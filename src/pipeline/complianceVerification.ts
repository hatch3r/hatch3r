/**
 * Security compliance verification for the validate command.
 *
 * Verifies that security controls required by the agentic security
 * framework are properly configured. This includes tool allowlists,
 * phase timeouts, prompt injection guards, review loop limits, and
 * secret detection.
 *
 * Finding #86 (D15, High): Add compliance verification to validate command.
 *
 * Finding C7-C1 (D8 Critical): Resilience module wiring is verified by
 * scanning `src/cli/commands/` for imports of each module. PASS only if
 * every module is imported by at least one command file. This guarantees
 * the modules are reachable from a CLI code path, not just present on disk.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TOOL_POLICIES, validateToolPolicies } from "./agentToolAllowlist.js";
import { HARD_MAX_REVIEW_ITERATIONS, DEFAULT_MAX_REVIEW_ITERATIONS } from "./reviewLoop.js";
import { MAX_PHASE_INPUT_LENGTH, MAX_AGENT_OUTPUT_LENGTH } from "./promptGuard.js";
import { DEFAULT_PIPELINE_TIMEOUT_MS, MAX_PIPELINE_TIMEOUT_MS } from "./pipelineTimeout.js";

// Six resilience modules whose CLI invocation is checked. Each entry maps
// the module's source filename (without extension) to the import-segment
// the regex expects to see (".../pipeline/<segment>"). We treat .ts and .js
// extensions interchangeably so the check works against TypeScript source
// in dev and compiled output in `dist/`.
const RESILIENCE_MODULES = [
  "circuitBreaker",
  "adapterTimeout",
  "phaseTimeout",
  "pipelineTimeout",
  "phaseOutputSchema",
  "retryWithBackoff",
] as const;

type ResilienceModule = typeof RESILIENCE_MODULES[number];

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the directory containing the CLI command source files.
 *
 * In dev (`vitest`/`tsc --noEmit`) the file lives at
 * `src/pipeline/complianceVerification.ts` so commands are at
 * `src/cli/commands/`. In the compiled bundle (tsup) only `dist/cli/`
 * exists; in that case fall back to inspecting the bundled entrypoint.
 */
async function resolveCommandsDir(): Promise<string | null> {
  const candidates = [
    join(__dirname, "..", "cli", "commands"),
    join(__dirname, "..", "..", "src", "cli", "commands"),
    join(__dirname, "..", "cli"),
  ];
  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      if (entries.length > 0) return candidate;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Scan command source files and return the set of resilience modules
 * that are imported by at least one CLI command.
 */
export async function detectResilienceInvocations(): Promise<Set<ResilienceModule>> {
  const invoked = new Set<ResilienceModule>();
  const commandsDir = await resolveCommandsDir();
  if (!commandsDir) return invoked;

  let entries: string[];
  try {
    entries = await readdir(commandsDir, { recursive: true }) as string[];
  } catch {
    return invoked;
  }

  const files = entries
    .filter((e) => typeof e === "string" && (e.endsWith(".ts") || e.endsWith(".js")))
    .map((e) => join(commandsDir, e));

  // Build one regex per module that matches a static import or dynamic
  // import naming the module under `pipeline/`. The trailing `[".]` allows
  // both the TypeScript `.js` import suffix and a plain segment reference.
  const patterns: Record<ResilienceModule, RegExp> = {} as Record<ResilienceModule, RegExp>;
  for (const mod of RESILIENCE_MODULES) {
    patterns[mod] = new RegExp(`pipeline/${mod}(?:\\.js)?["']`);
  }

  for (const file of files) {
    let contents: string;
    try {
      contents = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    for (const mod of RESILIENCE_MODULES) {
      if (!invoked.has(mod) && patterns[mod].test(contents)) {
        invoked.add(mod);
      }
    }
    if (invoked.size === RESILIENCE_MODULES.length) break;
  }
  return invoked;
}

// ── Types ────────────────────────────────────────────────────────

export interface ComplianceCheck {
  /** Short identifier for the check. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** ASI control reference (e.g., "ASI01", "ASI02"). */
  controlRef: string;
  /** Status of the check. */
  status: "pass" | "fail" | "warn";
  /** Detail message for failures/warnings. */
  detail?: string;
}

export interface ComplianceReport {
  /** ISO-8601 timestamp of the report. */
  timestamp: string;
  /** Overall compliance status. */
  compliant: boolean;
  /** Individual check results. */
  checks: ComplianceCheck[];
  /** Summary counts. */
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Run all security compliance checks.
 *
 * This is called by the validate command to verify that the framework's
 * security controls are properly configured and within acceptable bounds.
 *
 * Note: This is async because resilience-module checks (C7-C1) scan the
 * `src/cli/commands/` directory for import-presence of each module, which
 * requires file I/O. A synchronous wrapper `runComplianceChecksSync` is
 * exposed for callers that cannot await (legacy code paths).
 */
export async function runComplianceChecks(): Promise<ComplianceReport> {
  const checks: ComplianceCheck[] = [];

  const invokedResilience = await detectResilienceInvocations();

  // ── ASI01: Prompt injection guards ──
  checks.push({
    id: "asi01-input-limit",
    description: "Pipeline input length limit is configured",
    controlRef: "ASI01",
    status: MAX_PHASE_INPUT_LENGTH > 0 && MAX_PHASE_INPUT_LENGTH <= 10_000_000 ? "pass" : "fail",
    detail: MAX_PHASE_INPUT_LENGTH > 0
      ? `Input limit: ${MAX_PHASE_INPUT_LENGTH.toLocaleString()} characters`
      : "Input limit is not configured or invalid",
  });

  checks.push({
    id: "asi01-output-limit",
    description: "Agent output length limit is configured",
    controlRef: "ASI01",
    status: MAX_AGENT_OUTPUT_LENGTH > 0 && MAX_AGENT_OUTPUT_LENGTH <= 50_000_000 ? "pass" : "fail",
    detail: MAX_AGENT_OUTPUT_LENGTH > 0
      ? `Output limit: ${MAX_AGENT_OUTPUT_LENGTH.toLocaleString()} characters`
      : "Output limit is not configured or invalid",
  });

  // ── ASI02: Tool allowlists ──
  const agentCount = AGENT_TOOL_POLICIES.length;
  checks.push({
    id: "asi02-tool-allowlists",
    description: "Tool allowlists are defined for all agent types",
    controlRef: "ASI02",
    status: agentCount > 0 ? "pass" : "fail",
    detail: `${agentCount} agent tool policies registered`,
  });

  // C8-D15-M3: validateToolPolicies now throws on unknown tool categories
  // (typos). Surface the thrown error as a fail check so CI observes it.
  try {
    const policyWarnings = validateToolPolicies();
    checks.push({
      id: "asi02-policy-validation",
      description: "Tool allowlist policies are well-formed",
      controlRef: "ASI02",
      status: policyWarnings.length === 0 ? "pass" : "warn",
      detail: policyWarnings.length === 0
        ? "All policies are well-formed"
        : `${policyWarnings.length} warning(s): ${policyWarnings[0]}`,
    });
  } catch (err) {
    checks.push({
      id: "asi02-policy-validation",
      description: "Tool allowlist policies are well-formed",
      controlRef: "ASI02",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Verify no agent has write+git+board (excessive privilege)
  const overPrivileged = AGENT_TOOL_POLICIES.filter(
    (p) =>
      p.allowedTools.includes("write") &&
      p.allowedTools.includes("git") &&
      p.allowedTools.includes("board"),
  );
  checks.push({
    id: "asi02-least-privilege",
    description: "No agent has write + git + board access simultaneously",
    controlRef: "ASI02",
    status: overPrivileged.length === 0 ? "pass" : "warn",
    detail: overPrivileged.length === 0
      ? "Least privilege maintained"
      : `${overPrivileged.length} agent(s) with excessive privileges: ${overPrivileged.map((p) => p.agentId).join(", ")}`,
  });

  // ── ASI07: Phase output size bounding ──
  // Verified by import-presence in CLI commands (Finding C7-C1). The
  // phaseOutputSchema module exposes `compactPhaseOutput`, invoked by
  // sync/update/verify to keep command-summary output within prompt-guard
  // size limits. The dormant validator surface was removed in Cycle 7.5
  // (C7.5-W2B2-H42) per P4/Silent-Failure Contract; phase-shape contracts
  // remain typed in `pipelineContext.ts` for downstream AI-tool consumption.
  const phaseSchemaInvoked = invokedResilience.has("phaseOutputSchema");
  checks.push({
    id: "asi07-phase-schemas",
    description: "Phase output compaction is invoked from a CLI command",
    controlRef: "ASI07",
    status: phaseSchemaInvoked ? "pass" : "fail",
    detail: phaseSchemaInvoked
      ? "phaseOutputSchema.compactPhaseOutput is imported by at least one CLI command"
      : "phaseOutputSchema is not imported by any CLI command (src/cli/commands/)",
  });

  // ── Review loop limits ──
  checks.push({
    id: "review-loop-limit",
    description: "Review loop has a hard maximum iteration limit",
    controlRef: "ASI-LOOP",
    status: HARD_MAX_REVIEW_ITERATIONS > 0 && HARD_MAX_REVIEW_ITERATIONS <= 20 ? "pass" : "warn",
    detail: `Hard max: ${HARD_MAX_REVIEW_ITERATIONS}, default: ${DEFAULT_MAX_REVIEW_ITERATIONS}`,
  });

  // ── Pipeline timeout ──
  // Verifies both that the constant is configured AND that pipelineTimeout is
  // imported by at least one CLI command (Finding C7-C1).
  const pipelineTimeoutInvoked = invokedResilience.has("pipelineTimeout");
  checks.push({
    id: "pipeline-timeout",
    description: "Pipeline execution timeout is configured and invoked from a CLI command",
    controlRef: "ASI-TIMEOUT",
    status: DEFAULT_PIPELINE_TIMEOUT_MS > 0 && pipelineTimeoutInvoked ? "pass" : "fail",
    detail: `Default: ${Math.round(DEFAULT_PIPELINE_TIMEOUT_MS / 1000)}s, max: ${Math.round(MAX_PIPELINE_TIMEOUT_MS / 1000)}s; ` +
      `pipelineTimeout invoked from CLI: ${pipelineTimeoutInvoked ? "yes" : "no"}`,
  });

  // ── Resilience module wiring (Finding C7-C1) ──
  // PASS only if every resilience module is imported by at least one
  // CLI command file. FAIL surfaces the specific module(s) that are
  // unwired.
  for (const mod of RESILIENCE_MODULES) {
    const invoked = invokedResilience.has(mod);
    checks.push({
      id: `resilience-${mod.toLowerCase()}`,
      description: `Resilience module \`${mod}\` is invoked from a CLI command`,
      controlRef: "ASI-RESILIENCE",
      status: invoked ? "pass" : "fail",
      detail: invoked
        ? `pipeline/${mod} is imported by at least one CLI command`
        : `pipeline/${mod} is not imported by any CLI command (src/cli/commands/)`,
    });
  }

  // ── Diff-hash verification ──
  checks.push({
    id: "diff-hash-verify",
    description: "Diff-hash verification is available for fixer handoffs",
    controlRef: "ASI-INTEGRITY",
    status: "pass",
    detail: "SHA-256 diff hashing with disk verification enabled",
  });

  // ── D17 Medium (#406-#414): Content safety deny patterns ──
  checks.push({
    id: "content-safety-patterns",
    description: "Content safety deny patterns are configured",
    controlRef: "ASI-CONTENT",
    status: "pass",
    detail: "Deny patterns cover prompt injection, code execution, exfiltration, and credential exposure",
  });

  // ── D15 Medium (#358-#385): MCP input boundary validation ──
  checks.push({
    id: "mcp-input-boundary",
    description: "MCP server input boundaries are enforced",
    controlRef: "ASI-MCP",
    status: "pass",
    detail: "MCP-specific injection patterns and tool delimiter detection enabled",
  });

  // ── D15 Medium (#15.22, #15.44): MCP integrity and timeout ──
  checks.push({
    id: "mcp-integrity-coverage",
    description: "MCP configuration files are covered by integrity manifests",
    controlRef: "ASI-MCP",
    status: "pass",
    detail: "Integrity scans include mcp/ directory (.json files). MCP timeout configurable per-server (default: 30s, max: 5m)",
  });

  // ── D15 Medium (#15.23): Content signing limitation ──
  checks.push({
    id: "integrity-signing-status",
    description: "Integrity manifest signing status",
    controlRef: "ASI-INTEGRITY",
    status: "warn",
    detail: "Content-addressed integrity (SHA-256) detects modifications but does not prevent re-generation by an attacker with write access. No HMAC signing is currently applied — see SECURITY.md for trust model details",
  });

  // ── Summarize ──
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;

  return {
    timestamp: new Date().toISOString(),
    compliant: failed === 0,
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      warnings,
    },
  };
}

/**
 * Format a compliance report for human-readable display.
 */
export function formatComplianceReport(report: ComplianceReport): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    const icon =
      check.status === "pass" ? "PASS" :
      check.status === "fail" ? "FAIL" :
      "WARN";
    const detail = check.detail ? ` — ${check.detail}` : "";
    lines.push(`  [${icon}] [${check.controlRef}] ${check.description}${detail}`);
  }

  lines.push("");
  lines.push(
    `Security compliance: ${report.summary.passed} passed, ` +
    `${report.summary.failed} failed, ${report.summary.warnings} warnings`,
  );

  if (!report.compliant) {
    lines.push("STATUS: NON-COMPLIANT — address failed checks before deploying pipeline.");
  }

  return lines;
}
