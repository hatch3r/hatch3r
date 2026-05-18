---
id: hatch3r-observability-tracing-detail
type: rule
description: "[Deprecated] AI agent tracing detail rule -- consolidated into hatch3r-observability-tracing's AI Agent Instrumentation section"
scope: conditional
globs: "**/*trac*,**/*span*,**/*telemetry*,**/*otel*,**/*agent*,**/observability/**,**/routes/**,**/handlers/**,**/services/**,**/api/**,**/middleware/**,**/controllers/**,**/lib/**"
tags: [devops]
quality_charter: agents/shared/quality-charter.md
deprecated: true
cache_friendly: true
---
# Observability -- Tracing Extended Reference (Deprecated Redirect)

This rule has been merged into `hatch3r-observability-tracing`. Load that rule for AI agent instrumentation, tool call spans, LLM request/response tracing, tool call audit trails, and correlation ID patterns.

- See `hatch3r-observability-tracing` § "AI Agent Instrumentation" for: GenAI span attributes, agent invocation spans, tool call spans, LLM request/response tracing, tool call audit trail, correlation IDs for agent workflows.

<!-- DEPRECATED-CONTENT-REMOVED -->

The full content has been migrated to `hatch3r-observability-tracing`.
