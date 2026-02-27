---
id: hatch3r-pr-creation
description: Create a pull request following project conventions including branch naming, PR template, checklist, and rollout plan. Use when opening or preparing a pull request, or when the user asks to create a PR.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# PR Creation Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Verify branch naming
- [ ] Step 2: Self-review against checklist
- [ ] Step 3: Fill PR template
- [ ] Step 4: Create the PR
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

## Step 3: Fill PR Template

Use the project's PR template. Fill every section:

- **Summary:** 1-3 sentences on what and why
- **Type:** Feature / Bug fix / Refactor / QA / Docs / Infra
- **Related Issues:** `Closes #N` or `Relates to #N`
- **Changes:** Bullet list of key changes
- **Screenshots:** Required for UI changes (before/after)
- **Testing:** Which tests added/updated, manual test steps
- **Rollout Plan:** Feature flag / gradual / direct
- **Rollback Plan:** How to revert

## Step 4: Create the PR

PR title format: `{type}: {short description} (#issue)`

Examples:

- `feat: add user preferences panel (#42)`
- `fix: correct validation for email field (#87)`

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-reviewer`** — MUST spawn before PR creation for code review. Include the full diff and acceptance criteria in the prompt. Apply reviewer feedback before creating the PR.

## Related Skills

- **Skill**: `hatch3r-issue-workflow` — use this skill for the parent issue-to-PR workflow that feeds into PR creation

## Size Guidelines

| Files Changed | Recommendation                       |
| ------------- | ------------------------------------ |
| 1-5           | Ideal. Review and merge quickly.     |
| 6-15          | Acceptable. Thorough PR description. |
| 16-30         | Split if possible.                   |
| 30+           | Must be split.                       |
