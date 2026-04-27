# hatch3r — Constitution

> Established: 2026-03-25 | Restructured: 2026-04-09 (Cycle 5 Reaudit)
> Design rationale for the hatch3r governance system. VISION.md defines what we aspire to. This Constitution defines why we made these choices and how the governance system holds itself accountable.

---

## 1. Identity

hatch3r is an open-source CLI that installs tool-agnostic agentic coding setups into any repository via a canonical source model and platform adapters. For full identity, audience, and principles, see [VISION.md](VISION.md).

---

## 2. The 7 Binding Pillars

Every governance file, audit domain, and enhancement decision must serve at least one pillar. These are the constitutional heart of the governance system.

### P1. CLI UI/UX Excellence

Every lifecycle stage (init through release) delivers the best achievable CLI interface: clear prompts, actionable errors, progressive disclosure, accessible output.

**Measurement:** Time-to-first-value (steps from init to first useful output), decision count per flow, error recovery rate (% of errors with actionable next steps), first-run success rate.
**Governance refs:** AUDIT.md D10 (UX & Documentation), charter directive 11 (user-facing perspective).

### P2. Scientific & Practical Quality

Content is of verifiable, real-world-applicable quality. Findings carry the Scientific Rigor Contract — falsifiability, triangulated citations, confidence with basis, ≥3-step causal chain, bias check, peer-review counter-argument — defined in [audit/templates/rigor-contract.md](audit/templates/rigor-contract.md) and operationalised by the Behavioral Charter.

**Measurement:** Behavioral charter compliance rate, one-shot success rate (see [VISION.md](VISION.md) §Quality Bar), finding root-cause depth (symptom vs. systemic).
**Governance refs:** [AUDIT.md §Sub-Agent Behavioral Charter](AUDIT.md) (13 directives, authoritative location), Audit Quality Architecture (3 layers), D1/D5/D7/D13.

### P3. Adapter & MCP Currency

Every adapter and MCP server stays current through audit cycles. Each cycle mandates live web research against latest platform documentation. Staleness is a finding.

**Measurement:** Platform documentation date vs. audit date delta, feature gap count per adapter, adapter test coverage.
**Governance refs:** AUDIT.md D9 (Platform Adapters, web research mandate), charter directive 12 (currency verification), D2.

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
| CONSTITUTION.md | <=225 lines | +25 per binding pillar added |
| VISION.md | <=250 lines | Stable; add principles rarely |
| AUDIT.md | <=600 lines | ±4 lines per domain count delta |
| AUDIT-EXECUTE.md | <=700 lines | ±50 lines per execution phase delta |
| RE-ENVISION.md | <=350 lines | ±20 lines per theme-block delta |
| EVOLVE.md | <=400 lines | ±20 lines per assessment-dimension delta |
| Static-first prompt structure | required for `orchestrator: true` and `agents/*.md` | scripts/validate-efficiency-invariants.ts |
| Parallel-tool-by-default directive | required when artifact uses ≥2 independent tool calls | Body-text scan |
| Triage-first orchestrator | required when `orchestrator: true` | Frontmatter `triage_tiers` array |
| Anti-cache patterns | 0 per artifact | No volatile tokens above static frame |
| Domain file (SA ≤5) | 30-80 lines | Limit authoritative |
| Domain file (SA >5) | SA × 15 lines | Calibration supersedes Limit |
| Template file | 80-200 lines | Role-specific; bounded by role scope |
| Cross-file duplication | <5% | 0% ideal; audit per cycle |
| Finding inflation | <2.0x pre-dedup/post-triage | Source-level dedup improvement |
| Governance total | <=3000 lines | Increasing across cycles = bloat signal |
| Anti-slop phrases | 0 per file | Pattern match per cycle |
| Checklist items/SA | 4-8 | <4 shallow, >8 too broad |

#### Anti-Bloat Principles

1. **Single Source of Truth:** every concept defined in exactly one file; others reference it.
2. **Earn Your Existence:** every file, section, row serves at least one pillar — if none, remove.
3. **Compression Over Verbosity:** tables over prose; references over repetition.
4. **Proportional Depth:** file size proportional to governed complexity.
5. **Anti-Slop:** no filler phrases without measurable criteria (wordlist in AUDIT-EXECUTE.md regression gates).
6. **Currency transparency:** every governance prompt/template carries `> Last updated: YYYY-MM-DD` as line 2 or 3; absence Low, >180-day staleness Medium (verified by AUDIT-EXECUTE.md regression gates).

#### Silent Failure Contract

Every `catch` block in `src/` MUST emit a diagnostic via one of: a `warnings[]` array returned to the caller, the observability channel (`src/pipeline/observability.ts`), or the failure log (`src/pipeline/failureLog.ts`). Catch-and-skip without channel emission is a contract violation — failures hidden from operators are indistinguishable from success and silently degrade the lean coverage guarantee (P4).

Acceptable patterns: re-throw after classification (e.g. `if (code !== "ENOENT") throw err`); emit then return a sentinel; push to a caller-visible warnings collection. Unacceptable patterns: empty catch body; catch that contains only `return null` / `return []` / `return undefined`. Enforced by ESLint rule `silent-failure/no-silent-catch` (warning severity; opt-out via `// eslint-disable-next-line silent-failure/no-silent-catch` requires a justification comment naming the diagnostic channel that replaces it).

### P6. Security & Trust Governance

Security and trust are first-class governance concerns integrated into every tier, not siloed. Trust delegation, verification, revocation, and OWASP ASI compliance are governance-level requirements.

**Measurement:** Trust control coverage percentage, time to security finding resolution, ASI control compliance rate.
**Governance refs:** D15 (Agentic Security & Trust Model, including trust delegation chain and compliance mapping in Part B).

### P7. Speed & Token Efficiency (end-user runtime)

End-user agentic flows (commands, agents, skills consumed in `npx hatch3r`-installed projects) are tuned for token economy and latency, using only zero-quality-loss techniques established in published LLM literature: static-first prompt structure for cross-provider cache friendliness, parallel-tool-by-default, triage-first orchestration with auto-tiered depth (Light/Standard/Deep), plan/act split, structured outputs over prose, lazy loading via reference-by-pointer, and conditional sub-agent invocation. Aggressive compression that risks quality is rejected. The audit cycle (AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, audit commands) is exempt — depth there is non-negotiable.

**Measurement:** static-first ordering compliance (100% of orchestrator commands), parallel-tool directive presence (100% of multi-tool agents), triage-first directive on `orchestrator: true` commands (required), passive token/latency telemetry deltas in `src/pipeline/observability.ts` cycle-over-cycle (informational).
**Governance refs:** AUDIT.md D06 (extended), charter directive 14 (Speed & Token Efficiency Awareness), lean thresholds below (efficiency rows).

### Pillar Compliance Test

For any proposed governance change, answer: (1) which pillar(s) it serves, (2) what measurable improvement it produces, (3) whether it increases or decreases governance total size, (4) whether it degrades end-user runtime efficiency.

If (1) is "none", the change is rejected. If (3) is "increase", justify net value exceeding the size cost. If (4) is "yes", reject or document the offsetting gain.

---

## 3. Pillar-to-Governance Traceability Matrix

| Pillar | CONST | VISION | AUDIT | A-EXEC | RE-ENV | EVOLVE | TMPL | Domains | Trust |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| P1 CLI UX | S | P | S | S | S | S | — | D10, D20.1 | — |
| P2 Quality | P | P | P | S | S | S | P | D1,D5,D7,D13 | — |
| P3 Currency | S | P | P | S | — | S | — | D2,D9 | S |
| P4 Lean | S | P | P | P | — | S | — | D5,D16, D20 | — |
| P5 Governance | P | S | P | P | S | P | S | D16,D18,D19, D20 | — |
| P6 Security | P | — | S | S | — | — | — | D15, D20.2 | P |
| P7 Speed & Tokens | S | — | S | S | — | — | — | D6 | — |

P=primary, S=supporting, —=gap or acceptable. Columns: A-EXEC=AUDIT-EXECUTE.md · RE-ENV=RE-ENVISION.md · TMPL=audit/templates · Domains=audit/domains · Trust=D15 Part B.
**Known gaps:** P6 ↔ VISION.md and P7 ↔ VISION.md — add via RE-ENVISION.md workflow.

---

## 4. Audit Quality Architecture

The audit system operates on three layers so findings meet senior-engineer-level quality:

| Layer | Purpose | Concept Count | Canonical Location |
|-------|---------|:------------:|-------------------|
| 1. Audit System Mechanics | Structural completeness of the audit process | 16 | AUDIT.md §Execution Model |
| 2. Senior Human Parity | Behavioral traits matching expert judgment | 6 | AUDIT.md §Behavioral Charter |
| 3. Content Mirroring | Quality standards for audited content itself | 8 | agents/shared/quality-charter.md |

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
| 6 | Dual behavioral charters | Audit agents (13 directives) evaluate; content agents (quality charter) execute |
| 7 | Wave-based execution with regression gates | Progressive risk: critical first, gated between waves, rollback per-wave |
| 8 | Finding registry as central manifest | Single lifecycle record per finding; enables cross-cycle learning |
| 9 | Governance directory isolation | governance/ for governance, agents/ for content, src/ for code -- clear boundaries |
| 10 | Workspace features integrated into existing CLI commands | No separate command group; features belong in init/sync/config/status |

---

## 7. Governance File Structure

`governance/` top level: `CONSTITUTION.md` (this file) · `VISION.md` (public identity) · `RE-ENVISION.md` (capture/refinement prompt) · `AUDIT.md` (domains, scoring, charter, CL phases) · `AUDIT-EXECUTE.md` (waves, gates, registry, learning) · `inventory.json` (filesystem-derived counts, drift-checked in CI) · `hatch3r-prd.md`/`COMPETITIVE-ANALYSIS.md`/`AUDIT-REPORT.md` (gitignored).

`governance/audit/`: `domains/D01-D19.md` (19 domain definitions) · `templates/` (sub-agent templates incl. `rigor-contract.md`) · `baseline.json` · `finding-registry.json` · `execution-insights.json`. Trust delegation chain and compliance mapping live in D15 Part B (not separate files).

---

## 8. Amendment Protocol

Changes to this Constitution require:
- **Vision changes:** Use RE-ENVISION.md workflow
- **Audit system changes:** Use CL-3 (per-proposal consent)
- **All other changes:** Explicit framework owner approval with rationale

Every amendment must pass the Pillar Compliance Test (§2) and include date + rationale.
