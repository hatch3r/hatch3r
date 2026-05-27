import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CanonicalFile, CanonicalMetadata, RulePrecedence } from "../types.js";
import { sanitizePipelineInput } from "../pipeline/promptGuard.js";

/**
 * Set of valid rule precedence values. Kept in one place so the parser,
 * the parity validator, and the sort helper all agree on the enum.
 */
export const RULE_PRECEDENCE_VALUES = ["critical", "high", "normal", "low"] as const;

/**
 * Precedence-to-rank table. Lower rank = higher priority in sort output.
 * Spacing of 200 between buckets reserves room for future intermediate
 * tiers without renumbering the existing ones.
 */
const PRECEDENCE_RANKS: Record<RulePrecedence, number> = {
  critical: 100,
  high: 300,
  normal: 500,
  low: 700,
};

/**
 * Map a precedence value (or undefined/unknown) to its sort rank. Absent
 * and non-enum values both fall back to `"normal"` (500) so the helper is
 * safe on mixed inputs where some items carry precedence and others do not.
 */
export function precedenceRank(value?: string): number {
  if (value && (RULE_PRECEDENCE_VALUES as readonly string[]).includes(value)) {
    return PRECEDENCE_RANKS[value as RulePrecedence];
  }
  return PRECEDENCE_RANKS.normal;
}

/**
 * Stable sort by precedence rank ascending (lower rank = higher priority),
 * tie-breaking on `id` lexicographic order so ordering is deterministic
 * across runs regardless of filesystem enumeration. Returns a new array;
 * does not mutate the input.
 *
 * Consumers (Wave B) pipe rule collections through this helper before
 * emitting adapter output so critical rules appear above high above
 * normal above low in the generated files.
 */
export function sortByPrecedence<T extends { precedence?: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = precedenceRank(a.precedence) - precedenceRank(b.precedence);
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Filter canonical files down to those that should appear as user-invocable
 * entries in a tool's command/agent picker (e.g. `.claude/commands/`,
 * `.cursor/commands/`, `.claude/agents/`).
 *
 * Two orthogonal signals combined with AND:
 * 1. Top-level-only: the file's path relative to `baseDir` must not contain
 *    a path separator. This excludes companion subdirectories such as
 *    `commands/board/`, `commands/revision/`, `agents/modes/`, and
 *    `agents/shared/` whose contents are sub-workflows or shared reference
 *    material invoked by parent commands/agents, not directly by users.
 * 2. Frontmatter-type whitelist: `frontmatterType` must be either absent
 *    (legacy files lacking the field load unchanged) or equal to
 *    `expectedFrontmatterType`. This catches the rare case of a top-level
 *    companion file (e.g., a `type: shared-context` file) that sits next to
 *    real commands but must not be invocable.
 *
 * Canonical `.agents/` content (populated by `src/content/index.ts`)
 * remains unfiltered, so parent commands can continue referencing
 * companion files by name — this helper only gates per-tool adapter
 * emission.
 *
 * Cross-platform: uses `path.relative` to normalise the pair of absolute
 * paths before the subdirectory check, because on Windows `sourcePath` and
 * `baseDir` arrive backslash-separated (from `node:path.join` / `readdir`).
 * The relative-path check then looks for either separator so mixed inputs
 * (POSIX paths synthesised in tests, Windows paths emitted by `readdir`)
 * all land on the same outcome.
 */
export function filterUserFacing(
  files: CanonicalFile[],
  expectedFrontmatterType: "command" | "agent",
  baseDir: string,
): CanonicalFile[] {
  return files.filter((file) => {
    const rel = relative(baseDir, file.sourcePath);
    // Safe default when `sourcePath` lies outside `baseDir`: `path.relative`
    // returns a `..`-prefixed path (or a cross-drive absolute path on
    // Windows). Keep the file — filtering is a picker-visibility concern,
    // not a scoping guard.
    if (rel === "" || rel.startsWith("..")) return true;
    // Windows cross-drive absolute: path.relative returns the second path
    // verbatim when it cannot express a relative traversal.
    if (/^[A-Za-z]:[\\/]/.test(rel)) return true;
    // Subdirectory check: accept either separator because tests may feed
    // POSIX-style paths through on Windows, and `readdir` on Windows
    // returns native backslashes.
    if (rel.includes("/") || rel.includes("\\")) return false;
    if (file.frontmatterType && file.frontmatterType !== expectedFrontmatterType) return false;
    return true;
  });
}

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
  /**
   * C7.5-W2B2-H8: Non-fatal frontmatter type mismatches. Present when the
   * file loaded successfully but one or more identity fields (id/type/
   * description/tags) parsed into the wrong YAML type. The file is still
   * exposed via `canonical` so adapters keep working; the warning channel
   * exposes the mismatch so users notice adversarial or mistaken content.
   */
  typeMismatches?: CanonicalReadError[];
}

/**
 * C7-H18: Categorised error codes for canonical file failures.
 *
 * These map node:fs/promises errno codes (ENOENT/EACCES) plus parser
 * failure modes (UTF8/YAML) into a discriminated set so callers and
 * users can react to the specific failure mode instead of receiving a
 * generic null.
 *
 * C7.5-W2B2-H8 adds TYPE_MISMATCH for frontmatter fields that parse
 * successfully but carry the wrong YAML type (e.g. `id: 123` instead of
 * `id: "123"`, or `tags: "foo,bar"` instead of `tags: [foo, bar]`). The
 * categorisation is emitted as a warning — the file still loads with the
 * offending field coerced to its empty fallback — so adversarial canonical
 * content cannot silently impersonate another id via type manipulation.
 */
export interface CanonicalReadError {
  code: "NOT_FOUND" | "PERMISSION_DENIED" | "UTF8_DECODE_ERROR" | "YAML_PARSE_ERROR" | "TYPE_MISMATCH" | "UNKNOWN";
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
 * C7.5-W2B2-H8: Describe the observed YAML type of a frontmatter value so
 * the emitted warning pinpoints the wrong shape (array, number, boolean,
 * object, null) rather than a generic "not a string". Callers use this
 * string in the warning message.
 */
function describeYamlType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
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
 *
 * C7.5-W2B2-H8: pass `typeMismatches` to collect per-field TYPE_MISMATCH
 * diagnostics when `id`, `type`, `description`, or `tags` parse into the
 * wrong YAML type. The field is still coerced to its empty fallback; the
 * warning exposes the offending input so adversarial canonical content
 * cannot silently impersonate another id via `id: 123` or `id: [a, b]`.
 *
 * F2.2-F3 (Cycle 10 Wave 2): a leading UTF-8 BOM (U+FEFF) is stripped before
 * the FRONTMATTER_REGEX test. The regex is anchored with `^---`, so a BOM
 * inserted by a Windows editor (PowerShell `Set-Content`, VS Code "UTF-8 with
 * BOM") would push the `---` off byte 0 and make the match fail silently — the
 * file would then load with a filename-derived id, default `type: rule`, empty
 * description, and no tags/precedence, dropping security-critical metadata
 * (rule precedence, hook `type`, `floor:*` tags) without any signal. Stripping
 * the BOM matches the asymmetry already present for customization YAML
 * (`src/models/customize.ts` reads `utf-8` and the parser tolerates a BOM).
 * When a BOM is observed and `typeMismatches` is supplied, an ENCODING note is
 * pushed onto that channel so the file's encoding mistake surfaces as a
 * warning rather than staying silent.
 */
export function parseFrontmatter(
  rawContent: string,
  typeMismatches?: string[],
): {
  metadata: CanonicalMetadata;
  content: string;
  /**
   * The author-declared `type:` value from frontmatter, or `undefined` when
   * the field is absent or was a non-string. Distinct from `metadata.type`,
   * which falls back to `"rule"` when absent — callers that need to
   * distinguish "user declared type" from "parser default" (e.g. the
   * adapter filter at {@link filterUserFacing}) should read this field.
   */
  rawType?: string;
} {
  // F2.2-F3: strip a single leading UTF-8 BOM (U+FEFF) so the anchored
  // FRONTMATTER_REGEX can still see `^---` on byte 0. Surface the encoding
  // mistake on the warning channel — silently honoring it would still parse,
  // but operators should know their authoring tool injected a BOM.
  let cleaned = rawContent;
  if (cleaned.charCodeAt(0) === 0xfeff) {
    cleaned = cleaned.slice(1);
    if (typeMismatches) {
      typeMismatches.push(
        "ENCODING: leading UTF-8 BOM (U+FEFF) stripped before frontmatter parse — re-save the file as UTF-8 without BOM",
      );
    }
  }

  const match = cleaned.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      metadata: { id: "", type: "rule", description: "" },
      content: cleaned,
    };
  }

  const [, frontmatterStr, content = ""] = match;
  const parsed = parseYaml(frontmatterStr ?? "") as Record<string, unknown> | null;
  const metadata: CanonicalMetadata = {
    id: "",
    type: "rule",
    description: "",
  };
  let rawType: string | undefined;

  if (parsed && typeof parsed === "object") {
    // C7.5-W2B2-H8: enforce type contract on security-relevant identity
    // fields (id/type/description/tags). Values that parse to non-string
    // / non-array shapes are rejected with a TYPE_MISMATCH diagnostic so
    // users see that a YAML mistake (e.g. unquoted numeric id) has caused
    // the field to fall back to its empty default.
    const scalarFields: ReadonlyArray<"id" | "type" | "description"> = ["id", "type", "description"];
    for (const field of scalarFields) {
      const raw = parsed[field];
      if (raw === undefined) continue;
      if (typeof raw === "string") {
        metadata[field] = raw;
        if (field === "type") rawType = raw;
      } else if (typeMismatches) {
        typeMismatches.push(
          `${field} field must be a string, got ${describeYamlType(raw)} (value: ${JSON.stringify(raw)})`,
        );
      }
    }
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
    if (Array.isArray(parsed.tags)) {
      metadata.tags = parsed.tags.filter((t: unknown) => typeof t === "string");
    } else if (parsed.tags !== undefined && typeMismatches) {
      typeMismatches.push(
        `tags field must be an array of strings, got ${describeYamlType(parsed.tags)} (value: ${JSON.stringify(parsed.tags)})`,
      );
    }
    // D20 user-content authoring: optional `adapters: [...]` array on user
    // tier artifacts restricts which platform adapters emit the artifact.
    // Empty / omitted means full parity (handled by the adapter-side filter).
    // Parsed unconditionally — canonical content does not declare this field
    // so the parse is a harmless no-op; storing it on `CanonicalMetadata`
    // keeps the downstream filter (in `BaseAdapter`) source-agnostic.
    if (Array.isArray(parsed.adapters)) {
      metadata.adapters = parsed.adapters.filter((a: unknown) => typeof a === "string");
    } else if (parsed.adapters !== undefined && typeMismatches) {
      typeMismatches.push(
        `adapters field must be an array of strings, got ${describeYamlType(parsed.adapters)} (value: ${JSON.stringify(parsed.adapters)})`,
      );
    }
    // Wave A1: optional rule precedence bucket. Validated by
    // scripts/validate-rule-parity.ts (enum check + pass-through parity).
    // The parser accepts the value only when it is a string matching the
    // enum; anything else is silently dropped so invalid values cannot
    // reach consumers via this path. The CI validator emits the hard
    // failure for out-of-enum values.
    if (typeof parsed.precedence === "string") {
      const val = parsed.precedence;
      if ((RULE_PRECEDENCE_VALUES as readonly string[]).includes(val)) {
        metadata.precedence = val as RulePrecedence;
      }
    }
  }

  if (!metadata.id && metadata.name) {
    metadata.id = metadata.name;
  }
  metadata.type = metadata.type ?? "rule";
  metadata.description = metadata.description ?? "";

  return { metadata, content: content ?? "", rawType };
}

/**
 * Canonical type discriminant accepted by {@link readCanonicalFiles}.
 *
 * C8-D2-M3: Widened from the original 6 (`rules`/`agents`/`skills`/
 * `commands`/`prompts`/`github-agents`) to cover every on-disk
 * `.agents/{dir}/` directory that holds frontmatter-bearing markdown.
 *
 * - `hooks` — hook definition files. Note: the full hook lifecycle is still
 *   parsed by {@link readHookDefinitions} in `src/hooks/index.ts` because
 *   hook frontmatter has its own required fields (`event`, `agent`) and its
 *   own validation surface. Exposing `hooks` here lets generic tooling
 *   (validate, status, audit readers) enumerate hook markdown through the
 *   same discriminated read/warn pipeline as the other canonical types
 *   without re-implementing directory traversal or symlink skipping.
 * - `checks` — reusable quality-charter checklists referenced by agents
 *   (e.g. `accessibility.md`, `security.md`, `testing.md`).
 * - `policy` — optional deny-list and guardrail markdown under
 *   `.agents/policy/` (referenced by `src/cli/shared/agentsContent.ts`).
 * - `learnings` — project-specific `.agents/learnings/*.md` entries seeded
 *   by `hatch3r init` (see `src/cli/commands/init.ts:195-199`). Learnings
 *   carry lightweight frontmatter so agents can surface pitfalls/patterns
 *   during sync; extending the canonical type keeps that path uniform.
 */
export type CanonicalType =
  | "rules"
  | "agents"
  | "skills"
  | "commands"
  | "prompts"
  | "github-agents"
  | "hooks"
  | "checks"
  | "policy"
  | "learnings";

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
  // C8-D2-M3: hooks/checks/policy/learnings use the same glob strategy as
  // agents/rules — flat `.md` files with frontmatter. The existing
  // readGlobMd() path already lstat-guards each entry and skips symlinks,
  // so recursive symlinks in any of these directories cannot trigger
  // infinite readdir loops even though readdir({recursive:true}) is used.
  hooks: { type: "hook", dir: "hooks", strategy: "glob" },
  checks: { type: "check", dir: "checks", strategy: "glob" },
  policy: { type: "policy", dir: "policy", strategy: "glob" },
  learnings: { type: "learning", dir: "learnings", strategy: "glob" },
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
  const typeMismatches: string[] = [];
  try {
    // parseFrontmatter strips a leading BOM internally and pushes an ENCODING
    // note onto `typeMismatches` (F2.2-F3); the raw bytes are passed through
    // unmodified so the warning fires for the on-disk read path.
    parsed = parseFrontmatter(rawContent, typeMismatches);
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err, "YAML_PARSE_ERROR");
    return errorResult;
  }

  // F2.2-F3: normalise the stored raw bytes too. A BOM that reached the parser
  // would also reach adapters that re-emit `rawContent` verbatim
  // (`src/adapters/copilot.ts` prompt/agent bodies), leaking the BOM into
  // generated output. Strip it once here so re-emission is BOM-free while the
  // warning above still records that the source file carried one.
  if (rawContent.charCodeAt(0) === 0xfeff) {
    rawContent = rawContent.slice(1);
  }

  const { metadata, content, rawType } = parsed;
  const id = metadata.id || metadata.name || fallbackId;
  const canonical: CanonicalFile = {
    id,
    type: fileType,
    // Preserve the author-declared frontmatter `type` alongside the reader
    // bucket so downstream filters (see `filterUserFacing`) can distinguish
    // user-invocable commands/agents from companion content
    // (`shared-context`, `reference`, `mode`) within the same directory.
    // `rawType` is undefined when the author omitted `type:`, so files
    // without an explicit declaration fall through the filter's
    // back-compat path and are kept.
    frontmatterType: rawType,
    description: metadata.description ?? "",
    scope: metadata.scope,
    model: metadata.model,
    protected: metadata.protected,
    readonly: metadata.readonly,
    background: metadata.background,
    tags: metadata.tags,
    precedence: metadata.precedence,
    // D20: pass through the optional `adapters: [...]` filter declared on
    // user-tier frontmatter. Canonical content omits this field so the
    // value is `undefined` for canonical reads — the adapter-side filter
    // treats absence as "full parity" (emit unconditionally), so canonical
    // emission is unchanged.
    adapters: metadata.adapters,
    content,
    rawContent,
    sourcePath: fullPath,
  };
  const result: CanonicalReadResult = {
    file: fullPath,
    content: rawContent,
    frontmatter: { ...metadata } as Record<string, unknown>,
    body: content,
    canonical,
  };
  // C7.5-W2B2-H8: surface per-field type mismatches alongside the
  // successfully-loaded canonical file. Using `typeMismatches` lets the
  // file still load (with empty string/array fallbacks per prior
  // behavior) while the warning channel exposes which field parsed into
  // the wrong YAML type — closing the silent id-manipulation vector
  // without breaking existing content.
  if (typeMismatches.length > 0) {
    result.typeMismatches = typeMismatches.map(
      (m) => ({ code: "TYPE_MISMATCH" as const, message: `${fullPath}: ${m}` }),
    );
  }
  // C7.5-W2B2-H43 (D15-F15.1-02): wire the pipeline promptGuard into the
  // canonical read path so every sync/update/add/verify invocation that
  // reads .agents/ content exercises ASI01 structural-injection scanning
  // for the unambiguous tokens only. The template-literal check
  // (`{{...}}`) and role-colon checks are deliberately SKIPPED here
  // because legitimate canonical files intentionally embed Handlebars
  // examples (rules/hatch3r-i18n.md, rules/hatch3r-secrets-management.md)
  // and SMTP-style protocol docs — scanning those would flood sync with
  // false positives. The remaining checks catch null bytes, ANSI escape
  // sequences, chat template tokens, and tool-call delimiters, all of
  // which are smoking-gun indicators that a canonical file was
  // adversarially modified post-SHA-256 verification (or pre-publish).
  const injectionScan = scanCanonicalInjectionTokens(content);
  if (injectionScan.length > 0) {
    const injectionEntries = injectionScan.map(
      (v) => ({ code: "TYPE_MISMATCH" as const, message: `${fullPath}: promptGuard: ${v}` }),
    );
    result.typeMismatches = result.typeMismatches
      ? [...result.typeMismatches, ...injectionEntries]
      : injectionEntries;
  }
  return result;
}

/**
 * C7.5-W2B2-H43: narrow subset of pipeline promptGuard checks applied to
 * canonical file bodies. Returns a list of human-readable violation
 * descriptions. Skips the template-literal and role-colon checks that the
 * general pipeline guard runs because legitimate canonical docs contain
 * Handlebars examples and RFC-style role markers. The retained checks
 * are limited to structural tokens that have no business appearing in
 * canonical markdown and therefore produce zero false positives on the
 * hatch3r content library.
 */
function scanCanonicalInjectionTokens(body: string): string[] {
  const violations: string[] = [];
  if (/\x00/.test(body)) violations.push("null byte in canonical body");
  if (/\x1b\[/.test(body)) violations.push("ANSI escape sequence in canonical body");
  if (/\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i.test(body)) {
    violations.push("chat template injection tokens in canonical body");
  }
  if (/<\|(?:tool|function|plugin)\|>/i.test(body)) {
    violations.push("tool delimiter injection token in canonical body");
  }
  if (/<!--\s*(?:SYSTEM|ADMIN|ROOT)\s*-->/i.test(body)) {
    violations.push("HTML comment role escalation in canonical body");
  }
  return violations;
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
  canonicalRoot: string,
  type: CanonicalType,
): Promise<CanonicalReadResult[]> {
  const config = READER_CONFIGS[type];
  const baseDir = join(canonicalRoot, config.dir);
  return config.strategy === "subdirectory"
    ? readSkillSubdirs(baseDir)
    : readGlobMd(baseDir, config.type);
}

/**
 * D20 user-content authoring: read user-tier artifacts of a given type from
 * `${userContentRoot}/${dir}/`. Reuses {@link readGlobMd} and
 * {@link readSkillSubdirs} so the user subtree gets identical YAML, symlink,
 * UTF-8, and structural-injection treatment as canonical content (the
 * {@link scanCanonicalInjectionTokens} pass inside {@link readSingleMd}
 * applies uniformly to every canonical OR user file routed through these
 * helpers).
 *
 * Each successfully-loaded result has its `canonical.source` tagged
 * `"user"` so downstream consumers (the adapter-side filter in
 * `BaseAdapter.readTrackedCanonicalFiles` /
 * `readUserFacingCanonicalFiles`) can distinguish user from canonical.
 *
 * Silently returns an empty list when `${userContentRoot}/${dir}` is absent
 * — this is the common case for projects that have not yet authored any
 * user content. Permission and YAML errors surface via the same
 * {@link CanonicalReadResult.error} channel as canonical reads.
 *
 * Wave 4: `userContentRoot` is the user-repo override directory passed in by
 * the caller (Wave 5 will wire this to `.hatch3r/overrides/`). The legacy
 * implicit `${canonicalRoot}/user/` subtree no longer exists — every caller
 * that wants user-tier overrides must pass an explicit root.
 */
async function readUserCanonicalResults(
  userContentRoot: string,
  type: CanonicalType,
): Promise<CanonicalReadResult[]> {
  const config = READER_CONFIGS[type];
  const baseDir = join(userContentRoot, config.dir);
  const results = config.strategy === "subdirectory"
    ? await readSkillSubdirs(baseDir)
    : await readGlobMd(baseDir, config.type);
  for (const r of results) {
    if (r.canonical) {
      r.canonical.source = "user";
    }
  }
  return results;
}

/**
 * Read all canonical files of a given type from the bundled canonical-content
 * root.
 *
 * Wave 4: the first argument is the **bundled** canonical-content root (post
 * W0/W3, every caller passes {@link resolveBundledContentRoot}'s result). The
 * legacy `.agents/` materialisation in the user's repo no longer exists, so
 * user-tier overrides must be supplied via the explicit `userContentRoot`
 * parameter — there is no implicit `${canonicalRoot}/user/` lookup anymore.
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
 *
 * D20 user-content authoring: when `userContentRoot` is provided and the
 * directory exists, the user subtree is also scanned and its results appended
 * *after* the canonical results. User-tier files have
 * `canonical.source === "user"`; canonical files have `source` undefined
 * (treated as `"canonical"` by consumers). Wave 5 wires the
 * `.hatch3r/overrides/` path through adapters; for now most call sites pass
 * `undefined` (no overrides).
 */
export async function readCanonicalFiles(
  canonicalRoot: string,
  type: CanonicalType,
  warnings?: string[],
  userContentRoot?: string,
): Promise<CanonicalFile[]> {
  const canonical = await readCanonicalResults(canonicalRoot, type);
  const user = userContentRoot ? await readUserCanonicalResults(userContentRoot, type) : [];
  // Order: canonical first, user second. Predictable for downstream
  // consumers (sortByPrecedence is stable on equal precedence and
  // tie-breaks on `id`, so user content with the same precedence as a
  // canonical entry interleaves alphabetically without losing the
  // canonical/user split for adapters that emit unsorted lists).
  const results = [...canonical, ...user];
  const files: CanonicalFile[] = [];
  for (const r of results) {
    if (r.canonical) {
      files.push(r.canonical);
      // C7.5-W2B2-H8: surface non-fatal type mismatches even on success.
      // The canonical is still loaded (with the offending field coerced
      // to its empty fallback), so the warning is advisory, not blocking.
      if (warnings && r.typeMismatches) {
        for (const m of r.typeMismatches) warnings.push(formatWarning(m));
      }
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
 *
 * D20: see {@link readCanonicalFiles} for `userContentRoot` semantics — the
 * user subtree results are appended after canonical, with each user-tier
 * `CanonicalReadResult.canonical.source === "user"`.
 */
export async function readCanonicalFilesDetailed(
  canonicalRoot: string,
  type: CanonicalType,
  userContentRoot?: string,
): Promise<CanonicalReadResult[]> {
  const canonical = await readCanonicalResults(canonicalRoot, type);
  if (!userContentRoot) return canonical;
  const user = await readUserCanonicalResults(userContentRoot, type);
  return [...canonical, ...user];
}
