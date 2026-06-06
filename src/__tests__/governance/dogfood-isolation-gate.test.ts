import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D24-2 (High, P7 token efficiency) dogfood-isolation gate.
 *
 * `hatch3r init` run against this framework-dev repo writes the Claude adapter's
 * per-file emissions into the dev `.claude/` tree: ~66 numbered rule files
 * (`.claude/rules/[0-9]*-hatch3r-*.md`) plus untracked `.claude/{agents,commands,
 * checks}` and three `.claude/hooks/` JSON/mjs artifacts. None carry `paths:`
 * frontmatter, so Claude Code loads them unconditionally at session launch,
 * burying the 12 tracked dev rules (~16.6x token dilution per the finding).
 *
 * The root-cause fix is `.gitignore` coverage of every adapter-emitted path so
 * the dogfood can never enter the tracked tree. This probe is the CI assertion
 * that backstops it: the set of `.md` files actually on disk under
 * `.claude/rules/` must be a subset of the known dev rules (the git-tracked dev
 * rules, derived live so the assertion self-updates as rules are added, plus the
 * one gitignored dev rule `audit-cycle-awareness.md` that exists on a maintainer
 * box but not on a fresh CI clone), and ZERO files may match the dogfood naming
 * pattern. A subset (not equality) check is portable across both layouts: the
 * maintainer box has 13 dev `.md`, a fresh clone has 12.
 *
 * Dev rules carry no numeric prefix; the dogfood emissions are all
 * `NN-hatch3r-*.md` (NN in {10,30,50,70}). Any numbered-or-unknown `.md`
 * appearing here means dogfood leaked into the tracked tree — the exact
 * regression D24-2 fixes.
 *
 * `git ls-files` is invoked via the local git binary (same subprocess
 * convention as src/__tests__/governance/content-validation-gate.test.ts), so
 * every import stays inside `src/` and `tsc --noEmit` stays clean.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const RULES_DIR = resolve(ROOT, ".claude", "rules");

/** Dev rules that live on a maintainer box but are .gitignore'd, so they are
 *  absent from a fresh CI clone. Kept explicit so the probe distinguishes a
 *  known-good gitignored dev rule from leaked dogfood. */
const GITIGNORED_DEV_RULES = new Set(["audit-cycle-awareness.md"]);

/** Filenames matching the Claude adapter's dogfood rule emission. */
const DOGFOOD_RULE = /^[0-9]+-hatch3r-.*\.md$/;

/** Git-tracked `.md` basenames under `.claude/rules/`, derived live. */
function trackedDevRuleBasenames(): Set<string> {
  const out = execFileSync("git", ["ls-files", ".claude/rules/*.md"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return new Set(
    out
      .split("\n")
      .filter(Boolean)
      .map((p) => p.slice(p.lastIndexOf("/") + 1)),
  );
}

/** `.md` basenames physically present in `.claude/rules/`. */
function onDiskRuleBasenames(): string[] {
  return readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"));
}

describe("Dogfood isolation gate (Cycle 11 D24-2)", () => {
  it("no dogfood-named rule file leaks into .claude/rules/", () => {
    const leaked = onDiskRuleBasenames().filter((f) => DOGFOOD_RULE.test(f));
    expect(
      leaked,
      `Claude-adapter dogfood rule emissions found under .claude/rules/ — ` +
        `gitignore the dogfood per D24-2 instead of tracking it:\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("every on-disk .claude/rules/*.md is a known dev rule (tracked or gitignored), never dogfood", () => {
    const known = new Set([...trackedDevRuleBasenames(), ...GITIGNORED_DEV_RULES]);
    const unknown = onDiskRuleBasenames().filter((f) => !known.has(f));
    expect(
      unknown,
      `Unexpected .md under .claude/rules/ (not a tracked dev rule, not the ` +
        `gitignored audit-cycle-awareness.md) — dilutes session context per D24-2:\n${unknown.join("\n")}`,
    ).toEqual([]);
  });

  it("the dev .claude/rules/ tree stays lean (on-disk .md count == tracked dev rules + gitignored dev rules)", () => {
    const tracked = trackedDevRuleBasenames();
    const onDisk = onDiskRuleBasenames();
    // On disk we may have the gitignored dev rule(s) on top of the tracked set;
    // we never have MORE than that union. Upper bound = tracked + all gitignored.
    const upperBound = tracked.size + GITIGNORED_DEV_RULES.size;
    expect(onDisk.length).toBeLessThanOrEqual(upperBound);
    // And the tracked set is fully reflected on disk (no tracked rule missing).
    const onDiskSet = new Set(onDisk);
    const missingTracked = [...tracked].filter((f) => !onDiskSet.has(f));
    expect(missingTracked, "tracked dev rule(s) missing from working tree").toEqual([]);
  });
});
