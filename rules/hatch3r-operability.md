---
id: hatch3r-operability
type: rule
description: Operability patterns in user code — liveness / readiness / startup probes, graceful shutdown, feature flags, runbook URL annotations, health endpoints
scope: "**/services/**,**/handlers/**,**/health*,**/probes/**,**/k8s/**,**/manifests/**,**/charts/**,**/feature*,**/flags/**"
tags: [implementation, devops]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Operability

## Liveness, Readiness, and Startup Probes (Kubernetes)

Three probe kinds; each answers a different question and triggers a different action. Conflating them is the most common operability bug — a liveness probe that reaches downstream causes pod-restart cascades on dependency outages.

- **Liveness** — shallow self-check: process alive, event loop responsive, no deadlock on the request handler. NEVER checks external dependencies. Failure → kubelet restarts the pod. Default: `httpGet /health/live`, `periodSeconds: 10`, `failureThreshold: 3`, `timeoutSeconds: 1`.
- **Readiness** — deep dependency check: DB reachable, cache reachable, required downstream healthy, migrations applied. Failure → endpoint controller removes the pod from Service load-balancer rotation; pod stays running and recovers when dependencies return. Default: `httpGet /health/ready`, `periodSeconds: 5`, `failureThreshold: 2`, `timeoutSeconds: 2`.
- **Startup** — same checks as readiness but with longer initial allowance for slow-starting apps (large model load, warm cache build, JIT warmup, schema migration). Once succeeds once, liveness and readiness take over. Default: `httpGet /health/startup`, `periodSeconds: 5`, `failureThreshold: 60` (allowing 5 minutes), `timeoutSeconds: 2`.

Concrete examples per ecosystem:

- **Node Express** — `/health/live`, `/health/ready`, `/health/startup` on the same router with different handler chains. The live handler returns 200 unconditionally if the event loop is responsive; the ready handler awaits `Promise.allSettled` over DB ping, cache ping, downstream ping with per-check 1s timeout.
- **Spring Boot Actuator** — `/actuator/health/liveness` and `/actuator/health/readiness` exposed out of the box; add startup via a custom `HealthIndicator`. Configure `management.endpoint.health.probes.enabled=true`.
- **Go (net/http)** — three handlers on `http.ServeMux`; ready handler aggregates checks via `errgroup.Group.Wait()` with per-check `context.WithTimeout`.

Anti-pattern: a single `/health` endpoint that both Kubernetes probes hit. The pod is killed during DB outage because the liveness probe failed on the same deep check the readiness probe is supposed to own.

## Graceful Shutdown

Handle `SIGTERM` per the sequence below. Skipping the preStop delay causes the well-known endpoint-propagation race that drops up to several seconds of in-flight traffic.

- Step 1: Stop accepting new connections (close the HTTP listener; stop pulling from the queue).
- Step 2: Mark `/health/ready` to return 503 (the endpoint controller removes the pod from the Service).
- Step 3: Wait `preStop` window of 1–3s for endpoint-removal propagation. Kubernetes does NOT propagate endpoint removal before delivering SIGTERM — without an explicit `preStop` `sleep`, traffic continues to arrive for the first 1–3s of shutdown.
- Step 4: Drain in-flight requests (configurable deadline 30–45s; cap by `terminationGracePeriodSeconds`).
- Step 5: Close DB connections, drain queue consumers, flush log buffers, close OpenTelemetry exporters.
- Step 6: Exit 0.

Pod manifest baseline:

```
terminationGracePeriodSeconds: 45
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 3"]
```

Force kill after grace period defeats the drain. If 45s is insufficient, raise `terminationGracePeriodSeconds` rather than skip the drain — but investigate why the service holds long-running requests at shutdown.

For queue consumers (Kafka, NATS, SQS): on SIGTERM stop pulling new messages first, finish in-flight processing, then commit offsets and disconnect. Skipping the commit step on shutdown produces duplicate processing on the next pod's first poll.

## Feature Flags — OpenFeature

OpenFeature is a CNCF Incubating SDK (pre-1.0 spec) that wraps any provider — LaunchDarkly, Unleash, Flagsmith, GrowthBook, Statsig — behind a consistent API. New code targets OpenFeature; provider-specific SDK imports become a finding.

Flag types by lifecycle:

- **Release flag** — gate new code path during rollout. Remove within 1 sprint of full enablement; otherwise it becomes flag debt.
- **Experiment flag** — A/B test traffic split for measurement. Retire after the experiment concludes and the decision is shipped.
- **Ops flag** — kill switch for risky features and feature-level circuit breakers. Permanent by design. Cross-reference the kill-switch pattern below.
- **Permission flag** — entitlement gating (per-tenant feature availability). Prefer reusing the authorization layer where possible; flag only the surface that the auth system does not naturally cover.

Flag-debt budget: 50–100 active flags per service. Run a monthly cleanup cadence — list flags with `enabled = true for 100% of traffic for >30 days` and either remove them or convert to permanent config.

Default-off for new release flags; default-on only for kill switches (so the absence of provider connectivity does not silently disable the feature the on-call needs to disable). Evaluate flags at request entry once and pass the resolved value down — re-evaluating mid-request risks split-brain behavior when the flag flips during the call.

## Kill-Switch Pattern

Every risky feature ships with a kill switch (Ops flag) and a documented procedure for flipping it. On-call must be able to disable the feature without redeploying. Document the flag name in `docs/runbooks/<service>.md` alongside the alert.

Test the kill switch on every release — a kill switch that nobody has flipped in production is unverified. Quarterly drill: flip the flag, observe the metric drop, restore.

Cross-reference `rules/hatch3r-progressive-delivery.md` — kill switch is the rollback mechanism when the staged rollout has already finished and the regression is discovered after 100%.

## Runbook URL on Every Alert

Alert without a runbook is a finding under this rule. Every alert carries a runbook URL annotation:

- **Prometheus:** `annotations.runbook_url: "https://internal.example.com/runbooks/<alert-name>.md"`.
- **Datadog / Grafana:** equivalent `runbook_url` or `notification_message` template field.

Runbook format:

- **Symptoms** — what the on-call sees on the dashboard or in the alert payload.
- **Triage** — first three commands or queries to narrow the cause.
- **Mitigation** — kill switch, rollback command, scale action.
- **Root cause** — links to past postmortems for similar symptoms.
- **Follow-ups** — open issues, related dashboards, owner team.

Empirical observation from 2024–2026 incidents: LLM-driven auto-diagnosis quality is dominated by runbook quality rather than by model choice. A high-fidelity runbook with concrete commands beats a generic prompt against a frontier model on the same dataset.

Runbooks live in the service repository under `docs/runbooks/<alert-name>.md` so they ship with the code that emits the alert. Renaming an alert without updating the runbook URL produces a 404 link from the alert payload — a CI check on the alert manifest catches this on every PR that touches alert names.

## Health Endpoint Conventions

- `/health/live` — 200 + `{ "status": "ok", "version": "<semver>", "build_sha": "<short-sha>" }` on success; 503 + `{ "status": "down", "reason": "<diagnostic>" }` on failure.
- `/health/ready` — same shape; 503 includes the failing downstream name (e.g. `reason: "postgres-primary unreachable"`).
- `/health/startup` — same as ready but with allowance for warmup.

Never expose secrets, connection strings, or per-request internals from health endpoints — they are unauthenticated by default. Detailed diagnostics live behind authentication on a separate admin endpoint.

Probe response time budget: under 100ms for `/health/live`, under 500ms for `/health/ready` and `/health/startup`. A probe that times out the kubelet causes pod restart cascades unrelated to the underlying issue.

Cache the ready-check result for 1–2s — Kubernetes polls every 5s by default; checking each downstream on every poll multiplies dependency load by the replica count.

## Capacity Planning

- Nightly load test in CI against a staging environment representative of production. Compare baseline-vs-current p50, p95, p99 latency and error rate; fail the run on a 20% regression vs the previous green baseline.
- Saturation tracking — alert when CPU sustained above 70% for 15 minutes, memory above 80% for 15 minutes, connection pool above 80% utilization for 5 minutes.
- Rightsizing — target 20–30% headroom on CPU and memory at peak. Below 10% headroom is undersized; above 50% sustained is oversized and a cost finding.
- HPA (Horizontal Pod Autoscaler) target CPU at 60–70% — leaves room for the scale-up lag to bring new replicas online before the existing pods saturate.
- Cold-start budget for serverless and JVM services: measure p95 cold-start latency; provision the warm-pool to keep cold-start traffic below 1% of total. KEDA or platform autoscaler keeps the warm-pool at the right size.

## Multi-Region and Disaster Recovery

- RTO (Recovery Time Objective) and RPO (Recovery Point Objective) documented per service tier in the service catalog.
- Active-active for tier-1 services targeting RTO under 5 minutes and RPO under 1 minute.
- Active-passive acceptable for tier-2 services targeting RTO under 1 hour.
- Failover drill quarterly; the drill is the test of the runbook. A runbook that has not been executed in a drill is a draft, not a runbook.
- Data residency — honor regional data boundaries (EU-US DPF, regional cloud regions). Cross-region replication respects the residency contract.
- DNS-based failover (Route 53, Cloud DNS) has a propagation tail measured in minutes; for sub-minute RTO use load-balancer-level failover (cross-region target groups) or anycast.

## 2024–2026 Outage Lessons

- **CrowdStrike, July 2024** — global config push without canary. Mitigation: staged rollout (cross-reference `rules/hatch3r-progressive-delivery.md`).
- **AWS us-east-1, October 2025** — cascading failure across services with hidden us-east-1 control-plane dependency. Mitigation: dependency mapping, multi-region for control plane.
- **Azure East-US2, September 2025** — single-region outage on customer-perceived multi-region service. Mitigation: active-active across regions.
- **Cloudflare, November 2025** — config-change incident. Mitigation: treat config as code, canary config changes.

Most outages have an organizational root cause (change management, capacity planning, ownership). The patterns above defend against the technical leg of the failure; organizational defenses are out of scope for this rule.

Postmortem cadence: within 5 business days of incident close, blameless, owned by the on-call rotation, action items tracked in the service backlog with target due dates. Postmortem reviewers cross-check that the runbook was updated and that an automated detection (alert, dashboard, or unit test) was added for the failure mode that escaped detection.

## Cross-References

- `rules/hatch3r-resilience-patterns.md` — circuit breakers, retries, timeouts.
- `rules/hatch3r-progressive-delivery.md` — canary, blue-green, kill-switch usage during rollout.
- `rules/hatch3r-observability-metrics.md` — SLOs, RED metrics, burn-rate alerts feed the runbook.

## References

- Kubernetes probes — `kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes`
- Kubernetes pod termination — `kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination`
- Google SRE workbook, graceful-shutdown chapter — `sre.google/workbook`
- OpenFeature specification — `openfeature.dev`
- LaunchDarkly docs — `docs.launchdarkly.com`
- Unleash docs — `docs.getunleash.io`
- 2024–2026 outage postmortems: CrowdStrike Jul 2024, AWS us-east-1 Oct 2025, Azure East-US2 Sep 2025, Cloudflare Nov 2025.
