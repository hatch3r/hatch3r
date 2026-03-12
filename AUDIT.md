# hatch3r — Full Framework Audit Prompt

## Purpose

Perform a deep, end-to-end audit of every area, aspect, and line of code or content in the hatch3r framework. The goal is to ensure this framework is production-ready, open-sourceable, and excels in every capability compared to the current market — enabling end users to build winning software products at scale.

This audit covers **18 domains** organized across **4 tiers**, deploying **98 sub-agents** for maximum depth. Every domain requires web research for current market context. The final deliverable is a structured audit report with severity-tagged findings, weighted domain scores, and prioritized action items using 3-tier progressive disclosure.

---

## Framework Context

hatch3r is an open-source CLI (`npx hatch3r init`) and Cursor plugin that installs a tool-agnostic agentic coding setup into any repository. It uses a canonical source model (`/.agents/`) and generates tool-specific configurations via adapters.

### Architecture

```
/.agents/                    <- Canonical source (tool-agnostic)
  ├── agents/                <- Agent definitions
  ├── skills/                <- Skill workflows (*/SKILL.md)
  ├── rules/                 <- Coding standards, conventions
  ├── commands/              <- Slash-command workflows
  ├── prompts/               <- Reusable prompt templates
  ├── hooks/                 <- Event-triggered automation
  ├── checks/                <- Review criteria
  ├── mcp/mcp.json           <- MCP server configuration
  ├── policy/                <- Guardrails and deny lists
  ├── learnings/             <- Project learnings
  ├── AGENTS.md              <- Canonical orchestration reference
  └── hatch.json             <- Manifest

Adapters generate tool-specific output:
  .cursor/          <- Cursor       .github/         <- Copilot
  CLAUDE.md         <- Claude Code  GEMINI.md        <- Gemini CLI
  .windsurfrules    <- Windsurf     .amp/            <- Amp
  AGENTS.md         <- OpenCode     .codex/          <- Codex CLI
  .roo/ .roomodes   <- Cline        .aider/          <- Aider
  .kiro/            <- Kiro         .goosehints      <- Goose
  .rules            <- Zed
```

### Component Inventory (verify counts during audit)

| Category | Directory | Count |
|----------|-----------|-------|
| Agents | `agents/` | 16 |
| Rules | `rules/` | 22 .md + 22 .mdc = 44 files |
| Commands | `commands/` | 34 |
| Skills | `skills/` | 25 directories |
| Hooks | `hooks/` | 6 |
| Prompts | `prompts/` | 3 |
| Checks | `checks/` | 5 |
| GitHub Agents | `github-agents/` | 4 |
| **Total Content Artifacts** | | **137** |
| Adapters | `src/adapters/` | 13 tool adapters (19 files total) |
| CLI Commands | `src/cli/commands/` | 8 (add, config, init, status, sync, update, validate, verify) |
| Content System | `src/content/` | 3 files (index.ts 587 LOC, tags.ts 91 LOC, presets.ts 48 LOC) = 726 LOC |
| Integrity | `src/integrity/` | 1 file |
| Archive | `src/archive/` | 1 file (index.ts, 217 LOC) |
| TypeScript Source | `src/` | 50 files (excluding tests) |
| Test Files | `src/__tests__/` | 39 test files |
| CI Workflows | `.github/workflows/` | 5 workflows |
| Website Docs | `website/docs/` | 23 files |

### Orchestration Model

All tasks follow a four-phase sub-agent pipeline: (1) Research, (2) Implement, (3) Review Loop (max 3 iterations), (4) Final Quality (specialists).

---

## Execution Model

### Sub-Agent Strategy

Spawn **98 sub-agents** across 18 audit domains organized in 4 tiers. Each domain decomposes into multiple focused sub-agents for maximum depth. Sub-agents within the same domain run in parallel unless a sequential dependency is noted. Domain-level synthesis sub-agents run only after their prerequisite sub-agents complete. Inherit your LLM model to every sub-agent — do not downgrade. Each sub-agent MUST use web research. **Never optimize for token efficiency — optimize for audit quality and depth.**

### Dependency Graph

The following sub-agents have sequential dependencies and MUST NOT launch until their prerequisites complete:

| Sub-Agent | Depends On | Reason |
|-----------|-----------|--------|
| 9.14 (Capability Matrix Verification) | 9.1–9.13 | Requires all per-adapter audit findings |
| 9.15 (Emerging Platforms) | 9.1–9.13 | Requires understanding of current adapter landscape |
| 16.1 (One-Shot Success Analysis) | D5, D7 | Requires prompt quality and orchestration findings |
| 16.2 (Content Coverage Gap Analysis) | D5, D9 | Requires content and adapter findings |
| 16.3 (Prompt Consistency) | D5, D7 | Requires cross-artifact analysis |
| 16.4 (Regression & Maintenance) | D3, D4 | Requires test and CI findings |
| 17.3 (Market Positioning & Strategy) | 17.1, 17.2 | Requires competitor and ecosystem data |
| 18.1 (PRD Alignment) | D16, D17 | Requires compound system and competitive findings |
| 18.2 (Roadmap Reprioritization) | D16, D17 | Requires compound system and competitive findings |
| 18.3 (Distribution Verdict) | 18.1, 18.2 | Requires PRD and roadmap analysis |

### Concurrency Model

Of the 98 total sub-agents, **88 launch immediately** in parallel. The remaining **10 sub-agents** launch sequentially after their dependencies complete:

| Tier | Sequential Sub-Agents |
|------|----------------------|
| B | 9.14, 9.15 |
| C | 16.1, 16.2, 16.3, 16.4 |
| D | 17.3, 18.1, 18.2, 18.3 |

### Web Research Requirements

Every sub-agent MUST perform web research relevant to its domain. Requirements: (1) current platform docs for referenced tools, (2) competitor approaches, (3) industry standards by version/date, (4) developments from past 6 months. Cite all sources.

### Result Management Protocol

Sub-agent results MUST be file-based to prevent context overflow:

1. Each sub-agent writes findings to: `.audit-workspace/D{N}-SA{M}.findings.md`
2. After each domain completes, orchestrator reads domain results, produces synthesis (`.audit-workspace/D{N}-synthesis.md`), then releases individual results from context.
3. Report assembled from synthesis files, not accumulated context.
4. Create `.audit-workspace/` at execution start. Ephemeral — delete after report assembly.

### Tiered Execution with Synthesis Gates

Execute by tier with synthesis between tiers:

| Tier | Domains | Agents | Action |
|------|---------|--------|--------|
| A | D1–D4 | 25 | Launch → synthesize → release from context |
| B | D5–D10 | 41 | Launch → synthesize → release from context |
| C | D11–D16 | 26 | Launch → synthesize → release from context |
| D | D17–D18 | 6 | Launch → synthesize → final assembly |

Peak context: 41 sub-agent results (Tier B), not 98.

### Pre-Audit Questions

Before beginning, ask the user:
1. Is there a previous audit report to compare against? If so, where?
2. Are there specific areas of concern or priority for this audit cycle?
3. Should the audit include the gitignored PRD (`hatch3r-prd.md`) and competitive analysis (`COMPETITIVE-ANALYSIS.md`) if available locally?
4. What is the intended distribution model being evaluated (open-source npm, private npm, marketplace plugins, or all)?
5. Are there any new tools or platforms to add to the adapter coverage assessment?

---

## Scoring Methodology

### Domain Weighting

| Tier | Domains | Weight Per Domain | Tier Total |
|------|---------|-------------------|------------|
| A — Foundational | D1–D4 | 0.08 | 0.32 |
| B — Quality | D5–D10 | 0.06 | 0.36 |
| C — System-Level | D11–D16 | 0.04 | 0.24 |
| D — Strategic | D17–D18 | 0.04 | 0.08 |
| **Total** | | | **1.00** |

### Weighted Score Formula

```
Overall Score = SUM(domain_score[i] * weight[i]) for i in 1..18
```

Each `domain_score[i]` is 0–100. The overall score is therefore 0–100.

### Quality Score Formula

```
domain_score = 100 - (critical * 25) - (high * 10) - (medium * 3) - (low * 1) - (info * 0)
```

Floor at 0. Ceiling at 100.

### Severity Ceiling

Any domain with an unresolved **Critical** finding has its domain score capped at **50/100** regardless of formula output. If any domain triggers this cap, the overall score band is also capped at **Needs Work**.

### Score Bands

| Score | Band |
|-------|------|
| 90–100 | Ship Ready |
| 80–89 | Minor Issues |
| 70–79 | Needs Work |
| 60–69 | Significant Risk |
| < 60 | Not Ready |

### Severity Taxonomy

| Severity | Definition | Release Impact |
|----------|-----------|----------------|
| **Critical** | Blocks production release or creates security/correctness risk | Must resolve before any release |
| **High** | Significantly impacts quality, UX, or market competitiveness | Should resolve before release |
| **Medium** | Improvement opportunity with clear benefit | Can defer to next release |
| **Low** | Nice-to-have, polish item | Defer freely |
| **Info** | Observation, suggestion, or context for future consideration | No release impact |

### Effort Levels

| Level | Duration |
|-------|----------|
| **S** | < 2 hours |
| **M** | 2–8 hours |
| **L** | 1–3 days |
| **XL** | 1+ weeks |

---

## Deduplication Protocol

A finding is a duplicate if it matches on **2 of 3** signals:

| Signal | Description |
|--------|-------------|
| **File** | Same file or module referenced |
| **Root Cause** | Same underlying technical issue |
| **Recommendation** | Same or substantially similar fix |

When duplicates are detected:
1. Keep the highest-severity instance as the primary finding.
2. Record all domain references (e.g., "Also identified in D3, D7").
3. Preserve unique perspectives as sub-points under the primary finding.
4. Do not inflate finding counts — deduplicated findings count as one.

---

## Quality Gates

### Expected Finding Counts

| Severity | Expected Range | Below Range Suggests | Above Range Suggests |
|----------|---------------|---------------------|---------------------|
| Critical | 0–5 | Genuine maturity OR shallow audit | Fundamental issues |
| High | 5–20 | Shallow audit OR exceptional quality | Significant quality gaps |
| Medium | 20–50 | Insufficient depth | Exhaustive analysis |
| Low | 15–40 | Insufficient granularity | Over-reporting |
| Info | 10–30 | Missing strategic context | Appropriate depth |
| **Total** | **50–145** | **Audit quality concern** | **Thorough audit** |

If total findings fall below 50, the orchestrating agent MUST re-examine whether sub-agents achieved sufficient depth before finalizing.

### Quality Checklist

- [ ] All 18 domains have findings (no domain should be "clean")
- [ ] All 98 sub-agents produced output (no silent failures)
- [ ] Every Critical and High finding has a specific, actionable recommendation
- [ ] Every finding references specific files, line numbers, or artifacts
- [ ] Web research was performed for every domain (cite sources)
- [ ] Deduplication protocol was applied
- [ ] Finding counts fall within expected ranges

### Shallow Finding Detector

Flag any finding matching these patterns and require the sub-agent to deepen:

| Pattern | Required Depth |
|---------|----------------|
| Generic recommendation | Specify which function, what error case, what the improved handling looks like |
| No file reference | Identify specific files, functions, and line numbers |
| No web research citation | Cite the specific standard, paper, or documentation |
| Tautological finding | Identify specific untested paths, branches, or scenarios |
| Copy of checklist item | Provide analysis specific to hatch3r's implementation |

---

## Audit Domains

18 domains across 4 tiers. Each domain's full scope, sub-agent decomposition, and audit checklists are in the corresponding file under `audit/domains/`.

The orchestrator spawns sub-agents per domain file. Each sub-agent:
1. Reads its domain file (`audit/domains/D{NN}-{name}.md`)
2. Applies the universal checklist below
3. Conducts web research per the global directive
4. Writes results to `.audit-workspace/D{N}-SA{M}.findings.md`

### Universal Audit Checklist (apply to ALL sub-agents)

- [ ] Technical accuracy against current documentation (web research required)
- [ ] Specific file/line references for every finding
- [ ] Actionable recommendations (not generic)
- [ ] Severity and effort classification per the scoring methodology above
- [ ] Competitor/market comparison where applicable

### Summary Table

| Tier | Domain | Sub-Agents | Parallel | Sequential |
|------|--------|-----------|----------|------------|
| A | 1: Core Source Implementation | 8 | 8 | 0 |
| A | 2: Adapter Infrastructure | 7 | 7 | 0 |
| A | 3: Test Infrastructure | 5 | 5 | 0 |
| A | 4: Build, CI/CD & Dependencies | 5 | 5 | 0 |
| B | 5: Prompt Engineering Quality | 7 | 7 | 0 |
| B | 6: Context Engineering & Token Economics | 4 | 4 | 0 |
| B | 7: Agent Orchestration Optimization | 5 | 5 | 0 |
| B | 8: Error Recovery & Resilience | 4 | 4 | 0 |
| B | 9: Platform Adapters | 15 | 13 | 2 (9.14, 9.15) |
| B | 10: Documentation & Developer Experience | 6 | 6 | 0 |
| C | 11: End-to-End Data Flow | 4 | 4 | 0 |
| C | 12: Agent Observability & Debuggability | 4 | 4 | 0 |
| C | 13: Human-AI Collaboration Quality | 4 | 4 | 0 |
| C | 14: Cross-Project Adaptability & Scalability | 4 | 4 | 0 |
| C | 15: Agentic Security & Trust Model | 6 | 6 | 0 |
| C | 16: Compound System Evaluation | 4 | 0 | 4 |
| D | 17: Competition & Market Intelligence | 3 | 2 | 1 (17.3) |
| D | 18: PRD, Roadmap & Distribution | 3 | 0 | 3 |
| **Total** | | **98** | **88** | **10** |

---

## Output Format

The final audit report MUST use 3-tier progressive disclosure for maximum utility across audiences.

---

### Tier 1: Executive Dashboard

```
Audit Date: YYYY-MM-DD
Framework Version: (from package.json)
Previous Audit: (date or "N/A")
Auditor: (model name and version)
Domains Covered: 18/18
Sub-Agents Deployed: 98

Overall Score: XX/100 (Weighted)
Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]
Severity Ceiling Applied: [Yes/No — if any domain has unresolved Critical]

Top 3 Strengths:
1. ...
2. ...
3. ...

Top 3 Critical Issues:
1. ...
2. ...
3. ...

Competitive Positioning: (1 sentence)
Distribution Recommendation: (1 sentence)
```

#### Domain Heatmap

```
| Domain | Score | Critical | High | Medium | Low | Info |
|--------|-------|----------|------|--------|-----|------|
| D1: Core Source Implementation | XX | N | N | N | N | N |
| D2: Adapter Infrastructure | XX | N | N | N | N | N |
| D3: Test Infrastructure | XX | N | N | N | N | N |
| D4: Build, CI/CD & Dependencies | XX | N | N | N | N | N |
| D5: Prompt Engineering Quality | XX | N | N | N | N | N |
| D6: Context Engineering | XX | N | N | N | N | N |
| D7: Orchestration Optimization | XX | N | N | N | N | N |
| D8: Error Recovery & Resilience | XX | N | N | N | N | N |
| D9: Platform Adapters | XX | N | N | N | N | N |
| D10: Documentation & DevEx | XX | N | N | N | N | N |
| D11: End-to-End Data Flow | XX | N | N | N | N | N |
| D12: Observability | XX | N | N | N | N | N |
| D13: Human-AI Collaboration | XX | N | N | N | N | N |
| D14: Adaptability & Scalability | XX | N | N | N | N | N |
| D15: Agentic Security | XX | N | N | N | N | N |
| D16: Compound System | XX | N | N | N | N | N |
| D17: Competition & Market | XX | N | N | N | N | N |
| D18: PRD, Roadmap & Distribution | XX | N | N | N | N | N |
```

---

### Tier 2: Domain Summaries

For each of the 18 domains: Health Score (X/100), Finding Count by severity, Top 3 Findings (`[Severity] Finding — recommendation (Effort)`), Key Recommendation (1 sentence).

---

### Tier 3: Domain Detail

**Tier 3 is mandatory. Do not skip.**

For each domain, produce the full finding table: `#`, `Severity`, `Area`, `Finding`, `Recommendation`, `Effort`. Every row must have a corresponding row in Enhanced Action Items (and vice versa).

---

### Cross-Domain Analysis

Findings spanning multiple domains: `#`, `Finding`, `Domains`, `Primary Domain`, `Severity`, `Recommendation`.

---

### Competitive Positioning Matrix

`Capability`, `hatch3r`, `Competitor A`, `Competitor B`, etc.

---

### Enhanced Action Items

**This table MUST include every unique finding post-deduplication.** Do not curate, truncate, or limit to a "top N" subset. The execution prompt (`AUDIT-EXECUTE.md`) reads this table as the complete universe of findings.

Ordered by: Critical first, then High, Medium, Low. Within severity, order by impact-to-effort ratio (highest first).

Columns: `#`, `Domain`, `Action Item`, `Severity`, `Effort`, `Depends On`, `Status`.

**Status values:** `Open` (agent-actionable), `Open (human-only)`, `**Done**`, `Deferred (reason)`.

**Completeness check:** Total row count must equal the post-dedup finding count in the Executive Dashboard.

---

### Enhanced Release Plan

Columns: `#`, `Domain`, `Item`, `Severity`, `Effort`, `Owner`, `Risk Score` (Impact x Likelihood x Reversibility, each 1-5), `Status`. Sections: Blockers, Should-Have, Deferred. Include: Rollback Plan, Acceptance Criteria, Estimated Total Effort, Recommended Sequence, Risk Assessment.

---

### Distribution Verdict

Recommendation on: open-source vs private npm, marketplace strategy, timing, licensing, community building.

---

### Delta Since Previous Audit

(If previous audit exists) New findings, resolved findings, regressed findings, score changes per domain.

---

## Audit History

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| — | — | — | — | — |
