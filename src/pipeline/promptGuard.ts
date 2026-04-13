/**
 * ASI01 prompt injection mitigations for the pipeline.
 *
 * Implements three of four ASI01 guidelines:
 * 1. Input sanitization -- strip dangerous patterns from user/agent input
 * 2. Output validation -- verify agent output doesn't contain injection attempts
 * 3. Boundary markers -- wrap trusted content with verifiable delimiters
 *
 * Finding #78 (D15, High): Align pipeline with ASI01 prompt injection mitigations.
 */

import { createHash } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────

/** Maximum length for pipeline phase input in characters. */
export const MAX_PHASE_INPUT_LENGTH = 500_000;

/** Maximum length for agent output in characters. */
export const MAX_AGENT_OUTPUT_LENGTH = 1_000_000;

// ── Boundary Markers ─────────────────────────────────────────────

/**
 * Generate a unique boundary marker pair for a pipeline phase.
 *
 * The boundary marker includes a hash of the phase name and a nonce
 * to make it unguessable by injected content. Agents should only
 * trust content within these markers.
 */
export function generateBoundaryMarkers(
  phaseName: string,
  nonce?: string,
): { start: string; end: string; nonce: string } {
  const boundaryNonce =
    nonce ?? createHash("sha256").update(Date.now().toString() + Math.random().toString()).digest("hex").substring(0, 16);
  const phaseHash = createHash("sha256")
    .update(`${phaseName}:${boundaryNonce}`)
    .digest("hex")
    .substring(0, 12);

  return {
    start: `<!-- HATCH3R-PHASE:${phaseName}:BEGIN:${phaseHash} -->`,
    end: `<!-- HATCH3R-PHASE:${phaseName}:END:${phaseHash} -->`,
    nonce: boundaryNonce,
  };
}

/**
 * Wrap content with boundary markers for a specific pipeline phase.
 */
export function wrapWithBoundary(
  content: string,
  phaseName: string,
  nonce?: string,
): { wrapped: string; markers: ReturnType<typeof generateBoundaryMarkers> } {
  const markers = generateBoundaryMarkers(phaseName, nonce);
  const wrapped = `${markers.start}\n${content}\n${markers.end}`;
  return { wrapped, markers };
}

/**
 * Extract content from within boundary markers.
 *
 * Returns null if the markers are missing, malformed, or the hash doesn't
 * match (indicating potential tampering).
 */
export function extractBoundedContent(
  content: string,
  phaseName: string,
  nonce: string,
): string | null {
  const expectedMarkers = generateBoundaryMarkers(phaseName, nonce);

  const startIdx = content.indexOf(expectedMarkers.start);
  const endIdx = content.indexOf(expectedMarkers.end);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null;
  }

  return content
    .substring(startIdx + expectedMarkers.start.length, endIdx)
    .trim();
}

// ── Input Sanitization ───────────────────────────────────────────

/**
 * Patterns that indicate prompt injection attempts in pipeline input.
 * More aggressive than the general denied patterns -- these are specific
 * to inter-agent communication.
 */
const INJECTION_PATTERNS: { pattern: RegExp; description: string }[] = [
  {
    pattern: /(?:^|\n)\s*(?:system|assistant|user)\s*:\s*$/im,
    description: "role injection (system/assistant/user colon)",
  },
  {
    pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i,
    description: "chat template injection tokens",
  },
  {
    pattern: /<%[-=]?\s|%>|\{\{.*\}\}/,
    description: "template literal injection (ERB/Handlebars)",
  },
  {
    pattern: /<!--\s*(?:SYSTEM|ADMIN|ROOT)\s*-->/i,
    description: "HTML comment role escalation",
  },
  {
    pattern: /\x00|\x1b\[/,
    description: "null byte or ANSI escape sequence injection",
  },
  // D15 Medium: MCP-specific injection patterns (#358-#385)
  {
    pattern: /(?:tool_call|function_call)\s*\(/i,
    description: "tool/function call injection attempt",
  },
  {
    pattern: /<\|(?:tool|function|plugin)\|>/i,
    description: "tool delimiter injection token",
  },
];

export interface SanitizationResult {
  sanitized: string;
  violations: string[];
  truncated: boolean;
}

/**
 * Sanitize pipeline phase input.
 *
 * Strips dangerous patterns and enforces size limits on content
 * flowing between pipeline phases.
 */
export function sanitizePipelineInput(
  input: string,
  maxLength: number = MAX_PHASE_INPUT_LENGTH,
): SanitizationResult {
  const violations: string[] = [];
  let sanitized = input;
  let truncated = false;

  // Length enforcement
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    truncated = true;
    violations.push(
      `Input truncated from ${input.length} to ${maxLength} characters`,
    );
  }

  // Strip null bytes
  if (sanitized.includes("\0")) {
    sanitized = sanitized.replace(/\0/g, "");
    violations.push("Null bytes stripped from input");
  }

  // Check for injection patterns
  for (const { pattern, description } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      violations.push(`Injection pattern detected: ${description}`);
      // Replace the matched pattern with a safe marker
      sanitized = sanitized.replace(
        new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"),
        "[SANITIZED]",
      );
    }
  }

  return { sanitized, violations, truncated };
}

// ── Output Validation ────────────────────────────────────────────

export interface OutputValidationResult {
  valid: boolean;
  violations: string[];
  truncated: boolean;
}

/**
 * Validate agent output before passing to the next pipeline phase.
 *
 * Checks for injection attempts in agent responses and enforces size
 * limits. Unlike sanitization, validation does not modify the content --
 * it only reports issues so the orchestrator can decide how to proceed.
 */
export function validateAgentOutput(
  output: string,
  maxLength: number = MAX_AGENT_OUTPUT_LENGTH,
): OutputValidationResult {
  const violations: string[] = [];
  let truncated = false;

  // Length check
  if (output.length > maxLength) {
    truncated = true;
    violations.push(
      `Output exceeds maximum length (${output.length} > ${maxLength} characters)`,
    );
  }

  // Check for injection patterns in output
  for (const { pattern, description } of INJECTION_PATTERNS) {
    if (pattern.test(output)) {
      violations.push(`Injection pattern in output: ${description}`);
    }
  }

  // Check for boundary marker forgery attempts
  if (/<!-- HATCH3R-PHASE:[^:]+:(?:BEGIN|END):[a-f0-9]+ -->/.test(output)) {
    violations.push(
      "Output contains forged HATCH3R-PHASE boundary markers",
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    truncated,
  };
}

// ── Phase handoff ────────────────────────────────────────────────

export interface PhaseHandoff {
  /** Source phase name. */
  from: string;
  /** Target phase name. */
  to: string;
  /** Sanitized content. */
  content: string;
  /** Boundary markers used for content wrapping. */
  markers: ReturnType<typeof generateBoundaryMarkers>;
  /** Violations found during sanitization. */
  inputViolations: string[];
  /** Whether the input was truncated. */
  truncated: boolean;
  /** D12 Medium: ISO-8601 timestamp of the handoff for timing diagnostics (#315-#330). */
  timestamp: string;
  /** D12 Medium: Correlation ID for tracing handoffs across phases (#315-#330). */
  correlationId?: string;
}

/**
 * Create a sanitized phase handoff with boundary markers.
 *
 * This is the primary API for passing content between pipeline phases.
 * It sanitizes the input, wraps it with boundary markers, and returns
 * the complete handoff payload.
 */
export function createPhaseHandoff(
  from: string,
  to: string,
  content: string,
  maxLength?: number,
  correlationId?: string,
): PhaseHandoff {
  const { sanitized, violations, truncated } = sanitizePipelineInput(
    content,
    maxLength,
  );
  const { markers } = wrapWithBoundary(sanitized, to);

  return {
    from,
    to,
    content: sanitized,
    markers,
    inputViolations: violations,
    truncated,
    timestamp: new Date().toISOString(),
    correlationId,
  };
}
