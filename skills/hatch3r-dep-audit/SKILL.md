---
id: hatch3r-dep-audit
description: Audit and update npm dependencies for security, freshness, and bundle impact. Use when auditing dependencies, responding to CVEs, or upgrading packages.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Dependency Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Run npm audit + npm outdated, categorize findings
- [ ] Step 2: Research CVEs via web search for critical/high
- [ ] Step 3: Plan upgrades (breaking vs non-breaking, bundle impact)
- [ ] Step 4: Implement upgrades one-by-one, run tests after each
- [ ] Step 5: Verify quality gates and bundle size
- [ ] Step 6: Open PR with upgrade rationale
```

## Step 1: Gather Findings

- Run `npm audit` and capture output. Categorize by severity: critical, high, moderate, low.
- Run `npm outdated` to identify packages with newer versions.
- Cross-reference with project dependency management rules: fix high/critical before merge, patch within 48h for critical CVEs.
- Document findings in a structured table: package, current version, available version, severity, CVE IDs (if any).

## Step 2: Research CVEs

For critical and high vulnerabilities:

- Use **web search** to look up each CVE: exploitability, affected versions, fix version, workarounds.
- Check npm advisories and GitHub security advisories for official guidance.
- Prioritize: critical first, then high. Moderate/low can be batched.
- Note any packages with no fix available — document mitigation or deferral rationale.

## Step 3: Plan Upgrades

Before changing anything:

- **Breaking vs non-breaking:** Check each package's changelog (npm, GitHub releases). For external library docs and current best practices, follow the project's tooling hierarchy.
- **Bundle impact:** Check bundle size budget from project rules. Run `npm run build` and measure before/after for each upgrade.
- **Upgrade order:** Security fixes first, then non-breaking minor/patch, then breaking changes (one at a time).
- **Risks:** List packages that may require code changes (e.g., major version bumps).

## Step 4: Implement Upgrades

- Upgrade **one package at a time** (or one logical group, e.g., all patch-level ecosystem packages).
- After each upgrade: run `npm install`, then `npm run lint && npm run typecheck && npm run test`.
- If tests fail: fix or revert. Document any required code changes.
- Remove unused dependencies during the pass (per dependency-management rule).
- Commit `package-lock.json` — never use `npm install --no-save`.

## Step 5: Verify

```bash
npm run lint && npm run typecheck && npm run test
npm run build
```

- Confirm bundle size within budget (if defined).
- Run `npm audit` — no critical or high vulnerabilities remaining.
- Ensure `package-lock.json` is committed.

## Step 6: Open PR

Use the project's PR template. Include:

- **Upgrade rationale:** why each package was upgraded (CVE, freshness, feature).
- **Breaking changes:** any code changes required and why.
- **Bundle impact:** before/after gzipped size.
- **Test evidence:** all tests pass, no regressions.
- **Rollback plan:** if risky (e.g., major version bump).

## Definition of Done

- [ ] No critical or high CVEs remaining
- [ ] All tests pass (lint, typecheck, unit, integration, E2E)
- [ ] Bundle size within budget (if defined)
- [ ] `package-lock.json` committed
- [ ] PR includes upgrade rationale and bundle impact
- [ ] No duplicate packages; unused deps removed
