import type { CanonicalFile, HatchManifest } from "../types.js";
import type { AgentCustomization } from "./customize.js";
import { resolveModelAlias } from "./aliases.js";

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

export function withProviderPrefix(modelId: string): string {
  for (const [pattern, provider] of PROVIDER_PREFIXES) {
    if (pattern.test(modelId)) return `${provider}/${modelId}`;
  }
  return modelId;
}
