---
id: performance
type: check
description: Performance review criteria covering bundle size, render performance, memory usage, network optimization, database queries, and runtime efficiency
tags: [performance, tier:scaleup-plus]
cache_friendly: true
---
# Performance Check

> **Severity vocabulary:** see [agents/shared/severity-mapping.md](../agents/shared/severity-mapping.md) for canonical 5-column mapping.

Review criteria for evaluating performance in pull requests.

## Bundle Size and Asset Optimization

- `[CRITICAL]` New dependencies do not increase the total bundle size (gzipped) beyond the defined budget. Measure before and after.
- `[CRITICAL]` No unintentional import of full libraries when a subpath import or tree-shakable alternative exists (e.g., `import _ from "lodash"` vs `import groupBy from "lodash/groupBy"`).
- `[RECOMMENDED]` Images and static assets are compressed and served in WebP or AVIF, with intrinsic dimensions no larger than the maximum rendered size at 2x device pixel ratio (no downscaling a >2x-oversized source in the browser).
- `[RECOMMENDED]` CSS and JavaScript are minified and dead-code-eliminated in production builds.

## Render and Paint Performance

- `[CRITICAL]` Changes to critical rendering path do not regress Largest Contentful Paint (LCP) beyond the defined budget.
- `[CRITICAL]` Layout shifts are not introduced — Cumulative Layout Shift (CLS) must remain below the defined threshold.
- `[RECOMMENDED]` First Contentful Paint (FCP) is not regressed. Above-the-fold content renders without blocking on non-critical resources.
- `[RECOMMENDED]` Animations and transitions use `transform`/`opacity` (compositor-only properties) rather than properties that trigger layout or paint.

## Memory Usage and Leak Detection

- `[CRITICAL]` Event listeners, subscriptions, timers, and observers are cleaned up on component unmount or scope exit.
- `[CRITICAL]` No unbounded data structures (arrays, maps, caches) that grow without eviction or size limits.
- `[RECOMMENDED]` Large objects and buffers are released when no longer needed — avoid holding references beyond their useful lifetime.
- `[RECOMMENDED]` Closures in hot paths do not capture unnecessary outer scope variables that prevent garbage collection.

## Network Request Optimization

- `[CRITICAL]` No N+1 request patterns — batch or aggregate related requests instead of issuing one per item.
- `[CRITICAL]` API response payloads return only required fields. No over-fetching of large objects when a subset is needed.
- `[RECOMMENDED]` Cacheable responses set `Cache-Control` with an explicit `max-age` (immutable static assets `max-age=31536000, immutable`; mutable API responses `no-cache` or a documented TTL) plus an `ETag` or `Last-Modified` validator. Responses that mutate state or carry per-user data set `Cache-Control: private` or `no-store`.
- `[RECOMMENDED]` Request waterfalls are minimized — parallelize independent requests and preload critical resources.

## Database Query Performance

- `[CRITICAL]` New queries that filter or sort on a column have a supporting index. Queries against large tables must not perform full table scans.
- `[CRITICAL]` No N+1 query patterns in data access layers — use joins, batch loading, or dataloader patterns.
- `[RECOMMENDED]` Queries select only required columns, not `SELECT *`.
- `[RECOMMENDED]` Connection pooling is used for database access. No per-request connection creation in request handlers.
- `[RECOMMENDED]` Long-running queries and transactions are identified and bounded with timeouts.

## Runtime Performance

- `[CRITICAL]` No synchronous blocking operations (heavy computation, synchronous I/O) on the main thread or event loop.
- `[CRITICAL]` Hot-path code (called per-request, per-frame, or per-event) does not recompute a pure result whose inputs are unchanged since the last call — memoize or cache any such repeated pure computation, and bound the cache with an eviction policy (size cap or TTL).
- `[RECOMMENDED]` CPU-intensive work is offloaded to workers, background jobs, or streaming pipelines.
- `[RECOMMENDED]` Object allocation in tight loops is minimized — reuse buffers and avoid creating short-lived objects per iteration.

## Lazy Loading and Code Splitting

- `[CRITICAL]` Routes and large feature modules use dynamic imports or lazy loading — not bundled into the initial payload.
- `[RECOMMENDED]` Below-the-fold content, modals, and infrequently accessed features are lazy-loaded on demand.
- `[RECOMMENDED]` Third-party scripts (analytics, chat widgets, ads) are loaded asynchronously and deferred.
- `[RECOMMENDED]` Code splitting boundaries align with route or feature boundaries, not arbitrary file splits.
