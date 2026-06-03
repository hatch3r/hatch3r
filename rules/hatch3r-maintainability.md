---
id: hatch3r-maintainability-rule
type: rule
description: CQ8 Maintainability Quality measurement rule — jscpd duplication index, pattern-reuse ratio, cyclomatic complexity, expand-contract migrations, API breaking-change discipline, ADR presence on architectural changes
scope: conditional
globs: "src/**,**/migrations/**,**/db/migrations/**,**/prisma/migrations/**,**/openapi.yaml,**/openapi.json,**/*.proto,**/schema.graphql,**/asyncapi.yaml"
tags: [review, maintainability, code-standards, floor:content-quality, tier:team-plus]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Maintainability Quality (CQ8)

**Pillars:** P4 (Comprehensive Lean Coverage), CQ8 (Maintainability Quality)

## Scope

This rule binds the CQ8 measurement set across end-user code that hatch3r-generated agents produce AND the framework's own source tree. It owns:

- The jscpd duplication-index ceiling.
- The pattern-reuse ratio floor.
- The cyclomatic-complexity per-function ceiling.
- The expand-contract migration conformance gate.
- The API breaking-change discipline on stable endpoints.
- ADR presence on architectural-decision-class changes.
- Specialist routing to `agents/hatch3r-maintainability.md`.

This complements (does not duplicate) `rules/hatch3r-anti-duplication.md` (the pre-implementation discovery gate). Anti-duplication is the discipline; this rule owns the measurement set + thresholds + specialist routing.

## CQ8 Threshold Set

Source: pillar CQ8 (see `agents/shared/principles.md`). Every threshold below is measurable per audit cycle.

| Threshold | Target | Measurement source |
|-----------|--------|--------------------|
| jscpd duplication index | ≤5% per cycle | `npx jscpd --min-tokens 50 --min-lines 5 src/` JSON report |
| Pattern-reuse ratio (reused / newly-authored) | ≥70% | Diff grep against named patterns (circuit breaker, retry-with-jitter, error handler, idempotency-key handler) |
| Cyclomatic complexity per function | ≤10 | ESLint `complexity` rule (JS/TS), radon (Python), lizard (polyglot) |
| Documentation currency on user-facing API surfaces | ≤180 days | Last-modified timestamp on doc files; vs API surface diff |
| Expand-contract migration conformance | 100% | Per `rules/hatch3r-migrations.md` — expand → migrate → contract phases |
| API breaking-change events on stable endpoints | 0 per release | `oasdiff` (OpenAPI), `buf breaking` (protobuf), `graphql-inspector diff` (GraphQL SDL) |
| ADR presence on architectural-decision-class changes | 100% | Nygard-format ADR with one of {Proposed, Accepted, Superseded, Deprecated} |

## Duplication Scan

Run `npx jscpd` against in-scope directories every cycle and surface the JSON report path in the finding. The duplication-index is the percentage of duplicated tokens over total tokens — not the percentage of duplicated lines. Configure the scan via `.jscpd.json` with:

- `min-tokens: 50`
- `min-lines: 5`
- `ignore: ["**/__tests__/**", "**/node_modules/**", "**/dist/**", "**/build/**"]`
- `reporters: ["json", "console"]`

Critical-path duplication (auth, payment, settlement, ledger) is escalated regardless of the global index — even <5% global can hide a duplicated security-critical helper.

## Pattern-Reuse Ratio

Count reused vs newly-authored patterns per diff:

- **Reused** — code references a named existing module (e.g. `import { withCircuitBreaker } from '@/lib/resilience'`).
- **Newly-authored** — code introduces a new pattern that overlaps with an existing one.

Ratio target: ≥70% reused. Per cycle, list the named patterns with their canonical file path:

| Pattern | Canonical location |
|---------|--------------------|
| Circuit breaker | `src/lib/resilience/circuitBreaker.ts` (or project equivalent) |
| Retry with decorrelated jitter | `src/lib/resilience/retryWithBackoff.ts` |
| Error handler / RFC 9457 problem details | `src/lib/errors/problemDetails.ts` |
| Idempotency-Key handler | `src/lib/middleware/idempotencyKey.ts` |

Authoring a fifth circuit-breaker implementation in `src/auth/jwt.ts` is a CQ8 violation regardless of unit-test quality.

## Cyclomatic Complexity

Per function, complexity ≤10 (McCabe). Configure linter rules:

- **JS/TS:** ESLint `complexity: ['error', 10]`.
- **Python:** `radon cc -s -n B` (block B threshold = 6-10).
- **JVM:** detekt `ComplexMethod: threshold=10`, ktlint, or Checkstyle `CyclomaticComplexity max=10`.
- **Go:** `gocyclo -over 10 ./...`.
- **Rust:** `cargo clippy -- -W clippy::cognitive_complexity`.

Functions above the threshold MUST be refactored before merge unless an explicit exception is documented in an ADR (see ADR Presence below).

## Expand-Contract Migrations

Source: `rules/hatch3r-migrations.md`. Schema migrations on shared databases (multi-deploy environments) follow the three-phase pattern:

1. **Expand** — add the new column/table/index in a backward-compatible way. Old code keeps working.
2. **Migrate** — backfill data; deploy code that writes to both old + new locations or reads from both.
3. **Contract** — remove the old column/table/index after the migrate phase is verified.

Destructive single-deploy schema changes (drop column, rename column without alias, alter type without conversion) are CRITICAL findings. The specialist names the missing phase in the finding.

## API Breaking-Change Discipline

On stable endpoints (versioned `v1`, `v2`; or unversioned with public-consumer commitment), zero breaking changes per release. Run the per-spec diff tool in CI:

- **OpenAPI 3.x:** `oasdiff breaking --fail-on-diff` exits non-zero on breaks.
- **Protobuf:** `buf breaking --against '.git#branch=main'` exits non-zero.
- **GraphQL SDL:** `graphql-inspector diff schema.graphql https://api/graphql --rule considerUsage`.

A breaking change requires a major-version bump per semver 2.0.0 (semver.org). Bypass requires a documented deprecation timeline per `rules/hatch3r-api-versioning.md` — `Deprecation` (RFC 9745) + `Sunset` (RFC 8594) headers + migration guide.

## ADR Presence

Architectural-decision-class changes per `rules/hatch3r-code-standards.md` ADR-trigger list require a Nygard-format ADR with status one of {Proposed, Accepted, Superseded, Deprecated}. Triggers:

- New external dependency (npm package, system tool, managed service).
- Cross-module API change (public interface, exported types, plugin contract).
- Performance trade-off requiring documentation (caching strategy, batch size, partition scheme).
- Security trade-off requiring documentation (auth flow choice, token TTL, encryption algorithm).

ADRs live under `docs/adr/NNNN-{slug}.md` (or project equivalent) and are linked from the PR description.

## Specialist Agent Routing

| Trigger | Route to |
|---------|----------|
| Any code mutation | `agents/hatch3r-maintainability.md` (post-write duplication + complexity scan) |
| Schema or migration file modified | `agents/hatch3r-maintainability.md` (expand-contract conformance) |
| API spec (OpenAPI / GraphQL SDL / protobuf / AsyncAPI) modified | `agents/hatch3r-maintainability.md` (breaking-change diff) |
| Architectural decision per ADR-trigger list | `agents/hatch3r-maintainability.md` (ADR presence audit) |
| Pre-write duplication scan during Implementer phase | `agents/hatch3r-maintainability.md` invoked by `agents/hatch3r-implementer.md` post-write |
| Release-prep audit | `agents/hatch3r-maintainability.md` |

## Per-Finding Output Format

Every finding emitted under this rule MUST include the rigor-contract fields per `agents/shared/rigor-contract.md`:

- `proof_trace`: file:line citation + jscpd/oasdiff/buf-breaking output excerpt.
- `impact_horizon`: short | medium | long per CONSTITUTION Decision 17.
- `progress_toward_pillar: content-quality.CQ8+<delta>`: numeric delta against the threshold.
- `confidence`: high | medium | low with explicit basis.
- `causal_chain`: ≥3-step linkage from observation → root cause → impact.

## Severity Mapping

Source: `agents/shared/severity-mapping.md`.

| Specialist Status | Canonical Severity | Action |
|-------------------|--------------------|--------|
| `CRITICAL` | Critical | Destructive single-deploy migration; breaking change on stable endpoint without major-version bump; missing ADR on decision-class change |
| `FINDINGS` | High + Medium | Duplication-index >5%; pattern-reuse ratio <70%; cyclomatic complexity >10; documentation staleness >180 days |
| `PASS` | Low + Info | All thresholds met; surface in iteration summary |

## When to Invoke

- Every PR that mutates code, schema, or API spec.
- `agents/hatch3r-implementer.md` invokes this rule's checks post-write to scan its own diff for duplication before declaring completion (anti-duplication procedure per `agents/shared/quality-charter.md` §12).
- Pre-merge full CQ8 gate — duplication + complexity + pattern-reuse + migration + API-breaking + ADR-presence.
- Schema-change audits — any migration file triggers an expand-contract conformance scan.
- API-change audits — any diff touching `openapi.yaml`, `openapi.json`, `*.proto`, or GraphQL SDL triggers the breaking-change CI gate.
- Release-prep audit before publishing.

## References

- Pillar CQ8 (measurement set + specialist owner; see `agents/shared/principles.md`).
- The prompt-engineering and compound-system audit domains (maintainability domains).
- `agents/hatch3r-maintainability.md` (CQ8 reviewer / gate).
- `rules/hatch3r-anti-duplication.md` (pre-implementation discovery gate).
- `rules/hatch3r-migrations.md` (expand-contract migration pattern).
- `rules/hatch3r-api-versioning.md` (semver + deprecation + sunset policy).
- `rules/hatch3r-code-standards.md` (ADR-trigger list).
- `rules/hatch3r-resilience-patterns.md` (named patterns for the reuse ratio).
