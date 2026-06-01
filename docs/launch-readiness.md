---
id: launch-readiness
type: doc
description: Gate launch decisions (Show HN, r/ClaudeAI, Twitter/X) on objective readiness criteria; defines prerequisites, recommended sequence, anti-patterns, and the decision log for cycle-over-cycle launch-go decisions.
tags: [distribution, launch, governance, decision-log]
---

# Launch Readiness

> Source authority: the PRD §14 (Distribution Channels) and the Constitution §6 Decision 26 (supply-chain floor — npm provenance + SBOM + SHA-pinned actions). Closes finding F18.3.5 (Cycle 10, High).

## Purpose

Gate every external launch decision (Show HN, r/ClaudeAI, Twitter/X, sponsored placements, podcast appearances, conference demos) on the objective prerequisites listed in §2 below. Launching before all prerequisites are GREEN produces negative compounding: HN front-page traffic that finds an unfinished install path leaves a permanent comment trail that future visitors read first.

This document is the single decision point. If a prerequisite is not GREEN, the launch is NO-GO regardless of internal pressure or external opportunity.

## 1. Status

| Field | Value |
|-------|-------|
| Current readiness | NO-GO (Cycle 10 close, 2026-05-28) — see §3 status snapshot |
| Last reviewed | 2026-05-28 |
| Next review trigger | Resolution of any prerequisite in §2 from RED→GREEN |

## 2. Prerequisites

All six must read GREEN before any external-facing launch posts. Each row cites the canonical source.

| # | Prerequisite | Canonical source | Verification command |
|---|--------------|------------------|----------------------|
| P1 | 2.0.0 publish HOLD lifted (every Cycle 10 Critical and High verified per the audit execution model's Phase 4 gates) | Audit finding registry — Cycle 10 entries with `status: "resolved"` | Every Cycle 10 Critical/High finding in the registry has `status: "resolved"` |
| P2 | PRD §1 Posture reads "Distribution-Ready" (F18.3.1 dependency) | PRD §1 Posture line | PRD §1 Posture line contains the literal string `Distribution-Ready` |
| P3 | AAIF stance documented in PRD §5.x (closes F18.2.2 / F17.3.1) | PRD §5 (positioning section) | PRD §5 mentions agents.md / AAIF / cross-tool fallback at least once |
| P4 | 3-lane distribution plan documented in PRD §14 (F17.3.2 — Claude plugin marketplace + AGENTS.md/AAIF + Cursor plugin) | PRD §14 Distribution Channels | All three channels documented as live (not "stub" / "planned") |
| P5 | Marketplace submission package current (`docs/marketplace-submission.md`) | `docs/marketplace-submission.md` (referenced from F18.3.4) | Status field reads `READY` not `PARTIAL`; counts match `governance/inventory.json`; in-app form URLs reachable |
| P6 | Latest release published with npm provenance + SBOM | Constitution §6 Decision 26 (supply-chain floor) | `npm view hatch3r@latest dist.signatures` returns provenance attestation; SBOM artifact present on the corresponding GitHub release |

## 3. Status snapshot (cycle 10 close)

| Prereq | Status | Blocker |
|--------|--------|---------|
| P1 | RED | Cycle 10 close-out in progress; Wave 1 (Critical+High) execution not yet verified |
| P2 | RED | Cycle 10 close updates §1 Posture but currently reads "Not Ready (distribution)" |
| P3 | RED | F18.2.2 / F17.3.1 stance not yet applied to PRD §5.x |
| P4 | RED | PRD §14 Channel 1 documents `add <pack>` as `stub`; AGENTS.md/AAIF lane absent |
| P5 | AMBER | Submission package `Status` field reads `PARTIAL` — pending Anthropic in-app form completion |
| P6 | RED | First 2.0.0 release with provenance not yet cut |

Overall: **NO-GO** until every row reads GREEN.

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
|  |  |  |  |  |  |

## 7. Maintenance

- Re-check §3 status snapshot at every release branch cut and at every audit-cycle close.
- When all six prerequisites read GREEN, update §1 Status to GO and append the GO decision to §6 before posting.
- After every launch, append the actual outcome (HN points + comment count + 24h npm install delta) to the §6 outcome column within 7 days.
- Findings closed: F18.3.5 (Cycle 10).

## References

- PRD §14 Distribution Channels — canonical 3-lane plan (CLI, Cursor Plugin, npm Dependency); to be extended to the Claude Plugins Marketplace + AGENTS.md/AAIF lane per F17.3.2.
- Constitution §6 Key Design Decision 26 — supply-chain floor: npm provenance + SBOM + SHA-pinned actions + CI matrix Ubuntu/macOS/Windows × Node LTS 22/24.
- `docs/marketplace-submission.md` — agent-prepared submission package; status drives P5.
- Audit finding registry — Cycle 10 finding closure feeds P1.
