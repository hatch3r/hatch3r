import updateNotifier, { type UpdateInfo } from "update-notifier";
import chalk from "chalk";
import { HATCH3R_VERSION } from "../../version.js";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

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
 *   2. NO_UPDATE_NOTIFIER=1 — library-wide opt-out (handled by update-notifier)
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
