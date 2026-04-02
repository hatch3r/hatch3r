---
id: hatch3r-observability-logging
type: rule
description: Structured logging and error reporting conventions for the project
scope: conditional
tags: [devops]
quality_charter: agents/shared/quality-charter.md
---
# Observability -- Logging & Error Reporting

Logging and error reporting conventions. For metrics, SLOs, alerting, and dashboards see `hatch3r-observability-metrics`. For distributed tracing and OpenTelemetry conventions see `hatch3r-observability-tracing`.

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

## Structured Error Reporting

- Integrate Sentry (or equivalent) for automated error capture in both server and client environments.
- Configure release tracking: tag errors with `release` (git SHA or semver) and upload source maps for readable stack traces.
- Enable breadcrumbs: capture the last 50 user actions, network requests, and console messages leading to an error.
- Error grouping: use custom fingerprints for domain-specific errors to prevent over-grouping. Default fingerprinting is acceptable for unhandled exceptions.
- Enrich error context with `correlationId`, `userId`, environment, and relevant business state. Never attach PII or secrets.
- Set sample rates: 100% for errors, 10% for transactions in production. Adjust based on volume and budget.
