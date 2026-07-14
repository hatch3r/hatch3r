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
 * matched variant + the character indices of its start and end markers.
 *
 * "Detected" means both markers of a single variant appear **each on their
 * own line** (the only shape hatch3r emits — see {@link wrapWithMarkers},
 * which writes `${start}\n…\n${end}`) AND the start line precedes the end
 * line. Mixed variants (e.g. an HTML start with a YAML end) are not
 * recognised — the file is treated as having no managed block, which causes
 * the merge branch in safeWriteFile to fall back to the "missing markers"
 * error path. That's the safer outcome than swapping in new content based on
 * a partially-recognised pair.
 *
 * **D1-7 / D11-4 / D11-6 (Cycle 11 Wave 2, D1+D11, P6+CQ8) — line-anchored,
 * path-aware detection.** Recognition is anchored to whole lines: a marker is
 * only matched when a line, after trimming surrounding whitespace, equals the
 * marker token exactly. The prior bare-`indexOf` form matched the token
 * mid-line, so user content that merely *quotes* a marker (a `.yml` body that
 * documents `# HATCH3R:END`, or markdown prose mentioning
 * `<!-- HATCH3R:END -->`) truncated the block at the quoted token — corrupting
 * extractManagedBlock/extractCustomContent, which in turn fed a wrong slice to
 * the safeWrite deny-scan (so the fail-closed throw never fired) and to the
 * orphan-cleanup `unlink` gate. Variant selection is also path-aware: when
 * {@link filePath} is supplied, the variant {@link getMarkersForPath} would
 * emit for that path is tried first, so a `.yml` file that legitimately uses
 * YAML `#` markers but whose body mentions the HTML token is read as YAML, not
 * mis-detected as HTML by array order. Remaining variants are tried in
 * {@link MANAGED_BLOCK_VARIANTS} order so legacy wrong-variant files (issue #76)
 * still auto-repair.
 *
 * Returns `null` when no complete, ordered, line-anchored variant matches.
 * The start-before-end half of "ordered" is now also asserted explicitly at the
 * return site (D1-34, `startIdx < endIdx`), not left implicit in the END-search
 * offset, so a reversed `(startIdx, endIdx)` pair can never reach the read-side
 * extractors and trigger a {@link String.prototype.substring} bound-swap.
 */
function detectMarkers(
  content: string,
  filePath?: string,
): {
  variant: ManagedBlockMarkers;
  startIdx: number;
  endIdx: number;
} | null {
  // Path-aware precedence: try the variant this path would EMIT first, then
  // the rest in declared order. De-duplicate so the preferred variant is not
  // scanned twice.
  const preferred = filePath ? getMarkersForPath(filePath) : undefined;
  const ordered = preferred
    ? [preferred, ...MANAGED_BLOCK_VARIANTS.filter((v) => v.start !== preferred.start)]
    : MANAGED_BLOCK_VARIANTS;

  // D1-SA1.5-02 (Cycle 12 Wave 3, D1, P6): host-syntax awareness — when the
  // host is markdown, lines inside fenced code regions are excluded from
  // marker detection. Line-anchoring (D1-7/D11-4) made a QUOTED mid-line token
  // inert, but a fenced example documenting the marker format puts the token
  // on its own line, which trims to exactly the bare token — so the fence
  // interior detected as a real block and insertManagedBlock spliced canonical
  // content into the user's example. Computed once per scan and shared with
  // both marker searches below. `undefined` (non-markdown host OR malformed
  // fence structure — CI-RECON-03) means plain line-anchored detection.
  const fenced = isMarkdownHost(filePath) ? computeFencedLineRanges(content) : undefined;

  for (const variant of ordered) {
    const startIdx = lineAnchoredIndexOf(content, variant.start, 0, fenced);
    if (startIdx === -1) continue;
    // Require the END to be a line-anchored token AFTER the start line so a
    // quoted token before the real start (or no real end at all) cannot be
    // mistaken for the block boundary.
    const endIdx = lineAnchoredIndexOf(
      content,
      variant.end,
      startIdx + variant.start.length,
      fenced,
    );
    if (endIdx === -1) continue;
    // D1-34 (Cycle 11 Wave 3, D1, P6+CQ8) — explicit start-before-end guard at
    // the return site. The `fromIdx = startIdx + variant.start.length` argument
    // above already makes a returned `endIdx` strictly greater than `startIdx`
    // (lineAnchoredIndexOf's `tokenIdx >= fromIdx` clause), so today this branch
    // is unreachable. It is kept as a structural invariant so the read-side
    // extractors can never receive a reversed pair regardless of how the
    // index-search internals evolve: a future refactor of lineAnchoredIndexOf's
    // fromIdx handling, or a marker variant whose `end` token overlaps `start`,
    // could otherwise yield `startIdx >= endIdx`. Both extractManagedBlock and
    // extractCustomContent feed (startIdx, endIdx) to String.prototype.substring,
    // which SWAPS its bounds when the first exceeds the second — silently
    // emitting polluted/duplicated content (a sibling of D1-7's cross-variant
    // misdetection, distinct reversed-order root cause). Failing closed to null
    // routes such content down the "no managed block" branch, which
    // safeWriteFile skips non-destructively.
    if (startIdx >= endIdx) continue;
    return { variant, startIdx, endIdx };
  }
  return null;
}

/**
 * True when {@link filePath} names a markdown-family file — the only host
 * syntax where ``` / ~~~ code fences delimit literal regions. An omitted path
 * keeps the historical markdown assumption: {@link getMarkersForPath} defaults
 * the same way (HTML-comment markers), and the optional-path entry points are
 * documented as "correct for markdown" only (see {@link wrapInManagedBlock}).
 */
function isMarkdownHost(filePath?: string): boolean {
  if (filePath === undefined) return true;
  return /\.(md|mdc|markdown)$/i.test(filePath);
}

/** A fenced-code character range `[start, end)` within the scanned content. */
interface FencedRange {
  start: number;
  end: number;
}

/**
 * D1-SA1.5-02 (Cycle 12 Wave 3, D1, P6): compute the character ranges of
 * fenced code regions (backtick or tilde fences) in a markdown document, so
 * marker tokens QUOTED whole-line inside a fence are excluded from
 * line-anchored detection and duplicate counting.
 *
 * CommonMark-lite semantics, deliberately conservative:
 *   - An opening fence is a line whose trimmed form starts with >=3 backticks
 *     or >=3 tildes (info string allowed after the fence characters).
 *   - The region closes at the next line of the same fence character, at
 *     least as long, with nothing else on the line — fences do not nest, so
 *     other fence-looking lines inside stay inert (matching CommonMark).
 *   - A range covers the opening fence line through the closing fence line
 *     inclusive (the fence lines themselves never trim to a bare marker, but
 *     including them keeps the ranges contiguous).
 *   - An unterminated fence VOIDS the shield: `undefined` is returned and the
 *     caller falls back to plain line-anchored detection (the Cycle-11
 *     D1-7/D11-4 semantics), as if the document had no fences at all.
 *
 * Why unterminated ⇒ no shield (CI-RECON-03, Cycle 12 Wave 3 gate regression):
 * one stray fence line flips open/close parity for everything after it, so
 * EVERY pairing this scanner derives from a malformed document is unreliable —
 * not just the trailing range. `agents/hatch3r-ci-watcher.md` demonstrates the
 * failure: its body nests a ```bash example inside a ``` fence (author intent),
 * which CommonMark pairs as (open,inner-close) instead, stranding the final
 * fence line open. The initial D1-SA1.5-02 form extended that stranded fence to
 * end-of-content, shielding the file's REAL `<!-- HATCH3R:END -->`; detection
 * then reported "no managed block", and safeWriteFile's `appendIfNoBlock`
 * branch — the standard adapter-output sync path, NOT a non-destructive skip —
 * spliced a fresh copy of the full block on EVERY sync: unbounded file growth,
 * non-idempotent sync, and a `verify --fix` loop that can never converge
 * (INTEGRITY_ERROR). Returning `undefined` on malformed fence structure keeps
 * the quoted-example shield for every well-formed document (the D1-SA1.5-02
 * threat model: examples live in TERMINATED fences) while restoring the exact
 * pre-Cycle-12 behavior for malformed ones — real whole-line markers are
 * always found, and a whole-line token quoted inside an unterminated fence is
 * matched exactly as it was before fence-awareness existed (no regression
 * beyond the shield's own introduction).
 */
function computeFencedLineRanges(content: string): FencedRange[] | undefined {
  const ranges: FencedRange[] = [];
  let open: { char: string; len: number; rangeStart: number } | null = null;

  let lineStart = 0;
  while (lineStart <= content.length) {
    const nlIdx = content.indexOf("\n", lineStart);
    const lineEnd = nlIdx === -1 ? content.length : nlIdx;
    const trimmed = content.slice(lineStart, lineEnd).trim();

    if (open === null) {
      const m = /^(`{3,}|~{3,})/.exec(trimmed);
      if (m) {
        open = { char: m[1][0], len: m[1].length, rangeStart: lineStart };
      }
    } else {
      // Closing fence: same character, at least the opening length, and
      // nothing else on the line.
      const escaped = open.char === "`" ? "`" : "~";
      const closeRe = new RegExp(`^${escaped}{${open.len},}$`);
      if (closeRe.test(trimmed)) {
        ranges.push({ start: open.rangeStart, end: lineEnd });
        open = null;
      }
    }

    if (nlIdx === -1) break;
    lineStart = nlIdx + 1;
  }

  // Unterminated fence: the fence structure is malformed, so every derived
  // pairing is untrustworthy — void the shield entirely (see JSDoc,
  // CI-RECON-03).
  if (open !== null) return undefined;

  return ranges;
}

/** True when character index {@link idx} falls inside any of {@link ranges}. */
function insideFencedRange(ranges: FencedRange[], idx: number): boolean {
  for (const r of ranges) {
    if (idx >= r.start && idx < r.end) return true;
  }
  return false;
}

/**
 * Find the character index of the first line that — after trimming leading and
 * trailing whitespace — equals {@link marker} exactly, scanning from
 * {@link fromIdx}. Returns the index of the marker token within that line (the
 * first non-whitespace character), so callers keep the same substring contract
 * as a bare `indexOf(marker)` hit. Returns -1 when no such line exists.
 *
 * Anchoring to a whole line is what makes detection collision-proof: a marker
 * token embedded in prose or quoted inside a YAML/JSON value lives on a line
 * with other characters, so its trimmed line never equals the bare token.
 * When {@link fencedRanges} is supplied (markdown hosts — D1-SA1.5-02), lines
 * inside fenced code regions are skipped too, so a whole-line token quoted in
 * a ``` example never matches.
 */
function lineAnchoredIndexOf(
  content: string,
  marker: string,
  fromIdx = 0,
  fencedRanges?: FencedRange[],
): number {
  // Walk line boundaries from fromIdx. A line spans [lineStart, lineEnd).
  // Back up to the start of the line that fromIdx falls inside so a marker on
  // that same line is still considered (start+end never share a line in
  // hatch3r output, but a caller-supplied fromIdx may land mid-line).
  let lineStart = content.lastIndexOf("\n", fromIdx > 0 ? fromIdx - 1 : 0) + 1;
  while (lineStart <= content.length) {
    const nlIdx = content.indexOf("\n", lineStart);
    const lineEnd = nlIdx === -1 ? content.length : nlIdx;
    if (fencedRanges && insideFencedRange(fencedRanges, lineStart)) {
      if (nlIdx === -1) break;
      lineStart = nlIdx + 1;
      continue;
    }
    const line = content.slice(lineStart, lineEnd);
    if (line.trim() === marker) {
      const tokenIdx = lineStart + (line.length - line.trimStart().length);
      // Honor fromIdx: a token strictly before it (same-line back-up case) is
      // skipped so the END search never re-matches the START line.
      if (tokenIdx >= fromIdx) return tokenIdx;
    }
    if (nlIdx === -1) break;
    lineStart = nlIdx + 1;
  }
  return -1;
}

/**
 * Count lines that — after trimming — equal {@link marker} exactly. Used by
 * {@link insertManagedBlock} for duplicate-marker detection so a marker token
 * quoted inside user content (which lives on a line with other characters and
 * therefore never trims to the bare token) is not miscounted as a duplicate.
 * {@link fencedRanges} (markdown hosts — D1-SA1.5-02) additionally excludes
 * whole-line tokens quoted inside fenced code regions: before this, a real
 * HTML block plus a fenced example of the same tokens tripped the duplicate
 * check and routed safeWrite to the `.bak` auto-repair path, displacing
 * out-of-block user content.
 */
function countLineAnchored(content: string, marker: string, fencedRanges?: FencedRange[]): number {
  let count = 0;
  let lineStart = 0;
  while (lineStart <= content.length) {
    const nlIdx = content.indexOf("\n", lineStart);
    const lineEnd = nlIdx === -1 ? content.length : nlIdx;
    if (!(fencedRanges && insideFencedRange(fencedRanges, lineStart))) {
      if (content.slice(lineStart, lineEnd).trim() === marker) count++;
    }
    if (nlIdx === -1) break;
    lineStart = nlIdx + 1;
  }
  return count;
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
  const detected = detectMarkers(existingContent, filePath);

  if (!detected) {
    throw new HatchError(
      "Content must contain managed block markers (HATCH3R:BEGIN and HATCH3R:END)",
      1,
      "VALIDATION_ERROR",
      "Restore the HATCH3R:BEGIN/HATCH3R:END markers around the hatch3r content, then re-run the command.",
    );
  }

  const { variant, startIdx, endIdx } = detected;

  // D1-SA1.5-F7 (Cycle 10 Wave 4, D1, content-quality.CQ8): count every
  // occurrence of each marker (not just from after the first hit) and treat a
  // second occurrence as a duplicate. The prior `indexOf(..., startIdx + 1)`
  // form missed a duplicate that appears BEFORE the detected marker (the
  // reversed-corruption case `END … BEGIN … END … BEGIN`).
  // D1-7 / D11-4 (Cycle 11 Wave 2): the count is line-anchored to match
  // detectMarkers. The prior bare `indexOf`/`lastIndexOf` form counted a marker
  // token QUOTED in user content (markdown prose, or a YAML value documenting
  // `# HATCH3R:END`) as a duplicate, throwing the false "duplicate marker"
  // error — which routed safeWrite to the `.bak` auto-repair path that
  // overwrites out-of-block user content. Counting whole-line tokens only,
  // exactly as detection does, removes that false positive at the root.
  // D1-SA1.5-02 (Cycle 12 Wave 3): the count is additionally fence-aware on
  // markdown hosts, again exactly as detection is — a whole-line token quoted
  // inside a ``` example is neither a block boundary nor a duplicate. As in
  // detectMarkers, a malformed fence structure voids the shield (undefined —
  // CI-RECON-03) so the count stays consistent with detection.
  const fenced = isMarkdownHost(filePath) ? computeFencedLineRanges(existingContent) : undefined;
  const startCount = countLineAnchored(existingContent, variant.start, fenced);
  const endCount = countLineAnchored(existingContent, variant.end, fenced);
  if (startCount > 1) {
    throw new HatchError(
      "Corrupted managed block: duplicate start marker found. Remove the duplicate before syncing.",
      1,
      "VALIDATION_ERROR",
      "Open the file, delete the extra HATCH3R:BEGIN line so only one remains, then re-run the command.",
    );
  }
  if (endCount > 1) {
    throw new HatchError(
      "Corrupted managed block: duplicate end marker found. Remove the duplicate before syncing.",
      1,
      "VALIDATION_ERROR",
      "Open the file, delete the extra HATCH3R:END line so only one remains, then re-run the command.",
    );
  }

  // D1-7 / D11-6 (Cycle 11 Wave 2): the start-before-end ordering check that
  // previously lived here is now an upstream invariant — detectMarkers only
  // returns a pair when the END line is found AFTER the START line
  // (lineAnchoredIndexOf(end, startIdx + start.length)) AND, since D1-34
  // (Cycle 11 Wave 3), the explicit `startIdx < endIdx` guard at its return
  // site, so endIdx > startIdx always holds here. A reversed `END … BEGIN` file
  // no longer detects as a block at all; it falls into the "must contain managed
  // block markers" path above, and safeWriteFile then SKIPS it non-destructively
  // rather than .bak-overwriting it.

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
  //
  // D11-SA11.2-04 (Cycle 12 Wave 4, D11, CQ4) — the ONE documented exception to
  // byte-for-byte out-of-block preservation. `before` and `after` are RAW
  // substrings (not the trimmed slices extractCustomContent uses), so user bytes
  // outside the block survive verbatim; the sole deviation is this conditional
  // append. It adds a single "\n" when a user file whose out-of-block content
  // lacks a POSIX-final newline is merged for the FIRST time, then is byte-stable
  // on every later merge (the append is idempotent — it fires only when the
  // whole result does not already end in "\n"). The append moves the file toward
  // POSIX text-file conformance (a line is newline-terminated: The Open Group
  // POSIX.1-2017 base definitions §3) and the EditorConfig insert_final_newline
  // default, so it normalizes rather than corrupts. A format that needs strict
  // no-final-newline bit-preservation would gate this append behind a per-path
  // opt-out; not warranted today. Pinned by the "documented final-newline
  // exception (D11-SA11.2-04)" tests.
  const result = `${before}${block}${after}`;
  return result.endsWith("\n") ? result : result + "\n";
}

/**
 * Extract the text between HATCH3R:BEGIN and HATCH3R:END markers (any variant),
 * or null if absent. Pass {@link filePath} (D1-7/D11-6) so variant selection
 * prefers the format the path would emit — disambiguates a file whose body
 * quotes the other variant's token.
 */
export function extractManagedBlock(content: string, filePath?: string): string | null {
  const detected = detectMarkers(content, filePath);
  if (!detected) return null;

  return content
    .substring(detected.startIdx + detected.variant.start.length, detected.endIdx)
    .trim();
}

/**
 * Split {@link content} at the start of its managed block: `prefix` is every
 * byte BEFORE the line-anchored BEGIN marker; `rest` is the marker through
 * end-of-content. Returns `null` when no managed block is detected.
 *
 * Slash-picker heal (release/2.6.0): `safeWriteFile`'s existing-markers merge
 * branch and the `status`/`verify` drift comparison share this boundary so the
 * sync-side stub heal and the drift report agree byte-for-byte on what the
 * out-of-block prefix is. Uses the same {@link detectMarkers} resolution as
 * every other read-side helper (line-anchored, path-preferred variant,
 * fence-aware on markdown hosts).
 */
export function splitAtManagedBlock(
  content: string,
  filePath?: string,
): { prefix: string; rest: string } | null {
  const detected = detectMarkers(content, filePath);
  if (!detected) return null;
  return {
    prefix: content.substring(0, detected.startIdx),
    rest: content.substring(detected.startIdx),
  };
}

/**
 * True when {@link prefix} — the out-of-block slice BEFORE a managed block —
 * carries no user-authored content, so the sync-side stub heal may replace it
 * with the freshly generated prefix:
 *
 *   1. Whitespace-only (files written before the byte-0 frontmatter stub
 *      existed have the BEGIN marker at byte 0), or
 *   2. EXACTLY one leading YAML frontmatter block — an opening `---` line,
 *      any interior lines, the first subsequent `---` line — followed by
 *      nothing but whitespace. That is precisely the shape the generated
 *      picker stub uses (`BaseAdapter.processCommandsWithFm` /
 *      `processSkillsWithFmCliFiltered`), so a prefix of this shape is a
 *      generated (possibly stale) stub owned by hatch3r. Hand customization
 *      belongs in `.hatch3r/{type}/{id}.customize.yaml` — including
 *      `description:` overrides — never in the stub itself.
 *
 * Anything else (prose, an unterminated `---` fence, content after the
 * closing fence) is user content and the caller must preserve it verbatim.
 */
export function isHealableManagedPrefix(prefix: string): boolean {
  if (prefix.trim() === "") return true;
  const lines = prefix.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  if (i >= lines.length || (lines[i] ?? "").trim() !== "---") return false;
  // The first later line that trims to exactly `---` closes the frontmatter
  // block (matching how editors and FRONTMATTER_REGEX consumers read it).
  let close = i + 1;
  while (close < lines.length && (lines[close] ?? "").trim() !== "---") close++;
  if (close >= lines.length) return false; // unterminated — user content
  for (let k = close + 1; k < lines.length; k++) {
    if ((lines[k] ?? "").trim() !== "") return false; // trailing user content
  }
  return true;
}

/**
 * Extract user-authored content outside the managed block markers (any
 * variant). Pass {@link filePath} (D1-7/D11-6) so the boundary is computed from
 * the line-anchored, path-preferred variant — a user line that quotes a marker
 * token no longer truncates the slice fed to the safeWrite deny-scan or the
 * orphan-cleanup `unlink` gate.
 */
export function extractCustomContent(content: string, filePath?: string): string {
  const detected = detectMarkers(content, filePath);
  if (!detected) return content;

  const before = content.substring(0, detected.startIdx).trim();
  const after = content.substring(detected.endIdx + detected.variant.end.length).trim();
  return [before, after].filter(Boolean).join("\n\n");
}

/**
 * Internal: wrap {@link content} between the supplied {@link markers}.
 *
 * G2: Trim for symmetry with extractManagedBlock to avoid asymmetric
 * whitespace round-trips that produce spurious status drift.
 * G6 (v1.7.1): trailing \n is POSIX-final-newline; see insertManagedBlock G6.
 * D11-SA11.2-F12 (Cycle 10 Wave 4): the trim is unconditional, so canonical
 * content must NOT rely on leading/trailing whitespace inside the managed
 * block for semantic purposes — it is stripped on every sync. Documented for
 * canonical authors in agents/shared/quality-charter.md ("Managed-block trim
 * contract"). Put semantically-significant blank lines inside the body.
 */
function wrapWithMarkers(content: string, markers: ManagedBlockMarkers): string {
  return `${markers.start}\n${content.trim()}\n${markers.end}\n`;
}

/**
 * Wrap content with HATCH3R:BEGIN / HATCH3R:END markers, deriving the marker
 * variant from {@link path} (REQUIRED). `getMarkersForPath` selects YAML `#`
 * markers for `.yml`/`.yaml` and HTML `<!-- -->` markers otherwise.
 *
 * **D11-SA11.2-F8 (Cycle 10 Wave 4, D11, P5) — path-safe wrap.** This is the
 * marker-emission entry point adapter authors MUST use: because `path` is a
 * mandatory positional argument, an author cannot accidentally omit it and
 * fall back to the markdown default on a `.yml`/`.yaml` output (which would
 * re-introduce issue #76 — HTML markers in a YAML file → GitHub Actions parse
 * failure on line 2). Pass the SAME path the output is written to
 * (`output(path, wrapManagedFor(path, body), body)`); the markers then always
 * match the file format. Adapter call sites in base.ts/claude.ts/copilot.ts/
 * cursor.ts route through this helper for that reason.
 */
export function wrapManagedFor(path: string, content: string): string {
  return wrapWithMarkers(content, getMarkersForPath(path));
}

/**
 * Wrap content with HATCH3R:BEGIN / HATCH3R:END markers, choosing the
 * marker variant from {@link filePath}. Omit `filePath` to keep the
 * historical HTML-comment default.
 *
 * **D11-SA11.2-F8 (Cycle 10 Wave 4, D11, P5).** Prefer {@link wrapManagedFor},
 * which makes `path` mandatory and therefore un-omittable. This optional-path
 * form is retained for the few callers (and tests) that legitimately wrap
 * markdown with no path in hand; `filePath` is optional ONLY because the
 * HTML-comment default is correct for markdown. For any `.yml`/`.yaml` output
 * (or any format where an HTML comment is a syntax error) you MUST pass
 * `filePath` — or, better, call {@link wrapManagedFor}. There is no runtime
 * guard for the omission: the type system cannot tell a `.yml` path from a
 * `.md` one. When adding a `.yaml`-emitting adapter, route it through
 * {@link wrapManagedFor} and add a regression test asserting the emitted
 * markers are the YAML variant.
 */
export function wrapInManagedBlock(content: string, filePath?: string): string {
  return wrapWithMarkers(content, getMarkersForPath(filePath));
}

/**
 * Check whether content contains both line-anchored markers of any known
 * variant (start line before end line). Pass {@link filePath} (D1-7/D11-6) so
 * variant selection prefers the format the path would emit; this keeps the
 * detection decision consistent with the matching extract call on the same
 * file (the orphan-cleanup `unlink` gate reads both).
 */
export function hasManagedBlock(content: string, filePath?: string): boolean {
  return detectMarkers(content, filePath) !== null;
}

/**
 * D11-SA11.2-F11 (Cycle 10 Wave 4, D11, governance.P5): report whether an
 * {@link insertManagedBlock} write would flip the on-disk marker variant —
 * the issue #76 legacy-state auto-repair (HTML markers in a `.yml` file get
 * silently rewritten to YAML `#` markers). The repair is correct, but it was
 * previously invisible: the on-disk byte change shows up in `git diff` with
 * no attribution to hatch3r. Callers (safeWriteFile) use this to surface a
 * one-line "auto-repaired marker syntax" warning on the existing
 * {@link MergeResult.warning} channel so the rewrite is observable.
 *
 * Returns `false` when {@link existingContent} has no detectable managed block
 * (the no-block branch is handled separately) or when the detected variant
 * already matches the variant {@link getMarkersForPath} would emit.
 */
export function wouldChangeMarkerVariant(existingContent: string, filePath?: string): boolean {
  const detected = detectMarkers(existingContent, filePath);
  if (!detected) return false;
  const outputMarkers = getMarkersForPath(filePath);
  return (
    detected.variant.start !== outputMarkers.start || detected.variant.end !== outputMarkers.end
  );
}
