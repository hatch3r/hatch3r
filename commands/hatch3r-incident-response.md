---
id: hatch3r-incident-response
type: command
orchestrator: true
agentPipeline: [hatch3r-incident-responder, hatch3r-reliability, hatch3r-security]
description: Drive a live production incident through a structured lifecycle -- triage + topology, bounded-autonomy mitigation, stakeholder communication, then a blameless post-mortem with runbook -- via delegated sub-agents.
disable-model-invocation: true
tags: [devops, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 2
  rationale: One hatch3r-incident-responder specialist drives the live lifecycle (triage → bounded-autonomy mitigation → communication → blameless post-mortem); one hatch3r-reliability specialist runs the post-incident telemetry/SLO reconstruction in parallel once the incident is stabilized. Tier 1 spawns only the incident-response specialist (count 1); a security-suspected incident adds hatch3r-security. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the incident report for unresolved questions in scope, impact, irreversibility, or constraint conflicts (user-facing vs internal-only, blast radius unknown, rollback safety unverified, stakeholder-notification scope unspecified, or a mitigation that writes data / changes a schema with downstream consumers). If any are found, ask via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Live incidents are high-blast-radius, so irreversibility detection on every proposed mitigation is mandatory. Residual ambiguity discovered mid-incident invokes the same protocol.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Triage + topology + mitigate + communicate | `hatch3r-incident-responder` (executes `skills/hatch3r-incident-response/SKILL.md` Steps 1-3) | No | Yes |
| 2. Post-incident telemetry/SLO reconstruction | `hatch3r-reliability` (CQ4) | Yes (with Stage 3 drafting) | Tier 3, or any P0/P1 with an SLO-burn |
| 3. Blameless post-mortem + runbook + follow-ups | `hatch3r-incident-responder` (SKILL.md Steps 5-6) | No | When post-mortem required (P0/P1) |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): the Stage 2 reliability reconstruction is read-only against telemetry while Stage 3 drafts the post-mortem — disjoint writes, deterministic aggregation (the reconstruction feeds the post-mortem root-cause section), no shared mutable state.

---

# Incident Response — Triage, Mitigate, Communicate, Learn

Drives a live production incident end-to-end through delegated sub-agents. The orchestrator never edits files or applies mitigations inline; it delegates the live lifecycle to `hatch3r-incident-responder`, runs the post-incident reliability reconstruction in parallel, and integrates the blameless post-mortem.

The detailed runbook — severity table, Bounded Autonomy & Escalation matrix, Telemetry Sources adapter, topology-capture, and the six-step post-mortem template — lives in `skills/hatch3r-incident-response/SKILL.md`. This command orchestrates that runbook through sub-agents; it does not restate it.

**When to use this command vs. the `hatch3r-incident-response` skill vs. the `hatch3r-incident-responder` agent:**

- Use this **command** when: a live incident is open and the response is nontrivial (multi-service blast radius, a mitigation that needs a human gate, or a P0/P1 requiring incident-command discipline and a post-incident reliability reconstruction).
- Use the **skill** directly when: you are running the runbook yourself inline and want the step-by-step procedure without sub-agent delegation overhead.
- Use the **agent** directly when: another orchestrator (e.g. a reviewer pass) needs the incident-response specialist for post-incident reconstruction only.

---

## Token-Saving Directives

1. **Read telemetry once per scope.** The incident-response specialist captures the topology + telemetry snapshot once (Stage 1); pass it into the Stage 2 reliability prompt rather than re-querying.
2. **Targeted reads only.** Read only files on the failure path identified during triage — not the full codebase.
3. **Structured output only.** Every sub-agent prompt requires structured markdown output — no prose dumps.

---

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents carry the `quality_charter: agents/shared/quality-charter.md` reference in frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against live telemetry. Medium = topology/pattern-based, not directly reproduced. Low = best judgment, recommend human review.

Downstream propagation: every status update, every mitigation gate, and the post-mortem root-cause section MUST carry a high/medium/low rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure. A Low-confidence root cause blocks closing the incident.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked ASK, using the platform-native question tool per `agents/shared/user-question-protocol.md`.

## Step 0: Triage

Classify the incident before delegating, using the `skills/hatch3r-incident-response/SKILL.md` Step 1 severity table:

- **Tier 1 (P3 / minor):** single contained flow, reversible mitigation, no stakeholder paging. Spawn only `hatch3r-incident-responder`; skip Stage 2 reliability reconstruction. Post-mortem optional (recommended only if recurrence-prone).
- **Tier 2 (P2 / partial degradation):** limited blast radius, reversible mitigation acceptable with a diff preview. Spawn `hatch3r-incident-responder`; run the post-mortem (Stage 3). Add Stage 2 reliability reconstruction if an SLO burned.
- **Tier 3 (P0/P1 / major incident):** outage, security incident, or wide blast radius. Full pipeline — incident-response specialist with incident-command discipline (no autonomous mutation on P0; human gate on P0/P1 mitigations), parallel `hatch3r-reliability` reconstruction, and a mandatory blameless post-mortem.

Severity-to-tier is recomputed as blast radius is confirmed: an unconfirmed blast radius classifies upward (P3→P2, P2→P1), never downward.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 1), surface the cost preview so a delegated incident response is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 tier:

```yaml
cost_estimate:
  expected_sa_count: <Tier 1 ~1, Tier 2 ~1-2, Tier 3 ~2 (3 if security-suspected)>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>      # 0 when no research is needed
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a contained nuisance scored Deep, or a creeping outage scored Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification.
- The override wins over the auto-detected tier; record both so the cost estimate block reports the budget delta.
- The override does NOT suppress the severity-upgrade safety rule: a `--effort=light` run whose blast radius confirms P0/P1 still runs the Tier-3 incident-command discipline (no autonomous mutation on P0; human gate on mitigation). Safety dominates the cost override.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Triage + Mitigate + Communicate (Live Lifecycle)

Spawn `hatch3r-incident-responder` via the Task tool (`subagent_type: "generalPurpose"`) to execute `skills/hatch3r-incident-response/SKILL.md` Steps 1-4 (classify severity, capture topology, mitigate under the Bounded Autonomy & Escalation matrix, communicate to stakeholders).

The specialist prompt MUST include: the incident brief (symptoms, detection time, observed impact, affected environment, any recent deploys/config changes), the Step 0 tier + severity, all `scope: always` rule directives from `rules/`, a `correlation_id` (UUID v4 per `rules/hatch3r-agent-orchestration.md` → Correlation ID), the confidence expression requirement above, and the bounded-autonomy gate contract (verbatim):

> Bounded-autonomy gate: prefer the reversible mitigation (flag flip, kill-switch, config revert, scale-up, deploy rollback) over an irreversible one. Emit a diff preview (exact command/flag/config delta) before executing any auto-applied mutation. On a P0 incident, do NOT self-execute — investigate, build the timeline, propose the diff, and return for human approval. On P1, auto-apply only high-confidence reversible actions with a diff preview; medium/low-confidence or irreversible actions escalate to a human gate. Record every action in the incident timeline with actor, timestamp, and gate decision.

**ASK (mitigation gate — fires on every P0, and on any P1/irreversible action):** "Incident severity {P0-P3}. Proposed mitigation: {one-line + diff preview} (confidence {high/medium/low}, reversible: {yes/no}). Apply? (apply / adjust mitigation / escalate to on-call / investigate further)". For reversible high-confidence mitigations on P2/P3, the specialist may auto-apply with a diff preview and report it — no ASK required.

After the specialist returns, verify the mitigation against telemetry (error rate dropped, affected flow recovered) before declaring the incident stabilized. If the mitigation introduced a new issue, roll it back immediately and re-derive — per the skill's Error Handling.

---

### Step 2: Post-Incident Reliability Reconstruction (Tier 3 / SLO-burn; parallel with Step 3)

Once the incident is stabilized, spawn `hatch3r-reliability` via the Task tool to reconstruct which CQ4 floors held at incident time — SLO burn, span coverage on the failing path, RED/USE signal availability, resilience-pattern presence on the implicated outbound call. This runs read-only against telemetry, in parallel with the Step 3 post-mortem drafting.

The reliability prompt MUST include: the stabilized incident summary + topology map from Step 1, the failing service + route, all `scope: always` rule directives, the `correlation_id`, and the confidence expression requirement. Its output feeds the post-mortem's root-cause and action-item sections (e.g. "readiness probe gated on liveness signal — add dependency-health gate" as a follow-up).

Skip this stage for Tier 1, and for Tier 2 incidents where no SLO burned.

---

### Step 3: Blameless Post-Mortem + Runbook + Follow-Ups

Spawn `hatch3r-incident-responder` to execute `skills/hatch3r-incident-response/SKILL.md` Steps 5-6: write the blameless post-mortem (summary, timeline, root cause, impact, action items, lessons), author an alert-linked runbook for the failure mode, and file one follow-up issue per action item via the project's platform CLI.

The specialist prompt MUST include: the Step 1 timeline + mitigation record, the Step 2 reliability reconstruction (when run), all `scope: always` rule directives, the `correlation_id`, the confidence expression requirement, and the blameless-post-mortem contract (verbatim):

> Blameless post-mortem contract: assume every responder acted on the best information available. Focus on contributing causes, not individual fault. Do not name individuals as the cause. The root-cause section carries a confidence rating; a Low-confidence root cause keeps the post-mortem open (do not declare the incident closed). Strip secrets, PII, and proprietary code from the document.

Skip the post-mortem for Tier 1 incidents unless the failure mode is recurrence-prone.

---

### Step 4: Summary + Git Action

1. Present a concise completion summary:

```
Incident Response Complete:
  Severity:        {P0-P3}
  Blast radius:    {impacted node | upstream callers | downstream deps}
  Mitigation:      {one-line — reversible/irreversible, gate decision}
  Recovery:        {telemetry-verified: error rate dropped / flow recovered}
  Post-mortem:     {path/issue — blameless, root cause confidence high/medium/low}
  Follow-ups:      {N issues filed}
  Confidence:      {high/medium/low — overall incident verdict}
```

2. **ASK:** "Incident stabilized and post-mortem drafted. How should I handle the post-mortem + follow-up artifacts in git? (a) commit only, (b) commit and push, (c) skip git — leave in working tree". Applied mitigations on live infrastructure are NOT a git action — they are already recorded in the incident timeline.

Commit message format: `docs: post-mortem for {incident-slug}` (post-mortem + runbook are documentation/follow-up artifacts). For pushes, fall back to `git push -u origin {branch}` when no upstream exists.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for incident-response: `1` = triage + topology + mitigate + communicate (incident-response specialist), `2` = post-incident reliability reconstruction (reliability), `3` = blameless post-mortem + runbook + follow-ups (incident-response specialist), `4` = summary + git + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: post-mortem document, runbook, follow-up issue drafts, config/flag diffs authored for review. This command has no Tier-1 inline carve-out for file mutations: post-mortem and runbook authoring always flow through the `hatch3r-incident-responder` sub-agent.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 28, superseded in place 2026-07-06).

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

---

## Error Handling

- **Cannot reproduce the incident locally:** use production telemetry to build the timeline per the skill's Error Handling; record the local-reproduction gap as a post-mortem action item.
- **Mitigation introduces a new issue:** roll back the mitigation immediately, reassess, apply a more targeted fix; document both the original incident and the mitigation regression in the post-mortem.
- **Specialist sub-agent failure (Step 1):** the incident is live — surface the partial state and **ASK** immediately (provide missing context / escalate to on-call human / abort delegation and hand the live incident to the operator). Never silently retry a live-mitigation step.
- **Root cause unconfirmed (all hypotheses Low-confidence):** do not close the incident. State the verdict ("Root cause unconfirmed; top hypothesis confidence=low") and keep the post-mortem open with an investigation action item.
- **Root cause spans multiple services or teams:** document the cross-service dependency chain, assign follow-ups to the responsible teams, and recommend a joint post-mortem per the skill's Error Handling.
- **Suspected security breach surfaced mid-incident:** add `hatch3r-security` to the pipeline for the threat assessment; this command retains ownership of the timeline and mitigation discipline.

## Resumability (Decision 27/30)

A live incident is long-running and a responder hand-off mid-incident is common, so checkpoint the lifecycle — a resumed run re-enters at the last completed stage rather than re-applying a mitigation already executed or re-filing follow-up issues already filed. Applied live-infra mitigations are recorded in the incident timeline, not the checkpoint, so resumption never re-executes a flag flip or rollback.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.incident-workspace/`; step range the Step 0 → Step 4 progression; `wave` = the post-mortem drafting iteration; snapshot/rollback paths every authored artifact (post-mortem document, runbook, follow-up drafts). Write points: after the Step 0 triage, after the Step 1 mitigation record (the mitigation timeline is the source of truth — the checkpoint references it, never re-executes it), after the Step 2 reliability reconstruction, and after the Step 3 post-mortem + follow-ups.

## Guardrails

- **Reversibility-first.** Prefer reversible mitigations; an irreversible action escalates one severity band and always routes to a human gate.
- **No autonomous mutation on P0.** P0 incidents: investigate, build the timeline, propose the diff, page for approval — never self-execute.
- **Diff preview before apply.** Any auto-applied mutation emits the exact change before execution, never after.
- **Always delegate.** All file mutation (post-mortem, runbook, follow-up drafts) flows through `hatch3r-incident-responder` via the Task tool — no inline edits from the orchestrator turn.
- **Blameless post-mortems.** Never assign individual blame; focus on contributing causes.
- **Confidence propagation.** Every status update, mitigation gate, and post-mortem root-cause section carries a confidence rating from the upstream sub-agent. Dropping the signal is a gate failure.
- **Hygiene.** Strip secrets, PII, and proprietary code from the post-mortem, the incident channel, and logs.
- **This command composes existing hatch3r artifacts** (`hatch3r-incident-responder` agent + skill, `hatch3r-reliability`) — it orchestrates the runbook through sub-agents; it does not replace the skill or restate the runbook.

---

## References

- `skills/hatch3r-incident-response/SKILL.md` — the runbook this command orchestrates (severity table, Bounded Autonomy & Escalation matrix, Telemetry Sources, topology capture, six-step post-mortem); accessed 2026-06-02, trust tier: official-docs (in-repo canonical).
- `agents/hatch3r-incident-responder.md` — the specialist this command delegates the live lifecycle and post-mortem to; accessed 2026-06-02, trust tier: official-docs (in-repo canonical).
- `commands/hatch3r-bug-pipeline.md` — orchestrator command structure + Per-Turn Header / Delegation Attestation / Iteration Summary / Cost Visibility block patterns mirrored here; accessed 2026-06-02, trust tier: official-docs (in-repo canonical).
- PagerDuty — "Incident Response Documentation: Severity Levels" (https://response.pagerduty.com/before/severity_levels/) — accessed 2026-06-02, PagerDuty, **official-docs**. Source for the severity-to-response escalation mapping (SEV-1/SEV-2 → major-incident response with incident-commander paging) that the Step 0 tiering and Step 1 mitigation gate map onto the skill's P0-P3 table.
- Atlassian — "The Atlassian Incident Management Handbook" (https://www.atlassian.com/incident-management/handbook) — accessed 2026-06-02, Atlassian, **official-docs**. Source for incident-command authority (single owner empowered to coordinate, page, and gate) and the blameless-post-mortem-for-SEV2+ practice with a post-incident review within 24-48 hours encoded in Step 3.
