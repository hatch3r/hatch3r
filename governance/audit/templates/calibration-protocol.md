# Reviewer Confidence Calibration Protocol

> Last updated: 2026-05-18
> Pillars: P2 (primary), P5 (supporting).
> Canonical for: `governance/audit/templates/reviewer-sub-agent.md` Pass 1.5 confidence verification, `governance/AUDIT-EXECUTE.md` Phases 5/6/7 cycle close.

## Purpose

Detect drift between **claimed** reviewer confidence (Pass 1.5 of `governance/audit/templates/reviewer-sub-agent.md`) and **observed** outcome of the implemented finding. The reviewer is the judge of its own confidence; without an out-of-band measurement loop, that confidence claim is structurally over-trusted (D13-SA13.2-F2, Cycle 9). This protocol is that loop: at every cycle close, sample N=20 prior-cycle reviewer findings, score the claim against the realized outcome, and log the divergence.

Confidence schema is defined in `governance/audit/templates/rigor-contract.md` §Required Finding Output Schema (`confidence: high | medium | low`, `confidence_basis: direct measurement | sampled observation | inference from analogue`). This protocol does not redefine those bands — it audits how reviewers apply them.

## Process

At every cycle close (after the final reviewer verdict, before the cycle is archived) the orchestrator runs the calibration check:

1. **Sample.** Select N=20 findings from `governance/audit/finding-registry.json` whose `cycle` is the most recently completed cycle and whose `reviewer_verdict` is `PASS` or `PARTIAL`. Sample uniformly at random across domains; if fewer than 20 qualify, take all and log `sample_size_below_target: true`.

2. **Re-evaluate.** For each sampled finding, compare:
   - **Claimed confidence** — value of `confidence` recorded in the registry entry at reviewer verdict time.
   - **Observed outcome** — one of: `held` (no follow-up finding in next-cycle audit touching same file/recommendation), `weakened` (next-cycle audit re-finds the same root cause OR `execution_status` was downgraded post-verdict OR a rollback or hotfix touched the change within 14 days), `strengthened` (next-cycle audit recorded the change as a strength under the relevant domain's "Strengths" section).

3. **Score divergence.** Map (claimed, observed) to one of `aligned` / `over-claimed` / `under-claimed`:

   | Claimed | held | weakened | strengthened |
   |---------|------|----------|--------------|
   | high    | aligned | over-claimed | aligned |
   | medium  | aligned | over-claimed | under-claimed |
   | low     | under-claimed | aligned | under-claimed |

   `over-claimed` is the failure mode of interest: the reviewer expressed more certainty than the realized outcome justified.

4. **Threshold check.** Flag the cycle if any of the following hold:
   - `over_claimed >= 5/20` (25% over-claim rate)
   - `over_claimed_high >= 3/20` (3+ findings where claimed=high but observed=weakened)
   - `aligned <= 10/20` (overall alignment below 50%)

   Above-threshold flagging produces a CL-3 candidate (per `governance/AUDIT-EXECUTE.md` Phase 7) to tighten reviewer-sub-agent.md Pass 1.5 confidence verification rules.

## Output

Append a single calibration log entry to `governance/audit/execution-insights.json` under `current.reviewer_calibration` during the cycle close, promoted to `history[N].reviewer_calibration` by `npm run audit:archive` (per `src/audit/insights.ts::promoteToHistory`):

```yaml
reviewer_calibration:
  cycle_number: <int>
  cycle_date: YYYY-MM-DD
  sample_size: <int, target=20>
  sample_size_below_target: <bool>
  sampled_finding_ids: [<finding_id>, ...]
  distribution:
    aligned: <int>
    over_claimed: <int>
    over_claimed_high: <int>
    under_claimed: <int>
  thresholds_exceeded: [<list of triggered threshold names, empty if none>]
  cl3_candidate_filed: <bool>
  cl3_candidate_id: <string|null>
  notes: <one-paragraph qualitative summary, ≤3 sentences>
```

The log lives next to `fix_success_rate` and `sizing_accuracy` in the same insights ring buffer; Phase 1 of the next cycle reads `history[].reviewer_calibration` to inform reviewer-prompt selection per `governance/AUDIT-EXECUTE.md` §Previous Cycle Insights.

## Triggers

Two trigger paths:

1. **Cycle close (mandatory).** Phases 5/6/7 of `governance/AUDIT-EXECUTE.md` cannot mark the cycle archive-ready until `reviewer_calibration` has been appended to `current` insights. Skip is permitted only when `cycle_number == 1` (no prior cycle to sample) and must log `skip_reason: first_cycle`.

2. **Ad-hoc reviewer drift (optional).** Any framework maintainer or `/h4tcher-governance-check` run may invoke this protocol mid-cycle when one of the following holds: ≥2 rollbacks landed against findings the reviewer marked `confidence: high` in the same wave; the SHIP verdict was reversed after merge; a downstream audit cycle (within 3 cycles) re-finds the same root cause on a previously `PASS`-verdicted change. Ad-hoc runs append to `current.reviewer_calibration_adhoc[]` rather than overwriting the cycle-close entry.

## Constraints

- N=20 is the floor, not the ceiling — larger samples are accepted but the threshold ratios still apply.
- Sampling is uniform-random across domains; do not stratify (stratification re-introduces reviewer bias into the calibration step itself).
- The calibration sub-agent does NOT modify the original reviewer verdict. Divergence findings flow through CL-3 (per-proposal user consent) to tighten future verdicts — never to retroactively rewrite a past one.
- This protocol does not replace Pass 1.5 confidence verification in `governance/audit/templates/reviewer-sub-agent.md`. Pass 1.5 runs **within** a cycle; calibration runs **across** cycles.

## Pillar Service

- **P2 Scientific Quality (primary).** Operationalizes Test 3 (Confidence with basis) and Test 5 (Bias check) of the rigor contract at cycle scale — overclaiming confidence becomes detectable, not just declared.
- **P5 Governance Self-Quality (supporting).** Eliminates the "reviewer as judge of own confidence" structural over-trust pattern identified in D13-SA13.2-F2 by adding an out-of-band measurement loop.

Pillar Compliance Test answers per `governance/CONSTITUTION.md` §2: (1) P2 primary, P5 supporting. (2) Measurable improvement — 20-sample calibration produces an `over_claimed_rate` time series per cycle; ≥25% over-claim or ≥3/20 high-confidence weakening triggers a CL-3 candidate. (3) Net governance size impact: +1 file (≤120 lines); offset is the reduction in over-trusted PASS verdicts that would otherwise re-surface as Cycle N+1 findings.
