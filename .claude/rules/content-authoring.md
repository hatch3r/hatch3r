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
2. **Filename prefix:** `hatch3r-` on all top-level published content files (e.g., `hatch3r-implementer.md`). Two exception classes (no prefix required):
   - **2a — Support/companion subdirectories:** `agents/shared/*`, `agents/modes/*`, `commands/board/*`, `commands/revision/*`. These files are reference/companion material consumed by a parent artifact, not standalone published artifacts.
   - **2b — First-class artifact classes with class-internal naming:** `checks/*` (e.g., `checks/{accessibility,code-quality,performance,security,testing}.md`). These ARE a published artifact class (`type: check`, counted in `governance/inventory.json`) but use a class-internal naming convention instead of the `hatch3r-` prefix.

   Both classes are excluded from the prefix check; `src/content/index.ts:610-626` and `src/cli/commands/validate.ts:158-164` model the split (manifest `managedFiles` excludes these paths).
3. **Quality charter:** Reference or embody standards from `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable criteria
4. **Duplication check:** Before creating a new artifact, search existing artifacts for overlapping coverage. Existing content with overlapping scope is a false positive for "missing content"
5. **Skills format:** `skills/hatch3r-{name}/SKILL.md` directory structure with Quick Start + Step pattern
6. **Rules format:** Produce both `.md` (canonical) and `.mdc` (Cursor) variants. Body bytes must match (checked by `scripts/validate-rule-parity.ts`); frontmatter follows the scope transform below.
7. **Pillar alignment:** Every artifact must serve at least one Binding Pillar (P1-P8). Document which
8. **Commands — orchestrator marker (C8-D5-M1):** every file in `commands/hatch3r-*.md` MUST declare `orchestrator: true|false` in frontmatter. When `orchestrator: true`, add `agentPipeline: [hatch3r-agent-1, hatch3r-agent-2, ...]` listing every hatch3r-* sub-agent the command delegates to via the Task tool. `board-fill` is `orchestrator: true` because Step 7.9 delegates to `hatch3r-reviewer` and `hatch3r-fixer` via the Task tool. Enforced by `src/cli/commands/validate.ts::validateCommandOrchestratorFrontmatter`: a missing marker is a warning; `orchestrator: true` without `agentPipeline`, an empty array, or non-boolean `orchestrator` is a validation error.
9. **Command vs Skill — authoring criterion (Decision #13):** a new artifact is a **command** ONLY when it orchestrates ≥1 hatch3r-* sub-agent via the Task tool (`orchestrator: true` + non-empty `agentPipeline`). Every other user-invocable workflow — single-pass procedures, dispatchers, inline-execution flows — MUST be authored as a **skill** (`skills/hatch3r-{name}/SKILL.md`). A `commands/hatch3r-*.md` file with `orchestrator: false` is a structural error: either promote it to `orchestrator: true` by spawning a sub-agent, or collapse it into the matching skill and delete the command shell. Validation gate to be added to `src/cli/commands/validate.ts` per `governance/inventory.json` drift probes.
10. **Reputable-source reconnaissance (Decision #14):** before writing body content for a new agent, skill, or rule, web-research ≥2 independent reputable sources (official vendor documentation, established agent/skill libraries with named maintainers, peer-reviewed methodology) ≤12 months old per `governance/audit/templates/rigor-contract.md`. Synthesize patterns; never copy verbatim. Record sources in a `## References` section at the bottom of the new artifact with URL + access date + trust tier. Skip for trivial edits (typo, frontmatter-only, single-line clarification).
11. **"sub-agent" casing convention:** use `sub-agent` (lowercase, hyphenated) in prose and headings (e.g., `## Sub-agent delegation`); use `sub_agents_spawned` (underscore) for the YAML output field per the Required Finding Output Schema. Never write `Sub-Agent` Title Case or `subagent` (closed form). `governance/AUDIT.md`, `governance/AUDIT-EXECUTE.md`, and the audit domain files set the lowercase-hyphen majority dialect; new artifacts and heading rewrites follow it.

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

The `.mdc` twin inherits `precedence` unchanged from the `.md` source. `scripts/validate-rule-parity.ts` (CI gate `npm run validate:rule-parity`) verifies `.md`/`.mdc` precedence parity across all rule pairs. The framework-dev gatekeeper enumeration in the `high`-precedence row above is an informational prose list, hand-maintained — it is not derived from or machine-cross-checked against the on-disk `precedence:` frontmatter. D05 audits review assignment-policy compliance per cycle by reading the rule frontmatter directly.

D05 audit checklist (prompt engineering quality): `governance/audit/domains/D05-prompt-engineering.md`
