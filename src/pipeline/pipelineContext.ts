/**
 * PipelineContext type definitions and runtime validation.
 *
 * The PipelineContext is the structured handoff object passed between pipeline
 * phases. Each phase reads its inputs and writes its outputs to this context.
 * Runtime validation ensures that required fields are present and correctly
 * typed when context is passed between phases.
 *
 * Finding #54 (D7, High): Add TypeScript PipelineContext type with runtime validation.
 *
 * @library_export_only — canonical handoff schema for the hatch3r agent pipeline
 * (consumed by hatch3r-* agents and downstream pack integrators); the CLI itself
 * never instantiates a PipelineContext because runtime execution happens inside
 * Claude Code / the host coding tool, not inside the CLI process.
 */

// ── Types ────────────────────────────────────────────────────────

export type TaskType = "bug" | "feature" | "refactor" | "qa";
export type DeepContextTier = 1 | 2 | 3;
/**
 * AgentStatus — terminal status produced by any agent in the pipeline.
 *
 * - SUCCESS: work completed against the acceptance criteria.
 * - PARTIAL: work completed partially; `reason` explains what remains.
 * - FAILED: work did not complete due to an error or fault; `reason` explains.
 * - SKIPPED: work was skipped per documented skip criteria; `reason` cites the criterion.
 * - TIMEOUT: work exceeded the allotted phase timeout.
 * - BLOCKED_PREMISE_CHALLENGE: the agent determined the task premise is misconceived
 *   (e.g., requested feature already exists, conflicts with an architectural invariant,
 *   or requirements are internally contradictory) and the pipeline should halt pending
 *   user clarification. Surfaces quality-charter §3 ("Question Unclear Requirements")
 *   as a machine-actionable signal. `reason` must contain the premise concern and at
 *   least one alternative approach. See Finding D7-SA7.1-2 / C7.5-W2B2-H24.
 */
export type AgentStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED"
  | "TIMEOUT"
  | "BLOCKED_PREMISE_CHALLENGE";

/**
 * The canonical list of all AgentStatus values. Consumers that validate status
 * strings at runtime must import this constant rather than duplicating the
 * list, so adding a new variant updates every consumer in lock-step.
 */
export const AGENT_STATUS_VALUES: readonly AgentStatus[] = [
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "SKIPPED",
  "TIMEOUT",
  "BLOCKED_PREMISE_CHALLENGE",
] as const;

/**
 * True when the status indicates the pipeline should halt and surface to the
 * user rather than proceed to the next phase. Currently only
 * BLOCKED_PREMISE_CHALLENGE triggers halt semantics; other non-success states
 * (FAILED/TIMEOUT) are handled by retry/circuit-breaker logic, not halt.
 */
export function isHaltStatus(status: AgentStatus): boolean {
  return status === "BLOCKED_PREMISE_CHALLENGE";
}

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
  /**
   * C8-D13-M1: Reviewer self-reported confidence (optional, backward-compatible).
   * Consumed by evaluateReviewGate in reviewLoop.ts.
   */
  confidence?: "high" | "medium" | "low";
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
      "testability and security specialists are always required for code changes regardless of command",
      "Quality checks must pass before completion",
    ],
  },
] as const;

// ── Specialist Trigger Table (Finding #55) ───────────────────────

/**
 * Phase 4 specialist trigger conditions.
 *
 * Defines when each specialist should be triggered based on the changes
 * made during implementation. The CQ3 security specialist owns dependency
 * file modifications (absorbing the legacy dependency-auditor scope per
 * F16.3-H1, Cycle 10 Wave 1C).
 */
export interface SpecialistTrigger {
  specialist: string;
  /** When to trigger: "always", "evaluate", or "conditional". */
  mode: "always" | "evaluate" | "conditional";
  /** File patterns or conditions that trigger this specialist. */
  triggerConditions: string[];
  /** Dependency file patterns (e.g., for CQ3 security specialist's supply-chain checks). */
  triggerFilePatterns?: string[];
}

export const SPECIALIST_TRIGGER_TABLE: readonly SpecialistTrigger[] = [
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
    specialist: "hatch3r-architect",
    mode: "conditional",
    triggerConditions: ["Architectural decisions needed", "New module or service introduced"],
  },
  {
    specialist: "hatch3r-devops",
    mode: "conditional",
    triggerConditions: ["CI/CD changes", "Infrastructure or deployment changes"],
  },
  // ── CQ1–CQ9 quality-vector specialists (Finding F7.3-C1 / KDD #22) ──
  // One per CONSTITUTION §2B content-quality pillar. Each specialist enforces
  // measurable floors on end-user generated code via Phase 4 dispatch.
  // F16.3-H1 (Cycle 10 Wave 1C): the 5 legacy meta-agents (test-writer,
  // security-auditor, a11y-auditor, perf-profiler, dependency-auditor) were
  // retired into their CQ successors (testability/security/ui/performance/
  // security respectively). The CQ specialists below now carry the always-mode
  // floor that test-writer + security-auditor previously enforced.
  {
    specialist: "hatch3r-ui",
    mode: "conditional",
    triggerConditions: [
      "UI component files modified",
      "Design-token or theme files modified",
      "Component-library imports changed",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
      "tailwind.config.js",
      "tailwind.config.ts",
      "theme.ts",
    ],
  },
  {
    specialist: "hatch3r-ux",
    mode: "conditional",
    triggerConditions: [
      "Flow / route-transition / modal / error-state files modified",
      "Microcopy or i18n strings modified",
      "Async-view wrappers modified",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
    ],
  },
  {
    specialist: "hatch3r-security",
    mode: "always",
    triggerConditions: [
      "Any code change (always-mode floor — absorbs legacy security-auditor scope)",
      "Auth / JWT / OAuth / WebAuthn code modified",
      "Release workflow modified",
      "Cookie / session handling modified",
      "Dependency files modified (absorbs legacy dependency-auditor scope)",
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
    specialist: "hatch3r-reliability",
    mode: "conditional",
    triggerConditions: [
      "Service handler / request handler modified",
      "OpenTelemetry / SLO / observability config modified",
      "Retry / circuit-breaker / error-format code modified",
      "Kubernetes probe / health-check manifests modified",
    ],
  },
  {
    specialist: "hatch3r-testability",
    mode: "always",
    triggerConditions: [
      "Any code change (always-mode floor — absorbs legacy test-writer scope)",
      "Test code added, modified, or removed",
      "Mandate-map feature class introduced (parser / payment / RPC / AI eval)",
      "Coverage threshold or test-runner config modified",
    ],
  },
  {
    specialist: "hatch3r-scalability",
    mode: "conditional",
    triggerConditions: [
      "Request handler / route definition modified",
      "Queue client / connection-pool config modified",
      "Session storage / cache layer modified",
      "Background-job / horizontally-scaled tier code modified",
    ],
  },
  {
    specialist: "hatch3r-performance",
    mode: "conditional",
    triggerConditions: [
      "ORM query / data-access layer modified",
      "UI-rendering component modified",
      "Bundle config or vendor dependency >50KB introduced",
      "Hot-path code modified",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
    ],
  },
  {
    specialist: "hatch3r-maintainability",
    mode: "conditional",
    triggerConditions: [
      "Any code mutation (duplication-index + complexity scan)",
      "Schema or migration file modified",
      "API spec (OpenAPI / GraphQL SDL / Protobuf) modified",
    ],
    triggerFilePatterns: [
      "*.proto",
      "openapi.yaml",
      "openapi.json",
      "schema.graphql",
    ],
  },
  {
    specialist: "hatch3r-enhancability",
    mode: "conditional",
    triggerConditions: [
      "User-visible behavior modified",
      "Public API surface modified (OpenAPI / GraphQL SDL / AsyncAPI)",
      "Config schema or feature-flag definition modified",
      "Extension-point interface modified",
    ],
    triggerFilePatterns: [
      "*.proto",
      "openapi.yaml",
      "openapi.json",
      "schema.graphql",
      "asyncapi.yaml",
    ],
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
      { specialist: "hatch3r-testability", hint: "Use project test framework (vitest/jest); ensure type-safe test assertions" },
    ],
  },
  {
    language: "javascript",
    dependencyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use project test framework (vitest/jest/mocha)" },
    ],
  },
  {
    language: "python",
    dependencyFiles: ["requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock", "setup.py"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run ruff/flake8/mypy per project config" },
      { specialist: "hatch3r-testability", hint: "Use pytest; check for type annotations" },
      { specialist: "hatch3r-security", hint: "Check for pickle deserialization, SQL injection, SSTI" },
    ],
  },
  {
    language: "go",
    dependencyFiles: ["go.mod", "go.sum"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run golangci-lint; check for go vet warnings" },
      { specialist: "hatch3r-testability", hint: "Use standard testing package; check for table-driven tests" },
      { specialist: "hatch3r-security", hint: "Run govulncheck; check for unsafe pointer usage" },
    ],
  },
  {
    language: "rust",
    dependencyFiles: ["Cargo.toml", "Cargo.lock"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run clippy with project-configured lints" },
      { specialist: "hatch3r-security", hint: "Run cargo-audit; check for unsafe blocks" },
    ],
  },
  {
    language: "java",
    dependencyFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use JUnit 5; check for integration test coverage" },
      { specialist: "hatch3r-security", hint: "Check for OWASP dependency-check findings" },
    ],
  },
  {
    language: "ruby",
    dependencyFiles: ["Gemfile", "Gemfile.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use RSpec or minitest per project convention" },
      { specialist: "hatch3r-security", hint: "Run bundler-audit; check for mass assignment" },
    ],
  },
  {
    language: "php",
    dependencyFiles: ["composer.json", "composer.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use PHPUnit per project convention" },
      { specialist: "hatch3r-security", hint: "Check for SQL injection, XSS, deserialization" },
    ],
  },
  {
    language: "swift",
    dependencyFiles: ["Package.swift", "Package.resolved"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use XCTest; check for async test patterns" },
    ],
  },
  {
    language: "dart",
    dependencyFiles: ["pubspec.yaml", "pubspec.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use flutter_test or test package" },
    ],
  },
  {
    language: "elixir",
    dependencyFiles: ["mix.exs", "mix.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use ExUnit; check for doctest coverage" },
    ],
  },
  {
    language: "csharp",
    dependencyFiles: ["*.csproj", "*.sln", "Directory.Packages.props"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use xUnit/NUnit per project convention" },
      { specialist: "hatch3r-security", hint: "Check for SQL injection, CSRF, insecure deserialization" },
    ],
  },
  {
    language: "kotlin",
    dependencyFiles: ["build.gradle.kts", "build.gradle"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use JUnit 5 or kotest per project convention" },
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
      if (!AGENT_STATUS_VALUES.includes(context.implementationResult.status)) {
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

  // "always" mode specialists are always triggered for code changes.
  // F16.3-H1 (Cycle 10 Wave 1C): when an always-mode specialist also carries
  // triggerFilePatterns (e.g., hatch3r-security absorbed the legacy
  // dependency-auditor file-pattern scope), continue past the early-return so
  // the file-pattern + language-aware reasoning still annotates the result.
  if (trigger.mode === "always" && changedFiles.length > 0 && !trigger.triggerFilePatterns) {
    return { triggered: true, reasons: trigger.triggerConditions };
  }

  const reasons: string[] = [];
  // Always-mode specialists with file patterns: prepend the always-mode floor
  // reason so the conditional-pattern reasons add specificity on top.
  if (trigger.mode === "always" && changedFiles.length > 0) {
    reasons.push(...trigger.triggerConditions);
  }

  // Check file pattern triggers (e.g., dependency-auditor, CQ specialists)
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
      const label =
        trigger.specialist === "hatch3r-security"
          ? "Dependency files modified"
          : "Trigger files modified";
      reasons.push(`${label}: ${matchedFiles.join(", ")}`);
    }
  }

  // Project-type-aware trigger enhancement (Finding #56)
  // F16.3-H1 (Cycle 10 Wave 1C): hatch3r-security absorbed the legacy
  // dependency-auditor scope including language-aware dependency-file checks.
  if (projectType && trigger.specialist === "hatch3r-security") {
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
