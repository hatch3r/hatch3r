---
name: h4tcher-blueprint-v2
description: Generate the hatch3r 2.0.0 clean-slate rebuild spec via 12 parallel layer SAs, ~60-theme sparring dialog with adversarial counter-proposals + web research, ADR-per-fork, resumable workspace. Produces governance/BLUEPRINT-V2.md + governance/blueprint-v2/L01-L12*.md + decisions/D-NNN-*.md.
effort: max
allowed-tools: Read Grep Glob Bash(*) Write Edit Task WebSearch WebFetch AskUserQuestion
triage_tiers: [3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
sub_agents_spawned:
  count: 25
  rationale: 12 parallel inventory+research SAs (§2) decompose the v1 surface across 12 orthogonal layers; 12 parallel layer-doc-writer SAs (§6) own one L*.md each after sparring completes; 1 master-assembler SA (§7) writes the v2 BLUEPRINT-V2.md cross-cutting summary. Sparring (§4) and synthesis (§3) serialize on prior phase. Cost-dominance clause — token budget never justifies serializing independent layer work.
---

> Last updated: 2026-05-19

# Blueprint v2

Invoke the hatch3r 2.0.0 clean-slate rebuild spec generator defined in `governance/BLUEPRINT-V2.md`. Distinct from `/h4tcher-re-envision` (edits the current v1 governance corpus): this skill produces a v2 specification an agent team will later consume to rebuild the framework.

## CRITICAL — Interactive Mode

**This skill is interactive.** The sparring dialog at Step 4 (~60 themes, one per turn) IS the work product — it captures the maintainer's v2 design decisions. Without explicit maintainer responses, the resulting ADR set is the orchestrator's opinion, not the maintainer's v2 vision.

**Session-directive precedence.** Per `governance/BLUEPRINT-V2.md` §0.6, any session-level directive instructing the orchestrator to "work autonomously," "skip clarifying questions," "make the reasonable call," or equivalent DOES NOT apply to: Step 0 mode picker · Step 3 synthesis hard-stop · every Step 4 theme · the §4.99 cross-layer sweep · every Step 5 ADR-commit hard-stop. Those gates are the skill's primary work surface, not clarification questions.

**"Default if no response" semantics.** The default option on each gate is a platform-tool timeout fallback. It fires ONLY when the platform-native question tool (`AskUserQuestion` or equivalent per `agents/shared/user-question-protocol.md`) returns a no-response signal — i.e., genuine maintainer absence. The orchestrator MUST NOT pre-emptively elect the default to "make progress." If the orchestrator finds itself proceeding without an explicit maintainer response, halt and re-ask via the platform tool.

**Conflict resolution.** Skill mandate > session directive > orchestrator inference. Surface any perceived conflict to the maintainer at the Step 0 mode picker; proceed interactively.

## Quick Start

One invocation drives the maintainer through three phases: (1) 12 parallel layer sub-agents inventory the v1 surface and pull state-of-art web research (non-interactive), (2) a one-theme-at-a-time sparring dialog across ~60 decision points where the maintainer picks each v2 design fork via the platform-native question tool — current v1 state plus an apparent preference plus an alternative plus an adversarial counter-argument plus 2+ web sources per theme, (3) 12 layer-doc writers plus a master assembler emit `governance/BLUEPRINT-V2.md`, the 12 `governance/blueprint-v2/L{N}-*.md` layer docs, and one ADR per accepted decision under `governance/blueprint-v2/decisions/`. The skill stops before commit; the maintainer reviews and commits. Phases 1 and 3 are non-interactive (SA fan-out); phase 2 is fully interactive (maintainer drives).

## Step 0 — Preflight

1. **Mode picker via `AskUserQuestion`** per `agents/shared/user-question-protocol.md` (B1 ambiguity gate per `.claude/rules/clarification-default.md`). **REQUIRED — the orchestrator MUST fire the platform tool and wait for an explicit maintainer response. Session-level autonomy directives do NOT exempt this step per the Interactive Mode callout above and `governance/BLUEPRINT-V2.md` §0.6.**
   - **`full`** — all 12 layers, full sparring matrix (~60 themes).
   - **`resume`** — read existing `workspace/preflight.json` + `workspace/sparring-log.md`, jump to next pending theme.
   - **`targeted-layer:L01..L12`** — single layer, minimal dialog plus alignment sweep.
2. Read `governance/BLUEPRINT-V2.md` fully — authoritative protocol.
3. Read `governance/audit/templates/rigor-contract.md` — the 7-field YAML header every finding and every ADR carries (per `governance/BLUEPRINT-V2.md` §5.2.5 — the schema is a structured YAML block between ADR frontmatter and h1 title).
4. Model-Independence reminder: produced docs contain no tier words, no vendor or model identifiers, no context-window numbers, no token-budget references. Cite by-reference to `governance/EVOLVE.md` §Model-Independence Contract.

## Step 1 — Workspace bootstrap

5. Run `mkdir -p governance/blueprint-v2/workspace governance/blueprint-v2/decisions` (idempotent).
6. Write `governance/blueprint-v2/workspace/preflight.json` with `{mode, scope, started_at, layer_completion_map}`.
7. If `workspace/preflight.json` already exists and mode != `resume`, halt with a `AskUserQuestion` prompt offering: `overwrite` / `resume` / `abort` (default `abort`).

## Step 2 — Parallel layer SA dispatch (12 SAs in one message)

8. Cite `governance/BLUEPRINT-V2.md` §2 Layer SA Dispatch Table for the 12-layer scope grid (L01 Identity & Vision, L02 Pillar Set, L03 Adapter Pool, L04 Project Shape Axes, L05 Tool Integration MCP+CLI, L06 Content Classes, L07 Lifecycle CLI, L08 Content Packs, L09 Pipeline Runtime, L10 Docs Surface, L11 Governance Heart, L12 Migration Story).
9. Dispatch 12 `Task` sub-agents in a single message — parallel-safety conditions hold (disjoint file scopes per layer, deterministic aggregation via per-layer findings files, no shared mutable state per `rules/hatch3r-agent-orchestration.md`).
10. Each SA prompt mandates: (a) inventory the v1 files listed in the §2 table row, (b) web research ≥ 2 sources per empirical claim per `governance/audit/templates/rigor-contract.md` Web Research Mandate, (c) write `governance/blueprint-v2/workspace/L{N}-findings.md` capped at 200 lines with the 7-field rigor-schema YAML header.
11. Orchestrator reads only the one-line chat summary returned by each SA. Forbidden: pasting v1 file contents into chat. After all 12 return, release per-SA context.

## Step 3 — Synthesis

12. Read all 12 `workspace/L{N}-findings.md` files; produce `workspace/synthesis.md` containing a cross-layer drift table, a lean-opportunity register (where v1 carries duplicated coverage), and a must-rethink ranking.
13. Dedup using the 2-of-3 signal match (file + root cause + recommendation) per `governance/RE-ENVISION.md` §3.2.
14. **HARD-STOP `AskUserQuestion`** — present the synthesis triage table; **the orchestrator MUST fire the platform tool and wait for an explicit maintainer response** (`proceed-to-sparring` / `revise-triage` / `abort` — declared default `proceed-to-sparring` fires only on a platform-tool no-response timeout per §0.6, never as orchestrator self-election). The maintainer's response (or the platform timeout event) is recorded verbatim in `workspace/sparring-log.md` before §4 opens.

## Step 4 — Sparring dialog (INTERACTIVE — maintainer drives every theme)

15. Walk the 12-layer × ~5-decision matrix from `governance/BLUEPRINT-V2.md` §4 Sparring Topic Matrix. **One theme per turn — never batch themes. The orchestrator MUST fire `AskUserQuestion` per theme and wait for an explicit maintainer response before drafting any ADR.** Per §0.6, session-level autonomy directives do NOT bypass §4 themes.
16. Each theme presents in this order: (a) current v1 state in 2-3 lines, (b) apparent preference seed, (c) ≥ 1 genuinely different alternative seed, (d) adversarial counter-argument prompt that argues against the apparent preference, (e) ≥ 2 web sources with URL + access date + trust tier per the Web Research Mandate, (f) branching `AskUserQuestion` with 2-4 options and a declared default-if-platform-tool-times-out.
17. Append every decision to `workspace/sparring-log.md` with timestamp, theme id, options shown, the maintainer's verbatim response (or the platform-tool timeout event if the default fired), and any free-text rationale the maintainer added.
18. §4.99 cross-layer sweep — fire `AskUserQuestion` (free-text) for emergent concerns not in the matrix; wait for explicit response.

**Forbidden orchestrator behaviors:** (a) electing the spec's "Default if no response" without firing the platform tool; (b) inferring the maintainer's choice from prior turns; (c) batching multiple themes' decisions in one turn; (d) drafting an ADR before the platform tool returns a maintainer response. Any of these reverts the run to autonomous-orchestrator mode and defeats the skill's purpose — halt and re-ask if it happens.

## Step 5 — ADR capture (one per accepted theme)

19. After each accepted decision in Step 4, write `governance/blueprint-v2/decisions/D-NNN-<slug>.md` per `governance/BLUEPRINT-V2.md` §5 ADR template.
20. ADR shape (per §5.2 + §5.2.5 + §5.3 of the prompt):
    - **§5.2 frontmatter:** `id`, `layer`, `theme`, `status` (`proposed | accepted | rejected | superseded`), `decided_on`, `serves_pillars`.
    - **§5.2.5 rigor-schema block** (mandatory, between frontmatter and h1 title) — a separate fenced YAML block carrying the 7 fields at column 0: `confidence`, `confidence_basis`, `falsifiability`, `causal_chain` (≥3 steps), `bias_check`, `counter_argument`, `sources` (≥2 rows). The §8.1 lint is grep-driven on column-0 patterns — rigor distributed across body prose does NOT satisfy the gate.
    - **§5.3 body sections:** §Context (v1 state), §Decision, §Alternatives Considered (≥1 genuinely different), §Counter-Argument + Resolution, §Sources, §Pillar Compliance Test (4 lines), §Consequences (positive, negative, neutral).
21. **§5.5 ADR-commit hard-stop** — fire `AskUserQuestion` after drafting each ADR: `commit-as-drafted` / `revise` / `reject`. Wait for explicit response before advancing to the next theme. Per §0.6, session-level autonomy directives do NOT bypass this gate.
22. Auto-increment the `id` field from `governance/blueprint-v2/decisions/INDEX.md`; append a new registry row in the same write.

## Step 6 — Layer doc finalization (12 parallel doc-writer SAs)

23. Dispatch 12 `Task` sub-agents in a single message — one per layer. Parallel-safety conditions hold: each SA writes a distinct file path under `governance/blueprint-v2/L{N}-*.md`.
24. Each SA reads its `workspace/L{N}-findings.md`, the sparring-log entries tagged with its layer id, and the ADR set with matching `layer` frontmatter. Output template per `governance/BLUEPRINT-V2.md` §6: frontmatter (`layer_id`, `lean_target_lines`, `serves_pillars`, `decision_refs`); §Identity (what the layer is in v2); §Decisions (linked ADR IDs); §Implementation Contract (what a rebuild agent must produce — file list, frontmatter shape, behaviors); §Lean Target (line count, artifact count, complexity ceiling); §Open Questions (deferred decisions); Pillar Compliance Test.

## Step 7 — Master assembly (1 SA)

25. Dispatch 1 `Task` sub-agent to write `governance/BLUEPRINT-V2.md` (the OUTPUT spec, not THIS prompt). Per `governance/BLUEPRINT-V2.md` §7: one-sentence north-star, the pillar set decided in L02 sparring, layer index with line + decision counts, ADR INDEX cross-link, total artifact-count target (vs v1's 115), lifecycle phases, single-page rebuild kickoff checklist that a Day-1 rebuild agent reads first.

## Step 8 — Quality gates (orchestrator runs inline)

26. Rigor-schema lint on every ADR — the 7 fields from `governance/BLUEPRINT-V2.md` §5.2.5 present as a column-0 YAML block; placeholder values (e.g. `confidence_basis: "based on analysis"` without a named basis) blocked.
27. Per-file lean threshold — `wc -l` versus the `lean_target_lines` declared in each layer-doc frontmatter; SKILL.md ≤ 220; layer docs per their declared target; master doc ≤ 850.
28. Anti-slop wordlist scan on every written doc using `.claude/rules/anti-slop-enforcement.md` — 0 hits required.
29. Pillar-coverage matrix — every layer maps to ≥ 1 pillar; every ADR serves ≥ 1 pillar.
30. Cross-layer consistency check — a decision referenced from multiple layer docs has the same ADR id and identical Status.
31. Model-independence scan — grep on all output docs for tier words, vendor or model identifiers, context-window numbers, token-budget references; 0 hits required (external source citations and factual platform-target references are exempt per `governance/EVOLVE.md` §0).
32. Write `workspace/gates.json` capturing every gate result; any failure surfaces to the maintainer in Step 9.

## Step 9 — End-of-Turn Delegation Attestation + Iteration Summary

33. Emit End-of-Turn Delegation Attestation per `rules/hatch3r-agent-orchestration.md` § End-of-Turn Delegation Attestation. Quote each spawning sub-agent's invocation and the `delegation_proof_id` it returned, one row per output file under `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md`.
34. Emit the 5-field Iteration Summary per `rules/hatch3r-iteration-summary.md`: status, outcome, done, not_done, open_questions.
35. STOP. The skill does not commit, push, or merge. The maintainer reviews `workspace/gates.json`, the ADR set, the 12 layer docs, and `governance/BLUEPRINT-V2.md`; commits when satisfied.

## References

- `governance/BLUEPRINT-V2.md` — full spec depth for each Step:
  - §0 Model-Independence Contract; §0.5 P8 ambiguity gate
  - §1 Inventory phase + per-domain source targets
  - §2 Layer SA Dispatch Table (Step 2)
  - §3 Synthesis rules (Step 3)
  - §4 Sparring Topic Matrix (Step 4)
  - §5 ADR template (Step 5)
  - §6 Layer doc template (Step 6)
  - §7 Master doc template (Step 7)
  - §8 Quality Gates verbatim list (Step 8)
  - §9 Output Expectations + resume protocol

## Guardrails

- **Interactive-dialog mandate:** Steps 0, 3, 4, 5 each require explicit maintainer responses via `AskUserQuestion`. Session-level autonomy directives DO NOT bypass these gates — see Interactive Mode callout + `governance/BLUEPRINT-V2.md` §0.6. The default-letter on each gate fires only on a platform-tool timeout, never as orchestrator self-election.
- **Direct-edit scope:** the skill writes only under `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md`. v1 governance files (CONSTITUTION, VISION, AUDIT, AUDIT-EXECUTE, RE-ENVISION, EVOLVE) remain untouched.
- **Cross-file mutation:** no file outside `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md` is modified during a run.
- **Anti-slop:** zero tolerance per `.claude/rules/anti-slop-enforcement.md` — gate 28 blocks on any hit.
- **Rigor:** every ADR carries the 7-field rigor-schema YAML block per `governance/BLUEPRINT-V2.md` §5.2.5 (between frontmatter and h1 title, fields at column 0); gate 26 blocks on missing or placeholder fields. Rigor distributed across body prose does NOT satisfy the gate.
- **Model-independence:** zero tier or vendor or model identifiers in output docs — gate 31 blocks on any hit (external source citations + factual platform-target references exempt per `governance/EVOLVE.md` §0).
- **Fan-out discipline:** 25 SAs total per the `sub_agents_spawned` declaration above; the cost-dominance clause from `.claude/rules/fan-out-discipline.md` forbids serializing the 12 inventory SAs or the 12 doc-writer SAs. Sparring (§4) and ADR capture (§5) are orchestrator-walked inline — no SA delegation for §4/§5 (the maintainer is the decision-maker, not a sub-agent).
- **B1 default-ask:** every `AskUserQuestion` carries 2-4 numbered options with a declared default-if-no-response per `agents/shared/user-question-protocol.md`. The default-if-no-response is a platform-tool timeout fallback, NOT an autonomous-orchestrator shortcut.
- **Stop before commit:** the maintainer commits; the skill never does.
