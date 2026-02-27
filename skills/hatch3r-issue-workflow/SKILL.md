---
id: hatch3r-issue-workflow
description: Guides the 8-step agentic development workflow for GitHub issues. Covers parsing issues, loading skills, reading specs, planning, implementing, testing, opening PRs, and addressing review. Use when working on any GitHub issue or when the user mentions an issue number.
---
# Issue Workflow

## Quick Start

When assigned a GitHub issue, follow these 8 steps in order:

```
Task Progress:
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

Every issue MUST be delegated to a dedicated `hatch3r-implementer` sub-agent — never implement inline. The board-pickup command orchestrates this automatically, but if running issue-workflow standalone, follow the pattern below.

### Single Issue

Spawn one `hatch3r-implementer` sub-agent via the Task tool. Include: issue number, body, acceptance criteria, issue type, researcher output, and spec references. Await the result.

### Epic with Sub-Issues

1. **Group sub-issues by dependency level** from the epic's Implementation Order.
2. **Spawn one implementer sub-agent per sub-issue** using the Task tool. Include: issue number, body, acceptance criteria, issue type, parent epic context, and spec references.
3. **Launch sub-issues at the same dependency level in parallel** — as many concurrently as the platform supports.
4. **Await all sub-agents at a level** before starting the next level.
5. **Review results** from each sub-agent. Resolve any file conflicts between parallel outputs.

### Multiple Standalone Issues (Batch)

When working on multiple standalone issues (not part of an epic), apply the same parallel pattern:

1. **Group issues by dependency level.** Independent issues (no mutual dependencies) share the same level and run in parallel.
2. **Spawn one researcher sub-agent per issue** in parallel — as many concurrently as the platform supports. Each issue gets individual context gathering since standalone issues are unrelated.
3. **Spawn one implementer sub-agent per issue per level** in parallel — as many concurrently as the platform supports. Each receives its own researcher output.
4. **Await all sub-agents at a level** before starting the next level.
5. **Review results** from each sub-agent. Resolve any cross-issue file conflicts.

### Plain Chat with Multiple Tasks

When working from plain chat instructions with multiple tasks (numbered lists, multiple issue references, or distinct requests), parse into discrete tasks and apply the batch delegation pattern above. For GitHub issue references, fetch issue details. For natural language tasks, derive title, acceptance criteria, and type from the instruction.

The implementer sub-agent protocol is defined in the hatch3r-implementer agent. Each sub-agent handles its own implementation and testing but does NOT create branches, commits, or PRs.

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

- Ensure the dev server is running. If not, start it in the background.
- Navigate to the page or surface affected by the change.
- Visually confirm the implementation matches acceptance criteria from the issue.
- Interact with changed elements to verify functional correctness.
- Check the browser console for errors or warnings.
- Capture screenshots as evidence for the PR.

## Step 7: Open PR

- Use the project's PR template. Fill every section.
- Link to the issue. Include plan, implementation summary, test evidence.
- **Base branch:** Use `board.defaultBranch` from `/.agents/hatch.json` when creating PRs (fallback: `"main"`). Use `gh pr create --base {defaultBranch}` or equivalent.
- Self-review against the Definition of Done from the loaded skill.

## Step 8: Address Review

- Respond to every review comment.
- Push fixes as new commits (don't force-push during review).
- Re-request review after addressing all comments.

## Escalation

Stop and ask when:

1. Acceptance criteria are contradictory.
2. Security concern discovered.
3. Architectural decision needed (new ADR required).
4. Spec conflict found.
5. Scope creep detected.
6. Test infrastructure missing.
