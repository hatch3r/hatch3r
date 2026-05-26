import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, isAbsolute } from "node:path";
import { HATCH3R_DIR, HatchError } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type { WorkspaceManifest } from "./types.js";
import { WORKSPACE_MANIFEST_FILE, WORKSPACE_MANIFEST_VERSION } from "./types.js";

/**
 * Validate that a workspace repo path is safe (no traversal or absolute paths).
 * Rejects paths containing "..", absolute paths, and null bytes.
 */
export function isUnsafeRepoPath(repoPath: string): boolean {
  if (repoPath.includes('\0')) return true;
  if (isAbsolute(repoPath)) return true;
  const normalized = normalize(repoPath);
  if (normalized.startsWith('..')) return true;
  return false;
}

/** Runtime type guard that validates an unknown value conforms to the WorkspaceManifest shape. */
function validateWorkspaceManifest(data: unknown): data is WorkspaceManifest {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== "string") return false;
  if (typeof obj.hatch3rVersion !== "string") return false;
  if (typeof obj.name !== "string") return false;
  if (!Array.isArray(obj.repos)) return false;
  if (typeof obj.syncStrategy !== "string") return false;
  if (!["manual", "on-sync"].includes(obj.syncStrategy)) return false;

  if (!obj.defaults || typeof obj.defaults !== "object") return false;
  const defaults = obj.defaults as Record<string, unknown>;
  if (!Array.isArray(defaults.tools)) return false;
  if (!defaults.features || typeof defaults.features !== "object") return false;
  if (!defaults.mcp || typeof defaults.mcp !== "object") return false;

  // Validate MCP servers array
  const mcp = defaults.mcp as Record<string, unknown>;
  if (!Array.isArray(mcp.servers)) return false;

  // Validate content selection if present
  if (defaults.content !== undefined) {
    if (typeof defaults.content !== "object" || defaults.content === null) return false;
    const content = defaults.content as Record<string, unknown>;
    if (typeof content.preset !== "string") return false;
    if (typeof content.projectType !== "string") return false;
    if (typeof content.teamSize !== "string") return false;
    if (!content.items || typeof content.items !== "object") return false;
  }

  // Validate CLI tools config if present (plan §4.8 workspace parity)
  if (defaults.cliTools !== undefined) {
    if (typeof defaults.cliTools !== "object" || defaults.cliTools === null) return false;
    const cli = defaults.cliTools as Record<string, unknown>;
    if (typeof cli.enabled !== "boolean") return false;
    if (!Array.isArray(cli.selected)) return false;
    for (const id of cli.selected) {
      if (typeof id !== "string") return false;
    }
  }

  for (const repo of obj.repos as unknown[]) {
    if (!repo || typeof repo !== "object") return false;
    const r = repo as Record<string, unknown>;
    if (typeof r.path !== "string") return false;
    if (isUnsafeRepoPath(r.path)) return false;
    if (typeof r.sync !== "boolean") return false;
    if (r.owner !== undefined && typeof r.owner !== "string") return false;
    if (r.repo !== undefined && typeof r.repo !== "string") return false;
    if (r.defaultBranch !== undefined && typeof r.defaultBranch !== "string") return false;
    if (r.platform !== undefined && typeof r.platform !== "string") return false;
  }

  return true;
}

/** Read and validate the workspace manifest, returning null if not found. */
export async function readWorkspaceManifest(
  rootDir: string,
): Promise<WorkspaceManifest | null> {
  const manifestPath = join(rootDir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE);

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

  if (!validateWorkspaceManifest(parsed)) {
    throw new HatchError(
      `Invalid workspace manifest in ${manifestPath}: required fields missing or malformed.`,
      1,
      "VALIDATION_ERROR",
    );
  }

  return parsed;
}

/** Atomically write the workspace manifest to `.hatch3r/workspace.json`. */
export async function writeWorkspaceManifest(
  rootDir: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const manifestPath = join(rootDir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE);
  // Wave 6: ensure `.hatch3r/` exists; workspace init may write the manifest
  // before any other helper has created the directory on a fresh repo.
  await mkdir(dirname(manifestPath), { recursive: true });
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

/** Create a new workspace manifest with the given configuration. */
export function createWorkspaceManifest(
  name: string,
  defaults: WorkspaceManifest["defaults"],
  repos: WorkspaceManifest["repos"],
  syncStrategy: WorkspaceManifest["syncStrategy"] = "manual",
): WorkspaceManifest {
  return {
    version: WORKSPACE_MANIFEST_VERSION,
    hatch3rVersion: HATCH3R_VERSION,
    name,
    repos,
    defaults,
    syncStrategy,
  };
}
