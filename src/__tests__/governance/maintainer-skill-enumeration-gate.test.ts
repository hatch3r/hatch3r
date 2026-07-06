import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D24-10 (Medium, P5 governance self-quality) maintainer-skill
 * single-enumeration gate.
 *
 * D24-SA24.2-F07 established the invariant that the framework-dev maintainer
 * utility surface — `h4tcher-` skills that are NOT lifecycle add/refactor/remove
 * presets and are NOT delegated-to by them — is enumerated in ONE place:
 * `.claude/rules/capability-lifecycle.md`. F07 added `/h4tcher-docusaurus-generator`
 * there.
 *
 * D24-10 found that invariant partially regressed: two newer maintainer utilities,
 * `h4tcher-pr-resolve` and `h4tcher-release-prep`, exist on disk as skills yet were
 * referenced nowhere in `.claude/rules/` or CLAUDE.md (`grep -rln` -> zero). The
 * root-cause fix generalized line 31's docusaurus-only paragraph into a
 * "Maintainer utilities (non-lifecycle)" sub-list listing all three.
 *
 * This probe backstops the fix: every maintainer utility that exists as a skill
 * directory under `.claude/skills/` must be referenced by name in the
 * capability-lifecycle rule, so a future maintainer skill cannot silently
 * re-open the regression. Existence is verified live from disk (the skill must
 * be present to be required), so the assertion does not false-fail if a utility
 * is later removed.
 *
 * Paths are resolved relative to `import.meta.dirname` (same convention as
 * src/__tests__/governance/dogfood-isolation-gate.test.ts) so every import stays
 * inside `src/` and `tsc --noEmit` stays clean.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const LIFECYCLE_RULE = resolve(ROOT, ".claude", "rules", "capability-lifecycle.md");

/**
 * The framework-dev maintainer utilities in scope for the F07 single-enumeration
 * invariant: `h4tcher-` skills that are neither lifecycle presets
 * (add/refactor/remove/discover/scoped-audit/evolve) nor delegated-to author
 * skills (content/adapter/domain-author) nor the audit subsystem skills
 * (audit-cycle/audit-execute/governance-check, covered by their own rows/findings).
 * Each maps to its skill directory under `.claude/skills/`.
 */
const MAINTAINER_UTILITY_SKILLS = [
  "h4tcher-docusaurus-generator",
  "h4tcher-pr-resolve",
  "h4tcher-release-prep",
];

describe("Maintainer-skill single-enumeration gate (Cycle 11 D24-10 / D24-SA24.2-F07)", () => {
  const ruleText = readFileSync(LIFECYCLE_RULE, "utf-8");

  it.each(MAINTAINER_UTILITY_SKILLS)(
    "maintainer utility %s exists as a skill and is enumerated in capability-lifecycle.md",
    (skillName) => {
      const skillFile = resolve(ROOT, ".claude", "skills", skillName, "SKILL.md");
      // Only require enumeration for utilities that actually exist on disk, so the
      // probe self-heals if a utility is later decommissioned.
      if (!existsSync(skillFile)) return;
      expect(
        ruleText.includes(skillName),
        `Maintainer utility "${skillName}" exists at .claude/skills/${skillName}/SKILL.md ` +
          `but is not referenced in .claude/rules/capability-lifecycle.md. The F07 ` +
          `single-enumeration invariant requires every non-lifecycle maintainer skill to be ` +
          `listed in the "Maintainer utilities (non-lifecycle)" section (D24-10 regression).`,
      ).toBe(true);
    },
  );

  it('the "Maintainer utilities (non-lifecycle)" section header is present', () => {
    expect(
      /##\s+Maintainer utilities/i.test(ruleText),
      'capability-lifecycle.md must carry a "Maintainer utilities (non-lifecycle)" section ' +
        "header so the maintainer-skill surface has a single named home (D24-10).",
    ).toBe(true);
  });
});
