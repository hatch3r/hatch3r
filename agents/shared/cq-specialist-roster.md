---
id: shared-cq-specialist-roster
type: reference
description: Single-source CQ1-CQ10 specialist trigger roster — the 10-row delegation table shared verbatim by the implementer, reviewer, and fixer agents.
tags: [reference]
cache_friendly: true
---
# CQ Specialist Roster

The single source of the 10-row CQ1-CQ10 specialist trigger table. The `hatch3r-implementer`, `hatch3r-reviewer`, and `hatch3r-fixer` agents each point here from their `## Specialist Delegation` section instead of re-inlining the table; `agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability,product-spec}.md` are the specialist bodies. The id-set and trigger-mode (always/evaluate/conditional/mandatory-on-match) authority for fan-out remains `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE`; this file is the human-readable trigger-glob roster that mirrors it — with one documented lead: the CQ10 row below precedes its `SPECIALIST_TRIGGER_TABLE` registration, so orchestrators dispatch `hatch3r-product-spec` from this roster's trigger globs until that TS row lands. `hatch3r-ui` (CQ1) and `hatch3r-ux` (CQ2) carry mode `mandatory-on-match`: when their trigger matches, each MUST spawn as its own dedicated sub-agent instance at deep-context Tier 2/3 (skipping a triggered one is a gate failure); Tier 1 keeps the Phase Skip Criteria skip. `scripts/validate-specialist-roster.ts` (`checkCqTriggerTableParity`) treats this file as the reference copy and fails CI if any of the three agents re-inlines a divergent CQ row **as a markdown table** instead of pointing here; a bullet-list re-inline of dispatch prose is not table-shaped and is not diffed, so keep any per-specialist mode/trigger descriptions in the agent bodies aligned to this roster and to `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE` (a mode-token parity check over the agent bodies is the queued hardening — D5-SA5.1-01).

At a quality gate, the orchestrator MAY delegate to one or more of the 10 CQ specialists via the Task tool when the change touches a CQ-axis surface. Trigger conditions and the specialist roster (CONSTITUTION §6 Decision 22 wiring):

| CQ Pillar | Specialist | Trigger |
|-----------|------------|---------|
| CQ1 UI | `hatch3r-ui` | Files matching `**/*.{tsx,jsx,vue,svelte}`, Angular `*.component.{ts,html}`, theme/design-token configs (`tailwind.config.{js,ts}`, `theme.ts`), or source files under `**/components/**` |
| CQ2 UX | `hatch3r-ux` | Route-transition and page components, form components, navigation, empty/error/loading states, microcopy or i18n strings changed, locale-catalog files (`locales/` / `i18n/`) |
| CQ3 Security | `hatch3r-security` | Any code change (always-mode floor — absorbs legacy security-auditor scope); coverage focus: `src/auth/**`, `.github/workflows/*.yml`, OAuth/OIDC config, SBOM/provenance scripts, release-pipeline, dependency manifest/lockfile, DB rules/data flows/privacy invariants |
| CQ4 Reliability | `hatch3r-reliability` | Service handlers, OTel instrumentation, SLO files, RFC 9457 error responses |
| CQ5 Testability | `hatch3r-testability` | Any code change (always-mode floor — absorbs legacy test-writer scope); coverage focus: parsers, payment flows, RPC contracts, AI feature handlers, test files |
| CQ6 Scalability | `hatch3r-scalability` | Stateful handlers, back-pressure config, idempotency-key logic, queue producers/consumers, connection-pool config |
| CQ7 Performance | `hatch3r-performance` | LCP/INP/CLS-affecting UI code, p95/p99-affecting backend code, bundle-size imports, N+1 query candidates |
| CQ8 Maintainability | `hatch3r-maintainability` | Expand-contract migrations, API breaking-change candidates, duplication-risk patterns, high cyclomatic-complexity branches |
| CQ9 Enhancability | `hatch3r-enhancability` | Feature flags, externalized config, versioned APIs, extension-point definitions |
| CQ10 Product & Spec | `hatch3r-product-spec` | Spec artifacts produced or modified — `docs/specs/**`, `*.prd.md`, `requirements.md`/`design.md`/`tasks.md` triples, acceptance-criteria sections; greenfield/brownfield spec-output review; implementation PRs claiming spec coverage; implementation PRs changing user-observable behavior covered by `docs/specs/**` (per-feature fidelity, every tier — minimal at solo/team, per `rules/hatch3r-spec-currency.md`) |

Surface matched specialist names in the agent's structured result so the orchestrator can spawn them in parallel at Phase 4 subject to `max_phase4_parallel` batching. Multiple specialists fire in the same parallel set when independent globs match. Satisfies CONSTITUTION §6 Decision 22 wiring (CQ1-CQ9 specialist roster; the CQ10 row extends it per the 2026-07-09 CQ10 ratification), §2B (measurable CQ floors), and P8 B2 (fan-out scales with task surface count, not token cost).
