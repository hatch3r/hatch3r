---
id: post-merge-ci-watcher
type: hook
event: post-merge
agent: ci-watcher
description: Check CI pipeline status after merge
tags: [core]
quality_charter: agents/shared/quality-charter.md
---
# Hook: post-merge → ci-watcher

Activate the ci-watcher agent after a merge completes to verify the CI pipeline passes on the updated branch.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Detect the branch that was just merged into and the merge commit SHA.
2. Poll the CI pipeline (GitHub Actions, CircleCI, etc.) for the status of the merge commit.
3. Wait for pipeline completion with exponential backoff (initial: 30s, max: 5min, timeout: 15min).
4. If the pipeline fails, fetch the failure logs, identify the failing step(s), and produce a root-cause summary.
5. If new dependencies were added or lockfiles changed during the merge, flag this for the developer's awareness.

## Expected Output

- **On success**: "CI passed for merge commit `{sha}` on `{branch}` — all checks green."
- **On failure**: A structured diagnostic including the failing job name, step, error excerpt, and suggested fix. If the failure appears related to the merge (e.g., test conflict), flag it explicitly.
- **On timeout**: "CI pipeline for `{sha}` has not completed after 15 minutes. Check manually: {link}."

## Configuration

- **CI provider**: Auto-detected from repository config (`.github/workflows/`, `.circleci/`, etc.). Override with `ciProvider` in hook config.
- **Timeout**: Default 15 minutes. Adjust via `timeoutMinutes` in hook config.
- **Notifications**: Set `notifyOnFailure: true` to post a comment on the merge PR when CI fails.
