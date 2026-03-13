# Domain 5: Prompt Engineering Quality

**Scope:** ALL 137 content artifacts evaluated for prompt engineering quality, instruction clarity, and LLM execution reliability.
**Sub-agents:** 7

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

## Universal Checklist (apply to ALL sub-agents)

- [ ] **One-shot success prediction** — Would an LLM execute this artifact correctly on the first attempt without clarification? Rate 1-5.
- [ ] **Instruction clarity scoring** — Are instructions unambiguous, sequenced logically, and free of contradictions? Rate 1-5.
- [ ] **Output format specification** — Is the expected output format explicitly defined, structured, and parseable?
- [ ] **Scope boundaries** — Clear what the artifact does and does NOT do? Are there implicit assumptions?
- [ ] **Cross-agent handoff contract analysis** — For pipeline agents: are handoff contracts between phases (researcher to implementer, reviewer to fixer) explicitly defined with data schemas?
- [ ] **Golden test case methodology** — Could you write a deterministic test case to verify this artifact produces correct output? If not, why?
- [ ] **Prompt drift detection** — Are there version markers or checksums to detect when artifact content has drifted from intended behavior?
- [ ] **Token efficiency** — Is the artifact optimally sized? Could it be shorter without losing effectiveness? (Reference: AGENTS.md best practices: 6-10 rules, <150 lines)
- [ ] **Hallucination prevention** — Does the artifact include grounding mechanisms (file references, schema constraints, verification steps)?
- [ ] **State-of-the-art alignment** — Compare against latest research on effective LLM instruction formats

## Audit Checklists

### 5.1 Pipeline Agents
- [ ] Phase sequencing correctness — research, implement, review, final quality in correct order
- [ ] Context propagation between phases — critical information flows forward without loss
- [ ] Review loop termination conditions — clear criteria for when to stop iterating
- [ ] Phase 4 specialist dispatch logic — which specialists are invoked and when

### 5.2 Specialist Agents
- [ ] Domain expertise depth — does each specialist demonstrate deep knowledge?
- [ ] Tool usage instructions — are MCP tools, file operations, and external tools correctly referenced?
- [ ] Output actionability — can a user act on the specialist's output without interpretation?
- [ ] Integration with review loop — specialist findings feed back correctly into fixer

### 5.3 Meta Agents
- [ ] Cross-cutting concern coverage — do meta agents address concerns that span multiple domains?
- [ ] Learning system effectiveness — does the learnings-loader actually improve future agent behavior?
- [ ] Security coverage breadth — does the security-auditor cover the full attack surface?

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

### 5.6 Skills
- [ ] Step-by-step correctness — each step is executable and produces expected results
- [ ] Input/output contracts — what the skill expects and what it produces is explicit
- [ ] Guardrails — skill prevents common mistakes and dangerous operations
- [ ] Verification steps — skill includes self-check mechanisms
- [ ] Real-world applicability — skill addresses actual production scenarios

### 5.7 Supporting Artifacts
- [ ] Check criteria completeness — all 5 checks cover their domain thoroughly
- [ ] Hook trigger accuracy — all 6 hooks fire on correct events
- [ ] Prompt output quality — all 3 prompts produce useful, structured output
- [ ] GitHub Actions integration quality — all 4 github-agents work correctly in CI
