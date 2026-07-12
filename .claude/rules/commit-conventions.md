---
id: commit-conventions
type: rule
description: Commit and PR conventions for framework development — Conventional Commits format, mandatory DCO sign-off, audit-wave commit format, CI PR checks, no force-push to main.
tags: [maintainer, governance, p2, p5]
scope: always
precedence: normal
---

# Commit Conventions

> Last updated: 2026-07-12

**Pillars:** P2 (Scientific Quality), P5 (Governance Self-Quality)

1. **Format:** Conventional Commits — `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `audit`
   - Scopes: `cli`, `adapters`, `pipeline`, `content`, `governance`, `audit`, `workspace`, `worktree`
2. **DCO sign-off required:** `git commit -s` (adds `Signed-off-by:` footer)
3. **Audit wave commits:** `audit: wave N -- [severity] findings` format per `governance/AUDIT-EXECUTE.md` Phase 4
4. **PR checks (CI):** PR title conventional-commit format validated, DCO sign-off verified, bundle size reported — run in `.github/workflows/pr-checks.yml`
5. **No force-push to `main`.** Feature branches only.
   - Effective enforcement lives in ruleset 13329941's `non_fast_forward` rule — the single layer that owns the no-force-push policy (GitHub layers rulesets with classic protection and applies the most restrictive version, docs.github.com/…/about-rulesets, accessed 2026-07-12). The classic branch-protection `allow_force_pushes: true` flag is residual drift from the 2026-06-03 governance-privatization history rewrite and misstates the effective posture.
   - Correction (D4-SA4.3-06): in the D4-SA4.3-01 branch-protection settings pass, set classic `allow_force_pushes: false` (or retire the classic layer into the ruleset so one layer owns the policy) and enumerate/prune ruleset bypass actors. This is a GitHub repo-settings change (Administration), tracked under finding-01 — not a file edit.
   - Sanctioned exception: a purge-class history rewrite flips force-push on for the operation window only, then a ledgered revert step restores the block.
   - Contract of record: `CLAUDE.md` → "Merge gate — `main` branch-protection contract"; weekly drift probe `.github/workflows/trust-model-audit.yml` → `branch-protection-drift` (D4-SA4.3-01).

CI workflows: `.github/workflows/ci.yml` — supply-chain audit, build matrix (Node 22/24/26, Ubuntu/macOS/Windows); `.github/workflows/pr-checks.yml` — PR title format, DCO sign-off, bundle-size report.
