import { describe, it, expect } from "vitest";
import {
  validatePhaseTransition,
  shouldTriggerSpecialist,
  getSpecialistHints,
  isHaltStatus,
  AGENT_STATUS_VALUES,
  PHASE_SKIP_CRITERIA,
  SPECIALIST_TRIGGER_TABLE,
  LANGUAGE_SPECIALIST_CONFIGS,
  type AgentStatus,
  type PipelineContext,
  type ProjectTypeContext,
  type ReviewVerdict,
  type ValidationPass,
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
      { specialist: "hatch3r-testability", status: "SUCCESS" as const, findingsCount: 0, summary: "All tests pass" },
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
        // Intentionally invalid status to verify the validator rejects it.
        implementationResult: { ...validImplementationResult(), status: "INVALID" as unknown as AgentStatus },
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
        // Intentionally invalid verdict to verify the validator rejects it.
        reviewResult: { ...validReviewResult(), finalVerdict: "INVALID" as unknown as ReviewVerdict },
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
        // Intentionally missing validationPass to verify the validator rejects it.
        qualityResults: { specialists: [], validationPass: undefined as unknown as ValidationPass },
      };
      const errors = validatePhaseTransition(ctx, "completion");
      expect(errors.some((e) => e.field === "qualityResults.validationPass")).toBe(true);
    });
  });
});

// ── shouldTriggerSpecialist ──────────────────────────────────────

describe("shouldTriggerSpecialist", () => {
  // F16.3-H1 (Cycle 10 Wave 1C): legacy test-writer + security-auditor +
  // dependency-auditor roles collapsed into hatch3r-testability (CQ5) and
  // hatch3r-security (CQ3); the always-mode floors and dependency-file
  // triggers now live on the CQ specialists.
  it("should always trigger testability (CQ5) for code changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-testability", ["src/foo.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("should always trigger security (CQ3) for code changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["src/foo.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("should not trigger always-mode specialists for empty changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-testability", []);
    expect(result.triggered).toBe(false);
  });

  it("should trigger security (CQ3) for package.json changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["package.json"]);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes("package.json"))).toBe(true);
  });

  it("should trigger security (CQ3) for go.mod changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["go.mod"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger security (CQ3) for Cargo.toml changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["Cargo.toml"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger security (CQ3) for nested package.json", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["packages/core/package.json"]);
    expect(result.triggered).toBe(true);
  });

  // security (CQ3) is always-mode so any non-empty changed-files list triggers
  // it, regardless of dependency-file membership. The pre-F16.3-H1 conditional
  // dependency-auditor "non-dependency files don't trigger" assertion no
  // longer applies — security as always-mode subsumes it.

  it("should trigger security (CQ3) for lockfile changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-security", ["pnpm-lock.yaml"]);
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

    it("should trigger security (CQ3) with language context for Node.js", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-security",
        ["package.json"],
        nodeProject,
      );
      expect(result.triggered).toBe(true);
      expect(result.reasons.some((r) => r.includes("typescript"))).toBe(true);
    });

    it("should trigger security (CQ3) with language context for Go", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-security",
        ["go.mod"],
        goProject,
      );
      expect(result.triggered).toBe(true);
      expect(result.reasons.some((r) => r.includes("go"))).toBe(true);
    });

    // security (CQ3) is always-mode: any non-empty changed-files list
    // triggers it (its always-mode floor absorbs the legacy "no trigger on
    // unrelated files" assertion that dependency-auditor exercised in its
    // conditional mode). Project-type-aware language hints attach only when
    // dependency files are in the change set.
    it("should trigger security (CQ3) even for unrelated files (always-mode floor)", () => {
      const result = shouldTriggerSpecialist(
        "hatch3r-security",
        ["src/main.go"],
        goProject,
      );
      expect(result.triggered).toBe(true);
    });
  });
});

// ── getSpecialistHints ───────────────────────────────────────────

describe("getSpecialistHints", () => {
  it("should return TypeScript hints for testability (CQ5)", () => {
    const hints = getSpecialistHints("hatch3r-testability", {
      languages: ["typescript"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "npm",
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("typescript");
  });

  it("should return Go hints for security (CQ3)", () => {
    const hints = getSpecialistHints("hatch3r-security", {
      languages: ["go"],
      frameworks: [],
      isMonorepo: false,
      packageManager: "unknown",
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("go");
  });

  it("should return hints for multiple languages", () => {
    const hints = getSpecialistHints("hatch3r-testability", {
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
    const hints = getSpecialistHints("hatch3r-testability", {
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
  // F16.3-H1 (Cycle 10 Wave 1C): the legacy dependency-auditor scope
  // collapsed into hatch3r-security (CQ3) — security now carries the
  // dependency-file trigger patterns AND owns the always-mode floor that
  // legacy security-auditor enforced. testability (CQ5) carries the
  // always-mode floor that legacy test-writer enforced.
  it("should include security (CQ3) with dependency-file trigger patterns", () => {
    const security = SPECIALIST_TRIGGER_TABLE.find(
      (t) => t.specialist === "hatch3r-security",
    );
    expect(security).toBeDefined();
    expect(security!.mode).toBe("always");
    expect(security!.triggerFilePatterns).toBeDefined();
    expect(security!.triggerFilePatterns!.length).toBeGreaterThan(0);
  });

  it("should include all mandatory specialists (CQ-renamed)", () => {
    const mandatory = SPECIALIST_TRIGGER_TABLE.filter((t) => t.mode === "always");
    const names = mandatory.map((t) => t.specialist);
    expect(names).toContain("hatch3r-testability");
    expect(names).toContain("hatch3r-security");
  });

  it("should have dependency-file trigger patterns on security (CQ3)", () => {
    const security = SPECIALIST_TRIGGER_TABLE.find(
      (t) => t.specialist === "hatch3r-security",
    )!;
    expect(security.triggerFilePatterns).toContain("package.json");
    expect(security.triggerFilePatterns).toContain("go.mod");
    expect(security.triggerFilePatterns).toContain("Cargo.toml");
    expect(security.triggerFilePatterns).toContain("requirements.txt");
    expect(security.triggerFilePatterns).toContain("Gemfile");
    expect(security.triggerFilePatterns).toContain("pom.xml");
  });

  // ── CQ1-CQ9 vector specialists (Finding F7.3-C1) ──────────────────

  const CQ_SPECIALISTS = [
    "hatch3r-ui",
    "hatch3r-ux",
    "hatch3r-security",
    "hatch3r-reliability",
    "hatch3r-testability",
    "hatch3r-scalability",
    "hatch3r-performance",
    "hatch3r-maintainability",
    "hatch3r-enhancability",
  ] as const;

  it("should include all 9 CQ vector specialists (F7.3-C1)", () => {
    // F16.3-H1 (Cycle 10 Wave 1C): hatch3r-testability (CQ5) and
    // hatch3r-security (CQ3) absorbed the legacy test-writer +
    // security-auditor always-mode floors, so their mode is "always".
    // The remaining 7 CQ specialists keep their conditional dispatch.
    const ALWAYS_MODE_CQ = new Set(["hatch3r-testability", "hatch3r-security"]);
    for (const name of CQ_SPECIALISTS) {
      const entry = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === name);
      expect(entry, `${name} missing from SPECIALIST_TRIGGER_TABLE`).toBeDefined();
      const expectedMode = ALWAYS_MODE_CQ.has(name) ? "always" : "conditional";
      expect(entry!.mode).toBe(expectedMode);
      expect(entry!.triggerConditions.length).toBeGreaterThan(0);
    }
  });

  it("should trigger hatch3r-ui on UI component file changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/components/Button.tsx"]);
    expect(result.triggered).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("should trigger hatch3r-performance on Vue component file changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-performance", ["src/views/Home.vue"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger hatch3r-maintainability on OpenAPI spec changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-maintainability", ["openapi.yaml"]);
    expect(result.triggered).toBe(true);
  });

  it("should trigger hatch3r-enhancability on AsyncAPI spec changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-enhancability", ["asyncapi.yaml"]);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger hatch3r-ui on non-UI file changes", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/server/route.ts"]);
    expect(result.triggered).toBe(false);
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

// ── AgentStatus (Finding C7.5-W2B2-H24 / D7-SA7.1-2) ─────────────

describe("AGENT_STATUS_VALUES", () => {
  it("should include all six canonical statuses", () => {
    expect(AGENT_STATUS_VALUES).toEqual([
      "SUCCESS",
      "PARTIAL",
      "FAILED",
      "SKIPPED",
      "TIMEOUT",
      "BLOCKED_PREMISE_CHALLENGE",
    ]);
  });

  it("should include BLOCKED_PREMISE_CHALLENGE for quality-charter §3 escalation", () => {
    expect(AGENT_STATUS_VALUES).toContain("BLOCKED_PREMISE_CHALLENGE");
  });

  it("should be usable as a runtime allowlist", () => {
    for (const status of AGENT_STATUS_VALUES) {
      expect(typeof status).toBe("string");
      expect(status.length).toBeGreaterThan(0);
    }
  });
});

describe("isHaltStatus", () => {
  it("should return true for BLOCKED_PREMISE_CHALLENGE", () => {
    expect(isHaltStatus("BLOCKED_PREMISE_CHALLENGE")).toBe(true);
  });

  it("should return false for SUCCESS", () => {
    expect(isHaltStatus("SUCCESS")).toBe(false);
  });

  it("should return false for PARTIAL, FAILED, SKIPPED, TIMEOUT", () => {
    const nonHalt: AgentStatus[] = ["PARTIAL", "FAILED", "SKIPPED", "TIMEOUT"];
    for (const status of nonHalt) {
      expect(isHaltStatus(status)).toBe(false);
    }
  });

  it("should return true only for BLOCKED_PREMISE_CHALLENGE across the full enum", () => {
    const haltStatuses = AGENT_STATUS_VALUES.filter((s) => isHaltStatus(s));
    expect(haltStatuses).toEqual(["BLOCKED_PREMISE_CHALLENGE"]);
  });
});

describe("validatePhaseTransition with BLOCKED_PREMISE_CHALLENGE", () => {
  it("should accept BLOCKED_PREMISE_CHALLENGE as a valid implementation status", () => {
    const ctx = {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      taskType: "feature" as const,
      issueRef: "#42",
      deepContextTier: 2 as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      totalDuration: null,
      researchFindings: {
        modes: ["codebase-impact"],
        affectedFiles: ["src/foo.ts"],
        blastRadius: [],
        existingTests: [],
        dependencies: [],
        conventions: null,
        resolvedRequirements: null,
      },
      implementationResult: {
        filesChanged: [],
        testsWritten: [],
        status: "BLOCKED_PREMISE_CHALLENGE" as const,
        reason:
          "Task premise conflicts with architectural invariant X; alt: refactor invariant before feature",
      },
    };
    const errors = validatePhaseTransition(ctx, 3);
    expect(errors.filter((e) => e.field === "implementationResult.status")).toHaveLength(0);
  });
});
