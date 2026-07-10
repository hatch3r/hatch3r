---
id: commit-conventions
type: rule
description: Commit and PR conventions for framework development — Conventional Commits format, mandatory DCO sign-off, audit-wave commit format, CI PR checks, no force-push to main.
tags: [maintainer, governance, p2, p5]
scope: always
precedence: normal
---

# Commit Conventions

> Last updated: 2026-07-09

**Pillars:** P2 (Scientific Quality), P5 (Governance Self-Quality)

1. **Format:** Conventional Commits — `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `audit`
   - Scopes: `cli`, `adapters`, `pipeline`, `content`, `governance`, `audit`, `workspace`, `worktree`
2. **DCO sign-off required:** `git commit -s` (adds `Signed-off-by:` footer)
3. **Audit wave commits:** `audit: wave N -- [severity] findings` format per `governance/AUDIT-EXECUTE.md` Phase 4
4. **PR checks (CI):** PR title conventional-commit format validated, DCO sign-off verified, bundle size reported — run in `.github/workflows/pr-checks.yml`
5. **No force-push to main.** Feature branches only

CI workflows: `.github/workflows/ci.yml` — supply-chain audit, build matrix (Node 22/24/26, Ubuntu/macOS/Windows); `.github/workflows/pr-checks.yml` — PR title format, DCO sign-off, bundle-size report.
