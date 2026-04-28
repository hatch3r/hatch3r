#!/usr/bin/env node
/**
 * scripts/migrate-finding-registry.ts
 *
 * CLI wrapper around `src/audit/migrate.ts::runMigration`. Binds the migration
 * to the canonical repo paths and translates result/error into stdout output
 * + exit code.
 *
 * Pillars: P2, P5, P7. See `src/audit/migrate.ts` for migration semantics.
 *
 * Modes:
 *   (default)   --dry-run: read + migrate + report; no file mutation.
 *   --in-place  apply the migration. Atomic write through safeWrite. Preserves
 *               original at finding-registry.legacy.json. Appends anchor log
 *               entry. Writes report to .audit-workspace/.
 *
 * Usage:
 *   npm run audit:migrate                  # dry-run preview
 *   npm run audit:migrate -- --in-place    # actually migrate
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runMigration,
  summarizeStats,
  previewEntries,
  MigrationError,
  type MigrationResult,
} from "../src/audit/migrate.js";
import { RegistryParseError } from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const PATHS = {
  registry: resolve(ROOT, "governance/audit/finding-registry.json"),
  legacyPreserve: resolve(ROOT, "governance/audit/finding-registry.legacy.json"),
  anchorLog: resolve(ROOT, ".audit-workspace/registry-anchor-log.jsonl"),
  report: resolve(ROOT, ".audit-workspace/registry-migration-report.md"),
};

interface CliFlags {
  inPlace: boolean;
  generatedAt?: string;
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  let inPlace = false;
  let generatedAt: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in-place") inPlace = true;
    else if (arg === "--dry-run") inPlace = false;
    else if (arg === "--generated-at") {
      generatedAt = argv[i + 1];
      i += 1;
    }
  }
  return { inPlace, generatedAt };
}

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  let result: MigrationResult | null;
  try {
    result = await runMigration({
      paths: PATHS,
      inPlace: flags.inPlace,
      generatedAt: flags.generatedAt,
    });
  } catch (err) {
    if (err instanceof MigrationError || err instanceof RegistryParseError) {
      emitError(`audit:migrate: ${err.message}`);
    } else {
      emitError(`audit:migrate: unexpected error: ${(err as Error).message}`);
    }
    process.exit(1);
    return;
  }

  if (result === null) {
    emit("audit:migrate: registry already v2; no-op");
    return;
  }

  const mode = flags.inPlace ? "applied" : "dry-run";
  emit(
    `audit:migrate: ${mode} — ${result.preCount} → ${result.postCount} entries (v1 → v2)`,
  );
  emit(`pre-sha256:  ${result.preSha}`);
  emit(`post-sha256: ${result.postSha}`);
  emit("");
  emit(summarizeStats(result.stats));
  emit("");
  emit(previewEntries("Pre  (v1 sample)", result.preEntries));
  emit("");
  emit(previewEntries("Post (v2 sample)", result.postRegistry.entries));
  if (flags.inPlace) {
    emit("");
    emit(`legacy preserved at: ${PATHS.legacyPreserve}`);
    emit(`migration report:    ${PATHS.report}`);
    emit(`anchor log:          ${PATHS.anchorLog}`);
  } else {
    emit("");
    emit(
      "(dry-run; no files modified — re-run with --in-place to apply)",
    );
  }
}

main().catch((err: unknown) => {
  emitError(`audit:migrate failed: ${(err as Error).message}`);
  process.exit(1);
});
