import { access, cp, mkdir, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { HatchError, HATCH3R_DIR, MANIFEST_FILE } from "../types.js";

/**
 * Repo-relative path rendered with forward slashes regardless of host OS.
 *
 * `relative()` yields backslashes on Windows; the rest of this module's
 * operator-facing display strings (the `moved` entries below) are
 * hardcoded forward-slash, and the consolidated `console.warn` conflict
 * summary must read identically on every platform. These paths are display
 * /diagnostic only — never persisted to a cross-platform artifact nor parsed
 * back — so normalizing the separator is safe and removes the sole
 * Windows-vs-POSIX divergence in the conflict report.
 */
function toDisplayPath(rootDir: string, absPath: string): string {
  const rel = relative(rootDir, absPath);
  return sep === "/" ? rel : rel.split(sep).join("/");
}

/**
 * Legacy `.agents/` directory name retained ONLY in this migration shim.
 * Every other call site has been moved to `HATCH3R_DIR`; do not import this
 * constant from outside `src/migration/`.
 */
const AGENTS_DIR = ".agents";

/**
 * Wave 6 + Wave 5 — one-shot relocation of the legacy `.agents/` footprint
 * to `.hatch3r/`. Called from `runInit`/`runSync`/`runUpdate`/`runRegenerate`/
 * `syncWorkspaceRepos` so every user-facing pipeline migrates pre-1.9
 * installs before doing any new work.
 *
 * Scope (Wave 6 + Wave 5 ownership):
 *   - `.agents/hatch.json`      -> `.hatch3r/hatch.json`        (Wave 6)
 *   - `.agents/learnings/`      -> `.hatch3r/learnings/`        (Wave 6)
 *   - `.agents/handoffs/`       -> `.hatch3r/handoffs/`         (Wave 6)
 *   - `.agents/mcp/mcp.json`    -> `.hatch3r/mcp/mcp.json`      (Wave 6)
 *   - `.agents/user/`           -> `.hatch3r/overrides/`        (Wave 5)
 *
 * Out of scope (left for other waves):
 *   - `.integrity.json` / etc.  -> Wave 7 (integrity + clean rewrites)
 *
 * The shim is idempotent: every move first checks that the source exists and
 * the destination does NOT. On a fully migrated tree every call is a no-op.
 * After moves, `.agents/` is only removed when it is completely empty —
 * surviving entries (e.g. Wave 7 not yet run, or unrelated user files)
 * keep the directory in place.
 *
 * Returns the list of repo-relative paths that moved so callers can surface
 * a single consolidated warning to the operator.
 */

/**
 * D8-F8.1.2 conflict report. Surfaced to the operator when a destination-exists
 * branch hides divergent content between the legacy `.agents/` source and the
 * already-present `.hatch3r/` destination — the Silent Failure Contract
 * requires the operator to see this rather than silently keep the destination.
 */
export interface MigrationConflict {
  /** Repo-relative legacy path that could not be moved. */
  sourcePath: string;
  /** Repo-relative destination path that already existed. */
  destPath: string;
  /** Whether the conflict involved a file or a directory subtree. */
  kind: "file" | "directory";
  /** Human-readable description of the divergence. */
  reason: string;
}

export interface AgentsToHatch3rMigrationResult {
  /** Repo-relative paths that were moved from `.agents/` to `.hatch3r/`. */
  moved: string[];
  /** True when the now-empty `.agents/` directory was removed. */
  removedLegacyDir: boolean;
  /**
   * Conflicts where both `.agents/` source and `.hatch3r/` destination existed
   * with divergent content — the move was skipped and the operator must
   * decide whether to discard the legacy copy or reconcile. Surfaced to
   * stderr by `migrateAgentsToHatch3r` and exposed here for programmatic
   * callers (workspace sync, future re-init flows). Empty in the steady state.
   */
  conflicts: MigrationConflict[];
}

/**
 * Discriminated-union result for an individual move attempt. Lets the caller
 * distinguish a no-op (source missing, fast path) from a swallowed conflict
 * (destination present with divergent content) — fix for D8-F8.1.2.
 */
type MoveOutcome =
  | { moved: true }
  | { moved: false; reason: "source-missing" }
  | { moved: false; reason: "destination-exists"; identical: true }
  | { moved: false; reason: "destination-exists"; identical: false; detail: string }
  | { moved: false; reason: "not-a-directory" };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Byte-by-byte equality between two regular files. Read fully into memory
 * because the migration shim only handles small bookkeeping files
 * (`hatch.json`, `mcp.json`) — multi-MB payloads are out of scope.
 */
async function filesEqual(a: string, b: string): Promise<boolean> {
  const [aStat, bStat] = await Promise.all([stat(a), stat(b)]);
  if (aStat.size !== bStat.size) return false;
  const [aBuf, bBuf] = await Promise.all([readFile(a), readFile(b)]);
  return aBuf.equals(bBuf);
}

/**
 * Recursive byte-equal comparison for directory subtrees. Walks both trees in
 * lockstep; any size/structure divergence short-circuits to false.
 */
async function directoriesEqual(
  a: string,
  b: string,
): Promise<{ equal: true } | { equal: false; detail: string }> {
  const [aEntries, bEntries] = await Promise.all([
    readdir(a, { withFileTypes: true }),
    readdir(b, { withFileTypes: true }),
  ]);
  const aNames = aEntries.map((e) => e.name).sort();
  const bNames = bEntries.map((e) => e.name).sort();
  if (aNames.length !== bNames.length || aNames.some((n, i) => n !== bNames[i])) {
    return {
      equal: false,
      detail: `entry set differs (legacy: [${aNames.join(", ")}] vs destination: [${bNames.join(", ")}])`,
    };
  }
  const aMap = new Map(aEntries.map((e) => [e.name, e]));
  const bMap = new Map(bEntries.map((e) => [e.name, e]));
  for (const name of aNames) {
    const ae = aMap.get(name)!;
    const be = bMap.get(name)!;
    if (ae.isDirectory() !== be.isDirectory()) {
      return { equal: false, detail: `entry "${name}" type differs (file vs directory)` };
    }
    const childA = join(a, name);
    const childB = join(b, name);
    if (ae.isDirectory()) {
      const sub = await directoriesEqual(childA, childB);
      if (!sub.equal) return sub;
    } else if (ae.isFile()) {
      if (!(await filesEqual(childA, childB))) {
        return { equal: false, detail: `file "${name}" bytes differ` };
      }
    }
    // Symlinks / other entry types: treat as opaque equal-by-name to avoid
    // false positives on platform-specific filesystem oddities — the rename()
    // itself will surface a real error when we attempt the move.
  }
  return { equal: true };
}

/**
 * D8-6: cross-device-safe move. `rename(2)` fails with `EXDEV` when source and
 * destination sit on different filesystems — the common case for containerized
 * upgrades (bind-mounted `.agents/` from a different volume) and OneDrive /
 * networked-home setups where `.hatch3r/` and `.agents/` straddle a mount
 * boundary. Node's `rename` does not transparently fall back, so a 1.8→2.0
 * upgrade would hard-fail there. On `EXDEV` we copy the subtree
 * (`cp` with `recursive`, preserving a directory or a single file) then remove
 * the source — the same effect as a rename, just non-atomic across the device
 * boundary. Any non-EXDEV rename error re-throws unchanged.
 *
 * `recursive: true` is a no-op for a single file and required for a directory,
 * so the one helper serves both move sites. `cp` does not preserve symlinks as
 * links by default, but the migration shim only moves regular bookkeeping
 * files and content directories — symlinked sources go down the same path the
 * pre-fix `rename` took and are dereferenced by the copy, which is acceptable
 * for the one-shot relocation.
 */
async function renameAcrossDevices(oldPath: string, newPath: string): Promise<void> {
  try {
    await rename(oldPath, newPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    // Cross-device: copy then delete. If the copy fails we leave the source in
    // place (cp throws before rm runs), so the legacy copy is never lost.
    await cp(oldPath, newPath, { recursive: true });
    await rm(oldPath, { recursive: true, force: true });
  }
}

async function moveFileIfPossible(
  oldPath: string,
  newPath: string,
): Promise<MoveOutcome> {
  if (!(await exists(oldPath))) return { moved: false, reason: "source-missing" };
  if (await exists(newPath)) {
    // D8-F8.1.2: compare bytes so a duplicate-but-identical state stays silent
    // (idempotent re-run) while a divergent state surfaces a conflict warning.
    let identical: boolean;
    try {
      identical = await filesEqual(oldPath, newPath);
    } catch (err) {
      // I/O failure while comparing: treat as divergent — Silent Failure
      // Contract forbids swallowing the case where the destination might
      // differ from the source.
      const message = err instanceof Error ? err.message : String(err);
      return {
        moved: false,
        reason: "destination-exists",
        identical: false,
        detail: `byte-compare failed — ${message}`,
      };
    }
    if (identical) {
      return { moved: false, reason: "destination-exists", identical: true };
    }
    return {
      moved: false,
      reason: "destination-exists",
      identical: false,
      detail: "destination file bytes differ from legacy source",
    };
  }
  await mkdir(dirname(newPath), { recursive: true });
  await renameAcrossDevices(oldPath, newPath);
  return { moved: true };
}

async function moveDirIfPossible(
  oldDir: string,
  newDir: string,
): Promise<MoveOutcome> {
  if (!(await exists(oldDir))) return { moved: false, reason: "source-missing" };
  const oldStat = await stat(oldDir);
  if (!oldStat.isDirectory()) return { moved: false, reason: "not-a-directory" };
  if (await exists(newDir)) {
    let result: { equal: true } | { equal: false; detail: string };
    try {
      result = await directoriesEqual(oldDir, newDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        moved: false,
        reason: "destination-exists",
        identical: false,
        detail: `subtree compare failed — ${message}`,
      };
    }
    if (result.equal) {
      return { moved: false, reason: "destination-exists", identical: true };
    }
    return {
      moved: false,
      reason: "destination-exists",
      identical: false,
      detail: result.detail,
    };
  }
  await mkdir(dirname(newDir), { recursive: true });
  await renameAcrossDevices(oldDir, newDir);
  return { moved: true };
}

/**
 * Push a destination-exists conflict, when divergent, into the shared
 * conflicts[] array so the top-level summary surfaces it to the operator.
 * Identical-destination cases are silent — they represent a re-run of an
 * already-completed migration step.
 */
function recordIfConflict(
  outcome: MoveOutcome,
  rootDir: string,
  sourcePath: string,
  destPath: string,
  kind: "file" | "directory",
  conflicts: MigrationConflict[],
): void {
  if (
    outcome.moved === false &&
    outcome.reason === "destination-exists" &&
    outcome.identical === false
  ) {
    conflicts.push({
      sourcePath: toDisplayPath(rootDir, sourcePath),
      destPath: toDisplayPath(rootDir, destPath),
      kind,
      reason: outcome.detail,
    });
  }
}

/**
 * D8-5: best-effort compensating move-back for an interrupted migration. Walks
 * the completed-move ledger in reverse (last relocated, first restored) and
 * moves each entry from its new path back to its origin via the same
 * cross-device-safe primitive used on the forward path. Each reversal is
 * individually guarded: a failed move-back is surfaced on stderr in verbose
 * mode (Silent Failure Contract) but never re-thrown, so it cannot mask the
 * original interruption error the caller is about to throw. This function never
 * throws.
 */
async function rollbackMoves(
  completedMoves: ReadonlyArray<{ from: string; to: string }>,
): Promise<void> {
  for (let i = completedMoves.length - 1; i >= 0; i--) {
    const { from, to } = completedMoves[i];
    try {
      // Only move back when the destination still holds the relocated entry
      // and the origin is free — guards against a partially-reversed re-entry.
      if ((await exists(to)) && !(await exists(from))) {
        await mkdir(dirname(from), { recursive: true });
        await renameAcrossDevices(to, from);
      }
    } catch (err) {
      if (process.env.HATCH3R_VERBOSE) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[hatch3r] migration: rollback of ${to} -> ${from} failed — ${message}`,
        );
      }
    }
  }
}

/**
 * One-shot relocation of `.agents/` -> `.hatch3r/`. Safe to call on every
 * pipeline entry — idempotent and silent when nothing needs to move.
 *
 * The legacy `.agents/` directory is only removed when it ends up empty after
 * moves. When Wave 7 (integrity) has not yet migrated its own subtrees,
 * leftover entries keep `.agents/` on disk so those waves still have something
 * to act on.
 */
export async function migrateAgentsToHatch3r(
  rootDir: string,
): Promise<AgentsToHatch3rMigrationResult> {
  const moved: string[] = [];
  const conflicts: MigrationConflict[] = [];
  // D8-5: reversible record of each completed move ({ from, to }) so a failure
  // partway through the sequence can be compensated (best-effort move-back)
  // before re-throwing. The shim has no atomic multi-move primitive, so the
  // rollback restores the pre-migration layout rather than leaving the tree
  // half-relocated.
  const completedMoves: Array<{ from: string; to: string }> = [];
  const oldRoot = join(rootDir, AGENTS_DIR);

  // Fast path: no legacy directory at all.
  if (!(await exists(oldRoot))) {
    return { moved, removedLegacyDir: false, conflicts };
  }

  // Run one move attempt: on success record both the operator-facing display
  // string and the reversible { from, to } pair; otherwise capture any
  // divergent-destination conflict. Collapses four near-identical blocks
  // (P4 lean) and is the single place that feeds the rollback ledger.
  const attemptMove = async (
    oldP: string,
    newP: string,
    display: string,
    kind: "file" | "directory",
    mover: (a: string, b: string) => Promise<MoveOutcome>,
  ): Promise<void> => {
    const outcome = await mover(oldP, newP);
    if (outcome.moved) {
      moved.push(display);
      completedMoves.push({ from: oldP, to: newP });
    } else {
      recordIfConflict(outcome, rootDir, oldP, newP, kind, conflicts);
    }
  };

  let removedLegacyDir = false;
  try {
    // hatch.json
    await attemptMove(
      join(oldRoot, MANIFEST_FILE),
      join(rootDir, HATCH3R_DIR, MANIFEST_FILE),
      `${AGENTS_DIR}/${MANIFEST_FILE} -> ${HATCH3R_DIR}/${MANIFEST_FILE}`,
      "file",
      moveFileIfPossible,
    );

    // learnings/ (whole subtree)
    await attemptMove(
      join(oldRoot, "learnings"),
      join(rootDir, HATCH3R_DIR, "learnings"),
      `${AGENTS_DIR}/learnings/ -> ${HATCH3R_DIR}/learnings/`,
      "directory",
      moveDirIfPossible,
    );

    // handoffs/ (whole subtree)
    await attemptMove(
      join(oldRoot, "handoffs"),
      join(rootDir, HATCH3R_DIR, "handoffs"),
      `${AGENTS_DIR}/handoffs/ -> ${HATCH3R_DIR}/handoffs/`,
      "directory",
      moveDirIfPossible,
    );

    // mcp/mcp.json (single file under mcp/)
    await attemptMove(
      join(oldRoot, "mcp", "mcp.json"),
      join(rootDir, HATCH3R_DIR, "mcp", "mcp.json"),
      `${AGENTS_DIR}/mcp/mcp.json -> ${HATCH3R_DIR}/mcp/mcp.json`,
      "file",
      moveFileIfPossible,
    );
    // If `.agents/mcp/` is now empty (we just moved its only file), drop it
    // so the legacy-dir emptiness check below has a chance to clear `.agents/`.
    try {
      const mcpDir = join(oldRoot, "mcp");
      if (await exists(mcpDir)) {
        const entries = await readdir(mcpDir);
        if (entries.length === 0) await rmdir(mcpDir);
      }
    } catch (err) {
      // Best-effort cleanup; the legacy `.agents/mcp/` removal is purely a
      // tidiness step. Surface the failure on stderr only when the runtime
      // is in a verbose mode (process.env.HATCH3R_VERBOSE) so silent
      // fallbacks remain observable per the Silent Failure Contract.
      if (process.env.HATCH3R_VERBOSE) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[hatch3r] migration: legacy .agents/mcp/ cleanup skipped — ${message}`);
      }
    }

    // user/ (Wave 5) — D20 user-authored content moves to `.hatch3r/overrides/`.
    // The whole `.agents/user/` subtree relocates wholesale; `resolveUserContentRoot`
    // now resolves to `.hatch3r/overrides/` so adapter reads + saveUserContent
    // follow the new path automatically.
    await attemptMove(
      join(oldRoot, "user"),
      join(rootDir, HATCH3R_DIR, "overrides"),
      `${AGENTS_DIR}/user/ -> ${HATCH3R_DIR}/overrides/`,
      "directory",
      moveDirIfPossible,
    );

    // Attempt to remove the now-empty `.agents/` shell. Anything left behind
    // (e.g. `.agents/.integrity.json` until Wave 7, or any of the
    // destination-exists conflicts above) keeps the directory.
    try {
      const remaining = await readdir(oldRoot);
      if (remaining.length === 0) {
        await rmdir(oldRoot);
        removedLegacyDir = true;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  } catch (err) {
    // D8-5: the move sequence was interrupted (e.g. EXDEV copy failure mid-way,
    // a permission flip between entries, process-level I/O error). Without
    // compensation the tree is left half-relocated and a re-run would hit a
    // mix of source-missing and destination-exists states. Best-effort move
    // each completed relocation back to its origin (reverse order) so the
    // pre-migration layout is restored, then re-throw a structured HatchError
    // the operator can act on. Each move-back is individually guarded so a
    // failed reversal never masks the original failure.
    await rollbackMoves(completedMoves);
    const message = err instanceof Error ? err.message : String(err);
    throw new HatchError(
      `Migration of legacy ${AGENTS_DIR}/ state to ${HATCH3R_DIR}/ was interrupted: ${message}`,
      undefined,
      "FS_ERROR",
      "Migration interrupted; re-run to finish or move the listed entries manually",
    );
  }

  if (moved.length > 0) {
    const summary = moved.map((m) => `  - ${m}`).join("\n");
    const tail = removedLegacyDir
      ? `\n  Legacy ${AGENTS_DIR}/ removed (was empty after moves).`
      : `\n  Legacy ${AGENTS_DIR}/ kept (other artifacts still present).`;
    // One consolidated console warning; entry-point pipelines decide whether
    // to suppress in --quiet/--json modes by funnelling this through a logger.
    console.warn(
      `[hatch3r] Relocated legacy ${AGENTS_DIR}/ state to ${HATCH3R_DIR}/:\n${summary}${tail}`,
    );
  }

  // D8-F8.1.2: surface every divergent destination-exists case to the
  // operator. Silent skips violate the Silent Failure Contract because the
  // operator cannot distinguish a successful migration from a partial one.
  if (conflicts.length > 0) {
    const lines = conflicts.map(
      (c) => `  - ${c.sourcePath} vs ${c.destPath} (${c.kind}): ${c.reason}`,
    );
    console.warn(
      `[hatch3r] Migration conflicts detected — both ${AGENTS_DIR}/ source and ${HATCH3R_DIR}/ destination exist with divergent content. The legacy copy was kept in place; reconcile manually before re-running:\n${lines.join("\n")}`,
    );
  }

  return { moved, removedLegacyDir, conflicts };
}
