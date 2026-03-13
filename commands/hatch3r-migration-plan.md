---
id: hatch3r-migration-plan
type: command
description: Create a phased migration plan for a major dependency or framework upgrade. Analyzes breaking changes and produces an actionable plan with rollback procedures.
tags: [planning, brownfield]
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (2 parallel: dependency-analysis, breaking-changes) | Yes | Yes |
| 2. Impact Analysis | `hatch3r-architect` | No | Yes |
| 3. Plan Generation | `hatch3r-docs-writer` | No | Yes |

# Migration Plan — Dependency or Framework Upgrade from Assessment to Phased Execution

Take a dependency or framework upgrade target and produce a complete migration plan (`docs/migrations/`), rollback procedures for each phase, and structured `todo.md` entries ready for `hatch3r-board-fill`. Spawns parallel researcher sub-agents (dependency changelog analysis, breaking change inventory) followed by an architect for codebase impact mapping, then a docs-writer for plan generation. AI proposes all outputs; user confirms before any files are written. Optionally chains into `hatch3r-board-fill` to create GitHub issues immediately.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit changelog reads.** When reading changelogs spanning many versions, extract only breaking changes and deprecations — skip patch-level entries unless security-relevant.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.
4. **Batch file scanning.** When mapping breaking changes to codebase files, use targeted grep/glob patterns rather than reading entire file trees.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather Migration Target

1. **ASK:** "Tell me about the migration you're planning. I need:
   - **Dependency / framework name** (e.g., `react`, `prisma`, `next`, `typescript`)
   - **Target version** (e.g., `v19`, `^6.0.0`, `latest`)
   - **Motivation** (why now? — end-of-life, security, new feature needed, performance, ecosystem pressure)
   - **Known constraints** (timeline, downstream consumers, deployment windows, feature freezes)

   I'll auto-detect the current version from your lockfile. If this is a framework migration (e.g., CRA → Vite, Express → Fastify), describe the source and target instead of versions."

2. Auto-detect the current version from `package.json`, lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), `Cargo.toml`, `go.mod`, `pyproject.toml`, or equivalent. Identify the package manager and count direct/transitive dependents.

3. Present a structured summary:

```
Migration Brief:
  Target:          {dependency}  {current} → {target}
  Package Manager: {npm/yarn/pnpm/cargo/go/pip}
  Motivation:      {user-provided reason}
  Constraints:     {list}
  Direct Dependents: {N} packages depend on this
  Usage Sites:       {N} imports / API call sites in codebase
  Version Gap:       {N} major versions / {M} minor versions
```

**ASK:** "Does this capture the migration correctly? Adjust anything before I proceed to analysis."

#### Step 1b: Dimension Probing

After the migration brief is confirmed, probe for missing context. Analyze the brief for unstated assumptions and generate 4–8 targeted questions from the most relevant dimensions:
   - **Data migrations**: Does the upgrade require database schema changes, data transformations, or format conversions?
   - **Feature flags**: Should the migration be gated behind feature flags for gradual rollout?
   - **Backward compatibility**: Must the old and new versions coexist during transition (e.g., dual-write, adapter pattern)?
   - **Downstream consumers**: Are there other services, packages, or teams consuming APIs that will change?
   - **CI/CD impact**: Will build tooling, test runners, or deployment pipelines need updates?
   - **Runtime environment**: Does the target version require a newer Node.js, Python, Go, or OS version?
   - **Bundle/binary size**: Are there known size regressions in the target version?
   - **Type system**: Does the upgrade introduce stricter types or remove type exports?

Skip dimensions that the migration brief already addresses clearly.

**ASK:** "Before research begins, I have {N} questions to ensure we don't miss anything:
{numbered question list — each with the dimension label and why the answer matters}

Answer these now, or say 'use defaults' for any where you're comfortable with a reasonable default."

Record the user's answers as **Resolved Requirements** (passed to researchers and architect). For defaults, note the assumed value explicitly.

---

### Step 2: Research Phase — Spawn Parallel Researcher Sub-Agents

Spawn two sub-agents concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed migration brief, the Resolved Requirements from Step 1b, and uses depth level `deep`.

| Sub-Agent | Focus | Output |
|-----------|-------|--------|
| 1. Dependency Analysis | Changelog between current → target, deprecated APIs, removed exports, new required config, peer dependency changes, transitive dependency conflicts | Structured breaking change inventory with severity tags |
| 2. Breaking Changes & Community | Community migration guides, known issues, common pitfalls, workarounds, codemods available, official migration tools | Curated list of migration resources with applicability assessment |

**Each sub-agent uses the project's tooling hierarchy:** project docs first, then codebase exploration, then Context7 MCP for library documentation, then web research for community guides.

If the version gap spans multiple major versions (e.g., v2 → v5), instruct the dependency-analysis researcher to produce a per-major-version breakdown, noting which changes compound or are superseded.

Wait for both sub-agents to complete before proceeding.

---

### Step 3: Impact Analysis — Spawn Architect

Spawn the **hatch3r-architect** agent with the combined researcher outputs. The architect maps each breaking change to the actual codebase.

**Architect receives:** the breaking change inventory, community migration resources, Resolved Requirements from Step 1b, and full codebase context (file tree, import graph for the target dependency).

**Architect produces:**

| Output | Description |
|--------|-------------|
| **Breaking Change Map** | Each breaking change → list of affected files, line ranges, and code patterns that must change |
| **Severity Classification** | Each change classified: `trivial` (find-replace / codemod), `moderate` (logic rewrite), `significant` (architectural rework) |
| **Effort Estimates** | Hours per change, with confidence level (high/medium/low based on how well the change is understood) |
| **Risk Register** | Data-loss risks, security implications, performance regressions, behavioral changes that tests may not catch |
| **Codemod Candidates** | Changes amenable to automated codemods — AST transforms, regex replacements, or official migration tools |

Wait for the architect to complete before proceeding.

---

### Step 4: Synthesize & Review Analysis

1. Present a **merged summary** combining findings from all agents:

```
Migration Analysis:

  Target:              {dependency}  {current} → {target}
  Breaking Changes:    {N} total ({X} trivial, {Y} moderate, {Z} significant)
  Affected Files:      {N} files across {M} modules
  Codemod Candidates:  {N} changes automatable
  Estimated Effort:    {total hours} ({confidence})
  Risks:               {N} risks ({X} high, {Y} medium, {Z} low)
  Data-Loss Risk:      {yes/no — details if yes}
  Coexistence Required:{yes/no — dual-version period needed}
  Peer Dep Conflicts:  {N} ({list if any})
```

2. **Highlight high-severity items** — any `significant` breaking change, data-loss risk, or change without a clear migration path.

3. If the version gap spans multiple major versions, recommend incremental vs. direct migration with trade-offs for each.

**ASK:** "Here is the migration analysis. High-severity items are highlighted above. Options:
- **Confirm** to proceed with phased plan generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher or the architect with updated parameters
- **Descope** to target an intermediate version instead"

---

### Step 5: Generate Phased Migration Plan

From the merged analysis, generate a phased migration plan. Present all content for review before writing any files.

#### Migration Plan — `docs/migrations/{dependency}_{current}_to_{target}.md`

```markdown
# Migration Plan: {Dependency} {current} → {target}

## Overview

{2-3 sentence summary of the migration scope, motivation, and approach}

## Migration Summary

| Metric | Value |
|--------|-------|
| Breaking changes | {N} |
| Affected files | {N} |
| Estimated effort | {hours} |
| Recommended approach | {incremental / direct} |
| Coexistence period | {yes/no — duration if yes} |
| Rollback complexity | {low/medium/high} |

## Phase 0: Preparation

**Goal:** Create safety nets before any migration work begins.

| # | Task | Files | Effort | Validation |
|---|------|-------|--------|------------|
| 0.1 | Add test coverage for migration-affected code paths | {files} | {hours} | All new tests pass |
| 0.2 | Pin transitive dependencies to prevent drift | {files} | {hours} | Lockfile updated |
| 0.3 | Create compatibility shims / adapter layer (if coexistence needed) | {files} | {hours} | Shims compile, existing tests pass |
| 0.4 | Document current behavior for regression comparison | — | {hours} | Snapshot saved |

**Rollback:** No codebase changes to roll back. Remove new tests only if abandoning migration entirely.

## Phase 1: Non-Breaking Updates

**Goal:** Apply changes that are backward-compatible with the current version.

| # | Task | Files | Effort | Validation |
|---|------|-------|--------|------------|
| 1.1 | Update configuration to support both versions | {files} | {hours} | Config valid for both versions |
| 1.2 | Add new imports alongside deprecated ones | {files} | {hours} | No runtime changes |
| 1.3 | Run available codemods for trivial changes | {files} | {hours} | Codemod output reviewed, tests pass |

**Rollback:** `git revert` the Phase 1 commits. No data or state changes to undo.

## Phase 2: Migrate Consumers

**Goal:** Update application code to use new APIs, patterns, and behaviors.

| # | Task | Breaking Change | Severity | Files | Effort | Validation |
|---|------|----------------|----------|-------|--------|------------|
| 2.1 | {task description} | {breaking change ref} | {trivial/moderate/significant} | {files} | {hours} | {how to verify} |

**Rollback:** Revert Phase 2 commits. If data migrations occurred, run reverse migration script `{script}`.

## Phase 3: Cleanup

**Goal:** Remove backward-compatibility code, old imports, shims, and dead dependencies.

| # | Task | Files | Effort | Validation |
|---|------|-------|--------|------------|
| 3.1 | Remove compatibility shims | {files} | {hours} | No references to shim modules |
| 3.2 | Remove old dependency version from lockfile | {files} | {hours} | Only target version remains |
| 3.3 | Remove deprecated API usage suppressions | {files} | {hours} | No suppression comments remain |
| 3.4 | Update documentation and READMEs | {files} | {hours} | Docs reflect new version |

**Rollback:** Re-add shims from Phase 0 if a late regression surfaces.

## Risk Register

| Risk | Severity | Phase | Mitigation | Detection |
|------|----------|-------|------------|-----------|
| {risk} | High/Med/Low | {phase} | {strategy} | {how to detect early} |

## Validation Checklist

- [ ] All existing tests pass after each phase
- [ ] No new lint warnings or type errors
- [ ] Performance benchmarks within {X}% of baseline
- [ ] No runtime deprecation warnings or console errors
- [ ] CI pipeline passes on migration branch
- [ ] Manual smoke test of critical user flows

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

**ASK:** "Here is the phased migration plan. Review the content before I write the file:
- `{dependency}_{current}_to_{target}.md` — {phase count} phases, {task count} tasks, {risk count} risks

Confirm, or tell me what to adjust."

---

### Step 6: Generate todo.md Entries

From the phased migration plan, generate structured `todo.md` entries in the format that `hatch3r-board-fill` expects. One **epic-level entry** referencing the migration plan, followed by **one entry per phase**:

```markdown
- [ ] **Migrate {dependency} {current} → {target}**: {Migration overview with scope and effort summary}. Ref: docs/migrations/{dependency}_{current}_to_{target}.md.
- [ ] **{dependency} migration Phase 0 — Preparation**: {Phase 0 task summary}. Ref: docs/migrations/{dependency}_{current}_to_{target}.md.
- [ ] **{dependency} migration Phase 1 — Non-breaking updates**: {Phase 1 task summary}. Ref: docs/migrations/{dependency}_{current}_to_{target}.md.
- [ ] **{dependency} migration Phase 2 — Migrate consumers**: {Phase 2 task summary with breaking change count}. Ref: docs/migrations/{dependency}_{current}_to_{target}.md.
- [ ] **{dependency} migration Phase 3 — Cleanup**: {Phase 3 task summary}. Ref: docs/migrations/{dependency}_{current}_to_{target}.md.
```

#### Placement

Determine the appropriate priority header based on the migration motivation. Security and EOL migrations default to P0; feature-driven migrations default to P1; ecosystem-pressure migrations default to P2.

#### If `todo.md` Already Exists

**ASK:** "todo.md already exists with {N} items. How should I add the migration entries?
- **(a) Append** under the appropriate priority header
- **(b) Merge** — deduplicate against existing items and reorganize
- **(c) Show me the entries** and I'll place them manually"

#### If `todo.md` Does Not Exist

Create a new `todo.md` with the appropriate priority header and the new entries.

Present the drafted entries for review.

**ASK:** "Here are the todo.md entries for this migration ({N} items — 1 epic + {M} phase items). Review before I write:

{entries}

Confirm, or tell me what to adjust."

---

### Step 7: Write All Files

After all content is confirmed:

1. Write the migration plan to `docs/migrations/{dependency}_{current}_to_{target}.md`. Create the directory if needed.
2. Write or update `todo.md` at the project root.
3. Present a summary:

```
Files Created/Updated:
  docs/migrations/
    {dependency}_{current}_to_{target}.md  — {phase count} phases, {task count} tasks
  todo.md                                   — {N} entries added (1 epic + {M} phases)
```

---

### Step 8 (Optional): Chain into Board-Fill

**ASK:** "All files written. Run `hatch3r-board-fill` to create GitHub issues from the new todo.md entries? (yes / not now)"

If yes, instruct the user to invoke the `hatch3r-board-fill` command. Board-fill will perform its own deduplication, grouping, and readiness assessment.

---

## Error Handling

- **No changelog available:** Fall back to git diff of the source repository between version tags. If unavailable, rely on community migration guide researcher output only and warn the user that the breaking change inventory may be incomplete.
- **Breaking changes unmappable to codebase:** Flag as a **runtime risk** in the risk register with detection strategy (test, monitoring, canary) when a breaking change has no API signature difference to grep for.
- **Version gap too large:** If the migration spans 3+ major versions, recommend incremental migration (one major at a time) and generate a plan for the first hop only. ASK whether to plan just the first hop or attempt the full jump.
- **Sub-agent failure:** Retry once. If it fails again, present partial results and ask the user how to proceed (continue with partial analysis / provide missing information manually / abort).
- **Conflicting researcher outputs:** Present both sides with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide full file content so the user can create the file manually.
- **Missing project context:** Proceed without board context — this command does not require board configuration.
- **Peer dependency conflicts:** Enumerate conflicts in the analysis and include resolution tasks in Phase 0.
- **No codebase usage found:** Warn that the dependency may be transitive-only and adjust the plan scope accordingly.

## Guardrails

- **Never auto-execute migration steps.** This command produces a plan — it never runs install, upgrade, or codemod commands.
- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Preserve rollback ability at each phase.** Every phase must include a rollback procedure. If a phase cannot be rolled back (e.g., irreversible data migration), flag it with **⚠ IRREVERSIBLE** and require explicit user acknowledgment.
- **Flag data-loss risks prominently.** Any data-loss risk must appear in the risk register with `High` severity and a dedicated mitigation strategy.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle Context7 MCP, web research, and the tooling hierarchy internally.
- **Respect the project's tooling hierarchy:** project docs → codebase exploration → Context7 MCP → web research.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source specs.
- **Preserve existing todo.md content.** Never overwrite or reorganize existing items without explicit user approval.
- **Scope to the declared target.** Do not opportunistically upgrade other dependencies. Flag sibling upgrades as follow-up recommendations.

## Related

- **Command:** `hatch3r-dep-audit` — dependency health check; run before migration planning
- **Command:** `hatch3r-refactor-plan` — structural refactoring that accompanies a migration
- **Command:** `hatch3r-board-fill` — create GitHub issues from generated todo.md entries
- **Command:** `hatch3r-feature-plan` — plan features that depend on the migration target's new capabilities
- **Skill:** `hatch3r-refactor` — execution workflow for migration phases involving code restructuring
