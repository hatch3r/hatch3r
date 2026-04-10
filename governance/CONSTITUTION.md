# hatch3r — Constitution

> Established: 2026-03-25 | Restructured: 2026-04-09 (Cycle 5 Reaudit)
> Design rationale for the hatch3r governance system. VISION.md defines what we aspire to. This Constitution defines why we made these choices and how the governance system holds itself accountable.

---

## 1. Identity

hatch3r is an open-source CLI that installs tool-agnostic agentic coding setups into any repository via a canonical source model and platform adapters. For full identity, audience, and principles, see [VISION.md](VISION.md).

---

## 2. The 6 Binding Pillars

Every governance file, audit domain, and enhancement decision must serve at least one pillar. These are the constitutional heart of the governance system.

### P1. CLI UI/UX Excellence

Every lifecycle stage (init through release) delivers the best achievable CLI interface: clear prompts, actionable errors, progressive disclosure, accessible output.

**Measurement:** Time-to-first-value (steps from init to first useful output), decision count per flow, error recovery rate (% of errors with actionable next steps), first-run success rate.
**Governance refs:** AUDIT.md D10 (UX & Documentation), charter directive 11 (user-facing perspective).

### P2. Scientific & Practical Quality

Content is of verifiable, real-world-applicable quality. Agents self-validate assumptions against neutral senior baselines without explicit prompting. Operationalized through the Behavioral Charter (challenge the premise, adversarial thinking), measurable acceptance criteria, confidence expression, root-cause orientation.

**Measurement:** Behavioral charter compliance rate, one-shot success rate (see [VISION.md](VISION.md) §Quality Bar), finding root-cause depth (symptom vs. systemic).
**Governance refs:** AUDIT.md Behavioral Charter (13 directives), Audit Quality Architecture (3 layers), D1/D5/D7/D13.

### P3. Adapter & MCP Currency

Every adapter and MCP server stays current through audit cycles. Each cycle mandates live web research against latest platform documentation. Staleness is a finding.

**Measurement:** Platform documentation date vs. audit date delta, feature gap count per adapter, adapter test coverage.
**Governance refs:** AUDIT.md D9 (Platform Adapters, web research mandate), charter directive 12 (currency verification), D2.

### P4. Comprehensive Lean Coverage

Commands and shared resources cover every end-to-end stage of production software at every scale. Content stays lean: no bloat, no duplication, single-source-of-truth, every file earns its existence.

**Measurement:** Lifecycle phase coverage percentage, content-to-purpose ratio, duplication index, governance total line count (target <=3000).
**Governance refs:** AUDIT.md D16 (Cross-Domain Synthesis), CL-2 (Content Gap Identification), charter directive 13 (duplication awareness).

### P5. Governance Self-Quality

Governance and audit cycles apply the same quality standards, anti-slop, and anti-overhead principles to themselves. The governance system must pass its own tests.

**Measurement:** Governance duplication index (<5%), finding inflation ratio (<2.0x), false positive rate, anti-slop phrase count (0 per file), governance file line counts within lean thresholds.
**Governance refs:** CL-3 (Audit Self-Evolution), regression gate check 9 (governance weight), lean thresholds below.

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| CONSTITUTION.md | <=200 lines | Stable unless new pillars added |
| AUDIT.md | <=600 lines | ±4 lines per domain count delta |
| AUDIT-EXECUTE.md | <=700 lines | ±50 lines per execution phase delta |
| Domain file | 30-80 lines | Sub-agent count × 15 as baseline |
| Cross-file duplication | <5% | 0% ideal; audit per cycle |
| Finding inflation | <2.0x pre-dedup/post-triage | Source-level dedup improvement |
| Governance total | <=3000 lines | Increasing across cycles = bloat signal |
| Anti-slop phrases | 0 per file | Pattern match per cycle |
| Checklist items/SA | 4-8 | <4 shallow, >8 too broad |

#### Anti-Bloat Principles

1. **Single Source of Truth:** Every concept defined in exactly one file. Others reference it.
2. **Earn Your Existence:** Every file, section, row serves at least one pillar. If none, remove.
3. **Compression Over Verbosity:** Tables over prose. References over repetition.
4. **Proportional Depth:** File size proportional to governed complexity.
5. **Anti-Slop:** No filler phrases without measurable criteria. See anti-slop wordlist in AUDIT-EXECUTE.md regression gates.

### P6. Security & Trust Governance

Security and trust are first-class governance concerns integrated into every tier, not siloed. Trust delegation, verification, revocation, and OWASP ASI compliance are governance-level requirements.

**Measurement:** Trust control coverage percentage, time to security finding resolution, ASI control compliance rate.
**Governance refs:** D15 (Agentic Security & Trust Model, including trust delegation chain and compliance mapping in Part B).

### Pillar Compliance Test

For any proposed governance change, answer:
1. Which pillar(s) does this change serve?
2. What measurable improvement does it produce?
3. Does it increase or decrease governance total size?

If (1) is "none", the change is rejected. If (3) is "increase", the change must justify net value exceeding the size cost.

---

## 3. Pillar-to-Governance Traceability Matrix

| Pillar | CONSTITUTION | VISION | AUDIT | AUDIT-EXECUTE | Key Domains | Trust (D15 Part B) |
|--------|:-----------:|:------:|:-----:|:------------:|:-----------:|:------------------:|
| P1 CLI UX | S | P | S | S | D10 | -- |
| P2 Quality | P | P | P | S | D1,D5,D7,D13 | -- |
| P3 Currency | S | P | P | S | D2,D9 | S |
| P4 Lean | S | P | P | P | D5,D16 | -- |
| P5 Governance | P | S | P | P | D16,D18,D19 | -- |
| P6 Security | P | -- | S | S | D15 | P |

P = primary coverage, S = supporting coverage, -- = no coverage (gap or acceptable).

**Known gap:** P6 has no VISION.md coverage. Recommendation: add a security/trust principle via the RE-ENVISION.md workflow in a future cycle.

---

## 4. Audit Quality Architecture

The audit system operates on three layers so findings meet senior-engineer-level quality:

| Layer | Purpose | Concept Count | Canonical Location |
|-------|---------|:------------:|-------------------|
| 1. Audit System Mechanics | Structural completeness of the audit process | 16 | AUDIT.md §Execution Model |
| 2. Senior Human Parity | Behavioral traits matching expert judgment | 5 | AUDIT.md §Behavioral Charter |
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

```
governance/
├── CONSTITUTION.md          <- This file: design rationale, pillars, traceability
├── VISION.md                <- North star statement (public identity)
├── RE-ENVISION.md           <- Vision capture/refinement prompt
├── AUDIT.md                 <- Audit prompt (domains, scoring, charter, CL phases)
├── AUDIT-EXECUTE.md         <- Execution companion (waves, gates, registry, learning)
├── hatch3r-prd.md           <- Product requirements (gitignored)
├── COMPETITIVE-ANALYSIS.md  <- Market context (gitignored)
├── AUDIT-REPORT.md          <- Latest audit results (gitignored)
└── audit/
    ├── domains/D01-D19.md   <- Domain definitions (18 files)
    ├── templates/            <- Sub-agent templates (4 files)
    ├── baseline.json         <- Immutable baseline per cycle
    ├── finding-registry.json <- Finding lifecycle tracking
    └── execution-insights.json <- Cross-cycle learning
```

Trust delegation chain and compliance mapping are in D15 Part B (not separate files).

---

## 8. Amendment Protocol

Changes to this Constitution require:
- **Vision changes:** Use RE-ENVISION.md workflow
- **Audit system changes:** Use CL-3 (per-proposal consent)
- **All other changes:** Explicit framework owner approval with rationale

Every amendment must pass the Pillar Compliance Test (§2) and include date + rationale.
