---
id: shared-user-content-templates
type: shared-context
description: Body and frontmatter skeletons for the 5 user-authored content types. Referenced by hatch3r-creator at authoring time.
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

## User-Content Skeletons

Canonical reference for the body and frontmatter shapes `hatch3r-creator` produces when a user invokes `/hatch3r-create`. Five sections, one per artifact type. Each provides the minimum frontmatter (YAML), a body skeleton with `<PLACEHOLDER>` substitution slots, and notes on required versus optional fields. Placeholder convention: `<NAME>` is replaced at composition time; `[<TAG-1>, <TAG-2>]` indicates an array.

### 1. Agent Skeleton

**Path:** `.hatch3r/overrides/agents/<NAME>.md`. **Required:** `id`, `description`, `model`, `tags`. **Optional:** `protected` (always `false` for user agents), `quality_charter` (auto-injected), `adapters` (restricts adapter propagation when present), `tools` (per-agent allow/deny allowlist — when `tools.allow` cardinality exceeds 3, a **Security baseline:** body reference is required, see below).

**Security baseline (tool-grant inheritance).** A user agent that grants more than 3 tools in `tools.allow` MUST cite `rules/hatch3r-security-patterns.md` in a `**Security baseline:**` body line and inherit its deny-by-default posture (no unscoped `Bash`, no destructive subcommands, secrets via `${env:VAR}` only). `hatch3r-creator` surfaces a gentle warning when a wide `tools.allow` ships without this citation; at maturity tier `team`/`scaleup`/`enterprise` the warning is promoted to a strict gate per F20.2.A1's tier-aware floor (gate path: `src/content/userContent.ts`). Without this slot a broad tool grant is an unbounded-grant risk (audit Cycle 10 F20.2.A3).

```yaml
---
id: <NAME>
type: agent
description: <DESCRIPTION>
model: <MODEL>
tags: [<TAG-1>, <TAG-2>]
quality_charter: agents/shared/quality-charter.md
---
```

```markdown
You are <ROLE-STATEMENT> for the project. You receive <INPUT-SUMMARY> and produce <OUTPUT-SUMMARY>.

Prompt structure follows `agents/shared/prompt-structure.md` — `<task>`, `<context>`, `<rules>` tags wrap role, runtime state, and constraints.

<task>
## Your Role
- <BULLET-1>
- <BULLET-2>
</task>

<context>
## Inputs
- <INPUT-SLOT-1>
- <INPUT-SLOT-2>
</context>

## Implementation Protocol
### 1. <STEP-1-TITLE>
<STEP-1-BODY>
### 2. <STEP-2-TITLE>
<STEP-2-BODY>
### 3. Return Structured Result
{ status: "SUCCESS" | "BLOCKED", output: <FIELDS>, notes: <FREE-TEXT> }

<rules>
## Boundaries
- **Always:** <ALWAYS-1>
- **Never:** <NEVER-1>
- **Security baseline:** inherits `rules/hatch3r-security-patterns.md` (deny-by-default tools, no destructive subcommands, secrets via `${env:VAR}`). Required line when `tools.allow` grants more than 3 tools.
</rules>

## Confidence Expression
Per `agents/shared/quality-charter.md` §1 and `governance/audit/templates/rigor-contract.md`, rate every recommendation and decision as **high**, **medium**, or **low** confidence and name the basis (direct measurement, sampled observation, inference from analogue).

- **High:** Verified against the specific code/document path read this turn (<FILE-OR-FIXTURE-VERIFIED>).
- **Medium:** Pattern-based on convention or analogue (<NAMED-PATTERN-OR-ANALOGUE>); not fully traced.
- **Low:** Best professional judgment without verification (<UNKNOWN-OR-MISSING-INPUT>); recommend human review before acting.

Emit confidence in the structured result block above. Dropping the field is a charter violation.

## Failure Modes
| Failure | Status | Recovery |
|---|---|---|
| <KNOWN-FAILURE-1> | BLOCKED | <RECOVERY-1> |
| <KNOWN-FAILURE-2> | PARTIAL | <RECOVERY-2> |
| Ambiguous input that maps to ≥2 reasonable interpretations | BLOCKED | Apply `agents/shared/user-question-protocol.md` before any write. |
| Required input missing | BLOCKED | Surface a single multiple-choice question naming the missing field and a safe default. |
| Underlying tool error (filesystem, network, sub-agent timeout) | BLOCKED | Surface the error verbatim; do not silent-retry. |

## Quality Charter
This agent inherits `agents/shared/quality-charter.md` via the frontmatter `quality_charter:` field. The charter binds: §1 confidence levels, §4 root-cause reporting, §6 fail-gracefully, §7 measurable criteria, §8 escalate-ambiguity-early, §10 standardized iteration summary. List below any agent-specific section overrides — if none, write `None — full charter applies`:

- <CHARTER-OVERRIDE-OR-NONE>
```

The three sections above (Confidence Expression, Failure Modes, Quality Charter) are required on every user-authored agent. `hatch3r-creator` injects placeholders during composition and reports `gentleWarnings` when any section is missing or left unsubstituted at save time.

### 2. Skill Skeleton

**Path:** `.hatch3r/overrides/skills/<NAME>/SKILL.md` inside a new directory created via `mkdir -p`. The layout matches the canonical pattern at `skills/hatch3r-<name>/SKILL.md`. **Required:** `id`, `description`, `tags`. **Optional:** `quality_charter` (auto-injected).

```yaml
---
id: <NAME>
type: skill
description: <DESCRIPTION>
tags: [<TAG-1>, <TAG-2>]
quality_charter: agents/shared/quality-charter.md
---
```

```markdown
# <TITLE>

## Quick Start
Task Progress:
- [ ] Step 1: <STEP-1-TITLE>
- [ ] Step 2: <STEP-2-TITLE>
- [ ] Step 3: <STEP-3-TITLE>
- [ ] Step 4: Verification

## Step 1: <STEP-1-TITLE>
<STEP-1-BODY>

## Step 2: <STEP-2-TITLE>
<STEP-2-BODY>

## Step 3: <STEP-3-TITLE>
<STEP-3-BODY>

## Step 4: Verification
Run `<VERIFICATION-COMMAND>`. The skill is complete when:
1. <ACCEPTANCE-CRITERION-1>
2. <ACCEPTANCE-CRITERION-2>
```

Recommended step count: 3-7. Skills with more than 7 steps trigger a gentle warning suggesting decomposition.

### 3. Rule Skeleton

**Path:** `.hatch3r/overrides/rules/<NAME>.md` plus the auto-generated companion `.hatch3r/overrides/rules/<NAME>.mdc`. The `.md` is canonical; `.mdc` is generated by `saveUserContent` using the `.md → .mdc` scope transform from `rules/hatch3r-content-authoring.md`. **Required:** `id`, `type`, `description`, `scope`, `tags`. **Required when scope=conditional:** `globs`. **Optional:** `precedence` (default `normal`), `quality_charter` (auto-injected).

Three scope shapes (pick one):

| Shape | `scope:` line | `globs:` line | When to use |
|---|---|---|---|
| A | `scope: always` | (omit) | Applies every session, regardless of file context. |
| B | `scope: "<GLOB-CSV>"` | (omit) | Legacy compact form — tooling treats it as conditional. |
| C | `scope: conditional` | `globs: "<GLOB-CSV>"` | Explicit globs plus optional `precedence:`. |

```yaml
---
id: <NAME>
type: rule
description: <DESCRIPTION>
scope: <SHAPE-A-VALUE-OR-SHAPE-B-CSV-OR-conditional>
globs: "<GLOB-CSV>"          # required for Shape C; omit for A/B
precedence: <PRECEDENCE>     # Shape C only; default normal
tags: [<TAG-1>]
quality_charter: agents/shared/quality-charter.md
---
```

```markdown
# <TITLE>

<SHORT-PARAGRAPH-DESCRIBING-THE-RULE>

## Directives
- <DIRECTIVE-1>
- <DIRECTIVE-2>

## When This Rule Applies
<TRIGGER-CONDITIONS>

## Examples
<POSITIVE-AND-NEGATIVE-EXAMPLES>
```

The body bytes of `.md` and `.mdc` must match exactly (paired-file parity is a strict gate). The `.mdc` companion has different frontmatter — `saveUserContent` derives it from the `.md` scope shape per the table in `rules/hatch3r-content-authoring.md`.

### 4. Command Skeleton

**Path:** `.hatch3r/overrides/commands/<NAME>.md`. **Required:** `id`, `type`, `description`, `orchestrator`, `tags`. **Required when orchestrator=true:** `agentPipeline` (non-empty array). **Optional:** `quality_charter` (auto-injected). Two variants follow; pick by the `orchestrator` value.

```yaml
# 4a. Inline command — orchestrator: false. Modeled after commands/hatch3r-debug.md.
---
id: <NAME>
type: command
orchestrator: false
description: <DESCRIPTION>
tags: [<TAG-1>]
quality_charter: agents/shared/quality-charter.md
---
```

```yaml
# 4b. Orchestrator command — orchestrator: true. Modeled after commands/hatch3r-board-fill.md.
---
id: <NAME>
type: command
orchestrator: true
agentPipeline: [<AGENT-ID-1>, <AGENT-ID-2>]
description: <DESCRIPTION>
tags: [<TAG-1>]
quality_charter: agents/shared/quality-charter.md
---
```

Body skeleton — 4a inline (single-section workflow with inline validation):

```markdown
## Agent Pipeline
This command runs as a single orchestrator without sub-agent delegation.
# <TITLE> — <ONE-LINE-PURPOSE>
<INTRO-PARAGRAPH>
## Workflow
### Step 1: <STEP-1-TITLE>
**ASK:** "<QUESTION-1>"
### Step 2: <STEP-2-TITLE>
<STEP-2-BODY>
### Step 3: Validation Gates
<INLINE-VALIDATION-CHECKS>
### Step 4: Summary
<TITLE> Result: <FIELD-1>: <VALUE>
## Guardrails
- <GUARDRAIL-1>
```

Body skeleton — 4b orchestrator (Step 0 detect ambiguity, Phase 1 collect, Phase 2 delegate, Phase 3 housekeeping):

```markdown
## §0 Detect Ambiguity (P8 B1)
Before any action, scan the user's request for unresolved questions in scope, target artifact, irreversibility, or constraint conflicts (multiple matching files, missing acceptance criteria, ambiguous "small" boundary, conflicting requirements). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. ASK rules in Phase 1 remain in force for residual ambiguity discovered mid-workflow.

## Agent Pipeline
This command runs as an orchestrator. After collecting inputs in Phase 1, it delegates to <AGENT-ID-1> via the Task tool.
# <TITLE>
<INTRO-PARAGRAPH>
## Workflow
### Phase 1 — Collect & Plan
#### 1.1: <SLOT-1>
**ASK:** "<QUESTION-1>"
#### 1.N: Plan Summary & Confirmation
**ASK:** "Confirm to proceed, or specify changes."
### Phase 2 — Delegate
Use the Task tool to invoke <AGENT-ID-1>. Pass collected slots as structured input. Wait for the structured return.
### Phase 3 — Housekeeping
<POST-DELEGATION-STEPS>
## Guardrails
- <GUARDRAIL-1>
```

Every user-authored orchestrator command should contain the §0 block above per CONSTITUTION §2 P8 B1 (Clarification-First, Default-Path), and the block should reference `agents/shared/user-question-protocol.md` verbatim. `hatch3r-creator` enforces this via authoring discipline (the skeleton above is the canonical template the creator emits at composition time) — the runtime strict gate inside `runUserContentGates` is tracked under audit finding D20-F20.1.B1 and lands in the same wave as the strict-gate implementation in `src/content/userContent.ts`. Until that gate ships, a hand-written orchestrator command missing the §0 reference will save without rejection, so the creator skeleton is the single source of compliance.

The strict gate `validateCommandOrchestratorFrontmatter` (`src/cli/commands/validate.ts:171`) rejects `orchestrator: true` without a non-empty `agentPipeline` array.

### 5. Hook Skeleton

**Path:** `.hatch3r/overrides/hooks/<NAME>.md`. **Required:** `id`, `type`, `event`, `agent`, `description`, `tags`. **Optional:** `globs` (file-save filtering), `condition`, `quality_charter` (auto-injected). **Event enum:** `pre-commit | post-merge | ci-failure | file-save | session-start | pre-push | worktree-create | worktree-remove` (8 values), enforced by `isValidHookEvent` (`src/hooks/types.ts:30`).

```yaml
---
id: <NAME>
type: hook
event: <EVENT>
agent: <AGENT-ID>
description: <DESCRIPTION>
globs: "<GLOB-CSV>"
tags: [<TAG-1>]
quality_charter: agents/shared/quality-charter.md
---
```

```markdown
# Hook: <EVENT> → <AGENT-ID>
<SHORT-PARAGRAPH-DESCRIBING-WHAT-THE-HOOK-DOES-AND-WHEN-IT-FIRES>
## Agent Behavior
When this hook fires, the assigned agent should:
1. <STEP-1>
2. <STEP-2>
## Trigger Conditions
- **Event:** <EVENT>
- **Glob filter:** <GLOB-CSV-OR-NONE>
## Output
<DESCRIBES-WHAT-THE-AGENT-RETURNS-OR-WRITES>
```

The `agent` field must reference an existing agent — canonical (e.g., `lint-fixer` resolves to `agents/hatch3r-lint-fixer.md`) or under `.hatch3r/overrides/agents/`. Missing references are rejected at strict-gate time.

## Reference Implementations

For each user type, mirror the canonical shape below — minus the `hatch3r-` filename prefix; the user-tier path is always under `.hatch3r/overrides/{type}/`:

- **Agent:** `agents/hatch3r-implementer.md` (full body) or `agents/hatch3r-fixer.md` (compact body).
- **Skill:** `skills/hatch3r-bug-fix/SKILL.md` or `skills/hatch3r-feature/SKILL.md`.
- **Rule:** `rules/hatch3r-deep-context.md` (`scope: always`) or `rules/hatch3r-component-conventions.md` (`scope: conditional`).
- **Command:** `commands/hatch3r-debug.md` (inline) or `commands/hatch3r-board-fill.md` (orchestrator).
- **Hook:** `hooks/hatch3r-pre-commit.md` (with globs) or `hooks/hatch3r-session-start.md` (always-fire).
