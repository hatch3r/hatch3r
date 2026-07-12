import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, isAbsolute } from "node:path";
import { HATCH3R_DIR, HatchError, VALID_TOOLS, TOOL_CHOICES } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile, acquireWriteLock } from "../merge/safeWrite.js";
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

  // D14-M4 (Cycle 10): validate optional groups field on defaults.
  if (defaults.groups !== undefined) {
    if (typeof defaults.groups !== "object" || defaults.groups === null || Array.isArray(defaults.groups)) return false;
    for (const [_, delta] of Object.entries(defaults.groups)) {
      if (!delta || typeof delta !== "object") return false;
      const d = delta as Record<string, unknown>;
      if (d.tools !== undefined && !Array.isArray(d.tools)) return false;
      if (d.features !== undefined && (typeof d.features !== "object" || d.features === null)) return false;
      if (d.mcp !== undefined && (typeof d.mcp !== "object" || d.mcp === null)) return false;
      if (d.contentOverrides !== undefined) {
        if (typeof d.contentOverrides !== "object" || d.contentOverrides === null) return false;
        const co = d.contentOverrides as Record<string, unknown>;
        if (co.include !== undefined && !Array.isArray(co.include)) return false;
        if (co.exclude !== undefined && !Array.isArray(co.exclude)) return false;
      }
    }
  }

  // D14-M7 (Cycle 10): validate optional lockedContent on defaults.
  if (defaults.lockedContent !== undefined) {
    if (!Array.isArray(defaults.lockedContent)) return false;
    for (const id of defaults.lockedContent) {
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
    // D14-M4 (Cycle 10): validate optional groups membership on repo entry.
    if (r.groups !== undefined) {
      if (!Array.isArray(r.groups)) return false;
      for (const g of r.groups) {
        if (typeof g !== "string") return false;
      }
    }
  }

  return true;
}

/**
 * D2-SA2.5-05: collect every workspace tool id that is not in VALID_TOOLS.
 * The 1.9.0 hard-cut (15 adapters to 3) means an upgraded workspace can
 * legitimately still hold retired ids (windsurf, cline, ...) in
 * `defaults.tools`, a `groups[<name>].tools` delta, or a per-repo
 * `overrides.tools`. `validateWorkspaceManifest` above only checks each of
 * those for array-ness, so a stale id survives read and flows through the
 * sync merge into `getAdapter` — which throws a structured HatchError whose
 * recoveryHint the sync resilience catch discards. This mirrors the
 * repo-manifest reader's #108 entry check (manifest/hatchJson.ts:398) so the
 * two manifest readers reject unknown tool ids symmetrically. Returns [] when
 * every tool id across all three sites is known.
 */
function collectWorkspaceToolErrors(manifest: WorkspaceManifest): string[] {
  const errors: string[] = [];
  const checkEntries = (tools: unknown, where: string): void => {
    // Array-ness is already enforced by validateWorkspaceManifest; a
    // non-array (or absent) field simply has no entries to validate here.
    if (!Array.isArray(tools)) return;
    for (const tool of tools as unknown[]) {
      if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) {
        errors.push(`${where} contains unknown tool ${JSON.stringify(tool)}`);
      }
    }
  };

  checkEntries(manifest.defaults.tools, "`defaults.tools`");
  if (manifest.defaults.groups) {
    for (const [name, delta] of Object.entries(manifest.defaults.groups)) {
      checkEntries(delta.tools, `\`groups.${name}.tools\``);
    }
  }
  for (const repo of manifest.repos) {
    checkEntries(repo.overrides?.tools, `repo \`${repo.path}\` \`overrides.tools\``);
  }
  return errors;
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

  // D2-SA2.5-05: reject stale/unknown tool ids at the manifest boundary,
  // matching the repo-manifest reader's #108 check (manifest/hatchJson.ts:398).
  // Left unchecked, a retired id (windsurf, cline, ...) in defaults.tools, a
  // groups delta, or a per-repo override reaches getAdapter during sync, which
  // throws a HatchError whose recoveryHint the sync resilience catch discards.
  // Surfacing the supported set + file path here — with a recoveryHint —
  // keeps the actionable next step intact.
  const toolErrors = collectWorkspaceToolErrors(parsed);
  if (toolErrors.length > 0) {
    throw new HatchError(
      `Invalid workspace manifest in ${manifestPath}: ${toolErrors.join("; ")}. Supported tools: ${TOOL_CHOICES}.`,
      1,
      "VALIDATION_ERROR",
      `Remove retired tool ids from the tool list(s) in ${manifestPath} — the 1.9.0 release cut all adapters except ${TOOL_CHOICES} — then re-run \`hatch3r sync\`.`,
    );
  }

  return parsed;
}

/**
 * Atomically write the workspace manifest to `.hatch3r/workspace.json`.
 *
 * **Cross-process concurrency (F1.9-H1, Cycle 10 D1):** the in-process mutex
 * in `workspace/sync.ts` (`runSerialized`) plus `pLimit` only serialize writes
 * *within* one Node process. Two CI runners — or two operator shells — running
 * `hatch3r sync` against the same workspace root concurrently would otherwise
 * race the read-modify-write of `lastSync` entries and silently drop the slower
 * writer's timestamps. This function takes the same cross-process advisory lock
 * `atomicWriteFile` uses (opt-in via `HATCH3R_LOCK=1`, D1-SA1.5.1) explicitly
 * around the write so the protection is visible at this call site and survives
 * future refactors of `atomicWriteFile`'s internals. When the env var is unset
 * the lock is a no-op (single-process default unchanged); when set, a second
 * concurrent writer surfaces an `ELOCKED` → `HatchError(LOCK_TIMEOUT)` after the
 * existing 5×500 ms retry budget rather than clobbering silently.
 */
export async function writeWorkspaceManifest(
  rootDir: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const manifestPath = join(rootDir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE);
  // Wave 6: ensure `.hatch3r/` exists; workspace init may write the manifest
  // before any other helper has created the directory on a fresh repo.
  await mkdir(dirname(manifestPath), { recursive: true });
  // F1.9-H1: explicit cross-process lock. acquireWriteLock is reentrant within
  // a single process (HELD_LOCKS set), so the nested acquire inside
  // atomicWriteFile short-circuits to a no-op — the lock is taken exactly once
  // and released once here.
  const release = await acquireWriteLock(manifestPath);
  try {
    await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  } finally {
    await release();
  }
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
