---
id: hatch3r-observability-tracing
type: rule
description: Distributed tracing, OpenTelemetry semantic conventions, AI agent instrumentation, and correlation ID conventions for the project
scope: conditional
tags: [devops]
quality_charter: agents/shared/quality-charter.md
---
# Observability -- Distributed Tracing & OpenTelemetry

Distributed tracing, OpenTelemetry semantic conventions, AI agent instrumentation, and correlation ID conventions. For structured logging see `hatch3r-observability-logging`. For metrics, SLOs, alerting, and dashboards see `hatch3r-observability-metrics`.

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

- Set span status to `ERROR` for server-side errors (5xx) and unhandled exceptions. Do not set `ERROR` for client errors (4xx) on the server span -- those are valid responses, not server failures.
- Attach the exception to the span as a span event (`exception.type`, `exception.message`, `exception.stacktrace`) when setting status to `ERROR`.
- Use `OK` only when you want to suppress error signals from child spans. In most cases, leaving status as `UNSET` is correct.

### Attribute Naming Guidelines

- Use dot-separated namespaces: `http.request.method`, not `httpRequestMethod` or `http_request_method`.
- Attribute values should be low-cardinality. Never use unbounded values (full URLs with query params, raw SQL, user-generated content) as attribute values.
- For high-cardinality identifiers (user IDs, request IDs), use span attributes sparingly and rely on correlated logs for detail.
- Prefer semantic convention attributes over custom attributes. When custom attributes are necessary, prefix them with your organization or project namespace (e.g., `myapp.feature.flag_key`).

### AI Agent Semantic Conventions

Follow the [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (experimental, introduced 2024) for instrumenting AI/LLM agent systems. These conventions provide consistent attribute naming for generative AI operations, enabling interoperability across agent frameworks and observability backends.

#### `gen_ai.*` Span Attributes

Use these attributes on all spans that represent interactions with generative AI models:

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `gen_ai.system` | string | The GenAI provider system name | `openai`, `anthropic`, `azure_openai` |
| `gen_ai.request.model` | string | Model name as specified in the request | `gpt-4o`, `claude-sonnet-4-20250514` |
| `gen_ai.response.model` | string | Model name as returned in the response (may differ from request) | `gpt-4o-2024-08-06` |
| `gen_ai.request.max_tokens` | int | Maximum number of tokens requested for generation | `4096` |
| `gen_ai.request.temperature` | float | Temperature parameter sent in the request | `0.7` |
| `gen_ai.request.top_p` | float | Top-p (nucleus sampling) parameter | `0.9` |
| `gen_ai.response.finish_reasons` | string[] | Reasons the model stopped generating | `["stop"]`, `["length"]`, `["tool_calls"]` |
| `gen_ai.usage.input_tokens` | int | Number of tokens in the input/prompt | `1250` |
| `gen_ai.usage.output_tokens` | int | Number of tokens in the generated output | `530` |

- Always set `gen_ai.system` and `gen_ai.request.model` on every GenAI span. These are required for meaningful filtering and cost attribution.
- Record `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` from the API response to enable token usage dashboards and cost tracking.
- Use `gen_ai.response.finish_reasons` to detect truncated outputs (`length`) and trigger re-prompting or alerting logic.

#### Agent Invocation Spans

Instrument the full lifecycle of an agent invocation with a dedicated span. This span is the parent for all LLM calls, tool executions, and sub-agent delegations within a single agent run.

- **Span name pattern:** `agent.{agent_name}.invoke` (e.g., `agent.code_reviewer.invoke`, `agent.research_assistant.invoke`)
- **Required attributes:**

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `agent.id` | string | Unique identifier for this agent invocation | `agent-run-a1b2c3d4` |
| `agent.name` | string | Logical name of the agent | `code_reviewer` |
| `agent.parent_id` | string | ID of the parent agent (for sub-agent delegation chains) | `agent-run-x9y8z7` |
| `agent.task` | string | High-level description of the agent's assigned task | `review PR #42` |
| `agent.framework` | string | Agent framework in use | `langchain`, `autogen`, `custom` |

- **Span events for state transitions:** Record span events to mark key lifecycle transitions within the agent invocation:
  - `agent.planning` -- Agent begins task decomposition or reasoning.
  - `agent.tool_selection` -- Agent selects a tool to invoke.
  - `agent.awaiting_human` -- Agent pauses for human-in-the-loop confirmation.
  - `agent.delegating` -- Agent spawns a sub-agent.
  - `agent.completed` -- Agent finishes its task and produces a final output.
  - `agent.error` -- Agent encounters a non-recoverable error. Include `exception.type` and `exception.message` attributes on the event.

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

#### Tool Call Spans

Every tool invocation by an agent creates a child span of the agent invocation span. This enables tracing the full sequence of tool calls within an agent run, measuring tool latency, and detecting tool failures.

- **Span name pattern:** `tool.{tool_name}.execute` (e.g., `tool.file_read.execute`, `tool.web_search.execute`)
- **Required attributes:**

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `tool.name` | string | Canonical name of the tool | `file_read`, `git_diff`, `web_search` |
| `tool.input_hash` | string | SHA-256 hash of the tool input (for deduplication, not logging raw input) | `sha256:3a7f...` |
| `tool.output_status` | string | Outcome of the tool execution | `success`, `error`, `timeout`, `rejected` |
| `tool.duration_ms` | float | Wall-clock execution time of the tool in milliseconds | `142.5` |
| `tool.parameters_count` | int | Number of parameters passed to the tool | `3` |

- **Parent-child relationship:** Tool spans must be children of the invoking agent span. Use `context.with(trace.setSpan(context.active(), agentSpan))` to propagate the agent span context to tool execution.
- Set span status to `ERROR` when `tool.output_status` is `error` or `timeout`. Attach exception details as a span event.
- For tools that perform I/O (HTTP requests, file system operations, database queries), create nested child spans using the appropriate semantic conventions (`http.*`, `db.*`) under the tool span.

```typescript
const toolSpan = tracer.startSpan(
  'tool.git_diff.execute',
  { attributes: { 'tool.name': 'git_diff' } },
  trace.setSpan(context.active(), agentSpan),
);

const startTime = performance.now();
try {
  const result = await tools.gitDiff(params);
  toolSpan.setAttributes({
    'tool.output_status': 'success',
    'tool.duration_ms': performance.now() - startTime,
    'tool.input_hash': hashInput(params),
  });
} catch (err) {
  toolSpan.setAttributes({
    'tool.output_status': 'error',
    'tool.duration_ms': performance.now() - startTime,
  });
  toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  toolSpan.recordException(err);
  throw err;
} finally {
  toolSpan.end();
}
```

#### LLM Request/Response Tracing

Instrument every LLM API call with a dedicated span. These spans are typically children of an agent invocation span and capture model, token usage, and latency data for cost analysis and performance monitoring.

- **Span name pattern:** `gen_ai.{operation}` (e.g., `gen_ai.chat`, `gen_ai.completion`, `gen_ai.embeddings`)
- **Required attributes:** All applicable `gen_ai.*` attributes from the table above, plus:

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `gen_ai.operation.name` | string | The specific API operation | `chat`, `completion`, `embeddings` |
| `gen_ai.request.stop_sequences` | string[] | Stop sequences sent in the request | `["\n\n", "END"]` |
| `server.address` | string | Hostname of the GenAI API endpoint | `api.openai.com` |
| `server.port` | int | Port of the GenAI API endpoint | `443` |

- **Input/output token tracking:** Always capture `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` from the API response. Aggregate these in metrics for cost dashboards:
  - Counter: `gen_ai.tokens_total` with labels `{direction=input|output, model, agent_name}`
  - Histogram: `gen_ai.request_duration_ms` with labels `{model, operation, agent_name}`

- **Model version tracking:** Record both `gen_ai.request.model` (what was requested) and `gen_ai.response.model` (what was actually used). API providers may silently route to different model versions; capturing both enables drift detection.

- **Error handling and retry spans:** When an LLM request fails and is retried, each attempt is a separate child span under the same parent. Record the error on the failed span and create a new span for the retry:
  - Set `gen_ai.request.retries` (int) on the final successful span to indicate total retry count.
  - Record `http.response.status_code` on failed spans to distinguish rate-limit errors (429) from server errors (500+).
  - Use exponential backoff; the retry span's start time naturally captures the wait duration.

```typescript
const llmSpan = tracer.startSpan(
  'gen_ai.chat',
  {
    attributes: {
      'gen_ai.system': 'openai',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.request.max_tokens': 4096,
      'gen_ai.request.temperature': 0.2,
      'server.address': 'api.openai.com',
    },
  },
  trace.setSpan(context.active(), agentSpan),
);

try {
  const response = await openai.chat.completions.create({ /* ... */ });
  llmSpan.setAttributes({
    'gen_ai.response.model': response.model,
    'gen_ai.response.finish_reasons': response.choices.map(c => c.finish_reason),
    'gen_ai.usage.input_tokens': response.usage.prompt_tokens,
    'gen_ai.usage.output_tokens': response.usage.completion_tokens,
  });

  // Record token usage in metrics for cost tracking
  tokenCounter.add(response.usage.prompt_tokens, {
    direction: 'input', model: response.model, agent_name: agentName,
  });
  tokenCounter.add(response.usage.completion_tokens, {
    direction: 'output', model: response.model, agent_name: agentName,
  });
} catch (err) {
  llmSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  llmSpan.recordException(err);
  throw err;
} finally {
  llmSpan.end();
}
```

- Never log raw prompt content or full model responses as span attributes -- these are high-cardinality and may contain sensitive data. Use `gen_ai.usage.*` token counts for cost tracking and correlated logs for prompt debugging in non-production environments.
- In production, sample GenAI spans at a higher rate than general spans (e.g., 50-100%) because each call is expensive and lower volume than typical HTTP traffic. Adjust sampling based on call volume and observability budget.

### Tool Call Audit Trail

Maintain a structured audit log for every tool invocation in agentic workflows. This log is separate from tracing spans and serves as an immutable compliance and debugging record.

#### Schema Definition

Every tool call audit log entry must include the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `tool.name` | string | Name of the tool invoked |
| `tool.input_hash` | string | SHA-256 hash of the tool input (for privacy, never log raw input) |
| `tool.output_status` | string | Outcome of the tool execution: `success`, `error`, `timeout`, or `denied` |
| `tool.duration_ms` | float | Execution time in milliseconds |
| `agent.id` | string | ID of the agent that invoked the tool |
| `agent.name` | string | Human-readable agent name |
| `correlation.id` | string | Trace correlation ID linking this entry to the broader workflow |
| `timestamp` | string | ISO 8601 timestamp of the invocation |
| `session.id` | string | Session identifier for grouping related tool calls |

#### Logging Requirements

- Log every tool invocation at `info` level with the full schema above.
- Log tool failures at `error` level with additional `error.type` and `error.message` fields describing the failure.
- Aggregate tool call counts per agent per session for anomaly detection (e.g., an agent invoking an unusual number of tools may indicate a loop or misconfiguration).
- Retain audit logs for a minimum of 90 days to support post-incident investigation and compliance review.

#### Example Log Entry

```json
{
  "timestamp": "2026-02-15T14:32:07.891Z",
  "level": "info",
  "correlation.id": "agent-run-550e8400-e29b-41d4-a716-446655440000",
  "session.id": "sess-8f14e45f-ceea-467f-a8f0-3b5c6d7e8f9a",
  "agent.id": "agent-run-a1b2c3d4",
  "agent.name": "code_reviewer",
  "tool.name": "git_diff",
  "tool.input_hash": "sha256:3a7f2c9e8b1d4f6a0e5c7b9d2f4a6e8c0b3d5f7a9e1c3b5d7f9a2c4e6b8d0f",
  "tool.output_status": "success",
  "tool.duration_ms": 142.5
}
```

### Correlation IDs for Agent Workflows

Correlation IDs provide the connective thread linking all telemetry signals (logs, spans, metrics) across a multi-agent workflow. Every participant in the workflow uses the same correlation ID, enabling end-to-end traceability from the initial trigger through all agent delegations and tool calls.

#### ID Generation

- Use UUIDv4 for correlation IDs. Generate the ID at the workflow entry point (the first agent invocation or the orchestrator that initiates the run).
- Format: `{workflow-type}-{uuid}` (e.g., `agent-run-550e8400-e29b-41d4-a716-446655440000`, `review-flow-7c9e6679-7425-40de-944b-e07fc1f90ae7`).
- The workflow-type prefix provides human-readable context when scanning logs and makes it possible to filter by workflow category without parsing the full ID.

#### Propagation

- The correlation ID propagates from the parent agent to all sub-agents via context. Pass it explicitly when delegating to sub-agents or invoking tools.
- Every log entry, span, and metric produced during the workflow must include the `correlation.id` attribute.
- When crossing process boundaries (e.g., HTTP calls between services), propagate the correlation ID via a custom header (`X-Correlation-ID`) alongside standard W3C Trace Context headers.

#### Parent-Child Span Linking

- The parent agent's span ID becomes the `parent_span_id` attribute on child agent spans, establishing a clear hierarchy in trace visualizations.
- For cross-workflow references (e.g., an agent run triggered by a CI pipeline event), use OpenTelemetry `SpanLink` to connect the agent workflow trace to the originating trace without creating a parent-child relationship.
- SpanLinks preserve the independence of each workflow trace while enabling navigation between related workflows in the observability backend.

#### Implementation Pattern

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

  const ctx = trace.setSpan(context.active(), rootSpan);

  try {
    // Sub-agent inherits the correlation ID from context
    await context.with(ctx, async () => {
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
