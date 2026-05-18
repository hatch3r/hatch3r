import { spawn } from "node:child_process";
import type { CliToolId } from "../types.js";
import { AVAILABLE_CLI_TOOLS } from "./registry.js";

/**
 * Result of probing a single CLI tool. `installed` reflects whether the
 * binary was found on PATH; `path` is the resolved path when known (empty
 * string otherwise). `error` carries the probe failure reason — populated
 * only when the spawn itself errored, not when the binary is simply
 * missing.
 */
export interface CliToolDetectionResult {
  id: CliToolId;
  probe: string;
  installed: boolean;
  path: string;
  error?: string;
}

const PROBE_TIMEOUT_MS = 2000;

/**
 * Whitelist characters allowed in a probe binary name. Detection feeds the
 * name into `command -v` / `where` via argv, but defence-in-depth: reject
 * any name with whitespace or shell metacharacters before spawning.
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
  // POSIX: `command -v` is a POSIX-mandated builtin; pass through `/bin/sh -c`.
  // Windows: `where` is a stock cmd.exe builtin.
  const [cmd, args] = isWindows
    ? ["where", [name]]
    : ["/bin/sh", ["-c", `command -v -- "${name}"`]];

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
 * Probe one tool by `CliToolId`. Returns a detection result even when the
 * id is unknown to the registry (in that case `probe` is set to the id
 * itself so the caller can surface a useful warning).
 */
export async function detectCliTool(id: CliToolId): Promise<CliToolDetectionResult> {
  const meta = (AVAILABLE_CLI_TOOLS as Record<string, { probe: string } | undefined>)[id];
  const probe = meta?.probe ?? id;
  const path = await probeBin(probe);
  return {
    id,
    probe,
    installed: path.length > 0,
    path,
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
