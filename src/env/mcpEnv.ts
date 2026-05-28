import { readFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AVAILABLE_MCP_SERVERS, ENV_VAR_HELP } from "../types.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { verbose } from "../cli/shared/ui.js";

export interface EnvVar {
  name: string;
  server: string;
  comment: string;
  url: string;
}

const ENV_MCP_FILE = ".env.mcp";

const SOURCE_POSIX = "set -a && source .env.mcp && set +a";
const SOURCE_POWERSHELL =
  'Get-Content .env.mcp | ForEach-Object { if ($_ -match \'^\\s*([^#][^=]+)=(.*)$\') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), \'Process\') } }';

/**
 * Returns the sourcing command for the current OS.
 * Run this, then start or restart your editor (VS Code/Copilot auto-loads .env.mcp).
 */
export function getSourceEnvMcpCommand(): string {
  return process.platform === "win32" ? SOURCE_POWERSHELL : SOURCE_POSIX;
}

/**
 * Returns the sourcing disclaimer block for the .env.mcp template.
 * Includes both POSIX and Windows commands so the file is useful on any OS.
 *
 * D11-M7 (Cycle 10 Wave-3 Medium, P2): the prior disclaimer told users to
 * "source then start your editor" without explaining the GUI-launch failure
 * mode on macOS. Editors launched from Finder, the Dock, or Spotlight do not
 * inherit shell-sourced env vars — they receive only the launchd-managed
 * env (`/private/etc/launchd.conf`, `launchctl setenv`). VS Code mitigates
 * this via its `terminal.integrated.inheritEnv`/`resolveShellEnvironment`
 * shell-resolution probe at startup, but Cursor and Claude Code MCP STDIO
 * spawns inherit the parent process env directly. The expanded block calls
 * out the GUI-launch caveat and documents the two reliable workarounds.
 */
export function getSourceEnvMcpDisclaimer(): string {
  return [
    "# Cursor / Claude Code: Source this file, then start or restart your editor (VS Code/Copilot auto-loads it).",
    "# macOS/Linux (bash/zsh):",
    `#   ${SOURCE_POSIX}`,
    "# Windows (PowerShell):",
    `#   ${SOURCE_POWERSHELL}`,
    "# Windows (Git Bash): same as macOS/Linux",
    "",
    "# macOS GUI-launched editors (Finder, Dock, Spotlight) do NOT inherit shell-sourced env vars.",
    "# Two reliable workarounds:",
    "#   1. Launch the editor from a terminal AFTER sourcing this file:",
    `#      ${SOURCE_POSIX} && open -a Cursor .   # or: code .  /  cursor .  /  claude .`,
    "#   2. Make the values persistent across logins via launchctl (per var):",
    "#      launchctl setenv VAR_NAME \"$VAR_NAME\"   # then quit and relaunch the editor",
    "",
  ].join("\n");
}

/**
 * Collects every environment variable required by the given MCP server list.
 * Returns a deduped, deterministic array.
 */
export function collectRequiredEnvVars(servers: string[]): EnvVar[] {
  const seen = new Set<string>();
  const vars: EnvVar[] = [];

  for (const id of servers) {
    const meta = AVAILABLE_MCP_SERVERS[id];
    if (!meta?.requiresEnv) continue;
    for (const name of meta.requiresEnv) {
      if (seen.has(name)) continue;
      seen.add(name);
      const help = ENV_VAR_HELP[name];
      vars.push({
        name,
        server: id,
        comment: help?.comment ?? id,
        url: help?.url ?? "",
      });
    }
  }

  return vars;
}

/**
 * Renders the contents of a `.env.mcp` file.
 * Existing values (from a prior file) are preserved; new vars get empty placeholders.
 */
export function generateEnvMcpContent(
  vars: EnvVar[],
  existing: Record<string, string> = {},
): string {
  if (vars.length === 0) return "";

  const lines: string[] = [
    "# hatch3r MCP secrets",
    "# Fill in your values below. This file is gitignored — never commit it.",
    "# Docs: https://docs.hatch3r.com/docs/guides/mcp-setup",
    "",
    getSourceEnvMcpDisclaimer(),
  ];

  for (const v of vars) {
    const urlPart = v.url ? ` — ${v.url}` : "";
    lines.push(`# ${v.comment}${urlPart}`);
    lines.push(`${v.name}=${existing[v.name] ?? ""}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parses a KEY=VALUE env file, ignoring comments and blank lines.
 * Handles optional quoting and `export` prefix.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eqIdx = stripped.indexOf("=");
    if (eqIdx < 1) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let val = stripped.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * F2.7-F3 (D2, P1): Paths that must be ignored by git in every hatch3r-managed
 * repo. `.env.mcp` carries MCP secrets. `.hatch3r-archive/` accumulates
 * archive trees on every sync (5 syncs × 3 tools ≈ 15 directories). The
 * `.hatch3r/` user-state directories (snapshots, handoffs) grow without
 * bound under normal use. Without these entries the default `git add .`
 * silently commits operational state and secrets — breaks P1 first-run
 * success and the Silent Failure Contract.
 *
 * The trailing slash on directory entries makes the gitignore match
 * directory-scoped per `https://git-scm.com/docs/gitignore` (accessed
 * 2026-05-26). `.env.mcp` stays unsuffixed because it is a file.
 */
const REQUIRED_GITIGNORE_ENTRIES = [
  ".env.mcp",
  ".hatch3r-archive/",
  ".hatch3r/snapshots/",
  ".hatch3r/handoffs/",
] as const;

/**
 * Returns true when `entry` is already covered by an existing line in
 * `lines`. A dominating pattern is either the literal entry text or one
 * of the family-level globs that subsume the entry (e.g. `.env.*` covers
 * `.env.mcp`, `.hatch3r/` covers `.hatch3r/snapshots/`).
 */
function isCoveredByGitignore(entry: string, lines: string[]): boolean {
  const trimmedEntries = lines.map((l) => l.trim());
  if (trimmedEntries.includes(entry)) return true;
  if (entry === ".env.mcp" && trimmedEntries.includes(".env.*")) return true;
  if (entry.startsWith(".hatch3r/")) {
    if (trimmedEntries.includes(".hatch3r/") || trimmedEntries.includes(".hatch3r")) {
      return true;
    }
  }
  return false;
}

/**
 * Appends the required hatch3r entries to the project's `.gitignore` when
 * not already covered. Idempotent: each entry is checked individually so a
 * pre-existing line scan never duplicates entries on re-run.
 *
 * Entries registered: `.env.mcp` (MCP secrets), `.hatch3r-archive/`
 * (archive trees from sync/update), `.hatch3r/snapshots/` (per-session
 * snapshots), `.hatch3r/handoffs/` (handoff payloads). See
 * {@link REQUIRED_GITIGNORE_ENTRIES} for rationale.
 */
export async function ensureGitignoreEntry(rootDir: string): Promise<void> {
  const gitignorePath = join(rootDir, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch (err) {
    // .gitignore doesn't exist yet — will be created below. Surface under
    // --verbose so unexpected read failures (permission) stay observable.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`mcpEnv: ensureGitignoreEntry readFile(${gitignorePath}) — will create — ${message}`);
  }

  const existingLines = content.split("\n");
  const missing = REQUIRED_GITIGNORE_ENTRIES.filter(
    (entry) => !isCoveredByGitignore(entry, existingLines),
  );

  if (missing.length === 0) return;

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const additions = missing.join("\n") + "\n";
  // #240 (D8-8.7): Route through atomicWriteFile for crash-safe writes
  await atomicWriteFile(gitignorePath, `${content}${separator}${additions}`);
}

export interface EnsureResult {
  action: "created" | "updated" | "skipped";
  path: string;
  newVars: string[];
}

/**
 * Creates or updates `.env.mcp` in the given root directory.
 * Never overwrites existing values — only appends missing vars.
 */
export async function ensureEnvMcp(
  rootDir: string,
  servers: string[],
): Promise<EnsureResult> {
  const envPath = join(rootDir, ENV_MCP_FILE);
  const vars = collectRequiredEnvVars(servers);

  if (vars.length === 0) {
    return { action: "skipped", path: ENV_MCP_FILE, newVars: [] };
  }

  let existing: Record<string, string> = {};
  let hadFile = false;

  if (existsSync(envPath)) {
    hadFile = true;
    const raw = await readFile(envPath, "utf-8");
    existing = parseEnvFile(raw);
  }

  const newVars = vars.filter((v) => !(v.name in existing)).map((v) => v.name);

  if (hadFile && newVars.length === 0) {
    return { action: "skipped", path: ENV_MCP_FILE, newVars: [] };
  }

  const content = generateEnvMcpContent(vars, existing);
  await atomicWriteFile(envPath, content);
  // F1.7-H1 (D1, P6): `.env.mcp` holds MCP API tokens. atomicWriteFile leaves
  // the file at the umask-derived default (typically `0o644` on POSIX with
  // umask `0o022`), exposing secrets to every other user on a shared host
  // (CWE-552). Tighten to `0o600` (owner-read/write only) — the standard
  // secret-file permission, matching `ssh-keygen` and `.netrc` conventions.
  //
  // chmod runs AFTER atomicWriteFile completes the rename. There is a brief
  // window (microseconds) where the new `.env.mcp` exists at `0o644` before
  // chmod fires; recommendation step 2 (extending atomicWriteFile with a
  // `mode` option that runs before rename) is the systemic fix and is
  // tracked outside this work unit's file-lock (src/merge/safeWrite.ts).
  //
  // Windows chmod has limited semantics — Node maps a subset of POSIX modes.
  // EPERM/ENOTSUP/EINVAL are swallowed under --verbose; other errors throw
  // so genuine I/O failures surface.
  try {
    await chmod(envPath, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EINVAL") throw err;
    verbose(`mcpEnv: chmod(${envPath}, 0o600) skipped — ${code}`);
  }

  return {
    action: hadFile ? "updated" : "created",
    path: ENV_MCP_FILE,
    newVars,
  };
}
