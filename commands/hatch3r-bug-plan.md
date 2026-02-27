---
id: hatch3r-bug-plan
type: command
description: Plan a complex bug investigation -- spawn parallel researchers, produce diagnosis report with ranked hypotheses and structured todo.md entries for board-fill.
---
# Bug Plan — Complex Bug Investigation from Symptom to Board-Ready Fix Items

Take a complex or ambiguous bug report and produce a structured investigation report (`docs/investigations/`), architectural decision records (`docs/adr/`) when the fix requires significant design choices, and structured `todo.md` entries (scoped fix items) ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (symptom tracing, root cause investigation, impact assessment, regression research) to diagnose the bug from multiple angles before generating artifacts. AI proposes all outputs; user confirms before any files are written. Optionally chains into `hatch3r-board-fill` to create GitHub issues immediately.

**When to use this command vs. the `hatch3r-bug-fix` skill:**

- Use `hatch3r-bug-plan` when: root cause is unknown, multiple modules might be involved, reproducing is non-trivial, the bug has been lingering, or the fix may require phased work across multiple PRs.
- Use `hatch3r-bug-fix` skill directly when: root cause is clear, fix is localized, reproduction steps exist.

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

### Step 1: Gather Bug Report

1. **ASK:** "Tell me about the bug you want to investigate. I need:
   - **Bug title** (short descriptive name)
   - **Symptoms** (what is the user experiencing? what goes wrong?)
   - **Expected behavior** (what should happen instead?)
   - **Reproduction context** (when does it happen? intermittent or consistent? environment-specific?)
   - **Severity / urgency** (how bad is this? who is affected? data loss risk?)
   - **What has been tried** (any prior debugging attempts, hypotheses, or partial fixes?)

   You can also point me to an existing GitHub issue, error log, or incident report and I'll extract these from it."

2. If the user provides a document reference, issue, or error log, read it and extract the six fields above.
3. Present a structured summary:

```
Bug Brief:
  Title:            {title}
  Symptoms:         {what goes wrong, from the user's perspective}
  Expected:         {what should happen}
  Reproduction:     {when, how often, environment details}
  Severity:         {Critical/High/Med/Low — with impact description}
  Prior attempts:   {what has been tried, or "none"}
```

**ASK:** "Does this capture the bug correctly? Adjust anything before I send this to the research phase."

---

### Step 2: Load Project Context

1. Check for existing documentation:
   - `docs/specs/` — project specifications (read TOC/headers first, expand relevant sections only)
   - `docs/adr/` — architectural decision records (scan for decisions relevant to the affected area)
   - `docs/investigations/` — prior investigation reports (check for related or recurring bugs)
   - `README.md` — project overview
   - `/.agents/hatch.json` — board configuration
   - Existing `todo.md` — current backlog (check for overlap or related items)
2. Scan GitHub issues via `search_issues` for existing work related to the bug. Note duplicates, related bugs, or prior investigations.
3. If `/.agents/learnings/` exists, scan for learnings relevant to the affected area. Match by area and tags against the bug brief.
4. Present a context summary:

```
Context Loaded:
  Specs:              {N} files in docs/specs/ ({relevant ones listed})
  ADRs:               {N} files in docs/adr/ ({relevant ones listed})
  Prior investigations: {N} in docs/investigations/ ({related ones listed})
  Existing todo.md:   {found with N items / not found}
  Related issues:     {N} open issues with overlap ({list issue numbers})
  Learnings:          {N} relevant learnings ({areas})
  Gaps:               {list any missing context}
```

**ASK:** "Here is the context I loaded. Provide additional context — error logs, stack traces, affected versions, environment details? (or confirm to proceed)"

---

### Step 3: Spawn Parallel Researcher Sub-Agents

Spawn one sub-agent per research domain below concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed bug brief from Step 1 and the context summary from Step 2.

**Each sub-agent prompt must include:**
- The full confirmed bug brief
- The project context summary from Step 2
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `deep`

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `symptom-trace` | Trace execution path from user action to failure, identify divergence point |
| 2 | `root-cause` | Rank hypotheses by likelihood, identify code smells, analyze dependencies |
| 3 | `impact-analysis` | Map blast radius, affected flows/modules, data integrity risk, related symptoms |
| 4 | `regression` | Analyze git history, dependency changes, identify introduction window |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Investigation Summary:

Bug:                {title}
Top hypothesis:     {rank 1 from root cause investigator}
Confidence:         {High/Med/Low}
Affected flows:     {N} flows across {M} modules
Data integrity risk: {Yes — details / No}
Related issues:     {N} potentially related ({list issue numbers})
Likely introduced:  {time window from regression researcher}
Fix complexity:     {S/M/L/XL — based on scope of changes needed}
Severity:           {Critical/High/Med/Low}
```

2. **Highlight conflicts** between researchers. Common conflict types:
   - Symptom tracer points to module A, but root cause investigator's top hypothesis is in module B
   - Impact assessor flags critical data risk, but regression researcher finds no recent changes in that area
   - Multiple hypotheses with similar likelihood — no clear winner

3. For each conflict, present both sides and a recommended resolution.

4. Present the **ranked hypothesis list** from the root cause investigator with supporting/contradicting evidence from other researchers.

**ASK:** "Here is the merged investigation summary. Conflicts (if any) are highlighted above. Options:
- **Confirm** to proceed with investigation report and todo generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher with updated parameters
- **Narrow scope** to focus on the top hypothesis only"

---

### Step 5: Generate Investigation Report

From the merged researcher outputs, generate an investigation report. Present all content for review before writing any files.

#### Investigation Report — `docs/investigations/{NN}_{bug-slug}.md`

Determine the next sequential number by scanning existing files in `docs/investigations/`. Use slugified bug title (lowercase, hyphens). Create the `docs/investigations/` directory if it does not exist.

```markdown
# Investigation: {Bug Title}

## Status

Open

## Date

{today's date}

## Bug Brief

| Field | Value |
|-------|-------|
| Title | {title} |
| Severity | {level} |
| Symptoms | {description} |
| Expected behavior | {description} |
| Reproduction | {context} |
| Likely introduced | {time window} |

## Executive Summary

{2-3 sentences summarizing the investigation findings, top hypothesis, and recommended fix approach}

## Symptom Trace

{From symptom tracer — execution path, divergence point, error propagation}

## Root Cause Analysis

### Hypotheses

| Rank | Hypothesis | Likelihood | Evidence | Verification |
|------|-----------|-----------|----------|-------------|
| 1 | {hypothesis} | {level} | {evidence} | {strategy} |

### Recommended Investigation Order
{From root cause investigator — ordered list of what to verify first}

## Impact Assessment

### Blast Radius
| Area | Impact | Severity |
|------|--------|----------|
| {area} | {how affected} | {level} |

### Data Integrity Risk
{From impact assessor — risk assessment and recovery strategies}

### Related Issues
{From impact assessor — related symptoms and shared root causes}

## Regression Analysis

### Most Likely Introduction Window
{From regression researcher — when, what changed, confidence level}

### Key Changes
{From regression researcher — timeline of suspicious changes}

## Reproduction Strategy

{Synthesized from all researchers — step-by-step approach to reproduce the bug in a test or development environment}

1. {step}
2. {step}
3. {expected failure point}

## Recommended Fix Approach

{Synthesized recommendation — which hypothesis to pursue, what to fix, in what order}

### Fix Phases
| Phase | What to Fix | Files | Hypothesis Addressed | Risk |
|-------|-----------|-------|---------------------|------|
| 1 | {immediate fix} | {files} | #{rank} | {risk} |
| 2 | {follow-up hardening} | {files} | #{rank} | {risk} |

### Safeguards
- {regression test to add}
- {monitoring or alerting to add}
- {defensive code patterns to apply}

---

**Investigated by:** AI researcher sub-agents
**Last updated:** {today's date}
```

**ASK:** "Here is the generated investigation report. Review the content before I write the file:
- `{NN}_{bug-slug}.md` — {hypothesis count} hypotheses, severity {level}, {affected area count} areas affected

Confirm, or tell me what to adjust."

---

### Step 6: Generate ADR(s) (If Applicable)

Only proceed if the fix requires significant architectural decisions — for example, replacing an error-prone pattern across the codebase, introducing a new resilience mechanism, or changing a data model to prevent recurrence. Most bug investigations will NOT need ADRs.

If ADRs are needed, generate them following the same format as `hatch3r-feature-plan` Step 6.

#### ADR Format — `docs/adr/{NNNN}_{decision-slug}.md`

Determine the next sequential number by scanning existing files in `docs/adr/`. Use slugified decision titles.

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Context

{Why this decision is needed — the bug revealed a systemic issue that requires an architectural response, not just a point fix}

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

- Investigation report: `docs/investigations/{NN}_{bug-slug}.md`
```

If no ADRs are needed, state so and skip to Step 7.

**ASK** (only if ADRs generated): "Here are {N} ADR(s) generated from the investigation. Review before I write the files:
{list with titles}

Confirm, or tell me what to adjust."

---

### Step 7: Generate todo.md Entries

From the investigation report's fix phases and the synthesized research, generate structured `todo.md` entries in the format that `hatch3r-board-fill` expects.

#### Entry Structure

For multi-phase fixes, one **investigation-level entry** followed by **individual fix phase entries**:

```markdown
- [ ] **{Bug title} investigation & fix epic**: {Summary of bug, top hypothesis, fix phases}. Ref: docs/investigations/{NN}_{bug-slug}.md.
- [ ] **{Fix phase 1 title}**: {Description — what to fix, which hypothesis it addresses, acceptance criteria}. Ref: docs/investigations/{NN}_{bug-slug}.md.
- [ ] **{Fix phase 2 title}**: {Description — follow-up hardening, regression tests, monitoring}. Ref: docs/investigations/{NN}_{bug-slug}.md.
```

For simple bugs where the investigation revealed a single clear fix, produce a single standalone entry:

```markdown
- [ ] **Fix: {Bug title}**: {Root cause, fix approach, acceptance criteria}. Ref: docs/investigations/{NN}_{bug-slug}.md.
```

#### Placement

Use severity to determine priority: Critical/High bugs → P1, Medium → P2, Low → P3. Place entries under the matching `## P{N} — {Label}` header.

#### If `todo.md` Already Exists

**ASK:** "todo.md already exists with {N} items. How should I add the new entries?
- **(a) Append** under the appropriate priority header
- **(b) Merge** — deduplicate against existing items and reorganize
- **(c) Show me the entries** and I'll place them manually"

#### If `todo.md` Does Not Exist

Create a new `todo.md` with the appropriate priority header and the new entries.

Present the drafted entries for review.

**ASK:** "Here are the todo.md entries for this bug ({N} items). Review before I write:

{entries}

Confirm, or tell me what to adjust."

---

### Step 8: Write All Files

After all content is confirmed:

1. Write the investigation report to `docs/investigations/{NN}_{bug-slug}.md`. Create the `docs/investigations/` directory if it does not exist.
2. Write ADR(s) to `docs/adr/{NNNN}_{decision-slug}.md` (if any). Create the `docs/adr/` directory if it does not exist.
3. Write or update `todo.md` at the project root.
4. Present a summary of all files created or modified:

```
Files Created/Updated:
  docs/investigations/
    {NN}_{bug-slug}.md         — {hypothesis count} hypotheses, severity {level}
  docs/adr/
    {NNNN}_{decision}.md       — {decision title}  (if applicable)
  todo.md                       — {N} entries added ({1} epic + {M} fix phases)
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
- **No existing specs or docs:** Proceed without spec references. Warn that the investigation will be less contextualized without existing project documentation. Recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` first for best results.
- **Duplicate detection:** If the bug overlaps significantly with existing todo.md items, GitHub issues, or prior investigation reports found in Step 2, present the overlap and ASK whether to proceed (augment existing / replace / abort).
- **No clear root cause:** If all hypotheses are low-confidence, state this clearly. Recommend a focused debugging session (using `hatch3r-bug-fix` skill with the top hypothesis) rather than generating speculative fix items. ASK the user how to proceed.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Stay within the bug scope** defined by the user in Step 1. Do not expand the investigation into general code quality issues unless they are directly related to the bug. Flag tangential findings but do not act on them without explicit approval.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source investigation reports.
- **ADRs use the same format as `hatch3r-project-spec`** — Status, Date, Context, Decision, Alternatives, Consequences.
- **Hypotheses must be evidence-based.** Every hypothesis must cite specific code, patterns, or conditions as evidence. Do not generate speculative hypotheses without codebase support.
- **Do not over-scope fixes.** Each todo.md entry should target a specific hypothesis or fix phase. Avoid bundling unrelated improvements into bug fix items.
- **All 4 researchers must complete before proceeding to Step 4.** Do not generate reports from partial research.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
- **Distinguish fixes from improvements.** If the investigation reveals that the "bug" is actually expected behavior or a missing feature, flag this to the user and recommend using `hatch3r-feature-plan` instead.
