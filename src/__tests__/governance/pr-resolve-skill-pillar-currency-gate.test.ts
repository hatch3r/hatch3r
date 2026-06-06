import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 12 D19-4 (High, P5 governance self-quality) skill ⟷ CONSTITUTION
 * drift gate.
 *
 * `.claude/skills/h4tcher-pr-resolve/SKILL.md` injects a hatch3r-development
 * context block into every sub-agent it spawns (Step 7) and re-states the
 * Pillar Compliance Test inline (Step 10) plus the pillar-range references
 * (Step 1 prompt + References). Before D19-4 it cached a superseded 7-pillar
 * model ("P1–P7") and hardcoded governance lean ceilings (CONSTITUTION ≤225,
 * AUDIT-EXECUTE ≤700) that had already drifted from the live CONSTITUTION §2 P5
 * table (P1–P8, ≤550, ≤720). Sub-agents spawned without author memory grade
 * against whatever universe the block names — the stale block silently graded
 * against the wrong pillar set and the wrong ceilings.
 *
 * Root-cause fix: the block cites "per CONSTITUTION §2 P5" instead of caching
 * numeric ceilings, and every pillar-range reference tracks the live pillar
 * count. These probes backstop that fix so the block can never re-drift:
 *
 *  1. The highest governance pillar id is derived LIVE from CONSTITUTION's
 *     `### P<n>.` §2 headings. Any `P1–P<n>` range in the skill must name that
 *     same highest id — if a P9 is ever added to the Constitution and the skill
 *     lags, this fails. The superseded literal "P1–P7" is also rejected
 *     outright as a belt-and-suspenders check.
 *
 *  2. The skill must not re-cache governance lean ceilings as literals
 *     (e.g. "CONSTITUTION ≤225", "AUDIT-EXECUTE ≤700/≤720") — those numbers
 *     live in CONSTITUTION §2 P5 and drift independently. The skill must defer
 *     to "per CONSTITUTION §2 P5" instead.
 *
 * Both en-dash (–) and hyphen (-) pillar-range spellings are matched so a
 * future author using either form is still gated. Files are read with the same
 * `import.meta.dirname`-rooted, dependency-free convention as the sibling
 * dogfood-isolation gate, keeping every import inside `src/` for a clean
 * `tsc --noEmit`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const CONSTITUTION = resolve(ROOT, "governance", "CONSTITUTION.md");
const SKILL = resolve(
  ROOT,
  ".claude",
  "skills",
  "h4tcher-pr-resolve",
  "SKILL.md",
);

/** Highest governance pillar id from CONSTITUTION §2 `### P<n>.` headings. */
function liveHighestPillarId(): number {
  const text = readFileSync(CONSTITUTION, "utf-8");
  const ids = [...text.matchAll(/^#{2,3} P(\d+)\. /gm)].map((m) =>
    Number(m[1]),
  );
  expect(ids.length, "no `### P<n>.` pillar headings found in CONSTITUTION").toBeGreaterThan(0);
  return Math.max(...ids);
}

/** Pillar-range upper bounds named in the skill, across – and - spellings. */
function skillPillarRangeUpperBounds(skillText: string): number[] {
  return [...skillText.matchAll(/P1[–-]P(\d+)/g)].map((m) => Number(m[1]));
}

describe("PR-resolve skill pillar-currency gate (Cycle 12 D19-4)", () => {
  it("every P1–P<n> range in the skill names the live highest CONSTITUTION pillar id", () => {
    const highest = liveHighestPillarId();
    const skillText = readFileSync(SKILL, "utf-8");
    const bounds = skillPillarRangeUpperBounds(skillText);
    expect(
      bounds.length,
      "h4tcher-pr-resolve skill names no P1–P<n> pillar range — the Step 7 " +
        "context block and Step 10 Pillar Compliance Test must cite the range",
    ).toBeGreaterThan(0);
    const stale = bounds.filter((b) => b !== highest);
    expect(
      stale,
      `h4tcher-pr-resolve skill cites P1–P${stale.join("/P")} but CONSTITUTION ` +
        `§2 defines P1–P${highest}. Update the skill's pillar ranges to match ` +
        `the live pillar count (D19-4 drift gate).`,
    ).toEqual([]);
  });

  it("the skill never re-caches superseded literal P1–P7", () => {
    const skillText = readFileSync(SKILL, "utf-8");
    expect(
      /P1[–-]P7\b/.test(skillText),
      "h4tcher-pr-resolve skill re-introduced the superseded 7-pillar model " +
        "(P1–P7). Current model is P1–P8 per CONSTITUTION §2 (D19-4).",
    ).toBe(false);
  });

  it("the skill defers lean ceilings to CONSTITUTION §2 P5 instead of caching numeric limits", () => {
    const skillText = readFileSync(SKILL, "utf-8");
    // Literal governance-file line ceilings the skill must NOT hardcode in its
    // injected block — these drift independently and lived in the pre-D19-4 cache.
    const cachedCeiling = /(CONSTITUTION|AUDIT|AUDIT-EXECUTE|RE-ENVISION|EVOLVE)\s*[≤<]=?\s*\d{2,}/;
    const offenders = skillText
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => cachedCeiling.test(line));
    expect(
      offenders,
      "h4tcher-pr-resolve skill hardcodes governance lean ceilings instead of " +
        'citing "per CONSTITUTION §2 P5" — these numbers drift (D19-4):\n' +
        offenders.map((o) => `  ${o.n}: ${o.line.trim()}`).join("\n"),
    ).toEqual([]);
    // And the deferral phrasing must be present so the block stays self-updating.
    expect(
      /per CONSTITUTION §2 P5/.test(skillText),
      'h4tcher-pr-resolve skill must cite "per CONSTITUTION §2 P5" for lean ' +
        "thresholds (D19-4 root-cause: defer, do not cache).",
    ).toBe(true);
  });
});
