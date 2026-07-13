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
import {
  readMcpConfig,
  CANONICAL_MCP_PACKAGES,
} from "../../adapters/mcp-utils.js";

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

// D15-25 (Cycle 11 Wave 3, Medium, P6/SA15.5-F2): CANONICAL_MCP_PACKAGES is the
// allowlist `checkVersionPin` uses to ESCALATE an unpinned UNKNOWN package to
// the dependency-confusion / wrong-launcher class (vs a vetted package that
// merely lacks a version). The set is a hand-mirrored copy of the npx-launched
// package base-names in the bundled `mcp/mcp.json`; if it drifts from the real
// bundle, the gate either under-warns (a real canonical package wrongly flagged
// "unknown") or mis-escalates. This loads the REAL bundle (Decision 20) and
// asserts lockstep in both directions so a canonical add/remove that forgets the
// allowlist breaks here rather than shipping a wrong supply-chain signal.
describe("CANONICAL_MCP_PACKAGES — lockstep with bundled mcp.json (D15-25)", () => {
  // Base name (scope + name, no version) of an npx fetch-launcher's package
  // positional arg — the unit CANONICAL_MCP_PACKAGES is keyed by. Returns null
  // for non-npx or argless entries (HTTP transports, the `glab` system binary).
  function npxPackageBaseName(entry: McpServerEntry): string | null {
    const target = firstNpxPositionalArg(entry);
    if (target === null) return null;
    // Scoped (`@scope/pkg[@version]`): version `@` is the SECOND `@`.
    // Unscoped (`pkg[@version]`): the first `@`.
    const at = target.startsWith("@")
      ? target.indexOf("@", 1)
      : target.indexOf("@");
    return at > 0 ? target.slice(0, at) : target;
  }

  function bundledNpxPackageBaseNames(): Set<string> {
    const servers = loadBundledMcpServers();
    const names = new Set<string>();
    for (const entry of Object.values(servers)) {
      const base = npxPackageBaseName(entry);
      if (base !== null) names.add(base);
    }
    return names;
  }

  it("every npx-launched bundled package base-name is in the allowlist", () => {
    const bundled = bundledNpxPackageBaseNames();
    expect(bundled.size, "expected at least one npx-launched bundled server").toBeGreaterThan(0);
    const missing = [...bundled].filter((n) => !CANONICAL_MCP_PACKAGES.has(n));
    expect(
      missing,
      `bundled npx package(s) absent from CANONICAL_MCP_PACKAGES (mcp-utils.ts) — ` +
        `add them or the version-pin gate will mis-flag them as "unknown": ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the allowlist has no stale entries missing from the bundled pack", () => {
    const bundled = bundledNpxPackageBaseNames();
    const stale = [...CANONICAL_MCP_PACKAGES].filter((n) => !bundled.has(n));
    expect(
      stale,
      `CANONICAL_MCP_PACKAGES entr(ies) no longer present as an npx server in ` +
        `mcp/mcp.json — remove them to keep the allowlist a true mirror: ${stale.join(", ")}`,
    ).toEqual([]);
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

// D15-SA15.5-01 (Cycle 12 Wave 3, Medium, P6 Security & Trust): the docs' GitHub
// MCP toolset enumeration (docs/mcp-setup.md "Server details") must equal the
// shipped `X-MCP-Toolsets` header in mcp/mcp.json as a SET. Before this guard,
// mcp-setup.md claimed the header enabled `projects` while the shipped header
// enabled only repos,issues,pull_requests — a least-privilege security doc
// misstating the granted tool surface (`projects` is deliberately excluded as a
// high-blast-radius toolset per docs/mcp-server-blast-radius.md). This loads the
// REAL bundled pack + the REAL doc (Decision 20, real-deal-first) so the two
// surfaces cannot drift again without failing here.
describe("github MCP toolset — docs/config parity (D15-SA15.5-01)", () => {
  function csvToSet(csv: string): Set<string> {
    return new Set(csv.split(",").map((t) => t.trim()).filter((t) => t.length > 0));
  }

  function githubHeaderToolsets(): Set<string> {
    const servers = loadBundledMcpServers() as Record<
      string,
      McpServerEntry & { headers?: Record<string, unknown> }
    >;
    const github = servers.github;
    expect(github, "github server entry must exist in the bundled pack").toBeTruthy();
    const raw = github.headers?.["X-MCP-Toolsets"];
    expect(typeof raw, "github server must carry an X-MCP-Toolsets header string").toBe("string");
    return csvToSet(raw as string);
  }

  function docsEnumeratedToolsets(): Set<string> {
    const raw = readFileSync(join(PKG_ROOT, "docs", "mcp-setup.md"), "utf-8");
    const m = raw.match(/Uses `X-MCP-Toolsets` for ([^.\n]+)\./);
    expect(
      m,
      "docs/mcp-setup.md must enumerate the GitHub X-MCP-Toolsets set in the Server details section",
    ).toBeTruthy();
    return csvToSet((m as RegExpMatchArray)[1]);
  }

  it("the docs' GitHub toolset enumeration matches the shipped X-MCP-Toolsets header", () => {
    const header = [...githubHeaderToolsets()].sort();
    const docs = [...docsEnumeratedToolsets()].sort();
    expect(
      docs,
      `docs/mcp-setup.md enumerates GitHub toolsets ${JSON.stringify(docs)} but the shipped ` +
        `mcp/mcp.json X-MCP-Toolsets header grants ${JSON.stringify(header)} — reconcile the doc with the config`,
    ).toEqual(header);
  });
});
