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
  toCopilotToolsFrontmatter,
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
  });

  describe("toCursorReadonlyFrontmatter", () => {
    it("returns null for unknown agents so the caller preserves existing behaviour", () => {
      expect(toCursorReadonlyFrontmatter("unknown-agent")).toBeNull();
    });

    it("returns true for read-only agents (no write, no execute)", () => {
      expect(toCursorReadonlyFrontmatter("hatch3r-reviewer")).toBe(true);
      expect(toCursorReadonlyFrontmatter("hatch3r-ci-watcher")).toBe(true);
      expect(toCursorReadonlyFrontmatter("hatch3r-context-rules")).toBe(true);
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
      const readOnlyAgents = [
        "hatch3r-reviewer",
        "hatch3r-ci-watcher",
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
