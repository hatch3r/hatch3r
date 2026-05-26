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
| Holistic governance re-think (vision + pillars + audit + execution + lean + charters + anti-slop + closed-loop) | `/h4tcher-re-envision` |
| Full framework audit cycle | `/h4tcher-audit-cycle` |

When in doubt, run `/h4tcher-capability-discover` first — it is the only read-only lifecycle preset and surfaces duplication risk before any write.

## Removal threshold

Source of truth: `governance/audit/domains/D16-compound-system.md:59` (SA 16.3 removal candidate threshold). An artifact qualifies for removal only when ALL three hold:

1. Zero unique value beyond an existing artifact
2. ≤1 cross-reference from other artifacts
3. No orchestrator dependency in any `commands/hatch3r-*.md` `agentPipeline:`

Default recommendation when overlap is detected is merge via `/h4tcher-capability-refactor`, not removal (D16.3 add-vs-remove bias check). Removal requires the threshold above and a documented rejected merge alternative.

## Cross-skill delegation

Each lifecycle preset delegates body authoring to the matching author skill — the preset sets up context, the author skill writes the artifact:

| Artifact type | Delegate to |
|---------------|-------------|
| agent / skill / rule / command / hook | `h4tcher-content-author` |
| adapter (`src/adapters/`) | `h4tcher-adapter-author` |
| audit domain (`governance/audit/domains/`) | `h4tcher-domain-author` |

Pipeline modules under `src/merge/`, `src/integrity/`, `src/content/` have no canonical author skill — preset runs inline and flags for future skill coverage.

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
- `/h4tcher-re-envision` is the only lifecycle preset authorized to direct-edit VISION.md, CONSTITUTION §2 P5 lean-threshold rows, CONSTITUTION §2 Anti-Bloat Principles + Silent Failure Contract, AUDIT.md behavioral charter directive additions/refinements, anti-slop wordlist (atomic pair with CLAUDE.md), EVOLVE.md prompt mechanics, quality-charter, user-question-protocol, and CLAUDE.md cross-references — per-file consent required at §6.1; CONSTITUTION pillars/traceability/§8/Key Design Decisions remain §8 framework-owner direct edit via queued proposals.
