---
description: Performance budgets and targets for the project
alwaysApply: false
---
# Performance Budgets

## Application Budgets

| Metric                            | Budget               |
| --------------------------------- | -------------------- |
| UI render                         | 60fps (16ms/frame)   |
| Cold start to interactive         | 1.5 seconds          |
| Idle CPU usage                    | 1%                   |
| Memory footprint                  | 30 MB                |
| Event processing latency          | 10ms per event       |
| Bundle size (initial, gzipped)    | 500 KB               |
| Backend reads per session start   | ≤ 5 documents        |
| Serverless warm execution         | 500ms                |
| Serverless cold start             | 3 seconds            |
| Main thread long tasks            | 0 tasks > 50ms       |

## Core Web Vitals

Targets align with Google's "Good" thresholds (measured at p75 from real user data):

| Metric | Good        | Needs Improvement | Poor       | What It Measures            |
| ------ | ----------- | ----------------- | ---------- | --------------------------- |
| LCP    | ≤ 2.5s     | 2.5–4.0s          | > 4.0s     | Loading — largest visible element render time |
| INP    | ≤ 200ms    | 200–500ms         | > 500ms    | Responsiveness — worst interaction latency across full session |
| CLS    | ≤ 0.1      | 0.1–0.25          | > 0.25     | Visual stability — cumulative unexpected layout shifts |

- **LCP optimization**: preload hero images/fonts, inline critical CSS, use `fetchpriority="high"` on LCP elements, server-side render above-the-fold content.
- **INP optimization**: break long tasks with `scheduler.yield()`, defer non-critical event handlers, avoid layout thrashing in input handlers, keep interaction callbacks < 100ms.
- **CLS optimization**: set explicit `width`/`height` on images and embeds, reserve space for dynamic content, avoid inserting content above the viewport after load.

## API Response Time Budgets

| Endpoint Type  | p50     | p95     | p99     | Timeout |
| -------------- | ------- | ------- | ------- | ------- |
| Read (single)  | 50ms    | 150ms   | 300ms   | 5s      |
| Read (list)    | 100ms   | 300ms   | 500ms   | 10s     |
| Write (create) | 100ms   | 250ms   | 500ms   | 10s     |
| Write (update) | 75ms    | 200ms   | 400ms   | 10s     |
| Search         | 150ms   | 500ms   | 1000ms  | 15s     |
| Aggregation    | 200ms   | 800ms   | 2000ms  | 30s     |
| Auth flow      | 100ms   | 300ms   | 500ms   | 10s     |

- All endpoints must return within their timeout or abort with a structured error.
- Client-side: set `AbortController` timeouts matching the table above. Show loading indicators after 300ms.

## Database Query Budgets

| Constraint                        | Budget / Rule                        |
| --------------------------------- | ------------------------------------ |
| Single query execution            | < 100ms                              |
| N+1 detection                     | 0 N+1 patterns (enforced via lint/review) |
| Queries per request               | ≤ 10                                 |
| Connection pool size              | 10–20 per service instance           |
| Index coverage                    | Every query in hot paths must hit an index |
| Full collection scans             | Forbidden in production code         |
| Batch read size                   | ≤ 100 documents per batch            |

- Use query explain plans during code review for new or modified queries.
- Log slow queries (> 200ms) with the query pattern and execution plan.

## Network Budgets

| Constraint                        | Budget                               |
| --------------------------------- | ------------------------------------ |
| Requests per page load            | ≤ 30                                 |
| Total transfer size (initial)     | ≤ 1.5 MB                            |
| Image payload per page            | ≤ 500 KB                            |
| Individual API response           | ≤ 100 KB (gzipped)                  |
| WebSocket message size            | ≤ 10 KB                             |
| Font files loaded                 | ≤ 2 families, WOFF2 only            |
| Third-party script budget         | ≤ 100 KB (gzipped)                  |

- Images: serve WebP/AVIF with responsive `srcset`. Lazy-load below-the-fold images.
- Fonts: use `font-display: swap`, preload critical fonts, subset to used character ranges.
- Enable Brotli or gzip compression on all text responses. Set `Cache-Control` headers per resource type.

## Enforcement Mechanisms

| Gate                   | Tool / Method              | Trigger          | Threshold                    |
| ---------------------- | -------------------------- | ---------------- | ---------------------------- |
| Bundle size            | `size-limit` in CI         | Every PR         | Fail if > 500 KB gzipped    |
| Lighthouse score       | Lighthouse CI assertions   | Every PR         | Performance ≥ 90            |
| Core Web Vitals        | Lighthouse CI + CrUX       | PR + weekly      | All metrics in "Good" range  |
| API latency            | Integration test assertions | Every PR        | p95 within budget table      |
| DB query count         | Test-level query counter   | Every PR         | ≤ 10 per request             |
| Runtime regression     | RUM dashboards + alerts    | Continuous       | Alert on p75 regression > 10% |
| Synthetic monitoring   | Scheduled Lighthouse runs  | Hourly/daily     | Slack alert on score drop    |

- CI must block merge if any enforcement gate fails. No manual overrides without tech-lead approval.
- Track budget trends over time: plot bundle size, LCP, and INP per release on the performance dashboard.

## Measurement Tooling

| Metric Category    | Lab / CI Tool                      | Field / Production Tool          |
| ------------------ | ---------------------------------- | -------------------------------- |
| Core Web Vitals    | Lighthouse CI, WebPageTest         | CrUX, `web-vitals` library (RUM) |
| Bundle size        | `size-limit`, `webpack-bundle-analyzer` | N/A                         |
| API latency        | Integration tests, k6              | OpenTelemetry histograms         |
| DB performance     | Query explain, test query counters | Slow query logs, APM traces      |
| Memory / CPU       | Chrome DevTools, profiler          | Infrastructure metrics (Prometheus) |
| Visual regression  | Playwright screenshot diffing      | RUM CLS tracking                 |

- Automated regression detection: compare each PR's metrics against the `main` branch baseline. Flag regressions > 5% in any budget metric.
- Review performance budgets quarterly and tighten thresholds as the application matures.
