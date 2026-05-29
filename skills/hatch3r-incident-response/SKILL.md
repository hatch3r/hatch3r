---
id: hatch3r-incident-response
name: hatch3r-incident-response
type: skill
description: Handle production incidents with structured triage, mitigation, and post-mortem. Use when responding to production issues, outages, or security incidents.
tags: [devops]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Incident Response Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Classify severity (P0-P3) based on impact
- [ ] Step 1b: Capture topology context — impacted service graph + upstream/downstream deps
- [ ] Step 2: Triage — identify affected systems, user impact, blast radius
- [ ] Step 3: Mitigate — apply hotfix or rollback, verify mitigation works
- [ ] Step 4: Root cause analysis — trace the failure chain
- [ ] Step 5: Write post-mortem with timeline, root cause, action items
- [ ] Step 6: Create follow-up issues for permanent fixes and preventive measures
```

Two policies bound this workflow before any remediation action runs: the **Bounded Autonomy & Escalation** matrix (which actions auto-execute vs require a human gate, by severity) and the **Telemetry Sources** adapter (where to read signal, by capability class). Both are defined below; read them before Step 3.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: user-facing impact vs internal-only, blast radius known (single tenant vs all users), rollback safety verified, stakeholder notification scope (engineering vs exec vs public), and whether mitigation requires data write (irreversible) vs config flip (reversible).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Bounded Autonomy & Escalation

An agent acting in a live incident operates under bounded autonomy: actions are bounded, reversible-first, and gated on a human-in-the-loop for high-blast-radius severities. This matrix sets the auto-action vs escalation threshold by severity. Match the row to the severity assigned in Step 1.

| Severity | Autonomy bound | Required gate before action |
| -------- | -------------- | --------------------------- |
| P0 | No autonomous mutation. Investigate, build the timeline, propose a diff — do not apply. | Human approval required before any mitigation. Page on-call; do not self-execute. |
| P1 | Confidence-routed. High-confidence reversible action (flag flip, scale-up, documented rollback) may auto-apply WITH a diff preview emitted first; low-confidence or irreversible action escalates. | Human gate when confidence is medium/low OR the action writes data / is irreversible. |
| P2 | Auto-remediation acceptable for reversible actions with a diff preview emitted before apply. | Human gate only for irreversible (data-write, schema, destructive) actions. |
| P3 | Auto-remediation acceptable. | None for reversible actions; flag irreversible actions for review. |

Rules that hold across all rows:

- **Reversibility-first.** Prefer the reversible mitigation (feature-flag flip, config revert, scale-up, deploy rollback) over an irreversible one (data write, schema change). An irreversible action escalates one severity band on the gate column.
- **Diff preview before apply.** Any auto-applied mutation emits the exact change (command, flag, config delta) before execution, never after.
- **Confidence routing.** State confidence (high/medium/low per `agents/shared/quality-charter.md` section 1) on every proposed mitigation. Medium/low confidence on P1 routes to a human gate.
- **Audit trail.** Every action (auto or gated) is recorded in the incident timeline (Step 5) with actor, timestamp, and the gate decision.

## Telemetry Sources

Capture signal from the project's observability stack before declaring blast radius (Step 1b) and when verifying mitigation (Step 3). Read the configured stack from project conventions; do not assume a vendor. Adapter patterns by capability class:

| Capability class | What to read | Common providers |
| ---------------- | ------------ | ---------------- |
| Distributed traces | Request path spans, `trace_id`/`span_id` correlation, latency percentiles | OpenTelemetry-compatible backend, Datadog APM, Grafana Tempo |
| Metrics (RED/USE) | Rate, Errors, Duration per route; Utilization, Saturation, Errors per resource | Prometheus/Grafana, CloudWatch, Datadog |
| Logs | Structured JSON with `trace_id`, service+version+environment, error-level stack traces | Splunk, CloudWatch Logs, Loki |
| Error tracking | Grouped exceptions with release + environment tags | Sentry-class tracker |
| Deploy/change history | Recent deploys, config changes, dependency bumps correlated to incident start | Platform CLI (`gh`/`az`/`glab`), CI deploy log |

Reference `rules/hatch3r-observability-tracing.md` and `rules/hatch3r-observability-logging.md` for the end-user instrumentation floor these sources read from. When a capability class is not instrumented in the project, record the gap as a post-mortem action item rather than assuming data exists.

## Step 1: Classify Severity

| Severity | Definition                                  | Examples                                     |
| -------- | ------------------------------------------- | -------------------------------------------- |
| P0       | Complete outage, data loss, security breach | App unusable, auth down, data exposed        |
| P1       | Major degradation, significant user impact  | Sync failing, billing broken, >1% error rate |
| P2       | Partial degradation, limited impact         | Single flow broken, slow performance       |
| P3       | Minor issue, workaround available            | Cosmetic bug, edge case                     |

- Check for related issues or prior incidents using the platform tools (check `platform` in `.hatch3r/hatch.json`):
  - **GitHub:** Use **GitHub MCP** (`issue_read`, `search_issues`) or `gh issue list --search "..."`
  - **Azure DevOps:** `az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '...'"` or `az boards work-item show --id N`
  - **GitLab:** `glab issue list --search "..."` or `glab issue view N`
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 1b: Capture Topology Context

Before declaring blast radius in Step 2, map the impacted service graph. A correct blast-radius estimate depends on knowing what the failing component talks to — upstream callers amplify user impact, downstream dependencies are candidate root causes.

1. **Identify the impacted node(s):** which service, function, or resource is emitting the failure signal (from the Telemetry Sources above).
2. **Trace upstream:** which services/clients call the impacted node? These define the user-facing blast radius — a failure in a shared dependency fans out to every caller.
3. **Trace downstream:** which dependencies does the impacted node call (database, queue, third-party API, RPC peer)? A downstream failure is a candidate root cause, not a symptom site.
4. **Record the graph:** capture the upstream/downstream edges (from distributed traces, a service catalog, or an architecture ADR in project docs) before estimating blast radius. If no service map exists, reconstruct it from trace spans and note the absence as a post-mortem action item.

Output a one-line topology summary: `impacted: {node} | upstream callers: {list} | downstream deps: {list}`. Step 2 blast-radius estimation consumes this directly.

## Step 2: Triage

- **Affected systems:** Frontend, backend, database, auth, payment, third-party services?
- **User impact:** How many users? Which flows? Which plans (free/paid)?
- **Blast radius:** Is the issue contained or spreading?
- **Data:** Any data corruption, loss, or exposure? Check project privacy/security specs for implications.
- **Timeline:** When did it start? Any recent deploys, config changes, or dependency updates?

## Step 3: Mitigate

- **Immediate actions:** Rollback last deploy, disable feature flag, revert config, scale up, or apply hotfix.
- **Verification:** Confirm mitigation works — error rate drops, affected flow recovers.
- **Communication:** Notify stakeholders per the page-target SLA below. Document status in incident channel or issue.
  - Default page-target by severity (tune per org): P0 — page on-call ≤5 min after detection; P1 — ≤15 min; P2 — ≤1 h; P3 — next business day.
- Do not spend time on perfect fixes during active incident — stabilize first.

## Step 4: Root Cause Analysis

- Trace the failure chain: what changed, what failed, why.
- Review logs (correlationId, userId), metrics, deploy history.
- Check ADRs in project docs for architectural context.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 5: Post-Mortem

Write a structured post-mortem document:

- **Summary:** One-paragraph description of the incident.
- **Timeline:** Key events (detection, mitigation, resolution) with timestamps.
- **Root cause:** What went wrong and why.
- **Impact:** Users affected, duration, business impact.
- **Action items:** Permanent fixes, preventive measures, process improvements.
- **Lessons learned:** What we'll do differently.

Store in project incident docs or as an issue/wiki page on the platform. Follow project conventions.

## Step 6: Follow-Up Issues

- Create follow-up issues/work items for each action item from the post-mortem (check `platform` in `.hatch3r/hatch.json`):
  - **GitHub:** `gh issue create --title "..." --body "..." --label "incident-follow-up"` (or use **GitHub MCP** `issue_create`)
  - **Azure DevOps:** `az boards work-item create --type "Bug" --title "..." --description "..." --fields "System.Tags=incident-follow-up"`
  - **GitLab:** `glab issue create --title "..." --description "..." --label "incident-follow-up"`
- Label appropriately (e.g., `incident-follow-up`, `P0`, `P1`).
- Link issues/work items to the post-mortem and to each other.
- Assign owners and due dates for critical fixes.

## Error Handling

- **Cannot reproduce the incident locally**: Use production logs and traces to build the timeline. If local reproduction is blocked by environment differences, document the gap and recommend a staging environment test.
- **Mitigation introduces new issues**: Roll back the mitigation immediately, reassess the approach, and apply a more targeted fix. Document both the original incident and the mitigation regression in the post-mortem.
- **Root cause spans multiple services or teams**: Document the cross-service dependency chain, assign follow-up items to the responsible teams, and coordinate a joint post-mortem.

## Definition of Done

- [ ] Incident mitigated and verified
- [ ] Post-mortem written with timeline, root cause, and action items
- [ ] Follow-up issues created for permanent fixes and preventive measures
- [ ] Stakeholders notified (if P0/P1)
- [ ] No sensitive data (secrets, PII, code content) in post-mortem or logs

## Additional Resources

- Privacy/security specs: project documentation
- Observability: project logging and correlation conventions
- Error handling: project error handling patterns
