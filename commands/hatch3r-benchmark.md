---
id: hatch3r-benchmark
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-performance, hatch3r-docs-writer]
description: Run and analyze performance benchmarks. Compare results against baselines, identify regressions, and produce performance reports.
tags: [review, performance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 3
  rationale: Three-stage pipeline per agentPipeline — researcher gathers prior baselines, performance (CQ7) executes the suite, docs-writer assembles the report; each receives the run cache and emits a structured slice. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: contradictory inputs, missing target, unknown convention.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Discovery | `hatch3r-researcher` (codebase-analysis mode) | No | Yes |
| 2. Execution | Orchestrator (inline, runs benchmarks) | No | Yes |
| 3. Analysis | `hatch3r-performance` | No | Yes |
| 4. Reporting | `hatch3r-docs-writer` | No | If regressions found |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

# Performance Benchmark — Run, Compare, and Report on Performance Metrics

Run performance benchmarks against a target (file, function, endpoint, or full suite), compare results against a baseline (previous run, git ref, or none), and produce a structured performance report. Discovers existing benchmark files or proposes new ones for critical paths. Executes with configurable iterations, performs statistical analysis on results, and flags regressions with root cause tracing. Persists results to `.benchmarks/results.json` for longitudinal tracking. AI proposes all actions; user confirms at every checkpoint.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that may be useful for regression issue creation. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once benchmark discovery results are collected, reference them in memory — do not re-scan the filesystem.
2. **Limit source reads.** When reading source files to identify critical paths, read function signatures and hot-path sections only — not entire files.
3. **Structured output only.** All sub-agent prompts and benchmark results require structured markdown output — no prose dumps.
4. **Compress raw metrics.** Store full raw data in `.benchmarks/results.json` but present only summary statistics (mean, p50, p95, p99, stddev) in the report.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: the Step 7 statistical-significance verdict (CV, t-test, reliability flag) and every Step 8 root-cause attribution MUST carry a high/medium/low confidence rating sourced from the hatch3r-performance sub-agent. A `noisy` classification (CV > 15%) maps to low confidence. Dropping the signal between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

## Step 0: Triage

Classify the benchmark request before delegating:

- **Tier 1 (trivial)**: single benchmark with `none` baseline or quick re-run of an existing suite; inline execution, no `hatch3r-performance` fanout.
- **Tier 2 (standard)**: standard suite with `previous-run` or git-ref baseline; standard pipeline including statistical analysis and reporting.
- **Tier 3 (deep)**: full-suite cross-environment benchmark with regression triage and root-cause tracing; full pipeline with research and confirm scope with the user before saving results.

If Tier 1, complete inline and skip the analysis fanout. If Tier 2, run the standard pipeline below. If Tier 3, run the full pipeline with research and confirm scope with the user before saving results.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 2 discovery researcher), surface the cost preview so a full-suite benchmark run is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 inline ~0, Tier 2 ~2 (performance + docs-writer when regressions), Tier 3 up to 3>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

The benchmark suite execution time (Step 5) is wall-clock measurement, not LLM cost — report it separately in `estimated_duration_min` so the cost delta is not skewed by iteration count. Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a quick re-run scored as Deep, or a full cross-environment suite scored as Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- The override does NOT lower the minimum-3-iterations statistical-validity floor (Guardrails) — measurement rigor is independent of effort tier.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Gather Benchmark Context

1. **ASK:** "Tell me about the benchmarks you want to run. I need:
   - **Target:** specific file, function, endpoint, module, or `all` for the full suite
   - **Baseline:** `previous-run` (default — loads last saved results), a git ref (branch/tag/SHA to compare against), or `none` (no comparison)
   - **Iterations:** number of benchmark runs for statistical significance (default: 5, minimum: 3)
   - **Environment constraints:** CI vs. local, Node version, memory limits, specific flags (e.g., `--expose-gc`)
   - **Metrics of interest:** time (default), memory, throughput (ops/sec), or `all`

   You can also point me to an existing benchmark config file and I'll extract these from it."

2. If the user provides a config reference, read it and extract the fields above.
3. Present a structured summary:

```
Benchmark Brief:
  Target:       {target — file/function/endpoint/all}
  Baseline:     {previous-run / git-ref / none}
  Iterations:   {N}
  Environment:  {CI / local — Node version, flags}
  Metrics:      {time / memory / throughput / all}
```

**ASK:** "Does this capture the benchmark plan? Adjust anything before I begin discovery."

---

### Step 2: Discover Benchmarks

Delegate to `hatch3r-researcher` in `codebase-analysis` mode with focus on benchmark discovery.

1. Scan the codebase for existing benchmark infrastructure:
   - Benchmark files: `*.bench.ts`, `*.benchmark.ts`, `*.bench.js`, `*.benchmark.js`
   - Benchmark directories: `__benchmarks__/`, `bench/`, `benchmarks/`
   - Test runner bench support: vitest `bench` mode, jest-bench, tinybench, benny
   - Package.json scripts: any script containing `bench` or `benchmark`
   - Existing results: `.benchmarks/`, `benchmark-results/`, or similar
2. If benchmarks are found, catalog them:

```
Benchmark Discovery:
  Files found:      {N} benchmark files
  Runner:           {vitest bench / tinybench / benny / custom}
  Existing results: {found at path / not found}
  Coverage:         {which modules/functions have benchmarks}
  Gaps:             {critical paths without benchmarks}
```

3. If the target is a specific file/function, verify a corresponding benchmark exists.

**ASK:** "Here are the benchmarks I found. Confirm which to run:
{numbered list of benchmark files/suites with brief description}

Select: (a) all listed, (b) specific numbers, (c) let me suggest new benchmarks first"

---

### Step 3: Suggest Benchmarks (If Needed)

Skip this step if the user confirmed existing benchmarks in Step 2 and no gaps were identified.

1. Identify critical paths that lack benchmarks:
   - Functions with high cyclomatic complexity
   - Hot paths (called frequently based on import graph analysis)
   - I/O-bound operations (database queries, file operations, network calls)
   - Data transformation pipelines (parsing, serialization, mapping)
   - Functions the user specifically targeted in Step 1
2. For each candidate, propose a benchmark skeleton:

```
Benchmark Candidates:
  1. {function/module} — {why it's a critical path}
     Suggested benchmark: {brief description of what to measure}
  2. {function/module} — {why it's a critical path}
     Suggested benchmark: {brief description of what to measure}
```

**ASK:** "These critical paths lack benchmarks. Options:
- **(a) Create benchmarks** for selected candidates (tell me which numbers)
- **(b) Skip** — run only existing benchmarks
- **(c) Create all** suggested benchmarks"

3. If the user approves creation, generate benchmark files following the detected runner conventions (vitest bench, tinybench, etc.). Present file contents for review before writing.

---

### Step 4: Environment Preparation

1. Verify clean execution state:
   - Check for running dev servers, watchers, or other processes that consume CPU/memory
   - Warn if detected: "Found {N} background processes that may affect benchmark stability: {list}"
2. Set environment:
   - `NODE_ENV=production` (unless the user specified otherwise)
   - Apply any flags from Step 1 (e.g., `--expose-gc` for memory benchmarks)
3. If baseline is a git ref:
   - Verify the ref exists: `git rev-parse --verify {ref}`
   - Check for uncommitted changes that would block checkout
4. Present readiness check:

```
Environment Ready:
  NODE_ENV:          {production}
  Node version:      {version}
  Background noise:  {none / warnings listed}
  Baseline ref:      {verified / N/A}
  Working tree:      {clean / uncommitted changes — list}
```

If uncommitted changes exist and baseline requires git checkout, **ASK:** "Uncommitted changes detected. Options: (a) stash and continue, (b) abort baseline comparison, (c) use `previous-run` baseline instead"

---

### Step 5: Execute Benchmarks

1. Run the benchmark suite with the specified iterations:
   - Cold start run (first iteration, not counted in statistics)
   - Warm runs (remaining N iterations, used for statistics)
2. Capture metrics per benchmark:
   - **Time:** mean, median (p50), p95, p99, min, max, standard deviation
   - **Memory:** heap used (mean, peak), RSS delta, GC pause time (if `--expose-gc`)
   - **Throughput:** operations per second, iterations completed
3. Monitor execution:
   - Report progress: "Running benchmark {M}/{total} — {name}... iteration {I}/{N}"
   - If a single benchmark takes >60s per iteration, warn the user
   - If a benchmark crashes, capture the error and continue with remaining benchmarks
4. Store raw results in memory for analysis.

---

### Step 6: Baseline Comparison

Skip if baseline is `none`.

1. **If baseline is `previous-run`:**
   - Load `.benchmarks/results.json`
   - If file does not exist, warn and skip comparison
   - Match benchmarks by name — report any that exist in one set but not the other
2. **If baseline is a git ref:**
   - Stash current changes (if any)
   - Checkout the baseline ref
   - Run the same benchmark suite with the same iterations and environment
   - Checkout the original branch and restore stash
   - Match benchmarks by name
3. Compute deltas for each matched benchmark:

```
Comparison:
  Benchmark        | Metric   | Baseline   | Current    | Delta     | Change
  {name}           | time p50 | {value}    | {value}    | {±value}  | {±%}
  {name}           | ops/sec  | {value}    | {value}    | {±value}  | {±%}
  {name}           | heap     | {value}    | {value}    | {±value}  | {±%}
```

---

### Step 7: Statistical Analysis

Delegate to `hatch3r-performance` (CQ7) for analysis of the collected metrics.

1. Calculate statistical significance for each delta:
   - Use coefficient of variation (CV) to assess measurement noise
   - Flag results with CV > 15% as **noisy** — increase iterations recommended
   - Apply t-test or equivalent for significance (p < 0.05 threshold)
2. Identify outliers:
   - Runs that deviate > 2 standard deviations from mean
   - Report outlier count and whether they skew results
3. Classify each benchmark result:

| Classification | Criteria | Action |
|---------------|----------|--------|
| `regression-critical` | > 50% slower or > 2x memory | Immediate attention |
| `regression-warning` | 10–50% slower or 50–100% more memory | Investigation recommended |
| `acceptable` | < 10% change in either direction | No action needed |
| `improvement` | > 10% faster or less memory | Note for celebration |
| `noisy` | CV > 15% — results unreliable | Rerun with more iterations |

**ASK:** "Here is the benchmark summary:
- {N} benchmarks executed across {M} iterations
- {X} regressions ({critical count} critical, {warning count} warning)
- {Y} improvements
- {Z} noisy results

Want me to perform deep analysis on any specific metric or benchmark? (list numbers / all regressions / skip to report)"

---

### Step 8: Root Cause Analysis (If Regressions Found)

Skip if no regressions classified as `regression-critical` or `regression-warning` in Step 7.

1. For each regression > 10%, trace to specific code changes:
   - If baseline is a git ref: `git diff {ref}...HEAD -- {affected files}`
   - Identify new code in hot paths, additional allocations, changed algorithms
   - Cross-reference with import graph to find indirect causes
2. Categorize root causes:

| Pattern | Example | Typical Fix |
|---------|---------|-------------|
| Hot path expansion | New validation/logging in critical loop | Move out of loop, lazy evaluate |
| Allocation increase | New object creation per iteration | Object pooling, pre-allocation |
| Algorithm change | O(n) → O(n²) in data processing | Restore or optimize algorithm |
| Dependency overhead | New import initializing at load time | Lazy import, tree-shake |
| Serialization cost | Larger payloads, new fields | Selective serialization |

3. Present findings per regression:

```
Regression Analysis: {benchmark name}
  Metric:     {metric} — {baseline} → {current} ({+%} regression)
  Root cause: {description}
  Files:      {affected files with line ranges}
  Category:   {pattern from table above}
  Suggested fix: {brief recommendation}
```

---

### Step 9: Generate Report

Delegate to `hatch3r-docs-writer` if regressions were found (for a polished report); otherwise the orchestrator generates inline.

Present the full report for review before saving. Use the **Output Template** below.

**ASK:** "Here is the benchmark report. Review before I save:
- {N} benchmarks, {M} iterations, {environment}
- {X} regressions, {Y} improvements, {Z} stable
- Report file: `.benchmarks/report-{date}.md`

Confirm, or tell me what to adjust."

---

### Step 10: Save Results

1. Save raw results to `.benchmarks/results.json` (create directory if needed):
   - Timestamp, git SHA, branch, environment metadata
   - Per-benchmark: all iterations, computed statistics, classification
   - Comparison deltas (if baseline was used)
2. Save the markdown report to `.benchmarks/report-{YYYY-MM-DD}.md`.
3. Present a summary of files created:

```
Files Created/Updated:
  .benchmarks/
    results.json                — {N} benchmarks, {M} iterations, {timestamp}
    report-{YYYY-MM-DD}.md     — full benchmark report
```

**ASK:** "Results saved. Should these become the new baseline for future comparisons? (yes — overwrites previous baseline / no — keep existing baseline)"

If yes, save `results.json` as the canonical baseline for the next `previous-run` comparison.

---

## Output Template

The benchmark report follows this structure:

```markdown
# Performance Benchmark Report

**Date:** {YYYY-MM-DD}
**Branch:** {branch} @ {short SHA}
**Baseline:** {previous-run / git ref / none}
**Environment:** {Node version}, {OS}, {CI/local}
**Iterations:** {N} (+ 1 cold start, excluded)

## Summary

| Status | Count |
|--------|-------|
| Regressions (critical) | {N} |
| Regressions (warning) | {N} |
| Stable | {N} |
| Improvements | {N} |
| Noisy (inconclusive) | {N} |

## Results

| Benchmark | Metric | Baseline | Current | Delta | Status |
|-----------|--------|----------|---------|-------|--------|
| {name} | time (p50) | {value}ms | {value}ms | {±%} | {status icon} |
| {name} | ops/sec | {value} | {value} | {±%} | {status icon} |
| {name} | heap (mean) | {value}MB | {value}MB | {±%} | {status icon} |

### Statistical Confidence

| Benchmark | CV (%) | Outliers | Significance | Reliable |
|-----------|--------|----------|-------------|----------|
| {name} | {value}% | {N}/{total} | p={value} | {yes/no} |

## Regressions

### {Benchmark Name} — {metric} regression ({+%})

**Severity:** {critical / warning}
**Baseline:** {value} → **Current:** {value} ({±absolute}, {±%})

**Root Cause:**
{description of what changed and why it's slower}

**Affected Code:**
- `{file}:{line range}` — {what changed}

**Recommendation:**
{specific optimization suggestion}

## Improvements

| Benchmark | Metric | Baseline | Current | Improvement |
|-----------|--------|----------|---------|-------------|
| {name} | {metric} | {value} | {value} | {-%} faster |

## Environment Details

| Property | Value |
|----------|-------|
| Node.js | {version} |
| OS | {platform, arch} |
| CPU | {model, cores} |
| Memory | {total} |
| Runner | {vitest bench / tinybench / custom} |
| Flags | {--expose-gc, etc.} |

## Recommendations

1. {prioritized optimization recommendation}
2. {recommendation}

---

*Generated by hatch3r-benchmark — {timestamp}*
```

---

## Resumability (Decision 27/30)

benchmark is long-running — a Tier 3 full-suite run executes a multi-iteration benchmark sweep (Step 5), statistical analysis (Step 7), and regression root-cause delegation (Step 8) across the researcher → performance → docs-writer pipeline. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-running the suite from scratch — benchmark iterations are expensive wall-clock and the statistical-validity floor mandates a minimum of 3 iterations per Guardrails.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.benchmark-workspace/`; step range the Step 0 → Step 10 progression; `wave` = suite/iteration batch index; snapshot/rollback paths `.benchmarks/results.json` and any report files under `docs/performance/`. Write points: after Step 1 context discovery, after Step 2 benchmark inventory locks, after Step 4 environment preparation is confirmed, after every Step 5 iteration batch completes (so partial measurements survive a crash and are not re-collected), after Step 6 baseline comparison, after Step 7 statistical analysis, after Step 8 root-cause delegation returns, after Step 9 report assembly, and after Step 10 results are persisted to `.benchmarks/results.json`.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for benchmark: `1` = scope + tool selection, `2` = benchmark execution / sub-agent dispatch, `3` = result aggregation + regression detection, `4` = report + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: benchmark reports, baseline updates, dashboard refreshes.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 28, superseded in place 2026-07-06).

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first researcher dispatch (Step 2 discovery).
- **Post-execution `cost_actuals` + `delta`** — the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 3` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 0 (inline discovery + execution, no fan-out); Tier 2 ≈ 2 (performance for analysis + docs-writer when regressions found); Tier 3 up to 3 (researcher + performance + docs-writer). Benchmark wall-clock execution is reported separately and not counted as LLM token cost. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Benchmarks fail to run:** Capture the error output. Check for missing dependencies, syntax errors, or runner misconfiguration. Present the error and ASK: "Benchmark {name} failed to execute: {error}. Options: (a) skip and continue with remaining, (b) attempt to fix the benchmark file, (c) abort."
- **Baseline ref does not exist:** If `git rev-parse --verify {ref}` fails, report the error and ASK: "Baseline ref `{ref}` not found. Options: (a) use `previous-run` instead, (b) run without comparison, (c) provide a different ref."
- **No previous results file:** If baseline is `previous-run` but `.benchmarks/results.json` does not exist, warn and proceed without comparison. Note in the report that this is a baseline-establishing run.
- **Results too noisy (high variance):** If CV > 15% for more than half the benchmarks, flag the entire run as unreliable. ASK: "Results show high variance — likely environmental interference. Options: (a) rerun with more iterations ({current × 2}), (b) accept results with noise caveat, (c) abort and retry in a cleaner environment."
- **Benchmark timeout:** If a single benchmark exceeds 5 minutes per iteration, kill it and report. ASK whether to skip or increase the timeout.
- **Git checkout failure during baseline comparison:** If stash/checkout fails (merge conflicts, dirty state), abort the baseline comparison gracefully. Fall back to `previous-run` or `none` and inform the user.
- **Disk space for results:** If `.benchmarks/results.json` grows excessively (> 10MB), warn and suggest pruning old entries.

## Guardrails

- **Never modify production code based on benchmark results.** The benchmark command observes and reports — it never changes application source code. Optimization changes require a separate implementation task.
- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Flag CI vs. local execution.** Results from different environments must not share a baseline. Include environment fingerprint in `results.json` and warn if comparing across environments.
- **Minimum 3 iterations for statistical validity.** If the user requests fewer, override to 3 and explain why.
- **Always exclude the cold start run from statistics.** The first iteration warms caches and JIT — including it skews results.
- **Never overwrite baseline without confirmation.** Step 10 explicitly asks before promoting results to baseline status.
- **Preserve existing `.benchmarks/results.json` history.** Append new runs; do not truncate historical data without user approval.
- **Do not benchmark in debug mode.** Verify `NODE_ENV=production` and no debug flags are active unless explicitly requested.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Report, don't interpret subjectively.** Present statistical facts. Flag regressions by threshold, not opinion. Let the user decide what matters.

## Related

- **Agent:** `hatch3r-performance` (CQ7) — deep performance profiling and analysis
- **Check:** `checks/performance.md` — performance budget checks
- **Rule:** `hatch3r-performance-budgets` — performance budget thresholds and enforcement
- **Command:** `hatch3r-refactor-plan` — plan optimizations identified by benchmark regressions
