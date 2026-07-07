# Sustainability Model

> How hatch3r stays maintainable without a paid tier, recurring revenue, or full-time staff.

## Summary

hatch3r is maintained by volunteer contributors and sponsor-funded labor. It is not monetized, has no paid plan, and is not on a roadmap toward monetization (see [`docs/license-rationale.md`](./license-rationale.md) for the licensing stance). This document records the structural reasons the project expects to remain maintainable under that model.

The short version: hatch3r's quality is enforced by an automated 24-domain audit cycle that runs against the codebase itself. Maintenance work is therefore findable, scopeable, and parallelizable across one-shot contributors — not gated on a single maintainer's continuous attention.

## Funding model

| Channel | Status | Notes |
|---------|--------|-------|
| Donations / sponsorships | Accepted | GitHub Sponsors and one-time donations to the maintainer fund development time. |
| Paid plans, enterprise tier, SaaS | None | No closed-source upsell exists or is planned (see [`docs/license-rationale.md`](./license-rationale.md) §Anti-monetization signal). |
| Foundation grants | Future option | Tracked in the audit-domain Strategic Decision Register (D17 Competition); not pursued in current cycles. |
| Commercial support contracts | None | Out of scope; the framework is fully self-serve via `npx hatch3r init`. |

The donation channel exists to compensate the maintainer for the labor of running audit cycles and reviewing PRs — not to fund feature development. Feature development is driven by the audit cycle itself (new canonical content arises from audit findings; see the [Vision overview](https://docs.hatch3r.com/docs/about) §The Closed Loop).

## Structural defenses against abandonment

Many open-source projects collapse when the lead maintainer's attention drops below a critical threshold. hatch3r is designed to fail more gracefully via four structural choices:

### 1. The audit cycle replaces continuous maintainer attention

The framework's primary quality mechanism is the audit cycle (the audit prompt and its 4-wave execution model). One cycle deploys 124 sub-agents across 24 domains and produces a structured `AUDIT-REPORT.md` with severity-tagged findings. Execution follows a 4-wave progression (Critical → High → Medium → Low) with regression gates between waves.

Practical consequence: a single async contributor can pick up a single finding (one work-unit), implement it under the implementation sub-agent template, run the regression gate, and ship the result — without coordinating with the maintainer in real time. The audit cycle does the prioritization, scoping, and acceptance criteria up front. Contribution latency is bounded by the contributor's available hours, not by the maintainer's.

### 2. Lean thresholds prevent governance bloat

Governance file sizes are capped by lean thresholds, CI-mirrored in `.claude/rules/governance-lean-thresholds.md`:

| File | Limit |
|------|-------|
| Constitution | <=550 lines |
| Audit prompt | <=600 lines |
| Audit execution model | <=720 lines |
| Governance total (6 lean-tracked prompts) | <=3120 lines |
| Audit domain files | 30-80 lines (≤5 sub-agents), 15 lines per sub-agent above that |
| Cross-file duplication | <5% |
| Anti-slop phrases per file | 0 |

These thresholds are enforced by `npm run inventory` (which regenerates `governance/inventory.json` for CI drift detection) and by the anti-slop scan in `.claude/rules/anti-slop-enforcement.md`. The project cannot accumulate the "thousand-line governance doc nobody reads" failure mode common to maturing open-source frameworks: the threshold trips first and forces compression.

### 3. Canonical-source separation isolates platform churn

hatch3r maintains a strict split between canonical content (under `agents/`, `skills/`, `rules/`, `commands/`, `hooks/` — the source of truth) and adapter output (generated per platform under `.cursor/`, `CLAUDE.md`, `.github/`, etc.). All 3 platform adapters consume the same canonical source and produce platform-native output via the contract in `src/adapters/base.ts`.

Practical consequence: when Claude Code, Cursor, or the remaining supported platform ships a breaking change, the fix lives in exactly one adapter file under `src/adapters/`. Canonical content is unchanged. Contributors with no exposure to the broader framework can land an adapter fix in a single PR. This is the basis for the "currency" pillar (P3) which requires each adapter, CLI tool, and MCP server to be web-research-verified against vendor documentation each audit cycle.

### 4. Frozen contracts at module boundaries

Critical modules carry stricter test-coverage thresholds in `vitest.config.ts`:

- `src/merge/`: 90% statements, 80% branches, 90% functions, 90% lines
- `src/content/`: 85/70/85/85
- `src/adapters/customization.ts`: 85/75/85/85
- Global floor: 78/65/80/80

Combined with the managed-block contract (`HATCH3R:BEGIN` / `HATCH3R:END` markers preserve user content across regenerations, per `src/merge/managedBlocks.ts`) and the regenerate-and-diff drift model (`hatch3r status` / `hatch3r verify` regenerate adapter outputs from bundled content and compare against the on-disk copy — no `.integrity.json` checksum file), these contracts mean a refactor of one subsystem cannot silently corrupt downstream behavior. The test suite catches it before merge.

## Contributor pipeline

The audit cycle produces a stream of one-shot contribution opportunities:

1. Run `/h4tcher-audit-cycle` against the current `release/X.Y.Z` branch → produces an `AUDIT-REPORT.md` with severity-tagged findings.
2. Run `/h4tcher-audit-execute` → triages findings into a registry and groups them into waves and work units.
3. Each work unit is self-contained: it cites the files to modify, the acceptance criteria, the rigor contract the resolution must satisfy, and the regression-gate checks. Contributors pick up a work unit, implement it, write to `.audit-workspace/wave-{N}/{finding_id}.results.md`, and open a PR.

This is the mechanism by which async, parallel contribution is possible without continuous maintainer coordination. The maintainer's role is to run cycles and approve PRs, not to write specs for every contribution.

## Failure modes the project still has

This section is honest about gaps rather than aspirational:

- **Maintainer-fund dependency.** Audit cycles consume real labor (token budget for the audit's sub-agents, maintainer time to review PR-by-PR). If donation revenue drops to zero and the maintainer's available hours drop to zero simultaneously, cycle cadence slows.
- **Adapter staleness between cycles.** P3 requires each of the 3 adapters (Claude Code, Cursor, GitHub Copilot) to be re-verified against vendor documentation per cycle. A platform change that lands mid-cycle can drift until the next verification pass.
- **Plugin marketplace policy risk.** If Anthropic or Cursor change their marketplace licensing rules (e.g., requiring a different license, demanding telemetry), hatch3r would need a structural response. Tracked in the D17 Competition audit domain.

These are findable through audit cycles. They are not fatal under the structural-defense model above, but they require honest acknowledgment.

## How to support hatch3r

In rough order of value-per-hour to the project:

1. **Run an audit cycle on your own project's hatch3r install** and open issues against findings that surface. The audit prompt enforces the rigor contract (falsifiability statement, two independent sources, three-step causal chain, bias check, adversarial peer-review counter-argument), so issues opened from audit output land with a documented scope and resolution path.
2. **Pick up a Wave 2/3/4 finding from the audit finding registry** and submit a PR. Each finding has a documented work unit, acceptance criteria, and a regression gate.
3. **Verify a single adapter against the current vendor documentation** (one of the 3 in `src/adapters/`). Submit a PR with the web-research citation per P3.
4. **Sponsor the maintainer via GitHub Sponsors** to fund the labor of running cycles.

There is no "premium tier" of contribution; all four paths land in the same MIT-licensed repository under the same DCO sign-off model.

## References

- [`docs/license-rationale.md`](./license-rationale.md) — why MIT and the explicit anti-monetization signal
- [Vision overview](https://docs.hatch3r.com/docs/about) §The Closed Loop — audit cycle as continuous quality mechanism
- [Governance overview](https://docs.hatch3r.com/docs/about) — lean coverage (P4) and governance self-quality (P5) pillars
- Audit prompt — 24 domains, 124 sub-agents
- Audit execution model — 4-wave execution with regression gates
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — DCO sign-off, commit conventions
