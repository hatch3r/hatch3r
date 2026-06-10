import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D19-3 (High, framework-dev skill correctness) npm-separator gate.
 *
 * `.claude/skills/h4tcher-audit-execute/SKILL.md` invokes two argv-parsing
 * scripts — `audit:reset` (`scripts/clean-audit-workspace.ts`, parses
 * `process.argv.slice(2)`) and `audit:archive` (`scripts/audit-archive.ts`,
 * parses `process.argv.slice(2)` and HARD-FAILS when `--cycle` is absent). Both
 * are run via `npm run`, which strips bare flags before they reach the script
 * unless a `--` separator precedes them. Before D19-3 the skill wrote
 * `npm run audit:reset --auto` / `--strict` (line 30) and
 * `npm run audit:archive --in-place --cycle <N>` (line 86) WITHOUT the `--`, so
 * a live run silently dropped every flag: `audit:reset --auto` ran report-only
 * (never clearing stale-cycle markers) and `audit:archive` hard-failed on the
 * missing `--cycle`. The scripts' own docblocks already model the correct form
 * (`scripts/clean-audit-workspace.ts:20-24`, `scripts/audit-archive.ts:17-19`).
 *
 * The D19-3 fix rewrites both invocations to the `-- --flag` form and adds a
 * one-line note that npm requires `--` before script flags. This test
 * value-asserts the invariant generically against the canonical skill source the
 * maintainer edits: EVERY `npm run audit:{reset,archive}` invocation in the file
 * that carries a script flag (`--auto`, `--strict`, `--check`, `--in-place`,
 * `--cycle`) MUST place a `--` separator before the first such flag. It fails the
 * moment any invocation regresses to the bare-flag form (re-introducing the
 * silent-drop bug), regardless of how the surrounding prose is reworded.
 *
 * Reads the repo-root canonical file directly (not a built copy) so the
 * assertion tracks the source of truth regardless of build state, mirroring
 * `src/__tests__/governance/security-agent-verification-coverage.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const AUDIT_EXECUTE_SKILL = resolve(
  ROOT,
  ".claude",
  "skills",
  "h4tcher-audit-execute",
  "SKILL.md",
);

/** Script flags these two argv-parsing scripts consume. */
const SCRIPT_FLAGS = ["--auto", "--strict", "--check", "--in-place", "--cycle"];

/**
 * Every `npm run audit:{reset,archive} ...` invocation in the file, captured up
 * to the next backtick or end-of-segment so we can inspect its argument list.
 * Skill prose wraps each command in inline-code backticks (`...`), so we anchor
 * on the closing backtick.
 */
function npmAuditInvocations(body: string): string[] {
  const re = /npm run audit:(?:reset|archive)([^`\n]*)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * True when `argTail` (everything after the script name) either carries no
 * script flag at all, or places a standalone `--` separator before the first
 * script flag it carries.
 */
function separatorIsCorrect(argTail: string): boolean {
  const tokens = argTail.split(/\s+/).filter(Boolean);
  const firstFlagIdx = tokens.findIndex((t) => SCRIPT_FLAGS.includes(t));
  if (firstFlagIdx === -1) return true; // no script flag → `--` not required
  const separatorIdx = tokens.indexOf("--");
  return separatorIdx !== -1 && separatorIdx < firstFlagIdx;
}

// Privatization gate: `.claude/skills/h4tcher-*` is private overlay IP, gitignored
// and absent in public CI / contributor clones. Skip the whole suite when the
// skill source is absent (mirrors validate-governance-total.test.ts's
// "skips clean when the CONSTITUTION is absent (private-corpus public CI)"
// contract); the gate stays fully effective wherever the file is present.
const SKILL_PRESENT = existsSync(AUDIT_EXECUTE_SKILL);

describe.skipIf(!SKILL_PRESENT)("h4tcher-audit-execute npm `--` separator (Cycle 11 D19-3)", () => {
  const body = SKILL_PRESENT ? readFileSync(AUDIT_EXECUTE_SKILL, "utf-8") : "";
  const invocations = npmAuditInvocations(body);

  it("references both flag-bearing audit scripts (premise guard)", () => {
    // If the skill ever stops invoking these scripts this gate is moot — fail
    // loudly so the premise is re-checked rather than passing vacuously.
    expect(
      invocations.some((a) => SCRIPT_FLAGS.some((f) => a.split(/\s+/).includes(f))),
      "SKILL.md no longer invokes audit:reset/audit:archive with any script flag — re-check this gate's premise",
    ).toBe(true);
  });

  it("every flag-bearing npm run audit:* invocation uses the `--` separator", () => {
    const offenders = invocations.filter((a) => !separatorIsCorrect(a));
    expect(
      offenders,
      `these npm run audit:{reset,archive} invocations pass a script flag without the required \`--\` separator (npm strips bare flags, so the flag is silently dropped): ${JSON.stringify(
        offenders,
      )}`,
    ).toEqual([]);
  });

  it("the specific D19-3 invocations are present in corrected form", () => {
    // Anchor on the exact two call sites the finding named, so a reword that
    // happens to satisfy the generic check above still cannot drop them.
    expect(body).toContain("npm run audit:reset -- --auto");
    expect(body).toContain("npm run audit:archive -- --cycle <N> --in-place");
  });

  it("documents that npm requires `--` before script flags", () => {
    // The finding's fix column requires a one-line note explaining the
    // separator, so a future editor understands why `--` is load-bearing.
    expect(body).toMatch(/`--` separator is required/);
  });
});
