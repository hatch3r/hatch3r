---
id: hatch3r-pr-creation
description: Create a pull request or merge request following project conventions including branch naming, PR/MR template, checklist, and rollout plan. Use when opening or preparing a PR/MR, or when the user asks to create a PR or MR.
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# PR / MR Creation Workflow

> **Platform detection:** Check `platform` in `.hatch3r/hatch.json` to determine terminology and CLI. GitHub/Azure DevOps use "Pull Request" (PR); GitLab uses "Merge Request" (MR).

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Verify branch naming
- [ ] Step 2: Self-review against checklist
- [ ] Step 3: Fill PR/MR template
- [ ] Step 4: Create the PR/MR
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: target base branch (`board.defaultBranch` vs feature branch), draft vs ready-for-review, reviewers explicitly named, rollout plan (feature flag vs direct), and whether the diff includes irreversible operations (force-push, data migration).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Branch Naming

Branches must follow `{type}/{short-description}`:

| Type        | When to Use                        | Example                       |
| ----------- | ---------------------------------- | ----------------------------- |
| `feat/`     | New features                       | `feat/add-user-preferences`   |
| `fix/`      | Bug fixes                          | `fix/login-validation-bug`    |
| `refactor/` | Code, logical, or visual refactors  | `refactor/simplify-auth-flow`  |
| `qa/`       | QA validation or test additions    | `qa/e2e-checkout-flow`        |
| `docs/`     | Documentation changes              | `docs/update-readme`          |
| `infra/`    | CI/CD, tooling, infrastructure     | `infra/add-lint-ci-step`      |

Rules: lowercase, hyphens (no underscores), 3-5 words max.

## Step 2: Self-Review Checklist

Before creating the PR, verify:

**Scope:** Changes limited to the stated issue. No unrelated changes. No TODOs without linked issues.

**Quality:** Code compiles (`npm run typecheck`). Lint passes (`npm run lint`). All tests pass (`npm run test`). No `any` types. No `@ts-ignore` without linked issue.

**Security & Privacy:** No secrets in code. Database rules updated and tested if data model changed. No sensitive content leaks to cloud. Event metadata uses allowlisted keys. Entitlement gates enforced server-side if gated.

**Accessibility (if UI):** Animations respect `prefers-reduced-motion`. Color contrast meets WCAG AA. Interactive elements keyboard accessible.

## Step 3: Fill PR/MR Template

Use the project's PR/MR template. Fill every section:

- **Summary:** 1-3 sentences on what and why
- **Type:** Feature / Bug fix / Refactor / QA / Docs / Infra
- **Related Issues:** `Closes #N` or `Relates to #N` (GitHub/GitLab), or link ADO Work Items via `AB#N`
- **Changes:** Bullet list of key changes
- **Screenshots:** Required for UI changes (before/after)
- **Testing:** Which tests added/updated, manual test steps
- **Rollout Plan:** Feature flag / gradual / direct
- **Rollback Plan:** How to revert

## Step 4: Create the PR/MR

PR/MR title format: `{type}: {short description} (#issue)`

Examples:

- `feat: add user preferences panel (#42)`
- `fix: correct validation for email field (#87)`

Create the PR/MR using the platform CLI (check `platform` in `.hatch3r/hatch.json`):
- **GitHub:** `gh pr create --base {defaultBranch} --head {branch} --title "..." --body "..."`
- **Azure DevOps:** `az repos pr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`
- **GitLab:** `glab mr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`

Use `board.defaultBranch` from `.hatch3r/hatch.json` as the target branch (fallback: `"main"`).

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-reviewer`** — MUST spawn before PR/MR creation for code review. Include the full diff and acceptance criteria in the prompt. Apply reviewer feedback before creating the PR/MR.

## Related Skills

- **Skill**: `hatch3r-issue-workflow` — use this skill for the parent issue-to-PR workflow that feeds into PR creation

## Error Handling

- **PR/MR creation fails due to missing remote branch**: Push the local branch to the remote first (`git push -u origin {branch}`), then retry the PR/MR creation.
- **CI checks fail on the PR/MR**: Diagnose the failure locally, push fixes as new commits (do not force-push during review), and verify CI passes before requesting review.
- **Merge conflicts with the target branch**: Rebase onto the target branch, resolve conflicts, re-run all tests, and force-push the rebased branch only if no reviews have been submitted yet.

## Size Guidelines

| Files Changed | Recommendation                       |
| ------------- | ------------------------------------ |
| 1-5           | Ideal. Review and merge quickly.     |
| 6-15          | Acceptable. Thorough PR description. |
| 16-30         | Split if possible.                   |
| 30+           | Must be split.                       |
