---
id: hatch3r-ci-pipeline
name: hatch3r-ci-pipeline
type: skill
description: Design and optimize CI/CD pipelines. Covers stage design, test parallelization, artifact management, and pipeline performance.
tags: [devops]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# CI Pipeline Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Audit existing pipeline
- [ ] Step 2: Design stage structure
- [ ] Step 3: Optimize test parallelization
- [ ] Step 4: Configure artifact management
- [ ] Step 5: Implement and validate
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: CI platform (GitHub Actions vs GitLab vs CircleCI vs Azure Pipelines), pipeline duration target, runner sizing budget, deploy gate (auto vs manual approval for prod), and artifact retention policy.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

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
- Verify caching works: first run populates cache, second run uses it (confirmed by cache hit log output).
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

## Error Handling

- **Pipeline config syntax errors**: Validate workflow YAML locally (e.g., `actionlint` for GitHub Actions) before pushing. Report the exact line and field causing the parse failure.
- **Flaky tests block pipeline**: Identify the flaky test(s) by re-running the failing job. If confirmed flaky, quarantine the test with a tracking issue reference and unblock the pipeline.
- **Cache invalidation causes slow builds**: Verify cache key patterns match the lockfile hash. If caches are stale, clear them and document the corrected key strategy.

## Definition of Done

- [ ] Pipeline stages optimized with maximum parallelism
- [ ] Test parallelization configured and balanced
- [ ] Artifact management with retention policies
- [ ] Pipeline duration meets performance targets
- [ ] Documentation updated with pipeline architecture
