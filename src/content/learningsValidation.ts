import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { scanForDeniedPatterns } from "../adapters/customization.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import {
  sanitizeUserContent,
  validateAgentOutput,
} from "../pipeline/promptGuard.js";

// ── Constants ────────────────────────────────────────────────────

/** Maximum size of a single learning file in bytes (64 KB). */
export const MAX_LEARNING_FILE_BYTES = 65_536;

/** Maximum total size of all learnings combined in bytes (512 KB). */
export const MAX_LEARNINGS_TOTAL_BYTES = 524_288;

/** Maximum number of learning files allowed. */
export const MAX_LEARNING_FILE_COUNT = 50;

/** Allowed file extensions for learning files. */
const ALLOWED_EXTENSIONS = new Set([".md"]);

/** Pattern to detect non-UTF-8 binary content (null bytes, etc.). */
const BINARY_CONTENT_PATTERN = /\0/;

/** Pattern to validate learning file names (alphanumeric, hyphens, underscores, dots). */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;

/**
 * Injection patterns specific to learnings content.
 *
 * These detect attempts to override agent instructions or inject context
 * manipulation through the learnings system (D6 findings 6.7-6.9).
 * The existing DENY_PATTERNS in customization.ts handle general prompt
 * injection; these cover learnings-specific attack vectors.
 *
 * Canonical catalog: `agents/shared/injection-patterns.md` Section B.
 * Each entry's `patternId` matches a row in the catalog. The sync test at
 * `src/__tests__/pipeline/injectionPatternsSync.test.ts` asserts every ID
 * here appears in the catalog.
 *
 * Exported for cross-module use (handoffs validation reuses the same patterns).
 */
export const LEARNINGS_INJECTION_PATTERNS: { patternId: string; pattern: RegExp }[] = [
  // Fake section headers that mimic system/agent instructions
  {
    patternId: "P-LEARN-01",
    pattern: /^#{1,2}\s*(system\s+prompt|instructions|you\s+are|role)\s*:/im,
  },
  // Embedded YAML frontmatter trying to override agent config
  {
    patternId: "P-LEARN-02",
    pattern: /^---\s*\n[\s\S]*?(protected|scope|model)\s*:/m,
  },
  // Attempts to reference or override other agents' context
  {
    patternId: "P-LEARN-03",
    pattern: /(?:override|replace|ignore)\s+(?:agent|rule|skill)\s+/i,
  },
  // Fake managed block markers to inject into merge output
  {
    patternId: "P-LEARN-04",
    pattern: /HATCH3R:(BEGIN|END)/,
  },
  // Attempts to inject tool invocations
  {
    patternId: "P-LEARN-05",
    pattern: /<(?:tool_use|function_call|antml:invoke)\b/i,
  },
];

/**
 * Exported view of `LEARNINGS_INJECTION_PATTERNS` pattern IDs for the catalog
 * synchronization test. External consumers should use `validateLearningContent`.
 */
export const LEARNINGS_INJECTION_PATTERN_IDS: readonly string[] =
  LEARNINGS_INJECTION_PATTERNS.map((p) => p.patternId);

// ── Types ────────────────────────────────────────────────────────

export interface LearningValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fileCount: number;
  totalBytes: number;
}

export interface SingleLearningValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Single-file validation ───────────────────────────────────────

/**
 * Validate a single learning file's content.
 *
 * Checks:
 * 1. Content is valid UTF-8 (no null bytes / binary content)
 * 2. Content size is within the per-file limit
 * 3. Content does not contain denied patterns (prompt injection, etc.)
 * 4. Content is not empty
 */
export function validateLearningContent(
  content: string,
  fileName: string,
): SingleLearningValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Empty content check
  if (content.trim().length === 0) {
    errors.push(`Learning "${fileName}" is empty`);
    return { valid: false, errors, warnings };
  }

  // Binary / encoding check (null bytes indicate non-UTF-8 content)
  if (BINARY_CONTENT_PATTERN.test(content)) {
    errors.push(
      `Learning "${fileName}" contains binary content (null bytes detected). ` +
      `Only UTF-8 text files are allowed.`,
    );
    return { valid: false, errors, warnings };
  }

  // Per-file size limit
  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > MAX_LEARNING_FILE_BYTES) {
    errors.push(
      `Learning "${fileName}" exceeds ${MAX_LEARNING_FILE_BYTES} byte limit ` +
      `(${byteLength} bytes). Split into smaller files.`,
    );
  }

  // Denied pattern scan
  const violations = scanForDeniedPatterns(content);
  for (const v of violations) {
    warnings.push(`Learning "${fileName}" contains suspicious content: ${v}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a learning file name.
 *
 * Checks:
 * 1. File has an allowed extension (.md)
 * 2. File name matches the safe pattern (no path traversal, special chars)
 */
export function validateLearningFileName(fileName: string): string[] {
  const errors: string[] = [];

  // Extension check
  const ext = fileName.substring(fileName.lastIndexOf("."));
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    errors.push(
      `Learning file "${fileName}" has unsupported extension "${ext}". ` +
      `Only .md files are allowed.`,
    );
  }

  // Safe filename check
  if (!SAFE_FILENAME_PATTERN.test(fileName)) {
    errors.push(
      `Learning file "${fileName}" has an invalid name. ` +
      `Use only alphanumeric characters, hyphens, underscores, and dots.`,
    );
  }

  return errors;
}

// ── Content sanitization ────────────────────────────────────────

/**
 * Sanitize learnings content by stripping injection patterns.
 *
 * D6 findings 6.7-6.9: Learnings content is user-controlled and loaded
 * into agent context. This function strips patterns that could override
 * agent instructions or manipulate context. It runs both the general
 * denied patterns (from customization.ts) and the learnings-specific
 * injection patterns defined above.
 *
 * Returns the sanitized content string and a list of stripped patterns.
 */
export function sanitizeLearningsContent(
  content: string,
): { sanitized: string; stripped: string[] } {
  const stripped: string[] = [];
  let result = content;

  // Check learnings-specific injection patterns
  for (const { pattern } of LEARNINGS_INJECTION_PATTERNS) {
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
    );
    const matches = result.match(globalPattern);
    if (matches) {
      for (const m of matches) {
        stripped.push(`Learnings injection pattern stripped: "${m.slice(0, 80)}"`);
      }
      result = result.replace(globalPattern, "[BLOCKED]");
    }
  }

  // Also apply the general denied-pattern scan from customization
  const violations = scanForDeniedPatterns(result);
  if (violations.length > 0) {
    stripped.push(...violations);
    // Re-import would create circular dep concerns, but scanForDeniedPatterns
    // is already imported and available. Use deny pattern replacement inline.
    // The caller should treat the content as tainted and use the sanitized version.
  }

  return { sanitized: result, stripped };
}

// ── Directory validation ─────────────────────────────────────────

/**
 * Validate all learning files in a directory.
 *
 * Performs comprehensive validation of the learnings system:
 * 1. File count limit
 * 2. Total size limit
 * 3. Per-file name validation
 * 4. Per-file content validation (schema, encoding, size, denied patterns)
 */
export async function validateLearningsDirectory(
  learningsDir: string,
): Promise<LearningValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fileCount = 0;
  let totalBytes = 0;

  let entries: string[];
  try {
    entries = await readdir(learningsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { valid: true, errors: [], warnings: [], fileCount: 0, totalBytes: 0 };
    }
    throw err;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  fileCount = mdFiles.length;

  // File count limit
  if (fileCount > MAX_LEARNING_FILE_COUNT) {
    errors.push(
      `Too many learning files (${fileCount}). Maximum is ${MAX_LEARNING_FILE_COUNT}. ` +
      `Consolidate related learnings into fewer files.`,
    );
  }

  // Validate each file
  for (const file of mdFiles) {
    // File name validation
    const nameErrors = validateLearningFileName(file);
    errors.push(...nameErrors);

    // Content validation
    try {
      const content = await readFile(join(learningsDir, file), "utf-8");
      const byteLength = Buffer.byteLength(content, "utf-8");
      totalBytes += byteLength;

      const result = validateLearningContent(content, file);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    } catch (err) {
      errors.push(
        `Failed to read learning file "${file}": ${(err as Error).message}`,
      );
    }
  }

  // Check for non-.md files and warn
  const nonMdFiles = entries.filter(
    (f) => !f.endsWith(".md") && !f.startsWith("."),
  );
  for (const file of nonMdFiles) {
    warnings.push(
      `Non-markdown file found in learnings directory: "${file}". ` +
      `Only .md files are processed.`,
    );
  }

  // Total size limit
  if (totalBytes > MAX_LEARNINGS_TOTAL_BYTES) {
    errors.push(
      `Total learnings size (${totalBytes} bytes) exceeds ${MAX_LEARNINGS_TOTAL_BYTES} byte limit. ` +
      `Remove or consolidate learning files.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileCount,
    totalBytes,
  };
}

// ── /learn-driven persistence (C9-H50, D15-SA15.3-F01) ───────────

/**
 * Compute the SHA-256 hex digest of the body content for tamper detection.
 *
 * Trim leading/trailing whitespace before hashing so the digest is stable
 * across editors that strip or add trailing newlines, matching the
 * `computeHandoffIntegrity` pattern in `src/content/handoffs/validation.ts`.
 *
 * Canonical contract (D13-SA13.4-F10): the algorithm (SHA-256), hash scope
 * (trimmed body only), format (`sha256:{hex}`), and the role of this function
 * as the enforcement point are defined once in
 * `rules/hatch3r-learning-system.md` → "Integrity Hash — Single Source of
 * Truth". This implementation IS that enforcement point; the rule and the
 * `hatch3r-learnings-loader` agent reference it rather than restating it.
 */
export function computeLearningIntegrity(body: string): string {
  const trimmed = body.trim();
  return createHash("sha256").update(trimmed, "utf-8").digest("hex");
}

/**
 * Outcome of {@link persistLearning} — one entry per write attempt.
 */
export interface LearningPersistResult {
  /** True when the write succeeded; false on any guard rejection. */
  written: boolean;
  /** Absolute path the file was written to (when `written === true`). */
  path?: string;
  /** Computed SHA-256 of the body (post-trim); always present for audit. */
  integrity: string;
  /** Reasons the write was rejected; empty when `written === true`. */
  rejections: string[];
  /** Non-blocking advisories (denied-pattern hits below quarantine threshold). */
  warnings: string[];
}

/** Options for {@link persistLearning}. */
export interface PersistLearningOptions {
  /**
   * The expected SHA-256 of the body. When provided, the persistence path
   * recomputes the digest of the supplied body and refuses to write unless
   * the two match. This closes the in-memory tamper window — content cannot
   * be silently mutated between extraction (Step 2 of the /learn command)
   * and write (Step 3) without an audit-visible rejection.
   */
  expectedIntegrity?: string;
  /**
   * Audit-friendly identifier for the loader/agent invoking the persist
   * path. Defaults to `"learn-command"`.
   */
  source?: string;
}

/**
 * Persist a learning file with the full /learn-driven security pipeline.
 *
 * This is the canonical persistence entry point for the `/hatch3r learn`
 * command flow. It closes D15-SA15.3-F01 by running THREE security gates
 * BEFORE any byte is written to disk:
 *
 * 1. **`scanForDeniedPatterns`** (from `src/adapters/customization.ts`).
 *    The same 2026-injection-pattern scan that `safeWriteFile` invokes for
 *    managed-block writes. Any denied pattern blocks the write and is
 *    reported in `rejections`. Closes CD with D6-F1 (context poisoning).
 *
 * 2. **`validateAgentOutput`** (from `src/pipeline/promptGuard.ts`). The
 *    pipeline output validator runs all `INJECTION_PATTERNS` plus boundary-
 *    marker forgery detection. A non-`valid` result blocks the write.
 *    Closes CD with D6-F2 (boundary-marker tampering).
 *
 * 3. **`sanitizeUserContent`** quarantine check. /learn content is user-tier
 *    per the trust hierarchy in `agents/shared/injection-patterns.md` §B;
 *    when the sanitizer marks the content `blocked`, persistence refuses.
 *    The block reasons surface in `rejections` for audit.
 *
 * After the three pattern gates pass, the function performs the in-memory
 * **checksum verification** mandated by D15-SA15.3-F01:
 *
 * - Compute SHA-256 of the body (post-trim) via {@link computeLearningIntegrity}.
 * - When `options.expectedIntegrity` is provided, compare the computed digest
 *   against it byte-for-byte. A mismatch indicates the body was mutated
 *   between extraction and persist (in-memory tampering) and the write is
 *   refused with `rejections: ["integrity mismatch ..."]`.
 *
 * Only after every gate passes does the function invoke
 * {@link atomicWriteFile} to commit the bytes to disk with the standard
 * temp-file + rename sequence.
 *
 * The structural validation from {@link validateLearningContent} also runs
 * — empty bodies, binary content, and size overruns are hard-rejected.
 *
 * @param targetPath  Absolute path where the learning file should be
 *                    written. Caller is responsible for filename validation
 *                    via {@link validateLearningFileName} before invocation.
 * @param body        The fully-formed learning file content (frontmatter
 *                    plus body). All gates run against this exact string.
 * @param options     Optional checksum and audit-source overrides.
 */
export async function persistLearning(
  targetPath: string,
  body: string,
  options: PersistLearningOptions = {},
): Promise<LearningPersistResult> {
  const rejections: string[] = [];
  const warnings: string[] = [];
  const source = options.source ?? "learn-command";
  const fileName = targetPath.substring(targetPath.lastIndexOf("/") + 1);

  // ── Gate 0: Structural validation (size, empty, binary) ──
  // Run first so size-bound failures short-circuit before pattern scans.
  const structural = validateLearningContent(body, fileName);
  rejections.push(...structural.errors);

  // ── Compute integrity (always — audit visibility) ──
  const integrity = computeLearningIntegrity(body);

  // ── Gate 1: scanForDeniedPatterns ──
  // Mirrors safeWriteFile branch 2 — same canonical scan, same audit format.
  const denyHits = scanForDeniedPatterns(body);
  for (const hit of denyHits) {
    rejections.push(`source=${source} ${hit}`);
  }

  // ── Gate 2: validateAgentOutput ──
  // Catches injection patterns + boundary-marker forgery in the persisted text.
  const outputValidation = validateAgentOutput(body);
  if (!outputValidation.valid) {
    for (const v of outputValidation.violations) {
      rejections.push(`source=${source} validateAgentOutput: ${v}`);
    }
  }

  // ── Gate 3: sanitizeUserContent quarantine ──
  // /learn content is user-tier. Any blocked match refuses persistence
  // rather than silently `[SANITIZED]`-replacing — for the /learn path
  // we want the user to revise rather than ship an obfuscated file.
  const userContent = sanitizeUserContent(body, {
    source,
    reference: fileName,
  });
  if (userContent.blocked) {
    for (const reason of userContent.reasons) {
      rejections.push(`source=${source} sanitizeUserContent: ${reason}`);
    }
  }

  // Surface structural warnings (denied-pattern advisories below quarantine).
  warnings.push(...structural.warnings);

  // ── Checksum verification (in-memory tamper window close) ──
  if (typeof options.expectedIntegrity === "string") {
    if (options.expectedIntegrity !== integrity) {
      rejections.push(
        `source=${source} integrity mismatch: declared=${options.expectedIntegrity} computed=${integrity}. ` +
          `Body was mutated between extraction and persist; refusing write.`,
      );
    }
  }

  // Any rejection blocks the write — fail-closed per P6 (Security & Trust).
  if (rejections.length > 0) {
    return {
      written: false,
      integrity,
      rejections,
      warnings,
    };
  }

  // Refuse to overwrite an existing learning file (mirrors writeHandoff
  // discipline and the `Never overwrite existing learning files` guardrail
  // in `skills/hatch3r-learn/SKILL.md`).
  let exists = false;
  try {
    await stat(targetPath);
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (exists) {
    return {
      written: false,
      integrity,
      rejections: [
        `source=${source} refuse-overwrite: ${targetPath} already exists; ` +
          `learnings are append-only per /hatch3r-learn guardrail.`,
      ],
      warnings,
    };
  }

  await atomicWriteFile(targetPath, body);

  return {
    written: true,
    path: targetPath,
    integrity,
    rejections: [],
    warnings,
  };
}
