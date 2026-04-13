---
id: hatch3r-observability-tracing
type: rule
description: Distributed tracing and OpenTelemetry core conventions for the project
scope: conditional
globs: "**/*trac*,**/*span*,**/*telemetry*,**/*otel*,**/observability/**"
tags: [devops]
quality_charter: agents/shared/quality-charter.md
---
# Observability -- Distributed Tracing & OpenTelemetry

Core distributed tracing and OpenTelemetry conventions. For structured logging see `hatch3r-observability-logging`. For metrics, SLOs, alerting, and dashboards see `hatch3r-observability-metrics`. For AI agent instrumentation, tool call audit trails, and correlation ID patterns see `hatch3r-observability-tracing-detail`.

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

## OpenTelemetry Semantic Conventions

Follow the [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) (v1.29+) for consistent attribute naming across all telemetry signals.

### Standard Attribute Namespaces

| Namespace | Scope | Key Attributes |
|-----------|-------|----------------|
| `http.*` | HTTP client and server spans | `http.request.method`, `http.response.status_code`, `http.route`, `url.full`, `url.scheme` |
| `db.*` | Database client spans | `db.system`, `db.operation.name`, `db.collection.name`, `db.query.text` (sanitized) |
| `rpc.*` | RPC client and server spans | `rpc.system`, `rpc.service`, `rpc.method`, `rpc.grpc.status_code` |
| `messaging.*` | Message queue spans | `messaging.system`, `messaging.operation.type`, `messaging.destination.name` |
| `faas.*` | Serverless/FaaS invocations | `faas.trigger`, `faas.invoked_name`, `faas.coldstart` |
| `cloud.*` | Cloud provider context | `cloud.provider`, `cloud.region`, `cloud.availability_zone` |
| `k8s.*` | Kubernetes context | `k8s.namespace.name`, `k8s.pod.name`, `k8s.deployment.name` |

- Use semantic convention attribute names exactly as specified. Do not invent custom alternatives for concepts already covered.
- When semantic conventions are marked "Experimental," prefer them over project-specific names to ease future migration.

### Resource Semantic Conventions

Every telemetry-producing service must declare resource attributes at startup:

| Attribute | Requirement | Description |
|-----------|-------------|-------------|
| `service.name` | Required | Logical name of the service |
| `service.version` | Recommended | Semantic version of the service |
| `deployment.environment.name` | Recommended | Deployment environment (production, staging, development) |
| `service.instance.id` | Recommended | Unique instance identifier (pod name, container ID) |

- Configure via environment variables (`OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`) or programmatically at SDK initialization.
- Do not use the default `unknown_service` value in any deployed environment.

### Span Status Codes

| Code | When to Set |
|------|-------------|
| `UNSET` | Default. Span completed without error indication. |
| `OK` | Set only when the application explicitly considers the operation successful and wants to override lower-level error signals. Use sparingly. |
| `ERROR` | Operation failed: exception caught, HTTP 5xx, or business-logic error visible in error rate metrics. |

- Set `ERROR` for server-side errors (5xx) and unhandled exceptions. Do not set `ERROR` for client errors (4xx) on the server span.
- Attach exceptions as span events (`exception.type`, `exception.message`, `exception.stacktrace`) when setting `ERROR`.

### Attribute Naming Guidelines

- Use dot-separated namespaces: `http.request.method`, not `httpRequestMethod`.
- Attribute values should be low-cardinality. Never use unbounded values (full URLs with query params, raw SQL) as attribute values.
- Prefer semantic convention attributes over custom attributes. Prefix custom attributes with your project namespace (e.g., `myapp.feature.flag_key`).

### AI Agent Semantic Conventions (Summary)

Follow the [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) for AI/LLM agent instrumentation. Key attributes: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`. For full attribute tables, code examples, tool call audit trails, and correlation ID patterns, see `hatch3r-observability-tracing-detail`.
