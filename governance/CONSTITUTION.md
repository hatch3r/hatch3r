# hatch3r — Constitution

> Established: 2026-03-25 | Restructured: 2026-04-09 (Cycle 5 Reaudit) | Amended: 2026-05-18 (RE-ENVISION redesigned as holistic governance sparring engine — §2 P5 lean-threshold row recalibrated, §3 traceability cells updated, §6 Decision #11 added, §8 authorizes RE-ENVISION as direct-edit path for permitted layers)
> Last updated: 2026-05-26
> Design rationale for the hatch3r governance system. VISION.md defines what we aspire to. This Constitution defines why we made these choices and how the governance system holds itself accountable.

---

## 1. Identity

hatch3r is an open-source CLI that installs tool-agnostic agentic coding setups into any repository via a canonical source model and platform adapters. For full identity, audience, and principles, see [VISION.md](VISION.md).

---

## 2. The 8 Binding Pillars

Every governance file, audit domain, and enhancement decision must serve at least one pillar. These are the constitutional heart of the governance system.

### P1. CLI UI/UX Excellence

Every lifecycle stage (init through release) delivers a CLI interface measured by the metrics below (P1 Measurement): clear prompts, actionable errors, progressive disclosure, accessible output.

**Measurement:** Time-to-first-value (steps from init to first useful output), decision count per flow, error recovery rate (% of errors with actionable next steps), first-run success rate.
**Governance refs:** AUDIT.md D10 (UX & Documentation), charter directive 11 (user-facing perspective).

### P2. Scientific & Practical Quality

Content is of verifiable, real-world-applicable quality. Findings carry the Scientific Rigor Contract — falsifiability, triangulated citations, confidence with basis, ≥3-step causal chain, bias check, peer-review counter-argument — defined in [audit/templates/rigor-contract.md](audit/templates/rigor-contract.md) and operationalised by the Behavioral Charter.

**Measurement:** Behavioral charter compliance rate, one-shot success rate (see [VISION.md](VISION.md) §Quality Bar), finding root-cause depth (symptom vs. systemic). Agent-produced UI/UX measurement: WCAG 2.2 AA conformance via axe-core (0 serious/critical violations per route and per component), design-token adoption rate ≥95% on color and spacing in generated code, four-state surface contract coverage on async views (loading + empty + error + partial = 100%), agent-produced one-shot UI/UX acceptance rate cycle-over-cycle. Production-readiness metrics extend P2 to agent-produced services: instrumented-route ratio (observability) = 100%; expand-contract conformance on schema changes (migrations) = 100%; API breaking-change events per release on stable endpoints = 0; AI feature eval coverage with hallucination-as-SLI defined = 100%; per-feature-mandate-map coverage on test classes (testing depth) = 100%; SBOM + npm provenance + SHA-pinned actions (supply chain) = 100%; SLO defined on user-facing services (reliability) = 100%; OAuth 2.1 + passkey-server + RBAC-or-better authorization (auth depth) = 100%.
**Governance refs:** [AUDIT.md §Sub-Agent Behavioral Charter](AUDIT.md) (17 directives, authoritative location), Audit Quality Architecture (3 layers), D1/D5/D7/D13.

### P3. Adapter & External Tool Currency

The 3 supported adapters (`claude`, `cursor`, `copilot`), end-user-recommended CLI tools, and MCP servers stay current through audit cycles. Each cycle mandates live web research against latest official documentation, vendor changelogs ≤12 months old, and CVE feeds ≤90 days old. Staleness >90 days for any tier-1 tool is a Medium finding; missing CVE check is High. Scope narrowed to 3 adapters in 1.9.0 (Decision #12) — narrower scope raises the per-adapter currency bar.

**Measurement:** Platform documentation date vs. audit date delta (per adapter and per CLI tool, N=3 adapters), feature gap count per adapter, adapter test coverage, CLI tool currency delta (last vendor release vs cycle date, target ≤90 days), CVE advisory acknowledgement count per cycle.
**Governance refs:** AUDIT.md D9 (Platform Adapters, web research mandate, 3 adapter SAs + 2 synthesis), D21 (CLI Tool Currency), D2.4 (External Tool Config Utilities), charter directive 12 (currency verification), D15.5 + D15.7 (MCP and CLI supply-chain trust).

### P4. Comprehensive Lean Coverage

Commands and shared resources cover every end-to-end stage of production software at every scale. Content stays lean: no bloat, no duplication, single-source-of-truth, every file earns its existence.

**Measurement:** Lifecycle phase coverage percentage, content-to-purpose ratio, duplication index, artifact-level redundancy candidates surfaced per cycle, user-content authoring tool quality, governance total line count (target <=3000).
**Governance refs:** AUDIT.md D16 (Cross-Domain Synthesis), CL-2 (Content Gap Identification), charter directive 13 (duplication awareness), D20 (User-Content Authoring).

### P5. Governance Self-Quality

Governance and audit cycles apply the same quality standards, anti-slop, and anti-overhead principles to themselves. The governance system must pass its own tests.

**Measurement:** Governance duplication index (<5%), finding inflation ratio (<2.0x), false positive rate, anti-slop phrase count (0 per file), governance file line counts within lean thresholds.
**Governance refs:** CL-3 (Audit Self-Evolution), regression gate check 9 (governance weight), lean thresholds below.

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| CONSTITUTION.md | <=410 lines | +25 per governance pillar (P8 baseline) + 15 per content-quality vector + 5 per matrix-column added per new audit domain + 3 per finding field added to Required Finding Output Schema; recalibrated 2026-05-26 for 2.0.0 two-axis pillar framework |
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

**Measurement:** Trust control coverage percentage, time to security finding resolution, ASI control compliance rate.
**Governance refs:** D15 (Agentic Security & Trust Model, including trust delegation chain and compliance mapping in Part B).

### P7. Speed & Token Efficiency (end-user runtime)

End-user agentic flows (commands, agents, skills consumed in `npx hatch3r`-installed projects) are tuned for token economy and latency, using only zero-quality-loss techniques established in published LLM literature: static-first prompt structure for cross-provider cache friendliness, parallel-tool-by-default, triage-first orchestration with auto-tiered depth (Light/Standard/Deep), plan/act split, structured outputs over prose, and lazy loading via reference-by-pointer. P7 governs the static-prompt frame and dependency-edge serialization — it does NOT govern fan-out width. Aggressive compression that risks quality is rejected. The audit-cycle prompt itself (AUDIT.md, RE-ENVISION.md, `hatch3r-audit-cycle*.md`) is exempt — depth there is non-negotiable. AUDIT-EXECUTE.md is no longer exempt as of Cycle 9: it carries `triage_tiers` and groups Low/Info trivial findings sharing a closed `tier1_pattern` into batch sub-agents (≤30 per batch), preserving the rule that the orchestrator never edits files itself.

**Tension with P8 resolved:** P7 minimizes token waste in the static prompt structure; P8 mandates fan-out width sufficient for task size. Token cost is never a valid reason to under-fan-out (P8 dominates).

**Measurement:** static-first ordering compliance (100% of orchestrator commands), parallel-tool directive presence (100% of multi-tool agents), triage-first directive on `orchestrator: true` commands (required), passive token/latency telemetry deltas in `src/pipeline/observability.ts` cycle-over-cycle (informational).
**Governance refs:** AUDIT.md D06 (extended), charter directive 14 (Speed & Token Efficiency Awareness), lean thresholds below (efficiency rows).

### P8. Clarification & Fan-out Discipline

Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

Sub-agent fan-out scales with task size; serialization is only valid on dependency edges. Token cost is never a valid reason to serialize independent work. Delegating artifacts emit sub-agent count + rationale as a first-class output field.

**Measurement:** B1 gate present rate (target 100% across agents, skills, commands), sub-agent count emission rate on delegating artifacts (target 100%), under-fan-out incidents per cycle (target 0). User-content authoring tools count toward this when they delegate.
**Governance refs:** AUDIT.md Behavioral Charter directive 17 (clarification-first verification), D05 (B1 in prompts), D07 (B2 in orchestration), D13 (B1 in human-AI collaboration), shared/user-question-protocol.md.

### Pillar Compliance Test

For any proposed governance change, answer: (1) which pillar(s) it serves, (2) what measurable improvement it produces, (3) whether it increases or decreases governance total size, (4) whether it degrades end-user runtime efficiency.

If (1) is "none", the change is rejected. If (3) is "increase", justify net value exceeding the size cost. If (4) is "yes", reject or document the offsetting gain.

---

## 3. Pillar-to-Governance Traceability Matrix

| Pillar | CONST | VISION | AUDIT | A-EXEC | RE-ENV | EVOLVE | TMPL | Domains | Trust |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| P1 CLI UX | S | P | S | S | S | S | — | D10, D20.1 | — |
| P2 Quality | P | P | P | S | S | S | P | D1,D5,D7,D13 | — |
| P3 Currency | S | P | P | S | — | S | — | D2,D9,D21 | P |
| P4 Lean | S | P | P | P | S | S | — | D5,D16, D20 | — |
| P5 Governance | P | S | P | P | P | P | S | D16,D18,D19, D20 | — |
| P6 Security | P | — | S | S | — | — | — | D15, D20.2 | P |
| P7 Speed & Tokens | S | — | S | S | — | — | — | D6 | — |
| P8 Clarification & Fan-out | P | P | P | S | P | — | S | D5,D7,D13 | — |

P=primary, S=supporting, —=gap or acceptable. Columns: A-EXEC=AUDIT-EXECUTE.md · RE-ENV=RE-ENVISION.md · TMPL=audit/templates · Domains=audit/domains · Trust=D15 Part B.
**Known gaps:** P6 ↔ VISION.md and P7 ↔ VISION.md — add via RE-ENVISION.md workflow.

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

---

## 7. Governance File Structure

`governance/` top level: `CONSTITUTION.md` (this file) · `VISION.md` (public identity) · `RE-ENVISION.md` (capture/refinement prompt) · `AUDIT.md` (domains, scoring, charter, CL phases) · `AUDIT-EXECUTE.md` (waves, gates, registry, learning) · `inventory.json` (filesystem-derived counts, drift-checked in CI) · `hatch3r-prd.md`/`COMPETITIVE-ANALYSIS.md`/`AUDIT-REPORT.md` (gitignored).

`governance/audit/`: `domains/D01-D21.md` (21 domain definitions) · `templates/` (sub-agent templates incl. `rigor-contract.md`) · `baseline.json` · `finding-registry.json` · `execution-insights.json`. Trust delegation chain and compliance mapping live in D15 Part B (not separate files).

---

## 8. Amendment Protocol

Changes to this Constitution require:
- **Vision changes:** Use RE-ENVISION.md workflow
- **Audit system changes:** Use CL-3 (per-proposal consent)
- **All other changes:** Explicit framework owner approval with rationale

Every amendment must pass the Pillar Compliance Test (§2) and include date + rationale.

### RE-ENVISION direct-edit authorization (added 2026-05-18)

`governance/RE-ENVISION.md` is an authorized direct-edit path (with per-file consent at its §6.1) for the following layers: VISION.md content + principles; §2 P5 lean-threshold rows; §2 Anti-Bloat Principles; §2 Silent Failure Contract; behavioral charter directive additions and refinements in `governance/AUDIT.md` (directive removals route to CL-3); anti-slop wordlist in `governance/AUDIT-EXECUTE.md` regression gate 11 paired atomically with `CLAUDE.md` §Anti-Slop Wordlist; `governance/EVOLVE.md` prompt mechanics; `agents/shared/quality-charter.md`; `agents/shared/user-question-protocol.md`; `CLAUDE.md` cross-references. Pillars (§2 P1–P8 definitions), the Pillar-to-Governance Traceability Matrix (§3), this Amendment Protocol section (§8), and Key Design Decisions (§6) remain framework-owner direct-edits under this §8 protocol with dated rationale — RE-ENVISION emits a queued proposal in `.re-envision-workspace/constitution-amendment-queue.md` with pre-populated dated rationale for framework-owner application. Audit-system changes (AUDIT.md domains/scoring/CL phases, AUDIT-EXECUTE.md waves/gates/registry, audit/domains/D*.md, audit/templates/*.md, .claude/rules/*.md, .claude/skills/h4tcher-*/SKILL.md) route to CL-3 / AUDIT-EXECUTE Phase 7 per-proposal consent.
