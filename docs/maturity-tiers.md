# Maturity Tiers (Investment-Calibration Dial)

> **Last verified**: 2026-06-03 | **hatch3r version**: 2.0.0

Maturity is a single knob, set once at init, that **calibrates investment depth** — how much robustness, scalability, testing, and infrastructure the agents build for the project. It does **not** filter, gate, or remove any content: **every tier installs the same full corpus**. A solo repo and an enterprise repo receive the identical set of agents, skills, rules, commands, and checks; the tier only tells the agents how deep to invest in each concern, anchored by a universal floor that never relaxes.

The machine contract is `readMaturityTier` (`src/manifest/hatchJson.ts:879`), which resolves the persisted tier (absent → `solo`), plus the adapter header that stamps the tier and a calibration directive into every generated artifact (`src/adapters/cursor.ts`, `src/adapters/copilot.ts`), plus the always-on rule `rules/hatch3r-right-sizing.md` that tells agents to right-size against that tier. There is no admission gate — `tier:*` tags and the former Stage-6 selection check were removed in 2.x (see "What changed (2.x)" below).

---

## The four tiers

`MATURITY_TIERS = ["solo", "team", "scaleup", "enterprise"]` (`src/types.ts:17`). Default is `solo` (`src/types.ts:20`). Tiers are rank-ordered by array index via `MATURITY_TIER_RANK` (`src/types.ts:29-31`): `solo=0`, `team=1`, `scaleup=2`, `enterprise=3`. The rank no longer admits or withholds content — every tier installs the same corpus — it now orders the calibration ladder: a higher rank means deeper investment, more review rigor, and stricter user-content gates.

| Tier | Rank | Calibration at this tier |
|------|:----:|--------------------------|
| `solo` | 0 | Universal floor only. Ship the smallest thing that is correct, secure, accessible, and tested on its changed surfaces. Minimal review rigor; user-content gates run in gentle (warn-only) mode. |
| `team` | 1 | + shared-codebase discipline: duplication control, design-system reuse, structured logging. User-content gates promote from gentle to strict (block on violation). |
| `scaleup` | 2 | + production-operations depth: SLOs, distributed tracing, performance budgets, idempotency/back-pressure on mutating writes. Strict gates plus production-readiness review. |
| `enterprise` | 3 | + org-governance depth: full mutation/property/contract testing, AI-eval coverage, extensibility governance, FinOps. The deepest column — today's absolute audit thresholds. |

Set the tier at init:

```
hatch3r init --maturity team
```

(`src/cli/program.ts:101`). It persists to `.hatch3r/hatch.json` under the `maturity` field and is changed later with `hatch3r config maturity=<tier>` (`src/cli/program.ts:224`).

---

## What changed (2.x)

Earlier 2.0.0 drafts modeled maturity as a content-admission gate: `tier:*` tags on artifacts and a Stage-6 selection check (`isAdmittedByMaturityTier`) caused lower tiers to install *fewer* artifacts. That inverted the intent — a solo or startup repo never received the reliability, scalability, testability, or AI-eval content that matters to any software project.

2.x removes the gate entirely:

- The `tier:team-plus` / `tier:scaleup-plus` / `tier:enterprise-only` admission tags are **gone** from every artifact, and the `tier` tag facet was removed from `src/content/tags.ts`.
- The Stage-6 admission check and the `maturity` option on `resolveSelection` are removed; selection is now **tier-invariant** (every tier resolves the identical artifact set).
- Maturity is **calibration-only**: it sets investment depth via the adapter header and `rules/hatch3r-right-sizing.md`, and it tightens user-content gates at `team`+.

Existing installs are unaffected by the model change: because selection is tier-invariant, no artifact is added or removed when you run `sync` after upgrading. Relevance still comes from the unchanged `ctx:*` / `lang:*` / conditional-`scope` axes (for example, team-only artifacts are still gated by `ctx:team-only` + `--team-size`, independent of maturity).

---

## How the dial reaches the agent

There is no selection gate to run. The tier travels to the agent through four steps:

1. **Resolve the tier.** `readMaturityTier(manifest)` (`src/manifest/hatchJson.ts:879`) reads `.hatch3r/hatch.json` → `maturity`; an absent or out-of-enum value collapses to `solo` (`DEFAULT_MATURITY_TIER`, `src/types.ts:20`).
2. **Stamp it into every artifact.** Each adapter prepends the resolved tier plus a calibration directive to every generated artifact — Cursor via `cursorMaturityHeader` (`src/adapters/cursor.ts`, a `<!-- hatch3r: right-size to maturity=<tier>… -->` comment), Copilot via the managed-block blockquote (`src/adapters/copilot.ts`, `> hatch3r: right-size to maturity=<tier>…`). This is the fastest, most authoritative signal at agent runtime.
3. **Right-size against it.** The always-on rule `rules/hatch3r-right-sizing.md` (`scope: always`, `precedence: high`, `floor:content-quality`) instructs agents to invest only as deep as the tier needs, names the universal floor that never relaxes, and carries the tier → depth ladder. It ships at every tier (including solo) because it is a content-quality floor artifact.
4. **Tighten user-content gates.** `src/content/userContent.ts:576-580` reads the same tier rank and promotes selected user-content checks from gentle (warn-only) at `solo` to strict (block-on-violation) at `team`+ — higher tier means stricter authoring rigor. This is the one place the dial changes runtime behavior beyond the advisory directive.

---

## What each tier calibrates

All tiers ship the same corpus. The buckets below are **recommended investment posture** — the depth the agents build to at each tier — not install deltas. They mirror the tier → depth ladder in `rules/hatch3r-right-sizing.md`; every concern is present at every tier, just at a shallower depth lower down the ladder.

The **universal floor** binds at every tier including solo and never relaxes: **security · correctness & data integrity · accessibility basics · baseline tests on changed surfaces**. No calibration choice may drop below it.

### solo — universal floor only

Ship the smallest thing that is correct, secure, accessible, and tested on its changed surfaces. The full agentic pipeline (architect, researcher, planner, implementer, reviewer, fixer, docs-writer, devops basics, lint-fixer, ci-watcher), all nine CQ specialists, and every rule are installed — agents simply keep them minimal and dormant where the project does not yet need depth. No speculative abstraction, no infra a single author cannot operate.

### team — shared-codebase discipline

Build for a shared repo. Depth added on top of the floor:

- Duplication control and design-system reuse (`maintainability`, `ui` specialists invest here)
- Structured logging with correlation ids
- ADRs on genuine architectural decisions (not trivia), capability matrices, team conventions
- Project-board management and cross-person handoffs
- User-content gates run in strict mode

### scaleup — production operations

Build for production load. Depth added:

- SLOs defined and distributed tracing on the request path (`reliability` specialist)
- Performance budgets (`performance` specialist) and scalability patterns — statelessness, idempotency, back-pressure on mutating writes (`scalability` specialist)
- UX research depth (`ux` specialist)
- An incident-response path, containerization/deployment, telemetry, database migrations

### enterprise — org governance

Build to the deepest column — today's absolute audit thresholds. Depth added:

- Full mutation / property / contract testing and AI-eval coverage (`testability` specialist)
- Extensibility / enhancability governance (`enhancability` specialist)
- FinOps cost attribution, AI-feature governance, agentic CI workflows

---

## CQ specialist agents by tier

All nine content-quality specialist agents (CONSTITUTION §2B, files at `agents/hatch3r-{ui,ux,security,reliability,scalability,performance,maintainability,testability,enhancability}.md`) install at **every** tier now. The column below is advisory **calibration emphasis** — the tier at which each concern's depth starts to bind — not an install condition. Each specialist carries a `## Tier calibration` ladder whose solo column equals the universal floor and whose enterprise column equals its absolute audit threshold.

| Specialist | File | Tier where this concern's depth starts to bind |
|------------|------|------------------------------------------------|
| security | `agents/hatch3r-security.md` | solo (auth/secrets/correctness floor binds in full at every tier; only supply-chain/governance depth scales) |
| ui | `agents/hatch3r-ui.md` | team |
| maintainability | `agents/hatch3r-maintainability.md` | team |
| ux | `agents/hatch3r-ux.md` | scaleup |
| reliability | `agents/hatch3r-reliability.md` | scaleup |
| scalability | `agents/hatch3r-scalability.md` | scaleup |
| performance | `agents/hatch3r-performance.md` | scaleup |
| testability | `agents/hatch3r-testability.md` | enterprise |
| enhancability | `agents/hatch3r-enhancability.md` | enterprise |

Security is inverted relative to the others: its auth, secrets, and correctness floor binds in full at solo and never relaxes — only supply-chain and governance depth scale up the ladder. The remaining eight invest progressively deeper from the tier shown, while still being present and floor-active at solo.

---

## How to choose your tier

Start at `solo`. Raise the tier when a concrete need appears, not pre-emptively:

- **Add a second contributor** → `team`. You now want duplication discipline, handoffs, board management, and design-system consistency.
- **Ship to production load** → `scaleup`. Performance budgets, SLOs, incident response, and migrations start to bind.
- **Operate under org governance / compliance / FinOps** → `enterprise`. Cost accounting, AI-eval coverage, and extensibility governance become requirements.

Raising the tier does not change which artifacts install — selection is tier-invariant. It raises investment depth, review rigor, and user-content gate strictness (gentle → strict at `team`+). Run `hatch3r config maturity=<tier>` then `hatch3r sync` to restamp the adapter headers with the new tier so the calibration directive in every generated artifact reflects it.
