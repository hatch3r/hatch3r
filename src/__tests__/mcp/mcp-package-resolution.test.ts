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
// form `{ "command": "glab", "args": ["mcp"] }` (matches docs/mcp-setup.md
// "GitLab token scopes" -> `glab mcp`), so npx never resolves the bare name.
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
    // dependency-confusion vector). It must use the local-CLI launcher form.
    expect(gitlab.command).toBe("glab");
    expect(gitlab.args).toEqual(["mcp"]);

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
});
