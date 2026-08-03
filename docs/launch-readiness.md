---
id: launch-readiness
type: doc
description: Gate launch decisions (Show HN, r/ClaudeAI, Twitter/X) on objective readiness criteria; defines prerequisites, recommended sequence, anti-patterns, and the decision log for cycle-over-cycle launch-go decisions.
tags: [distribution, launch, governance, decision-log]
---

# Launch Readiness

> Source authority: the PRD §14 (Distribution Channels) and the project's supply-chain floor policy (npm provenance + SBOM + SHA-pinned actions). Closes finding F18.3.5 (Cycle 10, High).

## Purpose

Gate every external launch decision (Show HN, r/ClaudeAI, Twitter/X, sponsored placements, podcast appearances, conference demos) on the objective prerequisites listed in §2 below. Launching before all prerequisites are GREEN produces negative compounding: HN front-page traffic that finds an unfinished install path leaves a permanent comment trail that future visitors read first.

This document is the single decision point. If a prerequisite is not GREEN, the launch is NO-GO regardless of internal pressure or external opportunity.

## 1. Status

| Field | Value |
|-------|-------|
| Current readiness | NO-GO (v2.6.0 release-cut refresh, 2026-07-14) — see §3 status snapshot. The launch this gate governs is the T2 promotion wave (Show HN, r/ClaudeAI); the PRD §1 HOLD was dispositioned cleared-with-exception (2026-07-12, C12-CL1-1): the named-blocker Critical cluster is registry-done, so T2 now waits only on the three human acts — T0 storefront-count repair, T1 directory submissions, and a GO row in §6/the decision log. |
| Last reviewed | 2026-08-03 (v2.8.6 release cut — P6 re-verified same-day against v2.8.6's own published evidence in §3: SLSA-v1 provenance attestation, 101 verified registry signatures + 7 attestations with 0 invalid on a scratch install, `sbom.cdx.json` release asset, docs deploy success on merge commit a4e1e05a) |
| Next review trigger | Any §2 prerequisite flips, or any of the three remaining human acts (T0 storefront repair, T1 submissions, GO decision row) lands |

## 2. Prerequisites

All six must read GREEN before any external-facing launch posts. Each row cites the canonical source.

| # | Prerequisite | Canonical source | Verification command |
|---|--------------|------------------|----------------------|
| P1 | PRD §1 distribution HOLD cleared for the T2 promotion wave | PRD §1 "Distribution recommendation" HOLD + its named-blocker integrity assertion; `governance/audit/finding-registry.json` | The PRD §1 HOLD's named-blocker cluster is registry-done (`execution_status: "done"`) AND no open Critical remains in the current cycle's registry — the pointer inherits every future HOLD re-anchor via the PRD §1 integrity assertion (re-checked by AUDIT-EXECUTE Phase 0 step 7), so it never hard-codes a superseded cohort |
| P2 | PRD §1 posture pointer resolves to a GO distribution recommendation | PRD §1 Posture (dated-source pointer, D18-7) → current-cycle `governance/AUDIT-REPORT.md` header | The distribution recommendation the PRD §1 posture pointer resolves to reads GO (not HOLD / Staged GO); no bare "Distribution-Ready" literal is restated inline, per the D18-7 pointer convention |
| P3 | AAIF stance documented in PRD §5.x (closes F18.2.2 / F17.3.1) | PRD §5 (positioning section) | PRD §5 mentions agents.md / AAIF / cross-tool fallback at least once |
| P4 | 3-lane distribution plan (npm/CLI, Cursor marketplace, Claude Code marketplace) documented as live in PRD §14 | PRD §14 Distribution Channels; CONSTITUTION §6 Decision 12 (3-adapter scope) | All three ratified lanes documented as live channels (not "planned"). The retired AGENTS.md/AAIF lane is NOT a prerequisite — Decision 12 withdrew the emitter and PRD §14 records the §5.x AAIF-sunset gate satisfied; re-expansion would need a queued §8 amendment (VISION §Adapter scope), not this gate |
| P5 | Marketplace submission package current (`docs/marketplace-submission.md`) | `docs/marketplace-submission.md` (referenced from F18.3.4) | Status field reads `READY` not `PARTIAL`; counts match `governance/inventory.json`; in-app form URLs reachable |
| P6 | Latest release published with npm provenance + SBOM | Supply-chain floor policy (npm provenance + SBOM + SHA-pinned actions) | `npm view hatch3r@latest dist.signatures` returns provenance attestation; SBOM artifact present on the corresponding GitHub release |

## 3. Status snapshot (v2.8.6 release-cut refresh, 2026-08-03)

| Prereq | Status | Blocker / evidence |
|--------|--------|--------------------|
| P1 | GREEN | Named-blocker cluster registry-done: D1-SA1.10-01 (`done`, commit a7a6212) + D4-SA4.3-01 (`done` 2026-07-12 — branch-protection contract applied, drift probe green, actions run 29204707085); zero open Criticals in the live registry; HOLD dispositioned cleared-with-exception (PRD v4.10, C12-CL1-1) |
| P2 | RED | No full-GO distribution recommendation and no GO decision-log row yet — the cleared-with-exception ruling holds T2 on the three human acts (T0 storefront repair, T1 directory submissions, GO row) |
| P3 | GREEN | PRD §5.x is standards-watch only; PRD §14 records the AAIF-stance gate satisfied |
| P4 | GREEN | PRD §14 documents npm/CLI + Cursor + Claude Code marketplace lanes as live channels; §14 records the 3-lane-documented gate satisfied. Prior sub-note resolved: `add <pack>` shipped as a trust-gated v1 installer in 2.5.0 (Cycle-12 CL-2, D5-SA5.3-09) |
| P5 | AMBER | `docs/marketplace-submission.md` Status = PARTIAL (agent portion done); human in-app form submissions pending (PRD §1 "submissions pending") |
| P6 | GREEN | v2.8.6 (published 2026-08-03) verified same-day post-publish per release-prep Step 10 item 34: `npm view hatch3r@2.8.6 dist.attestations` returns SLSA-v1 provenance (`https://slsa.dev/provenance/v1`); `npm audit signatures` on a scratch install reports 101 verified registry signatures + 7 verified attestations, 0 invalid; `gh release view v2.8.6` ships the `sbom.cdx.json` SBOM asset with the CHANGELOG 2.8.6 section as body; docs deploy workflow concluded success on merge commit a4e1e05a. Prior v2.8.0/v2.8.5 evidence (same verification set, merge commit 9df32217) and v2.7.2/v2.7.1 evidence retained in the §6 log |

Overall: **NO-GO** for the T2 promotion wave — P2 RED (no GO decision row) + P5 AMBER (submissions pending); P1 has been GREEN since the v2.5.0 refresh, so the gate waits on human acts only, not engineering. No launch decision was taken at the v2.6.0 cut (no §6 row added).

## 4. Launch sequence (recommended)

Run in order. Do not parallelize lanes — each step depends on the previous step landing publicly so that audience clicks resolve to working install paths.

| Week | Step | Output | Exit condition |
|------|------|--------|----------------|
| 1 | GitHub repo public + README polish + first 2.0.0 npm release with provenance (P6) | Public repo URL, npm package published, GitHub release page with SBOM artifact | `npm view hatch3r dist.signatures` returns provenance; release page lists SBOM artifact |
| 2 | Cursor Marketplace + Claude Plugins Marketplace in-app submissions sent (human action on the in-app forms per `docs/marketplace-submission.md` §Submission Channels) | Submission confirmation IDs | Both submission confirmations on file |
| 3-4 | Marketplace approvals land | Live marketplace listings (URL each) | Both URLs return 200 and show current version |
| 4 (after marketplace URLs live) | Show HN launch | HN submission with link to GitHub repo and "Where to install" README section pointing at both marketplaces | Submission posted between 08:00-11:00 Pacific on a weekday for visibility |
| 5+ | r/ClaudeAI follow-up post | Reddit thread linking to Claude Plugins Marketplace listing first, GitHub second | Post contains marketplace install URL above the fold |
| 5+ | Twitter/X follow-up | Thread with screenshot of marketplace listing | Screenshot includes verified listing URL in the frame |

Each step is independent of the next once the previous exit condition is met. A delayed marketplace approval (step 3-4) defers steps 4 onward; it does not allow Show HN to run first.

## 5. Anti-patterns (do not do)

| Anti-pattern | Why it compounds negatively |
|--------------|------------------------------|
| Show HN before any prerequisite in §2 is GREEN | HN comments persist permanently and appear on Google searches for "hatch3r" for years; early "install is broken" / "where do I download" threads anchor the first impression for every future visitor |
| r/ClaudeAI before Claude Code marketplace listing is live | Top comments will be "where do I install" with no link to provide; without the marketplace credibility signal, the thread reads as a self-promo with no destination |
| Twitter/X without screenshot proof of marketplace listing | Plain-text claims of "available on Cursor and Claude" are indistinguishable from vapor announcements; the screenshot is the credibility primitive |
| Re-submitting Show HN after a failed launch | HN's duplicate-detection and community memory penalize repeat submissions; one shot per major version |
| Posting on multiple channels same day | Concentrates negative feedback if any one channel surfaces a defect; sequence enables learn-and-fix between channels |
| Launching during US holidays / weekends | Lower moderator coverage on marketplaces and forums increases time-to-resolution if a defect is reported |

## 6. Decision log

Append one row per launch-go/no-go decision. Date in ISO format. Status snapshot captures the §2 prerequisite table at decision time.

| Date | Launcher | Channel | Prerequisite status (P1/P2/P3/P4/P5/P6) | Decision | Outcome / link |
|------|----------|---------|------------------------------------------|----------|----------------|
| 2026-05-28 | release/2.0.0 maintainers | (none — gate authored) | RED/RED/RED/RED/AMBER/RED | NO-GO | This doc authored as gate; no launch attempted |
| 2026-06-22 | release/2.0.0 maintainers | (none — no launch attempted) | not evaluated at cut (backfilled Cycle 12) | NO-GO (implicit) | 2.0.0 published to npm with SLSA-v1 provenance; §7 §3 re-check missed |
| 2026-06-26 | release/2.1.0 maintainers | (none — no launch attempted) | not evaluated at cut (backfilled Cycle 12) | NO-GO (implicit) | 2.1.0 published; §7 §3 re-check missed |
| 2026-07-07 | release/2.1.1 maintainers | (none — no launch attempted) | not evaluated at cut (backfilled Cycle 12) | NO-GO (implicit) | 2.1.1 published; §7 §3 re-check missed |
| 2026-07-08 | release/2.2.0 maintainers | (none — no launch attempted) | not evaluated at cut (backfilled Cycle 12) | NO-GO (implicit) | 2.2.0 published with provenance + `sbom.cdx.json` SBOM asset; §7 §3 re-check missed |
| 2026-07-11 | Cycle-12 audit-execute | (none — gate refresh) | RED/RED/GREEN/GREEN/AMBER/GREEN | NO-GO | §2 P1/P2/P4 criteria re-keyed to canonical-source pointers (D18-SA18.3-03); P6 backfilled GREEN with provenance + SBOM evidence (D4-SA4.4-03); T2 promotion remains HELD by the PRD §1 HOLD |
| 2026-07-13 | release/2.5.0 maintainers | (none — no launch attempted) | GREEN/RED/GREEN/GREEN/AMBER/GREEN | NO-GO | 2.5.0 published with SLSA-v1 provenance + `sbom.cdx.json` (verified same-day, §3 P6); P1 flipped GREEN — HOLD cleared-with-exception (C12-CL1-1), Critical cluster registry-done; T2 waits on T0 storefront repair + T1 submissions + a GO row |
| 2026-07-16 | release/2.7.0 maintainers | (none — no launch attempted) | GREEN/RED/GREEN/GREEN/AMBER/GREEN | NO-GO (implicit) | 2.7.0 published with SLSA-v1 provenance + `sbom.cdx.json` (verified same-day, §3 P6: 101 registry signatures + 7 attestations, 0 invalid); 4-tier model ladder + effort axis shipped; full queued-work drain landed (a2a16b59 manifests, C4-C6 floors, CL-2 drift gate, P8 hardening); T2 still waits on T0 storefront repair + T1 submissions + a GO row |

## 7. Maintenance

- Re-check §3 status snapshot at every release branch cut and at every audit-cycle close. This duty is wired into the release ceremony at `.claude/skills/h4tcher-release-prep/SKILL.md` Step 11 (Launch-Readiness Refresh) so it runs on every release cut, not only from memory (D4-SA4.4-03).
- When all six prerequisites read GREEN, update §1 Status to GO and append the GO decision to §6 before posting.
- After every launch, append the actual outcome (HN points + comment count + 24h npm install delta) to the §6 outcome column within 7 days.
- Findings closed: F18.3.5 (Cycle 10); D18-SA18.3-03 + D4-SA4.4-03 (Cycle 12 — §2 criteria re-keyed to canonical-source pointers, P6 backfilled GREEN, release-prep re-check wiring).

## References

- PRD §14 Distribution Channels — ratified 3-lane plan targeting the 3 supported adapters (CONSTITUTION §6 Decision 12): npm/CLI, Cursor plugin marketplace, Claude Code plugin marketplace. The AGENTS.md/AAIF emission lane was retired in 1.9.0 (Decision 12) and is standards-watch only (PRD §5.x) — not a distribution lane.
- Supply-chain floor policy — npm provenance + SBOM + SHA-pinned actions + CI matrix Ubuntu/macOS/Windows × Node LTS 22/24.
- `docs/marketplace-submission.md` — agent-prepared submission package; status drives P5.
- Audit finding registry (`governance/audit/finding-registry.json`) + the PRD §1 distribution HOLD's named-blocker integrity assertion — jointly feed P1 (current-cycle open-Critical state + named-blocker registry status, not a frozen cohort).
