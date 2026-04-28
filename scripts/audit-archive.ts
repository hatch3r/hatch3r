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
 *   (default)   --dry-run: read + split + report; no file mutation.
 *   --in-place  apply: atomic write of archive file → atomic rewrite of live
 *               registry → atomic update of archive index → anchor-log rotation.
 *
 * Usage:
 *   npm run audit:archive                   # dry-run preview (Cycle from --cycle flag, required)
 *   npm run audit:archive -- --cycle 9      # dry-run for cycle 9
 *   npm run audit:archive -- --cycle 9 --in-place  # apply
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
  ArchiveError,
  type ArchivePaths,
  type ArchiveCycleResult,
} from "../src/audit/archive.js";
import { RegistryParseError } from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const PATHS: ArchivePaths = {
  registry: resolve(ROOT, "governance/audit/finding-registry.json"),
  archiveDir: resolve(ROOT, "governance/audit/archive"),
  archiveIndex: resolve(ROOT, "governance/audit/archive/index.json"),
  anchorLog: resolve(ROOT, ".audit-workspace/registry-anchor-log.jsonl"),
  anchorArchiveDir: resolve(ROOT, "governance/audit/archive"),
};

interface CliFlags {
  inPlace: boolean;
  cycle?: number;
  generatedAt?: string;
  baselineCommit?: string;
  headCommit?: string;
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  let inPlace = false;
  let cycle: number | undefined;
  let generatedAt: string | undefined;
  let baselineCommit: string | undefined;
  let headCommit: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in-place") inPlace = true;
    else if (arg === "--dry-run") inPlace = false;
    else if (arg === "--cycle") {
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
  return { inPlace, cycle, generatedAt, baselineCommit, headCommit };
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
  return [
    `audit:archive: ${inPlace ? "applied" : "dry-run"} for cycle ${cycle}`,
    `  archived:    ${result.archivedCount} entries`,
    `  lived:       ${result.livedCount} entries`,
    `  archive sha: ${result.archiveSha256}`,
    `  live sha:    ${result.liveSha256}`,
    `  archive →    ${result.archivePath}`,
  ].join("\n");
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
