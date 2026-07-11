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
 * Shells the disclaimer knows how to lead with. `posix` covers bash/zsh on
 * macOS/Linux and Git Bash on Windows (the `SOURCE_POSIX` form works in all
 * three); `powershell` is Windows PowerShell / pwsh; `auto` detects from the
 * runtime; `all` (the default) emits every shell block unconditionally so a
 * file written on one machine stays useful when opened on another. `cmd.exe`
 * is intentionally unsupported — see {@link getSourceEnvMcpDisclaimer}.
 */
export type EnvMcpShell = "posix" | "powershell" | "git-bash" | "auto" | "all";

/**
 * Resolve `"auto"` to a concrete shell from the runtime. PowerShell exposes
 * `PSModulePath`; otherwise we assume a POSIX-compatible shell (bash/zsh, or
 * Git Bash on Windows, all of which accept `SOURCE_POSIX`). `cmd.exe` is not
 * detected here because it is unsupported (no single-line `source` analogue).
 */
function detectActiveShell(): Exclude<EnvMcpShell, "auto"> {
  if (process.platform === "win32") {
    return process.env.PSModulePath ? "powershell" : "all";
  }
  return "posix";
}

const POSIX_DISCLAIMER_LINES = [
  "# macOS/Linux (bash/zsh):",
  `#   ${SOURCE_POSIX}`,
];
const POWERSHELL_DISCLAIMER_LINES = [
  "# Windows (PowerShell):",
  `#   ${SOURCE_POWERSHELL}`,
];
const GIT_BASH_DISCLAIMER_LINE = "# Windows (Git Bash): same as macOS/Linux";

/**
 * Returns the sourcing disclaimer block for the .env.mcp template.
 *
 * D1-SA1.7-F7 (Low, P1): the disclaimer is platform-aware. By default
 * (`activeShell: "all"`) it emits every shell block so a file authored on one
 * machine stays useful when opened on another. When the caller knows the
 * operator's shell (or passes `"auto"`), the matching command leads and the
 * remaining shells follow as a labelled fallback so the user is not left
 * scanning a wall of commands for the one line that applies to them. `cmd.exe`
 * has no single-line `source` equivalent and is documented as unsupported
 * (use PowerShell or Git Bash). The PowerShell one-liner remains a fallback,
 * not the only Windows path.
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
export function getSourceEnvMcpDisclaimer(
  options: { activeShell?: EnvMcpShell } = {},
): string {
  const requested = options.activeShell ?? "all";
  const shell = requested === "auto" ? detectActiveShell() : requested;

  // Assemble shell blocks, leading with the operator's shell when known.
  let shellBlocks: string[];
  if (shell === "posix" || shell === "git-bash") {
    shellBlocks = [
      ...POSIX_DISCLAIMER_LINES,
      GIT_BASH_DISCLAIMER_LINE,
      "# Other shells:",
      ...POWERSHELL_DISCLAIMER_LINES,
      "# Windows cmd.exe is not supported — use PowerShell or Git Bash.",
    ];
  } else if (shell === "powershell") {
    shellBlocks = [
      ...POWERSHELL_DISCLAIMER_LINES,
      "# Other shells:",
      ...POSIX_DISCLAIMER_LINES,
      GIT_BASH_DISCLAIMER_LINE,
      "# Windows cmd.exe is not supported — use PowerShell or Git Bash.",
    ];
  } else {
    // "all" — every shell unconditionally (default; cross-machine portable).
    shellBlocks = [
      ...POSIX_DISCLAIMER_LINES,
      ...POWERSHELL_DISCLAIMER_LINES,
      GIT_BASH_DISCLAIMER_LINE,
      "# Windows cmd.exe is not supported — use PowerShell or Git Bash.",
    ];
  }

  return [
    "# Cursor / Claude Code: Source this file, then start or restart your editor (VS Code/Copilot auto-loads it).",
    ...shellBlocks,
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
 * D1-SA1.7-F10 (Low, P6): defense-in-depth sanitizer for the comment/url
 * fields that {@link generateEnvMcpContent} interpolates into `.env.mcp`
 * comment lines. `comment`/`url` originate from `ENV_VAR_HELP`, which is
 * developer-controlled today but is the natural extension point for
 * third-party packs (per `governance/pack-trust-model.md`). A pack-supplied
 * value containing a newline followed by `KEY=value` would inject an
 * attacker-controlled assignment into the rendered file, which the operator
 * then `source`s into their shell environment. Stripping `\n`, `\r`, and `=`
 * (replacing each with a space) at the render boundary collapses any injected
 * line back into the single comment line it belongs to. A diagnostic is
 * surfaced under `--verbose` when stripping occurs (Silent Failure Contract).
 */
function sanitizeEnvMcpComment(value: string, fieldLabel: string): string {
  const sanitized = value.replace(/[\r\n=]/g, " ");
  if (sanitized !== value) {
    verbose(
      `mcpEnv: stripped newline/'=' characters from ${fieldLabel} before ` +
        `rendering .env.mcp (comment-injection guard)`,
    );
  }
  return sanitized;
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
    // F10: sanitize comment/url at the interpolation boundary so a
    // pack-supplied value cannot inject an extra `KEY=value` line.
    const comment = sanitizeEnvMcpComment(v.comment, `comment for ${v.name}`);
    const url = v.url ? sanitizeEnvMcpComment(v.url, `url for ${v.name}`) : "";
    const urlPart = url ? ` — ${url}` : "";
    lines.push(`# ${comment}${urlPart}`);
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
 * D12-3 (D12, P6): `.hatch3r/provenance.json` is a per-machine drift baseline
 * (emit-time content hashes + content-root-relative source ids regenerated on
 * every init/sync/update). It is machine-local state, not a committable
 * artifact — mirroring the `.env.mcp` carve-out — so it is registered here.
 * Even after D12-3 rewrote `sourceFiles` to content-root-relative ids, the
 * `contentHash`/`generatedAt`/`lastRunId` fields still vary per run and per
 * install, so committing it produces churn-only diffs.
 *
 * D1-14 (D1, P1): `.init-workspace/` and `.sync-workspace/` hold the
 * `--resume` checkpoint trees (`checkpoint.json`) written unconditionally by
 * `init.ts::recordPhase` (init.ts:695-715) and `sync.ts::recordPhase`. Every
 * `init`/`sync` run creates one of these directories regardless of MCP state,
 * so without these entries a default `git add .` stages per-run resume state —
 * the same Silent-Failure-Contract leak as `.hatch3r/snapshots/`.
 *
 * 2.2.0-S1 (P6, P1): runtime/ephemeral state hatch3r usage writes into the
 * user's repo. `.pr-resolve-workspace/` (checkpoint/rollback workspace of the
 * shipped `commands/hatch3r-pr-resolve.md`); `.hatch3r/telemetry/` (SPACE +
 * cost/tier telemetry, `src/pipeline/spaceTelemetry.ts` +
 * `src/pipeline/costEstimator.ts`); `.hatch3r/efficiency-events.jsonl`
 * (efficiency-event log, `src/pipeline/observability.ts`);
 * `.hatch3r/.failure-log.jsonl` (Silent-Failure-Contract audit trail,
 * `src/pipeline/failureLog.ts`); `.hatch3r/.breaker-state.jsonl`
 * (circuit-breaker state, `src/pipeline/circuitBreaker.ts`); `.hatch3r/.lock`
 * (advisory pipeline lock-note per `rules/hatch3r-agent-orchestration.md` →
 * Concurrent Invocation Handling); `.hatch3r/calibration-state.json` +
 * `.hatch3r/calibration-log.jsonl` (reviewer-calibration counter + second-pass
 * log per `rules/hatch3r-reviewer-calibration.md` — a missing state file
 * safely resets the counter to 0); `.hatch3r/archive/` (removed-tool archive
 * copies; parity with the root `.hatch3r-archive/` entry). All are
 * machine-local run state; a blanket `.hatch3r/` line already dominates the
 * `.hatch3r/*` subset via `isCoveredByGitignore`.
 *
 * The trailing slash on directory entries makes the gitignore match
 * directory-scoped per `https://git-scm.com/docs/gitignore` (accessed
 * 2026-05-26). File entries (`.env.mcp`, `.hatch3r/provenance.json`, the
 * `.hatch3r/*.jsonl`/`*.json` logs, `.hatch3r/.lock`) stay unsuffixed.
 */
const REQUIRED_GITIGNORE_ENTRIES = [
  ".env.mcp",
  ".hatch3r-archive/",
  ".hatch3r/snapshots/",
  ".hatch3r/handoffs/",
  ".hatch3r/provenance.json",
  ".init-workspace/",
  ".sync-workspace/",
  ".pr-resolve-workspace/",
  ".hatch3r/telemetry/",
  ".hatch3r/efficiency-events.jsonl",
  ".hatch3r/.failure-log.jsonl",
  ".hatch3r/.breaker-state.jsonl",
  ".hatch3r/.lock",
  ".hatch3r/calibration-state.json",
  ".hatch3r/calibration-log.jsonl",
  ".hatch3r/archive/",
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
 * snapshots), `.hatch3r/handoffs/` (handoff payloads),
 * `.hatch3r/provenance.json` (per-machine drift baseline, D12-3),
 * `.init-workspace/` + `.sync-workspace/` (per-run `--resume` checkpoint
 * trees, D1-14), `.pr-resolve-workspace/` (pr-resolve checkpoint/rollback
 * workspace), `.hatch3r/telemetry/` (SPACE + cost/tier telemetry),
 * `.hatch3r/efficiency-events.jsonl` (efficiency-event log),
 * `.hatch3r/.failure-log.jsonl` (failure-log audit trail),
 * `.hatch3r/.breaker-state.jsonl` (circuit-breaker state), `.hatch3r/.lock`
 * (advisory pipeline lock-note), `.hatch3r/calibration-state.json` +
 * `.hatch3r/calibration-log.jsonl` (reviewer-calibration counter + log),
 * `.hatch3r/archive/` (removed-tool archive copies) — the last nine per
 * 2.2.0-S1. See {@link REQUIRED_GITIGNORE_ENTRIES} for rationale.
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
 * D1-SA1.2-02 (D1, P6): true-merge append for an EXISTING `.env.mcp`.
 *
 * `generateEnvMcpContent` renders lines ONLY for the currently-required var
 * set, so re-rendering it over an existing file silently destroyed every
 * KEY=VALUE line outside that set — a filled secret for a since-deselected
 * server, a hand-added custom var, and every user comment — from the same
 * command family (`mcp setup` / `config` re-pick) that told the user to fill
 * the file. `.env.mcp` is gitignored by hatch3r's own design, so there was no
 * VCS recovery. This helper is the updater: it preserves every existing byte
 * verbatim and appends ONLY the required-but-absent vars under a labelled
 * demarcation header. `ensureEnvMcp` skips the write when nothing is missing,
 * so each var is appended at most once (idempotent by construction).
 *
 * Sources: OWASP Secrets Management Cheat Sheet
 * (cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html,
 * accessed 2026-07-09) — stored credentials are lifecycle-managed assets, not
 * incidental deletion targets.
 */
function appendMissingEnvVars(existingRaw: string, missing: EnvVar[]): string {
  if (missing.length === 0) return existingRaw;

  const appended: string[] = [
    "# --- hatch3r: appended MCP vars (existing values above are preserved) ---",
  ];
  for (const v of missing) {
    // F10 parity: sanitize comment/url at the interpolation boundary so a
    // pack-supplied value cannot smuggle an extra `KEY=value` line.
    const comment = sanitizeEnvMcpComment(v.comment, `comment for ${v.name}`);
    const url = v.url ? sanitizeEnvMcpComment(v.url, `url for ${v.name}`) : "";
    const urlPart = url ? ` — ${url}` : "";
    appended.push(`# ${comment}${urlPart}`);
    appended.push(`${v.name}=`);
    appended.push("");
  }

  // Preserve existing bytes; normalize only the trailing blank run so there is
  // exactly one blank line before the appended block (never drops a value or
  // comment — only collapses trailing empty lines).
  const base = existingRaw.replace(/\n*$/, "");
  return `${base}\n\n${appended.join("\n")}\n`;
}

/**
 * Creates or updates `.env.mcp` in the given root directory.
 *
 * Create: renders the full template. Update: a true merge — existing bytes are
 * preserved verbatim and only required-but-absent vars are appended (never a
 * template re-render over an existing file). See {@link appendMissingEnvVars}
 * (D1-SA1.2-02).
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

  let existingRaw = "";
  let existing: Record<string, string> = {};
  let hadFile = false;

  if (existsSync(envPath)) {
    hadFile = true;
    existingRaw = await readFile(envPath, "utf-8");
    existing = parseEnvFile(existingRaw);
  }

  const missingVars = vars.filter((v) => !(v.name in existing));
  const newVars = missingVars.map((v) => v.name);

  if (hadFile && newVars.length === 0) {
    return { action: "skipped", path: ENV_MCP_FILE, newVars: [] };
  }

  // D1-SA1.2-02: fresh file → render template; existing file → true-merge
  // append so no user-owned line is ever overwritten.
  const content = hadFile
    ? appendMissingEnvVars(existingRaw, missingVars)
    : generateEnvMcpContent(vars, existing);
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
