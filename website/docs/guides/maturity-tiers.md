---
sidebar_position: 5
title: Maturity Tiers
---

# Maturity Tiers

Maturity is a single dial — set once at `init` — that **calibrates how deeply your agents invest**: how much robustness, scalability, testing, and infrastructure they build for the project. It is **not** a content filter. Every tier installs the same full corpus; a solo repo and an enterprise repo receive the identical set of agents, skills, rules, commands, and checks. The tier only tells the agents how far to push each concern, anchored by a [universal floor](#the-universal-floor) that never relaxes.

:::info Maturity is not the same as `--team-size`
Two axes share the words "solo" and "team," and they do different jobs:

- **`--maturity`** (`solo` · `team` · `scaleup` · `enterprise`) — an **investment dial**. It does not add or remove content; it sets how deep agents build.
- **`--team-size`** (`solo` · `team`) — a **context filter**. It gates a small set of `ctx:team-only` artifacts (board management, handoffs) on whether you work alone or with others.

You can run `--maturity solo` with `--team-size team`, or any other combination.
:::

## The four tiers

Tiers are rank-ordered. A higher tier means deeper investment, more review rigor, and stricter user-content gates — never a different content set.

| Tier | Rank | What it calibrates |
|------|:----:|--------------------|
| `solo` | 0 | Universal floor only. Ship the smallest thing that is correct, secure, accessible, and tested on its changed surfaces. Minimal review rigor; user-content gates run in gentle (warn-only) mode. |
| `team` | 1 | **+ shared-codebase discipline:** duplication control, design-system reuse, structured logging. User-content gates promote from gentle to strict (block on violation). |
| `scaleup` | 2 | **+ production-operations depth:** SLOs, distributed tracing, performance budgets, idempotency / back-pressure on mutating writes. Strict gates plus production-readiness review. |
| `enterprise` | 3 | **+ org-governance depth:** full mutation / property / contract testing, AI-eval coverage, extensibility governance, FinOps. The deepest column. |

## The universal floor

One floor binds at **every** tier — including `solo` — and no calibration choice may drop below it:

- **Security** — auth, secrets handling, input validation, OWASP alignment
- **Correctness & data integrity** — no silent data loss or corruption
- **Accessibility basics** — keyboard reachability, semantic markup
- **Baseline tests on changed surfaces** — the code you touch is tested

Security is special: its auth, secrets, and correctness floor binds in full at `solo` and never relaxes — only supply-chain and governance depth scale up the ladder.

## Setting your tier

The tier defaults to `solo`. Set it at init:

```bash
hatch3r init --maturity team
```

It persists to `.hatch3r/hatch.json` under the top-level `maturity` field. Change it later, then re-sync so every generated artifact is re-stamped with the new tier:

```bash
hatch3r config maturity=scaleup
hatch3r sync
```

Each adapter stamps the resolved tier plus a right-size directive into the header of every generated artifact, so the agent reading a rule or running a command always sees the active tier. The always-on `hatch3r-right-sizing` rule carries the tier-to-depth ladder; at `team` and above, user-content authoring gates also tighten from warn-only to block-on-violation.

## What each tier calibrates

Every tier ships the same corpus. The buckets below are **recommended investment posture** — the depth agents build to — not install deltas. Every concern is present at every tier, just shallower lower down the ladder.

- **`solo` — universal floor only.** Ship the smallest correct, secure, accessible, tested thing. The full pipeline (architect, researcher, planner, implementer, reviewer, fixer, docs-writer, devops basics) and all nine quality specialists are installed — agents simply keep them minimal where the project does not yet need depth. No speculative abstraction.
- **`team` — shared-codebase discipline.** Duplication control and design-system reuse, structured logging with correlation IDs, ADRs on genuine architectural decisions, capability matrices, project-board management, and cross-person handoffs.
- **`scaleup` — production operations.** SLOs and distributed tracing on the request path, performance budgets, scalability patterns (statelessness, idempotency, back-pressure on mutating writes), an incident-response path, containerization, telemetry, and database migrations.
- **`enterprise` — org governance.** Full mutation / property / contract testing and AI-eval coverage, extensibility / enhancability governance, FinOps cost attribution, and agentic CI workflows.

## Quality specialists by tier

All nine [content-quality specialists](./quality-vector-specialists) install at every tier. The column below is advisory **calibration emphasis** — the tier at which each concern's depth starts to bind — not an install condition. Each specialist carries a `Tier calibration` ladder whose `solo` rung equals the universal floor and whose `enterprise` rung equals its absolute threshold.

| Specialist | Depth starts to bind at |
|------------|-------------------------|
| `hatch3r-security` | `solo` — auth/secrets/correctness floor binds in full everywhere; only supply-chain & governance depth scale |
| `hatch3r-ui` | `team` |
| `hatch3r-maintainability` | `team` |
| `hatch3r-ux` | `scaleup` |
| `hatch3r-reliability` | `scaleup` |
| `hatch3r-scalability` | `scaleup` |
| `hatch3r-performance` | `scaleup` |
| `hatch3r-testability` | `enterprise` |
| `hatch3r-enhancability` | `enterprise` |

## How to choose your tier

Start at `solo`. Raise the tier when a concrete need appears, not pre-emptively:

- **Add a second contributor** → `team`. You now want duplication discipline, handoffs, board management, and design-system consistency.
- **Ship to production load** → `scaleup`. Performance budgets, SLOs, incident response, and migrations start to bind.
- **Operate under org governance / compliance / FinOps** → `enterprise`. Cost accounting, AI-eval coverage, and extensibility governance become requirements.

Raising the tier does not change which artifacts install — selection stays tier-invariant. It raises investment depth, review rigor, and user-content gate strictness.

## Dial, not gate

Earlier 2.0.0 drafts modeled maturity as a content-admission gate, where lower tiers installed *fewer* artifacts. That inverted the intent — a solo repo never received the reliability, scalability, or testability content that matters to any project. 2.x removed the gate: there are no `tier:*` admission tags, selection is tier-invariant, and maturity is calibration-only. What still shapes which content is relevant are the unchanged context axes (`--team-size`, project type, language, and glob-scoped rules) — see [Content Model](../reference/architecture/content-model) and [What You Get](../getting-started/what-you-get).

## Related

- [Quality-Vector Specialists](./quality-vector-specialists) — the nine CQ specialists and their thresholds
- [Customization](./customization) — override behavior per project without losing managed updates
- [Configuration](../reference/configuration) — the `maturity` manifest field and `hatch3r config`
