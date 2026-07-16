---
id: hatch3r-design-system-create
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-ui, hatch3r-ux]
description: "Create a project design system from brand assets or an elicitation dialog — DTCG 2025.10 token emission, 3-tier taxonomy (primitive → semantic → component), OKLCH ramps, dual output design.md + design-tokens.json, gated on WCAG 2.2 AA contrast, 100% theme parity, and 0 dangling aliases."
argument-hint: "[brand-asset-path]"
disable-model-invocation: true
tags: [implementation, ui, design-system, floor:ui-ux]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
plan_gate: true
sub_agents_spawned:
  count: 4
  rationale: One hatch3r-researcher extracts palette + convention seeds from brand assets (Tier 2/3 only); one hatch3r-implementer writes design-tokens.json + docs/design.md + emission targets (all file mutation flows through the implementer per the Mandatory Delegation Directive); hatch3r-ui and hatch3r-ux run in parallel as the two mandatory validation gates — read-only over the same generated files with disjoint checklist rows. Research → implement → gate are the only serialization edges; every alias resolves into one token graph, so generation stays single-implementer by shared-state dependency, never by token cost. Cost-dominance per CONSTITUTION §2 P8.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity. Per-command triggers: (a) neither a brand-asset path nor an explicit request for the elicitation dialog is present; (b) the Step 1 detect verdict is `reuse` — an existing system is in scope and overwriting it is irreversible; (c) theme set undeclared (light + dark pair vs + high-contrast third set per `rules/hatch3r-theming.md`); (d) emission target undeclared (DTCG JSON only vs + Tailwind v4 `@theme` vs + CSS custom properties); (e) brand hue count ambiguous (one primary vs primary + secondary + accent — each hue gets its own ramp). Proceed without asking ONLY when the asset-vs-dialog path, theme set, and emission target are all explicit. B1 directive: `rules/hatch3r-clarification-default.md`.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Detect existing design system | Orchestrator (inline; runs `hatch3r-design-system-detect` skill, read-only) | No | Yes |
| 2. Intake / elicitation + ASK gate | Orchestrator (inline) | No | Yes |
| 3. Brand/asset research | `hatch3r-researcher` | Per asset class | Tier 2/3 only |
| 4. Generate tokens + docs | `hatch3r-implementer` | No — single token graph | Yes |
| 5. Validate CQ1 + CQ2 gates | `hatch3r-ui` + `hatch3r-ux` | Yes | Yes |
| 6. Docs check + Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): Stage 5 runs `hatch3r-ui` and `hatch3r-ux` concurrently — both are read-only over the same generated files, their gate rows are disjoint (contrast/alias/parity vs focus-indicator/target-size), and aggregation is deterministic (union of findings). Stage 3 fans out one researcher per asset class (palette + logo vs screenshot corpus vs Figma/tokens-studio export) when Tier 3 supplies more than one. Stage 4 stays single-implementer: every alias resolves into one token graph — shared mutable state, so the no-parallel-writers condition binds; a dependency edge, not a token-cost serialization.

---

# Design System Create -- Brand Assets or Elicitation Dialog → DTCG Tokens + design.md

Creates a project- or workspace-wide design system from brand assets (logo, brand-color list, screenshots, Figma export, tokens-studio JSON) or, when no assets exist, from a structured elicitation dialog. Dual output: `design-tokens.json` (DTCG Format Module 2025.10 — `$type`/`$value`, `{group.token}` aliases) and `docs/design.md` (principles, palette + OKLCH ramps, taxonomy diagram, theme table, usage examples, embedded Accessibility Report). A run passes only when every blocking row of the Step 5 gate table holds: WCAG 2.2 AA contrast on 100% of semantic fg/bg pairs in every theme, 100% theme parity, 0 dangling aliases, 0 component→primitive direct references.

Use `/hatch3r-design-system-create` when the detect verdict is `create` or `extend`. Use the `hatch3r-design-system-detect` skill alone to inventory an existing system without generating; use the `hatch3r-ui-ux-verify` skill to audit built UI against a system that already exists.

---

## Argument Parsing

Optional positional argument: `<brand-asset-path>` — a file or directory of brand assets.

- If supplied: Step 2 reads assets from that path; the elicitation dialog covers only the intake fields the assets leave unanswered.
- If omitted: Step 2 runs the full elicitation dialog (primary hue, neutral temperature, density, radius scale, motion preference, theme set).

---

## Step 0: Triage

Classify before delegating, using the Light / Standard / Deep vocabulary in `agents/shared/triage-vocabulary.md` (`triage_tiers: [1, 2, 3]` maps 1 = Light, 2 = Standard, 3 = Deep).

- **Tier 1 (Light)** — complete assets (brand hues + neutral readable without research), a single light + dark pair, detect verdict `create`. No researcher: one `hatch3r-implementer` + the two parallel gates.
- **Tier 2 (Standard)** — the elicitation dialog is needed (no assets, or assets answer only part of the Step 2 intake table) OR the detect verdict is `extend`. One `hatch3r-researcher` pass over whatever assets exist + implementer + gates.
- **Tier 3 (Deep)** — Figma/tokens-studio import, multi-brand palette, monorepo (workspace-wide token package), or a third theme (high-contrast). One researcher per asset class in parallel + implementer + gates.

An undeclared theme set or emission target fires the §0 gate before tiering. Classify upward on uncertainty (highest-tier rule, `agents/shared/triage-vocabulary.md`).

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 2 ASK gate, emit the cost preview per `rules/hatch3r-cost-visibility.md`:

```yaml
cost_estimate:
  expected_sa_count: <0-2 researchers by tier + 1 implementer + 2 validation gates>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>   # 0-2 — only for Figma/tokens-studio field-mapping checks
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 6 Iteration Summary recap per `rules/hatch3r-cost-visibility.md`.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Effort Override. Per-command slot: a complete-assets single-pair run misread as Deep because a stray tokens-studio JSON sits in the repo — force `--effort=light`.

---

## Step 1: Detect First (mandatory, read-only)

Invoke the `hatch3r-design-system-detect` skill inline and consume its Design System Inventory (`.audit-workspace/design-system-inventory.md`). This command never re-implements detection — it reads the inventory's token source, color space, component library, and responsive strategy verbatim and treats them as ground truth for Steps 3–4.

Verdict routing (the inventory's `Verdict:` line):

| Verdict | Route |
|---------|-------|
| `reuse` | HALT with an actionable pointer: print the existing token source + component library and exit — this command never overwrites a working design system. To audit it instead, run the `hatch3r-ui-ux-verify` skill. |
| `extend` | Scope generation to the inventory's gaps only (e.g. missing dark theme, missing component tier, hex → OKLCH migration). Existing token names are read-only inputs; the inventory's canonical token-source location overrides the greenfield default. |
| `create` | Full pipeline, Steps 2–6. |

If the inventory flags multiple token sources, the run is BLOCKED until the maintainer names the canonical one (the detect skill's reconciliation rule) — writing a new source beside them would break the DTCG single-source-of-truth mandate.

---

## Step 2: Intake / Elicitation + ASK Checkpoint (only mutation gate)

Fill the intake table from `<brand-asset-path>` where the assets answer a field; run the structured dialog for the rest. Cache for the Step 4 implementer prompt.

| Input | Default if unspecified | Notes |
|-------|------------------------|-------|
| Brand assets | none → full dialog | logo, brand-color list, screenshots, Figma export, tokens-studio JSON |
| Brand hue(s) | (required — assets or dialog) | 1–3 hues; each hue gets its own OKLCH ramp |
| Neutral temperature | pure gray | warm / cool / pure — hue bias of the neutral ramp |
| Density | comfortable | compact / comfortable / spacious — base of the spacing scale |
| Radius scale | 4px base | none / 4px / 8px / full-round tiers |
| Motion | 200ms ease + reduced-motion variant | per `rules/hatch3r-theming.md` |
| Theme set | light + dark | + high-contrast (≥7:1 text, ≥3:1 non-text) per `rules/hatch3r-theming.md` |
| Emission target | DTCG JSON | + Tailwind v4 `@theme` / + CSS custom properties, per the detect inventory |
| Token-source location | `tokens/design-tokens.json` (greenfield) | the inventory's canonical location wins on `extend` |

Present ONE consolidated ASK confirming the intake summary — the only mutation gate:

```
hatch3r-design-system-create — Tier {1|2|3}, verdict: {create|extend}

Intake summary:
  brand hues: {n} ({oklch values or dialog answers})
  neutral: {warm|cool|pure} · density: {…} · radius: {…} · motion: {…}
  themes: light + dark {+ high-contrast}
  emission: DTCG JSON {+ @theme} {+ CSS vars}
  taxonomy: primitive → semantic → component
  output: {token-source location} + docs/design.md
```

ASK per `agents/shared/user-question-protocol.md`: `accept` — generate and gate; `edit` — change an intake field first; `skip` — cancel, write nothing. After `accept`, the run is autonomous through Step 6.

---

## Step 3: Token Architecture (+ Tier 2/3 asset research)

**Tier 2/3 research (sub-agent delegation).** Delegate asset analysis to `hatch3r-researcher` via the Task tool — one researcher per asset class, in parallel (read-only per that agent's contract). Brief: extract candidate brand hues as OKLCH, spacing/radius conventions visible in screenshots, and a tokens-studio → DTCG field mapping when an export is present. Findings feed the Step 4 implementer prompt. Tier 1 skips this stage — the assets already answer the intake table.

**Taxonomy (all tiers).** Three tiers, aligned with `rules/hatch3r-theming.md` token layering and `rules/hatch3r-component-conventions.md`:

1. **Primitive** — raw scales, no theme awareness: OKLCH ramps (`gray.100`…`gray.900`, `brand.100`…), spacing, radius, type scale.
2. **Semantic** — role tokens (`color.surface`, `color.text-primary`, `color.border`, `color.brand`, `color.error/success/warning`) aliasing primitives; the theme-switching layer.
3. **Component** — `btn.text`, `input.border`, … aliasing semantic tokens only.

**Hard rule:** a component token never references a primitive token directly — every component alias resolves through the semantic tier (blocking row, Step 5). This constraint is what makes theme switching a semantic-tier-only override.

---

## Step 3.5: In-Session Plan Gate (Tier >= 2)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: artifact = the Step 3 token-architecture plan (3-tier taxonomy, per-hue ramp plan, theme set, emission targets) over the confirmed Step 2 intake + research findings; slug from the Step 1 verdict (`docs/plans/{YYYY-MM-DD}-design-system-{create|extend}.md`); gated dispatch = Step 4 implementer; revise returns to Step 3 architecture synthesis; no unattended flag — the Step 2 consolidated ASK is the interactive seam.

---

## Step 4: Generate (sub-agent delegation)

Delegate to `hatch3r-implementer` via the Task tool. ALL file writes flow through the implementer per the Mandatory Delegation Directive — the orchestrator writes nothing inline.

The implementer prompt MUST include the detect inventory, the confirmed intake, the Step 3 research findings, and this contract:

**OKLCH ramps (per brand hue + neutral):** a lightness ramp per hue (10 steps, L ≈ 0.98 → 0.15); for text-role steps hold L fixed and adjust C/H toward the Step 5 contrast thresholds (the apcach pattern — in OKLCH, contrast tracks ΔL, so L placement is the contrast control). Reduce chroma 10–20% on dark-theme surface ramps per `rules/hatch3r-theming.md`.

**DTCG emission (the token-source file):** Format Module 2025.10 — every token carries `$type` + `$value`; aliases use `{group.token}` syntax; groups mirror the 3-tier taxonomy; default location `tokens/design-tokens.json` on greenfield, the inventory's canonical location on `extend`.

**Themes:** light + dark (+ high-contrast when confirmed) as semantic-tier override sets with IDENTICAL semantic key sets — a key present in one theme and absent in another is a blocking Step 5 failure.

**Adapter emission (per detect inventory):** Tailwind v4 `@theme` block and/or `:root` CSS custom properties are generated FROM the DTCG file (Style Dictionary-compatible naming) — derived outputs, never a second authored source.

**Docs:** `docs/design.md` per the Step 6 contract.

Also include: all `scope: always` rule directives; the confidence expression requirement (verbatim, high/medium/low per `agents/shared/quality-charter.md` §1); the boundary "do NOT create branches, commits, or PRs". Await the structured result; capture `Files changed` and the `Delegation proof ID` per file.

---

## Step 5: Validate (parallel sub-agent gates)

After the implementer returns, delegate `hatch3r-ui` and `hatch3r-ux` via the Task tool in parallel. `hatch3r-ui` owns the contrast, alias, parity, reference, and APCA rows (CQ1 acceptance bar: `agents/hatch3r-ui.md` audit checklist); `hatch3r-ux` owns the focus-indicator and touch-target rows (interaction affordances, CQ2). Each prompt carries the generated file paths + its gate rows:

| Gate | Threshold | Blocking |
|---|---|---|
| WCAG 2.2 AA contrast (4.5:1 text / 3:1 large + non-text) | 100% of semantic fg/bg pairs, every theme | Yes |
| Focus-indicator contrast ≥3:1 | 100% of interactive component tokens | Yes |
| Touch-target sizing tokens ≥44px | 100% | Yes |
| Dangling aliases | 0 | Yes |
| Theme parity (identical semantic key set per theme) | 100% | Yes |
| Component→primitive direct references | 0 | Yes |
| APCA (Lc ≥60 body / ≥45 large) | advisory | No — recorded in a11y report |

The 44px sizing-token row sits above the WCAG 2.2 AA SC 2.5.8 floor (24×24 CSS px) — size tokens are authored to the platform-HIG bar so consuming components inherit it. A blocking-row failure routes back through `hatch3r-implementer` (max 1 regeneration pass), then re-gates the failed rows only. A persistent blocking failure ends the run at `PARTIAL` with the system flagged not-merge-ready. APCA readings below Lc 60/45 land in the design.md Accessibility Report — advisory, never a halt.

---

## Step 6: Docs + Iteration Summary

Verify `docs/design.md` (written by the Step 4 implementer) carries: principles (the confirmed intake decisions restated as statements), palette + per-hue OKLCH ramp tables, the 3-tier taxonomy diagram, a theme table (semantic keys × themes), usage examples per emission target, and an embedded Accessibility Report (WCAG pass matrix per theme + the APCA advisory readings). Emit the runtime `sub_agents_spawned: {count, rationale}` block with the actual spawn count per `rules/hatch3r-fan-out-discipline.md`.

### End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: `{token-source location}`, `docs/design.md`, emission-target files — all `via hatch3r-implementer`.

### Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default.

```markdown
## Iteration Summary

**SUCCESS** — Created 2-theme OKLCH design system (1 brand hue + neutral, 3-tier DTCG tokens); ui + ux gates PASS 6/6 blocking rows.
files 3 (+486/−0) · sa 4/4 · gates 6/6 · cost Δ−8% tok / Δ+3% min · tier 2
Not done: APCA Lc 58 on `color.text-secondary` (dark) — advisory, recorded in the design.md Accessibility Report
Next: import the token file into the build (Tailwind `@theme` / Style Dictionary) and point component authors at docs/design.md.

## Remaining Work

Not done: APCA Lc 58 on `color.text-secondary` (dark) — advisory, recorded in the design.md Accessibility Report
```

Status decision rules:
- **SUCCESS** — tokens + docs written, all blocking gate rows PASS, verdict-scoped outputs complete.
- **PARTIAL** — generated, but a blocking row failed after the single regeneration pass, or a verification command failed.
- **FAILED** — the implementer returned BLOCKED; nothing written.
- **BLOCKED** — detect verdict `reuse`, multiple token sources unreconciled, or an intake contradiction the maintainer must rule on.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping: `1` = detect + intake + confirm, `2` = research + implementer generation, `3` = parallel gates + docs + summary. Tier 1 complete-asset runs are exempt per the Tier 1 exemption.

---

## Error Handling

- **Asset unreadable or unsupported format** — name the supported classes (logo image, brand-color list, screenshots, Figma export, tokens-studio JSON) and fall back to the elicitation dialog for the missing fields; never infer a brand hue from a filename.
- **Multiple token sources in the detect inventory** — BLOCKED until the maintainer names the canonical source (Step 1).
- **Researcher returns low-confidence hue extraction** — re-open the ASK with the OKLCH candidates as numbered options (residual-ambiguity re-ask per the frame §0); never silently pick one.
- **Persistent blocking-gate failure after the regeneration pass** — end at PARTIAL, not-merge-ready flag, gate findings quoted verbatim in the Iteration Summary.

## Guardrails

1. **One ASK gate.** Step 2 is the only user-facing checkpoint; after `accept`, the run proceeds through Step 6 (residual-ambiguity re-asks per frame §0 excepted).
2. **No commit or push.** Generated files are left staged for human review; git operations are out of scope.
3. **Detect before create.** Step 1 is never skipped; a `reuse` verdict halts the run — this command never overwrites an existing design system.
4. **Single authored source.** The DTCG file is the only hand-authored token source; `@theme` / CSS-vars outputs are derived from it and regenerated, never edited in place.
5. **No raw color values outside the primitive tier.** Semantic and component tokens are aliases only (`rules/hatch3r-theming.md` token layering).
6. **Both gates are mandatory.** A run is never declared SUCCESS without `hatch3r-ui` AND `hatch3r-ux` PASS on every blocking row they own.

## Resumability (Decision 27/30)

design-system-create serializes on the research → generate → gate edges, so checkpoint at the stage boundary — an interrupted run re-enters at the first incomplete stage rather than regenerating the token file it already wrote.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.design-system-workspace/`; step range the Step 1 → Step 6 progression; `wave` = the researcher-batch index in Step 3, then the regeneration-pass index in Step 5; snapshot/rollback paths the token-source file, `docs/design.md`, and every emission-target file the Step 4 implementer touches. Write points: after the Step 1 inventory read, after the Step 2 accept gate, after each Step 3 researcher return, after the Step 4 implementer return, and after each Step 5 gate verdict.

## References

- [W3C Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/) (accessed 2026-07-08, W3C Design Tokens Community Group, official-docs) — `$type`/`$value` token shape, `{group.token}` alias syntax, group nesting, and the single-source mandate; source for the Step 4 emission contract.
- [Design Tokens specification reaches first stable version](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/) (accessed 2026-07-08, W3C Design Tokens CG, official-docs) — confirms 2025.10 as the first stable release; the version the emission contract pins.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (accessed 2026-07-08, W3C, official-docs) — SC 1.4.3 contrast minimums (4.5:1 / 3:1 large), SC 1.4.11 non-text contrast 3:1, SC 2.5.8 target size 24×24; the Step 5 blocking thresholds and the floor the 44px token row exceeds.
- [apcach](https://github.com/antiflasher/apcach) (accessed 2026-07-08, named-maintainer library, established-library) — composing OKLCH colors to a target contrast by holding L and adjusting C/H; pattern source for the Step 4 ramp recipe and the APCA advisory row (Lc 60 body / 45 large).
- [Style Dictionary — DTCG support](https://styledictionary.com/info/dtcg/) (accessed 2026-07-08, Style Dictionary maintainers, established-library) — DTCG-input transform surface and derived multi-platform outputs; basis for the derived-emission (never second-source) guardrail.
- [uxKero/anydesign](https://github.com/uxKero/anydesign) (accessed 2026-07-08, named maintainer, independent-analysis) — prior art: elicitation-dialog → design-system generation; structural source for the Step 2 dialog field set.
- [arvindrk/extract-design-system](https://github.com/arvindrk/extract-design-system) (accessed 2026-07-08, named maintainer, independent-analysis) — prior art: palette/spacing extraction from existing assets and screenshots; structural source for the Step 3 researcher brief.

Cross-references: `skills/hatch3r-design-system-detect/SKILL.md` (mandatory Step 1 inventory producer) · `rules/hatch3r-theming.md` (token layering, theme sets, dark-theme chroma reduction) · `rules/hatch3r-component-conventions.md` (how downstream components consume the tokens) · `rules/hatch3r-accessibility-standards.md` (WCAG 2.2 AA criteria behind the Step 5 rows) · `agents/hatch3r-ui.md` (CQ1 acceptance bar).
