import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, isAbsolute } from "node:path";
import { extractManagedBlock, splitAtManagedBlock } from "../merge/managedBlocks.js";
import { readPrefixFrontmatterField, safeWriteFile } from "../merge/safeWrite.js";
import { HATCH3R_DIR, type AdapterOutput } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { getRunId } from "../cli/shared/runId.js";
import { resolveBundledContentRoot } from "../content/contentRoot.js";

/**
 * D12-4 (Cycle 11 Wave 2, D12, P2): the relative on-disk location of the
 * provenance manifest, the single source of truth for `hatch3r status` drift
 * attribution and `hatch3r explain --source`. Exported so consumers
 * (status.ts, explain.ts, the writer below) reference one literal.
 */
export const PROVENANCE_FILE = "provenance.json";

/**
 * The CLI command that materialized a given provenance manifest.
 *
 * D12-SA12.2-02 (Cycle 12 Wave 4, D12, P5): `"config"` was added so a
 * `config`-originated regeneration attributes to its real entrypoint rather
 * than collapsing into `"update"`. `verify --fix` deliberately reuses
 * `"update"` (it is a repair-regeneration, mechanically identical to update) —
 * see the `runRegenerate` provenance write in `update.ts`.
 */
export type ProvenanceCommand = "sync" | "init" | "update" | "config";

/**
 * The valid {@link ProvenanceCommand} values, for runtime narrowing of a
 * `lastCommand` read back from a previously-persisted (possibly hand-edited)
 * manifest (D1-SA1.6-07). `satisfies` pins the array to the union so a typo
 * here is a compile error.
 */
const PROVENANCE_COMMANDS = ["sync", "init", "update", "config"] as const satisfies readonly ProvenanceCommand[];

/** Narrow an unknown persisted value to a {@link ProvenanceCommand}. */
function isProvenanceCommand(value: unknown): value is ProvenanceCommand {
  return typeof value === "string" && PROVENANCE_COMMANDS.some((c) => c === value);
}

/**
 * SA12.4-F1 / F2.7-F5 (D2/D12): canonical normalization used by BOTH the
 * provenance writer ({@link writeProvenance}) and the `hatch3r status` drift
 * reader, so the emit-time hash matches the hash derived from an on-disk file.
 * Hashes the trimmed managed block when one is present (the part hatch3r owns
 * and overwrites), else the full content. The same logic mirrors the
 * comparison in status.ts::computeAdapterDrift: there, on-disk block is
 * compared to expected block; here we reduce each side to a stable sha256 so a
 * stored baseline can be compared across runs without retaining full file
 * bodies.
 *
 * D12-4: moved here from status.ts so init/update can write a hash-bearing
 * provenance baseline without dragging the whole status command graph
 * (getAdapter, customizationSummary, …) into their import closure. status.ts
 * re-exports it for back-compat.
 */
export function hashEmittedContent(
  content: string,
  managedContent?: string,
  filePath?: string,
): string {
  // D11-6 (Cycle 11 Wave 2): pass filePath so block extraction is line-anchored
  // and variant-aware — drift hashing never truncates the block at a marker
  // token quoted in user content, which would otherwise hash a wrong slice and
  // report phantom drift.
  const block = extractManagedBlock(content, filePath) ?? managedContent ?? null;
  const payload = block !== null ? block.trim() : content;
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * D12-3 (D12, P6): normalize a `BaseAdapter`-populated `sourceFiles` entry to a
 * path RELATIVE to the bundled content root so the persisted manifest carries
 * portable `agents/hatch3r-architect.md`-style ids rather than the absolute,
 * machine-specific `/Users/<name>/…/dist/content/agents/hatch3r-architect.md`
 * the adapter tracks (built by `readCanonicalFiles` as
 * `join(resolveBundledContentRoot(), <type>, <relPath>)`). An absolute home
 * path leaks the operator's username + install layout into a file the operator
 * may commit (the D12-3 fix also gitignores `provenance.json`), and differs
 * per machine — defeating diff stability for any team that does commit it.
 *
 * Only absolute entries are rewritten: an already-relative value (an adapter
 * that set `sourceFiles` explicitly to a repo-relative id) is returned
 * unchanged, because feeding it to `path.relative(contentRoot, rel)` would
 * resolve it against `process.cwd()` and produce a wrong `..`-laden path. An
 * absolute path OUTSIDE the content root (no overlap) yields a `..`-prefixed
 * result from `path.relative`; that is preserved as-is rather than silently
 * dropping the attribution. POSIX `/` separators are forced so a manifest
 * written on Windows stays byte-identical to one written on POSIX (the ids are
 * display/trace strings, never re-opened from disk by any consumer —
 * status.ts/explain.ts/provenance.ts read them as opaque labels).
 */
export function relativizeSourceFile(sourceFile: string, contentRoot: string): string {
  if (!isAbsolute(sourceFile)) return sourceFile;
  return relative(contentRoot, sourceFile).split("\\").join("/");
}

/** One persisted provenance record: an output path + how it was produced. */
export interface ProvenanceEntry {
  path: string;
  adapter: string;
  sourceFiles: string[];
  contentHash?: string;
  /**
   * release/2.7.0 (additive — `schemaVersion` stays 1; old readers ignore
   * unknown keys): the `model:` / `effort:` scalars parsed from the output's
   * out-of-block frontmatter prefix at emit time
   * ({@link readPrefixFrontmatterField} over `splitAtManagedBlock().prefix`).
   * `hatch3r status` compares the ON-DISK prefix against these to attribute a
   * hand-edited stub (`user-modified` / `frontmatter-stub-edited`) instead of
   * blanket-reporting `canonical-outdated`. Absent when the output has no
   * managed block, no prefix, or no such frontmatter field.
   */
  emittedModel?: string;
  emittedEffort?: string;
}

/** The full on-disk `.hatch3r/provenance.json` document (schemaVersion 1). */
export interface ProvenanceManifest {
  schemaVersion: 1;
  hatch3rVersion: string;
  generatedAt: string;
  lastCommand: ProvenanceCommand;
  lastRunId: string;
  outputs: ProvenanceEntry[];
}

/** A single adapter's successful outputs, as collected by a command's loop. */
export interface PerAdapterOutputs {
  adapter: string;
  outputs: AdapterOutput[];
}

/** Stable `[adapter, path]` sort applied to every persisted entry set. */
function sortEntries<T extends { adapter: string; path: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const byAdapter = a.adapter.localeCompare(b.adapter);
    if (byAdapter !== 0) return byAdapter;
    return a.path.localeCompare(b.path);
  });
}

/**
 * D12-4 (Cycle 11 Wave 2, D12, P2): write `.hatch3r/provenance.json` from a
 * command's successful per-adapter outputs. Extracted verbatim from the
 * sync.ts writer (SA12.4-F1) so `init` and `update` populate the same
 * first-run trace + refresh the drift baseline — previously only `sync`
 * wrote it, leaving `explain --source` empty after `init` and stale after
 * `update` (lastCommand was hard-coded `"sync"`).
 *
 * Behavior (preserved from the sync.ts original):
 * - Each output is recorded with its producing adapter, the sorted
 *   `sourceFiles[]` set populated by `BaseAdapter.generate()`, and an
 *   emit-time `contentHash` ({@link hashEmittedContent}) so `status` can tell
 *   a user edit from an outdated canonical block.
 * - F2.7-F5 idempotency: when the previous manifest at the same hatch3r
 *   version records a byte-identical output set, `generatedAt`, `lastRunId`,
 *   AND `lastCommand` are carried forward so a no-op re-run stays byte-identical
 *   on disk. D1-SA1.6-07 added `lastCommand` to the carry set — previously it
 *   was re-stamped, so a no-op `update` after a `sync` rewrote the file and left
 *   a `{lastCommand:"update", lastRunId:<sync run id>}` header that names an
 *   id/command pair which never co-occurred as a run.
 * - D11-M2 split-brain repair: provenance rows for adapters in
 *   `failedAdapters` are carried forward from the previous manifest, so the
 *   half-state a partial run leaves on disk stays attributable rather than
 *   degrading to `unknown` drift.
 *
 * Silent Failure Contract (P5): a write/read failure never throws — it is
 * reported through `onWarn` (the caller's UI `warn()` channel) and the
 * function returns `{ written: false, warning }`. Callers thread that warning
 * into their summary so the gap is visible.
 *
 * @param command which CLI command produced this manifest (`sync` | `init`
 *   | `update` | `config`) — persisted as `lastCommand` so `explain --source`
 *   and CI consumers can attribute the manifest to the originating run.
 * @param failedAdapters adapter ids whose generation did NOT complete this
 *   run; their prior provenance rows are carried forward (D11-M2) so a
 *   partially-failed run stays attributable rather than degrading to
 *   `unknown` drift. All three callers compute this: `sync` from its
 *   failed-tool list, `init` from `tools.filter(t => t not in pendingAdapters)`,
 *   and `update` from `adapterFailures.map(f => f.tool)`. Pass `[]` only when
 *   the run had no adapter failures to carry forward.
 */
export async function writeProvenance(
  rootDir: string,
  perAdapterOutputs: PerAdapterOutputs[],
  command: ProvenanceCommand,
  opts: { failedAdapters?: string[]; onWarn?: (msg: string) => void } = {},
): Promise<{ written: boolean; warning?: string }> {
  const onWarn = opts.onWarn ?? (() => {});
  const failedAdapters = opts.failedAdapters ?? [];
  const provenancePath = join(rootDir, HATCH3R_DIR, PROVENANCE_FILE);
  try {
    // D12-3 (D12, P6): resolve the bundled content root ONCE so every
    // `sourceFiles` entry is rewritten relative to it (portable, machine-
    // independent ids). `resolveBundledContentRoot` is process-cached and only
    // throws when the bundled content is genuinely absent — in that edge layout
    // we fall back to leaving the absolute paths untouched rather than failing
    // the whole manifest write (the gitignore carve-out still keeps the file
    // machine-local). `relativizeSourceFile` no-ops on already-relative ids.
    let contentRoot: string | null = null;
    try {
      contentRoot = resolveBundledContentRoot();
    } catch {
      contentRoot = null;
    }
    const relSources = (sources: string[] | undefined): string[] =>
      contentRoot === null
        ? [...(sources ?? [])].sort()
        : [...(sources ?? [])].map((s) => relativizeSourceFile(s, contentRoot)).sort();

    // F2.7-F5 idempotency contract: sort `successfulOutputs` by `[adapter,
    // path]` to match the on-disk sort applied to the merged `outputs` below.
    // Without this, the `.every((p, i) => …)` index-by-index comparison
    // against the previous (already-sorted) manifest fails on the first row
    // even when both runs emit byte-identical adapter output — forcing a fresh
    // `generatedAt` / `lastRunId` on every re-run and breaking idempotency.
    const successfulOutputs = sortEntries(
      perAdapterOutputs.flatMap((entry) =>
        entry.outputs.map((out) => {
          // release/2.7.0: capture the emit-time `model:`/`effort:` scalars
          // from the out-of-block frontmatter prefix (the slice before the
          // HATCH3R:BEGIN marker) so `status` can tell a hand-edited stub from
          // a moved canonical mapping. Same parse the safeWrite stub-heal
          // warning uses (readPrefixFrontmatterField), so writer and reader
          // agree byte-for-byte. `undefined` (no block, empty prefix, or no
          // field) is dropped by JSON.stringify — prefix-less outputs persist
          // without the keys.
          const prefix = splitAtManagedBlock(out.content, out.path)?.prefix ?? "";
          return {
            path: out.path,
            adapter: entry.adapter,
            // D12-3: persist content-root-relative source ids, not the absolute
            // home paths BaseAdapter tracks (sort after relativizing so order is
            // stable on the rewritten strings).
            sourceFiles: relSources(out.sourceFiles),
            // F2.7-F5 (D2): emit-time hash of the normalized managed block (or
            // full content when the output has no block). `status` re-derives
            // this from the on-disk file to tell a user edit (on-disk differs
            // from this baseline) from an outdated canonical block (a fresh
            // regeneration differs from this baseline).
            // D12-SA12.2-03 (Cycle 12 Wave 4, D12, CQ2): pass `out.path` so the
            // baseline uses the SAME path-aware, variant-ordered block extraction
            // the status reader applies (status.ts computes BOTH its hashes with
            // filePath). Without it, a `.yml` output whose user region quotes a
            // complete HTML marker pair on its own lines hashes the HTML-first
            // block here but the YAML block in the reader — flipping drift
            // attribution to a phantom `(your edit)` on an untouched safe-to-sync
            // file. `out.path` is already the row's key two lines up.
            contentHash: hashEmittedContent(out.content, out.managedContent, out.path),
            emittedModel: readPrefixFrontmatterField(prefix, "model"),
            emittedEffort: readPrefixFrontmatterField(prefix, "effort"),
          };
        }),
      ),
    );

    // Read previous manifest for idempotency comparison and for the D11-M2
    // partial-run provenance carry-forward.
    let previousGeneratedAt: string | null = null;
    let previousLastRunId: string | null = null;
    // D1-SA1.6-07 (P2): carried forward together with generatedAt/lastRunId on
    // an idempotency hit so a byte-identical re-run stays truly byte-identical
    // and the header names one run (the run that produced the current bytes)
    // rather than pairing a fresh lastCommand with a carried lastRunId.
    let previousLastCommand: ProvenanceCommand | null = null;
    let previousEntries: ProvenanceEntry[] = [];
    try {
      const prevRaw = await readFile(provenancePath, "utf-8");
      const prev = JSON.parse(prevRaw) as Partial<ProvenanceManifest>;
      if (prev.schemaVersion === 1 && Array.isArray(prev.outputs)) {
        previousEntries = prev.outputs;
      }
      if (
        prev.schemaVersion === 1 &&
        prev.hatch3rVersion === HATCH3R_VERSION &&
        Array.isArray(prev.outputs) &&
        prev.outputs.length === successfulOutputs.length &&
        prev.outputs.every((p, i) => {
          const c = successfulOutputs[i];
          return (
            p.adapter === c.adapter &&
            p.path === c.path &&
            // F2.7-F5: the emit-time hash participates in the idempotency check
            // so a content change refreshes both the baseline hash and the
            // timestamp; identical re-runs stay byte-identical.
            p.contentHash === c.contentHash &&
            // release/2.7.0: the emitted model/effort scalars participate too.
            // `contentHash` covers only the managed BLOCK, so a prefix-only
            // change (hatch3r's model mapping moves `model: opus` → `fable`
            // above the BEGIN marker) leaves it identical — without these two
            // comparisons the match branch would carry generatedAt/lastRunId
            // forward across that real baseline change, stamping the refreshed
            // scalars with the OLD run's identity. Cost: the first post-2.7.0
            // run mismatches once (pre-2.7.0 manifests lack the keys) and
            // mints a fresh generatedAt; every later no-op run matches and
            // stays byte-identical.
            p.emittedModel === c.emittedModel &&
            p.emittedEffort === c.emittedEffort &&
            p.sourceFiles.length === c.sourceFiles.length &&
            p.sourceFiles.every((s, j) => s === c.sourceFiles[j])
          );
        })
      ) {
        previousGeneratedAt = typeof prev.generatedAt === "string" ? prev.generatedAt : null;
        previousLastRunId = typeof prev.lastRunId === "string" ? prev.lastRunId : null;
        previousLastCommand = isProvenanceCommand(prev.lastCommand) ? prev.lastCommand : null;
      }
    } catch {
      // Missing/corrupt previous manifest → no idempotency carry-forward and
      // no partial-run rows to preserve. A fresh manifest is written below.
      previousGeneratedAt = null;
      previousLastRunId = null;
      previousLastCommand = null;
      previousEntries = [];
    }

    // D11-M2 (Cycle 10 Wave-3 Medium, P2): split-brain repair after a partial
    // run. The non-transactional adapter loop leaves failed adapters' prior
    // outputs on disk untouched, so the failed adapter still owns real files.
    // Writing only the successful-adapter outputs would drop those rows;
    // `hatch3r status` then loses the baseline hash for every failed-adapter
    // output and degrades drift attribution to `unknown`. Carry the prior
    // provenance entries for FAILED adapters forward so the half-state on disk
    // stays attributable. Successful adapters' entries are always refreshed.
    const failedAdapterSet = new Set(failedAdapters);
    const carriedEntries = previousEntries.filter((p) => failedAdapterSet.has(p.adapter));
    const outputs = sortEntries([...successfulOutputs, ...carriedEntries]);

    // SA12.1-F-D12-M4 (D12, P1): record which CLI command produced this
    // provenance manifest and under which per-run correlation id. Operators
    // tracing a stale provenance entry back to a run can grep .failure-log.jsonl by
    // `lastRunId`, and CI consumers can branch on `lastCommand` to distinguish
    // a sync-emitted manifest from an init- or update-emitted one.
    const provenance: ProvenanceManifest = {
      schemaVersion: 1,
      hatch3rVersion: HATCH3R_VERSION,
      generatedAt: previousGeneratedAt ?? new Date().toISOString(),
      // D1-SA1.6-07 (P2): on an idempotency hit carry the prior lastCommand
      // alongside generatedAt/lastRunId so the three fields describe one run.
      // On a non-idempotent run previousLastCommand is null → this run's command
      // is stamped.
      lastCommand: previousLastCommand ?? command,
      lastRunId: previousLastRunId ?? getRunId(),
      outputs,
    };
    await safeWriteFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n", {
      force: true,
    });
    return { written: true };
  } catch (err) {
    // Silent Failure Contract (P5): a provenance write failure must not break
    // the command. Surface via the caller's warn channel so operators see the
    // gap; the per-output `sourceFiles` field remains available in-memory.
    const warning =
      `Failed to write ${HATCH3R_DIR}/${PROVENANCE_FILE}: ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `Source-file attribution will not be available for this run.`;
    onWarn(warning);
    return { written: false, warning };
  }
}
