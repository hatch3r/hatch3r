import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Framework, PackageEntry, RepoInfo, Tool } from "../types.js";
import { detectPackageManager } from "./packageManager.js";
import {
  detectConventionConflicts,
  formatConventionConflicts,
  type ConventionConflict,
} from "./conventionConflict.js";

/**
 * Analyze a repository directory to detect languages, frameworks, package
 * manager, linters, test frameworks, CI providers, and existing AI tool
 * configurations.
 *
 * Runs all detection probes in parallel for performance. Returns a
 * `RepoInfo` object used by `hatch3r init` to make smart defaults.
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function analyzeRepo(rootDir: string): Promise<RepoInfo> {
  const [languages, pm, isMonorepo, hasExistingAgents, existingTools, frameworks, linters, testFrameworks, ciProviders, hasDockerfile, hasDataArtifacts, packages] =
    await Promise.all([
      detectLanguages(rootDir),
      detectPackageManager(rootDir),
      detectMonorepo(rootDir),
      detectExistingAgents(rootDir),
      detectExistingTools(rootDir),
      detectFrameworks(rootDir),
      detectLinters(rootDir),
      detectTestFrameworks(rootDir),
      detectCIProviders(rootDir),
      detectDockerfile(rootDir),
      detectDataArtifacts(rootDir),
      // F14.2-H1 (D14): always run the package enumerator; it returns an empty
      // array for single-package repos, so the cost is one workspace-file
      // probe in the non-monorepo path. Populating this here means init/sync
      // never re-run repo detection just to learn the package layout.
      detectMonorepoPackages(rootDir),
    ]);
  const packageManager = pm.name;

  const info: RepoInfo = {
    languages,
    packageManager,
    frameworks,
    isMonorepo,
    hasExistingAgents,
    existingTools,
    rootDir,
    linters,
    testFrameworks,
    ciProviders,
    hasDockerfile,
    hasDataArtifacts,
  };
  if (packages.length > 0) {
    info.packages = packages;
  }
  return info;
}

/**
 * Single-source-of-truth greenfield classifier (D1-M2, Cycle 10 Wave-3).
 *
 * A repo is greenfield when there is only one detected language and that
 * language is `unknown` (no language probes hit), no existing AI tooling
 * (`existingTools` empty), and no pre-existing agent layout
 * (`hasExistingAgents` false). `init.ts` and the post-init JSON payload
 * previously duplicated this 4-clause predicate at two call sites; future
 * refactors that changed the clause shape risked them diverging.
 */
export function isGreenfield(repoInfo: Pick<RepoInfo, "languages" | "existingTools" | "hasExistingAgents">): boolean {
  return (
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents
  );
}

/**
 * Config-file indicators per detectable language (D14 Medium #344-#357).
 *
 * Single source of truth for which language names `detectLanguages` can emit
 * via filename probing. `csharp` is detected separately by file-extension scan
 * (`.csproj` / `.sln`) and so is appended to {@link DETECTABLE_LANGUAGES}
 * below rather than carrying a fixed-filename indicator list here.
 */
export const LANGUAGE_INDICATORS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "tsconfig.base.json", "tsconfig.app.json"],
  javascript: ["jsconfig.json", ".babelrc", "babel.config.js", "babel.config.json"],
  python: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "setup.cfg", "tox.ini"],
  rust: ["Cargo.toml", "Cargo.lock"],
  go: ["go.mod", "go.sum"],
  java: ["pom.xml", "build.gradle"],
  kotlin: ["build.gradle.kts"],
  ruby: ["Gemfile", ".ruby-version"],
  php: ["composer.json", "artisan"],
  swift: ["Package.swift"],
  dart: ["pubspec.yaml"],
  elixir: ["mix.exs"],
  scala: ["build.sbt"],
  zig: ["build.zig"],
  ocaml: ["dune-project"],
  haskell: ["stack.yaml", "cabal.project"],
  clojure: ["deps.edn", "project.clj"],
  lua: [".luacheckrc", "rockspec"],
};

/**
 * D14-3 (Cycle 11): The complete set of non-`unknown` language names
 * `detectLanguages` can return — every {@link LANGUAGE_INDICATORS} key plus
 * `csharp` (the extension-scanned outlier). Exported so the language ↔ tag
 * skew invariant test (`src/__tests__/content/languageTagSkew.test.ts`) can
 * assert that every detectable language is either mapped in
 * `content/tags.ts::LANGUAGE_TO_TAG` or named in that test's documented
 * unmapped allowlist — closing the silent-drift gap where a newly detected
 * language mapped to ∅ and stripped `lang:*` content.
 */
export const DETECTABLE_LANGUAGES: readonly string[] = [
  ...Object.keys(LANGUAGE_INDICATORS),
  "csharp",
];

/**
 * Detect programming languages by probing for language-specific config files.
 *
 * D14-16 (Cycle 11): exported so `hatch3r update` can re-detect languages
 * post-init without paying for the full 12-probe {@link analyzeRepo}. Returns
 * `["unknown"]` when no language indicator is found (same fallback `analyzeRepo`
 * surfaces). Callers that want the manifest-shaped set (no `unknown`) filter it
 * the way `init.ts::languagesForSelection` does.
 */
export async function detectLanguages(rootDir: string): Promise<string[]> {
  const languages: string[] = [];

  for (const [lang, files] of Object.entries(LANGUAGE_INDICATORS)) {
    for (const file of files) {
      if (await pathExists(join(rootDir, file))) {
        languages.push(lang);
        break;
      }
    }
  }

  try {
    const rootEntries = await readdir(rootDir);
    if (rootEntries.some(f => f.endsWith(".csproj") || f.endsWith(".sln"))) {
      languages.push("csharp");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (languages.length === 0) {
    languages.push("unknown");
  }

  return languages;
}

/** Detect whether the project is a monorepo by checking for workspace config files (pnpm-workspace, lerna, nx, turbo, or package.json workspaces). */
async function detectMonorepo(rootDir: string): Promise<boolean> {
  if (await pathExists(join(rootDir, "pnpm-workspace.yaml"))) return true;
  if (await pathExists(join(rootDir, "lerna.json"))) return true;
  if (await pathExists(join(rootDir, "nx.json"))) return true;
  if (await pathExists(join(rootDir, "turbo.json"))) return true;
  if (await pathExists(join(rootDir, "pants.toml"))) return true;

  try {
    const pkgJson = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgJson);
    if (pkg.workspaces) return true;
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError;
    if (!isExpected) throw err;
  }

  return false;
}

/**
 * F14.2-H1 (D14): Enumerate the package directories of a monorepo so the
 * manifest's `packages: PackageEntry[]` can be populated as a first-class
 * structure rather than a `detectMonorepo()` boolean.
 *
 * Resolution order follows the package-manager workspace definition, which is
 * the authoritative source per Turborepo's repository-structure guide
 * (https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository,
 * accessed 2026-05-27): `turbo.json`/`nx.json` flag a monorepo but defer the
 * package globs to the package manager. Globs are read from
 * `pnpm-workspace.yaml` (`packages:` list — https://pnpm.io/workspaces,
 * accessed 2026-05-27), the root `package.json` `workspaces` field, and the
 * `lerna.json` `packages` array. A candidate directory qualifies only when it
 * contains its own `package.json` (the Turborepo "directory with a
 * package.json" rule).
 *
 * Only single-level patterns (`dir/*`, trailing `/**`, and exact paths) are
 * expanded — this covers the dominant `packages/*` / `apps/*` convention.
 * Deeper recursive globs collapse to their first directory segment. Returns an
 * empty array when no workspace globs resolve to a package directory.
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function detectMonorepoPackages(rootDir: string): Promise<PackageEntry[]> {
  const patterns = await collectWorkspaceGlobs(rootDir);
  if (patterns.length === 0) return [];

  // Map first-path-segment prefix → set of glob remainders, so each parent
  // directory is read at most once regardless of how many patterns target it.
  const byPrefix = new Map<string, boolean>();
  for (const pattern of patterns) {
    const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.length === 0 || normalized.startsWith("/")) continue;
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    // Exact path with no wildcard segment → treat as a single package dir.
    if (!normalized.includes("*")) {
      byPrefix.set(normalized, false);
      continue;
    }

    // Wildcard pattern (e.g. "packages/*", "apps/**"): enumerate one level
    // under the leading non-wildcard prefix.
    const prefixSegments: string[] = [];
    for (const seg of segments) {
      if (seg.includes("*")) break;
      prefixSegments.push(seg);
    }
    byPrefix.set(prefixSegments.join("/"), true);
  }

  const found = new Map<string, PackageEntry>();

  for (const [prefix, isWildcard] of byPrefix) {
    if (!isWildcard) {
      await addPackageIfPresent(rootDir, prefix, found);
      continue;
    }

    const parentRel = prefix;
    const parentAbs = parentRel.length > 0 ? join(rootDir, parentRel) : rootDir;
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(parentAbs, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const rel = parentRel.length > 0 ? `${parentRel}/${entry.name}` : entry.name;
      await addPackageIfPresent(rootDir, rel, found);
    }
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Collect the raw workspace glob patterns declared by the repo's package
 * manager. Reads `pnpm-workspace.yaml` (`packages:` list), root `package.json`
 * `workspaces` (array form or `{ packages: [...] }` object form), and
 * `lerna.json` `packages`. Missing/malformed files contribute nothing.
 */
async function collectWorkspaceGlobs(rootDir: string): Promise<string[]> {
  const globs: string[] = [];

  // pnpm-workspace.yaml — parse the `packages:` list via the `yaml` dep.
  // A malformed YAML body is treated as "no signal" (parity with the
  // SyntaxError-swallowing JSON branches below), so a corrupt workspace file
  // never crashes the surrounding analyzeRepo() probe.
  try {
    const raw = await readFile(join(rootDir, "pnpm-workspace.yaml"), "utf-8");
    globs.push(...parsePnpmWorkspacePackages(raw));
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof YAMLParseError;
    if (!isExpected) throw err;
  }

  // package.json workspaces (array or { packages: [...] }).
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) {
      globs.push(...ws.filter((w: unknown): w is string => typeof w === "string"));
    } else if (ws && typeof ws === "object" && Array.isArray(ws.packages)) {
      globs.push(...ws.packages.filter((w: unknown): w is string => typeof w === "string"));
    }
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError;
    if (!isExpected) throw err;
  }

  // lerna.json packages.
  try {
    const raw = await readFile(join(rootDir, "lerna.json"), "utf-8");
    const lerna = JSON.parse(raw);
    if (Array.isArray(lerna.packages)) {
      globs.push(...lerna.packages.filter((w: unknown): w is string => typeof w === "string"));
    }
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError;
    if (!isExpected) throw err;
  }

  return globs;
}

/**
 * Parse the `packages:` list of a `pnpm-workspace.yaml` file into a list of
 * glob strings. Uses the `yaml` dependency (same parser as the rest of the
 * codebase, e.g. `src/adapters/canonical.ts`) so BOTH the block shape and the
 * YAML flow shape resolve:
 *
 *   packages:            packages: ['packages/*', 'apps/*']
 *     - "packages/*"
 *     - 'apps/*'
 *
 * D1-24 (Cycle 11): the previous hand-rolled line-regex matched only
 * dash-prefixed block items, so a flow-style `packages: ['packages/*']` parsed
 * to `[]` — collapsing `manifest.packages` and skipping per-package `.hatch3r/`
 * sync. A real YAML parse handles both shapes. Non-list `packages:` values and
 * non-string list items yield nothing (string filter mirrors the JSON branches
 * in {@link collectWorkspaceGlobs}); a malformed YAML body throws and is caught
 * by the caller. Other top-level keys (`catalog:`, `catalogs:`) are ignored
 * because only the `packages` field is read.
 */
function parsePnpmWorkspacePackages(raw: string): string[] {
  const doc: unknown = parseYaml(raw);
  if (!doc || typeof doc !== "object") return [];
  const packages = (doc as { packages?: unknown }).packages;
  if (!Array.isArray(packages)) return [];
  return packages
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Add `{ name, path }` for `relPath` to `found` when `relPath/package.json`
 * exists. `name` is the package.json `name` field when present, else the
 * directory basename. `path` is the POSIX-style relative path from rootDir.
 */
async function addPackageIfPresent(
  rootDir: string,
  relPath: string,
  found: Map<string, PackageEntry>,
): Promise<void> {
  const normalized = relPath.replace(/\\/g, "/");
  if (found.has(normalized)) return;
  const pkgJsonPath = join(rootDir, normalized, "package.json");
  let name = normalized.split("/").filter(Boolean).pop() ?? normalized;
  try {
    const raw = await readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw);
    if (typeof pkg.name === "string" && pkg.name.length > 0) name = pkg.name;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return; // not a package dir
    if (!(err instanceof SyntaxError)) throw err;
    // Malformed package.json: still a package dir, fall back to basename name.
  }
  found.set(normalized, { name, path: normalized });
}

/**
 * Check whether a hatch3r state layout already exists in the repo root.
 *
 * F10 (D1-SA1.6, cycle 10 wave 4): Wave 6 relocated user-side state from
 * `.agents/` to `.hatch3r/` (manifest, learnings, handoffs, mcp). Probing
 * `.agents/` alone returned `false` on a fully-migrated 1.9+ install, dropping
 * one brownfield-detection signal for upgraded users. Probe BOTH the new
 * `.hatch3r/` layout and the legacy `.agents/` layout so the signal survives
 * the relocation while staying backward-compatible with pre-migration repos.
 */
async function detectExistingAgents(rootDir: string): Promise<boolean> {
  const [hasNew, hasLegacy] = await Promise.all([
    pathExists(join(rootDir, ".hatch3r")),
    pathExists(join(rootDir, ".agents")),
  ]);
  return hasNew || hasLegacy;
}

const TOOL_INDICATORS: { tool: Tool; paths: string[] }[] = [
  { tool: "cursor", paths: [".cursor"] },
  { tool: "copilot", paths: [join(".github", "copilot-instructions.md")] },
  { tool: "claude", paths: ["CLAUDE.md", ".claude"] },
];

/** Detect which AI coding tools already have configuration in the repo. */
async function detectExistingTools(rootDir: string): Promise<Tool[]> {
  const results = await Promise.allSettled(
    TOOL_INDICATORS.map(async ({ tool, paths }) => {
      for (const p of paths) {
        if (await pathExists(join(rootDir, p))) return tool;
      }
      return null;
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<Tool> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
}

/** Framework indicators that rely on config-file presence. */
const FRAMEWORK_CONFIG_INDICATORS: { framework: Framework; configs: string[] }[] = [
  { framework: "next", configs: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  { framework: "angular", configs: ["angular.json"] },
  { framework: "svelte", configs: ["svelte.config.js", "svelte.config.ts"] },
  { framework: "nuxt", configs: ["nuxt.config.js", "nuxt.config.ts"] },
  { framework: "astro", configs: ["astro.config.mjs", "astro.config.ts"] },
];

/**
 * Framework indicators that rely on package.json dependency names.
 *
 * Order matters: more-specific frameworks (Next.js, SvelteKit, Nuxt, Remix)
 * are checked first so that `react` / `vue` / `svelte` are only emitted when
 * no higher-level meta-framework already covers them.
 */
const FRAMEWORK_DEP_INDICATORS: { framework: Framework; deps: string[] }[] = [
  { framework: "next", deps: ["next"] },
  { framework: "angular", deps: ["@angular/core"] },
  { framework: "sveltekit", deps: ["@sveltejs/kit"] },
  { framework: "svelte", deps: ["svelte"] },
  { framework: "nuxt", deps: ["nuxt"] },
  { framework: "remix", deps: ["@remix-run/react"] },
  { framework: "astro", deps: ["astro"] },
  { framework: "vue", deps: ["vue"] },
  // D14-M1 (Cycle 10): 2026 JS meta-framework dep indicators. Listed before
  // base react/solid so the suppression map (FRAMEWORK_SUPPRESSION) collapses
  // the base entry once the meta-framework is detected.
  { framework: "tanstack-start", deps: ["@tanstack/start", "@tanstack/react-start"] },
  { framework: "solid-start", deps: ["@solidjs/start", "solid-start"] },
  { framework: "qwik", deps: ["@builder.io/qwik", "@qwik.dev/core"] },
  { framework: "react", deps: ["react"] },
  { framework: "express", deps: ["express"] },
  { framework: "fastify", deps: ["fastify"] },
  { framework: "hono", deps: ["hono"] },
  // D14 Medium (#344-#357): Non-JS framework detection
  { framework: "nestjs", deps: ["@nestjs/core"] },
];

/**
 * Config-file-based indicators for non-JS frameworks.
 * D14 Medium (#344-#357): Broader framework detection across language ecosystems.
 * D14-M1 (Cycle 10): Phoenix surfaces via `mix.exs` (Elixir-build manifest).
 * FastAPI / Axum / Actix are detected via dep-name lookup on Python / Rust
 * package manifests; see {@link NON_JS_FRAMEWORK_DEP_INDICATORS} below.
 */
const NON_JS_FRAMEWORK_INDICATORS: { framework: Framework; configs: string[] }[] = [
  { framework: "django", configs: ["manage.py"] },
  { framework: "flask", configs: ["wsgi.py"] },
  { framework: "rails", configs: ["Rakefile", "config/routes.rb"] },
  { framework: "spring", configs: ["src/main/resources/application.properties", "src/main/resources/application.yml"] },
  { framework: "laravel", configs: ["artisan"] },
  { framework: "phoenix", configs: ["mix.exs"] },
];

/**
 * D14-M1 (Cycle 10): Non-JS framework indicators that are detected by
 * scanning the language-native manifest body for a dependency name. Each
 * entry pairs a manifest filename with a list of substrings that, when
 * present anywhere in the manifest body, imply the framework is in use.
 *
 * Substring matching is intentional — `Cargo.toml` lists deps under
 * `[dependencies]` with `axum = "0.7"`, `pyproject.toml` lists `fastapi`
 * under `dependencies = [...]` or `[tool.poetry.dependencies]`, and
 * `requirements.txt` is a flat list. Parsing each format would multiply
 * complexity for no detection benefit — every false-positive surface
 * (a comment mentioning the framework) is small and the resulting agent
 * output is still useful guidance.
 */
const NON_JS_FRAMEWORK_DEP_INDICATORS: {
  framework: Framework;
  manifest: string;
  deps: string[];
}[] = [
  { framework: "fastapi", manifest: "pyproject.toml", deps: ["fastapi"] },
  { framework: "fastapi", manifest: "requirements.txt", deps: ["fastapi"] },
  { framework: "axum", manifest: "Cargo.toml", deps: ["axum"] },
  { framework: "actix", manifest: "Cargo.toml", deps: ["actix-web", "actix_web"] },
];

/**
 * Meta-framework → base-framework suppression map.
 * When a meta-framework is detected, its base framework is suppressed to
 * avoid redundant entries (e.g. Next.js already implies React).
 */
const FRAMEWORK_SUPPRESSION: Partial<Record<Framework, Framework>> = {
  next: "react",
  remix: "react",
  nuxt: "vue",
  sveltekit: "svelte",
  // D14-M1 (Cycle 10): TanStack Start is React-based, so suppress the
  // bare `react` entry once the meta-framework wraps it. SolidStart wraps
  // SolidJS (not in this enum, so no suppression needed). Qwik's
  // primitives are independent (no base framework to suppress).
  "tanstack-start": "react",
};

/** Detect web/backend frameworks via config files, package.json deps, and language-specific indicators. Suppresses base frameworks when a meta-framework is present (e.g. Next.js suppresses React). */
async function detectFrameworks(rootDir: string): Promise<Framework[]> {
  const detected = new Set<Framework>();

  // 1. Config-file presence checks (parallel).
  const configResults = await Promise.allSettled(
    FRAMEWORK_CONFIG_INDICATORS.map(async ({ framework, configs }) => {
      for (const cfg of configs) {
        if (await pathExists(join(rootDir, cfg))) return framework;
      }
      return null;
    }),
  );

  for (const r of configResults) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.add(r.value);
    }
  }

  // 2. package.json dependency checks.
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const { framework, deps } of FRAMEWORK_DEP_INDICATORS) {
      if (deps.some((d) => d in allDeps)) {
        detected.add(framework);
      }
    }
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError;
    if (!isExpected) throw err;
  }

  // 3. Non-JS framework detection via config file presence (D14 Medium)
  const nonJsResults = await Promise.allSettled(
    NON_JS_FRAMEWORK_INDICATORS.map(async ({ framework, configs }) => {
      for (const cfg of configs) {
        if (await pathExists(join(rootDir, cfg))) return framework;
      }
      return null;
    }),
  );
  for (const r of nonJsResults) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.add(r.value);
    }
  }

  // 3b. D14-M1 (Cycle 10): Non-JS framework dep-name probes — substring
  // match against Python/Rust manifest bodies. Failures (ENOENT, parse
  // errors) are silently skipped; the indicator is opt-in evidence rather
  // than a correctness gate.
  const manifestCache = new Map<string, string | null>();
  const nonJsDepResults = await Promise.allSettled(
    NON_JS_FRAMEWORK_DEP_INDICATORS.map(async ({ framework, manifest, deps }) => {
      let body = manifestCache.get(manifest);
      if (body === undefined) {
        try {
          body = await readFile(join(rootDir, manifest), "utf-8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            body = null;
          } else {
            // Permission or other I/O issue — treat as "no signal" rather
            // than failing the whole detect call (parity with the JS
            // package.json branch above).
            body = null;
          }
        }
        manifestCache.set(manifest, body);
      }
      if (body === null) return null;
      if (deps.some((d) => body!.includes(d))) return framework;
      return null;
    }),
  );
  for (const r of nonJsDepResults) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.add(r.value);
    }
  }

  // 4. Suppress base frameworks when a meta-framework is present.
  for (const [meta, base] of Object.entries(FRAMEWORK_SUPPRESSION)) {
    if (detected.has(meta as Framework)) {
      detected.delete(base as Framework);
    }
  }

  return [...detected];
}

// ── D14 Medium (#14.5): Linter / formatter detection ──────────────

/** Linter/formatter indicator files. */
const LINTER_INDICATORS: { name: string; configs: string[] }[] = [
  { name: "eslint", configs: [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts"] },
  { name: "prettier", configs: [".prettierrc", ".prettierrc.js", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.cjs", "prettier.config.js", "prettier.config.mjs"] },
  { name: "biome", configs: ["biome.json", "biome.jsonc"] },
  { name: "ruff", configs: ["ruff.toml", ".ruff.toml"] },
  { name: "black", configs: ["pyproject.toml"] }, // pyproject.toml with [tool.black] — config presence is sufficient
  { name: "rubocop", configs: [".rubocop.yml"] },
  { name: "golangci-lint", configs: [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"] },
  { name: "clippy", configs: [".clippy.toml", "clippy.toml"] },
  { name: "checkstyle", configs: ["checkstyle.xml"] },
  { name: "stylelint", configs: [".stylelintrc", ".stylelintrc.json", ".stylelintrc.yml", "stylelint.config.js"] },
  { name: "deno-lint", configs: ["deno.json", "deno.jsonc"] },
];

/** Detect linters and formatters by probing for their config files. */
export async function detectLinters(rootDir: string): Promise<string[]> {
  const detected: string[] = [];
  const results = await Promise.allSettled(
    LINTER_INDICATORS.map(async ({ name, configs }) => {
      for (const cfg of configs) {
        if (await pathExists(join(rootDir, cfg))) return name;
      }
      return null;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.push(r.value);
    }
  }
  return detected;
}

// ── D14 Medium (#14.6): Test framework detection ─────────────────

/** Test framework indicator files. */
const TEST_FRAMEWORK_INDICATORS: { name: string; configs: string[] }[] = [
  { name: "vitest", configs: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"] },
  { name: "jest", configs: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.json"] },
  { name: "mocha", configs: [".mocharc.yml", ".mocharc.json", ".mocharc.js"] },
  { name: "pytest", configs: ["pytest.ini", "conftest.py"] },
  { name: "rspec", configs: [".rspec", "spec/spec_helper.rb"] },
  { name: "junit", configs: ["src/test/java"] },
  { name: "go-test", configs: ["go.mod"] }, // Go test is built-in; presence of go.mod implies go test availability
  { name: "cargo-test", configs: ["Cargo.toml"] }, // Rust test is built-in
  { name: "phpunit", configs: ["phpunit.xml", "phpunit.xml.dist"] },
  { name: "playwright", configs: ["playwright.config.ts", "playwright.config.js"] },
  { name: "cypress", configs: ["cypress.config.ts", "cypress.config.js", "cypress.json"] },
];

/** Detect test frameworks by probing for their config files. */
export async function detectTestFrameworks(rootDir: string): Promise<string[]> {
  const detected: string[] = [];
  const results = await Promise.allSettled(
    TEST_FRAMEWORK_INDICATORS.map(async ({ name, configs }) => {
      for (const cfg of configs) {
        if (await pathExists(join(rootDir, cfg))) return name;
      }
      return null;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.push(r.value);
    }
  }
  return detected;
}

// ── D14 Medium (#14.7): CI provider detection ────────────────────

/** CI provider indicator files/directories. */
const CI_PROVIDER_INDICATORS: { name: string; configs: string[] }[] = [
  { name: "github-actions", configs: [".github/workflows"] },
  { name: "gitlab-ci", configs: [".gitlab-ci.yml"] },
  { name: "circleci", configs: [".circleci/config.yml"] },
  { name: "travis", configs: [".travis.yml"] },
  { name: "jenkins", configs: ["Jenkinsfile"] },
  { name: "azure-pipelines", configs: ["azure-pipelines.yml"] },
  { name: "bitbucket-pipelines", configs: ["bitbucket-pipelines.yml"] },
  { name: "buildkite", configs: [".buildkite/pipeline.yml"] },
  { name: "drone", configs: [".drone.yml"] },
  { name: "woodpecker", configs: [".woodpecker.yml", ".woodpecker"] },
];

/** Detect CI/CD providers by probing for their config files or directories. */
export async function detectCIProviders(rootDir: string): Promise<string[]> {
  const detected: string[] = [];
  const results = await Promise.allSettled(
    CI_PROVIDER_INDICATORS.map(async ({ name, configs }) => {
      for (const cfg of configs) {
        if (await pathExists(join(rootDir, cfg))) return name;
      }
      return null;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      detected.push(r.value);
    }
  }
  return detected;
}

// ── Container / data-artifact probes ─────────────────────────────

/** Root-level files that imply a container build is defined for the repo. */
const DOCKERFILE_INDICATORS = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  ".devcontainer",
  ".devcontainer.json",
];

/**
 * Detect whether the repo defines a container build at its root: any of
 * `Dockerfile`, `docker-compose.{yml,yaml}`, `compose.{yml,yaml}`, a
 * `.devcontainer` directory, or `.devcontainer.json`. Shallow root-level
 * probe only. Populates `RepoInfo.hasDockerfile`, which drives the
 * `docker-detected` tier-2 trigger in `src/cliTools/triggers.ts`.
 */
export async function detectDockerfile(rootDir: string): Promise<boolean> {
  const results = await Promise.all(
    DOCKERFILE_INDICATORS.map((name) => pathExists(join(rootDir, name))),
  );
  return results.some(Boolean);
}

/**
 * Detect whether the repo carries data artifacts at its root: a top-level
 * `data/` directory, or a root-level file ending in `.csv` / `.parquet`.
 * Shallow root-level probe only — no recursive walk — to keep the cost to a
 * single `readdir` plus one `stat`. Populates `RepoInfo.hasDataArtifacts`,
 * which strengthens the `data-project` tier-2 trigger beyond the language
 * heuristic in `src/cliTools/triggers.ts`.
 */
export async function detectDataArtifacts(rootDir: string): Promise<boolean> {
  if (await dirExists(join(rootDir, "data"))) return true;
  try {
    const entries = await readdir(rootDir);
    return entries.some((f) => f.endsWith(".csv") || f.endsWith(".parquet"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

// ── Utilities ─────────────────────────────────────────────────────

/** Check whether a filesystem path exists. Returns false for ENOENT, throws for other errors. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}

/** Check whether `path` exists and is a directory. Returns false for ENOENT or a non-directory, throws for other errors. */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}

/** Format a `RepoInfo` as a multi-line human-readable summary for CLI output. */
export function formatRepoSummary(info: RepoInfo): string {
  const lines = [
    `Languages: ${info.languages.join(", ")}`,
    `Package manager: ${info.packageManager}`,
    `Monorepo: ${info.isMonorepo ? "yes" : "no"}`,
    `Existing .agents/: ${info.hasExistingAgents ? "yes" : "no"}`,
  ];

  if (info.frameworks.length > 0) {
    lines.push(`Frameworks: ${info.frameworks.join(", ")}`);
  }

  if (info.existingTools.length > 0) {
    lines.push(`Existing tool configs: ${info.existingTools.join(", ")}`);
  }

  if (info.linters && info.linters.length > 0) {
    lines.push(`Linters: ${info.linters.join(", ")}`);
  }

  if (info.testFrameworks && info.testFrameworks.length > 0) {
    lines.push(`Test frameworks: ${info.testFrameworks.join(", ")}`);
  }

  if (info.ciProviders && info.ciProviders.length > 0) {
    lines.push(`CI providers: ${info.ciProviders.join(", ")}`);
  }

  // F14.4-H3 (D14): surface mutually-exclusive convention conflicts (e.g. two
  // test runners, two linters) detected from the toolchain lists above, so the
  // init summary warns when generated single-toolchain guidance contradicts a
  // mid-migration repo. Empty string when there are no conflicts.
  const conflictBlock = formatConventionConflicts(detectConventionConflicts(info));
  if (conflictBlock.length > 0) {
    lines.push(conflictBlock);
  }

  return lines.join("\n");
}

/**
 * Convenience consumer for `hatch3r init` (F14.4-H3): run convention-conflict
 * detection directly against a `RepoInfo`. Re-exported here so init.ts imports
 * a single detect surface; the manifest-persistence + post-init-box wiring is
 * cross-WU (init.ts / types.ts) — see the remainder note in
 * `src/detect/conventionConflict.ts`.
 */
export function analyzeConventionConflicts(info: RepoInfo): ConventionConflict[] {
  return detectConventionConflicts(info);
}

export { detectConventionConflicts, formatConventionConflicts, type ConventionConflict };
