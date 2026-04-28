import { execFileSync } from "node:child_process";
import { retryWithBackoff } from "../pipeline/retryWithBackoff.js";
import {
  classifyDependency,
  classifyFailure,
  getRecoveryGuidance,
} from "../pipeline/circuitBreaker.js";
import {
  surveyInstalls,
  type InstallLocation,
  type InstallSurvey,
} from "../detect/installContext.js";
import { detectPackageManager } from "../detect/packageManager.js";
import {
  createSpinner,
  step,
  info,
  warn,
} from "../cli/shared/ui.js";
import { HatchError } from "../types.js";

/**
 * Package update timeout in milliseconds.
 * Override with HATCH3R_UPDATE_TIMEOUT_MS env var (default: 30000).
 *
 * Lifted from the original `runPackageUpdate` (`src/cli/commands/update.ts`)
 * during the C7-H9 / multi-install refactor — same env-var contract preserved.
 */
const UPDATE_TIMEOUT_MS = (() => {
  const envVal = process.env.HATCH3R_UPDATE_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30_000;
})();

export interface SelfUpdateResult {
  updated: InstallLocation[];
  skipped: Array<{ location: InstallLocation; reason: string }>;
  failed: Array<{ location: InstallLocation; error: string }>;
  survey: InstallSurvey;
}

interface RunOptions {
  stepOffset?: number;
  totalSteps?: number;
}

interface PmInvocation {
  cmd: string;
  args: string[];
}

async function buildInvocation(
  loc: InstallLocation,
  rootDir: string,
): Promise<PmInvocation> {
  const isWin = process.platform === "win32";
  if (loc.kind === "global") {
    // Global installs always go through the system npm. pnpm/yarn/bun
    // globals live in different roots and are out of scope for v1 — see
    // installContext.ts for the survey contract.
    return {
      cmd: isWin ? "npm.cmd" : "npm",
      args: ["install", "-g", "hatch3r@latest"],
    };
  }
  // project-local: respect the project's detected package manager.
  const pm = await detectPackageManager(rootDir);
  const cmd = isWin && pm.name !== "bun" ? `${pm.updateCmd}.cmd` : pm.updateCmd;
  return { cmd, args: pm.updateArgs };
}

function describe(loc: InstallLocation): string {
  switch (loc.kind) {
    case "global":
      return "global install";
    case "project-local":
      return "project-local install";
    case "npx":
      return "npx cache";
    case "dev-source":
      return "dev source checkout";
  }
}

/**
 * Update every reachable hatch3r install (the one that invoked us plus any
 * other install of the same package detected on the system) to the latest
 * registry version.
 *
 * Skips:
 * - dev-source (we're running from a repo checkout — never mutate it)
 * - npx cache (read-only; user must re-run with `@latest`)
 * - global on Windows (running .cmd shim is locked; user gets a guided
 *   message and runs `npm install -g hatch3r@latest` from a fresh terminal)
 *
 * The first target is treated as fatal on failure (preserves the legacy
 * single-target throw-on-error semantics from `runPackageUpdate`); failures
 * on additional targets are degraded — logged and recorded, never throwing.
 *
 * C7-H9 (D1) traceability preserved from the original `runPackageUpdate`:
 * the function is consumed by callers that chain `runRegenerate` after it,
 * either in-process (`runUpdate`) or via re-exec into the freshly installed
 * binary (`updateCommand`).
 */
export async function runSelfUpdate(
  rootDir: string,
  options: RunOptions = {},
): Promise<SelfUpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 1;
  const survey = await surveyInstalls(rootDir);
  const targets = [survey.invokedFrom, ...survey.alsoPresent];
  const result: SelfUpdateResult = {
    updated: [],
    skipped: [],
    failed: [],
    survey,
  };

  let isFirst = true;
  for (const target of targets) {
    const fatalIfFails = isFirst;
    isFirst = false;

    if (target.kind === "dev-source") {
      result.skipped.push({
        location: target,
        reason: "Running from a source checkout — self-update skipped to avoid mutating the working tree.",
      });
      continue;
    }

    if (target.kind === "npx") {
      const reason = "npx cache is read-only. Re-run with `npx hatch3r@latest <command>` to pull a fresh cache.";
      result.skipped.push({ location: target, reason });
      info(reason);
      continue;
    }

    if (target.kind === "global" && process.platform === "win32") {
      const reason = "Windows cannot replace the running global hatch3r.cmd shim while it is in use. Open a new terminal and run: npm install -g hatch3r@latest";
      result.skipped.push({ location: target, reason });
      warn(reason);
      continue;
    }

    const label = describe(target);
    const s = createSpinner(step(offset + 1, total, `Updating ${label}...`));
    s.start();
    try {
      const inv = await buildInvocation(target, rootDir);
      // Retry transient registry/network errors (ECONNRESET, 503,
      // EAI_AGAIN). Substantive failures (auth, missing package, EPERM)
      // surface on the first attempt unchanged.
      await retryWithBackoff(
        async () => {
          execFileSync(inv.cmd, inv.args, {
            stdio: "pipe",
            timeout: UPDATE_TIMEOUT_MS,
            killSignal: "SIGTERM",
            cwd: rootDir,
          });
        },
        { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2_000 },
      );
      s.succeed(step(offset + 1, total, `Updated ${label}`));
      result.updated.push(target);
    } catch (err) {
      const isTimeout = err && typeof err === "object" && ("killed" in err || "signal" in err);
      // C7.5-W2B2-H28 (D8): classify non-timeout failures so the error
      // surfaces dependency-aware recovery guidance (package-manager vs
      // network vs auth) instead of a bare vendor string.
      let msg: string;
      let errorCode: "NETWORK_ERROR" | "UNKNOWN_ERROR" = "UNKNOWN_ERROR";
      if (isTimeout) {
        msg = `Package update timed out after ${UPDATE_TIMEOUT_MS / 1000}s (${label}). Check network connectivity and retry, or set HATCH3R_UPDATE_TIMEOUT_MS to increase the timeout.`;
        errorCode = "NETWORK_ERROR";
      } else {
        const raw = err instanceof Error ? err.message : String(err);
        const depClass = classifyDependency(err);
        const failType = classifyFailure(err);
        const guidance = getRecoveryGuidance(depClass, failType);
        msg = `${raw}. ${guidance}`;
        if (depClass === "network") errorCode = "NETWORK_ERROR";
      }
      s.fail(step(offset + 1, total, `Failed to update ${label}`));

      if (fatalIfFails) {
        // Preserve the legacy single-target semantics: failure on the
        // primary install (the one that invoked us) is fatal.
        throw new HatchError(msg, 1, errorCode);
      }
      // Secondary targets (alsoPresent) degrade gracefully so a half-broken
      // global install does not block a successful project-local update.
      warn(`Could not update ${label}: ${msg}`);
      result.failed.push({ location: target, error: msg });
    }
  }

  return result;
}

/**
 * Pick the binary path to re-exec for the post-update regenerate phase.
 *
 * Preference order:
 * 1. The freshly-updated install matching `invokedFrom.kind` (so the user
 *    keeps using the install kind they already had).
 * 2. The freshly-updated `invokedFrom` itself.
 * 3. Any other freshly-updated install.
 *
 * Returns null when no install was updated (no point re-execing).
 */
export function pickReExecBin(result: SelfUpdateResult): string | null {
  if (result.updated.length === 0) return null;
  const invokedKind = result.survey.invokedFrom.kind;
  const sameKind = result.updated.find((u) => u.kind === invokedKind);
  if (sameKind) return sameKind.binPath;
  return result.updated[0]!.binPath;
}
