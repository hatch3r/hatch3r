import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Framework, RepoInfo, Tool } from "../types.js";
import { detectPackageManager } from "./packageManager.js";

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
  const [languages, pm, isMonorepo, hasExistingAgents, existingTools, frameworks, linters, testFrameworks, ciProviders] =
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
    ]);
  const packageManager = pm.name;

  return {
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
  };
}

/** Detect programming languages by probing for language-specific config files. */
async function detectLanguages(rootDir: string): Promise<string[]> {
  const languages: string[] = [];
  // D14 Medium (#344-#357): Improved language detection with broader indicators
  const indicators: Record<string, string[]> = {
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

  for (const [lang, files] of Object.entries(indicators)) {
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

/** Check whether a `.agents/` directory already exists in the repo root. */
async function detectExistingAgents(rootDir: string): Promise<boolean> {
  return pathExists(join(rootDir, ".agents"));
}

const TOOL_INDICATORS: { tool: Tool; paths: string[] }[] = [
  { tool: "cursor", paths: [".cursor"] },
  { tool: "copilot", paths: [join(".github", "copilot-instructions.md")] },
  { tool: "claude", paths: ["CLAUDE.md", ".claude"] },
  { tool: "opencode", paths: ["opencode.json", "opencode.jsonc"] },
  { tool: "windsurf", paths: [".windsurfrules"] },
  { tool: "amp", paths: [".amp"] },
  { tool: "codex", paths: [".codex"] },
  { tool: "gemini", paths: [".gemini", "GEMINI.md"] },
  { tool: "cline", paths: [".clinerules", ".roo", ".roomodes"] },
  { tool: "aider", paths: [".aider", ".aider.conf.yml"] },
  { tool: "kiro", paths: [".kiro"] },
  { tool: "goose", paths: [".goosehints", ".goose"] },
  { tool: "zed", paths: [".rules"] },
  { tool: "amazon-q", paths: [".amazonq"] },
  { tool: "antigravity", paths: [".antigravity"] },
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
 */
const NON_JS_FRAMEWORK_INDICATORS: { framework: Framework; configs: string[] }[] = [
  { framework: "django", configs: ["manage.py"] },
  { framework: "flask", configs: ["wsgi.py"] },
  { framework: "rails", configs: ["Rakefile", "config/routes.rb"] },
  { framework: "spring", configs: ["src/main/resources/application.properties", "src/main/resources/application.yml"] },
  { framework: "laravel", configs: ["artisan"] },
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

  return lines.join("\n");
}
