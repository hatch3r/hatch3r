---
id: hatch3r-refactor-plan
type: command
description: Plan a refactoring or migration effort -- spawn parallel researchers, produce refactoring spec, ADR(s), and phased todo.md entries for board-fill.
---
# Refactor Plan — Refactoring & Migration Specification from Problem to Phased Execution

Take a refactoring goal or migration need and produce a complete refactoring specification (`docs/specs/`), architectural decision records (`docs/adr/`) when the approach involves significant design choices, and structured `todo.md` entries (phased work items) ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (current state analysis, refactoring strategy, impact & risk assessment, migration path planning) to design the refactoring from multiple angles before generating artifacts. AI proposes all outputs; user confirms before any files are written. Optionally chains into `hatch3r-board-fill` to create GitHub issues immediately.

**Handles all refactoring types by detection:**

- **Structural / code refactoring** — module restructuring, extraction, dependency decoupling, dead code removal
- **Logical refactoring** — behavior flow changes, data model migrations, API contract evolution
- **Visual refactoring** — design system overhauls, component hierarchy restructuring, accessibility compliance
- **Mixed** — the command detects which dimensions are relevant and adjusts researcher prompts

The command produces phased todo.md entries that map to the appropriate execution skill (`hatch3r-refactor`, `hatch3r-logical-refactor`, or `hatch3r-visual-refactor`) during `hatch3r-board-pickup`.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather Refactoring Goal

1. **ASK:** "Tell me about the refactoring or migration you want to plan. I need:
   - **Title** (short descriptive name for the effort)
   - **Motivation** (what problem does this solve? what pain are you experiencing?)
   - **Target area** (which modules, files, components, or patterns are involved?)
   - **Desired end state** (what does "done" look like? what improves?)
   - **Constraints** (backward compatibility, feature freeze, timeline, external consumers, etc.)
   - **Refactoring type** (structural / logical / visual / migration / mixed / not sure)

   You can also point me to a tech debt finding, `hatch3r-codebase-map` output, existing spec section, or GitHub issue and I'll extract these from it."

2. If the user provides a document reference or issue, read it and extract the six fields above.
3. Detect the **refactoring dimension(s)** from the goal:

| Signal | Dimension |
|--------|-----------|
| Module restructuring, file reorganization, extracting/inlining, decoupling, dead code | Structural |
| Behavior changes, data model changes, API evolution, business logic rewrite | Logical |
| Design system changes, component overhaul, accessibility fixes, responsive layout | Visual |
| Framework/library swap, database migration, architecture shift | Migration |

4. Present a structured summary:

```
Refactoring Brief:
  Title:          {title}
  Motivation:     {why this refactoring is needed}
  Target area:    {modules, files, patterns involved}
  Desired state:  {what "done" looks like}
  Constraints:    {list}
  Dimension(s):   {Structural / Logical / Visual / Migration — one or more}
```

**ASK:** "Does this capture the refactoring goal correctly? Adjust anything before I send this to the research phase."

---

### Step 2: Load Project Context

1. Check for existing documentation:
   - `docs/specs/` — project specifications (read TOC/headers first, expand relevant sections only)
   - `docs/adr/` — architectural decision records (scan for decisions relevant to the target area)
   - `README.md` — project overview
   - `/.agents/hatch.json` — board configuration
   - Existing `todo.md` — current backlog (check for overlap or related items)
2. Scan GitHub issues via `search_issues` for existing work related to the refactoring area. Note in-progress work, dependencies, or prior refactoring attempts.
3. If `/.agents/learnings/` exists, scan for learnings relevant to the target area. Match by area and tags against the refactoring brief.
4. Scan test coverage in the target area — identify which parts have strong test coverage (safe to refactor) vs. weak coverage (need tests first).
5. Present a context summary:

```
Context Loaded:
  Specs:            {N} files in docs/specs/ ({relevant ones listed})
  ADRs:             {N} files in docs/adr/ ({relevant ones listed})
  Existing todo.md: {found with N items / not found}
  Related issues:   {N} open issues with overlap ({list issue numbers})
  Learnings:        {N} relevant learnings ({areas})
  Test coverage:    {strong / partial / weak in target area — details}
  Gaps:             {list any missing context}
```

**ASK:** "Here is the context I loaded. Provide additional context — prior refactoring attempts, external consumers, deployment constraints? (or confirm to proceed)"

---

### Step 3: Spawn Parallel Researcher Sub-Agents

Spawn one sub-agent per research domain below concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed refactoring brief from Step 1 (including detected dimension(s)) and the context summary from Step 2.

**Each sub-agent prompt must include:**
- The full confirmed refactoring brief including detected dimension(s)
- The project context summary from Step 2 (including test coverage assessment)
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `deep`
- The detected dimension(s) as the `dimension` parameter — the researcher agent applies dimension-specific focus automatically

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `current-state` | Map complexity, coupling, cohesion, test coverage, code smells, patterns |
| 2 | `refactoring-strategy` | Design transformations, behavioral invariants, interface contracts, effort |
| 3 | `risk-assessment` | Breaking changes, downstream consumers, regression hotspots, rollback strategy |
| 4 | `migration-path` | Phased execution plan, parallel lanes, rollback points, skill mapping |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification. Modes `current-state` and `refactoring-strategy` apply dimension-specific focus (structural/logical/visual/migration) based on the dimension(s) passed in the brief.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Refactoring Summary:

Title:             {title}
Dimension(s):      {Structural / Logical / Visual / Migration}
Affected files:    {N} files across {M} modules
Phases:            {N} phases ({X} parallelizable)
Total effort:      {estimate}
ADRs needed:       {N} architectural decisions
Risks:             {N} risks ({X} high, {Y} med, {Z} low)
Breaking changes:  {N} ({list if any})
Test gaps:         {N} areas need tests before refactoring
Prerequisites:     {list — tests to add, docs to update, etc.}
```

2. **Highlight conflicts** between researchers. Common conflict types:
   - Strategy designer proposes a transformation that the risk assessor flags as too dangerous given test coverage
   - Current state analyzer identifies coupling that the migration path planner's phase ordering doesn't account for
   - Effort estimates from strategy designer conflict with the scope of changes identified by current state analyzer
   - Migration path planner's skill mapping doesn't match the dimension detected in Step 1

3. For each conflict, present both sides and a recommended resolution.

**ASK:** "Here is the merged refactoring summary. Conflicts (if any) are highlighted above. Options:
- **Confirm** to proceed with spec and todo generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher with updated parameters
- **Descope** to reduce the refactoring scope
- **Add prerequisite phase** (e.g., add tests before refactoring)"

---

### Step 5: Generate Refactoring Spec

From the merged researcher outputs, generate a refactoring specification document. Present all content for review before writing any files.

#### Refactoring Spec — `docs/specs/{NN}_{refactor-slug}.md`

Determine the next sequential number by scanning existing files in `docs/specs/`. Use slugified refactoring title (lowercase, hyphens).

```markdown
# Refactoring: {Title}

## Overview

{2-3 sentence summary of the refactoring, its motivation, and target end state}

## Scope

### In Scope
- {area or transformation included}

### Out of Scope
- {explicitly excluded to prevent scope creep}

## Current State

{From current state analyzer — summary of problems, complexity, coupling}

### Key Metrics
| Metric | Current | Target |
|--------|---------|--------|
| {metric — e.g., module count, coupling, complexity} | {current value} | {target value} |

## Target State

{From strategy designer — description of the desired architecture after refactoring}

## Behavioral Invariants

| # | Invariant | Verification |
|---|-----------|-------------|
| 1 | {behavior that must be preserved} | {how to verify} |

## Transformation Plan

| # | Transformation | Type | From | To |
|---|---------------|------|------|-----|
| 1 | {change} | {Extract/Inline/Restructure/Migrate} | {current} | {target} |

## Phased Execution

| Phase | Title | Scope | Skill | Effort | Dependencies |
|-------|-------|-------|-------|--------|-------------|
| 0 | {prereq} | {scope} | {skill} | {effort} | — |
| 1 | {phase} | {scope} | {skill} | {effort} | Phase 0 |

### Phase Details
{Expanded details from migration path planner — per-phase goals, files, verification}

### Parallel Lanes
{Which phases can execute concurrently}

### Critical Path
{Sequential dependency chain with total effort}

## Breaking Changes

| What Breaks | Who Is Affected | Migration Path |
|------------|----------------|----------------|
| {change} | {consumers} | {strategy} |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| {risk} | {level} | {level} | {strategy} |

## Prerequisites

- [ ] {test to add before refactoring}
- [ ] {documentation to update}
- [ ] {approval to obtain}

## Completion Criteria

- [ ] All phases completed and verified
- [ ] All behavioral invariants confirmed via tests
- [ ] No regression in existing test suite
- [ ] Dead code removed
- [ ] Documentation updated

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

If a glossary exists (`docs/specs/00_glossary.md`), reference its stable IDs where applicable. If the refactoring introduces new entities or patterns, note them for glossary update.

**ASK:** "Here is the generated refactoring spec. Review the content before I write the file:
- `{NN}_{refactor-slug}.md` — {phase count} phases, {transformation count} transformations, {risk count} risks

Confirm, or tell me what to adjust."

---

### Step 6: Generate ADR(s) (If Applicable)

Only proceed if the refactoring involves significant architectural decisions — for example, replacing a framework, introducing a new pattern across the codebase, changing data models, or evolving API contracts. If no ADRs are needed, skip to Step 7.

From the strategy designer's output and any conflicts resolved in Step 4, create one ADR per decision.

#### ADR Format — `docs/adr/{NNNN}_{decision-slug}.md`

Determine the next sequential number by scanning existing files in `docs/adr/`. Use slugified decision titles.

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Context

{Why this decision is needed — the refactoring goal, the current state problem, and why a design choice must be made}

## Decision

{What was decided and why — which approach, pattern, or technology was chosen}

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

- Refactoring spec: `docs/specs/{NN}_{refactor-slug}.md`
```

**ASK:** "Here are {N} ADR(s) generated from refactoring decisions. Review before I write the files:
{list with titles}

Confirm, or tell me what to adjust."

---

### Step 7: Generate todo.md Entries

From the migration path planner's phased execution plan and the synthesized research, generate structured `todo.md` entries in the format that `hatch3r-board-fill` expects.

#### Entry Structure

One **epic-level entry** for the refactoring effort, followed by **individual phase entries** ordered for safe execution:

```markdown
- [ ] **{Refactoring title} epic**: {Motivation, target state, phase count, key transformations}. Ref: docs/specs/{NN}_{refactor-slug}.md.
- [ ] **Phase 0 — {Test scaffolding title}**: {What tests to add, where, acceptance criteria}. Ref: docs/specs/{NN}_{refactor-slug}.md.
- [ ] **Phase 1 — {Transformation title}**: {What to transform, behavioral invariants, verification criteria}. Ref: docs/specs/{NN}_{refactor-slug}.md.
- [ ] **Phase 2 — {Transformation title}**: {What to transform, dependencies on Phase 1, verification criteria}. Ref: docs/specs/{NN}_{refactor-slug}.md.
```

For small refactoring efforts (single phase, effort S or M), produce a single standalone entry instead of an epic.

#### Placement

Determine the appropriate priority header. Refactoring is typically P2 (important but not urgent) unless motivated by a production issue (P1) or purely aspirational improvement (P3). Place entries under the matching `## P{N} — {Label}` header.

#### If `todo.md` Already Exists

**ASK:** "todo.md already exists with {N} items. How should I add the new entries?
- **(a) Append** under the appropriate priority header
- **(b) Merge** — deduplicate against existing items and reorganize
- **(c) Show me the entries** and I'll place them manually"

#### If `todo.md` Does Not Exist

Create a new `todo.md` with the appropriate priority header and the new entries.

Present the drafted entries for review.

**ASK:** "Here are the todo.md entries for this refactoring ({N} items — 1 epic + {M} phases). Review before I write:

{entries}

Confirm, or tell me what to adjust."

---

### Step 8: Write All Files

After all content is confirmed:

1. Write the refactoring spec to `docs/specs/{NN}_{refactor-slug}.md`. Create the `docs/specs/` directory if it does not exist.
2. Write ADR(s) to `docs/adr/{NNNN}_{decision-slug}.md` (if any). Create the `docs/adr/` directory if it does not exist.
3. Write or update `todo.md` at the project root.
4. If a glossary exists and the refactoring introduces new entities or patterns, note glossary updates needed (do not modify the glossary automatically — flag for manual update or a follow-up `project-spec` run).
5. Present a summary of all files created or modified:

```
Files Created/Updated:
  docs/specs/
    {NN}_{refactor-slug}.md    — {phase count} phases, {transformation count} transformations
  docs/adr/
    {NNNN}_{decision}.md       — {decision title}  (if applicable)
    ...
  todo.md                       — {N} entries added ({1} epic + {M} phases)
  Glossary update needed:       {yes/no — list new patterns/entities if yes}
```

---

### Step 9 (Optional): Chain into Board-Fill

**ASK:** "All files written. Run `hatch3r-board-fill` to create GitHub issues from the new todo.md entries? (yes / not now)"

If yes, instruct the user to invoke the `hatch3r-board-fill` command. Note that board-fill will perform its own deduplication, grouping, dependency analysis, and readiness assessment on the entries.

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `/.agents/hatch.json` exists, proceed without board context — this command does not require board configuration.
- **No existing specs or docs:** Proceed without spec references. Warn that the refactoring spec will be less contextualized without existing project documentation. Recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` first for best results.
- **Duplicate detection:** If the refactoring overlaps significantly with existing todo.md items or GitHub issues found in Step 2, present the overlap and ASK whether to proceed (augment existing / replace / abort).
- **Weak test coverage:** If the current state analyzer finds weak test coverage in the target area, the migration path planner MUST include a Phase 0 for test scaffolding. Do not proceed with refactoring phases without adequate coverage.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Stay within the refactoring scope** defined by the user in Step 1. Do not expand into unrelated areas. Flag scope expansion opportunities but do not act on them without explicit approval.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source specs.
- **ADRs use the same format as `hatch3r-project-spec`** — Status, Date, Context, Decision, Alternatives, Consequences.
- **Every phase must leave the codebase in a working state.** No phase may break the build, fail tests, or leave the code in an intermediate non-functional state. If a transformation cannot be split into safe phases, flag this to the user.
- **Behavioral invariants are non-negotiable.** Every invariant listed in the spec must have a verification strategy. If an invariant cannot be verified (no test, no assertion), add a prerequisite to create the verification first.
- **Phase ordering must respect dependencies.** The migration path planner's output is the source of truth for execution order. Do not reorder phases without updating dependency analysis.
- **Do not over-specify.** Keep the spec at the right level of detail for board-fill to create actionable issues. Avoid implementation details that belong in code.
- **All 4 researchers must complete before proceeding to Step 4.** Do not generate specs from partial research.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
- **Distinguish refactoring from new features.** If the "refactoring" introduces new external behavior or capabilities, flag this to the user and recommend using `hatch3r-feature-plan` for the new behavior, with the refactoring as a prerequisite.
