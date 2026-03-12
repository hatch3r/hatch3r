import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepoInfo, Tool } from "../types.js";
import { detectPackageManager } from "./packageManager.js";

export async function analyzeRepo(rootDir: string): Promise<RepoInfo> {
  const [languages, pm, isMonorepo, hasExistingAgents, existingTools] =
    await Promise.all([
      detectLanguages(rootDir),
      detectPackageManager(rootDir),
      detectMonorepo(rootDir),
      detectExistingAgents(rootDir),
      detectExistingTools(rootDir),
    ]);
  const packageManager = pm.name;

  return {
    languages,
    packageManager,
    isMonorepo,
    hasExistingAgents,
    existingTools,
    rootDir,
  };
}

async function detectLanguages(rootDir: string): Promise<string[]> {
  const languages: string[] = [];
  const indicators: Record<string, string[]> = {
    typescript: ["tsconfig.json", "tsconfig.base.json"],
    javascript: ["jsconfig.json"],
    python: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    rust: ["Cargo.toml", "Cargo.lock"],
    go: ["go.mod", "go.sum"],
    java: ["pom.xml", "build.gradle"],
    kotlin: ["build.gradle.kts"],
    ruby: ["Gemfile"],
    php: ["composer.json"],
    swift: ["Package.swift"],
    dart: ["pubspec.yaml"],
    elixir: ["mix.exs"],
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

  if (info.existingTools.length > 0) {
    lines.push(`Existing tool configs: ${info.existingTools.join(", ")}`);
  }

  return lines.join("\n");
}
