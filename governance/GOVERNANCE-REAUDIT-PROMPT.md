# hatch3r Governance Reaudit & Constitution Restructuring

## Purpose

Perform a structural reaudit of the hatch3r governance system. Restructure
CONSTITUTION.md around 6 Binding Pillars. Evaluate all 19 audit domains for
merge/split/remove. Remove governance bloat across all governance files.
Align AUDIT.md and AUDIT-EXECUTE.md with pillar standards. All outputs are
proposals — no files are modified during this audit.

This is a governance-level audit, not a code or content audit. The scope is
the governance files themselves.

> Mode: PLAN ONLY. Every output is a structured proposal with rationale.
> The framework owner reviews and approves before any file modifications.

---

## Framework State

- Cycle: 4 (completed)
- Score: 85 (post-execution), up from 78 (Cycle 3)
- Fix success rate: 93.6% (0 rollbacks across 4 waves)
- 19 domains, 107 sub-agents, 4 tiers
- Governance files: governance/ directory
- Target: All changes land in Cycle 5 as a single restructuring

### Governance File Inventory

| File | Role | Committed |
|------|------|-----------|
| CONSTITUTION.md | Design decisions, quality principles | Yes |
| VISION.md | North star statement | Yes |
| RE-ENVISION.md | Vision capture prompt | Yes |
| AUDIT.md | 19-domain audit prompt | Yes |
| AUDIT-EXECUTE.md | Wave-based execution companion | Yes |
| trust-delegation-chain.md | Trust flow documentation | Yes |
| trust-framework-compliance.md | ASI control mapping | Yes |
| hatch3r-prd.md | Product requirements | Gitignored |
| COMPETITIVE-ANALYSIS.md | Market context | Gitignored |
| AUDIT-REPORT.md | Latest audit results | Gitignored |
| audit/domains/D01-D19.md | 19 domain definitions | Yes |
| audit/templates/*.md | Sub-agent templates (3 files) | Yes |
| audit/baseline.json | Immutable baseline metrics | Yes |
| audit/finding-registry.json | Finding lifecycle tracking | Yes |
| audit/execution-insights.json | Cross-cycle learning | Yes |

No governance file is immutable for this reaudit. All are open for
restructuring, merging, or removal if justified.

---

## The 6 Binding Pillars

These govern every governance file, every audit domain, and every
enhancement decision. They are the constitutional heart. Every governance
artifact must demonstrably serve at least one pillar.

**P1. CLI UI/UX Excellence**
Every lifecycle stage (init through release) has the best achievable CLI
interface: clear prompts, actionable errors, progressive disclosure,
accessible output. Measured by: time-to-first-value, decision count per
flow, error recovery rate.

**P2. Scientific & Practical Quality**
Content is of verifiable, real-world-applicable quality. Agents continuously
self-validate assumptions against neutral senior baselines without explicit
prompting. Operationalized through: the Behavioral Charter (challenge the
premise, adversarial thinking), measurable acceptance criteria, confidence
expression, root-cause orientation.

**P3. Adapter & MCP Currency**
Every adapter (15) and MCP server (10) stays current through audit cycles.
Each audit cycle mandates live web research against latest platform
documentation. Staleness is a finding. Measured by: platform documentation
date vs audit date delta, feature gap count per adapter.

**P4. Comprehensive Lean Coverage**
Commands and shared resources cover every E2E stage of production software
at every scale. Content stays lean: no bloat, no slop, no duplication,
single-source-of-truth, every file earns its existence. Measured by:
lifecycle phase coverage percentage, content-to-purpose ratio, duplication
index.

**P5. Governance Self-Quality**
Governance and audit cycles apply the same quality standards, anti-slop, and
anti-overhead principles to themselves. Includes: measurability, regression
prevention, baselines, scoring methodology integrity. The governance system
must pass its own tests. Measured by: governance file duplication index,
finding inflation/deflation trend, false positive rate.

**P6. Security & Trust Governance**
Security and trust are first-class governance concerns integrated into every
tier, not siloed in D15. Trust delegation, verification, revocation, and
OWASP ASI compliance are governance-level requirements. Measured by: trust
control coverage percentage, time to security finding resolution.

---

## Phase 0: Load Historical Context

Before any analysis, ingest execution history to ground proposals in data.

### Step 0.1: Read execution-insights.json
File: governance/audit/execution-insights.json
Extract: fix success rates by category, sizing accuracy, recurring failures,
top insights, closed-loop phase results, score progression.

### Step 0.2: Read finding-registry.json
File: governance/audit/finding-registry.json
Extract: finding distribution by domain and severity, dedup patterns,
false positive rates, domains with highest partial/failed counts.

### Step 0.3: Read baseline.json
File: governance/audit/baseline.json
Extract: domain scores at audit start. Identify domains that improved
most/least during execution.

### Step 0.4: Synthesize Historical Patterns
Produce a structured summary:

| Pattern | Evidence | Implication for Reaudit |
|---------|----------|------------------------|
| D12 lowest score at 60 | execution-insights top_insights | Domain scope misalignment |
| D16 re-reports D3/D5/D7 | execution-insights top_insights | Merge/boundary candidate |
| 350->138 Medium consolidation | sizing_accuracy wave_3 | Finding inflation at source |

This synthesis informs all subsequent phases. Do not skip it.

---

## Phase 1: Constitution Restructuring (Sub-Agent: CONST-1)

### 1.1 Audit Current CONSTITUTION.md

Read: governance/CONSTITUTION.md

For each section, classify:
- **PILLAR-CORE**: Directly defines or operationalizes a pillar
- **PILLAR-SUPPORT**: Supports a pillar but could be consolidated
- **UNIQUE-VALUE**: Not covered by pillars but necessary
- **DUPLICATE**: Duplicated from VISION.md or AUDIT.md
- **BLOAT**: Restates the obvious, uses filler language, doesn't earn inclusion

Produce a section-by-section classification table:

| Section | Current Lines | Classification | Pillar(s) Served | Action |
|---------|---------------|----------------|-------------------|--------|

### 1.2 Audit Cross-File Duplication

Compare CONSTITUTION.md against VISION.md, AUDIT.md, AUDIT-EXECUTE.md,
and both trust files. For each duplication:

| Content | Source File | Duplicate In | Resolution |
|---------|------------|--------------|------------|

### 1.3 Propose New CONSTITUTION.md Structure

The restructured constitution must:
1. Open with a 3-line identity statement (reference VISION.md for full identity)
2. Present the 6 Binding Pillars as Section 2 with:
   - Each pillar: name, operational definition (2-3 sentences), measurement
     criteria, governance file references
   - A pillar-to-governance traceability matrix
3. Retain unique-value content (Key Design Decisions, Governance File
   Structure) in compressed form
4. Eliminate all DUPLICATE and BLOAT content
5. Add a "Pillar Compliance Test": for any proposed governance change,
   answer "which pillar(s) does this serve?" — if none, reject

Output: Full proposed CONSTITUTION.md outline with estimated line counts.
Target: under 200 lines (current: ~296).

### 1.4 Pillar-to-Governance Traceability Matrix

| Pillar | CONSTITUTION | VISION | AUDIT | AUDIT-EXECUTE | Domains | Trust Files |
|--------|-------------|--------|-------|---------------|---------|-------------|

Flag gaps: pillars with weak or missing coverage in specific files.

---

## Phase 2: Governance File Bloat Analysis (Sub-Agent: BLOAT-1)

### 2.1 File-Level Metrics

For each governance file:

| File | Lines | Sections | Est. Tokens | Duplication Index | Pillar Coverage |
|------|-------|----------|-------------|-------------------|-----------------|

Duplication Index: proportion of content semantically equivalent to content
in another governance file (0-1 scale).

### 2.2 Per-File Bloat Findings

For each file, identify:
- Sections duplicating content from another governance file (cite both)
- Sections where the same concept appears twice within the file
- Filler language replaceable with measurable criteria
- Meta-commentary (describes what a section does rather than doing it)
- Tables/lists compressible without information loss

| File | Location | Type | Content Summary | Proposed Action | Bytes Saved |
|------|----------|------|-----------------|-----------------|-------------|

### 2.3 Cross-File Redundancy Map

Content existing in 3+ files. For each:
- Which file is the single source of truth?
- Which files should reference it?
- Deduplication strategy (reference, inline summary, or remove)?

---

## Phase 3: Audit Domain Restructuring (Sub-Agent: DOMAIN-1)

### 3.1 Domain Health Assessment

Using execution-insights.json and baseline.json:

| Domain | Baseline | Post-Exec | Findings | False Pos | Sub-Agents | Scope Fit (1-5) | Overlap With |
|--------|----------|-----------|----------|-----------|------------|-----------------|-------------|

Scope Fit: 1 = misaligned with what hatch3r is, 5 = perfectly scoped.

### 3.2 Known Issues (Confirmed in Cycle 4)

1. **D12 (Observability) scored 60** — checklist measures runtime observability
   inappropriate for a CLI tool generating static configuration
2. **D16 (Compound System) re-reports D3/D5/D7** — produces duplicate findings
   instead of unique cross-domain insights
3. **Medium finding inflation** — 350 pre-dedup to 138 post-triage (2.5x ratio)

### 3.3 Domain Restructuring Proposals

For each proposed change:

| Proposal | Type | Domains | Rationale | Risk | Pillar |
|----------|------|---------|-----------|------|--------|

For each, also specify:
- Impact on tier weights (must preserve totals: A=0.308, B=0.348, C=0.266, D=0.078)
- Impact on total sub-agent count
- Domain files to create/modify/delete
- Migration path for finding-registry.json historical IDs

### 3.4 First-Principles Challenge

After the data-driven analysis, independently ask:
- Designing from scratch for a CLI framework with 15 adapters, 10 MCP
  servers, 137 content artifacts, and a weekly audit cycle — what domains
  would you create?
- Which current domains would not exist in a from-scratch design?
- Which capabilities are missing?
- Does the 4-tier structure still make sense, or should tiers align with
  the 6 pillars?

Use web research for governance audit best practices and quality framework
standards to inform this analysis.

Present as a separate analysis — the framework owner decides which
perspective to prioritize.

---

## Phase 4: AUDIT.md Alignment (Sub-Agent: AUDIT-1)

### 4.1 Pillar Coverage Audit

| AUDIT.md Section | Lines | Pillar(s) | Gap |
|------------------|-------|-----------|-----|

### 4.2 Identify Bloat in AUDIT.md

AUDIT.md is ~710 lines. Apply the same classification from Phase 1.
Specific areas:
- Framework Context section duplicating VISION.md and CONSTITUTION.md
- Component Inventory table duplicating what `hatch3r validate` verifies
- Scoring Methodology explanatory text vs actual formulas
- Pre-Audit Questions with "sensible defaults"

### 4.3 Propose AUDIT.md Changes

| Change | Section | Current State | Proposed State | Pillar | Rationale |
|--------|---------|---------------|----------------|--------|-----------|

### 4.4 Behavioral Charter Evaluation

The current 10 directives serve P2. Evaluate whether directives are needed for:
- P1: "Evaluate CLI-facing outputs as a user, not a developer"
- P3: "Verify adapter/MCP findings against live documentation"
- P4: "Before proposing new content, verify no existing artifact covers the need"
- P6: "Evaluate security implications of every finding, not just D15"

For each: does it add signal, or dilute the charter?

---

## Phase 5: AUDIT-EXECUTE.md Alignment (Sub-Agent: EXEC-1)

### 5.1 Pillar Coverage Audit
Same structure as Phase 4.1 for AUDIT-EXECUTE.md (~800 lines).

### 5.2 Identify Bloat
Specific areas:
- Regression gate check 8 (Governance) — duplicates reviewer's role?
- Finding Registry field table — every field still used?
- Phase 5/6/7 descriptions duplicating AUDIT.md's CL-1/2/3
- Pre-Execution Protocol overlapping Pre-Audit Questions

### 5.3 Propose Changes
Same format as Phase 4.3.

### 5.4 Lean Threshold Integration
Where lean thresholds should appear in execution flow:
- Triage: reject findings serving zero pillars
- Grouping: flag work units increasing total governance size
- Regression gate: add governance weight check (total bytes)
- Report: include governance size metrics

---

## Phase 6: Trust File Integration (Sub-Agent: TRUST-1)

### 6.1 Assessment
Read governance/trust-delegation-chain.md and trust-framework-compliance.md.
For each:
- Does it serve P6?
- Does it duplicate D15 content?
- Is it referenced by other governance files?
- Is it maintained through the audit cycle or orphaned?

### 6.2 Integration Options

Evaluate:
A. Keep separate, add cross-references from CONSTITUTION.md and AUDIT.md
B. Merge into single trust-governance.md
C. Absorb into D15 domain file

For each: pros, cons, pillar alignment, maintenance burden.

---

## Phase 7: Lean Thresholds Definition (Sub-Agent: LEAN-1)

### 7.1 Anti-Bloat Principles

1. **Single Source of Truth**: Every concept defined in exactly one file. Others reference it.
2. **Earn Your Existence**: Every file, section, row serves at least one pillar. If none, remove.
3. **Compression Over Verbosity**: Tables over prose. References over repetition. Measurable criteria over descriptions.
4. **Proportional Depth**: File size proportional to governed complexity.
5. **Anti-Slop**: No filler phrases. Replace with measurable criteria or remove.

### 7.2 Initial Measurable Limits

Starting values. Calibrated over cycles using execution-insights data.

| Metric | Limit | Measurement | Calibration Signal |
|--------|-------|-------------|-------------------|
| CONSTITUTION.md | <= 200 lines | wc -l | Justify per-section if exceeded |
| AUDIT.md | <= 600 lines | wc -l | Adjust proportionally to domain count |
| AUDIT-EXECUTE.md | <= 700 lines | wc -l | Adjust if execution model changes |
| Domain file size | 30-80 lines | wc -l per file | Sub-agent count x 15 as baseline |
| Cross-file duplication | < 5% | Semantic comparison | 0% ideal |
| Filler phrase count | 0 per file | Pattern match | Any occurrence = finding |
| Checklist items/sub-agent | 4-8 | Count per SA | <4 = shallow, >8 = too broad |
| Governance total | <= 3000 lines | Sum all .md in governance/ | Increasing = bloat signal |
| Finding inflation rate | < 2x pre-dedup to post-triage | sizing_accuracy | Cycle 4 was 2.3x for Medium |

### 7.3 Anti-Slop Wordlist

Phrases that must not appear without accompanying measurable criteria:
- "best possible" / "best-in-class" / "world-class"
- "comprehensive and thorough" / "exhaustive"
- "robust and resilient"
- "high-quality" (without quality measure)
- "ensure" (without verification method)
- "properly" / "correctly" (without acceptance criterion)
- "as needed" / "as appropriate" (without trigger condition)
- "scalable" (without scale dimension and limit)

---

## Phase 8: Consolidated Proposal Assembly (Sub-Agent: SYNTH-1)

### 8.1 Merge & Deduplicate
Collect all proposals from Phases 1-7. Deduplicate proposals addressing the
same issue from different angles.

### 8.2 Dependency Ordering
1. Constitution restructuring (Phase 1) — agreed first
2. Domain restructuring (Phase 3) — changes what AUDIT.md references
3. AUDIT.md alignment (Phase 4) — depends on domain structure
4. AUDIT-EXECUTE.md alignment (Phase 5) — depends on AUDIT.md
5. Trust file integration (Phase 6) — depends on constitution
6. Lean thresholds (Phase 7) — applies to all, finalized last
7. Bloat removal (Phase 2) — applied throughout, finalized last

### 8.3 Impact Assessment

| Category | Files Modified | Lines Added | Lines Removed | Net | Risk |
|----------|---------------|-------------|---------------|-----|------|

### 8.4 Final Output Format

The consolidated proposal document must follow this structure:

# hatch3r Governance Reaudit — Proposals

## Summary
- Total proposals: N
- Files affected: N
- Net line change: -N (X% reduction)
- Pillar coverage: before -> after matrix

## Proposal Registry

| # | Phase | Category | Summary | Files | Pillar(s) | Priority | Risk | Depends On |
|---|-------|----------|---------|-------|-----------|----------|------|-----------|

## Detailed Proposals
(One section per proposal with: category, pillars, files, current state,
proposed state, rationale with evidence, risk, migration path, effort S/M/L)

## Domain Restructuring Detail
(Full domain health table + first-principles alternative)

## Lean Thresholds
(Principles + limits + anti-slop wordlist)

## Execution Order
(Dependency-ordered with justification)

## Invariant Checks
- [ ] Tier weights sum to 1.00 after domain changes
- [ ] Sub-agent counts consistent
- [ ] All AUDIT.md domain references have corresponding files
- [ ] No governance file exceeds lean threshold
- [ ] Every governance file serves at least one pillar
- [ ] Cross-file duplication < 5%
- [ ] finding-registry.json migration path for any domain renumbering

## Rollback Plan
(Per-category revert instructions)

---

## Sub-Agent Structure

| Agent | Phase | Responsibility | Inputs |
|-------|-------|---------------|--------|
| CONST-1 | 1 | Constitution restructuring, pillar elevation, duplication map | CONSTITUTION.md, VISION.md, all governance files |
| BLOAT-1 | 2 | Cross-file bloat analysis, redundancy map | All governance files |
| DOMAIN-1 | 3 | Domain health assessment, restructuring proposals, first-principles challenge | execution-insights.json, finding-registry.json, baseline.json, D01-D19.md |
| AUDIT-1 | 4 | AUDIT.md pillar alignment, bloat removal, charter evaluation | AUDIT.md, Phase 1+3 outputs |
| EXEC-1 | 5 | AUDIT-EXECUTE.md alignment, lean threshold integration | AUDIT-EXECUTE.md, Phase 4+7 outputs |
| TRUST-1 | 6 | Trust file P6 assessment, integration recommendation | Both trust files, CONSTITUTION.md, D15 |
| LEAN-1 | 7 | Anti-bloat principles, measurable limits, anti-slop wordlist | All governance files, execution-insights.json |
| SYNTH-1 | 8 | Merge, deduplicate, order, impact assess, produce final document | All phase outputs |

### Execution Waves

```
Phase 0 (historical context load)
  |
  +-->  CONST-1 (Phase 1) --+
  +-->  BLOAT-1 (Phase 2) --+--> AUDIT-1 (Phase 4) --+
  +-->  DOMAIN-1 (Phase 3) -+                         +--> SYNTH-1 (Phase 8)
  +-->  TRUST-1 (Phase 6) ----------------------------+
  +-->  LEAN-1 (Phase 7) ---+--> EXEC-1 (Phase 5) ---+
                             +------------------------+
```

Wave 1 (parallel): CONST-1, BLOAT-1, DOMAIN-1, TRUST-1, LEAN-1
Wave 2 (depends on Wave 1): AUDIT-1
Wave 3 (depends on Wave 2 + LEAN-1): EXEC-1
Wave 4 (depends on all): SYNTH-1

---

## Constraints

1. **Plan mode only.** Every output is a proposal. No files modified.
2. **CL-1/CL-2/CL-3 pattern.** Identify -> classify -> propose -> present.
3. **Anti-slop in proposals.** Proposals follow the lean standards they advocate.
4. **Pillar justification.** Every proposal cites which pillar(s) it serves. Zero-pillar proposals are rejected.
5. **Historical grounding.** Reference execution-insights.json or finding-registry.json evidence where available. First-principles proposals clearly labeled.
6. **Invariant preservation.** No proposal may break: tier weight sum = 1.00, sub-agent count consistency, domain file references, CL pattern.
7. **Web research scope.** Use for governance best practices and quality frameworks. Do NOT perform live adapter/MCP docs research — verify the governance structure mandates it.
8. **Backward compatibility.** Include migration path for finding-registry.json if domains are merged/renumbered.
9. **Timeline.** All changes target Cycle 5 as a single restructuring.
