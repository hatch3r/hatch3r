---
id: hatch3r-reviewer-calibration
type: rule
description: "Reviewer runtime confidence-calibration contract: every Nth (default N=5) consecutive clean PASS triggers an out-of-band second-pass review before loop exit; divergence reverts to REQUEST CHANGES; each second pass logs to .hatch3r/calibration-log.jsonl. Canonical source of the N-default and the directive that agents/hatch3r-reviewer.md and calibration-protocol.md reference."
tags: [review, orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Reviewer Confidence Calibration

**Pillars:** P2 (Scientific & Practical Quality), P5 (Governance Self-Quality)

A reviewer's `confidence` rating is self-assigned by the same model that produced the verdict. Without an out-of-band check it is structurally over-trusted, and over-confident models systematically under-emit `confidence: low` (arxiv:2508.06225). This rule is the canonical, always-on source for the **runtime** (within-loop) bound that closes that gap before the review loop exits on a clean PASS. It owns the N-default and the directive that `agents/hatch3r-reviewer.md` §Runtime Confidence Calibration and the across-cycle calibration protocol cite.

Scope split (do not duplicate across the two artifacts):

- **Runtime, within-loop (this rule + `agents/hatch3r-reviewer.md`):** bounds an unbounded run of self-trusted clean verdicts inside one review-loop session. Fires before loop exit.
- **Across-cycle measurement (the across-cycle calibration protocol):** samples N=20 prior-cycle PASS findings at cycle close and scores realized over-claim rate. Fires at cycle archive time.

The two are complements, not substitutes — neither replaces the other.

## Directive (verbatim)

> Every Nth consecutive clean PASS verdict on a review-loop exit triggers one out-of-band second-pass review of the same diff. If the second pass surfaces any Critical or Warning the first pass did not, the loop does NOT exit clean — it reverts to REQUEST CHANGES. Each second pass appends one record to `.hatch3r/calibration-log.jsonl`.

## N-default (authoritative)

`N = 5` consecutive clean PASS verdicts. This is the single source of truth for the default; `agents/hatch3r-reviewer.md` and the across-cycle calibration protocol cite this value rather than redeclaring it.

- **Counter owner — the orchestrator, NOT the reviewer.** The reviewer sub-agent is spawned stateless per iteration and the review loop exits on the first clean verdict, so a reviewer-owned counter can never exceed 1 and the second pass would never fire. The orchestrator owns `consecutive_clean_pass_count` and reads/writes it; the reviewer only reports its per-verdict outcome.
- **Counter scope — across top-level runs, persisted.** Count consecutive clean PASS verdicts across top-level pipeline runs, not within one loop and not per-iteration (the loop exits on the first clean verdict, so within a single loop the count advances by at most 1). The orchestrator persists the running count to project-local `.hatch3r/calibration-state.json` (`{ "consecutive_clean_pass_count": <int>, "updated_at": "<ISO-8601>" }`), written atomically via `src/merge/safeWrite.ts`. On each top-level run the orchestrator reads the prior count, increments on a would-be-clean exit, and resets to 0 on any REQUEST CHANGES or DESIGN_OBJECTION verdict. A missing/unparseable file is treated as count 0.
- **Project override:** a project may set a different cadence via its own config; the override widens or narrows the cadence but never disables the second pass while a second pass remains available (see Unavailability below).

## Trigger

The orchestrator evaluates the trigger at the would-be-clean loop exit (the point where the loop would return a clean PASS — 0 Critical + 0 Warning — to Phase 4), using the cross-run counter it persisted per N-default above. Either branch fires the second pass:

- **Cadence branch (default):** the post-increment `consecutive_clean_pass_count` (prior persisted count + 1 for this run) is a multiple of `N`.
- **High-risk fast path:** the reviewed diff touches any high-risk surface — a file tagged `floor:security`, auth/authn code (the `hatch3r-security` (CQ3) dispatch set in `agents/hatch3r-reviewer.md`: `src/auth/**`, OAuth/OIDC config, WebAuthn/passkey server, release-pipeline files, dependency manifest/lockfile), or any change that triggers the CQ3 security specialist. For a high-risk diff, fire the second pass on the **first** clean PASS, independent of the cadence counter (do not wait for the Nth). The high-risk branch still increments and persists the cross-run counter; it only lowers the firing threshold to 1 for that run.

## Action

Run one second-pass review of the same diff with an independent judge:

1. **Preferred:** a different model class, when the orchestrator can route one. The second pass renders its own independent verdict + confidence.
2. **Fallback:** the same model class re-rolled at higher temperature, when no second model class is available.

The second pass applies the same Review Checklist as the first (`agents/hatch3r-reviewer.md` → Review Checklist); it is a full re-review, not a spot check.

## Divergence handling

- **Divergent** — the second pass surfaces any Critical or Warning the first pass did not: do NOT exit clean. Revert the loop verdict to REQUEST CHANGES, record both verdicts, and feed the divergence to the next fixer iteration.
- **Aligned** — both passes agree (both clean): exit clean and record alignment.

A divergent second pass is the failure mode of interest — it is the runtime signal that the first pass was over-confident.

## Logging

Append exactly one record per second pass to `.hatch3r/calibration-log.jsonl` (project-local, JSON Lines) via the atomic append path in `src/merge/safeWrite.ts`. One JSON object per line:

```json
{"timestamp":"<ISO-8601>","first_pass_verdict":"PASS","second_pass_verdict":"PASS|REQUEST CHANGES","divergent":false,"second_pass_model_class":"different|re-roll","consecutive_clean_count":5,"trigger":"cadence|high-risk"}
```

`consecutive_clean_count` is the post-increment cross-run count at firing time; `trigger` records which Trigger branch fired (`high-risk` when the diff touched a high-risk surface and the second pass fired on the first clean PASS). The project-local over-claim rate derived from this log feeds the iteration-summary `Confidence` field per `rules/hatch3r-iteration-summary.md`.

## Unavailability (visible skip, never silent)

Skip the second pass ONLY when no second model class is available AND the orchestrator has disabled same-model re-roll. In that case emit `calibration: skipped (no second pass available)` in the verdict so the gap is visible rather than silent — a silent skip is a Silent-Failure-Contract violation. A skip does NOT reset the consecutive-clean-PASS counter; the next eligible exit re-attempts the second pass.

## Pillar Service

- **P2 Scientific & Practical Quality (primary).** Adds an adversarial out-of-band check to a self-assigned confidence value; over-claimed clean verdicts become detectable at runtime, not just at cycle close.
- **P5 Governance Self-Quality (supporting).** Removes the "reviewer as sole judge of its own confidence" structural over-trust pattern from the within-loop path, mirroring the across-cycle loop that `calibration-protocol.md` adds at cycle scope.

## References

- `agents/hatch3r-reviewer.md` §Runtime Confidence Calibration — the consuming agent body that invokes this contract (accessed 2026-05-28, trust tier: canonical).
- The across-cycle calibration protocol §Runtime complement (F13.2-F1) — the across-cycle measurement loop this runtime bound complements (accessed 2026-05-28, trust tier: canonical).
- `rules/hatch3r-iteration-summary.md` — consumes the project-local over-claim rate for the `Confidence` field (accessed 2026-05-28, trust tier: canonical).
- Anthropic / arXiv. "Confidence calibration in large language models" (arxiv:2508.06225). `https://arxiv.org/abs/2508.06225` (accessed 2026-05-28, peer-reviewed-methodology). Evidence that self-reported model confidence under-emits low-confidence signals, motivating the out-of-band second pass.
