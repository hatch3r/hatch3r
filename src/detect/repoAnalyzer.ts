import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepoInfo, Tool } from "../types.js";

export async function analyzeRepo(rootDir: string): Promise<RepoInfo> {
  const [languages, packageManager, isMonorepo, hasExistingAgents, existingTools] =
    await Promise.all([
      detectLanguages(rootDir),
      detectPackageManager(rootDir),
      detectMonorepo(rootDir),
      detectExistingAgents(rootDir),
      detectExistingTools(rootDir),
    ]);

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
    rust: ["Cargo.toml"],
    go: ["go.mod"],
    java: ["pom.xml", "build.gradle"],
    kotlin: ["build.gradle.kts"],
    ruby: ["Gemfile"],
    php: ["composer.json"],
    swift: ["Package.swift"],
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
  } catch { /* ignore */ }

  if (languages.length === 0) {
    languages.push("unknown");
  }

  return languages;
}

async function detectPackageManager(
  rootDir: string,
): Promise<RepoInfo["packageManager"]> {
  if (await pathExists(join(rootDir, "bun.lockb"))) return "bun";
  if (await pathExists(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(join(rootDir, "yarn.lock"))) return "yarn";
  if (await pathExists(join(rootDir, "package-lock.json"))) return "npm";
  if (await pathExists(join(rootDir, "package.json"))) return "npm";
  return "unknown";
}

async function detectMonorepo(rootDir: string): Promise<boolean> {
  if (await pathExists(join(rootDir, "pnpm-workspace.yaml"))) return true;
  if (await pathExists(join(rootDir, "lerna.json"))) return true;
  if (await pathExists(join(rootDir, "nx.json"))) return true;
  if (await pathExists(join(rootDir, "turbo.json"))) return true;

  try {
    const pkgJson = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgJson);
    if (pkg.workspaces) return true;
  } catch {
    // no package.json or invalid JSON
  }

  return false;
}

async function detectExistingAgents(rootDir: string): Promise<boolean> {
  return pathExists(join(rootDir, ".agents"));
}

async function detectExistingTools(rootDir: string): Promise<Tool[]> {
  const tools: Tool[] = [];

  if (await pathExists(join(rootDir, ".cursor"))) tools.push("cursor");
  if (await pathExists(join(rootDir, ".github", "copilot-instructions.md")))
    tools.push("copilot");
  if (
    (await pathExists(join(rootDir, "CLAUDE.md"))) ||
    (await pathExists(join(rootDir, ".claude")))
  )
    tools.push("claude");
  if (
    (await pathExists(join(rootDir, "opencode.json"))) ||
    (await pathExists(join(rootDir, "opencode.jsonc")))
  )
    tools.push("opencode");
  if (await pathExists(join(rootDir, ".windsurfrules")))
    tools.push("windsurf");
  if (await pathExists(join(rootDir, ".amp")))
    tools.push("amp");
  if (await pathExists(join(rootDir, ".codex"))) tools.push("codex");
  if ((await pathExists(join(rootDir, ".gemini"))) || (await pathExists(join(rootDir, "GEMINI.md")))) tools.push("gemini");
  if ((await pathExists(join(rootDir, ".clinerules"))) || (await pathExists(join(rootDir, ".roo"))) || (await pathExists(join(rootDir, ".roomodes")))) tools.push("cline");
  if (await pathExists(join(rootDir, ".aider.conf.yml"))) tools.push("aider");
  if (await pathExists(join(rootDir, ".kiro"))) tools.push("kiro");
  if ((await pathExists(join(rootDir, ".goosehints"))) || (await pathExists(join(rootDir, ".goose")))) tools.push("goose");
  if (await pathExists(join(rootDir, ".rules"))) tools.push("zed");

  return tools;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
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
