---
id: hatch3r-scalability-verify
name: hatch3r-scalability-verify
type: skill
description: Scalability verification gate before commit/release — stateless-handler ratio, back-pressure patterns, idempotency-key adoption, queue-based offloading, pool sizing, bulkheads, load-test pass at target scale
tags: [review, scalability, floor:content-quality, tier:scaleup-plus]
scope: conditional
globs: "src/handlers/**,src/routes/**,src/services/**,src/workers/**,**/k8s/**,**/manifests/**,**/k6/**,**/locust/**,**/gatling/**"
precedence: normal
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Scalability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping service code on horizontally-scaled tiers. Run before declaring a feature complete. The 8 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (load test at target scale). Skipping any gate = the feature is not done. Functional tests passing alone do not satisfy this bar — a stateful handler on a horizontally-scaled tier breaks on the Nth request; a POST endpoint without `Idempotency-Key` duplicates side effects under retry storm.

Inputs the skill expects:

- A repository with `src/` (handlers, routes, services, workers).
- A connection-pool config file (`pgbouncer.ini`, `knexfile.js`, `prisma.schema`, `application.yml` with HikariCP, `database.yml`).
- A queue client configuration (SQS, Kafka, Redis Streams, Bull/BullMQ, Sidekiq, Celery).
- A load-test script under `k6/`, `locust/`, or Gatling sims when claiming horizontal scaling.
- A documented concurrency profile naming target RPS, peak RPS, and burst multiplier.

Outputs the skill produces: an 8-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/scalability-verify-<sha>.json` for downstream consumption by `hatch3r-release`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Default path, not exception. Triggers for THIS skill: service / handler scope, target scale (current p99 vs 10x vs named load-test peak), gate selection (back-pressure vs idempotency vs pool-sizing vs full), concurrency envelope (steady-state RPS, peak RPS, burst multiplier), and topology (single-zone vs multi-region). Pool-size increases, queue-topology changes, and sticky-session removals are irreversible at production traffic — these MUST go through the protocol before action.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each scalability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-scalability.md` — invokes this skill as the closing scalability gate (CQ6) on PRs touching service code or scaling config. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 8-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW.

## Gate 1: Stateless-handler ratio ≥95%

- Handler scan reports no in-memory session state, no module-level mutable globals, no sticky-session assumption on horizontally-scaled tiers.
- Verified by AST grep against handler entry points: `req.session`, module-scope `let`/`var` mutables, in-process LRU caches keyed by `userId`.
- Session storage externalized to Redis / JWT / signed-cookie.
- <95% on user-facing routes → CRITICAL (load balancer round-robins break user state on every Nth request).

## Gate 2: Request-coalescing + back-pressure on high-fan-out endpoints

- Named pattern (semaphore via `p-limit`/`async-sem`, queue-depth limit via reverse-proxy LimitReqZone, token-bucket via Envoy `local_ratelimit`).
- Documented rejection threshold and queue-depth telemetry.
- Reject with HTTP 429 + `Retry-After` when threshold exceeded; never silently buffer beyond `max_inflight`.
- Coalesce duplicate in-flight requests by request-key hash (singleflight pattern).

## Gate 3: Database connection pool sizing per concurrency profile

- `pool_size = ceil(expected_concurrent_requests × avg_query_time_ms / target_p99_ms)` documented in config alongside the inputs.
- Hard cap below the database's `max_connections × 0.7` for admin sessions + replicas.
- PgBouncer in `transaction` mode where pool-per-connection cost is the constraint.
- Pool sized to dependency, not to handler concurrency. Mis-sizing → FINDINGS at High when pool exhaustion observed in load test.

## Gate 4: Idempotency-Key on every POST/PUT/PATCH

- Header acceptance + dedup-result storage per Stripe pattern.
- Dedup window ≥24h (Stripe default), key length up to 255 chars, stored result returned on retry regardless of original success/failure.
- Conflict semantics defined: same key + different request body → HTTP 422 with `idempotency_key_conflict`.
- Missing on irreversible POST endpoint (payment, account creation) → CRITICAL.

## Gate 5: Queue-based offloading for >1s operations

- Background-job system (SQS / Kafka / Redis Streams / BullMQ / Sidekiq / Celery) with retry policy (decorrelated jitter per AWS Architecture Blog).
- DLQ binding (max 3-5 attempts) + per-job idempotency at the handler level.
- Enqueuer commits the database transaction before publishing (staged-jobs pattern); no synchronous >1s work on user-facing paths.
- Visibility timeout ≥ p99 job duration × 2.

## Gate 6: Bulkheading — resource pools isolated by tenant or critical path

- Separate connection pools (or pool partitions) for tenant tiers (free / paid / enterprise) or critical-vs-batch paths.
- Documented limits per pool prevent cascade failure when one tenant or one downstream dependency saturates.
- Pattern: Netflix Hystrix-style bulkhead with `maxConcurrentExecutions` per dependency.
- Missing bulkhead between tenant tiers → Medium FINDINGS (one large tenant's burst impacts every other tenant's p99).

## Gate 7: Connection-pool exhaustion monitored (USE method)

- Pool queue depth (`pool.waiting`), pool wait time (`pool.acquire_duration_p99`), and pool saturation (`active / max`) emit metrics per Google SRE USE method (Utilization, Saturation, Errors).
- Saturation alerts wired with multi-window multi-burn-rate (2%/5%/10% per Google SRE workbook).
- Alert when `pool.waiting > 0` for >30s OR `active/max > 0.8` for >2min.
- Telemetry harness reuse: `skills/hatch3r-observability-verify` Gate 4 (RED+USE metrics).

## Gate 8: Horizontal scaling validated via load test

- k6 / Locust / Gatling run at named target RPS captures p99 latency, error rate, and pool-saturation metrics.
- p99 within the documented budget; zero pool exhaustion events; idempotency-key dedup verified by replaying ≥10% of requests at peak.
- Replicas auto-scale within target time (HPA / KEDA reaching target replica count within 2min on CPU > 70% or queue-depth threshold).
- Load-test result attached to the PR or release notes.

## Pass criteria

All 8 gates pass = the feature is "done" enough to ship to production. Anything less = not done.

- Stateless-handler ratio: ≥95% on user-facing routes.
- Back-pressure pattern: named + documented threshold on every high-fan-out endpoint.
- Pool sizing formula: documented + inputs visible in config.
- Idempotency-Key adoption: 100% on POST/PUT/PATCH; dedup window ≥24h.
- Queue offload: 100% of >1s operations; DLQ + decorrelated jitter + visibility ≥ p99 × 2.
- Bulkhead: present on multi-tenant or critical-vs-batch surfaces.
- Pool-saturation metrics + alerts: present per USE method.
- Load test at target RPS: p99 within budget, 0 pool exhaustion, ≥10% dedup replay verified.

## On fail

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of functional-test status.

Failure escalation per `agents/hatch3r-scalability.md` severity calibration: Gate 1 fail (stateful handler on horizontally-scaled tier without sticky-session strategy) → CRITICAL; Gate 4 fail (POST without Idempotency-Key on irreversible side effects) → CRITICAL; Gate 5 fail (>1s synchronous work on user-facing route) → High; Gates 3/6/7 → Medium; Gate 8 incomplete (no load test) → headroom-unstated Info but ship-block High when target unmet.

## When this skill runs

- Reviewer pass on PRs that add or modify request handlers, route definitions, queue clients, or connection-pool config.
- Implementer pre-write for any new endpoint that performs >1s work, accepts POST/PUT/PATCH, or runs on a horizontally-scaled tier.
- Verifier pre-merge gate for changes touching session storage, cache layers, or background-job systems.
- Capacity-planning audit when service traffic projections change.
- Load-test pre-release before any release claiming horizontal-scaling capability.

## Cross-References

- `rules/hatch3r-api-design.md` — idempotency requirement.
- `rules/hatch3r-reliability.md` — bulkheads section.
- `rules/hatch3r-observability-metrics.md` — USE method + burn-rate alerts.
- `skills/hatch3r-observability-verify` — telemetry harness reuse for Gate 7.
- `agents/shared/quality-charter.md` §Reliability quality + §API quality.

## References

- Stripe Idempotent Requests — `docs.stripe.com/api/idempotent_requests`
- Stripe staged-jobs pattern — `stripe.com/blog/idempotency`
- Brandur Leach Idempotency Keys in Postgres — `brandur.org/idempotency-keys`
- Google SRE USE method (Brendan Gregg) — `www.brendangregg.com/usemethod.html`
- AWS Architecture Blog decorrelated jitter — `aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/`
- k6 documentation — `k6.io/docs/`
- Stateless services failure modes — `medium.com/codeelevation/why-stateless-services-quietly-break-in-real-systems-and-how-to-fix-them-24fc20951046`
