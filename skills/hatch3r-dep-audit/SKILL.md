---
id: hatch3r-dep-audit
name: hatch3r-dep-audit
type: skill
description: Audits and updates npm dependencies for security, freshness, and bundle impact. Use when auditing dependencies, responding to CVEs, or upgrading packages.
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

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output.

## Required Agent Delegation

> **Note:** When this skill is invoked via an orchestration pipeline (a `commands/hatch3r-*.md` flow), skip this section — the orchestrator handles agent delegation.

This skill realizes the two-agent dependency pattern (governance PRD Decision 13, F13.1-F04): the agent that *assesses* upgrade risk is distinct from the agent that *applies* it. Spawn these agents via the Task tool (`subagent_type: "general-purpose"`) at the points below:

- **`hatch3r-dependency-drafter`** (analysis phase, Steps 1–3) — MUST spawn to inventory the dependency surface, classify each candidate by SemVer band, cross-check advisories, and draft the per-dependency proposal (current pin → proposed pin, band, driver, risk, consumer call sites, verification gate). The drafter is read-only (its `tools.deny` forbids manifest edits and installs), so its proposal is a reviewable decision artifact, not a mutation. Skip only for a trivial single-package patch already scoped by the invocation.
- **`hatch3r-fixer`** (apply phase, Step 4) — MUST spawn under reviewer authority to perform the manifest edit + `npm install` + per-upgrade verification the drafter's proposal names. The fixer flips each proposal from `drafted` to `applied` after its row's verification gate passes.
- **`hatch3r-devops`** (apply phase, Step 4 — CI-wiring variant) — spawn instead of `hatch3r-fixer` when the upgrade requires CI manifest wiring (lockfile-cache keys, build-matrix version pins, Renovate/Dependabot config) rather than only a source-tree dependency bump.

The drafter never applies and the fixer/devops never re-assess risk — the split keeps risk assessment separate from risk acceptance.

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
${HATCH3R:VERIFY_GATE_ALL}
npm run build
```

The gate line is resolved to the project's language-aware command set at sync time (fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`); the build line is illustrative — substitute the project's build command.

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

## References

- [npm audit — npm CLI docs](https://docs.npmjs.com/cli/v10/commands/npm-audit) — accessed 2026-05-31, official-docs (npm, Inc.). Source for the `npm audit` severity buckets (critical/high/moderate/low) and `npm outdated` semantics used in Step 1.
- [GitHub security advisories REST API](https://docs.github.com/en/rest/security-advisories/repository-advisories) — accessed 2026-05-31, official-docs (GitHub). Source for the `gh api /repos/{owner}/{repo}/security-advisories` CVE-research path in Step 2.
