/**
 * src/audit/migrate.ts
 *
 * I/O orchestration for the one-shot v1→v2 finding-registry migration.
 * Pure migration logic lives in `registry-schema.ts::migrate`; this module
 * adds atomic file writes, legacy preservation, anchor-log chain-of-custody,
 * and human-readable report generation.
 *
 * Exposed so the migration can be unit-tested under vitest with temp paths,
 * separate from the `scripts/migrate-finding-registry.ts` CLI wrapper which
 * binds it to the canonical repo paths.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, copyFile, appendFile } from "node:fs/promises";
import { atomicWriteFile } from "../merge/safeWrite.js";
import {
  CURRENT_REGISTRY_VERSION,
  migrate,
  parseRegistry,
  RegistryParseError,
  validateRegistry,
  type Finding,
  type MigrationStats,
  type Registry,
} from "./registry-schema.js";

export interface MigrationPaths {
  registry: string;
  legacyPreserve: string;
  anchorLog: string;
  report: string;
}

export interface MigrationOptions {
  paths: MigrationPaths;
  inPlace: boolean;
  generatedAt?: string;
}

export interface MigrationResult {
  preSha: string;
  postSha: string;
  preCount: number;
  postCount: number;
  stats: MigrationStats;
  generatedAt: string;
  preEntries: Finding[];
  postRegistry: Registry;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

function sha256(buf: string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function summarizeStats(stats: MigrationStats): string {
  return [
    `total entries:            ${stats.total}`,
    `pre-rigor backfilled:     ${stats.preRigorBackfilled}`,
    `execution_tier=3 default: ${stats.tierBackfilled}`,
    `central_path=false set:   ${stats.centralPathBackfilled}`,
    `false_positive=false set: ${stats.falsePositiveBackfilled}`,
  ].join("\n");
}

export function previewEntries(
  label: string,
  entries: ReadonlyArray<Finding>,
): string {
  if (entries.length === 0) return `${label}: (empty)`;
  const head = entries.slice(0, 3);
  const tail = entries.slice(-3);
  const fmt = (f: Finding): string =>
    `  - ${f.finding_id} | ${f.severity} | disposition=${f.disposition} | tier=${f.execution_tier ?? "—"} | rigor=${f.confidence ?? "—"}`;
  return [
    `${label}:`,
    "  first 3:",
    ...head.map(fmt),
    "  last 3:",
    ...tail.map(fmt),
  ].join("\n");
}

interface ReportArgs {
  preSha: string;
  postSha: string;
  preCount: number;
  postCount: number;
  stats: MigrationStats;
  generatedAt: string;
  preEntries: ReadonlyArray<Finding>;
  postEntries: ReadonlyArray<Finding>;
  legacyPreservePath: string;
  anchorLogPath: string;
}

export function buildReport(args: ReportArgs): string {
  return `# Registry Migration Report

> Generated: ${args.generatedAt}

Migration of \`governance/audit/finding-registry.json\` from legacy v1 (bare array)
to v2 envelope (\`{schema_version: "${CURRENT_REGISTRY_VERSION}", generated_at, entries}\`).

## Checksums

| File state | sha256 | entry count |
|---|---|---|
| pre-migration  (v1) | \`${args.preSha}\` | ${args.preCount} |
| post-migration (v2) | \`${args.postSha}\` | ${args.postCount} |

The pre-migration content is preserved at
\`${args.legacyPreservePath}\` for one cycle as a fallback.
A migration anchor entry is appended to
\`${args.anchorLogPath}\` for chain-of-custody.

## Backfill statistics

\`\`\`
${summarizeStats(args.stats)}
\`\`\`

## Spot-check

${previewEntries("Pre", args.preEntries)}

${previewEntries("Post", args.postEntries)}

## Rollback

If a problem surfaces, restore the v1 array via:

\`\`\`
cp ${args.legacyPreservePath} <registry-path>
\`\`\`
`;
}

async function appendAnchor(args: {
  anchorLogPath: string;
  phase: string;
  sha256: string;
  entryCount: number;
  generatedAt: string;
}): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(args.anchorLogPath), { recursive: true });
  const line = JSON.stringify({
    phase: args.phase,
    timestamp: args.generatedAt,
    sha256: args.sha256,
    entry_count: args.entryCount,
  });
  await appendFile(args.anchorLogPath, line + "\n", "utf-8");
}

/**
 * Run the migration end-to-end. Returns null when the registry is already v2
 * (idempotent no-op). Throws MigrationError on parse failure, schema mismatch,
 * or post-migration validation drift.
 *
 * When `inPlace` is true, performs writes in this dependency order:
 *   1. Copy current registry → legacyPreserve  (recovery fallback first)
 *   2. Append `migration:pre` anchor with pre-sha256
 *   3. atomicWriteFile new envelope to registry path
 *   4. Append `migration:post` anchor with post-sha256 (closes the chain)
 *   5. atomicWriteFile migration report
 *
 * Crash safety: a crash between steps 1-3 leaves the original registry intact
 * (atomicWriteFile uses temp+rename). A crash between 3-5 leaves the new
 * envelope live but the report missing — re-running is safe (idempotent).
 */
export async function runMigration(
  opts: MigrationOptions,
): Promise<MigrationResult | null> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const { paths, inPlace } = opts;

  const preContent = await readFile(paths.registry, "utf-8");
  const preSha = sha256(preContent);

  let raw: unknown;
  try {
    raw = JSON.parse(preContent);
  } catch (err) {
    throw new MigrationError(
      `failed to parse ${paths.registry}: ${(err as Error).message}`,
    );
  }

  // Idempotency: already-v2 envelopes are a no-op.
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as { schema_version?: unknown }).schema_version === "string"
  ) {
    return null;
  }

  if (!Array.isArray(raw)) {
    throw new RegistryParseError(
      "registry is neither a v1 array nor a v2 envelope",
    );
  }

  const { registry, stats } = migrate(raw, { generatedAt });

  // Validate the migrated envelope before any write — refuse to land an
  // invalid v2 even temporarily.
  const reparsed = parseRegistry(registry);
  const drifts = validateRegistry(reparsed);
  if (drifts.length > 0) {
    const sample = drifts
      .slice(0, 5)
      .map((d) => `${d.finding_id}: ${d.reason}`)
      .join("; ");
    throw new MigrationError(
      `post-migration validation found ${drifts.length} drift items: ${sample}${drifts.length > 5 ? ` (+${drifts.length - 5} more)` : ""}`,
    );
  }

  const postContent = JSON.stringify(registry, null, 2) + "\n";
  const postSha = sha256(postContent);

  const result: MigrationResult = {
    preSha,
    postSha,
    preCount: raw.length,
    postCount: registry.entries.length,
    stats,
    generatedAt,
    preEntries: raw.map((entry) => entry as Finding),
    postRegistry: registry,
  };

  if (inPlace) {
    await copyFile(paths.registry, paths.legacyPreserve);
    await appendAnchor({
      anchorLogPath: paths.anchorLog,
      phase: "migration:pre",
      sha256: preSha,
      entryCount: raw.length,
      generatedAt,
    });
    await atomicWriteFile(paths.registry, postContent);
    await appendAnchor({
      anchorLogPath: paths.anchorLog,
      phase: "migration:post",
      sha256: postSha,
      entryCount: registry.entries.length,
      generatedAt,
    });
    await atomicWriteFile(
      paths.report,
      buildReport({
        preSha,
        postSha,
        preCount: raw.length,
        postCount: registry.entries.length,
        stats,
        generatedAt,
        preEntries: result.preEntries,
        postEntries: registry.entries,
        legacyPreservePath: paths.legacyPreserve,
        anchorLogPath: paths.anchorLog,
      }),
    );
  }

  return result;
}
