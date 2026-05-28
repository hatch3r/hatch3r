---
id: hatch3r-gh-agentic-workflows
name: hatch3r-gh-agentic-workflows
description: Set up CI/CD agentic workflows for continuous AI-powered repository automation (GitHub Actions, Azure Pipelines, GitLab CI)
tags: [devops, ctx:team-only, tier:enterprise-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# CI/CD Agentic Workflows Integration

> **Platform detection:** Check `platform` in `.hatch3r/hatch.json` to determine which CI/CD system to use. Defaults to `"github"`.

This skill guides setup for AI-powered CI/CD automation in hatch3r-managed projects. The core SKILL covers GitHub Actions (the default); non-GitHub platforms load on demand from `references/`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: CI platform (GitHub Actions vs Azure Pipelines vs GitLab CI), AI engine (copilot vs claude vs codex), permission scope (read-only vs write), trigger pattern (schedule vs PR event vs manual), and cost-budget enforcement (token cap vs unbounded).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Progressive Disclosure (Anthropic 2026 skills spec)

| Target platform | File to read |
|-----------------|--------------|
| GitHub Actions (default) | This file — read sections below |
| Azure DevOps Pipelines | `references/azure-devops.md` |
| GitLab CI/CD | `references/gitlab-ci.md` |

Load only the references file that matches `platform` in `.hatch3r/hatch.json`. Do not eagerly load all three.

## Overview (GitHub Actions)

GitHub Agentic Workflows (technical preview, Feb 2026) bring AI agent orchestration into GitHub Actions. Agentic Workflows are markdown files in `.github/workflows/` with YAML frontmatter that compile to GitHub Actions jobs. They support multiple AI engines (GitHub Copilot, Claude, OpenAI Codex) and use MCP for tool access.

## Available Workflow Templates (GitHub)

### 1. Continuous Test Improvement

Automatically assess test coverage and add high-value tests.

```yaml
# .github/workflows/hatch3r-continuous-testing.md
---
name: Continuous Test Improvement
on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:
engine: copilot
permissions:
  contents: read
  pull-requests: write
---
```

Analyze test coverage gaps and open PRs with new tests for uncovered critical paths.

### 2. Continuous Triage

Automatically summarize, label, and route new issues.

```yaml
# .github/workflows/hatch3r-continuous-triage.md
---
name: Continuous Triage
on:
  issues:
    types: [opened]
engine: copilot
permissions:
  issues: write
---
```

When a new issue is opened, analyze it, apply labels from the hatch3r taxonomy (type:*, priority:*, area:*), and add a triage summary comment.

### 3. Continuous Documentation

Keep documentation aligned with code changes.

```yaml
# .github/workflows/hatch3r-continuous-docs.md
---
name: Continuous Documentation
on:
  pull_request:
    types: [closed]
    branches: [{defaultBranch}]
engine: copilot
permissions:
  contents: write
  pull-requests: write
---
```

Replace `{defaultBranch}` with `board.defaultBranch` from `.hatch3r/hatch.json` (fallback: `"main"`).

After a PR is merged, check if documentation needs updating and open a follow-up PR.

## Security Considerations

- Workflows run in sandboxed environments with minimal permissions
- Use read-only defaults; only grant write permissions when needed
- Review all AI-generated changes before merging
- Network isolation and tool allowlisting are enforced by the runtime

## Integration with hatch3r

- hatch3r's label taxonomy (type:*, executor:*, priority:*) aligns with agentic triage
- The hatch3r-testability (CQ5) agent's patterns can inform continuous testing workflows
- The hatch3r-docs-writer agent's patterns can inform continuous documentation
- Board management commands complement continuous triage

## Setup (GitHub)

1. Enable GitHub Agentic Workflows in your repository settings
2. Create workflow files in `.github/workflows/` using the templates above
3. Configure the AI engine (copilot is default, claude and codex are alternatives)
4. Set appropriate permissions for each workflow
5. Monitor workflow runs in the Actions tab

For Azure DevOps setup: see `references/azure-devops.md`. For GitLab setup: see `references/gitlab-ci.md`.

## Verification Steps (GitHub)

1. **Syntax check:** `gh workflow view {name}` or the Actions web UI
2. **Dry run:** `gh workflow run {name}` → `gh run watch`
3. **Output review:** Check the AI-generated output (PR, comment, label) for quality and correctness.
4. **Permission audit:** Verify the workflow cannot access resources beyond its declared permissions.
5. **Idempotency:** Run the workflow twice on the same input — it should not create duplicate artifacts.
6. **Error handling:** Trigger with invalid/edge-case input — workflow should fail gracefully with clear error.

Platform-equivalent verification for ADO/GitLab: see the platform reference files.

## Monitoring (GitHub)

- **Execution tracking:** `gh run list --workflow={name}`
- **Failure alerts:** Settings → Notifications → Actions
- **Cost awareness:** Monitor AI token usage per workflow run. Set spending limits in org settings.
- **Quality metrics:** Track success rate, output acceptance rate (merged PRs / total), mean time per run.

## Error Handling

- **Workflow file has YAML syntax errors:** Validate the workflow file locally before pushing (e.g., `actionlint` for GitHub Actions). Fix all reported errors before committing.
- **AI engine produces low-quality or empty output:** Add explicit context to the workflow prompt (file references, examples, constraints). If the output is still poor after enrichment, switch to a more capable model.
- **Workflow runs exceed cost or time limits:** Add `timeout-minutes` to the workflow, scope file references to reduce context size, and add concurrency groups to prevent parallel runs.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Workflow doesn't trigger | Incorrect `on:` event or branch filter | Verify event type matches, check branch protection rules |
| AI output is empty/poor | Insufficient context in workflow body | Add more context, reference specific files, include examples |
| Permission denied | Missing or insufficient permissions | Add required permissions in frontmatter, check org policies |
| MCP tool fails | Server not available or misconfigured | Verify MCP server is accessible, check auth tokens |
| Rate limiting | Too many workflow runs | Add concurrency groups, reduce trigger frequency |
| Workflow hangs | Large repo context or slow AI response | Set timeout-minutes, scope file references |

## Rollback (GitHub)

If a workflow produces undesirable results:

1. **Disable immediately:** `gh workflow disable {name}` or toggle in repo Settings → Actions
2. **Revert outputs:** Close AI-generated PRs, remove applied labels, revert merged changes if needed.
3. **Diagnose:** `gh run view {run-id} --log`
4. **Fix and re-enable:** Update the workflow file, test via manual dispatch, then re-enable.

Platform-equivalent rollback for ADO/GitLab: see the platform reference files.

## Definition of Done

- [ ] Workflow/pipeline file created in the platform-appropriate location (`.github/workflows/`, `azure-pipelines/`, `.gitlab-ci.yml`)
- [ ] Engine/runner configured with appropriate model or agent selection
- [ ] Permissions scoped to minimum required (read-only defaults, write only where needed)
- [ ] MCP tool access configured if needed (with allowlisting)
- [ ] Trigger events appropriate for the workflow's purpose
- [ ] Manual trigger included for testing (`workflow_dispatch` / manual pipeline run / manual pipeline trigger)
- [ ] Workflow tested via manual dispatch with expected outcomes verified
- [ ] Monitoring configured (platform notifications or Slack integration)
- [ ] Documentation updated (README or CONTRIBUTING) to describe the new workflow
