---
name: h4tcher-pr-resolve
description: Resolve PR comments on the hatch3r repo — invoke the canonical hatch3r-pr-resolve workflow, then apply hatch3r-specific quality gates (validate, rule parity, efficiency invariants, lean thresholds, anti-slop, inventory, pillar compliance) and stop before commit for human review.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit Task
---

> Last updated: 2026-07-08

# PR Resolve (Maintainer)

Maintainer-facing wrapper around `commands/hatch3r-pr-resolve.md` for resolving PR comments **on the hatch3r repo itself**. Invokes the canonical workflow through reply-posting, layers in hatch3r-development quality gates, then stops before commit so the maintainer reviews the diff.

For non-hatch3r repos the canonical `/hatch3r-pr-resolve` command (distributed via adapters) is the entry point — this skill is only for work on this repo.

## Step 1: Preflight

1. Confirm branch + open PR:
   ```bash
   git branch --show-current
   gh pr view --json number,title,url,state
   ```
2. Read `governance/CONSTITUTION.md` §2 P5 lean-threshold table; cache the limits for files this PR is likely to touch.
3. Capture baseline line counts for any governance file likely to be edited:
   ```bash
   wc -l governance/CONSTITUTION.md governance/AUDIT.md governance/AUDIT-EXECUTE.md governance/EVOLVE.md governance/audit/domains/*.md 2>/dev/null
   ```
4. Confirm working tree is clean: `git status --short` returns empty.

## Step 2: Invoke the Canonical Workflow

5. Read `commands/hatch3r-pr-resolve.md` end-to-end.
6. Execute that workflow from Step 0 (Triage) through Step 8 (Post replies). Halt before Step 9 (Commit and push) and Step 9.5 (Re-poll gate) — both depend on the manual commit this skill defers; the gates below run first, and the maintainer commits manually at the end of this skill.
7. For every sub-agent prompt spawned during Step 6 (Fix implementation) and Step 7 (Review loop + final-quality specialists), inject this hatch3r-development context block:
   ```
   Hatch3r-specific constraints:
   - Pillar Compliance Test: every change must serve one or more of P1–P8
     (governance/CONSTITUTION.md §2). If none, revert. P8 dominates P7:
     never under-fan-out for token-cost reasons.
   - Lean thresholds: governance file line limits per CONSTITUTION §2 P5
     (read the table — do not cache numeric ceilings here, they drift) —
     compress within the file before exceeding.
   - Anti-slop wordlist: zero hits per
     .claude/rules/anti-slop-enforcement.md.
   - Commit format: type(scope): description with DCO sign-off via
     git commit -s.
   ```
   Fan-out is task-derived (P8 B2): sub-agent count tracks the canonical workflow's Step 6/7 fan-out (implementers per fix slot, reviewer + fixer review loop, final-quality specialists). Token cost never serializes independent work (`.claude/rules/fan-out-discipline.md` Cost-dominance clause). Emit `sub_agents_spawned: { count, rationale }` in your output (the `Sub-agents` field of the Step 5 summary).

## Step 3: Hatch3r Quality Gates

Run after Step 2 fixes complete. Block commit on any failure.

| Gate | Command | Threshold |
|------|---------|-----------|
| Tests | `npm test` | 0 failed |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 errors |
| Validation | `npm run validate` | 0 errors |
| Rule parity | `npm run validate:rule-parity` | 0 mismatches |
| Efficiency invariants | `npm run validate:efficiency` | 0 violations |
| Build | `npm run build` | succeeds; `dist/` produced |
| Inventory drift | `npm run inventory:check-docs` | 0 drift |

8. If canonical content was touched (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/`):
   ```bash
   npm run inventory
   git diff governance/inventory.json
   ```
   Confirm the diff matches the actual content changes; investigate any unexpected drift before proceeding.

9. If `src/merge/`, `src/content/`, or `src/adapters/customization.ts` was touched, run a coverage spot-check:
   ```bash
   npm test -- --coverage
   ```
   Critical-module thresholds: 90/80/90/90 for `src/merge/`; 85/70/85/85 for `src/content/`; 85/75/85/85 for `src/adapters/customization.ts`.

## Step 4: Pillar + Governance Compliance

For every file modified during Step 2:

10. **Pillar Compliance Test** (`.claude/rules/pillar-compliance.md`):
    - Which pillar(s) P1–P8 does this change serve?
    - What measurable improvement does it produce?
    - Does it increase total governance size? If yes, justify the net value or compress elsewhere.
    - If no pillar served → revert the change.

11. **Lean threshold check:** Compare new `wc -l` against Step 1 baselines and the limits cached from CONSTITUTION.md §2 P5. Any file over limit → compress within the file.

12. **Anti-slop scan** on every modified `.md` / `.mdc` file under `governance/`, `agents/`, `commands/`, `rules/`, `skills/`, `hooks/`:
    ```bash
    git diff --name-only HEAD | grep -E '\.(md|mdc)$' | \
      xargs -I {} grep -Hn -E '(best possible|best-in-class|world-class|comprehensive and thorough|robust and resilient|it is important to note|this section describes)' {}
    ```
    Any hit → fix before commit using the replacement column from `.claude/rules/anti-slop-enforcement.md`.

## Step 5: Iteration Summary — STOP Before Commit

13. Emit the summary below to the conversation. Do not commit, push, or merge.

```
PR-Resolve Iteration Summary
----------------------------
PR:       #<n> — <title>
Branch:   <branch>
URL:      <url>

Findings:
  Addressed:  <count>
  Deferred:   <count> (written to todo.md per canonical Step 5c)
  Blocked:    <count>

Files changed: <count>
Diff summary: <git diff --stat one-line per file>

Gates:
  npm test                       <PASS|FAIL>
  npx tsc --noEmit               <PASS|FAIL>
  npm run lint                   <PASS|FAIL>
  npm run validate               <PASS|FAIL>
  npm run validate:rule-parity   <PASS|FAIL>
  npm run validate:efficiency    <PASS|FAIL>
  npm run build                  <PASS|FAIL>
  npm run inventory:check-docs   <PASS|FAIL|N/A>

Pillars served: P<n>, P<n>, ...
Lean threshold deltas: <file: before -> after / limit>
Anti-slop hits: <count> (must be 0 to commit)
Inventory regenerated: <yes|no>
Sub-agents: count=<integer>, rationale=<one-line task-decomposition justification>

Suggested commit message:
  <type>(<scope>): <one-line description>

  <body line 1>
  <body line 2>

  Pillars: P<n>, P<n>

Status:     SUCCESS | PARTIAL | BLOCKED
Confidence: high | medium | low

Next action (run manually):
  git add <files>
  git commit -s -m "<suggested message>"
  git push
```

14. Per-comment replies were already posted in Step 8 of the canonical workflow, so the PR thread reflects the work even though the local commit is pending. The maintainer's manual commit + push completes the loop.

15. Canonical Step 9.5 (re-poll) applies only after commit + push. After the manual `git commit -s && git push`, re-run this skill to poll for new AI-review-tool comments on the new HEAD; the canonical `postedCommentIds` checkpoint filter prevents double-replies across re-runs.

## Constraints

- Do not edit `governance/inventory.json` by hand — only via `npm run inventory`.
- Do not skip the anti-slop scan; one banned phrase blocks commit.
- Do not push to `main` directly; commits land on the current feature or release branch.
- Do not amend prior commits unless the maintainer explicitly instructs.
- Always run the Pillar Compliance Test on every governance file edit before saving.
- DCO sign-off is required: `git commit -s`.

## References

- Canonical workflow: `commands/hatch3r-pr-resolve.md`
- Pillar definitions: `governance/CONSTITUTION.md` §2 (P1–P8)
- Lean thresholds: `governance/CONSTITUTION.md` §2 P5
- Anti-slop wordlist: `.claude/rules/anti-slop-enforcement.md`
- Pillar Compliance Test: `.claude/rules/pillar-compliance.md`
- Commit conventions + DCO: `.claude/rules/commit-conventions.md`
- Companion skill: `.claude/skills/h4tcher-release-prep/SKILL.md` (post-merge release cuts)
