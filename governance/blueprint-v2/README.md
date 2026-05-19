# blueprint-v2 workspace

> Last updated: 2026-05-19

## Purpose

This directory holds the v2.0.0 clean-slate rebuild specification that `/h4tcher-blueprint-v2` produces — the master `BLUEPRINT-V2.md`, the 12 per-layer docs, and the ADR set captured during the sparring dialog. It does NOT modify any v1 governance artifact (CONSTITUTION, VISION, AUDIT, AUDIT-EXECUTE, RE-ENVISION, EVOLVE remain the v1 source of truth until v2 ships).

## Directory layout

```
governance/blueprint-v2/
  README.md                       # this file
  workspace/                      # transient state for an in-flight run
    .gitkeep
    preflight.json                # mode + scope + started_at + layer_completion_map
    L01-findings.md ... L12-findings.md
    synthesis.md
    sparring-log.md
    gates.json
  decisions/                      # ADR registry — one file per accepted decision
    INDEX.md
    D-001-<slug>.md
    ...
  L01-identity-and-vision.md      # 12 layer docs emitted by Step 6
  L02-pillar-set.md
  L03-adapter-pool.md
  L04-project-shape-axes.md
  L05-tool-integration.md
  L06-content-classes.md
  L07-lifecycle-cli.md
  L08-content-packs.md
  L09-pipeline-runtime.md
  L10-docs-surface.md
  L11-governance-heart.md
  L12-migration-story.md
```

The master spec `governance/BLUEPRINT-V2.md` sits one level up from this directory and is emitted by Step 7.

## State files

| File | Written by | Purpose | Lifecycle |
|------|------------|---------|-----------|
| `workspace/preflight.json` | Step 1 (orchestrator) | mode, scope, started_at, layer_completion_map | persistent across the run; cleared only by an explicit `overwrite` choice |
| `workspace/L{N}-findings.md` | Step 2 SAs | per-layer v1 inventory + ≥2-source web research with rigor-schema YAML header | persistent — feeds Step 3 synthesis and Step 6 layer-doc writers |
| `workspace/synthesis.md` | Step 3 (orchestrator) | cross-layer drift table + lean-opportunity register + must-rethink ranking | persistent — anchors the §4 sparring matrix walk |
| `workspace/sparring-log.md` | Step 4 (orchestrator) | chronological dialog transcript — one entry per theme with timestamp, options, choice, rationale | persistent — Step 6 doc-writer SAs read it filtered by layer id |
| `workspace/gates.json` | Step 8 (orchestrator) | per-gate pass/fail record for rigor lint, lean thresholds, anti-slop scan, pillar coverage, cross-layer consistency, model-independence | persistent — surfaced to maintainer in Step 9 |

## Resume protocol

1. Maintainer invokes `/h4tcher-blueprint-v2` with `mode=resume`.
2. Step 0 reads `workspace/preflight.json` + `workspace/sparring-log.md` and recomputes `layer_completion_map`.
3. Step 4 jumps to the next pending theme — already-decided themes are skipped without re-asking.
4. If `preflight.json` is absent, the skill prompts the maintainer (B1 ambiguity gate) for a fresh `full` or `targeted-layer:LNN` start.

## ADRs

ADRs land under `decisions/` with filenames `D-NNN-<kebab-slug>.md`. `decisions/INDEX.md` is the auto-maintained registry — Step 5 appends one row per accepted decision and assigns the next monotonic `D-NNN` id at capture time.

## Output

After Steps 5-7 complete, the artifacts that land outside `workspace/`:

- `governance/blueprint-v2/decisions/D-NNN-*.md` — one ADR per accepted decision.
- `governance/blueprint-v2/L{N}-*.md` — 12 per-layer specification docs.
- `governance/BLUEPRINT-V2.md` (sibling of this directory) — the master cross-cutting spec a rebuild agent reads first.

`workspace/` itself stays as the persistent run history — useful for audits of how a v2 decision was reached and for `mode=resume` re-entry on a paused run.
