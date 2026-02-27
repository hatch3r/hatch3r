---
description: Logging, metrics, and tracing conventions for the project
alwaysApply: false
---
# Observability

## Structured Logging

- Use structured JSON logging. No `console.log` in production code.
- Log levels: `error` (failures), `warn` (degraded), `info` (state changes), `debug` (dev only).
- Every log entry includes `correlationId` and `userId` (if available).
- Never log secrets, PII, tokens, passwords, or sensitive content.
- Instrument key operations with timing metrics. Serverless functions log execution time and outcome.
- Client-side: log errors to a sink (e.g., error reporting service), not just `console.error`.
- Prefer event-based metrics over polling. Trace user flows end-to-end with `correlationId`.
- Respect performance budgets: logging must not add > 10ms latency to hot paths.
- Include `service`, `environment`, and `version` fields in every log entry for filtering.
- Use log sampling for high-volume debug logs in production (e.g., 1% sample rate).

## Distributed Tracing

- Use OpenTelemetry SDK for all tracing instrumentation. Initialize the TracerProvider once at application startup before any instrumented libraries load.
- Propagate trace context via W3C Trace Context headers (`traceparent`, `tracestate`) across all service boundaries, queues, and async workflows.
- Span naming conventions:

| Span Type   | Pattern                        | Example                     |
| ----------- | ------------------------------ | --------------------------- |
| HTTP server | `HTTP {method} {route}`       | `HTTP GET /api/users/:id`   |
| HTTP client | `HTTP {method} {host}{path}`  | `HTTP POST api.stripe.com/` |
| DB query    | `{db.system} {operation}`     | `firestore getDoc`          |
| Queue       | `{queue} {operation}`         | `tasks-queue publish`       |
| Internal    | `{module}.{function}`         | `auth.verifyToken`          |

- Required span attributes: `service.name`, `service.version`, `deployment.environment`. Add domain-specific attributes (e.g., `user.id`, `tenant.id`) where relevant.
- Parent-child span relationships: every outbound call (HTTP, DB, queue) creates a child span of the current context. Never create orphan spans.
- Sampling strategies: use `ParentBased(TraceIdRatioBased(0.1))` in production (10% sample rate). Always sample errors and slow requests (> p95 latency) at 100%.
- Use the OpenTelemetry Collector as a gateway between applications and backends to enable batching, retrying, and vendor-neutral export.
- Keep span event count low (< 32 per span). For high-volume events, use correlated logs or `SpanLink` instead.

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

## Structured Error Reporting

- Integrate Sentry (or equivalent) for automated error capture in both server and client environments.
- Configure release tracking: tag errors with `release` (git SHA or semver) and upload source maps for readable stack traces.
- Enable breadcrumbs: capture the last 50 user actions, network requests, and console messages leading to an error.
- Error grouping: use custom fingerprints for domain-specific errors to prevent over-grouping. Default fingerprinting is acceptable for unhandled exceptions.
- Enrich error context with `correlationId`, `userId`, environment, and relevant business state. Never attach PII or secrets.
- Set sample rates: 100% for errors, 10% for transactions in production. Adjust based on volume and budget.

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

## OpenTelemetry Semantic Conventions

Follow the [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) (v1.29+) for consistent attribute naming across all telemetry signals. Semantic conventions ensure interoperability between instrumentation libraries, collectors, and observability backends.

### Standard Attribute Namespaces

| Namespace | Scope | Key Attributes |
|-----------|-------|----------------|
| `http.*` | HTTP client and server spans | `http.request.method`, `http.response.status_code`, `http.route`, `url.full`, `url.scheme` |
| `db.*` | Database client spans | `db.system` (e.g., `postgresql`, `mongodb`), `db.operation.name`, `db.collection.name`, `db.query.text` (sanitized) |
| `rpc.*` | RPC client and server spans | `rpc.system` (e.g., `grpc`, `jsonrpc`), `rpc.service`, `rpc.method`, `rpc.grpc.status_code` |
| `messaging.*` | Message queue spans | `messaging.system` (e.g., `kafka`, `rabbitmq`), `messaging.operation.type` (`publish`, `receive`, `process`), `messaging.destination.name` |
| `faas.*` | Serverless/FaaS invocations | `faas.trigger` (`http`, `pubsub`, `timer`), `faas.invoked_name`, `faas.coldstart` |
| `cloud.*` | Cloud provider context | `cloud.provider`, `cloud.region`, `cloud.availability_zone`, `cloud.account.id` |
| `k8s.*` | Kubernetes context | `k8s.namespace.name`, `k8s.pod.name`, `k8s.deployment.name`, `k8s.container.name` |

- Use the semantic convention attribute names exactly as specified. Do not invent custom alternatives for concepts already covered by the conventions.
- When semantic conventions are marked "Experimental," prefer them over project-specific names to ease future migration to stable conventions.

### Resource Semantic Conventions

Every telemetry-producing service must declare resource attributes at startup:

| Attribute | Stability | Requirement | Description |
|-----------|-----------|-------------|-------------|
| `service.name` | Stable | Required | Logical name of the service (e.g., `api-gateway`, `auth-service`) |
| `service.version` | Stable | Recommended | Semantic version of the service (e.g., `1.4.2`) |
| `deployment.environment.name` | Stable | Recommended | Deployment environment (e.g., `production`, `staging`, `development`) |
| `service.instance.id` | Experimental | Recommended | Unique instance identifier (e.g., pod name, container ID) |
| `service.namespace` | Experimental | Optional | Namespace for grouping related services |
| `telemetry.sdk.name` | Stable | Auto | Set by the SDK (e.g., `opentelemetry`) |
| `telemetry.sdk.language` | Stable | Auto | Set by the SDK (e.g., `nodejs`, `python`) |
| `telemetry.sdk.version` | Stable | Auto | Set by the SDK |

- Configure `service.name` and `service.version` via environment variables (`OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`) or programmatically at SDK initialization.
- Do not use the default `unknown_service` value in any deployed environment. Every service must have an explicit name.

### Span Status Codes

| Code | When to Set |
|------|-------------|
| `UNSET` | Default. The span completed without the instrumentation indicating an error. |
| `OK` | Explicitly set only when the application considers the operation successful and wants to override any lower-level error signal. Use sparingly. |
| `ERROR` | The operation failed. Set when an exception is caught, an HTTP response is 5xx, or a business-logic error occurs that should be visible in error rate metrics. |

- Set span status to `ERROR` for server-side errors (5xx) and unhandled exceptions. Do not set `ERROR` for client errors (4xx) on the server span — those are valid responses, not server failures.
- Attach the exception to the span as a span event (`exception.type`, `exception.message`, `exception.stacktrace`) when setting status to `ERROR`.
- Use `OK` only when you want to suppress error signals from child spans. In most cases, leaving status as `UNSET` is correct.

### Attribute Naming Guidelines

- Use dot-separated namespaces: `http.request.method`, not `httpRequestMethod` or `http_request_method`.
- Attribute values should be low-cardinality. Never use unbounded values (full URLs with query params, raw SQL, user-generated content) as attribute values.
- For high-cardinality identifiers (user IDs, request IDs), use span attributes sparingly and rely on correlated logs for detail.
- Prefer semantic convention attributes over custom attributes. When custom attributes are necessary, prefix them with your organization or project namespace (e.g., `myapp.feature.flag_key`).
