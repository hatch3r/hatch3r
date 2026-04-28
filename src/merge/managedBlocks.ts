import { HatchError, MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../types.js";

/**
 * Replace the content inside an existing managed block with new content.
 *
 * Throws if the managed block markers are missing, duplicated, or misordered.
 */
export function insertManagedBlock(
  existingContent: string,
  managedContent: string,
): string {
  const startIdx = existingContent.indexOf(MANAGED_BLOCK_START);
  const endIdx = existingContent.indexOf(MANAGED_BLOCK_END);

  // G1: Trim at insert time so the round-trip with extractManagedBlock
  // (which also trims) is symmetric. Without this, asymmetric whitespace
  // around the managed block causes spurious drift on subsequent status
  // runs even when the canonical content is byte-equal.
  const block = `${MANAGED_BLOCK_START}\n${managedContent.trim()}\n${MANAGED_BLOCK_END}`;

  if (startIdx === -1 || endIdx === -1) {
    throw new HatchError(
      "Content must contain managed block markers (HATCH3R:BEGIN and HATCH3R:END)",
      1,
      "VALIDATION_ERROR",
    );
  }

  const secondStart = existingContent.indexOf(MANAGED_BLOCK_START, startIdx + 1);
  const secondEnd = existingContent.indexOf(MANAGED_BLOCK_END, endIdx + 1);
  if (secondStart !== -1) {
    throw new HatchError(
      "Corrupted managed block: duplicate start marker found. Remove the duplicate before syncing.",
      1,
      "VALIDATION_ERROR",
    );
  }
  if (secondEnd !== -1) {
    throw new HatchError(
      "Corrupted managed block: duplicate end marker found. Remove the duplicate before syncing.",
      1,
      "VALIDATION_ERROR",
    );
  }

  if (startIdx >= endIdx) {
    throw new HatchError(
      "Corrupted managed block: start marker must appear before end marker",
      1,
      "VALIDATION_ERROR",
    );
  }

  const before = existingContent.substring(0, startIdx);
  const after = existingContent.substring(endIdx + MANAGED_BLOCK_END.length);
  return `${before}${block}${after}`;
}

/** Extract the text between HATCH3R:BEGIN and HATCH3R:END markers, or null if absent. */
export function extractManagedBlock(content: string): string | null {
  const startIdx = content.indexOf(MANAGED_BLOCK_START);
  const endIdx = content.indexOf(MANAGED_BLOCK_END);

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  return content
    .substring(startIdx + MANAGED_BLOCK_START.length, endIdx)
    .trim();
}

/** Extract user-authored content outside the managed block markers. */
export function extractCustomContent(content: string): string {
  const startIdx = content.indexOf(MANAGED_BLOCK_START);
  const endIdx = content.indexOf(MANAGED_BLOCK_END);

  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const before = content.substring(0, startIdx).trim();
  const after = content.substring(endIdx + MANAGED_BLOCK_END.length).trim();
  return [before, after].filter(Boolean).join("\n\n");
}

/** Wrap content with HATCH3R:BEGIN / HATCH3R:END markers. */
export function wrapInManagedBlock(content: string): string {
  // G2: Trim for symmetry with extractManagedBlock to avoid asymmetric
  // whitespace round-trips that produce spurious status drift.
  return `${MANAGED_BLOCK_START}\n${content.trim()}\n${MANAGED_BLOCK_END}`;
}

/** Check whether content contains both managed block start and end markers. */
export function hasManagedBlock(content: string): boolean {
  return (
    content.includes(MANAGED_BLOCK_START) &&
    content.includes(MANAGED_BLOCK_END)
  );
}
