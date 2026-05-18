---
name: h4tcher-re-envision
description: Holistic governance sparring engine — scans every governance layer in parallel via 10 sub-agents, surfaces drift, runs interactive 20-theme sparring dialog, and routes proposals via hybrid edit authority (direct-edit with per-file consent / CL-3 / CONSTITUTION §8 amendment). Run occasionally to bring the governance corpus to one consistent state.
effort: max
allowed-tools: Read Grep Glob Bash(*) Write Edit Agent WebSearch WebFetch
---

# Re-Envision

Invoke the hatch3r holistic governance sparring engine defined in `governance/RE-ENVISION.md`. Distinct from `/h4tcher-governance-check` (read-only validation) and `/h4tcher-audit-cycle` (framework-output audit): this is the only lifecycle preset that direct-edits VISION, lean thresholds, charters, and anti-slop wordlists with per-file consent, and emits CL-3 + §8 amendment queues for the rest.

## Pre-Flight

1. Ask the user (P8 ambiguity gate per `agents/shared/user-question-protocol.md`):
   - **Mode:** `full-rethink` (all 10 layers, ~20 themes, 90-180 min) / `occasional-check` (layers touched by recent commits or last EVOLVE Route A findings, ~8-10 themes) / `targeted-layer:<layer>` (single layer, single-theme dialog + alignment sweep)
   - **Cadence:** confirm ≥14 days since last RE-ENVISION run; override only on Critical security incident or BLOCK audit verdict
2. Read `governance/RE-ENVISION.md` fully — authoritative protocol
3. Read `governance/CONSTITUTION.md` §2 for the 8 Binding Pillars + lean thresholds
4. Read `governance/EVOLVE-REPORT.md` if present; stage Route A proposals as pre-seeded findings tagged `source: evolve-route-a`

## Setup

5. Create `.re-envision-workspace/` at repo root (gitignored per `.gitignore`)
6. Write `.re-envision-workspace/inventory.json` per `governance/RE-ENVISION.md` §1.2

## §2 Parallel Drift-Detection Fan-Out (10 sub-agents)

7. Sub-agent count + rationale (P8 Behavioral Charter directive 17 first-class output):
   - **count:** 10
   - **rationale:** Ten governance layers = ten distinct authority boundaries with non-overlapping rigor profiles; consolidating creates layer-blind synthesis; expanding creates overlap.
8. Launch all 10 layer sub-agents in parallel per `governance/RE-ENVISION.md` §2.1: L1 VISION · L2 CONSTITUTION-Pillars · L3 CONSTITUTION-LeanThresholds+AntiBloat · L4 CONSTITUTION-Traceability+Amendment+Decisions · L5 AUDIT · L6 AUDIT-EXECUTE · L7 TEMPLATES · L8 DOMAINS · L9 CHARTERS · L10 ANTI-SLOP+EVOLVE/RE-ENVISION-boundary
9. Each sub-agent writes `.re-envision-workspace/L{N}-{layer}.findings.md` with YAML rigor-schema header per `governance/audit/templates/rigor-contract.md`
10. Wait for all 10 sub-agents; build `.re-envision-workspace/synthesis.md`; release per-SA findings from context (AUDIT.md Result Management Protocol pattern)

## §3 Synthesis & Triage

11. Dedup vs `governance/audit/finding-registry.json` open entries + EVOLVE Route A pre-seeded findings using 2-of-3 signal match (file + root cause + recommendation)
12. Enforce rigor contract: 7 fields per finding or reject
13. Present severity-tagged triage table; ASK to proceed (hard-stop)

## §4 Sparring Dialog (20 themes)

14. Walk one theme block at a time per `governance/RE-ENVISION.md` §4.1–§4.20; never batch themes
15. Each theme: present current state + drift findings + branching ASK with declared default; wait for explicit response before advancing
16. §4.99 cross-layer concerns sweep ASK

## §5 Refinement Plan Assembly

17. Route each approved proposal to direct-edit / CL-3 / §8 per `governance/RE-ENVISION.md` §5.1 edit-authority matrix
18. Present 3 batched ASKs (one per route bucket); hard-stop per bucket

## §6 Action Execution

19. Direct-edit pass: per-file ASK hard-stop → on consent, delegate to a fresh sub-agent for multi-file proposals (orchestrator-never-edits pattern from AUDIT-EXECUTE.md Guardrail 18) → inline `wc -l` lean-threshold check vs CONSTITUTION §2 P5 → inline anti-slop wordlist grep
20. CL-3 emit: write `.re-envision-workspace/cl-3-handoff.md` in AUDIT.md CL-3 Output table format
21. §8 amendment emit: write `.re-envision-workspace/constitution-amendment-queue.md` with pre-populated dated rationale

## §7 Downstream Alignment Sweep

22. Cross-reference scrubbing on modified files via `grep -l <filename>` across `governance/` and `CLAUDE.md`
23. Pillar coverage redraw when pillar references changed
24. EVOLVE Route A closure log appended to `.re-envision-workspace/evolve-route-a-closure.md` (informational; EVOLVE-REPORT.md remains untouched)
25. Instruct user to run `npm run inventory` and `npm run validate:rule-parity`

## §8 Summary

26. Per-route run summary: counts per route + per layer
27. Next actions: when to invoke `/h4tcher-audit-cycle` or `/h4tcher-audit-execute` Phase 7
28. STOP — do not invoke downstream prompts (Guardrail 18)

## Quality Gates

- Lean-threshold check per modified file via `wc -l` vs CONSTITUTION §2 P5
- Anti-slop scan per modified file using the wordlist from AUDIT-EXECUTE.md regression gate 11 + CLAUDE.md §Anti-Slop Wordlist
- Pillar Compliance Test per proposal: 4 questions per CONSTITUTION §2
- 5 hard-stop ASK gates: §0.3 mode, §1.5 scope, §3.4 pre-dialog, §5.3 per-route batch, §6.1 per-file
- P8 ambiguity gate at §0.1 referencing `agents/shared/user-question-protocol.md`
- Sub-agent count + rationale emitted at §2.0
