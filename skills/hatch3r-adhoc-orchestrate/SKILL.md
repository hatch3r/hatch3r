---
id: hatch3r-adhoc-orchestrate
name: hatch3r-adhoc-orchestrate
type: skill
description: Scaffolds the ad-hoc Tier >= 2 orchestration protocol -- Per-Turn Pipeline-State Header, implementer delegation plan, End-of-Turn Delegation Attestation. Use for a maintainer multi-phase task with no registered command to avoid bypass mode.
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
sub_agents_spawned:
  count: 0
  rationale: This is a scaffolding skill — it emits the orchestration-protocol blocks for the maintainer's own multi-phase task; the maintainer's task then spawns its own implementer/fixer sub-agents per the plan this skill produces. The skill itself delegates nothing.
---

# Ad-Hoc Orchestration Scaffold

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Score the task tier (Tier >= 2 gate)
- [ ] Step 2: Emit the Per-Turn Pipeline-State Header
- [ ] Step 3: Build the delegation plan (no inline implementation)
- [ ] Step 4: Emit the End-of-Turn Delegation Attestation template
- [ ] Step 5: Verify the bypass-protection checklist
```

A multi-phase task driven by hand — research + implement + review, no registered `/h4tcher-*` command — is still bound by the **Orchestrator Self-Discipline (Bypass Protection)** contract in `CLAUDE.md` and `rules/hatch3r-agent-orchestration.md`. The CHANGELOG #73 failure mode is exactly this: running research and review sub-agents while inlining the implementation, escaping the protocol because no command was invoked. This skill is the turnkey scaffold that closes that loophole — it does not perform the work; it emits the three required protocol blocks so the maintainer's ad-hoc flow stays attributable.

Use this skill at the start of any maintainer-side multi-phase task at Tier >= 2 that is NOT already running under a registered command (which carries these blocks itself). When the work matches a registered intent, prefer the command: `/h4tcher-capability-add`, `/h4tcher-capability-refactor`, `/h4tcher-capability-remove` for lifecycle work; `commands/hatch3r-*.md` for end-user content workflows.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target files, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: the task tier is genuinely uncertain (Tier 1 vs Tier 2 changes whether the protocol even applies), the set of files to mutate is unbounded, or a registered command already covers the intent (route there instead of scaffolding).

## Step 1: Score the Task Tier (Tier >= 2 Gate)

The protocol binds at Tier 2 and Tier 3 only. Score the task per the `hatch3r-deep-context` rule (deep-context score >= 3 → Tier >= 2):

- **Tier 1** — trivial single-file edit, no cross-module reasoning. The header and attestation are NOT required; a single targeted edit is acceptable. State "Tier 1 — protocol not required" and exit the scaffold.
- **Tier 2** — multi-file or behavior-changing task with bounded scope. Full protocol applies.
- **Tier 3** — multi-module / high-risk task. Full protocol applies; fan out one sub-agent per independent module per `rules/hatch3r-fan-out-discipline.md` (P8 B2).

Record the score and the one-line rationale. The tier is the load-bearing input to every block below.

## Step 2: Emit the Per-Turn Pipeline-State Header

At the START of every assistant turn that touches the task, emit the single-line header per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Example first turn: `[hatch3r-pipeline: phase 1 | last: n/a | next: hatch3r-researcher]`

Phase mapping for an ad-hoc task (mirror the four-phase pipeline):

| Phase | Meaning | Driving agent |
|-------|---------|---------------|
| 1 | Research / context gathering | `hatch3r-researcher` |
| 2 | Implementation | `hatch3r-implementer` |
| 3 | Review loop | `hatch3r-reviewer` ↔ `hatch3r-fixer` |
| 4 | Final quality + summary | parallel specialists, then iteration summary |

A missing header on a Tier >= 2 turn is a self-detectable drift signal — halt and re-ground rather than continuing blind.

## Step 3: Build the Delegation Plan (No Inline Implementation)

The hard constraint: the orchestrator turn MUST NOT call any code-writing tool (`Edit`, `Write`, `MultiEdit`) directly. Code mutation flows ONLY through the Task tool spawning `hatch3r-implementer` (Phase 2) or `hatch3r-fixer` (Phase 3) per `rules/hatch3r-agent-orchestration.md` -> Mandatory Delegation Directive (No Inline Implementation). There is no Tier-1 carve-out here — Tier 1 exits at Step 1.

Produce a delegation plan before touching any file:

```
Delegation Plan:
  Phase 1 — research:   hatch3r-researcher, modes: {…}, depth: {quick|standard|deep}
  Phase 2 — implement:  hatch3r-implementer × {N}  ({1 per independent module}; correlation_id: {uuid})
  Phase 3 — review:     hatch3r-reviewer ↔ hatch3r-fixer (max 4 iterations)
  Phase 4 — quality:    {applicable specialists per the Phase 4 Specialist Trigger Table}
  sub_agents_spawned:   { count: {N}, rationale: {one-sentence task-decomposition justification} }
```

Fan-out scales with task decomposition, not token budget (P8 B2 dominates P7): N independent modules → N parallel Phase-2 implementers; serialize only on true dependency edges (shared files, ordered handoffs). Every delegation prompt carries the confidence expression requirement and the `correlation_id` per the orchestration rule.

## Step 4: Emit the End-of-Turn Delegation Attestation Template

Every turn that mutated files at Tier >= 2 emits the attestation block immediately BEFORE the Iteration Summary (beside it, not inside it — the iteration-summary contract stays verbatim), per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via <hatch3r-implementer | hatch3r-fixer> (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Why it is forgery-resistant: the per-file `delegation_proof_id` is returned by `hatch3r-implementer` / `hatch3r-fixer` in their structured results (`agents/hatch3r-implementer.md` -> Return Structured Result; `agents/hatch3r-fixer.md` -> Return Structured Result). Quote it verbatim. A turn that skipped delegation has no `delegation_proof_id` to quote — its row is unattributable, which is a self-declared P8 B2 violation: halt and queue re-delegation next turn. `inline_edits_by_orchestrator: none` is the only accepted value in an ad-hoc flow (the `hatch3r-quick-change` Tier-1 carve-out does not apply outside that command).

## Step 5: Bypass-Protection Checklist

Before declaring the turn complete, verify every item — a failed item is the CHANGELOG #73 bypass mode:

- [ ] Task tier scored; protocol applied iff Tier >= 2 (Step 1).
- [ ] Per-Turn Pipeline-State Header emitted at the start of every task-touching turn (Step 2).
- [ ] Zero inline `Edit` / `Write` / `MultiEdit` from the orchestrator turn; every code mutation went through `hatch3r-implementer` or `hatch3r-fixer` (Step 3).
- [ ] End-of-Turn Delegation Attestation emitted before the Iteration Summary, every mutated file attributed to a sub-agent with its `delegation_proof_id` quoted verbatim (Step 4).
- [ ] `sub_agents_spawned: { count, rationale }` emitted as a first-class field per `rules/hatch3r-fan-out-discipline.md`.
- [ ] Iteration Summary follows per `rules/hatch3r-iteration-summary.md`.

## Error Handling

- **Unattributable mutation row:** a file was mutated but no `delegation_proof_id` exists for it → the orchestrator inlined the edit. This is a P8 B2 violation. Halt the turn, queue re-delegation of that file through `hatch3r-implementer`/`hatch3r-fixer` next turn, and note the bypass in the attestation block.
- **Tier misclassification surfaces mid-task:** a Tier-1-scored task that grows to touch multiple modules → re-score to Tier >= 2 immediately, begin emitting the header and attestation from the current turn, and re-delegate any already-inlined edits.
- **Registered command exists for the intent:** if mid-scaffold you recognize the task matches a registered `/h4tcher-*` command or `commands/hatch3r-*.md`, stop scaffolding and route to that command — it carries these blocks natively and avoids hand-maintained drift.

## Definition of Done

- [ ] Tier scored; protocol applied at Tier >= 2 or skipped at Tier 1.
- [ ] Header emitted on every task-touching turn.
- [ ] No inline orchestrator edits; all mutations attributed to a delegated sub-agent.
- [ ] Attestation block emitted before the Iteration Summary with verbatim `delegation_proof_id`s.
- [ ] `sub_agents_spawned` count + rationale present.

## References

- `CLAUDE.md` -> "Orchestrator Self-Discipline (Bypass Protection)" — the three-requirement contract this skill scaffolds; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive (No Inline Implementation) — block formats and rules reproduced here; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `rules/hatch3r-fan-out-discipline.md` — P8 B2 fan-out scaling, `sub_agents_spawned` first-class field, attestation forgery-resistance rationale; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `skills/hatch3r-incident-response/SKILL.md` — canonical skill structure (Quick Start + Step pattern + Fan-out Discipline section) modeled here; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- hatch3r governance self-audit analysis — source rationale for the missing ad-hoc Tier >= 2 orchestrator scaffold; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
