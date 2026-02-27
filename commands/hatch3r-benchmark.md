---
id: hatch3r-benchmark
type: command
description: Run and analyze performance benchmarks. Compare results against baselines, identify regressions, and produce performance reports.
---
# Performance Benchmark

## Inputs

- **Target:** specific file, function, endpoint, or `all` for full suite
- **Baseline:** `previous-run` (default), git ref (branch/tag/SHA), or `none` (no comparison)
- **Iterations:** number of benchmark runs for statistical significance (default: 5)

## Procedure

1. **Discover benchmarks:**
   - Scan for benchmark files (`.bench.ts`, `.benchmark.ts`, `__benchmarks__/`, `bench/`)
   - If no benchmarks exist, identify critical paths and suggest benchmark candidates

2. **Run benchmarks:**
   - Execute benchmark suite with the specified iterations
   - Capture: execution time (mean, p50, p95, p99), memory usage, throughput (ops/sec)
   - Run in a clean state (cold start) and warm state

3. **Compare against baseline:**
   - If baseline is `previous-run`, read last saved benchmark results from `.benchmarks/results.json`
   - If baseline is a git ref, checkout that ref, run benchmarks, then compare
   - Calculate: absolute difference, percentage change, statistical significance

4. **Identify regressions:**
   - Flag any metric that regressed > 10% from baseline
   - For regressions, identify the likely cause (new code in hot path, additional allocations, etc.)
   - Classify: `critical` (> 50% regression), `warning` (10-50%), `acceptable` (< 10%)

5. **Generate report:**
   - Summary table with all metrics and comparison
   - Detailed analysis for any regressions
   - Recommendations for optimization if regressions found
   - Save results to `.benchmarks/results.json` for future comparisons

## Output

- Performance report in markdown format
- Updated baseline results file
- Regression alerts with severity classification

## Related

- **Skill:** `hatch3r-perf-audit` — comprehensive performance profiling
- **Agent:** `hatch3r-perf-profiler` — agent for deep performance investigation
