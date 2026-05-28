import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { HATCH3R_DIR, HatchError, type HatchManifest } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { discoverUserContent } from "../../content/userContent.js";
import { buildCustomizationSummary } from "../../adapters/customizationSummary.js";
import { emitJson, parseFormatOption, type CliOutputFormat } from "../shared/output.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
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

/**
 * F2.7-F5 / SA12.4-F1 (D2/D12): canonical normalization used by BOTH the
 * provenance writer (`sync.ts`) and this drift reader, so the emit-time hash
 * matches the hash derived from an on-disk file. Hashes the trimmed managed
 * block when one is present (the part hatch3r owns and overwrites), else the
 * full content. The same logic mirrors the comparison in
 * {@link computeAdapterDrift}: there, on-disk block is compared to expected
 * block; here we reduce each side to a stable sha256 so a stored baseline can
 * be compared across runs without retaining full file bodies.
 */
export function hashEmittedContent(content: string, managedContent?: string): string {
  const block = extractManagedBlock(content) ?? managedContent ?? null;
  const payload = block !== null ? block.trim() : content;
  return createHash("sha256").update(payload).digest("hex");
}

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
 * Wave 7: regenerate every adapter's output in memory (from the bundled
 * content root, no `.agents/` involvement) and compare against on-disk
 * output. The integrity-manifest fast path was removed with the integrity
 * subsystem (Wave 7); this is the only path.
 *
 * `verifyCommand` reuses this exact helper so verify+status share one
 * drift definition.
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
        const existingBlock = extractManagedBlock(existing);
        // Prefer extracting from the regenerated content rather than the raw
        // managedContent hint: `wrapInManagedBlock` / `extractManagedBlock`
        // trim their payload, and several adapters pass an un-trimmed body
        // in `out.managedContent` for convenience. Comparing trimmed-on-disk
        // against raw-from-managedContent produced spurious "modified"
        // entries on every status call.
        const expectedBlock = extractManagedBlock(out.content) ?? out.managedContent ?? null;
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
          const onDiskHash = hashEmittedContent(existing);
          const regeneratedHash = hashEmittedContent(out.content, out.managedContent ?? undefined);
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

/** Render the per-file drift lines for printing in status / verify output. */
function renderDriftLines(report: DriftReport): string[] {
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

export async function statusCommand(opts?: { verbose?: boolean; format?: string }): Promise<void> {
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
    if (jsonMode) {
      emitJson({
        status: "failed",
        error: "No .hatch3r/hatch.json found.",
        errorCode: "CONFIG_ERROR",
        recoveryHint: "Run `npx hatch3r init` to set up your project first.",
        timestamp: new Date().toISOString(),
        hatch3rVersion: HATCH3R_VERSION,
      });
    } else {
      logError("No .hatch3r/hatch.json found.");
      console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    }
    throw new HatchError(
      "No .hatch3r/hatch.json found.",
      undefined,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  const spinner = jsonMode ? null : createSpinner("Checking adapter-output drift...");
  spinner?.start();

  verbose(`Checking ${manifest.tools.length} tool(s): ${manifest.tools.join(", ")}`);

  const report = await computeAdapterDrift(rootDir, manifest);

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
