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
  /**
   * C9-H51 (D15-SA15.4-F01): When true, skip the `npm audit signatures`
   * check after each successful package install. Emergency-override only —
   * the caller is expected to emit a visible warning before passing this
   * flag. Default false (audit is enforced).
   */
  skipAuditSignatures?: boolean;
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
 * Result of an `npm audit signatures` invocation.
 * - `ok: true` — every package signature/attestation verified
 * - `ok: false` — signatures missing or invalid; `details` carries the
 *   captured CLI output for the caller's error message.
 * - `unsupported: true` — the local npm version did not expose
 *   `audit signatures` (npm < 8.13.0). Treated as a hard refusal in
 *   the security-first default — the same as a verification failure.
 */
export interface AuditSignaturesResult {
  ok: boolean;
  unsupported: boolean;
  details: string;
}

/**
 * C9-H51 (D15-SA15.4-F01): Run `npm audit signatures` programmatically
 * against the freshly fetched/installed hatch3r package, returning a
 * structured result the caller can use to decide whether to proceed.
 *
 * Detection of "signatures invalid":
 * - Non-zero exit code from `npm audit signatures`, OR
 * - Output contains the substring `signatures: invalid` (npm 10+ formatting)
 *   or `tampered` (Sigstore Rekor mismatch).
 *
 * Detection of "unsupported npm" (returns `unsupported: true`, which the
 * caller treats as a refusal-to-proceed in the secure default):
 * - Stderr contains `Unknown command: "audit signatures"` (npm < 8.13)
 *
 * Why not throw here: the caller composes a domain-specific HatchError
 * (`INTEGRITY_ERROR`) with target-specific labeling and actionable next
 * steps. This helper returns a structured result instead so the caller
 * controls the failure mode.
 *
 * Context:
 * - Mini Shai-Hulud (May 2026) — 170+ npm packages, 518M downloads
 *   compromised via maintainer-credential takeover.
 * - CVE-2026-45321 — TanStack provenance-bypass; `npm audit signatures`
 *   is the consumer-side detection that closes that class of attack.
 */
export async function runAuditSignatures(
  cwd: string,
): Promise<AuditSignaturesResult> {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  try {
    const out = execFileSync(cmd, ["audit", "signatures"], {
      stdio: "pipe",
      timeout: UPDATE_TIMEOUT_MS,
      killSignal: "SIGTERM",
      cwd,
    });
    const stdout = out.toString("utf-8");
    // Even on exit 0, npm sometimes prints `signatures: invalid` summary
    // lines for packages that lack attestations — treat as failure per
    // the secure-default contract.
    if (/signatures:\s*invalid|tampered/i.test(stdout)) {
      return { ok: false, unsupported: false, details: stdout.trim() };
    }
    return { ok: true, unsupported: false, details: stdout.trim() };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // execFileSync wraps the child stderr in the thrown error; surface the
    // stderr alongside the message so the caller's actionable next-step
    // can quote the specific failure.
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "";
    const combined = `${raw}\n${stderr}`.trim();
    if (/Unknown command:\s*"audit signatures"|audit signatures/i.test(stderr) &&
        /unknown|not.*recognized/i.test(stderr)) {
      return { ok: false, unsupported: true, details: combined };
    }
    return { ok: false, unsupported: false, details: combined };
  }
}

/**
 * Compose the actionable error message for a signature-verification refusal.
 * Extracted into a helper so the message format is one source-of-truth and
 * tests can assert against a single string.
 */
function formatSignatureFailureMessage(
  label: string,
  result: AuditSignaturesResult,
): string {
  if (result.unsupported) {
    return (
      `npm audit signatures is not available in your local npm (${label}). ` +
      `Upgrade to npm >= 8.13.0 (bundled with Node >= 16.17.0) and retry, ` +
      `or re-run with --skip-audit-signatures if the upgrade is blocked.\n` +
      `Original error: ${result.details}`
    );
  }
  return (
    `npm audit signatures verification FAILED for ${label}. ` +
    `Refusing to regenerate adapter outputs from an unverified package — ` +
    `this is the consumer-side defense against compromised registry artifacts ` +
    `(Shai-Hulud / Mini-Shai-Hulud / CVE-2026-45321 class). Next steps: ` +
    `(1) run \`npm audit signatures\` manually to inspect the failure, ` +
    `(2) clear the package cache and retry: \`npm cache clean --force && hatch3r update\`, ` +
    `(3) if you have verified the package out-of-band, re-run with --skip-audit-signatures. ` +
    `Captured output:\n${result.details}`
  );
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
 * The first target is treated as fatal on install failure (preserves the
 * legacy single-target throw-on-error semantics from `runPackageUpdate`);
 * install failures on additional targets are degraded — logged and
 * recorded, never throwing. C9-H51 (D15-SA15.4-F01): signature-verification
 * failures are always fatal regardless of primary/secondary classification,
 * because regenerating from an unverified package defeats the security
 * gate's whole purpose.
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

      // C9-H51 (D15-SA15.4-F01): verify Sigstore signatures / attestations
      // on the freshly-installed package before allowing the caller to
      // regenerate any output from it. Refusal is the secure default;
      // --skip-audit-signatures is an emergency override that the CLI
      // surface warns about loudly.
      if (!options.skipAuditSignatures) {
        // npm audit signatures inspects the dependency tree rooted at the
        // current cwd; for both project-local and global targets the
        // freshly-installed hatch3r package is reachable from rootDir
        // (project-local: rootDir/node_modules/hatch3r; global: covered
        // by npm's global lockfile reachability).
        //
        // C9-H51 (D15-SA15.4-F01): treat ALL audit-signature failures as
        // fatal, regardless of primary/secondary classification. The
        // security contract is binary: a successfully-fetched package the
        // CLI cannot verify is a refusal-to-regenerate event. We do not
        // degrade audit failures for the same reason we do not degrade
        // a `tampered` integrity result — the consumer-side defense
        // against compromised registry artifacts is the whole point of
        // running the check at all.
        const auditResult = await runAuditSignatures(rootDir);
        if (!auditResult.ok) {
          const msg = formatSignatureFailureMessage(label, auditResult);
          throw new HatchError(msg, 1, "INTEGRITY_ERROR");
        }
      } else {
        warn(
          `Signature verification SKIPPED for ${label} (--skip-audit-signatures). ` +
          `You are responsible for verifying the package out-of-band.`,
        );
      }

      result.updated.push(target);
    } catch (err) {
      // C9-H51 (D15-SA15.4-F01): the signature-verification gate above
      // throws HatchError(INTEGRITY_ERROR) on any target whose signature
      // check failed. Re-throw it unchanged so the caller sees the
      // security-specific error code instead of the package-manager
      // fallback classification ("UNKNOWN_ERROR" / "NETWORK_ERROR") this
      // catch otherwise applies to bare install failures.
      if (err instanceof HatchError) {
        s.fail(step(offset + 1, total, `Refused ${label}: signature verification failed`));
        throw err;
      }
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
