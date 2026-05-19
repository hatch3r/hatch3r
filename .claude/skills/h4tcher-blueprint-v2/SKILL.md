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

## Quick Start

One invocation drives the maintainer through three phases: (1) 12 parallel layer sub-agents inventory the v1 surface and pull state-of-art web research, (2) a one-theme-at-a-time sparring dialog across ~60 decision points (current v1 state plus an apparent preference plus an alternative plus an adversarial counter-argument plus 2+ web sources), (3) 12 layer-doc writers plus a master assembler emit `governance/BLUEPRINT-V2.md`, the 12 `governance/blueprint-v2/L{N}-*.md` layer docs, and one ADR per accepted decision under `governance/blueprint-v2/decisions/`. The skill stops before commit; the maintainer reviews and commits.

## Step 0 — Preflight

1. Mode picker via `AskUserQuestion` per `agents/shared/user-question-protocol.md` (B1 ambiguity gate per `.claude/rules/clarification-default.md`):
   - **`full`** — all 12 layers, full sparring matrix (~60 themes).
   - **`resume`** — read existing `workspace/preflight.json` + `workspace/sparring-log.md`, jump to next pending theme.
   - **`targeted-layer:L01..L12`** — single layer, minimal dialog plus alignment sweep.
2. Read `governance/BLUEPRINT-V2.md` fully — authoritative protocol.
3. Read `governance/audit/templates/rigor-contract.md` — the 7-field YAML header every finding and every ADR carries.
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
14. HARD-STOP `AskUserQuestion` — present the synthesis triage table; the maintainer confirms `proceed-to-sparring` / `revise-triage` / `abort` (default `proceed-to-sparring`) before §4 opens.

## Step 4 — Sparring dialog

15. Walk the 12-layer × ~5-decision matrix from `governance/BLUEPRINT-V2.md` §4 Sparring Topic Matrix. **One theme per turn — never batch themes.**
16. Each theme presents in this order: (a) current v1 state in 2-3 lines, (b) apparent preference seed, (c) ≥ 1 genuinely different alternative seed, (d) adversarial counter-argument prompt that argues against the apparent preference, (e) ≥ 2 web sources with URL + access date + trust tier per the Web Research Mandate, (f) branching `AskUserQuestion` with 2-4 options and a declared default.
17. Append every decision to `workspace/sparring-log.md` with timestamp, theme id, options shown, choice taken, and any free-text rationale the maintainer added.
18. §4.99 cross-layer sweep — open free-text `AskUserQuestion` for emergent concerns not in the matrix.

## Step 5 — ADR capture

19. After each accepted decision, write `governance/blueprint-v2/decisions/D-NNN-<slug>.md` per `governance/BLUEPRINT-V2.md` §5 ADR template. Required body sections: Context (v1 state), Decision, Alternatives Considered (≥1 genuinely different), Counter-Argument + Resolution, Sources (≥2 with URL + access date + author + trust tier), Pillar Compliance Test (4 lines), Consequences (positive, negative, neutral).
20. Frontmatter required: `id`, `layer`, `theme`, `status` (`proposed | accepted | rejected | superseded`), `decided_on`, `serves_pillars`, plus the 7-field rigor schema header per `governance/audit/templates/rigor-contract.md`.
21. Auto-increment the `id` field from `governance/blueprint-v2/decisions/INDEX.md`; append a new registry row in the same write.

## Step 6 — Layer doc finalization (12 parallel doc-writer SAs)

22. Dispatch 12 `Task` sub-agents in a single message — one per layer. Parallel-safety conditions hold: each SA writes a distinct file path under `governance/blueprint-v2/L{N}-*.md`.
23. Each SA reads its `workspace/L{N}-findings.md`, the sparring-log entries tagged with its layer id, and the ADR set with matching `layer` frontmatter. Output template per `governance/BLUEPRINT-V2.md` §6: frontmatter (`layer_id`, `lean_target_lines`, `serves_pillars`, `decision_refs`); §Identity (what the layer is in v2); §Decisions (linked ADR IDs); §Implementation Contract (what a rebuild agent must produce — file list, frontmatter shape, behaviors); §Lean Target (line count, artifact count, complexity ceiling); §Open Questions (deferred decisions); Pillar Compliance Test.

## Step 7 — Master assembly (1 SA)

24. Dispatch 1 `Task` sub-agent to write `governance/BLUEPRINT-V2.md` (the OUTPUT spec, not THIS prompt). Per `governance/BLUEPRINT-V2.md` §7: one-sentence north-star, the pillar set decided in L02 sparring, layer index with line + decision counts, ADR INDEX cross-link, total artifact-count target (vs v1's 115), lifecycle phases, single-page rebuild kickoff checklist that a Day-1 rebuild agent reads first.

## Step 8 — Quality gates (orchestrator runs inline)

25. Rigor-schema lint on every ADR — 7 fields present; placeholder values (e.g. `confidence_basis: "based on analysis"` without a named basis) blocked.
26. Per-file lean threshold — `wc -l` versus the `lean_target_lines` declared in each layer-doc frontmatter; SKILL.md ≤ 220; layer docs per their declared target; master doc ≤ 850.
27. Anti-slop wordlist scan on every written doc using `.claude/rules/anti-slop-enforcement.md` — 0 hits required.
28. Pillar-coverage matrix — every layer maps to ≥ 1 pillar; every ADR serves ≥ 1 pillar.
29. Cross-layer consistency check — a decision referenced from multiple layer docs has the same ADR id and identical Status.
30. Model-independence scan — grep on all output docs for tier words, vendor or model identifiers, context-window numbers, token-budget references; 0 hits required.
31. Write `workspace/gates.json` capturing every gate result; any failure surfaces to the maintainer in Step 9.

## Step 9 — End-of-Turn Delegation Attestation + Iteration Summary

32. Emit End-of-Turn Delegation Attestation per `rules/hatch3r-agent-orchestration.md` § End-of-Turn Delegation Attestation. Quote each spawning sub-agent's invocation and the `delegation_proof_id` it returned, one row per output file under `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md`.
33. Emit the 5-field Iteration Summary per `rules/hatch3r-iteration-summary.md`: status, outcome, done, not_done, open_questions.
34. STOP. The skill does not commit, push, or merge. The maintainer reviews `workspace/gates.json`, the ADR set, the 12 layer docs, and `governance/BLUEPRINT-V2.md`; commits when satisfied.

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

- **Direct-edit scope:** the skill writes only under `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md`. v1 governance files (CONSTITUTION, VISION, AUDIT, AUDIT-EXECUTE, RE-ENVISION, EVOLVE) remain untouched.
- **Cross-file mutation:** no file outside `governance/blueprint-v2/` and `governance/BLUEPRINT-V2.md` is modified during a run.
- **Anti-slop:** zero tolerance per `.claude/rules/anti-slop-enforcement.md` — gate 27 blocks on any hit.
- **Rigor:** every ADR carries the 7-field YAML header per `governance/audit/templates/rigor-contract.md`; gate 25 blocks on missing or placeholder fields.
- **Model-independence:** zero tier or vendor or model identifiers in output docs — gate 30 blocks on any hit.
- **Fan-out discipline:** 25 SAs total per the `sub_agents_spawned` declaration above; the cost-dominance clause from `.claude/rules/fan-out-discipline.md` forbids serializing the 12 inventory SAs or the 12 doc-writer SAs.
- **B1 default-ask:** every `AskUserQuestion` carries 2-4 numbered options with a declared default-if-no-response per `agents/shared/user-question-protocol.md`.
- **Stop before commit:** the maintainer commits; the skill never does.
