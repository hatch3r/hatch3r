---
id: hatch3r-ci-pipeline
type: skill
description: Design and optimize CI/CD pipelines. Covers stage design, test parallelization, artifact management, and pipeline performance.
---

# CI Pipeline Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Audit existing pipeline
- [ ] Step 2: Design stage structure
- [ ] Step 3: Optimize test parallelization
- [ ] Step 4: Configure artifact management
- [ ] Step 5: Implement and validate
```

## Step 1: Audit Existing Pipeline

- Map the current pipeline stages, their dependencies, and execution times.
- Identify bottlenecks: which stages take the longest? Which block others unnecessarily?
- Check for flaky tests that cause unnecessary reruns.
- Review resource usage: are runners appropriately sized? Are caches effective?
- Measure total pipeline duration from push to deployable artifact.

## Step 2: Design Stage Structure

- Organize into logical stages: install, lint, typecheck, unit test, integration test, build, deploy.
- Maximize parallelism: lint, typecheck, and unit tests can run in parallel after install.
- Use fail-fast: if lint fails, skip tests. If unit tests fail, skip integration tests.
- Gate deployments behind all quality checks.
- Separate environment-specific deployment stages (staging, production) with manual approval gates for production.

## Step 3: Optimize Test Parallelization

- Split test suites across multiple runners using test file sharding or test duration-based splitting.
- Use test timing data from previous runs to balance shard workloads.
- Run unit tests and integration tests on separate runners in parallel.
- For monorepos: only run tests for changed packages and their dependents.
- Cache test results for unchanged code paths where the test framework supports it.

## Step 4: Configure Artifact Management

- Build artifacts once, deploy the same artifact to all environments.
- Tag artifacts with commit SHA and build number for traceability.
- Set retention policies: keep production artifacts longer, clean up PR artifacts after merge.
- Store build metadata (git SHA, branch, build time, test results) alongside artifacts.
- Use content-addressable storage or artifact registries appropriate to the project (npm, Docker, S3).

## Step 5: Implement and Validate

- Implement pipeline changes incrementally — test each stage change in a feature branch.
- Verify caching works correctly: first run populates cache, second run uses it.
- Confirm parallel stages don't have hidden dependencies causing race conditions.
- Measure pipeline duration improvement against the baseline from Step 1.
- Document the pipeline architecture for the team.

## Pipeline Performance Targets

| Metric | Target |
|--------|--------|
| Lint + typecheck | < 2 minutes |
| Unit tests | < 5 minutes |
| Integration tests | < 10 minutes |
| Full pipeline (push to artifact) | < 15 minutes |
| Cache hit ratio | > 80% |

## Definition of Done

- [ ] Pipeline stages optimized with maximum parallelism
- [ ] Test parallelization configured and balanced
- [ ] Artifact management with retention policies
- [ ] Pipeline duration meets performance targets
- [ ] Documentation updated with pipeline architecture
