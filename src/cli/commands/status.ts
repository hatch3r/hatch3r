import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { HatchError, type HatchManifest } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { discoverUserContent } from "../../content/userContent.js";
import { buildCustomizationSummary } from "../../adapters/customizationSummary.js";
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
}

export interface DriftReport {
  entries: DriftEntry[];
  counts: { synced: number; modified: number; missing: number; unexpected: number };
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
  const entries: DriftEntry[] = [];

  const canonicalContentRoot = resolveBundledContentRoot();
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
          entries.push({ path: out.path, tool, status: "modified" });
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

  return { entries, counts };
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
          lines.push(`  ${chalk.yellow("~")} ${entry.path} ${chalk.dim("(drifted)")}`);
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

export async function statusCommand(opts?: { verbose?: boolean }): Promise<void> {
  setVerbose(!!opts?.verbose);
  printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .hatch3r/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError(
      "No .hatch3r/hatch.json found.",
      1,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  const spinner = createSpinner("Checking adapter-output drift...");
  spinner.start();

  verbose(`Checking ${manifest.tools.length} tool(s): ${manifest.tools.join(", ")}`);

  const report = await computeAdapterDrift(rootDir, manifest);

  spinner.stop();
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
    // F2.7-F5 (Cycle 10 Wave 2, partial): the `modified` status alone does not
    // attribute drift direction — `computeAdapterDrift` cannot tell a user edit
    // from an outdated canonical block without a stored emit-time baseline
    // (none exists yet; the manifest tracks paths, not per-file content hashes).
    // Until that provenance lands (sidecar `.hatch3r/.drift-baseline.json` or an
    // embedded hash+version line), surface the overwrite risk explicitly so the
    // operator does not lose hand edits by running `sync` blind.
    info(
      `Run ${chalk.bold("hatch3r sync")} to regenerate drifted files. ` +
      `${chalk.yellow("Drifted")} files differ from the regenerated output — this can mean either ` +
      `your hand edits inside the managed block OR an outdated block from a newer canonical version. ` +
      `${chalk.bold("sync overwrites the managed block")}; back up local edits first if unsure.`,
    );
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
        cliLines.push(`  ${chalk.yellow("✗")} ${r.id} not on PATH`);
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
      } else if (c.failed > 0 || c.skipped > 0) {
        customLines.push(chalk.dim(`  Run \`hatch3r explain --customizations\` for the per-artifact table.`));
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
