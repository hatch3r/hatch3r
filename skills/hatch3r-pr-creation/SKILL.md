---
id: hatch3r-pr-creation
description: Create a pull request or merge request following project conventions including branch naming, PR/MR template, checklist, and rollout plan. Use when opening or preparing a PR/MR, or when the user asks to create a PR or MR.
tags: [core, implementation]
quality_charter: agents/shared/quality-charter.md
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# PR / MR Creation Workflow

> **Platform detection:** Check `platform` in `.agents/hatch.json` to determine terminology and CLI. GitHub/Azure DevOps use "Pull Request" (PR); GitLab uses "Merge Request" (MR).

## Quick Start

```
Task Progress:
- [ ] Step 1: Verify branch naming
- [ ] Step 2: Self-review against checklist
- [ ] Step 3: Fill PR/MR template
- [ ] Step 4: Create the PR/MR
```

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

Create the PR/MR using the platform CLI (check `platform` in `.agents/hatch.json`):
- **GitHub:** `gh pr create --base {defaultBranch} --head {branch} --title "..." --body "..."`
- **Azure DevOps:** `az repos pr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`
- **GitLab:** `glab mr create --source-branch {branch} --target-branch {defaultBranch} --title "..." --description "..."`

Use `board.defaultBranch` from `.agents/hatch.json` as the target branch (fallback: `"main"`).

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
