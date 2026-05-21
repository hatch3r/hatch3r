# Domain 13: Human-AI Collaboration Quality

> Last updated: 2026-04-19

**Pillars served:** P2 (primary), P1, P8 (supporting).

**Scope:** How well the framework facilitates productive human-AI interaction, including proactive ambiguity detection.
**Sub-agents:** 5

| SA | Focus |
|----|-------|
| 13.1 | Interaction Patterns |
| 13.2 | Trust Calibration |
| 13.3 | Confidence Indication |
| 13.4 | Feedback Loops & Educational Value |
| 13.5 | P8 B1 Clarification Gates (directive 17) |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Audit Checklists

### 13.1 Interaction Patterns

Coverage of interaction types — does the framework support all 11 common interaction patterns?
- [ ] (1) Task delegation
- [ ] (2) Collaborative editing
- [ ] (3) Code review
- [ ] (4) Debugging assistance
- [ ] (5) Architecture discussion
- [ ] (6) Learning/teaching
- [ ] (7) Planning/specification
- [ ] (8) Testing strategy
- [ ] (9) Incident response
- [ ] (10) Dependency management
- [ ] (11) Release management

### 13.2 Trust Calibration
- [ ] Trust calibration assessment — does the framework create appropriate levels of trust in agent output?
- [ ] Uncertainty warnings — are users warned when agents are uncertain?
- [ ] Review gate trustworthiness — is the "0 Critical + 0 Warning" gate reliable or gameable?
- [ ] Over-trust risks — does the framework create false confidence in agent output?

### 13.3 Confidence Indication
- [ ] Do agents indicate graduated confidence levels (high/medium/low) in recommendations, with clear definitions for each level? High = verified against code. Medium = based on patterns. Low = best judgment, recommend human review.
- [ ] Are there graduated confidence signals (high confidence on formatting, low confidence on architecture)?
- [ ] Can users calibrate agent assertiveness?
- [ ] Are confidence levels backed by verifiable signals (test results, lint output)?
- [ ] Assumption challenging — do agents challenge user assumptions when warranted, rather than blindly implementing potentially misguided requirements? Is there a graceful mechanism for agents to say "before I proceed, I want to flag a concern about this approach"?
- [ ] Command-level confidence propagation — do command orchestrators (workflow, board-pickup, revision, quick-change) include confidence expression requirements in every sub-agent delegation prompt? Verify that the quality charter's confidence definitions (high = verified against code, medium = pattern-based, low = best judgment) are explicitly stated in sub-agent prompts, not assumed to be inherited.
- [ ] Confidence at quality gates — do commands express confidence levels at quality gate checkpoints (after quality checks pass, after review loop completion, after acceptance criteria verification)? The confidence should reflect verification depth, not just pass/fail status.
- [ ] Confidence in result summaries — do commands include an overall confidence assessment in their final output (Review Results, Merge Readiness, Quick Change Complete)? This gives the user a single signal about how much human verification is recommended.
- [ ] Confidence consistency across commands — do all four core orchestration commands use the same confidence scale (high/medium/low), the same definitions, and express confidence at the same structural points? Or do some commands express confidence while others present results with false certainty?

### 13.4 Feedback Loops & Educational Value
- [ ] Can users provide feedback that improves future agent performance?
- [ ] Educational value — does the framework teach users better practices, or just do the work?
- [ ] Learning system (`.hatch3r/learnings/`) effectiveness assessment
- [ ] Knowledge transfer — do agents explain their reasoning to help users learn?

### 13.5 P8 B1 Clarification Gates
Behavioral Charter directive 17 — ambiguity detection is **proactive default**, not reactive exception (`governance/CONSTITUTION.md` §P8 B1).
- [ ] Artifact directs the agent to detect ambiguity proactively, not reactively (gate at §0/Step 0, before work begins).
- [ ] `agents/shared/user-question-protocol.md` referenced explicitly for question phrasing and platform-native tool use.
- [ ] Default-if-no-response handling defined per `user-question-protocol.md` template (timeout, safe default, escalation).
- [ ] Escalation path on unresolved questions defined (human review, ASK checkpoint, abort with explanation — not silent assumption).
