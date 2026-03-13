---
id: post-merge-deploy
type: hook
event: post-merge
agent: deploy-agent
description: Deploy after merge to main
branches: main, release/*
---
# Hook: post-merge -> deploy-agent

Trigger deployment agent after merges to main or release branches.
