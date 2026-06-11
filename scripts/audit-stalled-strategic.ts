#!/usr/bin/env node
/**
 * scripts/audit-stalled-strategic.ts
 *
 * The strategic-stall forcing function named — but until D16-6 never built —
 * by AUDIT-EXECUTE.md Phase 0 step 6 ("Stalled-strategic-decision report
 * (F16.2-C1)"). Thin filesystem wrapper around the pure core in
 * `src/audit/stalled-strategic.ts` (the migrate.ts / migrate-finding-registry.ts
 * split): scans the live finding-registry for STRATEGIC findings unresolved
 * for >= 3 cycles and writes `.audit-workspace/stalled-strategic-report.md` so
 * the two-speed closure gap (high tactical Wave 1-2 rate vs near-zero strategic
 * CL-2/CL-3 rate) is surfaced at cycle start instead of by hand-reading the
 * registry. "Strategic", "stalled", and the report layout are defined in the
 * core module.
 *
 * The current cycle is read from governance/audit/baseline.json (`cycle`),
 * overridable with --current-cycle <n> for deterministic invocation.
 *
 * Pillars: P5 (Governance Self-Quality — closes the forcing-function gap that
 *          let F16.2-C1 be marked done without the mechanism existing),
 *          P2 (Scientific Quality), P7 (Speed & Token Efficiency).
 *
 * Usage:
 *   npm run audit:stalled                        # report at default threshold (3)
 *   npm run audit:stalled -- --current-cycle 11  # pin the current cycle
 *   npm run audit:stalled -- --threshold 2       # widen the stall window
 *   npm run audit:stalled -- --json              # machine-readable to stdout
 *   npm run audit:stalled -- --stdout            # write the report to stdout, not the file
 *
 * Exit:
 *   0 — report written (also 0 when the registry is absent: it is private and
 *       not present in public/contributor clones, mirroring
 *       validate-finding-registry.ts; a notice is printed to stderr).
 *   1 — registry present but unreadable / unparseable, or the report file
 *       could not be written.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRegistry,
  RegistryParseError,
  type Finding,
} from "../src/audit/registry-schema.js";
import {
  findStalledStrategic,
  renderReport,
  toCycleNumber,
  STALL_THRESHOLD_CYCLES,
} from "../src/audit/stalled-strategic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "governance/audit/finding-registry.json");
const BASELINE_PATH = resolve(ROOT, "governance/audit/baseline.json");
const REPORT_PATH = resolve(ROOT, ".audit-workspace/stalled-strategic-report.md");

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

interface CliOptions {
  currentCycle: number | null;
  threshold: number;
  json: boolean;
  stdout: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  const opts: CliOptions = {
    currentCycle: null,
    threshold: STALL_THRESHOLD_CYCLES,
    json: false,
    stdout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--stdout") {
      opts.stdout = true;
    } else if (arg === "--current-cycle") {
      opts.currentCycle = toCycleNumber(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--current-cycle=")) {
      opts.currentCycle = toCycleNumber(arg.slice("--current-cycle=".length));
    } else if (arg === "--threshold") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n)) opts.threshold = n;
      i += 1;
    } else if (arg.startsWith("--threshold=")) {
      const n = Number(arg.slice("--threshold=".length));
      if (Number.isFinite(n)) opts.threshold = n;
    }
  }
  return opts;
}

/** Read baseline.json `cycle` as the current-cycle anchor; null when unavailable. */
async function readCurrentCycleFromBaseline(): Promise<number | null> {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = JSON.parse(await readFile(BASELINE_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
    return toCycleNumber(raw.cycle);
  } catch (err) {
    // A malformed baseline is non-fatal here — the report degrades to
    // "unknown" current cycle rather than failing the whole run.
    emitError(
      `audit:stalled: baseline.json unreadable, current cycle unknown: ${(err as Error).message}`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // The finding registry is private and absent in public CI / contributor
  // clones. With nothing to read, print a notice and exit 0 rather than fail
  // the gate on the missing read (mirrors validate-finding-registry.ts).
  if (!existsSync(REGISTRY_PATH)) {
    emitError(
      "[audit-stalled-strategic] governance/audit/finding-registry.json absent — nothing to report",
    );
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(REGISTRY_PATH, "utf-8"));
  } catch (err) {
    emitError(
      `audit:stalled: failed to read or parse ${REGISTRY_PATH}: ${(err as Error).message}`,
    );
    process.exit(1);
    return;
  }

  let entries: ReadonlyArray<Finding>;
  try {
    const parsed = parseRegistry(raw);
    entries = parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;
  } catch (err) {
    if (err instanceof RegistryParseError) {
      emitError(`audit:stalled: parse error: ${err.message}`);
    } else {
      emitError(`audit:stalled: unexpected error: ${(err as Error).message}`);
    }
    process.exit(1);
    return;
  }

  const currentCycle =
    opts.currentCycle ?? (await readCurrentCycleFromBaseline());
  const rows = findStalledStrategic(entries, currentCycle, opts.threshold);

  if (opts.json) {
    emit(
      JSON.stringify(
        {
          current_cycle: currentCycle,
          threshold: opts.threshold,
          stalled_count: rows.length,
          stalled: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  const generatedAt = new Date().toISOString();
  const report = renderReport(rows, currentCycle, opts.threshold, generatedAt);

  if (opts.stdout) {
    emit(report);
  } else {
    try {
      await mkdir(dirname(REPORT_PATH), { recursive: true });
      await writeFile(REPORT_PATH, report, "utf-8");
    } catch (err) {
      emitError(
        `audit:stalled: failed to write ${REPORT_PATH}: ${(err as Error).message}`,
      );
      process.exit(1);
      return;
    }
    emitError(
      `audit:stalled: ${rows.length} stalled strategic finding(s) — wrote ${REPORT_PATH}`,
    );
  }
}

main().catch((err: unknown) => {
  emitError(`audit:stalled failed: ${(err as Error).message}`);
  process.exit(1);
});
