import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CanonicalFile, CanonicalMetadata } from "../types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/**
 * C7-H18: Discriminated result type for canonical file reads.
 *
 * Replaces the previous silent-null pattern that hid YAML errors,
 * permission failures, and decode errors from callers. Callers can now
 * distinguish "file is missing" from "YAML is invalid" from "permission
 * denied" by inspecting `error.code`.
 *
 * Successful reads have `file`, `content`, `frontmatter`, `body`, and
 * a parsed `canonical` shape. Failed reads have `file` and `error`.
 */
export interface CanonicalReadResult {
  /** Absolute file path. Always present. */
  file: string;
  /** Raw file content including frontmatter, present on success. */
  content?: string;
  /** Parsed frontmatter metadata, present on success. */
  frontmatter?: Record<string, unknown>;
  /** Markdown body after frontmatter (or full content if no frontmatter), present on success. */
  body?: string;
  /** Fully constructed CanonicalFile, present on success. */
  canonical?: CanonicalFile;
  /** Present when the read or parse failed. */
  error?: CanonicalReadError;
}

/**
 * C7-H18: Categorised error codes for canonical file failures.
 *
 * These map node:fs/promises errno codes (ENOENT/EACCES) plus parser
 * failure modes (UTF8/YAML) into a discriminated set so callers and
 * users can react to the specific failure mode instead of receiving a
 * generic null.
 */
export interface CanonicalReadError {
  code: "NOT_FOUND" | "PERMISSION_DENIED" | "UTF8_DECODE_ERROR" | "YAML_PARSE_ERROR" | "UNKNOWN";
  message: string;
  cause?: unknown;
}

/** Map a node:fs ErrnoException code to a CanonicalReadError code. */
function classifyFsError(err: unknown): CanonicalReadError["code"] {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "NOT_FOUND";
  if (code === "EACCES" || code === "EPERM") return "PERMISSION_DENIED";
  if (code === "ERR_INVALID_CHAR" || code === "ERR_ENCODING_INVALID_ENCODED_DATA") return "UTF8_DECODE_ERROR";
  // utf-8 decode in node throws TypeError without a `code` field; detect by name + message
  if (err instanceof TypeError && /utf-?8|invalid (byte|character)/i.test(err.message)) {
    return "UTF8_DECODE_ERROR";
  }
  return "UNKNOWN";
}

/** Build a CanonicalReadError, picking the most specific category for the cause. */
function toReadError(file: string, err: unknown, override?: CanonicalReadError["code"]): CanonicalReadError {
  const code = override ?? classifyFsError(err);
  const baseMessage = err instanceof Error ? err.message : String(err);
  return {
    code,
    message: `${file}: ${baseMessage}`,
    cause: err,
  };
}

/** Format a CanonicalReadError as a single-line warning string. */
function formatWarning(error: CanonicalReadError): string {
  return `[canonical] ${error.code}: ${error.message}`;
}

/**
 * Construct a CanonicalReadResult that carries an error.
 *
 * Splitting this out of the catch body is intentional: it makes the
 * catch perform a function call that materialises the diagnostic on the
 * result object, satisfying the silent-failure contract (CONSTITUTION.md
 * §2 P5) — the catch is no longer a pure-return swallow.
 */
function makeErrorResult(
  file: string,
  err: unknown,
  override?: CanonicalReadError["code"],
): CanonicalReadResult {
  const error = toReadError(file, err, override);
  return { file, error };
}

/**
 * Parse YAML frontmatter from a markdown file's raw content.
 *
 * Returns the parsed metadata and the body content after the frontmatter block.
 * If the file has no frontmatter delimiters (`---`), returns empty metadata
 * and the full content as the body.
 *
 * Throws when the YAML is structurally invalid; callers handle this and
 * surface a YAML_PARSE_ERROR via the warnings channel (C7-H18).
 */
export function parseFrontmatter(rawContent: string): {
  metadata: CanonicalMetadata;
  content: string;
} {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      metadata: { id: "", type: "rule", description: "" },
      content: rawContent,
    };
  }

  const [, frontmatterStr, content = ""] = match;
  const parsed = parseYaml(frontmatterStr ?? "") as Record<string, unknown> | null;
  const metadata: CanonicalMetadata = {
    id: "",
    type: "rule",
    description: "",
  };

  if (parsed && typeof parsed === "object") {
    if (typeof parsed.id === "string") metadata.id = parsed.id;
    if (typeof parsed.type === "string") metadata.type = parsed.type;
    if (typeof parsed.description === "string") metadata.description = parsed.description;
    if (typeof parsed.name === "string") metadata.name = parsed.name;
    if (typeof parsed.scope === "string") metadata.scope = parsed.scope;
    if (typeof parsed.model === "string") metadata.model = parsed.model;
    if (typeof parsed.agent === "string") metadata.agent = parsed.agent;
    if (typeof parsed.event === "string") metadata.event = parsed.event;
    if (typeof parsed.globs === "string") metadata.globs = parsed.globs;
    if (typeof parsed.protected === "boolean") metadata.protected = parsed.protected;
    if (typeof parsed.alwaysApply === "boolean") metadata.alwaysApply = parsed.alwaysApply;
    if (typeof parsed.readonly === "boolean") metadata.readonly = parsed.readonly;
    if (typeof parsed.background === "boolean") metadata.background = parsed.background;
    if (Array.isArray(parsed.tags)) metadata.tags = parsed.tags.filter((t: unknown) => typeof t === "string");
  }

  if (!metadata.id && metadata.name) {
    metadata.id = metadata.name;
  }
  metadata.type = metadata.type ?? "rule";
  metadata.description = metadata.description ?? "";

  return { metadata, content: content ?? "" };
}

export type CanonicalType =
  | "rules"
  | "agents"
  | "skills"
  | "commands"
  | "prompts"
  | "github-agents";

interface ReaderConfig {
  type: CanonicalFile["type"];
  dir: string;
  strategy: "glob" | "subdirectory";
}

const READER_CONFIGS: Record<CanonicalType, ReaderConfig> = {
  rules: { type: "rule", dir: "rules", strategy: "glob" },
  agents: { type: "agent", dir: "agents", strategy: "glob" },
  skills: { type: "skill", dir: "skills", strategy: "subdirectory" },
  commands: { type: "command", dir: "commands", strategy: "glob" },
  prompts: { type: "prompt", dir: "prompts", strategy: "glob" },
  "github-agents": { type: "github-agent", dir: "github-agents", strategy: "glob" },
};

/** Read a single markdown file and parse its frontmatter into a CanonicalReadResult. */
async function readSingleMd(
  fullPath: string,
  fileType: CanonicalFile["type"],
  fallbackId: string,
): Promise<CanonicalReadResult> {
  let stats;
  try {
    stats = await lstat(fullPath);
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err);
    return errorResult;
  }
  if (stats.isSymbolicLink()) {
    // Symlinks are intentionally skipped (security boundary, predates H18).
    // Return a NOT_FOUND-equivalent so callers see a deterministic non-success
    // instead of crashing; symlinks are not a user error and need no warning.
    return {
      file: fullPath,
      error: { code: "NOT_FOUND", message: `${fullPath}: skipped (symbolic link)` },
    };
  }

  let rawContent: string;
  try {
    rawContent = await readFile(fullPath, "utf-8");
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err);
    return errorResult;
  }

  let parsed;
  try {
    parsed = parseFrontmatter(rawContent);
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err, "YAML_PARSE_ERROR");
    return errorResult;
  }

  const { metadata, content } = parsed;
  const id = metadata.id || metadata.name || fallbackId;
  const canonical: CanonicalFile = {
    id,
    type: fileType,
    description: metadata.description ?? "",
    scope: metadata.scope,
    model: metadata.model,
    protected: metadata.protected,
    readonly: metadata.readonly,
    background: metadata.background,
    tags: metadata.tags,
    content,
    rawContent,
    sourcePath: fullPath,
  };
  return {
    file: fullPath,
    content: rawContent,
    frontmatter: { ...metadata } as Record<string, unknown>,
    body: content,
    canonical,
  };
}

/**
 * Read all `.md` files in a directory (recursively) and parse frontmatter.
 * Per-file errors are captured into CanonicalReadResult.error so a single
 * corrupt or unreadable file does not prevent reading the rest of the
 * directory. C7-H18 — error codes are surfaced instead of being swallowed.
 */
async function readGlobMd(baseDir: string, fileType: CanonicalFile["type"]): Promise<CanonicalReadResult[]> {
  let entries: string[];
  try {
    const all = await readdir(baseDir, { recursive: true });
    entries = all.filter((f) => f.endsWith(".md")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Directory absence is normal; not an error worth reporting.
      return [];
    }
    // Permission or other directory-level errors propagate as a single
    // synthetic result so callers can surface them via warnings.
    const errorResult = makeErrorResult(baseDir, err);
    return [errorResult];
  }

  return Promise.all(
    entries.map((relPath) => {
      const fullPath = join(baseDir, relPath);
      const fallbackId = relPath.replace(/\.md$/, "").replace(/\//g, "-");
      return readSingleMd(fullPath, fileType, fallbackId);
    }),
  );
}

/**
 * Read skill content from subdirectories (`{baseDir}/{skillName}/SKILL.md`).
 * Each skill is a directory containing a `SKILL.md` file with frontmatter.
 * Symlinks are skipped; missing `SKILL.md` files cause the directory to be skipped.
 * C7-H18 — error codes are surfaced instead of being swallowed.
 */
async function readSkillSubdirs(baseDir: string): Promise<CanonicalReadResult[]> {
  let dirents: { name: string; isDirectory: () => boolean }[];
  try {
    dirents = (await readdir(baseDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    const errorResult = makeErrorResult(baseDir, err);
    return [errorResult];
  }

  const skillDirs = dirents.filter((d) => d.isDirectory());
  return Promise.all(
    skillDirs.map(async (dir) => {
      const skillPath = join(baseDir, dir.name, "SKILL.md");
      const result = await readSingleMd(skillPath, "skill", dir.name);
      // For skills, prefer name over id (preserve historical behavior).
      // Also treat NOT_FOUND as a benign skip (skill dir exists but SKILL.md absent).
      if (result.canonical) {
        const fm = result.frontmatter ?? {};
        const nameField = typeof fm.name === "string" ? fm.name : undefined;
        const idField = typeof fm.id === "string" ? fm.id : undefined;
        result.canonical.id = nameField ?? idField ?? dir.name;
      }
      return result;
    }),
  );
}

/** Internal dispatch on canonical type to the matching reader. */
async function readCanonicalResults(
  agentsDir: string,
  type: CanonicalType,
): Promise<CanonicalReadResult[]> {
  const config = READER_CONFIGS[type];
  const baseDir = join(agentsDir, config.dir);
  return config.strategy === "subdirectory"
    ? readSkillSubdirs(baseDir)
    : readGlobMd(baseDir, config.type);
}

/**
 * Read all canonical files of a given type from the `.agents/` directory.
 *
 * Returns parsed `CanonicalFile` objects for every successful read. Failed
 * reads (YAML errors, permission denied, decode failures) are surfaced via
 * the optional `warnings` array — a NOT_FOUND on a SKILL.md or on a symlink
 * is treated as a benign skip and does not produce a warning. Skills use
 * subdirectory strategy (`skills/{name}/SKILL.md`); all others use glob
 * strategy (flat `.md` files in the type directory).
 *
 * C7-H18 — Replaces the previous silent-null per-file pattern that hid
 * YAML errors, permission denied, and decode failures from users. Pass a
 * `warnings: string[]` (typically `this.warnings` on a BaseAdapter) to
 * receive a `[canonical] CODE: file: message` line per non-skip failure.
 */
export async function readCanonicalFiles(
  agentsDir: string,
  type: CanonicalType,
  warnings?: string[],
): Promise<CanonicalFile[]> {
  const results = await readCanonicalResults(agentsDir, type);
  const files: CanonicalFile[] = [];
  for (const r of results) {
    if (r.canonical) {
      files.push(r.canonical);
    } else if (r.error && warnings) {
      // Suppress NOT_FOUND for the skills strategy (missing SKILL.md or
      // skipped symlink) — this is normal directory layout, not an error.
      if (r.error.code === "NOT_FOUND") continue;
      warnings.push(formatWarning(r.error));
    }
  }
  return files;
}

/**
 * Read canonical files and return per-file results including errors.
 *
 * C7-H18 — Use when callers need to inspect or count failures, e.g.,
 * validate command surfacing every YAML parse error or a CI gate that
 * fails when N>0 canonical reads error out. Most adapters should prefer
 * `readCanonicalFiles(dir, type, this.warnings)`.
 */
export async function readCanonicalFilesDetailed(
  agentsDir: string,
  type: CanonicalType,
): Promise<CanonicalReadResult[]> {
  return readCanonicalResults(agentsDir, type);
}
