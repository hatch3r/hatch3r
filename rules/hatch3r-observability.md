---
id: hatch3r-observability
type: rule
description: "[Deprecated] Observability conventions -- split into hatch3r-observability-logging, hatch3r-observability-metrics, and hatch3r-observability-tracing"
scope: conditional
tags: [devops]
quality_charter: agents/shared/quality-charter.md
deprecated: true
---
# Observability (Deprecated Redirect)

This rule has been split into three focused rules for maintainability:

- **`hatch3r-observability-logging`** -- Structured logging and error reporting conventions
- **`hatch3r-observability-metrics`** -- Metrics, SLO/SLI definitions, alerting, and dashboard standards
- **`hatch3r-observability-tracing`** -- Distributed tracing, OpenTelemetry semantic conventions, AI agent instrumentation, and correlation IDs

Load the specific rule that matches your task scope instead of this file.
