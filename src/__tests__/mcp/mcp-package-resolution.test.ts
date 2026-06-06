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
import { readMcpConfig } from "../../adapters/mcp-utils.js";

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

  // D15-26 (Cycle 11 Wave 3, Medium, P3 MCP supply-chain currency): the
  // default-enabled `brave-search` server previously pinned the reference
  // package `@modelcontextprotocol/server-brave-search@0.6.2`, which npm marks
  // deprecated ("Package no longer supported") and Brave archived in favour of
  // its officially maintained `@brave/brave-search-mcp-server` (verified
  // non-deprecated, `npm view` 2026-06-06). Migrated to the official server
  // (stdio transport via `--transport stdio`). This static guard locks the root
  // cause so a future edit cannot reintroduce the archived reference package.
  it("the brave-search server does not pin the deprecated @modelcontextprotocol/server-brave-search package", () => {
    const servers = loadBundledMcpServers();
    const brave = servers["brave-search"];
    expect(brave, "brave-search server entry must exist in the bundled pack").toBeTruthy();

    const argStrings = Array.isArray(brave.args)
      ? (brave.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    for (const arg of argStrings) {
      const at = arg.startsWith("@") ? arg.indexOf("@", 1) : arg.indexOf("@");
      const pkgName = at > 0 ? arg.slice(0, at) : arg;
      expect(
        pkgName,
        `brave-search launches \`${arg}\` — @modelcontextprotocol/server-brave-search is deprecated on npm ("Package no longer supported"); pin Brave's maintained @brave/brave-search-mcp-server instead`,
      ).not.toBe("@modelcontextprotocol/server-brave-search");
    }
  });
});

// D11-15 (Cycle 11 Wave 3, Medium, P6/SA11.3-F3): the bundled `github` server
// uses an HTTP transport with `_trust_bypass: true` (its endpoint,
// api.githubcopilot.com, is a rotating GitHub-operated remote with no stable
// artifact to SHA-256 pin). Before this fix, `validateMcpEntry` emitted an
// un-actionable "pinning bypassed" warning on EVERY `readMcpConfig` of the
// shipped pack, training operators to ignore MCP security warnings (alarm
// fatigue). The fix records `_trust_bypass_reason` on the entry, which
// suppresses the per-server warning while keeping the opt-out auditable in the
// config. This loads the REAL bundled pack (real-deal-first, CONSTITUTION §2 P2
// Decision 20) so a future edit that drops the reason re-fails here.
describe("bundled mcp.json — bypass-warning hygiene (D11-15)", () => {
  it("the github server carries a documented _trust_bypass_reason", () => {
    const servers = loadBundledMcpServers() as Record<
      string,
      McpServerEntry & { _trust_bypass?: unknown; _trust_bypass_reason?: unknown }
    >;
    const github = servers.github;
    expect(github, "github server entry must exist in the bundled pack").toBeTruthy();
    expect(github._trust_bypass).toBe(true);
    expect(typeof github._trust_bypass_reason).toBe("string");
    expect((github._trust_bypass_reason as string).trim()).not.toBe("");
  });

  it("readMcpConfig of the bundled pack emits no 'pinning bypassed' warning", async () => {
    const { warnings } = await readMcpConfig(PKG_ROOT);
    const bypassWarnings = warnings.filter((w) => w.includes("pinning bypassed"));
    expect(
      bypassWarnings,
      `bundled pack should not self-emit bypass-fatigue warnings, got: ${JSON.stringify(bypassWarnings)}`,
    ).toEqual([]);
  });
});
