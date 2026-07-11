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
 *
 * Canonical catalog: `agents/shared/injection-patterns.md` Section A.
 * Each entry's `patternId` matches a row in the catalog. The sync test at
 * `src/__tests__/pipeline/injectionPatternsSync.test.ts` asserts every ID
 * here appears in the catalog, preventing silent drift. The catalog may
 * contain rows ahead of the code during multi-sub-agent waves; those must
 * be resolved before the wave closes.
 */
const INJECTION_PATTERNS: { patternId: string; pattern: RegExp; description: string }[] = [
  {
    patternId: "P-PIPE-01",
    pattern: /(?:^|\n)\s*(?:system|assistant|user)\s*:\s*$/im,
    description: "role injection (system/assistant/user colon)",
  },
  {
    patternId: "P-PIPE-02",
    pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i,
    description: "chat template injection tokens",
  },
  {
    patternId: "P-PIPE-03",
    // D1-SA1.9-01 (D1, P6): the interior was `.*` (greedy, unbounded), which
    // backtracks super-linearly (~O(n^2)) on a long run of `{` with no closing
    // `}}` — ~98s on the 250 KB MAX_USER_CONTENT_LENGTH cap, turning the ASI06
    // user-content sanitizer into an availability sink. `[^{}]*` bounds the
    // interior to non-brace characters, so the scan stops at the first `{`/`}`
    // with no backtracking (linear time) while still matching ERB/Handlebars
    // `{{...}}` spans. Sources: OWASP ReDoS (owasp.org/www-community/attacks/
    // Regular_expression_Denial_of_Service_-_ReDoS), arxiv:2406.11618
    // (accessed 2026-07-09).
    pattern: /<%[-=]?\s|%>|\{\{[^{}]*\}\}/,
    description: "template literal injection (ERB/Handlebars)",
  },
  {
    patternId: "P-PIPE-04",
    pattern: /<!--\s*(?:SYSTEM|ADMIN|ROOT)\s*-->/i,
    description: "HTML comment role escalation",
  },
  {
    patternId: "P-PIPE-05",
    pattern: /\x00|\x1b\[/,
    description: "null byte or ANSI escape sequence injection",
  },
  // D15 Medium: MCP-specific injection patterns (#358-#385)
  {
    patternId: "P-PIPE-06",
    pattern: /(?:tool_call|function_call)\s*\(/i,
    description: "tool/function call injection attempt",
  },
  {
    patternId: "P-PIPE-07",
    pattern: /<\|(?:tool|function|plugin)\|>/i,
    description: "tool delimiter injection token",
  },
  // C8-D15-M1 (Cycle 8 Wave 3): 2026-disclosed injection variants.
  // Sources: OWASP LLM01:2025 (accessed 2026-04-19); AWS "Defending LLM
  // applications against Unicode character smuggling" (aws.amazon.com/
  // blogs/security/); Microsoft MSRC "How Microsoft defends against indirect
  // prompt injection attacks" (2025-07); Meta-llama/llama issue #1382
  // (homoglyph filter bypass). See governance/audit/finding-registry.json
  // entry C8-D15-M1-deny-pattern-2026-variants for causal chain.
  {
    patternId: "P-PIPE-08",
    // Unicode Tag block U+E0000-U+E007F (invisible). Any occurrence of a
    // tag codepoint in pipeline content is treated as smuggling -- there is
    // no legitimate use of this block in inter-agent text, per AWS guidance
    // and the HackerOne "Invisible Prompt Injection" disclosure (#2372363).
    // Uses explicit surrogate pair range rather than the `u` flag to stay
    // consistent with the existing non-unicode regex conventions in this
    // file and to avoid changing match semantics for other patterns.
    pattern: /[\uDB40][\uDC00-\uDC7F]/,
    description: "Unicode tag character smuggling (U+E0000-U+E007F invisible payload)",
  },
  {
    patternId: "P-PIPE-09",
    // Base64-encoded injection overrides. LLMs decode base64 during
    // pretraining but safety alignment rarely covers encoded payloads
    // (Promptfoo base64 strategy; arxiv:2504.07467 "Mixture of Encodings").
    // We match base64 encodings of the canonical override phrases rather
    // than any base64 string (which would be far too broad): "Ignore all
    // previous instructions", "Ignore previous instructions", "Disregard
    // previous instructions", "System prompt:", "You are now". Encodings
    // cover upper- and lower-case seeds.
    pattern: /(?:SWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnM|aWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnM|SWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw|aWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw|RGlzcmVnYXJkIHByZXZpb3VzIGluc3RydWN0aW9ucw|ZGlzcmVnYXJkIHByZXZpb3VzIGluc3RydWN0aW9ucw|U3lzdGVtIHByb21wdDo|c3lzdGVtIHByb21wdDo|WW91IGFyZSBub3c|eW91IGFyZSBub3c)/,
    description: "base64-encoded instruction override",
  },
  {
    patternId: "P-PIPE-10",
    // Homoglyph-masked instruction overrides. Attackers substitute
    // visually identical non-Latin codepoints (Cyrillic a U+0430, Greek
    // omicron U+03BF, etc.) inside the trigger words. We flag any of the
    // canonical injection keywords that appear within 20 characters of a
    // Cyrillic / Greek / Armenian / Cherokee / Georgian / Coptic letter.
    // This is intentionally a lower-confidence signal: a homoglyph in
    // adversary-controlled content near an override keyword is strong
    // evidence of smuggling (Meta-llama issue #1382 LLaMA homoglyph
    // bypass; Promptfoo homoglyph strategy).
    pattern: /[\u0400-\u04FF\u0370-\u03FF\u0530-\u058F\u13A0-\u13FF\u10A0-\u10FF\u2C80-\u2CFF][\s\S]{0,20}(?:ignore|system|instructions?|you\s+are|disregard|override)|(?:ignore|system|instructions?|you\s+are|disregard|override)[\s\S]{0,20}[\u0400-\u04FF\u0370-\u03FF\u0530-\u058F\u13A0-\u13FF\u10A0-\u10FF\u2C80-\u2CFF]/i,
    description: "homoglyph-masked instruction trigger (non-ASCII confusable near override keyword)",
  },
  {
    patternId: "P-PIPE-11",
    // Markdown/HTML image URL exfiltration. Attackers encode stolen data
    // into an external image URL; the renderer's automatic GET leaks it
    // to the attacker server (Simon Willison exfiltration-attacks tag;
    // Salesforce ForcedLeak 2025; Notion AI exfiltration 2025). External
    // image/link targets in pipeline content are blocked -- canonical
    // agent outputs reference only relative paths.
    pattern: /!\[[^\]]{0,200}\]\(\s*(?:https?:|data:|file:)|<img[^>]+src\s*=\s*["']\s*(?:https?:|data:)/i,
    description: "markdown/HTML image URL exfiltration attempt",
  },
  {
    patternId: "P-PIPE-12",
    // Error-message instruction smuggling. Attackers wrap overrides in
    // fake error/debug/diagnostic frames to exploit model trust in
    // system-looking context (Unit 42 "Fooling AI Agents" 2025;
    // cheatsheetseries.owasp.org LLM Prompt Injection Prevention). Match
    // error/debug/warning frames that carry an override directive.
    pattern: /(?:error|exception|warning|debug|stderr|traceback|panic)[\s:=\-]{1,4}[^\n]{0,80}(?:reveal|print|output|dump|show|leak|expose|display)\s+(?:the\s+|your\s+)?(?:system\s+prompt|prompt|instructions?|context|secrets?|tokens?|keys?)/i,
    description: "error/debug frame wrapping an instruction override",
  },
];

/**
 * Exported view of `INJECTION_PATTERNS` pattern IDs for the catalog
 * synchronization test at `src/__tests__/pipeline/injectionPatternsSync.test.ts`.
 * Consumers outside that test should use `sanitizePipelineInput` or
 * `validateAgentOutput` instead.
 */
export const PIPELINE_INJECTION_PATTERN_IDS: readonly string[] = INJECTION_PATTERNS.map(
  (p) => p.patternId,
);

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

// ── User Content Sanitization (C9-H14, D6-SA6.4-F1) ──────────────

/** Maximum length for user-contributed content in characters. */
export const MAX_USER_CONTENT_LENGTH = 250_000;

export interface UserContentSanitizationResult {
  /** Sanitized content with matched patterns replaced by `[SANITIZED]`. */
  sanitized: string;
  /** True when one or more injection patterns matched (caller should treat content as quarantined). */
  blocked: boolean;
  /** Audit-friendly reasons for each match (pattern ID + description + source). */
  reasons: string[];
}

export interface UserContentContext {
  /**
   * Identifier of the loader/agent invoking the sanitizer (e.g.
   * `learnings-loader`, `handoff-loader`, `context-rules`). Used in
   * audit-friendly reason strings so reviewers can trace which loader
   * encountered the violation.
   */
  source: string;
  /**
   * Optional reference to the file (or entry id) the content originated
   * from. Included in audit reasons when present.
   */
  reference?: string;
}

/**
 * Sanitize user-contributed content loaded into agent context.
 *
 * This wrapper is the canonical entry point invoked by user-tier loaders
 * (learnings-loader, handoff-loader, context-rules) before learnings or
 * handoffs are surfaced in a session briefing. It enforces the trust
 * boundary defined in `agents/shared/injection-patterns.md` Section B
 * (user-tier content) by:
 *
 * 1. Running every pattern in `INJECTION_PATTERNS` (the same catalog used
 *    by `sanitizePipelineInput`) against the content body.
 * 2. Replacing matched substrings with `[SANITIZED]` so downstream agents
 *    do not see the raw injection payload.
 * 3. Emitting structured `reasons` (pattern ID, description, source)
 *    suitable for `Validation Warnings` sections in agent briefings.
 * 4. Returning `blocked: true` whenever any pattern matched so callers
 *    can quarantine the entry per ASI06 (Memory & Context Poisoning).
 *
 * Length enforcement uses `MAX_USER_CONTENT_LENGTH` (250 KB) to match the
 * effective ceiling for learnings/handoffs without invoking the broader
 * pipeline ceiling (`MAX_PHASE_INPUT_LENGTH`).
 */
export function sanitizeUserContent(
  content: string,
  ctx?: UserContentContext,
): UserContentSanitizationResult {
  const reasons: string[] = [];
  let sanitized = content;
  let blocked = false;
  const sourceTag = ctx?.source ?? "unknown";
  const refTag = ctx?.reference ? ` ref=${ctx.reference}` : "";

  // Length enforcement (truncate before pattern scan to bound cost).
  if (sanitized.length > MAX_USER_CONTENT_LENGTH) {
    reasons.push(
      `source=${sourceTag}${refTag} truncated from ${sanitized.length} to ${MAX_USER_CONTENT_LENGTH} characters`,
    );
    sanitized = sanitized.substring(0, MAX_USER_CONTENT_LENGTH);
    blocked = true;
  }

  // Strip null bytes (P-PIPE-05 also matches, but explicit strip is safer
  // because the regex is escape-sequence-or-null and the replacement below
  // only happens once per loop iteration).
  if (sanitized.includes("\0")) {
    sanitized = sanitized.replace(/\0/g, "");
    reasons.push(
      `source=${sourceTag}${refTag} pattern=P-PIPE-05 null byte stripped`,
    );
    blocked = true;
  }

  // Scan + quarantine every pattern in the catalog.
  for (const { patternId, pattern, description } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      reasons.push(
        `source=${sourceTag}${refTag} pattern=${patternId} ${description}`,
      );
      sanitized = sanitized.replace(
        new RegExp(
          pattern.source,
          pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
        ),
        "[SANITIZED]",
      );
      blocked = true;
    }
  }

  return { sanitized, blocked, reasons };
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
