---
id: content-authoring
type: rule
description: Canonical content authoring contract — required YAML frontmatter, filename prefix, quality charter, duplication check, skill/rule/command format conventions, .md/.mdc rule scope transform.
tags: [maintainer, content, p2, p4]
scope: always
precedence: high
---

# Content Authoring

**Pillars:** P4 (Lean Coverage), P2 (Scientific Quality)

When creating or modifying canonical content artifacts in `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`:

1. **YAML frontmatter required:** `id`, `type` (agent|skill|rule|command|hook|prompt|github-agent), `description`, `tags`
2. **Filename prefix:** `hatch3r-` on all top-level published content files (e.g., `hatch3r-implementer.md`). Exceptions (no prefix required): support/reference content under named support subdirectories — `agents/shared/*`, `agents/modes/*`, `commands/board/*`, `commands/revision/*`, and `checks/*`. These files are companion/reference material, not standalone published artifacts; `src/content/index.ts:610-626` and `src/cli/commands/validate.ts:158-164` already model this split (manifest `managedFiles` excludes these paths from the prefix check).
3. **Quality charter:** Reference or embody standards from `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable criteria
4. **Duplication check:** Before creating a new artifact, search existing artifacts for overlapping coverage. Existing content with overlapping scope is a false positive for "missing content"
5. **Skills format:** `skills/hatch3r-{name}/SKILL.md` directory structure with Quick Start + Step pattern
6. **Rules format:** Produce both `.md` (canonical) and `.mdc` (Cursor) variants. Body bytes must match (checked by `scripts/validate-rule-parity.ts`); frontmatter follows the scope transform below.
7. **Pillar alignment:** Every artifact must serve at least one Binding Pillar (P1-P8). Document which
8. **Commands — orchestrator marker (C8-D5-M1):** every file in `commands/hatch3r-*.md` MUST declare `orchestrator: true|false` in frontmatter. When `orchestrator: true`, add `agentPipeline: [hatch3r-agent-1, hatch3r-agent-2, ...]` listing every hatch3r-* sub-agent the command delegates to via the Task tool. Commands classified as `orchestrator: false` (inline-execution: customize commands, hooks, learn, release, recipe, board-init/groom/refresh/shared, healthcheck, security-audit, dep-audit, context-health, cost-tracking) omit `agentPipeline`. `board-fill` is `orchestrator: true` because Step 7.9 delegates to `hatch3r-reviewer` and `hatch3r-fixer` via the Task tool. Enforced by `src/cli/commands/validate.ts::validateCommandOrchestratorFrontmatter`: a missing marker is a warning; `orchestrator: true` without `agentPipeline`, an empty array, or non-boolean `orchestrator` is a validation error.

## Rule Scope Transform (`.md` -> `.mdc`)

Canonical `.md` files declare rule scope using one of three frontmatter shapes. The corresponding `.mdc` frontmatter is deterministic.

| `.md` shape | `.mdc` frontmatter |
|-------------|--------------------|
| `scope: always` | `alwaysApply: true` (no `globs`) |
| `scope: "<g1>,<g2>,..."` (CSV string) | `globs: ["<g1>", "<g2>", ...]` + `alwaysApply: false` |
| `scope: conditional` + `globs: "<g1>,<g2>,..."` | `globs: ["<g1>", "<g2>", ...]` + `alwaysApply: false` |
| `scope: conditional` with no `globs:` (deprecated rules) | `alwaysApply: false` (no `globs`) |

Precedence (`precedence: critical|high|normal|low`, optional, default `normal`) is passed through to `.mdc` unchanged. Validated by `scripts/validate-rule-parity.ts`.

Enforced by `scripts/validate-rule-parity.ts` (CI gate via `npm run validate:rule-parity`):
- Every `.mdc` has a `description:` field matching the `.md` `description:`.
- `.mdc` files with `globs` carry `alwaysApply: false`.
- `.mdc` `globs` is a JSON array of quoted strings (no bare CSV).
- The set of globs on the `.mdc` side equals the set derived from the `.md` side via the transform above.

## Rule Precedence Ranks and Assignment Policy

Canonical `.md` rule frontmatter supports `precedence: critical|high|normal|low` (default `normal`). Adapters consume this field as the `NN-` filename prefix and ordering signal on every per-file rule emission (`src/adapters/canonical.ts::sortByPrecedence`).

| Precedence | Rank | Filename prefix | Assignment policy |
|------------|-----:|-----------------|-------------------|
| `critical` | 100 | `10-` | Security and secrets rules — `hatch3r-security-patterns`, `hatch3r-secrets-management`, and any future rule with equivalent blast radius |
| `high` | 300 | `30-` | Rules implementing CONSTITUTION §2 P2 hard-mandate floors (supply-chain, observability, migrations, API versioning, AI evals, accessibility, container hardening, dependency management, resilience patterns, design-system detection, ux-states-and-flows) AND framework-dev gatekeeper rules under `.claude/rules/` (pillar-compliance, governance-lean-thresholds, anti-slop-enforcement, security-patterns, content-authoring, test-requirements) AND pre-existing pipeline-protocol rules (agent-orchestration, iteration-summary, handoff-readiness, clarification-default, fan-out-discipline) |
| `normal` | 500 | `50-` | Default. Cosmetic/style rules — theming, i18n, commit conventions, doc style |
| `low` | 700 | `70-` | Deprecation hawks awaiting removal |

The `.mdc` twin inherits `precedence` unchanged from the `.md` source. `scripts/validate-rule-parity.ts` (CI gate `npm run validate:rule-parity`) verifies parity across all rule pairs. D05 audits enforce assignment-policy compliance per cycle.

D05 audit checklist (prompt engineering quality): `governance/audit/domains/D05-prompt-engineering.md`
