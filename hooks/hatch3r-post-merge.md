---
id: post-merge-ci-watcher
type: hook
event: post-merge
agent: ci-watcher
description: Check CI pipeline status after merge
---
# Hook: post-merge → ci-watcher

Activate the ci-watcher agent after a merge completes to verify the CI pipeline passes on the updated branch.
