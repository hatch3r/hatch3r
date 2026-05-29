---
id: hatch3r-scalability-rule
type: rule
description: CQ6 Scalability Quality measurement rule — stateless-handler ratio, back-pressure pattern adoption, idempotency-key adoption on POST/PUT/PATCH, queue offloading for >1s ops, pool sizing per concurrency profile
scope: conditional
globs: "**/handlers/**,**/routes/**,**/services/**,**/api/**,**/workers/**,**/queues/**,**/jobs/**,**/middleware/**,**/handler*,**/route*,**/worker*,**/queue*"
tags: [review, scalability, floor:content-quality]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Scalability Quality (CQ6)

**Pillars:** P2 (Scientific & Practical Quality), CQ6 (Scalability Quality)

## Scope

This rule binds the CQ6 measurement set across end-user services that hatch3r-generated agents produce. It owns:

- The stateless-handler ratio floor on user-facing routes.
- The back-pressure pattern adoption gate on high-fan-out endpoints.
- The Idempotency-Key adoption floor on POST/PUT/PATCH endpoints.
- The queue-based offloading gate for >1s operations.
- The database connection pool sizing rule per concurrency profile.
- Specialist routing to `agents/hatch3r-scalability.md`.

This complements (does not duplicate) `rules/hatch3r-resilience-patterns.md` (circuit breakers + retry-with-jitter + timeouts on outbound calls). Resilience is failure handling; scalability is horizontal-growth capability.

## CQ6 Threshold Set

Source: `governance/CONSTITUTION.md` §2B CQ6. Every threshold below is measurable per audit cycle; missing measurement is a Medium finding minimum.

| Threshold | Target | Measurement source |
|-----------|--------|--------------------|
| Stateless-handler ratio | ≥95% on user-facing routes | Static scan: in-memory session state, module-level mutable globals, sticky-session assumptions in `app/`, `src/handlers/`, `src/routes/`, `pages/api/`, `apps/api/` |
| Back-pressure pattern adoption | 100% on high-fan-out endpoints | Named pattern (semaphore, queue depth limit, rejection threshold) with documented thresholds |
| Idempotency-Key adoption | 100% on POST/PUT/PATCH endpoints | Stripe pattern — header acceptance + dedup-result storage + named TTL |
| Queue-based offloading | 100% for operations >1s | Background-job system + retry policy + dead-letter queue (DLQ) |
| Connection pool sizing | Per concurrency profile | `pool_size = expected_concurrent_requests × avg_query_time / target_p99` per `agents/hatch3r-scalability.md` §Pool sizing |
| Horizontal-scaling validation | Load tests at target scale | p99 latency within budget; no resource-pool exhaustion |

## Stateless-Handler Pattern

A handler is stateless when ALL hold:

- No module-level mutable globals (`let counter = 0` at module scope; `Map` instances re-used across requests).
- No in-process session storage (sessions stored in Redis, JWT, cookie store — externalized per `rules/hatch3r-auth-patterns.md`).
- No sticky-session assumption (no logic that depends on the same physical instance handling consecutive requests from the same client).
- No file-system cache at module scope (caches MUST live in Redis or a distributed store).

Per-request request-scoped state is fine. The test is: can two requests from the same client land on different instances and both succeed? If yes, stateless.

## Back-Pressure Pattern

A handler is back-pressured when it explicitly bounds in-flight work. Allowed patterns:

- **Semaphore** — fixed concurrency cap per handler; new requests reject 429 once the cap is reached.
- **Queue depth limit** — work pushed onto a queue with a max depth; producer rejects when full.
- **Rejection threshold** — load-shedding when p99 latency exceeds a documented budget.
- **Token bucket** — rate-limit per client identifier with named refill rate.

Implicit back-pressure (relying on TCP backlog, OS file-descriptor exhaustion, or queue-server overflow) does not satisfy this rule. The handler MUST cite the pattern name + threshold value in a comment near the entry point.

## Idempotency-Key Adoption

Source: Stripe `Idempotency-Key` header pattern (https://docs.stripe.com/api/idempotent_requests). On every POST/PUT/PATCH endpoint:

1. Accept the `Idempotency-Key` request header (UUID v4 client-generated).
2. On first observation, persist the request hash + response to a dedup store (Redis with TTL ≥24h, or database table with TTL index).
3. On repeat observation within TTL, return the persisted response without re-executing the operation.
4. Document the TTL in the handler comment + the API spec.

Endpoints that explicitly DO NOT mutate state (GET, HEAD, OPTIONS) do not require the key. Endpoints that are inherently idempotent (DELETE with same target) MUST still accept the key for client convenience.

## Queue-Based Offloading

Operations >1s wall-clock MUST be moved off the request path:

- **Job queue** — Sidekiq, BullMQ, Celery, Hangfire, Quartz; named retry policy (exponential backoff with jitter; max attempts; DLQ).
- **Async response pattern** — return 202 Accepted with a `Location` header pointing to a status endpoint; client polls or uses webhook callback.
- **Server-Sent Events / WebSocket** — for streaming progress on long operations.

Synchronous handlers performing >1s work without offloading are a CRITICAL finding from the specialist. The 1s threshold is measured at p95 of historical traffic; not the modal time.

## Database Connection Pool Sizing

Pool size = `expected_concurrent_requests × avg_query_time / target_p99`. Audit pool-size config against:

- `expected_concurrent_requests` = handler concurrency × instance count × steady-state RPS share.
- `avg_query_time` = p50 query time from observability — cite the data source.
- `target_p99` = SLO budget for handler latency — cite the SLO declaration.

Over-sizing the pool exhausts the database's `max_connections`; under-sizing queues requests and inflates p99. The formula MUST appear in a comment in the pool-init code, with the three values populated from the current measurement.

## Specialist Agent Routing

| Trigger | Route to |
|---------|----------|
| Handler / route definition added or modified | `agents/hatch3r-scalability.md` (CQ6 review / gate) |
| Queue client / connection-pool config modified | `agents/hatch3r-scalability.md` |
| Session storage / cache-layer change | `agents/hatch3r-scalability.md` + `rules/hatch3r-auth-patterns.md` |
| New endpoint that performs >1s work, accepts POST/PUT/PATCH, or runs on a horizontally-scaled tier | `agents/hatch3r-scalability.md` (Implementer pre-write) |
| Load-test pre-release | `agents/hatch3r-scalability.md` |
| Capacity-planning audit (new tenant, marketing event, geographic expansion) | `agents/hatch3r-scalability.md` |

## Per-Finding Output Format

Every finding emitted under this rule MUST include the rigor-contract fields per `governance/audit/templates/rigor-contract.md`:

- `proof_trace`: handler:line citation + measurement excerpt.
- `impact_horizon`: short | medium | long per CONSTITUTION Decision 17.
- `progress_toward_pillar: content-quality.CQ6+<delta>`: numeric delta against the threshold.
- `confidence`: high | medium | low with explicit basis.
- `causal_chain`: ≥3-step linkage from observation → root cause → impact.

## Severity Mapping

Source: `governance/audit/templates/severity-mapping.md`.

| Specialist Status | Canonical Severity | Action |
|-------------------|--------------------|--------|
| `CRITICAL` | Critical | Sync >1s op without offloading; missing Idempotency-Key on POST/PUT/PATCH; sticky-session dependency on horizontally-scaled tier |
| `FINDINGS` | High + Medium | Stateless-handler ratio <95%; missing back-pressure on high-fan-out endpoint; pool sizing without formula |
| `PASS` | Low + Info | All thresholds met; surface in iteration summary |

## Irreversibility Trigger

Any recommendation that increases connection-pool sizes, changes queue topology (visibility timeout, partition count, DLQ binding), or removes a sticky-session strategy is irreversible at production traffic. These changes MUST go through `agents/shared/user-question-protocol.md` per `rules/hatch3r-clarification-default.md` B1 before action.

## When to Invoke

- Every PR that adds or modifies request handlers, route definitions, queue clients, or connection-pool config.
- Every new endpoint that performs >1s work, accepts POST/PUT/PATCH, or runs on a horizontally-scaled tier.
- Every change touching session storage, cache layers, or background-job systems.
- Capacity-planning audits when service traffic projections change (new tenant onboarding, marketing event, geographic expansion).
- Load-test pre-release before any release that claims horizontal-scaling capability or a new concurrency tier.

## References

- `governance/CONSTITUTION.md` §2B CQ6 (measurement set + specialist owner).
- `governance/audit/domains/D11-content-quality-foundation.md` (D11 reliability + scalability foundation).
- `agents/hatch3r-scalability.md` (CQ6 reviewer / gate).
- `rules/hatch3r-resilience-patterns.md` (failure-handling patterns — distinct from horizontal-growth).
- `rules/hatch3r-auth-patterns.md` (externalized session storage).
- Stripe `Idempotency-Key` reference: https://docs.stripe.com/api/idempotent_requests.
