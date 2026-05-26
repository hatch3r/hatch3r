---
id: hatch3r-dep-audit
description: Audit and update npm dependencies for security, freshness, and bundle impact. Use when auditing dependencies, responding to CVEs, or upgrading packages.
tags: [maintenance, floor:security]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Dependency Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Run npm audit + npm outdated, categorize findings
- [ ] Step 2: Research CVEs via web search for critical/high
- [ ] Step 3: Plan upgrades (breaking vs non-breaking, bundle impact)
- [ ] Step 4: Implement upgrades one-by-one, run tests after each
- [ ] Step 5: Verify quality gates and bundle size
- [ ] Step 6: Open PR with upgrade rationale
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: scope (critical/high only vs all), major-version-bump authority, bundle-size budget, deferral policy when no fix is available, and whether to also remove unused deps in the same pass.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Gather Findings

- Run `npm audit` and capture output. Categorize by severity: critical, high, moderate, low.
- Run `npm outdated` to identify packages with newer versions.
- Cross-reference with project dependency management rules: fix high/critical before merge, patch within 48h for critical CVEs.
- Document findings in a structured table: package, current version, available version, severity, CVE IDs (if any).

## Step 2: Research CVEs

For critical and high vulnerabilities:

- Use **web search** to look up each CVE: exploitability, affected versions, fix version, workarounds.
- Check npm advisories and platform-specific security tools for official guidance (check `platform` in `.hatch3r/hatch.json`):
  - **GitHub:** GitHub Security Advisories (`gh api /repos/{owner}/{repo}/security-advisories`)
  - **Azure DevOps:** Azure Artifacts security scanning and Azure Boards advisory tracking
  - **GitLab:** GitLab Dependency Scanning (Security & Compliance → Vulnerability Report)
- Prioritize: critical first, then high. Medium/low can be batched.
- Note any packages with no fix available — document mitigation or deferral rationale.

## Step 3: Plan Upgrades

Before changing anything:

- **Breaking vs non-breaking:** Check each package's changelog (npm, release notes on the package's repository). For external library docs and current best practices, follow the project's tooling hierarchy.
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
- Verify `package-lock.json` is committed by checking `git status` for untracked or modified lockfile.

## Step 6: Open PR

Use the project's PR template. Include:

- **Upgrade rationale:** why each package was upgraded (CVE, freshness, feature).
- **Breaking changes:** any code changes required and why.
- **Bundle impact:** before/after gzipped size.
- **Test evidence:** all tests pass, no regressions.
- **Rollback plan:** if risky (e.g., major version bump).

## Error Handling

- **`npm audit` reports vulnerabilities with no fix available**: Document the vulnerability, assess exploitability in the project context, and create a tracking issue. If the risk is high, evaluate alternative packages.
- **Major version upgrade breaks tests**: Roll back the upgrade, document the breaking changes encountered, and create a dedicated migration issue with the specific test failures and required code changes.
- **Lockfile conflicts after upgrade**: Regenerate the lockfile from scratch (`rm package-lock.json && npm install`), verify all tests pass, and commit the clean lockfile.

## Tracking Issues for Deferred Items

For CVEs or outdated packages not addressed in this session, create a tracking issue on the project's platform (GitHub Issues, ADO Work Item, or GitLab Issue per `platform` in `.hatch3r/hatch.json`). Use severity-based priority labels: Critical/High → `priority:p0`/`priority:p1`; Medium/Low → `priority:p2`; Major outdated → `priority:p2`; Minor/patch → `priority:p3`. Include package name, current version, target version, severity, CVE ID (if applicable), and migration notes. Never close out a critical/high CVE without either a fix or a tracking issue.

## Definition of Done

- [ ] No critical or high CVEs remaining
- [ ] All tests pass (lint, typecheck, unit, integration, E2E)
- [ ] Bundle size within budget (if defined)
- [ ] `package-lock.json` committed
- [ ] PR includes upgrade rationale and bundle impact
- [ ] No duplicate packages; unused deps removed
