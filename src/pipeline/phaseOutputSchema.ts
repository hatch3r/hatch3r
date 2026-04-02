/**
 * ASI07 output schema validation at phase boundaries.
 *
 * Before output flows from one pipeline phase to the next, it is validated
 * against the expected schema for that phase. This prevents malformed or
 * incomplete data from propagating through the pipeline, which could cause
 * downstream agents to behave unpredictably.
 *
 * Uses PipelineContext field shapes as the source of truth.
 *
 * Finding #81 (D15, High): Add output schema validation at phase boundaries (ASI07).
 */

import type {
  ResearchFindings,
  ImplementationResult,
  ReviewResult,
  QualityResults,
} from "./pipelineContext.js";

// ── Types ────────────────────────────────────────────────────────

export type PipelinePhase = "research" | "implementation" | "review" | "quality";

export interface SchemaViolation {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface SchemaValidationResult {
  valid: boolean;
  phase: PipelinePhase;
  violations: SchemaViolation[];
}

// ── Validators ───────────────────────────────────────────────────

/**
 * Validate research phase output schema.
 */
export function validateResearchOutput(
  output: unknown,
): SchemaValidationResult {
  const violations: SchemaViolation[] = [];

  if (!output || typeof output !== "object") {
    violations.push({
      field: "researchFindings",
      message: "Research output must be a non-null object",
      severity: "error",
    });
    return { valid: false, phase: "research", violations };
  }

  const data = output as Record<string, unknown>;

  // Required fields
  if (!Array.isArray(data.modes)) {
    violations.push({
      field: "modes",
      message: "researchFindings.modes must be an array of strings",
      severity: "error",
    });
  }

  if (!Array.isArray(data.affectedFiles)) {
    violations.push({
      field: "affectedFiles",
      message: "researchFindings.affectedFiles must be an array of strings",
      severity: "error",
    });
  }

  if (!Array.isArray(data.blastRadius)) {
    violations.push({
      field: "blastRadius",
      message: "researchFindings.blastRadius must be an array of strings",
      severity: "error",
    });
  }

  if (!Array.isArray(data.existingTests)) {
    violations.push({
      field: "existingTests",
      message: "researchFindings.existingTests must be an array of strings",
      severity: "error",
    });
  }

  if (!Array.isArray(data.dependencies)) {
    violations.push({
      field: "dependencies",
      message: "researchFindings.dependencies must be an array of strings",
      severity: "error",
    });
  }

  // Optional but typed fields
  if ("conventions" in data && data.conventions !== null && typeof data.conventions !== "object") {
    violations.push({
      field: "conventions",
      message: "researchFindings.conventions must be an object or null",
      severity: "warning",
    });
  }

  if ("resolvedRequirements" in data && data.resolvedRequirements !== null && typeof data.resolvedRequirements !== "object") {
    violations.push({
      field: "resolvedRequirements",
      message: "researchFindings.resolvedRequirements must be an object or null",
      severity: "warning",
    });
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    phase: "research",
    violations,
  };
}

/**
 * Validate implementation phase output schema.
 */
export function validateImplementationOutput(
  output: unknown,
): SchemaValidationResult {
  const violations: SchemaViolation[] = [];

  if (!output || typeof output !== "object") {
    violations.push({
      field: "implementationResult",
      message: "Implementation output must be a non-null object",
      severity: "error",
    });
    return { valid: false, phase: "implementation", violations };
  }

  const data = output as Record<string, unknown>;
  const VALID_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "TIMEOUT"];

  if (!Array.isArray(data.filesChanged)) {
    violations.push({
      field: "filesChanged",
      message: "implementationResult.filesChanged must be an array of strings",
      severity: "error",
    });
  }

  if (!Array.isArray(data.testsWritten)) {
    violations.push({
      field: "testsWritten",
      message: "implementationResult.testsWritten must be an array of strings",
      severity: "error",
    });
  }

  if (typeof data.status !== "string" || !VALID_STATUSES.includes(data.status)) {
    violations.push({
      field: "status",
      message: `implementationResult.status must be one of: ${VALID_STATUSES.join(", ")}`,
      severity: "error",
    });
  }

  if ("reason" in data && data.reason !== null && typeof data.reason !== "string") {
    violations.push({
      field: "reason",
      message: "implementationResult.reason must be a string or null",
      severity: "warning",
    });
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    phase: "implementation",
    violations,
  };
}

/**
 * Validate review phase output schema.
 */
export function validateReviewOutput(
  output: unknown,
): SchemaValidationResult {
  const violations: SchemaViolation[] = [];

  if (!output || typeof output !== "object") {
    violations.push({
      field: "reviewResult",
      message: "Review output must be a non-null object",
      severity: "error",
    });
    return { valid: false, phase: "review", violations };
  }

  const data = output as Record<string, unknown>;

  if (typeof data.iterations !== "number" || data.iterations < 1) {
    violations.push({
      field: "iterations",
      message: "reviewResult.iterations must be a positive number",
      severity: "error",
    });
  }

  if (typeof data.finalVerdict !== "string" || !["CLEAN", "UNRESOLVED"].includes(data.finalVerdict)) {
    violations.push({
      field: "finalVerdict",
      message: 'reviewResult.finalVerdict must be "CLEAN" or "UNRESOLVED"',
      severity: "error",
    });
  }

  if (!Array.isArray(data.findings)) {
    violations.push({
      field: "findings",
      message: "reviewResult.findings must be an array",
      severity: "error",
    });
  } else {
    for (let i = 0; i < (data.findings as unknown[]).length; i++) {
      const finding = (data.findings as unknown[])[i];
      if (!finding || typeof finding !== "object") {
        violations.push({
          field: `findings[${i}]`,
          message: "Each finding must be an object",
          severity: "error",
        });
        continue;
      }
      const f = finding as Record<string, unknown>;
      const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
      if (typeof f.severity !== "string" || !VALID_SEVERITIES.includes(f.severity)) {
        violations.push({
          field: `findings[${i}].severity`,
          message: `Finding severity must be one of: ${VALID_SEVERITIES.join(", ")}`,
          severity: "error",
        });
      }
      if (typeof f.description !== "string") {
        violations.push({
          field: `findings[${i}].description`,
          message: "Finding description must be a string",
          severity: "error",
        });
      }
    }
  }

  if (typeof data.confirmationPassResult !== "string" || !["PASS", "FAIL"].includes(data.confirmationPassResult)) {
    violations.push({
      field: "confirmationPassResult",
      message: 'reviewResult.confirmationPassResult must be "PASS" or "FAIL"',
      severity: "error",
    });
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    phase: "review",
    violations,
  };
}

/**
 * Validate quality phase output schema.
 */
export function validateQualityOutput(
  output: unknown,
): SchemaValidationResult {
  const violations: SchemaViolation[] = [];

  if (!output || typeof output !== "object") {
    violations.push({
      field: "qualityResults",
      message: "Quality output must be a non-null object",
      severity: "error",
    });
    return { valid: false, phase: "quality", violations };
  }

  const data = output as Record<string, unknown>;

  if (!Array.isArray(data.specialists)) {
    violations.push({
      field: "specialists",
      message: "qualityResults.specialists must be an array",
      severity: "error",
    });
  } else {
    for (let i = 0; i < (data.specialists as unknown[]).length; i++) {
      const spec = (data.specialists as unknown[])[i];
      if (!spec || typeof spec !== "object") {
        violations.push({
          field: `specialists[${i}]`,
          message: "Each specialist result must be an object",
          severity: "error",
        });
        continue;
      }
      const s = spec as Record<string, unknown>;
      if (typeof s.specialist !== "string") {
        violations.push({
          field: `specialists[${i}].specialist`,
          message: "Specialist name must be a string",
          severity: "error",
        });
      }
      const VALID_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "TIMEOUT"];
      if (typeof s.status !== "string" || !VALID_STATUSES.includes(s.status)) {
        violations.push({
          field: `specialists[${i}].status`,
          message: `Specialist status must be one of: ${VALID_STATUSES.join(", ")}`,
          severity: "error",
        });
      }
    }
  }

  if (!data.validationPass || typeof data.validationPass !== "object") {
    violations.push({
      field: "validationPass",
      message: "qualityResults.validationPass must be an object",
      severity: "error",
    });
  } else {
    const vp = data.validationPass as Record<string, unknown>;
    if (typeof vp.testsPass !== "boolean") {
      violations.push({
        field: "validationPass.testsPass",
        message: "validationPass.testsPass must be a boolean",
        severity: "error",
      });
    }
    if (typeof vp.typecheckPass !== "boolean") {
      violations.push({
        field: "validationPass.typecheckPass",
        message: "validationPass.typecheckPass must be a boolean",
        severity: "error",
      });
    }
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    phase: "quality",
    violations,
  };
}

// ── Dispatcher ───────────────────────────────────────────────────

/**
 * Validate a pipeline phase output against its expected schema.
 *
 * This is the primary API for phase boundary validation. The orchestrator
 * calls this after each phase completes, before passing output to the
 * next phase.
 */
export function validatePhaseOutput(
  phase: PipelinePhase,
  output: unknown,
): SchemaValidationResult {
  switch (phase) {
    case "research":
      return validateResearchOutput(output);
    case "implementation":
      return validateImplementationOutput(output);
    case "review":
      return validateReviewOutput(output);
    case "quality":
      return validateQualityOutput(output);
  }
}

/**
 * Format schema validation results for human consumption.
 */
export function formatSchemaViolations(result: SchemaValidationResult): string {
  if (result.valid && result.violations.length === 0) {
    return `Phase "${result.phase}" output: schema valid`;
  }

  const lines: string[] = [
    `Phase "${result.phase}" output schema ${result.valid ? "valid (with warnings)" : "INVALID"}:`,
  ];

  for (const v of result.violations) {
    const prefix = v.severity === "error" ? "ERROR" : "WARN";
    lines.push(`  [${prefix}] ${v.field}: ${v.message}`);
  }

  return lines.join("\n");
}
