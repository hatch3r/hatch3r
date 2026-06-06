---
id: hatch3r-perf-audit
name: hatch3r-perf-audit
type: skill
description: Profile and optimize application performance against defined budgets. Use when investigating performance issues, auditing performance budgets, or optimizing hot paths.
tags: [review, performance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Performance Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read performance budgets from rules and specs
- [ ] Step 2: Profile — bundle size, runtime, memory
- [ ] Step 3: Identify violations — which budgets exceeded, which hot paths slow
- [ ] Step 4: Plan optimizations — code splitting, lazy loading, memoization, etc.
- [ ] Step 5: Implement optimizations with before/after measurements
- [ ] Step 6: Verify all budgets met, no regressions
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: target surface (frontend bundle vs backend cold start vs DB query), budget threshold values, profiling environment (local vs CI vs production), regression policy (revert vs ship-and-monitor), and whether optimization is allowed to introduce new deps.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Read Performance Budgets

Load the project's performance budgets from project rules and quality documentation:

- Common metrics: render frame rate, cold start to interactive, idle CPU usage, memory footprint, event processing latency, bundle size (initial, gzipped), database reads per session, API warm execution.
- Note which surface is in scope: frontend, backend, or both.
- Read project architecture docs for constraints if auditing a specific module.

## Step 2: Profile

**Bundle size:**

- Run `npm run build`. Inspect output for gzipped sizes.
- Use `vite-bundle-visualizer`, `rollup-plugin-visualizer`, or `webpack-bundle-analyzer` (or build tool equivalent) to identify large chunks and dependencies.
- Compare bundle sizes if multiple build targets exist.

**Runtime (frontend):**

- Use Chrome DevTools Performance tab: record startup, record key interactions.
- Measure: Time to Interactive (TTI), First Contentful Paint (FCP), Largest Contentful Paint (LCP).
- Use **cursor-ide-browser MCP** `browser_profile_start`/`browser_profile_stop` for CPU profiling with call stacks.
- Check frame rate during animations (target: 60fps, 16ms/frame).

**Memory:**

- Heap snapshot before/after session. Target per project budget.
- Look for leaks: detached DOM, growing arrays, uncleared timers.

**Backend/API:**

- Check monitoring for cold start and warm execution times.
- Instrument key paths.

- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 3: Identify Violations

- List which budgets are exceeded and by how much.
- Identify hot paths: which functions/components contribute most to latency or bundle size.
- Prioritize: critical user flows first.
- Document baseline measurements for comparison.

## Step 4: Plan Optimizations

Common strategies:

- **Code splitting:** Route-based or component-based. Lazy-load panels, modals, non-critical features.
- **Lazy loading:** `defineAsyncComponent`, dynamic `import()` for heavy components.
- **Memoization:** `computed`, `memo` for expensive derivations. Avoid unnecessary re-renders.
- **Reduce re-renders:** `v-show` over `v-if` for frequently toggled. `shallowRef` where appropriate.
- **Bundle:** Remove unused deps, replace heavy libs with lighter alternatives, tree-shake.
- **Images/assets:** Optimize, lazy-load, use appropriate formats.
- **Database:** Reduce reads (batch, cache, denormalize).
- **Cloud/API:** Warm-up strategies, reduce cold starts.

- Check project ADRs for constraints. Verify optimizations do not violate privacy/security invariants documented in the ADRs.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 5: Implement Optimizations

- Apply changes incrementally. Measure before and after each change.
- Document before/after for each metric in PR/MR or audit report (check `platform` in `.hatch3r/hatch.json` for PR vs MR terminology).
- Respect `prefers-reduced-motion` — do not add animations that ignore it.
- Run full test suite after each optimization to avoid functional regressions.

## Step 6: Verify

```bash
${HATCH3R:VERIFY_GATE_ALL}
npm run build
```

The gate line is resolved to the project's language-aware command set at sync time (fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`); the build line is illustrative — substitute the project's build command.

- All performance budgets met.
- No functional regressions.
- Before/after measurements documented.
- CI performance check passes (if configured).

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-performance`** (CQ7) — MUST spawn to perform autonomous performance profiling and optimization (CWV, p95/p99, bundle-size, N+1, hot-path analysis). Provide the target areas, budget thresholds, and baseline measurements.

## Related Rules

- **Rule**: `hatch3r-performance-budgets` — reference this rule for the project's defined performance budget thresholds

## Error Handling

- **No performance budgets defined for the project**: Use the defaults from `hatch3r-performance-budgets` rule as a baseline. Note in the report that custom budgets should be defined.
- **Profiling tool unavailable or incompatible**: Fall back to manual timing measurements (e.g., `performance.now()` or `console.time`) for critical paths. Document the measurement method used.
- **Optimization introduces functional regressions**: Revert the optimization, add a regression test for the broken behavior, then re-attempt with a different approach.

## Definition of Done

- [ ] All performance budgets met
- [ ] Before/after measurements documented
- [ ] No functional regressions
- [ ] Bundle size within budget (if defined)
- [ ] Key metrics within project targets

## References

- [Core Web Vitals — web.dev](https://web.dev/articles/vitals) — accessed 2026-05-31, official-docs (Google / Chrome team). Source for the LCP, INP/FCP/TTI metric definitions and the field-vs-lab measurement guidance behind Step 2.
- [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring) — accessed 2026-05-31, official-docs (Google / Chrome team). Source for the 60fps/16ms frame target and the metric-weighting model used when prioritising violations in Step 3.
