---
id: hatch3r-anti-duplication
type: rule
description: Pre-implementation discovery gate (codebase pattern search) + post-write duplication scan (jscpd threshold per maturity tier). Silent duplication is a P4 violation.
tags: [anti-duplication, code-quality, floor:content-quality]
precedence: high
scope: always
cache_friendly: true
---
# hatch3r Anti-Duplication

**Pillars:** P4 (Comprehensive Lean Coverage), CQ8 (Maintainability Quality)

## Pre-Implementation Discovery Gate

Before writing any new function, type, or pattern:

1. **Grep existing surface** for similar function names: `grep -rn "function.*<similar-name>" src/`
2. **Grep existing surface** for similar type shapes: `grep -rn "type.*<similar-shape>" src/`
3. **Grep existing surface** for similar comment headers: `grep -rn "// <similar-purpose>" src/`
4. **Read closest existing match** end-to-end to confirm it does NOT cover the new requirement.

If a similar artifact exists with ≥80% scope overlap, do one of:

- Extend the existing artifact with the additional case.
- Refactor into a shared abstraction consumed by both.
- Document the distinct scope as an ADR before authoring the new artifact.

Surface discovery-scan findings via the Iteration Summary's `Duplication:` exception line (formats in `rules/hatch3r-iteration-summary.md` → Exception Lines); a scan that ran clean emits no line — silence asserts it.

## Post-Write Duplication Scan

After every implementation:

1. Run `npx jscpd <changed-dirs>` (or equivalent: PMD CPD, simian, sonar-scanner).
2. Flag any block matching ≥30 lines OR ≥80% similarity with existing code.
3. Refactor or justify before merge.

Tools accepted as equivalent: `jscpd` (Node), `PMD CPD` (Java/multi-lang), `simian` (multi-lang), `sonar-scanner` duplication module. Pick by toolchain; the threshold below is tool-agnostic.

## Value-Drift Census (Shared Constants)

A rate, default, threshold, or enum value consumed by ≥2 features has exactly one owning module; every other reader imports it. On touching such a constant, run the census: grep the constant NAME and the literal VALUE repo-wide; every independently-defined copy is a drift candidate.

- **Damage ranking — silent-wrong beats loud-broken.** A deleted import fails at build; a stale copy computes wrong values in production with no signal.
- **Remedy per copy:** import from the owner, or document intentional divergence with an inline ADR comment.
- **Outside the jscpd scan's reach:** one-line literals sit below clone-scan thresholds (≥30-line blocks) — the census is name+value grep, not block matching.
- **Taxonomy owner:** `rules/hatch3r-contract-census.md` → Value-Drift Census; this section is the anti-duplication-side enforcement hook.

## Tunable Thresholds Per Maturity Tier

Per `hatch3r config maturity=<tier>`:

- **solo** — jscpd threshold ≤10% (relaxed for early-stage exploration)
- **team** — jscpd threshold ≤7%
- **scaleup** — jscpd threshold ≤5%
- **enterprise** — jscpd threshold ≤3%

Tier set via `hatch3r config maturity=<tier>` per CONSTITUTION §6 Decision #16 (Decision 4 in fresh-session-prompt mapping). Threshold breach blocks merge until the offending block is refactored or justified with an inline ADR comment.

## Silent Duplication Violation

Per CONSTITUTION §2 P4: Single Source of Truth. Silent duplication (no ADR, no refactor) is a P4 violation surfaced by D16 Compound System audit + D22 Content Architecture audit (after authoring).

Per CONSTITUTION §2 P5 Silent Failure Contract: a duplication scan that finds matches but emits no warning to the caller is itself a contract violation — the scan must surface findings via the Iteration Summary's `Duplication:` exception line or a CI gate.

## Discovery Gate Output Schema

Report from the pre-implementation grep step lands in the implementer's structured output as:

```
discovery_scan:
  greps_run: <integer>
  candidate_matches: <integer>
  closest_match_path: <relative-path>
  overlap_assessment: none | partial | high (≥80%)
  decision: new-artifact | extend-existing | refactor-shared | adr-distinct
```

`overlap_assessment: high` without `decision: extend-existing | refactor-shared | adr-distinct` is a P4 violation — author is creating a duplicate.

At the user surface, the Iteration Summary carries the `Duplication:` exception line only on a non-clean or skipped scan — `Duplication: <n> match(es), closest <path>, overlap <none|partial|high>` when matches were found, or `Duplication: scan skipped (<reason>)` when skipped; a clean scan emits no line. Value-drift census hits reuse the same channel and silent-failure contract with the variant `Duplication: value-drift — <n> independent definition(s) of <constant>, owner <path>`; a clean census emits no line.

## Worked Example

Task: add a function that formats an ISO-8601 timestamp for a CLI log line.

1. Discovery grep: `grep -rn "function format.*Date\|function format.*Time\|function format.*Timestamp" src/`.
2. Closest match found: `src/cli/util/format.ts::formatLocalTime(date: Date): string` — 11 lines, formats `HH:mm:ss` only.
3. Overlap assessment: `partial` — same domain (date formatting) but distinct output shape (timestamp vs time-of-day).
4. Decision: `extend-existing` — add a `format: "iso" | "local"` parameter to `formatLocalTime`, rename to `formatTime`, update 3 callers.
5. Post-write scan: `npx jscpd src/cli/util/` reports 0% duplication on the change. Merge.

The discovery step took ~30 seconds; it prevented a parallel `formatIsoTimestamp` function and a forked test file.

## Skip Conditions

The discovery + scan procedure binds every code-writing turn EXCEPT:

- Single-line edits to existing functions (bug fix, typo, error-message wording).
- Frontmatter-only edits to canonical content artifacts.
- Test-file edits that mirror an existing source-file change (the test mirrors a function the discovery step already ran on).
- Cosmetic edits (whitespace, comment wording, import sorting).

When skipped, declare `Duplication: scan skipped (<reason>)` in the Iteration Summary. Skipping without declaration is itself a P5 silent-failure violation per CONSTITUTION §2 P5 Silent Failure Contract.

## Enforcement

- `agents/shared/quality-charter.md` §12 binds every agent to this procedure.
- `agents/hatch3r-implementer.md` runs the discovery gate before writing.
- `agents/hatch3r-reviewer.md` runs the duplication scan in review.
- The compound-system and content-architecture audit domains audit duplication at cycle time.

## Pillar Service

- P4 — every artifact earns its existence; no redundant code or content.
- CQ8 — generated code carries the same anti-duplication discipline (jscpd ≤5% per CONSTITUTION §2 CQ8 Measurement).

## References

- CONSTITUTION §6 Decision #21 (pre-implementation discovery + post-write duplication scan).
- CONSTITUTION §6 Decision #16 (maturity tier `solo|team|scaleup|enterprise`).
- CONSTITUTION §2 P4 (Single Source of Truth).
- CONSTITUTION §2 CQ8 (Maintainability Measurement — jscpd ≤5% per cycle).
- `agents/shared/quality-charter.md` §12 (Anti-Duplication Procedure).
- The compound-system audit domain (duplication candidate threshold SA 16.3).
- The content-architecture audit domain (content-corpus duplication audit; authored in subsequent cycle).
