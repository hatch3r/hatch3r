---
id: hatch3r-edge-case-discipline
type: rule
description: Build-time enumeration of domain/data-correctness edge cases (cardinality, null/empty/boundary, cross-entity consistency, illegal state transitions, concurrency, partial failure) plus language-agnostic error-handling discipline — fires at Plan, Implement, and Review
tags: [implementation, reliability, testing, floor:content-quality]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Edge-Case & Error-Handling Discipline

**Pillars:** P2 (Scientific Quality)

This rule fires whenever a feature wires together ≥2 domain entities, or whenever a function consumes external or user-supplied input. Edge-case enumeration becomes a named build-time step, not a runtime afterthought. `rules/hatch3r-resilience-patterns.md` keeps a correct system *available* under failure (breakers, retries, fallbacks); this rule keeps the system *correct* in the first place — the two complement each other and do not overlap.

## When This Fires

- **Plan:** before writing code, enumerate edge cases from the taxonomy below for every entity and every cross-entity relationship the feature touches. List them as explicit named cases (e.g. `case: two contacts collide on email + linked property`), never the placeholder "handle edge cases".
- **Implement:** each enumerated case is handled in code OR explicitly recorded out-of-scope with a one-line reason. No silent omission — an unlisted case is a gap, an unhandled-but-listed case needs the recorded reason.
- **Review:** reject the change if any taxonomy category was not enumerated for an entity-wiring feature, or an enumerated case has neither handling nor a recorded out-of-scope reason. Maps to a Medium-or-higher finding per `agents/shared/quality-charter.md` §14.

## Domain Edge-Case Taxonomy

Seven categories. For each: the question to ask, then a worked example in the real-estate domain (properties + contacts + reservations + deals).

1. **Cardinality & duplicates** — for each relationship, what happens at zero, exactly-one, and N? Can two records collide on a natural key? Worked example: two contacts share the same email AND the same linked property but carry a different status — decide the dedup key and the tie-break rule (latest-updated wins, or merge) before writing the join, or the query returns a nondeterministic row.

2. **Null / empty / zero / boundary** — apply boundary-value analysis (Min−1, Min, Max, Max+1) and equivalence partitioning to every numeric, string, and collection input. Worked example: a deal with `amount = 0`, a reservation with an empty date range (`start == end`), a property with zero linked contacts, a name string at the column-length limit and one byte over.

3. **Cross-entity consistency & referential integrity** — if A references B, can B be missing, deleted, or in an invalid state when A is read? Worked example: a reservation pointing at an archived property; a deal whose contact was merged into another contact. Define cascade vs restrict vs orphan handling explicitly for each foreign reference; the default of an unhandled dangling reference is a 500 at read time.

4. **Illegal state transitions** — model the entity lifecycle as an explicit state set, enumerate the legal transitions, and reject the rest at construction and at transition time. Worked example: a deal moving `closed → pending`; a reservation marked `confirmed` on a `withdrawn` listing. Apply make-illegal-states-unrepresentable / parse-don't-validate: validate once at the boundary, then the constructed type carries the proof so downstream code cannot re-encounter the illegal state.

5. **Concurrency & ordering** — two writers modify the same record, or events arrive out of order. Worked example: two agents accept the same reservation slot at the same instant. Name the concurrency-control choice (optimistic version column, row lock, or idempotency key) at design time; "last write wins by accident" is not a choice. Cross-link `rules/hatch3r-scalability.md` and `rules/hatch3r-resilience-patterns.md`.

6. **Partial failure across layers** — a single logical write spans cache + DB + queue + external API; what is the state when step 3 of 4 fails? Worked example: a deal is persisted to the DB, the cache is updated, the "deal-won" event is published, and the external CRM sync then times out. Define the consistency boundary (transaction, saga, or transactional outbox) and the compensating action. Cross-link `rules/hatch3r-resilience-patterns.md` failure classification.

7. **Idempotency on replay / retry** — if the operation runs twice with the same input, is the second run a no-op? Required for any non-idempotent mutation reachable by a retry. Worked example: a retried "create reservation" call must not create two reservations for one slot. Cross-link `rules/hatch3r-resilience-patterns.md` → idempotency-key.

The seven categories are a floor, not a ceiling: enumerate domain-specific invariants alongside them (e.g. "a property has at most one active deal", "a reservation date range never overlaps another confirmed reservation on the same property").

## Error-Handling Discipline

Language-agnostic principles; complements `rules/hatch3r-code-standards.md` and does not restate its TypeScript mechanics.

- **Placement:** catch at architectural boundaries only (route handler, event handler, job processor, UI error boundary); let errors propagate within a module. Defer to `rules/hatch3r-code-standards.md` → Error Boundaries for the full pattern and the TS Result-type mechanics.
- **Propagation with context:** every re-throw or wrap attaches the failing operation plus the relevant identifiers (entity id, correlation id — no PII, no secrets) and preserves the original cause chain. A wrap that drops the cause is a finding.
- **Exhaustive matching:** every discriminated union, enum, and explicit state set is matched exhaustively with a compile-time-checked default, so adding a variant breaks the build rather than falling through silently. Cross-link `rules/hatch3r-code-standards.md` → exhaustive `switch` + `never`.
- **Recovery vs fail-fast triage:** classify each failure as recoverable (fallback or degrade — cross-link `rules/hatch3r-resilience-patterns.md` → Graceful Degradation) or unrecoverable (fail fast with an actionable message — cross-link `agents/shared/quality-charter.md` §6). No catch block treats both alike.
- **No silent catch (hard rule):** an empty catch, a catch that returns `null` or a default for every error, and swallow-and-continue are all prohibited. Defer to the `rules/hatch3r-code-standards.md` Error Handling Anti-Patterns table for the canonical prohibited list. This ties to `agents/shared/quality-charter.md` §6 (never fail silently) and §8 (a case that cannot be handled at build time is a clarification trigger, not a guess).

## Cross-References

- `rules/hatch3r-code-standards.md` — Result types, custom error classes, exhaustive `switch` + `never`, error anti-pattern table (the TS mechanics this rule references rather than restates).
- `rules/hatch3r-resilience-patterns.md` — failure classification, idempotency-on-retry, graceful degradation (run-time resilience; this rule is build-time correctness).
- `rules/hatch3r-testing.md` — every enumerated edge case maps to a required test class per the Per-Feature Mandate Map and Error Path Coverage.
- `rules/hatch3r-scalability.md` — idempotency-key adoption on mutations.
- `rules/hatch3r-migrations.md` — concurrent-modification and referential-integrity handling at the schema layer.
- `agents/shared/quality-charter.md` — §6 (Fail Gracefully), §8 (Escalate Ambiguity Early), §13 (Adversarial Thinking).

## References

- ISTQB Certified Tester Foundation Level syllabus — Boundary Value Analysis + Equivalence Partitioning — `https://www.istqb.org/certifications/certified-tester-foundation-level` (accessed 2026-06-02, official-standards-body).
- Alexis King, "Parse, Don't Validate" — `https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/` (accessed 2026-06-02, named-author primary source).
