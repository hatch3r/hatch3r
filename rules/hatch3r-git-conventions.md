---
id: hatch3r-git-conventions
type: rule
description: Conventional Commits type list, subject line rules, breaking-change footer format, branch naming template for type/short-description, and change-size discipline (PR-size ceiling with stacked-change escape hatch)
scope: agent-requested
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Git Conventions

**Pillars:** P2 (Scientific & Practical Quality), P5 (Governance Self-Quality)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope)?: description

[optional body]

[optional footer(s)]
```

### Types
- `feat` — new feature (triggers minor version bump)
- `fix` — bug fix (triggers patch version bump)
- `chore` — maintenance, dependencies, config
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or updating tests
- `ci` — CI/CD configuration changes
- `perf` — performance improvement
- `build` — build system changes
- `style` — formatting, whitespace (no logic change)

### Rules
- Subject line: imperative mood, lowercase, no period, max 72 characters
- Body: wrap at 80 characters, explain what and why (not how)
- Breaking changes: add `!` after type/scope and `BREAKING CHANGE:` footer
- Reference issues: `Closes #123`, `Fixes #456`

## Branch Naming

Format: `{type}/{short-description}`

Examples:
- `feat/user-authentication`
- `fix/null-pointer-on-login`
- `chore/update-dependencies`
- `refactor/extract-adapter-base`

## Change Size

Work in small batches — capability 5 of the 2025 DORA AI Capabilities Model (see References), one of seven capabilities measured to magnify AI-assisted delivery gains. Small batches keep each change reviewable in one pass and revertible in one step.

- **PR-size ceiling (default, team-overridable):** ≤400 changed lines (additions + deletions, excluding lockfiles and generated files) — the reviewable-in-one-pass bound. The number is a default the team overrides with a recorded rationale, not an absolute.
- **Over the ceiling → stack, don't grow:** split the work into stacked changes — a chain of dependent PRs, each independently reviewable and revertible (e.g., refactor-only → behavior change → cleanup) — instead of one monolithic PR.
- **Mechanical bulk diffs** (rename sweeps, codemod output, dependency bumps) may exceed the ceiling in one PR when the diff is a single repeated pattern; state the generating command in the PR description so the reviewer verifies the pattern once, not per hunk.
- **Review-depth tie:** review depth scales with change risk — larger and agent-authored changes weight review toward deeper scrutiny per `rules/hatch3r-reviewer-calibration.md` → Change-risk inputs (N selection).

## References

- DORA / Google Research. "Introducing the DORA AI Capabilities Model: 7 keys to succeeding in AI-assisted software development." `https://research.google/pubs/introducing-the-dora-ai-capabilities-model-7-keys-to-succeeding-in-ai-assisted-software-development/` (accessed 2026-07-09, official-docs). Capability 5 — working in small batches — grounds the Change Size ceiling and stacked-change guidance.
