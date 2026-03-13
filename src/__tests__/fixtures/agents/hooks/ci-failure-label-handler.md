---
id: ci-failure-label-handler
type: hook
event: ci-failure
agent: triage-agent
description: Triage CI failures with specific labels
labels: type:bug, status:blocked
---
# Hook: ci-failure -> triage-agent

Activate triage agent when CI fails on issues with bug or blocked labels.
