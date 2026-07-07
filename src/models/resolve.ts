import type { CanonicalFile, HatchManifest } from "../types.js";
import type { AgentCustomization } from "./customize.js";
import { resolveModelAlias } from "./aliases.js";

/**
 * Artifact classes that support per-id model configuration in
 * `hatch.json` -> `models.{agents,skills,commands}`. Mirrors the map keys on
 * {@link ModelConfig} (src/types.ts).
 */
export type ModelArtifactClass = "agents" | "skills" | "commands";

/**
 * Resolve the effective model for a canonical artifact (agent, skill, or
 * command) — release/2.2.0 generalization of {@link resolveAgentModel}.
 *
 * Priority (highest to lowest):
 * 1. Per-artifact customization (.hatch3r/{cls}/{id}.customize.yaml `model`)
 * 2. Manifest per-artifact override (models.{cls}[id])
 * 3. Canonical frontmatter `model:` field
 * 4. Manifest default model (models.default) — AGENTS ONLY. Skills and
 *    commands never inherit `models.default`: doing so would grow `model:`
 *    lines in every generated skill/command the moment a project sets a
 *    default (byte-stability break), and a command-level model switches the
 *    whole conversation model. See the {@link ModelConfig.default} JSDoc.
 *
 * The resolved value is passed through alias expansion (e.g. "opus" ->
 * "claude-opus-4-8"); `inherit` and unknown values pass through verbatim —
 * emission gating (recognizable-value predicates, `inherit` omission) is the
 * adapter layer's job, not resolution's.
 */
export function resolveArtifactModel(
  cls: ModelArtifactClass,
  id: string,
  frontmatterModel: string | undefined,
  manifest: HatchManifest,
  customize?: AgentCustomization,
): string | undefined {
  const raw =
    customize?.model
    ?? manifest.models?.[cls]?.[id]
    ?? frontmatterModel
    ?? (cls === "agents" ? manifest.models?.default : undefined);
  return raw ? resolveModelAlias(raw) : undefined;
}

/**
 * Resolve the effective model for an agent. Thin wrapper over
 * {@link resolveArtifactModel} with `cls: "agents"` — kept as the stable
 * agent-loop entry point (the `modelOverride` capability column is pinned to
 * adapters invoking this symbol; see
 * src/__tests__/adapters/capabilityMatrixDrift.test.ts).
 *
 * Priority (highest to lowest):
 * 1. Per-agent customization (.customize.yaml)
 * 2. Manifest agent-level override (models.agents[agentId])
 * 3. Agent frontmatter model field
 * 4. Manifest default model (models.default)
 *
 * The resolved value is passed through alias expansion (e.g. "opus" -> "claude-opus-4-8").
 */
export function resolveAgentModel(
  agentId: string,
  agent: CanonicalFile,
  manifest: HatchManifest,
  customize?: AgentCustomization,
): string | undefined {
  return resolveArtifactModel("agents", agentId, agent.model, manifest, customize);
}

const PROVIDER_PREFIXES: [RegExp, string][] = [
  [/^claude-/, "anthropic"],
  [/^gpt-|^codex-/, "openai"],
  [/^gemini-/, "google"],
];

/**
 * Prepend a provider prefix (e.g. "anthropic/", "openai/") to a model ID
 * when the model name matches a known provider pattern. Returns the input
 * unchanged if no provider is detected.
 */
export function withProviderPrefix(modelId: string): string {
  for (const [pattern, provider] of PROVIDER_PREFIXES) {
    if (pattern.test(modelId)) return `${provider}/${modelId}`;
  }
  return modelId;
}
