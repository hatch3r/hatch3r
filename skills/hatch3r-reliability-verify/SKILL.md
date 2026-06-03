---
id: hatch3r-reliability-verify
name: hatch3r-reliability-verify
type: skill
description: Reliability verification gate before declaring an agent-produced service done — SLO defined, kill switch, timeouts, retries, probes, runbook, staged rollout
tags: [review, devops, tier:scaleup-plus]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Reliability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping a service to production. Run before declaring a feature complete. The 9 gates below are machine-checkable on the manifest, the source, and the alert configuration. Skipping any gate = the feature is not done. Functional tests passing alone do not satisfy this bar — a service that lacks an SLO, a kill switch, or a runbook will fail in production before its first alert reaches the on-call.

Inputs the skill expects:

- A service repository with `src/` and `k8s/` (or equivalent manifest path).
- A `docs/runbooks/` directory.
- Either a `slo/` directory or inline SLO definitions in the alert manifest (Prometheus rules, Datadog monitors, OpenSLO YAML).

Outputs the skill produces: a 9-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/reliability-verify-<sha>.json` for downstream consumption by `hatch3r-release` (or any downstream release-prep skill).

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: service scope, SLO target values and window, rollout strategy (canary stages, hold durations), kill-switch authority and provider, and blast-radius rollback drill cadence.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each reliability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-reliability.md` — invokes this skill as a closing reliability gate (CQ4), alongside `skills/hatch3r-observability-verify` for the telemetry sub-vector. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 9-gate procedure (SLO, kill switch, timeouts, retries, probes, runbook, staged rollout).

No duplication: the agent decides WHEN, this skill defines HOW. The agent body cites this skill (`agents/hatch3r-reliability.md` — "cite `skills/hatch3r-reliability-verify` ... as the closing gates"); this subsection is the symmetric upstream citation per `rules/hatch3r-agent-orchestration.md` (Phase-4 dispatch).

## Gate 1: SLO defined

- The service has at least one Service Level Objective with target percentile, evaluation window, and a wired burn-rate alert.
- Format: `availability >= 99.9% over rolling 28d` or `p95 latency <= 300ms over rolling 28d`.
- Burn-rate alert pattern: multi-window multi-burn-rate (Google SRE) — fast burn (14.4x over 5m AND 6x over 1h) pages immediately; slow burn (3x over 6h AND 1x over 3d) opens a ticket.
- Output: SLO manifest path committed to the repo (e.g. `slo/<service>.yaml` or a Sloth / OpenSLO file).
- Check: grep for `slo:` or `objectives:` in the service manifest; reject if absent.
- Cross-reference: `rules/hatch3r-observability-metrics.md`.

## Gate 2: Kill switch present

- Every risky feature is gated by an OpenFeature Ops flag with a documented flip procedure.
- The flag name appears in `docs/runbooks/<service>.md` next to the alert that would trigger its use.
- Default-on with OFF override; provider connectivity loss does not silently disable the kill switch.
- Check: open the runbook, locate the flag name, confirm a flip-procedure step exists with the exact CLI or UI action.
- Cross-reference: `rules/hatch3r-operability.md` §Feature Flags.

## Gate 3: Timeouts on every outbound call

- Every DB, cache, queue, external HTTP, and external RPC call has an explicit timeout.
- Deadline propagation verified: parent timeout reaches child via `context.WithDeadline` (Go), chained `AbortSignal` (Web/Node), `Deadline` metadata (gRPC), or `TimeLimiter` (JVM).
- Default budgets: service-call 5s, DB 2s, cache 200ms, health-probe 1s.
- Check: grep the codebase for outbound-call sites and confirm each has a timeout argument or wrapper.
- Cross-reference: `rules/hatch3r-resilience-patterns.md` §Timeouts.

## Gate 4: Retries with decorrelated jitter

- Outbound calls wrap in a retry library — `opossum` (Node), `resilience4j` (JVM), `Polly` (.NET), `gobreaker` + `cenkalti/backoff` (Go), or `pybreaker` + `tenacity` (Python).
- Retry algorithm is decorrelated jitter: `sleep = min(cap, random_between(base, prev_sleep * 3))` with base 100ms, cap 30s, max 3 retries.
- `Idempotency-Key` header present on retried non-idempotent operations (POST, PATCH).
- Retry budget enforced: retry traffic capped at 10% of base traffic.
- Cross-reference: `rules/hatch3r-resilience-patterns.md` §Retry.

## Gate 5: Probes wired

- Kubernetes manifest defines `livenessProbe`, `readinessProbe`, and (for slow-starting services) `startupProbe`.
- Liveness is shallow (no downstream check); readiness is deep (downstream pings).
- Distinct endpoints — `/health/live`, `/health/ready`, `/health/startup` — not a single shared `/health`.
- Probe timeouts under 1s for live, under 2s for ready; periods 10s / 5s / 5s.
- Check: parse the k8s manifest YAML and verify `livenessProbe.httpGet.path != readinessProbe.httpGet.path` (shared endpoints fail this gate).
- Cross-reference: `rules/hatch3r-operability.md` §Probes.

## Gate 6: Graceful shutdown

- SIGTERM handler closes the listener, marks `/health/ready` to 503, then drains in-flight requests.
- `preStop` hook delays 1–3s before SIGTERM to handle the endpoint-propagation race.
- `terminationGracePeriodSeconds >= 45`.
- Queue consumers commit offsets before disconnect.
- Cross-reference: `rules/hatch3r-operability.md` §Graceful Shutdown.

## Gate 7: Runbook URL on every alert

- Every Prometheus / Datadog / Grafana alert has a `runbook_url` annotation linking to `docs/runbooks/<alert-name>.md`.
- Runbook contains the 5 required sections: Symptoms, Triage, Mitigation, Root cause, Follow-ups.
- CI check on the alert manifest fails any alert without `runbook_url` or with a 404 link.
- Cross-reference: `rules/hatch3r-operability.md` §Runbook URL.

## Gate 8: Staged rollout configured

- Deployment uses Argo Rollouts, Flagger, or an equivalent controller with canary or blue-green configured.
- Stage cadence: 1% → 10% → 50% → 100% with minimum holds 30 min / 1 h / 2 h.
- Auto-rollback wired to the service SLO burn-rate alert (fast-burn triggers immediate rollback).
- Canary analysis gates error-rate ratio, p95/p99 latency, and business KPIs against a live baseline.
- Check: locate the `Rollout` or `Canary` resource in the deploy directory; reject if missing or if `steps:` skips the 1% stage.
- Cross-reference: `rules/hatch3r-progressive-delivery.md`.

## Gate 9: Blast-radius documented

- PR description includes the blast-radius block: services affected, regions, traffic %, rollback time target (<5 min), exact rollback command.
- Rollback command verified by quarterly drill — drill date recorded in the runbook.
- Database migrations follow expand-contract; no destructive migration ships in the same deploy as the consuming code.
- Check: parse the PR body for the `## Blast radius` section; reject if absent or if any required field is empty.
- Cross-reference: `rules/hatch3r-progressive-delivery.md` §Blast-Radius Reasoning.

## Verdict

All 9 gates pass = the service is "done" enough to ship to production. Anything less = not done; the missing gates are findings against this skill.

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of functional-test status.

Evidence path format: `path/to/file.yaml:LN` or `commit-sha`. The verdict is auditable — a downstream review or release-gate skill can replay the same checks against the same evidence paths and reproduce the verdict bit-for-bit.

Gates run independently — a FAIL on Gate 3 does not short-circuit the remaining gates; the run produces the full 9-line verdict so the developer fixes everything in one pass rather than serializing on rerun cycles.

## When this skill runs

- After `hatch3r-implementer` finishes service code and before `hatch3r-qa-validation` runs.
- On every PR that touches `src/services/`, `src/handlers/`, `src/clients/`, `k8s/`, `manifests/`, or the alert / SLO configuration.
- Gate 9 (drill verification) requires manual confirmation from the on-call rota at release-cut time, not per PR.
- New-service bootstrap: run the full 9 gates before the first production deploy; failing any one is a blocker, not a follow-up.

## Cross-References

- `rules/hatch3r-resilience-patterns.md` — circuit breakers, retries with decorrelated jitter, idempotency keys.
- `rules/hatch3r-operability.md` — probes, graceful shutdown, kill switches, runbooks.
- `rules/hatch3r-progressive-delivery.md` — canary, blue-green, auto-rollback on SLO burn.
- `rules/hatch3r-observability-metrics.md` — SLOs, RED metrics, burn-rate alerts.

## References

- Google SRE workbook — `sre.google/workbook`
- Kubernetes probes — `kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes`
- Argo Rollouts — `argoproj.github.io/argo-rollouts`
- Flagger — `flagger.app`
- OpenFeature — `openfeature.dev`
- opossum (Node) — `github.com/nodeshift/opossum`
- resilience4j (JVM) — `resilience4j.readme.io`
- Polly (.NET) — `pollydocs.org`
- Sloth (Prometheus SLO generator) — `sloth.dev`
- OpenSLO specification — `openslo.com`
