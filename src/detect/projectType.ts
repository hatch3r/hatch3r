import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { RepoInfo } from "../types.js";

export interface ProjectTypeDetection {
  type: "greenfield" | "brownfield";
  confidence: number;
  signals: string[];
}

interface WeightedSignal {
  weight: number;
  label: string;
}

function getGitCommitDepth(rootDir: string): number {
  try {
    const out = execSync("git rev-list --count HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : 0;
    // Non-git or shallow-clone repos legitimately have no commit history;
    // returning 0 makes the commit-depth signal contribute nothing.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return 0;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isDirectory();
    // Missing-path ENOENT is the expected negative case for a presence probe.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
}

async function readDependencyCount(rootDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    return deps;
    // Absent / malformed package.json means "no node deps signal" — non-JS
    // brownfield repos hit this path by design.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return 0;
  }
}

async function readmeSize(rootDir: string): Promise<number> {
  try {
    const st = await fs.stat(join(rootDir, "README.md"));
    return st.size;
    // Missing README is the expected negative case for a presence probe.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return 0;
  }
}

export async function detectProjectType(
  info: RepoInfo,
  rootDir: string,
): Promise<ProjectTypeDetection> {
  const signals: WeightedSignal[] = [];

  const commits = getGitCommitDepth(rootDir);
  if (commits > 10) signals.push({ weight: 0.30, label: `${commits} commits` });

  if (info.hasExistingAgents) signals.push({ weight: 0.30, label: "existing .agents/" });

  if (info.languages.length > 0 && info.languages[0] !== "unknown") {
    signals.push({ weight: 0.25, label: `lang: ${info.languages[0]}` });
  }

  for (const name of ["src", "lib", "app"]) {
    if (await dirExists(join(rootDir, name))) {
      signals.push({ weight: 0.20, label: `${name}/ dir` });
    }
  }

  if (info.existingTools.length > 0) {
    signals.push({ weight: 0.20, label: `${info.existingTools.length} tool config(s)` });
  }

  const deps = await readDependencyCount(rootDir);
  if (deps >= 1) signals.push({ weight: 0.20, label: `${deps} deps` });

  if ((await readmeSize(rootDir)) > 2048) signals.push({ weight: 0.15, label: "README > 2KB" });

  const total = signals.reduce((s, x) => s + x.weight, 0);
  const top = [...signals].sort((a, b) => b.weight - a.weight).slice(0, 3).map((s) => s.label);

  return {
    type: total >= 0.40 ? "brownfield" : "greenfield",
    confidence: Math.min(1, total),
    signals: top,
  };
}
