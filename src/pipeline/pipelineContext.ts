/**
 * PipelineContext type definitions and runtime validation.
 *
 * The PipelineContext is the structured handoff object passed between pipeline
 * phases. Each phase reads its inputs and writes its outputs to this context.
 * Runtime validation ensures that required fields are present and correctly
 * typed when context is passed between phases.
 *
 * Finding #54 (D7, High): Add TypeScript PipelineContext type with runtime validation.
 */

// ── Types ────────────────────────────────────────────────────────

export type TaskType = "bug" | "feature" | "refactor" | "qa";
export type DeepContextTier = 1 | 2 | 3;
export type AgentStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED" | "TIMEOUT";
export type ReviewVerdict = "CLEAN" | "UNRESOLVED";
export type ConfirmationPassResult = "PASS" | "FAIL";

export interface ResearchFindings {
  /** Researcher modes used. */
  modes: string[];
  /** Files to create/modify/delete. */
  affectedFiles: string[];
  /** Downstream consumers at risk. */
  blastRadius: string[];
  /** Test files covering affected code. */
  existingTests: string[];
  /** Internal + external dependencies. */
  dependencies: string[];
  /** From similar-implementation mode. */
  conventions: Record<string, unknown> | null;
  /** From requirements-elicitation mode. */
  resolvedRequirements: Record<string, unknown> | null;
}

export interface ImplementationResult {
  filesChanged: string[];
  testsWritten: string[];
  status: AgentStatus;
  reason: string | null;
}

export interface ReviewFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  description: string;
  filePath?: string;
  line?: number;
  confidence: "high" | "medium" | "low";
}

export interface SpecialistResult {
  specialist: string;
  status: AgentStatus;
  findingsCount: number;
  summary: string;
}

export interface ValidationPass {
  testsPass: boolean;
  typecheckPass: boolean;
  fixAttempts: number;
  regressionsPersist: boolean;
}

export interface QualityResults {
  specialists: SpecialistResult[];
  validationPass: ValidationPass;
}

export interface ReviewResult {
  iterations: number;
  finalVerdict: ReviewVerdict;
  findings: ReviewFinding[];
  confirmationPassResult: ConfirmationPassResult;
}

/** Detected project type for specialist selection (Finding #56). */
export interface ProjectTypeContext {
  languages: string[];
  frameworks: string[];
  isMonorepo: boolean;
  packageManager: string;
}

/**
 * The PipelineContext is the canonical handoff object passed between
 * all four pipeline phases. Each phase populates its section.
 */
export interface PipelineContext {
  /** UUID v4, generated before Phase 1. */
  correlationId: string;
  taskType: TaskType;
  /** Issue number or null for plain chat. */
  issueRef: string | null;
  /** From hatch3r-deep-context scoring. */
  deepContextTier: DeepContextTier;

  /** Detected project type for specialist selection (Finding #56). */
  projectType?: ProjectTypeContext;

  // Phase 1 outputs (Research)
  researchFindings?: ResearchFindings;
  /** Research gap flags identified at mid-implementation checkpoint (Finding #52). */
  researchGaps?: string[];

  // Phase 2 outputs (Implementation)
  implementationResult?: ImplementationResult;

  // Phase 3 outputs (Review)
  reviewResult?: ReviewResult;

  // Phase 4 outputs (Quality)
  qualityResults?: QualityResults;

  // Metadata
  /** ISO-8601 timestamp. */
  startedAt: string;
  completedAt: string | null;
  /** Total duration in milliseconds. */
  totalDuration: number | null;
}

// ── Phase Skip Criteria (Finding #53) ────────────────────────────

/**
 * Consistent phase-skip criteria across all commands.
 *
 * Each phase has documented conditions under which it can be safely skipped.
 * Commands reference these criteria to maintain consistency.
 */
export interface PhaseSkipCriteria {
  phase: 1 | 2 | 3 | 4;
  phaseName: string;
  /** Conditions under which this phase can be safely skipped. */
  skipConditions: string[];
  /** What must always run even when the phase is "skipped". */
  mandatoryMinimum: string[];
}

export const PHASE_SKIP_CRITERIA: readonly PhaseSkipCriteria[] = [
  {
    phase: 1,
    phaseName: "Research",
    skipConditions: [
      "Trivial single-line edits (typo, comment, single-value config change)",
      "Task is classified as Tier 1 AND affects a single file with no cross-module impact",
      "Research was already performed in a prior invocation and results are cached in PipelineContext",
    ],
    mandatoryMinimum: [
      "Affected files must still be identified (even if via quick inline scan)",
      "Existing tests in the affected area must be noted",
    ],
  },
  {
    phase: 2,
    phaseName: "Implement",
    skipConditions: [
      "Never — implementation is always required when there are code changes",
    ],
    mandatoryMinimum: [
      "All code changes must go through hatch3r-implementer (never inline except trivial items in quick-change)",
    ],
  },
  {
    phase: 3,
    phaseName: "Review Loop",
    skipConditions: [
      "All items in the batch are classified as trivial (quick-change only)",
      "Change is documentation-only with no code modifications",
    ],
    mandatoryMinimum: [
      "Quality checks (lint, typecheck, test) must still pass",
      "Acceptance criteria must still be verified",
    ],
  },
  {
    phase: 4,
    phaseName: "Final Quality",
    skipConditions: [
      "Review loop (Phase 3) did not produce a clean verdict AND user chose to proceed manually",
      "Change is documentation-only with no code modifications",
      "All items are trivial AND quality checks pass (quick-change only)",
    ],
    mandatoryMinimum: [
      "test-writer and security-auditor are always required for code changes regardless of command",
      "Quality checks must pass before completion",
    ],
  },
] as const;

// ── Specialist Trigger Table (Finding #55) ───────────────────────

/**
 * Phase 4 specialist trigger conditions.
 *
 * Defines when each specialist should be triggered based on the changes
 * made during implementation. The dependency-auditor is included for
 * dependency file modifications.
 */
export interface SpecialistTrigger {
  specialist: string;
  /** When to trigger: "always", "evaluate", or "conditional". */
  mode: "always" | "evaluate" | "conditional";
  /** File patterns or conditions that trigger this specialist. */
  triggerConditions: string[];
  /** Dependency file patterns (for dependency-auditor). */
  triggerFilePatterns?: string[];
}

export const SPECIALIST_TRIGGER_TABLE: readonly SpecialistTrigger[] = [
  {
    specialist: "hatch3r-test-writer",
    mode: "always",
    triggerConditions: ["Any code change"],
  },
  {
    specialist: "hatch3r-security-auditor",
    mode: "always",
    triggerConditions: ["Any code change"],
  },
  {
    specialist: "hatch3r-docs-writer",
    mode: "evaluate",
    triggerConditions: [
      "Public API changes",
      "Architectural pattern changes",
      "User-facing behavior changes",
      "Specs or ADRs need updating",
    ],
  },
  {
    specialist: "hatch3r-lint-fixer",
    mode: "conditional",
    triggerConditions: ["Lint or type errors present after implementation"],
  },
  {
    specialist: "hatch3r-a11y-auditor",
    mode: "conditional",
    triggerConditions: ["UI or accessibility changes"],
  },
  {
    specialist: "hatch3r-perf-profiler",
    mode: "conditional",
    triggerConditions: ["Performance-sensitive changes", "Hot path modifications"],
  },
  {
    specialist: "hatch3r-dependency-auditor",
    mode: "conditional",
    triggerConditions: [
      "Dependency files modified",
      "New dependency added",
      "Dependency version changed",
      "Lockfile modified",
    ],
    triggerFilePatterns: [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "go.mod",
      "go.sum",
      "Cargo.toml",
      "Cargo.lock",
      "requirements.txt",
      "Pipfile",
      "Pipfile.lock",
      "pyproject.toml",
      "poetry.lock",
      "Gemfile",
      "Gemfile.lock",
      "composer.json",
      "composer.lock",
      "pubspec.yaml",
      "pubspec.lock",
      "mix.exs",
      "mix.lock",
      "build.gradle",
      "build.gradle.kts",
      "pom.xml",
      "Package.swift",
      ".npmrc",
      ".nvmrc",
    ],
  },
  {
    specialist: "hatch3r-architect",
    mode: "conditional",
    triggerConditions: ["Architectural decisions needed", "New module or service introduced"],
  },
  {
    specialist: "hatch3r-devops",
    mode: "conditional",
    triggerConditions: ["CI/CD changes", "Infrastructure or deployment changes"],
  },
] as const;

// ── Project-type-aware specialist selection (Finding #56) ────────

/**
 * Language-specific specialist configurations.
 *
 * Maps detected project languages to additional specialist considerations
 * and dependency file patterns. Used by the orchestrator to make
 * project-type-aware specialist selections.
 */
export interface LanguageSpecialistConfig {
  language: string;
  /** Dependency files specific to this language ecosystem. */
  dependencyFiles: string[];
  /** Additional specialist hints for this language. */
  specialistHints: {
    specialist: string;
    hint: string;
  }[];
}

export const LANGUAGE_SPECIALIST_CONFIGS: readonly LanguageSpecialistConfig[] = [
  {
    language: "typescript",
    dependencyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Check for TypeScript strict mode violations and type errors" },
      { specialist: "hatch3r-test-writer", hint: "Use project test framework (vitest/jest); ensure type-safe test assertions" },
    ],
  },
  {
    language: "javascript",
    dependencyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use project test framework (vitest/jest/mocha)" },
    ],
  },
  {
    language: "python",
    dependencyFiles: ["requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock", "setup.py"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run ruff/flake8/mypy per project config" },
      { specialist: "hatch3r-test-writer", hint: "Use pytest; check for type annotations" },
      { specialist: "hatch3r-security-auditor", hint: "Check for pickle deserialization, SQL injection, SSTI" },
    ],
  },
  {
    language: "go",
    dependencyFiles: ["go.mod", "go.sum"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run golangci-lint; check for go vet warnings" },
      { specialist: "hatch3r-test-writer", hint: "Use standard testing package; check for table-driven tests" },
      { specialist: "hatch3r-security-auditor", hint: "Run govulncheck; check for unsafe pointer usage" },
    ],
  },
  {
    language: "rust",
    dependencyFiles: ["Cargo.toml", "Cargo.lock"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run clippy with project-configured lints" },
      { specialist: "hatch3r-security-auditor", hint: "Run cargo-audit; check for unsafe blocks" },
    ],
  },
  {
    language: "java",
    dependencyFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use JUnit 5; check for integration test coverage" },
      { specialist: "hatch3r-dependency-auditor", hint: "Check for OWASP dependency-check findings" },
    ],
  },
  {
    language: "ruby",
    dependencyFiles: ["Gemfile", "Gemfile.lock"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use RSpec or minitest per project convention" },
      { specialist: "hatch3r-security-auditor", hint: "Run bundler-audit; check for mass assignment" },
    ],
  },
  {
    language: "php",
    dependencyFiles: ["composer.json", "composer.lock"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use PHPUnit per project convention" },
      { specialist: "hatch3r-security-auditor", hint: "Check for SQL injection, XSS, deserialization" },
    ],
  },
  {
    language: "swift",
    dependencyFiles: ["Package.swift", "Package.resolved"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use XCTest; check for async test patterns" },
    ],
  },
  {
    language: "dart",
    dependencyFiles: ["pubspec.yaml", "pubspec.lock"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use flutter_test or test package" },
    ],
  },
  {
    language: "elixir",
    dependencyFiles: ["mix.exs", "mix.lock"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use ExUnit; check for doctest coverage" },
    ],
  },
  {
    language: "csharp",
    dependencyFiles: ["*.csproj", "*.sln", "Directory.Packages.props"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use xUnit/NUnit per project convention" },
      { specialist: "hatch3r-security-auditor", hint: "Check for SQL injection, CSRF, insecure deserialization" },
    ],
  },
  {
    language: "kotlin",
    dependencyFiles: ["build.gradle.kts", "build.gradle"],
    specialistHints: [
      { specialist: "hatch3r-test-writer", hint: "Use JUnit 5 or kotest per project convention" },
    ],
  },
] as const;

// ── Runtime Validation ───────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate that required PipelineContext fields are present for a given phase.
 *
 * Phase transitions require specific fields to be populated:
 * - Phase 1 -> 2: correlationId, taskType, deepContextTier, startedAt
 * - Phase 2 -> 3: researchFindings (unless research was skipped per skip criteria)
 * - Phase 3 -> 4: implementationResult, reviewResult
 * - Phase 4 -> completion: qualityResults
 */
export function validatePhaseTransition(
  context: Partial<PipelineContext>,
  targetPhase: 1 | 2 | 3 | 4 | "completion",
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Always required
  if (!context.correlationId || typeof context.correlationId !== "string") {
    errors.push({ field: "correlationId", message: "correlationId must be a non-empty string (UUID v4)" });
  }
  if (!context.taskType || !["bug", "feature", "refactor", "qa"].includes(context.taskType)) {
    errors.push({ field: "taskType", message: 'taskType must be one of: "bug", "feature", "refactor", "qa"' });
  }
  if (!context.deepContextTier || ![1, 2, 3].includes(context.deepContextTier)) {
    errors.push({ field: "deepContextTier", message: "deepContextTier must be 1, 2, or 3" });
  }
  if (!context.startedAt || typeof context.startedAt !== "string") {
    errors.push({ field: "startedAt", message: "startedAt must be an ISO-8601 timestamp string" });
  }

  // Phase-specific requirements
  if (targetPhase === 2 || targetPhase === 3 || targetPhase === 4 || targetPhase === "completion") {
    // Phase 2+ needs research findings (or explicit gap acknowledgment)
    if (!context.researchFindings && (!context.researchGaps || context.researchGaps.length === 0)) {
      errors.push({
        field: "researchFindings",
        message: "researchFindings must be populated before Phase 2 (or researchGaps must document why research was skipped)",
      });
    }
  }

  if (targetPhase === 3 || targetPhase === 4 || targetPhase === "completion") {
    if (!context.implementationResult) {
      errors.push({ field: "implementationResult", message: "implementationResult must be populated before Phase 3" });
    } else {
      if (!["SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "TIMEOUT"].includes(context.implementationResult.status)) {
        errors.push({ field: "implementationResult.status", message: "implementationResult.status must be a valid AgentStatus" });
      }
    }
  }

  if (targetPhase === 4 || targetPhase === "completion") {
    if (!context.reviewResult) {
      errors.push({ field: "reviewResult", message: "reviewResult must be populated before Phase 4" });
    } else {
      if (typeof context.reviewResult.iterations !== "number" || context.reviewResult.iterations < 1) {
        errors.push({ field: "reviewResult.iterations", message: "reviewResult.iterations must be a positive number" });
      }
      if (!["CLEAN", "UNRESOLVED"].includes(context.reviewResult.finalVerdict)) {
        errors.push({ field: "reviewResult.finalVerdict", message: 'reviewResult.finalVerdict must be "CLEAN" or "UNRESOLVED"' });
      }
    }
  }

  if (targetPhase === "completion") {
    if (!context.qualityResults) {
      errors.push({ field: "qualityResults", message: "qualityResults must be populated at completion" });
    } else {
      if (!Array.isArray(context.qualityResults.specialists)) {
        errors.push({ field: "qualityResults.specialists", message: "qualityResults.specialists must be an array" });
      }
      if (!context.qualityResults.validationPass) {
        errors.push({ field: "qualityResults.validationPass", message: "qualityResults.validationPass must be populated" });
      }
    }
  }

  return errors;
}

/**
 * Check whether a specialist should be triggered based on changed files
 * and project type context.
 *
 * Finding #55: dependency-auditor triggers on dependency file changes.
 * Finding #56: project-type-aware specialist selection.
 */
export function shouldTriggerSpecialist(
  specialist: string,
  changedFiles: string[],
  projectType?: ProjectTypeContext,
): { triggered: boolean; reasons: string[] } {
  const trigger = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === specialist);
  if (!trigger) {
    return { triggered: false, reasons: [`Unknown specialist: ${specialist}`] };
  }

  // "always" mode specialists are always triggered for code changes
  if (trigger.mode === "always" && changedFiles.length > 0) {
    return { triggered: true, reasons: trigger.triggerConditions };
  }

  const reasons: string[] = [];

  // Check file pattern triggers (e.g., dependency-auditor)
  if (trigger.triggerFilePatterns) {
    const matchedFiles = changedFiles.filter((file) => {
      const basename = file.split("/").pop() ?? file;
      return trigger.triggerFilePatterns!.some((pattern) => {
        if (pattern.startsWith("*")) {
          return basename.endsWith(pattern.slice(1));
        }
        return basename === pattern;
      });
    });
    if (matchedFiles.length > 0) {
      reasons.push(`Dependency files modified: ${matchedFiles.join(", ")}`);
    }
  }

  // Project-type-aware trigger enhancement (Finding #56)
  if (projectType && trigger.specialist === "hatch3r-dependency-auditor") {
    const langConfigs = LANGUAGE_SPECIALIST_CONFIGS.filter((lc) =>
      projectType.languages.includes(lc.language),
    );
    for (const lc of langConfigs) {
      const langMatches = changedFiles.filter((file) => {
        const basename = file.split("/").pop() ?? file;
        return lc.dependencyFiles.some((pattern) => {
          if (pattern.startsWith("*")) {
            return basename.endsWith(pattern.slice(1));
          }
          return basename === pattern;
        });
      });
      if (langMatches.length > 0) {
        reasons.push(`${lc.language} dependency files modified: ${langMatches.join(", ")}`);
      }
    }
  }

  return { triggered: reasons.length > 0, reasons };
}

/**
 * Get language-specific specialist hints for the detected project type.
 *
 * Finding #56: project-type-aware specialist selection.
 * Returns hints that should be included in specialist prompts.
 */
export function getSpecialistHints(
  specialist: string,
  projectType: ProjectTypeContext,
): string[] {
  const hints: string[] = [];

  for (const lang of projectType.languages) {
    const config = LANGUAGE_SPECIALIST_CONFIGS.find((lc) => lc.language === lang);
    if (!config) continue;

    for (const hint of config.specialistHints) {
      if (hint.specialist === specialist) {
        hints.push(`[${lang}] ${hint.hint}`);
      }
    }
  }

  return hints;
}
