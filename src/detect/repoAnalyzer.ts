import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Framework, RepoInfo, Tool } from "../types.js";
import { detectPackageManager } from "./packageManager.js";

export async function analyzeRepo(rootDir: string): Promise<RepoInfo> {
  const [languages, pm, isMonorepo, hasExistingAgents, existingTools, frameworks] =
    await Promise.all([
      detectLanguages(rootDir),
      detectPackageManager(rootDir),
      detectMonorepo(rootDir),
      detectExistingAgents(rootDir),
      detectExistingTools(rootDir),
      detectFrameworks(rootDir),
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
  };
}

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
];

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}

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

  return lines.join("\n");
}
