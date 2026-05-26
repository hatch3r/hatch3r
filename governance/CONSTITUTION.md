# hatch3r — Constitution

> Established: 2026-03-25 | Restructured: 2026-04-09 (Cycle 5 Reaudit) | Amended: 2026-05-18 (RE-ENVISION redesigned as holistic governance sparring engine — §2 P5 lean-threshold row recalibrated, §3 traceability cells updated, §6 Decision #11 added, §8 authorizes RE-ENVISION as direct-edit path for permitted layers)
> Last updated: 2026-05-26
> Design rationale for the hatch3r governance system. VISION.md defines what we aspire to. This Constitution defines why we made these choices and how the governance system holds itself accountable.

---

## 1. Identity

hatch3r is an open-source CLI that installs tool-agnostic agentic coding setups into any repository via a canonical source model and platform adapters. For full identity, audience, and principles, see [VISION.md](VISION.md).

---

## 2. Pillar Framework (Two-Axis)

Every governance file, audit domain, and enhancement decision must serve at least one pillar. These are the constitutional heart of the governance system.

### §2.0 Axis Overview

hatch3r 2.0.0 distinguishes two pillar axes with different ownership, measurement, and traceability obligations:

- **Governance axis (§2A — P1-P8):** governs HOW the framework operates — CLI UX, scientific quality, adapter currency, lean coverage, governance self-quality, security & trust, speed & token efficiency, clarification & fan-out discipline.
- **Content-quality axis (§2B — CQ1-CQ9):** governs WHAT the framework produces — UI, UX, Security, Reliability, Testability, Scalability, Performance, Maintainability, Enhancability of generated end-user code.

Each governance change cites pillar(s) on at least one axis. Audit findings carry `progress_toward_pillar: <axis>.<pillar_id>+<delta>` (e.g., `governance.P5+0.15` or `content-quality.CQ3+0.20`).

### §2A. Governance Pillars

### P1. CLI UI/UX Excellence

Every lifecycle stage (init through release) delivers a CLI interface measured by the metrics below (P1 Measurement): clear prompts, actionable errors, progressive disclosure, accessible output.

**Measurement:** Time-to-first-value (steps from init to first useful output), decision count per flow, error recovery rate (% of errors with actionable next steps), first-run success rate.
**Primary owner:** D10 SA10.1-10.4 + framework owner for between-cycle UX escalations.
**Governance refs:** AUDIT.md D10 (UX & Documentation), charter directive 11 (user-facing perspective).

### P2. Scientific & Practical Quality

Content is of verifiable, real-world-applicable quality. Findings carry the Scientific Rigor Contract — falsifiability, triangulated citations, confidence with basis, ≥3-step causal chain, bias check, peer-review counter-argument — defined in [audit/templates/rigor-contract.md](audit/templates/rigor-contract.md) and operationalised by the Behavioral Charter.

**Measurement:** Behavioral charter compliance rate, one-shot success rate (see [VISION.md](VISION.md) §Quality Bar), finding root-cause depth (symptom vs. systemic). Agent-produced UI/UX measurement: WCAG 2.2 AA conformance via axe-core (0 serious/critical violations per route and per component), design-token adoption rate ≥95% on color and spacing in generated code, four-state surface contract coverage on async views (loading + empty + error + partial = 100%), agent-produced one-shot UI/UX acceptance rate cycle-over-cycle. Production-readiness metrics extend P2 to agent-produced services: instrumented-route ratio (observability) = 100%; expand-contract conformance on schema changes (migrations) = 100%; API breaking-change events per release on stable endpoints = 0; AI feature eval coverage with hallucination-as-SLI defined = 100%; per-feature-mandate-map coverage on test classes (testing depth) = 100%; SBOM + npm provenance + SHA-pinned actions (supply chain) = 100%; SLO defined on user-facing services (reliability) = 100%; OAuth 2.1 + passkey-server + RBAC-or-better authorization (auth depth) = 100%.
**Primary owner:** D1 SA1.x + D5 SA5.x + D7 SA7.x + D13 SA13.x + behavioral charter authors.
**Governance refs:** [AUDIT.md §Sub-Agent Behavioral Charter](AUDIT.md) (17 directives, authoritative location), Audit Quality Architecture (3 layers), D1/D5/D7/D13.

### P3. Adapter & External Tool Currency

The 3 supported adapters (`claude`, `cursor`, `copilot`), end-user-recommended CLI tools, and MCP servers stay current through audit cycles. Each cycle mandates live web research against latest official documentation, vendor changelogs ≤12 months old, and CVE feeds ≤90 days old. Staleness >90 days for any tier-1 tool is a Medium finding; missing CVE check is High. Scope narrowed to 3 adapters in 1.9.0 (Decision #12) — narrower scope raises the per-adapter currency bar.

**Measurement:** Platform documentation date vs. audit date delta (per adapter and per CLI tool, N=3 adapters), feature gap count per adapter, adapter test coverage, CLI tool currency delta (last vendor release vs cycle date, target ≤90 days), CVE advisory acknowledgement count per cycle. Twin metric (Decision 21): adapter capability utilization ratio (covered platform features / total platform features, per adapter) — measured per cycle by D09 capability matrix audit.
**Primary owner:** D9 SA-{Cursor, Claude, Copilot} per cycle + D21 SA-CLITools per cycle + framework owner for between-cycle staleness escalations.
**Governance refs:** AUDIT.md D9 (Platform Adapters, web research mandate, 3 adapter SAs + 2 synthesis), D21 (CLI Tool Currency), D2.4 (External Tool Config Utilities), charter directive 12 (currency verification), D15.5 + D15.7 (MCP and CLI supply-chain trust).

### P4. Comprehensive Lean Coverage

Commands and shared resources cover every end-to-end stage of production software at every scale. Content stays lean: no bloat, no duplication, single-source-of-truth, every file earns its existence.

**Measurement:** Lifecycle phase coverage percentage, content-to-purpose ratio, duplication index, artifact-level redundancy candidates surfaced per cycle, user-content authoring tool quality, governance total line count (target <=3000). Tier-aware (Decision 4): two-axis measurement — (a) canonical-corpus lifecycle phase coverage; (b) per-tier resolved-selection lifecycle phase coverage (solo / team / scaleup / enterprise per `hatch3r config maturity=<tier>`).
**Primary owner:** D5 SA5.x + D16 SA16.x + D20 SA20.x + per-content-class authors.
**Governance refs:** AUDIT.md D16 (Cross-Domain Synthesis), CL-2 (Content Gap Identification), charter directive 13 (duplication awareness), D20 (User-Content Authoring).

### P5. Governance Self-Quality

Governance and audit cycles apply the same quality standards, anti-slop, and anti-overhead principles to themselves. The governance system must pass its own tests.

**Measurement:** Governance duplication index (<5%), finding inflation ratio (<2.0x), false positive rate, anti-slop phrase count (0 per file), governance file line counts within lean thresholds.
**Primary owner:** D16 SA16.x + D18 SA18.x + D19 SA19.x + D20 SA20.x + RE-ENVISION orchestrator per ≥14-day cadence + D24 (after authoring) per cycle.
**Governance refs:** CL-3 (Audit Self-Evolution), regression gate check 9 (governance weight), lean thresholds below.

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| CONSTITUTION.md | <=550 lines | +25 per governance pillar (P8 baseline) + 15 per content-quality vector (CQ1-CQ9 baseline) + 5 per matrix-column added per new audit domain + 3 per finding field added to Required Finding Output Schema; recalibrated 2026-05-26 for 2.0.0 two-axis pillar framework (revised upward to accommodate 9 CQ pillars + 17 new Key Design Decisions + §3 matrix widening) |
| VISION.md | <=250 lines | Stable; add principles rarely |
| AUDIT.md | <=600 lines | ±4 lines per domain count delta |
| AUDIT-EXECUTE.md | <=720 lines | +20 lines per major regression-gate body addition (e.g., anti-slop wordlist inline per L10-F1); ±50 lines per execution phase delta; recalibrated 2026-05-26 for 2.0.0 wordlist embed |
| RE-ENVISION.md | <=550 lines | ±25 lines per § section added OR per L-layer SA added; baseline 9 sections + 10 layer SAs = 19 units × ~27 lines = 513 baseline; ceiling 550 (recalibrated 2026-05-26 for verifiable units) |
| EVOLVE.md | <=400 lines | ±20 lines per assessment-dimension delta |
| pack-trust-model.md | <=300 lines | ±25 lines per trust-tier or signing-method addition |
| rules/*.md (precedence: critical or high) | <=250 lines | ±25 lines per hard-mandate floor item added |
| rules/*.md (precedence: normal or low) | <=120 lines | Style/cosmetic rules; tighter ceiling enforces compression |
| CLAUDE.md | <=300 lines | +20 per pillar count delta; auto-derived counts excluded from line count via `scripts/validate-pillar-currency.ts` |
| README.md | <=200 lines | Quickstart + 60-second + key concepts per Decision 25 |
| docs/*.md per file | <=400 lines | Per-page reference scope; auto-generated frontmatter excluded |
| Static-first prompt structure | required for `orchestrator: true` and `agents/*.md` | scripts/validate-efficiency-invariants.ts |
| Parallel-tool-by-default directive | required when artifact uses ≥2 independent tool calls | Body-text scan |
| Triage-first orchestrator | required when `orchestrator: true` | Frontmatter `triage_tiers` array |
| Audit-execute SA-per-finding ratio (Critical/High/Medium/Low/Info) | 1:1 / ≤1:8 / ≤1:15 / ≤1:30 / ≤1:50 | Decision 18 closed enum; Tier 1 batch covers Low (`tier1_pattern` enum, ≤30) + Info (≤50); Tier 2H batches High (≤8 per same-pattern); Tier 2M batches Medium (≤15); same-file file-lock + dependency-chain serialization preserved across all tiers |
| Finding impact-gating (Decision 17) | required: impact_horizon ∈ {short, medium, long} + progress_toward_pillar = <pillar_id>+<delta> | SA drops at output time per AUDIT.md charter directive 18; auditor inspection per cycle |
| Anti-cache patterns | 0 per artifact | No volatile tokens above static frame |
| Domain file (SA ≤5) | 30-80 lines | Limit authoritative |
| Domain file (SA >5) | SA × 15 lines | Calibration supersedes Limit |
| Template file | 80-200 lines | Role-specific; bounded by role scope |
| Cross-file duplication | <5% | 0% ideal; audit per cycle |
| Finding inflation | <2.0x pre-dedup/post-impact-gating/post-triage | Source-level dedup + Decision 17 impact-gating compounded improvement |
| Governance total | <=3000 lines | Increasing across cycles = bloat signal |
| Generated UI a11y violations (axe-core, serious/critical) | 0 | Per-component, per-route, applies to agent-produced output |
| Design-token adoption in generated code (color, spacing, typography) | >=95% | Hard-coded values count against; semantic tokens count toward |
| Four-state surface contract coverage on generated async views | 100% | Loading + empty + error + partial; missing any state is a regression |
| Generated-service OTel instrumentation on request path | 100% | Per route, per service, agent-produced |
| Migration expand-contract conformance | 100% | Schema changes follow 3- or 4-deploy expand/migrate/contract; reversibility documented |
| API breaking-change events on stable endpoints | 0 per release | Verified by oasdiff / buf breaking / graphql-inspector CI gate |
| AI feature eval coverage | 100% | Every AI feature has automated eval set + hallucination-as-SLI |
| Per-feature test-class mandate compliance | 100% | Per `rules/hatch3r-testing.md` mandate-map: parser→fuzz, payment→mutation, RPC→contract |
| Supply-chain floor coverage | 100% | npm provenance + SBOM + SHA-pinned actions + cosign-verified containers |
| User-facing service SLO defined | 100% | Per service: availability + latency p95/p99 + burn-rate alert |
| Auth depth coverage | 100% | OAuth 2.1 + OIDC validation + DPoP + WebAuthn server-side + RBAC/ABAC/ReBAC rubric applied |
| Anti-slop phrases | 0 per file | Pattern match per cycle |
| Checklist items/SA | 4-8 | <4 shallow, >8 too broad |
| Ambiguity-detection gate coverage (agents/skills/commands) | 100% | §0/Step 0 references `agents/shared/user-question-protocol.md` |
| Sub-agent count emission on delegating artifacts | 100% | First-class output field with rationale per P8 |
| Floor admission (security + UI/UX + protocol) | structural invariant: every non-custom preset admits every item tagged `floor:security`, `floor:ui-ux`, or `floor:protocol` unconditionally | `src/content/index.ts::resolveSelection` stage 2; presets cannot disable via config. Item with zero capability + zero floor + not protected is DROPPED (1.9.0 — commit 7418f49 reverses the pre-1.9.0 empty-tag passthrough loophole) |
| Tag-facet integrity on canonical artifacts | every canonical agent/skill/rule/command/hook carries ≥1 capability tag OR ≥1 floor tag in frontmatter; `customize` and `floor:*` items are exempt from capability-gate filtering | `src/content/tags.ts::TAG_REGISTRY` single source of truth; `facetOf()` + `tagsForFacet()` predicates; verified by content/tags.test.ts and content/index.test.ts |
| Rule-precedence assignment policy | security + secrets rules → `precedence: critical` (rank 100, prefix `10-`); rules implementing CONSTITUTION §2 P2 hard-mandate floors (supply-chain, observability, migrations, auth depth, AI evals, accessibility, etc.) and framework-dev gatekeepers → `precedence: high` (rank 300, prefix `30-`); cosmetic/style → `precedence: normal` (rank 500, prefix `50-`); deprecation hawks → `precedence: low` (rank 700, prefix `70-`) | `scripts/validate-rule-parity.ts` checks `.md`/`.mdc` parity; D05 audit verifies assignment-policy compliance |
| Detail-rule frontmatter declaration (`rules/*-detail.{md,mdc}`) | required: `detail_rule: true` + `consumed_by: <parent-rule-id>` on both `.md` and `.mdc` | C9-M4 / D16-F16.3.3 — documents justified rule+detail pairings as the alternative to merge; absence reverts the pair to merge-candidate per D16.3 add-vs-remove bias. Currently authorised: `hatch3r-agent-orchestration-detail`. New `*-detail` pairs require a queued §8 amendment proposal. |

#### Anti-Bloat Principles

1. **Single Source of Truth:** every concept defined in exactly one file; others reference it.
2. **Earn Your Existence:** every file, section, row serves at least one pillar — if none, remove.
3. **Compression Over Verbosity:** tables required when ≥4 items share ≥2 columns; references over repetition when content appears in ≥2 files with >5% byte similarity (verified per `scripts/validate-efficiency-invariants.ts`).
4. **Proportional Depth:** file lines ≤ (primary unit count × calibration constant) per the §2 P5 calibration column for the file's class (e.g., domain SA × 15 lines, theme-block × 25 lines).
5. **Anti-Slop:** no filler phrases without measurable criteria (wordlist in AUDIT-EXECUTE.md regression gates).
6. **Currency transparency:** every governance prompt/template carries `> Last updated: YYYY-MM-DD` as line 2 or 3; absence Low, >180-day staleness Medium (verified by AUDIT-EXECUTE.md regression gates).

#### Silent Failure Contract

Every `catch` block, `.catch()` Promise handler, and async failure path in `src/` (including unawaited rejections, resumability/checkpoint write failures, snapshot rollback failures per Decision 27, cost-telemetry emission failures per Decision 24) MUST emit a diagnostic via one of: a `warnings[]` array returned to the caller, the observability channel (`src/pipeline/observability.ts`), or the failure log (`src/pipeline/failureLog.ts`). Catch-and-skip without channel emission is a contract violation — failures hidden from operators are indistinguishable from success and silently degrade the lean coverage guarantee (P4).

Acceptable patterns: re-throw after classification (e.g. `if (code !== "ENOENT") throw err`); emit then return a sentinel; push to a caller-visible warnings collection. Unacceptable patterns: empty catch body; catch that contains only `return null` / `return []` / `return undefined`; swallowed `.catch()` (e.g., `.catch(() => {})` without diagnostic emission). Enforced by ESLint rule `silent-failure/no-silent-catch` (warning severity; opt-out via `// eslint-disable-next-line silent-failure/no-silent-catch` requires a justification comment naming the diagnostic channel that replaces it).

### P6. Security & Trust Governance

Security and trust are first-class governance concerns integrated into every tier, not siloed. Trust delegation, verification, revocation, and OWASP ASI compliance are governance-level requirements.

**Measurement:** Trust control coverage ≥95% per maturity tier; time to security finding resolution ≤14d for High, ≤7d for Critical; ASI control compliance rate ≥90% per cycle; CVE advisory acknowledgement count per cycle; per-tier floor:security admission rule (Decision 4).
**Primary owner:** D15 SA15.x + framework owner for CVE response + hatch3r-security specialist (after authoring).
**Governance refs:** D15 (Agentic Security & Trust Model, including trust delegation chain and compliance mapping in Part B).

### P7. Speed & Token Efficiency (end-user runtime)

End-user agentic flows (commands, agents, skills consumed in `npx hatch3r`-installed projects) are tuned for token economy and latency, using only zero-quality-loss techniques established in published LLM literature: static-first prompt structure for cross-provider cache friendliness, parallel-tool-by-default, triage-first orchestration with auto-tiered depth (Light/Standard/Deep), plan/act split, structured outputs over prose, and lazy loading via reference-by-pointer. P7 governs the static-prompt frame and dependency-edge serialization — it does NOT govern fan-out width. Compression that would drop a Static-First Prompt frame, lazy-load reference (P7 Measurement), or P7 Measurement metric below baseline is rejected. The audit-cycle prompt itself (AUDIT.md, RE-ENVISION.md, `hatch3r-audit-cycle*.md`) is exempt — depth there is non-negotiable. AUDIT-EXECUTE.md is no longer exempt as of Cycle 9: it carries `triage_tiers` and groups Low/Info trivial findings sharing a closed `tier1_pattern` into batch sub-agents (≤30 per batch), preserving the rule that the orchestrator never edits files itself.

**Tension with P8 resolved:** P7 minimizes token waste in the static prompt structure; P8 mandates fan-out width sufficient for task size. Token cost is never a valid reason to under-fan-out (P8 dominates).

**Measurement:** static-first ordering compliance (100% of orchestrator commands), parallel-tool directive presence (100% of multi-tool agents), triage-first directive on `orchestrator: true` commands (required), passive token/latency telemetry deltas in `src/pipeline/observability.ts` cycle-over-cycle (informational).
**Primary owner:** D6 SA6.x + observability telemetry per cycle + framework owner for static-first compliance escalations.
**Governance refs:** AUDIT.md D06 (extended), charter directive 14 (Speed & Token Efficiency Awareness), lean thresholds below (efficiency rows).

### P8. Clarification & Fan-out Discipline

Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

Sub-agent fan-out scales with task size; serialization is only valid on dependency edges. Token cost is never a valid reason to serialize independent work. Delegating artifacts emit sub-agent count + rationale as a first-class output field.

**Measurement:** B1 gate present rate (target 100% across agents, skills, commands), sub-agent count emission rate on delegating artifacts (target 100%), under-fan-out incidents per cycle (target 0). User-content authoring tools count toward this when they delegate.
**Primary owner:** D5 SA5.x + D7 SA7.x + D13 SA13.x + behavioral charter directive 17 enforcement.
**Governance refs:** AUDIT.md Behavioral Charter directive 17 (clarification-first verification), D05 (B1 in prompts), D07 (B2 in orchestration), D13 (B1 in human-AI collaboration), shared/user-question-protocol.md.

---

### §2B. Content-Quality Pillars

The content-quality axis governs the quality of code generated by hatch3r agents for end-user projects. Each pillar maps to a Decision-13 specialist agent (to be authored in subsequent audit cycles) and to existing audit-domain SAs that already enforce the pillar's measurements.

### CQ1. UI Quality

Generated UI in end-user projects meets WCAG 2.2 AA conformance, design-system fidelity, and component-library reuse.

**Measurement:** axe-core 0 serious/critical violations per route + per component; design-token adoption ≥95% on color/spacing/typography; four-state surface contract (loading + empty + error + partial) coverage 100% on async views; component-library reuse ratio (reused / authored anew) per cycle.
**Primary owner:** hatch3r-ui specialist (to be authored) + D10 SA10.9 + D22 SA22.1 (to be authored).
**Governance refs:** AUDIT.md D10, D22 (future), agents/shared/quality-charter.md §UI/UX quality.

### CQ2. UX Quality

Generated UX flows in end-user projects meet sensible defaults, error-recovery clarity, and user-task completion rate.

**Measurement:** error-recovery rate (% of user errors with actionable next-step messages) ≥90%; first-run success rate per user task ≥80%; decisions-per-flow count ≤3 (per P1 Measurement); accessibility of error states (focus management + screen-reader announcement) 100%.
**Primary owner:** hatch3r-ux specialist (to be authored) + D10 SA10.9 + D13 SA13.x.
**Governance refs:** AUDIT.md D10, D13, agents/shared/quality-charter.md §UI/UX quality.

### CQ3. Security Quality

Generated code in end-user projects meets supply-chain integrity, authentication depth, secret hygiene, and OWASP ASI controls.

**Measurement:** npm provenance + SBOM (CycloneDX 1.6) + SHA-pinned actions + cosign-verified containers 100%; OAuth 2.1 + OIDC validation + DPoP + WebAuthn server-side coverage 100% on auth-bearing services; hardcoded secrets count 0 per cycle; OWASP ASI01-10 control coverage 100% on agent-produced code; CVE advisory acknowledgement count per cycle.
**Primary owner:** hatch3r-security specialist (to be authored) + D15 SA15.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D15, D22 (future), agents/shared/quality-charter.md §Supply-chain + §Authentication.

### CQ4. Reliability Quality

Generated services in end-user projects meet observability, SLO definition, error budget, and graceful degradation requirements.

**Measurement:** OpenTelemetry instrumentation on request path 100%; user-facing service SLO defined (availability + latency p95/p99 + burn-rate alert) 100%; RED+USE metrics emitted per service 100%; RFC 9457 problem details on error responses; circuit breaker / retry-with-backoff patterns on outbound dependencies.
**Primary owner:** hatch3r-reliability specialist (to be authored) + D11 SA11.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D11, D22 (future), agents/shared/quality-charter.md §Observability + §Reliability.

### CQ5. Testability Quality

Generated code in end-user projects meets real-deal-first testing, mandate-map adherence per test class, and per-feature test coverage.

**Measurement:** per-feature test-class mandate compliance 100% (parser→fuzz, payment→mutation, RPC→contract per `rules/hatch3r-testing.md`); real-deal test ratio ≥80% per cycle (mocks require documented `// MOCK: <reason>` justification); coverage thresholds met per file class; AI feature eval coverage 100% with hallucination-as-SLI.
**Primary owner:** hatch3r-testability specialist (to be authored) + D3 SA3.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D3, D22 (future), agents/shared/quality-charter.md §Testing.

### CQ6. Scalability Quality

Generated services in end-user projects meet horizontal scaling, stateless request handling, and back-pressure patterns.

**Measurement:** stateless-handler ratio ≥95% on user-facing routes; request-coalescing + back-pressure pattern adoption on high-fan-out endpoints; database connection pool sizing per concurrency profile; idempotency-key adoption on POST/PUT endpoints 100%; queue-based offloading for >1s operations.
**Primary owner:** hatch3r-scalability specialist (to be authored) + D11 SA11.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D11, D22 (future), agents/shared/quality-charter.md §Reliability.

### CQ7. Performance Quality

Generated code in end-user projects meets Core Web Vitals budgets (frontend), p95/p99 latency targets (backend), and bundle-size discipline.

**Measurement:** Core Web Vitals p75 met per page (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1); frontend bundle size per route ≤target budget; backend p95 latency per route ≤200ms; backend p99 latency ≤500ms; N+1 query count 0 per cycle on data-access paths.
**Primary owner:** hatch3r-performance specialist (to be authored) + D6 SA6.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D6, D22 (future), agents/shared/quality-charter.md §UI/UX quality (CWV) + §Observability (latency).

### CQ8. Maintainability Quality

Generated code in end-user projects meets readability, pattern-reuse, anti-duplication, and incremental-change-safety standards.

**Measurement:** jscpd duplication index ≤5% per cycle; pattern-reuse ratio (reused / newly-authored) ≥70%; cyclomatic complexity per function ≤10; documentation currency ≤180 days on user-facing API surfaces; expand-contract migration conformance 100%; API breaking-change events on stable endpoints 0 per release.
**Primary owner:** hatch3r-maintainability specialist (to be authored) + D5 SA5.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D5, D22 (future), agents/shared/quality-charter.md §Anti-Duplication Procedure + §API.

### CQ9. Enhancability Quality

Generated code in end-user projects meets pluggability, feature-flag adoption, configuration externalization, and forward-compatibility standards.

**Measurement:** feature-flag adoption on user-visible behavior changes 100%; configuration externalization on environment-dependent values 100%; forward-compatibility patterns (versioned APIs, additive schema, deprecation policy) per stable endpoint; extension-point definition for cross-cutting concerns; semantic versioning compliance 100%.
**Primary owner:** hatch3r-enhancability specialist (to be authored) + D14 SA14.x + D22 SA22.x (to be authored).
**Governance refs:** AUDIT.md D14, D22 (future), agents/shared/quality-charter.md §API + §AI feature.

---

### Pillar Compliance Test

For any proposed governance change, answer:

1. Which pillar(s) does this change serve, on which axis (governance and/or content-quality)?
2. What measurable improvement does it produce?
3. Does it increase or decrease governance total size? If increase, justify net value exceeding the size cost.
4. Does it degrade end-user runtime efficiency? If yes, reject or document the offsetting gain.
5. **Impact horizon (Decision 17):** short | medium | long? If unanswerable, reject.
6. **P8 dominance (Decision 18 + P7↔P8 tension):** does this change under-fan-out for token-cost reasons? If yes, reject (P8 dominates P7 per §2 P7 tension resolution).

If (1) is "none" — reject. If (3) is "increase" without justification — reject. If (4) is "yes" without offset — reject. If (5) is unanswerable — reject. If (6) is "yes" — reject.

---

## 3. Pillar-to-Governance Traceability Matrix (Two-Axis)

### §3.1 Governance Axis (P1-P8)

| Pillar | CONST | VISION | AUDIT | A-EXEC | RE-ENV | EVOLVE | TMPL | Domains | Trust |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| P1 CLI UX | S | P | S | S | S | S | — | D10, D20.1 | — |
| P2 Quality | P | P | P | S | S | S | P | D01,D05,D07,D13 | — |
| P3 Currency | S | P | P | S | — | S | S | D02,D09,D21 | P |
| P4 Lean | S | P | P | P | S | S | S | D05,D16,D20 | — |
| P5 Governance | P | S | P | P | P | P | S | D16,D18,D19,D20 | — |
| P6 Security | P | S | S | S | — | — | — | D15, D20.2 | P |
| P7 Speed & Tokens | S | S | S | S | — | — | P | D06 | — |
| P8 Clarification & Fan-out | P | P | P | S | P | — | S | D05,D07,D13 | — |

### §3.2 Content-Quality Axis (CQ1-CQ9)

| Pillar | CONST | VISION | AUDIT | A-EXEC | RE-ENV | EVOLVE | TMPL | Domains | Trust |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| CQ1 UI | P | S | S | S | — | — | — | D10, D22 (future) | — |
| CQ2 UX | P | S | S | S | — | — | — | D10, D13, D22 (future) | — |
| CQ3 Security | P | S | S | S | — | — | — | D15, D22 (future) | P |
| CQ4 Reliability | P | S | S | S | — | — | — | D11, D22 (future) | — |
| CQ5 Testability | P | S | S | S | — | — | — | D03, D22 (future) | — |
| CQ6 Scalability | P | S | S | S | — | — | — | D11, D22 (future) | — |
| CQ7 Performance | P | S | S | S | — | — | — | D06, D22 (future) | — |
| CQ8 Maintainability | P | S | S | S | — | — | — | D05, D22 (future) | — |
| CQ9 Enhancability | P | S | S | S | — | — | — | D14, D22 (future) | — |

P=primary, S=supporting, —=gap or acceptable. Columns: A-EXEC=AUDIT-EXECUTE.md · RE-ENV=RE-ENVISION.md · TMPL=audit/templates · Domains=audit/domains · Trust=D15 Part B.

**Known gaps closed in 2.0.0:** P6 ↔ VISION (closed via Principle 18 Security and trust as identity); P7 ↔ VISION (closed via Principle 19 Runtime token economy).

**Content-quality axis status:** §3.2 establishes the structural matrix. Per-cell P/S markings will refine as Decision 13 specialist agents land and D22 Content Architecture domain is authored (CL-3 / CL-2 in subsequent cycles).

---

## 4. Audit Quality Architecture

The audit system operates on three layers so findings meet senior-engineer-level quality:

| Layer | Purpose | Concept Count | Canonical Location |
|-------|---------|:------------:|-------------------|
| 1. Audit System Mechanics | Structural completeness of the audit process | 16 | AUDIT.md §Execution Model |
| 2. Senior Human Parity | Behavioral traits matching expert judgment | 17 | AUDIT.md §Behavioral Charter |
| 3. Content Mirroring | Quality standards for audited content itself | 13 numbered + 9 production-readiness sections | agents/shared/quality-charter.md |

Layer 1 prevents mechanical gaps (missed domains, broken dependencies). Layer 2 prevents cognitive gaps (confirmation bias, shallow analysis). Layer 3 prevents output gaps (content that passes audit but fails users). All three must align for a finding to be valid.

---

## 5. Closed-Loop Rationale

### Identification Phases (read-only, in AUDIT.md)

| Phase | Purpose | Why Separated |
|-------|---------|---------------|
| CL-1 | PRD Evolution Identification | Audit findings inform product direction; identification is safe, modification requires consent |
| CL-2 | Content Gap Identification | New content proposals need specification before implementation |
| CL-3 | Audit Self-Evolution | Changing the audit system is the highest-risk operation; per-proposal consent required |

### Action Phases (in AUDIT-EXECUTE.md)

| Phase | Purpose | Why Separated |
|-------|---------|---------------|
| 5 | PRD Update | Filtered by execution results; failed findings excluded |
| 6 | Content Generation Planning | Specs only, not implementation; follows priority tiers |
| 7 | Audit Prompt Evolution | Per-proposal user consent; invariant checks (weights, SA counts) |

Identification and action are separated because audit is read-only (safe to run autonomously) while execution modifies files (requires regression gates and user oversight).

---

## 6. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | RE-ENVISION.md is a prompt, not a document | Vision changes are rare and high-impact; structured dialog prevents drift |
| 2 | VISION.md committed, PRD gitignored | Vision is public identity; PRD contains competitive operational detail |
| 3 | Identification/action separation | Audit reads safely; execution writes require gates and consent |
| 4 | Per-proposal consent for CL-3 | Changing the audit system is highest-risk; no batch approval |
| 5 | Content fixes flow through audit cycle | Permanent quality vs. one-time fix; audit cycle is the maintenance mechanism |
| 6 | Dual behavioral charters | Audit agents (17 directives) evaluate; content agents (quality charter) execute |
| 7 | Wave-based execution with regression gates | Progressive risk: critical first, gated between waves, rollback per-wave |
| 8 | Finding registry as central manifest | Single lifecycle record per finding; enables cross-cycle learning |
| 9 | Governance directory isolation | governance/ for governance, agents/ for content, src/ for code -- clear boundaries |
| 10 | Workspace features integrated into existing CLI commands | No separate command group; features belong in init/sync/config/status |
| 11 | RE-ENVISION is a holistic governance sparring engine with hybrid edit authority | Vision-only refinement leaves cross-layer drift unresolved between audits; sparring across all 10 governance layers via 10 parallel SAs + 20-theme dialog brings the corpus to one consistent state. Direct-edit (per-file consent) for VISION, lean thresholds, anti-bloat, Silent Failure, charter additions/refinements, anti-slop wordlist (atomic pair), EVOLVE mechanics, quality-charter, user-question-protocol, CLAUDE.md cross-refs. CL-3 / Phase 7 routing for audit-system (AUDIT.md domains/scoring/CL phases, AUDIT-EXECUTE waves/gates/registry, audit/domains, audit/templates, .claude/rules, .claude/skills). §8 amendment queue for pillars, traceability matrix, amendment protocol itself, Key Design Decisions. |
| 12 | Adapter scope reduced to `claude` + `cursor` + `copilot`; `.hatch3r/` is the sole user-visible footprint (1.9.0) | Maintaining 15 adapters fragmented test/audit attention and diluted per-adapter currency. Narrowing to 3 high-leverage platforms concentrates maintenance, raises the per-adapter quality bar (D9 SA count drops from 16 to 5), and eliminates 12 duplicated codepaths. Bundled-content model removes `.agents/` materialization from user repos — adapters read canonical content from the npm package via `resolveBundledContentRoot()`. `.hatch3r/` (manifest + learnings + handoffs + overrides + mcp) becomes the single hatch3r footprint; `.agents/hatch.json` migration shim covers in-place upgrades. Applied under §8 framework-owner direct authority as a major-version breaking change. |
| 13 | Command-vs-Skill authoring criterion: orchestration is the discriminator (1.9.0) | Pre-1.9.0 governance had no decision criterion (VISION.md:99-104 was descriptive only), letting 13 inline-execution commands accumulate alongside same-name skills (4 customize + 9 board/health/release/etc). Codifies: `orchestrator: true` + non-empty `agentPipeline` → command; everything else → skill. Eliminates ~1,600 LOC of redundant command shells; lets the slash-picker reflect orchestration semantics rather than author convention. Applied under §8 framework-owner direct authority. |
| 14 | Reputable-source reconnaissance mandate for content authoring (1.9.0) | Pre-1.9.0, `governance/audit/templates/rigor-contract.md` web-research mandate applied to audit findings only; `agents/shared/quality-charter.md` directed runtime agents, not authors. New canonical artifacts therefore drifted from current best practice — authors leaned on training-data recall. Mandates ≥2 independent reputable sources ≤12 months old at authoring time, synthesised (never copied), recorded in a `## References` section. Closes the P2 gap at the source. Applied under §8 framework-owner direct authority. |
| 15 | Two-axis pillar framework — governance (P1-P8) × content-quality (CQ1-CQ9) (2.0.0) | Decision 13's 9 specialist agents cannot inherit pillar parents under single-axis structure; content-quality dimensions warrant first-class pillar status with own ownership, measurement, traceability. ISO/IEC 25010:2023 validates two-axis approach as state-of-art (accessed 2026-05-26). Applied via §8 Amendment Protocol with framework-owner direct authority. |
| 16 | Solo/early-stage primary audience with maturity-tier escalation (2.0.0) | OSS framework defaults serve the most common user. Team/enterprise opt-in via `hatch3r config maturity=solo|team|scaleup|enterprise` calibrates content + audit depth + floor mandates per stage. Each tier admits different content subset. Codified in VISION.md §Who It's For + P4 measurement. |
| 17 | Explicit triage-tier vocabulary (Light/Standard/Deep) universal on orchestrator commands (2.0.0) | Per-task effort calibration absent in 1.x. Decision 7 mandates `triage_tiers` frontmatter array on every orchestrator + auto-tiering at runtime based on task-complexity classification. User overridable via `--effort` flag. |
| 18 | Tag-filtered candidate set + LLM-decided final pick routing (2.0.0) | Decision 8 routing model balances determinism (capability tags pre-filter via `src/content/tags.ts`) with adaptivity (LLM picks within filtered set per task). Project detection narrows further. Debuggable AND dynamic. |
| 19 | Proof-trace + mandatory citation hallucination prevention (2.0.0) | Decision 9 operationalizes hallucination prevention via per-claim `proof_trace:` block (file/grep/command/URL+date) + pre-execution verification gates on state-dependent assertions. AUDIT.md charter directive 20 encodes. Citation alone insufficient — verification commands close the loop. |
| 20 | Real-deal-first testing with documented mock justification (2.0.0) | Decision 11 mandates real I/O / real dependencies; mocks require `// MOCK: <reason>` comment + audit review per test-class mandate-map. Test-class-aware: unit may mock external, integration must real-test internal seams, E2E forbids all mocking. CQ5 measurement. |
| 21 | Pre-implementation discovery + post-write duplication scan (2.0.0) | Decision 12 procedural enforcement: codebase pattern search BEFORE writing + jscpd-style duplication scan AFTER writing (threshold tunable per maturity tier). AUDIT.md charter directives + agents/shared/quality-charter.md §12 encode. CQ8 measurement. |
| 22 | 9 dedicated quality-vector specialist agents per content-quality pillar (2.0.0) | Decision 13: hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability} specialists. Each owns review criteria + author skills + rule + audit domain + content-quality pillar. Reviewer + Implementer + Verifier delegate to specialists at appropriate gates. Authored in subsequent cycles. |
| 23 | 2 spec agents (greenfield + brownfield) with shared core (2.0.0) | Decision 14: hatch3r-greenfield-spec (market research + tech-stack + PRD) + hatch3r-brownfield-spec (codebase mapping + integration + migration). Different rigor profiles; orchestrator picks at init based on project state. Shared core: requirements + acceptance criteria + risk inventory + test plan. |
| 24 | Impact-gated finding registration (2.0.0) | Decision 17: every finding declares `impact_horizon: short|medium|long` AND `progress_toward_pillar: <pillar_id>+<delta>` (e.g., P5+0.15 or CQ3+0.20). Findings missing either field DROPPED at SA output time. AUDIT.md charter directive 18 + Pillar Compliance Test Q5 + Q6 encode. |
| 25 | SA resource model — 1:1 Critical + batched per severity (2.0.0) | Decision 18: AUDIT-EXECUTE Wave 1 spawns 1 SA per Critical (no parallel deps); Waves 2-4 batch High ≤8 / Medium ≤15 / Low ≤30 (Tier 1 extended) / Info ≤50 per same-pattern SA. Same-file file-lock + dependency-chain serialization preserved. Massively reduces SA spawn count without quality loss. |
| 26 | 3 new audit domains — D22 Content Architecture + D23 Agentic Engineering Trends + D24 Governance Self-Audit (2.0.0) | Decision 19: D22 audits canonical content corpus PLUS `.claude/rules + skills + hooks + agents + commands + CLAUDE.md` AS a system (obsolete/mergable/missing/fusionable artifacts); D23 per-cycle agentic-coding state-of-art research feeding CL-1 + CL-3; D24 governance/* + .claude/* + audit prompt self-audit. Domain count 21→24. Domain files authored in subsequent cycles. |
| 27 | Structured learning system with auto-consolidation + mandatory consultation gate (2.0.0) | Decision 22: project-level `.hatch3r/learnings/` with structured frontmatter (topic, applies-to, supersedes-IDs, confidence); auto-consolidation when redundant/contradicted; mandatory consult-INDEX.md step in every Implementer + Reviewer + Researcher agent. Encoded as `rules/hatch3r-learning-system.md` (authored in subsequent cycle). |
| 28 | Mandatory standardized iteration summary on every orchestrator + meaningful skill run (2.0.0) | Decision 23: 9-section template covering request, fan-out + cost actual vs estimate, web research, files mutated + diffs, gates passed/failed, pillar-impact attribution, verification commands, open questions, learnings captured. Encoded as `rules/hatch3r-iteration-summary.md` (authored in subsequent cycle). |
| 29 | Cost visibility — pre-execution estimate + post-execution actuals + delta (2.0.0) | Decision 24: every orchestrator emits at plan time {expected_sa_count, estimated_input_tokens_static_frame, triage_tier, web_research_budget, estimated_duration_min}; post-execution includes actuals + delta in iteration summary. Token telemetry from `src/pipeline/observability.ts` surfaced to end user. |
| 30 | Workspace-checkpointed resumability + per-session snapshot rollback (2.0.0) | Decision 27: long-running orchestrators write `.{cmd}-workspace/checkpoint.json`; `hatch3r {cmd} --resume` re-enters at last checkpoint. Pre-mutation snapshots in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts session mutations. Atomic temp+rename already in `src/merge/safeWrite.ts`. Circuit breaker classifies transient vs substantive failures. Diff preview before every mutation. |
| 31 | Audit-cycle OSS posture — Conventional Commits + automated SemVer + dual-tier changelog + supply-chain floor (2.0.0) | Decision 26: release-please-style automation; changelog dual-tier (Highlights for users + Technical for contributors); npm provenance + SBOM + SHA-pinned actions per supply-chain floor; CI matrix Ubuntu/macOS/Windows × Node LTS (22/24). Weekly content release, monthly CLI release. |

---

## 7. Governance File Structure

`governance/` top level: `CONSTITUTION.md` (this file) · `VISION.md` (public identity) · `RE-ENVISION.md` (capture/refinement prompt) · `AUDIT.md` (domains, scoring, charter, CL phases) · `AUDIT-EXECUTE.md` (waves, gates, registry, learning) · `inventory.json` (filesystem-derived counts, drift-checked in CI) · `hatch3r-prd.md`/`COMPETITIVE-ANALYSIS.md`/`AUDIT-REPORT.md` (gitignored).

`governance/audit/`: `domains/D01-D21.md` (21 domain definitions) plus `D15-trust-reference.md` (governed appendix to D15 per EVOLVE proposal P2, 2026-04-19) · `templates/` (sub-agent templates incl. `rigor-contract.md`) · `archive/` (archived sections per L6-F13 compression) · `baseline.json` · `finding-registry.json` · `execution-insights.json`. Trust delegation chain and compliance mapping live in `D15-trust-reference.md`. D22 Content Architecture + D23 Agentic Engineering Trends + D24 Governance Self-Audit domain files authored in subsequent audit cycles per Decision 19 (§6 Key Design Decision #26).

---

## 8. Amendment Protocol

Changes to this Constitution require:
- **Vision changes:** Use RE-ENVISION.md workflow
- **Audit system changes:** Use CL-3 (per-proposal consent)
- **All other changes:** Explicit framework owner approval with rationale

Every amendment must pass the Pillar Compliance Test (§2) and include date + rationale.

### RE-ENVISION direct-edit authorization (added 2026-05-18)

`governance/RE-ENVISION.md` is an authorized direct-edit path (with per-file consent at its §6.1) for the following layers: VISION.md content + principles; §2 P5 lean-threshold rows; §2 Anti-Bloat Principles; §2 Silent Failure Contract; behavioral charter directive additions and refinements in `governance/AUDIT.md` (directive removals route to CL-3); anti-slop wordlist in `governance/AUDIT-EXECUTE.md` regression gate 11 paired atomically with `CLAUDE.md` §Anti-Slop Wordlist; `governance/EVOLVE.md` prompt mechanics; `agents/shared/quality-charter.md`; `agents/shared/user-question-protocol.md`; `CLAUDE.md` cross-references. Pillars (§2 P1–P8 definitions), the Pillar-to-Governance Traceability Matrix (§3), this Amendment Protocol section (§8), and Key Design Decisions (§6) remain framework-owner direct-edits under this §8 protocol with dated rationale — RE-ENVISION emits a queued proposal in `.re-envision-workspace/constitution-amendment-queue.md` with pre-populated dated rationale for framework-owner application. Audit-system changes (AUDIT.md domains/scoring/CL phases, AUDIT-EXECUTE.md waves/gates/registry, audit/domains/D*.md, audit/templates/*.md, .claude/rules/*.md, .claude/skills/h4tcher-*/SKILL.md) route to CL-3 / AUDIT-EXECUTE Phase 7 per-proposal consent.

### 2.0.0 Routing Extensions (added 2026-05-26)

Four new amendment surfaces emerged with the 2.0.0 governance rewrite. Their routes:

1. **Cross-§ amendment composition:** When a charter directive ADDITION (RE-ENVISION direct-edit per §5.1) also requires a §3 matrix cell update (§8 amendment), both edits land in one atomic constitution-amendment-queue entry; framework-owner consents once.
2. **Domain creation atomic-pair:** New D-domain files via CL-3 must also queue the §3 matrix Domains-cell update for the same amendment cycle.
3. **Canonical-namespace rule additions (`rules/hatch3r-*.md`):** Explicitly route to CL-3 + D5/D1 content audit (canonical content corpus, not framework-dev `.claude/rules/`).
4. **§3 second-axis row additions:** Adding new content-quality pillars (CQ10+) is §8 (matrix structure change). Per-cell entries on existing rows (P or S markings) are CL-3.

These clarifications preserve framework-owner final-arbiter authority while reducing per-amendment routing negotiation during the 2.0.0 amendment campaign.
