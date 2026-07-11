import chalk from "chalk";
import { HatchError, type HatchManifest } from "../../types.js";
import { readManifest } from "../../manifest/hatchJson.js";
import {
  classifyVersionSkew,
  computeAdapterDrift,
  installedOlderSkewHint,
  renderDiffSummaryLines,
  renderDriftLines,
  type DriftReport,
  type VersionSkewDirection,
} from "./status.js";
import { runRegenerate } from "./update.js";
import { scanManagedBlockTampering } from "./validate.js";
import { emitJson } from "../shared/output.js";
import { beginCommand } from "../shared/commandOutput.js";
import {
  assertManifest,
  MISSING_MANIFEST_MESSAGE,
  MISSING_MANIFEST_HINT,
} from "../shared/requireManifest.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  createSpinner,
  isQuiet,
  printBox,
  printNextSteps,
  info,
  warn,
} from "../shared/ui.js";

/** Default verify-fix cycles when `--fix` is given without `--max-fix-attempts`. */
const DEFAULT_MAX_FIX_ATTEMPTS = 2;
/** Hard ceiling on verify-fix cycles, matching the `--max-fix-attempts` help text. */
const MAX_FIX_ATTEMPTS_CEILING = 5;

/**
 * Options for the verify command.
 *
 * Wave 7 reduced verify to a thin drift-detection wrapper over
 * `computeAdapterDrift` (drift is adapter regeneration vs. on-disk output, not
 * a frozen hash manifest). Cycle 10 (D11-H-6) re-attached the advertised
 * `--fix` / `--max-fix-attempts` flags to that drift definition so the flags
 * declared in `program.ts` are honored instead of silently ignored
 * (Silent-Failure-Contract, P5). `--fix` repairs drift by regenerating adapter
 * output (the same in-memory regeneration `hatch3r sync` performs) up to
 * `--max-fix-attempts` times, re-checking drift after each pass.
 *
 * D12-SA12.1-F04 (Cycle 10, P1): verify is READ-ONLY in its default (no
 * `--fix`) mode — it only reads the manifest and compares regenerated output
 * against on-disk files, never writing. There is therefore intentionally NO
 * `--dry-run` flag: verify IS the preview (analogous to `git status` having no
 * `--dry-run`). The write-side preview lives on the destructive twins,
 * `hatch3r sync --dry-run` and `hatch3r update --dry-run`; a `verify --dry-run`
 * would be a tautology of the default report.
 *
 * D12-SA12.2-F5 (D12, P1): `--diff` adds a symmetric before/after summary box
 * (the same one `hatch3r sync --diff` and `hatch3r status --diff` render) so an
 * operator can see WHICH files drifted without re-running sync. It is read-only
 * — it re-renders the already-computed drift report, never writes — so it does
 * not contradict the no-`--dry-run` rationale above (which is about write
 * previews, not the read-only drift summary).
 */
export interface VerifyOptions {
  /** Auto-repair drifted/missing adapter output by regenerating it. */
  fix?: boolean;
  /** Maximum regenerate→re-check cycles (default 2, clamped to [1, 5]). */
  maxFixAttempts?: number;
  /**
   * SA12.1-F-D12-M2 (D12, P1): output format for CI consumers. `"json"`
   * emits a one-shot structured payload to stdout; `"human"` (default) keeps
   * the legacy decorated chrome.
   */
  format?: string;
  /**
   * D12-SA12.2-F5 (D12, P1): when set, print the sync-style "Diff summary" box
   * (added/modified/unchanged/orphan per file) after the PASS/FAIL box.
   */
  diff?: boolean;
  /**
   * D1-SA1.4-F11 (Cycle 10 Wave 4, P1): when set, print the per-tool / per-file
   * drift breakdown ({@link renderDriftLines}) before the PASS/FAIL summary box
   * in human mode — the same detail `hatch3r status` shows — so an operator who
   * sees `verify: FAIL (3 drift(s))` learns WHICH files drifted without
   * re-running `status`. CI brevity is preserved: the breakdown is opt-in and
   * JSON mode already carries the full `entries` list.
   */
  verbose?: boolean;
  /**
   * W5: suppress stdout chrome (banner, spinner, PASS/FAIL box, next steps);
   * stderr diagnostics still emit. Wired through `beginCommand`.
   */
  quiet?: boolean;
}

/** Render the drift counts as boxed summary lines (shared by report + fix paths). */
function buildSummaryLines(report: DriftReport): string[] {
  const summaryLines: string[] = [
    `${chalk.green("✔")} In sync:    ${report.counts.synced}`,
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
  return summaryLines;
}

function driftCountOf(report: DriftReport): number {
  return report.counts.modified + report.counts.missing + report.counts.unexpected;
}

/**
 * D1-SA1.4-F10 (Cycle 10, P1): build the recovery hint for a drifted report.
 * `hatch3r sync` regenerates drifted/missing managed output but does NOT remove
 * orphan (`unexpected`) files — those are cleared by `hatch3r clean`. The prior
 * verify hint pointed every drift category at `sync`, so an operator whose only
 * drift was orphan files ran `sync`, saw it do nothing, and was left confused.
 * This mirrors the per-category guidance status already emits (status.ts: sync
 * for missing, clean for unexpected): emit `clean` when the drift is purely
 * orphan files, `sync` when drift includes drifted/missing output (and append a
 * `clean` note when orphans also coexist).
 */
function buildRecoveryHint(report: DriftReport, olderSkewHint?: string): string {
  const { modified, missing, unexpected } = report.counts;
  const hasSyncable = modified > 0 || missing > 0;
  if (!hasSyncable && unexpected > 0) {
    // Orphan-only drift — `clean`, not `sync`; version skew is irrelevant
    // (clean removes files, it never regenerates from canonical).
    return "Run `hatch3r clean` to remove unexpected files no longer produced by any adapter.";
  }
  // D1-SA1.4-04 (D1, P1): installed-older + real (syncable) drift → `sync`/`--fix`
  // would regenerate from the OLDER canonical set and DOWNGRADE the files. Point
  // at `update` first (the `olderSkewHint` sentence) instead of sync.
  if (olderSkewHint && hasSyncable) {
    return unexpected > 0
      ? `${olderSkewHint} Run \`hatch3r clean\` to remove the unexpected (orphan) file(s).`
      : olderSkewHint;
  }
  const base =
    "Run `hatch3r sync` to regenerate drifted/missing files, or `hatch3r verify --fix` to auto-repair.";
  return unexpected > 0
    ? `${base} Run \`hatch3r clean\` to remove the unexpected (orphan) file(s).`
    : base;
}

/**
 * D12-SA12.2-F5 (D12, P1): print the sync-style "Diff summary" box when
 * `--diff` is set. Shared renderer ({@link renderDiffSummaryLines}) so verify,
 * status, and sync all emit the identical added/modified/unchanged/orphan box.
 * No-op in JSON mode (the per-entry list is already in the JSON payload) and
 * when `--diff` is absent.
 */
function maybePrintDiffSummary(options: VerifyOptions, report: DriftReport): void {
  if (!options.diff) return;
  const diffLines = renderDiffSummaryLines(report);
  if (diffLines.length > 0) {
    printBox("Diff summary", diffLines, "info");
    console.log();
  }
}

/**
 * D1-SA1.4-F11 (Cycle 10 Wave 4, P1): print the per-tool / per-file drift
 * breakdown when `--verbose` is set, mirroring what `hatch3r status` shows.
 * Shared renderer ({@link renderDriftLines}) so status and verbose-verify emit
 * identical per-file lines. No-op in JSON mode (the per-entry list is already
 * in the JSON payload), when `--verbose` is absent, or when there are no
 * entries to show.
 */
function maybePrintVerboseDrift(options: VerifyOptions, report: DriftReport): void {
  if (!options.verbose) return;
  const driftLines = renderDriftLines(report);
  if (driftLines.length > 0) {
    for (const line of driftLines) console.log(line);
    console.log();
  }
}

/**
 * D15-6 (SA15.4-F2, D15, P6): print the structural marker-tamper findings
 * returned by {@link scanManagedBlockTampering} as a warning box. The drift
 * comparison in {@link computeAdapterDrift} only diffs the EXTRACTED managed
 * block, so a hand-broken HATCH3R:BEGIN/END marker (orphan, duplicate, or
 * wrong host-comment syntax) is invisible to it — yet `docs/troubleshooting.md`
 * advertises verify as detecting "drift or tampering". This surfaces the
 * structural scan on the verify path so that promise holds. Findings are
 * advisory (warnings, never a hard FAIL) per the scanner's own contract, so
 * verify's drift-based PASS/FAIL exit code is unchanged. No-op when the scan
 * is clean. JSON mode carries the findings in the payload instead (handled in
 * {@link verifyCommand}), so this human-only renderer is skipped there.
 */
function printTamperWarnings(tamperWarnings: string[]): void {
  if (tamperWarnings.length === 0) return;
  const lines = tamperWarnings.map((w) => `${chalk.yellow("!")} ${w}`);
  printBox(
    `Managed-block structural warnings (${tamperWarnings.length})`,
    lines,
    "warning",
  );
}

/**
 * Bounded regenerate→re-check loop backing `verify --fix`. Each iteration
 * regenerates adapter output from the bundled canonical content (no network)
 * and recomputes drift. Returns the final report; the caller decides PASS/FAIL.
 */
async function runFixLoop(
  rootDir: string,
  manifest: HatchManifest,
  requestedAttempts: number | undefined,
): Promise<DriftReport> {
  const raw = Number.isFinite(requestedAttempts) ? Number(requestedAttempts) : DEFAULT_MAX_FIX_ATTEMPTS;
  const attempts = Math.min(Math.max(Math.trunc(raw), 1), MAX_FIX_ATTEMPTS_CEILING);

  let report = await computeAdapterDrift(rootDir, manifest);
  for (let attempt = 1; attempt <= attempts && driftCountOf(report) > 0; attempt++) {
    info(`--fix attempt ${attempt}/${attempts}: regenerating drifted adapter output...`);
    const result = await runRegenerate(rootDir, manifest, { snapshotCommandName: "verify-fix" });
    if (result.failedTools > 0 && result.syncedTools === 0) {
      warn(`Regeneration produced no output (${result.failedTools} tool(s) failed); aborting --fix loop.`);
      break;
    }
    report = await computeAdapterDrift(rootDir, manifest);
  }
  return report;
}

export async function verifyCommand(options: VerifyOptions = {}): Promise<void> {
  // SA12.1-F-D12-M2 (D12, P1): JSON mode emits a single structured document
  // for CI consumers (PASS/FAIL + drift counts + per-entry list). Human mode
  // keeps the legacy decorated chrome (banner, spinner, printBox panels).
  // W5: beginCommand resolves format/quiet AND routes `--verbose` through
  // `setVerbose`, so the `verbose()` diagnostics inside computeAdapterDrift
  // now emit on `verify --verbose` (previously the flag was read directly and
  // the channel never enabled).
  const format = beginCommand(options, { banner: "compact" });
  const jsonMode = format === "json";

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  if (!manifest) {
    // D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): in JSON mode emit the structured
    // error payload first, then delegate the throw (and, in human mode, the
    // canonical two-line stderr) to the shared `assertManifest` helper so the
    // message + exit-code contract is byte-identical across every
    // manifest-required command.
    if (jsonMode) {
      emitJson({
        status: "failed",
        error: MISSING_MANIFEST_MESSAGE,
        errorCode: "CONFIG_ERROR",
        recoveryHint: MISSING_MANIFEST_HINT,
        hatch3rVersion: HATCH3R_VERSION,
        timestamp: new Date().toISOString(),
      });
    }
    assertManifest(manifest, { jsonMode });
  }

  // D1-SA1.4-04 (D1, P1): version-skew detection. `status` and `verify` are the
  // two commands whose job is explaining drift, yet neither read the manifest's
  // recorded writer version before this — so a stale (older) global install
  // following verify's `sync`/`--fix` hint silently DOWNGRADED the outputs.
  // Surface the direction (JSON) and, when installed-older, flip the human
  // disclosure + recovery hint to `update` first (see `buildRecoveryHint`).
  const skewDirection: VersionSkewDirection = classifyVersionSkew(
    manifest.hatch3rVersion,
    HATCH3R_VERSION,
  );
  const olderSkewHint =
    skewDirection === "installed-older"
      ? installedOlderSkewHint(manifest.hatch3rVersion, HATCH3R_VERSION)
      : undefined;

  let report: DriftReport;
  if (options.fix) {
    report = await runFixLoop(rootDir, manifest, options.maxFixAttempts);
  } else {
    const spinner = jsonMode ? null : createSpinner("Verifying adapter-output drift...");
    spinner?.start();
    report = await computeAdapterDrift(rootDir, manifest);
    spinner?.stop();
  }

  // D15-6 (SA15.4-F2, D15, P6): the drift comparison above only diffs the
  // extracted managed block, so structural marker tampering (orphan/duplicate
  // markers, wrong host-comment syntax) slips past it. `docs/troubleshooting.md`
  // advertises verify as detecting "drift or tampering", so run the same
  // structural scan `validate` runs and surface its findings here. Read-only and
  // advisory: tamper findings are warnings, never a hard FAIL, so verify's
  // drift-based PASS/FAIL exit code (and the CI contract) is unchanged. After
  // `--fix` regenerates output, a re-scan reflects any markers the regeneration
  // repaired.
  const tamperWarnings = await scanManagedBlockTampering(rootDir);

  const driftCount = driftCountOf(report);
  const summaryLines = buildSummaryLines(report);

  if (jsonMode) {
    emitJson({
      status: driftCount === 0 ? "pass" : "fail",
      driftCount,
      counts: report.counts,
      driftKindCounts: report.driftKindCounts,
      entries: report.entries,
      // D15-6 (D15, P6): structural marker-tamper findings (advisory; do not
      // affect `status`). Empty array when the marker structure is well-formed.
      tamperWarnings,
      fixApplied: !!options.fix,
      // D1-SA1.4-04 (D1, P1): the manifest's recorded writer version + skew
      // direction. `hatch3rVersion` below is the RUNNING CLI; a CI consumer
      // needs `manifestHatch3rVersion` + `versionSkewDirection` to detect an
      // installed-older downgrade hazard (mirrors status's `installation` block).
      manifestHatch3rVersion: manifest.hatch3rVersion,
      versionSkew: manifest.hatch3rVersion !== HATCH3R_VERSION,
      versionSkewDirection: skewDirection,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    if (driftCount === 0) return;
    throw new HatchError(
      `Adapter output drift detected (${driftCount} file(s))`,
      undefined,
      "INTEGRITY_ERROR",
      buildRecoveryHint(report, olderSkewHint),
    );
  }

  // D1-SA1.4-04 (D1, P1): one-line human skew disclosure, shown on both PASS and
  // FAIL. `info` is a no-op under --quiet/json, so CI/JSON callers are
  // unaffected. installed-older names the downgrade hazard in yellow; the
  // (benign) installed-newer upgrade case is a dim note so the operator can
  // attribute expected canonical drift to the CLI bump.
  if (skewDirection !== "none") {
    info(
      skewDirection === "installed-older"
        ? chalk.yellow(olderSkewHint!)
        : chalk.dim(
            `Version skew: installed hatch3r v${HATCH3R_VERSION} is newer than the ` +
              `v${manifest.hatch3rVersion} that generated these files (drift from the upgrade is expected).`,
          ),
    );
  }

  if (driftCount === 0) {
    // D1-SA1.4-F11 (P1): `--verbose` prints the per-tool breakdown even on PASS
    // so an operator can confirm exactly which adapter outputs were checked.
    maybePrintVerboseDrift(options, report);
    printBox("verify: PASS", summaryLines, "success");
    maybePrintDiffSummary(options, report);
    // D15-6 (D15, P6): the managed-block CONTENT can match canonical (no drift)
    // while the marker STRUCTURE is broken — surface the structural scan even on
    // a drift-clean PASS so a hand-broken marker is not silently passed.
    printTamperWarnings(tamperWarnings);
    // W5: PASS-path follow-up (self-gated under --quiet).
    printNextSteps(["No drift. `hatch3r validate` covers structural checks."]);
    return;
  }

  // D1-SA1.4-F11 (P1): on FAIL, `--verbose` prints WHICH files drifted (per
  // tool) before the summary box, so the operator does not have to re-run
  // `hatch3r status` to learn the drift detail.
  maybePrintVerboseDrift(options, report);
  // D1-SA1.4-F10 (P1): the recovery hint is now drift-category-aware so an
  // orphan-only failure points at `hatch3r clean`, not `hatch3r sync` (which
  // would do nothing). Mirrors status.ts per-category guidance. D1-SA1.4-04:
  // `olderSkewHint` additionally flips syncable drift to `update`-first when the
  // installed CLI is older than the manifest's writer.
  const recoveryHint = buildRecoveryHint(report, olderSkewHint);
  printBox(`verify: FAIL (${driftCount} drift(s))`, summaryLines, "error");
  maybePrintDiffSummary(options, report);
  // D15-6 (D15, P6): structural marker warnings are advisory and orthogonal to
  // the drift FAIL above — print them alongside so a run that both drifted AND
  // has broken markers reports both, not just the drift.
  printTamperWarnings(tamperWarnings);
  if (options.fix) {
    info(`--fix could not clear all drift — run ${chalk.bold("hatch3r sync")} or inspect the failing tool(s).`);
  } else {
    info(recoveryHint);
    // W5: FAIL-path follow-up. Skipped after --fix (re-suggesting --fix when
    // the fix loop just failed would be circular; the info line above already
    // points at sync). Self-gated under --quiet.
    printNextSteps([
      "Run `hatch3r verify --fix` to regenerate, or `hatch3r status --diff` to inspect first.",
    ]);
  }
  // D11-SA11.2-F10 (D11, P1): scope disclosure — verify compares only the
  // hatch3r-managed block, never content outside HATCH3R:BEGIN/END. Mirrors the
  // note status emits so the two commands describe their scope identically.
  // W5: raw stdout writes are gated under --quiet (printBox/info self-gate;
  // these two do not).
  if (!isQuiet()) {
    console.log(
      chalk.dim(
        "  Note: verify covers hatch3r-managed blocks only (HATCH3R:BEGIN/END). " +
        "Content outside the markers is yours — use `git diff` to inspect it.",
      ),
    );
    console.log();
  }
  throw new HatchError(
    `Adapter output drift detected (${driftCount} file(s))`,
    undefined,
    "INTEGRITY_ERROR",
    recoveryHint,
  );
}
