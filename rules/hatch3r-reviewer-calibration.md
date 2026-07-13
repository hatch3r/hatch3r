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

A reviewer's `confidence` rating is self-assigned by the same model that produced the verdict. Without an out-of-band check it is structurally over-trusted: LLM judges systematically overstate confidence — predicted confidence significantly exceeds realized correctness (Tian et al. 2025, arxiv:2508.06225) — so a self-reported clean PASS carries a non-zero, unmeasured miscalibration probability at runtime. This rule is the canonical, always-on source for the **runtime** (within-loop) bound that closes that gap before the review loop exits on a clean PASS. It owns the N-default and the directive that `agents/hatch3r-reviewer.md` §Runtime Confidence Calibration and the across-cycle calibration protocol cite.

Scope split (do not duplicate across the two artifacts):

- **Runtime, within-loop (this rule + `agents/hatch3r-reviewer.md`):** bounds an unbounded run of self-trusted clean verdicts inside one review-loop session. Fires before loop exit.
- **Across-cycle measurement (the across-cycle calibration protocol):** samples N=20 prior-cycle PASS findings at cycle close and scores realized over-claim rate. Fires at cycle archive time.

The two are complements, not substitutes — neither replaces the other.

## Directive (verbatim)

> Every Nth consecutive clean PASS verdict on a review-loop exit triggers one out-of-band second-pass review of the same diff. If the second pass surfaces any Critical or Warning the first pass did not, the loop does NOT exit clean — it reverts to REQUEST CHANGES. Each second pass appends one record to `.hatch3r/calibration-log.jsonl`.

## N-default (authoritative)

`N = 5` consecutive clean PASS verdicts for general diffs; `N = 1` for safety-class diffs (auth / security / migration — see the high-risk fast path in Trigger). These are the single source of truth for the defaults; `agents/hatch3r-reviewer.md` and the across-cycle calibration protocol cite these values rather than redeclaring them. The lowered safety-class default fires the second pass on the first clean PASS so an auth, security, or migration change never merges on a single self-trusted verdict (D23-2).

- **Counter owner — the orchestrator, NOT the reviewer.** The reviewer sub-agent is spawned stateless per iteration and the review loop exits on the first clean verdict, so a reviewer-owned counter can never exceed 1 and the second pass would never fire. The orchestrator owns `consecutive_clean_pass_count` and reads/writes it; the reviewer only reports its per-verdict outcome.
- **Counter scope — across top-level runs, persisted.** Count consecutive clean PASS verdicts across top-level pipeline runs, not within one loop and not per-iteration (the loop exits on the first clean verdict, so within a single loop the count advances by at most 1). The orchestrator persists the running count to project-local `.hatch3r/calibration-state.json` (`{ "consecutive_clean_pass_count": <int>, "updated_at": "<ISO-8601>" }`), written atomically via `src/merge/safeWrite.ts`. On each top-level run the orchestrator reads the prior count, increments on a would-be-clean exit, and resets to 0 on any REQUEST CHANGES or DESIGN_OBJECTION verdict. A missing/unparseable file is treated as count 0.
- **Project override:** a project may set a different cadence via its own config; the override widens or narrows the cadence but never disables the second pass while a second pass remains available (see Unavailability below).

## Trigger

The orchestrator evaluates the trigger at the would-be-clean loop exit (the point where the loop would return a clean PASS — 0 Critical + 0 Warning — to Phase 4), using the cross-run counter it persisted per N-default above. Either branch fires the second pass:

- **Cadence branch (default):** the post-increment `consecutive_clean_pass_count` (prior persisted count + 1 for this run) is a multiple of `N`.
- **High-risk fast path (safety-class, N=1):** the reviewed diff touches any safety-class surface — a file tagged `floor:security`, auth/authn code (the `hatch3r-security` (CQ3) dispatch set in `agents/hatch3r-reviewer.md`: `src/auth/**`, OAuth/OIDC config, WebAuthn/passkey server, release-pipeline files, dependency manifest/lockfile), any change that triggers the CQ3 security specialist, OR a schema/event-schema migration (the `migration.review` surface — schema DDL, backfills, event-schema changes). For a safety-class diff, fire the second pass on the **first** clean PASS, independent of the cadence counter (do not wait for the Nth). The fast-path branch still increments and persists the cross-run counter; it only lowers the firing threshold to `N=1` for that run.

## Action

Run one second-pass review of the same diff with an independent judge:

1. **Documented setup recommendation — a different model class.** A same-model-family critique shares the generator's blind spot, so a same-family second pass cannot detect the error classes the family is systematically biased to produce (Huang et al., ICLR 2024, "Large Language Models Cannot Self-Correct Reasoning Yet"). Route the second pass to a different model class wherever the deployment can — this is the recommended project setup, not best-effort. The second pass renders its own independent verdict + confidence.
2. **Fallback — same model class re-rolled at higher temperature,** used ONLY when no second model class is routable. Because this fallback does not break the shared-blind-spot, it is a weaker check: emit `calibration: degraded (same-family re-roll)` in the verdict for that run so the weakened independence is visible and never asserted as a clean cross-family check. Record the model class used in the log (`second_pass_model_class: re-roll`).

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

`consecutive_clean_count` is the post-increment cross-run count at firing time; `trigger` records which Trigger branch fired (`high-risk` when the diff touched a safety-class surface and the second pass fired on the first clean PASS under the `N=1` fast path). `second_pass_model_class` is `different` for a cross-family second pass or `re-roll` for the same-family fallback; a `re-roll` record corresponds to a `calibration: degraded (same-family re-roll)` verdict annotation per Action. The project-local over-claim rate derived from this log feeds the `Confidence:` exception line of the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`.

## Unavailability (visible skip, never silent)

Skip the second pass ONLY when no second model class is available AND the orchestrator has disabled same-model re-roll. In that case emit `calibration: skipped (no second pass available)` in the verdict so the gap is visible rather than silent — a silent skip is a Silent-Failure-Contract violation. A skip does NOT reset the consecutive-clean-PASS counter; the next eligible exit re-attempts the second pass.

## Pillar Service

- **P2 Scientific & Practical Quality (primary).** Adds an adversarial out-of-band check to a self-assigned confidence value; over-claimed clean verdicts become detectable at runtime, not just at cycle close.
- **P5 Governance Self-Quality (supporting).** Removes the "reviewer as sole judge of its own confidence" structural over-trust pattern from the within-loop path, mirroring the across-cycle loop that `calibration-protocol.md` adds at cycle scope.

## References

- `agents/hatch3r-reviewer.md` §Runtime Confidence Calibration — the consuming agent body that invokes this contract (accessed 2026-05-28, trust tier: canonical).
- The across-cycle calibration protocol §Runtime complement (F13.2-F1) — the across-cycle measurement loop this runtime bound complements (accessed 2026-05-28, trust tier: canonical).
- `rules/hatch3r-iteration-summary.md` — consumes the project-local over-claim rate for the `Confidence:` exception line (accessed 2026-05-28, trust tier: canonical).
- Tian, Z. et al. "Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution" (arxiv:2508.06225). `https://arxiv.org/abs/2508.06225` (accessed 2026-06-09, peer-reviewed-methodology). Evidence that an LLM judge's predicted confidence significantly overstates realized correctness (the Overconfidence Phenomenon), so a self-reported clean PASS is structurally over-trusted — motivating the out-of-band second pass.
- Huang, J. et al. "Large Language Models Cannot Self-Correct Reasoning Yet." ICLR 2024 (arxiv:2310.01798). `https://arxiv.org/abs/2310.01798` (accessed 2026-06-06, peer-reviewed-methodology). Evidence that same-model self-critique shares the generator's blind spot, motivating the different-model-class setup recommendation in Action and the lowered safety-class `N=1` second-pass cadence (D23-2).
- `rules/hatch3r-ai-evals.md` §Eval Metrics — the sibling LLM-as-judge surface (the AI-feature eval judge). It shares this rule's judge-bias vocabulary (self-preference / different-model-class) and adds position-bias order-randomization for its pairwise adoption gate (accessed 2026-07-11, trust tier: canonical).
