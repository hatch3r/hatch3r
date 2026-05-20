# Azure DevOps Pipelines — Agentic Workflow Patterns

Loaded on demand when `platform: azure-devops` in `.hatch3r/hatch.json` or when user is setting up Azure DevOps CI.

Azure Pipelines use YAML files in the repo (typically `azure-pipelines.yml` or files under `.azuredevops/`) to define CI/CD jobs. Use the `az pipelines` CLI for management and monitoring.

## 1. Continuous Test Improvement (ADO)

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

Replace `{defaultBranch}` with `board.defaultBranch` from `.hatch3r/hatch.json` (fallback: `"main"`).

## 2. Continuous Triage (ADO)

Use Azure Boards service hooks to trigger a pipeline when a new work item is created. The pipeline applies labels and adds a triage comment.

## 3. Continuous Documentation (ADO)

Trigger a pipeline on PR completion to the default branch. Check if documentation needs updating and open a follow-up PR via `az repos pr create`.

## Setup

1. Create pipeline YAML files in the repo (e.g., `azure-pipelines/`)
2. Register each pipeline in Azure DevOps (Pipelines → New Pipeline → Existing YAML)
3. Configure service connections and variable groups for secrets
4. Set appropriate pipeline permissions and approvals
5. Monitor runs in Azure Pipelines

## Verification

- **Syntax check:** `az pipelines show --name {name}` or the Pipelines web UI
- **Dry run:** `az pipelines run --name {name}` → `az pipelines runs show --id {id}`

## Monitoring

- **Execution tracking:** `az pipelines runs list --pipeline-name {name}`
- **Failure alerts:** Pipeline notifications (Project Settings → Notifications)

## Rollback

1. Disable: `az pipelines update --name {name} --enabled false` or toggle in Pipelines UI
2. Revert outputs: close AI-generated PRs, remove applied labels, revert merged changes if needed
3. Diagnose: `az pipelines runs show --id {run-id}` and download logs from the Pipelines UI
4. Fix and re-enable: update the pipeline file, test via manual dispatch, then re-enable
