import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { LEARNINGS_INJECTION_PATTERNS } from "../learningsValidation.js";
import {
  type Handoff,
  type HandoffFrontmatter,
  isHandoffStatus,
} from "./schema.js";

// ── Constants ────────────────────────────────────────────────────

/** Maximum body bytes per handoff (50 KB). */
export const MAX_HANDOFF_BODY_BYTES = 51_200;
/** Maximum total file bytes per handoff (60 KB, body + frontmatter). */
export const MAX_HANDOFF_FILE_BYTES = 61_440;
/** Soft cap on active handoffs per repo — over the cap is a warning. */
export const MAX_ACTIVE_HANDOFFS_PER_REPO = 25;
/** Default expiry window (days) when authoring tools stamp `expires_after`. */
export const HANDOFF_DEFAULT_EXPIRY_DAYS = 30;
/** Maximum length of the optional `summary` field. */
export const MAX_SUMMARY_LENGTH = 200;

/** Required body section headings in canonical order. */
export const REQUIRED_BODY_SECTIONS: readonly string[] = [
  "Problem",
  "Decisions",
  "Work Done",
  "Work Remaining",
  "Blockers",
  "Next Steps",
  "Build & Test Status",
  "File Manifest",
];

/**
 * Handoff id pattern: `<YYYY-MM-DD>_T<HHmm>_<5hex>_<kebab-slug>`.
 * Slug is 1..60 chars, lowercase alphanumeric or hyphen, first char alphanumeric.
 */
export const HANDOFF_ID_PATTERN =
  /^[12][0-9]{3}-[01][0-9]-[0-3][0-9]_T[0-2][0-9][0-5][0-9]_[0-9a-f]{5}_[a-z0-9][a-z0-9-]{0,59}$/;

/** Pattern detecting non-UTF-8 binary content (null bytes). */
const BINARY_CONTENT_PATTERN = /\0/;

/** Pattern matching `## <Heading>` lines. */
const SECTION_HEADING_PATTERN = /^##\s+(.+?)\s*$/gm;

/** Pattern matching the formatted integrity field. */
const INTEGRITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

// ── Types ────────────────────────────────────────────────────────

/** Outcome of validating a handoff artifact. */
export interface HandoffValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Non-blocking advisories about freshness (expiry, git_ref drift). */
  driftWarnings?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * SHA-256 of the body bytes after trimming leading/trailing whitespace,
 * formatted as `"sha256:<lowercase hex>"`. Trim invariant ensures
 * round-tripping through editors that may add/strip trailing newlines.
 */
export function computeHandoffIntegrity(body: string): string {
  const trimmed = body.trim();
  const hash = createHash("sha256").update(trimmed, "utf-8").digest("hex");
  return `sha256:${hash}`;
}

/**
 * Returns true iff `handoff.frontmatter.integrity` is well-formed and matches
 * {@link computeHandoffIntegrity}`(handoff.body)`. Malformed or missing
 * integrity fields return false.
 */
export function verifyHandoffIntegrity(handoff: Handoff): boolean {
  const declared = handoff.frontmatter.integrity;
  if (typeof declared !== "string" || !INTEGRITY_PATTERN.test(declared)) {
    return false;
  }
  return computeHandoffIntegrity(handoff.body) === declared;
}

/**
 * Build a handoff id of the form `<YYYY-MM-DD>_T<HHmm>_<5hex>_<slug>`.
 *
 * `slug` must already be a kebab-case slug (a..z, 0..9, hyphen, length 1..60).
 * Date components are UTC.
 */
export function generateHandoffId(slug: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const min = now.getUTCMinutes().toString().padStart(2, "0");
  const rand = randomBytes(3).toString("hex").slice(0, 5);
  return `${yyyy}-${mm}-${dd}_T${hh}${min}_${rand}_${slug}`;
}

/**
 * Returns true iff `handoff.frontmatter.expires_after` is set and the
 * parsed instant is at-or-before `now`. Missing expiry → false (never expired).
 * Unparseable expiry → false (the schema check catches the malformed value).
 */
export function isHandoffExpired(handoff: Handoff, now: Date = new Date()): boolean {
  const expires = handoff.frontmatter.expires_after;
  if (!expires) return false;
  const expiresMs = Date.parse(expires);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= now.getTime();
}

/** Parse the section headings present in a handoff body. */
function extractSectionHeadings(body: string): string[] {
  const headings: string[] = [];
  // The regex is global; reset lastIndex defensively when re-running.
  SECTION_HEADING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_HEADING_PATTERN.exec(body)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

/**
 * Scan `body` for the 5 learnings-injection patterns (P-LEARN-01..05).
 * Returns the matching pattern ids; empty array on clean input.
 */
function scanForInjectionPatterns(body: string): string[] {
  const hits: string[] = [];
  for (const { patternId, pattern } of LEARNINGS_INJECTION_PATTERNS) {
    if (pattern.test(body)) hits.push(patternId);
  }
  return hits;
}

// ── Single-handoff validation ────────────────────────────────────

/**
 * Validate a parsed handoff artifact.
 *
 * Errors (hard fail):
 *   - missing/empty body, binary content, oversize body or file
 *   - missing or malformed required frontmatter fields
 *   - invalid status, id, integrity, confidence, completeness
 *
 * Warnings (advisory):
 *   - target_agent === "any", summary > 200 chars,
 *     missing required body section, injection-pattern hit
 *
 * Drift warnings (freshness): expired, git_ref drift vs `currentGitRef`.
 *
 * @param options.skipInjectionScan  Disable the P-LEARN-01..05 scan (testing only).
 * @param options.currentGitRef      Current `branch@sha7` for drift detection.
 * @param options.now                Inject a clock for deterministic expiry tests.
 */
export function validateHandoffContent(
  handoff: Handoff,
  options: { skipInjectionScan?: boolean; currentGitRef?: string; now?: Date } = {},
): HandoffValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const driftWarnings: string[] = [];
  const fm = handoff.frontmatter;

  // ── Body checks ──
  if (typeof handoff.body !== "string" || handoff.body.trim().length === 0) {
    errors.push("Handoff body is empty.");
  } else if (BINARY_CONTENT_PATTERN.test(handoff.body)) {
    errors.push(
      "Handoff body contains binary content (null bytes detected). " +
        "Only UTF-8 text is allowed.",
    );
  } else {
    const bodyBytes = Buffer.byteLength(handoff.body, "utf-8");
    if (bodyBytes > MAX_HANDOFF_BODY_BYTES) {
      errors.push(
        `Handoff body exceeds ${MAX_HANDOFF_BODY_BYTES} byte limit ` +
          `(${bodyBytes} bytes). Split or compact the handoff.`,
      );
    }
  }

  // ── Required frontmatter fields ──
  if (typeof fm.id !== "string" || !HANDOFF_ID_PATTERN.test(fm.id)) {
    errors.push(
      `Handoff id is missing or malformed (expected pattern ` +
        `<YYYY-MM-DD>_T<HHmm>_<5hex>_<slug>, got "${String(fm.id)}").`,
    );
  }
  if (fm.type !== "handoff") {
    errors.push(`Handoff frontmatter.type must be "handoff" (got "${String(fm.type)}").`);
  }
  if (typeof fm.created !== "string" || Number.isNaN(Date.parse(fm.created))) {
    errors.push(`Handoff frontmatter.created must be ISO-8601 (got "${String(fm.created)}").`);
  }
  if (typeof fm.updated !== "string" || Number.isNaN(Date.parse(fm.updated))) {
    errors.push(`Handoff frontmatter.updated must be ISO-8601 (got "${String(fm.updated)}").`);
  }
  if (!isHandoffStatus(fm.status)) {
    errors.push(`Handoff status is invalid: "${String(fm.status)}".`);
  }
  if (typeof fm.source_agent !== "string" || fm.source_agent.length === 0) {
    errors.push("Handoff source_agent is missing.");
  }
  if (typeof fm.target_agent !== "string" || fm.target_agent.length === 0) {
    errors.push("Handoff target_agent is missing.");
  } else if (fm.target_agent === "any") {
    warnings.push(
      'target_agent is "any" — explicit target_agent recommended to avoid handoff loops.',
    );
  }
  if (typeof fm.git_ref !== "string" || fm.git_ref.length === 0) {
    errors.push("Handoff git_ref is missing.");
  }
  if (typeof fm.branch !== "string" || fm.branch.length === 0) {
    errors.push("Handoff branch is missing.");
  }
  if (
    typeof fm.confidence !== "number" ||
    Number.isNaN(fm.confidence) ||
    fm.confidence < 0 ||
    fm.confidence > 1
  ) {
    errors.push(`Handoff confidence must be 0..1 inclusive (got ${String(fm.confidence)}).`);
  }
  if (
    typeof fm.completeness !== "number" ||
    Number.isNaN(fm.completeness) ||
    fm.completeness < 0 ||
    fm.completeness > 1
  ) {
    errors.push(`Handoff completeness must be 0..1 inclusive (got ${String(fm.completeness)}).`);
  }
  if (typeof fm.integrity !== "string" || !INTEGRITY_PATTERN.test(fm.integrity)) {
    errors.push(
      `Handoff integrity must be "sha256:<64-hex>" (got "${String(fm.integrity)}").`,
    );
  } else if (typeof handoff.body === "string" && handoff.body.trim().length > 0) {
    // Only verify when the body itself is valid — otherwise mismatch is redundant.
    const computed = computeHandoffIntegrity(handoff.body);
    if (computed !== fm.integrity) {
      errors.push(
        `Handoff integrity hash does not match body content ` +
          `(declared ${fm.integrity}, computed ${computed}).`,
      );
    }
  }

  // ── Optional field advisories ──
  if (typeof fm.summary === "string" && fm.summary.length > MAX_SUMMARY_LENGTH) {
    warnings.push(
      `Handoff summary exceeds ${MAX_SUMMARY_LENGTH} chars (${fm.summary.length} chars). ` +
        "Compact the summary; full context belongs in the body.",
    );
  }

  // ── Body section coverage ──
  if (typeof handoff.body === "string" && handoff.body.length > 0) {
    const present = new Set(extractSectionHeadings(handoff.body));
    for (const required of REQUIRED_BODY_SECTIONS) {
      if (!present.has(required)) {
        warnings.push(`Handoff body is missing required section "## ${required}".`);
      }
    }

    // ── Injection scan ──
    if (!options.skipInjectionScan) {
      const hits = scanForInjectionPatterns(handoff.body);
      for (const patternId of hits) {
        warnings.push(
          `Handoff body matches injection pattern ${patternId}. ` +
            "Review and sanitize before consuming.",
        );
      }
    }
  }

  // ── Drift checks ──
  if (isHandoffExpired(handoff, options.now)) {
    driftWarnings.push(
      `Handoff expired at ${String(fm.expires_after)}. ` +
        "Archive or refresh before resuming.",
    );
  }
  if (typeof options.currentGitRef === "string" && options.currentGitRef.length > 0) {
    if (fm.git_ref !== options.currentGitRef) {
      driftWarnings.push(
        `Handoff git_ref "${fm.git_ref}" differs from current "${options.currentGitRef}". ` +
          "Code has moved since the handoff was authored.",
      );
    }
  }

  const result: HandoffValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };
  if (driftWarnings.length > 0) result.driftWarnings = driftWarnings;
  return result;
}

// ── Directory validation ─────────────────────────────────────────

/** Outcome of {@link validateHandoffsDirectory}. */
export interface HandoffsDirectoryResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  activeCount: number;
  archivedCount: number;
}

/**
 * Read a handoff file from disk: split frontmatter and body, parse YAML.
 * Returns an error string when the file cannot be parsed.
 */
async function loadHandoffFile(
  filePath: string,
): Promise<{ handoff?: Handoff; error?: string }> {
  let raw: string;
  let readError: string | null = null;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_HANDOFF_FILE_BYTES) {
      return {
        error:
          `Handoff file "${filePath}" exceeds ${MAX_HANDOFF_FILE_BYTES} byte limit ` +
          `(${fileStat.size} bytes).`,
      };
    }
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    // Silent Failure Contract: stage the diagnostic, then surface via return.
    readError = `Failed to read handoff "${filePath}": ${(err as Error).message}`;
    raw = "";
  }
  if (readError !== null) {
    return { error: readError };
  }

  // Split `---\n<yaml>\n---\n<body>`.
  if (!raw.startsWith("---")) {
    return { error: `Handoff "${filePath}" is missing YAML frontmatter delimiter.` };
  }
  const afterFirst = raw.slice(3);
  const newlineAfterFirst = afterFirst.indexOf("\n");
  if (newlineAfterFirst < 0) {
    return { error: `Handoff "${filePath}" has malformed frontmatter delimiter.` };
  }
  const fmStart = newlineAfterFirst + 1;
  const closeMatch = afterFirst.slice(fmStart).match(/\n---\s*(?:\r?\n|$)/);
  if (!closeMatch || typeof closeMatch.index !== "number") {
    return { error: `Handoff "${filePath}" frontmatter is not closed by "---".` };
  }
  const yamlBlock = afterFirst.slice(fmStart, fmStart + closeMatch.index);
  const bodyStart = fmStart + closeMatch.index + closeMatch[0].length;
  const body = afterFirst.slice(bodyStart);

  let parsed: unknown;
  let parseError: string | null = null;
  try {
    parsed = parseYaml(yamlBlock);
  } catch (err) {
    // Silent Failure Contract: stage the diagnostic, then surface via return.
    parseError = `Handoff "${filePath}" has invalid YAML frontmatter: ${(err as Error).message}`;
    parsed = null;
  }
  if (parseError !== null) {
    return { error: parseError };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { error: `Handoff "${filePath}" frontmatter is not a YAML mapping.` };
  }

  return {
    handoff: {
      frontmatter: parsed as HandoffFrontmatter,
      body,
      filePath,
    },
  };
}

/**
 * Validate every `.md` file in `activeDir` (and optionally `archivedDir`).
 *
 * Errors and warnings are tagged with the offending filename. Missing
 * directories return a clean result with zero counts.
 */
export async function validateHandoffsDirectory(
  activeDir: string,
  options: { archivedDir?: string; currentGitRef?: string } = {},
): Promise<HandoffsDirectoryResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  async function listMdFiles(dir: string): Promise<string[] | null> {
    try {
      const entries = await readdir(dir);
      return entries.filter((f) => f.endsWith(".md"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      // Silent Failure Contract: surface other errors as warnings rather than
      // throw — the directory is best-effort scannable.
      warnings.push(`Failed to list handoff dir "${dir}": ${(err as Error).message}`);
      return null;
    }
  }

  const activeFiles = (await listMdFiles(activeDir)) ?? [];
  if (activeFiles.length > MAX_ACTIVE_HANDOFFS_PER_REPO) {
    warnings.push(
      `Active handoff count (${activeFiles.length}) exceeds soft cap ` +
        `(${MAX_ACTIVE_HANDOFFS_PER_REPO}). Archive completed handoffs to reduce drift surface.`,
    );
  }

  for (const file of activeFiles) {
    const { handoff, error } = await loadHandoffFile(join(activeDir, file));
    if (error || !handoff) {
      errors.push(error ?? `Failed to load handoff "${file}".`);
      continue;
    }
    const r = validateHandoffContent(handoff, { currentGitRef: options.currentGitRef });
    for (const e of r.errors) errors.push(`[${file}] ${e}`);
    for (const w of r.warnings) warnings.push(`[${file}] ${w}`);
    if (r.driftWarnings) {
      for (const dw of r.driftWarnings) warnings.push(`[${file}] ${dw}`);
    }
  }

  let archivedCount = 0;
  if (options.archivedDir) {
    const archivedFiles = (await listMdFiles(options.archivedDir)) ?? [];
    archivedCount = archivedFiles.length;
    for (const file of archivedFiles) {
      const { handoff, error } = await loadHandoffFile(join(options.archivedDir, file));
      if (error || !handoff) {
        errors.push(error ?? `Failed to load archived handoff "${file}".`);
        continue;
      }
      // Archived handoffs are not drift-checked but still schema-checked.
      const r = validateHandoffContent(handoff);
      for (const e of r.errors) errors.push(`[archived/${file}] ${e}`);
      for (const w of r.warnings) warnings.push(`[archived/${file}] ${w}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    activeCount: activeFiles.length,
    archivedCount,
  };
}
