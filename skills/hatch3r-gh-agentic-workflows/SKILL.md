---
id: hatch3r-gh-agentic-workflows
description: Set up GitHub Agentic Workflows for continuous AI-powered repository automation
---
# GitHub Agentic Workflows Integration

GitHub Agentic Workflows (technical preview, Feb 2026) bring AI agent orchestration into
GitHub Actions. This skill guides setup for hatch3r-managed projects.

## Overview

Agentic Workflows are markdown files in `.github/workflows/` with YAML frontmatter that
compile to GitHub Actions jobs. They support multiple AI engines (GitHub Copilot, Claude,
OpenAI Codex) and use MCP for tool access.

## Available Workflow Templates

hatch3r recommends these agentic workflow patterns for projects:

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

When a new issue is opened, analyze it, apply labels from the hatch3r taxonomy
(type:*, priority:*, area:*), and add a triage summary comment.

### 3. Continuous Documentation

Keep documentation aligned with code changes.

```yaml
# .github/workflows/hatch3r-continuous-docs.md
---
name: Continuous Documentation
on:
  pull_request:
    types: [closed]
    branches: [main]
engine: copilot
permissions:
  contents: write
  pull-requests: write
---
```

After a PR is merged, check if documentation needs updating and open a follow-up PR.

## Security Considerations

- Workflows run in sandboxed environments with minimal permissions
- Use read-only defaults; only grant write permissions when needed
- Review all AI-generated changes before merging
- Network isolation and tool allowlisting are enforced by the runtime

## Integration with hatch3r

- hatch3r's label taxonomy (type:*, executor:*, priority:*) aligns with agentic triage
- The hatch3r-test-writer agent's patterns can inform continuous testing workflows
- The hatch3r-docs-writer agent's patterns can inform continuous documentation
- Board management commands complement continuous triage

## Setup

1. Enable GitHub Agentic Workflows in your repository settings
2. Create workflow files in `.github/workflows/` using the templates above
3. Configure the AI engine (copilot is default, claude and codex are alternatives)
4. Set appropriate permissions for each workflow
5. Monitor workflow runs in the Actions tab

## Verification Steps

1. **Syntax check**: Validate the workflow file with `gh workflow view {name}` or the GitHub Actions web UI.
2. **Dry run**: Trigger manually via `gh workflow run {name}` and monitor with `gh run watch`.
3. **Output review**: Check the AI-generated output (PR, comment, label) for quality and correctness.
4. **Permission audit**: Verify the workflow cannot access resources beyond its declared permissions.
5. **Idempotency**: Run the workflow twice on the same input — it should not create duplicate artifacts.
6. **Error handling**: Trigger with invalid/edge-case input — workflow should fail gracefully with clear error.

## Monitoring

- **Execution tracking**: Use `gh run list --workflow={name}` to monitor recent runs.
- **Failure alerts**: Configure GitHub Actions notifications (Settings → Notifications → Actions).
- **Cost awareness**: Monitor AI token usage per workflow run. Set spending limits in org settings.
- **Quality metrics**: Track: success rate, output acceptance rate (merged PRs / total PRs), mean time per run.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Workflow doesn't trigger | Incorrect `on:` event or branch filter | Verify event type matches, check branch protection rules |
| AI output is empty/poor | Insufficient context in workflow body | Add more context, reference specific files, include examples |
| Permission denied | Missing or insufficient permissions | Add required permissions in frontmatter, check org policies |
| MCP tool fails | Server not available or misconfigured | Verify MCP server is accessible, check auth tokens |
| Rate limiting | Too many workflow runs | Add concurrency groups, reduce trigger frequency |
| Workflow hangs | Large repo context or slow AI response | Set timeout-minutes, scope file references |

## Rollback

If a workflow produces undesirable results:

1. **Disable immediately**: `gh workflow disable {name}` or toggle in repo Settings → Actions.
2. **Revert outputs**: Close AI-generated PRs, remove applied labels, revert merged changes if needed.
3. **Diagnose**: Review recent run logs with `gh run view {run-id} --log`.
4. **Fix and re-enable**: Update the workflow file, test via manual dispatch, then re-enable.

## Definition of Done

- [ ] Workflow file created in `.github/workflows/` with correct YAML frontmatter
- [ ] Engine configured (copilot/claude/codex) with appropriate model selection
- [ ] Permissions scoped to minimum required (read-only defaults, write only where needed)
- [ ] MCP tool access configured if needed (with allowlisting)
- [ ] Trigger events appropriate for the workflow's purpose
- [ ] Manual `workflow_dispatch` trigger included for testing
- [ ] Workflow tested via manual dispatch with expected outcomes verified
- [ ] Monitoring configured (GitHub Actions notifications or Slack integration)
- [ ] Documentation updated (README or CONTRIBUTING) to describe the new workflow
