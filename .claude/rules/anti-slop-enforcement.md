# Anti-Slop Enforcement

**Pillars:** P5 (Governance Self-Quality), P4 (Lean Coverage)

Zero tolerance for filler phrases in all `.md` files under `governance/`, `agents/`, `commands/`, `rules/`, `skills/`, `hooks/`. Scan output before committing and replace:

| Banned Phrase | Replacement |
|---------------|-------------|
| "best possible", "best-in-class", "world-class" | Specific measurable target (e.g., "95th percentile response time under 200ms") |
| "comprehensive and thorough", "exhaustive" | Specific scope (e.g., "covers all 15 adapters" or "validates 11 ASI controls") |
| "robust and resilient" | Named pattern (e.g., "circuit breaker with 3-failure threshold and 30s cooldown") |
| "high-quality" (without measure) | Specific metric (e.g., "90% branch coverage", "0 type errors") |
| "ensure" (without method) | Specific verification step (e.g., "run `npm test` and verify 0 failures") |
| "properly", "correctly" (without criterion) | Specific condition (e.g., "returns HTTP 200 with valid JSON body") |
| "as needed", "as appropriate" (without trigger) | Specific trigger (e.g., "when test coverage drops below 78%") |
| "scalable" (without dimension) | Specific scale (e.g., "handles repos with up to 500 canonical files") |
| "carefully", "thoroughly" | Remove or replace with concrete action |
| "it is important to note", "this section describes" | Remove — state the fact directly |

This wordlist comes from `governance/AUDIT-EXECUTE.md` regression gate check 10. Any hit is a gate failure.
