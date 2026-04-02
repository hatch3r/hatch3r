import { describe, it, expect } from "vitest";
import {
  buildAgentIdentity,
  createOutputMetadata,
  annotateOutput,
  verifyOutputAgent,
  verifyOutputPhase,
} from "../../pipeline/agentIdentity.js";

describe("agentIdentity", () => {
  describe("buildAgentIdentity", () => {
    it("should build identity for a known agent with capabilities", () => {
      const identity = buildAgentIdentity("hatch3r-researcher", "1.5.0");
      expect(identity.agentId).toBe("hatch3r-researcher");
      expect(identity.version).toBe("1.5.0");
      expect(identity.capabilities).toContain("read");
      expect(identity.capabilities).toContain("search");
      expect(identity.role).toBeTruthy();
    });

    it("should build identity for unknown agent with empty capabilities", () => {
      const identity = buildAgentIdentity("unknown-agent", "1.0.0");
      expect(identity.agentId).toBe("unknown-agent");
      expect(identity.capabilities).toEqual([]);
      expect(identity.role).toBe("Unknown agent role");
    });
  });

  describe("createOutputMetadata", () => {
    it("should create metadata with all required fields", () => {
      const meta = createOutputMetadata(
        "hatch3r-implementer",
        "1.5.0",
        "implementation",
        "corr-123",
        "abc123",
      );
      expect(meta.agent.agentId).toBe("hatch3r-implementer");
      expect(meta.phase).toBe("implementation");
      expect(meta.correlationId).toBe("corr-123");
      expect(meta.contentHash).toBe("abc123");
      expect(meta.producedAt).toBeTruthy();
    });

    it("should include correct agent capabilities in metadata", () => {
      const meta = createOutputMetadata(
        "hatch3r-reviewer",
        "1.5.0",
        "review",
        "corr-456",
      );
      expect(meta.agent.capabilities).toContain("read");
      expect(meta.agent.capabilities).toContain("search");
      expect(meta.agent.capabilities).not.toContain("write");
    });
  });

  describe("annotateOutput", () => {
    it("should wrap output data with metadata", () => {
      const data = { filesChanged: ["src/foo.ts"], status: "SUCCESS" };
      const annotated = annotateOutput(
        data,
        "hatch3r-implementer",
        "1.5.0",
        "implementation",
        "corr-789",
      );

      expect(annotated.data).toEqual(data);
      expect(annotated.metadata.agent.agentId).toBe("hatch3r-implementer");
      expect(annotated.metadata.phase).toBe("implementation");
      expect(annotated.metadata.correlationId).toBe("corr-789");
    });
  });

  describe("verifyOutputAgent", () => {
    it("should pass when agent matches", () => {
      const meta = createOutputMetadata(
        "hatch3r-researcher",
        "1.5.0",
        "research",
        "corr-001",
      );
      const result = verifyOutputAgent(meta, "hatch3r-researcher");
      expect(result.valid).toBe(true);
    });

    it("should fail when agent does not match", () => {
      const meta = createOutputMetadata(
        "hatch3r-researcher",
        "1.5.0",
        "research",
        "corr-001",
      );
      const result = verifyOutputAgent(meta, "hatch3r-implementer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("hatch3r-researcher");
      expect(result.reason).toContain("hatch3r-implementer");
    });
  });

  describe("verifyOutputPhase", () => {
    it("should pass when phase matches", () => {
      const meta = createOutputMetadata(
        "hatch3r-implementer",
        "1.5.0",
        "implementation",
        "corr-002",
      );
      const result = verifyOutputPhase(meta, "implementation");
      expect(result.valid).toBe(true);
    });

    it("should fail when phase does not match", () => {
      const meta = createOutputMetadata(
        "hatch3r-implementer",
        "1.5.0",
        "implementation",
        "corr-002",
      );
      const result = verifyOutputPhase(meta, "review");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("implementation");
      expect(result.reason).toContain("review");
    });
  });
});
