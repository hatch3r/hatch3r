---
id: hatch3r-hooks
type: command
description: Define and manage event-driven hooks that activate agents on project events
---
# Hooks — Event-Driven Agent Activation

Define, edit, and manage event-driven hooks that automatically activate hatch3r agents when specific project events occur. Hook definitions are tool-agnostic — the adapter pipeline translates them into tool-native configurations during `npx hatch3r sync`.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Discover Current State

1. Check `/.agents/hooks/` for existing hook definition files (`.md` files with frontmatter).
2. Read `/.agents/hatch.json` for configured tools and features.
3. List existing hooks with their event, agent, and conditions.

Present the current state:

```
Current Hooks: {list with id, event, agent — or "none"}
Configured Tools: {tools from hatch.json}
Hooks Feature: {enabled/disabled}
```

**ASK:** "Current hooks: {list or 'none'}. Tools: {list}. What would you like to do? (a) Add a new hook, (b) Edit existing hook, (c) Remove a hook, (d) List all hooks, (e) Sync hooks to tools"

---

### Step 2: Define Hook

For adding a new hook:

#### 2a. Select Event

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

**ASK:** "Select an event for this hook."

#### 2b. Select Agent

Present available hatch3r agents:

- `lint-fixer` — Automatic lint error resolution
- `test-writer` — Test generation for new or changed code
- `reviewer` — Code review and quality checks
- `security-auditor` — Security vulnerability scanning
- `ci-watcher` — CI/CD pipeline monitoring and diagnosis
- `a11y-auditor` — Accessibility compliance checks
- `perf-profiler` — Performance analysis and optimization
- `dependency-auditor` — Dependency security and update checks
- `docs-writer` — Documentation generation and updates

If the user wants a custom agent name not in this list, accept it but warn that the agent must exist in `/.agents/agents/`.

**ASK:** "Select an agent to activate when this event fires."

#### 2c. Define Conditions (Optional)

- **Glob patterns:** Which files trigger this hook (e.g., `src/**/*.ts`, `*.css`)
- **Branch patterns:** Which branches (e.g., `main`, `release/*`)

**ASK:** "Add conditions? (glob patterns, branch patterns, or skip for 'always activate')"

#### 2d. Write Hook Definition File

Generate the hook definition file at `/.agents/hooks/{event}-{agent-short-name}.md`:

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

---

### Step 3: Edit Existing Hook

For editing an existing hook:

1. List all hooks and ask which to edit.
2. Show current definition.
3. Ask what to change (event, agent, conditions, description).
4. Update the hook file in `/.agents/hooks/`.

**ASK:** "Updated hook: {summary}. Save? (yes / revert / cancel)"

---

### Step 4: Remove a Hook

1. List all hooks and ask which to remove.
2. Show the hook definition.

**ASK:** "Remove hook '{id}'? This will delete `/.agents/hooks/{filename}`. (yes / cancel)"

3. Delete the file. Warn that tool-specific generated files (e.g., `.cursor/rules/hatch3r-hook-*.mdc`) will be cleaned up on the next `npx hatch3r sync`.

---

### Step 5: Sync Hooks to Tools

1. Read all hook definitions from `/.agents/hooks/`.
2. For each configured tool in `hatch.json`, describe what will be generated:
   - **Claude Code:** Hook documentation appended to managed section of `CLAUDE.md`
   - **Cursor:** Glob-based `.mdc` rule files in `.cursor/rules/hatch3r-hook-*.mdc`
   - **Others:** No-op (hook definitions stored for future adapter support)
3. Present the list of files that will be generated/updated.

**ASK:** "Hooks will generate these files: {list}. Run `npx hatch3r sync` to apply. (understood / sync now)"

If user chooses "sync now", instruct them to run `npx hatch3r sync` in the terminal.

---

## Custom Events

Define project-specific hook events beyond the built-in types:

- **Event naming**: `custom:{domain}:{action}` (e.g., `custom:billing:subscription-change`)
- **Event registration**: Add custom events to `hatch.json` under `hooks.customEvents`
- **Event triggering**: Agents trigger custom events via `emit-hook custom:{name}` in their workflows
- **Event payload**: Custom events can pass structured data to hook handlers via JSON payload

### Custom Event Definition

In `hatch.json`:

```json
{
  "hooks": {
    "customEvents": [
      {
        "name": "custom:billing:subscription-change",
        "description": "Fired when a subscription plan changes",
        "payload": { "userId": "string", "oldPlan": "string", "newPlan": "string" }
      }
    ]
  }
}
```

Custom events follow the same hook definition format as built-in events — create a hook file in `/.agents/hooks/` with `event: custom:{domain}:{action}`.

---

## Hook Chaining

Hooks can trigger other hooks in sequence:

- **Chain definition**: Define ordered hook chains in `hatch.json` under `hooks.chains`
- **Execution order**: Hooks in a chain execute sequentially; failure in any hook stops the chain
- **Error handling**: Chain-level error handlers can catch and handle failures from individual hooks
- **Conditional chaining**: Hooks can conditionally trigger next hook based on output (pass/fail/skip)

### Chain Definition

In `hatch.json`:

```json
{
  "hooks": {
    "chains": [
      {
        "id": "pre-release-pipeline",
        "description": "Full pre-release validation chain",
        "steps": [
          { "hook": "pre-release-security-auditor", "on_fail": "stop" },
          { "hook": "pre-release-test-writer", "on_fail": "stop" },
          { "hook": "pre-release-docs-writer", "on_fail": "warn" }
        ],
        "on_error": "notify"
      }
    ]
  }
}
```

Chains are triggered by referencing the chain ID as the hook target. Individual hook results (`pass`, `fail`, `skip`) determine whether the chain continues.

---

## Hook Execution Ordering

When multiple hooks are registered for the same event:

- **Priority**: Hooks have a priority field (1-100, lower runs first, default 50)
- **Parallel vs Sequential**: Hooks at the same priority level run in parallel; different priority levels run sequentially
- **Timeout**: Each hook has a configurable timeout (default 30 seconds). Timed-out hooks are reported as failures.
- **Isolation**: Each hook runs in its own context. Hook outputs are collected but don't affect other hooks unless chained.

### Priority Configuration

Add `priority` and `timeout` to hook frontmatter:

```markdown
---
id: pre-commit-lint-fixer
type: hook
event: pre-commit
agent: lint-fixer
priority: 10
timeout: 60
---
```

### Execution Example

For `pre-commit` with three hooks:
1. `lint-fixer` (priority 10) — runs first
2. `security-auditor` (priority 20) — runs second
3. `test-writer` (priority 50) and `reviewer` (priority 50) — run in parallel, third

---

## Error Handling

- `/.agents/hooks/` doesn't exist: create it automatically.
- Invalid event type: warn and show the valid events table.
- Agent not found in `/.agents/agents/`: warn but allow (agent may be added later).
- Adapter doesn't support hooks: generate hook definition file anyway, warn that sync for that tool is a no-op.
- Duplicate hook ID: warn and ask the user to choose a different name or overwrite.

## Guardrails

- **Never skip ASK checkpoints.**
- Hook definitions are tool-agnostic — the adapters handle translation.
- Never delete hook files without explicit user confirmation.
- Always validate event names against the known events list.
- Hook IDs must be unique across all hook definitions.
- The command creates hook DEFINITIONS only — actual hook registration happens via `npx hatch3r sync`.
- Do not modify adapter output files directly — they are managed by the sync pipeline.
