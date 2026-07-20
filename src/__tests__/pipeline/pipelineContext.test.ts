import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  validatePhaseTransition,
  shouldTriggerSpecialist,
  getSpecialistHints,
  isHaltStatus,
  AGENT_STATUS_VALUES,
  PHASE_SKIP_CRITERIA,
  TIER1_SPECIALIST_SKIP_CRITERIA,
  TIER1_SKIP_MAX_CHANGED_LOC,
  TIER1_SKIPPABLE_CHANGE_CLASSES,
  evaluateTier1SpecialistSkip,
  type Tier1SpecialistSkipInput,
  SPECIALIST_TRIGGER_TABLE,
  LANGUAGE_SPECIALIST_CONFIGS,
  DEFAULT_MAX_VALIDATION_PASS_ITERATIONS,
  VALIDATION_PASS_CALIBRATION,
  evaluatePhase4Completion,
  resolveEffectiveTier,
  formatTierUpgradeNote,
  type AgentStatus,
  type PipelineContext,
  type TierUpgrade,
  type ProjectTypeContext,
  type QualityResults,
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

    it("rejects an UNRESOLVED verdict at the Phase 4 advance gate by default (D7-10)", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), finalVerdict: "UNRESOLVED" as const },
      };
      const errors = validatePhaseTransition(ctx, 4);
      const verdictErr = errors.find((e) => e.field === "reviewResult.finalVerdict");
      expect(verdictErr).toBeDefined();
      expect(verdictErr!.message).toContain("allowUnresolvedAdvance");
    });

    it("admits an UNRESOLVED verdict at Phase 4 when allowUnresolvedAdvance is passed (D7-10)", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), finalVerdict: "UNRESOLVED" as const },
      };
      const errors = validatePhaseTransition(ctx, 4, { allowUnresolvedAdvance: true });
      expect(errors).toHaveLength(0);
    });

    it("does not apply the UNRESOLVED rejection at completion (D7-10 — scoped to the advance gate)", () => {
      // The UNRESOLVED gate is the Phase 3 → 4 advance decision (targetPhase 4),
      // not the completion check; completion only requires the field set.
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), finalVerdict: "UNRESOLVED" as const },
        qualityResults: validQualityResults(),
      };
      const errors = validatePhaseTransition(ctx, "completion");
      expect(errors.some((e) => e.field === "reviewResult.finalVerdict")).toBe(false);
    });

    it("accepts an absent reviewResult at Phase 4 when phase3Skipped is set (D7-11 skip-path)", () => {
      // Documentation-only / trivial change: Phase 3 was skipped, so no reviewer
      // ran and there is no reviewResult.
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
      };
      const errors = validatePhaseTransition(ctx, 4, { phase3Skipped: true });
      expect(errors.some((e) => e.field === "reviewResult")).toBe(false);
    });

    it("still requires reviewResult at Phase 4 without the phase3Skipped signal (D7-11)", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
      };
      const errors = validatePhaseTransition(ctx, 4);
      expect(errors.some((e) => e.field === "reviewResult")).toBe(true);
    });

    it("accepts a synthetic SKIPPED reviewResult with iterations 0 under phase3Skipped (D7-11)", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: { ...validReviewResult(), iterations: 0 },
      };
      const errors = validatePhaseTransition(ctx, 4, { phase3Skipped: true });
      expect(errors.some((e) => e.field === "reviewResult.iterations")).toBe(false);
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

    it("accepts an absent qualityResults at completion when phase4Skipped is set (docs-only carve-out, D7-SA7.3-03)", () => {
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
      };
      const errors = validatePhaseTransition(ctx, "completion", { phase4Skipped: true });
      expect(errors).toHaveLength(0);
    });

    it("validates a full docs-only pipeline at completion (phase3Skipped + phase4Skipped, D7-SA7.3-03)", () => {
      // Documentation-only run: Phases 3 and 4 both skipped per
      // PHASE_SKIP_CRITERIA — no reviewResult and no qualityResults exist.
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
      };
      const errors = validatePhaseTransition(ctx, "completion", {
        phase3Skipped: true,
        phase4Skipped: true,
      });
      expect(errors).toHaveLength(0);
    });

    it("keeps requiring qualityResults at completion when options are passed without phase4Skipped (D7-SA7.3-03)", () => {
      // The carve-out is explicit-signal-only — an options object without the
      // flag must not relax the completion gate.
      const ctx = {
        ...validBaseContext(),
        researchFindings: validResearchFindings(),
        implementationResult: validImplementationResult(),
        reviewResult: validReviewResult(),
      };
      const errors = validatePhaseTransition(ctx, "completion", { phase3Skipped: false });
      expect(errors.some((e) => e.field === "qualityResults")).toBe(true);
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

  // Mirror pin (PR #133 finding 4): the Phase-1 mandatory-minimum carries the
  // plan-gate clause byte-identical to the Phase Skip Criteria table cell in
  // rules/hatch3r-agent-orchestration.md. Documentation-parity string only —
  // shouldSkipPhase/validatePhaseTransition never parse it.
  it("Phase 1 mandatory minimum carries the plan-gate clause (rule-table mirror)", () => {
    const phase1 = PHASE_SKIP_CRITERIA.find((p) => p.phase === 1)!;
    expect(phase1.mandatoryMinimum).toContain(
      "`plan_gate: true` commands: persisted plan artifact approved (In-Session Plan Gate)",
    );
  });

  // 2.8.0: the Phase-4 skipConditions carry the Tier-1 CQ5+CQ3 relaxation.
  // Mirror pin against the orchestration rule (authored canonically in the
  // same release): the criteria text is the contract of record, byte-for-byte.
  it("Phase 4 skipConditions carry the Tier-1 CQ5+CQ3 relaxation verbatim (rule mirror, 2.8.0)", () => {
    const phase4 = PHASE_SKIP_CRITERIA.find((p) => p.phase === 4)!;
    expect(phase4.skipConditions).toContain(TIER1_SPECIALIST_SKIP_CRITERIA);
    expect(TIER1_SPECIALIST_SKIP_CRITERIA).toBe(
      "Tier-1 may skip CQ5+CQ3 specialist waves only when ALL: (1) diff ≤50 changed LOC; (2) no new dependencies; (3) no files under security-adjacent paths (auth, crypto, secrets, input parsing/validation, permissions); (4) change class ∈ {docs-only, config-only, copy/comment-only, single-function fix with existing test coverage}. Any unmet criterion pins CQ5+CQ3 back on.",
    );
  });
});

// ── evaluateTier1SpecialistSkip (2.8.0) ──────────────────────────

describe("evaluateTier1SpecialistSkip", () => {
  /** All four criteria met — the only shape that yields canSkip: true. */
  function allMet(overrides: Partial<Tier1SpecialistSkipInput> = {}): Tier1SpecialistSkipInput {
    return {
      changedLoc: 12,
      hasNewDependencies: false,
      filesChanged: ["docs/guide.md", "src/render/banner.ts"],
      changeClass: "docs-only",
      ...overrides,
    };
  }

  it("skips when ALL four criteria are met", () => {
    const verdict = evaluateTier1SpecialistSkip(allMet());
    expect(verdict.canSkip).toBe(true);
    expect(verdict.reason).toContain("all four Tier-1 criteria met");
  });

  it("accepts every skippable change class when the other criteria hold", () => {
    for (const changeClass of TIER1_SKIPPABLE_CHANGE_CLASSES) {
      expect(evaluateTier1SpecialistSkip(allMet({ changeClass })).canSkip).toBe(true);
    }
  });

  it("accepts the exact ≤50 LOC boundary", () => {
    expect(TIER1_SKIP_MAX_CHANGED_LOC).toBe(50);
    expect(evaluateTier1SpecialistSkip(allMet({ changedLoc: 50 })).canSkip).toBe(true);
  });

  // Each criterion individually unmet ⇒ no skip (the "any unmet criterion
  // pins CQ5+CQ3 back on" clause, one criterion at a time).
  it("criterion (1) alone unmet — 51 changed LOC — denies the skip", () => {
    const verdict = evaluateTier1SpecialistSkip(allMet({ changedLoc: 51 }));
    expect(verdict.canSkip).toBe(false);
    expect(verdict.reason).toContain("(1)");
    expect(verdict.reason).not.toContain("(2)");
  });

  it("criterion (2) alone unmet — new dependency — denies the skip", () => {
    const verdict = evaluateTier1SpecialistSkip(allMet({ hasNewDependencies: true }));
    expect(verdict.canSkip).toBe(false);
    expect(verdict.reason).toContain("(2) change introduces new dependencies");
  });

  it("criterion (3) alone unmet — a security-adjacent path from EACH family — denies the skip", () => {
    const familyPaths = [
      "src/auth/login.ts", // auth
      "src/lib/crypto/hash.ts", // crypto
      "config/secrets.json", // secrets
      "src/input/parser.ts", // input parsing
      "src/validation/schema.ts", // input validation
      "src/permissions/roles.ts", // permissions
    ];
    for (const file of familyPaths) {
      const verdict = evaluateTier1SpecialistSkip(
        allMet({ filesChanged: ["docs/guide.md", file] }),
      );
      expect(verdict.canSkip, `expected ${file} to pin CQ5+CQ3 back on`).toBe(false);
      expect(verdict.reason).toContain("(3)");
      expect(verdict.reason).toContain(file);
    }
  });

  it("criterion (4) alone unmet — non-skippable change class — denies the skip", () => {
    const verdict = evaluateTier1SpecialistSkip(allMet({ changeClass: "feature" }));
    expect(verdict.canSkip).toBe(false);
    expect(verdict.reason).toContain('(4) change class "feature"');
  });

  it("enumerates every unmet criterion when several fail at once", () => {
    const verdict = evaluateTier1SpecialistSkip({
      changedLoc: 400,
      hasNewDependencies: true,
      filesChanged: ["src/auth/session.ts"],
      changeClass: "feature",
    });
    expect(verdict.canSkip).toBe(false);
    for (const marker of ["(1)", "(2)", "(3)", "(4)"]) {
      expect(verdict.reason).toContain(marker);
    }
  });

  it("fails safe on a non-finite LOC count (denies the skip)", () => {
    expect(evaluateTier1SpecialistSkip(allMet({ changedLoc: Number.NaN })).canSkip).toBe(false);
  });

  it("path matching is case-insensitive and separator-agnostic", () => {
    const windowsPath = "SRC\\Auth\\Login.ts";
    const verdict = evaluateTier1SpecialistSkip(allMet({ filesChanged: [windowsPath] }));
    expect(verdict.canSkip).toBe(false);
    expect(verdict.reason).toContain("(3)");
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
    // Release 2.2.0: hatch3r-ui (CQ1) and hatch3r-ux (CQ2) are
    // "mandatory-on-match" — matching identical to conditional, but a trigger
    // hit mandates a dedicated per-specialist spawn at Tier 2/3. The remaining
    // 5 CQ specialists keep their conditional dispatch.
    const ALWAYS_MODE_CQ = new Set(["hatch3r-testability", "hatch3r-security"]);
    const MANDATORY_ON_MATCH_CQ = new Set(["hatch3r-ui", "hatch3r-ux"]);
    for (const name of CQ_SPECIALISTS) {
      const entry = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === name);
      expect(entry, `${name} missing from SPECIALIST_TRIGGER_TABLE`).toBeDefined();
      const expectedMode = ALWAYS_MODE_CQ.has(name)
        ? "always"
        : MANDATORY_ON_MATCH_CQ.has(name)
          ? "mandatory-on-match"
          : "conditional";
      expect(entry!.mode).toBe(expectedMode);
      expect(entry!.triggerConditions.length).toBeGreaterThan(0);
    }
  });

  // ── Mandatory-on-match mode (2.2.0 — CQ1/CQ2 hard mandate) ──────
  it("marks hatch3r-ui and hatch3r-ux as mandatory-on-match (2.2.0)", () => {
    for (const name of ["hatch3r-ui", "hatch3r-ux"]) {
      const entry = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === name);
      expect(entry, `${name} missing from SPECIALIST_TRIGGER_TABLE`).toBeDefined();
      expect(entry!.mode).toBe("mandatory-on-match");
    }
  });

  it("hatch3r-ui row implements the roster's components/ path-glob claim (D7-SA7.3-02)", () => {
    // agents/shared/cq-specialist-roster.md CQ1 documents a `**/components/**`
    // trigger; this invariant keeps the SSOT row implementing that documented
    // coverage (suffix-gated components/ glob + Angular basenames) so the
    // roster claim can never silently regress to prose-only again.
    const ui = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === "hatch3r-ui");
    expect(ui).toBeDefined();
    expect(ui!.triggerPathGlobs).toContain("components/");
    expect(ui!.triggerPathGlobSuffixes).toBeDefined();
    expect(ui!.triggerFilePatterns).toContain("*.component.ts");
    expect(ui!.triggerFilePatterns).toContain("*.component.html");
  });

  it("returns mandatory: true when a mandatory-on-match specialist triggers", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/components/Button.tsx"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("returns mandatory: true when hatch3r-ux triggers on a flow component", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["src/flows/Checkout.tsx"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("omits mandatory when a mandatory-on-match specialist does not trigger", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/server/route.ts"]);
    expect(result.triggered).toBe(false);
    expect(result.mandatory).toBeUndefined();
  });

  it("does not set mandatory on triggered conditional or always specialists", () => {
    const conditional = shouldTriggerSpecialist("hatch3r-performance", ["src/views/Home.vue"]);
    expect(conditional.triggered).toBe(true);
    expect(conditional.mandatory).toBeUndefined();
    const always = shouldTriggerSpecialist("hatch3r-security", ["src/foo.ts"]);
    expect(always.triggered).toBe(true);
    expect(always.mandatory).toBeUndefined();
  });

  it("stays tier-agnostic — no tier parameter exists to suppress mandatory (recorded limit, D7-SA7.3-06)", () => {
    // Recorded typed-contract limit: the predicate cannot express the Tier-1
    // carve-out ("Tier 1 keeps its Phase Skip Criteria skip") — a Tier-1
    // orchestrator issues the identical call and receives the identical
    // mandatory: true; the tier gate is layered by the caller from prose
    // (rules/hatch3r-agent-orchestration.md → Tier-to-Phase-4 depth mapping).
    // Arity pin: 3 declared parameters (specialist, changedFiles,
    // projectType), no tier input. Landing the recorded hardening path (an
    // optional tier argument that suppresses mandatory at Tier 1) must
    // update this pin and the shouldTriggerSpecialist JSDoc record together.
    expect(shouldTriggerSpecialist.length).toBe(3);
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/components/Button.tsx"]);
    expect(result.mandatory).toBe(true);
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

  // ── CQ1 ui component-surface triggers (Finding D7-SA7.3-02) ─────
  // The ui row was basename-only (*.tsx/jsx/vue/svelte + tailwind/theme), so
  // Angular, co-located-.ts, Lit/Web-Component, and Svelte-5 runes surfaces
  // never matched — and the roster's documented `**/components/**` trigger
  // (agents/shared/cq-specialist-roster.md CQ1) had no SSOT implementation.
  it("triggers hatch3r-ui with mandatory: true on an Angular component class (D7-SA7.3-02)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/app/orders/orders.component.ts"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("triggers hatch3r-ui on an Angular component template (D7-SA7.3-02)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/app/orders/orders.component.html"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("triggers hatch3r-ui on a co-located .ts barrel under components/ (D7-SA7.3-02)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/components/Button/index.ts"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
    expect(result.reasons.some((r) => r.includes("src/components/Button/index.ts"))).toBe(true);
  });

  it("triggers hatch3r-ui on Lit/Web-Component and Svelte-5 runes files under components/ (D7-SA7.3-02)", () => {
    for (const file of ["src/components/my-element.ts", "src/components/counter.svelte.ts"]) {
      const result = shouldTriggerSpecialist("hatch3r-ui", [file]);
      expect(result.triggered, `${file} should trigger hatch3r-ui`).toBe(true);
      expect(result.mandatory, `${file} should be a Tier 2/3 hard mandate`).toBe(true);
    }
  });

  it("triggers hatch3r-ui on a style file under components/ (design-token surface, D7-SA7.3-02)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/components/Button/styles.scss"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("does NOT trigger hatch3r-ui on non-source files under components/ (D7-SA7.3-02)", () => {
    // The suffix gate mirrors the D7-20 backend source-suffix guard: a README
    // or a fixture asset under components/ is not a component change.
    const result = shouldTriggerSpecialist("hatch3r-ui", [
      "src/components/README.md",
      "src/components/fixtures/data.json",
    ]);
    expect(result.triggered).toBe(false);
    expect(result.mandatory).toBeUndefined();
  });

  it("does NOT trigger hatch3r-ui on a plain .ts outside a components/ segment (D7-SA7.3-02)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ui", ["src/lib/formatDate.ts"]);
    expect(result.triggered).toBe(false);
  });

  // ── Backend path-glob triggers (Finding D7-20) ──────────────────
  it("triggers hatch3r-reliability on a backend service-handler .ts path (D7-20)", () => {
    const result = shouldTriggerSpecialist("hatch3r-reliability", ["src/server/handlers/order.ts"]);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes("Backend path-glob trigger"))).toBe(true);
  });

  it("triggers hatch3r-scalability on a backend route .ts path (D7-20)", () => {
    const result = shouldTriggerSpecialist("hatch3r-scalability", ["src/routes/checkout.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("triggers hatch3r-performance on a backend data-access .ts path (D7-20)", () => {
    const result = shouldTriggerSpecialist("hatch3r-performance", ["src/db/queries/users.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("triggers hatch3r-reliability on a Go service file under a backend segment (D7-20)", () => {
    const result = shouldTriggerSpecialist("hatch3r-reliability", ["internal/api/server.go"]);
    expect(result.triggered).toBe(true);
  });

  it("triggers hatch3r-maintainability on a migration path (D7-20)", () => {
    const result = shouldTriggerSpecialist("hatch3r-maintainability", ["db/migrate/0007_add_index.ts"]);
    expect(result.triggered).toBe(true);
  });

  it("does NOT trigger a backend specialist on a front-end-only component path (D7-20)", () => {
    // hatch3r-reliability has no front-end basename patterns; a .vue under
    // components/ has no backend directory segment, so it must not trigger.
    const result = shouldTriggerSpecialist("hatch3r-reliability", ["src/components/Button.vue"]);
    expect(result.triggered).toBe(false);
  });

  it("does NOT trigger a backend specialist on a non-source file inside a backend dir (D7-20)", () => {
    // A README living under routes/ is not a code change — the source-suffix
    // guard prevents a spurious backend trigger.
    const result = shouldTriggerSpecialist("hatch3r-scalability", ["src/routes/README.md"]);
    expect(result.triggered).toBe(false);
  });

  it("does NOT match a backend segment as a basename substring (D7-20)", () => {
    // "routesConfig.ts" contains "routes" but not as a directory segment.
    const result = shouldTriggerSpecialist("hatch3r-reliability", ["src/lib/routesConfig.ts"]);
    expect(result.triggered).toBe(false);
  });

  // ── Microcopy/locale triggers on hatch3r-ux (Bugbot r3547623249) ──
  // The CQ2 row's "Microcopy or i18n strings modified" trigger condition must
  // be matchable by the predicate: a locale-only diff mandates the UX
  // specialist at Tier 2/3 instead of silently skipping it.
  it("triggers hatch3r-ux with mandatory: true on a locale-catalog-only diff (r3547623249)", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["src/i18n/locales/en.json"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
    expect(result.reasons.some((r) => r.includes("src/i18n/locales/en.json"))).toBe(true);
  });

  it("triggers hatch3r-ux on a YAML catalog under a locales/ segment", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["locales/de.yml"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("triggers hatch3r-ux on locale-format extensions regardless of directory", () => {
    // gettext (.po), XLIFF (.xlf), Flutter ARB (.arb): i18n-specific formats
    // ride the basename matcher, no directory evidence required.
    for (const file of ["po/messages.po", "translations/app.xlf", "lib/l10n/intl_en.arb"]) {
      const result = shouldTriggerSpecialist("hatch3r-ux", [file]);
      expect(result.triggered, `${file} should trigger hatch3r-ux`).toBe(true);
      expect(result.mandatory, `${file} should be a Tier 2/3 hard mandate`).toBe(true);
    }
  });

  it("triggers hatch3r-ux on an i18n config basename", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["i18n.config.ts"]);
    expect(result.triggered).toBe(true);
    expect(result.mandatory).toBe(true);
  });

  it("does NOT trigger hatch3r-ux on a .ts-only backend diff", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["src/server/route.ts"]);
    expect(result.triggered).toBe(false);
    expect(result.mandatory).toBeUndefined();
  });

  it("does NOT trigger hatch3r-ux on generic .json files without locale directory evidence", () => {
    const result = shouldTriggerSpecialist("hatch3r-ux", ["package.json", "tsconfig.json"]);
    expect(result.triggered).toBe(false);
  });

  it("does NOT trigger hatch3r-ux on a non-catalog file inside a locales/ dir", () => {
    // The locale suffix gate mirrors the D7-20 backend source-suffix guard: a
    // README under locales/ is not a catalog change.
    const result = shouldTriggerSpecialist("hatch3r-ux", ["locales/README.md"]);
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

describe("Phase 4 Validation Pass calibration (Finding D7-SA7.3-F-7)", () => {
  it("DEFAULT_MAX_VALIDATION_PASS_ITERATIONS is the documented cap of 2", () => {
    // The Phase 4 Validation Pass fixer-iteration cap. Lower than the
    // review-loop cap (4) because a validation-pass iteration only re-runs the
    // fixer on the same diff — no specialist re-spawn.
    expect(DEFAULT_MAX_VALIDATION_PASS_ITERATIONS).toBe(2);
  });

  it("rules/hatch3r-agent-orchestration.{md,mdc} anchor the validation-pass cap to DEFAULT_MAX_VALIDATION_PASS_ITERATIONS", () => {
    // Finding D7-SA7.3-F-7 (Cycle 10): the Phase 4 Validation Pass "max 2
    // iterations" bound previously had no calibration source, unlike the
    // sibling review-loop bound which cites DEFAULT_MAX_REVIEW_ITERATIONS.
    // This assertion makes the rule prose reference the code constant by name
    // and fails if the two ever drift — the same drift guard reviewLoop.test.ts
    // applies to the review-loop cap. The regex is anchored to the Phase 4
    // Validation Pass line and matches both the .md canonical and the .mdc
    // Cursor parity copy.
    const repoRoot = process.cwd();
    const pattern =
      /re-validate\s+\(max\s+(\d+)\s+iterations,\s+matches\s+`DEFAULT_MAX_VALIDATION_PASS_ITERATIONS`/;
    for (const relPath of [
      "rules/hatch3r-agent-orchestration.md",
      "rules/hatch3r-agent-orchestration.mdc",
    ]) {
      const body = readFileSync(join(repoRoot, relPath), "utf-8");
      const match = body.match(pattern);
      expect(
        match,
        `${relPath} must contain "re-validate (max <N> iterations, matches \`DEFAULT_MAX_VALIDATION_PASS_ITERATIONS\`...)" in the Phase 4 Validation Pass`,
      ).not.toBeNull();
      const declared = Number(match![1]);
      expect(
        declared,
        `${relPath} declared "max ${declared} iterations" but code has DEFAULT_MAX_VALIDATION_PASS_ITERATIONS=${DEFAULT_MAX_VALIDATION_PASS_ITERATIONS}`,
      ).toBe(DEFAULT_MAX_VALIDATION_PASS_ITERATIONS);
    }
  });

  it("VALIDATION_PASS_CALIBRATION declares a reproducible, honest basis", () => {
    expect(VALIDATION_PASS_CALIBRATION).toBeDefined();
    expect(["measured", "informed_estimate"]).toContain(VALIDATION_PASS_CALIBRATION.basis);
    expect(typeof VALIDATION_PASS_CALIBRATION.source).toBe("string");
    expect(VALIDATION_PASS_CALIBRATION.source.length).toBeGreaterThan(0);
    expect(typeof VALIDATION_PASS_CALIBRATION.sampleSize).toBe("number");
    expect(typeof VALIDATION_PASS_CALIBRATION.measurementMethodRef).toBe("string");
    expect(VALIDATION_PASS_CALIBRATION.measurementMethodRef.length).toBeGreaterThan(0);
  });

  it("VALIDATION_PASS_CALIBRATION recalibration triggers are valid fractions", () => {
    const t = VALIDATION_PASS_CALIBRATION.recalibrationTriggers;
    expect(t.convergeWithinCapRateBelow).toBeGreaterThan(0);
    expect(t.convergeWithinCapRateBelow).toBeLessThanOrEqual(1);
    expect(t.capHitRateAbove).toBeGreaterThanOrEqual(0);
    expect(t.capHitRateAbove).toBeLessThanOrEqual(1);
  });

  it("VALIDATION_PASS_CALIBRATION is an honest informed_estimate (no fabricated dataset)", () => {
    // Charter directive 20: until validation-pass telemetry lands, the basis
    // must remain informed_estimate with sampleSize 0 and no measuredAt date.
    expect(VALIDATION_PASS_CALIBRATION.basis).toBe("informed_estimate");
    expect(VALIDATION_PASS_CALIBRATION.sampleSize).toBe(0);
    expect(VALIDATION_PASS_CALIBRATION.measuredAt).toBeNull();
  });

  it("VALIDATION_PASS_CALIBRATION is frozen against mutation", () => {
    expect(Object.isFrozen(VALIDATION_PASS_CALIBRATION)).toBe(true);
    expect(Object.isFrozen(VALIDATION_PASS_CALIBRATION.recalibrationTriggers)).toBe(true);
  });
});

describe("evaluatePhase4Completion (Finding D7-M8 / D16-5)", () => {
  // Fresh fixture per assertion so a test that mutates one clause cannot leak
  // into the next. Baseline = both mandatory always-mode floor specialists
  // (hatch3r-security CQ3, hatch3r-testability CQ5) returned SUCCESS and the
  // validation pass is green — the only state the contract reports complete.
  function passingQualityResults(): QualityResults {
    return {
      specialists: [
        { specialist: "hatch3r-security", status: "SUCCESS", findingsCount: 0, summary: "No CQ3 findings" },
        { specialist: "hatch3r-testability", status: "SUCCESS", findingsCount: 0, summary: "All tests pass" },
      ],
      validationPass: {
        testsPass: true,
        typecheckPass: true,
        fixAttempts: 0,
        regressionsPersist: false,
      },
    };
  }

  it("returns complete:true when every clause passes (all-pass)", () => {
    const result = evaluatePhase4Completion(passingQualityResults());
    expect(result.complete).toBe(true);
    expect(result.mandatoryFloorsSatisfied).toBe(true);
    expect(result.reReviewIterations).toBe(0);
    expect(result.unresolvedCriticalFindings).toBe(0);
    expect(result.codeMutatingSpecialists).toEqual([]);
    expect(result.incompletionReason).toBeUndefined();
  });

  it("fails closed when validationPass.testsPass === false", () => {
    const q = passingQualityResults();
    q.validationPass.testsPass = false;
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe("validationPass.testsPass === false");
  });

  it("fails closed when validationPass.typecheckPass === false", () => {
    const q = passingQualityResults();
    q.validationPass.typecheckPass = false;
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe("validationPass.typecheckPass === false");
  });

  it("fails closed when validationPass.regressionsPersist === true", () => {
    const q = passingQualityResults();
    q.validationPass.regressionsPersist = true;
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe("validationPass.regressionsPersist === true");
  });

  it("fails closed when a mandatory floor specialist did not return SUCCESS (D16-5 security gate)", () => {
    // D16-5: a mandatory always-mode CQ3/CQ5 specialist that times out (or
    // crashes) must NOT be treated as an implicit pass. The typed gate reports
    // mandatoryFloorsSatisfied:false and complete:false — the same fail-closed
    // posture the orchestration-detail rule now carries in prose.
    const q = passingQualityResults();
    const sec = q.specialists.find((s) => s.specialist === "hatch3r-security")!;
    sec.status = "TIMEOUT";
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(false);
    expect(result.incompletionReason).toBe(
      "mandatory floor specialist (hatch3r-security or hatch3r-testability) did not return SUCCESS",
    );
  });

  it("fails closed when the security specialist is absent (missing-floor, not an implicit pass)", () => {
    // Absence-of-finding is not an implicit pass: if hatch3r-security never ran
    // (no SpecialistResult), find() returns undefined and the floor is unsatisfied.
    const q = passingQualityResults();
    q.specialists = q.specialists.filter((s) => s.specialist !== "hatch3r-security");
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(false);
  });

  it("fails closed when reReviewIterations exceeds the cap of 1", () => {
    const result = evaluatePhase4Completion(passingQualityResults(), {
      reReviewIterations: 2,
    });
    expect(result.complete).toBe(false);
    expect(result.reReviewIterations).toBe(2);
    expect(result.incompletionReason).toBe(
      "Phase 4 Validation Pass re-review exceeded max 1 iteration (rules/hatch3r-agent-orchestration.md)",
    );
  });

  it("fails closed when unresolvedCriticalFindings > 0", () => {
    const result = evaluatePhase4Completion(passingQualityResults(), {
      unresolvedCriticalFindings: 1,
    });
    expect(result.complete).toBe(false);
    expect(result.unresolvedCriticalFindings).toBe(1);
    expect(result.incompletionReason).toBe(
      "1 Critical finding(s) unresolved after Phase 4 fixer pass",
    );
  });

  it("evaluates clauses in priority order — testsPass failure reported before a missing floor", () => {
    // Guards the early-return ordering: when both the validation pass and a
    // mandatory floor fail, the validation-pass clause is reported first.
    const q = passingQualityResults();
    q.validationPass.testsPass = false;
    q.specialists = q.specialists.filter((s) => s.specialist !== "hatch3r-security");
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(false);
    expect(result.incompletionReason).toBe("validationPass.testsPass === false");
  });

  it("passes through codeMutatingSpecialists for the Phase 4 Validation Pass re-review scope", () => {
    const result = evaluatePhase4Completion(passingQualityResults(), {
      codeMutatingSpecialists: ["hatch3r-security"],
    });
    expect(result.complete).toBe(true);
    expect(result.codeMutatingSpecialists).toEqual(["hatch3r-security"]);
  });

  it("derives unresolvedCriticalFindings from SpecialistResult.criticalCount when no override is passed (D7-19)", () => {
    // D7-19: a specialist that recorded a Critical finding must fail the gate
    // without the caller threading the count through a separate options arg.
    const q = passingQualityResults();
    q.specialists.find((s) => s.specialist === "hatch3r-security")!.criticalCount = 2;
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.unresolvedCriticalFindings).toBe(2);
    expect(result.incompletionReason).toBe(
      "2 Critical finding(s) unresolved after Phase 4 fixer pass",
    );
  });

  it("sums criticalCount across specialists for the derived default (D7-19)", () => {
    const q = passingQualityResults();
    q.specialists.find((s) => s.specialist === "hatch3r-security")!.criticalCount = 1;
    q.specialists.find((s) => s.specialist === "hatch3r-testability")!.criticalCount = 2;
    const result = evaluatePhase4Completion(q);
    expect(result.unresolvedCriticalFindings).toBe(3);
    expect(result.complete).toBe(false);
  });

  it("treats absent criticalCount as 0 — back-compatible default stays complete (D7-19)", () => {
    // Baseline fixture omits criticalCount entirely; the derived sum is 0.
    const result = evaluatePhase4Completion(passingQualityResults());
    expect(result.unresolvedCriticalFindings).toBe(0);
    expect(result.complete).toBe(true);
  });

  it("lets an explicit options.unresolvedCriticalFindings override the derived sum (D7-19)", () => {
    const q = passingQualityResults();
    q.specialists.find((s) => s.specialist === "hatch3r-security")!.criticalCount = 5;
    // Explicit 0 override wins over the derived sum of 5.
    const result = evaluatePhase4Completion(q, { unresolvedCriticalFindings: 0 });
    expect(result.unresolvedCriticalFindings).toBe(0);
    expect(result.complete).toBe(true);
  });

  it("accepts SUCCESS without criticalCount as reviewed-clean — the count-on-SUCCESS invariant is un-typed (recorded limit, D7-SA7.3-06)", () => {
    // Recorded typed-contract limit: SpecialistResult stays a single
    // interface (the SUCCESS-requires-count discriminated union was rejected
    // in the D7-SA7.3-01 fix for @library_export_only back-compat), so this
    // literal compiles WITHOUT the field and the gate trusts absent → 0 once
    // the status sweep passes — a SUCCESS producer that forgets the count
    // reads as reviewed-clean. Narrowing the type later turns this literal
    // into a compile error — update the criticalCount JSDoc record with it.
    const q = passingQualityResults();
    q.specialists.push({
      specialist: "hatch3r-ui",
      status: "SUCCESS",
      findingsCount: 0,
      summary: "CQ1 review clean",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(true);
    expect(result.unresolvedCriticalFindings).toBe(0);
    expect(result.incompletionReason).toBeUndefined();
  });

  it("fails closed when a triggered mandatory-on-match specialist TIMEOUTs with no criticalCount (D7-SA7.3-01)", () => {
    // The central regression for D7-SA7.3-01: floors SUCCESS + validation pass
    // green, but the triggered hatch3r-ui (CQ1, mandatory-on-match) timed out
    // before setting criticalCount. Pre-sweep this returned complete:true —
    // only the two floors' statuses were read and `criticalCount ?? 0`
    // contributed 0 — so the dispatch-layer "non-skippable at Tier 2/3"
    // mandate had no completion-layer backstop.
    const q = passingQualityResults();
    q.specialists.push({
      specialist: "hatch3r-ui",
      status: "TIMEOUT",
      findingsCount: 0,
      summary: "timed out before completing the CQ1 review",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(true);
    expect(result.incompletionReason).toBe(
      "dispatched specialist(s) did not complete: hatch3r-ui (TIMEOUT)",
    );
  });

  it("fails closed when a conditional specialist returns FAILED — the sweep covers the whole dispatched set (D7-SA7.3-01)", () => {
    const q = passingQualityResults();
    q.specialists.push({
      specialist: "hatch3r-reliability",
      status: "FAILED",
      findingsCount: 0,
      summary: "crashed before producing output",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe(
      "dispatched specialist(s) did not complete: hatch3r-reliability (FAILED)",
    );
  });

  it("accepts SKIPPED with a documented reason — a documented skip is not a crash (D7-SA7.3-01)", () => {
    const q = passingQualityResults();
    q.specialists.push({
      specialist: "hatch3r-performance",
      status: "SKIPPED",
      findingsCount: 0,
      summary: "Phase Skip Criteria: Tier 1 run — conditional specialist skipped per tier depth mapping",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(true);
    expect(result.incompletionReason).toBeUndefined();
  });

  it("fails closed on SKIPPED without a documented reason — empty summary is an undocumented skip (D7-SA7.3-01)", () => {
    // SpecialistResult has no `reason` field; the summary is the SKIPPED
    // contract's citation channel. Whitespace-only counts as undocumented.
    const q = passingQualityResults();
    q.specialists.push({
      specialist: "hatch3r-ux",
      status: "SKIPPED",
      findingsCount: 0,
      summary: "   ",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe(
      "dispatched specialist(s) did not complete: hatch3r-ux (SKIPPED without documented skip reason)",
    );
  });

  it("reports the floor clause before the status sweep when both fail (clause priority preserved)", () => {
    // Guards the D16-5 floor message: a TIMEOUT floor is reported via the
    // floor clause, not folded into the generic sweep message.
    const q = passingQualityResults();
    q.specialists.find((s) => s.specialist === "hatch3r-security")!.status = "TIMEOUT";
    q.specialists.push({
      specialist: "hatch3r-ui",
      status: "TIMEOUT",
      findingsCount: 0,
      summary: "timed out",
    });
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(false);
    expect(result.incompletionReason).toBe(
      "mandatory floor specialist (hatch3r-security or hatch3r-testability) did not return SUCCESS",
    );
  });

  it("names every incomplete specialist when multiple fail the sweep (D7-SA7.3-01)", () => {
    const q = passingQualityResults();
    q.specialists.push(
      { specialist: "hatch3r-ui", status: "TIMEOUT", findingsCount: 0, summary: "timed out" },
      { specialist: "hatch3r-scalability", status: "PARTIAL", findingsCount: 1, summary: "half done" },
    );
    const result = evaluatePhase4Completion(q);
    expect(result.complete).toBe(false);
    expect(result.incompletionReason).toBe(
      "dispatched specialist(s) did not complete: hatch3r-ui (TIMEOUT), hatch3r-scalability (PARTIAL)",
    );
  });

  // ── Documentation-only carve-out (Finding D7-SA7.3-03) ──────────
  it("reports complete-by-skip for a documentation-only change (phase4Skipped, D7-SA7.3-03)", () => {
    // No Phase 4 ran: no specialists exist, and the validationPass values are
    // whatever the caller fabricated — the carve-out must not read them.
    const result = evaluatePhase4Completion(
      {
        specialists: [],
        validationPass: { testsPass: false, typecheckPass: false, fixAttempts: 0, regressionsPersist: true },
      },
      { phase4Skipped: true },
    );
    expect(result.complete).toBe(true);
    expect(result.mandatoryFloorsSatisfied).toBe("n/a");
    expect(result.unresolvedCriticalFindings).toBe(0);
    expect(result.incompletionReason).toBeUndefined();
  });

  it("still fails closed for an empty specialist set WITHOUT the phase4Skipped signal (D7-SA7.3-03)", () => {
    // The carve-out is explicit-signal-only: absent the flag, a context with
    // no specialists keeps the mandatory-floor rejection — a docs-only skip is
    // never granted implicitly.
    const result = evaluatePhase4Completion({
      specialists: [],
      validationPass: { testsPass: true, typecheckPass: true, fixAttempts: 0, regressionsPersist: false },
    });
    expect(result.complete).toBe(false);
    expect(result.mandatoryFloorsSatisfied).toBe(false);
    expect(result.incompletionReason).toContain("mandatory floor specialist");
  });
});

describe("mid-run tier upgrade (Finding D7-14)", () => {
  describe("resolveEffectiveTier", () => {
    it("returns the baseline deepContextTier when no upgrade is recorded", () => {
      expect(resolveEffectiveTier({ deepContextTier: 2 })).toBe(2);
    });

    it("returns the upgraded tier when a mid-run upgrade escalates above the baseline", () => {
      const upgrade: TierUpgrade = {
        from: 2,
        to: 3,
        reason: "Phase 1 research found 12 affected files (initial estimate <5)",
        atPhase: 1,
      };
      expect(resolveEffectiveTier({ deepContextTier: 2, tierUpgrade: upgrade })).toBe(3);
    });

    it("ignores a malformed non-escalating upgrade (to <= from) — never downgrades coverage", () => {
      // A bad record must not lower the effective tier below the baseline.
      expect(
        resolveEffectiveTier({
          deepContextTier: 3,
          tierUpgrade: { from: 3, to: 2, reason: "stale record", atPhase: 2 },
        }),
      ).toBe(3);
      expect(
        resolveEffectiveTier({
          deepContextTier: 2,
          tierUpgrade: { from: 2, to: 2, reason: "no-op", atPhase: 1 },
        }),
      ).toBe(2);
    });
  });

  describe("formatTierUpgradeNote", () => {
    it("returns null when no upgrade is recorded", () => {
      expect(formatTierUpgradeNote({ deepContextTier: 2 })).toBeNull();
    });

    it("renders a one-line note naming from→to, phase, reason, and the depth consequence", () => {
      const note = formatTierUpgradeNote({
        deepContextTier: 1,
        tierUpgrade: {
          from: 1,
          to: 3,
          reason: "Phase 2 surfaced 4 undocumented dependencies",
          atPhase: 2,
        },
      });
      expect(note).not.toBeNull();
      expect(note).toContain("Tier upgraded 1→3 at Phase 2");
      expect(note).toContain("Phase 2 surfaced 4 undocumented dependencies");
      expect(note).toContain("Tier 3");
      // Single line — no embedded newlines in the iteration-summary surfacing.
      expect(note).not.toContain("\n");
    });

    it("returns null for a recorded-but-non-escalating upgrade (agrees with resolveEffectiveTier)", () => {
      expect(
        formatTierUpgradeNote({
          deepContextTier: 3,
          tierUpgrade: { from: 3, to: 2, reason: "stale record", atPhase: 2 },
        }),
      ).toBeNull();
    });
  });

  it("PipelineContext accepts an optional tierUpgrade field (type-level + runtime carry)", () => {
    const ctx: Partial<PipelineContext> = {
      ...validBaseContext(),
      tierUpgrade: {
        from: 2,
        to: 3,
        reason: "Phase 1 research found >10 affected files",
        atPhase: 1,
      },
    };
    // The carrier does not disturb existing phase-transition validation.
    expect(validatePhaseTransition(ctx, 1)).toHaveLength(0);
    expect(resolveEffectiveTier(ctx as PipelineContext)).toBe(3);
  });
});
