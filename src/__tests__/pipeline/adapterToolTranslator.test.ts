import { describe, it, expect } from "vitest";
import {
  ADAPTER_ALLOWLIST_COVERAGE,
  PLATFORM_TOOL_MARKER,
  buildAllowlistCoverageTable,
  buildAskUserPlatformTable,
  getAskUserToolEntry,
  substituteCanonicalPlatformMarker,
  toAmazonQAllowedTools,
  toAskUserPlatformNote,
  toClaudeToolsFrontmatter,
  toCopilotToolsFrontmatter,
  toCursorReadonlyFrontmatter,
  toGeminiCoreTools,
  toKiroTools,
  toOpenCodePermissionFrontmatter,
  toWindsurfToolsFrontmatter,
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

    it("emits Bash for the security-auditor (read+search+execute, no write)", () => {
      const fm = toClaudeToolsFrontmatter("hatch3r-security-auditor");
      expect(fm).not.toBeNull();
      expect(fm).toContain("Read");
      expect(fm).toContain("Bash");
      expect(fm).not.toContain("Write");
      expect(fm).not.toContain("Edit");
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

    it("returns false for security-auditor (has execute)", () => {
      expect(toCursorReadonlyFrontmatter("hatch3r-security-auditor")).toBe(false);
    });
  });

  describe("toWindsurfToolsFrontmatter", () => {
    it("returns null for unknown agents", () => {
      expect(toWindsurfToolsFrontmatter("unknown-agent")).toBeNull();
    });

    it("produces the same mapping as Claude Code for researcher", () => {
      const wfm = toWindsurfToolsFrontmatter("hatch3r-researcher");
      const cfm = toClaudeToolsFrontmatter("hatch3r-researcher");
      expect(wfm).toBe(cfm);
    });

    it("emits Bash for the implementer", () => {
      const fm = toWindsurfToolsFrontmatter("hatch3r-implementer");
      expect(fm).toContain("Bash");
      expect(fm).toContain("Write");
    });
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
        const windsurf = toWindsurfToolsFrontmatter(id) ?? "";
        expect(claude, `${id} Claude`).not.toContain("Write");
        expect(claude, `${id} Claude`).not.toContain("Edit");
        expect(claude, `${id} Claude`).not.toContain("Bash");
        expect(copilot, `${id} Copilot`).not.toContain("edit");
        expect(copilot, `${id} Copilot`).not.toContain("execute");
        expect(windsurf, `${id} Windsurf`).not.toContain("Write");
        expect(windsurf, `${id} Windsurf`).not.toContain("Edit");
        // Cursor readonly must be true (cannot widen privilege).
        expect(toCursorReadonlyFrontmatter(id), `${id} Cursor readonly`).toBe(true);
      }
    });
  });
});

describe("toOpenCodePermissionFrontmatter (C9-H6)", () => {
  it("returns null for unknown agents", () => {
    expect(toOpenCodePermissionFrontmatter("unknown-agent")).toBeNull();
  });

  it("emits allow for read+search categories and deny for write/bash for reviewer", () => {
    const perm = toOpenCodePermissionFrontmatter("hatch3r-reviewer");
    expect(perm).not.toBeNull();
    expect(perm!.read).toBe("allow");
    expect(perm!.grep).toBe("allow");
    expect(perm!.glob).toBe("allow");
    expect(perm!.edit).toBe("deny");
    expect(perm!.bash).toBe("deny");
    expect(perm!.webfetch).toBe("deny");
    expect(perm!.websearch).toBe("deny");
  });

  it("emits allow for edit and bash for implementer", () => {
    const perm = toOpenCodePermissionFrontmatter("hatch3r-implementer");
    expect(perm!.read).toBe("allow");
    expect(perm!.edit).toBe("allow");
    expect(perm!.bash).toBe("allow");
    expect(perm!.task).toBe("allow"); // execute grants task too
  });

  it("emits allow for web tools for researcher", () => {
    const perm = toOpenCodePermissionFrontmatter("hatch3r-researcher");
    expect(perm!.read).toBe("allow");
    expect(perm!.webfetch).toBe("allow");
    expect(perm!.websearch).toBe("allow");
    expect(perm!.edit).toBe("deny");
    expect(perm!.bash).toBe("deny");
  });

  it("never emits 'ask' as a value (deterministic policies only)", () => {
    const perm = toOpenCodePermissionFrontmatter("hatch3r-implementer");
    for (const v of Object.values(perm!)) {
      expect(v).not.toBe("ask");
      expect(["allow", "deny"]).toContain(v);
    }
  });

  it("covers every documented OpenCode permission key", () => {
    const perm = toOpenCodePermissionFrontmatter("hatch3r-implementer");
    const keys = Object.keys(perm!).sort();
    expect(keys).toEqual(
      ["bash", "edit", "glob", "grep", "lsp", "read", "skill", "task", "webfetch", "websearch"].sort(),
    );
  });
});

describe("toAmazonQAllowedTools (C9-H6)", () => {
  it("returns null for unknown agents", () => {
    expect(toAmazonQAllowedTools("unknown-agent")).toBeNull();
  });

  it("maps reviewer to fs_read only", () => {
    const tools = toAmazonQAllowedTools("hatch3r-reviewer");
    expect(tools).toEqual(["fs_read"]);
  });

  it("maps implementer to fs_read+fs_write+execute_bash", () => {
    const tools = toAmazonQAllowedTools("hatch3r-implementer");
    expect(tools).toEqual(expect.arrayContaining(["fs_read", "fs_write", "execute_bash"]));
  });

  it("maps researcher to fs_read only (no built-in web tool in @builtin namespace)", () => {
    const tools = toAmazonQAllowedTools("hatch3r-researcher");
    expect(tools).toEqual(["fs_read"]);
  });

  it("emits tools in deterministic canonical order", () => {
    const a = toAmazonQAllowedTools("hatch3r-implementer");
    const b = toAmazonQAllowedTools("hatch3r-implementer");
    expect(a).toEqual(b);
    // Canonical order: read -> write -> execute
    const indices = a!.map((t) => ["fs_read", "fs_write", "execute_bash"].indexOf(t));
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
  });

  it("never emits fs_write for read-only agents", () => {
    for (const id of ["hatch3r-reviewer", "hatch3r-ci-watcher", "hatch3r-researcher"]) {
      expect(toAmazonQAllowedTools(id)).not.toContain("fs_write");
    }
  });
});

describe("toKiroTools (C9-H6)", () => {
  it("returns null for unknown agents", () => {
    expect(toKiroTools("unknown-agent")).toBeNull();
  });

  it("maps reviewer to read only", () => {
    const tools = toKiroTools("hatch3r-reviewer");
    expect(tools).toEqual(["read"]);
  });

  it("maps implementer to read+write+shell in canonical order", () => {
    const tools = toKiroTools("hatch3r-implementer");
    expect(tools).toEqual(["read", "write", "shell"]);
  });

  it("maps security-auditor to read+shell (no write)", () => {
    const tools = toKiroTools("hatch3r-security-auditor");
    expect(tools).toEqual(["read", "shell"]);
  });

  it("never emits write for read-only agents", () => {
    for (const id of ["hatch3r-reviewer", "hatch3r-ci-watcher", "hatch3r-context-rules"]) {
      const tools = toKiroTools(id);
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("shell");
    }
  });
});

describe("toGeminiCoreTools (C9-H6)", () => {
  it("returns null for unknown agents", () => {
    expect(toGeminiCoreTools("unknown-agent")).toBeNull();
  });

  it("maps reviewer to read+search tools only", () => {
    const tools = toGeminiCoreTools("hatch3r-reviewer");
    expect(tools).toEqual(
      expect.arrayContaining(["ReadFileTool", "ReadFolderTool", "GrepTool", "GlobTool"]),
    );
    expect(tools).not.toContain("WriteFileTool");
    expect(tools).not.toContain("EditTool");
    expect(tools).not.toContain("ShellTool");
  });

  it("maps implementer to read+search+write+execute", () => {
    const tools = toGeminiCoreTools("hatch3r-implementer");
    expect(tools).toEqual(
      expect.arrayContaining([
        "ReadFileTool",
        "WriteFileTool",
        "EditTool",
        "ShellTool",
      ]),
    );
  });

  it("maps researcher to read+search+web (no write, no execute)", () => {
    const tools = toGeminiCoreTools("hatch3r-researcher");
    expect(tools).toContain("ReadFileTool");
    expect(tools).toContain("WebFetchTool");
    expect(tools).toContain("GoogleWebSearchTool");
    expect(tools).not.toContain("WriteFileTool");
    expect(tools).not.toContain("ShellTool");
  });

  it("emits canonical tool names matching Gemini CLI built-in registry", () => {
    const tools = toGeminiCoreTools("hatch3r-implementer");
    for (const t of tools!) {
      expect(t).toMatch(/^[A-Z][A-Za-z]+Tool$/);
    }
  });
});

describe("ADAPTER_ALLOWLIST_COVERAGE + buildAllowlistCoverageTable (C9-H6)", () => {
  const EXPECTED_ADAPTERS = [
    "claude", "copilot", "cursor", "windsurf", "cline",
    "opencode", "amazon-q", "kiro", "gemini",
    "aider", "amp", "antigravity", "codex", "goose", "zed",
  ];

  it("covers all 15 hatch3r adapters with explicit coverage statement", () => {
    expect(ADAPTER_ALLOWLIST_COVERAGE.length).toBe(15);
    const adapters = ADAPTER_ALLOWLIST_COVERAGE.map((r) => r.adapter).sort();
    expect(adapters).toEqual([...EXPECTED_ADAPTERS].sort());
  });

  it("reports 9 adapters with full translator coverage", () => {
    const full = ADAPTER_ALLOWLIST_COVERAGE.filter((r) => r.coverage === "full");
    expect(full.length).toBe(9);
    for (const r of full) {
      expect(r.translator).not.toBeNull();
      expect(r.translator).toMatch(/^to[A-Z]/);
    }
  });

  it("reports 6 adapters with documented coverage limits", () => {
    const none = ADAPTER_ALLOWLIST_COVERAGE.filter((r) => r.coverage === "none");
    expect(none.length).toBe(6);
    const noCoverageAdapters = none.map((r) => r.adapter).sort();
    expect(noCoverageAdapters).toEqual(["aider", "amp", "antigravity", "codex", "goose", "zed"]);
    for (const r of none) {
      expect(r.translator).toBeNull();
      expect(r.rationale.length).toBeGreaterThan(20);
      expect(r.rationale.length).toBeLessThanOrEqual(200);
      expect(r.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("buildAllowlistCoverageTable renders a markdown table with 15 data rows", () => {
    const table = buildAllowlistCoverageTable();
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Adapter | Coverage | Translator | Rationale |");
    expect(lines[1]).toBe("|---------|----------|------------|-----------|");
    expect(lines.length - 2).toBe(15);
  });

  it("table cites translator export names for full-coverage adapters", () => {
    const table = buildAllowlistCoverageTable();
    expect(table).toContain("toClaudeToolsFrontmatter");
    expect(table).toContain("toOpenCodePermissionFrontmatter");
    expect(table).toContain("toAmazonQAllowedTools");
    expect(table).toContain("toKiroTools");
    expect(table).toContain("toGeminiCoreTools");
    expect(table).toContain("toClineGroupsFrontmatter");
  });

  it("table emits em-dash for adapters without a translator", () => {
    const table = buildAllowlistCoverageTable();
    // Each of the 6 no-coverage adapters must appear with the em-dash placeholder.
    for (const adapter of ["aider", "amp", "antigravity", "codex", "goose", "zed"]) {
      expect(table).toMatch(new RegExp(`\\| \`${adapter}\` \\| none \\| — \\|`));
    }
  });
});

describe("C9-H6 cross-adapter monotonic-privilege invariant", () => {
  const READ_ONLY_AGENTS = [
    "hatch3r-reviewer",
    "hatch3r-ci-watcher",
    "hatch3r-context-rules",
    "hatch3r-learnings-loader",
  ];

  it("never widens privilege on OpenCode for read-only agents", () => {
    for (const id of READ_ONLY_AGENTS) {
      const perm = toOpenCodePermissionFrontmatter(id);
      expect(perm, `${id} OpenCode`).not.toBeNull();
      expect(perm!.edit, `${id} OpenCode edit`).toBe("deny");
      expect(perm!.bash, `${id} OpenCode bash`).toBe("deny");
      expect(perm!.task, `${id} OpenCode task`).toBe("deny");
    }
  });

  it("never widens privilege on Amazon Q for read-only agents", () => {
    for (const id of READ_ONLY_AGENTS) {
      const tools = toAmazonQAllowedTools(id);
      expect(tools, `${id} AmazonQ`).not.toBeNull();
      expect(tools, `${id} AmazonQ fs_write`).not.toContain("fs_write");
      expect(tools, `${id} AmazonQ execute_bash`).not.toContain("execute_bash");
    }
  });

  it("never widens privilege on Kiro for read-only agents", () => {
    for (const id of READ_ONLY_AGENTS) {
      const tools = toKiroTools(id);
      expect(tools, `${id} Kiro`).not.toBeNull();
      expect(tools, `${id} Kiro write`).not.toContain("write");
      expect(tools, `${id} Kiro shell`).not.toContain("shell");
    }
  });

  it("never widens privilege on Gemini for read-only agents", () => {
    for (const id of READ_ONLY_AGENTS) {
      const tools = toGeminiCoreTools(id);
      expect(tools, `${id} Gemini`).not.toBeNull();
      expect(tools, `${id} Gemini WriteFileTool`).not.toContain("WriteFileTool");
      expect(tools, `${id} Gemini EditTool`).not.toContain("EditTool");
      expect(tools, `${id} Gemini ShellTool`).not.toContain("ShellTool");
    }
  });
});

describe("ASK_USER_TOOLS + toAskUserPlatformNote", () => {
  const KNOWN_ADAPTERS = [
    "claude", "cursor", "copilot", "windsurf", "codex", "cline",
    "opencode", "amp", "aider", "kiro", "goose", "zed",
    "amazon-q", "gemini", "antigravity",
  ];

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

  it("toAskUserPlatformNote returns fallback prose for gemini", () => {
    const note = toAskUserPlatformNote("gemini");
    expect(note.toLowerCase()).toContain("no documented native");
    expect(note).toContain("Plain-Text Fallback Template");
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
    expect(rowLines.length).toBe(15);
  });

  it("table cites AskUserQuestion in the claude row", () => {
    const table = buildAskUserPlatformTable();
    expect(table).toMatch(/\| `claude` \| Invoke the `AskUserQuestion` tool/);
  });

  it("table uses fallback prose for adapters with null entries", () => {
    const table = buildAskUserPlatformTable();
    expect(table).toMatch(/\| `gemini` \| _No documented native tool/);
    expect(table).toMatch(/\| `aider` \| _No documented native tool/);
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
