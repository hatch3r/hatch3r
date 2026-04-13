import { describe, it, expect } from "vitest";
import {
  validatePhaseTransition,
  shouldTriggerSpecialist,
  getSpecialistHints,
  PHASE_SKIP_CRITERIA,
  SPECIALIST_TRIGGER_TABLE,
  LANGUAGE_SPECIALIST_CONFIGS,
  type PipelineContext,
  type ProjectTypeContext,
} from "../../pipeline/pipelineContext.js";

// ── Fixture helpers ──────────────────────────────────────────────

function validBaseContext(): Partial<PipelineContext> {
  return {
    correlationId: "550e8400-e29b-41d4-a716-446655440000",
    taskType: "feature",
    issueRef: "#42",
    deepContextTier: 2,
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalDuration: null,
  };
}

function validResearchFindings() {
  return {
    modes: ["codebase-impact", "feature-design"],
    affectedFiles: ["src/foo.ts"],
    blastRadius: ["src/bar.ts"],
    existingTests: ["src/__tests__/foo.test.ts"],
    dependencies: ["lodash"],
    conventions: null,
    resolvedRequirements: null,
  };
}

function validImplementationResult() {
  return {
    filesChanged: ["src/foo.ts"],
    testsWritten: ["src/__tests__/foo.test.ts"],
    status: "SUCCESS" as const,
    reason: null,
  };
}

function validReviewResult() {
  return {
    iterations: 1,
    finalVerdict: "CLEAN" as const,
    findings: [],
    confirmationPassResult: "PASS" as const,
  };
}

function validQualityResults() {
  return {
    specialists: [
      { specialist: "hatch3r-test-writer", status: "SUCCESS" as const, findingsCount: 0, summary: "All tests pass" },
    ],
    validationPass: {
      testsPass: true,
      typecheckPass: true,
      fixAttempts: 0,
      regressionsPersist: false,
    },
  };
}

// ── validatePhaseTransition ──────────────────────────────────────

describe("validatePhaseTransition", () => {
  describe("Phase 1 (Research) entry", () => {
    it("should pass with valid base context", () => {
      const errors = validatePhaseTransition(validBaseContext(), 1);
      expect(errors).toHaveLength(0);
    });

    it("should fail without correlationId", () => {
      const ctx = { ...validBaseContext(), correlationId: undefined };
      const errors = validatePhaseTransition(ctx, 1);
      expect(errors.some((e) => e.field === "correlationId")).toBe(true);
    });

    it("should fail with invalid taskType", () => {
      const ctx = { ...validBaseContext(), taskType: "invalid" as PipelineContext["taskType"] };
      const errors = validatePhaseTransition(ctx, 1);
      expect(errors.some((e) => e.field === "taskType")).toBe(true);
    });

    it("should fail without deepContextTier", () => {
      const ctx = { ...validBaseContext(), deepContextTier: undefined };
      const errors = validatePhaseTransition(ctx, 1);
      expect(errors.some((e) => e.field === "deepContextTier")).toBe(true);
    });

    it("should fail with invalid deepContextTier", () => {
      const ctx = { ...validBaseContext(), deepContextTier: 5 as PipelineContext["deepContextTier"] };
      const errors = validatePhaseTransition(ctx, 1);
      expect(errors.some((e) => e.field === "deepContextTier")).toBe(true);
    });

    it("should fail without startedAt", () => {
      const ctx = { ...validBaseContext(), startedAt: undefined };
      const errors = validatePhaseTransition(ctx, 1);
      expect(errors.some((e) => e.field === "startedAt")).toBe(true);
    });
  });

  describe("Phase 2 (Implement) entry", () => {
    it("should pass with research findings", () => {
      const ctx = { ...validBaseContext(), researchFindings: validResearchFindings() };
      const errors = validatePhaseTransition(ctx, 2);
      expect(errors).toHaveLength(0);
    });

    it("should pass with research gaps (skip acknowledged)", () => {
      const ctx = { ...validBaseContext(), researchGaps: ["Trivial edit — research skipped"] };
      const errors = validatePhaseTransition(ctx, 2);
      expect(errors).toHaveLength(0);
    });

    it("should fail without research findings or gaps", () => {
      const ctx = validBaseContext();
      const errors = validatePhaseTransition(ctx, 2);
      expect(errors.some((e) => e.field === "researchFindings")).toBe(true);
    });
  });

  describe("Phase 3 (Review) entry", () => {
    it("should pass with all required fields", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
      };
      const errors = validatePhaseTransition(ctx, 3);
      expect(errors).toHaveLength(0);
    });

    it("should fail without implementationResult", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
      };
      const errors = validatePhaseTransition(ctx, 3);
      expect(errors.some((e) => e.field === "implementationResult")).toBe(true);
    });

    it("should fail with invalid implementationResult status", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: { ...validImplementationResult(), status: "INVALID" as any },
      };
      const errors = validatePhaseTransition(ctx, 3);
      expect(errors.some((e) => e.field === "implementationResult.status")).toBe(true);
    });
  });

  describe("Phase 4 (Quality) entry", () => {
    it("should pass with all required fields", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
      };
      const errors = validatePhaseTransition(ctx, 4);
      expect(errors).toHaveLength(0);
    });

    it("should fail without reviewResult", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
      };
      const errors = validatePhaseTransition(ctx, 4);
      expect(errors.some((e) => e.field === "reviewResult")).toBe(true);
    });

    it("should fail with invalid reviewResult verdict", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), finalVerdict: "INVALID" as any },
      };
      const errors = validatePhaseTransition(ctx, 4);
      expect(errors.some((e) => e.field === "reviewResult.finalVerdict")).toBe(true);
    });

    it("should fail with zero iterations", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), iterations: 0 },
      };
      const errors = validatePhaseTransition(ctx, 4);
      expect(errors.some((e) => e.field === "reviewResult.iterations")).toBe(true);
    });
  });

  describe("Completion", () => {
    it("should pass with all fields populated", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
        qualityResults: validQualityResults(),
      };
      const errors = validatePhaseTransition(ctx, "completion");
      expect(errors).toHaveLength(0);
    });

    it("should fail without qualityResults", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
      };
      const errors = validatePhaseTransition(ctx, "completion");
      expect(errors.some((e) => e.field === "qualityResults")).toBe(true);
    });

    it("should fail without validationPass", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
        qualityResults: { specialists: [], validationPass: undefined as any },
      };
      const errors = validatePhaseTransition(ctx, "completion");
      expect(errors.some((e) => e.field === "qualityResults.validationPass")).toBe(true);
    });
  });
});

// ── shouldTriggerSpecialist ──────────────────────────────────────

describe("shouldTriggerSpecialist", () => {
  it("should always trigger test-writer for code changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-test-writer", ["src/foo.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("should always trigger security-auditor for code changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security-auditor", ["src/foo.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("should not trigger always-mode specialists for empty changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-test-writer", []);
    expect(result.triggered).toBe(false);
  });

  it("should trigger dependency-auditor for package.json changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["package.json"]);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes("package.json"))).toBe(true);
  });

  it("should trigger dependency-auditor for go.mod changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["go.mod"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger dependency-auditor for Cargo.toml changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["Cargo.toml"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger dependency-auditor for nested package.json", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["packages/core/package.json"]);
    expect(result.triggered).toBe(true);
  });

  it("should not trigger dependency-auditor for non-dependency files", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["src/foo.ts", "src/bar.ts"]);
    expect(result.triggered).toBe(false);
  });

  it("should trigger dependency-auditor for lockfile changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-dependency-auditor", ["pnpm-lock.yaml"]);
    expect(result.triggered).toBe(true);
  });

  it("should return false for unknown specialist", () => {
    const result = shouldTriggerSpecialist("hatch3r-unknown", ["src/foo.ts"]);
    expect(result.triggered).toBe(false);
    expect(result.reasons[0]).toContain("Unknown specialist");
  });

  describe("project-type-aware triggers (Finding #56)", () => {
    const nodeProject: ProjectTypeContext = {
      languages: ["typescript"],
      frameworks: ["next"],
      isMonorepo: false,
      packageManager: "npm",
    };

    const goProject: ProjectTypeContext = {
      languages: ["go"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "unknown",
    };

    it("should trigger dependency-auditor with language context for Node.js", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-dependency-auditor",
        ["package.json"],
        nodeProject,
      );
      expect(result.triggered).toBe(true);
      expect(result.reasons.some((r) => r.includes("typescript"))).toBe(true);
    });

    it("should trigger dependency-auditor with language context for Go", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-dependency-auditor",
        ["go.mod"],
        goProject,
      );
      expect(result.triggered).toBe(true);
      expect(result.reasons.some((r) => r.includes("go"))).toBe(true);
    });

    it("should not trigger language-specific for unrelated files", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-dependency-auditor",
        ["src/main.go"],
        goProject,
      );
      expect(result.triggered).toBe(false);
    });
  });
});

// ── getSpecialistHints ───────────────────────────────────────────

describe("getSpecialistHints", () => {
  it("should return TypeScript hints for test-writer", () => {
    const hints = getSpecialistHints("hatch3r-test-writer", {
      languages: ["typescript"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "npm",
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("typescript");
  });

  it("should return Go hints for security-auditor", () => {
    const hints = getSpecialistHints("hatch3r-security-auditor", {
      languages: ["go"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "unknown",
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("go");
  });

  it("should return hints for multiple languages", () => {
    const hints = getSpecialistHints("hatch3r-test-writer", {
      languages: ["typescript", "python"],
      frameworks: [],
      isMonorepo: true,
      packageManager: "npm",
    });
    expect(hints.length).toBe(2);
    expect(hints.some((h) => h.includes("typescript"))).toBe(true);
    expect(hints.some((h) => h.includes("python"))).toBe(true);
  });

  it("should return empty for unknown language", () => {
    const hints = getSpecialistHints("hatch3r-test-writer", {
      languages: ["brainfuck"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "unknown",
    });
    expect(hints).toHaveLength(0);
  });

  it("should return empty for unknown specialist", () => {
    const hints = getSpecialistHints("hatch3r-unknown", {
      languages: ["typescript"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "npm",
    });
    expect(hints).toHaveLength(0);
  });
});

// ── Static data integrity ────────────────────────────────────────

describe("PHASE_SKIP_CRITERIA", () => {
  it("should cover all 4 phases", () => {
    const phases = PHASE_SKIP_CRITERIA.map((p) => p.phase);
    expect(phases).toEqual([1, 2, 3, 4]);
  });

  it("should have non-empty skipConditions for each phase", () => {
    for (const criteria of PHASE_SKIP_CRITERIA) {
      expect(criteria.skipConditions.length).toBeGreaterThan(0);
    }
  });

  it("should have non-empty mandatoryMinimum for each phase", () => {
    for (const criteria of PHASE_SKIP_CRITERIA) {
      expect(criteria.mandatoryMinimum.length).toBeGreaterThan(0);
    }
  });

  it("Phase 2 should never be skippable", () => {
    const phase2 = PHASE_SKIP_CRITERIA.find((p) => p.phase === 2)!;
    expect(phase2.skipConditions[0]).toContain("Never");
  });
});

describe("SPECIALIST_TRIGGER_TABLE", () => {
  it("should include dependency-auditor (Finding #55)", () => {
    const depAuditor = SPECIALIST_TRIGGER_TABLE.find(
      (t) => t.specialist === "hatch3r-dependency-auditor",
    );
    expect(depAuditor).toBeDefined();
    expect(depAuditor!.mode).toBe("conditional");
    expect(depAuditor!.triggerFilePatterns).toBeDefined();
    expect(depAuditor!.triggerFilePatterns!.length).toBeGreaterThan(0);
  });

  it("should include all mandatory specialists", () => {
    const mandatory = SPECIALIST_TRIGGER_TABLE.filter((t) => t.mode === "always");
    const names = mandatory.map((t) => t.specialist);
    expect(names).toContain("hatch3r-test-writer");
    expect(names).toContain("hatch3r-security-auditor");
  });

  it("should have trigger file patterns for dependency-auditor", () => {
    const depAuditor = SPECIALIST_TRIGGER_TABLE.find(
      (t) => t.specialist === "hatch3r-dependency-auditor",
    )!;
    expect(depAuditor.triggerFilePatterns).toContain("package.json");
    expect(depAuditor.triggerFilePatterns).toContain("go.mod");
    expect(depAuditor.triggerFilePatterns).toContain("Cargo.toml");
    expect(depAuditor.triggerFilePatterns).toContain("requirements.txt");
    expect(depAuditor.triggerFilePatterns).toContain("Gemfile");
    expect(depAuditor.triggerFilePatterns).toContain("pom.xml");
  });
});

describe("LANGUAGE_SPECIALIST_CONFIGS", () => {
  it("should have configs for common languages", () => {
    const languages = LANGUAGE_SPECIALIST_CONFIGS.map((c) => c.language);
    expect(languages).toContain("typescript");
    expect(languages).toContain("python");
    expect(languages).toContain("go");
    expect(languages).toContain("rust");
    expect(languages).toContain("java");
  });

  it("should have dependency files for each language", () => {
    for (const config of LANGUAGE_SPECIALIST_CONFIGS) {
      expect(config.dependencyFiles.length).toBeGreaterThan(0);
    }
  });

  it("should have specialist hints for each language", () => {
    for (const config of LANGUAGE_SPECIALIST_CONFIGS) {
      expect(config.specialistHints.length).toBeGreaterThan(0);
    }
  });
});
