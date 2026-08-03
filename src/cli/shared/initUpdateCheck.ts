// Sync child-process I/O (spawnSync) is used intentionally: the re-exec hand-off
// replaces the current process's work entirely, so there is nothing to overlap
// with — matching the `hatch3r update` re-exec precedent in
// src/cli/commands/update.ts.

import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { gt as semverGt, valid as semverValid } from "semver";
import { surveyInstalls } from "../../detect/installContext.js";
import { runSelfUpdate, pickReExecBin } from "../../install/selfUpdate.js";
import { readManifest } from "../../manifest/hatchJson.js";
import { fetchLatestUpdateInfo } from "./updateNotifier.js";
import { askConfirm, isBack } from "./initSteps.js";
import { info, verbose, warn } from "./ui.js";
import { resolveInvokedCommand } from "./invokedCommand.js";
import { HatchError } from "../../types.js";

/**
 * release/2.8.6: pre-flight auto-update for `hatch3r init` (and the
 * `hatch3r setup` chain into it).
 *
 * A user who installed hatch3r once and runs `init` months later would
 * otherwise generate stale canonical content and only learn about the newer
 * release from the passive exit-time banner (`checkForUpdates()`), AFTER the
 * stale generation already happened. This module closes that gap: before the
 * first prompt, interactive init probes the registry live (3s hard cap) and,
 * when a newer version exists, offers a one-confirm self-update through the
 * existing `runSelfUpdate` machinery (Sigstore audit gate included), then
 * re-execs the invoked command with the same args so generation runs on
 * current code + content.
 *
 * Contract: the check never blocks init on AVAILABILITY failures. Registry
 * timeout, network error, install failure, re-exec spawn failure — each
 * degrades to "proceed with the current version" (at most one warning line).
 *
 * Direction guard (F-SEC-01, sec-2.8.6-p4): the offer fires ONLY when the
 * registry version is semver-GREATER than the running version. update-notifier
 * `type` is a direction-agnostic `semverDiff`, so without the explicit
 * `semverGt(latest, current)` gate a running version AHEAD of `latest`
 * (prerelease users, or a dist-tag rolled back to an old signed release)
 * would be prompted into a default-Yes DOWNGRADE. The passive banner has
 * always been direction-guarded; this active path is too.
 *
 * Pin skip (F-SEC-02, sec-2.8.6-p4): a manifest `versionConstraint`
 * (`.hatch3r/hatch.json`, the `hatch3r update --pin-version` channel) means
 * "do not move" — the documented defense against dist-tag rollback. The
 * pre-flight is skipped ENTIRELY when the pin is set (verbose note only);
 * probing `latest` and re-execing would bypass the pin that `runSelfUpdate`
 * honors on the explicit path. Manifest absent/unreadable → no pin → the
 * check proceeds normally.
 *
 * Sigstore scope (F-SEC-06, sec-2.8.6-p4): the `npm audit signatures` gate
 * inside `runSelfUpdate` soft-passes with a warning when the environment
 * cannot be audited (`envLimited` — a global install dir without a lockfile
 * makes npm report "found no installed dependencies to audit"; see
 * `src/install/selfUpdate.ts::AuditSignaturesResult.envLimited`). That
 * pre-existing `runSelfUpdate` semantic applies here unchanged: the hard
 * stop below fires on a FAILED verification, not on an unverifiable
 * environment.
 *
 * One security carve-out (review-2.8.6-r1 F1): a signature-verification
 * failure (`HatchError` with `errorCode: "INTEGRITY_ERROR"` from
 * `runSelfUpdate`) is a HARD STOP — npm has already replaced the package on
 * disk when that gate fires (src/install/selfUpdate.ts, C9-H51), so failing
 * open would finish init now and leave an unverifiable hatch3r as the
 * machine's install. The re-thrown error maps to exit 73 and its recovery
 * hint names the version rollback and the explicit-override path. The
 * non-proceeding outcomes are therefore: that signature hard stop, a
 * completed re-exec (parent exits with the child's code), and an explicit
 * user cancel on the npx path (clean exit 0).
 */

/** Options for {@link maybeSelfUpdateBeforeInit}. */
export interface PreInitUpdateCheckOptions {
  /**
   * True on a headless run (`--yes` / `--quick` / `--default`). Headless and
   * CI runs skip the check entirely — there is nobody to answer the confirm,
   * and silently self-updating an automated run would be a supply-chain
   * surprise.
   */
  headless: boolean;
  /**
   * True when `--resume` was passed. A resume re-enters prior work recorded
   * against the CURRENT version's checkpoint baseline; swapping the binary
   * mid-resume would invalidate that baseline, so resume runs skip the check.
   */
  resume: boolean;
  /**
   * True when `--dry-run` was passed (F-SEC-03, sec-2.8.6-p4). Dry-run
   * promises zero mutations, but an accepted pre-flight update npm-installs a
   * package globally and re-execs — both real side effects. Dry-run runs skip
   * the check entirely, same silent class as `resume`.
   */
  dryRun?: boolean;
  /**
   * Full process argv (`[node, script, ...rest]`). Defaults to
   * `process.argv`; injectable for tests.
   */
  argv?: readonly string[];
  /**
   * Override for the child argv used when the self-update re-execs
   * (command token first). `setup` passes `["setup", ".", ...flags]` when
   * chaining into init: by that point setup has already scaffolded the
   * target directory and chdir'd into it, so replaying the ORIGINAL argv
   * (`setup <dir>`) from the inherited cwd would scaffold a nested
   * `<dir>/<dir>`. Absent, the argv is derived via
   * {@link buildInitReExecArgv}.
   */
  reExecArgv?: readonly string[];
}

/**
 * Build the re-exec child argv from the original process argv: the invoked
 * command token first (resolved via `resolveInvokedCommand`, which skips
 * leading global flags — the D1-8 contract), followed by every other user
 * token in original order, preserving all flags and values.
 *
 * `--no-banner` is appended (only when absent, and only for `init`, the one
 * chained command that registers the flag — see `src/cli/program.ts`)
 * because the parent already printed the banner before the check ran; the
 * `HATCH3R_RE_EXEC` guard on init's banner gate covers the `setup` child,
 * which has no `--no-banner` registration.
 *
 * Shares `resolveInvokedCommand`'s documented limitation: a bare (non-dash)
 * flag VALUE placed before the command token would be mis-read as the
 * command. The CLI's global pre-command flags are boolean-style
 * (`--no-update-check`, stripped before parse anyway), so the limitation is
 * theoretical — and identical to the entry point's own BACKABLE resolution.
 */
export function buildInitReExecArgv(argv: readonly string[]): string[] {
  const rest = argv.slice(2);
  const command = resolveInvokedCommand(argv) ?? "init";
  const commandIdx = rest.indexOf(command);
  const passThrough =
    commandIdx === -1 ? [...rest] : rest.filter((_, i) => i !== commandIdx);
  const args = [command, ...passThrough];
  if (command === "init" && !args.includes("--no-banner")) {
    args.push("--no-banner");
  }
  return args;
}

/** POSIX 128+signal exit codes for a signal-terminated re-exec child. */
function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

/**
 * Offer a pre-flight self-update before interactive init runs its first
 * prompt. See the module doc for the full contract. Outcomes:
 *
 * - **returns (void)** — proceed with the currently-running version. Covers
 *   every skip condition, an up-to-date install, a declined update, an
 *   accepted-but-impossible update (npx + continue), and every failure mode.
 * - **`process.exit(childCode)`** — the self-update succeeded and the
 *   freshly-installed binary re-ran the invoked command to completion; the
 *   parent adopts the child's exit code (mirrors `hatch3r update`'s re-exec).
 * - **throws `HatchError(…, 0)`** — the user chose to cancel on the npx path
 *   (clean user cancel, exit 0 — the `Init cancelled.` house convention).
 * - **throws `HatchError(INTEGRITY_ERROR)`** — the accepted self-update
 *   installed a package that then failed `npm audit signatures`. Init halts
 *   (exit 73 via `ERROR_CODE_TO_EXIT_CODE`) with a rollback + override hint
 *   instead of proceeding on an unverifiable install; no re-exec is spawned.
 *
 * Skip conditions (all silent, checked before any network or subprocess):
 * re-exec child (`HATCH3R_RE_EXEC=1`), explicit opt-out
 * (`HATCH3R_NO_UPDATE_CHECK=1`, set by the global `--no-update-check` strip
 * in `src/cli/index.ts`), the update-notifier library-wide opt-outs
 * (`NO_UPDATE_NOTIFIER` env PRESENT with any value, or `--no-update-notifier`
 * in argv — F-SEC-05: they silence the passive banner, so the active path
 * honors them identically), `NODE_ENV=test`, CI (`CI` env truthy), headless
 * (`--yes`/`--quick`/`--default`), `--resume`, `--dry-run` (F-SEC-03),
 * non-TTY stdin or stdout, a manifest `versionConstraint` pin (F-SEC-02,
 * verbose note), and a dev-source checkout (never self-mutate a working
 * tree — same rule as `runSelfUpdate`).
 */
export async function maybeSelfUpdateBeforeInit(
  opts: PreInitUpdateCheckOptions,
): Promise<void> {
  // ── Skip gates: environment ────────────────────────────────────────────
  if (process.env.HATCH3R_RE_EXEC === "1") return;
  if (process.env.HATCH3R_NO_UPDATE_CHECK === "1") return;
  // F-SEC-05 (sec-2.8.6-p4): the update-notifier library-wide opt-outs
  // (honored by the passive banner via the library itself) bind the active
  // probe identically — env form and argv form. PRESENCE check, not
  // truthiness (N-2): update-notifier itself treats `NO_UPDATE_NOTIFIER` as
  // set-means-opt-out, so `NO_UPDATE_NOTIFIER=""` must skip here too.
  if ("NO_UPDATE_NOTIFIER" in process.env) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.CI) return;
  const argv = opts.argv ?? process.argv;
  if (argv.includes("--no-update-notifier")) return;
  // ── Skip gates: run shape ──────────────────────────────────────────────
  if (opts.headless) return;
  if (opts.resume) return;
  // F-SEC-03 (sec-2.8.6-p4): dry-run promises zero mutations; an accepted
  // update would npm-install globally and re-exec. Skip entirely.
  if (opts.dryRun === true) return;
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return;

  const cwd = process.cwd();

  // ── Skip gate: versionConstraint pin (F-SEC-02, sec-2.8.6-p4) ──────────
  // A manifest pin means "do not move" — `runSelfUpdate` would honor it on
  // the explicit path only when threaded through, and comparing against
  // `latest` contradicts the pin's purpose (dist-tag-rollback defense), so
  // the pre-flight skips outright. A fresh init has NO manifest (readManifest
  // → null on ENOENT), and a MALFORMED one throws — init's own manifest
  // handling surfaces that later; for the pre-flight either shape means "no
  // pin readable", hence the catch-to-null.
  const manifest = await readManifest(cwd).catch(() => null);
  if (manifest?.versionConstraint) {
    verbose(
      `Pre-flight update check skipped: hatch3r is pinned to '${manifest.versionConstraint}' ` +
        `(.hatch3r/hatch.json::versionConstraint). Run \`hatch3r update --pin-version latest\` to clear the pin.`,
    );
    return;
  }

  // ── Skip gate: install context (dev-source) ────────────────────────────
  let invokedKind: "npx" | "global" | "project-local" | "dev-source";
  try {
    invokedKind = (await surveyInstalls(cwd)).invokedFrom.kind;
  } catch (err) {
    // Fail open: a survey failure (e.g. an unreadable npm prefix) must not
    // block init — without a classification we cannot safely self-update,
    // so proceed with the current version.
    warn(
      `Pre-flight update check skipped (install survey failed: ${err instanceof Error ? err.message : String(err)}).`,
    );
    return;
  }
  if (invokedKind === "dev-source") return;

  // ── Live registry probe (3s hard cap, silent fail-open) ────────────────
  const fetched = await fetchLatestUpdateInfo();
  if (fetched === null || fetched.type === "latest") return;
  // F-SEC-01 (sec-2.8.6-p4): direction guard. `type` is a direction-agnostic
  // `semverDiff` — it is non-"latest" in BOTH directions, so a running
  // version AHEAD of registry `latest` (prerelease build, or an attacker
  // rolling the dist-tag back to an old signed release) would otherwise get
  // a default-Yes DOWNGRADE prompt. Only a strictly-newer registry version
  // proceeds; `semverValid` (never throws) shields `semverGt` from a
  // malformed registry version — fail open, no prompt.
  if (
    semverValid(fetched.latest) === null ||
    semverValid(fetched.current) === null ||
    !semverGt(fetched.latest, fetched.current)
  ) {
    return;
  }

  // ── One confirm, default Yes ───────────────────────────────────────────
  const updateAnswer = await askConfirm({
    name: "updateHatch3r",
    message: `hatch3r ${fetched.latest} is available (you're running ${fetched.current}). Update now so init generates current content?`,
    default: true,
  });
  // Decline — proceed with the current version, no nagging. Shift+Tab (BACK)
  // has no earlier step to return to here, so it takes the same fail-open
  // path as a decline.
  if (isBack(updateAnswer) || updateAnswer !== true) return;

  const commandName = opts.reExecArgv?.[0] ?? resolveInvokedCommand(argv) ?? "init";

  // ── npx: the cache is read-only — advise @latest, confirm continue ─────
  if (invokedKind === "npx") {
    info(
      `npx runs hatch3r from a read-only cache, so it cannot update itself in place. ` +
        `Re-run \`npx hatch3r@latest ${commandName}\` to use v${fetched.latest}.`,
    );
    const continueAnswer = await askConfirm({
      name: "continueWithCurrent",
      message: `Continue with v${fetched.current} instead?`,
      default: true,
    });
    // Continue (or BACK) — proceed with the current version.
    if (isBack(continueAnswer) || continueAnswer === true) return;
    console.log(chalk.dim("\n  Init cancelled.\n"));
    // Exit 0 + no recoveryHint: user-initiated cancellation is success
    // (same convention as the overwrite-guard cancel in init.ts).
    throw new HatchError("Init cancelled.", 0);
  }

  // ── global / project-local: self-update via the existing machinery ─────
  let updateResult;
  try {
    // Defaults preserved: no version pin, Sigstore `npm audit signatures`
    // gate active (skipAuditSignatures unset).
    updateResult = await runSelfUpdate(cwd);
  } catch (err) {
    // Signature-failure hard stop (review-2.8.6-r1 F1). `runSelfUpdate`
    // throws HatchError(INTEGRITY_ERROR) AFTER `npm install` already replaced
    // the package on disk (selfUpdate.ts C9-H51 audit gate), so "fail open"
    // here would not preserve the status quo — it would finish init on the
    // in-memory pre-update code while leaving an UNVERIFIED hatch3r as the
    // on-disk install for every later run. Halt instead: no re-exec spawn,
    // exit 73 via the ERROR_CODE_TO_EXIT_CODE mapping (exitCode omitted),
    // rollback + explicit-override remediation in the recovery hint.
    if (err instanceof HatchError && err.errorCode === "INTEGRITY_ERROR") {
      const rollbackCmd =
        invokedKind === "global"
          ? `npm install -g hatch3r@${fetched.current}`
          : `npm install hatch3r@${fetched.current}`;
      throw new HatchError(
        `Init halted: the pre-flight self-update installed hatch3r ${fetched.latest}, but its signature verification failed (${err.message})`,
        undefined,
        "INTEGRITY_ERROR",
        `The unverified package is now on disk. Roll back to the version you were running with \`${rollbackCmd}\`, ` +
          `or verify the package out-of-band and then accept it explicitly with \`hatch3r update --skip-audit-signatures\`. ` +
          `Re-run \`hatch3r init\` after either step.`,
        { cause: err },
      );
    }
    // Fail open — one warning line, then init proceeds on the version that
    // is already running (its own code + bundled content were loaded before
    // any install attempt). Covers the availability failure classes only:
    // network error, registry/install timeout, generic package-manager
    // failure. INTEGRITY_ERROR is excluded above — `hatch3r update` remains
    // the strict path for retries.
    warn(
      `Pre-flight self-update failed: ${err instanceof Error ? err.message : String(err)} ` +
        `— continuing init with v${fetched.current}. Run \`hatch3r update\` later to retry.`,
    );
    return;
  }

  const reExecBin = pickReExecBin(updateResult);
  if (reExecBin === null) {
    // Nothing was actually updated (e.g. the Windows global-shim skip);
    // runSelfUpdate already printed the per-target reason. Proceed.
    return;
  }

  const childArgs = opts.reExecArgv ? [...opts.reExecArgv] : buildInitReExecArgv(argv);
  info(`Re-running \`hatch3r ${commandName}\` with freshly installed hatch3r (${reExecBin})`);
  const child = spawnSync(reExecBin, childArgs, {
    stdio: "inherit",
    env: { ...process.env, HATCH3R_RE_EXEC: "1" },
  });
  if (child.error) {
    // The spawn itself failed (the install DID land). Fail open in-process:
    // the running code is still the pre-update version it loaded at startup.
    warn(
      `Could not relaunch \`hatch3r ${commandName}\` after the update (${child.error.message}) ` +
        `— continuing init with v${fetched.current}.`,
    );
    return;
  }
  if (child.signal) {
    // Mirror update.ts's D8-SA8.1-F8.1.9 handling: a signal-terminated child
    // (Ctrl-C mid-init) propagates the POSIX 128+signal code, not a generic 1.
    process.exit(signalExitCode(child.signal));
  }
  process.exit(child.status ?? 0);
}
