# hatch3r — Re-Envision Prompt

> Last updated: 2026-05-18
> Role: Holistic governance sparring engine. Scans every governance layer in parallel via 10 sub-agents, synthesizes drift, runs an interactive 20-theme sparring dialog, and routes proposals via hybrid edit authority (direct-edit / CL-3 / CONSTITUTION §8 amendment). Modifies governance files only under explicit per-file consent for permitted layers; never auto-applies audit-system or pillar/matrix/protocol changes.

## Purpose

Re-think the governance corpus end-to-end through a structured sparring dialog with the framework owner. RE-ENVISION surfaces drift across vision, pillars, lean thresholds, audit/execution mechanics, charters, anti-slop, closed-loop phases, and routing seams; assembles a refinement plan; and routes each proposal to direct-edit (permitted layers, per-file consent), CL-3 / Phase 7 (audit-system), or CONSTITUTION §8 amendment (pillars, traceability matrix, amendment protocol, Key Design Decisions). Runs occasionally — minimum 14-day cadence floor — as the "is governance still sound?" check.

**Boundaries.** EVOLVE.md remains the automated proposal-only drift detector (9 dimensions, ≥7-day gating). RE-ENVISION is the interactive sparring engine and is the only governance prompt with hybrid direct-edit authority for the layers enumerated in §5. AUDIT.md and AUDIT-EXECUTE.md remain the framework-output audit mechanism — never modified by RE-ENVISION outside the CL-3 / Phase 7 handoff.

---

## §0 — Preflight

### §0.1 P8 ambiguity gate

Before any file scan, apply `agents/shared/user-question-protocol.md`: detect ambiguity in the user's invocation against the five triggers (ambiguous scope, multiple valid interpretations, irreversible action, conflicting constraints, missing acceptance criteria). On any hit, raise one question with 2–4 numbered options plus a default-if-no-response line, using the platform-native question tool. One question per turn. Hard-stop until resolved.

### §0.2 Authorization & cadence floor

Authorization: framework owner only. Cadence floor: 14 days since the last RE-ENVISION run. Override on a Critical security incident or a BLOCK verdict from the most recent `/h4tcher-audit-cycle` run — the override lifts the interval, not the authorization. Record the trigger in §8.3 metadata.

### §0.3 Mode selection — ASK 1 (hard-stop)

Ask the framework owner:

> **Question:** Which scope for this run?
>
> 1. `full-rethink` — all 10 layers · 20 themes · 14-day-floor cadence
> 2. `occasional-check` — VISION + CONSTITUTION + AUDIT-EXECUTE only · T1–T14 · faster
> 3. `targeted-layer:<layer>` — one layer SA · themes that consume it · quickest
>
> Default if no response: 2

Hard-stop. Wait for explicit response.

### §0.4 EVOLVE-REPORT.md ingestion

If `governance/EVOLVE-REPORT.md` exists at the project root:

- Read it once, in full.
- Extract every proposal tagged Route A (per EVOLVE.md §6).
- Pre-seed `.re-envision-workspace/evolve-route-a-inbox.md` with one entry per Route A proposal, each carrying `source: evolve-route-a` and the proposal's target file, current state, proposed change, and rationale.
- §3 dedup logic treats these as known findings (file + recommendation match collapses to one entry).
- The Route A inbox is read-only input. Guardrail 12 forbids writes back to `governance/EVOLVE-REPORT.md`.

If absent, log "No EVOLVE-REPORT.md found — proceeding without Route A pre-seed." and continue.

### §0.5 Model-Independence Contract — by reference

The Model-Independence Contract from `governance/EVOLVE.md` §0 applies unmodified to this prompt and to every sub-agent it spawns. Forbidden patterns (tier / size / generation / vendor / model-ID / context-window / token-budget) are banned in this prompt's authoring, in sub-agent outputs, and in any artifact written under `.re-envision-workspace/`. The §0 forbidden-pattern extension-by-analogy clause applies — every by-analogy decision is recorded in §8.3 metadata. Do not restate the contract here; treat the EVOLVE.md §0 definition as authoritative.

---

## §1 — Pre-Dialog Inventory

### §1.1 Enumerate in-scope files

Scope depends on the §0.3 mode. Read and record each file:

| Mode | Files |
|------|-------|
| `full-rethink` | `governance/VISION.md` · `governance/CONSTITUTION.md` · `governance/AUDIT.md` · `governance/AUDIT-EXECUTE.md` · `governance/EVOLVE.md` · `governance/RE-ENVISION.md` (self) · every `governance/audit/domains/D*.md` · every `governance/audit/templates/*.md` · `agents/shared/quality-charter.md` · `agents/shared/user-question-protocol.md` · `CLAUDE.md` |
| `occasional-check` | VISION · CONSTITUTION · AUDIT.md · AUDIT-EXECUTE.md · RE-ENVISION (self) · `agents/shared/quality-charter.md` |
| `targeted-layer:<layer>` | Files mapped to the chosen SA (see §2.1 SA table); always include VISION + CONSTITUTION for context |

**Explicitly out of scope:** `governance/hatch3r-prd.md` (gitignored, operational), `governance/COMPETITIVE-ANALYSIS.md` (gitignored, market context), state files (`audit/finding-registry.json`, `audit/baseline.json`, `audit/execution-insights.json`), the canonical content corpus (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/` — owned by AUDIT.md domains D1, D5, D9, D19).

### §1.2 Record inventory

For each in-scope file capture: line count (`wc -l`), `> Last updated:` header date (or absent), pillar references in the first 30 lines, and file role (prompt / template / charter / reference). Write to `.re-envision-workspace/inventory.json`.

### §1.3 Load authoritative references — by reference

Read these from their canonical source; never restate:

- 8 Binding Pillars (P1–P8): `governance/CONSTITUTION.md` §2
- Lean thresholds table: `governance/CONSTITUTION.md` §2 P5
- Pillar Compliance Test (4 questions including end-user runtime efficiency): `governance/CONSTITUTION.md` §2
- Pillar-to-Governance Traceability Matrix: `governance/CONSTITUTION.md` §3
- Anti-slop wordlist: `governance/AUDIT-EXECUTE.md` regression gate check 11 + `CLAUDE.md` §Anti-Slop (parity-checked)
- Severity taxonomy: `governance/AUDIT.md` §Scoring Methodology · §Severity Taxonomy
- Rigor contract: `governance/audit/templates/rigor-contract.md`
- Amendment Protocol: `governance/CONSTITUTION.md` §8

### §1.4 Cross-reference EVOLVE-REPORT

If §0.4 produced an inbox, cross-walk inbox entries against the §1.2 inventory: confirm each target file is in scope; note any out-of-scope target as `source: evolve-route-a; status: out-of-scope` and surface it in §3 for the framework owner's awareness.

### §1.5 ASK 2 — scope confirmation (hard-stop)

Present the inventory table and any EVOLVE Route A inbox alongside the out-of-scope rationale. Ask:

> **Question:** Proceed with the inventory above?
>
> 1. Proceed with all listed files.
> 2. Exclude specific files — list which.
> 3. Switch mode (return to §0.3).
>
> Default if no response: 1

Hard-stop. Wait for explicit response.

---

## §2 — Parallel Drift-Detection Fan-Out

### §2.0 Sub-agent count + rationale (P8 first-class output)

```
sub_agents_spawned:
  count: 10
  rationale: Ten distinct governance authority boundaries with non-overlapping rigor profiles — VISION, CONSTITUTION pillars, lean thresholds + anti-bloat, traceability + amendment + decisions, AUDIT, AUDIT-EXECUTE, templates, domains, charters, anti-slop + EVOLVE/RE-ENVISION boundary. Consolidating creates layer-blind synthesis; expanding creates overlap.
```

Mode `occasional-check` reduces to SAs L1, L2, L3, L6, L9 (count 5, rationale: cover VISION + CONSTITUTION + AUDIT-EXECUTE pillars × charters; defer audit-system depth). Mode `targeted-layer:<layer>` reduces to one SA (count 1, rationale: maintainer requested a single-layer probe).

### §2.1 Launch all in-scope SAs in parallel

| SA | Layer | Files read | Checklist focus |
|----|-------|------------|-----------------|
| L1 | VISION | `governance/VISION.md` | Tagline, identity, audience, quality bar, lifecycle coverage, principle staleness, P6/P7/P8 traceability gaps |
| L2 | CONSTITUTION — Pillars | CONSTITUTION §2 P1–P8 | Definitions, measurement metrics, primary-owner attribution, pillar overlap, P7↔P8 tension resolution |
| L3 | CONSTITUTION — Lean Thresholds + Anti-Bloat + Silent Failure | CONSTITUTION §2 P5 (table) + §Anti-Bloat Principles + §Silent Failure Contract | Row coverage per governance file, calibration math consistency, anti-bloat principle enforceability, silent-failure contract scope |
| L4 | CONSTITUTION — Traceability + Amendment + Decisions | CONSTITUTION §3 + §6 + §8 | Matrix cell-by-cell coverage, primary-owner consistency, Key Design Decisions currency, Amendment Protocol scope clarity |
| L5 | AUDIT | `governance/AUDIT.md` + every `governance/audit/domains/D*.md` | 21 domains × 121 SAs consistency, tier weights total 1.000, behavioral charter directive count, CL-1/2/3 phase scope |
| L6 | AUDIT-EXECUTE | `governance/AUDIT-EXECUTE.md` | 4 waves, 18 regression gates, finding registry schema, tier classification (Tier 1/2/3), SHIP gate criteria, Phases 5/6/7 |
| L7 | TEMPLATES | every `governance/audit/templates/*.md` | Rigor contract referenced from every prompt, severity-mapping consistency, SA template alignment with current AUDIT/AUDIT-EXECUTE |
| L8 | DOMAINS | every `governance/audit/domains/D*.md` + `governance/audit/domains/D15-trust-reference.md` | Per-file pillars block, 4–8 checklist items per SA, line count within 30–80 or SA×15, `> Last updated:` header presence |
| L9 | CHARTERS | AUDIT.md §Sub-Agent Behavioral Charter + `agents/shared/quality-charter.md` | 17 directives present + referenced from CONSTITUTION P2, directive 17 operationalised in D05/D07/D13, content-charter parity |
| L10 | ANTI-SLOP + EVOLVE/RE-ENVISION boundary | AUDIT-EXECUTE gate 11 wordlist + `CLAUDE.md` §Anti-Slop + EVOLVE.md §Out-of-Scope + this file §0 | Wordlist parity between `CLAUDE.md` and `AUDIT-EXECUTE.md`, EVOLVE↔RE-ENVISION boundary clarity, §0.5 by-reference inheritance integrity |

**Common checklist per SA:** lean threshold compliance per L3 thresholds · anti-slop wordlist compliance per L10 wordlist · cross-file dedup <5% · pillar coverage per L4 matrix · currency (`> Last updated:` ≤180 days) · Rigor Contract conformance per `governance/audit/templates/rigor-contract.md` · P8 B1 gate presence on artifacts that mutate · sub-agent count emission on delegating artifacts.

### §2.2 Per-SA output contract

Each SA writes `.re-envision-workspace/L{N}-{layer}.findings.md` with the YAML rigor-schema header per `governance/audit/templates/rigor-contract.md` §Required Finding Output Schema. One finding per block. Optional `Inconclusive Areas` section for examined territory where the SA could not determine whether an issue exists. Chat reply to orchestrator: one line — `"L{N}: {finding_count} findings → .re-envision-workspace/L{N}-{layer}.findings.md"`. No prose, diffs, or file contents in chat.

### §2.3 Synthesis gate

Orchestrator reads all `.re-envision-workspace/L{N}-*.findings.md` files, produces `.re-envision-workspace/synthesis.md` as a per-layer + cross-layer index (finding ID · severity · file · one-line description · layer source), then releases per-SA findings from context. The orchestrator NEVER edits during fan-out — read-only until §6.

---

## §3 — Synthesis & Triage

### §3.1 Severity-tagged findings table

From `.re-envision-workspace/synthesis.md`, emit a single triage table to `.re-envision-workspace/triage.md`:

```
| ID | Severity | Layer | File | One-line | Edit route (provisional) |
```

Severity vocabulary mirrors `governance/AUDIT.md` §Severity Taxonomy (Critical / High / Medium / Low / Info).

### §3.2 Dedup vs registry and EVOLVE inbox

For each finding, run the AUDIT.md 2-of-3 signal match (file + root cause + recommendation) against:

- Open entries in `governance/audit/finding-registry.json` (read-only; status ∈ {`pending`, `partial`, `targeted`}).
- Entries in `.re-envision-workspace/evolve-route-a-inbox.md`.

A 2-of-3 match collapses the RE-ENVISION finding into the existing entry — record `dedup_target: <finding_id>` and skip downstream routing for the duplicate. Surface the collapsed entry in §3.4 confirmation.

### §3.3 Rigor contract enforcement

Every finding admitted to §4 dialog input MUST carry the 7 fields from `governance/audit/templates/rigor-contract.md` §Required Finding Output Schema (confidence, confidence_basis, falsifiability, causal_chain ≥3 steps, bias_check, counter_argument, sources). Any finding missing a field is rejected — write `dropped_for_rigor: <field_name>` and exclude. Re-research is the SA's job, not the orchestrator's.

### §3.4 ASK 3 — pre-dialog confirmation (hard-stop)

Present the triage table, dedup collapses, and rigor rejections. Ask:

> **Question:** Proceed to the 20-theme dialog with the findings shown above?
>
> 1. Proceed — use the full triage set.
> 2. Drop specific findings — list IDs.
> 3. Re-run a specific SA — list layer ID.
>
> Default if no response: 1

Hard-stop. Wait for explicit response.

---

## §4 — Sparring Dialog

Present 20 themes ONE AT A TIME. Each block follows the template:

```
### T{N}. {Theme name}
**Layer:** L{N} | **Edit route:** {direct-edit / CL-3 / §8 amendment}
**Current state:** <2–3 lines from §1.2 inventory + §3 synthesis>
**Drift findings:** <1–3 lines citing finding IDs from §3.1>

**Question:** <one-sentence theme question>
1. <Option A> — <one-line trade-off>
2. <Option B> — <one-line trade-off>
3. <Option C> — <one-line trade-off>
Default if no response: <option number>
```

Wait for response before the next theme. Do not batch.

### T1. Identity & Purpose | L1 | direct-edit VISION
Current state: VISION §Identity (tagline, one-paragraph definition). Drift: L1 finding IDs from §3. **Question:** Does the current identity statement still match the framework's mission?

### T2. Target Audience | L1 | direct-edit VISION
Current state: VISION §Target Audience (personas, project maturity scope). Drift: L1 finding IDs. **Question:** Are the listed personas still the primary audience, or has scope shifted?

### T3. Quality Bar | L1 | direct-edit VISION
Current state: VISION §Quality Bar (one-shot success rate, measurable acceptance). Drift: L1 finding IDs. **Question:** Is the current quality metric still the right north-star measure?

### T4. Up-to-Date Information | L1 | direct-edit VISION
Current state: VISION §Currency (web research mandate, per-agent vs universal). Drift: L1 finding IDs. **Question:** Is the freshness model per-agent, universal, or hybrid?

### T5. Closed Loop & Audit Cadence | L1 + L5 + L6 | direct-edit VISION (cadence) / CL-3 (audit mechanics)
Current state: VISION §Cadence + AUDIT.md cycle, CL-1/2/3 phases. Drift: L1/L5/L6 IDs. **Question:** Is the cadence and CL phase structure still calibrated to the framework's current change rate?

### T6. Content Maintenance Model | L1 | direct-edit VISION
Current state: VISION §Content Maintenance (audit-cycle-driven, artifact types). Drift: L1 IDs. **Question:** Is content fixing exclusively through audit cycles still the right policy?

### T7. Platform Strategy | L1 | direct-edit VISION
Current state: VISION §Supported Platforms (15 adapters, parity policy). Drift: L1 IDs. **Question:** Is parity policy uniform, tiered, or per-platform?

### T8. CLI Scope | L1 | direct-edit VISION
Current state: VISION §CLI Scope (generator vs runtime boundary, 13 commands). Drift: L1 IDs. **Question:** Where does the CLI end and the AI tool begin — still a generator-only boundary?

### T9. Learning System Vision | L1 | direct-edit VISION
Current state: VISION §Learning (project-level vs framework-level, automatic vs manual). Drift: L1 IDs. **Question:** Is the learning system still framework-only or has project-level scope emerged?

### T10. Principles | L1 | direct-edit VISION
Current state: VISION §Principles (8–15 stable principles). Drift: L1 IDs. **Question:** Are the principles still stable, or are operational details creeping in?

### T11. Pillar Validity & Coverage | L2 + L4 | §8 amendment
Current state: CONSTITUTION §2 P1–P8 + §3 traceability matrix. Drift: L2/L4 IDs. **Question:** Is each pillar still distinct, well-measured, and traceable to ≥1 governance file?

### T12. Lean Threshold Calibration | L3 | direct-edit CONSTITUTION (per-row consent)
Current state: CONSTITUTION §2 P5 thresholds table (line caps per file, calibration deltas). Drift: L3 IDs (this file's row recalibrated to ≤550 / ±25 per theme-block). **Question:** Which rows require recalibration given current artifact size and roadmap?

### T13. Anti-Bloat + Silent Failure Contract | L3 | direct-edit CONSTITUTION (per-principle consent)
Current state: §2 P5 Anti-Bloat Principles (6 principles) + Silent Failure Contract. Drift: L3 IDs. **Question:** Are the 6 anti-bloat principles still enforceable, and does the Silent Failure Contract still match `src/` reality?

### T14. Traceability Matrix Health | L4 | §8 amendment
Current state: CONSTITUTION §3 8×9 matrix. Drift: L4 IDs (known gaps P6↔VISION, P7↔VISION). **Question:** Should each known gap be filled, accepted, or restructured?

### T15. Audit Domain Coverage | L5 + L8 | CL-3
Current state: 21 domains, 121 SAs across 4 tiers (A=27 / B=52 / C=36 / D=6). Drift: L5/L8 IDs. **Question:** Are 21 domains still the right partition — add, merge, or split?

### T16. Execution Model Currency | L6 | CL-3
Current state: AUDIT-EXECUTE 4 waves, 18 regression gates, Tier 1/2/3 classification, SHIP gate. Drift: L6 IDs. **Question:** Does the wave + gate + tier structure still match audit-cycle reality?

### T17. Charter Completeness | L9 | direct-edit (add/refine) / CL-3 (remove)
Current state: AUDIT.md §Sub-Agent Behavioral Charter 17 directives + `agents/shared/quality-charter.md`. Drift: L9 IDs. **Question:** Should any directive be added, refined, or removed — and is parity with the content charter intact?

### T18. Anti-Slop Coverage + Wordlist Parity | L10 | direct-edit with consent (atomic pair)
Current state: AUDIT-EXECUTE gate 11 wordlist + `CLAUDE.md` §Anti-Slop. Drift: L10 IDs (parity-check verdict). **Question:** Add or remove which wordlist entries — both files updated atomically?

### T19. Closed-Loop Effectiveness CL-1/2/3 | L5 + L6 | CL-3
Current state: CL-1 PRD evolution · CL-2 content gaps · CL-3 audit self-evolution (per-proposal consent). Drift: L5/L6 IDs. **Question:** Are CL-1/2/3 producing actionable output, or has any phase degraded into ritual?

### T20. Routing Boundary Clarity (EVOLVE / RE-ENVISION / AUDIT) | L10 | direct-edit RE-ENVISION mechanics (this file)
Current state: EVOLVE = automated drift detection; RE-ENVISION = interactive sparring + hybrid edit authority; AUDIT = framework-output evaluation. Drift: L10 IDs. **Question:** Are the three boundaries clear, or is overlap surfacing in proposals?

### §4.99 Cross-layer concerns sweep
After T20, ask:

> **Question:** Any cross-layer concerns the 20 themes did not surface?
> 1. None — proceed to §5.
> 2. Yes — describe (free text); orchestrator records as a §5 candidate.
> Default if no response: 1

Capture free-text responses into `.re-envision-workspace/synthesis.md` under `cross_layer_concerns:` for §5 routing.

---

## §5 — Refinement Plan Assembly

### §5.1 Per-finding routing — edit authority matrix

Every proposal accepted in §4 is routed via this matrix. Direct-edit = applied in §6.1 under per-file consent. CL-3 = handed off to AUDIT-EXECUTE Phase 7 via `.re-envision-workspace/cl-3-handoff.md`. §8 = queued in `.re-envision-workspace/constitution-amendment-queue.md` with pre-populated dated rationale for framework-owner application.

| Layer / File / Section | Edit route | Consent gate |
|------------------------|------------|--------------|
| `governance/VISION.md` (entire file) | Direct-edit | §6.1 per-file ASK |
| CONSTITUTION §2 P1–P8 (pillars) | §8 amendment queue | §5.3 batch + §8 dated rationale |
| CONSTITUTION §2 P5 (lean thresholds row) | Direct-edit + §8 dated rationale | §6.1 per-file |
| CONSTITUTION §2 Anti-Bloat + Silent Failure | Direct-edit | §6.1 per-file |
| CONSTITUTION §3 / §6 / §8 (matrix, decisions, protocol) | §8 amendment queue | §5.3 batch + §8 |
| `governance/AUDIT.md` (domains, scoring, CL phases) | CL-3 / Phase 7 | §5.3 batch + Phase 7 per-proposal |
| AUDIT.md §Sub-Agent Behavioral Charter (add/refine) | Direct-edit | §6.1 per-file |
| AUDIT.md §Sub-Agent Behavioral Charter (remove) | CL-3 / Phase 7 | §5.3 + Phase 7 |
| `governance/AUDIT-EXECUTE.md` (waves, gates, registry, Phases 5–7) | CL-3 / Phase 7 | §5.3 + Phase 7 |
| AUDIT-EXECUTE gate 11 anti-slop wordlist | Direct-edit (atomic with `CLAUDE.md`) | §6.1 paired per-file |
| `governance/audit/domains/D*.md` (per-domain) | CL-3 / Phase 7 | §5.3 + Phase 7 |
| `governance/audit/templates/*.md` | CL-3 / Phase 7 | §5.3 + Phase 7 |
| `governance/EVOLVE.md` (prompt mechanics) | Direct-edit | §6.1 per-file |
| `CLAUDE.md` §Anti-Slop wordlist | Direct-edit (atomic with AUDIT-EXECUTE gate 11) | §6.1 paired per-file |
| `CLAUDE.md` other sections | Direct-edit | §6.1 per-file |
| `agents/shared/quality-charter.md` | Direct-edit | §6.1 per-file |
| `agents/shared/user-question-protocol.md` | Direct-edit | §6.1 per-file |
| `.claude/rules/*.md` | CL-3 / Phase 7 | §5.3 + Phase 7 |
| `.claude/skills/h4tcher-*/SKILL.md` | CL-3 / Phase 7 | §5.3 + Phase 7 |
| `governance/inventory.json` | Read-only (regen via `npm run inventory`) | §7.4 user-invoked |
| `governance/hatch3r-prd.md` | CL-3 / Phase 5 | §5.3 + Phase 5 |
| `audit/finding-registry.json` · `audit/baseline.json` · `audit/execution-insights.json` | Read-only from RE-ENVISION | — |

**Ambiguity resolutions, binding:** (a) Charter directive additions and refinements route direct-edit; removals route CL-3 (high-risk). (b) Anti-slop wordlist edits are paired atomic — both `AUDIT-EXECUTE.md` gate 11 and `CLAUDE.md` §Anti-Slop or neither. (c) CONSTITUTION §6 Key Design Decisions edits route §8 only (constitutional).

### §5.2 Pillar Compliance Test per proposal

Each proposal answers all four `governance/CONSTITUTION.md` §2 Pillar Compliance Test questions:

1. Which pillar(s) does this proposal serve?
2. What measurable improvement does it produce?
3. Does it increase governance total size? If yes, justify net value > size cost.
4. Does it degrade end-user runtime efficiency? If yes, reject or document the offsetting gain.

If (1) is "none" → reject before §5.3. If (3) is "increase" without justification → compress elsewhere or reject. If (4) is "yes" without offset → reject.

### §5.3 ASK 4 — batch approval per route bucket (hard-stop, three ASKs)

Present each route bucket as a separate ASK; do not batch across routes. Each ASK is a hard-stop.

> **Question (direct-edit batch):** Approve the following direct-edit proposals (listed with target file, current → proposed, pillar served)?
> 1. Approve all listed.
> 2. Approve subset — list IDs.
> 3. Reject all.
> Default if no response: 3

> **Question (CL-3 batch):** Approve handoff of the following audit-system proposals to `.re-envision-workspace/cl-3-handoff.md` for Phase 7 consumption?
> 1. Approve all listed.
> 2. Approve subset — list IDs.
> 3. Reject all.
> Default if no response: 3

> **Question (§8 amendment batch):** Approve queueing of the following constitutional proposals in `.re-envision-workspace/constitution-amendment-queue.md` (per-proposal dated rationale pre-populated)?
> 1. Approve all listed.
> 2. Approve subset — list IDs.
> 3. Reject all.
> Default if no response: 3

Wait for explicit responses on all three.

---

## §6 — Action Execution

### §6.1 Direct-edit pass (hard-stop ASK 5.N per file)

For each approved direct-edit proposal, in registry order:

1. **Per-file ASK (hard-stop, numbered 5.1, 5.2, … per proposal):**
   > **Question:** Apply edit `<proposal_id>` to `<target_file>` (current → proposed shown above)?
   > 1. Apply.
   > 2. Skip — record reason.
   > 3. Halt §6 — return to §5.
   > Default if no response: 2
2. On approval, delegate the edit to a fresh sub-agent for multi-file proposals (orchestrator never edits — mirrors AUDIT-EXECUTE.md Guardrail 18). Single-file proposals may apply inline via the `Edit` tool. Each edit MUST preserve the file's existing structure; only the listed change is applied.
3. **Inline lean-threshold check.** Run `wc -l <target_file>` immediately after the edit. Compare against the row in `governance/CONSTITUTION.md` §2 P5. Overage → surface as violation, prompt rollback (`git checkout HEAD -- <target_file>`) before the next per-file ASK.
4. **Inline anti-slop check.** Grep the modified region for the `governance/AUDIT-EXECUTE.md` gate 11 wordlist; for each hit, scan the next 8 words for a measurable qualifier. Hits without qualifier → surface as violation, prompt rollback before continuing.
5. **Anti-slop wordlist paired-edit invariant.** If the modified file is `AUDIT-EXECUTE.md` gate 11 OR `CLAUDE.md` §Anti-Slop, the partner file MUST be modified in the same §6.1 pass — or both edits rolled back.
6. Append `{proposal_id, file, diff_hash, applied_at}` to `.re-envision-workspace/direct-edits.log`.

### §6.2 CL-3 handoff emission

Write `.re-envision-workspace/cl-3-handoff.md` using the AUDIT.md CL-3 Output table format:

```
| Proposal | Category | Current State | Proposed Change | Rationale | Risk |
```

Categories per `governance/AUDIT.md` Phase CL-3 §Categories: (1) New/modified domain scope, (2) Sub-agent count changes, (3) Checklist refinements, (4) Scoring methodology adjustments, (5) Process improvements. RE-ENVISION never invokes Phase 7 — the maintainer triggers it via `/h4tcher-audit-execute` after RE-ENVISION completes.

### §6.3 §8 amendment queue emission

Write `.re-envision-workspace/constitution-amendment-queue.md` with one entry per §8-routed proposal, pre-populating the dated rationale block:

```
## Proposal {id}
- target: <file + section>
- date: <run timestamp>
- pillar_served: <P1..P8>
- current_state: <quoted passage>
- proposed_change: <diff-style description>
- measurable_improvement: <quantified delta>
- size_impact: <+/- line count, justification if increase>
- rationale: <≥3-sentence framework-owner-facing narrative>
```

The maintainer applies each entry via the `governance/CONSTITUTION.md` §8 Amendment Protocol. RE-ENVISION does not direct-edit pillars, traceability matrix, amendment protocol itself, or Key Design Decisions.

### §6.4 Final routing table

Emit a single summary table to chat and to `.re-envision-workspace/routing-table.md`:

```
| Proposal ID | Route | File / Destination | Status |
```

Status values: `applied` (direct-edit committed), `queued-CL-3` (in cl-3-handoff.md), `queued-§8` (in constitution-amendment-queue.md), `rolled-back` (lean/anti-slop violation), `skipped` (user declined per-file).

---

## §7 — Downstream Alignment Sweep

Runs only if §6 mutated at least one file (check `.re-envision-workspace/direct-edits.log`).

### §7.1 Pairwise cross-reference scrubbing

For each modified file, run `grep -l <filename>` across `governance/` and `CLAUDE.md`. For each consumer:

- Stale line numbers — surface as Medium finding for next-cycle direct-edit.
- Deleted section anchors — surface as High finding; offer in-pass repair if the consumer is itself direct-editable.
- Divergent terminology (term added in §6 not propagated) — surface as Medium finding.

Append findings to `.re-envision-workspace/cross-reference-scrub.md`.

### §7.2 Pillar coverage redraw

If any §6-modified file added or removed a pillar reference in its first 30 lines, the change MUST appear in `governance/CONSTITUTION.md` §3 traceability matrix. If not already routed via §5 to the §8 amendment queue, emit a new §8 amendment queue entry now (pre-populated dated rationale, awaiting framework-owner application).

### §7.3 EVOLVE Route A closure log

For each EVOLVE Route A inbox entry that was applied, deduped, or rejected in §6: write an entry to `.re-envision-workspace/evolve-route-a-closure.md` with `{evolve_proposal_id, action: applied|deduped|rejected, re_envision_finding_id, target_file}`. **Informational only.** Guardrail 12 forbids writes to `governance/EVOLVE-REPORT.md` — the next EVOLVE run is stateless against the current filesystem state (EVOLVE.md Guardrail 11).

### §7.4 Maintenance commands

Instruct the framework owner to run, in order:

1. `npm run inventory` — regenerates `governance/inventory.json` (count drift CI gate).
2. `npm run validate:rule-parity` — `.md` ↔ `.mdc` rule parity.
3. `npm test`, `npm run lint`, `npx tsc --noEmit` — full quality-gate set.

RE-ENVISION does not invoke these commands itself — the framework owner runs them in their primary shell.

---

## §8 — Summary & Routing

### §8.1 Per-route run summary

Emit a table covering both per-layer counts and per-route counts:

```
| Layer | Findings | Direct-edit | CL-3 queued | §8 queued | Rolled back | Skipped |
| L1    | …        | …           | …           | …          | …            | …       |
…
| L10   | …        | …           | …           | …          | …            | …       |
```

### §8.2 Next-actions bullet list

- Trigger `/h4tcher-audit-execute` if `.re-envision-workspace/cl-3-handoff.md` has ≥1 entry — Phase 7 consumes it.
- Trigger `/h4tcher-audit-cycle` next if any modified file changed audit-system surface area downstream (per §7.1 cross-reference scrub).
- Apply each `.re-envision-workspace/constitution-amendment-queue.md` entry manually under `governance/CONSTITUTION.md` §8 Amendment Protocol.
- Commit `.re-envision-workspace/direct-edits.log` entries via Conventional Commits with DCO sign-off per `.claude/rules/commit-conventions.md`.

### §8.3 Metadata block

Write `.re-envision-workspace/metadata.json`:

```
{
  "run_id": "<uuid>",
  "timestamp_start": "<ISO-8601>",
  "timestamp_end": "<ISO-8601>",
  "mode": "full-rethink | occasional-check | targeted-layer:<layer>",
  "constitution_commit": "<short_sha pinned at run start>",
  "evolve_cross_ref": true | false,
  "by_analogy_decisions": [ /* §0.5 forbidden-pattern extensions recorded */ ],
  "sub_agent_count": <integer>,
  "sub_agent_rationale": "<one-sentence>"
}
```

### §8.4 Stop directive

> End of prompt. Executing agent: stop here. Do not invoke `/h4tcher-audit-cycle`, `/h4tcher-audit-execute`, EVOLVE.md, or any downstream prompt. The direct-edits are applied, the CL-3 handoff is written, the §8 amendment queue is written, the routing table is printed. The framework owner triggers the follow-up actions enumerated in §8.2.

---

## Guardrails

1. **5 hard-stop ASK gates** at §0.3 (mode), §1.5 (scope), §3.4 (pre-dialog), §5.3 (batch approval — 3 sub-ASKs), §6.1 (per-file consent — one ASK per direct-edit proposal). No timed default-yes.
2. **Per-file consent at §6.1.** Every direct-edit applies under an individual per-file ASK. Multi-file proposals split into per-file ASKs.
3. **Edit-authority matrix in §5.1 is binding.** No proposal is routed outside the matrix without an explicit framework-owner override recorded in §8.3 metadata.
4. **Audit-system files are never direct-edited.** `AUDIT.md` domains/scoring/CL phases, `AUDIT-EXECUTE.md` waves/gates/registry/Phases 5–7, `audit/domains/*`, `audit/templates/*`, `.claude/rules/*`, `.claude/skills/h4tcher-*` route exclusively to CL-3 / Phase 7.
5. **CONSTITUTION pillars, traceability matrix, amendment protocol, and Key Design Decisions are never direct-edited.** These route exclusively to the §8 amendment queue with pre-populated dated rationale; the framework owner applies via `governance/CONSTITUTION.md` §8 Amendment Protocol.
6. **Pillar Compliance Test per proposal.** Four questions answered before §5.3 admission (`governance/CONSTITUTION.md` §2). Any unanswered question → proposal rejected.
7. **Inline anti-slop check at §6.1.** Every direct-edit triggers a wordlist scan with 8-word measurable-qualifier window per `governance/AUDIT-EXECUTE.md` gate 11. Hits without qualifier → rollback before next per-file ASK.
8. **Inline lean-threshold check at §6.1.** Every direct-edit triggers `wc -l <target_file>` against the `governance/CONSTITUTION.md` §2 P5 row. Overage → rollback before next per-file ASK.
9. **Model-Independence Contract — by-reference inheritance.** EVOLVE.md §0 applies to this prompt, every SA, and every workspace file. By-analogy decisions are recorded in §8.3 metadata.
10. **P8 ambiguity gate at §0.1.** `agents/shared/user-question-protocol.md` consulted before any file scan; one question per turn; default-if-no-response mandatory.
11. **Sub-agent count + rationale at §2.0.** First-class output field per `governance/CONSTITUTION.md` §2 P8 B2 — omitting either is a Guardrail 11 violation.
12. **EVOLVE-REPORT.md is read-only.** RE-ENVISION reads it once at §0.4 and writes only the §7.3 closure log inside `.re-envision-workspace/`. EVOLVE-REPORT itself is never written by RE-ENVISION.
13. **`.re-envision-workspace/` is ephemeral and gitignored.** Created at run start; deleted at the framework owner's discretion after §8.4 stop. Git ignore enforced via `.gitignore`.
14. **Maximum 20 sparring themes per run.** No batching across themes; one block at a time. Cross-layer concerns sweep at §4.99 captures the remainder as free-text.
15. **No batch approval for §8 amendments.** The §5.3 §8 ASK enumerates every proposal; the framework owner approves the batch to *queue*, but each amendment applies individually via §8 Amendment Protocol with per-amendment dated rationale.
16. **14-day cadence floor.** Re-runs blocked unless ≥14 days since last run, OR Critical security incident, OR BLOCK verdict from last `/h4tcher-audit-cycle`. Cadence override lifts the interval, not the authorization (framework-owner only).
17. **Cross-reference scrubbing mandatory if §6 mutated files.** §7.1 runs unconditionally when `.re-envision-workspace/direct-edits.log` is non-empty.
18. **Explicit stop at §8.4 — no downstream prompt invocation.** RE-ENVISION does not invoke `/h4tcher-audit-cycle`, `/h4tcher-audit-execute`, EVOLVE, or any other prompt. The framework owner triggers follow-up actions.

---

> End of prompt. Executing agent: stop here. No downstream invocation. The workspace artifacts are written. The routing table is printed. Wait for the framework owner.
