import { spawn } from "node:child_process";
import type { CliToolId } from "../types.js";
import { AVAILABLE_CLI_TOOLS } from "./registry.js";

/**
 * Result of probing a single CLI tool. `installed` reflects whether the
 * binary was found on PATH AND any registered extension probe also resolved;
 * `path` is the resolved path when known (empty string otherwise). `error`
 * carries the probe failure reason — populated only when the spawn itself
 * errored, not when the binary is simply missing. `extensionMissing` is set
 * to the extension name when the base binary resolves but a registered
 * extension probe fails (D21-M6, Cycle 10) — callers surface this to users
 * so the installer prints the `az extension add --name azure-devops` step.
 */
export interface CliToolDetectionResult {
  id: CliToolId;
  probe: string;
  installed: boolean;
  path: string;
  error?: string;
  extensionMissing?: string;
}

const PROBE_TIMEOUT_MS = 2000;

/**
 * Character allowlist for a probe binary name. Detection passes the name to
 * `command -v` / `where` via argv — POSIX as the `$1` positional parameter of
 * `/bin/sh -c`, Windows as a direct `where` argument — so the name is never
 * spliced into shell script text and injection is structurally blocked
 * regardless of this check (D1-SA1.7-07). The allowlist is retained as
 * defence-in-depth: it rejects any name with whitespace or a shell
 * metacharacter before spawn, and fails the probe closed if the argv contract
 * is ever regressed back to an interpolated `-c` string.
 */
function isSafeProbeName(name: string): boolean {
  return /^[A-Za-z0-9._\-+]+$/.test(name);
}

/**
 * Probe a single binary by name and return its resolved path on PATH (or
 * the empty string when missing / on timeout / on spawn error).
 *
 * Uses `command -v <name>` on POSIX and `where <name>` on Windows. Avoids
 * `which` (not POSIX, MacOS wrapper drops shell functions) and avoids
 * `--version` (variable exit codes and latency). Wall-clock timeout is
 * 2000ms — fail-open on slow PATHs (e.g. AV-scanned mounts) per plan §3.
 *
 * Returns a string (path or `""`) rather than throwing so callers can
 * batch-detect with `Promise.all` without rejection handling.
 */
export async function probeBin(name: string): Promise<string> {
  if (!isSafeProbeName(name)) return "";

  const isWindows = process.platform === "win32";
  // POSIX: `command -v` is a POSIX-mandated builtin, run via `/bin/sh -c`. The
  // probe name is passed as the `$1` positional parameter (argv tail after the
  // `sh` $0), NOT interpolated into the `-c` script text, so no user-influenced
  // byte is ever part of the shell program; `--` plus the quoted `"$1"` keep the
  // name a single literal operand even if the allowlist is ever loosened.
  // Windows: `where` is a stock cmd.exe builtin; the name is a direct argv element.
  const [cmd, args] = isWindows
    ? ["where", [name]]
    : ["/bin/sh", ["-c", 'command -v -- "$1"', "sh", name]];

  return new Promise<string>((resolve) => {
    let settled = false;
    let stdout = "";

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
        // Probe child already exited between timeout fire and kill() — the
        // resolve("") below is the diagnostic surface for fail-open
        // timeout handling (probe returns "missing" on slow PATHs).
        // eslint-disable-next-line silent-failure/no-silent-catch
      } catch {
        // intentional no-op: child already gone
      }
      resolve("");
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("");
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) { resolve(""); return; }
      // `where` may print multiple paths (one per line); take the first.
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? "";
      resolve(first);
    });
  });
}

/**
 * D21-M6 (Cycle 10): run a follow-up extension probe AFTER the base binary
 * has been resolved on PATH. Returns the stdout when the probe exits 0 and
 * an empty string on timeout, spawn error, or non-zero exit — the caller
 * uses `String.includes` against `expectInStdout` to decide whether the
 * extension is present.
 *
 * Each argv entry must pass `isSafeProbeName` (same character allowlist as
 * the base binary) so shell metacharacters can never leak into spawn.
 * Direct `spawn(binary, args)` avoids `/bin/sh -c`, so even if the
 * allowlist were ever loosened, no shell would interpret the args.
 */
async function runExtensionProbe(binary: string, args: readonly string[]): Promise<string> {
  if (!isSafeProbeName(binary)) return "";
  for (const arg of args) {
    if (!isSafeProbeName(arg)) return "";
  }

  return new Promise<string>((resolve) => {
    let settled = false;
    let stdout = "";

    // Direct spawn (no shell) — safe even if `isSafeProbeName` is ever
    // loosened, because no interpolation happens.
    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
        // intentional no-op: probe timeout fail-open mirror of probeBin
        // eslint-disable-next-line silent-failure/no-silent-catch
      } catch {
        // child already gone
      }
      resolve("");
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("");
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) { resolve(""); return; }
      resolve(stdout);
    });
  });
}

/**
 * Probe one tool by `CliToolId`. Returns a detection result even when the
 * id is unknown to the registry (in that case `probe` is set to the id
 * itself so the caller can surface a useful warning).
 *
 * D21-M6 (Cycle 10): when the registry entry declares an `extensionProbe`,
 * a successful base probe is followed by the extension verification before
 * `installed: true` is returned. A missing extension surfaces as
 * `installed: false` with `extensionMissing` set so the installer prints
 * the extension-add step rather than silently treating the tool as ready.
 *
 * D21-SA21.2-03 (Cycle 12): when the registry entry declares `probeFallbacks`
 * and the primary probe misses, each fallback binary name is tried before the
 * tool is reported absent — closing the Debian/Ubuntu package-rename
 * false-negative (`bat`→`batcat`, `fd`→`fdfind`). `path` reports the resolved
 * binary so the caller can hint the alias.
 */
export async function detectCliTool(id: CliToolId): Promise<CliToolDetectionResult> {
  const meta = (AVAILABLE_CLI_TOOLS as Record<string, {
    probe: string;
    probeFallbacks?: readonly string[];
    extensionProbe?: { args: readonly string[]; expectInStdout: string; name: string };
  } | undefined>)[id];
  const probe = meta?.probe ?? id;
  let resolved = probe;
  let path = await probeBin(probe);
  // D21-SA21.2-03 (Cycle 12): when the primary probe misses, try the registry's
  // fallback binary names before reporting the tool absent. Covers Debian/Ubuntu
  // package renames (`bat`→`batcat`, `fd`→`fdfind`) where the apt channel this
  // registry recommends installs a differently-named binary than the upstream
  // default. `resolved`/`path` reflect the binary that actually answered so the
  // installer can hint the alias, while the returned `probe` stays canonical.
  if (path.length === 0 && meta?.probeFallbacks) {
    for (const alt of meta.probeFallbacks) {
      const altPath = await probeBin(alt);
      if (altPath.length > 0) {
        resolved = alt;
        path = altPath;
        break;
      }
    }
  }
  if (path.length === 0) {
    return { id, probe, installed: false, path };
  }
  const extensionProbe = meta?.extensionProbe;
  if (!extensionProbe) {
    return { id, probe, installed: true, path };
  }
  const stdout = await runExtensionProbe(resolved, extensionProbe.args);
  if (stdout.includes(extensionProbe.expectInStdout)) {
    return { id, probe, installed: true, path };
  }
  return {
    id,
    probe,
    installed: false,
    path,
    extensionMissing: extensionProbe.name,
  };
}

/**
 * Probe a batch of tools in parallel. Order of results matches input
 * order. Probes run concurrently to keep init's end-of-flow detection
 * step well under a second even when many tools are selected.
 */
export async function detectCliTools(ids: readonly CliToolId[]): Promise<CliToolDetectionResult[]> {
  return Promise.all(ids.map((id) => detectCliTool(id)));
}

/**
 * Return the subset of `ids` whose binary was not found on PATH. Caller
 * passes this to `offerInstaller` to print copy-paste install commands.
 */
export async function findMissingCliTools(ids: readonly CliToolId[]): Promise<CliToolId[]> {
  const results = await detectCliTools(ids);
  return results.filter((r) => !r.installed).map((r) => r.id);
}
