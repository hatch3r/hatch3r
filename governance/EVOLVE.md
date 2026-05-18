# hatch3r — Evolve Prompt

> Last updated: 2026-04-19
> Role: Constitutional self-check across the governance corpus, anchored in current-practice web research and the Scientific Rigor Contract. Proposal-only. Modifies no governance file except the report artefact.

## Purpose

Evolve is a governance self-check prompt. It assesses the existing governance files against nine measurable dimensions and emits a proposal report. It does not rewrite the vision, run the framework audit, or modify any governance file aside from its own report artefact. EVOLVE runs standalone — neither a precursor to nor a successor of `governance/AUDIT.md`, and does not block or gate AUDIT runs. EVOLVE assesses the governance corpus; AUDIT assesses the framework output.

**Triggers.**
- A capability uplift in the executing agent's generation is observed
- Suspected drift in the governance corpus (lean thresholds exceeded, pillar gaps detected, staleness observed)
- Periodic cadence — a maximum of 90 days since the prior EVOLVE run

**Run gating.** Minimum 7 days between consecutive EVOLVE runs. A Critical security incident or a regression-gate failure involving governance-scoped artefacts overrides the interval (not the authorization). Authorization: framework owner only.

**North Star.** Evolve serves one mission: keep the governance corpus aligned with the framework's goal of helping teams ship winning real-world software products at any scale through agentic AI. The mission is enumerated as five measurable traits:

1. correctness
2. security
3. performance
4. developer experience per P1 (CLI UX Excellence) in `governance/CONSTITUTION.md` §2
5. one-shot success rate per `governance/VISION.md` §Quality Bar

Every assessment dimension, every finding, and every proposal is tested against this five-trait mission. A proposal that does not advance a trait with a measurable delta is rejected before ranking (§4.2) and loses ties after ranking (Guardrail 14).

**Out of scope.**
- Rewriting governance content (VISION.md, principles, lean threshold rows, anti-bloat principles, Silent Failure Contract, behavioral charter directive additions/refinements, anti-slop wordlist, EVOLVE/RE-ENVISION prompt mechanics, quality-charter, user-question-protocol, CLAUDE.md cross-references) — that flows through `governance/RE-ENVISION.md`
- Running the 19-domain framework audit — that is `governance/AUDIT.md`
- Applying governance amendments — those flow through `governance/RE-ENVISION.md` (direct-edit with per-file consent for permitted layers), AUDIT-EXECUTE Phase 7 (CL-3, per-proposal consent) for audit-system changes, or the Amendment Protocol in `governance/CONSTITUTION.md` §8 for pillars, traceability matrix, amendment protocol itself, and Key Design Decisions

---

## §0 — Preflight: Model-Independence Contract

Before any assessment begins, the executing agent accepts this contract.

**The executing agent MUST NOT:**
- Name its own model family, vendor, or version tier in the prompt trace or in the report
- Use phrases that presume a specific model capability (e.g., "given my larger context window", "because I can reason harder than prior generations")
- Refer to specific context-window sizes, token limits, or tokenizer behaviours
- Mention any model or vendor by name — this includes specific AI labs, named models, and version identifiers

**The executing agent MUST:**
- Use capability-abstract verbs in its own output: "the executing agent", "the authoring agent", "the reviewing agent", "the sub-agent"
- Frame capability uplift abstractly: "expanded capability bandwidth", "stronger adherence to structured output schemas", "higher coherence on long-context synthesis"
- Apply the same forbidden-phrase test to every governance file under review AND to the report it writes

**Forbidden-pattern table** (partial list; extend by analogy):

| Pattern class | Example hits | Acceptable replacement |
|---|---|---|
| Tier words | flagship, frontier, premium, top-tier | "expanded capability bandwidth" |
| Size words | XL, large, small, mini, nano | "the executing agent" (no size) |
| Generation words | next-gen, latest, newest | "a capability uplift over the prior generation" |
| Brand / vendor | any AI lab name | "the executing agent's generation" |
| Model-ID pattern | version suffix digits, tag strings | (remove entirely) |
| Context-window size | token-count figures | "long-context synthesis" |
| Token / tokenizer terms | budget-in-tokens, byte-pair-encoding | (remove entirely) |

**Future-proofing clause.** If a term enters common usage after this document was written that maps to model tier / size / generation / vendor identity, the executing agent MUST treat it as a banned pattern by analogy and MUST record the decision in the Metadata section of the run's report.

**File-path exception.** Strings inside backticks that name files in this repository (e.g., adapter-output filenames whose names happen to be derived from vendor or product identifiers) are factual references to repository files, not self-identification by the executing agent. They are exempt from the name-ban in this contract.

**Platform-scope exception.** Factual references to the framework's committed adapter-target platforms by name (the set registered in `src/adapters/index.ts`) in scope statements — for example, `VISION.md` §Supported Platforms or `AUDIT.md` Canonical Source ↔ Adapter Outputs — are factual adapter-target references, not executing-agent self-identification. They are exempt from the brand/vendor name-ban.

**External-currency exception.** Directives referencing current external research or platform documentation (e.g., "current documentation", "published research") in checklist items or sub-agent prompts, where the subject is external artefacts and not the executing agent's capability tier, are exempt from the generation-word ban. The cited source and its access date must accompany the directive.

The report artefact is `governance/EVOLVE-REPORT.md`. The prompt writes no other file.

### Web Research Mandate & Scientific Rigor Contract

Both apply unmodified per the canonical [audit/templates/rigor-contract.md](audit/templates/rigor-contract.md). Every finding and every proposal in this prompt satisfies the six tests (falsifiability, triangulation, confidence with basis, ≥3-step causal chain, bias check, adversarial peer-review counter-argument) and the Web Research Mandate citation profile (≥2 independent sources, URL + access date + author/org + trust tier, recency windows). Missing any disqualifies the finding from inclusion.

Per-EVOLVE topic targets (drawn from `audit/templates/rigor-contract.md` §Per-Domain Source Targets, plus EVOLVE-specific): leading agentic-coding framework practice, prompt-engineering and agent-orchestration research, platform documentation for the 15 adapters hatch3r ships, security baselines (OWASP ASI, supply-chain reports), industry UI/UX patterns for developer tools, performance/cost benchmarks for agentic workflows.

---

## §1 — Pre-Assessment: Load and Inventory

### 1.1 Enumerate in-scope files

Load and record line counts plus `Last updated` headers for:
- `governance/VISION.md`
- `governance/CONSTITUTION.md`
- `governance/AUDIT.md`
- `governance/AUDIT-EXECUTE.md`
- `governance/RE-ENVISION.md`
- `governance/EVOLVE.md` (this prompt; self-review in scope; processed first per §2)
- Every file matching `governance/audit/domains/D*.md`
- Every file matching `governance/audit/templates/*.md`

**Explicitly out of scope, with rationale:** the gitignored PRD (`governance/hatch3r-prd.md`) and competitive analysis (`governance/COMPETITIVE-ANALYSIS.md`) carry operational detail and market context; state files (`governance/audit/finding-registry.json`, `governance/audit/execution-insights.json`, `governance/audit/baseline.json`) are per-run mutable data, not governance prompt content; `CLAUDE.md` and `.claude/*` are dev-setup for building hatch3r, not framework-governance; the canonical content corpus (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/`) is the responsibility of `governance/AUDIT.md` domains D1, D5, D9, and D19, not EVOLVE.

### 1.2 Record inventory

For each file, record: line count, `Last updated` date if present, pillar references found in the first 30 lines, and whether the file is a prompt (directive) or documentation (descriptive).

### 1.3 Load authoritative references BY REFERENCE

The prompt does not restate these. It reads them from source:
- Six Binding Pillars (P1–P6): `governance/CONSTITUTION.md` §2
- Lean thresholds table: `governance/CONSTITUTION.md` §2 Lean Thresholds
- Pillar Compliance Test: `governance/CONSTITUTION.md` §2
- Pillar-to-Governance Traceability Matrix: `governance/CONSTITUTION.md` §3
- Anti-slop wordlist: `governance/AUDIT-EXECUTE.md` regression gate check 10
- Severity conventions (Critical / High / Medium / Info): `governance/AUDIT.md` §Scoring Methodology
- Amendment Protocol: `governance/CONSTITUTION.md` §8

### 1.4 ASK — Gate 1: scope confirmation

Present the inventory table and the explicit out-of-scope rationale. Ask:

> Proceed with all files in scope? (y/n) If n, list files to exclude from this run.

Hard stop. Do not proceed without an explicit response.

---

## §2 — Per-File Assessment: Nine Dimensions

For every in-scope file, the executing agent runs the nine-dimension checklist. `governance/EVOLVE.md` is processed first so the self-check is on record before any other file biases the assessment. Domain and template files are processed in a loop using one shared template, and broken out individually only when a specific file has Critical or High findings.

### 2.1 Assessment dimensions

For each file, record a row per dimension: **verdict** (Pass / Partial / Fail), **evidence** (quoted phrase or section reference), **severity** (Critical / High / Medium / Info).

1. **Pillar alignment (P1–P6).** Does the file declare which pillars it serves? Is every section traceable to at least one pillar? Orphan content is a Medium finding.
2. **Lean threshold compliance.** Is the line count within the threshold defined in `governance/CONSTITUTION.md` §2 Lean Thresholds? Overage without a pillar-backed rationale is a High finding.
3. **Anti-slop compliance.** Apply the wordlist from `governance/AUDIT-EXECUTE.md` regression gate check 10. Each unqualified hit is a Medium finding. Count and list phrase-by-phrase.
4. **Cross-file duplication.** Identify paragraphs, tables, or lists that restate concepts owned by another governance file. Reference over restatement is the target. Greater than 5% concept-level duplication across a pair is a High finding.
5. **Model-portability.** Scan for model or vendor or family names, version identifiers, capability-tier phrasing, and context-window-specific instructions. Any hit in a prompt file is a Critical finding; in documentation, Medium. The §0 contract and forbidden-pattern table apply.
6. **Currency.** Compute days since the file's `Last updated` header. Greater than 180 days is a Medium finding. A missing header is a Low finding. Prose date references that now lie in the past are Low findings.
7. **Pillar coverage contribution.** Cross-reference the file's claimed pillars against the Pillar-to-Governance Traceability Matrix in `governance/CONSTITUTION.md` §3. Drift between the claim and the matrix is a Medium finding.
8. **Capability-leverage opportunities.** Identify sections where increased execution capability would permit simplification (fewer sub-steps), consolidation (merged overlapping sub-agents), or expansion (new checks previously too costly). State opportunities in capability-abstract terms per §0. Each opportunity is Info severity.
9. **North Star contribution.** Does the file advance at least one enumerated North Star trait (correctness, security, performance, developer experience per P1, one-shot success rate per VISION.md §Quality Bar)? Absent contribution on a file whose stated role implies such capability is a Medium finding; a false claim of capability is a High finding.

**Intentionally out of scope as EVOLVE dimensions** (each is owned by an AUDIT.md domain, not EVOLVE): adapter parity (D9), onboarding quality (D10), accessibility (D10), distribution readiness (D18), economic viability (D18), community-contribution friction (D10, D18), performance-under-load (D1, D3, D4).

### 2.2 Per-file output structure

Each file receives a sub-section in the report:

```
### <file-path>
| Dimension | Verdict | Evidence | Severity |
|-----------|---------|----------|----------|
| Pillar alignment | ... | ... | ... |
| Lean threshold | ... | ... | ... |
| Anti-slop | ... | ... | ... |
| Cross-file duplication | ... | ... | ... |
| Model-portability | ... | ... | ... |
| Currency | ... | ... | ... |
| Pillar coverage | ... | ... | ... |
| Capability-leverage | ... | ... | ... |
| North Star contribution | ... | ... | ... |
```

Domain and template files collapse into a single summary table with one row per file when findings are uniform. Any file with a Critical or High finding gets its own full sub-section.

---

## §3 — Cross-File Synthesis

### 3.1 Pairwise duplication matrix

Produce an NxN matrix across all in-scope files. Each cell shows estimated concept-level overlap as a percentage. Target <5% per pair. Flag pairs over 5% as High findings and list the overlapping concept.

### 3.2 Pillar coverage redraw

Redraw the Pillar-to-Governance Traceability Matrix (rows = P1–P6, columns = in-scope files) based on the pillar references recorded in Step 1.2. Compare cell-by-cell against `governance/CONSTITUTION.md` §3. Flag any pillar with no file coverage; flag any file serving zero pillars.

### 3.3 Currency summary

One row per file: `Last updated`, days stale, verdict. Sort by staleness descending.

### 3.4 Capability-leverage summary

One row per opportunity: file, section, current approach, capability-abstract description of the uplift that would enable simplification or consolidation. No model names. No tier / size / generation words.

---

## §4 — Proposal Generation

### ASK — Gate 2: pre-web-research confirmation

Before running web research, present the six topics and the ≥2-independent-sources rule. Ask:

> Proceed with web research on all six topics? (y/n) If n, list topics to drop or narrow.

Hard stop.

### ASK — Gate 3: pre-proposal confirmation

After findings are captured but before proposals are ranked, present the findings set and any rejection-filter hits from §4.2. Ask:

> Proceed to rank and generate proposals from the presented findings set? (y/n) If n, list findings to exclude.

Hard stop.

Generate at most **15 proposals per run**. Rank by the formula:

```
rank_score = severity_weight × pillar_impact × north_star_multiplier
  severity_weight      = Critical:25, High:10, Medium:3, Info:1
  pillar_impact        = count of pillars served (1–6)
  north_star_multiplier = 1.5 if proposal advances a named North Star trait
                          with a measurable delta, else 1.0
```

Drop the tail beyond the 15-proposal cap.

### 4.1 Proposal schema

Every proposal records:

- **Proposal ID.** Sequential integer within the run.
- **Target file.** Exact repository-relative path.
- **Current state.** Quoted passage or section reference.
- **Proposed change.** Diff-style description (add / remove / rewrite).
- **Pillar served.** One or more of P1–P6.
- **North Star trait advanced.** One or more of the five enumerated traits, with the measurable delta stated.
- **Line delta.** Estimated +/- lines.
- **Routing recommendation.** Route A, B, or C (see §6).
- **Pillar Compliance Test answers.** Three answers per `governance/CONSTITUTION.md` §2: which pillar(s), what measurable improvement, net size impact (with justification if an increase).

### 4.2 Rejection filters

A proposal is rejected before inclusion if any of these hold:

- It cannot answer all three Pillar Compliance Test questions
- It does not advance at least one enumerated North Star trait
- It proposes an operational-detail change — release dates, version numbers, command flags, CI workflow tweaks; those belong in PRD
- It proposes a change to EVOLVE.md that would remove the Model-Independence Contract in §0 or the guardrails in §7
- It proposes auto-apply semantics — this prompt is proposal-only by design
- Its core claim is not measurable (no quantified threshold, no falsifiable delta)
- It duplicates a finding currently open in the active audit cycle (check the most recent `governance/AUDIT-REPORT.md` if present; if the report is ephemeral per Guardrail 9 and absent, the filter does not fire)
- It depends on infrastructure not yet present in the repository (uncommitted file paths, proposed-but-not-adopted schemas)

---

## §5 — Report Assembly

### 5.1 Compose the report

Compose `governance/EVOLVE-REPORT.md` with these sections:

1. **Executive Summary.** File count; findings by severity; routing split (A / B / C); governance total line count versus the 3000-line budget; trigger that fired for this run; authorizer; North Star advancement summary (traits touched by accepted proposals); any *Self-Critical Caveat* block per the Self-Assessment Semantics section below.
2. **Per-File Assessment.** §2 output, one sub-section per file, self-row first.
3. **Cross-File Synthesis.** §3 output — duplication matrix, pillar coverage delta, currency summary, capability-leverage summary.
4. **Web Research Citations.** Consolidated table — one row per source: URL, access date, author/organisation, trust tier, topic served, recency check verdict.
5. **Findings Log.** One row per finding with falsifiability statement, citation(s), confidence (H/M/L), causal-chain depth, bias-check result, adversarial peer-review counter-argument, confidence-downgrade flag if any.
6. **Proposals.** §4 output, at most 15.
7. **Routing Map.** §6 output — one table row per proposal under each route; multi-route splits recorded.
8. **Metadata.** Inventory timestamps; pinned `governance/CONSTITUTION.md` commit hash; assessment-dimensions version; prompt-file SHA at run start; trigger; authorizer; run-id; any forbidden-pattern-by-analogy decisions recorded per §0.

### 5.2 Self-audit pass

Before writing the report, scan the composed content for: model / vendor / family names; capability-tier, tier-word, size-word, generation-word, or context-window phrasing tied to a specific generation; anti-slop wordlist hits from `governance/AUDIT-EXECUTE.md` regression gate check 10; operational-detail proposals that slipped past the §4.2 filter. Rewrite or remove every hit. Repeat the scan until zero hits remain.

### 5.3 ASK — Gate 4: report write confirmation

Present the target path (`governance/EVOLVE-REPORT.md`) and overwrite intent, including any *Self-Critical Caveat*. Ask:

> Write the report to `governance/EVOLVE-REPORT.md`, overwriting any existing file at that path? (y/n)

Hard stop.

### 5.4 Write

On confirmation, write the report. Modify no other file.

---

## §6 — Handoff and Routing

Every proposal is routed to exactly one of three buckets. The report's routing table lists each proposal under its route with the next-prompt handoff.

**Route A — Governance refinement.** Any proposal that touches a layer where RE-ENVISION has direct-edit authority (per `governance/RE-ENVISION.md` §5 edit-authority matrix): `governance/VISION.md` content (identity, audience, quality bar, principles, platform strategy, lifecycle coverage), `governance/CONSTITUTION.md` §2 P5 lean threshold rows, `governance/CONSTITUTION.md` §2 Anti-Bloat Principles, `governance/CONSTITUTION.md` §2 Silent Failure Contract, behavioral charter directive additions/refinements in `governance/AUDIT.md`, the anti-slop wordlist in `governance/AUDIT-EXECUTE.md` regression gate 11 paired atomically with `CLAUDE.md` §Anti-Slop Wordlist, `governance/EVOLVE.md` prompt mechanics, `agents/shared/quality-charter.md`, `agents/shared/user-question-protocol.md`, and `CLAUDE.md` cross-references. Next prompt: `governance/RE-ENVISION.md` used as a sparring engine. The proposal flows through RE-ENVISION's themed-dialog refinement (§4) and per-file consent execution (§6.1).

**Route B — Audit system.** Any proposal that touches `governance/AUDIT.md`, `governance/AUDIT-EXECUTE.md`, `governance/audit/domains/D*.md`, or `governance/audit/templates/*.md`: sub-agent counts, domain weights, scoring methodology, behavioral charter, regression gates, waves, closed-loop phases, template content. Next prompt: `governance/AUDIT-EXECUTE.md` Phase 7 (Audit Prompt Evolution / CL-3). The proposal is presented per-item for user consent.

**Route C — Constitution and prompt mechanics.** Any proposal that touches `governance/CONSTITUTION.md`, `governance/RE-ENVISION.md` *as an artefact to edit* (prompt mechanics of RE-ENVISION itself, not vision content), or `governance/EVOLVE.md` itself: pillar wording, lean thresholds, anti-slop wordlist, Pillar Compliance Test, prompt mechanics. Next action: direct edit under the Amendment Protocol in `governance/CONSTITUTION.md` §8 with a dated rationale.

**RE-ENVISION.md role boundaries — worked examples.** A proposal to clarify VISION.md's audience list → Route A (RE-ENVISION sparring engine direct-edits VISION.md with §6.1 per-file consent). A proposal to add a lean-threshold row for a new governance file → Route A (RE-ENVISION direct-edits the CONSTITUTION §2 P5 row with §6.1 per-file consent + §8 dated rationale). A proposal to refine a CONSTITUTION pillar definition → Route C (queue for framework-owner §8 amendment; RE-ENVISION's §6.3 emits a `constitution-amendment-queue.md` with pre-populated dated rationale, but does NOT direct-edit pillars). A proposal to add a new theme-block question to RE-ENVISION.md's §4 dialog → Route A (RE-ENVISION direct-edits its own prompt mechanics — `EVOLVE.md prompt mechanics` is in RE-ENVISION's direct-edit authority list; the same applies by analogy to RE-ENVISION's own mechanics). The destination of the change determines the route.

**Multi-route conflict resolution.** If a proposal targets files in multiple routes, split it into per-route sub-proposals so each sub-proposal is routed independently. If the proposal is atomic and cannot be split, route to the highest-risk route in precedence order C → B → A — the most restrictive amendment path governs.

### 6.1 Routing table

```
| Route | Proposal IDs | Next Prompt / Action                              |
|-------|--------------|---------------------------------------------------|
| A     | ...          | governance/RE-ENVISION.md                         |
| B     | ...          | governance/AUDIT-EXECUTE.md Phase 7 (CL-3)        |
| C     | ...          | Direct edit under governance/CONSTITUTION.md §8   |
```

After writing the routing table and naming the next prompt per bucket, the prompt stops. EVOLVE does not invoke any downstream prompt.

---

## §7 — Guardrails

1. **No governance modification.** The only file this prompt writes is `governance/EVOLVE-REPORT.md`. Every other governance file is read-only throughout the run. The ban is absolute; any change to EVOLVE.md itself flows through Route C.
2. **ASK gates are non-negotiable.** Four hard-stop gates: Step 1.4 (scope confirmation), §4 pre-web-research gate, §4 pre-proposal gate, Step 5.3 (report write confirmation). The prompt halts at each gate and waits for an explicit response. No timed default-yes.
3. **Maximum 15 proposals per run.** Overflow is dropped by the rank formula in §4. The prompt does not batch overflow into a "part 2" report.
4. **Pillar Compliance Test is mandatory per proposal.** A proposal missing any of the three answers from `governance/CONSTITUTION.md` §2 is rejected before inclusion.
5. **Model-Independence Contract applies to prompt and report.** The Step 5.2 self-audit removes every violation before write. A hit in the report is a blocker; the report does not ship with any hit.
6. **Operational details are out of scope.** Release dates, version numbers, command flags, CI workflow tweaks — those belong in PRD or repository configuration, not in governance proposals.
7. **No amendment authority.** Proposals are proposals. Routes A, B, and C flow through existing mechanisms — RE-ENVISION, AUDIT-EXECUTE Phase 7, and `governance/CONSTITUTION.md` §8 Amendment Protocol respectively. EVOLVE does not claim to amend any governance file.
8. **Missing file equals recorded gap, not abort.** If an in-scope file is missing from the filesystem, the prompt records the gap as a Critical finding in Per-File Assessment and continues with the remaining files.
9. **Report is ephemeral.** Each run overwrites `governance/EVOLVE-REPORT.md`. `governance/EVOLVE-REPORT.md` is listed in `.gitignore` so the report never enters version control. No historical retention — prior runs are lost on overwrite. This is intentional per Guardrail 11 (no cross-run state); cross-run analysis would violate that guardrail.
10. **No duplication of source-of-truth content.** Pillars, lean thresholds, anti-slop wordlist, Pillar Compliance Test, severity conventions, and the Traceability Matrix are referenced by file path and section, never restated. Restatement within EVOLVE.md is itself a High finding this prompt would raise against itself.
11. **No cross-run state.** EVOLVE does not read a prior `EVOLVE-REPORT.md` to decide what to include in the current run. Each run is stateless against the current filesystem state of `governance/`.
12. **No invocation of downstream prompts.** EVOLVE stops after writing the report and printing the routing table. The user triggers RE-ENVISION, AUDIT-EXECUTE, or direct edits as follow-up actions.
13. **Web research and scientific rigor are non-negotiable.** Every finding carries a falsifiability statement, triangulated citations meeting the Web Research Mandate rigor requirements in §0, a confidence level, a root-cause chain of at least three steps, a bias check, and an adversarial peer-review counter-argument. Every current-practice claim carries URL + access date + author/org + trust tier. Missing any disqualifies the finding from inclusion.
14. **North Star is both an upstream gate and the tiebreaker.** A proposal that fails to advance at least one enumerated North Star trait is rejected at §4.2. When two accepted proposals conflict or when prioritisation is ambiguous, the proposal that better advances the framework's ability to ship winning real-world software at any scale wins. Internal elegance without mission impact loses.
15. **Run gating.** Minimum 7 days between consecutive EVOLVE runs; framework-owner authorization required; a Critical security incident or a regression-gate failure involving governance-scoped artefacts overrides the interval but not the authorization.
16. **Forbidden-pattern extension by analogy.** Any term that maps to model tier / size / generation / vendor identity is banned even if introduced after this prompt was written. Each such decision is recorded in the report's Metadata section.

---

## Self-Assessment Semantics

`governance/EVOLVE.md` is processed first in §2 so the self-check is on record before any other file biases the assessment.

- On a **self-Medium, self-Low, or self-Info** finding: the run proceeds normally; the self-row is reported in Per-File Assessment as for any other file.
- On a **self-High** finding: reported normally. The run proceeds.
- On a **self-Critical** finding: the run **does not halt**. Instead, the Executive Summary opens with a *Self-Critical Caveat* block naming the finding, restating that Guardrail 1 forbids in-run self-edit, and identifying the Route C proposal that must be adopted before the next EVOLVE run. The Step 5.3 ASK gate repeats the caveat so the user has an explicit choice.

---

## Pillar Service Declaration

This prompt serves the framework's North Star through the following pillars:

- **P5 Governance Self-Quality (primary).** Structural self-check across nine measurable dimensions; surfaces drift that today has no other owner.
- **P4 Comprehensive Lean Coverage (supporting).** Pairwise duplication matrix, pillar-gap detection, and per-file lean-threshold verification.
- **P2 Scientific & Practical Quality (supporting).** Enforces the six-test Scientific Rigor Contract in §0 — falsifiability, citation, confidence expression, root-cause orientation, bias check, adversarial peer-review — on every finding and proposal.
- **P3 Adapter & MCP Currency (supporting).** Enforces the Web Research Mandate in §0 — proposals that invoke current practice carry URL + access date + author/org + trust tier citations.

**Pillar Compliance Test answers for this prompt file:** (1) Serves P5 primary plus P4, P2, P3 supporting. (2) Measurable improvement — surfaces drift in the governance corpus via the nine-dimension checklist and routes every actionable proposal to one of three defined amendment mechanisms; rejects proposals failing the Scientific Rigor Contract or Pillar Compliance Test so the governance system stays testable. (3) Yes, it increases governance size by roughly the line count of this file; net value exceeds cost because no other prompt owns constitutional self-check against current practice — absent this prompt, drift surfaces only incidentally during full audits (D16, D18, D19) where governance attention competes with framework-output findings.

This prompt is itself subject to the nine-dimension checklist in §2 and to the Scientific Rigor Contract in §0. Each run records a self-assessment row for `governance/EVOLVE.md` in the Per-File Assessment output.

---

## Follow-Up Items (Out of This Session's Write Scope)

The following are recorded as candidates for a later direct edit under the Amendment Protocol (Route C) or a separate dev-cycle task. This session modifies only `governance/EVOLVE.md`.

- Add an `EVOLVE.md` row to the Lean Thresholds table in `governance/CONSTITUTION.md` §2 P5 and mirror into `CLAUDE.md` §Lean Thresholds. Proposed line cap: 400, with per-section sub-budgets matching the structure of this prompt.
- Add an `EVOLVE.md` row to the Governance References table in `CLAUDE.md`.
- Author `.claude/skills/h4tcher-evolve/SKILL.md` so EVOLVE can be invoked via a dev-side slash command. The canonical pattern is now established by `.claude/skills/h4tcher-re-envision/SKILL.md` (Cycle 9 redesign); this remains an open follow-up. EVOLVE.md remains directly invokable as a prompt without the wrapper.

---

> End of prompt. Executing agent: stop here. Do not continue into downstream routes. The report is written. The routing table is printed.
