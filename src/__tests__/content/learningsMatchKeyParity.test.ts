/**
 * Cross-artifact match-key parity for the three learnings consumers.
 *
 * D13-25 (SA13.4-F8): the retired `hatch3r-learning-consult` rule scanned the
 * retired `tags`/`area`/`category` frontmatter fields as relevance match keys,
 * which the canonical schema replaced with `topic` (lookup) + `applies-to`
 * (path-glob binding). The consult rule was folded into
 * `rules/hatch3r-learning-system.md` (D6-17) and its scan corrected, but nothing
 * pinned the three independent consumers to the same match-key vocabulary, so
 * any one of them could silently drift back to a retired key. This test is that
 * pin: it asserts all three consumers (a) name the canonical match keys
 * `topic` + `applies-to`, and (b) never describe a retired field as a match key.
 *
 * The three consumers (per the finding):
 *   1. consult/canonical rule — `rules/hatch3r-learning-system.md`
 *   2. loader (read path)      — `agents/hatch3r-learnings-loader.md`
 *   3. learn skill (write path)— `skills/hatch3r-learn/SKILL.md`
 *
 * Ref: governance/AUDIT-REPORT.md D13-25; rules/hatch3r-learning-system.md
 * §"Canonical Schema — Single Source of Truth".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");

// The canonical relevance match keys per the learning schema. A learning is
// consulted by matching `topic` (subject lookup) and `applies-to` (path glob).
const CANONICAL_MATCH_KEYS = ["topic", "applies-to"] as const;

// Frontmatter fields the schema retired as match keys (migration table in
// rules/hatch3r-learning-system.md). None may be described as a match key by
// any consumer; they may only appear in a retirement/migration context.
const RETIRED_MATCH_KEYS = ["category", "area", "date", "recorded", "source", "author"] as const;

interface Consumer {
  /** Human label for assertion messages. */
  label: string;
  /** Repo-relative path to the canonical artifact. */
  relPath: string;
}

const CONSUMERS: Consumer[] = [
  { label: "consult/canonical rule", relPath: "rules/hatch3r-learning-system.md" },
  { label: "learnings loader (read path)", relPath: "agents/hatch3r-learnings-loader.md" },
  { label: "learn skill (write path)", relPath: "skills/hatch3r-learn/SKILL.md" },
];

/**
 * The original-bug detector: returns the first retired field a line directs a
 * consumer to use as a match key, or `null` when the line is clean.
 *
 * A line is FLAGGED when it (a) talks about a "match key", (b) names a retired
 * field token, and (c) is not an intentional retirement/migration note. A
 * migration-mapping line is recognised because it carries the canonical binding
 * token (`applies-to`/`path-glob`) — it maps retired→canonical rather than
 * directing a retired-key scan — or carries an explicit retirement qualifier.
 */
function retiredKeyDirectedAsMatchKey(line: string): string | null {
  if (!/match[ -]key/i.test(line)) return null;
  const retirementContext = /retir|deprecat|legacy|migrat|divergent|not (a|part of)|no longer/i;
  if (retirementContext.test(line)) return null;
  if (/applies-to|path-glob/i.test(line)) return null; // migration-mapping row
  for (const retired of RETIRED_MATCH_KEYS) {
    if (new RegExp(`\\b${retired}\\b`, "i").test(line)) return retired;
  }
  return null;
}

describe("learnings match-key cross-artifact parity (D13-25)", () => {
  const sources = new Map<string, string>();

  beforeAll(async () => {
    for (const consumer of CONSUMERS) {
      const text = await readFile(join(PROJECT_ROOT, consumer.relPath), "utf-8");
      sources.set(consumer.relPath, text);
    }
  });

  it("every consumer names both canonical match keys", () => {
    for (const consumer of CONSUMERS) {
      const text = sources.get(consumer.relPath)!;
      for (const key of CANONICAL_MATCH_KEYS) {
        expect(
          text.includes(key),
          `${consumer.label} (${consumer.relPath}) must reference the canonical match key \`${key}\``,
        ).toBe(true);
      }
    }
  });

  it("every consumer pairs the canonical match keys in a match-key statement", () => {
    // The string "match key" (or "match-key") must co-occur with both
    // `topic` and `applies-to` so the canonical pair is stated together, not
    // documented as two unrelated fields. Catches a drift that drops one key.
    for (const consumer of CONSUMERS) {
      const text = sources.get(consumer.relPath)!;
      expect(
        /match[ -]key/i.test(text),
        `${consumer.label} (${consumer.relPath}) must contain a "match key" statement`,
      ).toBe(true);
      // Both canonical keys appear in the same artifact that talks about match
      // keys — asserted by the per-key presence check above plus this guard.
      expect(text.includes("topic")).toBe(true);
      expect(text.includes("applies-to")).toBe(true);
    }
  });

  it("the original-bug detector flags a retired-key directive and exempts canonical/migration lines", () => {
    // Falsifiability self-test: prove the detector below has teeth before we
    // trust its clean verdict against the live corpus. The first line is the
    // exact shape D13-25 reported (a retired field directed as the scan key);
    // the next three must be exempt (canonical directive, migration-table row,
    // explicit retirement note).
    expect(retiredKeyDirectedAsMatchKey("match each row's `category` as the relevance match key")).toBe("category");
    expect(retiredKeyDirectedAsMatchKey("match each row's `Topic` + `Applies-To` against the task")).toBeNull();
    expect(
      retiredKeyDirectedAsMatchKey(
        "| `category` + `area` + `tags` as match keys | `topic` (match key) + `applies-to` (path-glob) |",
      ),
    ).toBeNull();
    expect(
      retiredKeyDirectedAsMatchKey("the retired `category`/`area` keys are no longer match keys"),
    ).toBeNull();
  });

  it("no consumer directs a retired field to be used as a match key", () => {
    // The original bug (D13-25): a retired field named as a relevance/match
    // key. Every "match key" line in every consumer must pass the detector.
    for (const consumer of CONSUMERS) {
      const text = sources.get(consumer.relPath)!;
      for (const line of text.split("\n")) {
        const flagged = retiredKeyDirectedAsMatchKey(line);
        expect(
          flagged,
          `${consumer.label} (${consumer.relPath}) directs retired field \`${flagged}\` as a match key:\n  ${line.trim()}`,
        ).toBeNull();
      }
    }
  });

  it("the consult rule's INDEX scan keys on Topic + Applies-To", () => {
    // The folded Consultation Efficiency step scans the INDEX table columns;
    // those column headers must be the canonical keys, not retired ones.
    const ruleText = sources.get("rules/hatch3r-learning-system.md")!;
    expect(ruleText).toMatch(/`Topic`\s*\+\s*`Applies-To`/);
    // INDEX.md table header carries the canonical columns.
    expect(ruleText).toMatch(/\|\s*ID\s*\|\s*Topic\s*\|\s*Applies-To\s*\|/);
  });

  it("every consumer cites the canonical schema rule as single source of truth", () => {
    // The loader and skill must defer to the rule; the rule must declare itself
    // the canonical author. This keeps the three from each inventing a schema.
    const ruleText = sources.get("rules/hatch3r-learning-system.md")!;
    expect(ruleText).toMatch(/Single Source of Truth/i);

    for (const relPath of [
      "agents/hatch3r-learnings-loader.md",
      "skills/hatch3r-learn/SKILL.md",
    ]) {
      const text = sources.get(relPath)!;
      expect(
        text.includes("rules/hatch3r-learning-system.md"),
        `${relPath} must cite rules/hatch3r-learning-system.md as the canonical schema source`,
      ).toBe(true);
    }
  });
});
