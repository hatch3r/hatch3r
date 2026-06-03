# Content Maturity Tiers

> **Last verified**: 2026-06-03 | **hatch3r version**: 2.0.0

hatch3r scales the canonical artifacts it installs to a project's operational maturity. A solo hobby repo gets the core agentic pipeline and the security floor; an enterprise repo additionally gets FinOps accounting, AI-eval governance, and extensibility review. The maturity tier is one knob, set once at init, that gates which `tier:*`-tagged artifacts pass content selection.

This is the human-readable companion to the per-artifact `tier:*` frontmatter tags. The machine contract is `isAdmittedByMaturityTier` (`src/content/index.ts:86`), Stage 6 of `resolveSelection`.

---

## The four tiers

`MATURITY_TIERS = ["solo", "team", "scaleup", "enterprise"]` (`src/types.ts:17`). Default is `solo` (`src/types.ts:20`). Tiers are rank-ordered by array index via `MATURITY_TIER_RANK` (`src/types.ts:29-31`): `solo=0`, `team=1`, `scaleup=2`, `enterprise=3`. A higher tier admits every lower-tier artifact plus its own — admission is rank-based, not exact-match.

| Tier | Rank | Tag to opt in | Admits |
|------|:----:|---------------|--------|
| `solo` | 0 | *(none — default)* | solo content only |
| `team` | 1 | `tier:team-plus` | solo + team |
| `scaleup` | 2 | `tier:scaleup-plus` | solo + team + scaleup |
| `enterprise` | 3 | `tier:enterprise-only` / `floor:enterprise-only` | every artifact |

Set the tier at init:

```
hatch3r init --maturity team
```

(`src/cli/program.ts:101`). It persists to `.hatch3r/hatch.json` under the `maturity` field and is changed later with `hatch3r config maturity=<tier>` (`src/cli/program.ts:224`).

---

## Admission tags and their minimum tier

An artifact opts into a tier by carrying ONE `tier:*` tag. The tag-to-minimum-tier map is `TIER_TAG_REQUIREMENTS` (`src/content/index.ts:53-58`):

| Tag | Minimum tier | Dropped when project rank is below |
|-----|--------------|-------------------------------------|
| `tier:team-plus` | `team` (1) | solo |
| `tier:scaleup-plus` | `scaleup` (2) | solo, team |
| `tier:enterprise-only` | `enterprise` (3) | solo, team, scaleup |
| `floor:enterprise-only` | `enterprise` (3) | solo, team, scaleup |

`floor:enterprise-only` is an alias spelling used in the bucket spec, treated identically to `tier:enterprise-only` (`src/content/index.ts:39-41`). An artifact carrying no `tier:*` tag is admitted at every maturity — `solo` is the default and carries no tag.

---

## How the gate runs

`isAdmittedByMaturityTier(itemTags, maturity, isProtected)` (`src/content/index.ts:86-100`) executes as Stage 6 of the seven-stage `resolveSelection` pipeline (`src/content/index.ts:792-794`, applied at `:934`). For each tier tag the artifact carries, the gate drops the artifact when the project's rank is below the tag's minimum-tier rank (`src/content/index.ts:93-98`).

Two bypass rules:

- **`protected: true` bypasses the gate.** Protected items return early at `src/content/index.ts:91` and always ship — the orchestration pipeline (architect → researcher → planner → implementer → reviewer → fixer) is protected, so it installs at every tier including solo.
- **Floor tags do NOT bypass the tier gate.** Only `protected` does. A floor-tagged artifact (e.g. `floor:security`) is admitted unconditionally by Stage 2 floor admission (`src/content/index.ts:774-776`), but it can still carry a `tier:*` tag to gate *which* maturity gets it. So a floor item and a tier item are independent decisions: floor governs "ships regardless of preset"; tier governs "ships regardless of maturity".

---

## Tagging convention

Append the tier tag AFTER the artifact's capability tag(s). The FIRST tag (`tags[0]`) stays a capability tag — the custom-content picker groups each artifact under `tags[0]` as its primary classification (`src/cli/shared/customContentChoices.ts:50`). Leading with a `tier:*` tag would mis-group the artifact.

```yaml
# correct — capability primary, tier appended
tags: [ui, design-system, tier:team-plus]

# wrong — tier as primary mis-groups the picker entry
tags: [tier:team-plus, ui]
```

---

## The rubric: what ships at each tier

### solo (no tag) — the foundational solo-developer workflow

Most of the corpus. The core agentic pipeline (architect, researcher, planner, implementer, reviewer, fixer, docs-writer, devops basics, lint-fixer, ci-watcher), the security floor (security review is universal), the lifecycle commands (`init`, `sync`, `status`, `diagnose`, `config`), and the universal rules. A solo developer gets a working pipeline with no team-coordination or compliance overhead.

### team-plus — shared codebase, two or more contributors

Presupposes a shared repo. Artifacts that only pay off with multiple contributors:

- Design-system consistency (the `ui` specialist)
- Maintainability / duplication discipline (the `maintainability` specialist)
- Capability matrices and team conventions
- Basic observability
- Project-board management and cross-person handoffs
- Dependency governance and third-party pack installation
- Auth scaffolding for a multi-user service

### scaleup-plus — production-scale operations

Production load and formal review processes:

- Performance budgets (the `performance` specialist)
- Scalability patterns (the `scalability` specialist)
- Reliability / SLO engineering (the `reliability` specialist)
- UX research (the `ux` specialist)
- Incident response
- Containerization / deployment
- Telemetry and database migrations

### enterprise-only — org governance, compliance, FinOps

Regulated environments with full audit posture:

- Advanced testability and AI-eval coverage (the `testability` specialist)
- Enhancability / extensibility governance (the `enhancability` specialist)
- Cost accounting / FinOps
- AI-feature governance
- Agentic CI workflows

---

## CQ specialist agents by tier

The nine content-quality specialist agents (CONSTITUTION §2B, files at `agents/hatch3r-{ui,ux,security,reliability,scalability,performance,maintainability,testability,enhancability}.md`) map to tiers by where their concern first matters:

| Specialist | File | Tier |
|------------|------|------|
| security | `agents/hatch3r-security.md` | solo (floor — universal) |
| ui | `agents/hatch3r-ui.md` | team |
| maintainability | `agents/hatch3r-maintainability.md` | team |
| ux | `agents/hatch3r-ux.md` | scaleup |
| reliability | `agents/hatch3r-reliability.md` | scaleup |
| scalability | `agents/hatch3r-scalability.md` | scaleup |
| performance | `agents/hatch3r-performance.md` | scaleup |
| testability | `agents/hatch3r-testability.md` | enterprise |
| enhancability | `agents/hatch3r-enhancability.md` | enterprise |

Security is the floor specialist: it ships at every tier because security review is universal. The remaining eight gate by the maturity at which their concern starts to bind.

---

## How to choose your tier

Start at `solo`. Raise the tier when a concrete need appears, not pre-emptively:

- **Add a second contributor** → `team`. You now want duplication discipline, handoffs, board management, and design-system consistency.
- **Ship to production load** → `scaleup`. Performance budgets, SLOs, incident response, and migrations start to bind.
- **Operate under org governance / compliance / FinOps** → `enterprise`. Cost accounting, AI-eval coverage, and extensibility governance become requirements.

Raising the tier is non-destructive: it only admits more artifacts (higher rank admits all lower-tier content per `MATURITY_TIER_RANK`). Run `hatch3r config maturity=<tier>` then `hatch3r sync` to materialize the newly-admitted content.
