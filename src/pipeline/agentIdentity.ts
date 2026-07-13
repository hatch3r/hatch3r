/**
 * ASI03 agent identity metadata for pipeline outputs.
 *
 * Every pipeline output includes metadata identifying which agent produced
 * it, when, and what capabilities the agent had. This supports auditability,
 * provenance tracking, and trust verification in multi-agent pipelines.
 *
 * Finding #80 (D15, High): Add agent identity metadata to pipeline outputs (ASI03).
 *
 * @library_export_only — ASI03 provenance + ASI10 capability/goal-drift contract
 * consumed by agent-runtime integrators (packs, downstream orchestrators). It is
 * NOT a CLI gate, but as of D15-SA15.3-02 it is no longer uncalled: its only
 * non-test importer is `src/pipeline/complianceVerification.ts`, whose
 * `asi03-agent-identity` + `asi10-capability-drift` checks round-trip these
 * exports as a `validate`-side self-test (mirroring diffHash / reviewLoop) — the
 * contract is verified on the CLI path but does not gate a CLI flow.
 */

import { createHash } from "node:crypto";
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

// ── D15-M7: Behavioral drift detection (capability+goal hash) ───────

/**
 * D15-M7: per-agent capability+goal fingerprint for multi-session
 * behavioral-drift detection (ASI10 Rogue Agents, ASI03 Identity Abuse).
 *
 * The framework previously had no documented detection for an agent whose
 * declared capabilities or goal text silently changed across sessions — e.g.,
 * a hatch3r-implementer whose `allowedTools` widened from
 * `["read","search","write","execute"]` to include `git` between session A
 * and session B. The capability set was readable but never hashed, so a
 * `verify`-style cross-session check had no canonical fingerprint to compare.
 *
 * `computeAgentCapabilityGoalHash` returns a deterministic SHA-256 prefix
 * over `(agentId, sorted capabilities, goal)`. Two sessions that observe
 * the same hash for the same `agentId` can assert behavioral parity; a
 * drift between sessions surfaces as a hash mismatch, which the orchestrator
 * can route to the failure-log or refuse to enter Phase 3 on.
 *
 * The hash is intentionally a 16-hex-char prefix (64 bits) — enough to
 * make accidental collisions vanishingly unlikely while staying short
 * enough to surface in handoff payloads and structured-result fields
 * without crowding out task content.
 */
export interface AgentCapabilityGoalFingerprint {
  /** Agent identifier this fingerprint is bound to. */
  agentId: string;
  /** Capabilities (sorted, deduplicated) included in the hash. */
  capabilities: readonly string[];
  /** Goal / role text included in the hash. */
  goal: string;
  /** 64-bit (16 hex char) SHA-256 prefix over (agentId|sorted_caps|goal). */
  fingerprint: string;
}

export function computeAgentCapabilityGoalHash(
  agentId: string,
  capabilities: readonly string[],
  goal: string,
): AgentCapabilityGoalFingerprint {
  const sorted = [...new Set(capabilities)].sort();
  // Field separator '\x1f' (Unit Separator) makes the serialisation
  // injection-resistant — no allowed category or goal text contains it.
  const payload = `${agentId}\x1f${sorted.join(",")}\x1f${goal}`;
  const digest = createHash("sha256").update(payload, "utf-8").digest("hex");
  return {
    agentId,
    capabilities: sorted,
    goal,
    fingerprint: digest.slice(0, 16),
  };
}

/**
 * Compute the capability+goal fingerprint for an `AgentIdentity` instance.
 * Convenience wrapper that pulls the fields from the identity record.
 */
export function fingerprintAgentIdentity(
  identity: AgentIdentity,
): AgentCapabilityGoalFingerprint {
  return computeAgentCapabilityGoalHash(
    identity.agentId,
    identity.capabilities,
    identity.role,
  );
}

/**
 * Compare two fingerprints from different sessions. Returns a structured
 * drift report — `drifted: true` when the hashes differ, with the changed
 * field(s) named so a downstream gate can route the event.
 */
export interface CapabilityGoalDriftReport {
  drifted: boolean;
  agentId: string;
  changedFields: ReadonlyArray<"agentId" | "capabilities" | "goal">;
  before: AgentCapabilityGoalFingerprint;
  after: AgentCapabilityGoalFingerprint;
}

export function detectCapabilityGoalDrift(
  before: AgentCapabilityGoalFingerprint,
  after: AgentCapabilityGoalFingerprint,
): CapabilityGoalDriftReport {
  const changedFields: Array<"agentId" | "capabilities" | "goal"> = [];
  if (before.agentId !== after.agentId) changedFields.push("agentId");
  if (
    before.capabilities.length !== after.capabilities.length ||
    before.capabilities.some((c, i) => c !== after.capabilities[i])
  ) {
    changedFields.push("capabilities");
  }
  if (before.goal !== after.goal) changedFields.push("goal");
  return {
    drifted: before.fingerprint !== after.fingerprint,
    agentId: after.agentId,
    changedFields,
    before,
    after,
  };
}
