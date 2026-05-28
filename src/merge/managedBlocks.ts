import {
  HatchError,
  MANAGED_BLOCK_VARIANTS,
  getMarkersForPath,
  type ManagedBlockMarkers,
} from "../types.js";

/**
 * D6-M13 (Cycle 9 / Wave 3): Managed-block markers are positionally inert
 * for prompt-caching purposes. The `HATCH3R:BEGIN` / `HATCH3R:END` markers
 * delimit which slice of an adapter-output file hatch3r owns vs. which is
 * user-authored content. They do NOT participate in any provider's prompt
 * caching mechanism (Anthropic `cache_control`, OpenAI Responses prefix
 * caching, Google Gemini implicit caching). The caching boundary on every
 * provider is purely positional — the static prefix at the top of a prompt
 * is cached; anything below the first variable token is not. The markers
 * are HTML/YAML comments invisible to the LLM, so reordering content around
 * them has zero effect on cache hits.
 *
 * For static-first prompt structure (P1 in `agents/shared/efficiency-patterns.md`),
 * what matters is byte-stable ordering of the prompt frame from one
 * invocation to the next — not the presence or position of the managed-block
 * markers. Two implications:
 *
 *   1. Editing user content above/below the managed block does NOT invalidate
 *      any provider cache as long as the hatch3r-owned content inside the
 *      block remains byte-stable.
 *   2. Re-ordering the hatch3r-owned content (e.g., reshuffling adapter
 *      directives) DOES invalidate prompt caching even if the markers stay
 *      in place — because the cache hashes the actual byte stream, not the
 *      logical sections.
 *
 * If positional-caching guarantees are needed, they must be implemented at
 * the adapter level (`src/adapters/*.ts`) by ensuring static-frame ordering
 * across the full adapter output, not by relying on the marker structure.
 *
 * Scan {@link content} for any known marker variant and return the
 * matched variant + the indices of its start and end markers.
 *
 * "Detected" means both markers were found in the same variant; mixed
 * variants (e.g. an HTML start with a YAML end) are not recognised — the
 * file is treated as having no managed block, which causes the merge
 * branch in safeWriteFile to fall back to the "missing markers" error
 * path. That's the safer outcome than swapping in new content based on
 * a partially-recognised pair.
 *
 * Returns `null` when no complete variant matches.
 */
function detectMarkers(content: string): {
  variant: ManagedBlockMarkers;
  startIdx: number;
  endIdx: number;
} | null {
  for (const variant of MANAGED_BLOCK_VARIANTS) {
    const startIdx = content.indexOf(variant.start);
    const endIdx = content.indexOf(variant.end);
    if (startIdx !== -1 && endIdx !== -1) {
      return { variant, startIdx, endIdx };
    }
  }
  return null;
}

/**
 * Replace the content inside an existing managed block with new content.
 *
 * Throws if the managed block markers are missing, duplicated, or misordered.
 *
 * The output markers are chosen by {@link getMarkersForPath}({@link filePath}),
 * which means a file written by an earlier hatch3r release with the wrong-style
 * markers (issue #76: HTML markers in a `.yml` workflow) is auto-repaired to
 * the correct syntax on the next sync.
 */
export function insertManagedBlock(
  existingContent: string,
  managedContent: string,
  filePath?: string,
): string {
  const outputMarkers = getMarkersForPath(filePath);
  const detected = detectMarkers(existingContent);

  if (!detected) {
    throw new HatchError(
      "Content must contain managed block markers (HATCH3R:BEGIN and HATCH3R:END)",
      1,
      "VALIDATION_ERROR",
    );
  }

  const { variant, startIdx, endIdx } = detected;

  const secondStart = existingContent.indexOf(variant.start, startIdx + 1);
  const secondEnd = existingContent.indexOf(variant.end, endIdx + 1);
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

  // G1: Trim at insert time so the round-trip with extractManagedBlock
  // (which also trims) is symmetric. Without this, asymmetric whitespace
  // around the managed block causes spurious drift on subsequent status
  // runs even when the canonical content is byte-equal.
  const block = `${outputMarkers.start}\n${managedContent.trim()}\n${outputMarkers.end}`;

  const before = existingContent.substring(0, startIdx);
  const after = existingContent.substring(endIdx + variant.end.length);
  // G6 (v1.7.1): guarantee POSIX final newline so the round-trip
  // sync→commit→sync is byte-stable. Without it, every external tool
  // that appends a trailing \n on save (editors, prettier, EditorConfig
  // insert_final_newline=true) creates drift that the next sync rewrites,
  // producing the worktree-setup "many local git changes" symptom.
  const result = `${before}${block}${after}`;
  return result.endsWith("\n") ? result : result + "\n";
}

/** Extract the text between HATCH3R:BEGIN and HATCH3R:END markers (any variant), or null if absent. */
export function extractManagedBlock(content: string): string | null {
  const detected = detectMarkers(content);
  if (!detected) return null;

  return content
    .substring(detected.startIdx + detected.variant.start.length, detected.endIdx)
    .trim();
}

/** Extract user-authored content outside the managed block markers (any variant). */
export function extractCustomContent(content: string): string {
  const detected = detectMarkers(content);
  if (!detected) return content;

  const before = content.substring(0, detected.startIdx).trim();
  const after = content.substring(detected.endIdx + detected.variant.end.length).trim();
  return [before, after].filter(Boolean).join("\n\n");
}

/**
 * Wrap content with HATCH3R:BEGIN / HATCH3R:END markers, choosing the
 * marker variant from {@link filePath}. Omit `filePath` to keep the
 * historical HTML-comment default (used by every markdown-producing adapter).
 */
export function wrapInManagedBlock(content: string, filePath?: string): string {
  const markers = getMarkersForPath(filePath);
  // G2: Trim for symmetry with extractManagedBlock to avoid asymmetric
  // whitespace round-trips that produce spurious status drift.
  // G6 (v1.7.1): trailing \n is POSIX-final-newline; see insertManagedBlock G6.
  return `${markers.start}\n${content.trim()}\n${markers.end}\n`;
}

/** Check whether content contains both markers of any known variant. */
export function hasManagedBlock(content: string): boolean {
  return detectMarkers(content) !== null;
}
