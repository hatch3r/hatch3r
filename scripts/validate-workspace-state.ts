#!/usr/bin/env node
/**
 * scripts/validate-workspace-state.ts
 *
 * Mechanical schema validation for the EVOLVE engine's ephemeral workspace
 * state — `.evolve-workspace/checkpoint.json` and
 * `.evolve-workspace/verdict-ledger.jsonl` — against the schemas in
 * `governance/EVOLVE.md` §0.6. That section names this exact script:
 * "Checkpoint and ledger writes validate mechanically against the schemas in
 * this section via `scripts/validate-workspace-state.ts`". Lands the queued
 * script from the EVOLVE run a2a16b59 validator-sync manifest (item C3).
 *
 * Pillars: P5 (Governance Self-Quality), P2 (Scientific Quality).
 *
 * Checkpoint contract (§0.6 required-key floor; extra keys tolerated —
 * `session_count`/`last_gate` are documented diagnostic fields and runs add
 * run-specific notes such as `cadence_override`):
 *   engine == "evolve" · schema_version == 1 · run_id · mode matching
 *   `full-rewrite | scoped:<A##,…> | assess-only` · phase · corpus_sha ·
 *   prompt_sha · inventory_hashes object ·
 *   agenda{total_blocks, cursor, verdicts_done} · round2 object ·
 *   research object ·
 *   rewrite{wave, files_done, files_pending, rolled_back, failed,
 *   rewritten_hashes} · by_analogy_decisions array · timestamp.
 *
 * Ledger contract (§0.6): one JSON object per non-empty line, two line
 * classes:
 *   - VERDICT entries (§4 round 1 / §5 round 2): id · name · verdict ∈
 *     {keep-as-is, refine, rewrite, remove-or-merge, deferred} (round 1) or
 *     {adopt, defer, reject} (round 2) · round ∈ {1, 2} · files array ·
 *     consent_tier ∈ {standard, s8-labeled} · owner_consent boolean ·
 *     rationale_dated · ts; `pct_answers` must be non-null when
 *     `accepted_suggestions` is non-empty or round == 2 (§0.6 text below the
 *     schema block).
 *   - CONSENT-RECORD lines (`gate:`-keyed, no `verdict` key): the §7.4
 *     "append the consent record to the ledger" class. §0.6 names the §6.2
 *     consent record as ledger content but defines NO schema for it, so this
 *     validator counts and reports these lines without schema-validating
 *     them (schema-ing them is a §0.6 amendment, out of validator scope).
 *   A line matching neither class (no gate, no id/verdict/round anchors) is
 *   a violation.
 *
 * Absent-input behavior: `.evolve-workspace/` is gitignored + ephemeral
 * (deletable once the §8.3 archive exists), so an absent workspace or an
 * absent target file exits 0 with a "no workspace — nothing to validate"
 * notice. CI stays green without a workspace, mirroring the absent-registry
 * convention in `scripts/validate-finding-registry.ts`.
 *
 * On violations: one `file · pointer · problem` line each; exit 1.
 *
 * Usage: `npm run validate:workspace-state` (standalone script — NOT part of
 * the `validate` battery, which must pass in workspace-less CI clones).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

export const WORKSPACE_DIR_NAME = ".evolve-workspace";
export const CHECKPOINT_NAME = "checkpoint.json";
export const LEDGER_NAME = "verdict-ledger.jsonl";

/** Round-1 (§4) verdict subset per EVOLVE.md §0.6. */
export const ROUND1_VERDICTS: ReadonlySet<string> = new Set([
  "keep-as-is",
  "refine",
  "rewrite",
  "remove-or-merge",
  "deferred",
]);

/** Round-2 (§5) verdict subset per EVOLVE.md §0.6. */
export const ROUND2_VERDICTS: ReadonlySet<string> = new Set([
  "adopt",
  "defer",
  "reject",
]);

/** Full §0.6 verdict enum (union of the round-1 and round-2 subsets). */
export const ALL_VERDICTS: ReadonlySet<string> = new Set([
  ...ROUND1_VERDICTS,
  ...ROUND2_VERDICTS,
]);

/** `s8-labeled` is the JSON value for the display form `§8-labeled` (§0.6). */
export const CONSENT_TIERS: ReadonlySet<string> = new Set([
  "standard",
  "s8-labeled",
]);

/**
 * §0.6 mode shape: `full-rewrite | scoped:<A##,…> | assess-only`. The scoped
 * list is one or more comma-joined agenda ids of the `A##` form (two digits,
 * matching the §1.2 static agenda A00–A15 id shape).
 */
export const MODE_RE = /^(?:full-rewrite|assess-only|scoped:A\d{2}(?:,A\d{2})*)$/;

export interface Violation {
  /** Repo-relative file path (e.g. `.evolve-workspace/checkpoint.json`). */
  file: string;
  /** JSON pointer-ish locator: a key path or `line <n>` for the ledger. */
  pointer: string;
  problem: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a parsed checkpoint.json value against the §0.6 required-key
 * floor. Extra keys are tolerated (see header). Returns violations; empty
 * array means the checkpoint satisfies the contract.
 */
export function validateCheckpoint(
  raw: unknown,
  file: string = `${WORKSPACE_DIR_NAME}/${CHECKPOINT_NAME}`,
): Violation[] {
  const v: Violation[] = [];
  if (!isPlainObject(raw)) {
    return [
      {
        file,
        pointer: "(root)",
        problem: `checkpoint root must be a JSON object; got ${Array.isArray(raw) ? "array" : typeof raw}`,
      },
    ];
  }

  if (raw.engine !== "evolve") {
    v.push({
      file,
      pointer: "engine",
      problem: `must be the literal "evolve"; got ${JSON.stringify(raw.engine)}`,
    });
  }
  if (raw.schema_version !== 1) {
    v.push({
      file,
      pointer: "schema_version",
      problem: `must be the number 1; got ${JSON.stringify(raw.schema_version)}`,
    });
  }
  if (!isNonEmptyString(raw.run_id)) {
    v.push({
      file,
      pointer: "run_id",
      problem: "required non-empty string",
    });
  }
  if (!isNonEmptyString(raw.mode) || !MODE_RE.test(raw.mode)) {
    v.push({
      file,
      pointer: "mode",
      problem: `must match \`full-rewrite | scoped:<A##,…> | assess-only\`; got ${JSON.stringify(raw.mode)}`,
    });
  }
  for (const key of ["phase", "corpus_sha", "prompt_sha", "timestamp"]) {
    if (!isNonEmptyString(raw[key])) {
      v.push({ file, pointer: key, problem: "required non-empty string" });
    }
  }
  if (!isPlainObject(raw.inventory_hashes)) {
    v.push({
      file,
      pointer: "inventory_hashes",
      problem: "required object of <path>: <sha> pairs",
    });
  }

  if (!isPlainObject(raw.agenda)) {
    v.push({
      file,
      pointer: "agenda",
      problem: "required object {total_blocks, cursor, verdicts_done}",
    });
  } else {
    for (const key of ["total_blocks", "cursor", "verdicts_done"]) {
      if (!isFiniteNumber(raw.agenda[key])) {
        v.push({
          file,
          pointer: `agenda.${key}`,
          problem: `required finite number; got ${JSON.stringify(raw.agenda[key])}`,
        });
      }
    }
  }

  for (const key of ["round2", "research"]) {
    if (!isPlainObject(raw[key])) {
      v.push({ file, pointer: key, problem: "required object" });
    }
  }

  if (!isPlainObject(raw.rewrite)) {
    v.push({
      file,
      pointer: "rewrite",
      problem:
        "required object {wave, files_done, files_pending, rolled_back, failed, rewritten_hashes}",
    });
  } else {
    if (!isFiniteNumber(raw.rewrite.wave)) {
      v.push({
        file,
        pointer: "rewrite.wave",
        problem: `required finite number; got ${JSON.stringify(raw.rewrite.wave)}`,
      });
    }
    for (const key of ["files_done", "files_pending", "rolled_back", "failed"]) {
      if (!Array.isArray(raw.rewrite[key])) {
        v.push({
          file,
          pointer: `rewrite.${key}`,
          problem: "required array",
        });
      }
    }
    if (!isPlainObject(raw.rewrite.rewritten_hashes)) {
      v.push({
        file,
        pointer: "rewrite.rewritten_hashes",
        problem: "required object of <path>: <sha256> pairs",
      });
    }
  }

  if (!Array.isArray(raw.by_analogy_decisions)) {
    v.push({
      file,
      pointer: "by_analogy_decisions",
      problem: "required array (§0.3 future-proofing clause records)",
    });
  }

  return v;
}

export type LedgerLineClass = "verdict" | "consent" | "unrecognized";

/**
 * Classify a parsed ledger line. `gate:`-keyed lines without a `verdict` are
 * the §7.4 consent-record class (no §0.6 schema). Lines carrying any verdict
 * anchor (id / verdict / round) validate as §0.6 verdict entries. Anything
 * else is unrecognized.
 */
export function classifyLedgerLine(
  obj: Record<string, unknown>,
): LedgerLineClass {
  if ("gate" in obj && !("verdict" in obj)) return "consent";
  if ("id" in obj || "verdict" in obj || "round" in obj) return "verdict";
  return "unrecognized";
}

/**
 * Validate one verdict-entry object against the §0.6 ledger schema keys.
 * `pointer` prefixes every violation (e.g. `line 3`).
 */
export function validateVerdictEntry(
  obj: Record<string, unknown>,
  pointer: string,
  file: string,
): Violation[] {
  const v: Violation[] = [];
  const at = (key: string): string => `${pointer} · ${key}`;

  for (const key of ["id", "name", "rationale_dated", "ts"]) {
    if (!isNonEmptyString(obj[key])) {
      v.push({
        file,
        pointer: at(key),
        problem: "required non-empty string",
      });
    }
  }

  const round = obj.round;
  if (round !== 1 && round !== 2) {
    v.push({
      file,
      pointer: at("round"),
      problem: `required 1 (§4) or 2 (§5); got ${JSON.stringify(round)}`,
    });
  }

  const verdict = obj.verdict;
  if (!isNonEmptyString(verdict) || !ALL_VERDICTS.has(verdict)) {
    v.push({
      file,
      pointer: at("verdict"),
      problem: `must be one of keep-as-is|refine|rewrite|remove-or-merge|deferred (round 1) or adopt|defer|reject (round 2); got ${JSON.stringify(verdict)}`,
    });
  } else if (round === 1 && !ROUND1_VERDICTS.has(verdict)) {
    v.push({
      file,
      pointer: at("verdict"),
      problem: `round-1 entry carries the round-2 verdict ${JSON.stringify(verdict)} (round-1 subset: keep-as-is|refine|rewrite|remove-or-merge|deferred)`,
    });
  } else if (round === 2 && !ROUND2_VERDICTS.has(verdict)) {
    v.push({
      file,
      pointer: at("verdict"),
      problem: `round-2 entry carries the round-1 verdict ${JSON.stringify(verdict)} (round-2 subset: adopt|defer|reject)`,
    });
  }

  if (!Array.isArray(obj.files)) {
    v.push({ file, pointer: at("files"), problem: "required array" });
  }

  if (
    !isNonEmptyString(obj.consent_tier) ||
    !CONSENT_TIERS.has(obj.consent_tier)
  ) {
    v.push({
      file,
      pointer: at("consent_tier"),
      problem: `must be "standard" or "s8-labeled"; got ${JSON.stringify(obj.consent_tier)}`,
    });
  }

  if (typeof obj.owner_consent !== "boolean") {
    v.push({
      file,
      pointer: at("owner_consent"),
      problem: `required boolean; got ${JSON.stringify(obj.owner_consent)}`,
    });
  }

  // Optional arrays: type-checked only when present.
  for (const key of ["accepted_suggestions", "rejected_suggestions", "concerns"]) {
    if (key in obj && obj[key] !== null && !Array.isArray(obj[key])) {
      v.push({
        file,
        pointer: at(key),
        problem: "must be an array when present",
      });
    }
  }

  // §0.6: pct_answers is required (non-null) when accepted_suggestions is
  // non-empty or round == 2, else null.
  const accepted = obj.accepted_suggestions;
  const needsPct =
    (Array.isArray(accepted) && accepted.length > 0) || round === 2;
  if (needsPct && (obj.pct_answers === undefined || obj.pct_answers === null)) {
    v.push({
      file,
      pointer: at("pct_answers"),
      problem:
        "required non-null when accepted_suggestions is non-empty or round == 2 (§0.6)",
    });
  }

  return v;
}

export interface LedgerReport {
  violations: Violation[];
  verdictCount: number;
  consentCount: number;
}

/**
 * Validate the full verdict-ledger.jsonl content. Blank lines are skipped
 * (trailing newline convention). Line numbers in pointers are 1-based.
 */
export function validateLedger(
  content: string,
  file: string = `${WORKSPACE_DIR_NAME}/${LEDGER_NAME}`,
): LedgerReport {
  const violations: Violation[] = [];
  let verdictCount = 0;
  let consentCount = 0;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const pointer = `line ${i + 1}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      violations.push({
        file,
        pointer,
        problem: `not valid JSON: ${(err as Error).message}`,
      });
      continue;
    }
    if (!isPlainObject(parsed)) {
      violations.push({
        file,
        pointer,
        problem: `ledger line must be a JSON object; got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      });
      continue;
    }

    const cls = classifyLedgerLine(parsed);
    if (cls === "consent") {
      consentCount += 1;
      continue;
    }
    if (cls === "unrecognized") {
      violations.push({
        file,
        pointer,
        problem:
          "matches neither the §0.6 verdict-entry shape (no id/verdict/round key) nor the §7.4 consent-record shape (no gate key)",
      });
      continue;
    }
    verdictCount += 1;
    violations.push(...validateVerdictEntry(parsed, pointer, file));
  }

  return { violations, verdictCount, consentCount };
}

export interface RunResult {
  violations: Violation[];
  /** Repo-relative paths that were validated. */
  checked: string[];
  /** Repo-relative paths (or the workspace dir) absent and skipped. */
  skipped: string[];
  verdictCount: number;
  consentCount: number;
}

export interface RunOptions {
  /** Repo root override for tests. Defaults to the checkout root. */
  rootDir?: string;
}

/** Read + validate both workspace-state targets under `<rootDir>/.evolve-workspace/`. */
export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const wsDir = join(rootDir, WORKSPACE_DIR_NAME);
  const result: RunResult = {
    violations: [],
    checked: [],
    skipped: [],
    verdictCount: 0,
    consentCount: 0,
  };

  if (!existsSync(wsDir)) {
    result.skipped.push(`${WORKSPACE_DIR_NAME}/`);
    return result;
  }

  const checkpointRel = `${WORKSPACE_DIR_NAME}/${CHECKPOINT_NAME}`;
  const checkpointAbs = join(wsDir, CHECKPOINT_NAME);
  if (!existsSync(checkpointAbs)) {
    result.skipped.push(checkpointRel);
  } else {
    result.checked.push(checkpointRel);
    const raw = await readFile(checkpointAbs, "utf-8");
    let parsed: unknown;
    let parseOk = true;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseOk = false;
      result.violations.push({
        file: checkpointRel,
        pointer: "(root)",
        problem: `not valid JSON: ${(err as Error).message}`,
      });
    }
    if (parseOk) {
      result.violations.push(...validateCheckpoint(parsed, checkpointRel));
    }
  }

  const ledgerRel = `${WORKSPACE_DIR_NAME}/${LEDGER_NAME}`;
  const ledgerAbs = join(wsDir, LEDGER_NAME);
  if (!existsSync(ledgerAbs)) {
    result.skipped.push(ledgerRel);
  } else {
    result.checked.push(ledgerRel);
    const content = await readFile(ledgerAbs, "utf-8");
    const report = validateLedger(content, ledgerRel);
    result.violations.push(...report.violations);
    result.verdictCount = report.verdictCount;
    result.consentCount = report.consentCount;
  }

  return result;
}

async function main(): Promise<void> {
  const result = await runValidator();

  if (result.checked.length === 0) {
    console.log(
      "validate:workspace-state: no workspace — nothing to validate " +
        `(${result.skipped.join(", ")} absent; .evolve-workspace/ is ephemeral + gitignored)`,
    );
    return;
  }

  for (const skipped of result.skipped) {
    console.log(
      `validate:workspace-state: ${skipped} absent — target skipped`,
    );
  }
  for (const checked of result.checked) {
    if (checked.endsWith(LEDGER_NAME)) {
      console.log(
        `validate:workspace-state: ${checked} — ${result.verdictCount} verdict entr${result.verdictCount === 1 ? "y" : "ies"} validated; ` +
          `${result.consentCount} consent-record line(s) (gate-keyed; no §0.6 schema — counted, not validated)`,
      );
    } else {
      console.log(`validate:workspace-state: ${checked} — validated`);
    }
  }

  if (result.violations.length === 0) {
    console.log("validate:workspace-state: 0 violations");
    return;
  }

  console.error(
    `validate:workspace-state: ${result.violations.length} violation(s):`,
  );
  for (const viol of result.violations) {
    console.error(`  ${viol.file} · ${viol.pointer} · ${viol.problem}`);
  }
  process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests
// (same is-main detector as scripts/validate-severity-vocabulary.ts).
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // The is-main detector defaults to "not main" if argument resolution
    // throws; that fallback path is the test-import path, so no diagnostic
    // channel applies (tests intentionally import this module).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-workspace-state failed:", err);
    process.exit(1);
  });
}
