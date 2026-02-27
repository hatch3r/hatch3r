export const MODEL_ALIASES: Record<string, string> = {
  "opus": "claude-opus-4-6",
  "sonnet": "claude-sonnet-4-6",
  "haiku": "claude-haiku-4-5",
  "codex": "gpt-5.3-codex",
  "codex-prev": "gpt-5.2-codex",
  "codex-mini": "gpt-5.1-codex-mini",
  "codex-spark": "gpt-5.3-codex-spark",
  "gemini-pro": "gemini-3.1-pro",
  "gemini-flash": "gemini-3-flash",
  "gemini-stable": "gemini-2.5-pro",
};

export function resolveModelAlias(input: string): string {
  return MODEL_ALIASES[input] ?? input;
}
