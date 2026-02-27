---
id: hatch3r-perf-audit
description: Profile and optimize application performance against defined budgets. Use when investigating performance issues, auditing performance budgets, or optimizing hot paths.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Performance Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read performance budgets from rules and specs
- [ ] Step 2: Profile — bundle size, runtime, memory
- [ ] Step 3: Identify violations — which budgets exceeded, which hot paths slow
- [ ] Step 4: Plan optimizations — code splitting, lazy loading, memoization, etc.
- [ ] Step 5: Implement optimizations with before/after measurements
- [ ] Step 6: Verify all budgets met, no regressions
```

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

- Check project ADRs for constraints. Ensure optimizations don't violate privacy/security invariants.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 5: Implement Optimizations

- Apply changes incrementally. Measure before and after each change.
- Document before/after for each metric in PR or audit report.
- Respect `prefers-reduced-motion` — do not add animations that ignore it.
- Run full test suite after each optimization to avoid functional regressions.

## Step 6: Verify

```bash
npm run lint && npm run typecheck && npm run test
npm run build
```

- All performance budgets met.
- No functional regressions.
- Before/after measurements documented.
- CI performance check passes (if configured).

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-perf-profiler`** — MUST spawn to perform autonomous performance profiling and optimization. Provide the target areas, budget thresholds, and baseline measurements.

## Related Rules

- **Rule**: `hatch3r-performance-budgets` — reference this rule for the project's defined performance budget thresholds

## Definition of Done

- [ ] All performance budgets met
- [ ] Before/after measurements documented
- [ ] No functional regressions
- [ ] Bundle size within budget (if defined)
- [ ] Key metrics within project targets
