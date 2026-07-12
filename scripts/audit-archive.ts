#!/usr/bin/env node
/**
 * scripts/audit-archive.ts
 *
 * CLI wrapper around `src/audit/archive.ts::archiveCycle` and
 * `rotateAnchorLog`. Binds the archival pipeline to the canonical repo paths
 * and translates result/error into stdout output + exit code.
 *
 * Pillars: P4 (Lean Coverage), P5 (Governance Self-Quality), P7 (Speed).
 *
 * Modes:
 *   (default)     --dry-run: read + split + report; no file mutation.
 *   --in-place    apply: strict-accumulator close gate (D16-SA16.2-01) → atomic
 *                 write of archive file → atomic rewrite of live registry →
 *                 atomic update of archive index → anchor-log rotation →
 *                 history-currency gate → insights drift gate (validateInsights).
 *                 The strict-accumulator gate fails loudly (before any write)
 *                 when the current-cycle accumulator is absent, so a cycle's
 *                 telemetry is never silently lost at close; pass
 *                 --allow-missing-accumulator to archive without promotion.
 *   --list        enumerate cycle-N archive files (descending), no mutation.
 *   --cold-pack   gzip-bundle older cycle archives under archive/cold/, keeping
 *                 the `--keep <N>` newest loose (default 2; preservation-first —
 *                 originals are removed only after the bundle round-trip verifies).
 *
 * Usage:
 *   npm run audit:archive                   # dry-run preview (Cycle from --cycle flag, required)
 *   npm run audit:archive -- --cycle 9      # dry-run for cycle 9
 *   npm run audit:archive -- --cycle 9 --in-place  # apply
 *   npm run audit:archive -- --list                # enumerate archives
 *   npm run audit:archive -- --cold-pack --keep 3  # bundle all but the 3 newest
 *
 * D1-SA1.7-04 (Cycle 12 Wave 3, D1, P5): `--list`, `--cold-pack`, and the
 * insights drift gate wire the three previously consumer-less exports
 * (`enumerateAuditArchives`, `coldPackAuditArchives`, `validateInsights`) onto
 * the live script path — closing the checklist-1.7.5 "every exported surface
 * has a script consumer" gap without de-exporting tested library code.
 *
 * Phase-3 limitation: `audit:reset` (the workspace cleanup script) ships in
 * Phase 5. Until then, the script prints a reminder to clean `.audit-workspace/`
 * manually if needed — it does NOT delete the workspace itself.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  archiveCycle,
  rotateAnchorLog,
  assertHistoryCurrent,
  enumerateAuditArchives,
  coldPackAuditArchives,
  ArchiveError,
  type ArchivePaths,
  type ArchiveCycleResult,
} from "../src/audit/archive.js";
import { readInsights, validateInsights } from "../src/audit/insights.js";
import { RegistryParseError } from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const INSIGHTS_FILE = resolve(ROOT, "governance/audit/execution-insights.json");

const PATHS: ArchivePaths = {
  registry: resolve(ROOT, "governance/audit/finding-registry.json"),
  archiveDir: resolve(ROOT, "governance/audit/archive"),
  archiveIndex: resolve(ROOT, "governance/audit/archive/index.json"),
  anchorLog: resolve(ROOT, ".audit-workspace/registry-anchor-log.jsonl"),
  anchorArchiveDir: resolve(ROOT, "governance/audit/archive"),
  // Wiring both insights paths makes `archiveCycle` drive the ring-buffer
  // promotion at cycle close (D16-8). Previously omitted, which is why the
  // Cycle-10 accumulator was never promoted into history[].
  insightsFile: INSIGHTS_FILE,
  currentInsightsFile: resolve(ROOT, ".audit-workspace/current-insights.json"),
};

interface CliFlags {
  inPlace: boolean;
  cycle?: number;
  generatedAt?: string;
  baselineCommit?: string;
  headCommit?: string;
  /** Enumerate cycle archives (read-only standalone mode; D1-SA1.7-04). */
  list: boolean;
  /** Cold-pack older cycle archives (standalone mode; D1-SA1.7-04). */
  coldPack: boolean;
  /** Loose archives to keep in --cold-pack mode (default 2). */
  keep: number;
  /**
   * Opt out of the strict-accumulator close gate (D16-SA16.2-01). By default an
   * `--in-place` close fails loudly when the current-cycle accumulator is
   * absent; this flag archives without promotion instead (the rare legitimate
   * close of a cycle that produced no accumulator).
   */
  allowMissingAccumulator: boolean;
}

/** Default loose-archive count for `--cold-pack` when `--keep` is omitted. */
const DEFAULT_COLD_PACK_KEEP = 2;

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  let inPlace = false;
  let cycle: number | undefined;
  let generatedAt: string | undefined;
  let baselineCommit: string | undefined;
  let headCommit: string | undefined;
  let list = false;
  let coldPack = false;
  let keep = DEFAULT_COLD_PACK_KEEP;
  let allowMissingAccumulator = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in-place") inPlace = true;
    else if (arg === "--dry-run") inPlace = false;
    else if (arg === "--allow-missing-accumulator") allowMissingAccumulator = true;
    else if (arg === "--list") list = true;
    else if (arg === "--cold-pack") coldPack = true;
    else if (arg === "--keep") {
      const next = argv[i + 1];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--keep requires a positive integer argument; got "${next}"`);
      }
      keep = n;
      i += 1;
    } else if (arg === "--cycle") {
      const next = argv[i + 1];
      const n = Number(next);
      if (!Number.isFinite(n)) {
        throw new Error(`--cycle requires a numeric argument; got "${next}"`);
      }
      cycle = n;
      i += 1;
    } else if (arg === "--generated-at") {
      generatedAt = argv[i + 1];
      i += 1;
    } else if (arg === "--baseline-commit") {
      baselineCommit = argv[i + 1];
      i += 1;
    } else if (arg === "--head-commit") {
      headCommit = argv[i + 1];
      i += 1;
    }
  }
  return {
    inPlace,
    cycle,
    generatedAt,
    baselineCommit,
    headCommit,
    list,
    coldPack,
    keep,
    allowMissingAccumulator,
  };
}

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

function formatPlan(
  result: ArchiveCycleResult,
  cycle: number,
  inPlace: boolean,
): string {
  const lines = [
    `audit:archive: ${inPlace ? "applied" : "dry-run"} for cycle ${cycle}`,
    `  archived:    ${result.archivedCount} entries`,
    `  lived:       ${result.livedCount} entries`,
    `  archive sha: ${result.archiveSha256}`,
    `  live sha:    ${result.liveSha256}`,
    `  archive →    ${result.archivePath}`,
  ];
  if (result.insightsPromoted !== undefined) {
    lines.push(
      `  insights:    ${result.insightsPromoted ? "promoted accumulator → history[]" : "no promotion (current-insights.json absent)"}`,
    );
  }
  return lines.join("\n");
}

/**
 * `--list` mode (D1-SA1.7-04): enumerate cycle-N archive files, newest cycle
 * first. Read-only — nothing is mutated. Wires `enumerateAuditArchives`.
 */
async function runList(): Promise<void> {
  const { kept } = await enumerateAuditArchives(PATHS);
  if (kept.length === 0) {
    emit("audit:archive --list: no cycle archives found");
    return;
  }
  emit(`audit:archive --list: ${kept.length} cycle archive(s) (newest first)`);
  for (const name of kept) {
    emit(`  ${name}`);
  }
}

/**
 * `--cold-pack` mode (D1-SA1.7-04): bundle all but the `keep` newest cycle
 * archives into a gzipped JSON bundle under `archive/cold/`. Preservation-
 * first — `coldPackAuditArchives` deletes loose originals only after the
 * bundle round-trip verifies byte-identical content.
 */
async function runColdPack(keep: number): Promise<void> {
  const result = await coldPackAuditArchives(PATHS, { keep });
  emit(`audit:archive --cold-pack: kept ${result.kept.length} loose, packed ${result.coldArchived.length}`);
  for (const name of result.kept) {
    emit(`  kept:   ${name}`);
  }
  for (const name of result.coldArchived) {
    emit(`  packed: ${name}`);
  }
  if (result.bundlePath) {
    emit(`  bundle: ${result.bundlePath}`);
  } else {
    emit(`  (nothing to pack — ${result.kept.length} archive(s) ≤ keep=${keep})`);
  }
}

async function main(): Promise<void> {
  let flags: CliFlags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (err) {
    emitError(`audit:archive: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  // Standalone archive-maintenance modes (no --cycle required).
  if (flags.list) {
    try {
      await runList();
    } catch (err) {
      emitError(`audit:archive --list failed: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }
  if (flags.coldPack) {
    try {
      await runColdPack(flags.keep);
    } catch (err) {
      emitError(`audit:archive --cold-pack failed: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (flags.cycle === undefined) {
    emitError(
      "audit:archive: --cycle <N> is required. Example: npm run audit:archive -- --cycle 9",
    );
    process.exit(1);
    return;
  }

  let result: ArchiveCycleResult;
  try {
    result = await archiveCycle({
      paths: PATHS,
      cycle: flags.cycle,
      dryRun: !flags.inPlace,
      generatedAt: flags.generatedAt,
      baselineCommit: flags.baselineCommit,
      headCommit: flags.headCommit,
      // Strict-accumulator close gate (D16-SA16.2-01): a real `--in-place` close
      // fails loudly when the current-cycle accumulator is missing, unless the
      // operator explicitly opts out. Dry-run previews never carry the gate.
      strictAccumulator: flags.inPlace && !flags.allowMissingAccumulator,
    });
  } catch (err) {
    if (err instanceof ArchiveError || err instanceof RegistryParseError) {
      emitError(`audit:archive: ${err.message}`);
    } else {
      emitError(`audit:archive: unexpected error: ${(err as Error).message}`);
    }
    process.exit(1);
    return;
  }

  emit(formatPlan(result, flags.cycle, flags.inPlace));

  // Surface non-fatal diagnostics (e.g. an accumulator missing the
  // forward-looking cl2_artifact_closure field) without failing the run.
  for (const w of result.warnings ?? []) {
    emit(`  warning:     ${w}`);
  }

  if (flags.inPlace) {
    try {
      const rot = await rotateAnchorLog(PATHS, flags.cycle);
      if (rot.rotatedTo) {
        emit(`anchor log:    rolled older entries → ${rot.rotatedTo}`);
        emit(`               kept ${rot.keptCount} live entries`);
      } else {
        emit(`anchor log:    no rotation needed (${rot.keptCount} kept)`);
      }
    } catch (err) {
      emitError(
        `audit:archive: anchor-log rotation failed: ${(err as Error).message}`,
      );
      process.exit(1);
      return;
    }

    // Cycle-close currency gate (D16-8 / SA16.2-F3): after promotion, the
    // newest history entry MUST be the cycle that just closed (current-1).
    // A stale or empty ring is a hard failure — it is the exact drift this
    // gate exists to catch (a cycle-7-only ring after cycles 9/10 executed).
    try {
      const currency = await assertHistoryCurrent(INSIGHTS_FILE, flags.cycle);
      if (!currency.current) {
        emitError(`audit:archive: history-currency gate FAILED: ${currency.reason}`);
        process.exit(1);
        return;
      }
      emit(
        `history gate:  PASS (newest history entry is cycle ${currency.lastCycle} = current-1)`,
      );
    } catch (err) {
      emitError(
        `audit:archive: history-currency gate error: ${(err as Error).message}`,
      );
      process.exit(1);
      return;
    }

    // Insights drift gate (D1-SA1.7-04): re-read the ring the promotion just
    // wrote and run `validateInsights` on the LIVE path — version + length
    // invariants (schema_version, history ≤ HISTORY_MAX, entry shape). Drift
    // here means the promotion produced a malformed ring; failing the run
    // surfaces it at cycle close instead of at the next cycle's parse.
    try {
      const ring = await readInsights({
        insightsFile: INSIGHTS_FILE,
        currentFile: resolve(ROOT, ".audit-workspace/current-insights.json"),
      });
      const drift = validateInsights(ring);
      if (drift.length > 0) {
        for (const report of drift) {
          emitError(`audit:archive: insights drift: ${report.reason} — ${report.detail}`);
        }
        process.exit(1);
        return;
      }
      emit("insights gate: PASS (0 drift reports)");
    } catch (err) {
      emitError(
        `audit:archive: insights drift gate error: ${(err as Error).message}`,
      );
      process.exit(1);
      return;
    }

    emit("");
    emit(
      "note: workspace cleanup runs in Phase 5 (audit:reset, not yet shipped); for now manually clean .audit-workspace/ if needed",
    );
  } else {
    emit("");
    emit("(dry-run; no files modified — re-run with --in-place to apply)");
  }
}

main().catch((err: unknown) => {
  emitError(`audit:archive failed: ${(err as Error).message}`);
  process.exit(1);
});
