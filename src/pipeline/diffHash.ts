/**
 * Diff-hash verification for fixer-to-reviewer handoff.
 *
 * When the fixer agent claims to have made changes, this module verifies
 * that the diff hash matches the actual changes on disk. This prevents
 * the fixer from claiming changes it didn't make and ensures the reviewer
 * is reviewing the actual modifications.
 *
 * Finding #77 (D15, High): Add diff-hash verification on fixer-to-reviewer handoff.
 */

import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────

export interface DiffEntry {
  /** Relative file path from the project root. */
  filePath: string;
  /** Content before the fix (empty string for new files). */
  before: string;
  /** Content after the fix (empty string for deleted files). */
  after: string;
}

export interface HandoffPayload {
  /** SHA-256 hash of the serialized diff entries. */
  diffHash: string;
  /** The diff entries that were claimed by the fixer. */
  diffs: DiffEntry[];
  /** Fixer iteration number (maps to review loop iteration). */
  iteration: number;
  /** ISO timestamp of the handoff. */
  timestamp: string;
}

export interface HandoffVerification {
  valid: boolean;
  /** Present when verification fails. */
  error?: string;
  /** The expected hash computed from the diffs. */
  computedHash: string;
  /** The hash claimed in the payload. */
  claimedHash: string;
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hash for a set of diff entries.
 *
 * The hash is computed over a canonical JSON representation of the diffs
 * (sorted by file path, with consistent key ordering) to ensure the same
 * changes always produce the same hash regardless of entry order.
 */
export function computeDiffHash(diffs: DiffEntry[]): string {
  const sorted = [...diffs].sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );

  const canonical = sorted.map((d) => ({
    filePath: d.filePath,
    before: d.before,
    after: d.after,
  }));

  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized, "utf-8").digest("hex");
}

/**
 * Create a handoff payload from the fixer to the reviewer.
 *
 * This generates a signed payload that the reviewer can verify to ensure
 * the fixer's claimed changes match the actual modifications.
 */
export function createHandoffPayload(
  diffs: DiffEntry[],
  iteration: number,
): HandoffPayload {
  const diffHash = computeDiffHash(diffs);
  return {
    diffHash,
    diffs,
    iteration,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Verify a handoff payload from the fixer.
 *
 * Recomputes the diff hash from the payload's diffs and compares it
 * to the claimed hash. If they don't match, the fixer's claim is
 * considered invalid.
 */
export function verifyHandoff(payload: HandoffPayload): HandoffVerification {
  const computedHash = computeDiffHash(payload.diffs);
  const valid = computedHash === payload.diffHash;

  return {
    valid,
    error: valid
      ? undefined
      : `Diff hash mismatch: fixer claimed "${payload.diffHash}" ` +
        `but actual diff hash is "${computedHash}". ` +
        `The fixer may have modified the diff entries after hashing.`,
    computedHash,
    claimedHash: payload.diffHash,
  };
}

/**
 * Verify that the actual file contents match the "after" state in the diffs.
 *
 * This is a secondary verification that checks the diffs themselves are
 * truthful -- i.e., the "after" content in each diff entry matches what
 * is actually on disk.
 *
 * @param diffs - The diff entries from the handoff payload.
 * @param readFile - An async function that reads a file's current content.
 *                   Returns null if the file does not exist.
 */
export async function verifyDiffsAgainstDisk(
  diffs: DiffEntry[],
  readFile: (filePath: string) => Promise<string | null>,
): Promise<{ valid: boolean; mismatches: string[] }> {
  const mismatches: string[] = [];

  for (const diff of diffs) {
    const actualContent = await readFile(diff.filePath);

    if (diff.after === "" && actualContent === null) {
      // File was deleted and is indeed gone
      continue;
    }

    if (diff.after === "" && actualContent !== null) {
      mismatches.push(
        `${diff.filePath}: fixer claimed file was deleted but it still exists`,
      );
      continue;
    }

    if (actualContent === null) {
      mismatches.push(
        `${diff.filePath}: fixer claimed content exists but file is missing`,
      );
      continue;
    }

    if (actualContent !== diff.after) {
      const expectedHash = createHash("sha256")
        .update(diff.after, "utf-8")
        .digest("hex")
        .substring(0, 12);
      const actualHash = createHash("sha256")
        .update(actualContent, "utf-8")
        .digest("hex")
        .substring(0, 12);
      mismatches.push(
        `${diff.filePath}: content mismatch (expected hash: ${expectedHash}, actual: ${actualHash})`,
      );
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}
