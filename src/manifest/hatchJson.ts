import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_DIR,
  HatchError,
  MANIFEST_FILE,
  VALID_TOOLS,
  WORKTREE_CAPABLE_TOOLS,
  DEFAULT_FEATURES,
  type BoardConfig,
  type ContentSelection,
  type HatchManifest,
  type Platform,
  type Tool,
} from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile } from "../merge/safeWrite.js";

/**
 * Validate a git branch name against the rules from `git check-ref-format`.
 *
 * Rejects names that:
 * - are empty or whitespace-only
 * - contain `..", `~`, `^`, `:`, `\`, spaces, or control characters
 * - start or end with `/` or `.`
 * - contain consecutive slashes `//`
 * - end with `.lock`
 * - contain `@{` (reflog syntax)
 * - are exactly `@`
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.trim() !== name) return false;
  if (/[~^:\\\x00-\x1f\x7f ]/.test(name)) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  if (name.includes("..")) return false;
  if (name.includes("//")) return false;
  if (name.endsWith(".lock")) return false;
  if (name.includes("@{")) return false;
  if (name === "@") return false;
  return true;
}

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
  platform?: Platform;
  owner?: string;
  repo?: string;
  namespace?: string;
  project?: string;
  defaultBranch?: string;
  tools: Tool[];
  features?: Partial<HatchManifest["features"]>;
  mcpServers?: string[];
  content?: ContentSelection;
  languages?: string[];
}): HatchManifest {
  const platform = options.platform ?? "github";
  const owner = options.owner ?? "";
  const repo = options.repo ?? "";
  const namespace = options.namespace ?? owner;
  const project = options.project ?? repo;
  const manifest: HatchManifest = {
    version: "2.0.0",
    hatch3rVersion: HATCH3R_VERSION,
    platform,
    owner,
    repo,
    namespace,
    project,
    tools: options.tools,
    features: { ...DEFAULT_FEATURES, ...options.features },
    mcp: { servers: options.mcpServers ?? [] },
    managedFiles: [],
  };
  if (options.content) {
    manifest.content = options.content;
  }
  if (options.languages && options.languages.length > 0 && options.languages[0] !== "unknown") {
    manifest.languages = options.languages;
  }
  if (options.defaultBranch) {
    manifest.board = createMinimalBoardConfig(owner, repo, options.defaultBranch);
  }
  if (options.tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t))) {
    manifest.worktree = { enabled: true };
  }
  return manifest;
}

export function migrateManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw };

  if (!migrated.namespace && typeof migrated.owner === "string") {
    migrated.namespace = migrated.owner;
  }
  if (!migrated.namespace) {
    migrated.namespace = "";
  }

  if (!migrated.project && typeof migrated.repo === "string") {
    migrated.project = migrated.repo;
  }
  if (!migrated.project) {
    migrated.project = "";
  }

  if (migrated.version === "1.0.0") {
    migrated.version = "2.0.0";
  }

  return migrated;
}

function validateManifest(data: unknown): data is HatchManifest {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.version !== "string" ||
    typeof obj.hatch3rVersion !== "string" ||
    (obj.platform !== undefined && typeof obj.platform !== "string") ||
    !Array.isArray(obj.tools) ||
    obj.features === null ||
    typeof obj.features !== "object" ||
    obj.mcp === null ||
    typeof obj.mcp !== "object" ||
    !Array.isArray(obj.managedFiles)
  ) {
    return false;
  }

  // #108: Validate tools array entries are known tool strings
  for (const tool of obj.tools as unknown[]) {
    if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) return false;
  }

  // #108: Validate board sub-schema when present
  if (obj.board !== undefined) {
    if (typeof obj.board !== "object" || obj.board === null) return false;
    const board = obj.board as Record<string, unknown>;
    if (typeof board.owner !== "string") return false;
    if (typeof board.repo !== "string") return false;
    if (board.defaultBranch !== undefined) {
      if (typeof board.defaultBranch !== "string") return false;
      // #1.15: Validate defaultBranch against git branch naming rules
      if (!isValidGitBranchName(board.defaultBranch)) return false;
    }
  }

  // #108: Validate worktree.extraPatterns when present
  if (obj.worktree !== undefined) {
    const wt = obj.worktree as Record<string, unknown>;
    if (wt.extraPatterns !== undefined) {
      if (!Array.isArray(wt.extraPatterns)) return false;
      if (!(wt.extraPatterns as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.content !== undefined) {
    if (typeof obj.content !== "object" || obj.content === null) return false;
    const content = obj.content as Record<string, unknown>;
    if (typeof content.preset !== "string") return false;
    if (typeof content.projectType !== "string") return false;
    if (typeof content.teamSize !== "string") return false;
    if (!content.items || typeof content.items !== "object") return false;
    const items = content.items as Record<string, unknown>;
    const requiredKeys = ["agents", "skills", "rules", "commands", "prompts", "hooks", "githubAgents"];
    for (const key of requiredKeys) {
      if (!Array.isArray(items[key])) return false;
      if (!(items[key] as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.costTracking !== undefined) {
    if (typeof obj.costTracking !== "object" || obj.costTracking === null) return false;
    const ct = obj.costTracking as Record<string, unknown>;
    if (ct.sessionBudget !== undefined && typeof ct.sessionBudget !== "number") return false;
    if (ct.issueBudget !== undefined && typeof ct.issueBudget !== "number") return false;
    if (ct.epicBudget !== undefined && typeof ct.epicBudget !== "number") return false;
    if (ct.currency !== undefined && typeof ct.currency !== "string") return false;
    if (ct.warningThresholds !== undefined) {
      if (!Array.isArray(ct.warningThresholds)) return false;
      if (!(ct.warningThresholds as unknown[]).every((v) => typeof v === "number")) return false;
    }
    if (ct.hardStop !== undefined && typeof ct.hardStop !== "boolean") return false;
  }

  if (obj.specs !== undefined) {
    if (typeof obj.specs !== "object" || obj.specs === null) return false;
    const specs = obj.specs as Record<string, unknown>;
    if (!Array.isArray(specs.paths)) return false;
    if (!(specs.paths as unknown[]).every((v) => typeof v === "string")) return false;
    if (specs.lastGenerated !== undefined && typeof specs.lastGenerated !== "string") return false;
  }

  if (obj.workspace !== undefined) {
    if (typeof obj.workspace !== "object" || obj.workspace === null) return false;
    const ws = obj.workspace as Record<string, unknown>;
    if (typeof ws.rootPath !== "string") return false;
    if (typeof ws.lastSync !== "string") return false;
    if (typeof ws.syncVersion !== "string") return false;
    if (typeof ws.workspaceChecksum !== "string") return false;
    if (ws.excludedContent !== undefined) {
      if (!Array.isArray(ws.excludedContent)) return false;
      if (!(ws.excludedContent as unknown[]).every((v) => typeof v === "string")) return false;
    }
    if (ws.localContent !== undefined) {
      if (!Array.isArray(ws.localContent)) return false;
      if (!(ws.localContent as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.managedFilesByAdapter !== undefined) {
    if (typeof obj.managedFilesByAdapter !== "object" || obj.managedFilesByAdapter === null) return false;
    for (const [k, v] of Object.entries(obj.managedFilesByAdapter as Record<string, unknown>)) {
      if (typeof k !== "string") return false;
      if (!Array.isArray(v)) return false;
      if (!(v as unknown[]).every((p) => typeof p === "string")) return false;
    }
  }

  return true;
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
    throw new HatchError(
      `Malformed JSON in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      1,
      "CONFIG_ERROR",
    );
  }

  const migrated = migrateManifest(parsed as Record<string, unknown>);

  if (!validateManifest(migrated)) {
    throw new HatchError(
      `Invalid manifest in ${manifestPath}: required fields missing or malformed. Run hatch3r init to regenerate.`,
      1,
      "CONFIG_ERROR",
    );
  }
  return migrated;
}

export async function writeManifest(
  rootDir: string,
  manifest: HatchManifest,
): Promise<void> {
  // C8-D1-M2: Validate manifest schema before persisting to disk.
  if (!validateManifest(manifest)) {
    throw new HatchError(
      "Invalid manifest schema: required fields missing or malformed. " +
      "Expected valid HatchManifest with tools, mcp, managedFiles populated. " +
      "Check that tools are in VALID_TOOLS and all required fields present.",
      undefined,
      "CONFIG_ERROR",
    );
  }
  const manifestPath = join(rootDir, AGENTS_DIR, MANIFEST_FILE);
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export function addManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  if (!manifest.managedFiles.includes(filePath)) {
    manifest.managedFiles.push(filePath);
  }
}

export function removeManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  manifest.managedFiles = manifest.managedFiles.filter((f) => f !== filePath);
}
