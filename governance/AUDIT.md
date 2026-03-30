# hatch3r — Full Framework Audit Prompt

## Purpose

Perform a deep, end-to-end audit of every area, aspect, and line of code or content in the hatch3r framework. The goal is to ensure this framework is production-ready, open-sourceable, and excels in every capability compared to the current market — enabling end users to build winning software products at scale.

This audit covers **19 domains** organized across **4 tiers**, deploying **107 sub-agents** for maximum depth. Every domain requires web research for current market context. The final deliverable is a structured audit report with severity-tagged findings, weighted domain scores, and prioritized action items using 3-tier progressive disclosure.

> **Path Convention:** All file paths in this document are relative to the **repository root**. Governance files live under `governance/`. The ephemeral `.audit-workspace/` directory is created at repository root.

---

## Framework Context

hatch3r is an open-source CLI (`npx hatch3r init`) and Cursor plugin that installs a tool-agnostic agentic coding setup into any repository. It uses a canonical source model (`/.agents/`) and generates tool-specific configurations via adapters.

### Architecture

```
/.agents/                    <- Canonical source (tool-agnostic)
  ├── agents/                <- Agent definitions
  ├── skills/                <- Skill workflows (*/SKILL.md)
  ├── rules/                 <- Coding standards, conventions
  ├── commands/              <- Slash-command workflows
  ├── prompts/               <- Reusable prompt templates
  ├── hooks/                 <- Event-triggered automation
  ├── checks/                <- Review criteria
  ├── mcp/mcp.json           <- MCP server configuration
  ├── policy/                <- Guardrails and deny lists
  ├── learnings/             <- Project learnings
  ├── AGENTS.md              <- Canonical orchestration reference
  └── hatch.json             <- Manifest

Adapters generate tool-specific output:
  .cursor/          <- Cursor       .github/         <- Copilot
  CLAUDE.md         <- Claude Code  GEMINI.md        <- Gemini CLI
  .windsurfrules    <- Windsurf     .amp/            <- Amp
  AGENTS.md         <- OpenCode     .codex/          <- Codex CLI
  .roo/ .roomodes   <- Cline        .aider/          <- Aider
  .kiro/            <- Kiro         .goosehints      <- Goose
  .rules            <- Zed          .amazonq/        <- Amazon Q
```

### Component Inventory (verify counts during audit)

| Category | Directory | Count |
|----------|-----------|-------|
| Agents | `agents/` | 16 |
| Rules | `rules/` | 22 .md + 22 .mdc = 44 files |
| Commands | `commands/` | 34 |
| Skills | `skills/` | 25 directories |
| Hooks | `hooks/` | 6 |
| Prompts | `prompts/` | 3 |
| Checks | `checks/` | 5 |
| GitHub Agents | `github-agents/` | 4 |
| **Total Content Artifacts** | | **137** |
| Adapters | `src/adapters/` | 14 tool adapters (20 files total) |
| CLI Commands | `src/cli/commands/` | 9 (add, config, init, status, sync, update, validate, verify, worktreeSetup) |
| Content System | `src/content/` | 3 files (index.ts 686 LOC, tags.ts 91 LOC, presets.ts 48 LOC) = 825 LOC |
| Workspace | `src/workspace/` | 6 files (763 LOC) |
| Worktree | `src/worktree/` | 3 files (500 LOC) |
| Integrity | `src/integrity/` | 1 file |
| Archive | `src/archive/` | 1 file (index.ts, 263 LOC) |
| TypeScript Source | `src/` | 61 files (excluding tests) |
| Test Files | `src/__tests__/` | 47 test files |
| CI Workflows | `.github/workflows/` | 4 workflows (ci, pr-checks, release, deploy-docs) |
| Website Docs | `website/docs/` | 25 files |

#### Dynamic Verification Protocol

The component inventory above is a reference snapshot. During audit execution, Tier A sub-agents MUST verify actual counts by scanning the filesystem:

1. **Before Tier A launches:** Count files in each directory listed above. Record actual counts.
2. **Discrepancy handling:** If actual counts differ from the table, use actual counts for all audit calculations. Flag the discrepancy as an Info finding in the relevant domain (D1 for content artifacts, D2 for adapters, D3 for tests, D4 for CI).
3. **New categories:** If directories exist that are not in the table (e.g., a new content type), flag as Info in D1 and include in the audit scope.
4. **Output:** Write verified inventory to `.audit-workspace/verified-inventory.json`. All subsequent sub-agents reference this file, not the static table.

### Orchestration Model

All tasks follow a four-phase sub-agent pipeline: (1) Research, (2) Implement, (3) Review Loop (max 3 iterations), (4) Final Quality (specialists).

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

Spawn **107 sub-agents** across 19 audit domains organized in 4 tiers. Each domain decomposes into multiple focused sub-agents for maximum depth. Sub-agents within the same domain run in parallel unless a sequential dependency is noted. Domain-level synthesis sub-agents run only after their prerequisite sub-agents complete. Inherit your LLM model to every sub-agent — do not downgrade. Each sub-agent MUST use web research. **Never optimize for token efficiency — optimize for audit quality and depth.**

### Dependency Graph

The following sub-agents have sequential dependencies and MUST NOT launch until their prerequisites complete:

| Sub-Agent | Depends On | Reason |
|-----------|-----------|--------|
| 9.15 (Capability Matrix Verification) | 9.1–9.14 | Requires all per-adapter audit findings |
| 9.16 (Emerging Platforms) | 9.1–9.14 | Requires understanding of current adapter landscape |
| 16.1 (One-Shot Success Analysis) | D5, D7 | Requires prompt quality and orchestration findings |
| 16.2 (Content Coverage Gap Analysis) | D5, D9 | Requires content and adapter findings |
| 16.3 (Prompt Consistency) | D5, D7 | Requires cross-artifact analysis |
| 16.4 (Regression & Maintenance) | D3, D4 | Requires test and CI findings |
| 17.3 (Market Positioning & Strategy) | 17.1, 17.2 | Requires competitor and ecosystem data |
| 18.1 (PRD Alignment) | D16, D17 | Requires compound system and competitive findings |
| 18.2 (Roadmap Reprioritization) | D16, D17 | Requires compound system and competitive findings |
| 16.5 (Closed-Loop Effectiveness) | D18 (prev cycle)* | Requires previous audit cycle's PRD/content/evolution outputs |
| 18.3 (Distribution Verdict) | 18.1, 18.2 | Requires PRD and roadmap analysis |

> \* **External data dependency:** 16.5 depends on the *previous* cycle's D18 output, not the current cycle's D18 execution. This is a data prerequisite (load previous cycle's report), not a current-cycle execution dependency. 16.5 launches in Tier C after 16.4 completes — it does not wait for current-cycle Tier D.

### Concurrency Model

Of the 107 total sub-agents, **96 launch immediately** in parallel. The remaining **11 sub-agents** launch sequentially after their dependencies complete:

| Tier | Sequential Sub-Agents |
|------|----------------------|
| B | 9.15, 9.16 |
| C | 16.1, 16.2, 16.3, 16.4, 16.5 |
| D | 17.3, 18.1, 18.2, 18.3 |

### Web Research Requirements

Every sub-agent MUST perform web research relevant to its domain:
- **Platform/adapter domains (D9, D17):** Current platform documentation, competitor features, market shifts
- **Security domains (D15):** Current OWASP guidelines, recent CVEs, MCP vulnerability reports
- **Code quality domains (D1, D3, D8):** Current best practices for the specific pattern being audited (e.g., safe write patterns, test isolation techniques)
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
| B | D5–D10 | 42 | Launch → synthesize → release from context |
| C | D11–D16, D19 | 32 | Launch → synthesize → release from context |
| D | D17–D18 | 6 | Launch → synthesize → final assembly |

Peak context: 42 sub-agent results (Tier B), not 107.

### Pre-Audit Questions

Before beginning, ask the user:
1. Is there a previous audit report to compare against? If so, where?
2. Are there specific areas of concern or priority for this audit cycle?

The following have sensible defaults. Ask only if context suggests the default is wrong:
3. Include gitignored PRD (`governance/hatch3r-prd.md`) and competitive analysis (`governance/COMPETITIVE-ANALYSIS.md`) if available locally? **Default: Yes**
4. Distribution model to evaluate? **Default: All (open-source npm, marketplace plugins, private npm)**
5. New tools/platforms to add to adapter coverage? **Default: None — sub-agent 9.16 will discover via web research**
6. Run closed-loop phases after audit assembly (PRD evolution, self-evolution, content gap identification)? **Default: Yes**

---

## Scoring Methodology

### Domain Weighting

| Tier | Domains | Weight Per Domain | Tier Total |
|------|---------|-------------------|------------|
| A — Foundational | D1–D4 | 0.077 | 0.308 |
| B — Quality | D5–D10 | 0.058 | 0.348 |
| C — System-Level | D11–D16, D19 | 0.038 | 0.266 |
| D — Strategic | D17–D18 | 0.039 | 0.078 |
| **Total** | | | **1.00** |

### Weighted Score Formula

```
Overall Score = SUM(domain_score[i] * weight[i]) for i in 1..19
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

The quality score formula is a heuristic — it measures problem absence, not actual quality. To prevent score drift from reality:

- After report assembly, the orchestrator compares each domain's formula score against its holistic assessment of that domain's actual quality.
- Flag any domain where the formula score and holistic impression diverge by more than 10 points. Include the divergence in the Executive Dashboard with a brief explanation.
- Over multiple cycles, persistent divergences should trigger CL-3 proposals to adjust the scoring formula weights.

### Severity Taxonomy

| Severity | Definition | Release Impact |
|----------|-----------|----------------|
| **Critical** | Blocks production release or creates security/correctness risk | Must resolve before any release |
| **High** | Significantly impacts quality, UX, or market competitiveness | Should resolve before release |
| **Medium** | Improvement opportunity with clear benefit | Can defer to next release |
| **Low** | Nice-to-have, polish item | Defer freely |
| **Info** | Observation, suggestion, or context for future consideration | No release impact |

### Effort Levels

| Level | Duration |
|-------|----------|
| **S** | < 2 hours |
| **M** | 2–8 hours |
| **L** | 1–3 days |
| **XL** | 1+ weeks |

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

- [ ] All 19 domains were thoroughly examined (no domain was skipped). Domains with zero findings must include a clean-domain justification citing: specific files examined, verification methods used, and web research performed. A clean domain is acceptable; a skipped domain is not.
- [ ] All 107 sub-agents produced output (no silent failures)
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

2. **Adversarial thinking** — Think like an attacker (D15), a confused first-time user (D19), a fatigued developer copy-pasting from a tutorial (D5). Ask "how could this realistically fail in practice?" not just "does this follow best practices?"

3. **Root-cause orientation** — Report root causes, not symptoms. "Missing error handling in function X" is a symptom; "no error strategy defined at the architecture level" is the root cause. If you can only identify the symptom, say so and rate confidence as medium.

4. **Intellectual honesty** — Rate your confidence on each finding: **high** (verified against code and documentation), **medium** (based on established patterns but not fully verified), **low** (best judgment, recommend human review). Use the "Inconclusive Areas" section when genuinely uncertain rather than forcing a finding.

5. **Independence from framing** — The framework describing itself as "battle-tested" or "proven" is marketing, not evidence. Verify claims independently. Do not anchor on previous audit findings, the PRD's self-description, or VISION.md's aspirational language.

6. **Inventiveness** — After completing the domain checklist, ask: "What did the checklist miss?" Dedicate approximately 20% of your analysis effort to beyond-checklist exploration — non-obvious failure modes, creative misuse scenarios, emergent issues from component interactions.

7. **Severity discipline** — When in doubt, classify conservatively (lower severity). A Medium finding misclassified as High wastes execution resources in an earlier wave. The Severity Taxonomy definitions are precise — match impact to definition, not the other way around.

8. **Constructive realism** — Recommendations must be implementable within the framework's actual constraints. hatch3r is a setup-time configuration generator, not a runtime agent executor. Recommending runtime monitoring for a tool that generates static files is not actionable.

9. **Challenge the premise** — At least once per domain, ask: "Is this the right approach, or is there a fundamentally better way?" Do not just evaluate execution quality — question whether the design itself is optimal. D7.1 (Pipeline Design) is the explicit home for architectural alternatives, but every domain should question its own assumptions.

10. **Holistic awareness** — Consider how your findings interact with other domains. A D1 finding about error handling patterns may affect D8 (Error Recovery) and D5 (Prompt Engineering). Flag cross-cutting concerns explicitly with domain references so the cross-domain analysis pass can synthesize them.

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
| B | 5: Prompt Engineering Quality | 7 | 7 | 0 |
| B | 6: Context Engineering & Token Economics | 4 | 4 | 0 |
| B | 7: Agent Orchestration Optimization | 5 | 5 | 0 |
| B | 8: Error Recovery & Resilience | 4 | 4 | 0 |
| B | 9: Platform Adapters | 16 | 14 | 2 (9.15, 9.16) |
| B | 10: Documentation & Developer Experience | 6 | 6 | 0 |
| C | 11: End-to-End Data Flow | 4 | 4 | 0 |
| C | 12: Agent Observability & Debuggability | 4 | 4 | 0 |
| C | 13: Human-AI Collaboration Quality | 4 | 4 | 0 |
| C | 14: Cross-Project Adaptability & Scalability | 4 | 4 | 0 |
| C | 15: Agentic Security & Trust Model | 6 | 6 | 0 |
| C | 16: Compound System Evaluation | 5 | 0 | 5 |
| C | 19: User Journey & Adoption Friction | 5 | 5 | 0 |
| D | 17: Competition & Market Intelligence | 3 | 2 | 1 (17.3) |
| D | 18: PRD, Roadmap & Distribution | 3 | 0 | 3 |
| **Total** | | **107** | **96** | **11** |

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

```
Audit Date: YYYY-MM-DD
Framework Version: (from package.json)
Previous Audit: (date or "N/A")
Auditor: (model name and version)
Domains Covered: 19/19
Sub-Agents Deployed: 107

Overall Score: XX/100 (Weighted)
Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]
Severity Ceiling Applied: [Yes/No — if any domain has unresolved Critical]

Top 3 Strengths:
1. ...
2. ...
3. ...

Top 3 Critical Issues:
1. ...
2. ...
3. ...

Competitive Positioning: (1 sentence)
Distribution Recommendation: (1 sentence)
```

#### Holistic Assessment

In 3-5 sentences, provide the orchestrator's subjective quality impression of the framework — independent of the formula score. What feels strong? What feels fragile? What is the overall craft quality and design coherence? Note specifically where the holistic impression diverges from the formula score and explain why. This section serves as a calibration signal for the scoring methodology.

#### Domain Heatmap

```
| Domain | Score | Critical | High | Medium | Low | Info |
|--------|-------|----------|------|--------|-----|------|
| D1: Core Source Implementation | XX | N | N | N | N | N |
| D2: Adapter Infrastructure | XX | N | N | N | N | N |
| D3: Test Infrastructure | XX | N | N | N | N | N |
| D4: Build, CI/CD & Dependencies | XX | N | N | N | N | N |
| D5: Prompt Engineering Quality | XX | N | N | N | N | N |
| D6: Context Engineering | XX | N | N | N | N | N |
| D7: Orchestration Optimization | XX | N | N | N | N | N |
| D8: Error Recovery & Resilience | XX | N | N | N | N | N |
| D9: Platform Adapters | XX | N | N | N | N | N |
| D10: Documentation & DevEx | XX | N | N | N | N | N |
| D11: End-to-End Data Flow | XX | N | N | N | N | N |
| D12: Observability | XX | N | N | N | N | N |
| D13: Human-AI Collaboration | XX | N | N | N | N | N |
| D14: Adaptability & Scalability | XX | N | N | N | N | N |
| D15: Agentic Security | XX | N | N | N | N | N |
| D16: Compound System | XX | N | N | N | N | N |
| D17: Competition & Market | XX | N | N | N | N | N |
| D18: PRD, Roadmap & Distribution | XX | N | N | N | N | N |
| D19: User Journey & Adoption | XX | N | N | N | N | N |
```

---

### Tier 2: Domain Summaries

For each of the 19 domains: Health Score (X/100), Finding Count by severity, Top 3 Findings (`[Severity] Finding — recommendation (Effort)`), Key Recommendation (1 sentence).

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

**This table MUST include every unique finding post-deduplication.** Do not curate, truncate, or limit to a "top N" subset. The execution prompt (`AUDIT-EXECUTE.md`) reads this table as the complete universe of findings.

Ordered by: Critical first, then High, Medium, Low. Within severity, order by impact-to-effort ratio (highest first).

Columns: `#`, `Domain`, `Action Item`, `Severity`, `Effort`, `Risk Score` (Impact x Likelihood x Reversibility, each 1-5), `Owner`, `Depends On`, `Status`.

**Status values:** `Open` (agent-actionable), `Open (human-only)`, `**Done**`, `Deferred (reason)`.

**Completeness check:** Total row count must equal the post-dedup finding count in the Executive Dashboard.

**Sections:** Blockers (Critical), Should-Have (High), Deferred (Medium/Low). Include: Estimated Total Effort, Recommended Sequence, Risk Assessment.

---

### Distribution Verdict

Recommendation on: open-source vs private npm, marketplace strategy, timing, licensing, community building.

---

### Delta Since Previous Audit

(If previous audit exists) New findings, resolved findings, regressed findings, score changes per domain.

---

### Closed-Loop Analysis (if Pre-Audit Question 6 = Yes)

Append three tables produced by the Post-Audit Closed-Loop Phases:
1. **PRD Evolution Candidates** — from Phase CL-1
2. **Content Gap Artifacts** — from Phase CL-2
3. **Audit Self-Evolution Proposals** — from Phase CL-3

These sections are informational. They do not affect domain scores or the distribution verdict.

---

## Post-Audit Closed-Loop Phases

These phases run after report assembly, gated by Pre-Audit Question 6. They produce structured output appended to the audit report. They are identification-only — no files are modified. The execution companion (AUDIT-EXECUTE.md) acts on the output.

### Phase CL-1: PRD Evolution Identification

**Trigger:** Pre-Audit Question 6 = Yes AND `governance/hatch3r-prd.md` is available.
**Input:** Assembled audit report (all tiers), `governance/hatch3r-prd.md`, `governance/VISION.md` (if available).
**Agent:** Single synthesis agent (not a sub-agent pool — this requires cross-domain reasoning).

#### Process

1. Extract PRD-relevant findings from:
   - D17 (competitive gaps): Features competitors offer that hatch3r does not → candidates for PRD feature additions
   - D16.2 (content coverage gaps): Uncovered workflows/tech stacks → candidates for PRD scope expansion
   - D19 (user journey issues): Adoption friction points → candidates for PRD UX requirement changes
   - D18.1 (PRD alignment): Implementation/spec gaps → candidates for PRD corrections
   - D9 (adapter findings): Platform changes → candidates for PRD adapter requirement updates

2. For each candidate, produce:
   - **PRD section affected** (by section number)
   - **Change type:** Addition / Modification / Removal / Reprioritization
   - **Proposed change** (specific text or description)
   - **Justification** (which finding(s) and evidence support this)
   - **VISION.md alignment** (does this change align with the north star? If not, flag as "Requires Vision Review")

3. Output format — append to audit report:

```
### PRD Evolution Candidates

| # | PRD Section | Change Type | Proposed Change | Justification | Vision Aligned |
|---|-------------|-------------|-----------------|---------------|----------------|
```

#### Constraints
- Do NOT modify `governance/hatch3r-prd.md` — only identify changes.
- Competitive features are candidates, not mandates. The user decides priority.
- Changes that contradict VISION.md must be flagged with "Requires Vision Review."

### Phase CL-2: Content Gap Identification

**Trigger:** Pre-Audit Question 6 = Yes.
**Input:** D16.2 findings (content coverage gap analysis), verified component inventory.
**Agent:** Single synthesis agent.

#### Process

1. From D16.2 findings, extract every identified gap:
   - Missing agents (workflow types with no supporting agent)
   - Missing skills (common tasks with no skill workflow)
   - Missing rules (conventions not codified)
   - Missing commands (actions users need but cannot invoke)
   - Missing prompts (reusable templates that would reduce duplication)

2. For each gap, produce:
   - **Content type:** Agent / Skill / Rule / Command / Prompt / Hook / Check
   - **Proposed name** (following `hatch3r-{name}` convention)
   - **Purpose** (1-2 sentences)
   - **Priority:** P1 (blocks common workflows) / P2 (improves coverage) / P3 (nice-to-have)
   - **Estimated complexity:** S / M / L
   - **Dependencies** (existing artifacts it would interact with)

3. Output format — append to audit report:

```
### Content Gap Artifacts

| # | Type | Proposed Name | Purpose | Priority | Complexity | Dependencies |
|---|------|---------------|---------|----------|------------|--------------|
```

#### Constraints
- Do NOT create content artifacts — only identify them.
- Names must follow existing conventions.
- Priority must be justified by specific D16.2 findings.

### Phase CL-3: Audit Self-Evolution Identification

**Trigger:** Pre-Audit Question 6 = Yes.
**Input:** Full audit execution experience (all domain results, quality gate outcomes, scoring anomalies).
**Agent:** Single meta-analysis agent.

**User consent is required before any self-evolution proposals are applied. This phase only identifies proposals — it does not modify AUDIT.md or domain files.**

#### Process

1. **New domain candidates:** Are there recurring cross-domain findings that suggest a dedicated domain? Threshold: 3+ findings spanning 3+ existing domains with a shared theme not covered by any single domain.

2. **Domain hardening candidates:** For each domain:
   - Were all checklist items exercised, or were some too vague to audit?
   - Were findings discovered that no checklist item covers?
   - Should checklist items be split into more specific checks?

3. **Scoring weight adjustment candidates:**
   - Did any domain's weight produce counterintuitive results?
   - Did the tier structure correctly reflect importance?

4. **Sub-agent count adjustment candidates:**
   - Were any sub-agents consistently producing zero findings (oversized scope)?
   - Were any sub-agents consistently producing 10+ findings (undersized scope)?

5. **Quality gate adjustment candidates:**
   - Were the expected finding count ranges accurate?
   - Were the shallow finding detector patterns effective?

6. For each proposal, produce:
   - **Target:** AUDIT.md section or domain file
   - **Change type:** Add domain / Add checklist item / Modify checklist item / Adjust weight / Adjust sub-agent count / Adjust quality gate
   - **Proposal** (specific text)
   - **Evidence** (what from this audit cycle triggered this)
   - **Risk** (what could go wrong if adopted)

7. Output format — append to audit report:

```
### Audit Self-Evolution Proposals

| # | Target | Change Type | Proposal | Evidence | Risk |
|---|--------|-------------|----------|----------|------|

**These proposals require explicit user consent before implementation. Present each proposal individually for yes/no decision.**
```

#### Constraints
- Maximum 10 proposals per audit cycle (prevents runaway evolution).
- New domains require user approval AND a full domain file specification.
- Weight adjustments must preserve tier total invariant (A=0.308, B=0.348, C=0.266, D=0.078, Total=1.00).
- Never propose removing a domain — only adding, splitting, or hardening.

---

## Audit History

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| — | — | — | — | — |
