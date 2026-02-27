---
id: hatch3r-feature-plan
type: command
description: Plan a single feature in depth -- spawn parallel researchers, produce feature spec, ADR(s), and structured todo.md entries for board-fill.
---
# Feature Plan — Single Feature Specification from Idea to Board-Ready Epic

Take a single feature idea and produce a complete feature specification (`docs/specs/`), architectural decision records (`docs/adr/`) when needed, and structured `todo.md` entries (epic + sub-items) ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (codebase impact, feature design, architecture, risk & pitfalls) to analyze the feature from multiple angles before generating artifacts. AI proposes all outputs; user confirms before any files are written. Optionally chains into `hatch3r-board-fill` to create GitHub issues immediately.

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

**ASK:** "Does this capture the feature correctly? Adjust anything before I send this to the research phase."

---

### Step 2: Load Project Context

1. Check for existing documentation:
   - `docs/specs/` — project specifications (read TOC/headers first, expand relevant sections only)
   - `docs/adr/` — architectural decision records (scan for decisions relevant to the feature area)
   - `README.md` — project overview
   - `/.agents/hatch.json` — board configuration
   - Existing `todo.md` — current backlog (check for overlap or related items)
2. Scan GitHub issues via `search_issues` for existing work related to the feature. Note duplicates or partial overlaps.
3. If `/.agents/learnings/` exists, scan for learnings relevant to the feature area. Match by area and tags against the feature brief.
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
- The project context summary from Step 2
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `deep`

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `codebase-impact` | Map affected files, modules, integration points, coupling, and existing patterns |
| 2 | `feature-design` | Break down into sub-tasks, user stories, acceptance criteria, edge cases, effort |
| 3 | `architecture` | Data model, API contracts, component design, ADR candidates, dependencies |
| 4 | `risk-assessment` | Technical risks, security, performance, breaking changes, common pitfalls |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Research Summary:

Feature:          {name}
Affected files:   {N} files across {M} modules
Sub-tasks:        {N} tasks ({X} parallelizable)
Effort:           {total estimate}
ADRs needed:      {N} architectural decisions
Risks:            {N} risks ({X} high, {Y} med, {Z} low)
Breaking changes: {N} ({list if any})
Priority:         {recommended P-level}
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

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `/.agents/hatch.json` exists, proceed without board context — this command does not require board configuration.
- **No existing specs or docs:** Proceed without spec references. Warn that the feature spec will be less contextualized without existing project documentation. Recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` first for best results.
- **Duplicate detection:** If the feature overlaps significantly with existing todo.md items or GitHub issues found in Step 2, present the overlap and ASK whether to proceed (augment existing / replace / abort).

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Stay within the feature scope** defined by the user in Step 1. Do not invent sub-features the user did not describe or imply. Flag scope expansion opportunities but do not act on them without explicit approval.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source specs.
- **ADRs use the same format as `hatch3r-project-spec`** — Status, Date, Context, Decision, Alternatives, Consequences.
- **Feature spec must reference existing glossary IDs** where a glossary exists. Do not create conflicting stable IDs.
- **Do not over-specify.** Keep the spec at the right level of detail for board-fill to create actionable issues. Avoid implementation details that belong in code.
- **All 4 researchers must complete before proceeding to Step 4.** Do not generate specs from partial research.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
