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
    // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error(
      "[validate-finding-registry] governance/AUDIT-REPORT.md absent — skipping CL-row balance check (private file; expected in public clones)",
    );
    return null;
  }
  const cycle = cycleFlag ?? (await readCycleFromBaseline());
  if (cycle === null) {
    // eslint-disable-next-line no-console
    console.error(
      "[validate-finding-registry] cycle anchor unknown (no --cycle flag; baseline.json cycle unreadable) — skipping CL-row balance check",
    );
    return null;
  }
  let reportMd: string;
  try {
    reportMd = await readFile(REPORT_PATH, "utf-8");
  } catch (err) {
    // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.log(
      `validate:finding-registry: CL-row balance ok (cycle ${cycle}: ` +
        `CL-1 ${counts.cl1ReportRows}<->${countClRegistryEntries(entries, cycle, "CL-1")}, ` +
        `CL-3 ${counts.cl3ReportRows}<->${countClRegistryEntries(entries, cycle, "CL-3")})`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(
      `validate:finding-registry: CL-row balance invariant FAILED (cycle ${cycle})`,
    );
    for (const f of failures) {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.error(`validate:finding-registry: parse error: ${err.message}`);
    } else {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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

    // eslint-disable-next-line no-console
    console.error(
      `validate:finding-registry: ${drifts.length} drift on ${entryCount} entries (${modeLabel})`,
    );
    for (const [reason, list] of byReason) {
      // eslint-disable-next-line no-console
      console.error(`  ${reason}: ${list.length}`);
      // Show first 3 examples per reason; collapse the rest.
      const sample = list.slice(0, 3);
      for (const d of sample) {
        // eslint-disable-next-line no-console
        console.error(
          `    - ${d.finding_id}${d.detail ? `: ${d.detail}` : ""}`,
        );
      }
      if (list.length > sample.length) {
        // eslint-disable-next-line no-console
        console.error(`    ...and ${list.length - sample.length} more`);
      }
    }
  }

  // Second lane: CL-row balance invariant. Failures never join the tolerant
  // drift count above; they gate the exit code on their own.
  const balanceFailures = await runClBalance(entries, flags.cycle);

  if (drifts.length > 0 || (balanceFailures !== null && balanceFailures.length > 0)) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("validate:finding-registry failed:", err);
  process.exit(1);
});
