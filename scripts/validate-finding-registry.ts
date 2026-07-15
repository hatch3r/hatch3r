#!/usr/bin/env node
/**
 * scripts/validate-finding-registry.ts
 *
 * Enforces structural and Invariant 1-7 contracts on
 * `governance/audit/finding-registry.json`. The script wraps the pure
 * validators in `src/audit/registry-schema.ts` and emits exit code 0 on
 * clean / 1 on drift.
 *
 * Pillars: P2 (Scientific Quality), P5 (Governance Self-Quality).
 *
 * Modes:
 *   (default)   legacy-tolerant: pre-rigor-contract entries permitted.
 *   --strict    strict mode: full rigor contract enforced; v2 envelope required.
 *   --post-phase2  also require work_unit + wave on every targeted entry.
 *   --cycle <n>    pin the cycle for the CL-row balance invariant (default:
 *                  governance/audit/baseline.json `cycle`).
 *
 * CL-row balance invariant (Cycle-12 CL-3 Proposal 6c): when BOTH the registry
 * AND governance/AUDIT-REPORT.md are readable, each Phase CL-1 / CL-3 table
 * row must be materialized as a `C<cycle>-CL{1,3}-<n>` registry entry. The
 * report is private (absent in public clones) — absent report or unknown cycle
 * skips the check with a notice, mirroring the absent-registry convention.
 * Balance failures print as their own lane (never added to the tolerant drift
 * count) and force exit 1.
 *
 * S12-F2 invariant lane (EVOLVE run a2a16b59 validator-sync manifest): three
 * always-on structural invariants over every entry, in their own lane like
 * CL-row balance (never added to the tolerant drift count; failures force
 * exit 1). Field vocabularies derived from `src/audit/registry-schema.ts`
 * (Severity / Disposition / ExecutionStatus unions) + the live corpus
 * (2026-07-15 profile: dispositions {targeted, excluded, human_only,
 * phase_5_candidate, rollover}; execution_status {pending, done, partial,
 * deferred, never_attempted}):
 *
 *   (a) severity ∈ {Critical, High, Medium, Low, Info}. The two
 *       rollover-summary dispositions (`rollover`, `partially_promoted`) may
 *       instead carry an aggregate `<Sev>+<Sev>` (sanctioned by
 *       registry-schema.ts's AGGREGATE_SEVERITY_RE) — this lane additionally
 *       requires every aggregate COMPONENT to be a 5-enum member, which the
 *       shape-only regex does not check.
 *   (b) an OPEN finding must carry a non-null, non-empty `cycle`. Open =
 *       execution_status undefined or "pending" — the open/terminal split
 *       defined by `src/audit/archive.ts::isLiveEntry`.
 *   (c) a TERMINAL disposition ⇒ a terminal execution_status. Terminal
 *       dispositions (routing concluded): {excluded, human_only,
 *       already_resolved, deferred, deferred_cycle10, multi_cycle_deferred,
 *       external_blocker, phase_5_candidate}. Active dispositions (exempt):
 *       {targeted (in-flight work class), rollover, partially_promoted (live
 *       rollover stubs per archive.ts::isLiveEntry)}. Terminal
 *       execution_status = everything except undefined/"pending": {done,
 *       partial, failed, rolled_back, never_attempted, already_resolved,
 *       deferred}.
 *
 * Usage: `npm run audit:validate-registry [-- --strict] [-- --post-phase2] [-- --cycle 12]`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkClBalance,
  countClRegistryEntries,
  countClReportRows,
  parseRegistry,
  validateRegistry,
  RegistryParseError,
  type DriftReport,
  type Finding,
  type ValidateOptions,
} from "../src/audit/registry-schema.js";
import { toCycleNumber } from "../src/audit/stalled-strategic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "governance/audit/finding-registry.json");
const REPORT_PATH = resolve(ROOT, "governance/AUDIT-REPORT.md");
const BASELINE_PATH = resolve(ROOT, "governance/audit/baseline.json");

interface CliFlags {
  validate: ValidateOptions;
  cycle: number | null;
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  const flags: CliFlags = { validate: {}, cycle: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") flags.validate.strict = true;
    else if (arg === "--post-phase2") flags.validate.postPhase2 = true;
    else if (arg === "--cycle") {
      flags.cycle = toCycleNumber(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--cycle=")) {
      flags.cycle = toCycleNumber(arg.slice("--cycle=".length));
    }
  }
  return flags;
}

// ── S12-F2 invariant lane ───────────────────────────────────────────
// Derived sets — see the header block for the derivation basis.

/** The 5-severity enum (mirrors registry-schema.ts `Severity`). */
export const SEVERITY_ENUM: ReadonlySet<string> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Info",
]);

/**
 * Dispositions sanctioned to carry an aggregate `<Sev>+<Sev>` severity
 * (mirrors registry-schema.ts `ROLLOVER_SUMMARY_DISPOSITIONS`).
 */
export const ROLLOVER_SUMMARY_DISPOSITIONS: ReadonlySet<string> = new Set([
  "rollover",
  "partially_promoted",
]);

/**
 * Dispositions that conclude a finding's routing. The complement of the
 * active set {targeted, rollover, partially_promoted} over the
 * registry-schema.ts `Disposition` union.
 */
export const TERMINAL_DISPOSITIONS: ReadonlySet<string> = new Set([
  "excluded",
  "human_only",
  "already_resolved",
  "deferred",
  "deferred_cycle10",
  "multi_cycle_deferred",
  "external_blocker",
  "phase_5_candidate",
]);

/**
 * True when the entry is OPEN per `src/audit/archive.ts::isLiveEntry`:
 * execution_status undefined or "pending". Every other value is terminal.
 */
export function isOpenStatus(executionStatus: unknown): boolean {
  return executionStatus === undefined || executionStatus === "pending";
}

/**
 * S12-F2 invariants (a)–(c). Pure over the entry list; returns one
 * DriftReport per violation with an `S12-F2{a,b,c}` reason prefix.
 */
export function checkS12Invariants(
  entries: ReadonlyArray<Finding>,
): DriftReport[] {
  const reports: DriftReport[] = [];
  for (let i = 0; i < entries.length; i++) {
    const f = entries[i];
    const id =
      typeof f.finding_id === "string" && f.finding_id.length > 0
        ? f.finding_id
        : `<index ${i}>`;

    // (a) severity ∈ 5-enum; rollover summaries may carry an aggregate whose
    // every component is a 5-enum member.
    const sev = f.severity as unknown;
    if (typeof sev !== "string" || !SEVERITY_ENUM.has(sev)) {
      const isRolloverSummary =
        typeof f.disposition === "string" &&
        ROLLOVER_SUMMARY_DISPOSITIONS.has(f.disposition);
      const aggregateOk =
        isRolloverSummary &&
        typeof sev === "string" &&
        sev.includes("+") &&
        sev.split("+").every((part) => SEVERITY_ENUM.has(part));
      if (!aggregateOk) {
        reports.push({
          finding_id: id,
          reason: "S12-F2a severity outside 5-enum",
          detail: `got ${JSON.stringify(sev)}; expected Critical|High|Medium|Low|Info${isRolloverSummary ? " or an aggregate of those (rollover summary)" : ""}`,
        });
      }
    }

    // (b) open ⇒ cycle non-null (and non-empty when a string).
    if (isOpenStatus(f.execution_status)) {
      const cycle = f.cycle as unknown;
      if (cycle === undefined || cycle === null || cycle === "") {
        reports.push({
          finding_id: id,
          reason: "S12-F2b open finding without cycle",
          detail: `execution_status ${JSON.stringify(f.execution_status)} is open, but cycle is ${JSON.stringify(cycle)}`,
        });
      }
    }

    // (c) terminal disposition ⇒ terminal execution_status.
    if (
      typeof f.disposition === "string" &&
      TERMINAL_DISPOSITIONS.has(f.disposition) &&
      isOpenStatus(f.execution_status)
    ) {
      reports.push({
        finding_id: id,
        reason: "S12-F2c terminal disposition with open status",
        detail: `disposition "${f.disposition}" concludes routing, but execution_status is ${JSON.stringify(f.execution_status)} (open)`,
      });
    }
  }
  return reports;
}

/** Read baseline.json `cycle` as the cycle anchor; null when unavailable. */
async function readCycleFromBaseline(): Promise<number | null> {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = JSON.parse(await readFile(BASELINE_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
    return toCycleNumber(raw.cycle);
  } catch (err) {
    // Non-fatal: the caller degrades to "skip the balance check with a
    // notice", but the read failure itself must still be visible.
     
    console.error(
      `[validate-finding-registry] baseline.json unreadable, cycle anchor unknown: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * CL-row balance lane. Returns the failure list, or null when the check was
 * skipped (private report absent / cycle anchor unknown) — a skip is not a
 * pass and not a failure, matching the absent-registry exit-0 convention.
 */
async function runClBalance(
  entries: ReadonlyArray<Finding>,
  cycleFlag: number | null,
): Promise<DriftReport[] | null> {
  if (!existsSync(REPORT_PATH)) {
     
    console.error(
      "[validate-finding-registry] governance/AUDIT-REPORT.md absent — skipping CL-row balance check (private file; expected in public clones)",
    );
    return null;
  }
  const cycle = cycleFlag ?? (await readCycleFromBaseline());
  if (cycle === null) {
     
    console.error(
      "[validate-finding-registry] cycle anchor unknown (no --cycle flag; baseline.json cycle unreadable) — skipping CL-row balance check",
    );
    return null;
  }
  let reportMd: string;
  try {
    reportMd = await readFile(REPORT_PATH, "utf-8");
  } catch (err) {
     
    console.error(
      `[validate-finding-registry] AUDIT-REPORT.md unreadable — skipping CL-row balance check: ${(err as Error).message}`,
    );
    return null;
  }
  const counts = {
    cl1ReportRows: countClReportRows(reportMd, "CL-1"),
    cl3ReportRows: countClReportRows(reportMd, "CL-3"),
  };
  const failures = checkClBalance(entries, cycle, counts);
  if (failures.length === 0) {
     
    console.log(
      `validate:finding-registry: CL-row balance ok (cycle ${cycle}: ` +
        `CL-1 ${counts.cl1ReportRows}<->${countClRegistryEntries(entries, cycle, "CL-1")}, ` +
        `CL-3 ${counts.cl3ReportRows}<->${countClRegistryEntries(entries, cycle, "CL-3")})`,
    );
  } else {
     
    console.error(
      `validate:finding-registry: CL-row balance invariant FAILED (cycle ${cycle})`,
    );
    for (const f of failures) {
       
      console.error(`  ${f.reason}: ${f.detail}`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  // The finding registry is private and absent in public CI / contributor
  // clones. With nothing to validate, print a notice and exit 0 rather than
  // fail the gate on the missing read.
  if (!existsSync(REGISTRY_PATH)) {
     
    console.error(
      "[validate-finding-registry] governance/audit/finding-registry.json absent — skipping finding-registry drift check",
    );
    return;
  }

  let raw: unknown;
  try {
    const content = await readFile(REGISTRY_PATH, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
     
    console.error(
      `validate:finding-registry: failed to read or parse ${REGISTRY_PATH}: ${(err as Error).message}`,
    );
    process.exit(1);
    return;
  }

  let parsed;
  try {
    parsed = parseRegistry(raw);
  } catch (err) {
    if (err instanceof RegistryParseError) {
       
      console.error(`validate:finding-registry: parse error: ${err.message}`);
    } else {
       
      console.error(
        `validate:finding-registry: unexpected error: ${(err as Error).message}`,
      );
    }
    process.exit(1);
    return;
  }

  const drifts: DriftReport[] = validateRegistry(parsed, flags.validate);
  const entries =
    parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;
  const entryCount = entries.length;
  const modeLabel = [
    parsed.kind === "v2" ? "v2" : "legacy-v1",
    flags.validate.strict ? "strict" : "tolerant",
    flags.validate.postPhase2 ? "post-phase-2" : "phase-1",
  ].join(", ");

  if (drifts.length === 0) {
     
    console.log(
      `validate:finding-registry: ${entryCount} entries checked (${modeLabel}), 0 drift`,
    );
  } else {
    // Group by reason for a compact CI-readable summary.
    const byReason = new Map<string, DriftReport[]>();
    for (const d of drifts) {
      const list = byReason.get(d.reason) ?? [];
      list.push(d);
      byReason.set(d.reason, list);
    }

     
    console.error(
      `validate:finding-registry: ${drifts.length} drift on ${entryCount} entries (${modeLabel})`,
    );
    for (const [reason, list] of byReason) {
       
      console.error(`  ${reason}: ${list.length}`);
      // Show first 3 examples per reason; collapse the rest.
      const sample = list.slice(0, 3);
      for (const d of sample) {
         
        console.error(
          `    - ${d.finding_id}${d.detail ? `: ${d.detail}` : ""}`,
        );
      }
      if (list.length > sample.length) {
         
        console.error(`    ...and ${list.length - sample.length} more`);
      }
    }
  }

  // Second lane: CL-row balance invariant. Failures never join the tolerant
  // drift count above; they gate the exit code on their own.
  const balanceFailures = await runClBalance(entries, flags.cycle);

  // Third lane: S12-F2 invariants (always-on; own lane like CL-row balance).
  const s12Failures = checkS12Invariants(entries);
  if (s12Failures.length === 0) {
     
    console.log(
      "validate:finding-registry: S12-F2 invariants ok (severity 5-enum · open⇒cycle · terminal-disposition⇒terminal-status)",
    );
  } else {
     
    console.error(
      `validate:finding-registry: S12-F2 invariants FAILED (${s12Failures.length} violation(s))`,
    );
    for (const f of s12Failures) {
       
      console.error(`  ${f.reason}: ${f.finding_id}: ${f.detail}`);
    }
  }

  if (
    drifts.length > 0 ||
    (balanceFailures !== null && balanceFailures.length > 0) ||
    s12Failures.length > 0
  ) {
    process.exit(1);
  }
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
  main().catch((err: unknown) => {
     
    console.error("validate:finding-registry failed:", err);
    process.exit(1);
  });
}
