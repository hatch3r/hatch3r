import { readFile, readdir, lstat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CanonicalFile, CanonicalMetadata, RulePrecedence } from "../types.js";
import { HatchError } from "../types.js";

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
 * Split a comma-separated glob list into an ordered, de-duplicated array,
 * trimming whitespace and stripping a single layer of surrounding quotes.
 * Returns an empty array for empty/undefined input.
 *
 * Mirrors the `csvToSet` semantics in `scripts/validate-rule-parity.ts`
 * (the rule-parity CI gate) so the glob set an adapter emits matches the
 * set the parity validator derives from the same `.md` frontmatter. Returns
 * an array (insertion order preserved, duplicates dropped) rather than a Set
 * because every emitter renders an ordered list (`globs: [...]`,
 * `applyTo: "a, b"`, `paths: [...]`); callers that need set semantics can
 * wrap the result in `new Set(...)`.
 */
export function csvToGlobList(csv: string | undefined): string[] {
  if (!csv) return [];
  const trimmed = csv.trim().replace(/^["']|["']$/g, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of trimmed.split(",")) {
    const g = part.trim();
    if (g && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/**
 * Scope/glob override shape accepted by {@link resolveRuleGlobs}. Structurally
 * compatible with the customization {@link Customization} layer (which carries
 * `scope`) plus an optional `globs` CSV for a future override path. Both fields
 * are optional; an absent field falls through to the canonical rule value.
 */
export interface RuleGlobOverrides {
  scope?: string;
  globs?: string;
}

/**
 * X4/CD4 (D6-1 / D9-1 / D11-1 — GLOBS DROP, Cycle 11 Wave 1): single source of
 * truth for the file-glob set an adapter attaches to a rule. ALL THREE
 * adapters (cursor `globs:`, copilot `applyTo:`, claude `paths:`) MUST route
 * through this helper instead of deriving globs from `scope` alone.
 *
 * Resolution (mirrors the `.md`→`.mdc` scope transform in
 * `src/adapters/canonical.ts` doc + `scripts/validate-rule-parity.ts`):
 *   - effective scope `"always"`          → [] (unconditional; emit no glob shape)
 *   - effective scope `"agent-requested"` → [] (Cursor Apply-Intelligently mode:
 *                                            description-only `.mdc`, no globs; the
 *                                            agent pulls the rule in by description
 *                                            — D5-28, see scope-mode note below)
 *   - effective scope `"conditional"`     → parse `overrides.globs ?? rule.globs`
 *                                            (the canonical two-line form; the
 *                                            real patterns live in the `globs:`
 *                                            field, never in `scope`)
 *   - effective scope contains `,`        → legacy inline-CSV; parse the scope
 *     OR is any other non-keyword string    string itself as the glob CSV
 *   - effective scope absent/empty        → [] (unconditional)
 *
 * D5-28 (Cycle 12 Wave 3, D5, P4): `agent-requested` is the third sanctioned
 * scope. Cursor's "Apply Intelligently / Agent Requested" mode is a
 * description-driven `.mdc` (`description:` present, `alwaysApply: false`, NO
 * `globs:`) — the agent reads the description and pulls the rule in only when
 * relevant (cursor.com/docs/context/rules, accessed 2026-06-09). Without an
 * explicit keyword, this shape was reachable only via the deprecated
 * globs-less-`conditional` form, so a large optional rule with no natural file
 * glob (e.g. a 200-line workflow rule) was forced to `scope: always` and loaded
 * on every Cursor turn (~23 KB against Cursor's ~30.7 KB always-apply
 * performance guidance — a soft per-turn ceiling for always-loaded rule
 * content, a DIFFERENT quantity from the window-fit context budget the runtime
 * gate enforces via `CONTEXT_BUDGET_TOKENS` in `src/adapters/contextBudget.ts`
 * (~120K tokens for Cursor). The two figures are ~15x apart by design: one
 * measures always-apply responsiveness, the other single-window fit — see the
 * `CONTEXT_BUDGET_TOKENS` docstring, D6-SA6.1-02). Returning [] here routes
 * an `agent-requested` rule to the same no-glob emission as `always` for glob
 * purposes; the `alwaysApply` distinction (true vs false) is applied by each
 * adapter's frontmatter builder, not here. Claude Code and Copilot have no
 * agent-requested primitive, so on those adapters the rule loads unconditionally
 * (the honest fallback, matching the no-globs branch already documented in
 * `claude.ts::claudeRulePathsFrontmatter`).
 *
 * "Effective scope" is `overrides?.scope ?? rule.scope` so a customization-layer
 * scope override (already honoured by every adapter via `overrides.scope`)
 * continues to win. The returned array is ordered + de-duplicated; an empty
 * array means "no per-file scoping — load unconditionally".
 *
 * Before this helper, the adapters hit an `else if (scope)` branch on
 * `scope === "conditional"` and emitted `["conditional"]` as the glob, dropping
 * the real patterns for 52/65 conditional rules (incl. `floor:security` /
 * `precedence: critical` `hatch3r-security-patterns`).
 *
 * D2-SA2.3-06 (D2 Medium, P6): pass an optional `warnings` array to receive an
 * advisory when the effective scope is neither a known keyword nor glob-shaped
 * — the case where a `.customize.yaml` typo (`scope: alway`) would otherwise
 * silently turn an always-on rule into a dead glob. Emission is unchanged.
 */
export function resolveRuleGlobs(
  rule: Pick<CanonicalFile, "scope" | "globs">,
  overrides?: RuleGlobOverrides,
  warnings?: string[],
): string[] {
  const scope = overrides?.scope ?? rule.scope;
  if (!scope || scope === "always" || scope === "agent-requested") return [];
  if (scope === "conditional") {
    return csvToGlobList(overrides?.globs ?? rule.globs);
  }
  // Legacy inline-CSV form (`scope: "src/**/*.ts,*.md"` or a single bare
  // glob like `scope: "**/*.ts"`): the glob patterns live in the scope
  // string itself. Parse it directly so back-compat rules keep working.
  //
  // D2-SA2.3-06 (D2 Medium): a scope value that is neither a known keyword nor
  // glob-shaped (contains none of `* / . ,`) parses here as a literal
  // one-token CSV glob that matches no file — silently converting an always-on
  // rule (including a `precedence: critical` security rule re-scoped via a
  // `.customize.yaml` override) into a dead glob. When a `warnings` channel is
  // supplied, surface the near-miss so a `scope: alway` typo is caught instead
  // of dropping the rule from every session; emission stays unchanged.
  if (warnings && !/[*/.,]/.test(scope)) {
    warnings.push(
      `Scope override "${scope}" is not one of always|agent-requested|conditional ` +
        `and is not glob-shaped — the rule will match no files. ` +
        `Did you mean one of those keywords?`,
    );
  }
  return csvToGlobList(scope);
}

/**
 * Filter canonical files down to those that should appear as user-invocable
 * entries in a tool's command/agent picker (e.g. `.claude/commands/`,
 * `.cursor/commands/`, `.claude/agents/`).
 *
 * Two orthogonal signals combined with AND:
 * 1. Top-level-only: the file's path relative to `baseDir` must not contain
 *    a path separator. This excludes companion subdirectories such as
 *    `commands/board/`, `commands/rework/`, `agents/modes/`, and
 *    `agents/shared/` whose contents are sub-workflows or shared reference
 *    material invoked by parent commands/agents, not directly by users.
 * 2. Frontmatter-type whitelist: `frontmatterType` must be either absent
 *    (legacy files lacking the field load unchanged) or equal to
 *    `expectedFrontmatterType`. This catches the rare case of a top-level
 *    companion file (e.g., a `type: shared-context` file) that sits next to
 *    real commands but must not be invocable.
 *
 * Canonical content (bundled in the npm package, read via
 * `resolveBundledContentRoot()`) remains unfiltered, so parent commands can
 * continue referencing companion files by name — this helper only gates
 * per-tool adapter emission.
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
 *
 * D2-M04 (D2 Medium, Cycle 10 Wave 3 rollover) splits the previously
 * overloaded TYPE_MISMATCH bucket into two codes:
 *   - TYPE_MISMATCH: frontmatter scalar/array field carries the wrong YAML
 *     type (e.g. `id: 123`, `tags: "foo,bar"`). Authoring mistake — caller
 *     remedies by quoting the value or wrapping the list in `[ ... ]`.
 *   - INJECTION_TOKEN: the canonical file body contains a structural
 *     injection token (null byte, ANSI escape, `[INST]`, `<|im_start|>`,
 *     `<|tool|>`, `<!-- SYSTEM -->`, etc.). P6 (Security & Trust) signal
 *     — caller remedies by removing the token or routing through an
 *     authoring sanitizer. Previously, both classes shared the
 *     TYPE_MISMATCH code, which made it impossible to filter the
 *     security-relevant subset (P6) from authoring mistakes (P2) in
 *     downstream warnings UIs and CI gates.
 */
export interface CanonicalReadError {
  code:
    | "NOT_FOUND"
    | "PERMISSION_DENIED"
    | "UTF8_DECODE_ERROR"
    | "YAML_PARSE_ERROR"
    | "TYPE_MISMATCH"
    | "INJECTION_TOKEN"
    | "UNKNOWN";
  message: string;
  cause?: unknown;
}

/**
 * CI-RECON-06 (Cycle 12 FIX-AND-SHIP): normalize path separators to `/` in
 * reader DIAGNOSTIC MESSAGES only. On win32, `join()`/`readdir` produce
 * backslash-separated paths (`checks\accessibility.md`), so a message built
 * from `${fullPath}` diverges per-platform and any consumer keying on a
 * `dir/file.md` fragment (tests, CI grep, docs examples) silently misses on
 * Windows. The replacement is unconditional — matching the in-repo precedent
 * in `src/detect/repoAnalyzer.ts:355` / `src/merge/orphanCleanup.ts:188` —
 * because `\` is a reserved separator on win32 (never a filename character)
 * and the canonical corpus contains no posix filename embedding a literal
 * backslash; unconditional also means the win32 branch is exercised verbatim
 * by posix test runs (backslash-input regression cases in canonical.test.ts).
 * SCOPE BOUNDARY: `CanonicalReadResult.file` and `CanonicalFile.sourcePath`
 * stay OS-native — they feed real fs calls and `path.relative()` checks
 * (`isTopLevelMd`) downstream. Only the human/CI-facing `message` channel is
 * normalized.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
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
    // CI-RECON-06: interpolated path is posix-normalized for the message
    // channel; `baseMessage` free text is left untouched (a YAML/TypeError
    // message may legitimately contain backslash escapes).
    message: `${toPosixPath(file)}: ${baseMessage}`,
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
    // F2.2-F10 (Cycle 10 Wave 4): a `.md` file with no YAML frontmatter at all
    // loads with an empty `id`, default `type: "rule"`, and empty description.
    // `readSingleMd` recovers `id` from the filename and overrides `type` with
    // the reader bucket, but `rawType` stays undefined so the file flows
    // through `filterUserFacing`'s back-compat keep path and can surface in the
    // user-invocable picker as if it were a declared artifact. Surface the
    // missing frontmatter on the warning channel rather than coercing silently
    // (CONSTITUTION §2 P5 Silent Failure Contract).
    if (typeMismatches) {
      typeMismatches.push(
        "file lacks YAML frontmatter; id falling back to filename, type defaulting to caller bucket",
      );
    }
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
    // release/2.7.0 effort axis: string-typed only, carried verbatim beside
    // `model` — normalization + gating live in resolveAgentEffort and the
    // adapter emission paths, not the parser.
    if (typeof parsed.effort === "string") metadata.effort = parsed.effort;
    if (typeof parsed.agent === "string") metadata.agent = parsed.agent;
    if (typeof parsed.event === "string") metadata.event = parsed.event;
    if (typeof parsed.globs === "string") metadata.globs = parsed.globs;
    // D5-29 (Cycle 11 Wave 3, P6): optional Copilot agent-scope opt-out. Parsed
    // unconditionally — canonical content omits the field today, so this is a
    // harmless no-op for every current read; storing it on `CanonicalMetadata`
    // lets the Copilot adapter render `excludeAgent:` on the per-rule
    // instruction file without an adapter code change when a rule opts in.
    if (typeof parsed.copilot_exclude_agent === "string") {
      metadata.copilotExcludeAgent = parsed.copilot_exclude_agent;
    }
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
    // D9-H-6 (D9, P1): optional skill tool pre-approval list. Accept both the
    // YAML-underscore (`allowed_tools`) and the Copilot-native hyphen
    // (`allowed-tools`) spellings — `allowed_tools` wins when both appear so
    // a canonical author who mirrors the rendered output form still parses.
    // Only the Copilot adapter renders this field (`processSkillsWithFmCliFiltered`
    // with `emitAllowedTools`); other adapters ignore it. A non-array value is
    // surfaced on the warning channel and the field falls back to undefined.
    const allowedToolsRaw = parsed.allowed_tools ?? parsed["allowed-tools"];
    if (Array.isArray(allowedToolsRaw)) {
      metadata.allowedTools = allowedToolsRaw.filter((t: unknown) => typeof t === "string");
    } else if (allowedToolsRaw !== undefined && typeMismatches) {
      typeMismatches.push(
        `allowed_tools field must be an array of strings, got ${describeYamlType(allowedToolsRaw)} (value: ${JSON.stringify(allowedToolsRaw)})`,
      );
    }
    // D20-1 (X5/CD5): structured agent tool grant — `tools: { allowed, denied }`.
    // Authored on user agents by `src/content/userContent.ts::composeArtifactFile`
    // and validated against ALL_TOOL_CATEGORIES by its `validateStructuredTools`
    // gate. Carried onto the CanonicalFile so the Claude adapter can derive a
    // runtime policy for the re-prefixed user agent id (without it the agent is
    // NO_POLICY-denied every tool call under the PreToolUse hook). Distinct from
    // `allowed_tools` (a flat skill pre-approval list) — `tools` is the
    // category-scoped agent allow/deny object. Non-array `allowed`/`denied`
    // members surface on the warning channel and fall back to undefined.
    const toolsRaw = parsed.tools;
    if (toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)) {
      const toolsObj = toolsRaw as Record<string, unknown>;
      const allowedRaw = toolsObj.allowed;
      const deniedRaw = toolsObj.denied;
      if (Array.isArray(allowedRaw)) {
        metadata.toolsAllowed = allowedRaw.filter((t: unknown) => typeof t === "string");
      } else if (allowedRaw !== undefined && typeMismatches) {
        typeMismatches.push(
          `tools.allowed field must be an array of strings, got ${describeYamlType(allowedRaw)} (value: ${JSON.stringify(allowedRaw)})`,
        );
      }
      if (Array.isArray(deniedRaw)) {
        metadata.toolsDenied = deniedRaw.filter((t: unknown) => typeof t === "string");
      } else if (deniedRaw !== undefined && typeMismatches) {
        typeMismatches.push(
          `tools.denied field must be an array of strings, got ${describeYamlType(deniedRaw)} (value: ${JSON.stringify(deniedRaw)})`,
        );
      }
      // D15-3 (Cycle 11, P6 / ASI02-03): canonical agents author the
      // SHORT-form `tools: { allow: [...], deny: [...] }` carrying literal
      // tool-name tokens — top-level Claude tools (`Write`, `Edit`,
      // `MultiEdit`, `Bash`) and granular `Bash:<subcommand>` strings — rather
      // than the category-scoped long-form `allowed`/`denied` above. Pre-fix
      // these were dropped at parse time, so the per-agent deny envelope
      // (`"Bash:git commit"`, `"Bash:git push"`, `Write`, `Edit` on
      // dependency-drafter / devops / pack-installer) never reached the
      // generated Claude agent file. Carry the raw lists onto the metadata so
      // the Claude adapter can re-emit them (native `disallowedTools:` for
      // top-level tools + a `## Tool Restrictions` constraint block for the
      // granular `Bash:<subcommand>` denies Claude subagent frontmatter cannot
      // express). Keyed `allow`/`deny` to match the canonical short-form
      // spelling; non-array members surface on the warning channel.
      const allowRaw = toolsObj.allow;
      const denyRaw = toolsObj.deny;
      if (Array.isArray(allowRaw)) {
        metadata.toolsAllowRaw = allowRaw.filter((t: unknown) => typeof t === "string");
      } else if (allowRaw !== undefined && typeMismatches) {
        typeMismatches.push(
          `tools.allow field must be an array of strings, got ${describeYamlType(allowRaw)} (value: ${JSON.stringify(allowRaw)})`,
        );
      }
      if (Array.isArray(denyRaw)) {
        metadata.toolsDenyRaw = denyRaw.filter((t: unknown) => typeof t === "string");
      } else if (denyRaw !== undefined && typeMismatches) {
        typeMismatches.push(
          `tools.deny field must be an array of strings, got ${describeYamlType(denyRaw)} (value: ${JSON.stringify(denyRaw)})`,
        );
      }
      // D20-SA20.1-02 (D20 Medium, P6): surface a near-miss/typo `tools`
      // sub-key. The four recognized sub-keys are `allowed`/`denied` (D20-1
      // category grant) and `allow`/`deny` (D15-3 tool-name grant). Any other
      // key (e.g. `allowd`, `denyed`) silently declares no grant, so the
      // width-based security-baseline gate reads `undefined` and requires no
      // baseline citation. Emit a warning so the misspelling surfaces instead
      // of silently disabling the grant.
      if (typeMismatches) {
        for (const key of Object.keys(toolsObj)) {
          if (key !== "allowed" && key !== "denied" && key !== "allow" && key !== "deny") {
            typeMismatches.push(
              `tools.${key} is not a recognized sub-key (expected allowed | denied | allow | deny); its grant is ignored`,
            );
          }
        }
      }
    } else if (toolsRaw !== undefined && typeMismatches) {
      typeMismatches.push(
        `tools field must be an object of shape { allowed?: string[], denied?: string[] }, got ${describeYamlType(toolsRaw)} (value: ${JSON.stringify(toolsRaw)})`,
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

  // D2-SA2.2-05 (D2 Low, P6): warn on frontmatter truncated at an interior
  // column-0 `---`. FRONTMATTER_REGEX's non-greedy first group stops at the
  // FIRST `\r?\n---`, so a YAML block scalar (`description: |`) whose text holds
  // a column-0 `---` — or any stray `---` above the real closer — truncates the
  // frontmatter mid-document. The prefix still parses as valid YAML (no
  // YAML_PARSE_ERROR fires), so every field after the divider (`precedence:`,
  // `protected:`, `floor:*` tags — the D02 §2.3 Layer-1 admission floor) lands
  // in the BODY and coerces to its empty fallback with zero signal, silently
  // disabling the customization Layer-1 lock so a protected/floor artifact
  // becomes disableable at Layer 2. Warn when the first non-empty body line
  // still looks like frontmatter (a `key: value` line or a bare `---`) so the
  // drop surfaces on the `typeMismatches` channel (CONSTITUTION §2 P5 Silent
  // Failure Contract) instead of vanishing. Cheap single-line heuristic, not a
  // re-parse: 0 hits across the 261-file canonical corpus + every test fixture;
  // a body that legitimately opens with `Word: ...` warns advisorily (remedy:
  // lead with a `#` heading or quote the value). Guarded by `typeMismatches`, so
  // the channel-less callers (content/index.ts, base.ts, userContent.ts, …) stay
  // unaffected — only the canonical read path (readSingleMd) opts in.
  if (typeMismatches) {
    const firstBodyLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
    if (/^[A-Za-z_][\w-]*:\s/.test(firstBodyLine) || /^---\s*$/.test(firstBodyLine)) {
      typeMismatches.push(
        "frontmatter may have been truncated at an interior `---`: the body opens with a " +
          "frontmatter-looking line; quote or indent any `---` divider placed inside a block scalar",
      );
    }
  }

  return { metadata, content: content ?? "", rawType };
}

/**
 * Canonical type discriminant accepted by {@link readCanonicalFiles}.
 *
 * C8-D2-M3: Widened from the original 6 (`rules`/`agents`/`skills`/
 * `commands`/`prompts`/`github-agents`) to cover every on-disk
 * `<canonicalRoot>/{dir}/` directory that holds frontmatter-bearing markdown.
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
 *   `<canonicalRoot>/policy/` (referenced by `src/cli/shared/agentsContent.ts`).
 * - `learnings` — reserved member kept so generic tooling enumerates the
 *   canonical type uniformly; no `doGenerate` consumes it and the bundled
 *   `<canonicalRoot>/learnings/` never exists (D15-13). Authoritative learnings
 *   live under `.hatch3r/learnings/`, read directly by `loadValidatedLearnings`
 *   in `src/content/learningsLoader.ts`, not through this reader (D11-SA11.1-02).
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
  // agents/rules — flat `.md` files with frontmatter. D2-9: readGlobMd()
  // enumerates with `{ withFileTypes: true, recursive: true }`, which does not
  // descend into symlinked directories (and drops symlinked files), so a
  // symlink in any of these directories cannot cause id duplication or an
  // infinite readdir loop. (The earlier comment claimed the per-file `lstat`
  // gate alone covered this; it does not — files reached through a symlinked
  // directory are regular files, not symlinks, so only the Dirent walk skips
  // them at the directory boundary.)
  hooks: { type: "hook", dir: "hooks", strategy: "glob" },
  checks: { type: "check", dir: "checks", strategy: "glob" },
  policy: { type: "policy", dir: "policy", strategy: "glob" },
  learnings: { type: "learning", dir: "learnings", strategy: "glob" },
};

/**
 * D11-11 (Cycle 11 Wave 3): the on-disk directory names every canonical reader
 * enumerates, derived from {@link READER_CONFIGS} so there is one source of
 * truth for "which `${root}/<dir>/` does the reader pipeline look at". The
 * packaging copy list in `scripts/copy-content.ts` asserts its `SOURCE_DIRS`
 * covers this set (minus a documented allowlist) and fails the build on drift,
 * so a future reader type cannot be added without also wiring it into the
 * published tarball — which previously read ENOENT→empty and silently shipped
 * an empty content type with no warning. Sorted + de-duplicated for a stable,
 * comparable list.
 */
export const READER_CONFIG_DIRS: readonly string[] = [
  ...new Set(Object.values(READER_CONFIGS).map((c) => c.dir)),
].sort();

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
      error: { code: "NOT_FOUND", message: `${toPosixPath(fullPath)}: skipped (symbolic link)` },
    };
  }

  // D2-10 (D2 Medium, Cycle 11 Wave 3): read raw bytes and decode with a
  // *fatal* UTF-8 decoder rather than `readFile(..., "utf-8")`. The string
  // form never throws on malformed input — it silently substitutes U+FFFD
  // (the replacement character) for each invalid byte, so a corrupt or
  // wrong-encoding canonical file would load with mangled content and the
  // entire UTF8_DECODE_ERROR branch in classifyFsError (predicated on a
  // TypeError the lenient reader can never raise) was unreachable dead code.
  // `TextDecoder("utf-8", { fatal: true })` throws a TypeError whose message
  // contains "utf-8" on the first invalid byte; we map it to UTF8_DECODE_ERROR
  // explicitly so bad encoding surfaces on the warning channel (and trips
  // strict mode) instead of being coerced silently (CONSTITUTION §2 P5 Silent
  // Failure Contract). `ignoreBOM: true` is required: the default decoder
  // *consumes* a leading BOM, but the F2.2-F3 path below detects a BOM via
  // `charCodeAt(0) === 0xfeff` to emit an ENCODING warning before stripping it.
  // Keeping the BOM in the decoded string preserves that warning and matches
  // the prior `readFile(..., "utf-8")` behavior, which also retained the BOM.
  let rawBytes: Buffer;
  try {
    rawBytes = await readFile(fullPath);
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err);
    return errorResult;
  }

  let rawContent: string;
  try {
    rawContent = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
  } catch (err) {
    const errorResult = makeErrorResult(fullPath, err, "UTF8_DECODE_ERROR");
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
    // X4/CD4 (D6-1/D9-1/D11-1): carry the raw `globs:` CSV onto the
    // CanonicalFile so adapters can resolve the real glob set for
    // `scope: conditional` rules. Without this copy, `rule.globs` was
    // undefined downstream and all three adapters derived glob frontmatter
    // from `scope` alone, emitting the literal token `"conditional"` as a
    // glob and dropping the patterns (52/65 conditional rules never
    // auto-attached in Cursor/Copilot and loaded unconditionally in Claude).
    globs: metadata.globs,
    model: metadata.model,
    // release/2.7.0: pass through the optional `effort:` reasoning-effort
    // level beside `model`. Undefined for artifacts that do not declare it.
    effort: metadata.effort,
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
    // D9-H-6: pass through the optional skill `allowed_tools` pre-approval
    // list. Undefined for artifacts that do not declare it (every non-skill
    // type, and skills that pre-approve nothing).
    allowedTools: metadata.allowedTools,
    // D20-1 (X5/CD5): pass through the structured agent `tools` allow/deny
    // grant. Undefined for canonical agents and for user agents that declared
    // no `tools` field. The Claude adapter derives a runtime policy from these
    // so a re-prefixed user agent is governed by its authored grant rather
    // than NO_POLICY-denied.
    toolsAllowed: metadata.toolsAllowed,
    toolsDenied: metadata.toolsDenied,
    // D15-3 (Cycle 11, P6 / ASI02-03): pass through the literal short-form
    // `tools.allow` / `tools.deny` tool-name grant authored on canonical
    // agents. Undefined for agents that did not author the short-form lists.
    // The Claude adapter re-emits the per-agent deny envelope from these so
    // the granular `Bash:<subcommand>` and `Write`/`Edit` denies survive into
    // the generated agent file instead of being silently dropped.
    toolsAllowRaw: metadata.toolsAllowRaw,
    toolsDenyRaw: metadata.toolsDenyRaw,
    // D5-29 (Cycle 11 Wave 3, P6): pass through the optional Copilot
    // agent-scope opt-out. Undefined for every canonical rule today (none
    // declare `copilot_exclude_agent:`); the Copilot adapter emits an
    // `excludeAgent:` line only when this is set, so canonical emission is
    // unchanged.
    copilotExcludeAgent: metadata.copilotExcludeAgent,
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
    // CI-RECON-06: posix-normalized path in the message channel (win32
    // `join()` yields backslashes; see toPosixPath).
    result.typeMismatches = typeMismatches.map(
      (m) => ({ code: "TYPE_MISMATCH" as const, message: `${toPosixPath(fullPath)}: ${m}` }),
    );
  }
  // C7.5-W2B2-H43 (D15-F15.1-02): wire the pipeline promptGuard into the
  // canonical read path so every sync/update/add/verify invocation that
  // reads canonical content exercises ASI01 structural-injection scanning
  // for the unambiguous tokens only. The template-literal check
  // (`{{...}}`) and role-colon checks are deliberately SKIPPED here
  // because legitimate canonical files intentionally embed Handlebars
  // examples (rules/hatch3r-i18n.md, rules/hatch3r-secrets-management.md)
  // and SMTP-style protocol docs — scanning those would flood sync with
  // false positives. The remaining checks catch null bytes, ANSI escape
  // sequences, chat template tokens, and tool-call delimiters, all of
  // which are smoking-gun indicators that a canonical file was
  // adversarially modified post-SHA-256 verification (or pre-publish).
  // The trust-delegation rationale for the narrow scope (canonical content
  // is trusted at the npm-tarball-signature layer via
  // resolveBundledContentRoot) is documented in governance/pack-trust-model.md
  // §3.4 (D11-SA11.1-07, Cycle 10 Wave 4).
  //
  // D2-M04 (D2 Medium, Cycle 10 Wave 3 rollover): emit injection findings
  // with the dedicated `INJECTION_TOKEN` code instead of overloading
  // `TYPE_MISMATCH`. Downstream consumers can now distinguish P6 security
  // signals from P2 authoring mistakes by inspecting `error.code`.
  const injectionScan = scanCanonicalInjectionTokens(content);
  if (injectionScan.length > 0) {
    const injectionEntries = injectionScan.map(
      (v) => ({ code: "INJECTION_TOKEN" as const, message: `${toPosixPath(fullPath)}: promptGuard: ${v}` }),
    );
    result.typeMismatches = result.typeMismatches
      ? [...result.typeMismatches, ...injectionEntries]
      : injectionEntries;
  }
  // D2-SA2.2-03 (D2 Medium, P6): extend the smoking-gun injection detector to
  // the frontmatter half of the file. A chat-template/ANSI/null-byte token
  // placed in a frontmatter string value (e.g. `description:`) evaded the
  // body-only scan above yet still propagates into generated output —
  // `description` is re-emitted into `.mdc`/agent frontmatter and picker text,
  // and `rawContent` (which includes the frontmatter block) is re-emitted
  // verbatim on some Copilot paths (see the F2.2-F3 note above). Scan the raw
  // frontmatter block so a token moved one line up from the body no longer
  // skips the detector. Legitimate frontmatter never carries these structural
  // tokens (zero false positives on the current corpus).
  const frontmatterBlock = rawContent.match(FRONTMATTER_REGEX)?.[1] ?? "";
  if (frontmatterBlock) {
    const fmInjectionScan = scanCanonicalInjectionTokens(frontmatterBlock, "frontmatter");
    if (fmInjectionScan.length > 0) {
      const fmInjectionEntries = fmInjectionScan.map(
        (v) => ({ code: "INJECTION_TOKEN" as const, message: `${toPosixPath(fullPath)}: promptGuard: ${v}` }),
      );
      result.typeMismatches = result.typeMismatches
        ? [...result.typeMismatches, ...fmInjectionEntries]
        : fmInjectionEntries;
    }
  }
  return result;
}

/**
 * C7.5-W2B2-H43: narrow subset of pipeline promptGuard checks applied to
 * canonical file content. Returns a list of human-readable violation
 * descriptions. Skips the template-literal and role-colon checks that the
 * general pipeline guard runs because legitimate canonical docs contain
 * Handlebars examples and RFC-style role markers. The retained checks
 * are limited to structural tokens that have no business appearing in
 * canonical markdown and therefore produce zero false positives on the
 * hatch3r content library.
 *
 * D2-SA2.2-03 (D2 Medium, P6): `location` distinguishes the body scan from
 * the frontmatter scan so the emitted message pinpoints which half of the
 * file carried the token. Callers scan both halves (`readSingleMd`) because
 * a frontmatter string value (e.g. `description:`) reaches generated output
 * just as the body does.
 *
 * The trust delegation that justifies this narrow scope — canonical content
 * is trusted at the npm-tarball-signature layer, not by per-file body
 * inspection — is governed in governance/pack-trust-model.md §3.4
 * (D11-SA11.1-07).
 */
function scanCanonicalInjectionTokens(
  text: string,
  location: "body" | "frontmatter" = "body",
): string[] {
  const violations: string[] = [];
  if (/\x00/.test(text)) violations.push(`null byte in canonical ${location}`);
  if (/\x1b\[/.test(text)) violations.push(`ANSI escape sequence in canonical ${location}`);
  if (/\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i.test(text)) {
    violations.push(`chat template injection tokens in canonical ${location}`);
  }
  if (/<\|(?:tool|function|plugin)\|>/i.test(text)) {
    violations.push(`tool delimiter injection token in canonical ${location}`);
  }
  if (/<!--\s*(?:SYSTEM|ADMIN|ROOT)\s*-->/i.test(text)) {
    violations.push(`HTML comment role escalation in canonical ${location}`);
  }
  return violations;
}

/**
 * Read all `.md` files in a directory (recursively) and parse frontmatter.
 * Per-file errors are captured into CanonicalReadResult.error so a single
 * corrupt or unreadable file does not prevent reading the rest of the
 * directory. C7-H18 — error codes are surfaced instead of being swallowed.
 *
 * D2-9 (D2 Medium, Cycle 11 Wave 3): enumerate with `{ withFileTypes: true,
 * recursive: true }` instead of the string form `{ recursive: true }`. The
 * string form follows symlinked *directories* and emits the real `.md` files
 * twice — once under the real path and once under the symlinked-directory path
 * (probe: a `linkdir -> real/` symlink yields both `real/a.md` and
 * `linkdir/a.md`). Those second-copy entries are regular files, not symlinks,
 * so the per-file `lstat` symlink gate in {@link readSingleMd} never catches
 * them, producing silent N× id duplication that scaled to 16× under nested
 * symlinks. The Dirent form does NOT descend into symlinked directories (it
 * reports the symlink entry itself but stops there), so no duplicate path is
 * generated; we additionally skip any Dirent that is itself a symlink (a
 * symlinked file) to preserve the security boundary the per-file `lstat` gate
 * already enforced, and we skip non-`.md` and directory entries.
 */
async function readGlobMd(baseDir: string, fileType: CanonicalFile["type"]): Promise<CanonicalReadResult[]> {
  let dirents: Dirent[];
  try {
    // D2-SA2.2-09 (D2 Low, P3 — UPSTREAM WATCH): the dedup guarantee below rests
    // on `readdir({ withFileTypes: true, recursive: true })` NOT descending
    // symlinked directories. That behavior is undocumented and contested
    // upstream — nodejs/node#51858 (make readdir stop following symlinks) and
    // nodejs/node#52663 (withFileTypes:false DOES descend) are the watch items;
    // if the Dirent form unifies toward following, the 16× id-duplication D2-9
    // fixed returns. The regression is pinned by the "does not duplicate ids
    // when a symlinked directory points back into the tree" test in
    // canonical.test.ts (DO NOT DELETE — a Node behavior change reds CI on the
    // Node 22/24/26 matrix before user impact).
    dirents = await readdir(baseDir, { withFileTypes: true, recursive: true });
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

  // D2-9: keep only regular `.md` files. Symlinked directories are never
  // descended into by the Dirent recursive walk, and symlinked *files* are
  // dropped here so a `link.md -> real.md` symlink cannot yield a duplicate id
  // (matching the per-file `lstat` skip in readSingleMd). `parentPath` is the
  // absolute directory the entry lives in; relativise it against baseDir to
  // rebuild the stable fallback id ("real/nested/foo.md" -> "real-nested-foo").
  const entries = dirents
    .filter((d) => d.isFile() && !d.isSymbolicLink() && d.name.endsWith(".md"))
    .map((d) => relative(baseDir, join(d.parentPath, d.name)))
    .sort();

  return Promise.all(
    entries.map((relPath) => {
      const fullPath = join(baseDir, relPath);
      const fallbackId = relPath.replace(/\.md$/, "").replace(/[/\\]/g, "-");
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
 *
 * F2.2-F7 (Cycle 10 Wave 4): pass `{ strict: true }` to promote the
 * soft-warning channel to a hard failure — when strict mode is on and ANY
 * non-skip warning (YAML parse error, permission denied, type mismatch,
 * injection token) is collected, the function throws a `HatchError`
 * (`VALIDATION_ERROR`) instead of returning a degraded file list. The default
 * (`strict` omitted/false) preserves the resilient soft-warning behavior every
 * current caller relies on — sync/init/update continue to surface warnings and
 * proceed. Strict mode is opt-in tooling for a release/CI integrity gate: the
 * `validate:canonical` step asserting `0` canonical warnings; see
 * `scripts/validate-canonical.ts`, which implements finding 2.2-F7.
 */
export async function readCanonicalFiles(
  canonicalRoot: string,
  type: CanonicalType,
  warnings?: string[],
  userContentRoot?: string,
  opts?: { strict?: boolean },
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
  // F2.2-F7: collect warnings locally so strict mode can inspect them even
  // when the caller did not pass a `warnings` array. When `warnings` IS
  // provided, every collected line is also mirrored into it — identical to
  // the prior push-into-caller-array behavior, so non-strict callers are
  // unaffected.
  const collected: string[] = [];
  const collect = (line: string): void => {
    collected.push(line);
    if (warnings) warnings.push(line);
  };
  for (const r of results) {
    if (r.canonical) {
      files.push(r.canonical);
      // C7.5-W2B2-H8: surface non-fatal type mismatches even on success.
      // The canonical is still loaded (with the offending field coerced
      // to its empty fallback), so the warning is advisory, not blocking.
      if (r.typeMismatches) {
        for (const m of r.typeMismatches) collect(formatWarning(m));
      }
    } else if (r.error) {
      // Suppress NOT_FOUND for the skills strategy (missing SKILL.md or
      // skipped symlink) — this is normal directory layout, not an error.
      if (r.error.code === "NOT_FOUND") continue;
      collect(formatWarning(r.error));
    }
  }
  if (opts?.strict && collected.length > 0) {
    throw new HatchError(
      `Canonical read for "${type}" produced ${collected.length} warning(s) under strict mode:\n${collected.join("\n")}`,
      undefined,
      "VALIDATION_ERROR",
      `Fix the canonical content issues above, or drop --strict to treat them as non-blocking warnings.`,
    );
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
