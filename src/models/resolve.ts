import type { CanonicalFile, HatchManifest } from "../types.js";
import type { AgentCustomization } from "./customize.js";
import { resolveModelAlias } from "./aliases.js";

/**
 * Resolve the effective model for an agent.
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
  const raw =
    customize?.model
    ?? manifest.models?.agents?.[agentId]
    ?? agent.model
    ?? manifest.models?.default;
  return raw ? resolveModelAlias(raw) : undefined;
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
