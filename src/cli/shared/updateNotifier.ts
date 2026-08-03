import updateNotifier, { type UpdateInfo } from "update-notifier";
import chalk from "chalk";
import { HATCH3R_VERSION } from "../../version.js";

// Consumed by the init pre-flight auto-update (src/cli/shared/initUpdateCheck.ts).
export type { UpdateInfo };

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Hard cap on the live registry probe in {@link fetchLatestUpdateInfo}.
 * Kept short (3s) because the probe runs inline on interactive `init`
 * startup — a slow or unreachable registry must never noticeably delay init.
 */
export const FETCH_INFO_TIMEOUT_MS = 3_000;

/**
 * Build the hatch3r-flavored update banner shown by update-notifier.
 *
 * The library prints `npm i -g hatch3r` automatically when invoked from a
 * global install, and `npm i hatch3r` when invoked from a project — its
 * `is-installed-globally` detection drives the distinction. We layer on a
 * "Run `hatch3r update` to refresh content too" hint because a fresh CLI
 * does nothing for the user's project until they regenerate output.
 */
function buildMessage(update: UpdateInfo): string {
  const fromTo = `${chalk.dim(update.current)} → ${chalk.green(update.latest)}`;
  const cyan = chalk.hex("#06b6d4");
  return [
    `Update available ${fromTo}`,
    chalk.dim("Run ") + cyan("npm i -g hatch3r@latest") + chalk.dim(" to update the CLI"),
    chalk.dim("Then run ") + cyan("hatch3r update") + chalk.dim(" to refresh project content"),
  ].join("\n");
}

/**
 * Probe the npm registry for a newer hatch3r version and queue a banner to
 * print at process exit. Idempotent across invocations within the 24h
 * cache window (state stored at ~/.config/configstore/update-notifier-hatch3r.json).
 *
 * Suppression layers, in order:
 *   1. HATCH3R_NO_UPDATE_CHECK=1 — explicit hatch3r-specific opt-out
 *   2. NO_UPDATE_NOTIFIER=1 / `--no-update-notifier` argv — library-wide
 *      opt-outs (handled by update-notifier here). F-SEC-05 (sec-2.8.6-p4):
 *      both forms ALSO gate the active init pre-flight probe
 *      (`maybeSelfUpdateBeforeInit` in initUpdateCheck.ts) — each opt-out
 *      binds the passive banner AND the active path identically.
 *   3. CI=1 — CI environments (handled by update-notifier)
 *   4. stdout not a TTY — pipes/redirects (handled by update-notifier)
 *
 * The probe runs in a detached unref'd child process the first time it
 * fires after the cache window expires, so command startup is never
 * blocked on the network.
 */
export function checkForUpdates(): void {
  if (process.env.HATCH3R_NO_UPDATE_CHECK === "1") return;

  let notifier;
  try {
    notifier = updateNotifier({
      pkg: { name: "hatch3r", version: HATCH3R_VERSION },
      updateCheckInterval: ONE_DAY_MS,
      shouldNotifyInNpmScript: false,
    });
    // The notification is best-effort and runs at startup before any
    // failure-log channel is wired up. A configstore permission error
    // (the most common failure mode) must NEVER take down the CLI itself.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return;
  }

  if (!notifier.update) return;
  try {
    notifier.notify({
      defer: true,
      message: buildMessage(notifier.update),
    });
    // Same rationale as above — silent fail keeps the CLI usable even if
    // boxen/notify breaks on the user's machine.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    // intentional no-op: notification is non-essential
  }
}

/**
 * Probe the npm registry LIVE (no 24h cache) for the latest published
 * hatch3r version, bounded by a hard timeout. Returns `null` on ANY
 * failure — constructor error (configstore permissions), network error,
 * or timeout — so callers are structurally fail-open: the init pre-flight
 * auto-update proceeds silently with the current version when the
 * registry cannot answer in time.
 *
 * Result shape (update-notifier v7 `fetchInfo()`): `{ latest, current,
 * type, name }` where `type` is `semverDiff(current, latest) ?? "latest"`.
 * `type` is a direction-agnostic `semverDiff` — non-`latest` in BOTH
 * directions; callers MUST apply their own strictly-greater guard (see
 * `initUpdateCheck.ts`, F-SEC-01).
 *
 * Distinct from {@link checkForUpdates}: that path is the passive,
 * cached, exit-time banner; this one is an awaited inline probe for the
 * interactive `init` update prompt. The notifier instance here is
 * constructed with `updateCheckInterval: Number.MAX_SAFE_INTEGER` so its
 * constructor-time `check()` never spawns a SECOND detached background
 * probe alongside the one `checkForUpdates()` may have already queued —
 * this instance exists only for its `fetchInfo()` method.
 */
export async function fetchLatestUpdateInfo(
  timeoutMs: number = FETCH_INFO_TIMEOUT_MS,
): Promise<UpdateInfo | null> {
  let notifier: ReturnType<typeof updateNotifier>;
  try {
    notifier = updateNotifier({
      pkg: { name: "hatch3r", version: HATCH3R_VERSION },
      updateCheckInterval: Number.MAX_SAFE_INTEGER,
      shouldNotifyInNpmScript: false,
    });
    // Same contract as checkForUpdates(): a configstore permission error —
    // the common constructor failure — must never take down init itself.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<null>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(null), timeoutMs);
      // unref: when the fetch wins the race, the pending timer must not
      // hold the process open for the remainder of the window.
      timer.unref();
    });
    // The rejection handler is attached BEFORE the race: if the fetch
    // rejects after the timeout already won, an unhandled rejection would
    // otherwise reach the CLI's last-resort net (src/cli/index.ts) and turn
    // a background network error into a fatal exit 1. Promise.resolve wraps
    // the declared `UpdateInfo | Promise<UpdateInfo>` union into a promise.
    const fetching: Promise<UpdateInfo | null> = Promise.resolve(
      notifier.fetchInfo(),
    ).then(
      (fetched) => fetched,
      () => null,
    );
    return await Promise.race([fetching, timeout]);
    // review-2.8.6-r1 F4: same fail-open contract as the constructor catch
    // above. The update-notifier v7 `fetchInfo()` union declares a sync
    // (non-promise) return shape, so a SYNCHRONOUS throw is reachable before
    // Promise.resolve can wrap it — without this catch it escaped the
    // try/finally as a rejection, violating the "returns null on ANY
    // failure" contract this probe's callers are structurally built on.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
