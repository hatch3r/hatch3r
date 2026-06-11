import { describe, it, expect } from "vitest";
import { resolveRepoConfig, buildSelectionFromIds } from "../../workspace/resolve.js";
import { DEFAULT_FEATURES } from "../../types.js";
import type { WorkspaceDefaults, WorkspaceGroupDelta, WorkspaceRepoOverrides } from "../../workspace/types.js";
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
          include: ["hatch3r-security", "hatch3r-a11y-audit"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.contentIds.has("hatch3r-security")).toBe(true);
      expect(result.contentIds.has("hatch3r-a11y-audit")).toBe(true);
      expect(result.addedContent).toContain("hatch3r-security");
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

    it("does not exclude any unconditionally-admitted (floor-tagged) ID (D16-2)", () => {
      // The unconditional-admission set is built in sync.ts via
      // admitsUnconditionally (protected OR any floor:* tag). A floor-tagged
      // artifact whose id is in that set cannot be dropped by a per-repo
      // exclude — previously the loop honoured only protected ids.
      const unconditionalIds = new Set(["hatch3r-code-standards"]);
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          exclude: ["hatch3r-code-standards"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides, unconditionalIds);
      expect(result.contentIds.has("hatch3r-code-standards")).toBe(true);
      expect(result.excludedContent).not.toContain("hatch3r-code-standards");
    });

    it("handles include and exclude together", () => {
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: {
          include: ["hatch3r-security"],
          exclude: ["hatch3r-feature"],
        },
      };
      const result = resolveRepoConfig(defaults, overrides);
      expect(result.contentIds.has("hatch3r-security")).toBe(true);
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

  describe("group-layer merge (D1-10)", () => {
    it("is a no-op when no group deltas are supplied (legacy two-layer merge)", () => {
      const withEmpty = resolveRepoConfig(defaults, undefined, undefined, []);
      const without = resolveRepoConfig(defaults);
      expect(withEmpty.tools).toEqual(without.tools);
      expect(withEmpty.features).toEqual(without.features);
      expect(withEmpty.mcp).toEqual(without.mcp);
      expect([...withEmpty.contentIds].sort()).toEqual([...without.contentIds].sort());
    });

    it("replaces tools from a group delta (later layer wins, defaults overridden)", () => {
      const group: WorkspaceGroupDelta = { tools: ["copilot"] };
      const result = resolveRepoConfig(defaults, undefined, undefined, [group]);
      expect(result.tools).toEqual(["copilot"]);
    });

    it("partially merges features across the group layer", () => {
      const group: WorkspaceGroupDelta = { features: { mcp: false } };
      const result = resolveRepoConfig(defaults, undefined, undefined, [group]);
      expect(result.features.mcp).toBe(false);
      expect(result.features.agents).toBe(true);
    });

    it("replaces MCP from a group delta", () => {
      const group: WorkspaceGroupDelta = { mcp: { servers: ["postgres"] } };
      const result = resolveRepoConfig(defaults, undefined, undefined, [group]);
      expect(result.mcp.servers).toEqual(["postgres"]);
    });

    it("applies group-layer content include and exclude deltas", () => {
      const group: WorkspaceGroupDelta = {
        contentOverrides: { include: ["hatch3r-security"], exclude: ["hatch3r-researcher"] },
      };
      const result = resolveRepoConfig(defaults, undefined, undefined, [group]);
      expect(result.contentIds.has("hatch3r-security")).toBe(true);
      expect(result.contentIds.has("hatch3r-researcher")).toBe(false);
      expect(result.addedContent).toContain("hatch3r-security");
      expect(result.excludedContent).toContain("hatch3r-researcher");
    });

    it("applies multiple group deltas in declared order (later group wins on tools)", () => {
      const g1: WorkspaceGroupDelta = { tools: ["claude"] };
      const g2: WorkspaceGroupDelta = { tools: ["copilot"] };
      const result = resolveRepoConfig(defaults, undefined, undefined, [g1, g2]);
      expect(result.tools).toEqual(["copilot"]);
    });

    it("lets a per-repo override outrank the group layer (override is the final layer)", () => {
      const group: WorkspaceGroupDelta = { tools: ["claude"], mcp: { servers: ["postgres"] } };
      const overrides: WorkspaceRepoOverrides = { tools: ["cursor"] };
      const result = resolveRepoConfig(defaults, overrides, undefined, [group]);
      expect(result.tools).toEqual(["cursor"]); // override wins over group
      expect(result.mcp.servers).toEqual(["postgres"]); // group still applies where override is silent
    });

    it("re-includes in a per-repo override an id a group excluded (net-delta reporting)", () => {
      const group: WorkspaceGroupDelta = {
        contentOverrides: { exclude: ["hatch3r-researcher"] },
      };
      const overrides: WorkspaceRepoOverrides = {
        contentOverrides: { include: ["hatch3r-researcher"] },
      };
      const result = resolveRepoConfig(defaults, overrides, undefined, [group]);
      expect(result.contentIds.has("hatch3r-researcher")).toBe(true);
      expect(result.excludedContent).not.toContain("hatch3r-researcher");
    });

    it("refuses a group-layer exclude of an unconditionally-admitted (floor) id", () => {
      const unconditionalIds = new Set(["hatch3r-code-standards"]);
      const group: WorkspaceGroupDelta = {
        contentOverrides: { exclude: ["hatch3r-code-standards"] },
      };
      const result = resolveRepoConfig(defaults, undefined, unconditionalIds, [group]);
      expect(result.contentIds.has("hatch3r-code-standards")).toBe(true);
      expect(result.excludedContent).not.toContain("hatch3r-code-standards");
    });

    it("deep-merges models across the group layer (group agent override applied)", () => {
      const defaultsWithModels: WorkspaceDefaults = {
        ...defaults,
        models: { default: "claude-base", agents: { "hatch3r-researcher": "claude-r" } },
      };
      const group: WorkspaceGroupDelta = {
        models: { agents: { "hatch3r-implementer": "claude-i" } },
      };
      const result = resolveRepoConfig(defaultsWithModels, undefined, undefined, [group]);
      expect(result.models?.default).toBe("claude-base");
      expect(result.models?.agents?.["hatch3r-researcher"]).toBe("claude-r");
      expect(result.models?.agents?.["hatch3r-implementer"]).toBe("claude-i");
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
