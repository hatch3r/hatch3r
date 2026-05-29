---
id: hatch3r-roadmap
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer]
description: Sequence delivery phases over time into a dependency-ordered milestone plan with business and technical lenses, emitting a todo.md rollout schedule rather than design docs
tags: [planning, ctx:greenfield-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: deep
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 2
  rationale: Two parallel hatch3r-researcher modes (business-priority + technical-readiness) in Step 3 to inform sequencing; one hatch3r-docs-writer in Step 6 assembles todo.md on their merged output (serialized on the research → assembly dependency edge). Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

# Roadmap — Generate Phased Roadmap from Specs & Vision

Generate a dependency-aware, priority-ordered roadmap with **two parallel dimensions**: business milestones and technical milestones. Spawns parallel researcher sub-agents (business priority, technical readiness) to inform prioritization with market timing, competitive pressure, revenue impact, and production readiness gaps. Outputs to `todo.md` in the exact format that `hatch3r-board-fill` expects, with items tagged as `[BIZ]`, `[TECH]`, or `[BOTH]`. Optionally generates a root-level `AGENTS.md`. Works for both greenfield projects (from `hatch3r-project-spec` output) and brownfield projects (from `hatch3r-codebase-map` output).

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (2 parallel: Business Priority, Technical Readiness) | Yes | Yes |
| 2. Document Generation | `hatch3r-docs-writer` (todo.md generation) | No | Yes |
| 3. AGENTS.md | `hatch3r-docs-writer` (AGENTS.md generation/rework) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every business-priority and technical-readiness recommendation (market-timing, revenue-impact ordering, debt-velocity estimate) carries a high/medium/low confidence rating sourced from the researcher sub-agent — web-sourced market estimates are medium at best unless tied to a cited benchmark. The Step 4 roadmap presentation and Step 6 summary MUST preserve the signal. Dropping it between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. When in doubt, **ASK** — it is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.

## Step 0: Triage

Classify the roadmap request before delegating:

- **Tier 1 (trivial)**: small project with focused scope (under 20 backlog items), single dimension (technical only); reduced fanout (1 researcher: Technical Readiness) and condensed todo.md output.
- **Tier 2 (standard)**: standard dual-lens roadmap (business + technical) with both researchers; standard pipeline with parallel research and AGENTS.md generation.
- **Tier 3 (deep)**: enterprise/scale company with regulatory deadlines, multi-quarter horizon, or 50+ backlog items; full pipeline with deep web research and confirm milestones with the user before writing files.

If Tier 1, run the reduced researcher set and skip Step 7 (AGENTS.md) unless requested. If Tier 2, run the standard pipeline below. If Tier 3, run the full pipeline with deep research, surface market-timing intelligence, and confirm phased plan with the user before file writes.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 3 parallel researchers), surface the cost preview so a deep-research roadmap run is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 ~1 (technical-readiness only), Tier 2 ~2-3, Tier 3 up to 3 (+ AGENTS.md docs-writer)>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>            # market + benchmark research; Tier 3 is web-heavy
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

The Step 1 business-discovery interview is user-driven and excluded from the duration estimate. Post-execution actuals + delta land in the Step 6 summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a focused single-dimension roadmap scored as Deep, or an enterprise multi-quarter roadmap scored as Light. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification (which controls researcher count and web-research depth).
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Load Project Context & Business Discovery

#### 1a. Load Existing Documentation

1. Check for existing documentation:
   - `docs/specs/technical/` — technical specifications
   - `docs/specs/business/` — business specifications
   - `docs/specs/` (flat) — legacy spec layout (pre-dual-lens)
   - `docs/adr/` — architectural decision records
   - `docs/codebase-health.md` — health report (from codebase-map)
   - Existing `todo.md` — current backlog
   - `README.md` — project overview
   - Root `AGENTS.md` — existing agent instructions
2. Read discovered documents selectively — TOC/headers first (first ~30 lines), full content only for sections relevant to roadmap planning.
3. If no docs exist, ASK user for project vision and goals (text input or reference to a document).
4. For brownfield projects: scan current GitHub issues via `gh issue list --state open --limit 100` to understand existing tracked work. Paginate if more than 100 issues.

#### 1b. Load Session Context

Check for `.hatch3r-session.json` (written by `hatch3r-codebase-map` or `hatch3r-project-spec`). If found, pre-fill company stage and business context. Confirm with the user rather than re-asking.

#### 1c. Onboarding Scope Selection

**ASK:** "Should I generate a roadmap for the **full product**, or only **specific parts**? If specific, list the domains, modules, or feature areas to focus on."

#### 1d. Company Stage Assessment

If not loaded from `.hatch3r-session.json`:

**ASK:** "To calibrate the roadmap to your situation, tell me about your company/project stage:

- **Company stage**: pre-revenue / early-revenue / growth / scale / enterprise
- **Team composition**: solo founder, small team (2-5), medium (5-20), large (20+)
- **Current user/revenue scale**: no users yet, beta (<1K), early traction (1K-50K), growth (50K-500K), scale (500K+)
- **Funding/runway**: bootstrapped, pre-seed, seed, Series A+, profitable
- **Regulatory/compliance needs**: none, basic (GDPR/SOC2), heavy (HIPAA/PCI/FedRAMP)
- **Deployment maturity**: no deployment yet, manual, CI/CD, full GitOps"

Cache the stage assessment. It drives **stage-adaptive prioritization**:
- **Pre-revenue / early-revenue**: Prioritize speed-to-market. Front-load core value delivery and minimum viable infrastructure. Defer polish and scale.
- **Growth**: Prioritize scaling bottlenecks and retention features. Balance new features with production hardening.
- **Scale / enterprise**: Prioritize reliability, compliance, and governance. Front-load SLA readiness and security hardening.

#### 1e. Business Context & Roadmap Goals

**ASK:** "To build a business-aware roadmap, I need additional context:

- **Target launch date or next major milestone**: when is the next business deadline?
- **Key business KPIs for the next 6-12 months**: what metrics define success?
- **Team capacity**: how many devs, approximate hours/week available?
- **Market timing pressures**: competitor launches, regulatory deadlines, seasonal peaks, funding milestones?
- **Revenue targets**: any specific revenue or user growth targets for the next 6-12 months?
- **Dependencies on external parties**: partners, vendors, API providers, design agencies?

Any other priorities or constraints I should factor into the roadmap?"

#### 1f. Present Context Summary

```
Context Loaded:
  Technical Specs: {N} files in docs/specs/technical/
  Business Specs:  {N} files in docs/specs/business/
  ADRs:            {N} files in docs/adr/
  Health report:   {found / not found}
  Existing todo.md: {found with N items / not found}
  AGENTS.md:       {found / not found}
  Open GitHub issues: {N}
  Session context: {loaded from .hatch3r-session.json / gathered fresh}

Company Stage:    {stage}
Team Capacity:    {N} devs, {hours}/week
Next Milestone:   {milestone} by {date}
Key KPIs:         {list}
Market Pressures: {list or none}

Gaps: {list any missing context}
```

**ASK:** "Here is the context I loaded. Provide additional goals, constraints, or priorities? (or confirm to proceed)"

---

### Step 2: Analyze & Categorize Work

1. From technical specs: extract all requirements, acceptance criteria, and gaps.
2. From business specs: extract business rules, GTM requirements, competitive gaps, and production readiness gaps.
3. From ADRs: extract pending decisions and their implementation work.
4. From health report (if exists): extract debt items and improvement opportunities.
5. From existing GitHub issues: map already-tracked work to avoid duplication.
6. Categorize all work items by:

| Dimension | Values |
| -------------- | --------------------------------------------------------------------------------------- |
| **Scope** | `[BIZ]` business-driven, `[TECH]` technically-driven, `[BOTH]` cross-cutting |
| **Domain/area** | Which module, subsystem, or business domain does this touch? |
| **Type** | feature, bug fix, refactor, infrastructure, documentation, QA, GTM, compliance |
| **Effort** | S (< 1 day), M (1-3 days), L (3-5 days), XL (> 5 days, should be an epic) |
| **Impact** | critical path, quality of life, nice-to-have, revenue-blocking, scale-blocking |
| **Dependencies** | What must come first? (both technical and business dependencies) |

7. Present a categorized summary table of all extracted work items, with separate sections for business-driven, technically-driven, and cross-cutting items.

---

### Step 3: Spawn Parallel Research Sub-Agents

Launch one sub-agent per research domain below concurrently using the Task tool with `subagent_type: "generalPurpose"`. Each receives the full context from Steps 1-2.

**Both sub-agent prompts must include:**
- All loaded project context (specs, ADRs, health report, existing backlog)
- Company stage, business context, and roadmap goals from Step 1
- The categorized work items from Step 2
- Instruction to use **web search** for market research, benchmarks, and best practices
- Explicit instruction: **do NOT create any files — return output as a structured result**

#### Sub-Agent 1: Business Priority Researcher

**Prompt context:** Full project context, business specs, company stage, market pressures, KPIs.

**Task:** Research and recommend business-driven prioritization using **web search** for market intelligence.

1. **Market timing windows**:
   - Research the product category for seasonal patterns, industry events, regulatory deadlines
   - Identify windows of opportunity (competitor gaps, market shifts, funding cycles)
   - Flag time-sensitive items that must ship by a specific date
2. **Competitive pressure analysis**:
   - Research competitor release cadences and recent launches
   - Identify feature gaps that competitors are filling (urgency signals)
   - Find differentiation opportunities that should be prioritized
3. **Revenue-impact ordering**:
   - Which features drive conversion most? (based on industry benchmarks)
   - Which features drive retention most? (churn reduction)
   - Which features unlock new revenue streams or market segments?
   - Order features by expected revenue impact
4. **Regulatory deadlines**:
   - Research compliance timelines for the product's industry and geography
   - Identify must-have certifications and their lead times
   - Flag regulatory blockers that constrain launch timing
5. **User acquisition channel requirements**:
   - What technical capabilities are needed for each GTM channel (PLG requires self-serve, SEO requires content, API-first requires docs)
   - Order channel enablement work by expected ROI

**Output structure:**

```markdown
## Business Priority Intelligence

### Market Timing
| Window | Deadline | Items Affected | Priority Impact |
|--------|----------|---------------|----------------|
| {window} | {date} | {items} | {how it changes priority} |

### Competitive Urgency
| Feature/Area | Competitor Activity | Urgency | Recommendation |
|-------------|-------------------|---------|----------------|
| {area} | {what competitors are doing} | high/med/low | {action} |

### Revenue Impact Ordering
| Rank | Feature/Area | Revenue Mechanism | Impact Estimate | Evidence |
|------|-------------|-------------------|-----------------|----------|
| 1 | {feature} | {conversion/retention/expansion/new segment} | {high/med/low} | {benchmark or reasoning} |

### Regulatory Timeline
| Requirement | Deadline | Effort | Blocking |
|------------|----------|--------|----------|
| {requirement} | {date} | {S/M/L/XL} | {what it blocks} |

### Channel Requirements
| Channel | Required Capabilities | Priority | Expected ROI |
|---------|---------------------|----------|-------------|
| {channel} | {what needs to be built} | {P0-P3} | {high/med/low} |

### Recommended Business Milestones
1. {milestone}: {date target} — {what it unlocks}
2. ...
```

#### Sub-Agent 2: Technical Readiness Researcher

**Prompt context:** Full project context, technical specs, health report, company stage.

**Task:** Evaluate technical readiness and recommend infrastructure prioritization. Use **web search** for industry benchmarks and best practices.

1. **Tech debt velocity impact**:
   - Which debt items slow down feature delivery most?
   - Quantify: "fixing X would speed up Y by approximately Z%"
   - Recommend debt paydown ordering by delivery velocity impact
2. **Infrastructure prerequisites for scaling milestones**:
   - What infrastructure must be in place before hitting 1K, 10K, 100K users?
   - Map infrastructure gaps to business milestones
   - Flag "too late to fix" items that need lead time
3. **Production readiness gaps blocking launch/growth**:
   - What's missing for a credible production launch?
   - What's missing for scaling beyond initial traction?
   - Grade each gap by business impact
4. **Technical dependencies constraining business priorities**:
   - Which business features are blocked by technical prerequisites?
   - Build a dependency graph: business priorities → technical enablers
   - Identify the critical path through technical enablers
5. **Industry benchmarks for performance/reliability**:
   - Research performance benchmarks for the product category (page load times, API latency, uptime)
   - Research reliability expectations for the company stage
   - Identify gaps between current state and benchmarks

**Output structure:**

```markdown
## Technical Readiness Intelligence

### Debt Velocity Impact
| Debt Item | Affected Areas | Velocity Impact | Fix Effort | ROI |
|-----------|---------------|----------------|-----------|-----|
| {item} | {modules} | {estimated slowdown} | {S/M/L/XL} | {high/med/low} |

### Infrastructure Milestones
| User Milestone | Prerequisites | Current State | Gap | Lead Time |
|---------------|--------------|--------------|-----|-----------|
| 1K users | {list} | {status} | {missing} | {days} |
| 10K users | {list} | {status} | {missing} | {days} |
| 100K users | {list} | {status} | {missing} | {days} |

### Production Readiness Blockers
| Blocker | Business Impact | Fix Effort | Deadline |
|---------|----------------|-----------|----------|
| {blocker} | {what it blocks} | {S/M/L/XL} | {when needed} |

### Technical → Business Dependency Map
| Business Priority | Technical Prerequisites | Status |
|------------------|----------------------|--------|
| {business item} | {technical items that must come first} | {ready/blocked} |

### Performance Benchmarks
| Metric | Industry P50 | Industry P90 | Current | Gap |
|--------|-------------|-------------|---------|-----|
| {metric} | {value} | {value} | {value or unknown} | {gap} |

### Recommended Technical Milestones
1. {milestone}: {deadline} — {what it enables}
2. ...
```

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Generate Dual-Lens Phased Roadmap

Merge the categorized work items from Step 2 with the research intelligence from Step 3 to build a roadmap with **two parallel dimensions**.

#### 4a. Business Milestones Lane

Map business-driven milestones across the timeline:

| Milestone Type | Examples |
|---------------|---------|
| **Revenue milestones** | Launch, first paying customer, MRR targets, break-even |
| **User acquisition milestones** | Beta launch, public launch, growth targets, market expansion |
| **Market timing milestones** | Competitive windows, seasonal peaks, conference launches |
| **Compliance milestones** | Certifications, audits, regulatory deadlines |
| **Fundraising milestones** | Metrics needed for next round, demo-ready state |

#### 4b. Technical Milestones Lane

Map technically-driven milestones across the timeline:

| Milestone Type | Examples |
|---------------|---------|
| **Infrastructure readiness** | MVP infra (solo tier), scaling infra (team/scaleup tier), multi-region, enterprise tier per CONSTITUTION §6 Decision 4 |
| **Production hardening** | Monitoring, alerting, incident response, SLA readiness |
| **Technical debt paydown** | Prioritized by business impact (velocity improvement) |
| **Platform capabilities** | APIs, integrations, extensibility, developer experience |
| **Security & compliance** | Auth hardening, vulnerability scanning, audit trails |

#### 4c. Phase Rules (Enhanced)

| Phase | Label | Business Criteria | Technical Criteria |
| ----- | ---- | ----------------- | ------------------ |
| P0 | Critical / Launch Blockers | Revenue-blocking features, regulatory deadlines, market timing windows | Security fixes, data integrity, core infrastructure dependencies |
| P1 | Core Features | Primary value-delivering features, conversion-critical flows, first GTM channel enablement | Essential integrations, performance baselines, CI/CD, compound system integrity checks |
| P2 | Important | Secondary features, retention improvements, additional GTM channels | Quality improvements, significant refactors, testing gaps, monitoring |
| P3 | Nice to Have | Polish, upsell features, market expansion preparation | Optimizations, non-critical enhancements, developer experience |
| P4+ | Future Ideas | Long-term market plays, new segments, platform strategy | Long-term architecture evolution, experimental technology |

#### 4d. Within Each Priority Tier

1. Order by dependency (both technical and business prerequisites first).
2. Group related items into epics (2+ related items = epic candidate).
3. Identify parallel work lanes (independent business and technical tracks that can be worked simultaneously).
4. Estimate effort for each item/epic.
5. Map business milestones to the technical items that enable them.
6. Calibrate to team capacity from Step 1e.

#### 4e. Present the Roadmap

```
Roadmap Overview:
  P0: N items (N BIZ, N TECH, N BOTH) — estimated effort: X days
  P1: N items (N BIZ, N TECH, N BOTH) — estimated effort: X days
  P2: N items (N BIZ, N TECH, N BOTH) — estimated effort: X days
  P3: N items (N BIZ, N TECH, N BOTH) — estimated effort: X days
  Future: N items

Business Milestones:
  {date/phase}: {milestone} — requires: {items}
  {date/phase}: {milestone} — requires: {items}

Technical Milestones:
  {date/phase}: {milestone} — enables: {business items}
  {date/phase}: {milestone} — enables: {business items}

Parallel Lanes:
  Lane A (Business): {theme} — P0 items 1-3, P1 items 4-5
  Lane B (Technical): {theme} — P0 items 6-7, P1 items 8-10
  Lane C (Cross-cutting): {theme} — P0 items 11-12

Critical Path: item 1 → item 3 → item 5 → item 8
Business-Critical Path: {biz milestone 1} → {biz milestone 2} → {launch}
```

**ASK:** "Here is the proposed dual-lens roadmap with business and technical milestones. Review:
- Are the business milestones and their timelines realistic?
- Are the technical prerequisites mapped with accurate dependency links?
- Adjust priorities, add/remove items, change grouping?
(confirm / adjust)"

---

### Step 5: Generate todo.md

Write `todo.md` in the exact format that `hatch3r-board-fill` expects, with `[BIZ]`/`[TECH]`/`[BOTH]` tags.

**Format specification:**

```markdown
## P0 — Critical / Launch Blockers

- [ ] **[TECH] {Infrastructure item}**: {Description. Scope: {what's in}. Enables: {business milestone}.} Ref: docs/specs/technical/{spec}.md.
- [ ] **[BIZ] {Market-driven item}**: {Description. Revenue impact: {impact}. Deadline: {if time-sensitive}.} Ref: docs/specs/business/{spec}.md.
- [ ] **[BOTH] {Cross-cutting item}**: {Description}. Ref: docs/specs/{spec}.md.

## P1 — Core Features

- [ ] **[TECH] {Feature title}**: {Description}. Ref: docs/specs/technical/{spec}.md.
- [ ] **[BIZ] {Business feature}**: {Description. Conversion/retention impact: {impact}.} Ref: docs/specs/business/{spec}.md.

## P2 — Important

- [ ] **[TECH] {Refactor/improvement title}**: {Description. Velocity impact: {improvement}.} Ref: docs/adr/{adr}.md.
- [ ] **[BIZ] {Business requirement}**: {Description}. Ref: docs/specs/business/{spec}.md.

## P3 — Nice to Have

- [ ] **[TECH] {Enhancement title}**: {Description}.
- [ ] **[BIZ] {Business enhancement}**: {Description}.

## Future Ideas

- [ ] **[TECH] {Long-term technical item}**: {Description}.
- [ ] **[BIZ] {Long-term business item}**: {Description}.
```

**Format requirements:**

- Each item on one line as `- [ ] **[BIZ/TECH/BOTH] {bold title}**: {description}`.
- Include `Ref:` with source spec/ADR path when the item was derived from a specific document. Use `docs/specs/business/` or `docs/specs/technical/` paths matching the item's category.
- For business items: include revenue/conversion/retention impact where known.
- For technical items: include what business milestone they enable where applicable.
- For time-sensitive items: include deadline or market window.
- Epic-level items should be substantial enough for board-fill to break into sub-issues.
- Group by priority tier with `## P{N} — {Label}` headers.
- Standalone items should be self-contained tasks.
- Items must be actionable — no vague "improve X" without specific scope.

**If `todo.md` already exists:**

**ASK:** "todo.md already exists with {N} items. (a) Replace entirely, (b) Append new items, (c) Merge (deduplicate and reorganize)"

- For **replace**: overwrite the file entirely.
- For **append**: add new items under appropriate priority headers, preserving existing content.
- For **merge**: compare existing items with new ones semantically, deduplicate, and reorganize by priority. Preserve existing `[BIZ]`/`[TECH]`/`[BOTH]` tags if present.

---

### Step 6: Write & Summary

1. Spawn a `hatch3r-docs-writer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) to write `todo.md` to the project root. The docs-writer receives the confirmed roadmap output from Step 4 and the format specification from Step 5, and follows the `hatch3r-docs-writer` agent protocol.
2. Update `.hatch3r-session.json` with roadmap context (if company stage and business context were gathered fresh in this run):

```json
{
  "timestamp": "{ISO timestamp}",
  "command": "hatch3r-roadmap",
  "companyStage": { ... },
  "businessContext": { ... },
  "scope": "{full / specific parts}",
  "roadmapGoals": { ... }
}
```
3. Present a summary:

```
Roadmap Written: todo.md

  Total items:     N (X epics, Y standalone)
  By scope:        BIZ: N, TECH: N, BOTH: N
  By priority:     P0: N, P1: N, P2: N, P3: N, Future: N
  Estimated total effort: ~X days
  Recommended parallel lanes: N
  Team capacity:   {N} devs × {hours}/week = ~{available days}
  Estimated duration: ~{weeks} weeks at current capacity

Business Milestones:
  {milestone 1}: {target date/phase}
  {milestone 2}: {target date/phase}

Technical Milestones:
  {milestone 1}: {target date/phase}
  {milestone 2}: {target date/phase}
```

---

### Step 7: AGENTS.md Generation

**ASK:** "Generate or update the root-level `AGENTS.md` with a project summary derived from the roadmap and specs? This file serves as the 'README for agents' — consumed by OpenCode, Windsurf, and other AI coding tools so they understand your project's business context, architecture, and conventions from the first interaction.

(a) Yes — generate it, (b) No — skip, (c) Let me review the content first."

If yes or review-first: spawn a `hatch3r-docs-writer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) to generate `AGENTS.md` at the project root following the `hatch3r-docs-writer` agent protocol. The docs-writer receives the roadmap context and spec references. The generated `AGENTS.md` should follow this structure:

```markdown
# {Project Name} — Agent Instructions

> Auto-generated by hatch3r-roadmap on {today's date}. Review and adjust before use.

## Project Purpose

{One-paragraph vision/purpose from business overview}

## Business Context

- **Business model**: {type}
- **Revenue model**: {model}
- **Company stage**: {stage}
- **Target market**: {segments}
- **Key metrics**: {KPIs}

## Technology Stack

{Concise stack summary — languages, frameworks, databases, infrastructure}

## Architecture Overview

{Architecture style, key components, deployment topology — 3-5 sentences}

## Module Map

| Module | Purpose |
| ------ | ------- |
| {module} | {one-line description} |

## Key Business Rules & Domain Constraints

{Top 5-10 business rules that agents must respect when making changes}

- {rule}: {constraint}

## Conventions

{Key coding conventions agents should follow — naming, patterns, testing}

## Current Roadmap Focus

{What the team is currently working on — P0/P1 items from the roadmap}

- **Current phase**: {description}
- **Key milestones**: {next 2-3 milestones}

## Documentation Reference

- Business specs: `docs/specs/business/`
- Technical specs: `docs/specs/technical/`
- Architecture decisions: `docs/adr/`
- Roadmap: `todo.md`
```

If the user chose "review first," present the content and **ASK** for confirmation before writing.

If `AGENTS.md` already exists, **ASK** before overwriting: "Root `AGENTS.md` already exists. (a) Replace entirely, (b) Append hatch3r section, (c) Skip."

---

### Step 8: Cross-Command Handoff

**ASK:** "Roadmap complete. Recommended next steps:
- Run `hatch3r-board-fill` to create GitHub issues from the todo.md
- Run `hatch3r-board-pickup` to start working on the highest-priority items

Which would you like to run next? (or none)"

**Future command:** `hatch3r-test-plan` — generates a test plan from the current task context (issue, spec references, acceptance criteria) covering unit, integration, and E2E test scenarios. Not yet implemented; tracked for a future release.

---

## Resumability (Decision 27/30)

roadmap is long-running — a Tier 3 brownfield discovery fans out parallel researcher sub-agents across Business-Priority and Technical-Readiness intelligence (Steps 2–3), then generates a dual-lens phased roadmap, todo.md, AGENTS.md, and a cross-command handoff (Steps 4–8). Per `governance/CONSTITUTION.md` §6 Decision 30 (Workspace-checkpointed resumability), checkpoint progress so an interrupted run re-enters at the last completed step rather than re-running the multi-mode researcher fan-out.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.roadmap-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the Step 0 → Step 8 progression), `wave` (researcher-batch index across business + technical lenses), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, roadmapSlug }`.
2. **Write points:** after Step 1 context + business discovery completes, after Step 2 categorization locks, after Step 3 researcher fan-out returns, after the Step 4 dual-lens roadmap synthesis is confirmed by ASK, and after each Step 5–7 file write (roadmap doc, todo.md, AGENTS.md) so already-generated artifacts survive a crash and are not regenerated on resume. Also after Step 8 cross-command handoff dispatch.
3. **`--resume` invocation:** `hatch3r-roadmap --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the repo / `todo.md` / `AGENTS.md` changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage before resuming.
4. **Snapshot rollback:** pre-mutation snapshots of `docs/roadmap/`, `todo.md`, and `AGENTS.md` land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's writes. Diff preview precedes every file write per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for roadmap: `1` = vision intake + horizon scoping, `2` = researcher/spec sub-agent dispatch (themes, milestones, dependencies), `3` = roadmap synthesis + sequencing, `4` = roadmap write + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (roadmap doc, milestone files, theme specs) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via <hatch3r-agent-name> (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output. The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `governance/audit/templates/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first researcher dispatch (Step 3).
- **Post-execution `cost_actuals` + `delta`** — appended to the Step 6 summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 2` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 1 (technical-readiness researcher only, condensed todo.md); Tier 2 ≈ 2-3 (both researchers + todo.md docs-writer); Tier 3 up to 3 (both researchers with deep web research + AGENTS.md docs-writer). This command is web-research-heavy at Tier 3 — `estimated_web_research_queries` typically dominates the cost delta. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **No specs or docs found:** Fall back to user-provided vision. Warn that the roadmap will be less detailed without structured specs. Offer to run `hatch3r-project-spec` or `hatch3r-codebase-map` first.
- **Existing todo.md conflict:** Always ASK before modifying — never overwrite silently.
- **Very large scope (>50 items):** Suggest splitting into phases or focus areas. Present only the first phase in detail and summarize the rest.
- **GitHub issue fetch failure:** Proceed without deduplication check. Warn user that duplicates may exist.
- **Ambiguous priority:** Default to P2. Flag for user review in Step 4.
- **Sub-agent failure:** Retry the failed researcher once. If it fails again, proceed with the other researcher's output and note the gap. ASK the user whether to continue with partial research.
- **Business context gaps:** If the user cannot answer business discovery questions, proceed with "TBD" markers and flag these items as needing business input before implementation.
- **Stage assessment unclear:** Default to "early-revenue" if the user is unsure. This provides balanced prioritization without over- or under-engineering the roadmap.
- **No business specs found:** If only technical specs exist (legacy layout), generate a technical-only roadmap and recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` to create business specs.

## Adapter Parity Within the Supported Set

hatch3r supports 3 adapters as of 1.9.0 (Cursor, Claude Code, Copilot). Adapter parity within that supported set is enforced by capability-matrix tests; no adapter-parity work should land in roadmaps unless those tests detect a regression. If a regression is detected, track the gap as a `[TECH]` item at P2 priority or higher.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **When in doubt, ASK.** It is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Never overwrite todo.md without explicit user confirmation.**
- **todo.md format must be compatible with board-fill** — markdown checklist with bold titles, priority headers matching `## P{N} — {Label}`, items tagged with `[BIZ]`/`[TECH]`/`[BOTH]`.
- **Keep items at the right granularity** — epic-level for complex features (XL effort), standalone for simple tasks (S/M effort).
- **Always reference source documentation** (specs, ADRs) where items were derived from. Use `docs/specs/business/` or `docs/specs/technical/` paths matching the item's category.
- **Do not duplicate work already tracked in GitHub issues.**
- **Effort estimates are rough; label each estimate explicitly with the `(estimate)` suffix.**
- **Respect existing priority conventions in the project.**
- **Stage-adaptive prioritization.** Never recommend enterprise-tier (per CONSTITUTION §6 Decision 4) solutions for solo-tier pre-revenue startups. Never recommend MVP shortcuts for scaleup-tier or enterprise-tier companies. Calibrate all prioritization to the company stage from Step 1d.
- **Business milestones must map to technical enablers.** Every business milestone should have its technical prerequisites identified and scheduled ahead of it.
- **Technical items must justify business impact.** Every technical item (refactor, debt paydown, infrastructure) should state what business outcome it enables or unblocks.
- **Never overwrite `AGENTS.md`** without explicit user confirmation.
- **Sub-agents must not create files.** They return structured text results to the orchestrator. Only the orchestrator writes files.
