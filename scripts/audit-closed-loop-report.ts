#!/usr/bin/env node
/**
 * scripts/audit-closed-loop-report.ts
 *
 * Derived view over the audit finding-registry's closed-loop fields. Turns the
 * per-finding `cl1_status`, `cl3_status`, and `sdr_status` columns — previously
 * discoverable only by reading the whole registry by hand — into a queryable
 * per-disposition summary. Adopted by AUDIT-EXECUTE.md Phase 5 (the "Cycle-N
 * CL-1 table populated" hard step) and the PRD §27 CL-1 disposition tables,
 * which assert their per-disposition counts match this report (D18-1 /
 * SA18.1-F1; the shared instrument named in D16-16 / D18-15). The CL-3 column
 * (audit self-evolution) is the D16-16 addition: CL-3 was previously tracked
 * only as ad-hoc top-level cycle keys, so per-proposal disposition was not
 * queryable — closed-loop-agents.md Phase 7 now writes `cl3_status` at
 * apply-time and this report surfaces it alongside CL-1.
 *
 * Pillars: P5 (Governance Self-Quality — closes the PRD-terminus closed loop),
 *          P2 (Scientific Quality — disposition is queried, not inferred),
 *          P7 (Speed & Token Efficiency — one read, not a full-registry scan).
 *
 * Usage:
 *   npm run audit:closed-loop                 # whole-registry CL-1 + SDR summary
 *   npm run audit:closed-loop -- --cycle 10   # restrict to cycle 10 entries
 *   npm run audit:closed-loop -- --cycle 10 --json   # machine-readable output
 *
 * The --cycle filter matches the registry `cycle` field loosely (string or
 * number; "7.5" and 7.5 both match `--cycle 7.5`).
 *
 * Exit:
 *   0 — report printed (also 0 when the registry is absent: the registry is
 *       private and not present in public/contributor clones, mirroring
 *       validate-finding-registry.ts; a notice is printed to stderr).
 *   1 — registry present but unreadable / unparseable.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRegistry,
  RegistryParseError,
  type Finding,
} from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "governance/audit/finding-registry.json");

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

interface CliOptions {
  cycle: string | null;
  json: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  const opts: CliOptions = { cycle: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--cycle") {
      opts.cycle = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--cycle=")) {
      opts.cycle = arg.slice("--cycle=".length);
    }
  }
  return opts;
}

/** Loose cycle match: a registry `cycle` of "10" or 10 both match `--cycle 10`. */
function cycleMatches(entry: Finding, wanted: string | null): boolean {
  if (wanted === null) return true;
  if (entry.cycle === undefined || entry.cycle === null) return false;
  return String(entry.cycle) === String(wanted);
}

interface DispositionTally {
  /** disposition value -> count */
  counts: Map<string, number>;
  /** disposition value -> finding ids carrying it */
  ids: Map<string, string[]>;
  total: number;
}

function tally(
  entries: ReadonlyArray<Finding>,
  field: "cl1_status" | "sdr_status" | "cl3_status",
): DispositionTally {
  const counts = new Map<string, number>();
  const ids = new Map<string, string[]>();
  let total = 0;
  for (const e of entries) {
    const value = e[field];
    // Skip absent and the inert `none` baseline — the report is about findings
    // that actually entered the closed loop, not the un-entered majority.
    if (typeof value !== "string" || value.length === 0 || value === "none") {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
    const list = ids.get(value) ?? [];
    list.push(typeof e.finding_id === "string" ? e.finding_id : "<no-id>");
    ids.set(value, list);
    total += 1;
  }
  return { counts, ids, total };
}

function renderTally(label: string, t: DispositionTally): string[] {
  const lines: string[] = [];
  lines.push(`${label}: ${t.total} finding(s) with a non-none disposition`);
  if (t.total === 0) {
    lines.push("  (none)");
    return lines;
  }
  const sorted = [...t.counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [disposition, count] of sorted) {
    lines.push(`  ${disposition}: ${count}`);
    const list = (t.ids.get(disposition) ?? []).slice().sort();
    lines.push(`    ${list.join(", ")}`);
  }
  return lines;
}

function tallyToJson(t: DispositionTally): Record<string, { count: number; ids: string[] }> {
  const out: Record<string, { count: number; ids: string[] }> = {};
  for (const [disposition, count] of t.counts) {
    out[disposition] = {
      count,
      ids: (t.ids.get(disposition) ?? []).slice().sort(),
    };
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // The finding registry is private and absent in public CI / contributor
  // clones. With nothing to read, print a notice and exit 0 rather than fail
  // the gate on the missing read (mirrors validate-finding-registry.ts).
  if (!existsSync(REGISTRY_PATH)) {
    emitError(
      "[audit-closed-loop-report] governance/audit/finding-registry.json absent — nothing to report",
    );
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(REGISTRY_PATH, "utf-8"));
  } catch (err) {
    emitError(
      `audit:closed-loop: failed to read or parse ${REGISTRY_PATH}: ${(err as Error).message}`,
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
      emitError(`audit:closed-loop: parse error: ${err.message}`);
    } else {
      emitError(`audit:closed-loop: unexpected error: ${(err as Error).message}`);
    }
    process.exit(1);
    return;
  }

  const scoped = entries.filter((e) => cycleMatches(e, opts.cycle));
  const cl1 = tally(scoped, "cl1_status");
  const cl3 = tally(scoped, "cl3_status");
  const sdr = tally(scoped, "sdr_status");
  const scopeLabel = opts.cycle === null ? "all cycles" : `cycle ${opts.cycle}`;

  if (opts.json) {
    emit(
      JSON.stringify(
        {
          scope: scopeLabel,
          entries_scanned: scoped.length,
          cl1: { total: cl1.total, by_disposition: tallyToJson(cl1) },
          cl3: { total: cl3.total, by_disposition: tallyToJson(cl3) },
          sdr: { total: sdr.total, by_disposition: tallyToJson(sdr) },
        },
        null,
        2,
      ),
    );
    return;
  }

  emit(`Closed-loop disposition report (${scopeLabel}, ${scoped.length} entries scanned)`);
  emit("");
  for (const line of renderTally("CL-1 (PRD evolution)", cl1)) emit(line);
  emit("");
  for (const line of renderTally("CL-3 (audit self-evolution)", cl3)) emit(line);
  emit("");
  for (const line of renderTally("SDR (strategic decision register)", sdr)) emit(line);
}

main().catch((err: unknown) => {
  emitError(`audit:closed-loop failed: ${(err as Error).message}`);
  process.exit(1);
});
