import { describe, it, expect } from "vitest";
import {
  AGENT_TOOL_POLICIES,
  getAgentToolPolicy,
  checkToolAccess,
  validateToolPolicies,
} from "../../pipeline/agentToolAllowlist.js";

describe("agentToolAllowlist", () => {
  describe("AGENT_TOOL_POLICIES", () => {
    it("should have policies for all core agents", () => {
      const coreAgents = [
        "hatch3r-researcher",
        "hatch3r-implementer",
        "hatch3r-reviewer",
        "hatch3r-fixer",
        "hatch3r-test-writer",
        "hatch3r-security-auditor",
        "hatch3r-docs-writer",
      ];
      for (const agentId of coreAgents) {
        const policy = AGENT_TOOL_POLICIES.find((p) => p.agentId === agentId);
        expect(policy, `Missing policy for ${agentId}`).toBeDefined();
      }
    });

    it("should have unique agent IDs", () => {
      const ids = AGENT_TOOL_POLICIES.map((p) => p.agentId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should have non-empty allowedTools for every agent", () => {
      for (const policy of AGENT_TOOL_POLICIES) {
        expect(
          policy.allowedTools.length,
          `${policy.agentId} has empty allowedTools`,
        ).toBeGreaterThan(0);
      }
    });

    it("should not grant any agent write+git+board simultaneously", () => {
      for (const policy of AGENT_TOOL_POLICIES) {
        const hasWrite = policy.allowedTools.includes("write");
        const hasGit = policy.allowedTools.includes("git");
        const hasBoard = policy.allowedTools.includes("board");
        expect(
          hasWrite && hasGit && hasBoard,
          `${policy.agentId} has write+git+board`,
        ).toBe(false);
      }
    });
  });

  describe("getAgentToolPolicy", () => {
    it("should return the policy for a known agent", () => {
      const policy = getAgentToolPolicy("hatch3r-researcher");
      expect(policy).toBeDefined();
      expect(policy!.agentId).toBe("hatch3r-researcher");
      expect(policy!.allowedTools).toContain("read");
    });

    it("should return undefined for an unknown agent", () => {
      expect(getAgentToolPolicy("unknown-agent")).toBeUndefined();
    });
  });

  describe("checkToolAccess", () => {
    it("should allow a researcher to use read tools", () => {
      const result = checkToolAccess("hatch3r-researcher", "read");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should deny a researcher from using write tools", () => {
      const result = checkToolAccess("hatch3r-researcher", "write");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not allowed");
      expect(result.reason).toContain("write");
    });

    it("should deny access for unknown agents (deny-by-default)", () => {
      const result = checkToolAccess("unknown-agent", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No tool policy registered");
      expect(result.reason).toContain("deny-by-default");
    });

    it("should allow an implementer to use write and execute tools", () => {
      expect(checkToolAccess("hatch3r-implementer", "write").allowed).toBe(true);
      expect(checkToolAccess("hatch3r-implementer", "execute").allowed).toBe(true);
    });

    it("should deny an implementer from using git tools", () => {
      expect(checkToolAccess("hatch3r-implementer", "git").allowed).toBe(false);
    });

    it("should deny a reviewer from using write tools", () => {
      expect(checkToolAccess("hatch3r-reviewer", "write").allowed).toBe(false);
    });

    it("should deny a reviewer from using execute tools", () => {
      expect(checkToolAccess("hatch3r-reviewer", "execute").allowed).toBe(false);
    });
  });

  describe("validateToolPolicies", () => {
    it("should return no warnings for the default policies", () => {
      const warnings = validateToolPolicies();
      expect(warnings).toEqual([]);
    });
  });
});
