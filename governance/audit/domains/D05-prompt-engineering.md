# Domain 5: Prompt Engineering Quality

> Last updated: 2026-04-19

**Pillars served:** P2 (primary), P4 (supporting).

**Scope:** ALL 137 content artifacts evaluated for prompt engineering quality, instruction clarity, and LLM execution reliability.
**Sub-agents:** 8

## Sub-Agent Decomposition

| SA | Focus | Artifact Count |
|----|-------|---------------|
| 5.1 | Pipeline Agents | 4 agents: researcher, implementer, reviewer, fixer |
| 5.2 | Specialist Agents | 8 agents: a11y-auditor, architect, ci-watcher, context-rules, dep-auditor, devops, docs-writer, lint-fixer |
| 5.3 | Meta Agents | 4 agents: perf-profiler, security-auditor, test-writer, learnings-loader |
| 5.4 | Rules | 22 .md + 22 .mdc = 44 files |
| 5.5 | Commands | 34 command files |
| 5.6 | Skills | 25 skill directories (SKILL.md each) |
| 5.7 | Supporting Artifacts | 5 checks + 6 hooks + 3 prompts + 4 github-agents = 18 files |
| 5.8 | Cross-Artifact Consistency | All 137 content artifacts (redistributed from D16) |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Universal Checklist (apply to ALL sub-agents)

- [ ] **One-shot success prediction** — Would an LLM execute this artifact correctly on the first attempt without clarification? Rate 1-5.
- [ ] **Instruction clarity scoring** — Are instructions unambiguous, sequenced logically, and free of contradictions? Rate 1-5.
- [ ] **Output format specification** — Is the expected output format explicitly defined, structured, and parseable?
- [ ] **Scope boundaries** — Clear what the artifact does and does NOT do? Are there implicit assumptions?
- [ ] **Cross-agent handoff contract analysis** — For pipeline agents: are handoff contracts between phases (researcher to implementer, reviewer to fixer) explicitly defined with data schemas?
- [ ] **Golden test case methodology** — Could you write a deterministic test case to verify this artifact produces correct output? If not, why?
- [ ] **Prompt drift detection** — Are there version markers or checksums to detect when artifact content has drifted from intended behavior?
- [ ] **Negative scenario testing** — For each content type examined: what happens when prerequisites are missing? When inputs are malformed? When referenced artifacts (agents, skills, MCP servers) don't exist? Content must fail gracefully with clear guidance or warn clearly — not fail silently or produce confusing output.

## Audit Checklists

### 5.1 Pipeline Agents
- [ ] Phase sequencing correctness — research, implement, review, final quality in correct order
- [ ] Context propagation between phases — critical information flows forward without loss
- [ ] Review loop termination conditions — clear criteria for when to stop iterating
- [ ] Phase 4 specialist dispatch logic — which specialists are invoked and when
- [ ] **Token efficiency** — Pipeline artifact is optimally sized. Reference: AGENTS.md best practices (6-10 rules, ≲150 lines per GitHub 2026 research).

### 5.2 Specialist Agents
- [ ] Domain expertise depth — does each specialist demonstrate deep knowledge?
- [ ] Tool usage instructions — are MCP tools, file operations, and external tools correctly referenced?
- [ ] Output actionability — can a user act on the specialist's output without interpretation?
- [ ] Integration with review loop — specialist findings feed back correctly into fixer
- [ ] **External-research alignment** — Compare against published research on LLM instruction formats; cite source and date.

### 5.3 Meta Agents
- [ ] Cross-cutting concern coverage — do meta agents address concerns that span multiple domains?
- [ ] Learning system effectiveness — does the learnings-loader actually improve future agent behavior?
- [ ] Security coverage breadth — does the security-auditor cover the full attack surface?
- [ ] **Hallucination prevention** — Meta agent includes grounding mechanisms (file references, schema constraints, verification steps).

### 5.4 Rules
- [ ] Technical accuracy — do recommendations reflect current best practices?
- [ ] .md/.mdc parity — canonical .md and Cursor .mdc versions are in sync
- [ ] Scope metadata correctness — `alwaysApply`, `globs`, `description` correctly set
- [ ] OWASP coverage — security rules cover OWASP Top 10 and OWASP Agentic Top 10
- [ ] Performance budget specificity — measurable thresholds, not vague guidance

### 5.5 Commands
- [ ] Workflow completeness — edge cases, error paths, alternative flows handled
- [ ] Platform feature integration — commands leverage platform capabilities (GitHub API, git, etc.)
- [ ] UX quality — intuitive naming, helpful output, clear error messages
- [ ] Simulated LLM execution — for ALL core and orchestration-heavy commands (minimum: `hatch3r-workflow`, `hatch3r-board-pickup`, `hatch3r-revision`, `hatch3r-quick-change`, `hatch3r-learn`, `hatch3r-security-audit`), mentally simulate step-by-step LLM execution. Predict output at each step. Compare against stated purpose. Flag deviation/hallucination risks. For commands with sub-files (e.g., board-pickup's delegation files), simulate the full delegation chain.
- [ ] **Governance compliance** — Verify adherence to Principles in `governance/VISION.md` §Principles and Behavioral Standards in `governance/CONSTITUTION.md` §2 P2. Specific checks: ASK checkpoints at user-facing decisions, mandatory quality gates, sub-agent delegation via four-phase pipeline, learnings consultation, scope-always rules in sub-agent prompts, current-information grounding, measurable acceptance criteria, context-degradation guards, severity routing, confidence expression, max-3-iteration review loop with user ASK on exhaustion, agent protocol reference, explicit error handling with recovery guidance.

### 5.6 Skills
- [ ] Step-by-step correctness — each step is executable and produces expected results
- [ ] Input/output contracts — what the skill expects and what it produces is explicit
- [ ] Guardrails — skill prevents common mistakes and dangerous operations
- [ ] Verification steps — skill includes self-check mechanisms
- [ ] Real-world applicability — skill addresses actual production scenarios

### 5.7 Supporting Artifacts
- [ ] Check criteria completeness — all 5 checks have explicit pass/fail criteria covering their stated domain scope
- [ ] Hook trigger accuracy — all 6 hooks fire on correct events
- [ ] Prompt output quality — all 3 prompts produce useful, structured output
- [ ] GitHub Actions integration quality — all 4 github-agents work correctly in CI

### Content Quality Principles

Verify that all content artifacts embody the shared quality charter (`agents/shared/quality-charter.md`). These checks apply across all content types and complement the per-type checklists above.

- [ ] **Charter inheritance** — Do agents reference or inherit the shared quality charter? Is the charter accessible in the agent's context when loaded?
- [ ] **Confidence expression** — Do agents express confidence levels (high/medium/low) in their output? Or do they present all recommendations with equal false certainty?
- [ ] **Measurable acceptance criteria** — Do commands include measurable, verifiable acceptance criteria (not vague aspirational wording without measurable pass/fail conditions)?
- [ ] **Failure mode documentation** — Do skills define what happens when prerequisites are missing, when edge cases arise, or when the skill cannot complete its task?
- [ ] **Approach challenging** — Does the reviewer agent challenge the approach and design, not just the implementation details? Does it ask "is this the right solution?" in addition to "is this solution correct?"
- [ ] **Requirement questioning** — Does the implementer agent question unclear or potentially misguided requirements before building, or does it blindly implement whatever is specified?
- [ ] **Information currency** — Do agents use Context7 MCP and web search as instructed by the tooling hierarchy rule? Or do they rely on potentially stale training data for technical decisions?
- [ ] **Stakeholder awareness** — Do agents consider impact on multiple stakeholders (end user, maintaining developer, team lead, ops team) in their recommendations?

### 5.8 Cross-Artifact Consistency (redistributed from D16)
- [ ] Consistent terminology across all 137 content artifacts
- [ ] Consistent severity levels ("Critical", "High", "Medium", "Low") usage across artifacts
- [ ] Consistent output format structures across artifacts
- [ ] Content interaction testing: when an agent loads 15+ always-apply rules, a skill, shared context, and agent instructions simultaneously, do instructions conflict or create ambiguity?
- [ ] MCP dependency graceful degradation: when a command references an unconfigured MCP server, does the workflow fail gracefully with guidance?
