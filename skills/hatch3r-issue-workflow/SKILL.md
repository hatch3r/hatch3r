---
id: hatch3r-issue-workflow
description: Guides the 8-step agentic development workflow for issues/work items. Covers parsing issues, loading skills, reading specs, planning, implementing, testing, opening PRs/MRs, and addressing review. Use when working on any issue/work item or when the user mentions an issue number.
tags: [core, implementation]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Issue Workflow

## Quick Start

When assigned an issue or work item (GitHub Issue, Azure DevOps Work Item, or GitLab Issue — check `platform` in `.hatch3r/hatch.json`), follow these 8 steps in order:

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Parse the issue
- [ ] Step 2: Load the issue-type skill
- [ ] Step 3: Read relevant specs
- [ ] Step 4: Produce a plan
- [ ] Step 5: Implement
- [ ] Step 6: Test
- [ ] Step 6b: Browser verification (if UI)
- [ ] Step 7: Open PR
- [ ] Step 8: Address review
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. This upgrades the existing Escalation block from exception to default. Triggers for THIS skill: issue type unclear (bug vs feature vs refactor), acceptance criteria missing or contradictory, scope boundary undefined, irreversible operation in path (schema change, public API rename), and target branch / merge policy ambiguous.

## Step 1: Parse the Issue

- Read all fields from the issue template.
- Identify: type (bug/feature/refactor/qa), affected area, priority, acceptance criteria.
- Note linked issues and spec references.

## Step 2: Load the Issue-Type Skill

Navigate to the matching skill based on issue type:

| Issue Type        | Skill                    |
| ----------------- | ------------------------ |
| Bug report        | hatch3r-bug-fix          |
| Feature request   | hatch3r-feature          |
| Code refactor     | hatch3r-refactor         |
| Logical refactor  | hatch3r-logical-refactor |
| Visual refactor   | hatch3r-visual-refactor  |
| QA E2E validation | hatch3r-qa-validation    |

## Step 3: Read Relevant Specs

Load only the specs relevant to the issue area. See the spec mapping table in the project context rule.

Also check project ADRs for architectural constraints.

- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 4: Produce a Plan

Output a structured plan before writing code:

- **Approach:** strategy
- **Files to touch:** list with brief description per file
- **Tests to write:** list
- **Risks:** what could go wrong
- **Open questions:** if any, propose answers

## Step 4b: Sub-Agent Delegation

Every issue MUST be delegated to a dedicated `hatch3r-implementer` sub-agent — never implement inline. The board-pickup command orchestrates this automatically; if running issue-workflow standalone, apply the pattern that matches your scenario:

| Scenario | Pattern |
|----------|---------|
| Single issue | Spawn one `hatch3r-implementer` sub-agent via the Task tool with issue number, body, acceptance criteria, issue type, researcher output, and spec references. Await result. |
| Epic with sub-issues | Load `references/delegation-patterns.md` — Pattern 2 |
| Batch of standalone issues | Load `references/delegation-patterns.md` — Pattern 3 |
| Plain chat with multiple tasks | Load `references/delegation-patterns.md` — Pattern 4 |

The implementer sub-agent protocol is defined in the `hatch3r-implementer` agent. Each sub-agent handles its own implementation and testing but does NOT create branches, commits, or PRs.

## Step 5: Implement

- Follow the plan. Use stable IDs from the project glossary.
- Do not expand scope beyond acceptance criteria.
- Remove dead code. Keep changes minimal and focused.

## Step 6: Test

- Unit tests for new logic. Integration tests for cross-module interactions.
- Database/security rules tests if rules changed.
- Regression tests for preserved behavior.
- All tests must be deterministic, isolated, and fast.

## Step 6b: Browser Verification (if UI)

Skip this step if the issue has no user-facing UI changes.

- Confirm the dev server is running by checking the expected port. If not running, start it in the background.
- Navigate to the page or surface affected by the change.
- Visually confirm the implementation matches acceptance criteria from the issue.
- Interact with changed elements to verify functional correctness.
- Check the browser console for errors or warnings.
- Capture screenshots as evidence for the PR.

## Step 7: Open PR / MR

- Use the project's PR/MR template. Fill every section.
- Link to the issue/work item. Include plan, implementation summary, test evidence.
- **Base branch:** Use `board.defaultBranch` from `.hatch3r/hatch.json` (fallback: `"main"`).
- Open a code review using the platform CLI (check `platform` in `.hatch3r/hatch.json`):
  - **GitHub:** `gh pr create --base {defaultBranch} --head {branch} --title "..." --body "..."`
  - **Azure DevOps:** `az repos pr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`
  - **GitLab:** `glab mr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`
- Self-review against the Definition of Done from the loaded skill.

## Step 8: Address Review

- Respond to every review comment.
- Push fixes as new commits (don't force-push during review).
- Re-request review after addressing all comments.

## Error Handling

- **Issue description is too vague to implement**: Do not guess. Ask the user for clarification on acceptance criteria, scope boundaries, and expected behavior before starting Step 3 (planning).
- **Tests fail after implementation and the cause is unclear**: Run tests in isolation to identify whether the failure is in new code or existing code. If existing tests broke, check whether they relied on behavior that was intentionally changed.
- **PR/MR creation fails due to branch conflicts**: Rebase onto the target branch, resolve conflicts, re-run all tests, and verify the merge result before re-creating the PR/MR.

## Escalation

Stop and ask when:

1. Acceptance criteria are contradictory.
2. Security concern discovered.
3. Architectural decision needed (new ADR required).
4. Spec conflict found.
5. Scope creep detected.
6. Test infrastructure missing.
