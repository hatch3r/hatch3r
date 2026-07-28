/**
 * DD-C1 (release/2.8.5): shared config-ingress parsing + validation
 * primitives. Before this module every boundary that ingests untrusted or
 * semi-trusted structured input (manifest JSON, customize YAML, pack
 * manifests, env vars, CLI strings) hand-rolled its own parse + shape
 * checks — or worse, trusted a bare `JSON.parse(...) as T` cast. The
 * helpers here are the seed vocabulary those boundaries converge on:
 *
 *   - {@link parseJsonStrict} / {@link parseYamlStrict} — parse with a
 *     structured `HatchError` (CONFIG_ERROR) naming the source on failure,
 *     returning `unknown` so callers MUST validate before use.
 *   - {@link isPlainObject} — the non-null/non-array object gate every
 *     document-shaped ingress needs first.
 *   - {@link requireString} / {@link requireBoolean} /
 *     {@link requireStringArray} / {@link requireEnum} — per-field
 *     validators in the error-accumulation style of
 *     `manifest/hatchJson.ts::validateStringUnion` (the pattern this module
 *     generalizes): they push a field-named message into `errors` and return
 *     `undefined` on mismatch, so a caller collects EVERY defect in one pass
 *     instead of failing field-by-field across reruns.
 *   - {@link unknownFields} / {@link rejectUnknownFields} — unknown-key
 *     policy: enumerate keys outside the allowed set; callers decide warn
 *     (forward-compat surfaces) vs error (security surfaces like pack
 *     manifests).
 *   - {@link readEnvInt} / {@link readEnvBool} — normalized env-var reads.
 *     Booleans follow the repo-wide `"1"`/`"0"` convention STRICTLY (e.g.
 *     `HATCH3R_LOCK=true` is documented as no-signal, pinned by the
 *     safeWrite.fileLock tests) — any other value returns `undefined`.
 *
 * Zero new dependencies: `yaml` is an existing production dep; everything
 * else is stdlib.
 */

import { parse as parseYamlLib } from "yaml";
import { HatchError } from "../types.js";

/** Human-readable value class for error messages (never dumps large values). */
function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  const t = typeof v;
  if (t === "string") {
    const s = v as string;
    return `string ${JSON.stringify(s.length > 40 ? s.slice(0, 40) + "…" : s)}`;
  }
  if (t === "object") return "an object";
  return `${t} ${String(v)}`;
}

/** Non-null, non-array object gate — the first check for any document ingress. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse JSON, throwing a structured CONFIG_ERROR `HatchError` naming
 * `source` (a path or logical name) on syntax failure. Returns `unknown` —
 * the caller owns shape validation.
 */
export function parseJsonStrict(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new HatchError(
      `Malformed JSON in ${source}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      "CONFIG_ERROR",
      `Fix the JSON syntax in ${source} (a linter or \`jq . < file\` pinpoints the offset), then re-run.`,
      { cause: err },
    );
  }
}

/**
 * Parse YAML, throwing a structured CONFIG_ERROR `HatchError` naming
 * `source` on syntax failure. Returns `unknown` — the caller owns shape
 * validation. Uses the single-document `parse` from the existing `yaml` dep.
 */
export function parseYamlStrict(raw: string, source: string): unknown {
  try {
    return parseYamlLib(raw) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new HatchError(
      `Malformed YAML in ${source}: ${reason}`,
      undefined,
      "CONFIG_ERROR",
      `Fix the YAML syntax in ${source}, then re-run.`,
      { cause: err },
    );
  }
}

/** Options shared by the require* field validators. */
export interface RequireFieldOptions {
  /** When true, an absent (`undefined`) field is valid and returns `undefined`
   *  without an error entry. Default false (field is required). */
  optional?: boolean;
  /** Message prefix naming the containing object (e.g. `repos[2]`); the
   *  reported field becomes `<label>.<field>`. */
  label?: string;
}

function fieldName(field: string, opts: RequireFieldOptions): string {
  return opts.label !== undefined ? `${opts.label}.${field}` : field;
}

/**
 * Validate `obj[field]` is a string. Pushes a field-named message into
 * `errors` and returns `undefined` on mismatch (error-accumulation style).
 */
export function requireString(
  obj: Record<string, unknown>,
  field: string,
  errors: string[],
  opts: RequireFieldOptions = {},
): string | undefined {
  const v = obj[field];
  if (v === undefined && opts.optional === true) return undefined;
  if (typeof v === "string") return v;
  errors.push(`\`${fieldName(field, opts)}\` must be a string (got ${describeValue(v)})`);
  return undefined;
}

/** Validate `obj[field]` is a boolean (error-accumulation style). */
export function requireBoolean(
  obj: Record<string, unknown>,
  field: string,
  errors: string[],
  opts: RequireFieldOptions = {},
): boolean | undefined {
  const v = obj[field];
  if (v === undefined && opts.optional === true) return undefined;
  if (typeof v === "boolean") return v;
  errors.push(`\`${fieldName(field, opts)}\` must be a boolean (got ${describeValue(v)})`);
  return undefined;
}

/** Validate `obj[field]` is an array of strings (error-accumulation style). */
export function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  errors: string[],
  opts: RequireFieldOptions = {},
): string[] | undefined {
  const v = obj[field];
  if (v === undefined && opts.optional === true) return undefined;
  if (Array.isArray(v) && v.every((entry) => typeof entry === "string")) {
    return v as string[];
  }
  errors.push(
    `\`${fieldName(field, opts)}\` must be an array of strings (got ${describeValue(v)})`,
  );
  return undefined;
}

/**
 * Validate `obj[field]` is one of `allowed` (generalizes
 * `manifest/hatchJson.ts::validateStringUnion` to return the narrowed
 * value). Error-accumulation style.
 */
export function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  errors: string[],
  opts: RequireFieldOptions = {},
): T | undefined {
  const v = obj[field];
  if (v === undefined && opts.optional === true) return undefined;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  errors.push(
    `\`${fieldName(field, opts)}\` must be one of ${allowed.map((a) => JSON.stringify(a)).join(" | ")} (got ${describeValue(v)})`,
  );
  return undefined;
}

/** Keys of `obj` outside `allowed`, sorted for stable messages. */
export function unknownFields(
  obj: Record<string, unknown>,
  allowed: Iterable<string>,
): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(obj)
    .filter((k) => !allowedSet.has(k))
    .sort();
}

/**
 * Push one error naming every key of `obj` outside `allowed`. Use on
 * security-relevant ingress (pack manifests) where an unrecognized key is a
 * refusal; forward-compat surfaces should route {@link unknownFields}
 * through a warning channel instead.
 */
export function rejectUnknownFields(
  obj: Record<string, unknown>,
  allowed: Iterable<string>,
  errors: string[],
  label: string,
): void {
  const unknown = unknownFields(obj, allowed);
  if (unknown.length > 0) {
    errors.push(
      `${label} contains unknown field(s): ${unknown.map((k) => JSON.stringify(k)).join(", ")}`,
    );
  }
}

/**
 * Read an integer env var. Returns `undefined` when unset, blank,
 * non-numeric, or non-finite; otherwise the value truncated to an integer.
 * Range policy (defaults, floors, clamps) stays with the caller so each
 * knob documents its own bounds.
 */
export function readEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

/**
 * Read a boolean env var under the repo-wide strict `"1"`/`"0"` convention:
 * `"1"` → true, `"0"` → false, anything else (including `"true"`, `""`,
 * unset) → `undefined` (no signal). The strictness is deliberate and
 * test-pinned — `HATCH3R_LOCK=true` must NOT read as enabled
 * (src/__tests__/merge/safeWrite.fileLock.test.ts).
 */
export function readEnvBool(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}
