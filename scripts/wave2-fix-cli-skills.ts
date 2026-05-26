/**
 * Wave 2 follow-up: add capability tags to CLI-tool skills.
 *
 * Why this exists: Wave 2's main retag dropped `core` from CLI skills but
 * did not add a replacement capability tag. The new resolver (Wave 1)
 * drops items with zero capability tags — so all 30 CLI skills were
 * silently excluded from every preset. This script restores admission by
 * adding the appropriate capability tag per tier:
 *
 *   - tier-1 + overview → `orchestration` (in minimal + standard + full)
 *   - tier-2          → `maintenance` (in standard + full)
 *   - tier-3          → unchanged (admitted via `full.includeIds`)
 *
 * Auditable record. Idempotent — re-running is a no-op on already-tagged files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TIER1_PLUS_OVERVIEW = [
  "ripgrep", "fd", "jq", "yq", "gh", "delta", "bat", "sd", "ast-grep", "zstd",
  "overview",
] as const;

const TIER2 = [
  "playwright", "duckdb", "qsv", "taplo", "docker", "llm",
  "fzf", "lazygit", "difftastic", "glab", "az-devops",
] as const;

function tagsLineRegex(): RegExp {
  return /^(tags:\s*)(\[[^\]]*\])(\s*)$/m;
}

function addCapability(skillId: string, capability: "orchestration" | "maintenance"): boolean {
  const path = resolve(ROOT, `skills/hatch3r-cli-${skillId}/SKILL.md`);
  const content = readFileSync(path, "utf-8");
  const m = content.match(tagsLineRegex());
  if (!m) throw new Error(`No tags line found in ${path}`);
  const [, prefix, arr, trail] = m;

  // Parse the array literal — handles both ["a","b"] and [a, b] formats.
  const inner = arr.slice(1, -1).trim();
  const items = inner
    ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];

  if (items.includes(capability)) return false;  // already correct, idempotent
  items.push(capability);

  // Preserve original quoting style — if any item was quoted in the source, requote all.
  const wasQuoted = /["']/.test(arr);
  const rendered = wasQuoted
    ? `[${items.map((s) => `"${s}"`).join(", ")}]`
    : `[${items.join(", ")}]`;

  const next = content.replace(tagsLineRegex(), `${prefix}${rendered}${trail}`);
  writeFileSync(path, next);
  return true;
}

let changed = 0;
for (const id of TIER1_PLUS_OVERVIEW) {
  if (addCapability(id, "orchestration")) {
    changed++;
    console.log(`  + orchestration  hatch3r-cli-${id}`);
  }
}
for (const id of TIER2) {
  if (addCapability(id, "maintenance")) {
    changed++;
    console.log(`  + maintenance    hatch3r-cli-${id}`);
  }
}
console.log(`\n${changed} CLI skill(s) retagged. ${TIER1_PLUS_OVERVIEW.length + TIER2.length - changed} already correct.`);
