/**
 * Workspace checkpoint persistence for resumable orchestrators.
 *
 * Decision 27 / hatch3r 2.0.0 / Bucket 2.2: long-running orchestrators
 * (`audit`, `sync`, `init`, multi-wave commands) write a single JSON
 * checkpoint file at the workspace root so the run can be resumed at the
 * last passed wave/phase after a crash, signal, or operator-initiated
 * interrupt.
 *
 * **File:** `<workspace>/checkpoint.json` (canonical path
 * `.{cmd}-workspace/checkpoint.json` per task spec).
 *
 * **Write protocol:** every state transition goes through
 * {@link writeCheckpoint} which delegates to `atomicWriteFile` (tmp+rename
 * with fsync). Partial writes are not observable.
 *
 * **Resume protocol:** the resumed run calls {@link readCheckpoint} to
 * fetch the last known state, then {@link verifyResumability} to confirm
 * the canonical content baseline matches. Drift fails closed — operator
 * must re-run from scratch or accept the diff before resuming.
 *
 * **Pillar service:** P1 (CLI UX — actionable resume), P2 (Scientific
 * Quality — atomic operations), P5 (Silent Failure Contract — every
 * failure path returns or throws with a diagnostic).
 */

import { join } from "node:path";
import { mkdir, readFile, copyFile } from "node:fs/promises";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { HatchError } from "../types.js";

// ── Types ────────────────────────────────────────────────────────

/**
 * Lifecycle state of the workspace at the moment the checkpoint was
 * written. `in-progress` is the steady state during a wave; `passed`
 * marks a fully-completed wave; `failed` records a regression-gate
 * failure that an operator must triage before resuming.
 */
export type CheckpointStatus = "in-progress" | "passed" | "failed";

/**
 * Metadata captured alongside the checkpoint's progress markers. Each
 * field anchors the workspace to a specific moment in the canonical
 * content lifecycle so {@link verifyResumability} can detect drift.
 */
export interface CheckpointMeta {
  /** Git SHA / content hash of the canonical baseline at Phase 0. */
  baselineSha: string;
  /** Highest gate index (1-based) that passed before the run halted. */
  lastPassedGateN: number;
  /** SHA of the finding registry at the moment of the write. */
  registrySha: string;
  /** ISO-8601 timestamp of when this checkpoint was written. */
  timestamp: string;
}

/**
 * On-disk shape of `checkpoint.json`. Versioned for future migration.
 */
export interface Checkpoint {
  /** Schema version. Bump on any breaking field change. */
  schemaVersion: 1;
  /** Phase identifier (free-form, set by the orchestrator). */
  phase: string;
  /** Wave number within the phase (1-based). */
  wave: number;
  /** Lifecycle state when the checkpoint was last written. */
  status: CheckpointStatus;
  /** Metadata enabling drift detection on resume. */
  meta: CheckpointMeta;
}

/**
 * Result of {@link verifyResumability}. `ok=true` means the resume can
 * proceed; `ok=false` carries a single-line drift diagnostic suitable
 * for surfacing to the operator.
 */
export interface ResumabilityResult {
  ok: boolean;
  drift?: string;
}

// ── Constants ────────────────────────────────────────────────────

/** Standardized filename within a `.{cmd}-workspace/` directory. */
export const CHECKPOINT_FILE = "checkpoint.json";

/** Current schema version — bump on breaking field changes. */
export const CHECKPOINT_SCHEMA_VERSION = 1 as const;

/**
 * Command names whose checkpoint writers create a `.{command}-workspace/`
 * directory in the user's repo via {@link workspaceDir}. Single source of
 * truth for two surfaces that must enumerate the same set: the writers
 * (`init`/`sync`/`update`/`config`/`verify-fix`, each resolving its workspace
 * path through {@link workspaceDir}) and the gitignore registry
 * (`REQUIRED_GITIGNORE_ENTRIES` in `src/env/mcpEnv.ts`, which spreads
 * {@link WORKSPACE_CHECKPOINT_GITIGNORE_ENTRIES}).
 *
 * D1-SA1.2-06 (D1, P1): the reopened D1-14 leak class. `.update-workspace/`,
 * `.config-workspace/`, and `.verify-fix-workspace/` were written on every
 * `update` / `config` / `verify --fix` run yet never registered in
 * `REQUIRED_GITIGNORE_ENTRIES`, so a default `git add .` staged per-run
 * checkpoint state (Silent Failure Contract breach, CONSTITUTION §2 P5).
 * Deriving both surfaces from this one list — and typing {@link workspaceDir}'s
 * `command` parameter to its members — makes a new checkpoint-writing command
 * fail `tsc` until it is registered here, at which point its gitignore entry
 * follows with no second edit.
 */
export const CHECKPOINT_WORKSPACE_COMMANDS = [
  "init",
  "sync",
  "update",
  "config",
  "verify-fix",
] as const;

/** A checkpoint-writing command registered in {@link CHECKPOINT_WORKSPACE_COMMANDS}. */
export type CheckpointWorkspaceCommand = (typeof CHECKPOINT_WORKSPACE_COMMANDS)[number];

/**
 * Directory-scoped (trailing-slash) gitignore entries — one per
 * {@link CHECKPOINT_WORKSPACE_COMMANDS} member, in list order.
 * `REQUIRED_GITIGNORE_ENTRIES` (`src/env/mcpEnv.ts`) spreads this array so
 * registering a command above gitignores its workspace with no edit there.
 */
export const WORKSPACE_CHECKPOINT_GITIGNORE_ENTRIES: readonly string[] =
  CHECKPOINT_WORKSPACE_COMMANDS.map((command) => `.${command}-workspace/`);

// ── Validation ───────────────────────────────────────────────────

/**
 * Validate that a parsed JSON object conforms to the {@link Checkpoint}
 * shape. Returns `null` on success or a human-readable error string when
 * any required field is missing or has the wrong type. No external
 * schema library — we keep validation in-tree to avoid pulling Zod into
 * the pipeline bundle.
 */
function validateCheckpoint(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "checkpoint is not an object";
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    return `schemaVersion must be ${CHECKPOINT_SCHEMA_VERSION} (got ${String(r.schemaVersion)})`;
  }
  if (typeof r.phase !== "string" || r.phase.length === 0) {
    return "phase must be a non-empty string";
  }
  if (typeof r.wave !== "number" || !Number.isFinite(r.wave) || r.wave < 0) {
    return "wave must be a non-negative finite number";
  }
  if (r.status !== "in-progress" && r.status !== "passed" && r.status !== "failed") {
    return `status must be in-progress|passed|failed (got ${String(r.status)})`;
  }
  const meta = r.meta;
  if (!meta || typeof meta !== "object") return "meta must be an object";
  const m = meta as Record<string, unknown>;
  if (typeof m.baselineSha !== "string" || m.baselineSha.length === 0) {
    return "meta.baselineSha must be a non-empty string";
  }
  if (typeof m.lastPassedGateN !== "number" || !Number.isFinite(m.lastPassedGateN)) {
    return "meta.lastPassedGateN must be a finite number";
  }
  if (typeof m.registrySha !== "string") {
    return "meta.registrySha must be a string";
  }
  if (typeof m.timestamp !== "string" || m.timestamp.length === 0) {
    return "meta.timestamp must be a non-empty string";
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Resolve the absolute path of `checkpoint.json` for a given workspace
 * directory. The workspace directory itself is created on demand by
 * {@link writeCheckpoint}.
 */
export function checkpointPath(workspace: string): string {
  return join(workspace, CHECKPOINT_FILE);
}

/**
 * Resolve the absolute `.{command}-workspace/` directory a checkpoint writer
 * uses. `command` is typed to {@link CheckpointWorkspaceCommand} so every
 * writer's workspace name is a registered {@link CHECKPOINT_WORKSPACE_COMMANDS}
 * member — the gitignore registry that derives from the same list therefore
 * cannot miss one (D1-SA1.2-06).
 */
export function workspaceDir(
  rootDir: string,
  command: CheckpointWorkspaceCommand,
): string {
  return join(rootDir, `.${command}-workspace`);
}

/**
 * Write a checkpoint to `<workspace>/checkpoint.json` atomically.
 *
 * Delegates to `atomicWriteFile` so a SIGKILL mid-write leaves either
 * the previous checkpoint or no file at all — never a half-written
 * record. Parent directory is created on demand.
 *
 * Throws on any I/O failure (re-thrown by `atomicWriteFile`).
 */
export async function writeCheckpoint(
  workspace: string,
  phase: string,
  wave: number,
  status: CheckpointStatus,
  meta: CheckpointMeta,
): Promise<void> {
  await mkdir(workspace, { recursive: true });
  const checkpoint: Checkpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    phase,
    wave,
    status,
    meta,
  };
  const json = JSON.stringify(checkpoint, null, 2) + "\n";
  await atomicWriteFile(checkpointPath(workspace), json);
}

/**
 * F1.5-H1 (Cycle 10 D1): Before {@link readCheckpoint} throws on a malformed
 * (unparseable or schema-invalid) checkpoint, preserve a copy at
 * `<workspace>/checkpoint.json.corrupt-<ISO>` so the operator — and a future
 * migration tool — can inspect what was on disk. The original throw branch
 * previously instructed "Delete the file and re-run from scratch" with no
 * backup; a schema-version mismatch during an upgrade takes the same branch,
 * so the only recoverable artifact would otherwise be destroyed. Returns the
 * backup path on success or `null` when the copy itself fails (best-effort —
 * a failed backup must not mask the underlying corruption error).
 */
async function preserveCorruptCheckpoint(path: string): Promise<string | null> {
  // Colons in an ISO timestamp are illegal on Windows file systems; replace
  // them with hyphens so the backup path is portable.
  const stamp = new Date().toISOString().replace(/:/g, "-");
  const backupPath = `${path}.corrupt-${stamp}`;
  try {
    await copyFile(path, backupPath);
    return backupPath;
  } catch (err) {
    // Silent Failure Contract (CONSTITUTION §2 P5): the backup is best-effort
    // — its failure must not mask the corruption error that is about to throw
    // — but the operator still needs to know the copy did not happen, so the
    // recovery hint does not promise a preserved file that is not there.
    console.error(
      `hatch3r: could not preserve corrupt checkpoint ${path} to ${backupPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Read `<workspace>/checkpoint.json` and return the parsed checkpoint,
 * or `null` if the file is absent. Throws when the file exists but is
 * malformed — silently swallowing a corrupt checkpoint would let an
 * operator resume into an undefined state, violating P5 Silent Failure
 * Contract.
 *
 * F1.5-H1 (Cycle 10): on a malformed checkpoint the corrupt file is first
 * copied to `<workspace>/checkpoint.json.corrupt-<ISO>` (see
 * {@link preserveCorruptCheckpoint}); the thrown recovery hint names the
 * preserved copy so a schema-version mismatch hit during an upgrade does not
 * cost the operator the only inspectable artifact.
 */
export async function readCheckpoint(workspace: string): Promise<Checkpoint | null> {
  const path = checkpointPath(workspace);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const backupPath = await preserveCorruptCheckpoint(path);
    const recovery = backupPath
      ? `The corrupt file was preserved at ${backupPath} for inspection. Delete ${path} and re-run from scratch, or restore the file from a known-good source.`
      : `Delete ${path} and re-run from scratch, or restore the file from a known-good source.`;
    throw new HatchError(
      `checkpoint.json at ${path} is not valid JSON: ${msg}`,
      1,
      "VALIDATION_ERROR",
      recovery,
    );
  }
  const validationError = validateCheckpoint(parsed);
  if (validationError !== null) {
    const backupPath = await preserveCorruptCheckpoint(path);
    const recovery = backupPath
      ? `The mismatched file was preserved at ${backupPath} for inspection or migration. Delete ${path} and re-run from scratch.`
      : `Delete ${path} and re-run from scratch.`;
    throw new HatchError(
      `checkpoint.json at ${path} failed validation: ${validationError}`,
      1,
      "VALIDATION_ERROR",
      recovery,
    );
  }
  return parsed as Checkpoint;
}

/**
 * Confirm that a recorded baseline still matches the current canonical
 * state. Returns `{ ok: true }` when the SHAs match, otherwise returns
 * `{ ok: false, drift: "<diagnostic>" }`.
 *
 * Behavior when no checkpoint exists: returns `{ ok: false, drift: "no
 * checkpoint" }` — the caller decides whether absence is fatal (an
 * explicit `--resume` was requested) or benign (default cold start).
 */
export async function verifyResumability(
  workspace: string,
  currentSha: string,
): Promise<ResumabilityResult> {
  const checkpoint = await readCheckpoint(workspace);
  if (checkpoint === null) {
    return { ok: false, drift: "no checkpoint found — start a fresh run" };
  }
  if (checkpoint.meta.baselineSha !== currentSha) {
    return {
      ok: false,
      drift:
        `canonical baseline drift: checkpoint=${checkpoint.meta.baselineSha} ` +
        `current=${currentSha}. Re-run from scratch or rebase to the checkpoint baseline.`,
    };
  }
  if (checkpoint.status === "failed") {
    return {
      ok: false,
      drift:
        `checkpoint records a failed wave at phase=${checkpoint.phase} wave=${checkpoint.wave}. ` +
        `Triage the underlying failure before resuming.`,
    };
  }
  return { ok: true };
}
