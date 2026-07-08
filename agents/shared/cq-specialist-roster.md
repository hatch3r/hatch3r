---
id: shared-cq-specialist-roster
type: reference
description: Single-source CQ1-CQ9 specialist trigger roster — the 9-row delegation table shared verbatim by the implementer, reviewer, and fixer agents.
tags: [reference]
cache_friendly: true
---
# CQ Specialist Roster

The single source of the 9-row CQ1-CQ9 specialist trigger table. The `hatch3r-implementer`, `hatch3r-reviewer`, and `hatch3r-fixer` agents each point here from their `## Specialist Delegation` section instead of re-inlining the table; `agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md` are the specialist bodies. The id-set and trigger-mode (always/evaluate/conditional/mandatory-on-match) authority for fan-out remains `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE`; this file is the human-readable trigger-glob roster that mirrors it. `hatch3r-ui` (CQ1) and `hatch3r-ux` (CQ2) carry mode `mandatory-on-match`: when their trigger matches, each MUST spawn as its own dedicated sub-agent instance at deep-context Tier 2/3 (skipping a triggered one is a gate failure); Tier 1 keeps the Phase Skip Criteria skip. `scripts/validate-specialist-roster.ts` (`checkCqTriggerTableParity`) treats this file as the reference copy and fails CI if any of the three agents re-inlines a divergent CQ row instead of pointing here.

At a quality gate, the orchestrator MAY delegate to one or more of the 9 CQ specialists via the Task tool when the change touches a CQ-axis surface. Trigger conditions and the specialist roster (CONSTITUTION §6 Decision 13 wiring):

| CQ Pillar | Specialist | Trigger |
|-----------|------------|---------|
| CQ1 UI | `hatch3r-ui` | Files matching `**/*.{tsx,jsx,vue,svelte}` or `**/components/**` |
| CQ2 UX | `hatch3r-ux` | Route handlers, page components, form components, navigation, empty/error/loading states, microcopy or i18n strings changed, locale-catalog files (`locales/` / `i18n/`) |
| CQ3 Security | `hatch3r-security` | `src/auth/**`, `.github/workflows/*.yml`, OAuth/OIDC config, SBOM/provenance scripts, release-pipeline, dependency manifest/lockfile, DB rules/data flows/privacy invariants |
| CQ4 Reliability | `hatch3r-reliability` | Service handlers, OTel instrumentation, SLO files, RFC 9457 error responses |
| CQ5 Testability | `hatch3r-testability` | Parsers, payment flows, RPC contracts, AI feature handlers, test files |
| CQ6 Scalability | `hatch3r-scalability` | Stateful handlers, back-pressure config, idempotency-key logic, queue producers/consumers, connection-pool config |
| CQ7 Performance | `hatch3r-performance` | LCP/INP/CLS-affecting UI code, p95/p99-affecting backend code, bundle-size imports, N+1 query candidates |
| CQ8 Maintainability | `hatch3r-maintainability` | Expand-contract migrations, API breaking-change candidates, duplication-risk patterns, high cyclomatic-complexity branches |
| CQ9 Enhancability | `hatch3r-enhancability` | Feature flags, externalized config, versioned APIs, extension-point definitions |

Surface matched specialist names in the agent's structured result so the orchestrator can spawn them in parallel at Phase 4 subject to `max_phase4_parallel` batching. Multiple specialists fire in the same parallel set when independent globs match. Satisfies CONSTITUTION §6 Decision 13 wiring (CQ1-CQ9 specialist roster), §2B (measurable CQ floors), and P8 B2 (fan-out scales with task surface count, not token cost).
