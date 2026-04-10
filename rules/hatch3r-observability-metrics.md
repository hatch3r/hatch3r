---
id: hatch3r-observability-metrics
type: rule
description: Metrics, SLO/SLI definitions, alerting, and dashboard conventions for the project
scope: conditional
globs: "**/*metric*,**/*slo*,**/*sli*,**/*alert*,**/*dashboard*,**/observability/**"
tags: [devops]
quality_charter: agents/shared/quality-charter.md
---
# Observability -- Metrics, SLOs & Alerting

Metrics, SLO/SLI, alerting, and dashboard conventions. For structured logging see `hatch3r-observability-logging`. For distributed tracing and OpenTelemetry conventions see `hatch3r-observability-tracing`.

## Metrics

- Use OpenTelemetry Metrics SDK. Expose Prometheus-compatible `/metrics` endpoint for scraping where applicable.
- Metric naming: `{service}.{domain}.{metric}_{unit}` in snake_case. Example: `api.auth.login_duration_ms`.
- Instrument types and when to use:

| Instrument  | Use Case                           | Example                          |
| ----------- | ---------------------------------- | -------------------------------- |
| Counter     | Monotonically increasing totals    | `http.requests_total`            |
| Histogram   | Distributions (latency, size)      | `http.request_duration_ms`       |
| Gauge       | Point-in-time values               | `db.connection_pool_active`      |
| UpDownCounter | Values that increase and decrease | `queue.messages_pending`         |

- Histogram buckets for latency: `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]` ms.
- Cardinality management: never use unbounded values (user IDs, request paths with params) as metric labels. Cap label cardinality to < 100 unique values per metric.
- Custom business metrics: track domain-significant events (sign-ups, purchases, feature usage) as counters with relevant dimensions.

## SLO / SLI Definitions

- Define SLIs as ratios of good events to total events, measured from the user's perspective.
- Standard SLIs:

| SLI              | Definition                                    | Measurement Source       |
| ---------------- | --------------------------------------------- | ------------------------ |
| Availability     | Requests returning non-5xx / total requests   | Load balancer logs       |
| Latency          | Requests completing < threshold / total        | Tracing p99              |
| Error rate       | Failed operations / total operations           | Application metrics      |
| Freshness        | Data updated within SLA / total records        | Background job metrics   |

- SLO targets: set per-service. Typical starting points: 99.9% availability (43 min/month budget), p99 latency < 500ms.
- Error budgets: `budget = 1 - SLO_target`. Track remaining budget on a rolling 30-day window.
- Burn rate alerts: use multi-window approach (short + long window). Fast-burn alert: 2% budget consumed in 1 hour. Slow-burn alert: 5% consumed in 6 hours. Alert only when both windows confirm.

## Alerting

| Severity | Criteria                            | Response Time | Notification       |
| -------- | ----------------------------------- | ------------- | ------------------- |
| P1       | Service down, data loss risk        | 15 min        | Page on-call + Slack |
| P2       | Degraded performance, SLO at risk   | 1 hour        | Page on-call        |
| P3       | Non-critical issue, workaround exists | Next business day | Slack channel  |
| P4       | Cosmetic / low-impact               | Sprint backlog | Ticket only         |

- Every alert must link to a runbook with: symptoms, likely causes, diagnostic steps, remediation actions.
- Alert fatigue prevention: tune thresholds to < 5 actionable alerts per on-call shift. Suppress duplicate alerts within a 10-minute dedup window.
- Route alerts by service ownership. Use escalation policies: if P1/P2 unacknowledged in 15 min, escalate to secondary.
- Review alert quality monthly: snooze/delete alerts with < 20% action rate.

## Dashboard Standards

- Required dashboards per service:

| Dashboard        | Contents                                                    |
| ---------------- | ----------------------------------------------------------- |
| Service Health   | Request rate, error rate, latency p50/p95/p99, saturation   |
| Business Metrics | Key domain counters, conversion funnels, feature adoption   |
| Dependencies     | Upstream/downstream latency, error rates, circuit breaker state |
| Infrastructure   | CPU, memory, disk, connection pools, queue depth            |

- Dashboard-as-code: define dashboards in version-controlled JSON/YAML (Grafana provisioning, Terraform, or equivalent). No manual dashboard creation in production.
- Every dashboard panel includes: descriptive title, unit labels, threshold lines for SLO targets, and a link to the relevant runbook or alert.
- Review dashboards quarterly: remove unused panels, update thresholds, verify data source accuracy.
