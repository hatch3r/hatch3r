---
id: hatch3r-observability-verify
name: hatch3r-observability-verify
type: skill
description: Verification gate before declaring an agent-produced service done — OTel span coverage on request path, structured-log + trace-id correlation, SLO definition, error-tracking integration, GenAI semconv on AI features
tags: [review, reliability, observability, devops]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Observability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping a service. Run before declaring a feature complete. The 9 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (SLO + burn-rate alert review per release). Skipping any gate = the feature is not done. Reviewer approval and passing unit tests alone do not satisfy this bar.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: service scope (which routes), trace vendor (OTel collector vs vendor SDK), sample rates (head vs tail), SLO target values, and Gate 7 applicability (LLM-in-path vs pure service).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each observability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-reliability.md` — invokes this skill as the telemetry sub-vector gate of CQ4 (OTel span coverage, structured-log + trace-id correlation, RED/USE metrics, GenAI semconv), alongside `skills/hatch3r-reliability-verify` for the SLO/probes/runbook sub-vector. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 9-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW. The agent body cites this skill (`agents/hatch3r-reliability.md` — "cite ... `skills/hatch3r-observability-verify` as the closing gates"); this subsection is the symmetric upstream citation per `rules/hatch3r-agent-orchestration.md` (Phase-4 dispatch).

## Gate 1: OTel span on request path

- Every HTTP server entry point, every RPC handler, and every queue consumer emits a root span. Every outbound DB / cache / queue / external HTTP call is wrapped in a child span.
- Discovery: enumerate route declarations via `grep -E 'app\.(get|post|put|patch|delete)|router\.|@Get|@Post|fastify\.route' src/` and outbound calls via `grep -E 'fetch\(|axios|prisma|redis|pg\.query'`. Each match must have a tracer call on the same path: `grep -E 'tracer|startSpan|@WithSpan'` against the file.
- Auto-instrumentation packages (`@opentelemetry/auto-instrumentations-node`, `opentelemetry-instrumentation` Python) satisfy the spec when loaded before app imports — verify via process arg `--require @opentelemetry/auto-instrumentations-node/register` or equivalent loader.
- Pass criteria: >=1 root span per route + >=1 child span per outbound call. 0 routes without instrumentation. Coverage threshold: >=95% of declared routes emit at least one root span under fixture traffic.
- HTTP semconv attributes on every server span: `http.request.method`, `http.route`, `http.response.status_code`, `url.scheme`. DB spans carry `db.system` + `db.operation.name`. Span status `ERROR` set on every 5xx + every caught exception. Sources: `rules/hatch3r-observability-tracing.md`, OpenTelemetry semconv v1.29.

## Gate 2: Structured logs with trace_id injection

- Every log line emitted from request scope is JSON (pino / winston / zap / loguru / `slog`). No `console.log` for application logs in production code paths.
- Every request-scoped logger carries `trace_id` and `span_id` from the active OTel context. Verify via Playwright or vitest fixture that emits a request and asserts both fields appear on the captured log line.
- Hook the logger to the active span: `@opentelemetry/instrumentation-pino` for Node, `LoggingInstrumentor` for Python — auto-injects trace_id + span_id. Manual injection acceptable when auto-instrumentation is unavailable for the logger.
- W3C Trace Context (`traceparent` + `tracestate` headers) propagated on every outbound HTTP call. Test: send a request, inspect the outbound call recorded by `nock` / `msw` / a recording proxy, assert the header is present and parses as a valid traceparent string `00-{32hex}-{16hex}-{2hex}`.
- Pass criteria: 0 unstructured app-log statements + 100% of request-scoped log lines carry `trace_id` + traceparent propagated on every outbound call. Sources: `rules/hatch3r-observability-logging.md`, W3C Trace Context Level 1 (W3C Recommendation 2020-02).

## Gate 3: Severity and message standards

- OTel `SeverityNumber` mapping documented in the logger initialization. Replace ad-hoc level strings with the OTel-aligned set: `TRACE / DEBUG / INFO / WARN / ERROR / FATAL` mapped to SeverityNumber 1 / 5 / 9 / 13 / 17 / 21.
- Log messages follow the verb-first structure: action + object + outcome. Example: `"created order" {order_id, amount}`. Never embed dynamic values into the message string — pass them as fields.
- PII / secret redaction enabled via a centralized redactor — pino redact paths, winston format redactor, or a structured-log middleware. Audit: grep for password / authorization / token / email fields in log payloads; 0 unredacted hits.
- Required envelope fields on every log entry: `service.name`, `service.version`, `deployment.environment`, `trace_id`, `span_id`, `severity_number`, `timestamp` (RFC 3339 with millisecond precision).
- No `console.log` for app logs. Enforced via eslint rule `no-console` with `error` severity in production code paths; test code is exempt via override. Sources: `rules/hatch3r-observability-logging.md`, OpenTelemetry Logs Data Model.

## Gate 4: RED + USE metrics

- Services emit RED metrics: a Rate counter, an Error counter, and a Duration histogram, each labeled `route`, `method`, `status`. Histogram buckets follow the rule default `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]` ms.
- Resources emit USE metrics: Utilization gauge, Saturation gauge, Errors counter on the resource pool — DB connection pool, worker pool, queue depth, file descriptor count, in-memory cache fill ratio.
- Naming follows `{service}.{domain}.{metric}_{unit}` in snake_case. Counter names end in `_total`; histogram names end in the unit (`_ms`, `_bytes`).
- Cardinality budget per metric documented in a comment next to the instrument declaration. Cap label cardinality at the value defined in `rules/hatch3r-observability-metrics.md` (<100 unique values per label). Never use raw `user_id` or unbucketed `path` as a label.
- Exemplars attached to histogram observations when running with OTel Collector — link the metric data point to the corresponding trace_id for click-through from Grafana to the trace view.
- Pass criteria: RED triplet present per route + USE triplet present per pooled resource + cardinality cap declared + exemplars wired. Sources: Brendan Gregg USE method, Tom Wilkie RED method, `rules/hatch3r-observability-metrics.md`.

## Gate 5: SLO defined

- Service declares at least one SLO covering availability, latency p95 or p99, and correctness where applicable. SLO target + measurement window + error-budget formula committed in `slo.yaml` or `service.yaml` at the service root.
- SLI definition uses the user-facing event ratio: `good_events / valid_events`. Source the numerator and denominator from the same signal (load-balancer logs OR application metrics, never mixed).
- Burn-rate alerts follow the Google SRE workbook multi-window multi-burn-rate (MWMBR) pattern: fast-burn alert at 2% budget consumed in 1 hour AND slow-burn at 5% consumed in 6 hours. Both windows must confirm before paging. Window pair selected per the workbook table to keep detection time < 1 hour for full-budget-exhaustion incidents.
- Error budget tracked on a rolling 30-day window. Burn-rate threshold = (budget_consumed_ratio / window_fraction).
- Pass criteria: SLO target documented + burn-rate alert config committed + runbook link present + error-budget tracker dashboard exists. Sources: Google SRE Workbook ch. 5 (Alerting on SLOs), `rules/hatch3r-observability-metrics.md`.

## Gate 6: Error tracker integration

- Sentry / Honeycomb / Datadog / Bugsnag SDK initialized at process entry before any application code runs. Release version + commit SHA tagged via `release: process.env.GIT_SHA` or equivalent.
- Source maps uploaded in the build pipeline — verify via a grep of the deploy workflow for `sentry-cli sourcemaps upload` or vendor equivalent. Source-map upload step runs on tag-push and on every production deploy.
- Breadcrumbs configured: capture the last 50 user actions, network requests, and log entries leading to an error. Console-message breadcrumbs disabled in production to avoid leaking debug data.
- PII scrubbing enabled — `beforeSend` hook strips email, IP, password, authorization tokens from event payloads. Test via a fixture event with PII and assert the captured payload is clean.
- Sample rates: 100% for errors, 10% for transactions in production. Adjust per cost envelope; record the override in the SDK init comment.
- Pass criteria: SDK init present + release tag set + source-map upload in CI + PII scrubber wired + breadcrumb config explicit. Sources: `rules/hatch3r-observability-logging.md`, Sentry release tracking guide.

## Gate 7: AI / LLM observability (when applicable)

Applies only when the feature calls an LLM or runs an agent:

- GenAI semconv span on every LLM call carrying `gen_ai.operation.name`, `gen_ai.provider.name` (renamed from the deprecated `gen_ai.system` in SemConv v1.37.0), `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`. Cache-hit flag emitted as a span attribute when the provider returns one.
- Tools invoked by the agent emit `execute_tool {gen_ai.tool.name}` spans per `rules/hatch3r-observability-tracing.md` § "AI Agent Instrumentation". Each tool span carries `gen_ai.operation.name`, `gen_ai.tool.name`, plus the `app.tool.input_hash`/`app.tool.output_status`/`app.tool.duration_ms` extras.
- Cost telemetry per request: the registered GenAI metrics `gen_ai.client.token.usage` (Histogram, attribute `gen_ai.token.type`) and `gen_ai.client.operation.duration` (Histogram).
- GenAI spans sampled at 50-100% in production — higher than general spans because volume is low and per-call cost is high.

Cross-reference: `rules/hatch3r-ai-evals.md` (Slice 5), OpenLLMetry semantic conventions.

## Gate 8: Sampling and cost control

- Head sampling configured in the SDK and tail sampling configured at the OpenTelemetry Collector. Default: `ParentBased(TraceIdRatioBased(0.1))` head sample + tail-sampling policy keeping 100% of error traces and 100% of traces with latency > p95.
- Spans-per-second budget documented per service alongside expected QPS. Budget formula: `target_sps = qps * head_sample * (1 + retry_factor)`. Re-check on every deploy.
- Log sampling for high-volume routes — health checks and static asset routes drop to 1% sample rate via a per-route override at the logger or middleware.
- Cardinality drop rules at the Collector or vendor — drop attributes that exceed the cardinality budget rather than failing ingestion. Example: drop `user_id` from spans before export when count > 10k unique values per 5-minute window.
- Cost-budget alert wired on monthly telemetry spend with a 80% threshold warning and 100% threshold page.
- Pass criteria: head + tail sampling declared + per-route log sample rule + cardinality drop policy + cost-budget alert. Sources: OpenTelemetry sampling docs, `rules/hatch3r-observability-tracing.md`.

## Gate 9: Alerts-as-code with runbook URL

- Every Prometheus / Datadog / Grafana alert defined in Terraform or YAML committed to the repo. No alerts created via vendor console.
- Every alert rule carries a `runbook_url` annotation linking to a runbook in `docs/runbooks/` or equivalent. Runbook contains: symptoms, likely causes, diagnostic steps, remediation actions, owner team, escalation policy.
- Severity tier set on every alert per the project policy: P1 page on-call within 15 min; P2 page within 1 hour; P3 Slack channel; P4 ticket only. Alerts without a severity tag fail the gate.
- CI check parses alert files and fails when `runbook_url` is missing or the target runbook file does not exist. Provide a `validate-alerts` script under `scripts/` or rely on `promtool check rules` for Prometheus.
- Pass criteria: 100% alerts in code + 100% alerts with runbook annotation + 100% alerts with severity tier + target runbook file exists. Sources: Grafana alerting-as-code docs, Datadog Terraform provider, `rules/hatch3r-observability-metrics.md`.

## Verdict

All 9 gates pass = the feature is "done". Anything less = not done.

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of reviewer approval status.

## When this skill runs

- After `hatch3r-implementer` finishes service code and before `hatch3r-qa-validation` runs.
- On every PR that touches `src/routes/`, `src/handlers/`, `src/services/`, `src/api/`, `src/middleware/`, `src/controllers/`, `src/lib/`, or any file matching the four observability rule globs.
- Gate 5 (SLO + burn-rate alert review) executes at release-cut time per release; PR-level execution checks only that the SLO file exists and is non-empty.

## Cross-References

- `rules/hatch3r-observability-logging.md`
- `rules/hatch3r-observability-metrics.md`
- `rules/hatch3r-observability-tracing.md` (includes AI agent instrumentation; was previously split as `-detail`)

## References

- OpenTelemetry Semantic Conventions v1.29 — `opentelemetry.io/docs/specs/semconv/`
- OpenTelemetry GenAI Semantic Conventions — `opentelemetry.io/docs/specs/semconv/gen-ai/`
- W3C Trace Context Level 1 — `www.w3.org/TR/trace-context/`
- Google SRE Workbook ch. 5 (SLO + multi-burn-rate alerts) — `sre.google/workbook/alerting-on-slos/`
- Grafana SLO and alerts-as-code — `grafana.com/docs/grafana/latest/alerting/`
- Sentry release tracking and source maps — `docs.sentry.io/product/releases/`
- OpenLLMetry GenAI conventions — `github.com/traceloop/openllmetry`
