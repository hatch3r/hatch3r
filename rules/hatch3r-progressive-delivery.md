---
id: hatch3r-progressive-delivery
type: rule
description: Progressive delivery — canary, blue-green, feature-flag rollout with auto-rollback on SLO burn; staged rollout to prevent CrowdStrike-class incidents
scope: "**/.github/workflows/**,**/deploy/**,**/k8s/**,**/manifests/**,**/argo/**,**/flagger/**,**/spinnaker/**,**/rollout*"
tags: [devops]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Progressive Delivery

## Three Rollout Strategies

Choose one per service based on risk profile and resource budget:

- **Canary** — shift traffic in increments (1% → 10% → 50% → 100%) over hours; analyze metrics at each stage; auto-rollback on SLO burn. Argo Rollouts is the most-deployed Kubernetes-native option; Flagger is the Flux-aligned alternative. Lowest resource overhead; gradual exposure.
- **Blue-green** — bring the new version fully online alongside the old version; switch traffic atomically; keep old version warm for fast rollback. Higher resource cost (2x at switchover); near-instant rollback. Suits stateful upgrades and small fleets.
- **Feature-flag rollout** — deploy the new code dark (path exists but is gated); flip an OpenFeature flag to release. Decouples deploy from release; pairs with the kill-switch pattern in `rules/hatch3r-operability.md`.

A service may combine strategies — deploy via blue-green for infrastructure changes, then gate user-visible behavior behind a feature flag for incremental release.

## Canary Analysis

Automate the success / fail decision at each stage; never rely on a human eyeballing the dashboard.

- **Argo Rollouts AnalysisTemplate** — declarative Prometheus / Datadog / New Relic / Wavefront queries with success conditions.
- **Flagger metric checks** — Prometheus / Datadog / CloudWatch / Stackdriver via `MetricTemplate`.
- **Datadog deployment tracking** — auto-rollback triggered by deployment-tagged anomaly detection.
- **Spinnaker / Kayenta** — Mann-Whitney U test on baseline-vs-canary metrics; statistical rigor for low-traffic services where raw thresholds give noisy signals.

Metrics gated at every stage:

- Error-rate ratio (canary vs control) — fail on >1.2x baseline for 2 consecutive intervals.
- p95 / p99 latency (canary vs control) — fail on >1.2x baseline for 2 consecutive intervals.
- Business KPIs (checkout success rate, signup completion) — fail on >5% drop from baseline.
- Saturation metrics (CPU, memory) — fail on canary above 90% when control is below 70%.

Two consecutive intervals (typically 1-minute scrape windows) avoids single-scrape noise tripping a false rollback.

Baseline definition: a stable subset of production pods running the prior version, receiving the same traffic mix as the canary. Comparing canary against absolute thresholds rather than against a live baseline produces false positives during traffic spikes and false negatives during quiet windows.

## SLO-Burn Auto-Rollback

Wire canary analysis to the service's SLO (cross-reference `rules/hatch3r-observability-metrics.md`). If a multi-window multi-burn-rate alert fires during a canary stage, rollback automatically — do not wait for the next stage gate.

Two-window burn-rate alert pattern: trigger rollback when error budget burns at 14.4x over a 5-minute window AND 6x over a 1-hour window (the Google SRE "fast burn" pattern). Slow-burn alerts (3x over 6h AND 1x over 3d) do not auto-rollback — they page the on-call.

## Staged Rollout Cadence

Default cadence for non-trivial production deploys, enforced by the rollout controller:

- Stage 1: 1% for 30 minutes minimum.
- Stage 2: 10% for 1 hour minimum.
- Stage 3: 50% for 2 hours minimum.
- Stage 4: 100%.

Override only with explicit on-call approval, documented in the deploy log. CrowdStrike July 2024 root cause: a global config push without staged exposure; a 1% canary would have detected the kernel panic before reaching any production tenant.

Trivial deploys (docs-only, config-only with prior canary, dependency patch with no behavior change) may skip stages with a documented justification in the PR.

Stage holding times scale with peak-hour traffic — a 30-minute stage at 03:00 may see less traffic than a 5-minute stage at 13:00. Tune cadence per service so each stage observes at least 1000 canary requests; below that the metrics-gate is statistically underpowered.

## Blast-Radius Reasoning

Every PR description includes the blast-radius block:

- **Services affected** — list of deployed services.
- **Regions** — list of target regions and rollout order.
- **Traffic %** — peak traffic share over the deploy window.
- **Rollback time** — measured rollback duration (under 5 minutes is the target).
- **Rollback command** — exact CLI invocation, copy-pasteable.

A reviewer-enforced checklist item rejects PRs missing the block. Blast-radius is the artifact the incident commander reads at 03:00.

## Deploy Windows and Change Calendar

- No production deploys: Friday 12:00 PM through Monday 09:00 AM in the timezone of the on-call region.
- No production deploys during named freezes (Black Friday window, end-of-quarter close, major event launch).
- Hotfixes require explicit incident-commander sign-off, captured in the deploy log.

Deploy-window violations are a finding even when the deploy succeeded — the on-call coverage assumption is what is being tested, not the deploy.

## Rollback Playbook

Every deploy ships a rollback command in the service runbook. Examples:

- Argo Rollouts: `kubectl argo rollouts abort <rollout> -n <ns>` then `kubectl argo rollouts undo <rollout> -n <ns>`.
- Flagger canary: `kubectl patch canary <name> -n <ns> --type merge -p '{"spec":{"skipAnalysis":false}}'` then trigger a revert deployment.
- Kubernetes deployment (no rollout controller): `kubectl rollout undo deployment/<name> -n <ns>`.

Time-to-rollback target: under 5 minutes from rollback decision to traffic on the previous version. If the rollback path is untested in the last quarterly drill, the deploy is blocked until the path is verified.

Database migrations follow expand-contract: the new code reads both old and new schema; the migration runs as a separate deploy; the old code path is removed in a subsequent release. Rollback of a deploy that owns its own destructive migration is not possible — separate the migration from the deploy.

## Config-Change Canary

Treat configuration as code — same staged rollout cadence, same auto-rollback wiring. CrowdStrike July 2024 and Cloudflare November 2025 both originated in config changes pushed globally without canary.

- Feature flags rolled out via OpenFeature targeting rules (1% → 10% → 50% → 100% by user / tenant / region) cover application-level config.
- Infrastructure config (kernel modules, network policies, service-mesh routing) needs a canary cluster or canary node pool, not a global push.

A "config tweak" is a deploy by another name; the change-management envelope is identical.

GitOps-managed clusters (Flux, Argo CD) gain canary semantics for free via Flagger or Argo Rollouts. Direct `kubectl apply` to the cluster bypasses the controller and produces audit-trail gaps — block direct cluster writes outside of break-glass procedures.

## Cross-References

- `rules/hatch3r-operability.md` — kill switches and runbooks for post-rollout recovery.
- `rules/hatch3r-observability-metrics.md` — SLO definitions and burn-rate alerts that gate the canary.
- `rules/hatch3r-resilience-patterns.md` — circuit breakers shield the user from a failing canary while the rollback completes.

## References

- Argo Rollouts — `argoproj.github.io/argo-rollouts`
- Flagger — `flagger.app`
- Spinnaker — `spinnaker.io`
- Kayenta — `github.com/spinnaker/kayenta`
- Datadog deployment tracking — `docs.datadoghq.com/tracing/services/deployment_tracking`
- Google SRE workbook, alerting chapter (multi-window multi-burn-rate) — `sre.google/workbook/alerting-on-slos`
- 2024–2026 outage postmortems: CrowdStrike Jul 2024, AWS us-east-1 Oct 2025, Azure East-US2 Sep 2025, Cloudflare Nov 2025.
