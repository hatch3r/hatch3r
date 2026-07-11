---
id: hatch3r-hooks
name: hatch3r-hooks
type: skill
description: Define, edit, and manage event-driven hooks that activate agents on project events. Tool-agnostic — adapters translate hook definitions into tool-native configurations during `npx hatch3r sync`.
tags: [devops, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Hooks — Event-Driven Agent Activation

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Discover current state
- [ ] Step 2: Define a hook (add) — select event, agent, conditions, write definition file
- [ ] Step 3: Edit an existing hook
- [ ] Step 4: Remove a hook
- [ ] Step 5: Sync hooks to tools
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Learnings Consultation

If `.hatch3r/learnings/` exists, scan for learnings related to hook configurations, event trigger patterns, or prior hook issues before starting.

## Step 1: Discover Current State

1. Check `hooks/` for existing hook definition files (`.md` files with frontmatter).
2. Read `.hatch3r/hatch.json` for configured tools and features.
3. List existing hooks with their event, agent, and conditions.

Present the current state:

```
Current Hooks: {list with id, event, agent — or "none"}
Configured Tools: {tools from hatch.json}
Hooks Feature: {enabled/disabled}
```

**ASK:** "Current hooks: {list or 'none'}. Tools: {list}. What would you like to do? (a) Add a new hook, (b) Edit existing hook, (c) Remove a hook, (d) List all hooks, (e) Sync hooks to tools"

## Step 2: Define Hook

For adding a new hook:

### 2a. Select Event

Present available events with descriptions:

| Event | Description | Use Cases |
|-------|-------------|-----------|
| `pre-commit` | Triggered before a commit is created | Lint checks, secret scanning, test running |
| `post-merge` | Triggered after a branch merge | Dependency updates, migration checks, notification |
| `ci-failure` | Triggered when CI/CD pipeline fails | Auto-diagnosis, fix suggestions |
| `file-save` | Triggered when a file is saved | Auto-formatting, auto-testing, live validation |
| `session-start` | Triggered when a new coding session starts | Context loading, status checks |
| `pre-push` | Triggered before pushing to remote | Full test suite, build verification |
| `pre-implementation` | Triggered before implementing a sub-issue | Context loading, spec review, learning consultation |
| `post-implementation` | Triggered after implementing a sub-issue | Learning capture, code quality check, doc updates |
| `pre-review` | Triggered before code review starts | Checklist generation, context preparation |
| `post-review` | Triggered after code review completes | Fix tracking, learning capture, approval notifications |
| `pre-release` | Triggered before a release workflow | Changelog verification, version validation, dependency audit |
| `post-release` | Triggered after a release completes | Monitoring setup, notification, deploy verification |
| `pre-test` | Triggered before test execution | Test environment setup, fixture preparation |
| `post-test` | Triggered after test execution completes | Coverage reporting, flaky test detection, result analysis |
| `on-error` | Triggered when any workflow step fails | Error diagnosis, auto-retry, escalation, incident logging |
| `on-context-switch` | Triggered when agent context is refreshed or delegated | State persistence, handoff documentation |
| `on-dependency-change` | Triggered when dependencies are added/updated/removed | Security audit, compatibility check, license validation |
| `on-security-finding` | Triggered when a security issue is discovered | Alert escalation, auto-fix suggestions, incident creation |

> [!IMPORTANT]
> Claude Code only maps `session-start` → `SessionStart` semantically. Every other event above (pre-commit, post-merge, ci-failure, file-save, pre-push, etc.) is a git/project lifecycle event with NO native Claude Code mapping — the adapter emits a no-op or alternative strategy, NOT a PreToolUse/PostToolUse binding. If the user picks one of these and targets Claude Code, say so before writing the definition. Full detail: the "Claude Code event mapping" note in Step 2d below.

**ASK:** "Select an event for this hook."

### 2b. Select Agent

First run `ls agents/` to read the current agent roster. The list below is the canonical set at authoring time, but agents may be added or renamed — verify each id against the live roster before presenting, and drop any that no longer resolve to `agents/<id>.md`. Present available hatch3r agents (every id below carries the `hatch3r-` prefix and must exist as `agents/<id>.md`):

- `hatch3r-lint-fixer` — Automatic lint error resolution
- `hatch3r-testability` — Test generation for new or changed code
- `hatch3r-reviewer` — Code review and quality checks
- `hatch3r-security` — Security vulnerability scanning
- `hatch3r-ci-watcher` — CI/CD pipeline monitoring and diagnosis
- `hatch3r-ui` — Accessibility and UI-quality checks
- `hatch3r-performance` — Performance analysis and optimization
- `hatch3r-dependency-drafter` — Dependency security and update checks
- `hatch3r-docs-writer` — Documentation generation and updates

If the user names an agent not shown, confirm it against the `ls agents/` roster: accept a real id, and warn that any name absent from `agents/` must be created there before the hook can fire. The `agent:` value is emitted verbatim into the hook definition — no id normalization resolves a short or misspelled name, so a value that is not an exact `agents/<id>.md` id activates nothing.

**ASK:** "Select an agent to activate when this event fires."

### 2c. Define Conditions (Optional)

- **Glob patterns:** Which files trigger this hook (e.g., `src/**/*.ts`, `*.css`)
- **Branch patterns:** Which branches (e.g., `main`, `release/*`)

**ASK:** "Add conditions? (glob patterns, branch patterns, or skip for 'always activate')"

### 2d. Write Hook Definition File

Generate the hook definition file at `hooks/{event}-{agent-short-name}.md`:

```markdown
---
id: {event}-{agent-short-name}
type: hook
event: {selected-event}
agent: {selected-agent}
description: {user-provided or auto-generated description}
globs: {comma-separated glob patterns, if any}
branches: {comma-separated branch patterns, if any}
---
# Hook: {event} → {agent}

{Description of what this hook does and when it activates.}

## Activation

- **Event:** {event}
- **Agent:** {agent}
- **Conditions:** {glob patterns, branch patterns, or "always"}

## Tool-Specific Behavior

- **Claude Code:** For session-start → SessionStart. For pre-commit, post-merge, ci-failure, file-save, pre-push: no native mapping — adapter may use no-op or alternative strategy (see mapping note below).
- **Cursor:** Maps to glob-based rule activation in `.cursor/rules/`
- **Others:** Hook definition stored; sync when adapter support is added
```

Claude Code event mapping: **Claude Code's native hook events (PreToolUse, PostToolUse, SubagentStart, SessionStart) are tool-lifecycle events and do NOT map to git/project events.** PreToolUse fires before every tool call; PostToolUse fires after every tool completes; SubagentStart fires when a subagent spawns. Only `session-start` → `SessionStart` is semantically correct. For pre-commit, post-merge, ci-failure, file-save, and pre-push, the Claude Code adapter may use a no-op or alternative strategy (e.g., Cursor rules) — do not map these to PreToolUse/PostToolUse/SubagentStart, as that would cause hooks to fire on every tool invocation instead of the intended event.

**ASK:** "Hook definition: {summary}. Create? (yes / adjust / cancel)"

## Step 3: Edit Existing Hook

For editing an existing hook:

1. List all hooks and ask which to edit.
2. Show current definition.
3. Ask what to change (event, agent, conditions, description).
4. Update the hook file in `hooks/`.

**ASK:** "Updated hook: {summary}. Save? (yes / revert / cancel)"

## Step 4: Remove a Hook

1. List all hooks and ask which to remove.
2. Show the hook definition.

**ASK:** "Remove hook '{id}'? This will delete `hooks/{filename}`. (yes / cancel)"

3. Delete the file. Warn that tool-specific generated files (e.g., `.cursor/rules/hatch3r-hook-*.mdc`) will be cleaned up on the next `npx hatch3r sync`.

## Step 5: Sync Hooks to Tools

1. Read all hook definitions from `hooks/`.
2. For each configured tool in `hatch.json`, describe what will be generated:
   - **Claude Code:** Hook documentation appended to managed section of `CLAUDE.md`
   - **Cursor:** Glob-based `.mdc` rule files in `.cursor/rules/hatch3r-hook-*.mdc`
   - **Others:** No-op (hook definitions stored for future adapter support)
3. Present the list of files that will be generated/updated.

> [!IMPORTANT]
> For Claude Code, only `session-start` becomes an executable native hook. Git/project-event hooks (pre-commit, post-merge, ci-failure, file-save, pre-push, etc.) are written to `CLAUDE.md` as documentation, NOT registered as native Claude Code hooks — they do not fire on the named event. State this explicitly when listing the generated Claude Code output (see the "Claude Code event mapping" note in Step 2d).

**ASK:** "Hooks will generate these files: {list}. Run `npx hatch3r sync` to apply. (understood / sync now)"

If user chooses "sync now", instruct them to run `npx hatch3r sync` in the terminal.

## Hook Definition Schema (implemented surface)

A hook is a single canonical artifact: one event fires one agent, optionally narrowed by conditions. The fields below are the complete config that adapters honor today (`src/hooks/types.ts` `HookDefinition` + `HookCondition`):

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique hook identifier (sanitized for shell safety). |
| `event` | yes | Lifecycle event from the events table in Step 2a. |
| `agent` | yes | Agent ID dispatched when the event fires. |
| `description` | yes | Human-readable purpose. |
| `globs` | no | File glob patterns — hook fires only when matching files are affected. |
| `branches` | no | Branch name patterns — hook fires only on matching branches. |
| `labels` | no | Issue/PR labels — hook fires only when matching labels are present. |

There is no chaining, custom-event, priority, timeout, or parallel-by-priority config: each hook is independent, the adapter emits one tool-native entry per hook, and ordering across multiple hooks on the same event is the tool's own (Claude Code stacks matcher entries; Cursor stacks `.cursor/hooks.json` entries). Do not author `hooks.chains`, `hooks.customEvents`, `emit-hook`, `priority:`, or `timeout:` — no code consumes them.

## Error Handling

- `hooks/` doesn't exist: create it automatically.
- Invalid event type: warn and show the valid events table.
- Agent not found in `agents/`: warn but allow (agent may be added later).
- Adapter doesn't support hooks: generate hook definition file anyway, warn that sync for that tool is a no-op.
- Duplicate hook ID: warn and ask the user to choose a different name or overwrite.

## Guardrails

- **Never skip ASK checkpoints.**
- Hook definitions are tool-agnostic — the adapters handle translation.
- Never delete hook files without explicit user confirmation.
- Always validate event names against the known events list.
- Hook IDs must be unique across all hook definitions.
- The skill creates hook DEFINITIONS only — actual hook registration happens via `npx hatch3r sync`.
- Do not modify adapter output files directly — they are managed by the sync pipeline.
