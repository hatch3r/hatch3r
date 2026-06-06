// D15-1 (Cycle 11 Wave 1, Critical, P6 Security & Trust): dependency-confusion
// regression guard for the bundled MCP server pack (`mcp/mcp.json`).
//
// Root cause this test locks down: the `gitlab` server was declared as
// `npx -y glab mcp`. The bare npm name `glab` is NOT an npm package — `glab`
// is the GitLab CLI, a Go binary — and its only npm versions were UNPUBLISHED
// 2026-05-30. `npx -y <bare-name>` against an unpublished name (a) fails for
// every user and (b) opens a dependency-confusion window: `-y` auto-installs
// and executes whatever an attacker re-registers under `glab`, an npx-time RCE
// with editor privileges. The fix moves `gitlab` to the local-CLI launcher
// form `{ "command": "glab", "args": ["mcp", "serve"] }`, so npx never resolves
// the bare name.
//
// D11-8 (Cycle 11 Wave 2, High, P3/P6) advanced the subcommand from the bare
// `["mcp"]` to `["mcp", "serve"]`: `glab mcp` is the parent command GROUP and
// prints help without starting a server, whereas `glab mcp serve` is the stdio
// MCP server entrypoint (https://docs.gitlab.com/cli/mcp/serve/, accessed
// 2026-06-06). The Wave-1 npx-drop is unchanged; only the exact-args
// expectation advances from the help-only form to the runnable server form.
//
// This loads the REAL bundled `mcp/mcp.json` (no fixtures, no mocks) per
// CONSTITUTION §2 P2 Decision 20 (real-deal-first): a fixtures-only test would
// pass while the shipped pack still carried the vulnerable launcher.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../../cli/shared/paths.js";

interface McpServerEntry {
  command?: unknown;
  args?: unknown;
  url?: unknown;
  _disabled?: unknown;
}

const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const MCP_JSON_PATH = join(PKG_ROOT, "mcp", "mcp.json");

function loadBundledMcpServers(): Record<string, McpServerEntry> {
  const raw = readFileSync(MCP_JSON_PATH, "utf-8");
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerEntry> };
  expect(parsed.mcpServers, `mcpServers missing in ${MCP_JSON_PATH}`).toBeTruthy();
  return parsed.mcpServers as Record<string, McpServerEntry>;
}

/**
 * An npx target is "bare/unscoped" when it is the first non-flag positional
 * arg of an `npx` launcher AND does not start with `@` (a scoped name like
 * `@modelcontextprotocol/server-filesystem`). Bare unscoped names are the
 * dependency-confusion attack surface: an attacker can register the public
 * name and `npx -y` will fetch and execute it. Scoped names under an owned
 * org are not confusable.
 */
function firstNpxPositionalArg(entry: McpServerEntry): string | null {
  if (entry.command !== "npx") return null;
  const args = Array.isArray(entry.args) ? (entry.args as unknown[]) : [];
  for (const raw of args) {
    if (typeof raw !== "string") continue;
    if (raw.startsWith("-")) continue; // skip flags like -y / --no-install
    return raw;
  }
  return null;
}

describe("bundled mcp.json — dependency-confusion guard (D15-1)", () => {
  it("the gitlab server launches the local glab CLI, NOT `npx ... glab`", () => {
    const servers = loadBundledMcpServers();
    const gitlab = servers.gitlab;
    expect(gitlab, "gitlab server entry must exist in the bundled pack").toBeTruthy();

    // Root-cause assertion: gitlab must not use npx at all (the npx path is the
    // dependency-confusion vector). It must use the local-CLI launcher form with
    // the runnable `mcp serve` subcommand (bare `mcp` only prints help). See
    // https://docs.gitlab.com/cli/mcp/serve/ (accessed 2026-06-06).
    expect(gitlab.command).toBe("glab");
    expect(gitlab.args).toEqual(["mcp", "serve"]);

    // Negative guard: there is no `npx ... glab` launcher anywhere in the entry.
    expect(gitlab.command).not.toBe("npx");
    const argStrings = Array.isArray(gitlab.args)
      ? (gitlab.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    expect(argStrings).not.toContain("glab");
  });

  it("no MCP server in the bundled pack launches the bare unpublished name `glab` via npx", () => {
    const servers = loadBundledMcpServers();
    for (const [name, entry] of Object.entries(servers)) {
      const target = firstNpxPositionalArg(entry);
      if (target === null) continue;
      // The package name is everything left of the version `@` (unscoped form).
      const at = target.indexOf("@");
      const pkgName = at === -1 ? target : target.slice(0, at);
      expect(
        pkgName,
        `server "${name}" launches \`npx ${target}\` — \`glab\` is an unpublished bare name (GitLab CLI is a Go binary); use the local-CLI launcher form { command: "glab" }`,
      ).not.toBe("glab");
    }
  });

  it("no ENABLED npx server uses a bare unscoped package name (dependency-confusion surface)", () => {
    const servers = loadBundledMcpServers();
    const offenders: Array<{ name: string; target: string }> = [];
    for (const [name, entry] of Object.entries(servers)) {
      if (entry._disabled === true) continue; // only enabled (active) servers
      const target = firstNpxPositionalArg(entry);
      if (target === null) continue;
      // A scoped name (`@scope/pkg`) is not confusable with a public bare name.
      if (target.startsWith("@")) continue;
      offenders.push({ name, target });
    }
    expect(
      offenders,
      `enabled servers launching a bare unscoped npx name (dependency-confusion risk): ${offenders
        .map((o) => `${o.name} -> npx ${o.target}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  // D15-8 (Cycle 11 Wave 2, High, P3 MCP supply-chain currency): the `postgres`
  // server previously pinned `@modelcontextprotocol/server-postgres@0.6.2`,
  // which npm marks deprecated ("Package no longer supported"), Anthropic
  // archived 2025-05-29, and Datadog documented a SQL-injection bypassing the
  // read-only restriction. Even shipped `_disabled: true`, it is a first-class
  // enable-on-demand default. Replaced with the maintained, non-deprecated
  // `@henkey/postgres-mcp-server`. This static guard locks the root cause so a
  // future edit cannot reintroduce the archived package name.
  it("the postgres server does not pin the archived @modelcontextprotocol/server-postgres package", () => {
    const servers = loadBundledMcpServers();
    const postgres = servers.postgres;
    expect(postgres, "postgres server entry must exist in the bundled pack").toBeTruthy();

    const argStrings = Array.isArray(postgres.args)
      ? (postgres.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    for (const arg of argStrings) {
      const at = arg.startsWith("@") ? arg.indexOf("@", 1) : arg.indexOf("@");
      const pkgName = at > 0 ? arg.slice(0, at) : arg;
      expect(
        pkgName,
        `postgres launches \`${arg}\` — @modelcontextprotocol/server-postgres is deprecated/archived with a documented SQL-injection (Datadog); pin a maintained PostgreSQL MCP server instead`,
      ).not.toBe("@modelcontextprotocol/server-postgres");
    }
  });
});
