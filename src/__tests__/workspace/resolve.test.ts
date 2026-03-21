import { describe, it, expect } from "vitest";
import { resolveRepoConfig, buildSelectionFromIds } from "../../workspace/resolve.js";
import { DEFAULT_FEATURES } from "../../types.js";
import type { WorkspaceDefaults, WorkspaceRepoOverrides } from "../../workspace/types.js";
import type { ContentSelection } from "../../types.js";

describe("workspace resolve", () => {
  const baseContent: ContentSelection = {
    preset: "standard",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: ["hatch3r-researcher", "hatch3r-implementer", "hatch3r-reviewer"],
      skills: ["hatch3r-feature"],
      rules: ["hatch3r-code-standards"],
      commands: ["hatch3r-workflow"],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
  };

  const defaults: WorkspaceDefaults = {
    platform: "github",
    tools: ["cursor", "claude"],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: ["github", "playwright"] },
    content: baseContent,
  };

  describe("resolveRepoConfig", () => {
    it("inherits all defaults when no overrides", () => {
      const result = resolveRepoConfig(defaults);
      expect(result.tools).toEqual(["cursor", "claude"]);
      expect(result.features).toEqual(defaults.features);
      expect(result.mcp).toEqual(defaults.mcp);
      expect(result.contentIds.has("hatch3r-researcher")).toBe(true);
      expect(result.contentIds.has("hatch3r-implementer")).toBe(true);
      expect(result.excludedContent).toEqual([]);
      expect(result.addedContent).toEqual([]);
    });

    it("replaces tools entirely when overridden", () => {
      const overrides: WorkspaceRepoOverrides = { tools: ["copilot"] };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.tools).toEqual(["copilot"]);
    });

    it("partially merges features", () => {
      const overrides: WorkspaceRepoOverrides = {
        features: { agents: false, mcp: false },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.features.agents).toBe(false);
      expect(result.features.mcp).toBe(false);
      expect(result.features.skills).toBe(true);
      expect(result.features.rules).toBe(true);
    });

    it("replaces MCP entirely when overridden", () => {
      const overrides: WorkspaceRepoOverrides = {
        mcp: { servers: ["postgres"] },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.mcp.servers).toEqual(["postgres"]);
    });

    it("adds content IDs from include", () => {
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          include: ["hatch3r-security-auditor", "hatch3r-a11y-audit"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.contentIds.has("hatch3r-security-auditor")).toBe(true);
      expect(result.contentIds.has("hatch3r-a11y-audit")).toBe(true);
      expect(result.addedContent).toContain("hatch3r-security-auditor");
      expect(result.addedContent).toContain("hatch3r-a11y-audit");
    });

    it("removes content IDs from exclude", () => {
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          exclude: ["hatch3r-researcher"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.contentIds.has("hatch3r-researcher")).toBe(false);
      expect(result.excludedContent).toContain("hatch3r-researcher");
    });

    it("does not exclude protected items", () => {
      const protectedIds = new Set(["hatch3r-researcher"]);
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          exclude: ["hatch3r-researcher"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides, protectedIds);
      expect(result.contentIds.has("hatch3r-researcher")).toBe(true);
      expect(result.excludedContent).not.toContain("hatch3r-researcher");
    });

    it("handles include and exclude together", () => {
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          include: ["hatch3r-security-auditor"],
          exclude: ["hatch3r-feature"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.contentIds.has("hatch3r-security-auditor")).toBe(true);
      expect(result.contentIds.has("hatch3r-feature")).toBe(false);
    });

    it("overrides platform", () => {
      const overrides: WorkspaceRepoOverrides = { platform: "gitlab" };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.platform).toBe("gitlab");
    });

    it("does not add duplicate IDs on include", () => {
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          include: ["hatch3r-researcher"], // already in base
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.addedContent).not.toContain("hatch3r-researcher");
    });
  });

  describe("buildSelectionFromIds", () => {
    it("builds selection from ID set", () => {
      const ids = new Set(["hatch3r-researcher", "hatch3r-feature", "hatch3r-code-standards"]);
      const allItems = [
        { id: "hatch3r-researcher", type: "agent" },
        { id: "hatch3r-feature", type: "skill" },
        { id: "hatch3r-code-standards", type: "rule" },
        { id: "hatch3r-workflow", type: "command" },
      ];
      const result = buildSelectionFromIds(ids, baseContent, allItems);
      expect(result.preset).toBe("custom");
      expect(result.items.agents).toEqual(["hatch3r-researcher"]);
      expect(result.items.skills).toEqual(["hatch3r-feature"]);
      expect(result.items.rules).toEqual(["hatch3r-code-standards"]);
      expect(result.items.commands).toEqual([]);
    });

    it("preserves base selection metadata", () => {
      const ids = new Set<string>();
      const result = buildSelectionFromIds(ids, baseContent, []);
      expect(result.projectType).toBe("brownfield");
      expect(result.teamSize).toBe("solo");
    });
  });
});
