---
id: anti-slop-enforcement
type: rule
description: Zero tolerance for banned filler phrases in .md files under governance/agents/commands/rules/skills/hooks; replace with measurable qualifiers.
tags: [maintainer, governance, p4, p5]
scope: always
precedence: high
---

# Anti-Slop Enforcement

> Last updated: 2026-07-09

**Pillars:** P5 (Governance Self-Quality), P4 (Lean Coverage)

Zero tolerance for filler phrases in all `.md` files under `governance/`, `agents/`, `commands/`, `rules/`, `skills/`, `hooks/`. Scan output before committing and replace:

| Banned Phrase | Replacement |
|---------------|-------------|
| "best possible", "best-in-class", "world-class" | Specific measurable target (e.g., "95th percentile response time under 200ms") |
| "comprehensive and thorough", "exhaustive" | Specific scope (e.g., "covers all 3 adapters (cursor, claude, copilot)" or "validates 11 ASI controls") |
| "robust and resilient" | Named pattern (e.g., "circuit breaker with 3-failure threshold and 30s cooldown") |
| "high-quality" (no measure) | Specific metric (e.g., "90% branch coverage", "0 type errors") |
| "ensure" (no method) | Specific verification step (e.g., "run `npm test` and verify 0 failures") |
| "properly", "correctly" (no criterion) | Specific condition (e.g., "returns HTTP 200 with valid JSON body") |
| "as needed", "as appropriate" (no trigger) | Specific trigger (e.g., "when test coverage drops below 78%") |
| "scalable" (no dimension) | Specific scale (e.g., "handles repos with up to 500 canonical files") |
| "carefully", "thoroughly" | Remove or replace with concrete action |
| "it is important to note", "this section describes" | Remove — state the fact directly |
| "obviously", "clearly", "naturally", "intuitively", "without doubt", "certainly" (when not citing a source) | Cite specific source (file:line OR URL with access date) |
| "this might affect", "could be useful" (without specific impact) | Specify measurable impact prediction OR concrete use case |
| "successfully completed", "everything works", "works as expected" (without verification) | Cite verification command + result (e.g., "npm test exit 0, 432/432 passing") |
| "enterprise-grade", "production-grade" (without maturity tier) | Specify maturity tier (solo/team/scaleup/enterprise) per CONSTITUTION §2 P5 + Decision 16 |

This wordlist mirrors the single physical home `governance/CONSTITUTION.md` §2 P5 → Anti-Slop Wordlist row-for-row; `governance/AUDIT-EXECUTE.md` regression gate 11, `CLAUDE.md` → Anti-Slop Wordlist, and the `scripts/validate-anti-slop.ts` pattern array are the other one-way mirrors, refreshed in the same sweep. A hit without the paired measurable qualifier within 8 words is a gate failure.
