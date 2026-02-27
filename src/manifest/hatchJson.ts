import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import {
  AGENTS_DIR,
  MANIFEST_FILE,
  DEFAULT_FEATURES,
  type BoardConfig,
  type HatchManifest,
  type Tool,
} from "../types.js";
import { HATCH3R_VERSION } from "../version.js";

function createMinimalBoardConfig(owner: string, repo: string, defaultBranch: string): BoardConfig {
  return {
    owner,
    repo,
    defaultBranch,
    projectNumber: null,
    statusFieldId: null,
    statusOptions: {
      backlog: null,
      ready: null,
      inProgress: null,
      inReview: null,
      done: null,
    },
    labels: {
      types: ["type:bug", "type:feature", "type:refactor", "type:qa", "type:docs", "type:infra"],
      executors: ["executor:agent", "executor:human", "executor:hybrid"],
      statuses: ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:blocked"],
      meta: ["meta:board-overview"],
    },
    branchConvention: "{type}/{short-description}",
    areas: [],
  };
}

export function createManifest(options: {
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  tools: Tool[];
  features?: Partial<HatchManifest["features"]>;
  mcpServers?: string[];
}): HatchManifest {
  const owner = options.owner ?? "";
  const repo = options.repo ?? "";
  const manifest: HatchManifest = {
    version: "1.0.0",
    hatch3rVersion: HATCH3R_VERSION,
    owner,
    repo,
    tools: options.tools,
    features: { ...DEFAULT_FEATURES, ...options.features },
    mcp: { servers: options.mcpServers ?? [] },
    managedFiles: [],
  };
  if (options.defaultBranch) {
    manifest.board = createMinimalBoardConfig(owner, repo, options.defaultBranch);
  }
  return manifest;
}

function validateManifest(data: unknown): data is HatchManifest {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.version === "string" &&
    typeof obj.hatch3rVersion === "string" &&
    Array.isArray(obj.tools) &&
    obj.features !== null &&
    typeof obj.features === "object" &&
    obj.mcp !== null &&
    typeof obj.mcp === "object" &&
    Array.isArray(obj.managedFiles)
  );
}

export async function readManifest(
  rootDir: string,
): Promise<HatchManifest | null> {
  const manifestPath = join(rootDir, AGENTS_DIR, MANIFEST_FILE);

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(
      `Malformed JSON in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!validateManifest(parsed)) {
    console.error(chalk.red("Invalid .agents/hatch.json: missing required fields (version, hatch3rVersion, tools, features, managedFiles)"));
    return null;
  }
  return parsed;
}

export async function writeManifest(
  rootDir: string,
  manifest: HatchManifest,
): Promise<void> {
  const manifestPath = join(rootDir, AGENTS_DIR, MANIFEST_FILE);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function addManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  if (!manifest.managedFiles.includes(filePath)) {
    manifest.managedFiles.push(filePath);
  }
}
