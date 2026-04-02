import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { scanForDeniedPatterns } from "../adapters/customization.js";

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
