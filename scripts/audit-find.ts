#!/usr/bin/env node
/**
 * scripts/audit-find.ts
 *
 * Resolve a finding by ID across the live registry and the archive index.
 * Replaces the old "read whole registry to chase one ID" workflow.
 *
 * Pillars: P5 (Governance Self-Quality), P7 (Speed & Token Efficiency).
 *
 * Usage:
 *   npm run audit:find -- C7-D5-M3
 *
 * Search order:
 *   1. Live registry (`governance/audit/finding-registry.json`).
 *   2. Archive index (`governance/audit/archive/index.json`), iterating
 *      archives smallest-cycle first to match the chronological audit cycle.
 *
 * Exit:
 *   0 — match found, JSON entry printed to stdout.
 *   1 — not found in live or archive.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRegistry,
  RegistryParseError,
  type Finding,
} from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const PATHS = {
  registry: resolve(ROOT, "governance/audit/finding-registry.json"),
  archiveDir: resolve(ROOT, "governance/audit/archive"),
  archiveIndex: resolve(ROOT, "governance/audit/archive/index.json"),
};

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

interface ArchiveIndexEntry {
  cycle: number;
  file: string;
  entry_count: number;
  sha256: string;
  archived_at: string;
  baseline_commit?: string;
  head_commit?: string;
}

interface ArchiveIndexFile {
  schema_version: string;
  generated_at: string;
  archives: ArchiveIndexEntry[];
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

async function searchLive(findingId: string): Promise<Finding | null> {
  let raw: unknown;
  try {
    raw = await readJson(PATHS.registry);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  const parsed = parseRegistry(raw);
  const entries = parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;
  return entries.find((e) => e.finding_id === findingId) ?? null;
}

async function searchArchives(
  findingId: string,
): Promise<{ entry: Finding; archiveFile: string; cycle: number } | null> {
  let indexRaw: unknown;
  try {
    indexRaw = await readJson(PATHS.archiveIndex);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  if (
    indexRaw === null ||
    typeof indexRaw !== "object" ||
    !Array.isArray((indexRaw as ArchiveIndexFile).archives)
  ) {
    return null;
  }
  const index = indexRaw as ArchiveIndexFile;
  // Smallest cycle first (chronological).
  const sorted = [...index.archives].sort((a, b) => a.cycle - b.cycle);
  for (const a of sorted) {
    const archivePath = join(PATHS.archiveDir, a.file);
    let archiveRaw: unknown;
    try {
      archiveRaw = await readJson(archivePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
    if (
      archiveRaw === null ||
      typeof archiveRaw !== "object" ||
      !Array.isArray((archiveRaw as { entries?: unknown[] }).entries)
    ) {
      continue;
    }
    const entries = (archiveRaw as { entries: Finding[] }).entries;
    const hit = entries.find((e) => e.finding_id === findingId);
    if (hit) {
      return { entry: hit, archiveFile: a.file, cycle: a.cycle };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0].startsWith("-")) {
    emitError("audit:find: usage: npm run audit:find -- <finding_id>");
    process.exit(1);
    return;
  }
  const findingId = argv[0];

  // 1. Live registry.
  let liveHit: Finding | null = null;
  try {
    liveHit = await searchLive(findingId);
  } catch (err) {
    if (err instanceof RegistryParseError) {
      emitError(`audit:find: live registry parse error: ${err.message}`);
      process.exit(1);
      return;
    }
    emitError(`audit:find: error reading live registry: ${(err as Error).message}`);
    process.exit(1);
    return;
  }
  if (liveHit) {
    emit(JSON.stringify({ source: "live", entry: liveHit }, null, 2));
    return;
  }

  // 2. Archive index.
  let archiveHit:
    | { entry: Finding; archiveFile: string; cycle: number }
    | null = null;
  let archivesScanned = 0;
  try {
    // Re-walk to count archives even on miss for the not-found message.
    let indexRaw: unknown = null;
    try {
      indexRaw = await readJson(PATHS.archiveIndex);
    } catch {
      // no archives yet
    }
    if (
      indexRaw &&
      typeof indexRaw === "object" &&
      Array.isArray((indexRaw as ArchiveIndexFile).archives)
    ) {
      archivesScanned = (indexRaw as ArchiveIndexFile).archives.length;
    }
    archiveHit = await searchArchives(findingId);
  } catch (err) {
    emitError(`audit:find: error searching archives: ${(err as Error).message}`);
    process.exit(1);
    return;
  }
  if (archiveHit) {
    emit(
      JSON.stringify(
        {
          source: "archive",
          archive_file: archiveHit.archiveFile,
          cycle: archiveHit.cycle,
          entry: archiveHit.entry,
        },
        null,
        2,
      ),
    );
    return;
  }

  emitError(
    `audit:find: "${findingId}" not found in live or archive (${archivesScanned} archives scanned)`,
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  emitError(`audit:find failed: ${(err as Error).message}`);
  process.exit(1);
});
