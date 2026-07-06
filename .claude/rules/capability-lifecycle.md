---
id: capability-lifecycle
type: rule
description: Maintainer guidance for selecting the right capability preset and respecting the lifecycle contract during add / refactor / remove.
tags: [maintainer, governance, presets]
scope: always
precedence: normal
---

# Capability Lifecycle

**Pillars:** P4 (Lean Coverage), P5 (Governance Self-Quality)

## Decision tree

Pick the preset that matches the intent before editing any artifact:

| Intent | Preset |
|--------|--------|
| Not sure what exists | `/h4tcher-capability-discover` |
| Quality-check an arbitrary slice | `/h4tcher-scoped-audit <area>` |
| Add a new artifact | `/h4tcher-capability-add` |
| Rename / split / merge / restructure | `/h4tcher-capability-refactor` |
| Phase out an artifact | `/h4tcher-capability-remove` |
| Interactive governance evolution (corpus scan + research + full-coverage discussion + rewrite with per-file consent) | `/h4tcher-evolve` |
| Full framework audit cycle | `/h4tcher-audit-cycle` |
| Regenerate the hatch3r docs site from this repo's corpus | `/h4tcher-docusaurus-generator` |

When in doubt, run `/h4tcher-capability-discover` first — it is the only read-only lifecycle preset and surfaces duplication risk before any write.

## Maintainer utilities (non-lifecycle)

These `h4tcher-` skills are framework-dev maintainer tools, NOT lifecycle add/refactor/remove presets and NOT delegated-to by the lifecycle presets. Enumerated here so the entire maintainer-skill surface is listed in one place — when a new maintainer-only skill is authored, add a row here (D24-SA24.2-F07 single-enumeration invariant; regression closed under D24-10):

| Skill | Purpose |
|-------|---------|
| `/h4tcher-docusaurus-generator` | Build or refresh the framework's own Docusaurus site (`website/`) from `governance/`, `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, and `docs/`. |
| `/h4tcher-pr-resolve` | Resolve PR comments on the hatch3r repo: run the canonical `hatch3r-pr-resolve` workflow, then apply hatch3r-dev quality gates (validate, rule parity, efficiency, lean thresholds, anti-slop, inventory, pillar compliance) and stop before commit. |
| `/h4tcher-release-prep` | Prepare a hatch3r release: version bump, changelog completeness + sync, repo + website docs currency, quality gates, adapter-output verification, release-notes reconciliation with CI. |

## Removal threshold

Source of truth: `governance/audit/domains/D16-compound-system.md` §16.3 "Removal candidate threshold" (SA 16.3 Artifact Inventory & Redundancy). An artifact qualifies for removal only when ALL three hold:

1. Zero unique value beyond an existing artifact
2. Class-aware reachability fails — a flat cross-reference count mis-fires on entry-point and by-construction classes, so the test is per class:
   - **agents** — zero `agentPipeline:` id-occurrences across `commands/hatch3r-*.md`.
   - **skills + commands** — NOT an entry point: absent from `AGENT_COMMAND_NAMES` (`src/cli/program.ts:45`) AND not emitted by any adapter AND not on the CLAUDE.md user surface. Skills/commands are user-typed leaf nodes; zero functional consumers is their correct state and never alone implies removability.
   - **rules** — neither `scope: always` nor a glob matching a repo path; glob/always rules are reachable by construction.
3. No orchestrator dependency in any `commands/hatch3r-*.md` `agentPipeline:`

Default recommendation when overlap is detected is merge via `/h4tcher-capability-refactor`, not removal (D16.3 add-vs-remove bias check). Removal requires the threshold above and a documented rejected merge alternative.

## Cross-skill delegation

Each lifecycle preset delegates body authoring to the matching author skill — the preset sets up context, the author skill writes the artifact:

| Artifact type | Delegate to |
|---------------|-------------|
| agent / skill / rule / command / hook | `h4tcher-content-author` |
| adapter (`src/adapters/`) | `h4tcher-adapter-author` |
| audit domain (`governance/audit/domains/`) | `h4tcher-domain-author` |

Pipeline modules under `src/merge/`, `src/content/`, `src/pipeline/` have no canonical author skill — preset runs inline and flags for future skill coverage.

## Gate checklist

Before declaring lifecycle work complete, run every gate below — orchestrator stops before commit and surfaces failures to the maintainer:

- Anti-slop scan: zero hits from the wordlist in `.claude/rules/anti-slop-enforcement.md`
- Pillar compliance test per `.claude/rules/pillar-compliance.md`
- Lean thresholds per `.claude/rules/governance-lean-thresholds.md`
- `npm run inventory` regenerates `governance/inventory.json`; diff committed
- `npm run validate`
- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run validate:rule-parity`
- `npm run validate:efficiency`
- B1 gate present (clarification-default rule applied; user-question-protocol referenced)
- B2 rationale present (sub-agent count + rationale emitted by orchestrator)
- `/h4tcher-evolve` sessions are the authorized governance-edit path — in-session per-file owner consent constitutes CONSTITUTION §8 approval for all governance layers (pillars, §3 matrix, §6 decisions, §8 itself carry an explicit §8-amendment label in the consent ASK); out-of-session changes keep CL-3 / §8-queue routes.
