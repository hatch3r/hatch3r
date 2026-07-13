---
id: ci-failure-ci-watcher
type: hook
event: ci-failure
agent: ci-watcher
description: Diagnose CI pipeline failures
tags: [devops]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: ci-failure → ci-watcher

Activate the ci-watcher agent when a CI pipeline fails to diagnose the root cause, suggest fixes, and report actionable next steps.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Fetch the full CI run logs for the failed workflow run (using `gh run view {run-id} --log` or equivalent).
2. Identify the failing job(s) and step(s) — extract the error output, exit code, and stack trace (if present).
3. Classify the failure type: build error, test failure, lint violation, type error, dependency issue, infrastructure/flaky, timeout, or permission error.
4. For test failures: identify the specific failing test(s), expected vs. actual values, and the source file(s) involved.
5. For build/type errors: extract the compiler error message and the source location.
6. Produce a root-cause hypothesis with a concrete suggested fix (code change, config change, or retry recommendation for flaky failures).
7. If the failure matches a known pattern from `.hatch3r/learnings/`, reference the relevant learning.

## Expected Output

A structured diagnostic report containing:

- **Failed job**: Name and step of the failing CI job.
- **Error type**: Classification (build, test, lint, type, dependency, infra, timeout, permission).
- **Root cause**: Concise explanation of why the failure occurred.
- **Error excerpt**: The relevant log output (truncated to key lines).
- **Suggested fix**: Specific, actionable remediation steps.
- **Related learnings**: Links to any matching entries in `.hatch3r/learnings/` (if applicable).

## Configuration

These are agent-runtime defaults, not settings in a separate config file. To use a different value, state it in your prompt when the hook fires.

- **CI provider**: Auto-detected from repository config. Name a specific provider in your prompt to pin it.
- **Log depth**: The agent fetches the last 200 lines of the failing step by default. Ask for more lines when a failure needs deeper context.
- **Auto-retry**: The agent does not re-run the workflow by default. Ask it to re-run once when the failure is classified as infrastructure/flaky.
