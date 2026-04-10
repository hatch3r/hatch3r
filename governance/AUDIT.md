# hatch3r — Full Framework Audit Prompt

## Purpose

Perform a deep, end-to-end audit of every area, aspect, and line of code or content in the hatch3r framework. The goal is to ensure this framework is production-ready, open-sourceable, and excels in every capability compared to the current market — enabling end users to build winning software products at scale.

This audit covers **19 domains** organized across **4 tiers**, deploying **106 sub-agents** for maximum depth. Every domain requires web research for current market context. The final deliverable is a structured audit report with severity-tagged findings, weighted domain scores, and prioritized action items using 3-tier progressive disclosure.

> **Path Convention:** All file paths in this document are relative to the **repository root**. Governance files live under `governance/`. The ephemeral `.audit-workspace/` directory is created at repository root.

---

## Framework Context

> Framework identity, architecture, and principles: see [VISION.md](VISION.md).

### Architecture

| Canonical Source (`/.agents/`) | Adapter Outputs |
|------|-------|
| agents/, skills/, rules/, commands/, prompts/, hooks/, checks/, mcp/, policy/, learnings/, AGENTS.md, hatch.json | .cursor/ (Cursor), .github/ (Copilot), CLAUDE.md (Claude), GEMINI.md (Gemini), .windsurfrules (Windsurf), .amp/ (Amp), AGENTS.md (OpenCode), .codex/ (Codex), .roo/.roomodes (Cline), .aider/ (Aider), .kiro/ (Kiro), .goosehints (Goose), .rules (Zed), .amazonq/ (Amazon Q), .antigravity/ (Antigravity) |

### Component Inventory

Sub-agents MUST run the Dynamic Verification Protocol below to establish actual counts. Do not rely on static numbers — verify by scanning the filesystem at audit start.

#### Dynamic Verification Protocol

1. **Before Tier A launches:** Count files in each content and source directory. Record actual counts.
2. **Discrepancy handling:** If actual counts differ from expectations, use actual counts for all audit calculations. Flag the discrepancy as an Info finding in the relevant domain (D1 for content artifacts, D2 for adapters, D3 for tests, D4 for CI).
3. **Output:** Write verified inventory to `.audit-workspace/verified-inventory.json`. All subsequent sub-agents reference this file.

---

## Execution Model

### Reproducibility and Non-Determinism

LLM-based auditing is inherently non-deterministic. Running the same audit on unchanged code may yield different findings. This is expected behavior, not a flaw. To manage variance:

- **Critical findings must be re-verifiable.** Any auditor reading the same code path should reach the same conclusion. If a Critical finding depends on subjective judgment rather than observable code behavior, downgrade to High.
- **Variance tracking.** When findings differ between cycles for the same unchanged code, flag as variance in the Delta section — not as new findings or regressions.
- **Confidence rating.** Every finding must include a confidence level (high/medium/low) per the Behavioral Charter. This makes variance visible and manageable.

### Adaptive Resource Allocation

Not all domains require equal audit depth every cycle. To prevent diminishing returns:

- **Mature domain reduction.** Domains scoring 95+ for 3 consecutive cycles may have sub-agent allocation reduced (minimum 2 sub-agents per domain). Freed sub-agent slots are reallocated to domains scoring below 80.
- **Reductions require consent.** Resource reallocation is proposed via Phase CL-3 (Audit Self-Evolution) and requires explicit user approval.
- **Automatic restoration.** If a reduced domain's score drops below 90, restore full sub-agent allocation in the next cycle without requiring a CL-3 proposal.

### Sub-Agent Strategy

Spawn **106 sub-agents** across 19 audit domains organized in 4 tiers. Each domain decomposes into multiple focused sub-agents for maximum depth. Sub-agents within the same domain run in parallel unless a sequential dependency is noted. Domain-level synthesis sub-agents run only after their prerequisite sub-agents complete. Inherit your LLM model to every sub-agent — do not downgrade. Each sub-agent MUST use web research. **Never optimize for token efficiency — optimize for audit quality and depth.**

### Dependency Graph

The following sub-agents have sequential dependencies and MUST NOT launch until their prerequisites complete:

| Sub-Agent | Depends On | Reason |
|-----------|-----------|--------|
| 9.15 (Capability Matrix Verification) | 9.1–9.14 | Requires all per-adapter audit findings |
| 9.16 (Emerging Platforms) | 9.1–9.14 | Requires understanding of current adapter landscape |
| 16.1 (Cross-Domain Pattern Synthesis) | D5, D7, D9 | Requires prompt, orchestration, and adapter findings |
| 16.2 (Coverage Gap Analysis) | D5, D9 | Requires content and adapter findings |
| 17.3 (Market Positioning & Strategy) | 17.1, 17.2 | Requires competitor and ecosystem data |
| 18.1 (PRD Alignment) | D16, D17 | Requires cross-domain synthesis and competitive findings |
| 18.2 (Roadmap Reprioritization) | D16, D17 | Requires cross-domain synthesis and competitive findings |
| 18.3 (Distribution Verdict) | 18.1, 18.2 | Requires PRD and roadmap analysis |

### Concurrency Model

Of the 106 total sub-agents, **97 launch immediately** in parallel. The remaining **9 sub-agents** launch sequentially after their dependencies complete:

| Tier | Sequential Sub-Agents |
|------|----------------------|
| B | 9.15, 9.16 |
| C | 16.1, 16.2 |
| D | 17.3, 18.1, 18.2, 18.3 |

### Web Research Requirements

Every sub-agent MUST perform web research relevant to its domain:
- **Platform/adapter domains (D9, D17):** Current platform documentation, competitor features, market shifts
- **Security domains (D15):** Current OWASP guidelines, recent CVEs, MCP vulnerability reports
- **Code quality domains (D1, D3, D8):** Current best practices for the specific pattern being audited (e.g., safe write patterns, test isolation techniques)
- **Agentic development domain (D19):** Current Claude Code documentation for hooks, settings.json schema, skill format, Agent Teams API
- **All domains:** At minimum, verify any external references (tool docs, standards) are current. Cite all sources with version/date.

The goal is grounding findings in current standards, not satisfying a checkbox.

### Result Management Protocol

Sub-agent results MUST be file-based to prevent context overflow:

1. Each sub-agent writes findings to: `.audit-workspace/D{N}-SA{M}.findings.md`
2. After each domain completes, orchestrator reads domain results, produces synthesis (`.audit-workspace/D{N}-synthesis.md`), then releases individual results from context.
3. Report assembled from synthesis files, not accumulated context.
4. Create `.audit-workspace/` at repository root at execution start. Clean per-run artifacts (findings, synthesis files) at the start of each new audit cycle, but preserve cross-cycle files (`execution-insights.json`).
5. Each synthesis file must include a **"Key Findings for Downstream Domains"** section listing findings that later tiers might need, with domain tags (e.g., "Relevant to D7, D9"). This prevents information loss across tier boundaries.
6. Later-tier sub-agents may request specific earlier findings by referencing "D{N}-SA{M}". The orchestrator retrieves the relevant finding from the appropriate synthesis file and provides it as additional context.

### Tiered Execution with Synthesis Gates

Execute by tier with synthesis between tiers:

| Tier | Domains | Agents | Action |
|------|---------|--------|--------|
| A | D1–D4 | 27 | Launch → synthesize → release from context |
| B | D5–D10,D19 | 49 | Launch → synthesize → release from context |
| C | D11–D16 | 24 | Launch → synthesize → release from context |
| D | D17–D18 | 6 | Launch → synthesize → final assembly |

Peak context: 49 sub-agent results (Tier B), not 106.

### Pre-Audit Questions

Before beginning, ask the user:
1. Is there a previous audit report to compare against? If so, where?
2. Are there specific areas of concern or priority for this audit cycle?

---

## Scoring Methodology

### Domain Weighting

| Tier | Domains | Weight Per Domain | Tier Total |
|------|---------|-------------------|------------|
| A — Foundational | D1–D4 | 0.077 | 0.308 |
| B — Quality | D5–D10,D19 | 0.0497 | 0.348 |
| C — System-Level | D11–D16 | 0.0443 | 0.266 |
| D — Strategic | D17–D18 | 0.039 | 0.078 |
| **Total** | | | **1.00** |

### Weighted Score Formula

```
Overall Score = SUM(domain_score[i] * weight[i]) for all domains
```

Each `domain_score[i]` is 0–100. The overall score is therefore 0–100.

### Quality Score Formula

```
domain_score = 100 - (critical * 25) - (high * 10) - (medium * 3) - (low * 1) - (info * 0)
```

Floor at 0. Ceiling at 100.

### Severity Ceiling

Any domain with an unresolved **Critical** finding has its domain score capped at **50/100** regardless of formula output. If any domain triggers this cap, the overall score band is also capped at **Needs Work**.

### Score Bands

| Score | Band |
|-------|------|
| 90–100 | Ship Ready |
| 80–89 | Minor Issues |
| 70–79 | Needs Work |
| 60–69 | Significant Risk |
| < 60 | Not Ready |

### Calibration Check

**Calibration check:** Flag any domain where formula score and holistic assessment diverge by >10 points. Persistent divergences across 2+ cycles trigger a CL-3 proposal.

### Severity Taxonomy

| Severity | Definition | Release Impact | Typical Effort |
|----------|-----------|----------------|----------------|
| Critical | Blocks correct operation or creates security vulnerability | Must fix before any release | S-M |
| High | Significant quality gap affecting user success | Fix in current cycle | S-M |
| Medium | Improvement opportunity with measurable user impact | Fix in current or next cycle | S-L |
| Low | Minor enhancement or polish | Fix when convenient | S |
| Info | Observation, no action required | None | — |

---

## Deduplication Protocol

A finding is a duplicate if it matches on **2 of 3** signals:

| Signal | Description |
|--------|-------------|
| **File** | Same file or module referenced |
| **Root Cause** | Same underlying technical issue |
| **Recommendation** | Same or substantially similar fix |

When duplicates are detected:
1. Keep the highest-severity instance as the primary finding.
2. Record all domain references (e.g., "Also identified in D3, D7").
3. Preserve unique perspectives as sub-points under the primary finding.
4. Do not inflate finding counts — deduplicated findings count as one.

---

## Quality Gates

### Expected Finding Counts

| Severity | Reference Range | If Below Range | Above Range Suggests |
|----------|----------------|----------------|---------------------|
| Critical | 0–5 | Genuine maturity — verify depth before concluding | Fundamental issues |
| High | 5–20 | Verify sub-agents examined specific files and cited line numbers before concluding | Significant quality gaps |
| Medium | 20–55 | Verify sub-agents analyzed code paths, not just file headers | Exhaustive analysis |
| Low | 15–45 | Verify findings are substantive, not padded | Over-reporting |
| Info | 10–30 | Missing strategic context | Appropriate depth |
| **Total** | **50–155** | **Verify audit depth before finalizing** | **Thorough audit** |

If total findings fall below 50, the orchestrating agent MUST verify depth by checking that each sub-agent examined specific files, cited specific lines, and performed relevant web research — not by requiring more findings.

### Quality Checklist

- [ ] All 19 domains were examined (no domain was skipped). Domains with zero findings must include a clean-domain justification citing: specific files examined, verification methods used, and web research performed. A clean domain is acceptable; a skipped domain is not.
- [ ] All 106 sub-agents produced output (no silent failures)
- [ ] Every Critical and High finding has a specific, actionable recommendation
- [ ] Every finding references specific files, line numbers, or artifacts
- [ ] Web research was performed for every domain (cite sources)
- [ ] Deduplication protocol was applied
- [ ] Finding counts fall within expected ranges

### Shallow Finding Detector

Flag any finding matching these patterns and require the sub-agent to deepen:

| Pattern | Required Depth |
|---------|----------------|
| Generic recommendation | Specify which function, what error case, what the improved handling looks like |
| No file reference | Identify specific files, functions, and line numbers |
| No web research citation | Cite the specific standard, paper, or documentation |
| Tautological finding | Identify specific untested paths, branches, or scenarios |
| Copy of checklist item | Provide analysis specific to hatch3r's implementation |
| References removed/replaced code | Verify the referenced file/function still exists in the current codebase before reporting |
| Duplicated from previous audit | Verify the finding hasn't already been resolved in the current version |
| Severity mismatch | The finding's real-world impact must match its severity definition. An "improvement opportunity" (Medium definition) classified as High, or a "polish item" (Low definition) classified as Medium, must be reclassified. When in doubt, classify conservatively (lower). |
| True but irrelevant | The finding must describe a scenario that could realistically occur in normal or adversarial use. Edge cases requiring impossible inputs, deprecated platforms, or contrived conditions are Info at most. |
| Disconnected citation | Web research must connect to hatch3r's specific context. Citing a general standard without explaining why it applies to hatch3r's specific usage pattern is insufficient. |

---

## Audit Domains

19 domains across 4 tiers. Each domain's full scope, sub-agent decomposition, and audit checklists are in the corresponding file under `governance/audit/domains/`.

The orchestrator spawns sub-agents per domain file. Each sub-agent:
1. Reads its domain file (`governance/audit/domains/D{NN}-{name}.md`)
2. Applies the universal checklist below
3. Conducts web research per the global directive
4. Writes results to `.audit-workspace/D{N}-SA{M}.findings.md`
5. Optionally includes an **Inconclusive Areas** section for areas examined where the sub-agent couldn't determine whether an issue exists, with explanation of what blocked determination. These do not count as findings and do not affect scores.

### Universal Audit Checklist (apply to ALL sub-agents)

- [ ] Technical accuracy against current documentation (web research required)
- [ ] Code behavior verification — every finding about code behavior must be verified by reading the specific code path, not assumed from file names or patterns. Cite the function and logic, not just the file.
- [ ] Specific file/line references for every finding
- [ ] Actionable recommendations (not generic)
- [ ] Severity and effort classification per the scoring methodology above
- [ ] Competitor/market comparison where applicable
- [ ] Git history context — before flagging a design decision as a bug, check `git blame` and recent commit messages for intentional rationale. A deliberate architectural choice is not a finding.
- [ ] Measurable acceptance criteria — where possible, findings should include quantifiable thresholds ("error messages include the failing file path in 100% of CLI errors" rather than "error messages should be more helpful")
- [ ] Multi-stakeholder impact — consider how each finding affects: the end user experiencing the product, the developer maintaining the code, the team lead governing quality, and the ops team deploying. Findings that matter to only one stakeholder should note this.

### Sub-Agent Behavioral Charter

Every audit sub-agent must internalize these behavioral directives. These govern HOW you think, not just WHAT you check. The checklists define scope; the charter defines mindset.

1. **Neutrality** — Do not favor findings that inflate your domain's importance. Do not confirm previous audit conclusions without re-verifying independently. Approach each artifact as if seeing it for the first time.

2. **Adversarial thinking** — Think like an attacker (D15), a confused first-time user (D10), a fatigued developer copy-pasting from a tutorial (D5). Ask "how could this realistically fail in practice?" not just "does this follow best practices?"

3. **Root-cause orientation** — Report root causes, not symptoms. "Missing error handling in function X" is a symptom; "no error strategy defined at the architecture level" is the root cause. If you can only identify the symptom, say so and rate confidence as medium.

4. **Intellectual honesty** — Rate your confidence on each finding: **high** (verified against code and documentation), **medium** (based on established patterns but not fully verified), **low** (best judgment, recommend human review). Use the "Inconclusive Areas" section when genuinely uncertain rather than forcing a finding.

5. **Independence from framing** — The framework describing itself as "battle-tested" or "proven" is marketing, not evidence. Verify claims independently. Do not anchor on previous audit findings, the PRD's self-description, or VISION.md's aspirational language.

6. **Inventiveness** — After completing the domain checklist, ask: "What did the checklist miss?" Dedicate approximately 20% of your analysis effort to beyond-checklist exploration — non-obvious failure modes, creative misuse scenarios, emergent issues from component interactions.

7. **Severity discipline** — When in doubt, classify conservatively (lower severity). A Medium finding misclassified as High wastes execution resources in an earlier wave. The Severity Taxonomy definitions are precise — match impact to definition, not the other way around.

8. **Constructive realism** — Recommendations must be implementable within the framework's actual constraints. hatch3r is a setup-time configuration generator, not a runtime agent executor. Recommending runtime monitoring for a tool that generates static files is not actionable.

9. **Challenge the premise** — At least once per domain, ask: "Is this the right approach, or is there a fundamentally better way?" Do not just evaluate execution quality — question whether the design itself is optimal. D7.1 (Pipeline Design) is the explicit home for architectural alternatives, but every domain should question its own assumptions.

10. **Holistic awareness** — Consider how your findings interact with other domains. A D1 finding about error handling patterns may affect D8 (Error Recovery) and D5 (Prompt Engineering). Flag cross-cutting concerns explicitly with domain references so the cross-domain analysis pass can synthesize them.

11. **User-facing perspective** — For any finding affecting CLI output, error messages, or user-visible behavior, evaluate from the perspective of a first-time user running `npx hatch3r init`, not from the developer maintaining the code.

12. **Currency verification** — For any finding involving adapters or MCP servers, verify against the platform's latest official documentation. Cite the documentation version and date. A finding based on stale documentation is itself a finding.

13. **Duplication awareness** — Before flagging a missing content artifact (agent, skill, rule, command), search existing artifacts for overlapping coverage. A proposal for content that already exists is a false positive, not a finding.

### Domain File Quality Standard

Each domain file (`governance/audit/domains/D{NN}-{name}.md`) must meet these minimum quality standards. CL-3 may propose domain file improvements when standards are not met.

- **Minimum depth:** At least 4 checklist items per sub-agent. Domains with fewer items likely have insufficient audit coverage.
- **Scenario-based items:** Checklist items should be scenario-based where possible ("What happens when the MCP server is unreachable?") rather than only question-based ("Is MCP handling good?"). Scenario-based items produce more specific, actionable findings.
- **File references:** Items should reference specific files or code paths to examine, not just abstract concepts. This grounds the audit in the actual codebase.
- **Testability:** Each item should have a clear pass/fail criterion. If an item cannot be objectively evaluated, it should be split or made more specific.

### Summary Table

| Tier | Domain | Sub-Agents | Parallel | Sequential |
|------|--------|-----------|----------|------------|
| A | 1: Core Source Implementation | 10 | 10 | 0 |
| A | 2: Adapter Infrastructure | 7 | 7 | 0 |
| A | 3: Test Infrastructure | 5 | 5 | 0 |
| A | 4: Build, CI/CD & Dependencies | 5 | 5 | 0 |
| B | 5: Prompt Engineering Quality | 8 | 8 | 0 |
| B | 6: Context Engineering & Token Economics | 4 | 4 | 0 |
| B | 7: Agent Orchestration Optimization | 5 | 5 | 0 |
| B | 8: Error Recovery & Resilience | 4 | 4 | 0 |
| B | 9: Platform Adapters | 16 | 14 | 2 |
| B | 10: User Experience & Documentation | 8 | 8 | 0 |
| B | 19: Agentic Development Self-Governance | 4 | 4 | 0 |
| C | 11: End-to-End Data Flow | 4 | 4 | 0 |
| C | 12: CLI Diagnostics & Traceability | 4 | 4 | 0 |
| C | 13: Human-AI Collaboration Quality | 4 | 4 | 0 |
| C | 14: Cross-Project Adaptability & Scalability | 4 | 4 | 0 |
| C | 15: Agentic Security & Trust Model | 6 | 6 | 0 |
| C | 16: Cross-Domain Synthesis | 2 | 0 | 2 |
| D | 17: Competition & Market Intelligence | 3 | 2 | 1 |
| D | 18: PRD, Roadmap & Distribution | 3 | 0 | 3 |
| **Total** | | **106** | **98** | **8** |

> **Note:** Sub-agent counts and domain list may evolve across audit cycles via the self-evolution process (Phase CL-3). The table above reflects the current baseline. Any changes require explicit user consent.

---

## Orchestrator Quality Guidance

The orchestrating agent (the agent executing this prompt) is the most critical component of the audit system. These directives govern orchestrator behavior.

### Sub-Agent Failure Handling

If a sub-agent produces no output, clearly shallow output (fewer than 2 findings for a domain with 5+ sub-agents), or output where the Shallow Finding Detector triggers on more than 50% of findings:

1. Retry the sub-agent with an explicit instruction: "Your previous output was insufficient. Deepen your analysis by reading specific code paths, citing line numbers, and performing web research."
2. If the retry also produces shallow output, flag the domain as "Needs Manual Review" in the Executive Dashboard and proceed. Do not fabricate findings to fill the gap.

### Synthesis Quality Standard

Each tier synthesis (`.audit-workspace/D{N}-synthesis.md`) must meet these requirements:

- **Critical and High findings:** Preserve verbatim with full file references, severity, and recommendations. Do not summarize — these drive Wave 1 and Wave 2 execution.
- **Medium findings:** Summarize with file references and 1-sentence description each. Preserve the recommendation.
- **Low and Info findings:** List by count per domain with a 1-sentence theme summary.
- **Synthesis confidence:** Include a self-rating (high/medium/low) indicating the orchestrator's confidence that the synthesis accurately represents the sub-agents' findings.
- **Key Findings for Downstream Domains:** Include per the Result Management Protocol item 5.

### Cross-Domain Discovery

After Tier C synthesis completes (before launching Tier D):

1. Review all tier syntheses for findings that span 3+ domains with a shared theme.
2. Look for contradictions between domain findings (e.g., D1 says error handling is robust, D8 says recovery patterns are missing).
3. Identify emergent issues from component interactions that no single domain would catch.
4. Produce a structured "Cross-Domain Findings" section for the final report.

### Report Assembly

When assembling the final report from synthesis files:

1. **Completeness:** Verify every domain has a synthesis file. Flag any missing domains.
2. **Consistency:** Scan for contradictions between domain findings. If two domains conflict on the same file or feature, preserve both findings with a cross-reference note and escalate to the Cross-Domain Analysis section.
3. **Coherence:** Read the assembled report end-to-end. The narrative should tell a coherent story about the framework's health, not just list disconnected findings.
4. **Deduplication:** Apply the Deduplication Protocol across the full assembled report, not just within individual domains.

---

## Output Format

The final audit report MUST use 3-tier progressive disclosure for maximum utility across audiences.

---

### Tier 1: Executive Dashboard

> Template: see `governance/audit/templates/report-format.md`

Includes: Holistic Assessment (3-5 sentence subjective quality impression) and Domain Heatmap (score + finding counts per domain).

---

### Tier 2: Domain Summaries

For each domain: Health Score (X/100), Finding Count by severity, Top 3 Findings (`[Severity] Finding — recommendation (Effort)`), Key Recommendation (1 sentence).

---

### Tier 3: Domain Detail

**Tier 3 is mandatory. Do not skip.**

For each domain, produce the full finding table: `#`, `Severity`, `Area`, `Finding`, `Recommendation`, `Effort`. Every row must have a corresponding row in Enhanced Action Items (and vice versa).

---

### Cross-Domain Analysis

Findings spanning multiple domains: `#`, `Finding`, `Domains`, `Primary Domain`, `Severity`, `Recommendation`.

---

### Competitive Positioning Matrix

`Capability`, `hatch3r`, `Competitor A`, `Competitor B`, etc.

---

### Enhanced Action Items

> Template: see `governance/audit/templates/report-format.md`

---

### Distribution Verdict

Recommendation on: open-source vs private npm, marketplace strategy, timing, licensing, community building.

---

### Delta Since Previous Audit

> Template: see `governance/audit/templates/report-format.md`

---

### Closed-Loop Analysis

Append three tables produced by the Post-Audit Closed-Loop Phases:
1. **PRD Evolution Candidates** — from Phase CL-1
2. **Content Gap Artifacts** — from Phase CL-2
3. **Audit Self-Evolution Proposals** — from Phase CL-3

These sections are informational. They do not affect domain scores or the distribution verdict.

---

## Post-Audit Closed-Loop Phases

These phases run after report assembly. They produce structured output appended to the audit report. They are identification-only — no files are modified. The execution companion (AUDIT-EXECUTE.md) acts on the output.

### Phase CL-1: PRD Evolution Identification

**Trigger:** Audit findings suggest product direction changes.
**Inputs:** Findings tagged with PRD impact, current `governance/hatch3r-prd.md`.
**Output table:** | Candidate | Domain | Finding | PRD Section | Change Type | Priority |
**Constraints:** Identification only — no modifications. Flag items needing Vision Review.
**Process detail:** See `governance/audit/templates/closed-loop-agents.md` Phase 5 agent.

### Phase CL-2: Content Gap Identification

**Trigger:** Audit reveals missing or inadequate content artifacts.
**Inputs:** Findings identifying content gaps, verified artifact inventory.
**Output table:** | Artifact | Type | Gap Description | Priority (P1/P2/P3) | Depends On |
**Priority tiers:** P1 = full spec (blocks user success), P2 = outline spec (improves quality), P3 = list only (nice-to-have).
**Constraints:** Specs only — no content implementation. Follow existing conventions and frontmatter patterns.
**Process detail:** See `governance/audit/templates/closed-loop-agents.md` Phase 6 agent.

### Phase CL-3: Audit Self-Evolution Identification

**Trigger:** Audit process itself has improvement opportunities.
**Inputs:** Audit execution observations, cross-domain patterns.
**Output table:** | Proposal | Category | Current State | Proposed Change | Rationale | Risk |

**Categories:** (1) New/modified domain scope, (2) Sub-agent count changes, (3) Checklist refinements, (4) Scoring methodology adjustments, (5) Process improvements.

**Constraints:**
- Maximum 10 proposals per cycle
- Per-proposal user consent required (never batch-approve)
- Weight changes must preserve tier totals (A=0.308, B=0.348, C=0.266, D=0.078)
- Never remove domains without replacement
- Sub-agent count changes require corresponding domain file updates
**Process detail:** See `governance/audit/templates/closed-loop-agents.md` Phase 7 agent.

---

## Audit History

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| — | — | — | — | — |
