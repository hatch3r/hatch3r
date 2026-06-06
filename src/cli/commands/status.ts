import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { hashEmittedContent } from "../../manifest/provenance.js";
import { getAdapter } from "../../adapters/index.js";
import { HATCH3R_DIR, type HatchManifest } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { planPerPackageOutputs } from "../../content/monorepoEmission.js";
import { discoverUserContent } from "../../content/userContent.js";
import {
  readSpaceMetricsForDay,
  summarizeSpaceMetricRecords,
  type SpaceMetricRecord,
} from "../../pipeline/spaceTelemetry.js";
import { buildCustomizationSummary } from "../../adapters/customizationSummary.js";
import { emitJson, parseFormatOption, type CliOutputFormat } from "../shared/output.js";
import {
  assertManifest,
  MISSING_MANIFEST_MESSAGE,
  MISSING_MANIFEST_HINT,
} from "../shared/requireManifest.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  printBanner,
  createSpinner,
  printBox,
  info,
  label,
  setVerbose,
  verbose,
} from "../shared/ui.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { detectCliTools } from "../../cliTools/detect.js";

/**
 * Wave 7 drift status — per-file comparison between on-disk adapter output
 * and freshly regenerated output (sourced from the bundled content root).
 */
export interface DriftEntry {
  path: string;
  tool: string;
  /** `in-sync` — managed block (or full content) matches regeneration.
   *  `modified` — file exists but managed block differs.
   *  `missing`  — file path absent from disk.
   *  `unexpected` — file present on disk but no longer produced by any adapter.
   */
  status: "in-sync" | "modified" | "missing" | "unexpected";
  /**
   * F2.7-F5 (D2): for `modified` entries, attributes WHY the file drifted by
   * comparing the on-disk file and a fresh regeneration against the emit-time
   * baseline hash recorded in `.hatch3r/provenance.json`:
   *   - `user-modified`     — on-disk differs from baseline; regeneration matches it (the user hand-edited; canonical content is unchanged).
   *   - `canonical-outdated`— on-disk matches baseline; regeneration differs (canonical content changed since last sync; the user did not touch the file).
   *   - `both`             — on-disk differs from baseline AND regeneration differs (the user edited and canonical also moved).
   *   - `unknown`          — no baseline recorded (file predates the provenance writer, or `sync` has not run since the upgrade).
   * Absent for non-`modified` statuses.
   */
  driftKind?: "user-modified" | "canonical-outdated" | "both" | "unknown";
}

export interface DriftReport {
  entries: DriftEntry[];
  counts: { synced: number; modified: number; missing: number; unexpected: number };
  /**
   * F2.7-F5 (D2): sub-counts of the `modified` total by drift attribution.
   * The sum of these four equals `counts.modified`.
   */
  driftKindCounts: {
    userModified: number;
    canonicalOutdated: number;
    both: number;
    unknown: number;
  };
}

// D12-4 (Cycle 11 Wave 2): `hashEmittedContent` moved to
// `src/manifest/provenance.ts` (alongside the `writeProvenance` writer it
// pairs with) so `init`/`update` can emit a hash-bearing provenance baseline
// without importing the whole status command graph. Re-exported here so
// existing `import { hashEmittedContent } from "./status.js"` call sites keep
// working unchanged; the drift reader below uses the same binding.
export { hashEmittedContent };

/**
 * F2.7-F5 (D2): one entry of the emit-time provenance baseline read from
 * `.hatch3r/provenance.json`. Only `path` + `contentHash` are needed for
 * drift attribution; the writer also stores `adapter` + `sourceFiles`.
 */
interface ProvenanceBaselineEntry {
  path: string;
  contentHash?: string;
}

/**
 * F2.7-F5 (D2): load the emit-time content-hash baseline keyed by output path.
 * Returns an empty map when the manifest is absent or unreadable so drift
 * attribution degrades to `unknown` rather than throwing — status must still
 * render its drift summary without a baseline.
 */
async function loadProvenanceBaseline(rootDir: string): Promise<Map<string, string>> {
  const baseline = new Map<string, string>();
  try {
    const raw = await readFile(join(rootDir, HATCH3R_DIR, "provenance.json"), "utf-8");
    const parsed = JSON.parse(raw) as { outputs?: ProvenanceBaselineEntry[] };
    for (const entry of parsed.outputs ?? []) {
      if (typeof entry.path === "string" && typeof entry.contentHash === "string") {
        baseline.set(entry.path, entry.contentHash);
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
    verbose(`status: provenance baseline unavailable (${code}); drift attribution = unknown`);
  }
  return baseline;
}

/**
 * D10-17 (D10, P1): number of trailing calendar days of SPACE telemetry the
 * status reporting surface reads. The per-day JSONL filename is derived from the
 * record timestamp (`space-<YYYY-MM-DD>.jsonl`), so a `status` run the day after
 * `hatch3r init` would miss the init's `firstRunSuccessRate` if it read only
 * today. A 7-day window keeps the recent first-run signal visible without an
 * unbounded directory walk.
 */
const SPACE_TELEMETRY_WINDOW_DAYS = 7;

/**
 * D10-17 (D10, P1): structured SPACE-telemetry rollup surfaced by `status` from
 * the persisted JSONL (the cross-process read counterpart to the
 * `recordFirstRunSuccess` call wired into `init.ts`). Empty `axes` + zero
 * `recordCount` means no telemetry has been written yet.
 */
export interface SpaceTelemetrySummary {
  /** Calendar days (YYYY-MM-DD) scanned, newest first. */
  daysScanned: string[];
  /** Total metric records read across the window. */
  recordCount: number;
  /** Per-axis count + mean over the window (one row per SPACE axis). */
  axes: ReturnType<typeof summarizeSpaceMetricRecords>;
  /**
   * Mean of the `performance`-axis `firstRunSuccessRate` records (0..1), or
   * `null` when none were recorded in the window. This is the primary P1 metric.
   */
  firstRunSuccessRate: number | null;
}

/**
 * D10-17 (D10, P1): read the trailing {@link SPACE_TELEMETRY_WINDOW_DAYS}-day
 * SPACE telemetry from `.hatch3r/telemetry/space-<date>.jsonl` and roll it up.
 *
 * Best-effort and side-effect-free: {@link readSpaceMetricsForDay} swallows
 * missing/unreadable/corrupt files (Silent Failure Contract), so this returns a
 * zero-record summary rather than throwing when telemetry is absent.
 */
function readSpaceTelemetrySummary(rootDir: string): SpaceTelemetrySummary {
  const days: string[] = [];
  const all: SpaceMetricRecord[] = [];
  const now = Date.now();
  for (let i = 0; i < SPACE_TELEMETRY_WINDOW_DAYS; i += 1) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    days.push(day);
    for (const rec of readSpaceMetricsForDay(day, rootDir)) {
      all.push(rec);
    }
  }
  const firstRunRecords = all.filter(
    (r) => r.metricId === "firstRunSuccessRate" && r.axis === "performance",
  );
  const firstRunSuccessRate =
    firstRunRecords.length === 0
      ? null
      : firstRunRecords.reduce((sum, r) => sum + r.value, 0) / firstRunRecords.length;
  return {
    daysScanned: days,
    recordCount: all.length,
    axes: summarizeSpaceMetricRecords(all),
    firstRunSuccessRate,
  };
}

/**
 * Wave 7: regenerate every adapter's output in memory (from the bundled
 * content root, no `.agents/` involvement) and compare against on-disk
 * output. The integrity-manifest fast path was removed with the integrity
 * subsystem (Wave 7); this is the only path.
 *
 * `verifyCommand` reuses this exact helper so verify+status share one
 * drift definition.
 *
 * D1-SA1.4-F8 (D2, P6) — concurrency contract: `status`/`verify` are
 * read-only and BEST-EFFORT under concurrent writes. This function reads each
 * on-disk output with `readFile` while regenerating the expected output from
 * the manifest in memory; it acquires no lock. If a concurrent `hatch3r sync`
 * is mid-write, `safeWriteFile`'s temp+rename keeps each individual file read
 * atomic (old or new bytes, never a half-written file), but the manifest the
 * concurrent sync is mutating (e.g. adding/removing a tool) and the on-disk
 * files can momentarily belong to different generations, yielding a transient
 * "modified"/"unexpected" entry. The advisory `.hatch3r/.lock` that top-level
 * orchestrator pipelines acquire (see `rules/hatch3r-agent-orchestration.md`
 * -> Concurrent Invocation Handling) is the coordination point; a drift report
 * produced while that lock is held by a writer is a snapshot of an in-flight
 * state. Re-run after the writer completes for an authoritative report; do not
 * run `status`/`verify` in parallel with `sync` and treat the result as final.
 *
 * D2-SA2.7-F8 (D2, P7) — cost note: there is no result cache. Each invocation
 * regenerates every adapter's output once (O(adapter x output-count) file
 * reads + transforms). A cross-invocation cache would not help the single-shot
 * CLI model — the process regenerates once per run and exits, so there is
 * nothing to deduplicate within a call. A persisted on-disk cache keyed on
 * (bundled-content version, manifest mtime, overrides mtime) is the only shape
 * that could help repeated shell-prompt / pre-commit use; it is deferred until
 * a profile on a representative repo confirms wall-clock > 250ms (the finding's
 * own gate), to avoid adding invalidation surface for an unmeasured win.
 */
export async function computeAdapterDrift(
  rootDir: string,
  manifest: HatchManifest,
): Promise<DriftReport> {
  const counts = { synced: 0, modified: 0, missing: 0, unexpected: 0 };
  const driftKindCounts = { userModified: 0, canonicalOutdated: 0, both: 0, unknown: 0 };
  const entries: DriftEntry[] = [];

  const canonicalContentRoot = resolveBundledContentRoot();
  // F2.7-F5 (D2): emit-time content-hash baseline (path -> sha256). Used to
  // attribute the direction of every `modified` entry below.
  const baseline = await loadProvenanceBaseline(rootDir);
  const seenPaths = new Set<string>();

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    // Wave 7 drift parity: regeneration must use the SAME projectRoot the
    // emission used (init/sync/update pass `rootDir`). Without it, adapter
    // customization probes resolve against `process.cwd()` instead of the
    // user repo, producing spurious "modified" entries on every status call.
    const outputs = await adapter.generate(canonicalContentRoot, manifest, rootDir);
    verbose(`${tool}: ${outputs.length} output file(s) to check`);

    for (const out of outputs) {
      seenPaths.add(out.path);
      const destPath = join(rootDir, out.path);
      try {
        const existing = await readFile(destPath, "utf-8");
        const existingBlock = extractManagedBlock(existing, out.path);
        // Prefer extracting from the regenerated content rather than the raw
        // managedContent hint: `wrapInManagedBlock` / `extractManagedBlock`
        // trim their payload, and several adapters pass an un-trimmed body
        // in `out.managedContent` for convenience. Comparing trimmed-on-disk
        // against raw-from-managedContent produced spurious "modified"
        // entries on every status call.
        const expectedBlock = extractManagedBlock(out.content, out.path) ?? out.managedContent ?? null;
        const matches = existingBlock !== null && expectedBlock !== null
          ? existingBlock === expectedBlock.trim()
          : existing === out.content;
        if (matches) {
          entries.push({ path: out.path, tool, status: "in-sync" });
          counts.synced++;
        } else {
          // F2.7-F5 (D2): attribute drift direction against the emit-time
          // baseline. `onDiskHash` and `regeneratedHash` are both reduced via
          // the same normalization the baseline used, so a clean comparison is
          // possible without retaining full file bodies.
          const baselineHash = baseline.get(out.path);
          const onDiskHash = hashEmittedContent(existing, undefined, out.path);
          const regeneratedHash = hashEmittedContent(
            out.content,
            out.managedContent ?? undefined,
            out.path,
          );
          let driftKind: NonNullable<DriftEntry["driftKind"]>;
          if (!baselineHash) {
            driftKind = "unknown";
            driftKindCounts.unknown++;
          } else {
            const userTouched = onDiskHash !== baselineHash;
            const canonicalMoved = regeneratedHash !== baselineHash;
            if (userTouched && canonicalMoved) {
              driftKind = "both";
              driftKindCounts.both++;
            } else if (userTouched) {
              driftKind = "user-modified";
              driftKindCounts.userModified++;
            } else if (canonicalMoved) {
              driftKind = "canonical-outdated";
              driftKindCounts.canonicalOutdated++;
            } else {
              // On-disk and regeneration both match the baseline yet the
              // block comparison above flagged a difference — a normalization
              // edge (e.g. trailing-whitespace-only). Treat as unknown rather
              // than asserting a false attribution.
              driftKind = "unknown";
              driftKindCounts.unknown++;
            }
          }
          entries.push({ path: out.path, tool, status: "modified", driftKind });
          counts.modified++;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        entries.push({ path: out.path, tool, status: "missing" });
        counts.missing++;
      }
    }

    // F14.2-H1 (D14): monorepo per-package emission parity. When the manifest
    // records workspace packages AND --per-package was opted in, init/sync ALSO
    // write per-directory copies for tools whose load model reads them — cursor
    // only, per D14-6 — into every `<package>/<rel>` and stamp those paths into
    // `manifest.managedFiles`. Re-target this tool's root outputs through the
    // SAME helper init/sync use (which returns [] for claude/copilot) and
    // register every per-package path as seen, so the orphan loop below does not
    // classify a legitimately-emitted per-package file as `unexpected`. Without
    // this, an N-package cursor repo reports ~(root-output-count x N) false
    // orphans on every status/verify call.
    for (const perPkg of planPerPackageOutputs(tool, manifest.packages, outputs)) {
      seenPaths.add(perPkg.output.path);
    }
  }

  // Files emitted by init/sync directly (not by any adapter). Tracked in the
  // manifest for `clean`/`update` lifecycle parity but excluded from the
  // "unexpected" drift check so they do not generate false-positive notices.
  const NON_ADAPTER_MANAGED_FILES = new Set<string>([".worktreeinclude"]);

  // Surface files the manifest still tracks but no current adapter emits.
  // These are leftovers from a removed adapter or a renamed output path.
  for (const tracked of manifest.managedFiles ?? []) {
    if (seenPaths.has(tracked)) continue;
    if (NON_ADAPTER_MANAGED_FILES.has(tracked)) continue;
    try {
      await access(join(rootDir, tracked));
      entries.push({ path: tracked, tool: "(unowned)", status: "unexpected" });
      counts.unexpected++;
    } catch (err) {
      // Missing-and-unowned is a no-op — neither produced nor present.
      const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
      verbose(`status: unexpected-file probe access(${tracked}) — ${code}`);
    }
  }

  return { entries, counts, driftKindCounts };
}

/**
 * F2.7-F5 (D2): one-word drift-attribution tag rendered next to a `modified`
 * file so the operator can tell a hand edit (keep it) from an outdated
 * canonical block (safe to regenerate) at a glance.
 */
function driftKindTag(kind: DriftEntry["driftKind"]): string {
  switch (kind) {
    case "user-modified":
      return chalk.yellow(" (your edit)");
    case "canonical-outdated":
      return chalk.cyan(" (canonical changed)");
    case "both":
      return chalk.red(" (your edit + canonical changed)");
    case "unknown":
    default:
      return chalk.dim(" (no baseline)");
  }
}

/**
 * D12-SA12.2-F5 (D12, P1): render a "Diff summary" box from a drift report,
 * reusing the exact `+ added` / `~ modified` / `= unchanged` vocabulary that
 * `hatch3r sync --diff` already emits (sync.ts ~line 1461) so `status --diff`
 * and `verify --diff` read identically. The data is already computed in-memory
 * by {@link computeAdapterDrift}; this only re-renders the per-file status as a
 * sync-style line. `missing` maps to `+ added` (sync would create it) and
 * `unexpected` maps to a distinct `! orphan` line (sync would NOT touch it —
 * mirrors the unexpected-file handling in {@link renderDriftLines}). Shared by
 * status and verify so a future drift-category addition lands in one place.
 */
export function renderDiffSummaryLines(report: DriftReport): string[] {
  const lines: string[] = [];
  for (const entry of report.entries) {
    switch (entry.status) {
      case "in-sync":
        lines.push(`${chalk.dim("= unchanged")} ${entry.path}`);
        break;
      case "modified":
        lines.push(`${chalk.yellow("~ modified")}  ${entry.path}`);
        break;
      case "missing":
        lines.push(`${chalk.green("+ added")}     ${entry.path}`);
        break;
      case "unexpected":
        lines.push(`${chalk.red("! orphan")}    ${entry.path}`);
        break;
    }
  }
  return lines;
}

/**
 * Render the per-file drift lines for printing in status / verify output.
 *
 * D1-SA1.4-F11 (Cycle 10 Wave 4, P1): exported so `hatch3r verify --verbose`
 * reuses the identical per-tool breakdown status emits, instead of forcing the
 * operator to re-run `status` to see WHICH files drifted. Shared renderer keeps
 * a future drift-category addition landing in one place.
 */
export function renderDriftLines(report: DriftReport): string[] {
  const byTool = new Map<string, DriftEntry[]>();
  for (const entry of report.entries) {
    const arr = byTool.get(entry.tool) ?? [];
    arr.push(entry);
    byTool.set(entry.tool, arr);
  }
  const lines: string[] = [];
  for (const [tool, items] of byTool) {
    lines.push(chalk.bold(`${tool}:`));
    for (const entry of items) {
      switch (entry.status) {
        case "in-sync":
          lines.push(`  ${chalk.green("=")} ${entry.path}`);
          break;
        case "modified":
          lines.push(`  ${chalk.yellow("~")} ${entry.path} ${chalk.dim("(drifted)")}${driftKindTag(entry.driftKind)}`);
          break;
        case "missing":
          lines.push(`  ${chalk.red("+")} ${entry.path} ${chalk.dim("(missing)")}`);
          break;
        case "unexpected":
          lines.push(`  ${chalk.red("!")} ${entry.path} ${chalk.dim("(unexpected: not produced by any current adapter)")}`);
          break;
      }
    }
  }
  return lines;
}

export async function statusCommand(opts?: { verbose?: boolean; format?: string; diff?: boolean }): Promise<void> {
  // SA12.1-F-D12-M2 (D12, P1): JSON mode emits a single structured document
  // for CI consumers — see {@link buildStatusJsonOutput}. Human mode keeps
  // the legacy decorated chrome (banner, spinner, printBox panels).
  const format: CliOutputFormat = parseFormatOption(opts?.format);
  const jsonMode = format === "json";
  setVerbose(jsonMode ? false : !!opts?.verbose);
  if (!jsonMode) printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    // D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): emit the structured payload first
    // in JSON mode, then delegate the human stderr + throw to the shared
    // `assertManifest` helper so every manifest-required command prints the
    // identical missing-manifest message and CONFIG_ERROR exit code.
    if (jsonMode) {
      emitJson({
        status: "failed",
        error: MISSING_MANIFEST_MESSAGE,
        errorCode: "CONFIG_ERROR",
        recoveryHint: MISSING_MANIFEST_HINT,
        timestamp: new Date().toISOString(),
        hatch3rVersion: HATCH3R_VERSION,
      });
    }
    assertManifest(manifest, { jsonMode });
  }

  const spinner = jsonMode ? null : createSpinner("Checking adapter-output drift...");
  spinner?.start();

  verbose(`Checking ${manifest.tools.length} tool(s): ${manifest.tools.join(", ")}`);

  const report = await computeAdapterDrift(rootDir, manifest);

  // D10-17 (D10, P1): roll up the persisted SPACE telemetry (written by
  // `init.ts::recordFirstRunSuccess`) so the human box and the JSON payload both
  // surface it. Read-only, never throws.
  const spaceTelemetry = readSpaceTelemetrySummary(rootDir);

  spinner?.stop();

  // SA12.1-F-D12-M2: emit the JSON payload before any human chrome and exit
  // early so CI consumers see exactly one JSON document on stdout.
  if (jsonMode) {
    const hasDrift =
      report.counts.modified > 0 || report.counts.missing > 0 || report.counts.unexpected > 0;
    emitJson({
      status: hasDrift ? "drift" : "in-sync",
      counts: report.counts,
      driftKindCounts: report.driftKindCounts,
      entries: report.entries,
      tools: manifest.tools,
      // D10-17: SPACE developer-productivity telemetry rollup. `recordCount: 0`
      // + `firstRunSuccessRate: null` when no telemetry has been written yet.
      spaceTelemetry,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  console.log();

  for (const line of renderDriftLines(report)) {
    console.log(`  ${line}`);
  }
  console.log();

  const summaryLines = [
    `${chalk.green("=")} In sync:    ${report.counts.synced}`,
  ];
  if (report.counts.modified > 0) {
    summaryLines.push(`${chalk.yellow("~")} Drifted:    ${report.counts.modified}`);
    // F2.7-F5 (D2): break the drifted total down by attribution so the
    // operator sees, at the summary level, how many files carry their own
    // edits (keep) versus an outdated canonical block (safe to regenerate).
    const dk = report.driftKindCounts;
    if (dk.userModified > 0) summaryLines.push(`    ${chalk.yellow("•")} your edits:        ${dk.userModified}`);
    if (dk.canonicalOutdated > 0) summaryLines.push(`    ${chalk.cyan("•")} canonical changed: ${dk.canonicalOutdated}`);
    if (dk.both > 0) summaryLines.push(`    ${chalk.red("•")} edits + canonical: ${dk.both}`);
    if (dk.unknown > 0) summaryLines.push(`    ${chalk.dim("•")} no baseline:       ${dk.unknown}`);
  }
  if (report.counts.missing > 0) {
    summaryLines.push(`${chalk.red("+")} Missing:    ${report.counts.missing}`);
  }
  if (report.counts.unexpected > 0) {
    summaryLines.push(`${chalk.red("!")} Unexpected: ${report.counts.unexpected}`);
  }

  const hasDrift = report.counts.modified > 0 || report.counts.missing > 0 || report.counts.unexpected > 0;
  const style = hasDrift ? "info" as const : "success" as const;
  printBox("Status", summaryLines, style);

  // D12-SA12.2-F5 (D12, P1): `--diff` renders the same before/after summary box
  // `hatch3r sync --diff` emits, computed in-memory from the drift report (no
  // extra disk reads beyond the regeneration status already performed).
  if (opts?.diff && report.entries.length > 0) {
    const diffLines = renderDiffSummaryLines(report);
    if (diffLines.length > 0) {
      printBox("Diff summary", diffLines, "info");
      console.log();
    }
  }

  if (report.counts.modified > 0) {
    // F2.7-F5 (D2): the emit-time baseline in `.hatch3r/provenance.json` now
    // lets status attribute drift direction, so the hint is tailored per
    // sub-state instead of the prior blanket overwrite warning.
    const dk = report.driftKindCounts;
    if (dk.canonicalOutdated > 0 && dk.userModified === 0 && dk.both === 0 && dk.unknown === 0) {
      // Pure canonical drift — regenerating is safe; nothing of the user's to lose.
      info(
        `Run ${chalk.bold("hatch3r sync")} to update ${dk.canonicalOutdated} file(s) whose ` +
        `${chalk.cyan("canonical content changed")}. No local edits were detected, so regenerating is safe.`,
      );
    } else if ((dk.userModified > 0 || dk.both > 0) && dk.canonicalOutdated === 0 && dk.unknown === 0) {
      // Only user edits — sync would overwrite them.
      info(
        `${chalk.bold("hatch3r sync overwrites the managed block.")} ` +
        `${dk.userModified + dk.both} drifted file(s) carry ${chalk.yellow("your edits")}` +
        `${dk.both > 0 ? " (some also have newer canonical content)" : ""} — ` +
        `back them up before running sync if you want to keep them.`,
      );
    } else {
      // Mixed or no-baseline — give the per-tag legend so the operator reads
      // the inline tags above and decides file-by-file.
      info(
        `Drifted files are tagged above: ` +
        `${chalk.cyan("(canonical changed)")} is safe to ${chalk.bold("hatch3r sync")}; ` +
        `${chalk.yellow("(your edit)")} / ${chalk.red("(your edit + canonical changed)")} would be ` +
        `overwritten — back up first. ${chalk.dim("(no baseline)")} means sync has not run since this file was tracked; ` +
        `run sync once to record a baseline for future attribution.`,
      );
    }
    console.log();
  }
  if (report.counts.missing > 0) {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate missing files.`);
    console.log();
  }
  if (report.counts.unexpected > 0) {
    info(`Unexpected files are tracked in the manifest but no longer produced. Run ${chalk.bold("hatch3r clean")} to remove them, or remove them manually.`);
    console.log();
  }

  // D11-SA11.2-F10 (D11, P1): scope disclosure. Drift detection compares only
  // the hatch3r-managed block (HATCH3R:BEGIN/END markers) against regeneration;
  // content you author OUTSIDE those markers is yours and is never reported
  // here. Surface this whenever drift exists so the operator does not read a
  // clean managed-block report as "the whole file is unchanged".
  if (hasDrift) {
    console.log(
      chalk.dim(
        "  Note: drift detection covers hatch3r-managed blocks only " +
        "(HATCH3R:BEGIN/END). Content outside the markers is yours — use `git diff` to inspect it.",
      ),
    );
    console.log();
  }

  // ── CLI tools (plan §4.7 status touchpoint) ────────────────
  const cliSelected = manifest.cliTools?.selected ?? [];
  if (manifest.cliTools?.enabled && cliSelected.length > 0) {
    const cliResults = await detectCliTools(cliSelected);
    const installed = cliResults.filter((r) => r.installed).length;
    const cliLines: string[] = [];
    cliLines.push(label("Installed", `${installed}/${cliResults.length}`));
    const missing = cliResults.filter((r) => !r.installed);
    if (missing.length > 0) {
      cliLines.push("");
      for (const r of missing) {
        // D21-M6 (Cycle 10): differentiate "binary missing" from "extension
        // missing" so the user reaches for the right remediation.
        if (r.extensionMissing) {
          cliLines.push(`  ${chalk.yellow("✗")} ${r.id} — extension missing: ${r.extensionMissing}`);
        } else {
          cliLines.push(`  ${chalk.yellow("✗")} ${r.id} not on PATH`);
        }
      }
      cliLines.push("");
      cliLines.push(chalk.dim(`Run \`npx hatch3r cli-tools install\` to see install commands.`));
    }
    printBox("CLI tools", cliLines, missing.length === 0 ? "success" : "info");
  }

  // ── User content (D20) ─────────────────────────────────────
  // Manifest counters are authoritative when present; otherwise fall back
  // to a live disk scan so user-authored content remains visible even when
  // a pre-D20 manifest is in play.
  let userTypes: Record<string, number> | null = null;
  let userTotal = 0;
  let userLastModified: string | null = null;
  if (manifest.userContent && manifest.userContent.count > 0) {
    userTypes = manifest.userContent.types;
    userTotal = manifest.userContent.count;
    userLastModified = manifest.userContent.lastModified;
  } else {
    try {
      const discovered = await discoverUserContent(rootDir);
      if (discovered.length > 0) {
        const types: Record<string, number> = {};
        for (const e of discovered) {
          types[e.type] = (types[e.type] ?? 0) + 1;
        }
        userTypes = types;
        userTotal = discovered.length;
      }
    } catch (err) {
      verbose(`User content discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (userTypes && userTotal > 0) {
    const userLines: string[] = [];
    for (const [type, count] of Object.entries(userTypes)) {
      if (count > 0) {
        userLines.push(`${type}:`.padEnd(12) + String(count));
      }
    }
    if (userLastModified) {
      userLines.push(`${"Total:".padEnd(12)}${userTotal} item(s), last modified ${userLastModified}`);
    } else {
      userLines.push(`${"Total:".padEnd(12)}${userTotal} item(s)`);
    }
    printBox("User content", userLines, "info");
  }

  // ── Developer productivity (SPACE telemetry, D10-17) ────────
  // Surface the persisted SPACE metrics written by `init.ts` (primary metric
  // `firstRunSuccessRate`). Shown only when telemetry exists so a fresh repo
  // that has never run init keeps the status output compact. This is the
  // reporting surface that makes the SPACE pipeline a wired runtime feature
  // rather than a tested-but-uncalled library (the F10.8-1 integration gap).
  if (spaceTelemetry.recordCount > 0) {
    const spaceLines: string[] = [];
    if (spaceTelemetry.firstRunSuccessRate !== null) {
      const pct = Math.round(spaceTelemetry.firstRunSuccessRate * 100);
      const perfRow = spaceTelemetry.axes.find((a) => a.axis === "performance");
      const runs = perfRow?.count ?? 0;
      spaceLines.push(
        label("First-run success", `${pct}% (${runs} run${runs === 1 ? "" : "s"})`),
      );
    }
    const populatedAxes = spaceTelemetry.axes.filter((a) => a.count > 0);
    for (const a of populatedAxes) {
      spaceLines.push(`  ${a.axis.padEnd(14)}${a.count} metric(s), mean ${a.mean.toFixed(2)}`);
    }
    spaceLines.push(
      chalk.dim(`  ${spaceTelemetry.recordCount} record(s) over the last ${SPACE_TELEMETRY_WINDOW_DAYS} day(s)`),
    );
    printBox("Developer productivity (SPACE)", spaceLines, "info");
  }

  // ── Customizations (SA12.3-F03) ─────────────────────────────
  // Surface the per-artifact .customize.{yaml,md} state that previously stayed
  // silent under the Silent Failure Contract. Default mode prints a one-line
  // "N active (M skipped, K failed)" row; --verbose expands to the per-artifact
  // table identical to `hatch3r explain --customizations`. Skipped when no
  // customization files exist so the status output stays compact for fresh
  // installs.
  //
  // SA12.1-F-D12-M7 (Cycle 10 Wave 3, D12, P1): default mode now ALSO lists
  // the active customizations (capped at 8 rows) so the operator sees which
  // canonical artifacts carry `.hatch3r/*.customize.*` overrides without
  // needing `--verbose` or `hatch3r explain --customizations`. The prior
  // one-line "N active" summary hid the per-artifact id list.
  try {
    const customizationSummary = await buildCustomizationSummary(rootDir);
    if (customizationSummary.entries.length > 0) {
      const c = customizationSummary.counts;
      const oneLine =
        `${chalk.bold(String(c.active))} active` +
        (c.skipped > 0 ? `, ${chalk.yellow(String(c.skipped))} skipped` : "") +
        (c.failed > 0 ? `, ${chalk.red(String(c.failed))} failed` : "");
      const customLines: string[] = [oneLine];
      if (opts?.verbose) {
        customLines.push("");
        for (const entry of customizationSummary.entries) {
          const icon =
            entry.outcome === "failed"
              ? chalk.red("✗")
              : entry.outcome === "skipped"
                ? chalk.yellow("○")
                : entry.outcome === "active"
                  ? chalk.green("✓")
                  : chalk.dim("·");
          const reason = entry.reason ? chalk.dim(` — ${entry.reason}`) : "";
          customLines.push(`  ${icon} ${entry.type}/${entry.id}${reason}`);
        }
      } else {
        // SA12.1-F-D12-M7: list non-active entries first (failed > skipped >
        // active) so problems are immediately visible. Cap the active rows at
        // 8 to keep the box readable on a fresh install with many overrides;
        // the operator runs `--verbose` or `hatch3r explain --customizations`
        // for the full list.
        const FAILED_FIRST = customizationSummary.entries
          .filter((e) => e.outcome === "failed")
          .sort((a, b) => a.id.localeCompare(b.id));
        const SKIPPED_NEXT = customizationSummary.entries
          .filter((e) => e.outcome === "skipped")
          .sort((a, b) => a.id.localeCompare(b.id));
        const ACTIVE_LAST = customizationSummary.entries
          .filter((e) => e.outcome === "active")
          .sort((a, b) => a.id.localeCompare(b.id));
        const visible = [...FAILED_FIRST, ...SKIPPED_NEXT, ...ACTIVE_LAST.slice(0, 8)];
        const hiddenActive = Math.max(0, ACTIVE_LAST.length - 8);
        if (visible.length > 0) {
          customLines.push("");
          for (const entry of visible) {
            const icon =
              entry.outcome === "failed"
                ? chalk.red("✗")
                : entry.outcome === "skipped"
                  ? chalk.yellow("○")
                  : chalk.green("✓");
            const reason = entry.reason ? chalk.dim(` — ${entry.reason}`) : "";
            customLines.push(`  ${icon} ${entry.type}/${entry.id}${reason}`);
          }
          if (hiddenActive > 0) {
            customLines.push(
              chalk.dim(`  … +${hiddenActive} more active (run with --verbose for the full list)`),
            );
          }
        }
        if (c.failed > 0 || c.skipped > 0) {
          customLines.push(chalk.dim(`  Run \`hatch3r explain --customizations\` for the per-artifact table.`));
        }
      }
      printBox(
        "Customizations",
        customLines,
        c.failed > 0 ? "warning" : c.skipped > 0 ? "info" : "success",
      );
    }
  } catch (err) {
    verbose(`Customization summary skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Workspace topology ──────────────────────────────────────
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (wsManifest && wsManifest.repos.length > 0) {
    const wsLines: string[] = [];
    for (const repo of wsManifest.repos) {
      const icon = repo.sync ? chalk.green("✓") : chalk.dim("○");
      let detail: string;
      if (!repo.sync) {
        detail = chalk.dim("sync disabled");
      } else if (repo.lastSync) {
        const elapsed = Math.max(0, Date.now() - new Date(repo.lastSync).getTime());
        const hours = Math.floor(elapsed / (1000 * 60 * 60));
        const timeAgo = hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
        detail = `synced ${timeAgo}`;
      } else {
        detail = chalk.yellow("never synced");
      }
      const identity = repo.owner && repo.repo
        ? chalk.dim(`${repo.owner}/${repo.repo}`)
        : "";
      const branch = repo.defaultBranch
        ? chalk.dim(`[${repo.defaultBranch}]`)
        : "";
      const identityPart = identity || branch ? `  ${identity} ${branch}` : "";
      wsLines.push(`${icon} ${repo.name ?? repo.path}${identityPart}  ${chalk.dim(`(${detail})`)}`);
    }
    printBox(`Workspace: ${wsManifest.name} (${wsManifest.repos.length} repos)`, wsLines, "info");
  }

  // Show workspace membership info if this repo is managed by a workspace
  if (manifest.workspace) {
    const wsInfo = [
      `Managed by workspace at ${chalk.bold(manifest.workspace.rootPath)}`,
      `Last synced: ${manifest.workspace.lastSync ? new Date(manifest.workspace.lastSync).toLocaleString() : "never"}`,
    ];
    printBox("Workspace member", wsInfo, "info");
  }

}
