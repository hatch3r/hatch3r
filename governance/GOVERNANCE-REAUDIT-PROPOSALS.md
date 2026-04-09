# hatch3r Governance Reaudit — Proposals

> Cycle: 5 (restructuring)
> Date: 2026-04-09
> Baseline: Cycle 4 post-execution (score 85, 93.6% fix rate, 0 rollbacks)
> Mode: Proposals only. Framework owner reviews and approves before file modifications.

---

## Summary

- **Total proposals:** 20
- **Files affected:** 15 (7 modified, 2 deleted, 1 created, 5 domain files rewritten/deleted)
- **Net line change:** -646 (18% reduction)
- **Governance total:** 3,593 → 2,947 lines (under 3,000 target)
- **Domains:** 19 → 17 (-2)
- **Sub-agents:** 107 → 98 (-9)
- **Tier weight invariant:** Preserved (A=0.308, B=0.348, C=0.266, D=0.078, sum=1.000)

**Pillar coverage before → after:**

| Pillar | CONSTITUTION | VISION | AUDIT | AUDIT-EXECUTE | Domains | Trust |
|--------|:-----------:|:------:|:-----:|:------------:|:-------:|:-----:|
| P1 CLI UX | - → P | P | - → S | - → S | D10,D19→D10 | -- |
| P2 Quality | P → P | P | P | S | D1,D5,D7,D13,D16 | -- |
| P3 Currency | - → P | P | - → S | S | D2,D9 | S |
| P4 Lean | - → P | P | - → S | P → P | D5,D16 | -- |
| P5 Governance | P | S | P | P | D18,D16 | -- |
| P6 Security | - → P | -- | S | S | D15 | P → P |

Legend: P = primary, S = supporting, -- = no coverage (acceptable), - → X = gap closed by proposals.

---

## Proposal Registry

| # | Phase | Category | Summary | Files | Pillar(s) | Priority | Risk | Effort | Depends On |
|---|-------|----------|---------|-------|-----------|----------|------|--------|------------|
| P1 | 1 | Constitution | Restructure around 6 Binding Pillars; 295→175 lines | CONSTITUTION.md | P5 | Critical | Medium | M | P4, P18 |
| P2 | 1 | Constitution | Add pillar-to-governance traceability matrix | CONSTITUTION.md | P5 | Critical | Low | S | P1 |
| P3 | 1 | Constitution | Add Pillar Compliance Test gate | CONSTITUTION.md | P5 | High | Low | S | P1 |
| P4 | 2 | Bloat | Remove 8 duplicate sections from CONSTITUTION.md | CONSTITUTION.md | P4, P5 | Critical | Medium | S | -- |
| P5 | 2 | Bloat | Replace hardcoded counts with generic references | All governance | P4 | Medium | Low | S | P1, P7, P8 |
| P6 | 3 | Domain | Rescope D12: Observability → CLI Diagnostics | D12 | P1, P5 | Critical | Low | S | -- |
| P7 | 3 | Domain | Restructure D16: 5→2 SAs with dedup gate | D16 | P5, P4 | Critical | Medium | M | P8 |
| P8 | 3 | Domain | Merge D10+D19 → "D10: UX & Documentation" (11→8 SAs) | D10, D19 | P1, P4 | High | Medium | M | P11, P12 |
| P9 | 3 | Domain | Clarify D06/D15 boundary | D06, D15 | P2, P6 | Medium | Low | S | -- |
| P10 | 3 | Domain | Rescope D17/D18 human-blocking items | D17, D18 | P5 | Medium | Low | S | -- |
| P11 | 3 | Domain | Clarify D01/D08 error handling boundary | D01, D08 | P4 | Low | Low | S | -- |
| P12 | 3 | Domain | Clarify D02/D09/D11 adapter pipeline boundary | D02, D09, D11 | P4 | Low | Low | S | -- |
| P13 | 4 | AUDIT | Compress AUDIT.md: 710→544 lines | AUDIT.md | P4, P5 | Critical | Medium | L | P1, P7, P8 |
| P14 | 4 | Charter | Add 3 behavioral directives (P1, P3, P4) | AUDIT.md | P1, P3, P4 | High | Low | S | P13 |
| P15 | 5 | EXECUTE | Compress AUDIT-EXECUTE.md: 830→668 lines | AUDIT-EXECUTE.md | P4, P5 | Critical | Medium | L | P13 |
| P16 | 5 | Registry | Prune finding registry: 24→18 fields | AUDIT-EXECUTE.md | P4 | Medium | Low | S | P15 |
| P17 | 6 | Trust | Absorb trust files into D15; delete 2 files | D15, trust-*.md | P6, P5 | High | Low | M | P1 |
| P18 | 7 | Lean | Define 11 measurable lean thresholds | CONSTITUTION.md | P5 | Critical | Low | S | -- |
| P19 | 7 | Lean | Anti-slop wordlist with 3-layer enforcement | AUDIT-EXECUTE.md | P4, P5 | High | Low | S | P18 |
| P20 | 8 | Synthesis | Registry migration for domain renumbering | finding-registry.json | P5 | High | Low | S | P6-P8 |

---

## Detailed Proposals

### P1. Restructure CONSTITUTION.md Around 6 Binding Pillars

**Category:** Constitution | **Pillars:** P5 | **Files:** `governance/CONSTITUTION.md` | **Effort:** M

**Current state (295 lines):** 9 sections mixing design rationale with content duplicated from VISION.md and AUDIT.md. 41% duplication index — highest of any governance file. 8 of 9 sections contain verbatim or near-verbatim content from other files.

**Proposed state (175 lines):**

```
# hatch3r — Constitution                               [3 lines]
## 1. Identity                                          [5 lines]
   3-line statement. "For full identity, see VISION.md."

## 2. The 6 Binding Pillars                            [55 lines]
   P1: CLI UI/UX Excellence                             [8 lines]
     Definition, measurement (time-to-first-value, decision count,
     error recovery rate), governance refs (AUDIT D10, D19→D10)
   P2: Scientific & Practical Quality                   [8 lines]
     Definition, measurement (behavioral charter compliance,
     acceptance criteria), refs (AUDIT charter, D1/D5/D7)
   P3: Adapter & MCP Currency                           [8 lines]
     Definition, measurement (doc date delta, feature gap count),
     refs (AUDIT D9, web research mandate)
   P4: Comprehensive Lean Coverage                      [8 lines]
     Definition, measurement (lifecycle coverage %, content-to-
     purpose ratio, duplication index), refs (AUDIT D16, CL-2)
   P5: Governance Self-Quality                          [8 lines]
     Definition, measurement (duplication index, inflation trend,
     false positive rate), refs (CL-3, lean thresholds)
   P6: Security & Trust Governance                      [8 lines]
     Definition, measurement (trust control coverage %, time to
     resolution), refs (D15, trust reference in D15)
   Pillar Compliance Test                               [7 lines]
     Gate: "Which pillar(s) does this serve?" If none, reject.

## 3. Pillar-to-Governance Traceability Matrix         [25 lines]
   Pillar x [CONST, VISION, AUDIT, AUDIT-EXECUTE, Domains, Trust]
   Marks: P (primary), S (supporting), -- (n/a). Gap column.

## 4. Audit Quality Architecture (compressed)          [20 lines]
   3 layers named + rationale (5 lines).
   Summary table: layer, concept count, canonical location,
   verification method (15-line table).

## 5. Closed-Loop Rationale                            [15 lines]
   Two tables (CL-1/2/3 + Phases 5-7): name, purpose, why.
   No process detail — reference AUDIT.md / AUDIT-EXECUTE.md.

## 6. Key Design Decisions                             [25 lines]
   10 decisions compressed: decision + why, one sentence each.
   Table format.

## 7. Governance File Structure                        [15 lines]
   Updated directory tree incl. trust absorption into D15.
   One-sentence rationale for governance/ isolation.

## 8. Amendment Protocol                                [7 lines]
   How to change this document. RE-ENVISION for vision,
   CL-3 for audit, explicit owner approval for all others.
```

**Rationale:** CONSTITUTION.md's role is design rationale ("why"), not specification ("what"). VISION.md specifies the north star, AUDIT.md specifies the audit process. The current Constitution duplicates both. Restructuring eliminates duplication, elevates the 6 Binding Pillars to constitutional status, and adds the traceability matrix that ensures every governance artifact serves a pillar.

**Risk:** Medium. Removing content from the Constitution may reduce self-contained readability. Mitigation: each removed section gets a one-line cross-reference with exact target.

**Migration:** No external references to CONSTITUTION.md sections found in other governance files.

---

### P2. Add Pillar-to-Governance Traceability Matrix

**Category:** Constitution | **Pillars:** P5 | **Files:** `governance/CONSTITUTION.md` | **Effort:** S

**Proposed matrix:**

| Pillar | CONST | VISION | AUDIT | AUDIT-EXEC | Key Domains | Trust (D15) |
|--------|:-----:|:------:|:-----:|:----------:|:-----------:|:-----------:|
| P1 CLI UX | S | P | S | S | D10 | -- |
| P2 Quality | P | P | P | S | D1,D5,D7,D13 | -- |
| P3 Currency | S | P | P | S | D2,D9 | S |
| P4 Lean | S | P | P | P | D5,D16 | -- |
| P5 Governance | P | S | P | P | D16,D18 | -- |
| P6 Security | P | GAP | S | S | D15 | P |

**Gap:** P6 has no VISION.md coverage. Recommendation: add a 15th principle to VISION.md: "Security and trust are first-class concerns, not afterthoughts — the framework applies the same scrutiny to its own agentic architecture as it does to the code it helps produce." This is a RE-ENVISION.md workflow item, not a direct edit.

---

### P3. Add Pillar Compliance Test

**Category:** Constitution | **Pillars:** P5 | **Files:** `governance/CONSTITUTION.md` | **Effort:** S

**Proposed gate (7 lines):**

```markdown
### Pillar Compliance Test

For any proposed governance change, answer:
1. Which pillar(s) does this change serve?
2. What measurable improvement does it produce?
3. Does it increase or decrease governance total size?

If the answer to (1) is "none", the change is rejected.
If (3) is "increase", the change must justify net value exceeding the size cost.
```

---

### P4. Remove 8 Duplicate Sections from CONSTITUTION.md

**Category:** Bloat | **Pillars:** P4, P5 | **Files:** `governance/CONSTITUTION.md` | **Effort:** S

| Section | Lines | Duplicate Of | Resolution |
|---------|-------|-------------|------------|
| 1. Framework Identity | 8-17 | VISION.md 9-16 | Replace with 3-line reference |
| 2.1 North Star | 22-31 | VISION.md 39-48 | Remove; reference VISION.md |
| 2.2 Senior Engineer | 33-37 | VISION.md 43 | Remove |
| 2.3 Up-to-Date Info | 39-43 | VISION.md 51-57 | Remove |
| 3.1 Weekly Cadence | 48-61 | VISION.md 59-83 | Remove |
| 5.1 Audit Charter | 169-183 | AUDIT.md 340-362 (verbatim) | Remove; reference AUDIT.md |
| 5.2 Quality Charter | 184-195 | agents/shared/quality-charter.md | Remove; reference |
| 6. Content Maintenance | 198-209 | VISION.md 85-102 | Remove |
| 7. Platform Strategy | 212-221 | VISION.md 105-116 | Remove |

**Lines recovered:** ~120 from CONSTITUTION.md.

**Risk:** Medium. The "why" rationale unique to CONSTITUTION.md (especially in §2.1 and §2.2) is not present in VISION.md. Mitigation: before each removal, verify whether the VISION.md version includes the rationale. If not, compress the rationale into one sentence in the new Pillar definition (§2 of restructured Constitution). Specifically:
- North Star "why" ("cost of failure measured in revision cycles") → P2 definition
- Senior Engineer "why" ("most agentic output fails at UX boundary") → P1 definition
- Up-to-Date "why" ("training data stale by definition") → P3 definition

---

### P5. Replace Hardcoded Counts with Generic References

**Category:** Bloat | **Pillars:** P4 | **Files:** All governance files | **Effort:** S

**Current:** "19 domains", "107 sub-agents", "15 adapters" hardcoded in 5+ files. These numbers change via CL-3 (domains/SAs) and adapter additions. Hardcoding guarantees drift.

**Proposed:**
- "19 domains" / "107 sub-agents" → "all audit domains" / "all sub-agents" except in AUDIT.md Summary Table (canonical source)
- "15 adapters" → "all supported adapters" except in D09 domain file (canonical source)
- "137 artifacts" → "all content artifacts" except in AUDIT.md Component Inventory (post-compression: Dynamic Verification Protocol)

**Files to update:** CONSTITUTION.md (3 occurrences), VISION.md (4 occurrences), AUDIT.md (retain canonical counts), AUDIT-EXECUTE.md (2 occurrences).

---

### P6. Rescope D12: Observability → CLI Diagnostics

**Category:** Domain | **Pillars:** P1, P5 | **Files:** `governance/audit/domains/D12-observability.md` → rename to `D12-cli-diagnostics.md` | **Effort:** S

**Current state:** D12 "Agent Observability & Debuggability" (38 lines, 4 SAs). Baseline score 22, post-execution 60 (still lowest). 3 of 13 findings never attempted. SA 12.4 "OpenTelemetry AI Agent Alignment" measures runtime tracing standards (spans, semantic conventions, EU AI Act traceability) for a CLI tool that generates static configuration files.

**Evidence:**
- Baseline 22 (lowest alongside D7)
- Post-exec ~60 (still lowest of all domains)
- 3 never-attempted findings (#62, #66, #67) about runtime tracing
- SA 12.2 "Tool Call Audit Trails" assumes runtime agent infrastructure hatch3r does not have
- Behavioral charter directive 8 explicitly states: "hatch3r is a setup-time configuration generator, not a runtime agent executor"

**Proposed state:** "D12: CLI Diagnostics & Traceability" (4 SAs, ~40 lines)

```markdown
# Domain 12: CLI Diagnostics & Traceability

**Scope:** Can users understand what hatch3r did, diagnose problems, and
trace generated output back to its source?
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 12.1 | CLI Output Diagnostic Quality |
| 12.2 | Configuration Audit Trails |
| 12.3 | Agent Instruction Debugging |
| 12.4 | Content Traceability |

## Audit Checklists

### 12.1 CLI Output Diagnostic Quality
- [ ] Do error messages include file path, severity, and recovery steps?
- [ ] Can users distinguish errors from warnings from info in all commands?
- [ ] Is progress feedback informative without being noisy (init, sync, update)?
- [ ] Do validation/verify commands produce actionable output?

### 12.2 Configuration Audit Trails
- [ ] Does the integrity manifest capture what changed, when, and by which command?
- [ ] Can users diff between pre-sync and post-sync state?
- [ ] Is the provenance of each generated file traceable (which adapter, which template)?
- [ ] Does `hatch3r status` provide a complete health check?

### 12.3 Agent Instruction Debugging
- [ ] Can users understand what instructions agents receive per adapter?
- [ ] Are content resolution rules visible (which rules apply, in what order)?
- [ ] Can users preview generated output before writing (dry-run)?
- [ ] Are customization overrides visible in output?

### 12.4 Content Traceability
- [ ] Can users trace any generated file back to its canonical source?
- [ ] Are managed block boundaries clearly documented in output?
- [ ] Is the transformation pipeline visible (canonical → adapter → output)?
- [ ] Are content dependency chains surfaced (agent X requires skill Y)?
```

**Tier:** C (unchanged). **Weight:** 0.0443 (post-restructuring). **Sub-agents:** 4 (unchanged).

---

### P7. Restructure D16: Compound System → Cross-Domain Synthesis

**Category:** Domain | **Pillars:** P5, P4 | **Files:** `governance/audit/domains/D16-compound-system.md` | **Effort:** M

**Current state:** D16 "Compound System Evaluation" (55 lines, 5 sequential SAs). 20 findings in Cycle 4. 18 of 20 findings (90%) merged into home domains via `dedup:merge_into`. Only 2 genuinely unique findings (#396, #397) about closed-loop execution stalling.

**Evidence:**
- Finding-registry.json: D16 findings #386-#405, 18 with `dedup_action: "merge_into"` targeting D03, D05, D07, D08, D15
- execution-insights.json top_insights[4]: "D16 re-reports D3/D5/D7 findings"
- All 20 findings resolved (100%), but resolution was crediting home domains, not D16

**Root cause:** D16's 5 SAs (one-shot success, content coverage gaps, prompt consistency, regression quality, closed-loop effectiveness) re-audit scope already covered by home domains:
- SA 16.1 (one-shot) → already in D07 (orchestration) scope
- SA 16.2 (content gaps) → already in CL-2 identification phase
- SA 16.3 (consistency) → already in D05 (prompt engineering) scope
- SA 16.4 (regression) → already in D03 (test infrastructure) scope

**Proposed state:** "D16: Cross-Domain Synthesis" (2 SAs, ~30 lines)

```markdown
# Domain 16: Cross-Domain Synthesis

**Scope:** Cross-domain insights that no single domain can produce.
Explicitly NOT re-auditing scope covered by home domains.
**Sub-agents:** 2

ALL sub-agents are **sequential** — run only after all Tier A and B
domains complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 16.1 | Cross-Domain Contradiction Detection | All Tier A+B |
| 16.2 | Closed-Loop Effectiveness | D18 (previous cycle) |

## Deduplication Gate

Before creating any finding, verify:
1. Does an equivalent finding exist in a home domain from this cycle?
2. Does the root cause match an existing finding?
If yes to either: log as "cross-domain confirmation of D{N} #{ID}"
without creating a new finding.

## Audit Checklists

### 16.1 Cross-Domain Contradiction Detection
- [ ] Identify findings spanning 3+ domains with shared root cause
- [ ] Flag domains that contradict each other
- [ ] Cross-command consistency check: review loops, quality gates,
      sub-agent prompts, confidence expression (formerly SA 16.3)
- [ ] Cross-artifact contradiction detection across all content types

### 16.2 Closed-Loop Effectiveness
- [ ] PRD evolution tracking — were Cycle 4 CL-1 candidates incorporated?
- [ ] Content gap closure rate — were CL-2 artifacts created?
- [ ] Audit evolution adoption rate — were CL-3 proposals reflected?
- [ ] Feedback loop latency — cycles from finding to resolution
- [ ] Learning system integration — are findings captured as learnings?
```

**Scope redistribution:**
- SA 16.1 (one-shot success analysis) → Add as checklist item in D07 SA 7.1 (Pipeline Design)
- SA 16.2 (content coverage gaps) → Already covered by CL-2; no relocation needed
- SA 16.3 (prompt consistency) → Merge cross-command checks into D05 as new SA 5.8 or add to D05 SA 5.5
- SA 16.4 (regression quality) → Add as checklist item in D03 SA 3.5 (Coverage Meta-Analysis)

**Impact:** 5→2 SAs (-3). Tier C, weight unchanged. Explicit dedup gate prevents the 90% duplication observed in Cycle 4.

---

### P8. Merge D10+D19 → "D10: User Experience & Documentation"

**Category:** Domain | **Pillars:** P1, P4 | **Files:** `governance/audit/domains/D10-documentation-devex.md` (rewrite), delete `D19-user-journey.md` | **Effort:** M

**Current state:**
- D10 "Documentation & Developer Experience" (59 lines, 6 SAs, Tier B, weight 0.058)
- D19 "User Journey & Adoption Friction" (83 lines, 5 SAs, Tier C, weight 0.038)
- Combined: 142 lines, 11 SAs

**Evidence of overlap:**
- D10 SA 10.3 (first-run experience) directly overlaps D19 SA 19.1 (post-init to first value)
- D10 SA 10.6 (learning curve) overlaps D19 SA 19.5 (workflow chain viability)
- D10 SA 10.2 (CLI UX) overlaps D19 SA 19.1 (post-init messaging)
- D16 finding #405 explicitly flagged: "documentation drift compounds D10/D19 UX"
- Both domains scored similarly: D10 baseline 40, D19 baseline 43

**Proposed merged domain:** "D10: User Experience & Documentation" (8 SAs, ~80 lines, Tier B)

| SA | Focus | Origin |
|----|-------|--------|
| 10.1 | Documentation Accuracy | D10 SA 10.1 |
| 10.2 | CLI UX & Output Quality | D10 SA 10.2 + D10 SA 10.5 |
| 10.3 | First-Run to First-Value Journey | D10 SA 10.3 + D19 SA 19.1 |
| 10.4 | Customization & Configuration Clarity | D19 SA 19.2 |
| 10.5 | Multi-Tool Coexistence | D19 SA 19.3 |
| 10.6 | Content Profile & Selection Impact | D19 SA 19.4 |
| 10.7 | Workflow Chain Viability | D19 SA 19.5 |
| 10.8 | Learning Curve & Adoption Metrics | D10 SA 10.4 + D10 SA 10.6 |

**Tier assignment:** Tier B. Rationale: user experience is a quality-tier concern, not system-level. Running in Tier B produces findings earlier for cross-domain analysis.

**Weight impact:** Tier B goes from 6 domains (0.058 each) to 5 domains (0.0696 each). Tier C goes from 7 to 6 domains (0.0443 each). Tier totals preserved exactly: B=0.348, C=0.266.

---

### P9. Clarify D06/D15 Boundary

**Category:** Domain | **Pillars:** P2, P6 | **Files:** `D06-context-engineering.md`, `D15-agentic-security.md` | **Effort:** S

**Issue:** D06 SA 6.4 "Memory Safety & Context Poisoning" overlaps D15 SA 15.1 "Prompt Injection & Instruction Integrity" and ASI06 in SA 15.3.

**Proposed boundary rule (add to both domain files):**

> D06 audits context engineering quality under normal operation (overflow handling, session isolation, format validation). D15 audits context security under adversarial conditions (poisoning attacks, injection via learnings, weaponization of user-controlled files). If a finding involves intentional malicious input, it belongs in D15.

**D06 SA 6.4 rename:** "Memory Safety & Context Poisoning" → "Context Integrity & Isolation"

---

### P10. Rescope D17/D18 Human-Blocking Items

**Category:** Domain | **Pillars:** P5 | **Files:** `D17-competition.md`, `D18-prd-roadmap.md` | **Effort:** S

**Issue:** D17 has 4 never-attempted findings (25%), D18 has 2 (20%). All are human-blocking: open-source (#13), npm publish (#14), branding (#89), strategic investment (#106), open-source roadmap (#8), npm execute (#95). These depress domain scores and inflate finding counts.

**Proposed change:** Add to both domain files:

```markdown
### Strategic Decision Register

Items classified as human-decision (open-source, branding, investment,
distribution) are tracked here, not as findings. They:
- Do not generate findings or affect domain score
- Are listed in the Executive Dashboard under "Stalled Strategic Decisions"
  if unresolved for 3+ cycles
- Require `Owner: Human` tag in finding registry if they do generate findings

Agent-verifiable items (competitor comparison, documentation currency,
community metrics) remain as standard checklist items.
```

**Finding registry impact:** Existing human-only findings (#8, #13, #14, #89, #95, #106) receive `disposition: "strategic_register"`.

---

### P11. Clarify D01/D08 Error Handling Boundary

**Category:** Domain | **Pillars:** P4 | **Files:** `D01-core-source.md`, `D08-error-recovery.md` | **Effort:** S

**Add to both files:**

> D01 audits per-command error correctness: "Does this specific command handle this specific error correctly?" D08 audits cross-framework error patterns and resilience: "Does the framework have consistent error handling patterns across all commands, and are recovery mechanisms (retry, circuit breaker, rollback) implemented?" A D01 finding about a specific command's missing error case is not a D08 finding unless it reveals a systemic pattern gap.

---

### P12. Clarify D02/D09/D11 Adapter Pipeline Boundary

**Category:** Domain | **Pillars:** P4 | **Files:** `D02-adapter-infrastructure.md`, `D09-platform-adapters.md`, `D11-data-flow.md` | **Effort:** S

**Add to all three files:**

> D02 audits contracts and abstractions (base.ts, canonical.ts, content system): "Are the abstractions correct?" D09 audits per-adapter implementations: "Does each adapter correctly implement the contract?" D11 audits end-to-end integration: "When content flows through the full pipeline, does it arrive correctly?" D11 findings must demonstrate cross-component failures that neither D02 nor D09 would catch independently.

---

### P13. Compress AUDIT.md: 710 → 544 Lines

**Category:** AUDIT | **Pillars:** P4, P5 | **Files:** `governance/AUDIT.md` | **Effort:** L

| # | Section | Lines | Savings | Change |
|---|---------|-------|---------|--------|
| A1 | Framework Context identity (13-17) | 5→1 | 4 | Reference VISION.md |
| A2 | Architecture tree (18-42) | 24→10 | 14 | Flat two-column table |
| A3 | Component Inventory (44-68) | 24→3 | 21 | Replace with Dynamic Verification reference |
| A4 | Dynamic Verification (69-76) | 7→5 | 2 | Remove redundant step 3 |
| A5 | Orchestration Model (78-80) | 3→0 | 3 | Remove (not actionable for sub-agents) |
| A6 | Pre-Audit Q3-Q6 (176-181) | 6→0 | 6 | Remove (defaults always apply per Cycle 4 data) |
| A7 | Calibration Check prose (226-232) | 7→3 | 4 | Compress to rule |
| A8 | Severity + Effort tables (234-252) | 18→12 | 6 | Merge into single table |
| A9 | Output Format templates (443-571) | 128→85 | 43 | Extract to templates/report-format.md |
| A10 | CL-1 process (584-612) | 28→12 | 16 | Keep schema, remove process duplication |
| A11 | CL-2 process (614-649) | 35→12 | 23 | Same treatment |
| A12 | CL-3 process (651-703) | 52→20 | 32 | Keep categories, remove template duplication |
| A13 | Charter expansion | 0→+8 | -8 | Add 3 new directives (see P14) |

**Detail for A3 (Component Inventory → Dynamic Verification reference):**

Current: 24-line static table listing counts for agents (16), rules (44), commands (34), etc. This table drifts — AUDIT.md says 16 adapters in the summary table but D09 domain file has 17 sub-agents covering 15 adapters + 2 synthesis agents. The Dynamic Verification Protocol (lines 69-76) already mandates filesystem scanning before Tier A launches.

Proposed replacement (3 lines):
```markdown
Sub-agents MUST run the Dynamic Verification Protocol below to establish
actual counts. Static inventory is maintained in the verified-inventory.json
output. Reference governance/CONSTITUTION.md Section 7 for file structure.
```

**Detail for A9 (Output Format extraction):**

Move the Executive Dashboard template (lines 451-475), Domain Heatmap template (lines 483-505), and Enhanced Action Items format (lines 535-548) to `governance/audit/templates/report-format.md`. Keep in AUDIT.md: section names, progressive disclosure principle, and reference line per template. This is the single largest compression (43 lines).

**Detail for A10-A12 (CL phase compression):**

CL-1/CL-2/CL-3 identification phases currently contain step-by-step process descriptions that duplicate content in:
- `governance/audit/templates/closed-loop-agents.md` (the operational template)
- AUDIT-EXECUTE.md Phases 5-7 (the execution-side counterpart)

Compress each to: trigger condition, input list, output table schema, 3 constraints. The step-by-step remains in the template file.

**Net:** -166 lines. Projected: 544 lines (under 600 target).

---

### P14. Add 3 Behavioral Charter Directives

**Category:** Charter | **Pillars:** P1, P3, P4 | **Files:** `governance/AUDIT.md` (lines 340-362) | **Effort:** S

Current charter: 10 directives, all serving P2 (Scientific & Practical Quality). Pillar coverage gaps: P1 (zero), P3 (zero), P4 (zero).

**Add:**

**11. User-facing perspective** — For any finding affecting CLI output, error messages, or user-visible behavior, evaluate from the perspective of a first-time user running `npx hatch3r init`, not from the developer maintaining the code. *Serves P1.*

**12. Currency verification** — For any finding involving adapters or MCP servers, verify against the platform's latest official documentation. Cite the documentation version and date. A finding based on stale documentation is itself a finding. *Serves P3.*

**13. Duplication awareness** — Before flagging a missing content artifact (agent, skill, rule, command), search existing artifacts for overlapping coverage. A proposal for content that already exists is a false positive, not a finding. *Serves P4.*

**P6 candidate (skip):** "Evaluate security implications of every finding, not just D15." Skipped because: (a) most sub-agents operate on content without security attack surfaces, (b) D15 already has 6 dedicated SAs, (c) existing directive 10 (Holistic awareness) covers cross-cutting concerns, (d) adding this risks "security theater" — low-value observations inflating findings.

---

### P15. Compress AUDIT-EXECUTE.md: 830 → 668 Lines

**Category:** EXECUTE | **Pillars:** P4, P5 | **Files:** `governance/AUDIT-EXECUTE.md` | **Effort:** L

| # | Section | Lines | Savings | Change |
|---|---------|-------|---------|--------|
| E1 | Pre-Execution Q's (32-43) | 12→6 | 6 | Remove boilerplate Q1 (report path), Q5 (model), Q9 |
| E2 | Pre-Analysis template (57-75) | 18→10 | 8 | Remove code-fenced template |
| E3 | Phase 0 baseline template (98-111) | 13→5 | 8 | Reference baseline.json as schema |
| E4 | Finding Registry fields (199-224) | 25→17 | 8 | Remove 5 unused fields (see P16) |
| E5 | Wave parameters (302-309) | 8→5 | 3 | Remove aspirational concurrency limits |
| E6 | Regression gate template (356-370) | 14→5 | 9 | Compress to rule form |
| E7 | Phase 5 PRD (461-512) | 51→22 | 29 | Keep execution-unique logic only |
| E8 | Phase 6 Content (515-581) | 66→25 | 41 | Remove spec template (in closed-loop-agents.md) |
| E9 | Phase 7 Audit (584-645) | 61→25 | 36 | Remove proposal template (in closed-loop-agents.md) |
| E10 | Guardrails (800-822) | 22→14 | 8 | Remove redundant G4, G6, G14, G20 |
| E11 | Report Update template (677-709) | 32→18 | 14 | Compress template body |
| E12 | Lean threshold integration | 0→+8 | -8 | Add 4 checkpoints (see below) |

**Lean threshold integration points (E12):**

1. **Triage (Phase 1):** Add filter: "Reject findings serving zero pillars. Each finding must cite at least one pillar in its description."
2. **Grouping (Phase 2):** Add flag: "Flag work units that increase total governance line count. These require explicit justification."
3. **Regression gate (new check 9):** "Governance weight: `wc -l` on modified governance files. FAIL if any file exceeds lean threshold."
4. **Telemetry:** Add metric: "governance_total_lines" tracked per wave.

**Detail for E7-E9 (CL phase compression):**

Phases 5-7 in AUDIT-EXECUTE.md contain near-verbatim copies of AUDIT.md CL-1/CL-2/CL-3 plus operational templates already in `closed-loop-agents.md`. The pattern becomes:
- AUDIT.md: defines identification phase (compressed per P13)
- `closed-loop-agents.md`: provides operational templates
- AUDIT-EXECUTE.md: specifies only execution-unique logic (filtering, approval flow, commit strategy)

Phase 5 keeps: trigger condition, prerequisite, filtering by failed/rolled-back candidates, user approval flow, separate commit strategy.
Phase 6 keeps: trigger, priority filtering (P1/P2/P3), output location, spec conventions.
Phase 7 keeps: trigger, per-proposal consent requirement, invariant checks, guardrail 3 suspension note.

**Detail for E10 (Guardrail pruning):**

| Guardrail | Why Remove |
|-----------|-----------|
| G4: "Do not mark human-only as done" | Registry invariant — already enforced by disposition field |
| G6: "Be honest about execution status" | Redundant with registry terminal status requirement |
| G14: "No silent drops" | Same constraint as G13 |
| G20: "Closed-loop phases optional" | Already stated in Phase 5/6/7 trigger conditions |

**Net:** -162 lines. Projected: 668 lines (under 700 target).

---

### P16. Prune Finding Registry: 24 → 18 Fields

**Category:** Registry | **Pillars:** P4 | **Files:** `governance/AUDIT-EXECUTE.md`, `governance/audit/finding-registry.json` | **Effort:** S

| Field | Population | Action | Rationale |
|-------|-----------|--------|-----------|
| `execution_duration` | 0/260 (0%) | REMOVE | Never populated; telemetry tracks aggregate timing |
| `mixed_decomposition` | 0/260 (0%) | REMOVE | Zero mixed items across 4 cycles; owner is always Agent or Human |
| `prd_impact` | 0/260 (0%) | REMOVE | PRD updates tracked at phase level in telemetry |
| `content_generated` | 0/260 (0%) | REMOVE | Content specs tracked at phase level |
| `audit_evolution` | 0/260 (0%) | REMOVE | Evolution proposals tracked at phase level |
| `reviewer_verdict` | 0/260 (0%) | RESTRUCTURE | Move to wave-level in telemetry; reviewer issues per-wave verdict, not per-finding |
| `reviewer_notes` | 15/260 (5.8%) | KEEP | Partially populated; captures meaningful observations |
| `dedup_tier` | 18/260 (6.9%) | KEEP | Expected low population; serves design purpose |
| `rollback_reason` | 0/260 (0%) | KEEP | Zero rollbacks is success; field needed for failure case |
| `rollback_level` | 0/260 (0%) | KEEP | Same rationale |

**Migration:** Existing entries retain removed fields as `null` (backward compatible). New Cycle 5 entries omit them. AUDIT-EXECUTE.md field table (lines 199-224) reduced from 24 to 18 rows.

---

### P17. Absorb Trust Files into D15

**Category:** Trust | **Pillars:** P6, P5 | **Files:** `D15-agentic-security.md`, delete `trust-delegation-chain.md` + `trust-framework-compliance.md` | **Effort:** M

**Current state:** Two trust files (148 + 141 = 289 lines) created from D15 findings #84 and #85. Both are orphaned: not referenced by CONSTITUTION.md, VISION.md, AUDIT.md, or any domain file. The audit cycle cannot maintain content it does not know exists.

**Proposed state:** D15 restructured into two sections:

```
# Domain 15: Agentic Security & Trust Model          [~197 lines]

## Part A: Audit Checklists                            [~67 lines]
   (existing D15 content, unchanged)

## Part B: Trust Reference                             [~130 lines]

### Trust Delegation Chain (compressed from 148 lines)
   Chain diagram (retain, 15 lines)
   Trust levels table (compress 5 sections → 1 table, 12 lines)
   Trust boundaries table (compress 3 sections → 1 table, 8 lines)
   Invariants (retain, 6 lines)
   Failure modes (retain table, 8 lines)

### Trust Framework Compliance (compressed from 141 lines)
   Trust dimensions table (retain, 8 lines)
   Control-to-trust mapping (compress 10 verbose sections →
     1 consolidated table with columns: Control, Trust Dimension,
     Implementation File, Validation Method, Finding ID, 20 lines)
   Compliance verification (retain, 6 lines)
   Audit schedule (retain, 6 lines)
```

**Compression:** 289 → 130 lines (55% reduction). Achieved by converting verbose per-control property tables to a single consolidated table, and converting per-level trust descriptions to a single summary table.

**D15 total:** ~197 lines. Exceeds 80-line lean threshold. Justified: D15 is the most complex domain (6+2 SAs post-reallocation, OWASP ASI coverage, trust reference material). Lean threshold note: "adjust proportionally to sub-agent count" — 8 SAs × 15 = 120 baseline, plus 77 lines of trust reference.

**Add to D15 SA 15.6 checklist:** "Verify trust reference section (Part B) against current implementation in `src/pipeline/`."

**Cross-references:**
- CONSTITUTION.md P6 pillar definition: "Trust delegation chain and compliance mapping: see D15 Part B."
- AUDIT.md: no change needed (D15 already referenced).

---

### P18. Define 11 Measurable Lean Thresholds

**Category:** Lean | **Pillars:** P5 | **Files:** `governance/CONSTITUTION.md` (new subsection in §2 under P5) | **Effort:** S

| # | Metric | Limit | Current | Calibration Signal |
|---|--------|-------|---------|-------------------|
| L1 | CONSTITUTION.md lines | <=200 | 295 | Stable unless new pillars |
| L2 | AUDIT.md lines | <=600 | 710 | ±4 lines per domain delta |
| L3 | AUDIT-EXECUTE.md lines | <=700 | 830 | ±50 lines per execution phase delta |
| L4 | Domain file lines | 30-80 | 37-106 | SA count × 15 baseline |
| L5 | Template file lines | <=200 | 107-186 | Adjust per reviewer passes |
| L6 | Cross-file duplication | <5% | ~12-15% | 0% ideal; manual audit per cycle |
| L7 | Finding inflation ratio | <2.0x | 2.5x Med | Source-level dedup improvement |
| L8 | Governance total lines | <=3000 | 3593 | Increasing = bloat signal |
| L9 | Registry active fields | <=20 | 18 | Drop <5% population after 3 cycles |
| L10 | Anti-slop phrases | 0/file | TBD | Pattern match per cycle |
| L11 | Checklist items/SA | 4-8 | Varies | <4 = shallow, >8 = too broad |

**Anti-bloat principles (codified in Constitution §2, P5 definition):**

1. **Single Source of Truth:** Every concept defined in exactly one file. Others reference it.
2. **Earn Your Existence:** Every file, section, row serves at least one pillar. If none, remove.
3. **Compression Over Verbosity:** Tables over prose. References over repetition.
4. **Proportional Depth:** File size proportional to governed complexity.
5. **Anti-Slop:** No filler phrases without measurable criteria.

---

### P19. Anti-Slop Wordlist with 3-Layer Enforcement

**Category:** Lean | **Pillars:** P4, P5 | **Files:** `governance/AUDIT-EXECUTE.md` (regression gate), `governance/AUDIT.md` (CL-3) | **Effort:** S

**Wordlist (12 categories):**

| Category | Phrases | Required Replacement |
|----------|---------|---------------------|
| Vague quality | "best possible", "best-in-class", "world-class" | Specify metric and threshold |
| Vague thoroughness | "comprehensive and thorough", "exhaustive" | Specify coverage scope |
| Vague robustness | "robust and resilient" | Specify failure modes handled |
| Unqualified quality | "high-quality" (without measure) | Attach acceptance test |
| Unverifiable assurance | "ensure" (without verification method) | "Verify by [method]" |
| Unspecified correctness | "properly", "correctly" (without criterion) | Specific acceptance criterion |
| Unbounded discretion | "as needed", "as appropriate" (without trigger) | "When [specific condition]" |
| Unspecified scale | "scalable" (without dimension) | "Scales to [N] [units]" |
| Vague effort | "carefully", "thoroughly" | Remove — checklist defines thoroughness |
| Vague importance | "critical", "crucial" (outside severity taxonomy) | Use severity taxonomy or remove |
| Filler bridge | "it is important to note that" | State the fact directly |
| Meta-commentary | "this section describes" | Let section title convey purpose |

**Enforcement layers:**

1. **Authoring-time (new regression gate check 10):** `grep -c` against wordlist on modified `.md` files in `governance/`. FAIL if count > 0.
2. **Audit-time (CL-3):** Meta-analysis agent scans all governance files. Occurrences → Info findings.
3. **Trend-tracking (telemetry):** Anti-slop count per file tracked in execution-insights.json. Increasing trend across cycles triggers CL-3 proposal.

**Exceptions:** Quoted external standards, the wordlist itself, content artifacts (governed by Quality Charter, not anti-slop wordlist).

---

### P20. Registry Migration for Domain Renumbering

**Category:** Synthesis | **Pillars:** P5 | **Files:** `governance/audit/finding-registry.json`, `governance/audit/baseline.json` | **Effort:** S

**Rule 1: No finding ID renumbering.** IDs #1-#447 are immutable.

**Rule 2: Domain string migration.**

| Domain Change | Affected Findings | Migration |
|--------------|-------------------|-----------|
| D19 → D10 (merge) | #96-#99, #415-#431, #447 (22 findings) | Set `domain = "D10: User Experience & Documentation"`, add `migrated_from = "D19: User Journey & Adoption"`, `migration_cycle = 5` |
| D12 rename | #62-#67, #315-#320, #443 (13 findings) | Set `domain = "D12: CLI Diagnostics & Traceability"`, add `migrated_from = "D12: Agent Observability"`, `migration_cycle = 5` |
| D16 rename | #386-#405 (20 findings) | Set `domain = "D16: Cross-Domain Synthesis"`, add `migrated_from = "D16: Compound System"`, `migration_cycle = 5` |

**Rule 3: New schema fields.** Add `migrated_from` (string) and `migration_cycle` (number) to AUDIT-EXECUTE.md field table.

**Rule 4: AUDIT.md Summary Table update.** 17 rows (remove D19, update D10/D12/D16 names and SA counts). Total: 98 SAs (89 parallel, 9 sequential).

**Rule 5: baseline.json update.** Remove D19 key. D10 score represents merged domain baseline. D12/D16 keys retain shorthand (D12, D16).

---

## Domain Restructuring Detail

### Full Domain Health Table

| Domain | Tier | Baseline | Post-Exec | Findings | Partial | Never | SAs | Scope Fit | Action |
|--------|------|----------|-----------|----------|---------|-------|-----|-----------|--------|
| D01: Core Source | A | 61 | ~99 | 15 | 1 | 0 | 10 | 5/5 | Boundary clarification (P11) |
| D02: Adapter Infra | A | 44 | ~99 | 10 | 1 | 0 | 7 | 5/5 | Boundary clarification (P12) |
| D03: Test Infra | A | 50 | ~99 | 15 | 1 | 0 | 5 | 5/5 | Absorb D16 SA 16.4 scope |
| D04: Build/CI/CD | A | 50 | ~99 | 10 | 1 | 0 | 5 | 4/5 | No change |
| D05: Prompt Eng. | B | 46 | ~99 | 16 | 1 | 0 | 7 | 5/5 | Absorb D16 SA 16.3 scope |
| D06: Context Eng. | B | 50 | ~99 | 12 | 1 | 0 | 4 | 3/5 | Boundary clarification (P9) |
| D07: Orchestration | B | 22 | ~89 | 13 | 1 | 1 | 5 | 5/5 | Absorb D16 SA 16.1 scope |
| D08: Error Recovery | B | 30 | ~99 | 10 | 1 | 0 | 4 | 5/5 | Boundary clarification (P11) |
| D09: Platform Adapt. | B | 50 | ~99 | 21 | 1 | 0 | 17 | 5/5 | +1 SA (reallocation), boundary (P12) |
| D10: Docs/DevEx | B | 40 | ~99 | 7 | 1 | 0 | 6→8 | 4/5 | **Merge with D19 (P8)** |
| D11: Data Flow | C | 35 | ~99 | 7 | 1 | 0 | 4 | 4/5 | Boundary clarification (P12) |
| D12: Observability | C | 22 | ~60 | 13 | 1 | 3 | 4 | 3/5 | **Rescope to CLI diagnostics (P6)** |
| D13: Human-AI | C | 54 | ~99 | 8 | 1 | 0 | 4 | 4/5 | No change |
| D14: Adaptability | C | 38 | ~99 | 9 | 1 | 0 | 4 | 3/5 | No change |
| D15: Agentic Security | C | 50 | ~89 | 26 | 1 | 1 | 6→8 | 5/5 | **Absorb trust files (P17)**, +2 SAs |
| D16: Compound | C | 50 | ~100 | 20 | 0 | 0 | 5→2 | 2/5 | **Restructure to synthesis (P7)** |
| D17: Competition | D | 50 | ~30 | 16 | 0 | 4 | 3 | 3/5 | Strategic register (P10) |
| D18: PRD/Roadmap | D | 50 | ~50 | 10 | 0 | 2 | 3 | 3/5 | Strategic register (P10) |
| D19: User Journey | C | 43 | ~99 | 22 | 1 | 0 | 5→0 | 4/5 | **Merge into D10 (P8), DELETE** |

### Post-Restructuring Summary

| Tier | Domains | Per-Domain Weight | Tier Total | SAs |
|------|---------|-------------------|------------|-----|
| A | D01, D02, D03, D04 (4) | 0.077 | 0.308 | 27 |
| B | D05, D06, D07, D08, D09, D10 (5→5) | 0.0696 | 0.348 | 46 |
| C | D11, D12, D13, D14, D15, D16 (7→6) | 0.0443 | 0.266 | 23 |
| D | D17, D18 (2) | 0.039 | 0.078 | 6 |
| **Total** | **17** | | **1.000** | **98** |

Note: D10 moves from old Tier B (6 domains @ 0.058) to new Tier B (5 domains @ 0.0696), gaining weight. D09 (17→18 SAs) stays Tier B. D15 (6→8 SAs) stays Tier C. 6 SAs held as unallocated adaptive buffer per AUDIT.md "Adaptive Resource Allocation."

### First-Principles Challenge

If designing from scratch for a CLI framework with 15 adapters, 10 MCP servers, 137 content artifacts, and weekly audit cycle:

**Domains that would NOT exist in current form:**
- D12 (Observability): Runtime tracing for a static config generator is a category error. CLI output quality is a UX concern.
- D16 (Compound System) as standalone: Cross-domain synthesis is an orchestrator responsibility. Evidence: 90% duplication.
- D13 (Human-AI Collaboration) and D14 (Adaptability) as standalone: Both are 4-SA domains with scope fit 3-4/5. D13's concerns (confidence, trust calibration) belong in D05. D14's concerns (tech stack generalization) belong in D01/D02/D09.

**Pillar-aligned alternative (13 domains, 95 SAs):**

| Pillar | Domain | SAs | Replaces |
|--------|--------|-----|----------|
| P1 | CLI Source & Commands | 10 | D01 |
| P1 | User Experience & Documentation | 8 | D10+D19 |
| P2 | Content Artifact Quality | 7 | D05 |
| P2 | Agent Pipeline & Orchestration | 7 | D07+D08 |
| P2 | Context Engineering | 3 | D06 |
| P3 | Adapter Infrastructure | 7 | D02 |
| P3 | Platform Adapter Implementations | 17 | D09 |
| P3 | End-to-End Data Flow | 4 | D11 |
| P4 | Test Infrastructure | 5 | D03 |
| P4 | Build, CI/CD & Dependencies | 5 | D04 |
| P5 | Governance Self-Quality | 2 | D16 rescoped |
| P6 | Agentic Security & Trust | 6 | D15 |
| P6 | Supply Chain & Distribution | 4 | D04 security + D17/D18 market |

**Should tiers align with pillars?** No. Tiers determine execution order (dependency graph). Pillars determine existence justification (governance concern). These are orthogonal. D15 (P6) depends on D01/D02 (P1/P3) findings to assess code-level security — if tiers matched pillars, this dependency would be violated. The correct integration: every domain file declares which pillar(s) it serves; the traceability matrix verifies coverage.

**Recommendation:** The current proposals (P6-P12) address the most severe structural problems (D12 misalignment, D16 duplication, D10/D19 overlap) while preserving continuity. The first-principles design is presented for the framework owner to consider for a future major restructuring. It should not be attempted in Cycle 5 alongside the other proposals.

---

## Lean Thresholds

### Anti-Bloat Principles

1. **Single Source of Truth:** Every concept defined in exactly one file. Others reference it.
2. **Earn Your Existence:** Every file, section, row serves at least one pillar. If none, remove.
3. **Compression Over Verbosity:** Tables over prose. References over repetition.
4. **Proportional Depth:** File size proportional to governed complexity.
5. **Anti-Slop:** No filler phrases without measurable criteria.

### Limits Table

| # | Metric | Limit | Current | Post-Reaudit | Measurement | Calibration |
|---|--------|-------|---------|--------------|-------------|-------------|
| L1 | CONSTITUTION.md | <=200 | 295 | 175 | `wc -l` | Stable unless new pillars |
| L2 | AUDIT.md | <=600 | 710 | 544 | `wc -l` | ±4 per domain delta |
| L3 | AUDIT-EXECUTE.md | <=700 | 830 | 668 | `wc -l` | ±50 per exec phase delta |
| L4 | Domain file | 30-80 | 37-106 | 30-80 (D15: 197 exception) | `wc -l` per file | SA × 15 baseline |
| L5 | Template file | <=200 | 107-186 | <=200 | `wc -l` per file | ±20 per reviewer pass |
| L6 | Cross-file duplication | <5% | ~12-15% | <5% | Semantic audit per cycle | 0% ideal |
| L7 | Finding inflation | <2.0x | 2.5x Medium | <2.0x | pre-dedup / post-triage | Source dedup improvement |
| L8 | Governance total | <=3000 | 3593 | 2947 | `wc -l` sum governance/ | Increasing = bloat signal |
| L9 | Registry fields | <=20 | 24 | 18 | Count active fields | Drop <5% after 3 cycles |
| L10 | Anti-slop | 0/file | TBD | 0 | grep against wordlist | Any occurrence = finding |
| L11 | Checklist items/SA | 4-8 | Varies | 4-8 | Count per SA | <4 shallow, >8 too broad |

### Anti-Slop Wordlist

See P19 for full wordlist and enforcement strategy.

---

## Execution Order

```
Wave 0: Historical context load — COMPLETED
  Inputs: execution-insights.json, finding-registry.json, baseline.json
  Output: Pattern synthesis (8 patterns documented)

Wave 1 (parallel, no dependencies):
  P6:  Rescope D12 (self-contained domain file rewrite)
  P9:  Clarify D06/D15 boundary (add boundary note to both files)
  P10: Rescope D17/D18 (add strategic register to both files)
  P11: Clarify D01/D08 boundary (add boundary note to both files)
  P12: Clarify D02/D09/D11 boundary (add boundary note to 3 files)
  P18: Define lean thresholds (CONSTITUTION.md subsection)
  Effort: 6S = ~6 hours

Wave 2 (depends on Wave 1 for boundary context and thresholds):
  P4:  Remove 8 duplicate sections from CONSTITUTION.md
  P1:  Restructure CONSTITUTION.md (apply P4 removals + new structure)
  P2:  Add traceability matrix
  P3:  Add pillar compliance test
  P8:  Merge D10+D19 (depends on P11, P12 boundaries being settled)
  P7:  Restructure D16 (depends on P8 for scope redistribution)
  P17: Absorb trust files into D15 (depends on P1 for P6 pillar ref)
  Effort: 1L + 3M + 3S = ~16 hours

Wave 3 (depends on Wave 2 for domain structure and constitution):
  P13: Compress AUDIT.md (depends on P1 constitution, P7/P8 domain changes)
  P14: Add 3 charter directives (part of P13 AUDIT.md changes)
  P5:  Replace hardcoded counts (depends on P1, P7, P8 finalization)
  P19: Anti-slop enforcement (add to AUDIT-EXECUTE.md regression gate)
  Effort: 1L + 2S = ~8 hours

Wave 4 (depends on Wave 3 for AUDIT.md changes):
  P15: Compress AUDIT-EXECUTE.md (depends on P13 AUDIT.md structure)
  P16: Prune finding registry fields (part of P15 changes)
  Effort: 1L = ~4 hours

Wave 5 (depends on all):
  P20: Registry migration (depends on P6, P7, P8 domain renaming)
  Invariant verification (all checks)
  Effort: 2S = ~2 hours
```

**Total estimated effort:** ~36 hours across 5 waves.

---

## Invariant Checks

After all proposals are applied:

- [ ] Tier weights: A=0.308 (4×0.077), B=0.348 (5×0.0696), C=0.266 (6×0.0443), D=0.078 (2×0.039), Total=1.000
- [ ] Sub-agent total: 98 (sum across 17 domain files matches AUDIT.md summary table)
- [ ] Domain file count: 17 files in `governance/audit/domains/` (D19 deleted)
- [ ] AUDIT.md Summary Table: 17 rows with correct SA counts, no D19 row
- [ ] AUDIT.md Dependency Graph: D16 dependencies updated, D19 references removed
- [ ] AUDIT.md Behavioral Charter: 13 directives (10 original + 3 new)
- [ ] Scoring methodology: Formulas and weights unchanged
- [ ] CL pattern: Identification/action separation preserved in AUDIT.md and AUDIT-EXECUTE.md
- [ ] Templates: `closed-loop-agents.md`, `implementation-sub-agent.md`, `reviewer-sub-agent.md` compatible with updated AUDIT-EXECUTE.md
- [ ] finding-registry.json: All domain strings match post-migration domain files
- [ ] baseline.json: Domain keys match active domains (no D19)
- [ ] Lean thresholds: No governance file exceeds its limit (except D15 at 197, documented exception)
- [ ] Pillar coverage: Every governance file serves at least one pillar (verified via traceability matrix)
- [ ] Cross-file duplication: <5% (verified via semantic comparison)
- [ ] Anti-slop: 0 matches in any governance file (verified via wordlist grep)
- [ ] Trust file references: Zero references to deleted `trust-delegation-chain.md` or `trust-framework-compliance.md`

---

## Rollback Plan

### Per-Category Revert Instructions

**Constitution (P1-P4):**
Revert: `git checkout HEAD -- governance/CONSTITUTION.md`
Risk: None. Constitution is read by humans, not consumed by the audit system.
Note: If P2 traceability matrix is reverted, P6/P7/P8 domain changes still stand independently.

**Domain restructuring (P6-P12):**
Revert per-domain: `git checkout HEAD -- governance/audit/domains/D{N}-*.md`
For P8 (D10/D19 merge): restore `D19-user-journey.md` from git, revert `D10-documentation-devex.md`.
For P17 (trust absorption): restore both trust files from git, revert `D15-agentic-security.md`.
Cascade: If any domain change is reverted, also revert P20 (registry migration) for that domain and update AUDIT.md Summary Table.

**AUDIT.md compression (P13-P14):**
Revert: `git checkout HEAD -- governance/AUDIT.md`
Cascade: If P13 is reverted, P15 (AUDIT-EXECUTE.md) should also be reverted since it references the compressed CL structure. Delete `governance/audit/templates/report-format.md` (created by A9).

**AUDIT-EXECUTE.md compression (P15-P16):**
Revert: `git checkout HEAD -- governance/AUDIT-EXECUTE.md`
For P16 (registry pruning): No data loss — removed fields are null. Future entries can re-add them.

**Lean thresholds (P18-P19):**
Revert: Remove lean threshold subsection from CONSTITUTION.md. Remove regression gate checks 9 and 10 from AUDIT-EXECUTE.md.
Note: Anti-slop wordlist removal does not affect any existing content.

**Registry migration (P20):**
Revert: Restore `finding-registry.json` and `baseline.json` from git. Domain strings return to pre-migration values.
Note: This is the final wave specifically to enable clean rollback of earlier waves.

### Full Rollback

If the entire restructuring must be reverted:
```
git checkout HEAD -- governance/
git checkout HEAD -- governance/audit/domains/
```
This restores all governance files to their Cycle 4 post-execution state.
No code changes are involved (this is a governance-only restructuring).
