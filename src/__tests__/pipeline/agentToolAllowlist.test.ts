import { describe, it, expect } from "vitest";
import {
  AGENT_TOOL_POLICIES,
  getAgentToolPolicy,
  checkToolAccess,
  toFailureLogEntry,
  validateToolPolicies,
  type AllowlistDenialEvent,
} from "../../pipeline/agentToolAllowlist.js";
import { parseFailureLog, formatLogEntry } from "../../pipeline/failureLog.js";

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

  // C7.5-W2B2-H44: Every denial path emits a structured event via the
  // optional `onDeny` observability callback so denied tool calls flow
  // to failure-log.jsonl rather than being silently rejected
  // (Silent Failure Contract, CONSTITUTION.md §2 P5, C7-H11).
  describe("C7.5-W2B2-H44 denial observability", () => {
    it("emits NO_POLICY denial with agentId, tool, and reason when agent is unregistered", () => {
      const events: AllowlistDenialEvent[] = [];
      const result = checkToolAccess("unknown-agent", "read", (e) => events.push(e));
      expect(result.allowed).toBe(false);
      expect(events).toHaveLength(1);
      const [evt] = events;
      expect(evt.agentId).toBe("unknown-agent");
      expect(evt.tool).toBe("read");
      expect(evt.reasonCode).toBe("NO_POLICY");
      expect(evt.reason).toContain("No tool policy registered");
      expect(evt.allowedTools).toEqual([]);
      expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("emits TOOL_NOT_ALLOWED denial with allowedTools list when tool is off-allowlist", () => {
      const events: AllowlistDenialEvent[] = [];
      const result = checkToolAccess("hatch3r-reviewer", "write", (e) => events.push(e));
      expect(result.allowed).toBe(false);
      expect(events).toHaveLength(1);
      const [evt] = events;
      expect(evt.agentId).toBe("hatch3r-reviewer");
      expect(evt.tool).toBe("write");
      expect(evt.reasonCode).toBe("TOOL_NOT_ALLOWED");
      expect(evt.reason).toContain("not allowed to use tool");
      expect(evt.allowedTools).toContain("read");
      expect(evt.allowedTools).toContain("search");
      expect(evt.allowedTools).not.toContain("write");
    });

    it("does NOT emit a denial event when access is allowed", () => {
      const events: AllowlistDenialEvent[] = [];
      const result = checkToolAccess("hatch3r-researcher", "read", (e) => events.push(e));
      expect(result.allowed).toBe(true);
      expect(result.denial).toBeUndefined();
      expect(events).toHaveLength(0);
    });

    it("attaches the structured denial event to the ToolAccessResult even without a callback", () => {
      // Backward-compat: callers that do NOT supply onDeny still see the
      // denial on the returned result so they can route it to a channel.
      const result = checkToolAccess("hatch3r-implementer", "git");
      expect(result.allowed).toBe(false);
      expect(result.denial).toBeDefined();
      expect(result.denial!.reasonCode).toBe("TOOL_NOT_ALLOWED");
      expect(result.denial!.agentId).toBe("hatch3r-implementer");
      expect(result.denial!.tool).toBe("git");
    });

    it("preserves the existing ToolAccessResult shape (reason is the same free-form string)", () => {
      // Callers that ignore the new `denial` field continue to work.
      const result = checkToolAccess("hatch3r-reviewer", "write");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(result.denial?.reason);
    });

    it("propagates listener exceptions to the caller (no silent swallow)", () => {
      // A broken sink must be visible to the orchestrator, not hidden.
      const thrower = (): never => {
        throw new Error("sink-failed");
      };
      expect(() =>
        checkToolAccess("hatch3r-reviewer", "write", thrower),
      ).toThrow("sink-failed");
    });

    it("fires the listener once per denial (no duplicates)", () => {
      const events: AllowlistDenialEvent[] = [];
      checkToolAccess("hatch3r-reviewer", "write", (e) => events.push(e));
      checkToolAccess("hatch3r-reviewer", "execute", (e) => events.push(e));
      checkToolAccess("unknown-agent", "read", (e) => events.push(e));
      expect(events).toHaveLength(3);
      expect(events[0].reasonCode).toBe("TOOL_NOT_ALLOWED");
      expect(events[1].reasonCode).toBe("TOOL_NOT_ALLOWED");
      expect(events[2].reasonCode).toBe("NO_POLICY");
    });
  });

  // C7.5-W2B2-H44: `toFailureLogEntry` converts an `AllowlistDenialEvent`
  // into a persistable `FailureLogEntry` so denials can be appended to
  // `.failure-log.jsonl` via the existing pipeline failure-log machinery.
  describe("C7.5-W2B2-H44 toFailureLogEntry", () => {
    it("maps a denial event to a FailureLogEntry with phase 'tool-allowlist'", () => {
      const events: AllowlistDenialEvent[] = [];
      checkToolAccess("hatch3r-reviewer", "write", (e) => events.push(e));
      const entry = toFailureLogEntry(events[0]);
      expect(entry.phase).toBe("tool-allowlist");
      expect(entry.tool).toBe("write");
      expect(entry.errorCode).toBe("TOOL_NOT_ALLOWED");
      expect(entry.error).toContain("not allowed");
      expect(entry.timestamp).toBe(events[0].timestamp);
    });

    it("propagates optional correlationId and version", () => {
      const events: AllowlistDenialEvent[] = [];
      checkToolAccess("unknown-agent", "read", (e) => events.push(e));
      const entry = toFailureLogEntry(events[0], {
        correlationId: "run-123",
        version: "1.6.0",
      });
      expect(entry.correlationId).toBe("run-123");
      expect(entry.version).toBe("1.6.0");
    });

    it("produces an entry that round-trips through formatLogEntry + parseFailureLog", () => {
      const events: AllowlistDenialEvent[] = [];
      checkToolAccess("hatch3r-implementer", "git", (e) => events.push(e));
      const entry = toFailureLogEntry(events[0]);
      const jsonl = formatLogEntry(entry);
      const parsed = parseFailureLog(jsonl + "\n");
      expect(parsed).toHaveLength(1);
      expect(parsed[0].phase).toBe("tool-allowlist");
      expect(parsed[0].tool).toBe("git");
      expect(parsed[0].errorCode).toBe("TOOL_NOT_ALLOWED");
    });
  });
});
