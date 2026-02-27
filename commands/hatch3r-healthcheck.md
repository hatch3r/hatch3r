---
id: hatch3r-healthcheck
type: command
description: Create a full-product QA and testing audit epic with one sub-issue per project module
---
# Healthcheck — Full Product QA & Testing Audit

Create a healthcheck epic on **{owner}/{repo}** with one sub-issue per logical project module, plus cross-module wiring and vision/roadmap alignment audits. Each sub-issue is a deep static-analysis audit task that, when picked up by the board workflow, produces a findings epic with actionable sub-issues for achieving full QA and testing coverage. The command only creates the initial audit epic — it does NOT execute any audits.

---

## Shared Context

**Read the project's shared board context at the start of the run** (e.g., `.cursor/commands/board-shared.md` or equivalent). It contains GitHub Context, Project Reference, Projects v2 sync procedure, and Board Overview template. Cache all values for the duration of this run.

## Token-Saving Directives

Follow any **Token-Saving Directives** in the shared context file.

---

## Module Discovery

The product is divided into logical modules. Discover modules from the project structure:

1. **Scan for modules:** Inspect top-level directories (e.g., `src/`, `functions/`, `packages/`) and identify logical units.
2. **Map to specs:** If `docs/specs/` exists, map each module to relevant spec files.
3. **Build taxonomy:** Produce a table of modules with their directories and primary specs.

Example structure (adapt to project):

| # | Module | Directories | Primary Specs |
|---|--------|-------------|----------------|
| 1 | Core Engine | `src/engine/` | `02_core-engine.md` |
| 2 | Events | `src/events/` | `03_event-model.md` |
| ... | ... | ... | ... |

Plus two cross-cutting audits:

| # | Audit | Scope |
|---|-------|-------|
| W | Cross-Module Wiring | Integration points between all modules |
| R | Product vs Vision, Roadmap & Concept Alignment | Implementation vs product vision, roadmap, and specs |

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Load Context & Pre-Flight Check

1. Read the shared board context and cache GitHub Context, Projects v2 config, and sync procedure.
2. If `docs/specs/00_glossary.md` exists, read the first 30 lines for TOC/section headers.
3. Scan for existing healthcheck epics: `search_issues` with `owner: {owner}`, `repo: {repo}`, query `label:meta:healthcheck state:open`.
4. If an open healthcheck epic exists:

**ASK:** "An open healthcheck epic already exists: #{number} — {title}. (a) Abort, (b) close the existing one and create a new healthcheck, (c) proceed and create a second healthcheck."

5. Fetch all open issues (`list_issues`, paginate, exclude `meta:board-overview`). Cache for Board Overview regeneration in Step 7.

---

### Step 2: Determine Audit Modules

1. Build the module taxonomy from directory structure (see Module Discovery above).
2. If the user specified specific modules in their invocation, filter the taxonomy to only those modules. The two cross-cutting audits (Wiring, Roadmap) are always included unless the user explicitly excludes them.
3. Validate that the directories for each selected module exist in the workspace. Warn if any directory is missing.

Present the selected modules:

```
Healthcheck Audit Scope:

Level 1 (parallel):
  1. {Module 1} — {path}/
  2. {Module 2} — {path}/
  ...

Level 2 (after all Level 1 complete):
  W. Cross-Module Wiring — integration points
  R. Product vs Vision, Roadmap & Concept Alignment — vision + roadmap + specs
```

**ASK:** "These modules will be audited. Confirm, add, or remove modules."

---

### Step 3: Create Healthcheck Epic

Create the parent epic via `issue_write` with `method: create`, `owner: {owner}`, `repo: {repo}`.

**Title:** `[Healthcheck]: Full Product QA & Testing Audit`

**Labels:** `type:epic`, `meta:healthcheck`, `status:ready`, `executor:agent`, `priority:p1`, `area:testing`

**Body:**

```markdown
## Overview

Full-product healthcheck audit covering {N} logical modules plus cross-module wiring and roadmap alignment analysis. Each sub-issue performs a deep static analysis of one module and produces a findings epic with actionable sub-issues for achieving full QA and testing coverage.

## Sub-Issues

### Level 1 — Module Audits (parallel)

- [ ] #{part-1} — Audit: {Module 1}
- [ ] #{part-2} — Audit: {Module 2}
      ...

### Level 2 — Cross-Cutting Audits (after all Level 1)

- [ ] #{wiring} — Audit: Cross-Module Wiring
- [ ] #{roadmap} — Audit: Product vs Vision, Roadmap & Concept Alignment

## Implementation Order

### 1

- [ ] #{part-1} — Audit: {Module 1}
- [ ] #{part-2} — Audit: {Module 2}
      ...all module audits...

### 2 -- after #{part-1}, #{part-2}, ... #{part-N}

- [ ] #{wiring} — Audit: Cross-Module Wiring
- [ ] #{roadmap} — Audit: Product vs Vision, Roadmap & Concept Alignment

## Acceptance Criteria

- [ ] All sub-issue audits completed
- [ ] One findings epic created per audited module (with `meta:healthcheck-findings` label)
- [ ] All findings epics have sub-issues with acceptance criteria
- [ ] All findings epics integrated into Projects v2 board
- [ ] Cross-cutting findings epics have correct dependencies on module findings epics

## Dependencies

None.
```

Record the returned `number` and internal numeric `id` for the epic.

---

### Step 4: Create Module Audit Sub-Issues

For each module in the selected taxonomy, create a sub-issue via `issue_write` with `method: create`.

**Title:** `Audit: {Module Name}`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`

**Body:** Use the Module Audit Sub-Issue Template below, filling in the module-specific fields.

After creating each sub-issue, link it to the parent epic via `sub_issue_write` with `method: add`, using the parent `issue_number` and the child's internal numeric `id`.

Record all returned sub-issue numbers for use in Step 5.

#### Module Audit Sub-Issue Template

```markdown
## Audit: {Module Name}

> Parent: #{healthcheck-epic-number} — [Healthcheck]: Full Product QA & Testing Audit

### Scope

**Directories:** {comma-separated directory paths from taxonomy}
**Primary Specs:** {spec filenames from taxonomy}
**Test Directories:** Search `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/rules/` for files matching this module.

### Audit Protocol

Perform a deep static analysis of this module. Do NOT execute tests or modify code — review source files, spec documents, and existing test files only.

#### 1. Test Coverage Analysis

- List all exported functions, classes, and modules in the scope directories
- Map each to existing test files in `tests/`
- Identify untested code paths and missing test scenarios
- Assess test quality: meaningful assertions, edge cases, error paths

#### 2. Spec Compliance

- Read the referenced specs fully
- Compare implementation against every requirement in the spec
- Flag deviations, partial implementations, and missing features

#### 3. Testing Pyramid Assessment

- Unit tests: coverage percentage estimate and quality assessment
- Integration tests: cross-module interactions and contract tests
- E2E tests: critical user flows covered for this module
- Security tests: invariants validated
- Performance tests: budget compliance verified

#### 4. Code Quality

- Error handling completeness (all error paths covered)
- Edge case coverage (boundary values, empty states, overflow)
- Input validation at module boundaries
- TypeScript strict mode compliance (no `any`, no `@ts-ignore` without linked issue)
- Max function length and file length compliance per project standards

#### 5. Performance & Privacy

- Performance budget compliance per project quality docs
- Privacy invariant adherence per project security docs

### Output — Findings Epic

After completing the audit, create a findings epic on GitHub.

**Create via `issue_write`:**

- **Title:** `[QA Findings]: {Module Name}`
- **Labels:** `type:epic`, `meta:healthcheck-findings`, `status:ready`, `executor:agent`, `priority:p1`
- **Body:** Overview of findings count and severity, sub-issues checklist, implementation order, acceptance criteria ("done when all finding sub-issues are resolved").

**Create sub-issues** — one per actionable finding. Each must include:

- Problem description with evidence (file paths, line references, spec section)
- Suggested fix approach
- Acceptance criteria (specific and testable)
- Labels: `type:qa` for test gaps, `type:bug` for spec deviations, `type:refactor` for code quality, plus relevant `area:*` label

**Link sub-issues** to the findings epic via `sub_issue_write`.

**Board integration** — for the findings epic and every sub-issue:

Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary). Set status to Ready using the project's status field option ID.

### Completion

Return to the parent orchestrator with:

- Findings epic issue number
- Total findings count
- Breakdown by type (test gaps, spec deviations, code quality, performance, privacy)
- Any blockers encountered
```

---

### Step 5: Create Cross-Cutting Audit Sub-Issues

Create two additional sub-issues with dependencies on all module audit sub-issues.

#### 5a. Cross-Module Wiring Audit

**Title:** `Audit: Cross-Module Wiring`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`, `has-dependencies`

**Body:** Scope: Analyze integration points between all project modules. This audit runs AFTER all module audits complete — use their findings for additional context. Follow the same Output — Findings Epic instructions as module audits. Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}

Link to parent epic via `sub_issue_write`.

#### 5b. Product vs Vision, Roadmap & Concept Alignment Audit

**Title:** `Audit: Product vs Vision, Roadmap & Concept Alignment`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`, `has-dependencies`

**Body:** Scope: Compare the current implementation against the product vision, roadmap, and all specification documents. This audit runs AFTER all module audits complete. Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}. Follow the same Output — Findings Epic instructions.

Link to parent epic via `sub_issue_write`.

---

### Step 6: Finalize Epic & Set Dependencies

1. **Update the healthcheck epic body** with the actual sub-issue numbers in the Sub-Issues checklist and Implementation Order section. Use `issue_write` with `method: update`.

2. **Verify dependency sections** on the wiring and roadmap sub-issues contain the correct module audit sub-issue numbers.

3. Present a summary with epic number, sub-issues, and total count.

---

### Step 7: Board Integration

1. **Projects v2 Sync:** Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary) for the healthcheck epic and ALL sub-issues. Set status to Ready using the project's status field option ID.

2. **Board Overview Regeneration:** Regenerate the Board Overview using the **Board Overview Template** from the shared context. Use cached board data from Step 1, updated with the newly created healthcheck epic. Skip silently if no board overview issue exists.

---

## Error Handling

- `search_issues` failure: retry once, then warn and proceed (assume no existing healthcheck).
- `issue_write` failure: report the error, retry once. If still failing, present the drafted body for manual creation.
- `sub_issue_write` failure: report but do not delete the created sub-issue. Note the unlinking for manual fix.
- Projects v2 sync failure (gh CLI or MCP): warn and continue. Board sync can be fixed later via board-refresh.

## Guardrails

- **Never skip ASK checkpoints.**
- **Use GitHub MCP tools for issue operations** (create, update, link). For Projects v2 board integration, follow the sync procedure from hatch3r-board-shared (gh CLI primary).
- **The command ONLY creates issues.** It does NOT execute any audits, run tests, or modify code.
- **Always include the `meta:healthcheck` label** on the healthcheck epic.
- **Always include `meta:healthcheck-findings`** in the output instructions for audit sub-issues.
- **Preserve dependency ordering.** Level 2 sub-issues must reference all Level 1 sub-issues in their Dependencies section.
- **Board Overview is auto-maintained.** Exclude it from all analysis. One board overview issue at a time.
- **Do not expand scope.** The command creates exactly the discovered modules plus the two cross-cutting audits. No additional issue types.
