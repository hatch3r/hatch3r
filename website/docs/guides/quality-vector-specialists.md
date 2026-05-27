---
sidebar_position: 9
title: Quality-Vector Specialists
---

# Quality-Vector Specialists (2.0.0)

hatch3r 2.0.0 introduces a two-axis pillar framework. The **governance axis** (P1-P8) defines how the framework operates -- CLI UX, scientific quality, adapter currency, lean coverage, self-quality, security, speed, and clarification/fan-out discipline. The **content-quality axis** (CQ1-CQ9) defines what the framework produces in end-user code. Each CQ pillar is owned by a specialist agent invoked at quality gates with measurable thresholds and a structured proof_trace contract.

See [governance/CONSTITUTION.md](https://github.com/hatch3r/hatch3r/blob/main/governance/CONSTITUTION.md) §2 for the canonical pillar definitions and the traceability matrix.

## Per-Pillar Specialist Table

| Pillar | Specialist agent | Measurable threshold |
|--------|------------------|----------------------|
| **CQ1 UI** | `hatch3r-ui` | WCAG 2.2 AA conformance, design-token adoption >=95%, four-state surface contract coverage, component-library reuse ratio |
| **CQ2 UX** | `hatch3r-ux` | Four-state coverage (loading + empty + error + partial), interaction-state matrix, error-recovery paths, copy-deck completeness |
| **CQ3 Security** | `hatch3r-security` | OWASP Agentic Top 10 controls, secrets-management posture, prompt-injection defense, tool-allowlist enforcement |
| **CQ4 Reliability** | `hatch3r-reliability` | SLO compliance, named resilience patterns (circuit breaker with declared threshold, retry with backoff), idempotency, replay safety |
| **CQ5 Testability** | `hatch3r-testability` | Coverage thresholds (stmt/branch/func/line per maturity tier), deterministic + isolated test design, contract tests for adapters and external surfaces |
| **CQ6 Scalability** | `hatch3r-scalability` | Documented scale targets (N users, M repos, P concurrent agents), resource bounds, back-pressure design |
| **CQ7 Performance** | `hatch3r-performance` | Latency budgets per critical path, bundle-size budgets, runtime profiling baseline, regression gates |
| **CQ8 Maintainability** | `hatch3r-maintainability` | Lean thresholds, cross-file duplication <5%, module cohesion, dead-code budget |
| **CQ9 Enhancability** | `hatch3r-enhancability` | Extension-point contracts, customization escape hatches, migration paths, deprecation discipline |

## How Specialists Are Invoked

Each specialist agent declares a Phase-4 trigger in its frontmatter -- conditional file patterns that match changes touching its pillar's surface. When `hatch3r-board-pickup` (or the manual workflow) reaches the final-quality phase, the orchestrator dispatches the specialists whose triggers match the changed files, in parallel.

Each specialist returns a structured `proof_trace` with the measurements it took, the thresholds it compared against, and an `impact_horizon` classifier (short / medium / long) per CONSTITUTION Decision 17.

## Pillar Compliance Test

Every governance or content change in hatch3r answers six questions (CONSTITUTION §2):

1. Which pillar(s) does this change serve, on which axis (governance and/or content-quality)?
2. What measurable improvement does it produce?
3. Does it increase governance size? If yes, justify net value exceeding the size cost.
4. Does it degrade end-user runtime efficiency? If yes, reject or document the offset.
5. Impact horizon (short / medium / long)?
6. P8 (clarification & fan-out) dominance over P7 (token efficiency) -- does this change under-fan-out for token-cost reasons? If yes, reject.

## Reference

- [CONSTITUTION §2 Pillar Framework](https://github.com/hatch3r/hatch3r/blob/main/governance/CONSTITUTION.md)
- [agents/hatch3r-ui.md](https://github.com/hatch3r/hatch3r/blob/main/agents/hatch3r-ui.md) (and the other 8 specialist agent files alongside it)
- [Agent Teams](./agent-teams) -- how specialists coordinate with reviewer, fixer, and test-writer roles
