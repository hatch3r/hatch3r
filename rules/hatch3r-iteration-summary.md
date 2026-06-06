---
id: hatch3r-iteration-summary
type: rule
description: 9-section iteration summary template emitted by every orchestrator command and meaningful skill run — status, outcome, done/not-done, fan-out + cost, verifications, gates, pillar impact, open questions, learnings captured.
tags: [iteration, summary, telemetry, floor:content-quality]
precedence: high
scope: always
---
# hatch3r Iteration Summary

**Pillars:** P5 (Governance Self-Quality), P7 (Speed & Token Efficiency — cost visibility)

## When Required

Every orchestrator command (`commands/hatch3r-*.md` with `orchestrator: true`) AND every meaningful skill run (`/h4tcher-*` or `/hatch3r-*` that mutates state) MUST emit the 9-section block as the final user-facing output.

## Pre-Execution Cost Preview

Every orchestrator command MUST emit a one-block cost preview BEFORE its first sub-agent dispatch (Decision 24 at the user-facing surface), so the user sees the cost envelope before any agent spawns:

```yaml
cost_preview:
  expected_sa_count: <integer>
  estimated_input_tokens_static_frame: <integer>
  triage_tier: 1 | 2 | 3
  web_research_budget: <integer queries, 0 if none>
  estimated_duration_min: <integer>
```

Calibrate the fields to the triage tier (see `rules/hatch3r-deep-context`); source token estimates from `src/pipeline/observability.ts` / `src/pipeline/costEstimator.ts`. The post-run §2 "Fan-out + Cost" section closes the loop by reporting actuals + `delta_percent` against this preview. Commands wire the preview as an explicit pre-dispatch step (e.g., `commands/hatch3r-workflow.md` Step 0.5).

## The 9 Sections

1. **Request** — verbatim restatement of the user's ask in one sentence
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` + `cost: { estimated_input_tokens, actual_input_tokens, estimated_duration_min, actual_duration_min, delta_percent }`
3. **Web Research** — every URL fetched with access date + trust tier (per `agents/shared/rigor-contract.md`); count 0 acceptable if no research was needed
4. **Files Mutated** — list with diff summary (lines added / removed / files created)
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per Decision 17
7. **Verification Commands** — exact commands run with exit codes + key output lines (≤200 chars)
8. **Open Questions / Blockers** — explicit None if fully closed
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run; cross-reference `rules/hatch3r-learning-system.md`

## Required Fields per quality-charter §11

- **Status:** closed enum SUCCESS | PARTIAL | FAILED | BLOCKED
- **Outcome:** one sentence
- **Done / Not Done / Deferred / Unverified:** explicit lists
- **Confidence + basis:** one of direct measurement | sampled observation | inference from analogue
- **Consulted Learnings:** IDs of `.hatch3r/learnings/` entries the bound agents (implementer / reviewer / researcher / fixer) read this run per the `rules/hatch3r-learning-system.md` Mandatory Consultation Gate; `none` when INDEX.md is absent or zero `applies-to` rows matched. Distinct from §9 Learnings Captured (entries written this run). Citing zero when `applies-to` matched is a gate failure.

## Confidence-to-Action Mapping (D13)

When a review loop ran this turn, the §5 Confidence line MUST append the action guidance for the loop's terminal confidence level (`reviewLoopConfidence` in `src/pipeline/reviewLoop.ts`). This is the canonical confidence-to-action text — `confidenceExplanation` in `src/pipeline/reviewLoop.ts` returns these exact three strings, so the typed helper and this user-facing rule stay byte-identical (the strings are no longer reachable only from a unit test, closing D13-SA13.2-F2):

- **high** — The fix was correct on the first attempt. Human review is optional but recommended for critical code paths.
- **medium** — The fix required one round of corrections, which is normal for moderately complex changes. A brief human review is recommended.
- **low** — The fix required multiple attempts or was interrupted. A thorough human review is strongly recommended before merging.

Omit the mapping when no review loop ran (e.g. a Tier 1 typo edit with no reviewer pass) — no confidence level is derived, so no action line applies.

## Optional Pattern Rationale (D13 in-flow teaching)

Orchestrators MAY emit a `## Pattern Rationale` block before the Iteration Summary to teach the user the framework pattern applied — closing the knowledge-transfer gap surfaced by D13 SA13.4 F5. One line per pattern with rule citation + pillar served + plain-language reason:

```
pattern_rationale:
  - pattern: <name, e.g., "circuit-breaker for outbound DB call">
    rule: <rules/hatch3r-*.md path or agents/shared/principles.md anchor>
    pillar: <P1..P8 or CQ1..CQ9>
    why: <≤1 sentence plain language>
```

Default omission policy: emit when at least one mutated file applies a named rule the user did not request explicitly. Skip on trivial edits (typo, frontmatter-only). When omitted entirely, no field appears — this preserves token budget for Tier 1 runs.

## User-Accepted Bypass Record (D13)

When the user explicitly accepts a low-confidence PASS at an ASK checkpoint (per the gate-failure rule in the Confidence Propagation Contract used by every core orchestrator), the orchestrator MUST:

1. Emit `User-Accepted Bypass: yes` in §8 (Open Questions / Blockers) with the bypass reason verbatim from the user reply.
2. Append a single line to `.hatch3r/bypass-log.jsonl` (one JSON object per line — append-only, never rewritten):

```json
{"ts": "<ISO-8601>", "command": "<hatch3r-* name>", "verdict": "low", "user_reason": "<verbatim ≤200 chars>", "files": ["<paths>"], "session_id": "<id>"}
```

Schema: `ts` ISO-8601 UTC timestamp; `command` the orchestrator command id; `verdict` always `low` (no bypass on high/medium per the contract); `user_reason` the user's verbatim acceptance string (truncated at 200 chars, no PII); `files` mutated file list; `session_id` the host runtime's session id when available, `unknown` otherwise. Atomic append via `src/merge/safeWrite.ts` pattern (temp+rename then concat). Absence of the line on a recorded bypass is a P5 gate failure.

## Validation Gate

A skill or command that omits the 9-section block fails the lifecycle gate (`.claude/rules/capability-lifecycle.md`). Prose substitution is rejected. The orchestrator catches the omission before declaring SUCCESS.

## Emission-Rate Telemetry

The validation gate above asserts the block is present per run; it does not measure the emission rate across runs. The SPACE-class telemetry pipeline (`src/pipeline/spaceTelemetry.ts`, Decision 24 sibling of cost-visibility) records that rate: each orchestrator/meaningful-skill run emits one `activity`-axis metric `iterationSummaryEmitted` (value `1` when the 9-section block was produced, `0` when skipped) via `recordSpaceMetric`, persisted to `.hatch3r/telemetry/space-<YYYY-MM-DD>.jsonl` and aggregated by `getSpaceSummary`. The audit cycle reads the aggregate to verify the CONSTITUTION §2 P5 "Sub-agent count emission on delegating artifacts: 100%" target is met in practice rather than only mandated (D10-SA10.8-F-6). Persistence honours the Silent Failure Contract — telemetry I/O never throws.

## Pillar Service
- P5 — standardised reporting prevents drift across orchestrators
- P7 — cost section surfaces token + duration deltas to user per Decision 24
