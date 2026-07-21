---
id: hatch3r-iteration-summary
type: rule
description: "Recap-contract iteration summary — every orchestrator command and meaningful skill run closes with a 1-2 line recap (status, outcome, files/sub-agents/gates/cost-delta telemetry) plus exception lines that fire on non-default outcomes with one always-emitted exception — the `Not done:` line appears on every recap (`Not done: none — full scope completed` when empty) — and a Remaining Work terminal block closes the run when scope items remain, each item carrying a `disposition:` suffix recorded via the single bundled Deferred-Items Disposition Gate ASK; silence asserts the default for every other line."
tags: [iteration, summary, telemetry, floor:content-quality]
precedence: high
scope: always
---
# hatch3r Iteration Summary

**Pillars:** P5 (Governance Self-Quality), P7 (Speed & Token Efficiency — cost visibility)

## When Required

Every orchestrator command (`commands/hatch3r-*.md` with `orchestrator: true`) AND every meaningful skill run (`/h4tcher-*` or `/hatch3r-*` that mutates state) MUST close with the recap-contract Iteration Summary as the final user-facing output — with at most two sanctioned trailers after it: the Plan-Execution Handoff block (see §Plan-Execution Handoff below), then the Remaining Work block (§Remaining Work (terminal block)), which when it fires is the run's very last output — with the Deferred-Items Disposition Gate ASK (§Deferred-Items Disposition Gate) as the one sanctioned interposition before that final block. The block opens with the literal heading `## Iteration Summary` — the stable extraction anchor for downstream consumers. Governance anchor: CONSTITUTION §6 Decision 37 (2.7.1; Replaces: 28 — the recap contract that superseded the former sectioned template 2026-07-06).

## Pre-Execution Cost Preview

Every orchestrator command MUST emit the pre-dispatch cost preview defined at `rules/hatch3r-cost-visibility.md` → Pre-Execution Estimate BEFORE its first sub-agent dispatch (Decision 29 at the user-facing surface). That rule owns the preview schema — do not restate it here. Commands wire the preview as an explicit pre-dispatch step (e.g., `commands/hatch3r-workflow.md` Step 0.5); the recap's cost facet closes the loop by reporting deltas against it.

## The Recap

Under the `## Iteration Summary` heading, the body is a 1-2 line recap:

```
Line 1:  **<SUCCESS|PARTIAL|FAILED|BLOCKED>** — <one outcome sentence naming the work object and end state>
Line 2:  files <N> (+<added>/−<removed>) · sa <actual>/<expected> · gates <passed>/<run> · cost Δ<tok%>% tok / Δ<min%>% min · tier <1|2|3>
```

Status enum reused from `agents/shared/quality-charter.md` §11. Facet order fixed (machine-parseable). `+<added>/−<removed>` are diff line totals (lines added/removed) across the changed files. `sa <actual>/<expected>` carries the fan-out count; **rationale stays a dispatch-time emission** per `rules/hatch3r-fan-out-discipline.md` (validate-fanout-emission unaffected). Merge condition: line 2 folds into line 1 parenthesized when ≥3 facets at rest (files 0, sa 0, gates 0); at-rest facets fold away except `files`, `sa`, and `tier` — e.g. `**SUCCESS** — Explained adapter precedence (read-only: files 0 · sa 0 · tier 1)`.

## Exception Lines

Below the recap, a line appears ONLY when its firing condition holds. An absent exception line is a positive claim of its Silent-when default — silence asserts the default. Each entry is a single line; `Cost:` is the one multi-line exception (its fenced YAML follows the line). Exception to the silence rule — `Not done:` has an always-true firing condition: it appears on every recap, as `Not done: none — full scope completed` when every scope item completed (a positive assertion, never silence).

| Line | Format | Fires when | Gate preserved | Silent-when |
|---|---|---|---|---|
| Not done | `Not done: <item> [— deferred: <why> \| unverified: <what>]; …` or `Not done: none — full scope completed` | always (the empty form is the positive assertion of full completion) | charter honesty; handoff Work Remaining | never — always emitted |
| Blockers | `Blockers: <blocker or open question>; …` | any open blocker | old §8; handoff Blockers | none open |
| Open findings | `Open findings: <finding_id> <sev> — <disposition>; …` | any findings-ledger row folds non-terminal, or terminal as `escalated`/`surfaced`, at recap time | findings-ledger run-exit invariant (`rules/hatch3r-findings-ledger.md`) | no ledger file for this run, or every row folds to done/deferred/declined/accepted-risk/already-resolved |
| Default applied | `Default applied: <question summary> → option <N> (<one-line reason>)` — format unchanged from the superseded template, one per default; disposition-gate non-interactive form: `Default applied: kept deferred (non-interactive)` | ASK default exercised (incl. the disposition gate's non-interactive default) | **P8 B1** | no default taken |
| Gates failed | `Gates failed: <gate>: <one-line cause>; …` | recap gates shows failure | P1 actionability | all gates passed |
| Cost | `Cost: flagged_for_review: true` + fenced cost_actuals/delta YAML (the one multi-line exception) | any delta > 25% absolute | **Decision 29** / cost-visibility AC5 | deltas within ±25% (recap Δ facet suffices; telemetry persists regardless) |
| Confidence | `Confidence: <high\|medium\|low> — <basis>[. <D13 action string verbatim>]` | review loop ran OR confidence < high OR status ≠ SUCCESS | D13 mapping; reviewer-calibration; anti-inflation | SUCCESS + high + direct measurement + no loop |
| Review independence | `Review independence: <same-family\|not-declared> — self-preference bias possible; clean PASS is not provider-independent` | a review loop ran AND its resolved reviewer↔fixer `verdictIndependence` (`src/pipeline/reviewLoop.ts`) is `same_family` or `unknown` — the hatch3r default routes both agents to one model family | D13-SA13.2-01 trust-calibration disclosure; reviewer D15-M8 limitation | reviewer and fixer ran on `different_family` (clean PASS is provider-independent), or no review loop ran |
| User-Accepted Bypass | `User-Accepted Bypass: yes — <verbatim reason ≤200 chars>` + JSONL append | accepted low-confidence PASS | D13 bypass record | no bypass |
| Learnings | `Learnings: consulted <ids> · surfaced <ids> · captured <ids> · outcome <id:helpful\|neutral\|harmful\|untested>` (omit empty facets) | any facet non-empty; `outcome` carries one verdict per consulted id at run close | learning-system gates; outcome capture for `rules/hatch3r-learning-system.md` → Outcome-Weighted Promotion | no INDEX / zero matches / nothing captured |
| Tier | `formatTierUpgradeNote` output verbatim (one-liner, `src/pipeline/pipelineContext.ts:647-655`) | mid-run tier upgrade | D7-14 | no upgrade |
| Duplication | `Duplication: <n> match(es), closest <path>, overlap <none\|partial\|high>` or `Duplication: scan skipped (<reason>)` | scan matched OR skipped | anti-duplication silent-failure | scan ran clean |
| Next (optional, never gated) | `Next: <one-line suggested action>` | concrete next step exists | charter optional-sections precedent | nothing to suggest |

Charter-field mapping: Status + Outcome → line 1; Done → outcome + files facet; the rest → exception lines. Learning-system's "citing zero when `applies-to` matched is a gate failure" becomes fired-condition-with-no-line.

## Handoff Mapping

Handoff surfaces (`rules/hatch3r-handoff-readiness.md`, `skills/hatch3r-handoff-prepare/SKILL.md`, `agents/hatch3r-handoff-preparer.md`) derive their fields from the recap:

- **Work Done** ← recap outcome (line 1) + files facet
- **Work Remaining** ← `Not done:` line verbatim (the `none — full scope completed` form ⇒ no remaining work); a missing line in a legacy transcript ⇒ `None — full scope completed`
- **Blockers** ← `Blockers:` line; absent ⇒ `None`
- **Open Findings** ← `Open findings:` line; absent ⇒ none

## Confidence-to-Action Mapping (D13)

When a review loop ran this turn, the `Confidence:` exception line MUST append the action guidance for the loop's terminal confidence level (`reviewLoopConfidence` in `src/pipeline/reviewLoop.ts`). This is the canonical confidence-to-action text — `confidenceExplanation` in `src/pipeline/reviewLoop.ts` returns these exact three strings, so the typed helper and this user-facing rule stay byte-identical (the strings are no longer reachable only from a unit test, closing D13-SA13.2-F2):

- **high** — The fix was correct on the first attempt. Human review is optional but recommended for critical code paths.
- **medium** — The fix required one round of corrections, which is normal for moderately complex changes. A brief human review is recommended.
- **low** — The fix required multiple attempts or was interrupted. A thorough human review is strongly recommended before merging.

Omit the mapping when no review loop ran (e.g. a Tier 1 typo edit with no reviewer pass) — no confidence level is derived, so no action line applies.

## Pattern Rationale (D13 in-flow teaching — default-ON at Tier ≥ 2)

At Tier ≥ 2 the orchestrator MUST emit a `## Pattern Rationale` block before the Iteration Summary — one SHORT line per framework pattern applied this turn (rule citation + pillar served + plain-language reason), so sub-agent reasoning reaches the user instead of being summarized away (D13 SA13.4 F5/F6):

```
pattern_rationale:
  - pattern: <name, e.g., "circuit-breaker for outbound DB call">
    rule: <rules/hatch3r-*.md path or agents/shared/principles.md anchor>
    pillar: <P1..P8 or CQ1..CQ9>
    why: <≤1 sentence plain language>
```

Emission policy: one line per mutated file that applies a named rule the user did not request explicitly; a Tier ≥ 2 turn that applied at least one such pattern and omits the block is a P5 gate failure (same enforcement class as the Validation Gate below). Tier 1 trivial edits (typo, frontmatter-only, single-line clarification) skip the block, mirroring the Tier-1 exemption in `rules/hatch3r-agent-orchestration.md` → Per-Turn Pipeline-State Header. When a Tier ≥ 2 turn applied no named rule beyond the request, emit `pattern_rationale: none (no implicit pattern applied)` so absence is never ambiguous. A triggered plan/act split (`agents/shared/efficiency-patterns.md` P4) is recorded here as an entry carrying `plan_act_split: triggered`; a skipped split stays silent — silence asserts the skip. The `--quiet` CLI flag suppresses the block at the user surface only (same precedent as cost data in `rules/hatch3r-cost-visibility.md`); suppression does not weaken the Tier ≥ 2 emission contract for default runs.

## User-Accepted Bypass Record (D13)

When the user explicitly accepts a low-confidence PASS at an ASK checkpoint (per the Confidence Propagation Contract used by every core orchestrator), the orchestrator MUST (1) emit the `User-Accepted Bypass:` exception line with the bypass reason verbatim from the user reply, and (2) append one JSON object line to `.hatch3r/bypass-log.jsonl` (append-only, never rewritten; atomic append via the `src/merge/safeWrite.ts` pattern — temp+rename then concat):

```json
{"ts": "<ISO-8601 UTC>", "command": "<hatch3r-* name>", "verdict": "low", "user_reason": "<verbatim ≤200 chars, no PII>", "files": ["<paths>"], "session_id": "<host session id, else unknown>"}
```

Absence of the line on a recorded bypass is a P5 gate failure.

## Validation Gate

A run fails the gate when the recap is missing, when any registry row's firing condition holds with no corresponding exception line, or when prose is substituted for the recap grammar. A `plan_handoff: true` run that ends at the plan seam (stop/defer, `--auto`, `--review-only`, non-interactive — §Plan-Execution Handoff) and closes without the Plan-Execution Handoff block fails the gate identically; a run that continued through the Execute-Now Continuation is exempt — emitting the block there is itself the violation. A recap missing the `Not done:` line fails the gate — the line is always-emitted, never a silent default. A run whose `Not done:` line carries ≥1 item but that does not close with the `## Remaining Work` terminal block (§Remaining Work (terminal block)) fails the gate. A `## Remaining Work` item line missing its `disposition:` suffix fails the gate, as does a disposition-eligible run (≥1 deferred item, unresolved follow-up, or punted human decision) that emitted neither the bundled disposition ASK nor the `Default applied: kept deferred (non-interactive)` line (§Deferred-Items Disposition Gate). Registry-row checking is an explicit pre-status step: before declaring status, the orchestrator walks the table above and emits each line whose firing condition holds — the omission is caught before SUCCESS is declared.

## Plan-Execution Handoff (plan_handoff: true)

Commands whose frontmatter declares `plan_handoff: true` MUST append the Plan-Execution Handoff block immediately after the recap. Format, shapes (A direct / B chain), Tier-1 carve-out, and suppression rule are owned by `commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block) — this rule points there and restates nothing. The block and the Remaining Work block (§Remaining Work (terminal block)) are the two sanctioned post-recap trailers; when both fire, the handoff block renders first and Remaining Work renders last. A run firing neither closes with the recap itself. The block is required when the run ends at the plan seam (stop/defer, `--auto`, `--review-only`, non-interactive); a producer run that continued through the Execute-Now Continuation (`commands/shared/orchestration-frame.md` → Execute-Now Continuation) closes with the execution recap and emits no handoff block.

## Deferred-Items Disposition Gate

Fires when the end-of-run Remaining Work set contains ≥1 deferred item, unresolved follow-up, or punted human decision. Zero such items ⇒ the gate passes silently — no ASK, no block (an empty ASK is itself a violation). Purpose: deferred items otherwise accumulate silently across runs, letting a run read as done while decisions pile up unrecorded — the gate converts each item into one recorded human decision before the run may close.

Protocol — BEFORE emitting the final `## Remaining Work` block, the orchestrator asks ONE bundled question via the platform question tool per `agents/shared/user-question-protocol.md`:

- The question body lists every deferred item, numbered. When >4 items, group them under ≤4 labels (by file, domain, or theme) and number the groups so the ASK stays within one screen.
- Options (fixed): `1. Keep deferred (default)` · `2. Follow up now in this session` · `3. Queue as a new workflow/plan`. The reply may split by item/group number (e.g., "2 for items 1 and 3, 1 for the rest"); every item not explicitly assigned takes the default.
- One ASK total per run — never one per item, and never a second ASK after a follow-up pass.
- Non-interactive/headless runs skip the ASK, apply option 1 to every item, and emit the registered exception line `Default applied: kept deferred (non-interactive)`.
- Option 2 items re-enter execution BEFORE the summary re-emits: run the follow-up work, then re-emit the Iteration Summary — completed items drop off `Not done:`; items still open carry `disposition: followed-up` in the re-emitted Remaining Work block, with no second ASK.
- Option 3 items record `disposition: queued:<ref>` where `<ref>` names the created artifact (plan file, issue id, or board item).

Disposition suffix: every item line in the `## Remaining Work` block carries a mandatory `disposition: kept | followed-up | queued:<ref>` suffix. An item line without one is a gate failure (§Validation Gate) — no deferred item may appear without a recorded human decision (or the recorded non-interactive default).

## Remaining Work (terminal block)

Fires when the `Not done:` line carries ≥1 item (not the `none — full scope completed` form) (Decision 37). Position: the VERY LAST output of the run — after the recap, its exception lines, and the Plan-Execution Handoff block when both fire. The Deferred-Items Disposition Gate ASK (§Deferred-Items Disposition Gate) is the only element permitted between the run-closing sequence — End-of-Turn Delegation Attestation (`rules/hatch3r-agent-orchestration.md`), recap, trailers — and this final block; the block itself stays last.

Format: the heading `## Remaining Work`, then the `Not done:` line copied verbatim with each item gaining the mandatory `disposition: kept | followed-up | queued:<ref>` suffix (§Deferred-Items Disposition Gate), then the `Blockers:` and `Open findings:` lines copied verbatim only when those recap lines fired — the disposition suffix is the block's one bookkeeping addition beyond re-surfaced recap data.

Scope clause: the block reflects THIS run's scope gaps only — a plan-producing run whose deliverable is the plan does not list plan execution as not-done.

## Emission-Rate Telemetry (current status: per-run gate only; cross-run rate not yet wired)

The Validation Gate asserts recap presence per run; no automated cross-run emission-rate measurement exists today. `src/pipeline/spaceTelemetry.ts` provides `recordSpaceMetric`, `loadSpaceMetricsFromDisk`, and `summarizeSpaceMetricRecords`, but nothing on the iteration-summary path invokes them — commands and skills are LLM-interpreted markdown with no binding to compiled `src/`, so the cross-run loop is a future capability, not a live measurement (origin D10-SA10.8-F-6; gap corrected D10-18). The module records only the `activity` and `performance` axes; `satisfaction` and `communication` are reserved with no feeder, so "SPACE" names the data shape, not five-axis coverage (D10-40). Wiring requires a host-runtime post-turn bridge emitting an `iterationSummaryEmitted` metric to `.hatch3r/telemetry/space-<YYYY-MM-DD>.jsonl`; until then, P5 emission compliance rests on the per-run gate plus audit-cycle spot checks.

## Pillar Service
- P1 — the always-emitted `Not done:` line plus the Remaining Work terminal block make incompleteness un-missable at run end (actionability)
- P8 — the disposition gate routes every deferred item through one bundled B1 ASK (`agents/shared/user-question-protocol.md`), so run-end deferral is a recorded human decision, never silent accumulation
- P5 — one standardised recap plus an auditable exception-line registry prevents drift across orchestrators
- P7 — the recap cost facet surfaces token + duration deltas per Decision 29 at a fraction of the former template's token footprint
