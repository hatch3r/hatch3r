---
id: hatch3r-test-plan
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer]
description: Plan a comprehensive test strategy -- spawn parallel researchers, produce test plan spec with coverage targets, priority ordering, test case outlines, and structured todo.md entries for board-fill.
tags: [core, planning]
quality_charter: agents/shared/quality-charter.md
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (5 parallel: coverage-analysis, complexity-risk, test-pattern, boundary-analysis, risk-prioritization) | Yes | Yes |
| 2. Document Generation | `hatch3r-docs-writer` (test plan spec, ADRs) | Yes | Yes |
| 3. Todo Generation | Orchestrator (inline) | No | Yes |

# Test Plan -- Comprehensive Test Strategy from Scope to Board-Ready Epic

Take a test planning scope (feature, module, or codebase area) and produce a complete test plan specification (`docs/specs/`), architectural decision records (`docs/adr/`) when significant testing infrastructure decisions are involved, and structured `todo.md` entries (epic + sub-items) ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (coverage analysis, complexity & risk mapping, test pattern extraction, boundary analysis, risk-based prioritization) to analyze the testing landscape from multiple angles before generating artifacts. AI proposes all outputs; user confirms before any files are written. Supports two modes: feature-scoped test planning (plan tests for a specific feature) and module/codebase-level coverage auditing (assess and improve test coverage across an area). Optionally chains into `hatch3r-test-writer` for immediate test implementation or `hatch3r-board-fill` to create tracking issues.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory -- do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output -- no prose dumps.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather Test Planning Scope

1. **ASK:** "Tell me about the test strategy you want to plan. I need:
   - **Scope** (what to plan tests for -- a feature, module, or codebase area)
   - **Mode** -- choose one:
     - **Feature-scoped**: Plan tests for a specific feature (often chained from `hatch3r-feature-plan`)
     - **Coverage audit**: Assess and improve test coverage across a module or codebase area
   - **Motivation** (why now? new feature landing, coverage gaps found, refactoring safety net, CI failures, etc.)
   - **Known constraints** (timeline, framework mandates, CI budget, flaky test concerns, etc.)

   You can also point me to an existing feature spec, coverage report, or GitHub issue and I'll extract these from it."

2. If the user provides a document reference or issue, read it and extract the four fields above.
3. Present a structured summary:

```
Test Planning Brief:
  Scope:       {scope description}
  Mode:        {feature-scoped / coverage-audit}
  Motivation:  {why this test plan is needed}
  Constraints: {list}
```

**ASK:** "Does this capture the test planning scope? Adjust anything before I send this to the research phase."

#### Step 1b: Dimension Probing (Test Strategy Elicitation)

After the test planning brief is confirmed, probe for missing requirements across key test planning dimensions. Scan the scope description for ambiguities and generate targeted follow-up questions.

1. Analyze the confirmed brief for vague language, unstated assumptions, and missing dimensions.
2. Generate 5-10 targeted questions from the most relevant dimensions for this scope:
   - **Coverage targets**: What coverage thresholds are acceptable? Should they match or exceed `hatch3r-testing` rule defaults (80% stmt, 70% branch, 90% critical)?
   - **Test types in scope**: Which test types are relevant? Unit, integration, E2E, property-based, contract, snapshot, visual regression, performance, security?
   - **Performance budget for test suite**: How fast should the test suite run? CI time budget? Parallelization constraints?
   - **CI integration**: How should tests integrate with CI? Per-PR gates, nightly runs, coverage reporting, mutation testing schedule?
   - **Mock/stub strategy**: Existing mock infrastructure? Preferred mock approach? External service dependencies that need mocking?
   - **Test data requirements**: Data generation approach? Fixture vs factory preference? Seeding requirements? PII concerns in test data?
   - **Browser/E2E scope**: Which user flows need E2E coverage? Browser matrix? Mobile viewport testing?
   - **Flaky test tolerance**: Existing flaky tests? Quarantine process in place? Retry budget in CI?
3. Skip dimensions that the brief already addresses clearly.

**ASK:** "Before research begins, I have {N} questions to confirm the test plan covers all relevant dimensions:
{numbered question list -- each with the dimension label and why the answer matters}

Answer these now, or say 'use defaults' for any where you're comfortable with a reasonable default."

4. Record the user's answers as **Resolved Requirements**. These are passed to the researchers and ultimately to the test plan spec.
5. For any dimension where the user chose defaults, note the assumed default explicitly (referencing `hatch3r-testing` rule thresholds where applicable).

---

### Step 2: Load Project Context

1. Check for existing test infrastructure and documentation:
   - Test configuration files -- `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `.stryker.conf.*`, `tsconfig.json` (for test paths)
   - Existing coverage reports -- `coverage/`, `.nyc_output/`, or CI artifacts
   - Existing test files -- `tests/`, `__tests__/`, `*.test.*`, `*.spec.*` (scan for patterns and count)
   - Quarantine directory -- `tests/quarantine/` or equivalent
   - `docs/specs/` -- project specifications (read TOC/headers first, expand relevant sections only)
   - `docs/adr/` -- architectural decision records (scan for testing-related decisions)
   - `README.md` -- project overview
   - `.agents/hatch.json` -- board configuration
   - Existing `todo.md` -- current backlog (check for overlap or related items)
   - Feature spec -- if mode is feature-scoped, look for the referenced feature spec in `docs/specs/`
2. Scan GitHub issues via `search_issues` for existing testing-related work. Note duplicates or partial overlaps.
3. If `.agents/learnings/` exists, scan for learnings relevant to testing, coverage, or quality.
4. Present a context summary:

```
Context Loaded:
  Test framework:       {vitest/jest/playwright/etc. with versions}
  Coverage tooling:     {configured / not configured -- tool name if configured}
  Mutation testing:     {configured / not configured -- tool name if configured}
  Existing tests:       {N} test files ({X} unit, {Y} integration, {Z} E2E)
  Quarantine:           {N} quarantined tests / not found
  Coverage baseline:    {N}% stmt / {N}% branch / unknown}
  Specs:                {N} files in docs/specs/ ({relevant ones listed})
  ADRs:                 {N} files in docs/adr/ ({relevant ones listed})
  Feature spec:         {found: path / not found -- mode-dependent}
  Existing todo.md:     {found with N items / not found}
  Related issues:       {N} open issues with testing overlap ({list issue numbers})
  Learnings:            {N} relevant learnings ({areas})
  Gaps:                 {list any missing context}
```

**ASK:** "Here is the context I loaded. Provide additional constraints, related work, or context? (or confirm to proceed)"

---

### Step 3: Spawn Parallel Researcher Sub-Agents

Spawn one sub-agent per research domain below concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed test planning brief from Step 1 and the context summary from Step 2.

**Each sub-agent prompt must include:**
- The full confirmed test planning brief
- The Resolved Requirements from Step 1b (user's answers to dimension-probing questions)
- The project context summary from Step 2
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `deep`

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `coverage-analysis` | Map existing test coverage, gaps, critical untested paths, coverage metrics |
| 2 | `complexity-risk` | Code complexity hotspots, mutation-prone areas, error handling coverage, testing depth recommendations |
| 3 | `test-pattern` | Existing test conventions, framework usage, mock patterns, helper library, convention compliance |
| 4 | `boundary-analysis` | Integration boundaries, external dependencies, data flow boundaries, event chains, API surface coverage |
| 5 | `risk-prioritization` | Risk-ranked prioritization by business impact, security exposure, change frequency, current coverage |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification.

The `coverage-analysis` sub-agent establishes the baseline -- its output tells us where we are today and how far we need to go to meet targets.

The `risk-prioritization` sub-agent's output is critical for ordering the test plan -- it determines which tests should be written first for maximum risk reduction.

The `test-pattern` sub-agent ensures the plan aligns with existing conventions, so new tests fit naturally into the codebase.

**Each sub-agent prompt must also include** the Resolved Requirements from Step 1b (user's answers to dimension-probing questions) so researchers can factor in the user's explicit decisions.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Research Summary:

Feature / Area:          {scope name}
Mode:                    {feature-scoped / coverage-audit}
Current coverage:        {N}% stmt / {N}% branch / {N}% function (or "unknown")
Target coverage:         {N}% stmt / {N}% branch / {N}% function
Test types planned:      {unit, integration, E2E, property, contract, etc.}
Test cases identified:   {N} total ({X} P0, {Y} P1, {Z} P2, {W} P3)
Complexity hotspots:     {N} high-complexity areas needing thorough testing
Boundary tests needed:   {N} integration boundaries identified
Quick wins:              {N} high-impact, low-effort tests to add first
Mock infrastructure:     {existing / needs setup / needs expansion}
Convention alignment:    {N}/{M} conventions followed, {divergences if any}
Effort estimate:         {total estimate}
Priority:                {recommended P-level for the overall test plan}
```

2. **Highlight conflicts** between researchers. Common conflict types:
   - Coverage analysis finds gaps that risk-prioritization ranks as low priority (coverage vs. risk trade-off)
   - Test pattern analysis reveals conventions that conflict with optimal testing strategy
   - Boundary analysis identifies integration points that complexity-risk rates as low-risk
   - Effort estimates that seem inconsistent with the scope of testing identified

3. For each conflict, present both sides and a recommended resolution.

**ASK:** "Here is the merged research summary. Conflicts (if any) are highlighted above. Options:
- **Confirm** to proceed with test plan spec and todo generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher with updated parameters
- **Descope** to reduce the test plan size"

---

### Step 5: Generate Test Plan Spec

From the merged researcher outputs, generate a test plan specification document. Present all content for review before writing any files.

#### Test Plan Spec -- `docs/specs/{NN}_{scope-slug}_test-plan.md`

Determine the next sequential number by scanning existing files in `docs/specs/`. Use slugified scope name (lowercase, hyphens).

```markdown
# {Scope Name} -- Test Plan

## Overview

{2-3 sentence summary of the test plan scope and purpose, derived from the confirmed brief}

## Scope

### In Scope
- {test area / module / feature covered}

### Out of Scope
- {explicitly excluded to prevent scope creep}

## Current State

### Coverage Metrics
| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Statement coverage | {N}% | {N}% | {delta} |
| Branch coverage | {N}% | {N}% | {delta} |
| Function coverage | {N}% | {N}% | {delta} |
| Mutation score | {N}% | {N}% | {delta} |

### Test Inventory
| Type | Count | Framework | Directory |
|------|-------|-----------|-----------|
| Unit | {N} | {framework} | {path} |
| Integration | {N} | {framework} | {path} |
| E2E | {N} | {framework} | {path} |

### Flaky Tests
| Test | File | Quarantined? | Issue |
|------|------|-------------|-------|
| {test name} | {path} | Yes/No | {issue link or "none"} |

## Strategy Matrix

| Test Type | Scope | Framework | Count Planned | Priority | CI Integration |
|-----------|-------|-----------|-------------|----------|---------------|
| Unit | {modules/functions} | {framework} | {N} | P0/P1/P2/P3 | Per-PR |
| Integration | {boundaries} | {framework} | {N} | P0/P1/P2/P3 | Per-PR |
| E2E | {flows} | {framework} | {N} | P0/P1/P2/P3 | Nightly / Per-PR |
| Property-based | {functions} | {framework} | {N} | P0/P1/P2/P3 | Per-PR |
| Contract | {APIs} | {framework} | {N} | P0/P1/P2/P3 | Per-PR |

## Test Case Outlines

### P0 -- Critical (Must Have)
| # | Test Case | Type | Module | What It Validates | Acceptance Criteria |
|---|-----------|------|--------|------------------|-------------------|
| 1 | {title} | Unit/Integration/E2E | {module} | {behavior being tested} | - [ ] {criterion} |

### P1 -- Important (Should Have)
| # | Test Case | Type | Module | What It Validates | Acceptance Criteria |
|---|-----------|------|--------|------------------|-------------------|
| 1 | {title} | Unit/Integration/E2E | {module} | {behavior being tested} | - [ ] {criterion} |

### P2 -- Standard (Nice to Have)
| # | Test Case | Type | Module | What It Validates | Acceptance Criteria |
|---|-----------|------|--------|------------------|-------------------|
| 1 | {title} | Unit/Integration/E2E | {module} | {behavior being tested} | - [ ] {criterion} |

### P3 -- Low Priority (Stretch)
| # | Test Case | Type | Module | What It Validates | Acceptance Criteria |
|---|-----------|------|--------|------------------|-------------------|
| 1 | {title} | Unit/Integration/E2E | {module} | {behavior being tested} | - [ ] {criterion} |

## Mock & Test Data Strategy

### Mock Approach
| Dependency | Mock Type | Library / Tool | Rationale |
|-----------|----------|---------------|-----------|
| {dependency} | Fake/Stub/Mock/MSW/Emulator | {tool} | {why this approach -- aligned with fakes > stubs > mocks hierarchy} |

### Test Data Strategy
| Data Need | Approach | Source | Notes |
|-----------|----------|--------|-------|
| {data need} | Factory/Fixture/Seed/Generated | {tool or file} | {deterministic seeding, PII concerns, etc.} |

## Infrastructure Requirements

| Requirement | Status | Action Needed |
|-------------|--------|--------------|
| {test framework setup} | Exists/Needs setup | {action} |
| {coverage tooling} | Exists/Needs setup | {action} |
| {mutation testing} | Exists/Needs setup | {action} |
| {CI integration} | Exists/Needs setup | {action} |
| {mock infrastructure} | Exists/Needs setup | {action} |

## CI Integration

| Gate | When | Threshold | Action on Failure |
|------|------|-----------|------------------|
| Unit tests | Per-PR | All pass | Block merge |
| Integration tests | Per-PR | All pass | Block merge |
| E2E tests | {Per-PR / Nightly} | All pass | {Block merge / Alert} |
| Coverage check | Per-PR | No decrease > 1% | Block merge |
| Mutation testing | {Weekly / Nightly} | {N}% score | Alert |
| Flaky test scan | {Weekly} | < 0.5% rate | Alert |

## Convention Alignment

Reference conventions from `hatch3r-testing` rule:

| Convention | Plan Alignment | Notes |
|-----------|---------------|-------|
| Deterministic (no wall clock) | {aligned / needs attention} | {details} |
| Isolated (own setup/teardown) | {aligned / needs attention} | {details} |
| Fast (unit < 50ms, integration < 2s) | {aligned / needs attention} | {details} |
| Named clearly (behavior descriptions) | {aligned / needs attention} | {details} |
| No network in unit tests | {aligned / needs attention} | {details} |
| Fakes > stubs > mocks hierarchy | {aligned / needs attention} | {details} |
| Factory over fixtures | {aligned / needs attention} | {details} |

## Implementation Order

{Topological ordering of test implementation with parallel lanes identified}

1. {infrastructure setup -- prerequisites with no dependencies}
2. {P0 tests -- highest risk reduction}
3. {P1 tests -- important coverage gaps}
4. {P2 + P3 tests -- parallel -- lower priority, can be batched}

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| {risk to the test plan itself -- e.g., flaky infrastructure, CI budget, test data complexity} | High/Med/Low | {strategy} |

## Completion Criteria

- [ ] All P0 test cases implemented and passing
- [ ] All P1 test cases implemented and passing
- [ ] Coverage targets met: {N}% stmt / {N}% branch
- [ ] No new flaky tests introduced
- [ ] CI gates configured and enforcing
- [ ] Mock infrastructure set up for all external dependencies
- [ ] Test data strategy implemented (factories/fixtures)
- [ ] Convention alignment verified against `hatch3r-testing` rule

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

If a glossary exists (`docs/specs/00_glossary.md`), reference its stable IDs where applicable.

**ASK:** "Here is the generated test plan spec. Review the content before I write the file:
- `{NN}_{scope-slug}_test-plan.md` -- {test case count} test cases across {test type count} test types, targeting {coverage target}% statement coverage

Confirm, or tell me what to adjust."

---

### Step 6: Generate ADR(s) (If Applicable)

Only proceed if the research phase identified significant testing infrastructure decisions requiring ADRs. Examples:
- Adopting a new test framework or replacing an existing one
- Introducing property-based testing infrastructure
- Setting up contract testing between services
- Adopting mutation testing as a quality gate
- Changing the mock strategy (e.g., moving from mocks to fakes with an in-memory implementation)

If no ADRs are needed, skip to Step 7.

#### ADR Format -- `docs/adr/{NNNN}_{decision-slug}.md`

Determine the next sequential number by scanning existing files in `docs/adr/`. Use slugified decision titles.

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Context

{Why this testing infrastructure decision is needed -- current pain points, coverage gaps, or quality concerns that motivate the change}

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

- Test plan spec: `docs/specs/{NN}_{scope-slug}_test-plan.md`
```

**ASK:** "Here are {N} ADR(s) generated from testing infrastructure decisions. Review before I write the files:
{list with titles}

Confirm, or tell me what to adjust."

---

### Step 7: Generate todo.md Entries

From the risk-prioritized test case outlines and the synthesized research, generate structured `todo.md` entries in the format that `hatch3r-board-fill` expects.

#### Entry Structure

One **epic-level entry** with a description referencing the test plan spec, followed by **individual sub-item entries** grouped by priority:

```markdown
- [ ] **{Scope name} test plan epic**: {Overview -- test types, coverage targets, test case count}. Ref: docs/specs/{NN}_{scope-slug}_test-plan.md.
- [ ] **[P0] {Test case/group title}**: {Description with key assertions}. Ref: docs/specs/{NN}_{scope-slug}_test-plan.md.
- [ ] **[P1] {Test case/group title}**: {Description with key assertions}. Ref: docs/specs/{NN}_{scope-slug}_test-plan.md.
- [ ] **[P2] {Test case/group title}**: {Description with key assertions}. Ref: docs/specs/{NN}_{scope-slug}_test-plan.md.
```

If the test plan is small enough to be a single task (fewer than 5 test cases, single test type), produce a single standalone entry instead of an epic.

#### Placement

Determine the appropriate priority header based on the priority recommended in Step 4. Place entries under the matching `## P{N} -- {Label}` header.

#### If `todo.md` Already Exists

**ASK:** "todo.md already exists with {N} items. How should I add the new entries?
- **(a) Append** under the appropriate priority header
- **(b) Merge** -- deduplicate against existing items and reorganize
- **(c) Show me the entries** and I'll place them manually"

#### If `todo.md` Does Not Exist

Create a new `todo.md` with the appropriate priority header and the new entries.

Present the drafted entries for review.

**ASK:** "Here are the todo.md entries for this test plan ({N} items -- 1 epic + {M} sub-items, grouped by priority). Review before I write:

{entries}

Confirm, or tell me what to adjust."

---

### Step 8: Write All Files

After all content is confirmed:

1. Write the test plan spec to `docs/specs/{NN}_{scope-slug}_test-plan.md`. Create the `docs/specs/` directory if it does not exist.
2. Write ADR(s) to `docs/adr/{NNNN}_{decision-slug}.md` (if any). Create the `docs/adr/` directory if it does not exist.
3. Write or update `todo.md` at the project root.
4. If a glossary exists and the test plan introduces new testing-related terminology, note glossary updates needed (do not modify the glossary automatically).
5. Present a summary of all files created or modified:

```
Files Created/Updated:
  docs/specs/
    {NN}_{scope-slug}_test-plan.md  -- {test case count} test cases, {test type count} types, {coverage target}% target
  docs/adr/
    {NNNN}_{decision}.md            -- {decision title}  (if applicable)
    ...
  todo.md                            -- {N} entries added ({1} epic + {M} sub-items)
  Glossary update needed:            {yes/no -- list new terms if yes}
```

---

### Step 9 (Optional): Chain into Test Writer or Board-Fill

**ASK:** "All files written. What would you like to do next?
- **Run `hatch3r-test-writer`** to implement the highest-priority (P0) tests immediately
- **Run `hatch3r-board-fill`** to create GitHub issues from the new todo.md entries
- **Neither** -- I'll take it from here"

If `hatch3r-test-writer`: instruct the user to invoke `hatch3r-test-writer`, passing the P0 test cases from the test plan spec as the scope.

If `hatch3r-board-fill`: instruct the user to invoke `hatch3r-board-fill`. Note that board-fill will perform its own deduplication, grouping, dependency analysis, and readiness assessment on the entries.

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `.agents/hatch.json` exists, proceed without board context -- this command does not require board configuration.
- **No existing tests:** Switch to bootstrapping strategy -- the test plan becomes a greenfield test setup plan. Include infrastructure setup (framework installation, config, CI gates) as P0 items. Warn that coverage baselines will be unavailable.
- **No coverage tooling:** Recommend coverage setup as a prerequisite. Include coverage tooling installation as a P0 infrastructure item in the test plan. Proceed with estimated coverage from code analysis rather than measured coverage.
- **Feature spec not found (feature-scoped mode):** Warn that the test plan will be less informed without a feature spec. Recommend running `hatch3r-feature-plan` first for best results. Proceed with what's available from codebase analysis.
- **No existing specs or docs:** Proceed without spec references. Warn that the test plan will be less contextualized. Recommend running `hatch3r-project-spec` or `hatch3r-codebase-map` first for best results.
- **Duplicate detection:** If the test plan scope overlaps significantly with existing todo.md items or GitHub issues found in Step 2, present the overlap and ASK whether to proceed (augment existing / replace / abort).

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Stay within the test planning scope** defined by the user in Step 1. Do not invent test areas the user did not describe or imply. Flag coverage expansion opportunities but do not act on them without explicit approval.
- **Coverage targets must align with `hatch3r-testing` rule thresholds.** Statement 80%, branch 70%, critical modules 90%/85%. If the user requests lower targets, note the divergence explicitly.
- **Test cases must follow the convention hierarchy.** Fakes > stubs > mocks, as specified in `hatch3r-testing` rule. If the codebase uses a different convention, note the divergence and recommend gradual alignment.
- **Do not prescribe implementation details.** The test plan specifies what to test, not how to implement the tests. Implementation details are `hatch3r-test-writer`'s responsibility. Test case outlines include behavior descriptions and acceptance criteria, not code.
- **Property-based and mutation testing are opt-in.** Only include these in the plan if the user opts in during Step 1b or the codebase already uses them.
- **All 5 researchers must complete before proceeding to Step 4.** Do not generate specs from partial research.
- **todo.md must be compatible with board-fill format** -- markdown checklist with bold titles, grouped by priority, referencing source specs.
- **ADRs use the same format as `hatch3r-project-spec`** -- Status, Date, Context, Decision, Alternatives, Consequences.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
