import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, isAbsolute } from "node:path";
import { HATCH3R_DIR, HatchError, VALID_TOOLS, TOOL_CHOICES } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile, acquireWriteLock } from "../merge/safeWrite.js";
import { isPlainObject, unknownFields } from "../config/parse.js";
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

/**
 * DD-C2 (release/2.8.5): normalize a repo path for duplicate detection.
 * `normalize()` folds `"api"` / `"./api"` / `"api/"` onto one key; trailing
 * separators are stripped explicitly (normalize keeps them); win32
 * case-folds because NTFS paths are case-insensitive, so `Api` and `api`
 * name the same directory there. Exported for direct unit coverage.
 */
export function normalizeRepoPathKey(repoPath: string): string {
  let key = normalize(repoPath).replace(/[\\/]+$/, "");
  if (process.platform === "win32") key = key.toLowerCase();
  return key;
}

/**
 * DD-C4 (release/2.8.5): per-field error accumulation over the
 * WorkspaceManifest shape — the boolean type-guard walk this replaces
 * reported only "required fields missing or malformed" with no field name,
 * so a hand-edited workspace.json was recovered field-by-field across
 * reruns. Mirrors `manifest/hatchJson.ts::collectManifestErrors` (D1-M13):
 * every defect is collected in one pass, each message names its field path.
 * DD-C2: also rejects two `repos[]` entries whose paths normalize to the
 * same directory (both would sync concurrently under `pLimit`, racing every
 * write in that repo). Exported for direct unit coverage;
 * {@link validateWorkspaceManifest} is defined as `.length === 0` over this.
 */
export function collectWorkspaceManifestErrors(data: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(data)) {
    errors.push(`manifest root must be a JSON object (got ${data === null ? "null" : Array.isArray(data) ? "an array" : typeof data})`);
    return errors;
  }
  const obj = data;

  if (typeof obj.version !== "string") errors.push("`version` must be a string");
  if (typeof obj.hatch3rVersion !== "string") errors.push("`hatch3rVersion` must be a string");
  if (typeof obj.name !== "string") errors.push("`name` must be a string");
  if (typeof obj.syncStrategy !== "string" || !["manual", "on-sync"].includes(obj.syncStrategy)) {
    errors.push('`syncStrategy` must be "manual" or "on-sync"');
  }

  if (!isPlainObject(obj.defaults)) {
    errors.push("`defaults` must be an object");
  } else {
    const defaults = obj.defaults;
    if (!Array.isArray(defaults.tools)) errors.push("`defaults.tools` must be an array");
    if (!isPlainObject(defaults.features)) errors.push("`defaults.features` must be an object");
    if (!isPlainObject(defaults.mcp)) {
      errors.push("`defaults.mcp` must be an object");
    } else if (!Array.isArray(defaults.mcp.servers)) {
      errors.push("`defaults.mcp.servers` must be an array");
    }

    // Validate content selection if present
    if (defaults.content !== undefined) {
      if (!isPlainObject(defaults.content)) {
        errors.push("`defaults.content` must be an object");
      } else {
        const content = defaults.content;
        if (typeof content.preset !== "string") errors.push("`defaults.content.preset` must be a string");
        if (typeof content.projectType !== "string") errors.push("`defaults.content.projectType` must be a string");
        if (typeof content.teamSize !== "string") errors.push("`defaults.content.teamSize` must be a string");
        if (!isPlainObject(content.items)) errors.push("`defaults.content.items` must be an object");
      }
    }

    // Validate CLI tools config if present (plan §4.8 workspace parity)
    if (defaults.cliTools !== undefined) {
      if (!isPlainObject(defaults.cliTools)) {
        errors.push("`defaults.cliTools` must be an object");
      } else {
        const cli = defaults.cliTools;
        if (typeof cli.enabled !== "boolean") errors.push("`defaults.cliTools.enabled` must be a boolean");
        if (!Array.isArray(cli.selected) || cli.selected.some((id) => typeof id !== "string")) {
          errors.push("`defaults.cliTools.selected` must be an array of strings");
        }
      }
    }

    // D14-M4 (Cycle 10): validate optional groups field on defaults.
    if (defaults.groups !== undefined) {
      if (!isPlainObject(defaults.groups)) {
        errors.push("`defaults.groups` must be an object of group deltas");
      } else {
        for (const [name, delta] of Object.entries(defaults.groups)) {
          if (!isPlainObject(delta)) {
            errors.push(`\`defaults.groups.${name}\` must be an object`);
            continue;
          }
          if (delta.tools !== undefined && !Array.isArray(delta.tools)) errors.push(`\`defaults.groups.${name}.tools\` must be an array`);
          if (delta.features !== undefined && !isPlainObject(delta.features)) errors.push(`\`defaults.groups.${name}.features\` must be an object`);
          if (delta.mcp !== undefined && !isPlainObject(delta.mcp)) errors.push(`\`defaults.groups.${name}.mcp\` must be an object`);
          if (delta.contentOverrides !== undefined) {
            if (!isPlainObject(delta.contentOverrides)) {
              errors.push(`\`defaults.groups.${name}.contentOverrides\` must be an object`);
            } else {
              const co = delta.contentOverrides;
              if (co.include !== undefined && !Array.isArray(co.include)) errors.push(`\`defaults.groups.${name}.contentOverrides.include\` must be an array`);
              if (co.exclude !== undefined && !Array.isArray(co.exclude)) errors.push(`\`defaults.groups.${name}.contentOverrides.exclude\` must be an array`);
            }
          }
        }
      }
    }

    // D14-M7 (Cycle 10): validate optional lockedContent on defaults.
    if (defaults.lockedContent !== undefined) {
      if (!Array.isArray(defaults.lockedContent) || defaults.lockedContent.some((id) => typeof id !== "string")) {
        errors.push("`defaults.lockedContent` must be an array of strings");
      }
    }
  }

  if (!Array.isArray(obj.repos)) {
    errors.push("`repos` must be an array");
  } else {
    // DD-C2: duplicate detection over the normalized path key. Before this,
    // `"api"` and `"./api"` were two accepted entries that both synced the
    // same directory — concurrent writes under pLimit with no error.
    const seenPaths = new Map<string, string>();
    obj.repos.forEach((repo, i) => {
      if (!isPlainObject(repo)) {
        errors.push(`\`repos[${i}]\` must be an object`);
        return;
      }
      const r = repo;
      if (typeof r.path !== "string") {
        errors.push(`\`repos[${i}].path\` must be a string`);
      } else if (isUnsafeRepoPath(r.path)) {
        errors.push(`\`repos[${i}].path\` is unsafe (absolute, traversal, or null byte): ${JSON.stringify(r.path)}`);
      } else {
        const key = normalizeRepoPathKey(r.path);
        const prior = seenPaths.get(key);
        if (prior !== undefined) {
          errors.push(
            `\`repos[]\` contains duplicate paths: ${JSON.stringify(prior)} and ${JSON.stringify(r.path)} ` +
              `both normalize to ${JSON.stringify(key)} — two entries syncing one directory race every write. ` +
              `Remove one entry.`,
          );
        } else {
          seenPaths.set(key, r.path);
        }
      }
      if (typeof r.sync !== "boolean") errors.push(`\`repos[${i}].sync\` must be a boolean`);
      if (r.owner !== undefined && typeof r.owner !== "string") errors.push(`\`repos[${i}].owner\` must be a string`);
      if (r.repo !== undefined && typeof r.repo !== "string") errors.push(`\`repos[${i}].repo\` must be a string`);
      if (r.defaultBranch !== undefined && typeof r.defaultBranch !== "string") errors.push(`\`repos[${i}].defaultBranch\` must be a string`);
      if (r.platform !== undefined && typeof r.platform !== "string") errors.push(`\`repos[${i}].platform\` must be a string`);
      // D14-M4 (Cycle 10): validate optional groups membership on repo entry.
      if (r.groups !== undefined && (!Array.isArray(r.groups) || r.groups.some((g) => typeof g !== "string"))) {
        errors.push(`\`repos[${i}].groups\` must be an array of strings`);
      }
    });
  }

  return errors;
}

/** Runtime type guard over the WorkspaceManifest shape — defined as
 *  {@link collectWorkspaceManifestErrors} returning zero entries (DD-C4). */
function validateWorkspaceManifest(data: unknown): data is WorkspaceManifest {
  return collectWorkspaceManifestErrors(data).length === 0;
}

/** Top-level + `defaults` keys the current schema understands — the
 *  unknown-field advisory in {@link readWorkspaceManifest} reports keys
 *  outside these sets (DD-C4 unknown-field policy: warn, never reject,
 *  so a same-major newer manifest stays readable). */
const KNOWN_WORKSPACE_MANIFEST_KEYS = [
  "version",
  "hatch3rVersion",
  "name",
  "repos",
  "defaults",
  "syncStrategy",
] as const;
const KNOWN_WORKSPACE_DEFAULTS_KEYS = [
  "platform",
  "tools",
  "features",
  "mcp",
  "content",
  "models",
  "cliTools",
  "groups",
  "lockedContent",
] as const;

/**
 * DD-C3 (release/2.8.5): workspace-manifest migration registry, mirroring
 * `manifest/hatchJson.ts::MANIFEST_MIGRATIONS` (same shape, same idempotency
 * contract: running the registry twice on one input MUST produce the same
 * output). Empty today — the workspace schema has never changed since 1.0.0
 * — but the registry + the major-version gate in
 * {@link readWorkspaceManifest} exist BEFORE the first real migration so a
 * future schema bump adds an entry here instead of re-inventing the
 * mechanism (the repo-manifest family had migrations from day one; the
 * workspace family had neither the registry nor any version read-back).
 */
export interface WorkspaceManifestMigration {
  /** Stable identifier (used in logs and tests). */
  id: string;
  /** Human-readable summary of what this migration does. */
  description: string;
  /** Apply step. Mutates the manifest in place; returns nothing. */
  apply: (m: Record<string, unknown>) => void;
}

export const WORKSPACE_MANIFEST_MIGRATIONS: readonly WorkspaceManifestMigration[] = [];

/** DD-C3: run the (currently empty) migration registry over a deep copy —
 *  uniformly pure, mirroring `migrateManifest` (D3-SA3.3-08). */
export function migrateWorkspaceManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(raw);
  for (const migration of WORKSPACE_MANIFEST_MIGRATIONS) {
    migration.apply(migrated);
  }
  return migrated;
}

/** Major component of a semver-ish version string, or NaN when unparseable. */
function majorOf(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "", 10);
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

/**
 * Read and validate the workspace manifest, returning null if not found.
 *
 * DD-C3/C4 (release/2.8.5) read pipeline, mirroring
 * `manifest/hatchJson.ts::readManifest`: parse → major-version gate →
 * migration registry → per-field error accumulation → unknown-field
 * advisory. `options.onWarn` receives the unknown-field advisory (warn, not
 * reject — a same-major newer manifest stays readable); the parameter is
 * optional so existing call sites compile unchanged, and it defaults to a
 * no-op — callers with a UI channel (`hatch3r sync`) should pass their
 * `warn` sink.
 */
export async function readWorkspaceManifest(
  rootDir: string,
  options: { onWarn?: (message: string) => void } = {},
): Promise<WorkspaceManifest | null> {
  const manifestPath = join(rootDir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE);
  const onWarn = options.onWarn ?? (() => {});

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
      `Fix the JSON syntax in ${manifestPath}; if you have version control, \`git checkout -- ${HATCH3R_DIR}/${WORKSPACE_MANIFEST_FILE}\` restores the last committed copy.`,
      { cause: err },
    );
  }

  // DD-C3: major-version gate BEFORE shape validation — a manifest written
  // by a newer major would otherwise fail shape checks with misleading
  // per-field errors (or worse, pass them and be silently down-migrated).
  // The workspace version was previously written but never read back.
  if (isPlainObject(parsed) && typeof parsed.version === "string") {
    const major = majorOf(parsed.version);
    const currentMajor = majorOf(WORKSPACE_MANIFEST_VERSION);
    if (Number.isInteger(major) && Number.isInteger(currentMajor) && major > currentMajor) {
      throw new HatchError(
        `Workspace manifest at ${manifestPath} is schema version ${parsed.version}, ` +
          `newer than the ${WORKSPACE_MANIFEST_VERSION} this hatch3r understands.`,
        1,
        "CONFIG_ERROR",
        `Upgrade hatch3r (\`npm install -g hatch3r@latest\` or \`npx hatch3r@latest\`) to a release that supports workspace schema ${major}.x, then re-run.`,
      );
    }
  }

  // DD-C3: run the migration registry (empty today; the mechanism exists so
  // the first real schema change adds a registry entry, not a new pipeline).
  const migrated = isPlainObject(parsed) ? migrateWorkspaceManifest(parsed) : parsed;

  // DD-C4: per-field error accumulation — every defect in one pass, each
  // naming its field path (was: one generic "required fields missing" line).
  const fieldErrors = collectWorkspaceManifestErrors(migrated);
  if (fieldErrors.length > 0) {
    throw new HatchError(
      `Invalid workspace manifest in ${manifestPath}: ${fieldErrors.join("; ")}.`,
      1,
      "VALIDATION_ERROR",
      `Correct the field(s) listed above in ${manifestPath}, then re-run.`,
    );
  }
  if (!validateWorkspaceManifest(migrated)) {
    // Defense in depth — validateWorkspaceManifest is DEFINED as
    // `collectWorkspaceManifestErrors(x).length === 0`, so this branch is
    // unreachable while the two stay in sync (same parity contract as
    // manifest/hatchJson.ts::readManifest).
    /* v8 ignore start -- DD-C4 parity dead branch */
    throw new HatchError(
      `Invalid workspace manifest in ${manifestPath}: shape mismatch beyond per-field checks.`,
      1,
      "VALIDATION_ERROR",
    );
    /* v8 ignore stop */
  }
  const parsedManifest: WorkspaceManifest = migrated;

  // DD-C4 unknown-field policy: advisory, never a rejection — enumerate keys
  // the current schema does not understand so a typo'd key (`repoes`) or a
  // newer-minor field is visible instead of silently ignored.
  const migratedRecord = migrated as unknown as Record<string, unknown>;
  const unknownTop = unknownFields(migratedRecord, KNOWN_WORKSPACE_MANIFEST_KEYS);
  const unknownDefaults = isPlainObject(migratedRecord.defaults)
    ? unknownFields(migratedRecord.defaults, KNOWN_WORKSPACE_DEFAULTS_KEYS).map((k) => `defaults.${k}`)
    : [];
  const allUnknown = [...unknownTop, ...unknownDefaults];
  if (allUnknown.length > 0) {
    onWarn(
      `${manifestPath} contains field(s) this hatch3r does not recognize and will ignore: ` +
        `${allUnknown.join(", ")}. Check for typos, or upgrade hatch3r if the field is from a newer release.`,
    );
  }

  // D2-SA2.5-05: reject stale/unknown tool ids at the manifest boundary,
  // matching the repo-manifest reader's #108 check (manifest/hatchJson.ts:398).
  // Left unchecked, a retired id (windsurf, cline, ...) in defaults.tools, a
  // groups delta, or a per-repo override reaches getAdapter during sync, which
  // throws a HatchError whose recoveryHint the sync resilience catch discards.
  // Surfacing the supported set + file path here — with a recoveryHint —
  // keeps the actionable next step intact.
  const toolErrors = collectWorkspaceToolErrors(parsedManifest);
  if (toolErrors.length > 0) {
    throw new HatchError(
      `Invalid workspace manifest in ${manifestPath}: ${toolErrors.join("; ")}. Supported tools: ${TOOL_CHOICES}.`,
      1,
      "VALIDATION_ERROR",
      `Remove retired tool ids from the tool list(s) in ${manifestPath} — the 1.9.0 release cut all adapters except ${TOOL_CHOICES} — then re-run \`hatch3r sync\`.`,
    );
  }

  return parsedManifest;
}

/**
 * Atomically write the workspace manifest to `.hatch3r/workspace.json`.
 *
 * **Cross-process concurrency (F1.9-H1, Cycle 10 D1; DD-A7, 2.8.5):** the
 * in-process mutex in `workspace/sync.ts` (`runSerialized`) plus `pLimit`
 * only serialize writes *within* one Node process. Two CI runners — or two
 * operator shells — running `hatch3r sync` against the same workspace root
 * concurrently would otherwise race the read-modify-write of `lastSync`
 * entries and silently drop the slower writer's timestamps. This function
 * takes the same cross-process advisory lock `atomicWriteFile` uses
 * (default-on since 2.8.5, D1-SA1.5.1/DD-A1) explicitly around the write so
 * the protection is visible at this call site and survives future refactors
 * of `atomicWriteFile`'s internals. When the run opted out (`--no-lock` /
 * `HATCH3R_LOCK=0`) the lock is a no-op; otherwise a second concurrent
 * writer surfaces an `ELOCKED` → `HatchError(LOCK_TIMEOUT)` after the ~3s
 * retry budget (`LOCK_RETRY_TOTAL_BACKOFF_MS`) rather than clobbering
 * silently.
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
