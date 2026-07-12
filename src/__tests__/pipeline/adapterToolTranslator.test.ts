import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  ADAPTER_ALLOWLIST_COVERAGE,
  PLATFORM_TOOL_MARKER,
  buildAllowlistCoverageTable,
  buildAskUserPlatformTable,
  getAskUserToolEntry,
  substituteCanonicalPlatformMarker,
  toAskUserPlatformNote,
  toClaudeToolsFrontmatter,
  toClaudeToolsFrontmatterFromCategories,
  toCopilotToolsFrontmatter,
  toCopilotToolsFrontmatterFromCategories,
  toCursorReadonlyFrontmatter,
} from "../../pipeline/adapterToolTranslator.js";

/**
 * Tests the D15 trust-delegation translator that converts
 * AGENT_TOOL_POLICIES to adapter-native allowlist primitives.
 *
 * Audit context: C7.5-W2B2-H41 (per-adapter `tools:` frontmatter
 * emission) and C7.5-W2B2-H45 (translator after frontmatter emission).
 * Resolves Cycle 6 Critical #3 / F15.5-01.
 */
describe("adapterToolTranslator", () => {
  describe("toClaudeToolsFrontmatter", () => {
    it("returns null for unknown agents (deny by omission; Claude Code inherits parent tools)", () => {
      expect(toClaudeToolsFrontmatter("unknown-agent")).toBeNull();
    });

    it("maps read + search to Read, Grep, Glob for a read-only researcher", () => {
      const fm = toClaudeToolsFrontmatter("hatch3r-researcher");
      expect(fm).not.toBeNull();
      // Researcher: read + search + web + mcp
      expect(fm).toContain("Read");
      expect(fm).toContain("Grep");
      expect(fm).toContain("Glob");
      expect(fm).toContain("WebSearch");
      expect(fm).toContain("WebFetch");
    });

    it("never emits Write or Edit for the reviewer (read+search only)", () => {
      const fm = toClaudeToolsFrontmatter("hatch3r-reviewer");
      expect(fm).not.toBeNull();
      expect(fm).toContain("Read");
      expect(fm).toContain("Grep");
      expect(fm).not.toContain("Write");
      expect(fm).not.toContain("Edit");
      expect(fm).not.toContain("Bash");
    });

    it("emits Edit/Write/Bash for the implementer (read+search+write+execute)", () => {
      const fm = toClaudeToolsFrontmatter("hatch3r-implementer");
      expect(fm).not.toBeNull();
      expect(fm).toContain("Read");
      expect(fm).toContain("Edit");
      expect(fm).toContain("Write");
      expect(fm).toContain("Bash");
    });

    // F16.3-H1 (Cycle 10 Wave 1C): the legacy security-auditor agent was
    // retired; CQ3 hatch3r-security is review-only (read+search) per its
    // §Boundaries section, so the historical "execute without write" mid-tier
    // policy no longer exists. The privilege-mode tests covered by this case
    // are exercised on read-only/implementer ends of the spectrum elsewhere
    // in this file.
  });

  describe("D2-SA2.4-03 platform-tool currency (tools-reference accessed 2026-07-10)", () => {
    it("emits the current read/search/execute platform tools for an execute-granted agent", () => {
      // A specified Claude `tools:` list EXCLUDES anything not enumerated, so the
      // current tool set must be present or those tools are unreachable at runtime.
      const fm = toClaudeToolsFrontmatter("hatch3r-implementer") ?? "";
      expect(fm).toContain("LSP"); // read
      expect(fm).toContain("ToolSearch"); // search
      expect(fm).toContain("PowerShell"); // execute (Windows shell parity with Bash)
      expect(fm).toContain("EnterWorktree"); // execute
      expect(fm).toContain("ExitWorktree"); // execute
    });

    it("grants read/search currency tools to a read+search agent but no execute-class tool (monotonic privilege)", () => {
      const fm = toClaudeToolsFrontmatter("hatch3r-reviewer") ?? "";
      expect(fm).toContain("LSP");
      expect(fm).toContain("ToolSearch");
      expect(fm).not.toContain("PowerShell");
      expect(fm).not.toContain("EnterWorktree");
    });
  });

  describe("toCopilotToolsFrontmatter", () => {
    it("returns null for unknown agents", () => {
      expect(toCopilotToolsFrontmatter("unknown-agent")).toBeNull();
    });

    it("maps researcher categories to Copilot aliases (read, search, web)", () => {
      const tools = toCopilotToolsFrontmatter("hatch3r-researcher");
      expect(tools).not.toBeNull();
      expect(tools).toContain("read");
      expect(tools).toContain("search");
      expect(tools).toContain("web");
      expect(tools).not.toContain("edit");
      expect(tools).not.toContain("execute");
    });

    it("maps reviewer to read+search only", () => {
      const tools = toCopilotToolsFrontmatter("hatch3r-reviewer");
      expect(tools).toEqual(expect.arrayContaining(["read", "search"]));
      expect(tools).not.toContain("edit");
      expect(tools).not.toContain("execute");
      expect(tools).not.toContain("web");
    });

    it("maps implementer to read+search+edit+execute", () => {
      const tools = toCopilotToolsFrontmatter("hatch3r-implementer");
      expect(tools).toEqual(expect.arrayContaining(["read", "search", "edit", "execute"]));
    });

    // D15-22 (SA15.3-F7, Cycle 11 Wave 3, P6): Copilot's `tools:` array is a
    // tool-level allowlist with no `Bash:<subcommand>` deny primitive, so the
    // `git` category collapses to the coarse `execute` alias — a git-restricted
    // agent receives unrestricted execute on Copilot. This collapse is disclosed
    // in SECURITY.md -> Allowlist Hybrid Contract (Copilot runtime row). Pin it
    // so a future map change that widens `git` to a finer token trips here and
    // forces the SECURITY.md disclosure to be re-reviewed.
    it("collapses the reserved git category to the coarse execute alias (no subcommand grain)", () => {
      const tools = toCopilotToolsFrontmatterFromCategories(["git"]);
      expect(tools).toEqual(["execute"]);
      // No finer-grained git/commit/push token exists on the Copilot surface.
      expect(tools).not.toContain("git");
    });
  });

  // D2-SA2.4-01 (Cycle 12 Wave 2, D2, P3): the `mcp` category maps to no fixed
  // tool name, so an enumerated `tools:` list EXCLUDES every MCP tool unless the
  // per-server grant tokens (`mcp__<server>` on Claude, `<server>/*` on Copilot)
  // are appended. Servers are threaded from the adapter's
  // ctx.manifest.mcp.servers selection.
  describe("D2-SA2.4-01 MCP server grants (per-server tools token)", () => {
    it("appends mcp__<server> to an mcp-granted agent's Claude tools (registry path)", () => {
      // hatch3r-researcher policy = read+search+web+mcp.
      const fm = toClaudeToolsFrontmatter("hatch3r-researcher", ["context7", "github"]) ?? "";
      expect(fm).toContain("mcp__context7");
      expect(fm).toContain("mcp__github");
      // Additive — the non-MCP grants survive alongside the MCP tokens.
      expect(fm).toContain("Read");
      expect(fm).toContain("WebSearch");
    });

    it("appends <server>/* to an mcp-granted agent's Copilot tools (registry path)", () => {
      const tools = toCopilotToolsFrontmatter("hatch3r-researcher", ["context7", "github"]) ?? [];
      expect(tools).toContain("context7/*");
      expect(tools).toContain("github/*");
      expect(tools).toContain("read");
    });

    it("adds no MCP token when no servers are selected (mcp-off case unchanged)", () => {
      const claudeUndef = toClaudeToolsFrontmatter("hatch3r-researcher") ?? "";
      const claudeEmpty = toClaudeToolsFrontmatter("hatch3r-researcher", []) ?? "";
      const copilotEmpty = toCopilotToolsFrontmatter("hatch3r-researcher", []) ?? [];
      expect(claudeUndef).not.toContain("mcp__");
      expect(claudeEmpty).not.toContain("mcp__");
      expect(copilotEmpty.some((t) => t.endsWith("/*"))).toBe(false);
    });

    it("adds no MCP token to an agent whose policy lacks the mcp category even when servers are selected", () => {
      // hatch3r-reviewer is read+search only — no mcp grant.
      const claude = toClaudeToolsFrontmatter("hatch3r-reviewer", ["context7"]) ?? "";
      const copilot = toCopilotToolsFrontmatter("hatch3r-reviewer", ["context7"]) ?? [];
      expect(claude).not.toContain("mcp__");
      expect(copilot).not.toContain("context7/*");
    });

    it("threads servers through the explicit-category (user-agent) path, gated on the mcp category", () => {
      const claude = toClaudeToolsFrontmatterFromCategories(["read", "mcp"], ["context7"]) ?? "";
      const copilot = toCopilotToolsFrontmatterFromCategories(["read", "mcp"], ["context7"]) ?? [];
      expect(claude).toContain("mcp__context7");
      expect(copilot).toEqual(expect.arrayContaining(["read", "context7/*"]));
      // Categories without `mcp` get no server token even when servers are passed.
      const noMcp = toClaudeToolsFrontmatterFromCategories(["read"], ["context7"]) ?? "";
      expect(noMcp).not.toContain("mcp__");
    });

    it("dedupes duplicate server names and preserves selection order", () => {
      const claude = toClaudeToolsFrontmatterFromCategories(["mcp"], ["b", "a", "b"]) ?? "";
      expect(claude).toBe("mcp__b, mcp__a");
      const copilot = toCopilotToolsFrontmatterFromCategories(["mcp"], ["b", "a", "b"]) ?? [];
      expect(copilot).toEqual(["b/*", "a/*"]);
    });
  });

  describe("toCursorReadonlyFrontmatter", () => {
    it("returns null for unknown agents so the caller preserves existing behaviour", () => {
      expect(toCursorReadonlyFrontmatter("unknown-agent")).toBeNull();
    });

    it("returns true for read-only agents (no write, no execute)", () => {
      expect(toCursorReadonlyFrontmatter("hatch3r-reviewer")).toBe(true);
      // D5-2 (Cycle 11 Wave 2): hatch3r-ci-watcher gained `execute` (it runs
      // platform-CLI `gh run list` + local lint/typecheck/test), so it is no
      // longer Cursor-readonly. context-rules gained only web+mcp (not
      // write/execute), so it stays readonly.
      expect(toCursorReadonlyFrontmatter("hatch3r-context-rules")).toBe(true);
    });

    it("returns false for ci-watcher (gained execute in D5-2 — runs shell commands)", () => {
      expect(toCursorReadonlyFrontmatter("hatch3r-ci-watcher")).toBe(false);
    });

    it("returns true for researcher (no write, no execute in its policy)", () => {
      // Researcher has read+search+web+mcp but not write/execute.
      expect(toCursorReadonlyFrontmatter("hatch3r-researcher")).toBe(true);
    });

    it("returns false for implementer (has write and execute)", () => {
      expect(toCursorReadonlyFrontmatter("hatch3r-implementer")).toBe(false);
    });

    // F16.3-H1 (Cycle 10 Wave 1C): legacy security-auditor retired; the CQ
    // security agent is review-only (read+search), so it now reports readonly
    // = true. The "returns false for an agent with execute" path is covered
    // by the implementer assertion above.
  });

  describe("monotonic-privilege invariant (regression guard for F15.5-01)", () => {
    it("never emits Write or Edit for any reviewer/read-only agent across adapters", () => {
      // D5-2 (Cycle 11 Wave 2): hatch3r-ci-watcher gained `execute` and is no
      // longer read-only — it is covered by the implementer "has write+execute"
      // path instead. The remaining ids still have read+search(+web+mcp) only.
      const readOnlyAgents = [
        "hatch3r-reviewer",
        "hatch3r-context-rules",
        "hatch3r-learnings-loader",
      ];
      for (const id of readOnlyAgents) {
        const claude = toClaudeToolsFrontmatter(id) ?? "";
        const copilot = toCopilotToolsFrontmatter(id) ?? [];
        expect(claude, `${id} Claude`).not.toContain("Write");
        expect(claude, `${id} Claude`).not.toContain("Edit");
        expect(claude, `${id} Claude`).not.toContain("Bash");
        expect(copilot, `${id} Copilot`).not.toContain("edit");
        expect(copilot, `${id} Copilot`).not.toContain("execute");
        // Cursor readonly must be true (cannot widen privilege).
        expect(toCursorReadonlyFrontmatter(id), `${id} Cursor readonly`).toBe(true);
      }
    });
  });
});

describe("ADAPTER_ALLOWLIST_COVERAGE + buildAllowlistCoverageTable (C9-H6)", () => {
  const EXPECTED_ADAPTERS = ["claude", "copilot", "cursor"];

  it("covers all 3 hatch3r adapters with explicit coverage statement", () => {
    expect(ADAPTER_ALLOWLIST_COVERAGE.length).toBe(3);
    const adapters = ADAPTER_ALLOWLIST_COVERAGE.map((r) => r.adapter).sort();
    expect(adapters).toEqual([...EXPECTED_ADAPTERS].sort());
  });

  it("reports all 3 adapters with full translator coverage", () => {
    const full = ADAPTER_ALLOWLIST_COVERAGE.filter((r) => r.coverage === "full");
    expect(full.length).toBe(3);
    for (const r of full) {
      expect(r.translator).not.toBeNull();
      expect(r.translator).toMatch(/^to[A-Z]/);
    }
  });

  it("reports zero adapters with documented coverage limits (all retained adapters have translators)", () => {
    const none = ADAPTER_ALLOWLIST_COVERAGE.filter((r) => r.coverage === "none");
    expect(none.length).toBe(0);
  });

  it("buildAllowlistCoverageTable renders a markdown table with 3 data rows", () => {
    const table = buildAllowlistCoverageTable();
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Adapter | Coverage | Translator | Rationale |");
    expect(lines[1]).toBe("|---------|----------|------------|-----------|");
    expect(lines.length - 2).toBe(3);
  });

  it("table cites translator export names for full-coverage adapters", () => {
    const table = buildAllowlistCoverageTable();
    expect(table).toContain("toClaudeToolsFrontmatter");
    expect(table).toContain("toCopilotToolsFrontmatter");
    expect(table).toContain("toCursorReadonlyFrontmatter");
  });
});

describe("ASK_USER_TOOLS + toAskUserPlatformNote", () => {
  const KNOWN_ADAPTERS = ["claude", "cursor", "copilot"];

  it("returns an entry or null for every known adapter", () => {
    for (const a of KNOWN_ADAPTERS) {
      const entry = getAskUserToolEntry(a);
      if (entry !== null) {
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.name.length).toBeLessThanOrEqual(30);
        expect(entry.name).not.toMatch(/\s/);
      }
    }
  });

  it("returns a populated entry for claude", () => {
    const entry = getAskUserToolEntry("claude");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("AskUserQuestion");
  });

  it("returns null for unknown adapter names (deny-by-default)", () => {
    expect(getAskUserToolEntry("does-not-exist")).toBeNull();
  });

  it("toAskUserPlatformNote returns native-case prose for claude", () => {
    const note = toAskUserPlatformNote("claude");
    expect(note).toContain("AskUserQuestion");
    expect(note).toContain("ASK checkpoint");
  });

  it("toAskUserPlatformNote returns fallback prose for unknown adapter", () => {
    const note = toAskUserPlatformNote("does-not-exist");
    expect(note.toLowerCase()).toContain("no documented native");
  });

  it("native-case prose contains a code-fenced tool name", () => {
    const note = toAskUserPlatformNote("claude");
    expect(note).toMatch(/`[A-Za-z0-9_]+`/);
  });
});

describe("buildAskUserPlatformTable + substituteCanonicalPlatformMarker", () => {
  it("renders a markdown table with header and one row per known adapter", () => {
    const table = buildAskUserPlatformTable();
    expect(table.split("\n")[0]).toBe("| Adapter | Platform-Native Question Tool |");
    expect(table.split("\n")[1]).toBe("|---------|-------------------------------|");
    const rowLines = table.split("\n").slice(2);
    expect(rowLines.length).toBe(3);
  });

  it("table cites AskUserQuestion in the claude row", () => {
    const table = buildAskUserPlatformTable();
    expect(table).toMatch(/\| `claude` \| Invoke the `AskUserQuestion` tool/);
  });

  it("table uses fallback prose for adapters with null entries (cursor, copilot)", () => {
    const table = buildAskUserPlatformTable();
    expect(table).toMatch(/\| `cursor` \| _No documented native tool/);
    expect(table).toMatch(/\| `copilot` \| _No documented native tool/);
  });

  it("substituteCanonicalPlatformMarker replaces the marker with the table", () => {
    const before = `before\n${PLATFORM_TOOL_MARKER}\nafter`;
    const after = substituteCanonicalPlatformMarker(before);
    expect(after).not.toContain(PLATFORM_TOOL_MARKER);
    expect(after).toContain("| Adapter | Platform-Native Question Tool |");
    expect(after.startsWith("before\n")).toBe(true);
    expect(after.endsWith("\nafter")).toBe(true);
  });

  it("substituteCanonicalPlatformMarker is a no-op when the marker is absent", () => {
    const input = "no marker here\njust prose";
    expect(substituteCanonicalPlatformMarker(input)).toBe(input);
  });

  it("substituteCanonicalPlatformMarker handles multiple marker occurrences", () => {
    const input = `${PLATFORM_TOOL_MARKER}\n---\n${PLATFORM_TOOL_MARKER}`;
    const result = substituteCanonicalPlatformMarker(input);
    expect(result).not.toContain(PLATFORM_TOOL_MARKER);
    const matches = result.match(/Platform-Native Question Tool/g);
    expect(matches?.length).toBe(2);
  });

  it("PLATFORM_TOOL_MARKER is the documented HTML comment token", () => {
    expect(PLATFORM_TOOL_MARKER).toBe("<!-- HATCH3R:PLATFORM-TOOL -->");
  });
});

// D2-SA2.4-14 (Cycle 12 Wave 4, D2, P4): the module-doc header enumerates the
// tool-allowlist TARGET platforms. It is prose, so no compiler/parity gate
// caught the stale "Windsurf Cascade" row that survived the 1.9.0 three-adapter
// hard-cut and contradicted the removal notes 70 lines below. This gate reads
// the header block and binds its platform-bullet count to AdapterName's three
// members (via ADAPTER_ALLOWLIST_COVERAGE, itself bound to AdapterName's exact
// members by the coverage tests above), holding the D2 stale-surface metric at
// 0 for this header so a removed adapter cannot silently reappear.
describe("D2-SA2.4-14 module-header target-platform enumeration (stale-surface gate)", () => {
  const source = readFileSync(
    join(process.cwd(), "src/pipeline/adapterToolTranslator.ts"),
    "utf-8",
  );
  // The "What this module does:" enumeration ends where "Design constraints:"
  // begins; the removal-note comments (which correctly name windsurf as a
  // REMOVED adapter) live far below this slice and are not gated here.
  const headerStart = source.indexOf("What this module does:");
  const headerEnd = source.indexOf("Design constraints:");
  const headerBlock = source.slice(headerStart, headerEnd);

  it("locates the header enumeration block", () => {
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerEnd).toBeGreaterThan(headerStart);
  });

  it("lists exactly one platform bullet per AdapterName member (== ADAPTER_ALLOWLIST_COVERAGE length)", () => {
    const bullets = headerBlock.match(/\n\s*\*\s+-\s/g) ?? [];
    expect(bullets.length).toBe(ADAPTER_ALLOWLIST_COVERAGE.length);
  });

  it("names each of the three supported target platforms", () => {
    expect(headerBlock).toContain("Claude Code");
    expect(headerBlock).toContain("GitHub Copilot");
    expect(headerBlock).toContain("Cursor");
  });

  it("names none of the 1.9.0-removed adapters (windsurf + the other 11)", () => {
    const REMOVED_ADAPTERS = [
      "windsurf",
      "cline",
      "opencode",
      "amazonq",
      "kiro",
      "gemini",
      "aider",
      "amp",
      "antigravity",
      "codex",
      "goose",
      "zed",
    ];
    for (const name of REMOVED_ADAPTERS) {
      expect(
        new RegExp(`\\b${name}\\b`, "i").test(headerBlock),
        `header enumeration must not name removed adapter "${name}"`,
      ).toBe(false);
    }
  });
});
