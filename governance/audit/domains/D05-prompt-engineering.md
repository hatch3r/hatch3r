# Domain 5: Prompt Engineering Quality

> Last updated: 2026-05-18

**Pillars served:** P2 (primary), P4, P8 (supporting).

**Scope:** 209 content artifacts evaluated for prompt engineering quality, instruction clarity, ambiguity-detection gates, LLM execution reliability.
**Sub-agents:** 9

| SA | Focus |
|----|-------|
| 5.1 | Pipeline agents (researcher/implementer/reviewer/fixer) |
| 5.2 | Specialist agents (a11y/architect/ci-watcher/context-rules/dep-auditor/devops/docs-writer/lint-fixer) |
| 5.3 | Meta agents (perf-profiler/security-auditor/test-writer/learnings-loader) |
| 5.4 | Rules (42 .md + 42 .mdc) |
| 5.5 | Commands (38) |
| 5.6 | Skills (63) |
| 5.7 | Supporting artifacts (6 checks + 6 hooks + 3 prompts + 4 github-agents) |
| 5.8 | Cross-artifact consistency (209 artifacts, from D16) |
| 5.9 | P8 B1 verification (ambiguity-detection gate, directive 17) |

> Apply rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Universal Checklist (all sub-agents)
- [ ] One-shot success prediction — LLM executes correctly first attempt without clarification (1-5).
- [ ] Instruction clarity — unambiguous, sequenced, contradiction-free (1-5).
- [ ] Output format — explicit, structured, parseable.
- [ ] Scope boundaries — does / does NOT do; implicit assumptions surfaced.
- [ ] Handoff contracts — pipeline phase data schemas explicit.
- [ ] Golden test case — deterministic test exists or rationale for absence.
- [ ] Negative scenarios — missing prereqs, malformed inputs, absent referenced artifacts fail gracefully with guidance.

## Audit Checklists

### 5.1 Pipeline Agents
- [ ] Phase sequencing research→implement→review→final correct; context propagation lossless; review-loop termination criteria explicit; Phase 4 dispatch logic defined; token efficiency per AGENTS.md (6-10 rules, ≲150 lines).

### 5.2 Specialist Agents
- [ ] Domain expertise visible; tool usage (MCP/file ops/externals) accurate; output actionable; integration with review loop intact; external-research alignment cited.

### 5.3 Meta Agents
- [ ] Cross-cutting coverage; learnings-loader produces measurable behavior change; security-auditor covers full attack surface; hallucination prevention via file refs, schemas, verification.

### 5.4 Rules (42 .md + 42 .mdc)
- [ ] Technical accuracy current; .md/.mdc parity intact; scope metadata correct; OWASP Top 10 + Agentic Top 10 covered; performance budgets measurable.

### 5.5 Commands
- [ ] Workflow completeness (edges/errors/alternates); platform integration; UX quality; simulated LLM execution for core/orchestration commands flags deviation/hallucination; governance compliance per `governance/VISION.md` §Principles and `governance/CONSTITUTION.md` §2 P2 (ASK checkpoints, gates, sub-agent delegation, learnings consultation, severity routing, confidence expression, max-3-iteration loop, explicit error handling).

### 5.6 Skills
- [ ] Step executability; I/O contracts explicit; guardrails prevent dangerous ops; self-check verification present; real-world production applicability.

### 5.7 Supporting Artifacts
- [ ] 6 checks have pass/fail criteria covering scope; 6 hooks fire on correct events; 3 prompts produce structured output; 4 github-agents work in CI.

### 5.8 Cross-Artifact Consistency
- [ ] Consistent terminology, severity scale, output formats across 209 artifacts.
- [ ] Content interaction — 15+ always-apply rules + skill + shared + agent loaded simultaneously produce no conflict/ambiguity.
- [ ] MCP dependency graceful degradation — unconfigured server fails with guidance.
- [ ] Filename prefix scope — top-level published content has `hatch3r-` prefix; support subdirs exempt per `.claude/rules/content-authoring.md`.

### 5.9 P8 B1 verification
Behavioral Charter directive 17 (Clarification-First Verification). Gate is **default behavior, not exception-driven** per `governance/CONSTITUTION.md` §P8 B1.
- [ ] Artifact has §0 or Step 0 ambiguity-detection gate (PASS/FAIL).
- [ ] Gate references `agents/shared/user-question-protocol.md` explicitly (PASS/FAIL).
- [ ] Gate uses platform-native question tool, not free-text prose (PASS/FAIL).
- [ ] Gate is default path, not exception-only (PASS/FAIL).
- [ ] Tier 2+ tasks have hard confirmation gate, not soft inline acknowledgement (PASS/FAIL).
- [ ] Triggers cover ambiguous scope, irreversible action, missing acceptance criteria.
