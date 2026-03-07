---
id: hatch3r-board-fill
type: command
description: Create epics and issues/work items from todo.md, reorganize the board with dependency analysis, readiness assessment, and implementation ordering. Supports GitHub, Azure DevOps, and GitLab.
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context Gathering | Explore sub-agents (codebase exploration) | Yes | When application context needed |
| 2. Issue Creation | Orchestrator (inline, GitHub MCP) | No | Yes |
| 3. Board Sync | Orchestrator (Projects v2 sync) | No | Yes |

All issue operations MUST follow the Board Sync Enforcement rules defined in `hatch3r-board-shared`.

# Board Fill -- Create Epics & Issues from todo.md + Board Reorganization

Create epics (with sub-issues) or standalone issues/work items from items in `todo.md`, using the platform's CLI and MCP tools against **{owner}/{repo}** (read from `.agents/hatch.json` board config). The `platform` field determines whether to use GitHub Issues, Azure DevOps Work Items, or GitLab Issues. Before creating anything, board-fill **triages each item through interactive questioning** to extract scope, intent, unknowns, and acceptance criteria from the user -- ensuring issues are genuinely ready for implementation, not just structurally complete. On every run, board-fill also performs a **full board reorganization**: grouping standalone issues into epics, decomposing oversized items, analyzing dependencies, setting implementation order, identifying parallel work, and marking issues as `status:ready` when all readiness criteria (structural + substantive) are met. AI proposes groupings, dependencies, and ordering; user confirms before anything is created or updated. Duplicate topics are detected and skipped.

---

## Integration with GitHub Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above GitHub Agentic Workflows. While GitHub's agentic workflows handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-groom** refines existing work items as priorities, scope, and dependencies evolve over time
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide

For ongoing refinement of existing board items (re-prioritization, reclassification, re-scoping, archiving stale items, dependency cleanup), use `hatch3r-board-groom` instead of re-running board-fill.

GitHub Agentic Workflows and hatch3r are complementary: use agentic workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Read and Parse todo.md

1. Read `todo.md` at the project root.
2. Parse each non-empty line as a separate todo item. Strip leading `- ` or `* ` markers.
3. Present the parsed list numbered.

**ASK:** "Here are the items I found in todo.md. Which items should I process? (all / specific numbers / exclude specific numbers)"

#### 1a. Product Vision Input (Optional)

1. Check if a product vision document exists at `.agents/product-vision.md`.
2. If found, read and cache the vision document for use in Steps 2.5 and 4.
3. If not found, check whether the user provided a vision statement inline with the board-fill invocation (e.g., as a quoted string or file path argument).
4. If a vision is available from either source, note: "Product vision loaded — will use for triage context and issue scoping."
5. If no vision is available, proceed without it. Do not prompt the user for one.

---

### Step 1.5: Full Board Scan

Scan the entire board to build an inventory of all existing work. This scan feeds into all subsequent steps. **Cache everything retrieved here.**

1. **Platform-specific: Fetch all open issues/work items**

   **If platform is `github`:**
   - Fetch ALL open issues using `gh issue list -R {owner}/{repo} --state open --limit 500 --json number,title,labels,state,createdAt,updatedAt,body` (fall back to `list_issues` MCP with `owner: {board.owner}`, `repo: {board.repo}`, `state: OPEN`). Paginate to retrieve every issue.

   **If platform is `azure-devops`:**
   - Fetch ALL active work items: `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT [System.Id], [System.Title], [System.State], [System.Tags], [System.CreatedDate], [System.ChangedDate] FROM WorkItems WHERE [System.State] <> 'Closed' AND [System.State] <> 'Removed'"` (fall back to `list_work_items` MCP).

   **If platform is `gitlab`:**
   - Fetch ALL open issues: `glab issue list -R {namespace}/{project} --state opened --per-page 100` (paginate to retrieve all).

   **Exclude** any issue/work item with the `meta:board-overview` label/tag from all subsequent processing.

2. For each issue, fetch labels and check for sub-issues:
   - **GitHub:** `issue_read` with `method: get_labels` and `method: get_sub_issues`.
   - **Azure DevOps:** Tags from `System.Tags` field; parent-child relations via `az boards work-item relation list --id N`.
   - **GitLab:** Labels from issue data; related issues via `glab api projects/{project_id}/issues/{N}/links`.
3. Categorize every open issue:
   - **Epic** -- has sub-issues
   - **Sub-issue** -- is a child of an epic
   - **Standalone** -- neither parent nor child
4. For each issue, note presence of: `has-dependencies` label, `## Dependencies` section, required labels (`type:*`, `priority:*`, `area:*`, `executor:*`), acceptance criteria, documentation references, `## Implementation Order` (epics only).
5. Present a board health summary:

```
Board Health:
  Total open issues: N (X epics, Y sub-issues, Z standalone)
  Missing dependency metadata: #N, #M ...
  Missing required labels: #N — no priority, no area ...
  Potential epic grouping candidates: #N + #M (shared theme) ...
```

**ASK:** "Here is the current board state. I will process the selected todo.md items AND reorganize existing issues. Before I continue: are there any items on the board that are stale, misprioritized, or missing context I should know about? Continue?"

---

### Step 2: Duplicate Detection

#### 2a. New Items vs. Existing Board

For each selected todo item:

1. **Platform-specific: Search for existing matches**
   - **GitHub:** `gh search issues -R {owner}/{repo} "{keywords}"` (fall back to `search_issues` MCP).
   - **Azure DevOps:** `az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '{keywords}'"` (fall back to `search_work_items` MCP).
   - **GitLab:** `glab issue list -R {namespace}/{project} --search "{keywords}"`.
2. Compare against cached board inventory semantically.
3. Classify: **Duplicate** / **Partial overlap** / **No match**.

Present findings in a table and ask.

**ASK:** "These items appear already covered. Skip / create anyway / add as sub-issue? For partial overlaps, create new or link?"

#### 2b. Existing Board Cross-Deduplication

Compare existing open issues pairwise for semantic duplicates. Present any findings.

**ASK (only if duplicates found):** "These existing issues overlap. Merge / keep both / convert one to sub-issue?"

---

### Step 2.5: Item-Level Triage Questioning

Before classifying items, extract the information needed to produce genuinely ready issues. Todo items are often terse one-liners; this step surfaces the user's actual intent, scope, and constraints that the AI cannot infer.

#### Vision-Aware Triage (Conditional)

If a product vision was loaded in Step 1a, apply these modifications to the triage process:

1. **Derive context from the vision first.** For each triage dimension (Scope, Value, Unknowns, Size, Stakeholder), check whether the product vision document provides clear answers. Extract relevant goals, user segments, success metrics, and stated priorities from the vision.
2. **Reduce questioning.** Only ask triage questions for dimensions that the vision does not clearly address. If the vision states the target user, value proposition, and scope boundaries for an item's domain, mark those dimensions as "Clear (from vision)" and skip the corresponding questions.
3. **Reference vision goals explicitly.** When classifying items or asking remaining triage questions, cite the specific vision goal or statement that informs the classification (e.g., "Per the product vision goal 'Zero-config onboarding', this item aligns with...").
4. **Greenfield streamlining.** For greenfield projects where the vision covers all major work areas, batch all items into a single triage pass. Present the vision-derived context for each item and ask the user to confirm or override in one prompt rather than per-item questioning.

If no product vision is available, proceed with the full triage process below.

#### 2.5a. Assess Clarity

For each remaining item, score its clarity across six dimensions:

| Dimension              | What to check                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **Scope / Definition** | Does the item describe what "done" looks like? Are boundaries (in/out of scope) clear?                |
| **Value / Why**        | Is the motivation stated? Can you articulate the user problem it solves?                              |
| **Unknowns / Spikes**  | Are there open design decisions, research questions, or unvalidated assumptions?                      |
| **External Blockers**  | Might there be dependencies on external teams, services, approvals, or resources invisible to the AI? |
| **Size / Decomposition** | Could the item reasonably be a single issue, or does it span multiple deliverables?                 |
| **User / Stakeholder** | Is the affected user or stakeholder identifiable? Is the current workaround known?                    |

Categorize each item into a confidence tier:

- **Clear** -- all dimensions answered by the todo text, linked docs, or codebase context. Skip questioning for this item.
- **Ambiguous** -- 1-2 dimensions unclear. Ask targeted questions for the specific gaps.
- **Vague** -- 3+ dimensions unclear. Deep probing required across multiple dimensions.

#### 2.5b. Triage by Theme

Batch items that share a theme (same area, feature domain, or epic grouping candidate) and triage them together. This avoids repetitive questions and lets the user provide shared context once.

For each batch, present the items and their clarity assessment, then ask **only about the unclear dimensions**. Do not ask questions the todo text already answers.

**Question templates by dimension** (adapt to context, do not use verbatim):

- **Scope / Definition:** "What does 'done' look like for [item]? What's explicitly out of scope? Is there an MVP slice vs. a full version?"
- **Value / Why:** "Why is this important now? What user problem does it solve? What's the cost of deferring?"
- **Unknowns / Spikes:** "Are there open questions or design decisions that need resolving first? Should we create a spike/research issue before the implementation issue?"
- **External Blockers:** "Are there dependencies on external teams, services, environments, approvals, or resources I can't see from the codebase?"
- **Size / Decomposition:** "This seems like it could be multiple deliverables. Should we break it down? What's the smallest shippable increment?"
- **User / Stakeholder:** "Who is primarily affected? What's their current workaround (if any)?"

**ASK:** Present the clarity assessment table and triage questions per batch. Example:

```
Triage — Distribution & Growth items:

| # | Item                     | Clarity | Gaps                          |
|---|--------------------------|---------|-------------------------------|
| 1 | Documentation site       | Vague   | Scope, Size, Unknowns         |
| 2 | Claude Code plugin       | Ambiguous | Scope                       |
| 3 | Landing page             | Ambiguous | Value, Scope                |

Questions:
1. Documentation site: What pages/sections are essential for v1? Is this a full static site (Docusaurus/etc.) or a README expansion? Are there content gaps that need authoring vs. sections that can be auto-generated from existing docs?
2. Claude Code plugin: What does "package for marketplace" entail beyond what's already built? Any marketplace-specific requirements you're aware of?
3. Landing page: What's the primary conversion goal (GitHub stars, installs, sign-ups)? Is there existing copy/branding to work from?
```

#### 2.5c. Capture Structured Triage Context

Store the user's answers as **Triage Context** for each item. This context feeds into all subsequent steps:

- **Step 3** uses it for classification (priority from stated urgency, risk from stated unknowns, executor from stated complexity).
- **Step 4** uses it to guide codebase exploration and documentation reads toward areas the user highlighted.
- **Step 5** uses it for grouping and decomposition decisions.
- **Step 5.6** uses it to validate readiness substantively.
- **Step 6** uses it to draft acceptance criteria grounded in the user's actual requirements.

Format per item (internal, not shown to user):

```
Item: {original todo text}
Scope: {user's stated scope / definition of done}
Value: {user's stated motivation / user problem}
Unknowns: {open questions, spike needs} or "None"
External Blockers: {stated blockers} or "None"
Decomposition: {user's stated breakdown / MVP slice} or "Single issue"
Stakeholder: {affected user / workaround} or "Not specified"
```

If the user declines to answer a dimension ("skip", "not sure", "figure it out"), record that explicitly. These unresolved dimensions become readiness gaps in Step 5.6.

---

### Step 3: Issue Type & Executor Classification

For each remaining item, classify across all dimensions using the mapping tables below **combined with Triage Context from Step 2.5**. Triage answers take precedence over keyword heuristics when they conflict.

**Type:**

| Signal                          | Type             | Label                       |
| ------------------------------- | ---------------- | --------------------------- |
| bug, broken, not working, fix   | Bug Report       | `type:bug`                  |
| add, implement, create, new     | Feature Request  | `type:feature`              |
| refactor, simplify, clean up    | Code Refactor    | `type:refactor`             |
| rework flow, change behavior    | Logical Refactor | `type:refactor`             |
| UI, visual, layout, dark mode   | Visual Refactor  | `type:refactor` + `area:ui` |
| test, QA, validate              | QA Validation    | `type:qa`                   |
| docs, document, README          | Documentation    | `type:docs`                 |
| CI, CD, pipeline, deploy, infra | Infrastructure   | `type:infra`                |

If the user flagged unresolved unknowns or research needs in triage, consider whether the item (or part of it) should be a **spike** sub-issue (`type:spike`) that produces a decision/design before the implementation issue can be created. Present spike candidates explicitly.

**Executor:** `executor:agent` (clear criteria, bounded scope) / `executor:human` (decisions, infra, external setup) / `executor:hybrid` (agent implements after human direction). Use triage context: if the user stated the item requires decisions, external coordination, or judgment calls, lean toward `executor:human` or `executor:hybrid` regardless of keyword signals.

**Priority:** `priority:p0` (critical/security) / `priority:p1` (broken, no workaround) / `priority:p2` (degraded, default) / `priority:p3` (cosmetic, nice-to-have). Use the user's stated urgency and impact from triage (Value/Why answers) to override keyword defaults. Default `p2` only when both the todo text AND triage answers are ambiguous; security defaults to `p1`+.

**Area:** Read area labels from `board.areas` in `.agents/hatch.json`. If the list is empty, infer areas from the repository's directory structure. Assign all relevant area labels.

**Risk:** `risk:low` (isolated, easy rollback) / `risk:med` (shared modules, moderate scope) / `risk:high` (architectural, security-critical). Incorporate triage context: if the user surfaced unknowns, external dependencies, or broad blast radius, escalate risk accordingly. Items with unresolved spikes default to `risk:med`+.

Present the full classification table with all label categories. Flag any items where triage answers shifted the classification away from what keyword signals alone would suggest.

**ASK:** "Confirm or adjust the type, executor, priority, area, and risk for any item. For items flagged as potential spikes, confirm whether to create a spike sub-issue or proceed directly to implementation."

---

### Step 4: Retrieve Application Context

#### 4a. Project Documentation

1. Read project documentation relevant to the areas touched by the todo items (e.g., specs, ADRs, design docs).
2. Prefer reading TOC/headers first (first ~30 lines), then expand only relevant sections. Do NOT read full document bodies unless necessary.
3. Read ADRs or architectural documents if items touch architectural decisions.

#### 4b. Codebase Exploration

Use explore subagents or direct file reads to understand the current state of source areas touched by the todo items.

#### 4b.5. Consult Project Learnings

1. If `.agents/learnings/` exists, scan for learnings relevant to the areas touched by the todo items.
2. Match by `area` and `tags` in learning frontmatter against the area labels assigned in Step 3.
3. Surface relevant learnings in the Context Summary output:
   - **Pitfalls** for areas being touched (highest priority -- include specific warnings)
   - **Patterns** that could inform issue scoping or acceptance criteria
   - **Decisions** that constrain how issues should be approached
4. If no learnings directory exists, skip silently.

#### 4c. External Research (When Needed)

For items referencing external libraries, frameworks, or services not fully covered by local docs:

Follow the project's tooling hierarchy for external knowledge augmentation (Context7 MCP for library docs, web research for current events).

Skip if all items are purely internal (no external library involvement).

#### 4d. Product Vision Context (When Available)

If a product vision was loaded in Step 1a:

1. Include the product vision as **primary context** for issue scoping. Vision-stated goals, success metrics, target users, and scope boundaries take precedence over inferred context when drafting issue bodies and acceptance criteria.
2. Map each todo item to the specific vision goal(s) it supports. Include this mapping in the Context Summary output so that Steps 5 and 6 can reference it.
3. Flag any todo items that do not clearly map to a stated vision goal — these may represent scope creep or infrastructure work that supports the vision indirectly.

#### Output

Present a brief **Context Summary**: key constraints from documentation, current implementation state, external findings (if any), and product vision alignment (if vision is available).

---

### Step 5: Propose Grouping (Epics vs. Standalone)

**Grouping philosophy:** Minimize standalone issues to near-zero. Group aggressively into epics. Standalone only if topically isolated from every other issue AND substantial enough to stand alone.

#### 5a. Group New Items

1. **Absorb into existing epics first.**
2. **Form new epics** from 2+ items sharing any connection (area, subsystem, category).
3. **Adopt orphans** into broad thematic epics (e.g., "Security & Auth Hardening", "Infrastructure & Tooling").
4. **Standalone only as last resort.**

#### 5b. Regroup Existing Standalone Issues

Evaluate existing standalones for grouping into existing or new epics. Same aggressive philosophy.

#### 5c. Decomposition Check

After grouping, evaluate whether any individual item is too large to be a single issue. Use the Size/Decomposition answers from Triage Context (Step 2.5) and the following signals:

1. **User said to break down** -- the user explicitly stated the item spans multiple deliverables or suggested an MVP slice. Decompose into sub-issues per the user's guidance.
2. **Multiple areas touched** -- the item requires changes across 3+ distinct areas/subsystems. Split along area boundaries.
3. **Multiple acceptance criteria clusters** -- if the item's likely acceptance criteria fall into distinct, independently shippable groups, split into one issue per group.
4. **Ambiguous scope with no user clarification** -- if scope was flagged as unclear in triage and the user declined to narrow it, flag the item as needing further breakdown and propose a decomposition.

For each item flagged for decomposition, propose specific sub-issues with one-line descriptions. Items already grouped into an epic become sub-issues of that epic; standalone items that decompose become a new epic with sub-issues.

Present grouping proposals (from 5a + 5b) and decomposition proposals (from 5c) together.

**ASK:** "Confirm grouping and decomposition, or: move items between groups / merge-split epics / convert epic↔standalone / reject decomposition / reject existing regrouping. Are there items here that still feel too large for a single issue?"

---

### Step 5.5: Dependency Analysis & Implementation Order

> **Note on `status:blocked`:** Do NOT mark dependency-blocked issues as `status:blocked`. Reserve `status:blocked` for external blockers only.

#### 5.5a. Infer Dependencies

For every open issue, determine blocking relationships using:

1. Explicit references ("Depends on", "Blocked by", "After #N").
2. Semantic analysis (A creates what B consumes → A blocks B).
3. Epic internal ordering.
4. Area overlap -- use **soft** dependencies (`Recommended after #N`) for issues that share `area:*` labels but have no true producer/consumer relationship. Soft dependencies advise sequential work to reduce merge conflicts but do not block pickup.
5. Cross-epic dependencies.

Write each dependency into the issue's `## Dependencies` section using the format defined in the Dependency Data Model (`hatch3r-board-shared`): `Blocked by #N` for hard, `Recommended after #N` for soft.

#### 5.5b. Build the Dependency DAG

Directed graph: nodes = issues, edges = "blocked by". Validate: no cycles, identify orphans. Compute topological ordering.

#### 5.5c. Determine Implementation Order

1. Within epics: topological order, then priority at same level. Mark parallel items.
2. Across board: interleave by priority at each topological depth.
3. Identify parallel lanes.

#### 5.5d. Present

Present the dependency graph, parallel groups, and implementation order by priority lane. Draft `## Dependencies` sections for each issue. For epics, derive `## Implementation Order` sections from the sub-issues' `## Dependencies` DAG (see Dependency Data Model in `hatch3r-board-shared`).

**ASK:** "Confirm or adjust dependencies and implementation order. Are there dependencies I can't see from the code -- external teams, environments, approvals, or sequencing constraints?"

---

### Step 5.6: Readiness Assessment

#### Readiness Criteria

Every issue must pass both **structural** and **substantive** criteria before it can be marked `status:ready`.

**Structural criteria (all must hold):**

1. `## Dependencies` section present.
2. Issue appears in an `## Implementation Order` section or has a global position.
3. All required labels: one `type:*`, one `priority:*`, 1+ `area:*`, one `executor:*`, one `risk:*`.
4. Acceptance criteria present.
5. Issue body follows template structure.

**Substantive criteria (all must hold):**

6. **Acceptance criteria are specific and testable** -- each criterion describes a verifiable outcome an implementer can confirm. Reject vague criteria (e.g., "Documentation is complete") in favor of measurable ones (e.g., "Getting-started guide covers install, first-run, and deployment with working code examples").
7. **Scope is bounded** -- the issue body defines what is explicitly out of scope, or states "No scope exclusions." An issue with unbounded scope is not ready.
8. **No unresolved unknowns** -- if Triage Context (Step 2.5) surfaced open questions or spike needs for this item, they must be resolved (user answered them) or a spike sub-issue must exist to address them before implementation begins. Items with recorded "not sure" / unanswered dimensions that affect implementability are not ready.
9. **Effort is estimable** -- the issue is scoped narrowly enough that a developer could reasonably estimate it. If the issue is too vague or too large to estimate, it needs further decomposition or clarification.

#### Process

Evaluate each open issue at `status:triage`. Do not downgrade issues already at `status:ready`/`in-progress`/`in-review`.

1. **Classify:** For each `status:triage` issue, check all readiness criteria (structural + substantive). Classify as Ready (all met) or Not Ready (list specific gaps).
2. **Resolve gaps:**
   - **Structural gaps -- resolve inline:** Missing labels, missing `## Dependencies`, missing implementation order position, or body not following template can be inferred and applied by the AI (same as before).
   - **Substantive gaps -- ask the user:** Vague acceptance criteria, unbounded scope, unresolved unknowns, and non-estimable effort cannot be reliably resolved by the AI alone. For each substantive gap, ask the user for the missing information. Do not fabricate scope boundaries, acceptance criteria precision, or spike resolutions.
   - **Missing labels:** Infer from issue content, codebase context, and classification tables in Step 3. Apply the inferred labels.
   - **Missing `## Dependencies` section:** Infer from the dependency DAG built in Step 5.5. Write the section (use `None` if the issue has no blockers).
   - **Missing acceptance criteria:** Draft from Triage Context answers (Step 2.5), issue body, and codebase context. If triage answers are insufficient, ask the user.
   - **Missing implementation order position:** Assign based on the topological ordering from Step 5.5.
   - **Body does not follow template:** Restructure the body to match the template for its type (see Step 6).
3. **Present resolved gaps for confirmation:**

**ASK:** "I resolved the following gaps to bring issues to `status:ready`:

| Issue | Gap | Type | Resolution |
|-------|-----|------|------------|
| #N    | missing priority label | Structural | Inferred `priority:p2` (default, no urgency signals) |
| #M    | vague acceptance criteria | Substantive | Need your input -- what specifically must be true for this to be done? |
| #K    | unresolved unknowns | Substantive | Triage flagged open questions: [list]. Create spike sub-issue, or can you answer now? |
| ...   | ... | ... | ... |

For substantive gaps marked 'Need your input', please provide the missing information. Confirm or adjust structural resolutions."

4. **Re-evaluate:** After user confirmation/adjustment, re-check all criteria. If any issue still has gaps (e.g., user rejected a resolution without providing an alternative), ask for the specific missing information and repeat from step 2. **Do not proceed until every `status:triage` issue meets all readiness criteria (structural + substantive).**
5. **Mark ready:** Once all criteria are met, mark all evaluated issues `status:ready`.

---

### Step 6: Refine Issue Content

Issue bodies must follow the structure for their type. Use this condensed reference:

| Type                           | Body sections                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Bug Report                     | Summary, Steps to Reproduce, Expected/Actual Behavior, Acceptance Criteria, Scope, References, Dependencies |
| Feature Request                | Summary, Motivation, Proposed Solution, Acceptance Criteria, Scope, References, Dependencies               |
| Code/Logical/Visual Refactor   | Summary, Current State, Proposed Change, Acceptance Criteria, Scope, References, Dependencies              |
| QA Validation                  | Summary, Test Scope, Pass/Fail Criteria, Coverage Targets, Scope, Dependencies                             |
| Documentation / Infrastructure | Use Feature Request structure                                                                             |

**Epics** get: Overview (2-3 sentences), Sub-issues checklist, Acceptance criteria ("done when all sub-issues resolved"), all classified labels.

**Sub-issues** get: Problem/Goal, Acceptance criteria, Scope, Parent epic reference, all classified labels.

**Standalone** issues follow the sub-issue pattern without parent reference.

#### Acceptance Criteria Sourcing

Acceptance criteria must be grounded in the user's stated requirements, not AI inference from the todo text alone. Source AC in this priority order:

1. **Triage Context (Step 2.5)** -- the user's answers to Scope/Definition and Value/Why questions are the primary source. If the user stated what "done" looks like, translate that directly into testable criteria.
2. **User-stated edge cases or constraints** -- if the user mentioned failure modes, performance requirements, compatibility needs, or stakeholder expectations during triage, include them as criteria.
3. **Codebase context (Step 4)** -- existing tests, interfaces, contracts, and architectural patterns that constrain the implementation inform technical criteria.
4. **AI inference** -- only as a supplement for criteria the above sources don't cover. Flag AI-inferred criteria distinctly so the user can validate them.

Each acceptance criterion must be **specific and testable**: an implementer reading it can determine pass/fail without ambiguity. Prefer "API returns 400 with validation error for missing required fields" over "API validates input properly."

#### Scope Section

Every issue body (except epics) must include a `## Scope` section with:

- **In scope:** What this issue covers, derived from the user's triage answers.
- **Out of scope:** What this issue explicitly does not cover. Use the user's stated boundaries from triage, or "No exclusions" if the user confirmed the scope is self-evident.

#### Presenting Drafted Issues (Token-Efficient Two-Tier Format)

Do NOT render full issue bodies for every issue. Use this two-tier approach to minimize token output:

**Tier 1 -- Compact summary table (always shown):**

Present all drafted issues in a single table:

```
| # | Title | Type | Pri | AC | Scope (1-line) | Flags |
|---|-------|------|-----|----|----------------|-------|
| 1 | OAuth2 PKCE flow | feature | P1 | 4 | Auth module only | [2 inferred AC] |
| 2 | Fix rate limiter | bug | P0 | 2 | middleware | -- |
| 3 | Update API docs | docs | P3 | 3 | REST endpoints | -- |
```

Column definitions:

- **AC** = count of acceptance criteria for this issue
- **Scope (1-line)** = single phrase summarizing the scope boundary
- **Flags** = items needing user attention: `[N inferred AC]` (AI-inferred acceptance criteria that need validation), `[scope TBD]` (scope not yet bounded), `[spike needed]` (unresolved unknowns). Use `--` when no flags.

**Tier 2 -- Expand on demand (only when requested):**

After the table, present the ASK. Only render full issue bodies for the specific numbers the user requests. If no flags exist on any issue, the user may confirm without expanding.

**ASK:** "Here is the issue summary. Items flagged with [inferred AC] contain AI-drafted acceptance criteria that need your validation. Enter issue numbers to see full details (e.g., '1, 3'), or confirm to proceed with all as drafted."

---

### Step 7: Create & Update Issues via GitHub MCP

All issue operations in this command MUST follow the Board Sync Enforcement rules defined in `hatch3r-board-shared` and the **Batch Operations** directive. Every created/updated issue must be synced to the board immediately, with status, priority, and area fields populated.

#### 7-pre. Collect Batch Plan & Approve

Before executing any GitHub API calls, collect ALL planned operations into a single batch and get one user approval:

1. **Collect all creation operations** into a table, ordered by dependency (epics first, then sub-issues, then standalone):

```
| # | Title | Type | Labels | Epic Assignment | Status |
|---|-------|------|--------|-----------------|--------|
| 1 | {epic title} | Epic | {labels} | — | {status} |
| 2 | {sub-issue title} | Sub-issue | {labels} | → Epic #1 | {status} |
| 3 | {standalone title} | Standalone | {labels} | — | {status} |
```

2. **Collect all update operations** for existing issues (from Steps 5, 5.5, 5.6) into a second table:

```
| Issue # | Title | Updates |
|---------|-------|---------|
| #{N} | {title} | {add dependencies, regroup under epic, mark ready, etc.} |
```

3. **Collect all post-creation operations** (sub-issue linking, Projects v2 board sync) into a count summary:

```
Post-creation operations: {X} sub-issue links, {Y} board sync calls, {Z} status updates
```

**ASK:** "Here is the full batch of GitHub operations. {N} issues to create, {M} issues to update, {P} post-creation operations. Confirm to execute all, or adjust?"

After the user confirms, execute all operations in 7a–7b below **without additional per-item prompts**. Report progress inline (e.g., "Created #N... Linked sub-issue #M...").

#### 7a. Create New Issues

Execute in dependency order (parents before children). Do not prompt between operations — the batch was approved in 7-pre.

**Phase 1 — Create all issues/work items:**

**Platform-specific: Issue creation**

**If platform is `github`:**
1. **Epics first:** `gh issue create -R {owner}/{repo} --title "..." --body "..." --label "..."` (fall back to `issue_write` MCP with `method: create`). Include `## Dependencies` section and `has-dependencies` label. Record the returned `number` and internal numeric `id` field.
2. **Sub-issues:** Create each. Record the returned `number` and internal numeric `id` field.
3. **Standalone issues:** Create with `## Dependencies` and `has-dependencies`.

**If platform is `azure-devops`:**
1. **Epics first:** `az boards work-item create --org https://dev.azure.com/{namespace} --project {project} --type "Epic" --title "..." --description "..." --fields "System.Tags=has-dependencies"` (fall back to `create_work_item` MCP). Record the returned work item `id`.
2. **Sub-issues:** Create as User Stories or Tasks: `az boards work-item create --type "User Story" --title "..." --description "..."`. Record the returned `id`.
3. **Standalone issues:** Create as User Stories with `## Dependencies` and `has-dependencies` tag.

**If platform is `gitlab`:**
1. **Epics first:** `glab issue create -R {namespace}/{project} --title "..." --description "..." --label "has-dependencies"`. Record the returned issue number.
2. **Sub-issues:** Create each. Record the returned issue number.
3. **Standalone issues:** Create with `## Dependencies` and `has-dependencies` label.

**Phase 2 — Link sub-issues** (after all issues exist):

**If platform is `github`:**
For each sub-issue, link via `sub_issue_write` with `method: add` using the parent `issue_number` and child's internal numeric `id` (NOT the issue number or node_id).

**If platform is `azure-devops`:**
For each sub-issue, create a parent-child relation: `az boards work-item relation add --org https://dev.azure.com/{namespace} --id {child_id} --relation-type "System.LinkTypes.Hierarchy-Reverse" --target-id {parent_id}`.

**If platform is `gitlab`:**
For each sub-issue, add a related issue link: `glab api projects/{project_id}/issues/{parent_iid}/links --method POST --field target_project_id={project_id} --field target_issue_iid={child_iid}`. Also reference the parent in the sub-issue body.

**Phase 3 — Sync to board** (after all issues and links are created):

For each created issue, run the full **Board Sync Procedure** from `hatch3r-board-shared`. This adds the item to the board and sets the status to match the issue's `status:*` label (typically `status:ready` or `status:triage`).

#### 7b. Update Existing Issues (Board Reorganization)

For issues needing updates (from Steps 5, 5.5, 5.6):

1. **Add/update `## Dependencies`:** Read current body, append/replace section, update via platform CLI or MCP. Add `has-dependencies` label/tag.
   - **GitHub:** `gh issue edit N --body "..."` or `issue_write` MCP.
   - **Azure DevOps:** `az boards work-item update --id N --description "..."`.
   - **GitLab:** `glab issue update N --description "..."`.
2. **Regenerate `## Implementation Order`** (epics only): Derive from the sub-issues' `## Dependencies` DAG (see Dependency Data Model in `hatch3r-board-shared`). Replace the existing section entirely -- do not manually edit it.
3. **Apply epic regrouping:** Link standalones to epics.
   - **GitHub:** `sub_issue_write` MCP. Update epic body.
   - **Azure DevOps:** `az boards work-item relation add` with parent-child relation.
   - **GitLab:** `glab api` issue links endpoint. Update epic body.
4. **Mark `status:ready`:** Remove `status:triage`, add `status:ready`. Do not downgrade existing statuses.
   - **GitHub:** `gh issue edit N --remove-label "status:triage" --add-label "status:ready"`.
   - **Azure DevOps:** `az boards work-item update --id N --state "Active" --fields "System.Tags=+status:ready;-status:triage"`.
   - **GitLab:** `glab issue update N --unlabel "status::triage" --label "status::ready"`.
5. **Add missing labels/tags** if user opted to fill gaps.
6. **Sync Board Status:** For each issue whose status was set or changed in this run, run the full **Board Sync Procedure** from `hatch3r-board-shared`. This ensures the board view matches the label. Skip issues already synced in Phase 3.

#### 7c. Present Summary

```
New Issues Created:
| Type | Title | Issue # | Executor | Parent | Status |

Existing Issues Updated:
| Issue # | Title | Updates Applied |

Board Summary: N created, M updated, X marked ready, Y still triage, Z parallel lanes
```

---

### Step 7.5: Refresh Board Dashboard

**This step is mandatory. Do not skip.**

1. Search the cached board inventory for an open issue labeled `meta:board-overview`.
2. Compute Implementation Lanes using the **Lane Computation Algorithm** from `hatch3r-board-shared`. Use the cached dependency DAG from Step 5.5 as input.
3. Assign models to all open issues using the **Model Selection Heuristic (Quality-First)** from `hatch3r-board-shared`.
4. **If found:** Regenerate the dashboard body using the **Board Overview Issue Format** template from `hatch3r-board-shared`, populated with cached board data updated with mutations from Step 7. Update the issue body using platform CLI (fall back to MCP):
   - **GitHub:** `gh issue edit {N} --body "..."` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id {N} --description "..."`.
   - **GitLab:** `glab issue update {N} --description "..."`.
5. **If not found:** Create a new board overview issue using the **Board Overview Issue Format** template from `hatch3r-board-shared`, populated with current board data. Label/tag it `meta:board-overview` and sync to the board:
   - **GitHub:** `gh issue create` or `issue_write` MCP, then add to project board.
   - **Azure DevOps:** `az boards work-item create` with `meta:board-overview` tag.
   - **GitLab:** `glab issue create` with `meta:board-overview` label.

Do NOT re-fetch all issues; use cached data.

---

### Step 8: Cleanup

**ASK:** "All issues created. Should I remove processed items from `todo.md`? (yes / no / only created ones)"

If yes, edit `todo.md` to remove lines for created issues. Preserve skipped/excluded lines.

---

## Error Handling

- **Search failure** (GitHub `search_issues` / Azure DevOps `az boards query` / GitLab `glab issue list --search`): retry once, then warn and proceed without dedup.
- **Issue/work item creation failure** (GitHub `issue_write` / Azure DevOps `az boards work-item create` / GitLab `glab issue create`): report, skip that issue, continue. Summarize failures at end.
- **Sub-issue linking failure** (GitHub `sub_issue_write` / Azure DevOps relation add / GitLab issue link): report but do not delete the created issue.
- Never create an issue without user confirmation in Step 6.

## Guardrails

- **Never create issues for topics already covered** without explicit user approval.
- **Never skip ASK checkpoints.**
- **Use correct labels** from the label taxonomy defined in `.agents/hatch.json` (type, priority, area, risk, executor, status, has-dependencies, meta labels).
- **Keep issue bodies concise.** Acceptance criteria must be grounded in user-stated requirements from triage, not fabricated from the todo text alone.
- **No dependency cycles.** Flag and resolve before proceeding.
- **Never downgrade issue status.** Only upgrade `status:triage` → `status:ready`.
- **Always perform the full board scan** in Step 1.5.
- **Preserve existing issue body content** when appending sections.
- **Board Overview is auto-maintained.** Exclude it from all analysis. One board overview issue at a time.
