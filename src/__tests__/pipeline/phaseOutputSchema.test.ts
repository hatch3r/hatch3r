import { describe, it, expect } from "vitest";
import {
  validateResearchOutput,
  validateImplementationOutput,
  validateReviewOutput,
  validateQualityOutput,
  validatePhaseOutput,
  formatSchemaViolations,
  compactPhaseOutput,
} from "../../pipeline/phaseOutputSchema.js";

describe("phaseOutputSchema", () => {
  describe("validateResearchOutput", () => {
    const validResearch = {
      modes: ["codebase-impact"],
      affectedFiles: ["src/foo.ts"],
      blastRadius: ["src/bar.ts"],
      existingTests: ["src/__tests__/foo.test.ts"],
      dependencies: ["lodash"],
      conventions: null,
      resolvedRequirements: null,
    };

    it("should pass for valid research output", () => {
      const result = validateResearchOutput(validResearch);
      expect(result.valid).toBe(true);
      expect(result.phase).toBe("research");
      expect(result.violations.filter((v) => v.severity === "error")).toHaveLength(0);
    });

    it("should fail for null output", () => {
      const result = validateResearchOutput(null);
      expect(result.valid).toBe(false);
      expect(result.violations[0].message).toContain("non-null object");
    });

    it("should fail when required arrays are missing", () => {
      const result = validateResearchOutput({ modes: ["a"] });
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
    });

    it("should warn for invalid conventions type", () => {
      const result = validateResearchOutput({
        ...validResearch,
        conventions: "not an object",
      });
      expect(result.violations.some((v) => v.field === "conventions")).toBe(true);
    });
  });

  describe("validateImplementationOutput", () => {
    const validImpl = {
      filesChanged: ["src/foo.ts"],
      testsWritten: ["src/__tests__/foo.test.ts"],
      status: "SUCCESS",
      reason: null,
    };

    it("should pass for valid implementation output", () => {
      const result = validateImplementationOutput(validImpl);
      expect(result.valid).toBe(true);
      expect(result.phase).toBe("implementation");
    });

    it("should fail for null output", () => {
      const result = validateImplementationOutput(null);
      expect(result.valid).toBe(false);
    });

    it("should fail for invalid status", () => {
      const result = validateImplementationOutput({
        ...validImpl,
        status: "INVALID",
      });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === "status")).toBe(true);
    });

    it("should accept all valid status values", () => {
      for (const status of ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "TIMEOUT"]) {
        const result = validateImplementationOutput({ ...validImpl, status });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("validateReviewOutput", () => {
    const validReview = {
      iterations: 2,
      finalVerdict: "CLEAN",
      findings: [
        { severity: "HIGH", description: "Issue found", confidence: "high" },
      ],
      confirmationPassResult: "PASS",
    };

    it("should pass for valid review output", () => {
      const result = validateReviewOutput(validReview);
      expect(result.valid).toBe(true);
      expect(result.phase).toBe("review");
    });

    it("should fail for zero iterations", () => {
      const result = validateReviewOutput({ ...validReview, iterations: 0 });
      expect(result.valid).toBe(false);
    });

    it("should fail for invalid verdict", () => {
      const result = validateReviewOutput({
        ...validReview,
        finalVerdict: "MAYBE",
      });
      expect(result.valid).toBe(false);
    });

    it("should fail for invalid finding severity", () => {
      const result = validateReviewOutput({
        ...validReview,
        findings: [{ severity: "EXTREME", description: "bad" }],
      });
      expect(result.valid).toBe(false);
    });

    it("should fail for missing confirmation pass result", () => {
      const result = validateReviewOutput({
        ...validReview,
        confirmationPassResult: undefined,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("validateQualityOutput", () => {
    const validQuality = {
      specialists: [
        {
          specialist: "hatch3r-test-writer",
          status: "SUCCESS",
          findingsCount: 0,
          summary: "All good",
        },
      ],
      validationPass: {
        testsPass: true,
        typecheckPass: true,
        fixAttempts: 0,
        regressionsPersist: false,
      },
    };

    it("should pass for valid quality output", () => {
      const result = validateQualityOutput(validQuality);
      expect(result.valid).toBe(true);
      expect(result.phase).toBe("quality");
    });

    it("should fail for null output", () => {
      const result = validateQualityOutput(null);
      expect(result.valid).toBe(false);
    });

    it("should fail when specialists is not an array", () => {
      const result = validateQualityOutput({
        ...validQuality,
        specialists: "not array",
      });
      expect(result.valid).toBe(false);
    });

    it("should fail when validationPass is missing", () => {
      const result = validateQualityOutput({
        specialists: validQuality.specialists,
      });
      expect(result.valid).toBe(false);
    });

    it("should fail for invalid specialist status", () => {
      const result = validateQualityOutput({
        ...validQuality,
        specialists: [
          { specialist: "test", status: "INVALID", findingsCount: 0, summary: "x" },
        ],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("validatePhaseOutput", () => {
    it("should dispatch to the correct validator", () => {
      const research = validatePhaseOutput("research", { modes: [], affectedFiles: [], blastRadius: [], existingTests: [], dependencies: [] });
      expect(research.phase).toBe("research");

      const impl = validatePhaseOutput("implementation", null);
      expect(impl.phase).toBe("implementation");
    });
  });

  describe("formatSchemaViolations", () => {
    it("should format a valid result", () => {
      const result = validateResearchOutput({
        modes: [],
        affectedFiles: [],
        blastRadius: [],
        existingTests: [],
        dependencies: [],
      });
      const formatted = formatSchemaViolations(result);
      expect(formatted).toContain("schema valid");
    });

    it("should format violations with severity prefixes", () => {
      const result = validateResearchOutput(null);
      const formatted = formatSchemaViolations(result);
      expect(formatted).toContain("ERROR");
      expect(formatted).toContain("INVALID");
    });
  });

  describe("compactPhaseOutput", () => {
    it("should return input unchanged when below threshold", () => {
      const input = { key: "short value", list: [1, 2, 3] };
      const result = compactPhaseOutput(input, { threshold: 100_000 });
      expect(result).toEqual(input);
    });

    it("should truncate strings exceeding maxStringLength", () => {
      const longStr = "a".repeat(600);
      const input = { data: longStr };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 100 });
      expect(result.data).toHaveLength(100 + " [compacted]".length);
      expect(result.data).toContain(" [compacted]");
      expect(result.data.startsWith("a".repeat(100))).toBe(true);
    });

    it("should compact arrays exceeding headItems + tailItems", () => {
      const input = { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      const result = compactPhaseOutput(input, {
        threshold: 0,
        headItems: 3,
        tailItems: 2,
      });
      expect(result.items).toHaveLength(6); // 3 head + 1 placeholder + 2 tail
      expect(result.items[0]).toBe(1);
      expect(result.items[1]).toBe(2);
      expect(result.items[2]).toBe(3);
      expect(result.items[3]).toBe("[compacted: 5 items omitted]");
      expect(result.items[4]).toBe(9);
      expect(result.items[5]).toBe(10);
    });

    it("should recurse into nested objects", () => {
      const longStr = "b".repeat(300);
      const input = {
        outer: {
          inner: {
            value: longStr,
          },
        },
      };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 50 });
      expect(result.outer.inner.value).toHaveLength(50 + " [compacted]".length);
      expect(result.outer.inner.value).toContain(" [compacted]");
    });

    it("should preserve primitives (number, boolean, null)", () => {
      const input = {
        count: 42,
        active: true,
        disabled: false,
        nothing: null,
      };
      const result = compactPhaseOutput(input, { threshold: 0 });
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.nothing).toBeNull();
    });

    it("should leave short arrays intact", () => {
      const input = { items: ["a", "b"] };
      const result = compactPhaseOutput(input, {
        threshold: 0,
        headItems: 3,
        tailItems: 2,
      });
      expect(result.items).toEqual(["a", "b"]);
    });

    it("should leave short strings intact", () => {
      const input = { msg: "hello" };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 500 });
      expect(result.msg).toBe("hello");
    });
  });
});
