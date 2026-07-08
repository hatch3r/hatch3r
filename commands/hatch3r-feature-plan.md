---
id: hatch3r-feature-plan
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer, hatch3r-ui, hatch3r-ux, hatch3r-security, hatch3r-reliability, hatch3r-testability, hatch3r-scalability, hatch3r-performance, hatch3r-maintainability, hatch3r-enhancability]
description: Design a new capability -- draft user stories, acceptance criteria, data model, API surface, and sub-issue breakdown as an epic-shaped todo.md for greenfield features
tags: [planning, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: deep
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 13
  rationale: Four parallel hatch3r-researcher modes per feature brief — codebase-impact, feature-design, architecture, risk-pitfalls — dispatched concurrently in Step 3; a docs-writer composes the spec on their merged output; the 9 CQ vector specialists (ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability) advise pre-write on the measurable floors that the spec must encode (axe-core threshold, OAuth depth, OTel + SLO scaffolding, mandate-map test class, etc.). Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: contradictory inputs, missing target, unknown convention.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (4 parallel: codebase-impact, feature-design, architecture, risk-assessment) | Yes | Yes |
| 2. Document Generation | `hatch3r-docs-writer` (spec, ADRs) | Yes | Yes |
| 3. Todo Generation | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

# Feature Plan — Single Feature Specification from Idea to Board-Ready Epic

Take a single feature idea and produce a complete feature specification (`docs/specs/`), architectural decision records (`docs/adr/`) when needed, and structured `todo.md` entries (epic + sub-items) ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (codebase impact, feature design, architecture, risk & pitfalls) to analyze the feature from multiple angles before generating artifacts. AI proposes all outputs; user confirms before any files are written. Optionally chains into `hatch3r-board-fill` to create GitHub issues immediately.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.

---

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces spec readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

## Step 0: Triage

Classify the feature-planning request before delegating:

- **Tier 1 (trivial)**: small feature scoped to one module with clear AC; reduced fanout (1–2 researchers), produce a single standalone todo entry instead of an epic.
- **Tier 2 (standard)**: standard feature touching 2–5 modules with sub-tasks; standard pipeline with all 5 parallel researcher modes and ADR generation if architectural decisions arise.
- **Tier 3 (deep)**: cross-cutting feature with new architecture, multiple integrations, or breaking changes; full pipeline with deep research and confirm spec scope with the user before writing files.

If Tier 1, run the reduced researcher set and skip Step 6 (ADRs). If Tier 2, run the standard pipeline below. If Tier 3, run the full pipeline including ADR generation and confirm spec scope explicitly before writing files.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 3), surface the cost preview so a multi-researcher feature-planning run is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 ~2, Tier 2 ~6, Tier 3 up to 13>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a single-module feature scored as Deep, or a cross-cutting feature scored as Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Gather Feature Description

1. **ASK:** "Tell me about the feature you want to plan. I need:
   - **Feature name**
   - **Description / goal** (one paragraph — what does it do and why is it needed?)
   - **Target personas** (who benefits from this feature?)
   - **Known constraints** (timeline, tech mandates, backward compatibility, etc.)

   You can also point me to an existing spec section, PRD passage, or GitHub issue and I'll extract these from it."

2. If the user provides a document reference or issue, read it and extract the four fields above.
3. Present a structured summary:

```
Feature Brief:
  Name:        {name}
  Goal:        {one-paragraph description}
  Personas:    {list with brief impact}
  Constraints: {list}
```

**ASK:** "Does this capture the feature? Adjust anything before I send this to the research phase."

#### Step 1b: Dimension Probing (Requirements Elicitation)

After the feature brief is confirmed, probe for missing requirements across key dimensions. Scan the feature description for ambiguities and generate targeted follow-up questions.

1. Analyze the confirmed feature brief for vague language, unstated assumptions, and missing dimensions.
2. Generate 5–10 targeted questions from the most relevant dimensions for this feature type:
   - **Data**: What data is needed? Schema shape? Source? Volume expectations? Validation rules?
   - **Behavior**: What happens on success? On failure? On edge cases? Concurrent access?
   - **UI/UX**: Loading states? Empty states? Error states? Responsive behavior? Accessibility?
   - **Security**: Auth model? Data sensitivity? Input validation? Rate limiting?
   - **Performance**: Expected data volume? Caching? Pagination? Bundle impact?
   - **Integration**: Which existing features does this interact with? Shared state? Event chains?
   - **Migration**: Existing data or behavior that changes? Backward compatibility?
   - **Observability**: Logging? Metrics? Error tracking for the new behavior?
   - **Testing**: What constitutes "working"? Acceptance test scenarios?
   - **Rollout**: Feature flags? Phased rollout? Rollback strategy?
3. Skip dimensions that the feature brief already addresses with a stated answer.

**ASK:** "Before research begins, I have {N} questions to confirm coverage of all feature dimensions:
{numbered question list — each with the dimension label and why the answer matters}

Answer these now, or say 'use defaults' for any where you're comfortable with a reasonable default."

4. Record the user's answers as **Resolved Requirements**. These are passed to the researchers and ultimately to the implementer.
5. For any dimension where the user chose defaults, note the assumed default explicitly.

---

### Step 2: Load Project Context

1. Check for existing documentation:
   - `docs/specs/` — project specifications (read TOC/headers first, expand relevant sections only)
   - `docs/adr/` — architectural decision records (scan for decisions relevant to the feature area)
   - `README.md` — project overview
   - `.hatch3r/hatch.json` — board configuration
   - Existing `todo.md` — current backlog (check for overlap or related items)
2. Scan GitHub issues via `search_issues` for existing work related to the feature. Note duplicates or partial overlaps.
3. If `.hatch3r/learnings/` exists, scan for learnings relevant to the feature area. Match by area and tags against the feature brief.
4. Present a context summary:

```
Context Loaded:
  Specs:            {N} files in docs/specs/ ({relevant ones listed})
  ADRs:             {N} files in docs/adr/ ({relevant ones listed})
  Existing todo.md: {found with N items / not found}
  Related issues:   {N} open issues with overlap ({list issue numbers})
  Learnings:        {N} relevant learnings ({areas})
  Gaps:             {list any missing context}
```

**ASK:** "Here is the context I loaded. Provide additional constraints, related work, or context? (or confirm to proceed)"

---

### Step 3: Spawn Parallel Researcher Sub-Agents

Spawn one sub-agent per research domain below concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed feature brief from Step 1 and the context summary from Step 2.

**Each sub-agent prompt must include:**
- The full confirmed feature brief
- The Resolved Requirements from Step 1b (user's answers to dimension-probing questions)
- The project context summary from Step 2
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `deep`

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `codebase-impact` | Map affected files, modules, integration points, coupling, existing patterns, and transitive dependency trace |
| 2 | `feature-design` | Break down into sub-tasks, user stories, acceptance criteria, edge cases, effort |
| 3 | `architecture` | Data model, API contracts, component design, ADR candidates, dependencies |
| 4 | `risk-assessment` | Technical risks, security, performance, breaking changes, common pitfalls |
| 5 | `similar-implementation` | Find analogous existing features, extract their conventions, recommend patterns to follow |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification.

The `similar-implementation` sub-agent's output is critical for convention alignment — it identifies reference implementations whose patterns the new feature should follow. This output is passed to the implementer as "Reference Conventions" and used in Step 4 for convention alignment.

The `codebase-impact` sub-agent uses `deep` depth, which includes transitive dependency tracing (import chains up to 3 levels), API consumer maps, and blast radius summary.

**Each sub-agent prompt must also include** the Resolved Requirements from Step 1b (user's answers to dimension-probing questions) so researchers can factor in the user's explicit decisions.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Research Summary:

Feature:              {name}
Affected files:       {N} files across {M} modules
Blast radius:         {N} direct + {M} transitive files at risk
Sub-tasks:            {N} tasks ({X} parallelizable)
Effort:               {total estimate}
ADRs needed:          {N} architectural decisions
Risks:                {N} risks ({X} high, {Y} med, {Z} low)
Breaking changes:     {N} ({list if any})
Convention reference: {reference module} — follow patterns from {name}
Convention alignment: {N}/{M} aspects aligned, {divergences if any}
Priority:             {recommended P-level}
```

2. **Highlight conflicts** between researchers. Common conflict types:
   - Feature design researcher scopes work that the risk researcher flags as dangerous
   - Architecture researcher proposes a pattern that contradicts existing codebase conventions found by the codebase impact researcher
   - Effort estimates that seem inconsistent with the scope of changes identified

3. For each conflict, present both sides and a recommended resolution.

**ASK:** "Here is the merged research summary. Conflicts (if any) are highlighted above. Options:
- **Confirm** to proceed with spec and todo generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher with updated parameters
- **Descope** to reduce the feature size"

---

### Step 5: Generate Feature Spec

From the merged researcher outputs, generate a feature specification document. Present all content for review before writing any files.

#### Feature Spec — `docs/specs/{NN}_{feature-slug}.md`

Determine the next sequential number by scanning existing files in `docs/specs/`. Use slugified feature name (lowercase, hyphens).

```markdown
# {Feature Name}

## Overview

{2-3 sentence summary of the feature and its purpose, derived from the confirmed feature brief}

## Scope

### In Scope
- {item derived from feature design researcher}

### Out of Scope
- {item — explicitly listed to prevent scope creep}

## Personas Affected

| Persona | Impact | Key Flows |
|---------|--------|-----------|
| {name} | {how this feature affects them} | {flows} |

## Requirements

| Req ID | Requirement | Priority | Source |
|--------|-------------|----------|--------|
| {feature-slug}-R01 | {requirement} | P0/P1/P2/P3 | {researcher / feature brief} |

## Sub-Features

| # | Sub-Feature | User Story | Acceptance Criteria | Effort |
|---|-------------|-----------|---------------------|--------|
| 1 | {title} | {story} | {criteria as checklist} | S/M/L/XL |

## Architecture

### Data Model Changes
{From architecture researcher — tables, schemas, migrations}

### API / Interface Contracts
{From architecture researcher — endpoints, interfaces}

### Component Design
{From architecture researcher — new and modified components}

## Dependencies

| Depends On | Type | Status | Notes |
|-----------|------|--------|-------|
| {dependency} | Hard/Soft | Exists/Needs building | {notes} |

## Edge Cases

- {edge case}: {expected behavior}

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| {risk} | {level} | {strategy} |

## Convention Alignment

Reference implementation: {module/feature name} ({file path})

| Aspect | Convention to Follow | Reference Files |
|--------|---------------------|----------------|
| File structure | {pattern} | {example files from reference} |
| State management | {pattern} | {example files from reference} |
| Error handling | {pattern} | {example files from reference} |
| Data fetching | {pattern} | {example files from reference} |
| Test structure | {pattern} | {example files from reference} |

Divergences from reference:
- {aspect}: {what differs and why}

## Implementation Order

{Topological ordering of sub-tasks with parallel lanes identified}

1. {task} (prerequisite — no dependencies)
2. {task} (depends on 1)
3. {task} + {task} (parallel — both depend on 2)
4. {task} (depends on 3)

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

If a glossary exists (`docs/specs/00_glossary.md`), reference its stable IDs where applicable. If the feature introduces new entities or events, note them for glossary update.

**ASK:** "Here is the generated feature spec. Review the content before I write the file:
- `{NN}_{feature-slug}.md` — {sub-feature count} sub-features, {requirement count} requirements, {risk count} risks

Confirm, or tell me what to adjust."

---

### Step 6: Generate ADR(s) (If Applicable)

Only proceed if the architecture researcher identified decisions requiring ADRs in Step 3. If no ADRs are needed, skip to Step 7.

From the architecture researcher's "Architectural Decisions Requiring ADRs" output, create one ADR per decision.

#### ADR Format — `docs/adr/{NNNN}_{decision-slug}.md`

Determine the next sequential number by scanning existing files in `docs/adr/`. Use slugified decision titles.

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Context

{Why this decision is needed — business and technical context, derived from the feature brief and architecture researcher findings}

## Decision

{What was decided and why}

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| {option} | {pros} | {cons} | {reason} |

## Consequences

### Positive
- {consequence}

### Negative
- {consequence}

### Risks
- {risk}: {mitigation}

## Related

- Feature spec: `docs/specs/{NN}_{feature-slug}.md`
```

**ASK:** "Here are {N} ADR(s) generated from architectural decisions for this feature. Review before I write the files:
{list with titles}

Confirm, or tell me what to adjust."

---

### Step 7: Generate todo.md Entries

From the feature design researcher's sub-task catalog and the synthesized research, generate structured `todo.md` entries in the format that `hatch3r-board-fill` expects.

#### Entry Structure

One **epic-level entry** with a description referencing the feature spec, followed by **individual sub-item entries** if the feature breaks into 2+ sub-tasks:

```markdown
- [ ] **{Feature name} epic**: {Feature overview, scope, key sub-tasks}. Ref: docs/specs/{NN}_{feature-slug}.md.
- [ ] **{Sub-task 1 title}**: {Description with acceptance criteria summary}. Ref: docs/specs/{NN}_{feature-slug}.md.
- [ ] **{Sub-task 2 title}**: {Description with acceptance criteria summary}. Ref: docs/specs/{NN}_{feature-slug}.md.
```

If the feature is small enough to be a single task (effort S or M, no meaningful sub-tasks), produce a single standalone entry instead of an epic.

#### Placement

Determine the appropriate priority header based on the priority recommended in Step 4. Place entries under the matching `## P{N} — {Label}` header.

#### If `todo.md` Already Exists

**ASK:** "todo.md already exists with {N} items. How should I add the new entries?
- **(a) Append** under the appropriate priority header
- **(b) Merge** — deduplicate against existing items and reorganize
- **(c) Show me the entries** and I'll place them manually"

#### If `todo.md` Does Not Exist

Create a new `todo.md` with the appropriate priority header and the new entries.

Present the drafted entries for review.

**ASK:** "Here are the todo.md entries for this feature ({N} items — 1 epic + {M} sub-items). Review before I write:

{entries}

Confirm, or tell me what to adjust."

---

### Step 7.5: Deterministic Plan-Lint (Evaluator gate before write)

Steps 3-4 are the Planner (researchers) and Steps 5-7 are the Generator (spec/ADR/todo drafting). Before any file is written in Step 8, run an Evaluator pass over the drafted plan — the third role of Anthropic's Planner/Generator/Evaluator pattern (the gather-context → take-action → verify-work loop in `agents/shared/quality-charter.md`). The human ASK checkpoints in Steps 4-7 catch judgment-level disagreements; this gate catches structural defects the human eye skips on a long spec. It is rules-based (string/reference assertions over the drafted artifacts), not LLM-as-judge — the `rules-based > visual > LLM-as-judge` hierarchy applies, so each assertion below either passes or names the offending row.

Run all three assertions against the drafted spec (Step 5), ADR(s) (Step 6), and todo entries (Step 7). Each is a binary predicate over text already drafted; none require re-invoking a sub-agent.

| # | Assertion | Pass condition | Fail action |
|---|-----------|----------------|-------------|
| L1 | **Acceptance criteria are testable predicates.** Every cell in the Sub-Features `Acceptance Criteria` column (Step 5) and every acceptance-criteria summary in a todo entry (Step 7) states an observable subject plus a verifiable condition. | No criterion is a bare adjective or unfalsifiable phrase (`works`, `is fast`, `handles errors`, `looks good`, `as expected`) with no measurable subject + condition. A criterion phrased as a checklist item with a concrete trigger and outcome passes. | List each non-testable criterion by sub-feature title; rewrite it as `given <state>, when <action>, then <observable outcome>` (or a measurable threshold) before proceeding. |
| L2 | **Every `Depends On` resolves to a listed prerequisite.** Each entry in the spec Dependencies table `Depends On` column (Step 5) and each "depends on N" reference in the Implementation Order maps to either another sub-feature/sub-task listed in this spec, an entry in the same Dependencies table, or a named existing artifact marked `Status: Exists`. | Zero dangling dependencies — no `Depends On` value that names nothing in the spec and is not flagged `Needs building` or `Exists`. | Name each unresolved dependency and its source row; add the missing prerequisite to the Dependencies table (with `Type` + `Status`) or correct the reference before proceeding. |
| L3 | **Edge Cases carry zero empty `expected behavior`.** Every row in the spec `## Edge Cases` section (Step 5) and every row of an Edge-Case Ledger carried from `hatch3r-architect` / `agents/hatch3r-edge-case-analyst.md` has a non-empty `expected behavior` value. | No edge case is listed with a blank, `{expected behavior}` placeholder, or `TBD`/`TODO` expected-behavior cell. | List each edge case with a missing `expected behavior`; fill it from the risk-assessment researcher output, or move the row to `Out of Scope` with a one-line justification before proceeding. |

Emit the lint verdict with the spec-readiness confidence rating per the Confidence Propagation Contract:

```
plan_lint:
  L1_testable_acceptance_criteria: pass | fail (<N> non-testable: <titles>)
  L2_dependencies_resolve:         pass | fail (<N> dangling: <names>)
  L3_edge_cases_have_expected:     pass | fail (<N> empty: <ids>)
  verdict: pass | fail
  confidence: high | medium | low   # sourced from upstream researcher confidence per the Confidence Propagation Contract
```

**On `fail`:** do not advance to Step 8. Apply the per-assertion Fail action above to repair the drafted content in place, re-present the corrected rows under the relevant Step 5-7 ASK, then re-run this gate. A failing plan-lint is never written to disk — the gate is the last checkpoint before mutation, so structural defects cannot reach the implementer.

**On `pass`:** proceed to Step 8.

---

### Step 8: Write All Files

After all content is confirmed:

1. Write the feature spec to `docs/specs/{NN}_{feature-slug}.md`. Create the `docs/specs/` directory if it does not exist.
2. Write ADR(s) to `docs/adr/{NNNN}_{decision-slug}.md` (if any). Create the `docs/adr/` directory if it does not exist.
3. Write or update `todo.md` at the project root.
4. If a glossary exists and the feature introduces new entities/events, note glossary updates needed (do not modify the glossary automatically — flag for manual update or a follow-up `project-spec` run).
5. Present a summary of all files created or modified:

```
Files Created/Updated:
  docs/specs/
    {NN}_{feature-slug}.md    — {sub-feature count} sub-features, {requirement count} requirements
  docs/adr/
    {NNNN}_{decision}.md      — {decision title}  (if applicable)
    ...
  todo.md                      — {N} entries added ({1} epic + {M} sub-items)
  Glossary update needed:      {yes/no — list new entities/events if yes}
```

---

### Step 9 (Optional): Chain into Board-Fill

**ASK:** "All files written. Run `hatch3r-board-fill` to create GitHub issues from the new todo.md entries? (yes / not now)"

If yes, instruct the user to invoke the `hatch3r-board-fill` command. Note that board-fill will perform its own deduplication, grouping, dependency analysis, and readiness assessment on the entries.

---

## Resumability (Decision 27/30)

feature-plan is long-running — a Tier 3 cross-cutting feature fans out four parallel hatch3r-researcher modes (codebase-impact, feature-design, architecture, risk-pitfalls) in Step 3, then assembles the spec via docs-writer with the 9 CQ vector specialists (ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability) advising pre-write on the measurable floors the spec must encode. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-running the four-researcher + nine-specialist fan-out.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.feature-plan-workspace/`; step range Step 0 → Step 8; `wave` = researcher-batch index, then CQ-specialist-batch index; doc dirs `docs/specs/`, `docs/adr/`, `todo.md`; `meta` adds `featureSlug`. Write points: after Step 1 feature-brief context locks, after Step 2 scope ASK, after the Step 3 four-researcher fan-out returns, after the CQ-specialist advisory batch returns, after Step 4 spec synthesis is confirmed by ASK, after each Step 5 file write, after Step 6 todo.md epic + sub-item generation, and after the optional Step 7 chain-to-`hatch3r-board-fill` handoff.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for feature-plan: `1` = feature intake + scope decomposition, `2` = researcher/spec sub-agent dispatch, `3` = plan synthesis + acceptance-criteria drafting + Step 7.5 deterministic plan-lint (Evaluator gate), `4` = plan write + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: plan document, sub-plan files, criteria spec.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 23, superseded in place 2026-07-06).

### Cost Visibility (Decision 24)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first researcher dispatch.
- **Post-execution `cost_actuals` + `delta`** — the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 13` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 2 (reduced researcher set + docs-writer); Tier 2 ≈ 6; Tier 3 up to 13 (4-5 parallel researcher modes + docs-writer + the 9 CQ vector specialists advising pre-write). Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## References

- Anthropic. "Building agents with the Claude Agent SDK." `https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk` (accessed 2026-06-06, Anthropic engineering, official-vendor). Source for the Planner/Generator/Evaluator decomposition and the gather-context → take-action → verify-work loop behind Step 7.5: the Evaluator role evaluates the drafted plan before execution, and the `rules-based > visual > LLM-as-judge` hierarchy is why the Step 7.5 plan-lint is binary string/reference assertions rather than an LLM critique.

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `.hatch3r/hatch.json` exists, proceed without board context — this command does not require board configuration.
- **No existing specs or docs:** Proceed without spec references. Warn that the feature spec will be less contextualized without existing project documentation. Recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` first for best results.
- **Duplicate detection:** If the feature overlaps significantly with existing todo.md items or GitHub issues found in Step 2, present the overlap and ASK whether to proceed (augment existing / replace / abort).

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Never write files on a failing Step 7.5 plan-lint.** The Evaluator gate (acceptance criteria testable, dependencies resolve, edge cases carry expected behavior) must report `verdict: pass` before Step 8 — repair the drafted content and re-run the gate; a failing plan never reaches the implementer.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Stay within the feature scope** defined by the user in Step 1. Do not invent sub-features the user did not describe or imply. Flag scope expansion opportunities but do not act on them without explicit approval.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source specs.
- **ADRs use the same format as `hatch3r-project-spec`** — Status, Date, Context, Decision, Alternatives, Consequences.
- **Feature spec must reference existing glossary IDs** where a glossary exists. Do not create conflicting stable IDs.
- **Do not over-specify.** Keep the spec at the right level of detail for board-fill to create actionable issues. Avoid implementation details that belong in code.
- **All 4 researchers must complete before proceeding to Step 4.** Do not generate specs from partial research.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
