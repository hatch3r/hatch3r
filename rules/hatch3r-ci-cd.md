---
id: hatch3r-ci-cd
type: rule
description: CI/CD pipeline standards covering stage gates, deployment strategies, and rollback procedures
scope: always
---
# CI/CD Standards

## Pipeline Design

- Every pipeline must have these ordered stages: install, lint, typecheck, test, build, deploy.
- Stages within the same tier run in parallel. Cross-tier stages are sequential.
- Fail fast: a failing stage must abort all downstream stages immediately.
- Pipeline configuration lives in version control alongside the application code.
- Use matrix builds for multi-platform or multi-version testing.

## Stage Gates

- **Lint gate:** Zero warnings policy. New warnings block the pipeline.
- **Type gate:** Strict mode with no suppressions. Type errors are build failures.
- **Test gate:** All tests pass. Coverage must not decrease from the base branch.
- **Security gate:** Dependency vulnerability scan with no critical/high findings.
- **Build gate:** Artifact must be reproducible — same commit produces identical output.

## Artifact Management

- Build artifacts once per commit. Promote the same artifact across environments.
- Tag artifacts with: git SHA, branch name, build timestamp, pipeline run ID.
- Retention policy: production artifacts 90 days, staging 30 days, PR artifacts 7 days.
- Store build metadata (dependencies, test results, coverage) alongside the artifact.
- Never deploy an artifact that hasn't passed all stage gates.

## Deployment Strategies

- **Staging:** Auto-deploy on merge to the default branch. No manual approval needed.
- **Production:** Require explicit approval from at least one team member.
- Use progressive deployment (canary or blue-green) for production services.
- Set automatic rollback triggers: error rate > 1%, latency p99 > 2x baseline, health check failures.
- Database migrations run before application deployment. They must be backward-compatible.

## Environment Promotion

- Environments: `development` → `staging` → `production`.
- Each promotion uses the exact same artifact — no rebuilds between environments.
- Environment-specific configuration is injected at deploy time, not build time.
- Feature flags control feature availability per environment, not code branches.
- Staging must mirror production infrastructure as closely as possible.

## Rollback Procedures

- Every deployment must support instant rollback to the previous version.
- Rollback is a deployment of the previous artifact, not a code revert.
- Database rollback scripts (`down` migrations) must be tested before every deployment.
- Rollback decision criteria: automated monitoring triggers OR manual team decision within 30 minutes.
- Post-rollback: create an incident ticket, run root cause analysis, fix forward.

## Branch Protection

- The default branch requires: passing CI, at least one approval, no force pushes.
- Feature branches auto-delete after merge.
- Release branches (if used) follow the same protection as the default branch.
- Direct commits to the default branch are forbidden — all changes go through PRs.

## Secrets Management in CI

- Never store secrets in pipeline configuration files.
- Use the CI platform's secret storage (GitHub Secrets, GitLab CI Variables, etc.).
- Rotate CI secrets on a regular schedule (at least quarterly).
- Audit secret access logs for unauthorized usage.
- Use OIDC-based authentication for cloud provider access instead of long-lived credentials.
