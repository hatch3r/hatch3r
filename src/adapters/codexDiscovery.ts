import { CodexProjectionError } from "./codexProjectionError.js";

/** Exact documented fallback budget for serialized repository-skill metadata. */
export const CODEX_DISCOVERY_FALLBACK_CHAR_BUDGET = 8_000;

export interface CodexDiscoveryEntry {
  name: string;
  description: string;
  path: string;
  fullDescription: string;
}

export interface CodexDiscoveryCatalog {
  entries: CodexDiscoveryEntry[];
  serialized: string;
  characterCount: number;
  budget: number;
  compacted: boolean;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function unicodeSlice(value: string, max: number): string {
  return Array.from(value).slice(0, Math.max(0, max)).join("");
}

/** Convert a long canonical description into deterministic discovery prose. */
function compactCodexDiscoveryDescription(
  description: string,
  maxChars: number,
): string {
  if (maxChars <= 0) return "";
  const normalized = description.replace(/\s+/g, " ").trim();
  if (unicodeLength(normalized) <= maxChars) return normalized;
  if (maxChars === 1) return "…";
  const firstSentence = normalized.match(/^.*?(?:[.!?](?=\s|$)|$)/)?.[0]?.trim() ?? normalized;
  const source = unicodeLength(firstSentence) >= Math.min(maxChars, 24)
    ? firstSentence
    : normalized;
  const provisional = unicodeSlice(source, maxChars - 1).trimEnd();
  const wordBoundary = provisional.lastIndexOf(" ");
  const compacted = wordBoundary >= Math.floor(maxChars * 0.55)
    ? provisional.slice(0, wordBoundary).trimEnd()
    : provisional;
  return `${compacted}…`;
}

function serializeDiscovery(
  entries: ReadonlyArray<Pick<CodexDiscoveryEntry, "name" | "description" | "path">>,
): string {
  return entries
    .map((entry) => `- ${entry.name}: ${entry.description} (file: ${entry.path})\n`)
    .join("");
}

function normalizedDiscoveryEntries(
  input: ReadonlyArray<{ name: string; description: string; path: string }>,
): CodexDiscoveryEntry[] {
  return [...input]
    .map((entry) => ({
      ...entry,
      fullDescription: entry.description.replace(/\s+/g, " ").trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
    .map((entry) => ({ ...entry, description: entry.fullDescription }));
}

function compactDescriptions(
  entries: CodexDiscoveryEntry[],
  descriptionBudget: number,
): CodexDiscoveryEntry[] {
  let remaining = descriptionBudget;
  return entries.map((entry, index) => {
    const fairShare = Math.floor(remaining / (entries.length - index));
    const allotted = Math.min(unicodeLength(entry.fullDescription), fairShare);
    const description = compactCodexDiscoveryDescription(entry.fullDescription, allotted);
    remaining -= unicodeLength(description);
    return { ...entry, description };
  });
}

function trimToBudget(entries: CodexDiscoveryEntry[], budget: number): string {
  let serialized = serializeDiscovery(entries);
  while (unicodeLength(serialized) > budget) {
    const entry = [...entries].reverse().find((item) => unicodeLength(item.description) > 1);
    if (!entry) {
      throw new CodexProjectionError(
        "Codex discovery catalog could not be compacted to its fallback budget",
      );
    }
    entry.description = compactCodexDiscoveryDescription(
      entry.description,
      unicodeLength(entry.description) - 1,
    );
    serialized = serializeDiscovery(entries);
  }
  return serialized;
}

/** Account for the exact fallback serialization without truncating skill bodies. */
export function buildCodexDiscoveryCatalog(
  input: ReadonlyArray<{ name: string; description: string; path: string }>,
  budget = CODEX_DISCOVERY_FALLBACK_CHAR_BUDGET,
): CodexDiscoveryCatalog {
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new CodexProjectionError(`Codex discovery budget must be a positive integer, got ${budget}`);
  }
  const entries = normalizedDiscoveryEntries(input);
  const fullSerialized = serializeDiscovery(entries);
  if (unicodeLength(fullSerialized) <= budget) {
    return catalog(entries, fullSerialized, budget, false);
  }
  const fixedCost = unicodeLength(serializeDiscovery(
    entries.map((entry) => ({ ...entry, description: "" })),
  ));
  const descriptionBudget = budget - fixedCost;
  if (descriptionBudget < entries.length) {
    throw new CodexProjectionError(
      `Codex discovery catalog cannot fit ${entries.length} managed skills in ${budget} characters: ` +
        `names, paths, formatting, and one character per description require ${fixedCost + entries.length}. ` +
        "Disable nonessential skills/command bridges or shorten their names before syncing.",
    );
  }
  const compacted = compactDescriptions(entries, descriptionBudget);
  return catalog(compacted, trimToBudget(compacted, budget), budget, true);
}

function catalog(
  entries: CodexDiscoveryEntry[],
  serialized: string,
  budget: number,
  compacted: boolean,
): CodexDiscoveryCatalog {
  return {
    entries,
    serialized,
    characterCount: unicodeLength(serialized),
    budget,
    compacted,
  };
}
