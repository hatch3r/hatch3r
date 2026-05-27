---
sidebar_position: 4
title: Hooks
---

# Hooks

Event-triggered automation that activates a specific agent on a lifecycle event (session start, file save, pre-commit, pre-push, post-merge, CI failure). Hook definitions live in the canonical `hooks/` content (bundled npm package) and are emitted into each supported adapter's native hook system during `hatch3r sync`.

Hooks are non-interactive: the configured agent runs with its standard tool allowlist and writes back into the editor's hook output channel. Disable a hook per-project by setting `enabled: false` in `.hatch3r/hooks/{id}.customize.yaml`.

## Hook Reference

| Hook | Event | Agent invoked | Purpose |
|------|-------|---------------|---------|
| **session-start** | New coding session opens | `learnings-loader` | Index `.hatch3r/learnings/`, surface up to 5 relevant entries scoped to recently changed files; silent when nothing matches. |
| **file-save** | TS/JS/TSX/JSX file saved (configurable globs) | `context-rules` | Match the saved path against the canonical `rules/` content (always-apply plus glob-scoped) and emit non-blocking inline suggestions for violations; 2 s debounce. |
| **pre-commit** | Before commit, on staged TS/JS files | `lint-fixer` | Run the project linter and formatter on staged files, auto-fix what is fixable, re-stage the fixes, report unfixable violations with file and line. |
| **pre-push** | Before push, on outgoing commits | `security-auditor` | Scan the outgoing diff for high-entropy strings and known secret patterns (API keys, tokens, private keys, `.env`, `*.pem`); block the push on detection. |
| **post-merge** | After a merge completes | `ci-watcher` | Poll the CI pipeline for the merge SHA with exponential backoff (30 s -- 5 min, 15 min timeout) and report failures with a root-cause summary. |
| **ci-failure** | CI workflow run reports failure | `ci-watcher` | Fetch the failed run logs, classify the failure (build, test, lint, type, dependency, infra, timeout, permission), produce a root-cause hypothesis with a suggested fix. |

## Configuration

Hook frontmatter exposes per-hook knobs. Common fields:

- `globs` -- restrict which files trigger the hook (`file-save`, `pre-commit`).
- `debounceMs` -- collapse rapid events (`file-save`, default 2000).
- `timeoutMinutes` -- cap the agent's wall time (`post-merge`, default 15).
- `blockOnWarnings` -- escalate warnings to blocking (`pre-commit`, default `false`).
- `autoRetryFlaky` -- single retry on infrastructure failures (`ci-failure`).
- `scanFullHistory` -- audit full history instead of outgoing diff (`pre-push`).

Override defaults per-project in `.hatch3r/hooks/{id}.customize.yaml`. See [Customization](../guides/customization).

## Adapter Support

Not every coding tool exposes a hook/event API. Of the 3 supported adapters, two emit hook files today:

| Adapter | Hook output |
|---------|-------------|
| **cursor** | `.cursor/hooks/*` |
| **claude** | `.claude/settings.json` hook entries |

GitHub Copilot has no PreToolUse or pre-edit hook surface (`hooks: false` in `ADAPTER_CAPABILITIES`), so the Copilot adapter emits no hook files. Track the full picture in the [Adapter Capability Matrix](./adapter-capability-matrix#implementation-matrix).

## Canonical Location

Hook definitions live in the canonical `hooks/hatch3r-{event}.md` content (bundled npm package) with YAML frontmatter declaring `id`, `type: hook`, `event`, `agent`, and `description`:

```yaml
---
id: pre-commit-lint-fixer
type: hook
event: pre-commit
agent: lint-fixer
description: Auto-fix lint and formatting issues before commit
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx"
---
```

The body documents the agent's expected behavior, output format, and configuration knobs. `hatch3r sync` translates each file into the target adapter's native hook format and wraps it in a managed block so user edits outside the block are preserved.
