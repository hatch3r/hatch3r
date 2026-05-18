---
name: h4tcher-audit-cycle
description: Execute a full 20-domain audit cycle using the governance audit prompt. Deploys 111 sub-agents across 4 tiers with synthesis gates and produces a structured audit report.
effort: max
allowed-tools: Read Grep Glob Bash(*) Write Agent WebSearch WebFetch
---

# Audit Cycle

Execute the full hatch3r audit cycle defined in `governance/AUDIT.md`.

## Pre-Audit

1. Ask the user:
   - Path to previous audit report (if exists): default `governance/AUDIT-REPORT.md`
   - Specific areas of concern to prioritize
   - Any domains to skip or deprioritize
2. Read `governance/AUDIT.md` fully — this is the authoritative audit protocol
3. Read `governance/CONSTITUTION.md` §2 for the 7 Binding Pillars

## Setup

4. Create `.audit-workspace/` at repo root if missing
5. Clean per-run artifacts (`.audit-workspace/D*-SA*.findings.md`, `.audit-workspace/D*-synthesis.md`) but preserve `execution-insights.json`
6. Run Dynamic Verification Protocol:
   - Count files in `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/`, `src/adapters/`, `src/__tests__/`
   - Write actual counts to `.audit-workspace/verified-inventory.json`
   - Flag any discrepancy with expected counts as Info finding

## Tier A — Foundational (4 domains, 27 sub-agents)

7. Read domain files: `governance/audit/domains/D01-core-source.md` through `D04-build-cicd.md`
8. Launch sub-agents for D01-D04 in parallel. Each sub-agent:
   - Reads its domain checklist
   - Performs web research relevant to its scope
   - Writes findings to `.audit-workspace/D{N}-SA{M}.findings.md`
9. After all Tier A sub-agents complete: produce `.audit-workspace/D{N}-synthesis.md` for each domain
10. Release individual findings from context (keep synthesis only)

## Tier B — Quality (7 domains, 49 sub-agents)

11. Read domain files: `governance/audit/domains/D05-prompt-engineering.md` through `D10-documentation-devex.md`, and `D19-agentic-dev-setup.md`
12. Launch sub-agents in parallel, except:
    - D09.15 (Capability Matrix Verification) — wait for D09.1-D09.14
    - D09.16 (Emerging Platforms) — wait for D09.1-D09.14
13. Produce synthesis per domain. Release findings from context

## Tier C — System-Level (7 domains, 27 sub-agents)

14. Read domain files: `governance/audit/domains/D11-data-flow.md` through `D16-compound-system.md`, and `D20-user-content-authoring.md`
15. Launch sub-agents in parallel, except:
    - D16.1 (Cross-Domain Pattern Synthesis) — wait for D05, D07, D09 synthesis
    - D16.2 (Coverage Gap Analysis) — wait for D05, D09 synthesis
    - D20.2 (User-Authored Artifact Compliance) — wait for D20.1, D05, D15 synthesis
16. Run Cross-Domain Discovery after Tier C synthesis
17. Produce synthesis per domain. Release findings from context

## Tier D — Strategic (2 domains, 6 sub-agents)

18. Read domain files: `governance/audit/domains/D17-competition.md`, `D18-prd-roadmap.md`
19. Launch D17.1, D17.2 in parallel → then D17.3 (sequential)
20. Launch D18.1, D18.2 (wait for D16, D17) → then D18.3 (sequential)
21. Produce synthesis

## Report Assembly

22. Assemble report using format from `governance/audit/templates/report-format.md`:
    - Tier 1: Executive Dashboard (overall score, domain scores, top 5 findings)
    - Tier 2: Domain summaries with finding counts by severity
    - Tier 3: Detailed findings with evidence and recommendations
23. Run quality gates:
    - All 19 domains examined
    - Finding counts within expected range (50-155 total)
    - Deduplication applied (2-of-3 signal match: file, root cause, recommendation)
24. Produce closed-loop tables:
    - CL-1: PRD Evolution Candidates
    - CL-2: Content Gap Artifacts (P1/P2/P3 priority)
    - CL-3: Audit Self-Evolution Proposals (max 10)
25. Write final report to `governance/AUDIT-REPORT.md`

## Scoring Formula

```
domain_score = 100 - (critical*25) - (high*10) - (medium*3) - (low*1)
overall_score = SUM(domain_score[i] * weight[i])
```

Score bands: 90-100 Ship Ready, 80-89 Minor Issues, 70-79 Needs Work, 60-69 Significant Risk, <60 Not Ready.
