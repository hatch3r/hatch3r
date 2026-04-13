/**
 * ASI03 agent identity metadata for pipeline outputs.
 *
 * Every pipeline output includes metadata identifying which agent produced
 * it, when, and what capabilities the agent had. This supports auditability,
 * provenance tracking, and trust verification in multi-agent pipelines.
 *
 * Finding #80 (D15, High): Add agent identity metadata to pipeline outputs (ASI03).
 */

import { getAgentToolPolicy } from "./agentToolAllowlist.js";

// ── Types ────────────────────────────────────────────────────────

export interface AgentIdentity {
  /** Agent identifier (e.g. "hatch3r-implementer"). */
  agentId: string;
  /** Agent version (from framework version, not individual agent versioning). */
  version: string;
  /** Tool categories this agent is allowed to use. */
  capabilities: readonly string[];
  /** Human-readable role description. */
  role: string;
}

export interface AgentOutputMetadata {
  /** The agent that produced this output. */
  agent: AgentIdentity;
  /** Pipeline phase that produced this output. */
  phase: string;
  /** Pipeline correlation ID for tracing. */
  correlationId: string;
  /** ISO-8601 timestamp when the output was produced. */
  producedAt: string;
  /** SHA-256 prefix of the output content for integrity. */
  contentHash?: string;
}

export interface AnnotatedOutput<T> {
  /** The actual output data. */
  data: T;
  /** Agent identity and provenance metadata. */
  metadata: AgentOutputMetadata;
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Build an AgentIdentity from a registered agent ID.
 *
 * Looks up the agent's tool policy to populate capabilities.
 * Falls back to an empty capability set for unknown agents.
 */
export function buildAgentIdentity(
  agentId: string,
  frameworkVersion: string,
): AgentIdentity {
  const policy = getAgentToolPolicy(agentId);

  return {
    agentId,
    version: frameworkVersion,
    capabilities: policy?.allowedTools ?? [],
    role: policy?.description ?? "Unknown agent role",
  };
}

/**
 * Create output metadata for an agent's pipeline output.
 */
export function createOutputMetadata(
  agentId: string,
  frameworkVersion: string,
  phase: string,
  correlationId: string,
  contentHash?: string,
): AgentOutputMetadata {
  return {
    agent: buildAgentIdentity(agentId, frameworkVersion),
    phase,
    correlationId,
    producedAt: new Date().toISOString(),
    contentHash,
  };
}

/**
 * Wrap an output value with agent identity metadata.
 *
 * This is the primary API for annotating pipeline outputs.
 * Every output flowing between pipeline phases should be annotated
 * so the next phase can verify provenance and capabilities.
 */
export function annotateOutput<T>(
  data: T,
  agentId: string,
  frameworkVersion: string,
  phase: string,
  correlationId: string,
  contentHash?: string,
): AnnotatedOutput<T> {
  return {
    data,
    metadata: createOutputMetadata(
      agentId,
      frameworkVersion,
      phase,
      correlationId,
      contentHash,
    ),
  };
}

/**
 * Verify that an annotated output was produced by an expected agent.
 *
 * Returns true if the output's agent matches the expected agent ID.
 * Used by pipeline phases to verify they received output from the
 * correct upstream agent.
 */
export function verifyOutputAgent(
  metadata: AgentOutputMetadata,
  expectedAgentId: string,
): { valid: boolean; reason?: string } {
  if (metadata.agent.agentId !== expectedAgentId) {
    return {
      valid: false,
      reason:
        `Expected output from agent "${expectedAgentId}" but received ` +
        `output from "${metadata.agent.agentId}".`,
    };
  }

  return { valid: true };
}

/**
 * Verify that an annotated output was produced during an expected phase.
 */
export function verifyOutputPhase(
  metadata: AgentOutputMetadata,
  expectedPhase: string,
): { valid: boolean; reason?: string } {
  if (metadata.phase !== expectedPhase) {
    return {
      valid: false,
      reason:
        `Expected output from phase "${expectedPhase}" but received ` +
        `output from phase "${metadata.phase}".`,
    };
  }

  return { valid: true };
}
