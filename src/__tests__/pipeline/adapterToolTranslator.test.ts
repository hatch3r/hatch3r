import { describe, it, expect } from "vitest";
import {
  toClaudeToolsFrontmatter,
  toCopilotToolsFrontmatter,
  toCursorReadonlyFrontmatter,
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
