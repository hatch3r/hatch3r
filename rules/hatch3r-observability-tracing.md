---
id: hatch3r-observability-tracing
type: rule
description: Distributed tracing, OpenTelemetry conventions, and AI agent instrumentation for the project
scope: conditional
globs: "**/*trac*,**/*span*,**/*telemetry*,**/*otel*,**/*agent*,**/observability/**,**/routes/**,**/handlers/**,**/services/**,**/api/**,**/middleware/**,**/controllers/**,**/lib/**"
tags: [devops]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Observability -- Distributed Tracing & OpenTelemetry

Distributed tracing, OpenTelemetry semantic conventions, AI agent instrumentation, tool call audit trails, and correlation ID patterns. For structured logging see `hatch3r-observability-logging`. For metrics, SLOs, alerting, and dashboards see `hatch3r-observability-metrics`.

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

## AI Agent Instrumentation

Follow the [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) for AI/LLM agent instrumentation.

### GenAI Span Attributes

Use these attributes on all spans representing interactions with generative AI models:

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `gen_ai.system` | string | GenAI provider system name | `openai`, `anthropic`, `azure_openai` |
| `gen_ai.request.model` | string | Model name as specified in the request | `gpt-4o`, `claude-sonnet-4-20250514` |
| `gen_ai.response.model` | string | Model name as returned in the response | `gpt-4o-2024-08-06` |
| `gen_ai.request.max_tokens` | int | Maximum tokens requested for generation | `4096` |
| `gen_ai.request.temperature` | float | Temperature parameter | `0.7` |
| `gen_ai.response.finish_reasons` | string[] | Reasons the model stopped generating | `["stop"]`, `["length"]` |
| `gen_ai.usage.input_tokens` | int | Tokens in the input/prompt | `1250` |
| `gen_ai.usage.output_tokens` | int | Tokens in the generated output | `530` |

- Always set `gen_ai.system` and `gen_ai.request.model` on every GenAI span.
- Record `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` from the API response for cost dashboards.
- Use `gen_ai.response.finish_reasons` to detect truncated outputs (`length`) and trigger re-prompting.

### Agent Invocation Spans

Instrument the full lifecycle of an agent invocation with a dedicated span. This span is the parent for all LLM calls, tool executions, and sub-agent delegations.

- **Span name pattern:** `agent.{agent_name}.invoke`
- **Required attributes:** `agent.id`, `agent.name`, `agent.parent_id`, `agent.task`, `agent.framework`
- **Span events for state transitions:** `agent.planning`, `agent.tool_selection`, `agent.awaiting_human`, `agent.delegating`, `agent.completed`, `agent.error`

```typescript
const agentSpan = tracer.startSpan('agent.code_reviewer.invoke', {
  attributes: {
    'agent.id': invocationId,
    'agent.name': 'code_reviewer',
    'agent.parent_id': parentAgentId ?? '',
    'agent.task': `review PR #${prNumber}`,
    'agent.framework': 'custom',
  },
});
agentSpan.addEvent('agent.planning');
// ... agent reasoning and tool calls happen as child spans ...
agentSpan.addEvent('agent.completed');
agentSpan.end();
```

### Tool Call Spans

Every tool invocation by an agent creates a child span of the agent invocation span.

- **Span name pattern:** `tool.{tool_name}.execute`
- **Required attributes:** `tool.name`, `tool.input_hash` (SHA-256), `tool.output_status`, `tool.duration_ms`, `tool.parameters_count`
- Tool spans must be children of the invoking agent span. Set span status to `ERROR` when `tool.output_status` is `error` or `timeout`.
- For tools performing I/O, create nested child spans using appropriate semantic conventions (`http.*`, `db.*`).

```typescript
const toolSpan = tracer.startSpan(
  'tool.git_diff.execute',
  { attributes: { 'tool.name': 'git_diff' } },
  trace.setSpan(context.active(), agentSpan),
);
try {
  const result = await tools.gitDiff(params);
  toolSpan.setAttributes({
    'tool.output_status': 'success',
    'tool.duration_ms': performance.now() - startTime,
    'tool.input_hash': hashInput(params),
  });
} catch (err) {
  toolSpan.setAttributes({ 'tool.output_status': 'error' });
  toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  toolSpan.recordException(err);
  throw err;
} finally {
  toolSpan.end();
}
```

### LLM Request/Response Tracing

- **Span name pattern:** `gen_ai.{operation}` (e.g., `gen_ai.chat`, `gen_ai.completion`)
- **Token tracking:** Capture `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. Aggregate in metrics: Counter `gen_ai.tokens_total` with labels `{direction, model, agent_name}`, Histogram `gen_ai.request_duration_ms`.
- **Model version tracking:** Record both `gen_ai.request.model` and `gen_ai.response.model` for drift detection.
- **Retry spans:** Each retry attempt is a separate child span. Set `gen_ai.request.retries` on the final span. Record `http.response.status_code` on failed spans (429 vs 500+).
- Never log raw prompt content or full model responses as span attributes. Use token counts for cost tracking and correlated logs for prompt debugging in non-production environments.
- Sample GenAI spans at 50-100% in production (higher than general spans) because each call is expensive and low volume.

### Tool Call Audit Trail

Maintain a structured audit log for every tool invocation in agentic workflows, separate from tracing spans.

| Field | Type | Description |
|-------|------|-------------|
| `tool.name` | string | Name of the tool invoked |
| `tool.input_hash` | string | SHA-256 hash of tool input (never log raw input) |
| `tool.output_status` | string | `success`, `error`, `timeout`, or `denied` |
| `tool.duration_ms` | float | Execution time in milliseconds |
| `agent.id` | string | ID of the invoking agent |
| `agent.name` | string | Human-readable agent name |
| `correlation.id` | string | Trace correlation ID |
| `timestamp` | string | ISO 8601 timestamp |
| `session.id` | string | Session identifier |

- Log tool invocations at `info` level, failures at `error` level with `error.type` and `error.message`.
- Aggregate tool call counts per agent per session for anomaly detection.
- Retain audit logs for a minimum of 90 days.

### Correlation IDs for Agent Workflows

- Use UUIDv4 with workflow-type prefix: `{workflow-type}-{uuid}` (e.g., `agent-run-550e8400-...`).
- Generate at the workflow entry point. Propagate to all sub-agents and tool calls.
- Every log entry, span, and metric must include `correlation.id`.
- Cross-process: propagate via `X-Correlation-ID` header alongside W3C Trace Context.
- Use OpenTelemetry `SpanLink` for cross-workflow references (e.g., agent run triggered by CI event).

```typescript
import { randomUUID } from 'node:crypto';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

function generateCorrelationId(workflowType: string): string {
  return `${workflowType}-${randomUUID()}`;
}

async function runAgentWorkflow(task: string): Promise<void> {
  const correlationId = generateCorrelationId('agent-run');
  const tracer = trace.getTracer('agent-orchestrator');
  const rootSpan = tracer.startSpan('agent.orchestrator.invoke', {
    attributes: {
      'correlation.id': correlationId,
      'agent.name': 'orchestrator',
      'agent.task': task,
    },
  });
  try {
    await context.with(trace.setSpan(context.active(), rootSpan), async () => {
      await delegateToSubAgent('code_reviewer', {
        correlationId,
        parentSpanId: rootSpan.spanContext().spanId,
        task: 'review changes',
      });
    });
  } catch (err) {
    rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    rootSpan.recordException(err as Error);
    throw err;
  } finally {
    rootSpan.end();
  }
}
```
