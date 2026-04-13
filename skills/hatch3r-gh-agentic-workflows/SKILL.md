---
id: hatch3r-gh-agentic-workflows
description: Set up CI/CD agentic workflows for continuous AI-powered repository automation (GitHub Actions, Azure Pipelines, GitLab CI)
tags: [devops, team]
quality_charter: agents/shared/quality-charter.md
---
# CI/CD Agentic Workflows Integration

> **Platform detection:** Check `platform` in `.agents/hatch.json` to determine which CI/CD system to use. Defaults to `"github"`.

This skill guides setup for AI-powered CI/CD automation in hatch3r-managed projects across all supported platforms.

## Overview

### GitHub Actions (Agentic Workflows)

GitHub Agentic Workflows (technical preview, Feb 2026) bring AI agent orchestration into
GitHub Actions. Agentic Workflows are markdown files in `.github/workflows/` with YAML frontmatter that
compile to GitHub Actions jobs. They support multiple AI engines (GitHub Copilot, Claude,
OpenAI Codex) and use MCP for tool access.

### Azure DevOps Pipelines

Azure Pipelines use YAML files in the repo (typically `azure-pipelines.yml` or files under `.azuredevops/`) to define CI/CD jobs. Use the `az pipelines` CLI for management and monitoring.

### GitLab CI/CD

GitLab CI uses `.gitlab-ci.yml` at the repo root to define pipelines. Use the `glab ci` CLI for management and monitoring.

## Available Workflow Templates

### Platform: GitHub Actions

hatch3r recommends these agentic workflow patterns for GitHub-hosted projects:

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
    branches: [{defaultBranch}]
engine: copilot
permissions:
  contents: write
  pull-requests: write
---
```

Replace `{defaultBranch}` with `board.defaultBranch` from `.agents/hatch.json` (fallback: `"main"`).

After a PR is merged, check if documentation needs updating and open a follow-up PR.

### Platform: Azure DevOps Pipelines

Equivalent pipeline patterns for Azure DevOps:

#### 1. Continuous Test Improvement (ADO)

```yaml
# azure-pipelines/hatch3r-continuous-testing.yml
trigger: none
schedules:
  - cron: '0 6 * * 1'
    displayName: Weekly test improvement
    branches:
      include: [{defaultBranch}]
    always: true

pool:
  vmImage: 'ubuntu-latest'

steps:
  - script: echo "Analyze test coverage gaps and create PRs with new tests"
    displayName: 'AI-assisted test improvement'
```

Replace `{defaultBranch}` with `board.defaultBranch` from `.agents/hatch.json` (fallback: `"main"`).

#### 2. Continuous Triage (ADO)

Use Azure Boards service hooks to trigger a pipeline when a new work item is created. The pipeline applies labels and adds a triage comment.

#### 3. Continuous Documentation (ADO)

Trigger a pipeline on PR completion to the default branch. Check if documentation needs updating and open a follow-up PR via `az repos pr create`.

### Platform: GitLab CI/CD

Equivalent pipeline patterns for GitLab:

#### 1. Continuous Test Improvement (GitLab)

```yaml
# .gitlab-ci.yml (or included file)
continuous-test-improvement:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - echo "Analyze test coverage gaps and create MRs with new tests"
```

Configure a pipeline schedule in GitLab (Settings → CI/CD → Schedules) for weekly runs.

#### 2. Continuous Triage (GitLab)

Use GitLab webhooks on issue creation to trigger a pipeline that applies labels from the hatch3r taxonomy and adds a triage comment via `glab issue update`.

#### 3. Continuous Documentation (GitLab)

Trigger on merge to the default branch. Check if documentation needs updating and open a follow-up MR via `glab mr create`.

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

### GitHub
1. Enable GitHub Agentic Workflows in your repository settings
2. Create workflow files in `.github/workflows/` using the templates above
3. Configure the AI engine (copilot is default, claude and codex are alternatives)
4. Set appropriate permissions for each workflow
5. Monitor workflow runs in the Actions tab

### Azure DevOps
1. Create pipeline YAML files in the repo (e.g., `azure-pipelines/`)
2. Register each pipeline in Azure DevOps (Pipelines → New Pipeline → Existing YAML)
3. Configure service connections and variable groups for secrets
4. Set appropriate pipeline permissions and approvals
5. Monitor runs in Azure Pipelines

### GitLab
1. Define jobs in `.gitlab-ci.yml` (or use `include:` for modular files)
2. Configure pipeline schedules for periodic jobs (Settings → CI/CD → Schedules)
3. Set CI/CD variables for secrets (Settings → CI/CD → Variables)
4. Configure protected branches and merge request approvals
5. Monitor runs in CI/CD → Pipelines

## Verification Steps

1. **Syntax check**: Validate the workflow/pipeline definition:
   - **GitHub:** `gh workflow view {name}` or the Actions web UI
   - **Azure DevOps:** `az pipelines show --name {name}` or the Pipelines web UI
   - **GitLab:** CI Lint (CI/CD → Editor → Validate) or `glab ci lint`
2. **Dry run**: Trigger manually and monitor:
   - **GitHub:** `gh workflow run {name}` → `gh run watch`
   - **Azure DevOps:** `az pipelines run --name {name}` → `az pipelines runs show --id {id}`
   - **GitLab:** `glab ci run` → `glab ci view`
3. **Output review**: Check the AI-generated output (PR/MR, comment, label) for quality and correctness.
4. **Permission audit**: Verify the workflow cannot access resources beyond its declared permissions.
5. **Idempotency**: Run the workflow twice on the same input — it should not create duplicate artifacts.
6. **Error handling**: Trigger with invalid/edge-case input — workflow should fail gracefully with clear error.

## Monitoring

- **Execution tracking**:
  - **GitHub:** `gh run list --workflow={name}`
  - **Azure DevOps:** `az pipelines runs list --pipeline-name {name}`
  - **GitLab:** `glab ci list`
- **Failure alerts**:
  - **GitHub:** Settings → Notifications → Actions
  - **Azure DevOps:** Pipeline notifications (Project Settings → Notifications)
  - **GitLab:** Pipeline email notifications (Settings → Integrations)
- **Cost awareness**: Monitor AI token usage per workflow run. Set spending limits in org settings.
- **Quality metrics**: Track: success rate, output acceptance rate (merged PRs/MRs / total), mean time per run.

## Error Handling

- **Workflow file has YAML syntax errors**: Validate the workflow file locally before pushing (e.g., `actionlint` for GitHub Actions, Azure Pipelines schema validation, or `glab ci lint` for GitLab). Fix all reported errors before committing.
- **AI engine produces low-quality or empty output**: Add explicit context to the workflow prompt (file references, examples, constraints). If the output is still poor after enrichment, switch to a more capable model.
- **Workflow runs exceed cost or time limits**: Add `timeout-minutes` to the workflow, scope file references to reduce context size, and add concurrency groups to prevent parallel runs.

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

1. **Disable immediately**:
   - **GitHub:** `gh workflow disable {name}` or toggle in repo Settings → Actions
   - **Azure DevOps:** `az pipelines update --name {name} --enabled false` or toggle in Pipelines UI
   - **GitLab:** Pause pipeline schedules in Settings → CI/CD → Schedules, or use the GitLab API
2. **Revert outputs**: Close AI-generated PRs/MRs, remove applied labels, revert merged changes if needed.
3. **Diagnose**: Review recent run logs:
   - **GitHub:** `gh run view {run-id} --log`
   - **Azure DevOps:** `az pipelines runs show --id {run-id}` and download logs from the Pipelines UI
   - **GitLab:** `glab ci view {pipeline-id}` or check CI/CD → Pipelines in the web UI
4. **Fix and re-enable**: Update the workflow/pipeline file, test via manual dispatch, then re-enable.

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
