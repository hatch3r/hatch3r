# GitLab CI/CD — Agentic Workflow Patterns

Loaded on demand when `platform: gitlab` in `.agents/hatch.json` or when user is setting up GitLab CI.

GitLab CI uses `.gitlab-ci.yml` at the repo root to define pipelines. Use the `glab ci` CLI for management and monitoring.

## 1. Continuous Test Improvement (GitLab)

```yaml
# .gitlab-ci.yml (or included file)
continuous-test-improvement:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - echo "Analyze test coverage gaps and create MRs with new tests"
```

Configure a pipeline schedule in GitLab (Settings → CI/CD → Schedules) for weekly runs.

## 2. Continuous Triage (GitLab)

Use GitLab webhooks on issue creation to trigger a pipeline that applies labels from the hatch3r taxonomy and adds a triage comment via `glab issue update`.

## 3. Continuous Documentation (GitLab)

Trigger on merge to the default branch. Check if documentation needs updating and open a follow-up MR via `glab mr create`.

## Setup

1. Define jobs in `.gitlab-ci.yml` (or use `include:` for modular files)
2. Configure pipeline schedules for periodic jobs (Settings → CI/CD → Schedules)
3. Set CI/CD variables for secrets (Settings → CI/CD → Variables)
4. Configure protected branches and merge request approvals
5. Monitor runs in CI/CD → Pipelines

## Verification

- **Syntax check:** CI Lint (CI/CD → Editor → Validate) or `glab ci lint`
- **Dry run:** `glab ci run` → `glab ci view`

## Monitoring

- **Execution tracking:** `glab ci list`
- **Failure alerts:** Pipeline email notifications (Settings → Integrations)

## Rollback

1. Disable: pause pipeline schedules in Settings → CI/CD → Schedules, or use the GitLab API
2. Revert outputs: close AI-generated MRs, remove applied labels, revert merged changes if needed
3. Diagnose: `glab ci view {pipeline-id}` or check CI/CD → Pipelines in the web UI
4. Fix and re-enable: update the pipeline file, test via manual dispatch, then re-enable
