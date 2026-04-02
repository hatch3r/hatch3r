# hatch3r — Constitution

> Established: 2026-03-25
> This document captures the foundational decisions, quality principles, and design rationale for the hatch3r framework governance system. It is the "why behind the why" — VISION.md defines what we aspire to, the PRD defines how we build it, and this Constitution defines why we made these choices.

---

## 1. Framework Identity

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository. It solves the "great agent setups don't travel well" problem — agentic coding configurations are hard to extract, hard to reuse across tools, prone to drift, unsafe by default, not updatable, not delegatable, and not learnable.

The solution: a canonical source model (`/.agents/`) that generates native configuration for 15 AI coding platforms via adapters. One source of truth, many outputs. Weekly-audited and continuously improved through a closed-loop governance system.

The framework is for everyone: solo developers to enterprise teams, any software type (web, API, CLI, mobile, infra), any maturity level (MVP to enterprise-grade). Generic content with customization for specifics.

This is not about commercialization. The focus is building the ideal framework — marketplace and distribution follow from getting the framework right.

---

## 2. Quality Philosophy

### 2.1 The North Star: One-Shot Success Rate

The #1 quality metric is **one-shot success rate and post-implementation quality**. Every content change, every audit finding, every architectural decision is evaluated against: "Does this make first-attempt success more likely?"

**Why this metric:** In agentic software engineering, the cost of failure is measured in revision cycles. Each failed attempt costs tokens, time, and human attention. A framework that enables agents to get it right the first time delivers exponentially more value than one that requires multiple iterations.

**The known gap:** Small-to-mid tasks should one-shot. Larger features (reusable components, styling consistency, i18n keys, complex cross-file wiring, edge cases) are harder — partly model limitations, partly content optimization opportunity. The framework continuously optimizes for these cases through the weekly audit cycle but acknowledges this boundary honestly.

**The revision loop as safety net:** The human-tests-as-user, feedback, agent-fixes loop works well. It should be optimized (fewer cycles needed, each cycle faster and more effective) but not fundamentally rethought. This is a design decision: invest in one-shot quality first, revision efficiency second.

### 2.2 Senior Engineer Quality with Outside-In View

The quality standard is: output that a senior engineer would approve in code review. Not just "works correctly" but: correct, well-structured, considers edge cases, maintainable, and approaching the problem from the user's perspective outward (outside-in), not from the code's perspective inward.

**Why outside-in:** Most agentic output fails at the UX/user boundary, not at the code boundary. An agent can write syntactically perfect code that solves the wrong problem or creates a confusing user experience. The outside-in perspective catches this class of error.

### 2.3 Up-to-Date Information Principle

Agents must ALWAYS ground their work in current information via web search, Context7 MCP, or equivalent. Never rely solely on training data for technical decisions.

**Why this is a general principle, not a per-skill feature:** Training data is stale by definition. Libraries change APIs, frameworks deprecate features, best practices evolve, security vulnerabilities are discovered. An agent relying on 6-month-old training data about a React API that was deprecated 3 months ago will produce confidently wrong code. The tooling hierarchy (project specs > codebase > Context7 > web research) ensures agents use the most current, most relevant information available.

---

## 3. The Closed Loop

### 3.1 Weekly Cadence

```
Vision --> PRD --> Build --> Audit --> Execute Findings --> Update PRD --> repeat
                                           |
                              Content Gap Identification
                                           |
                              Audit Self-Evolution (with user consent)
                                           |
                              Learning System (compounds over time)
```

**Why weekly:** Fast enough to stay current with the rapidly evolving AI coding landscape (new platform features, competitor moves, emerging standards). Slow enough to allow meaningful implementation between cycles. The audit (19 domains, 107 sub-agents) and execution (4-wave with regression gates) need approximately one week to complete.

### 3.2 Three Post-Audit Phases (Identification)

These phases run after the audit report is assembled. They IDENTIFY — they do not modify files. The execution companion (AUDIT-EXECUTE.md) acts on their output.

**Phase CL-1: PRD Evolution Identification**
- Extracts PRD-relevant findings from competitive gaps (D17), coverage gaps (D16.2), user journey issues (D19), alignment issues (D18.1), and adapter findings (D9)
- Produces a PRD Evolution Candidates table
- Changes contradicting VISION.md are flagged "Requires Vision Review"
- **Why:** Without this, audit findings that reveal strategic gaps (a competitor shipped something we don't have, a user workflow has no supporting content) sit in the report and are never acted upon. CL-1 converts findings into PRD requirements.

**Phase CL-2: Content Gap Identification**
- Extracts gaps from D16.2: missing agents, skills, rules, commands, prompts
- Produces a Content Gap Artifacts table with type, name, priority (P1/P2/P3), and complexity
- **Why:** Without this, content gaps are identified but never systematically addressed. CL-2 ensures every gap gets a structured specification that the next cycle can implement.

**Phase CL-3: Audit Self-Evolution Identification**
- Evaluates: new domain candidates, domain hardening, scoring weight adjustments, sub-agent count changes, quality gate adjustments
- Maximum 10 proposals per cycle (prevents bloating)
- Requires explicit user consent per proposal
- Never proposes removing a domain
- **Why:** An audit system that doesn't improve itself becomes stale. But an audit system that changes without oversight becomes unreliable. CL-3 balances evolution with control.

### 3.3 Three Post-Execution Phases (Action)

These phases run after all execution waves complete and the final reviewer issues a verdict.

**Phase 5: PRD Update**
- Applies approved PRD Evolution Candidates
- Filters out candidates tied to failed/rolled-back findings
- Presents to user for batch approval (individual override for VISION.md conflicts)
- Commits separately from wave commits
- **Why:** Separating PRD updates from code fixes ensures the PRD evolves based on validated outcomes, not speculative recommendations.

**Phase 6: Content Generation Planning**
- Produces structured specifications for content gaps
- P1: full spec. P2: outline. P3: listed only
- Writes to ephemeral `.audit-workspace/content-specs/`
- Does NOT implement content — specifications only
- **Why:** Creating content requires careful design. Specifications bridge the gap between "this is missing" and "here's exactly what to build." The next cycle implements from specs.

**Phase 7: Audit Prompt Evolution**
- Applies accepted proposals from CL-3
- Per-proposal user consent (no batch approval)
- Invariant checks: tier weights sum to 1.00, sub-agent counts match, domain files exist
- Guardrail 3 suspended ONLY for this phase
- **Why:** The audit modifying itself is the highest-risk operation. Per-proposal consent and invariant checks prevent unintended cascading changes.

---

## 4. Audit Quality Architecture (3 Layers, 29 Concepts)

These concepts were identified through systematic analysis of the audit system's ability to produce senior-expert-quality results. Layer 1 covers audit system mechanics (16 gaps), Layer 2 addresses senior human parity (5 traits), and Layer 3 ensures content quality mirroring (8 standards). Each represents a failure mode that could cause the audit to miss real issues or produce superficial findings.

### Layer 1: Audit System Mechanics

| # | Gap | Solution | Rationale |
|---|-----|----------|-----------|
| 1 | **Behavioral Traits** — sub-agents lack directives on HOW to think | Sub-Agent Behavioral Charter: 10 directives (neutrality, adversarial thinking, root-cause orientation, intellectual honesty, independence, inventiveness, severity discipline, constructive realism, challenge the premise, holistic awareness) | Checklists define WHAT to check; the charter defines the MINDSET. Without behavioral directives, sub-agents default to surface-level checklist completion rather than deep, creative analysis. |
| 2 | **Synthesis Quality** — no guidance on tier-transition summaries | Orchestrator Quality Guidance: preserve Critical/High verbatim, summarize Medium with file refs, list Low by count, include synthesis confidence rating | Information loss between tiers means later sub-agents operate on incomplete data. The synthesis standard ensures critical details survive compression. |
| 3 | **Fix-to-Finding Verification** — regression gate checks breakage, not correctness of fix | 7th regression gate check (Fix-Finding Alignment) + reviewer Pass 1.5 | A fix that passes tests but doesn't address the specific finding is a false resolution. Without this check, the framework could show improving scores while actual issues persist. |
| 4 | **Cross-Domain Discovery** — no structured process for emergent issues | Dedicated post-Tier-C cross-domain analysis pass | Issues that span 3+ domains (e.g., an error handling problem that affects code quality, orchestration, AND user experience) fall through domain-siloed analysis. |
| 5 | **Scoring Calibration** — formula untethered to real outcomes | Calibration Check: compare formula scores against orchestrator's holistic assessment, flag >10-point divergences | A domain could score 90 (formula) while the orchestrator knows it's fragile. Without calibration, scores become meaningless numbers disconnected from actual quality. |
| 6 | **Audit Reproducibility** — LLM variance unacknowledged | Reproducibility note: Critical findings must be re-verifiable, variance tracked in Delta section | Two audit runs on the same code yielding different Critical findings is a trust problem. Acknowledging non-determinism and requiring re-verifiability for Critical findings manages this. |
| 7 | **False Positive Tracking** — no feedback on finding accuracy | Registry `false_positive` field + 15% threshold for CL-3 proposals | Without tracking false positives, the audit may consistently flag non-issues, wasting execution resources and eroding trust. |
| 8 | **Diminishing Returns** — equal resources on mature vs struggling domains | Adaptive Resource Allocation: 95+ domains reduced (min 2 sub-agents), freed resources to domains below 80 | A domain scoring 97 for three consecutive cycles doesn't need the same scrutiny as one scoring 72. Adaptive allocation maximizes audit value. |
| 9 | **Context Propagation** — information loss between tiers | "Key Findings for Downstream Domains" section in synthesis + cross-tier retrieval mechanism | A D1 finding about error handling patterns may be critical context for D8 (Error Recovery). Without propagation, later tiers audit in partial blindness. |
| 10 | **Git History as Evidence** — design decisions misread as bugs | Universal Checklist bullet: check `git blame` before flagging | A function that looks wrong may have an intentional rationale in its commit history. Without checking, the audit wastes cycles on false findings. |
| 11 | **Orchestrator Quality** — the orchestrator is underprompted | Full Orchestrator Quality Guidance section: failure handling, synthesis standards, cross-domain discovery, report assembly | The orchestrator manages 107 sub-agents and is the most critical agent in the system, yet it had the least guidance. |
| 12 | **Content Interaction Testing** — components tested in isolation | D16.1 checklist items: agent + rule + skill composition testing, MCP dependency testing | Real-world failures happen when 15 rules + a skill + shared context are loaded simultaneously and contradict each other. Testing each artifact in isolation misses these emergent conflicts. |
| 13 | **Negative Testing of Content** — only positive scenarios tested | D05 Universal Checklist: negative scenario testing for all content types | Content that works when prerequisites are present may fail catastrophically when they're absent. Without negative testing, edge cases in content are invisible. |
| 14 | **Domain File Quality Standard** — quality varies across domains | Minimum 4 items per sub-agent, scenario-based, file references required | Some domains had 30+ specific checklist items while others had vague 4-item lists. Inconsistent domain quality produces inconsistent audit depth. |
| 15 | **Execution Learning** — fix failure patterns not tracked | Execution Learning section with cross-cycle JSON output | The same types of fixes failing repeatedly across cycles indicates a systemic issue. Without learning, the execution system repeats the same mistakes. |
| 16 | **Measurable Criteria** — qualitative findings can't be verified | Universal Checklist bullet: measurable acceptance criteria where possible | "Improve error handling" is unfalsifiable. "Error messages include file path in 100% of CLI errors" is measurable and verifiable. |

### Layer 2: Senior Human Parity

| # | Trait | Solution | Rationale |
|---|-------|----------|-----------|
| A | **Challenge the Premise** — audit assumes architecture is correct | Behavioral Charter directive #9: "Is this the right approach, or is there a fundamentally better way?" | Senior engineers don't just evaluate execution quality — they question whether the design itself is optimal. Without this, the audit optimizes local decisions while missing globally better alternatives. |
| B | **Multi-Stakeholder Perspective** — single-domain lens per sub-agent | Universal Checklist bullet: impact on end user, developer, team lead, ops team | Senior engineers simultaneously consider multiple stakeholders. Without this directive, findings optimize for one audience at the expense of others. |
| C | **Pattern Recognition** — no accumulated cross-project experience | Execution Learning (compounds over cycles) + CL-3 evolution | True "lived experience" is time-dependent — it accumulates over audit cycles as the learning system captures patterns. This is the closest achievable approximation. |
| D | **Holistic Quality Judgment** — formula scores, no gestalt impression | Holistic Assessment section in Executive Dashboard: orchestrator's subjective quality impression | A framework can score 92 and still "feel fragile." Senior engineers have this instinct. The Holistic Assessment captures it as a calibration signal. |
| E | **Simulated Execution** — audit reads but never runs | D05 simulated LLM execution for commands + D19 simulated end-to-end walkthrough | Senior QA engineers don't just read code — they use the product. Mentally simulating LLM execution catches issues that code review alone misses. |

### Layer 3: Content Mirroring

The same quality concepts that govern the audit system must be reflected in the framework's content — the agents, skills, rules, and commands that end users interact with.

**The bridge:** `agents/shared/quality-charter.md` defines 7 behavioral standards for end-user agents. D05's Content Quality Principles checklist verifies content against these standards during each audit cycle.

**Why mirroring matters:** An audit that finds and fixes problems is valuable. But content that embodies quality principles from the start — agents that express confidence, question assumptions, use current information, consider multiple stakeholders — produces better results even before the audit catches any issues. The audit then becomes a verification mechanism rather than a discovery mechanism.

| Concept | Audit System | Content Standard | Verification |
|---------|-------------|-----------------|--------------|
| Behavioral traits | Behavioral Charter (10 directives) | Quality Charter (7 standards) | D05 Content Quality Principles |
| Root-cause orientation | Charter #3 | Quality Charter #4 | D05 checklist |
| Confidence expression | Charter #4 | Quality Charter #1 | D05 + D13 checklists |
| Up-to-date information | Web research mandate | Quality Charter #2 | D05 checklist |
| Multi-stakeholder | Universal Checklist | Quality Charter #5 | D05 checklist |
| Challenge assumptions | Charter #9 | Quality Charter #3 | D07 + D13 checklists |
| Measurable criteria | Universal Checklist | Quality Charter #7 | D05 checklist |
| Graceful failure | (Negative testing in D05) | Quality Charter #6 | D05 + D16 checklists |

---

## 5. Behavioral Standards

### 5.1 Audit Sub-Agent Behavioral Charter (10 Directives)

These govern HOW audit sub-agents think, not just WHAT they check. Located in AUDIT.md after the Universal Audit Checklist.

1. **Neutrality** — Don't favor findings that inflate your domain's importance. Don't confirm previous audit conclusions without re-verifying independently.
2. **Adversarial thinking** — Think like an attacker (D15), a confused first-time user (D19), a fatigued developer copy-pasting (D5). Ask "how could this fail in practice?"
3. **Root-cause orientation** — Report root causes, not symptoms.
4. **Intellectual honesty** — Rate confidence (high/medium/low) on each finding. Use "Inconclusive Areas" when genuinely uncertain.
5. **Independence from framing** — The framework describing itself as "battle-tested" is marketing, not evidence. Verify independently. Don't anchor on previous audit findings.
6. **Inventiveness** — After the checklist, ask "what did the checklist miss?" Spend 20% of effort on beyond-checklist exploration.
7. **Severity discipline** — When in doubt, classify conservatively (lower).
8. **Constructive realism** — Recommendations must be implementable within the framework's actual constraints.
9. **Challenge the premise** — At least once per domain, ask: "Is this the right approach, or is there a fundamentally better way?"
10. **Holistic awareness** — Consider how your findings interact with other domains. Flag cross-cutting concerns explicitly.

### 5.2 Shared Agent Quality Charter (7 Standards)

These govern how end-user agents behave. Located in `agents/shared/quality-charter.md`. Verified by D05's Content Quality Principles checklist.

1. **Express confidence levels** — High (verified against current code and documentation), Medium (pattern-based but not fully verified against the specific code path), Low (best professional judgment, recommend human review).
2. **Use current information first** — Tooling hierarchy: project specs and documentation > codebase search > Context7 MCP for library docs > web research for broader context.
3. **Question unclear requirements** — Ask before building the wrong thing. Frame challenges constructively.
4. **Report root causes** — Symptoms are not findings. Report both the symptom (what you observed) and the root cause (why it exists).
5. **Consider multiple stakeholders** — End user, maintaining developer, team lead, ops team. When interests conflict, note the tradeoff explicitly.
6. **Fail gracefully** — Clear error messages, never fail silently. Provide recovery guidance.
7. **Include measurable criteria** — Quantifiable acceptance criteria where possible. When a recommendation cannot be quantified, provide a concrete before/after example instead.

---

## 6. Content Maintenance Model

Content is ONLY maintained through:
1. The weekly audit cycle (audit finds issues, execute fixes them)
2. In-between agentic work triggered by the framework owner

Maximum end quality is the only metric that matters. There are 7 content types: agents, commands, prompts, rules, skills, hooks, and github-agents. Every content artifact must be auditable, versionable, and improvable through the audit cycle.

**Why no community content contributions to quality:** The quality bar is too precise for crowd-sourced improvements. Community packs (additive content) are welcome; community corrections to core content quality are handled through audit findings.

**Why the audit-first approach to content fixes:** Rather than manually editing 137+ content artifacts when quality issues are found, the design philosophy is to update the audit checklists to FIND issues, then let the audit-execute cycle fix them. Manually editing content is one-time and error-prone. Improving the audit's ability to find issues is permanent and self-reinforcing — every future cycle benefits. This is the difference between fixing a bug and fixing the process that creates bugs.

---

## 7. Platform Strategy

All 15 adapters are equally supported — no first-class vs second-class platforms. Platform changes (new features, API changes, deprecations) are adapted within the weekly audit cycle.

**Supported platforms:** Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity.

**Why equal parity:** The framework's core value proposition is tool-agnostic agent setup. If adapter quality varies, users of "lesser" tools get worse results, undermining the premise. D9 (Platform Adapters) audits all 15 with dedicated sub-agents per adapter — 15 per-adapter sub-agents plus a capability matrix verification sub-agent and an emerging platforms sub-agent (17 total).

**Capability gap transparency:** Platforms have different native capabilities. Not every platform can express every feature in the canonical source. The framework tracks and documents these capability gaps rather than hiding them. Users of any platform know exactly what they get and what their platform cannot express.

---

## 8. Key Design Decisions

### 8.1 RE-ENVISION.md is a prompt, not a command
**Decision:** RE-ENVISION.md lives in `governance/` alongside AUDIT.md, not in `commands/`.
**Why:** It's for framework owners, not end users. Making it a command would include it in user content profiles, add to artifact counts, and imply end users should run it. It's a governance tool, not a development tool.

### 8.2 VISION.md is committed (public), PRD is gitignored
**Decision:** VISION.md is committed to the repository. The PRD (`hatch3r-prd.md`) and competitive analysis (`COMPETITIVE-ANALYSIS.md`) are gitignored. The audit report (`AUDIT-REPORT.md`) is also gitignored.
**Why:** The vision is stable and aspirational — written for everyone (owner, contributors, users). The PRD contains competitive analysis, internal detail, and evolves rapidly through audit cycles. The competitive analysis contains market intelligence. The audit report contains internal quality findings. These are internal documents, not public-facing. Committing them would expose strategic detail and create noise in the git history from weekly audit-driven updates.

### 8.3 Identification vs Action separation (CL-1/2/3 vs Phases 5-7)
**Decision:** AUDIT.md identifies issues (CL-1/2/3 produce tables). AUDIT-EXECUTE.md acts on them (Phases 5-7 apply changes).
**Why:** Clean separation of concerns. The audit should never modify files — it is a read-only analysis tool. All modifications go through the execution companion with its regression gates, rollback protocols, and user consent mechanisms. This means the audit can be run freely without fear of side effects, and execution can be run selectively against specific findings.

### 8.4 Per-proposal consent for audit evolution
**Decision:** Phase 7 (Audit Prompt Evolution) requires individual user consent for each proposal. No batch approval.
**Why:** The audit modifying itself is the highest-risk operation in the system. A bad batch approval could add irrelevant domains, break scoring weights, or dilute audit focus. Per-proposal consent ensures every change is deliberate. This is explicitly different from Phase 5 (PRD Update), which allows batch approval because PRD changes are lower-risk and more numerous.

### 8.5 Content fixes flow through the audit cycle, not manual edits
**Decision:** Rather than manually editing 137+ content artifacts, update the audit checklists to FIND issues, then let the audit-execute cycle fix them.
**Why:** Manually editing content is one-time and error-prone. Improving the audit's ability to find issues is permanent and self-reinforcing — every future cycle benefits. This is the difference between fixing a bug and fixing the process that creates bugs.

### 8.6 Two separate behavioral charters (audit + content)
**Decision:** The audit Behavioral Charter (10 directives in AUDIT.md) and the shared Quality Charter (7 standards in `agents/shared/quality-charter.md`) are separate documents.
**Why:** They serve different audiences with different operational contexts. The audit charter governs meta-analysis behavior (neutrality, severity discipline, inventiveness). The quality charter governs runtime agent behavior (confidence expression, graceful failure, requirement questioning). Merging them would conflate two distinct roles.

### 8.7 Wave-based execution with regression gates
**Decision:** Findings are executed in 4 waves (Critical, High, Medium, Low), each gated by a 7-check regression gate comparing against an immutable Phase 0 baseline.
**Why:** Severity-ordered execution ensures the most impactful issues are resolved first. If later waves introduce regressions, the high-value fixes from earlier waves are already committed and safe. The immutable baseline prevents "baseline shifting" where each wave's regressions become the new normal. The 7th gate check (Fix-Finding Alignment) ensures fixes actually address their findings rather than merely passing tests.

### 8.8 Finding Registry as single source of truth
**Decision:** A central `finding-registry.json` tracks every finding through its lifecycle from triage through execution, review, and closed-loop phases.
**Why:** Without a structured registry, finding status is scattered across the audit report, git history, and human memory. The registry provides: full traceability (every finding has one entry), deduplication tracking (merge decisions are recorded), execution status (what was done, what failed, what was rolled back), and cross-phase linkage (a finding's impact on the PRD, content specs, and audit evolution are recorded in one place).

### 8.9 Governance directory consolidation
**Decision:** All governance documents live in `governance/`, not the project root.
**Why:** These documents govern how the framework is maintained and evolved. They are not user-facing content (that's in `agents/`, `commands/`, etc.), not framework source code (that's in `src/`), and not project documentation (that's in `website/docs/`). A dedicated governance folder clarifies their role and keeps the project root clean. The `governance/audit/` subdirectory further separates domain definitions and templates from the top-level governance prompts.

### 8.10 Workspace features integrated into existing commands
**Decision:** Workspace capabilities are integrated into existing CLI commands (`init`, `sync`, `config`, `status`) rather than exposed as a separate `workspace` command group.
**Why:** Users think in terms of actions (initialize, sync, configure) not concepts (workspace). Adding a separate command group would fragment the mental model and force users to learn when to use `hatch3r init` vs `hatch3r workspace init`. The existing commands already cover the relevant actions — workspace support is a capability, not a command.

---

## 9. Governance File Structure

```
governance/
  CONSTITUTION.md          <-- This file (why we made these choices)
  VISION.md                <-- North star (what we aspire to)
  RE-ENVISION.md           <-- Vision capture prompt (how to update the vision)
  hatch3r-prd.md           <-- Product requirements (how and when) [gitignored]
  COMPETITIVE-ANALYSIS.md  <-- Market context [gitignored]
  AUDIT.md                 <-- Audit prompt (19 domains, 107 sub-agents)
  AUDIT-EXECUTE.md         <-- Execution companion (wave-based, regression-gated)
  AUDIT-REPORT.md          <-- Latest audit results [gitignored]
  audit/
    domains/               <-- 19 domain definition files (D01-D19)
    templates/             <-- Sub-agent templates (implementation, reviewer, closed-loop)
    baseline.json          <-- Audit baseline metrics
    finding-registry.json  <-- Finding lifecycle tracking
```

**Why `governance/`:** These documents govern how the framework is maintained and evolved. They are not user-facing content (that's in `agents/`, `commands/`, etc.), not framework source code (that's in `src/`), and not project documentation (that's in `website/docs/`). A dedicated governance folder clarifies their role and keeps the project root clean.

**Why three gitignored files:** The PRD, competitive analysis, and audit report contain internal operational detail that changes frequently and would create noise in the public git history. The vision, constitution, audit prompt, and execution prompt are stable governance documents that benefit from version control and public visibility.

**Why domain files are separate from AUDIT.md:** Each domain's scope, sub-agent decomposition, and checklist items are substantial enough to warrant their own file. Keeping them in AUDIT.md would make it unmanageably large. Separate files also enable CL-3 (Audit Self-Evolution) to modify individual domains without touching the core audit prompt.

---

*This Constitution is a living document. It evolves when the RE-ENVISION prompt captures new vision decisions, when audit cycles reveal new design principles, or when the framework's strategic direction shifts. Changes should be documented with date and rationale.*
