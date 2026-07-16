# Changelog

All notable changes to hatch3r are documented in this file.

## [2.7.1] - 2026-07-16

### Headline

Plan-first becomes the default for code-mutating orchestration. The 9 code-mutating orchestrator commands (`board-pickup`, `bug-pipeline`, `debug`, `diagnose`, `design-system-create`, `pr-resolve`, `release`, `auth-scaffold`, `slo-scaffold`) gain frontmatter `plan_gate: true`: at effective Tier >= 2 they persist a plan artifact to `docs/plans/{YYYY-MM-DD}-{slug}.md` (the workflow plan-file seven-field format) and ask `execute now (default) / revise / stop` before dispatching implementation — unattended and board-auto-advance runs persist the plan and continue without pausing. The 7 executable-plan producers (the `hatch3r-plan` router, feature/bug/migration/refactor/test-plan, rework) gain the mirror-image ending: an `Execute or Defer` ASK whose execute-now path runs the just-written plan in the same session with `--plan-file` semantics, keeping the fresh-session copy-paste block as the deferral path. Run endings stop hiding scope: the recap `Not done:` line is now always emitted (`Not done: none — full scope completed` on a complete run), and a `## Remaining Work` terminal block closes any run with open items. Also fixed: `.hatch3r/provenance.json.bak` litter in end-user repos, and `status`/`verify` now flag the pre-2.6.0 stale-duplicate-body hook corruption (stale script copy below `HATCH3R:END` that plain re-sync cannot heal) with the delete-then-sync remediation. No breaking changes; manifest schema unchanged (generation 3); the new `plan_gate` frontmatter key is additive and needs no config migration. Ships as PR #133.

### Content

- **`plan_gate: true` on the 9 code-mutating orchestrator commands** — `board-pickup`, `bug-pipeline`, `debug`, `diagnose`, `design-system-create`, `pr-resolve`, `release`, `auth-scaffold`, `slo-scaffold`. At effective Tier >= 2 the command persists a plan artifact to `docs/plans/{YYYY-MM-DD}-{slug}.md` in the workflow plan-file seven-field format (scope, acceptance criteria, files, order, dependencies, constraints, out-of-scope — the same shape `/hatch3r-workflow --plan-file` parses), then asks `execute now (default) / revise / stop` before the first implementer/fixer dispatch; Tier 1 runs keep the existing ASK cadence, and unattended runs (`--auto` / CI / board auto-advance) persist the artifact and continue without pausing. Exempt by design: `hatch3r-workflow` (the direct-execution entry point), `hatch3r-quick-change` (the Tier-1 carve-out), `hatch3r-incident-response` (urgency), and `healthcheck`/`security-audit`/`board-fill` (their board output IS the plan).
- **Same-session execute for the 7 executable-plan producers** — the `hatch3r-plan` router, `feature-plan`, `bug-plan`, `migration-plan`, `refactor-plan`, `test-plan`, and `rework` now end with an `Execute or Defer` ASK: execute now (default) continues in this session, executing the emitted `hatch3r-workflow` command file with `--plan-file` semantics against the just-written artifact; stop keeps the previous behavior — the fresh-session `Execute This Plan` copy-paste block remains as the deferral path. Doc planners (`roadmap`, `project-spec`, `api-spec`, `spec`) are unchanged; rework's `--auto`/`--review-only` never auto-execute.
- **Honest run endings** — the recap contract's `Not done:` line (`rules/hatch3r-iteration-summary.md`) is now always emitted: `Not done: none — full scope completed` on a complete run is a positive assertion, not silence. When items remain, a `## Remaining Work` terminal block renders as the run's very last output (after the `Execute This Plan` block when both fire).

### Validators

- **New `--plan-gate` mode in `scripts/validate-efficiency-invariants.ts`** — locks the 9-command `PLAN_GATE_COMMANDS` roster in both directions (`PLAN-GATE-ROSTER-MISS` on silent key removal, `PLAN-GATE-KEY-MISS` on an unreviewed `plan_gate: true` outside the roster), requires the `In-Session Plan Gate` frame citation in each gated body (`PLAN-GATE-POINTER-MISS`), and checks the orchestration frame carries the `## In-Session Plan Gate (plan_gate: true)` + `## Execute-Now Continuation (executable-plan producers)` sections with the `execute now` ASK literal (`PLAN-GATE-FRAME-MISS`). Runs in the `validate:efficiency` umbrella as its thirteenth mode.

### Fixed

- **`.hatch3r/provenance.json.bak` litter in end-user repos** — hatch3r no longer writes a `.bak` backup for its own regenerable provenance manifest, deletes a stale pre-2.7.1 one on the next `init`/`sync`/`update`/`config` (every `writeProvenance` caller), and `.gitignore` management gains a `.hatch3r/provenance.json.bak*` entry.
- **`status`/`verify` detect the stale-duplicate-body hook corruption** — a script-hosted managed output (`.js`/`.mjs`/`.cjs`, e.g. `.claude/hooks/pretooluse-allowlist.mjs`) carrying a stale raw copy of its generated script below the `// HATCH3R:END` marker (the pre-2.6.0 sync splice; the duplicated ESM imports break the hook on every tool call) now reports `modified` with driftDetail `stale-duplicate-body` and names the remediation — delete the file, then `npx hatch3r sync` — instead of reporting in-sync while plain re-sync silently kept the corruption.

### Chore

- **PreToolUse allowlist hook: sync-merge seam exercised under real Node** — new tests drive the generated `.claude/hooks/pretooluse-allowlist.mjs` through the sync merge path and execute the result with Node instead of asserting on strings; `docs/troubleshooting.md` gains an entry for the pre-2.6.0 sync corruption that duplicated the script body (plain re-sync does not heal it — delete the file, then `npx hatch3r sync`).

### Upgrade notes

- **`plan_gate` is additive** — no config migration; manifest schema unchanged (generation 3), and existing manifests, overrides, and `.customize.yaml` files keep resolving unchanged.
- **Two-step plan flows keep working** — choose `stop` at the ASK to keep the pre-2.7.1 plan-then-fresh-session flow; the `Execute This Plan` copy-paste block still renders as the deferral path.
- **`hatch3r-quick-change` admits Tier 2 batches yet stays gate-exempt by design** (Tier 3 it hard-blocks and routes to `/hatch3r-workflow`) — route larger batches through a gated command or `/hatch3r-workflow` when you want the plan artifact + approval step.

## [2.7.0] - 2026-07-15

### Headline

The model-class ladder widens from 3 to 4 — `frontier | advanced | standard | economy` (16/3/6/5 across the 30 agents; the 2.6.0 words `default`/`strongest` stay accepted as legacy synonyms on user overrides, alongside the pre-2.6.0 `fast`/`standard`/`reasoning`) — and reasoning effort becomes a first-class axis: `low | medium | high | xhigh | max`, resolved per agent as customize `effort:` > authored frontmatter `effort:` > `models.tierEfforts.<class>` pin > built-in class default (`frontier: xhigh`, `advanced: high`, `economy: medium`; `standard`: none). Cursor and Copilot gain native class pins under the new `cursor.agentModelPins` / `copilot.agentModelPins` knobs (`"native"` default, `"conservative"` restores the pre-2.7.0 posture), `models.tiers.<class>: "inherit"` becomes the per-class native-emission off-switch, and `sync`/`status`/`verify` learn to attribute hand-edited `model:`/`effort:` frontmatter against the new provenance scalars. No breaking config change: manifest schema unchanged (generation 3), the new keys (`models.tierEfforts`, `agentModelPins`) are optional, and every pre-2.7.0 `models.tiers` key keeps resolving. Ships as PR #131, plus one main-line rider merged after the v2.6.0 tag (#130 — launch-readiness v2.6.0 release-cut refresh; docs-only, Chore).

### Adapters

- **Claude Code — 4-row class map + native `effort:` emission** — the class→alias map gains `frontier → fable` (`fable` joins the recognizable-value gate beside `sonnet`/`opus`/`haiku`/`inherit`/`claude-*` — without it every frontier-class agent would silently degrade to prose-only emission). Per class: `frontier` → `model: fable` + `effort: xhigh` (authored `max` on security/reviewer/edge-case-analyst), `advanced` → `model: opus` + `effort:` (authored, else built-in `high`), `standard` → `model: sonnet` with no `effort:` line, `economy` → `model: haiku` + `effort: medium` (authored `low` on the 3 loaders). **Behavior change:** operator `models.tiers` pins no longer suppress the `effort:` line — explicit authored/customize effort and `models.tierEfforts` pins ride pins (the built-in class default does not); 2.6.0's suppress-on-every-pin would silently drop `effort: max` on `hatch3r-security` the moment an operator pins `tiers.frontier: fable`.
- **Cursor — native concrete-id pins with a clamped effort bracket** — under the default `cursor.agentModelPins: "native"`, `advanced`/`frontier` pin concrete ids via alias expansion (`model: claude-opus-4-8` / `model: claude-fable-5`), appending `[effort=high]` iff the resolved effort ranks ≥ `xhigh` and clamping the bracket value to `high` — the only bracket level cursor.com/docs/subagents.md documents (accessed 2026-07-14); a plain-`high` resolution gets no bracket, so the bracket encodes the ≥ `xhigh` distinction. `economy` stays `model: fast` (never bracketed), `standard` stays omitted. Operator `models.tiers` pins emit verbatim — brackets are never appended to a pin; pin the bracketed form yourself. `"conservative"` restores the pre-2.7.0 advisory-body-line posture for `advanced`/`frontier`.
- **Copilot — native display-name pins + gate widening + spurious-warning fix** — under the default `copilot.agentModelPins: "native"`: `frontier` → `model: Claude Fable 5`, `advanced` → `model: Claude Opus 4.8`, `economy` → `model: Claude Haiku 4.5` (single display-name string — the Copilot CLI rejects the array form), `standard` omitted (picker default); `"conservative"` omits every class word (pins still win). The recognizable-model gate now accepts the documented display-name families (`Claude `/`GPT-<digit>`/`Gemini ` prefixes) alongside provider-prefix ids and `(copilot)`-qualified labels. Fix: `reasoning` (with `default`/`strongest`) joins the intentionally-omitted set — a `model: reasoning` user override no longer fires a drop warning on every sync. No effort field is emitted on this surface (no documented key; `ADAPTER_CAPABILITIES` gains `effortOverride` — claude/cursor `true`, copilot `false`, pinned by the capability-matrix drift test).
- **Per-class off-switch** — `models.tiers.<class>: "inherit"` suppresses native model/effort emission for that class on all 3 adapters; the class intent stays visible in body prose (Claude `## Recommended Model`, Cursor advisory line). `hatch3r validate` lints legacy tier keys (rename warning), dual-key shadows (canonical key wins), unknown keys, and circular class-word pins; `models.tierEfforts` takes canonical class keys and the 5-level enum only (errors otherwise), and `.customize.yaml` `effort:` is a closed-enum, agents-only override (warn-and-drop on other types, blocked outside the enum).
- **Heal warning + hand-edit attribution** — `sync` now warns when stub regeneration changes an emitted `model:`/`effort:` value, naming each changed field (old → new) plus the durable channels (`.customize.yaml` `model:`/`effort:`, `hatch.json` `models.*`). `.hatch3r/provenance.json` gains per-file `emittedModel`/`emittedEffort` scalars, and `status`/`verify` use them to attribute a hand-edited frontmatter stub as `user-modified` with detail `frontmatter-stub-edited` and an exact remedy — the pre-2.7.0 blanket `canonical-outdated` mislabeled the edit as hatch3r's own format move while the heal silently discarded it.

### Content

- **25 class migrations + 22 authored efforts across the 30 agents** — 16 `strongest` → `frontier` (the verdict roster: 10 CQ specialists + reviewer, architect, edge-case-analyst, incident-responder, greenfield-spec, brownfield-spec), 3 `default` → `advanced` (implementer, fixer, creator — the mutating work lane promoted off the middle tier), 6 `default` → `standard` (researcher, docs-writer, devops, pack-installer, dependency-drafter, handoff-preparer); the 5 `economy` agents keep their class. Authored `effort:` lands on 22: `xhigh` on 13 frontier + the 3 advanced, `max` on security/reviewer/edge-case-analyst, `low` on the 3 loaders (context-rules, handoff-loader, learnings-loader); ci-watcher/lint-fixer ride the `economy` class default (`medium`).
- **3 rules updated for the new vocabulary** — `hatch3r-model-allocation` is rewritten around the 4-word ladder and gains a new **Effort ladder** section (the two-stage resolution chain, un-degradable authored floors — a `models.tierEfforts` pin can never lower an agent below its authored level — and the per-adapter effort surfaces), plus the frontier-is-floor-only allocation rule: the tier ladder tops out at `advanced`, so `max()` never mints `frontier` at runtime. `hatch3r-deep-context` remaps the tier table (Tier 2 → `standard`, Tier 3 → `advanced`) and the `/hatch3r-create` intake enum; `hatch3r-agent-orchestration` verdict-floor wording moves `strongest` → `frontier`.
- **Board-surface class migration** — `hatch3r-create`'s Model Pool speaks the four class words (default `frontier` for `risk:high` issues, `standard` otherwise; `codex`/`gemini-pro` stay as cross-vendor concrete aliases by design), with `commands/board/shared-board-overview.md` and `skills/hatch3r-board-shared/SKILL.md` migrated in the same sweep and `hatch3r-workflow`'s Phase 4 specialist-floor wording updated.
- **Creator vocabulary** — `hatch3r-creator` teaches user-authored agents the 4-class `model:` enum and the new optional `effort:` field (5-level enum, class-default inheritance, verdict-lane `xhigh`+ floor guidance), so `/hatch3r-create` artifacts speak the same vocabulary as the canonical corpus.
- **Validator `--model-class` mode extended** — MODEL-CLASS-VOCAB enforces the 4-word enum on every agent; the floor roster is the 16-id TOP_FLOOR_IDS verdict set (MODEL-CLASS-FLOOR); new EFFORT-VOCAB (any authored `effort:` is one of the 5 levels) and EFFORT-FLOOR (the 16 verdict agents author `xhigh` or above) checks.
- **Cost estimator prices class words** — `explain --cost --model <class>` rates through the Claude class map: `frontier` → `claude-fable-5` at $10/$50 per 1M in/out (rate row added; opus $5/$25, sonnet $3/$15, haiku $1/$5 unchanged).

### Governance

- **Terminology-currency amendment: landed.** CONSTITUTION §6 Decision 34, the §2 P7 model-allocation wording, and the D02/D07 domain rows now carry the 4-word ladder + effort dimension — the domain rows via owner-consented CL-3 batch (hatch3r-governance #7), the constitutional wording via the §8 amendment queue landed on owner re-confirmation 2026-07-15 (hatch3r-governance #8).

### Chore — queued-work drain (2026-07-15, rode the release branch)

- **EVOLVE a2a16b59 manifests closed** — anti-slop validator header repointed to the CONSTITUTION §2 P5 single home; quick-start split (304 → 197 lines + `website/docs/reference/quick-start-reference.md`) with a new `QUICK-START-CAP` efficiency check; new `scripts/validate-workspace-state.ts` (EVOLVE checkpoint/ledger schema gate, standalone `validate:workspace-state`); `scripts/validate-finding-registry.ts` gains the S12-F2 invariant lane (severity 5-enum · open⇒cycle · terminal-disposition⇒terminal-status); `src/audit/archive.ts` types new archive-index entries (`artifact_type`, 9-value enum) and round-trips unknown index keys; legacy registry + 2026-04-19 EVOLVE report relocated into the governance archive.
- **C4/C5/C6 review-quality floors (EVOLVE a2a16b59 round-2 adoptions)** — `rules/hatch3r-reviewer-calibration.md`: change-risk N-selection table with authorship (agent- vs human-authored) as an explicit risk input, plus the AI-reviewer qualification gate (seeded-bug catch rate + declared false-positive budget + human triage before trust); `rules/hatch3r-git-conventions.md`: Change Size section (≤400-changed-lines default ceiling, stacked-change escape hatch) per DORA 2025 capability 5; `rules/hatch3r-dependency-management.md`: SLSA successor routes (platform-native attestations + reusable workflows) beside the pinned generator.
- **CL-2 drift gate shipped** — new `scripts/validate-content-claims.ts` (+ tests, wired into `validate:efficiency`): flags skill/command bodies claiming a self-provided runtime or own-invocation flags with no `src/cli` backing (`CONTENT-CLAIM-PHANTOM-RUNTIME`/`-STORE`); proposal archived as applied. Merge-blocking once the CI `validate` umbrella becomes a required check (owner act).
- **P8 `task_structure` companion now enforced** — `validate-fanout-emission.ts` promotes the companion to error level and requires the 3-key emission directive; backfilled across 4 orchestrator commands, 41 shipped skills, and the maintainer presets. Decision-citation fix in `rules/hatch3r-agent-orchestration-detail.md` (27 → 30).

### Upgrade notes

- **Legacy `strongest`/`reasoning` overrides now resolve to Fable at 2× the opus rate.** Pre-2.7.0 both synonyms mapped to the top class emitting `opus` (`claude-opus-4-8`, $5/$25 per 1M in/out); they now normalize to `frontier`, emitting `fable`/`claude-fable-5`/`Claude Fable 5` at $10/$50. Keep the old spend with `"models": { "tiers": { "frontier": "opus" } }`.
- **Downgrade pins on `tiers.strongest` now cover only frontier agents.** A legacy `models.tiers.strongest` pin normalizes to `frontier` and remaps the 16 frontier-class agents only; the 3 promoted `advanced`-class agents (implementer, fixer, creator — now emitting opus-tier where 2.6.0 emitted sonnet-tier/inherit) sit outside it. Cap that band with its own `models.tiers.advanced` pin.

## [2.6.0] - 2026-07-14

### Headline

A sub-agent quality release. Every canonical agent now declares a model class (`economy | default | strongest` — 16/9/5 across the 30 agents) that each adapter maps to its native model vocabulary, backed by two new always-on rules: model allocation (`max(agent floor, effective-tier class)` on every spawn, with an explicit per-spawn model pass) and context budget (≤15k-token input frames, ≤2,000-token distilled returns against durable results files — bounding context width, never fan-out width). Planning consolidates: a `hatch3r-plan` router classifies raw requests over the 9 planning flows (commands 31 → 32), the 11 plan-producing commands close with a copy-paste Execute This Plan prompt, and `hatch3r-workflow --plan-file=<path>` executes an approved plan in a fresh session without re-deriving it. `hatch3r-revision` becomes `hatch3r-rework` and now ends at a rework plan instead of fixing inline. The slash-picker teaser fix closes its two remaining live paths (sync heals pre-2.1.0 stub frontmatter; companion subcommands get real teasers), `verify` names a reason for every non-emitted artifact, and the learnings cap becomes configurable (`learnings.maxCount`, default 150) with an agent-performed consolidation pass. Rules 70 → 72. No CLI-binary breaking changes; one command rename with a migration note (`docs/MIGRATION-rework-2026-07.md`); manifest schema unchanged (generation 3) — the new keys (`models.tiers`, `learnings.maxCount`) are optional and default to current behavior. Ships as PR #129, plus two main-line riders merged after the v2.5.0 tag (#125, #126 — Chore).

### Adapters

- **Slash-picker teaser fix — both remaining live paths closed** — `safeWriteFile` now heals empty or stale out-of-block frontmatter stubs on merge. Repos initialized before the 2.1.0 byte-0 stub fix carry their `HATCH3R:BEGIN` marker at byte 0, so the picker-visible `description:` stub — which lives outside the managed block — could never land through regeneration (not even `--force`); the next `hatch3r sync`/`update` now restores it (repro repo: first sync healed 49 files, second healed 0 — idempotent), and a genuine user-authored prefix is never touched (the heal fires only when the pre-merge prefix is empty or a single stale generated stub). Companion subcommands (`board/*`, `rework/*`, `shared/*`) now emit byte-0 name/description stubs, so namespaced pickers like `/board:pickup` show real teasers. `status`/`verify` report the new `frontmatter-stub` and `markers-missing` drift kinds with exact remedies, and `init` surfaces `MergeResult` warnings it previously discarded.
- **Emission-completeness check** — `verify` reports every canonical artifact NOT emitted for a selected tool with its reason: `feature-disabled`, `customization-disabled` (naming the `.customize.yaml`), `cli-tools-filter`, `adapter-scope` (naming the frontmatter adapter list), or `unexplained` — which counts as ordinary drift; `status` gains a one-line summary. Root-cause note: content selection was never a generate-time filter — "missing command" reports trace to the pre-fix stub path (file present, picker mis-surfaced it) or a marker-less file skip, both now loud.
- **Per-agent model classes `economy | default | strongest`** — all 30 agents carry a `model:` class in frontmatter (16 strongest / 9 default / 5 economy). Claude Code emission maps a class to a native model alias plus `effort:` (strongest → high, economy → medium); Cursor gets a dead-value fix — the literal `model: standard` can no longer ship (economy → `fast`, default → omitted/inherit, strongest → an advisory body line unless pinned); Copilot intentionally omits class words (model availability is plan-dependent) unless a concrete pin resolves. The new `models.tiers.{economy|default|strongest}` manifest key remaps a class project-wide in one line (e.g. `strongest: fable`); `.customize.yaml` `model:` accepts a class word or a concrete id; `MODEL_ALIASES` is refreshed — `sonnet` → `claude-sonnet-5` (closing D1-SA1.6-03) plus a new `fable` alias — with matching cost-estimator rates; and a strict `--model-class` validator mode lands: class-word vocabulary on every agent (MODEL-CLASS-VOCAB) plus `model: strongest` pinning on always-mode and CQ-roster specialists (MODEL-CLASS-FLOOR).
- **Generated `.mjs` hook guards are now managed files** — the Claude PreToolUse allowlist hook and Cursor's three guards (`subagent-guard`, `mcp-guard`, `workdir-guard`) previously shipped with no managed markers (HTML markers are invalid JS), so every `hatch3r sync` skip-warned on them forever. A JS `//` marker variant lands (a shebang stays at byte 0 above the block), and a legacy-adoption path replaces recognized generated marker-less scripts wholesale on the next sync — one "Adopted" notice, then idempotent (repro: sync ×3 byte-identical, `node --check` valid, zero warnings). Raw JSON surfaces (`.claude/settings.json`, policy/hook JSON) still skip-warn — markers are impossible in JSON; a JSON-merge strategy is queued for the next cycle.

### Content

- **`rules/hatch3r-model-allocation` (rules 70 → 72 with the context-budget rule below; 87 lines, `scope: always`, `precedence: high`)** — per-spawn allocation matrix `allocated_class = max(agent static floor, effective-tier class)` across three lanes (verdict 16 / work 9 / mechanical 5); an explicit per-spawn model pass — generic-type spawns never load agent definition files, and definition-level model preferences are intermittently ignored on at least one host (anthropics/claude-code#44385, accessed 2026-07-14) — so the allocated class's mapped model rides every Task invocation; floor pinning — `hatch3r-security`, `hatch3r-testability`, and `floor:*`-tagged agents never resolve below `default` from any override layer; `model_classes` emitted per spawn beside `sub_agents_spawned`.
- **`rules/hatch3r-context-budget` (87 lines, `scope: always`, `precedence: high`)** — sub-agent input frames target ≤15,000 tokens with a 30,000-token justified ceiling (derived from the Decision 29 standard cost envelope); a scoped-input directive (paths + line ranges, not file bodies); a distilled-return contract — durable results files under `.hatch3r/results/` plus ≤2,000-token chat returns; working-context ceilings at 50% (compress) and 75% (STOP: write the results file, return PARTIAL), where the orchestrator's mandatory response is to decompose the remainder into MORE sub-agents along module/contract seams; P8 dominance stated outright — the budget bounds context width, never fan-out width. Grounded in Anthropic's context-engineering guidance and Chroma's context-rot research (both accessed 2026-07-14).
- **`commands/hatch3r-plan` planning router (commands 31 → 32; 149 lines)** — classifies a raw request over the 9 existing planning flows via an R1–R9 signal table (a row fires on ≥1 strong or ≥2 weak signals), with `--flow=<name>` overriding classification, a tie-breaker ASK on multi-row matches, and a zero-match ASK restating the nine flows; shared intake, then read-and-execute dispatch — the routed command's file is the contract; multi-flow sequences run in spec → project-spec → roadmap dependency order, at most two flows inline per run, the remainder chained as fresh-session prompts inside one consolidated Execute This Plan block.
- **Plan-Execution Handoff contract** — the 11 plan-producing commands (frontmatter `plan_handoff: true`) close with an `## Execute This Plan` block after the Iteration Summary: one copy-paste prompt that executes the plan in a fresh session — `/hatch3r-workflow --plan-file=<path>` by default, Shape B chains for roadmap/spec/project-spec, and a Tier-1 cleanup-only plan (≤3 single-line findings) may substitute `/hatch3r-quick-change`. The block format is single-homed in `commands/shared/orchestration-frame.md` → Plan-Execution Handoff; `rules/hatch3r-iteration-summary.md` names it the one sanctioned post-recap trailer; validator Mode K (`--plan-handoff`) pins the 11-command roster and fails on a missing block, a silently dropped frontmatter key, or a missing frame template.
- **`hatch3r-revision` → `hatch3r-rework` — plans, never fixes inline** — the renamed command reconstructs what was delivered from the git diff, interviews the user for feedback, triages findings `[REVISE]`/`[DEFER]`, validates them read-only (`hatch3r-researcher` + one `hatch3r-reviewer` pass), plan-lints, and ends at a rework plan (`docs/rework/{date}-{branch}.md`) plus an Execute This Plan prompt — zero commit/push semantics. `--review-only` is unchanged; `--auto` now means an unattended plan; `ctx:team-only` is dropped, so solo installs receive the command; companion files 4 → 3 (the delegation companion retired; `hatch3r-pr-resolve` is self-contained where it borrowed them). Migration note: `docs/MIGRATION-rework-2026-07.md`.
- **Learnings: configurable cap + consolidation pass** — `learnings.maxCount` in `hatch.json` (default 150, floor 50); the directory byte cap scales exactly with the count — 524,288 B at 50 (byte-identical to the legacy fixed cap) and 1,572,864 B at 150. `hatch3r learn capture` warns at ≥80% of the cap with a consolidation pointer and never blocks; the learn skill gains the agent-performed consolidation pass (cluster by topic + `applies-to` overlap → merge with `supersedes` → archive originals with an integrity re-stamp → regenerate INDEX.md); the `.usage.jsonl` write-side bound is recomputed to a rolling 4,000 rows / 1 MB (≤150 learnings × the 20-row window = 3,000 rows of live signal).
- **Two PR #121 pr-resolve deferrals drained** — the `release.yml` publish job now verifies the tarball against the gates job's `tarball_sha` job output instead of a digest file packed inside the artifact it attests (PRR-DEFER-1), and the verify skill's PR phrasing is marked as invocation timing, not dispatch scope (PRR-DEFER-2).

### CLI

- **`hatch3r-workflow --plan-file=<path>` intake** — an approved plan document becomes the task source: an existence guard with an actionable error naming the planning output directories, plan parse, and a git-freshness ASK — a stale plan (drift between the plan and the files it names) is never executed silently; derivation phases are skipped (the plan is the contract) and Quick Mode is supported. This is the execution half of the Plan-Execution Handoff contract above.

### Governance

- **CONSTITUTION codification executed (EVOLVE run b911d8f5)** — the model-class allocation, context-budget, and plan-handoff policies are codified: §6 Decisions 34-35 appended, the §2 P7 Measurement cell gains allocation-fit / context-budget-compliance / plan-handoff-presence items with honest validator anchoring, and D06/D07 audit checklists now verify both spawn policies (D02/D03/D05/D09/D16/D22 drift repairs in the same run). Private-governance changes ride hatch3r-governance#6; the run also caught and fixed a wrong-row "Decision-24" cost-envelope cite in the shipped context-budget rule (canonical id: Decision 29).

### Chore

- **#125** — launch-readiness v2.5.0 release-cut refresh (P1 GREEN, P6 re-verified); docs-only, rode main after the v2.5.0 tag.
- **#126** — dropped per-test 30s timeouts that clamped the win32 heavy-fs headroom in CI; test-infrastructure only.

## [2.5.0] - 2026-07-13

### Headline

Executes the Cycle-12 framework audit to full drain — 832 post-dedup findings (2 Critical, 96 High, 319 Medium, 289 Low, 126 Info), 100.0% coverage, framework report score 24.8 → 72.4/100 — and ships the drain plus its closed-loop output in one release (PR #121). Both Criticals land: workspace sync on an installed npm package no longer builds a 0-item content index from the package root, and the `main` merge gate replaces a phantom required check dead since v1.1.0 with a 4-context live contract plus a weekly drift probe. From the 14-gap content drain: an opt-in root `AGENTS.md` output class with a matching `init --import agents` importer, a trust-gated `hatch3r add <pack>` installer v1, the CQ10 product-spec specialist completing the 10-specialist roster (agents 29 → 30), adapter enforcement parity (Claude sub-agent `maxTurns`/`memory`, Copilot MCP sandbox), review-loop runtime telemetry, and a skill-eval CI harness. Managed-block writes gain a fence-aware marker shield, `.env.mcp` updates become a true merge, and `init` fails fast on non-interactive stdin. No breaking CLI changes; manifest schema unchanged (generation 3) — every new manifest key (`agentsMd`, `claude.subagentMaxTurns`, `claude.subagentMemory`, `copilot.mcpSandbox`) is optional and defaults to current behavior.

### Adapters

- **Opt-in root `AGENTS.md` output class (D9-SA9.5-05)** — setting `agentsMd.enabled: true` in `.hatch3r/hatch.json` (default: off, nothing emitted) adds a root `AGENTS.md` to generated output: a thin pointer carrying the universal floor, the B1 clarification directive, the maturity tier, and per-selected-tool surface pointers — not a duplicate corpus; canonical content stays single-sourced in each tool's own surface. The file is a whole-content managed block with single-writer owner election (`claude` > `cursor` > `copilot`), so multi-tool repos emit exactly one copy.
- **Adapter enforcement parity (D9-SA9.4-04 + D9-SA9.1-05 / D9-SA9.2-01 / D9-SA9.3-08)** — Claude Code sub-agents now carry `maxTurns: 200` frontmatter by default (a runaway bound, not a task budget; tune via `claude.subagentMaxTurns`, opt out with `false`) and `hatch3r-learnings-loader` gets `memory: project` (persistent agent memory under `.claude/agent-memory/`; replace or disable via `claude.subagentMemory`). Copilot gains an opt-in MCP sandbox (`copilot.mcpSandbox`, off by default — VS Code sandboxing is default-deny, so blanket enablement would break every network-reaching stdio server in the canonical set). Cursor's `beforeMCPExecution` MCP-allowlist guard hook (`.cursor/hooks/mcp-guard.mjs`, hard-denies servers outside the resolved `.cursor/mcp.json` set) shipped inside the wave-4 drain. All three platform surfaces re-verified against vendor docs accessed 2026-07-12.
- **Managed-block marker detection is fence-aware — and fails safe on malformed fences (D1-SA1.5-02 + CI-RECON-03)** — a quoted `HATCH3R:BEGIN`/`END` example inside a terminated markdown code fence is no longer treated as a real marker (previously managed content could be spliced into documentation examples). The first cut of the shield extended an unterminated fence's range to end-of-content, which shadowed a file's real `END` marker and made every sync append a duplicate managed block (observed on `.cursor/agents/hatch3r-ci-watcher.md`: 4 syncs → 4 BEGIN/END pairs, 26,723 → 35,631 bytes) while `verify --fix` looped to a non-convergent INTEGRITY_ERROR (exit 73). `computeFencedLineRanges` now voids the shield entirely on any unterminated fence and detection falls back to the pre-fence-aware line-anchored semantics, so a malformed document can never behave worse than before fence-awareness existed. 212/212 drift+merge suite tests; sync idempotency and `verify --fix` convergence restored.
- **Copilot `applyTo` package-targeting evaluated to HOLD (D14-SA14.2-04)** — per-package instruction targeting stays unshipped; the evaluation (both vendor sources accessed 2026-07-12) corrected the load-model assumptions the proposal depended on and records the re-open triggers.

### Content

- **CQ10 specialist: `hatch3r-product-spec` (D22-SA22.3-06, XD-01)** — the Product & Spec Quality specialist closes the roster: all 10 content-quality pillars (CQ1-CQ10) now map to a specialist agent (agents 29 → 30). Authored under the current senior-expert charter with a tracked forward pointer to the queued specialist-layer taxonomy redefinition; adapter policy-JSON snapshots refreshed for the new allowlist entry.
- **`rules/hatch3r-ai-evals.md`: judge-bias controls + trajectory watch (D23-SA23.3-01 … -04)** — the AI-evals rule gains LLM-judge bias controls and trajectory-watch refinement for agentic flows.
- **`rules/hatch3r-ai-ux-patterns.md` refreshed to Vercel AI SDK 6 (D23-SA23.2-02)** — the AI-UX rule's SDK guidance re-anchored to the current major.
- **Learning-system memory taxonomy (D23-SA23.1-03)** — `rules/hatch3r-learning-system.md` gains a memory-taxonomy subsection mapping learning classes to storage surfaces.
- **Spec-agent "Resolved clarifications" section (D5-SA5.9-03)** — the spec output schema now records B1 clarification answers in the spec artifact itself, so downstream phases inherit the resolved decisions instead of re-asking.
- **Rigor-contract clarification-gate rescoped (D5-SA5.9-04)** — the clarification-gate floor now binds workflow-bearing artifacts specifically; landed through the EVOLVE consent session (run b383f804) after the §8 queue, not by direct edit.
- **CLI-tool registry 34 → 39 (D21-SA21.7-05)** — `crush` (P2, replacing the archived `mods`), `jaq`, `tombi`, `hurl`, and `tea` registered as tier-3 entries; `mods` annotated archived-superseded pending the next-cycle B1-gated replace-or-remove evaluation.
- **`hatch3r-capability-matrix` de-floored + `full`-preset carve-out (D5-SA5.4-09 + CI-RECON-05)** — the rule is framework-internal (it governs hatch3r's own per-cycle adapter audit) and must stay user-disableable, so its `floor:content-quality` tag was removed; it now ships via `full.includeIds` only — the everything preset — and minimal/standard/archetype presets deliberately exclude it.

### CLI

- **Critical: installed packages synced from a 0-item content index (D1-SA1.10-01)** — workspace sync built its content index from the package root via `findPackageRoot`, which resolves the development repo layout but not the published npm layout, so a globally- or `npx`-installed hatch3r indexed 0 canonical items. Sync now resolves through `resolveBundledContentRoot()` — the same bundled-content resolver the adapters use — with a new published-layout regression fixture (`sync.publishedLayout.test.ts`); 31/31 targeted tests.
- **`hatch3r add <pack>`: stub → trust-gated v1 installer (D5-SA5.3-09)** — installs packs from a local path or an installed npm package: manifest validation, signing gate with `--allow-untrusted` override, per-file SHA-256 integrity map, lifecycle-script ban, deny-pattern body scan (strict tier), traversal/symlink/non-text guards, collision policy, atomic materialization with whole-batch rollback, `--dry-run` preview, and an install ledger at `.hatch3r/packs/<pack_id>.json`. Bare `hatch3r add` keeps its info + exit-0 probe; usage errors keep exit 2.
- **`init --import agents`: AGENTS.md/AGENT.md importer (D14-SA14.4-03)** — an existing root `AGENTS.md` (or `AGENT.md`) can now be imported into the canonical override set, joining the cursor/copilot/windsurf/awesome-cursorrules importer targets (`--import auto` includes it).
- **`init` fails fast on non-interactive stdin (D3-SA3.2-11)** — running `hatch3r init` on a non-TTY stdin without `--yes`/`--quick`/`--default` now exits 2 with an error naming those headless escapes, instead of dying at the first prompt; the headless flags themselves stay non-interactive (149/149 init tests, including 2 new non-TTY preflight regressions).
- **`.env.mcp` updates are a true merge (D1-SA1.2-02)** — re-running MCP selection re-rendered the template over an existing `.env.mcp`, destroying deselected-server secrets, custom variables, and user comments. `ensureEnvMcp` now preserves the existing file verbatim and appends only required-but-absent vars under a labelled header; two destructive-branch regression tests added (40/40 mcpEnv tests).
- **Review-loop runtime telemetry (D7-SA7.2-01, D7-SA7.2-04)** — every terminated review loop appends one JSONL record (loop class, iteration count, termination reason, per-iteration verdicts, `converged`, optional `durationMs`) to `.hatch3r/review-loop-metrics.jsonl`; the append never throws — a write failure degrades to a warning. Iteration-cap calibration promotes from this ledger at 30 samples.

### Governance

- **Cycle-12 audit executed to full drain** — 832 post-dedup findings (2 Critical / 96 High / 319 Medium / 289 Low / 126 Info) across the 4-wave progressive model with 19-check regression gates: 526 done / 306 partial (documented boundaries) / 2 §8-EVOLVE-queued, 0 failed, 100.0% coverage, 4/4 wave gates PASS. Framework report score 24.8 → 72.4/100 (Needs Work). Closed loop: CL-1 applied 9 PRD evolution candidates (PRD v4.10), CL-2 implemented all 14 content gaps (the features above), CL-3 applied 10 audit-machinery proposals. Cycle archived; insights ring now carries cycles [10, 11, 12]. Private-governance changes ride hatch3r-governance#4.
- **Critical: phantom required check on `main` (D4-SA4.3-01)** — branch protection required a "Quality gates" status context that no workflow has emitted since v1.1.0. The merge-gate contract is re-anchored to the 4 live contexts (`All CI checks`, `Validate PR title (conventional commits)`, `DCO sign-off check`, `Bundle size gate`) with `enforce_admins` enabled, documented in CLAUDE.md as the contract of record, and guarded by a weekly branch-protection drift probe (`.github/workflows/trust-model-audit.yml` → `branch-protection-drift`). Repo settings applied and probe green 2026-07-12.
- **Skill behavioral-eval harness (D5-SA5.6-10)** — two new CI gates: `validate:skill-refs` (4 dangling-reference checks — unresolved ids, unknown sub-agents, missing paths, TS-call drift — over skills/agents/commands against `governance/inventory.json` + the filesystem) and `validate:skill-contracts` (7 per-skill structural contracts: id↔dir, type, description, tags, Quick Start, Step pattern, strict frontmatter), plus a golden set for workflow-skill selection.
- **Audit-machinery hardening (CL-3)** — `validate-finding-registry` gains a CL-row balance invariant; the registry schema gains a typed `reopened` field and stalled-strategic predicate legs; the archive history gate's off-by-one is fixed and a named depth-waiver cohort mechanism added so waived-depth findings are tracked as an explicit cohort instead of silently passing.

### Chore

- **Bundle-size baseline re-anchored, +13.6% intentional** — the cycle-12 drain grew `src/` (pack installer, `AGENTS.md` emission + importer, review-loop telemetry, registry-schema additions), so the bundle-size gate baseline is reset to the new footprint as a recorded decision rather than accumulating as unexplained drift.
- **Test-infrastructure closures (CI-RECON-04/05/06)** — three fix-and-ship rounds closed every CI regression the drain opened: the wave-4 gate's 4 test failures (signal-harness expectations vs the intentional non-TTY init gate, tip text, provenance attribution), 5 full-matrix failures (4 test pins/snapshots/fixtures + the capability-matrix preset carve-out listed under Content), and 3 win32-only failures. Two shipped fixes rode the win32 round: canonical-reader diagnostic messages are posix-normalized (win32 `join()` backslashes made the same message diverge per platform), and handoff-id generation moved from independent 20-bit random draws to a CSPRNG-seeded per-process counter, making up to 2^20 ids per process collision-free by construction.
- **MIT patent posture ratified (Cycle-12 CL-1, C12-CL1-6)** — `docs/license-rationale.md` now records the owner-ratified decision: MIT stands, its patent silence deliberately accepted on the documented low-exposure rationale, with named revisit triggers (a patent-sensitive corporate adoption inquiry, or contributor-base growth making retroactive patent grants impractical).
- **treeshake A/B benchmark executed and closed (D4-SA4.1-09)** — the standing per-cycle instruction in `tsup.config.ts` to re-run the treeshake benchmark had gone unexecuted for two cycles with no owner and no result home. Measured 2026-07-12 (tsup 8.5.1, three-way, one source tree): `treeshake: true` produces a 1,325,930 B `dist/cli/index.js` vs 1,359,021 B for the `false` baseline — a 33,091 B (2.4%) reduction at ~9x build time (~480 ms vs ~55 ms for the Rollup pass). Omitting the key is byte-identical to `false`, which answers egoist/tsup#1136 for this single-entry build: `false` and `undefined` both leave the Rollup pass off. `treeshake: false` is retained (2.4% is below the self-imposed 5% flip threshold) and the config comment is rewritten from a recurring benchmark instruction into a dated closed decision with a bundle-budget-breach re-open trigger.

## [2.2.0] - 2026-07-08

### Headline

Adds a design-system creation command (DTCG 2025.10 tokens, OKLCH ramps, WCAG 2.2 AA gates), a user-consented re-poll loop at the end of `hatch3r-pr-resolve`, per-artifact model configuration for skills and commands, and a `mandatory-on-match` dispatch mode that makes the hatch3r-ui/ux specialists non-skippable on matching diffs at Tier 2/3. End-user repos now auto-gitignore all hatch3r runtime state (telemetry, calibration, locks, workspaces). No breaking CLI changes; manifest schema unchanged (schemaVersion 3) — the new `models.skills` / `models.commands` maps are optional and default to inherit/unset. Also ships retrospective-driven hardening: a write-ahead findings ledger so review-loop findings can no longer be registered but never implemented, shared-contract discipline (consumer census as a lane-exit gate, seam ownership for parallel lanes, façade contract-hold on field drops/renames), and runtime-evidence gates for no-static-types stacks. Parallel safety now holds at file AND contract granularity.

### Added

- **`hatch3r-design-system-create` command** (commands 30 → 31) — orchestrator command that creates a project/workspace design system from brand assets or an elicitation dialog: detect-first (consumes `hatch3r-design-system-detect`; a `reuse` verdict halts), 3-tier token taxonomy (primitive → semantic → component, no component→primitive shortcuts), OKLCH ramps, DTCG Format Module 2025.10 emission, dual `design-tokens.json` + `design.md` output, blocking gates on WCAG 2.2 AA contrast (100% of semantic pairs per theme), focus-indicator contrast ≥3:1, touch targets ≥44px, 0 dangling aliases, and 100% light/dark theme parity (APCA Lc 60/45 advisory). `agentPipeline`: researcher, implementer, ui, ux.
- **pr-resolve re-poll gate (Step 9.5, ask each round)** — after every push, `hatch3r-pr-resolve` asks whether to poll for new AI-review-tool comments (CodeRabbit, Copilot code review) on the new HEAD: 60s × 5 attempts (~300s budget) per round, retaining only comments created after the round start, not already replied to (`postedCommentIds`), and unresolved; a fresh round re-enters the pipeline scoped to the retained set. No automatic round cap — each round is user-approved; round state (`index`, `started_at`, `comments_per_round`) rides the checkpoint for resume, and the Step 10 recap gains a `rounds` facet.
- **Per-artifact model configuration for skills and commands** — new optional `models.skills` / `models.commands` id maps in `hatch.json`, and `.customize.yaml` `model:` overrides now apply beyond agents. Emitted only where the target tool supports it (official docs, accessed 2026-07-08): Claude Code skills + commands (`model:` frontmatter; omitted = inherit), Copilot prompt files (string form only), Cursor unchanged (no per-file model surface for rules/commands). `models.default` keeps agents-only semantics; with nothing configured, generated output is byte-identical to 2.1.1.
- **`mandatory-on-match` specialist dispatch mode** — `hatch3r-ui` (CQ1) and `hatch3r-ux` (CQ2) move from conditional guidance to a hard mandate: when their trigger globs match the diff at Tier 2/3, a dedicated per-specialist sub-agent instance must spawn (Tier 1 keeps its Phase Skip Criteria skip; ui and ux are never merged into one spawn). `shouldTriggerSpecialist` returns `mandatory?: boolean`; the roster validator's required-pipeline set now includes mandatory-on-match ids (`hatch3r-revision` gains `hatch3r-ux`).
- **`hatch3r-findings-ledger` rule (rules 67 → 70 with the two below)** — per-run append-only JSONL write-ahead ledger (`.hatch3r/findings/`): Critical/Warning findings registered on disk before every fixer dispatch (W1), per-iteration disposition reconciliation (W2), loop-exit run-exit invariant (W3: no row ends `pending`; `declined`/`accepted-risk` are user-attested only; unattended runs record `escalated` and exit PARTIAL), sub-agent-death flush (W4), and Suggestion terminalization (W5 — never silently dropped). Wired into the reviewer (ID column + `Resolved since last iteration:`), the fixer (`[<finding_id>]` line format), the workflow/board-pickup/pr-resolve/board-fill/revision loops, the iteration summary (`Open findings:` exception line), and the handoff preparer/loader (session-start open-findings surfacing, 14-day stale flag).
- **`hatch3r-contract-census` rule** — shared-contract discipline: 7-class contract taxonomy, repo-wide consumer census as a blocking lane-exit gate (implementer §5d / fixer §5b `Consumer census:` result field; `unreconciled` without justification caps Status at PARTIAL), consumer-scoped two-lens review (reviewer item 11 rewritten — self-run grep, read both sides of every seam), seam-owner protocol for parallel lanes (board-pickup Step 3 contract-overlap scan + delegation-multi 6c.2 owner assignment + 6c.4 cross-lane census verification), façade contract-hold on field drop/rename ("Did you delete the field, or null it behind the façade?"), and a value-drift census for shared constants (anti-duplication rule + checks). Parallel-safety condition (1) amended to file AND contract granularity across the orchestration rule and 25 command citations.
- **`hatch3r-dynamic-stack-verification` rule** — runtime-evidence gates where no compiler validates consumers: component smoke-mount on changed components, dynamic-i18n-key verification (with a new i18n rule Dynamic Keys contract), dormant-collection-read grep ratchet (baseline, fail-on-increase), and captured runtime evidence on client↔server/module-boundary changes; deep-context complexity scoring +2 for typeless boundary changes.
- **Product-decision attestation (5th ASK trigger)** — an autonomous run may not self-certify a user-data-destroying or user-visible-behavior-changing choice via a code comment or PR sentence: new user-question-protocol trigger + clarification-default five-trigger set, workflow auto-mode no longer auto-finalizes over an unattested product decision, and `checks/code-quality.md` gains a Decision Provenance section (reviewer flags untraceable assertions as Critical).
- **Coverage honesty + fail-closed environment gates** — `rules/hatch3r-testing.md` Degenerate-Input Guard (a no-op input vector is not coverage; named degenerate vectors; "N passing" needs activated behaviors) with matching `checks/testing.md` items, and `rules/hatch3r-security-patterns.md` now mandates allowlist environment gating for dangerous capabilities (`NODE_ENV !== 'production'` denylists are the named anti-pattern; unknown environment fails closed) with a `checks/security.md` Environment Gating section.

### Fixed

- **Runtime state committed in end-user repos** — `REQUIRED_GITIGNORE_ENTRIES` grew 7 → 16: `.pr-resolve-workspace/`, `.hatch3r/telemetry/`, `.hatch3r/efficiency-events.jsonl`, `.hatch3r/.failure-log.jsonl`, `.hatch3r/.breaker-state.jsonl`, `.hatch3r/.lock`, `.hatch3r/calibration-state.json`, `.hatch3r/calibration-log.jsonl`, `.hatch3r/archive/`. The reviewer-calibration counter tolerates a reset on fresh clones (missing file = count 0). Also fixes the `spaceTelemetry.ts` comment that claimed telemetry was already ignored.
- **Plugin manifest version drift** — `.cursor-plugin/plugin.json` (stuck at 2.1.0) and `.claude-plugin/marketplace.json` (stuck at 2.0.0) now carry the release version.

## [2.1.1] - 2026-07-06

### Content

- **Recap-contract iteration summary — the 9-section template is retired**: `rules/hatch3r-iteration-summary.md` (+ `.mdc`) now defines a 1–2 line recap (status enum + outcome sentence + `files · sa · gates · cost Δ · tier` telemetry facets) plus an 11-row exception-line registry (`Not done`, `Blockers`, `Default applied`, `Gates failed`, `Cost`, `Confidence`, `User-Accepted Bypass`, `Learnings`, `Tier`, `Duplication`, `Next`) where a line appears only when its firing condition holds — silence asserts the default, and a fired condition with no line is the gate failure. Dropped outright: request restatement, web-research list, pillar-impact attribution, verification-command detail (the recap `gates` facet replaces it). Every governance gate survives as a conditional line: the P8 B1 `Default applied:` log, the Decision-24 cost visibility (delta in the recap; full blocks beyond ±25%), charter honesty (`Not done` / `Blockers`), the D13 confidence-to-action strings, and the learning-system facets. (#115) Propagated across 63 canonical files: 30 command closing blocks, the coupled contracts (`cost-visibility`, `clarification-default`, `learning-system`, `agent-orchestration`, `handoff-readiness`, quality-charter §11, user-question-protocol), worked recap examples in the scaffold/diagnose/pack-install/pr-resolve/spec templates and the handoff trio (with absence-translation defaults), and the CONSTITUTION §6 Decision-23 row / VISION Principle 21 / D10 checklist superseded in place (2026-07-06).

### Governance

- **RE-ENVISION.md absorbed into EVOLVE.md — single interactive governance-evolution engine**: `governance/EVOLVE.md` is rewritten from a stateless 9-dimension proposal-only self-check into the unified interactive governance-evolution engine — 3 modes (`full-rewrite` / `scoped:<A##,...>` / `assess-only`), a 16-block full-coverage agenda (A00–A15) in which every block reaches an explicit verdict, parallel corpus-scan + research fan-out (15 scanner + 6 researcher sub-agents in full-rewrite mode, file-based outputs), a net-new capability round (≤10 candidates per run), dependency-waved per-file-consent rewrite execution (waves W1–W7; author sub-agents only), and checkpoint/resume in `.evolve-workspace/`. `governance/RE-ENVISION.md` is retired and the `/h4tcher-re-envision` skill is replaced by `/h4tcher-evolve`. CONSTITUTION §8 "EVOLVE session authorization" replaces the RE-ENVISION direct-edit authorization: in-session per-file owner consent constitutes §8 approval for all governance layers (labeled consent ASK on §8-tier files); out-of-session changes keep the CL-3 / §8-queue routes. Lean table recalibrated: RE-ENVISION row removed, EVOLVE `<=400` → `<=700` lines, governance total re-derived as the 6 lean-tracked prompts (CONSTITUTION + VISION + AUDIT + AUDIT-EXECUTE + EVOLVE + pack-trust-model) `<=3120` lines. Validators and tests retargeted: `scripts/validate-governance-total.ts` scopes the 6-prompt list, `scripts/validate-traceability-matrix.ts` reads the Domains column after the RE-ENV matrix-column removal, and the D24-15 cached-CLI-count gate (`scripts/validate-governance-currency.ts` + `src/__tests__/governance/cli-count-currency-gate.test.ts`) retargets from RE-ENVISION to `governance/EVOLVE.md`. (#115)

### Chore

- **Docs website + repo docs currency**: landing page stats now build-time-derived from `governance/inventory.json` (29 agents / 53 skills / 67 rules / 30 commands / 3 adapters — were 16/26/27/34/15) with the tools grid cut to the 3 supported adapters and `/.agents/` copy removed; private-governance citations across `website/docs/` and 9 repo `docs/*.md` files reworded to public-safe statements with stale counts corrected; org slug normalized to `github.com/hatch3r/hatch3r`; the `/h4tcher-docusaurus-generator` skill no longer sources private governance files. (#115)

## [2.1.0] - 2026-06-26

### Headline

Adds a `hatch3r setup` command that scaffolds a fresh project (mkdir + git init, opt-in GitHub remote) and chains into `init`, and fixes the `/` slash-command picker showing the `HATCH3R:BEGIN` managed-block marker instead of each command/skill description across all three adapters. Interactive `init` now asks for the project maturity tier (the 4th of ≤6 prompts) and prints the defaults it inferred; `config` gains interactive maturity and `confidence_floor` steps and stops silently disabling the `handoffs` feature on re-run. No breaking CLI changes; manifest schema unchanged (schemaVersion 3).

### Added

- **`hatch3r setup [dir]`** — scaffold a new project then initialize it: creates the directory, runs `git init` (idempotent), optionally creates a GitHub remote with `--remote` (via `gh`, skipped with a warning when unavailable), then chains into the `init` prompts. Standard `--format <human|json>` / `--quiet` / `--dry-run` / `--verbose` flags. (CLI commands 19 → 20.)
- **Maturity-tier prompt in `init`** — every interactive run now asks for the project maturity tier (solo / team / scaleup / enterprise), seeded at the git-inferred default; `--maturity <tier>` skips it. A matching maturity step was added to interactive `config`.
- **`confidence_floor` step in `config`** — the agent-assertiveness floor is now settable interactively (tier-aware default), not only via `config confidence_floor=<value>`.
- **Inferred-default feedback in `init`** — prints the default branch and maturity tier it inferred, so silent defaults are visible and correctable.
- **`handoffs` in the `config` feature picker** — the feature is now shown and toggleable.

### Fixed

- **Slash-command picker descriptions** — command files (Claude Code, Cursor, Copilot) and Claude skill files now emit byte-0 YAML `description:` frontmatter, so the `/` picker shows each artifact's real description instead of the `HATCH3R:BEGIN` managed-block marker. Covers the synthetic `hatch3r-agent-team` launcher.
- **`handoffs` silently disabled on `config` re-run** — `handoffs` was missing from the feature picker, so re-running `config` rebuilt the feature set without it and forced it off. The rebuild now preserves any feature not shown in the picker, fixing `handoffs` and preventing the same class of silent drop for future features.

### Chore

- Post-2.0.0 housekeeping rolled into this release: D15 CI guard + npm keywords (#105), removed `release-please.yml` (org blocks Actions-created PRs) (#106), and a Windows-aware heavy-fs test timeout to stop init flakiness (#107).

## [2.0.0] - 2026-06-21

### Headline

Major release on two fronts. **Governance** — a two-axis pillar framework (governance P1-P8 × content-quality CQ1-CQ9) backed by 9 quality-vector specialist agents, 2 spec agents (greenfield/brownfield) with an orchestrator command, 3 new audit domains (D22 Content Architecture, D23 Agentic Engineering Trends, D24 Governance Self-Audit), 6 new canonical rules, 4 new audit templates, and 6 code modules adding maturity-tier config, resumability + per-session snapshot rollback wired into every mutation command (`init`, `sync`, `update`, `config`, `clean`), cost visibility, tag-filtered routing, adapter capability-utilization audit, and an opt-in Playwright browser-verification skill. CONSTITUTION restructured (§2 two-axis, §3 second matrix, 17 new Key Design Decisions). Tag registry expanded from 44 to 76 tags. **CLI** — Claude Code becomes the first-listed tool across every picker and enumeration; `init` and `config` share one set of interactive step builders; MCP moves to pure opt-in (the init MCP prompt is replaced by the CLI-tools picker); `config` content changes are manifest-only; and every non-stub command gains the standardized `--format <human|json>` + `--quiet` flag matrix with a single shared command ending and a registration drift-guard test. Major release without breaking CLI surface; manifest schema unchanged from v1.9.0 (schemaVersion 3).

### Two-Axis Pillar Framework (CONSTITUTION §2)

- **Governance axis (§2A — P1-P8):** how the framework operates. No change to pillar identities; measurements extended per §2 P2.
- **Content-quality axis (§2B — CQ1-CQ9):** what the framework produces. Each CQ pillar carries measurable thresholds (axe-core 0 critical, design-token ≥95%, OAuth 2.1 + OIDC + DPoP + WebAuthn, OTel 100%, real-deal test ratio ≥80%, jscpd ≤5%, etc.).
- **Pillar Compliance Test extended** with Q5 impact horizon (Decision 17) + Q6 P8 dominance over P7.
- §3 Traceability Matrix split into §3.1 (P1-P8) and §3.2 (CQ1-CQ9). 17 new Key Design Decisions (#15-#31) document the 2.0.0 design rationale.

### Bucket 1.1 — 9 Quality-Vector Specialist Agents (Decision 13)

Each new agent reviews end-user code against one CQ pillar with measurable checklist items, two-axis pillar declaration, `floor:content-quality` admission tag, proof_trace + impact_horizon + progress_toward_pillar output contract per Decision 17, and ≥2 web-researched references ≤12 months old per Decision 14.

- `agents/hatch3r-ui.md` (CQ1) — WCAG 2.2 AA via axe-core, design-token ≥95%, four-state surface contract
- `agents/hatch3r-ux.md` (CQ2) — error-recovery rate ≥90%, first-run success ≥80%, decisions-per-flow ≤3
- `agents/hatch3r-security.md` (CQ3) — OAuth 2.1 + OIDC + DPoP (RFC 9449) + WebAuthn server-side, SBOM (CycloneDX 1.6) + npm provenance + SHA-pinned actions + cosign-signed containers
- `agents/hatch3r-reliability.md` (CQ4) — OTel 100% on request path, SLO with multi-window burn-rate alerts (Google SRE), RED+USE metrics, RFC 9457 problem+json, circuit breaker + decorrelated jitter
- `agents/hatch3r-testability.md` (CQ5) — per-feature test-class mandate map (parser→fuzz, payment→mutation, RPC→contract), real-deal-first ≥80%, AI feature eval 100%
- `agents/hatch3r-scalability.md` (CQ6) — stateless-handler ratio ≥95%, back-pressure, idempotency-Key per Stripe pattern
- `agents/hatch3r-performance.md` (CQ7) — Core Web Vitals p75 (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1), backend p95 ≤200ms / p99 ≤500ms, N+1 = 0
- `agents/hatch3r-maintainability.md` (CQ8) — jscpd ≤5%, pattern-reuse ≥70%, complexity ≤10, expand-contract migration 100%
- `agents/hatch3r-enhancability.md` (CQ9) — feature-flag adoption 100% on behavior changes, semver, RFC 9745 Deprecation + RFC 8594 Sunset headers

### Bucket 1.2 — 2 Spec Agents + Orchestrator (Decision 14)

- `agents/hatch3r-greenfield-spec.md` — market research + competitive analysis + persona + tech-stack + PRD + acceptance criteria + risk inventory + test plan
- `agents/hatch3r-brownfield-spec.md` — codebase map + existing-pattern detection + integration-surface analysis + migration-aware plan + non-destructive-adoption check
- `commands/hatch3r-spec.md` — orchestrator picks greenfield vs brownfield by project-state detection

### Bucket 1.3 — 3 New Audit Domains (Decision 19)

- `governance/audit/domains/D22-content-architecture.md` (4 SAs) — obsolete / mergable / missing / fusionable artifacts in canonical corpus + `.claude/*` system
- `governance/audit/domains/D23-agentic-engineering-trends.md` (3 SAs) — per-cycle web research on public implementer-agent prompts, MCP protocol, AI SDK, agentic-coding CLI releases
- `governance/audit/domains/D24-governance-self-audit.md` (4 SAs) — applies rigor contract + behavioral charter to governance corpus itself

### Bucket 1.4 — 6 Canonical Rules

Each rule ships with `.md` + `.mdc` twin per `scripts/validate-rule-parity.ts`.

- `rules/hatch3r-learning-system.{md,mdc}` (Decision 22) — structured frontmatter + auto-consolidation + mandatory consultation gate
- `rules/hatch3r-iteration-summary.{md,mdc}` (Decision 23) — 9-section template
- `rules/hatch3r-proof-model.{md,mdc}` (Decision 9) — proof_trace schema + pre-execution verification gates
- `rules/hatch3r-anti-duplication.{md,mdc}` (Decision 12) — discovery gate + post-write jscpd scan (threshold tunable per tier)
- `rules/hatch3r-capability-matrix.{md,mdc}` (Decision 21) — twin metric (currency + utilization) per adapter
- `rules/hatch3r-cost-visibility.{md,mdc}` (Decision 24) — pre-execution estimate + post-execution actuals + delta

### Bucket 1.5 — 4 Audit Templates (Decisions 18 + 20)

- `governance/audit/templates/high-batch-sub-agent.md` (Tier 2H, ≤8 High findings per same-pattern batch)
- `governance/audit/templates/medium-batch-sub-agent.md` (Tier 2M, ≤15 Medium findings per same-pattern batch)
- `governance/audit/templates/web-comparison-content-audit.md` (Decision 20 comparison-table format)
- `governance/audit/templates/charter-floors-end-user.md` (single-source catalogue split from AUDIT.md directives 15+16)

### Bucket 2.1 — Maturity-Tier Configuration (Decision 4)

`hatch3r config maturity=solo|team|scaleup|enterprise` (set / get / inline key=value). Persisted to `.hatch3r/hatch.json::maturity`. `src/content/index.ts::resolveSelection` gates `tier:*` / `floor:enterprise-only` tags by project tier rank. Default `solo` when manifest absent. 27 new tests.

### Bucket 2.1a — Maturity tiers reframed: content-admission gate → investment-calibration dial (Decision 16 amended)

Maturity (`hatch3r config maturity=solo|team|scaleup|enterprise`) no longer filters which artifacts install — every tier installs the full corpus. Instead it dials investment depth: a new always-on rule `hatch3r-right-sizing` plus the adapter maturity header direct agents to invest only as deep as the tier needs and never default to the enterprise rung, anchored by a universal floor (security, correctness & data integrity, accessibility basics, baseline tests on changed surfaces) that binds at every tier. The 9 content-quality specialists gained per-tier `## Tier calibration` ladders; CONSTITUTION §2B CQ1–CQ9 thresholds split into a universal floor + per-tier ladder (the prior absolute thresholds become the enterprise column; Decision 16 amended).

- **Removed:** the Stage-6 maturity admission filter, `isAdmittedByMaturityTier`, `TIER_TAG_REQUIREMENTS`, the `tier:*` tag facet, and the 69 `tier:*` artifact tags.

### Bucket 2.2 — Resumability + Rollback (Decision 27)

- `src/pipeline/checkpoint.ts` — workspace-checkpointed orchestrator resumability via `.{cmd}-workspace/checkpoint.json`
- `src/pipeline/snapshot.ts` — pre-mutation snapshots under `.hatch3r/snapshots/<session-id>/`; tombstone sentinels handle file deletion on rollback. Exports `createSnapshot`, `applyRollback`, `listSnapshots`, plus the new `withSnapshot(commandName, paths, mutator)` helper used by every mutation command.
- `src/cli/commands/rollback.ts` — `hatch3r rollback --session=<id>` + `list` + `--dry-run` + `--yes`
- Snapshot capture wired into every mutation command: `init`, `sync`, `update`, `config` (interactive + scalar `key=value` forms), and `clean`. Each run prints the captured session id in its success summary and surfaces a one-line revert command (`hatch3r rollback --session=<id>`). Session ids are namespaced by command (`init-...`, `sync-...`, `update-...`, `config-...`, `clean-...`). `--dry-run` on sync skips capture.
- `--resume` flag surface declared on `init` + `sync`
- 63 new tests; coverage exceeds 90/80/90/90 on all new pipeline modules

### Bucket 2.3 — Cost Visibility (Decision 24)

- `src/pipeline/costEstimator.ts` — `estimateCost` per Light/Standard/Deep tier midpoints, `recordActuals` (atomic write), `computeDelta` (flags >25% variance), `formatCostBlock` (iteration-summary cost: block)
- `src/pipeline/observability.ts` extended with `recordSubAgentSpawn` / `recordPhaseDuration` / `recordTokenCost`
- 49 new tests

### Bucket 2.4 — Tag-Filtered Routing (Decision 8)

- `src/content/routing.ts` — pure functions: `filterCandidatesByTags` + `narrowByProjectDetection` + `buildCandidateSet` with rationale array. Floor + protected items bypass every filter. Wiring into `resolveSelection` deferred to follow-up integration commit.
- 37 new tests; coverage 98.68/95/100/98.52

### Bucket 2.5 — Capability-Utilization Audit Logic (Decision 21)

- `src/adapters/capabilityMatrix.ts` — `enumerateAdapterCapabilities`, `enumeratePlatformCapabilities` (reads `docs/adapter-capability-matrix.md` sentinel + built-in seed), `computeUtilization`, `surfaceFindings` (Medium for high-leverage, Info for low-leverage, satisfies rigor-contract Required Finding Output Schema)
- 21 new tests

### Bucket 2.6 — Playwright Browser-Verification Skill (Decision 16)

- `skills/hatch3r-browser-verify/SKILL.md` — opt-in skill, default ON for `hatch3r-ui` + `hatch3r-ux`, disable via `hatch3r config browser=off`. Visual verification + axe-core a11y + screenshot regression + E2E test scaffolds.
- Skill ID `hatch3r-browser-verify` (renamed to avoid cross-type collision with pre-existing `rules/hatch3r-browser-verification.{md,mdc}` from v1.6.0)
- `agents/hatch3r-ui.md` + `agents/hatch3r-ux.md` declare `browser_capability: opt-in`

### Tag-Registry Expansion (src/content/tags.ts)

32 new tags added to `TAG_REGISTRY`:

- **CQ-vector capability tags** (10): `security`, `reliability`, `testing`, `scalability`, `maintainability`, `enhancability`, `observability`, `supply-chain`, `accessibility`, `orchestrator`
- **Work-type capability tags** (21): `spec`, `greenfield`, `brownfield`, `migration`, `telemetry`, `cost`, `anti-duplication`, `code-quality`, `code-standards`, `adapters`, `capability`, `currency`, `iteration`, `summary`, `learning`, `knowledge-capture`, `proof`, `verification`, `citation`, `playwright`, `visual-regression`
- **Floor tag** (1): `floor:content-quality`

`ALL_TAGS` 44 → 76. `tagsForFacet("capability")` 9 → 40. `tagsForFacet("floor")` 3 → 4.

### Bucket 3.1 — Legacy Meta-Agent Retirement (F16.3-H1, Cycle 10)

Retired 5 legacy meta-agents in favor of the 9 CQ specialists per CONSTITUTION §6 Decision 13. Per F16.3-H1 close-out, Cycle 10. Successor mapping for downstream references:

- `agents/hatch3r-a11y-auditor.md` → `agents/hatch3r-ui.md` (CQ1 — WCAG 2.2 AA via axe-core, design-token ≥95%)
- `agents/hatch3r-dependency-auditor.md` → `agents/hatch3r-security.md` (CQ3 — supply-chain via SBOM/SLSA/CVE feeds)
- `agents/hatch3r-perf-profiler.md` → `agents/hatch3r-performance.md` (CQ7 — Core Web Vitals p75, backend p95)
- `agents/hatch3r-security-auditor.md` → `agents/hatch3r-security.md` (CQ3 — OAuth 2.1 + OIDC + DPoP + WebAuthn)
- `agents/hatch3r-test-writer.md` → `agents/hatch3r-testability.md` (CQ5 — test mandate-map, real-deal ratio ≥80%)

Cross-references in canonical content, framework-dev docs, website docs, governance templates, and `governance/inventory.json` updated to the successor agent IDs. Historical audit findings, finding-registry entries, and prior-release CHANGELOG entries retain their original IDs as immutable cycle records.

### Claude-Code-first tool ordering

- `TOOLS` in `src/types.ts` reordered to `["claude", "cursor", "copilot"]`; every derived surface (tool picker choices, `--tools` help text, adapter enumeration, README + website tables) now lists Claude Code first. Ordering only — no behavioral change to any adapter.

### Shared init/config step builders (drift-proof parity)

- `src/cli/shared/flowSteps.ts` — platform, identity, preset, custom-items, tools, CLI-tools, MCP-gate, and MCP-servers steps extracted into shared factories consumed by init's single-repo flow, init's workspace flow, and config. Prompt copy, name keys, defaults, skip predicates, and Shift+Tab BACK threading are single-sourced, so the two commands can no longer drift apart prompt-by-prompt (the pre-extraction test answer-queues pass unmodified).

### MCP is pure opt-in; init's fifth prompt is the CLI-tools picker

- Interactive `init` no longer prompts for MCP. The flow is: platform → repo identity → preset → (custom items, only when preset=custom) → tools → CLI-tools picker (tier-1 + trigger-matched tier-2 pre-checked, so enter-through equals the `--yes` smart default).
- MCP opt-in paths: `init --mcp` on any init path, or `hatch3r mcp setup` afterwards. `features.mcp` defaults to false; `mcp setup` and `mcp remove` maintain the flag (`true` only while at least one server remains selected) so adapter emission and `sync` stay consistent with the manifest.
- `--no-mcp` force-disables even when combined with `--mcp`, so a CI config can self-document "no MCP" instead of relying on the implicit default.

### config content changes are manifest-only

- `hatch3r config` add/remove of content items updates `.hatch3r/hatch.json` and regenerates adapter outputs from the bundled canonical content — no `.agents/` materialization on any path. Removing an item still rescues hand-authored `.customize.yaml`/`.customize.md` overrides into the archive via `archiveCustomizeOverrides` (skipped under `--dry-run`, which performs no writes).

### Standardized flag matrix + shared command endings

- Every non-stub command and subcommand registers `--format <human|json>` + `--quiet` (normalized via `parseFormatOption`); mutating commands register `--dry-run` with wired previews (init, sync, update, config, clean, rollback, worktree-setup, worktree-cleanup, mcp setup/remove, cli-tools, learn capture); `--verbose` is registered only where detail output is wired — a registered-but-unread flag violates the Silent Failure Contract.
- `--format json` on a prompting invocation (e.g. `mcp setup`, bare `cli-tools`, interactive flows without `--yes`) is an exit-2 usage error; an invalid `--format` value is also exit 2. JSON mode emits exactly one document on stdout with the envelope `{ status, <command payload>, command, hatch3rVersion, timestamp }`; diagnostics stay on stderr. Legacy `init --json` is kept as a boolean alias that upgrades `--format` to `json`.
- `src/cli/shared/commandOutput.ts` — `beginCommand`/`finishCommand` are the single chokepoint for command endings: one outcome box + ≤3 next-steps + optional timing in human mode, or the one JSON envelope in JSON mode, never both.
- Drift guard: `src/__tests__/cli/index.test.ts` ("W5 flag-surface drift guard") fails when a newly registered command or subcommand is not classified into the flag matrix.

### Dry-run no-write contracts

- `--dry-run` paths are covered by tests asserting no file mutation (manifest, adapter outputs, `.env.mcp`, archive moves) across init, sync, update, config, clean, rollback, worktree-setup/cleanup, mcp setup/remove, cli-tools, and learn capture.

### Security — path-charset guard

- **Path-charset guard in `archiveCustomizeOverrides`** (`src/content/index.ts`): a cleaned item id outside `[A-Za-z0-9._-]` (or containing `..`) is rejected before any path is built, closing a traversal read/delete primitive that would open if a future caller wired user-supplied ids into the rescue flow. Degrades like the function's other failure modes (verbose diagnostic + skip, no throw).

### Inventory

agents 19 → 29 (net +10: +11 from Bucket 1.1's 9 CQ specialists + Bucket 1.2's 2 spec agents, −5 from Bucket 3.1 legacy retirements, +4 from the finalize-readiness expansion); skills 39 → 53; rules 40 → 67; commands 25 → 30; hooks 6 → 7; pipeline modules 18 → 22; CLI commands 14 → 19; audit domains 21 → 24.

All counts in this Inventory section are sourced from `governance/inventory.json` (`counts` object, regenerated by `npm run inventory`) at release-cut — the single source of truth that the `inventory --check-docs` CI gate diffs against README + CLAUDE.md + `.cursor-plugin/plugin.json`.

`.cursor-plugin/plugin.json` synced to 2.0.0 — `version` bumped 1.9.0 → 2.0.0 and the `description` count metadata regenerated from `governance/inventory.json` (D10-SA10.1-F-11).

### Gates

- `npx tsc --noEmit` — 0 errors
- `npm test` — 5863 passing, 3 skipped (5866 total)
- `npm run lint` — 0 errors
- `npm run validate` — 67/67 rule pairs OK; 0 errors across efficiency-invariants, bridge-budget, fanout-emission, cli-skills, wiring
- Anti-slop wordlist scan — 0 hits across all new content

### Fixed

- **PreToolUse allowlist hook resolves regardless of working directory.** The Claude adapter wired the `.claude/hooks/pretooluse-allowlist.mjs` launcher with a cwd-relative path in exec-form `args`; when the hook fired from a non-root working directory (e.g. the Agent tool spawning a sub-agent) Node threw `node:internal/modules/cjs/loader:1386` ("Cannot find module"), surfaced as a non-blocking "PreToolUse:Agent hook error" on every Agent invocation. The launcher is now shell-form anchored to `$CLAUDE_PROJECT_DIR` (`node "$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-allowlist.mjs"`), and uses `node` from PATH instead of the generation-time `process.execPath` for portability across Node upgrades and machines.

## [1.9.0] - 2026-05-26

### Headline

Adapter scope cut from 15 to 3 (Claude Code, Cursor, GitHub Copilot) and a bundled-content refactor that removes the `.agents/` materialization step from end-user repos. Manifest, learnings, handoffs, MCP config, and the user-content escape hatch all relocate under a single `.hatch3r/` directory. Content pack redesign splits the flat `tags: string[]` into 3 logical facets (capability / floor / context) with structural floor admission for security + UI/UX in every preset. Schema version bumped to 3. This is a breaking release.

### Content Pack Redesign (P1, P2, P4, P6)

Replaces the brittle `includeTags` / `excludeTags` filter with a 4-stage admission pipeline driven by typed tag facets. Source of truth for the design: `.audit-workspace/council-D-architect.md` (4-member sub-agentic council deliverable that preceded the implementation).

- **Tag taxonomy (`src/content/tags.ts`) — full rewrite.** New facets: capability (`orchestration`, `planning`, `implementation`, `review`, `devops`, `maintenance`, `board`, `performance`, `ai`), floor (`floor:security`, `floor:ui-ux`, `floor:protocol`), context (`ctx:greenfield-only`, `ctx:brownfield-only`, `ctx:team-only`), customize (`customize`), ui-ux specialisation (`a11y`, `frontend`, `ui`, `ux`, `design-system`), cli-tool + cli-tool-category (CLI category `ai` renamed to `ai-cat` to disambiguate from the new `ai` capability), language. `TAG_REGISTRY` is the single source of truth; helpers `facetOf`, `tagsForFacet`, and per-facet `is*` predicates replace hard-coded enumerations. Tags before: 42. Tags after: 38.
- **Removed tags:** `core` (split into `orchestration` capability + `floor:protocol`), `solo` (decorative; unused), bare `security` (now `floor:security`). Renamed: `team` → `ctx:team-only`, `greenfield` → `ctx:greenfield-only`, `brownfield` → `ctx:brownfield-only`.
- **Filter semantics (`src/content/index.ts::resolveSelection`) — replaced.** 4 stages: custom path → floor admission (every `floor:*` item admitted unconditionally for every non-custom preset) → capability gate (positive intersection; customize gated by `preset.includeCustomize`; per-id `includeIds`/`excludeIds` carve-outs) → context filter (`ctx:*-only`; floor items bypass team-size filtering) → language filter. **The "empty tags = passthrough" loophole is reversed**: items with zero capability + zero floor + not protected are now DROPPED.
- **Preset DSL (`src/content/presets.ts`) — replaced.** `includeTags`/`excludeTags` removed. New fields: `capabilities: CapabilityTag[]` (positive list; floor not listed), `includeCustomize: boolean` (locked: `false` for minimal, `true` for standard + full), optional `includeIds`/`excludeIds` for per-id carve-outs (cannot remove floor or protected items).
- **Floor categories enforced structurally** (cannot be disabled by preset config):
  - `floor:security` (P6) — security rules, auditor agents, secrets/auth/data-classification rules
  - `floor:ui-ux` (P1/P2) — UI/UX verification, accessibility (a11y is part of UI/UX floor), state design, design-system detection, theming, AI UX patterns
  - `floor:protocol` — pipeline-critical agents (researcher, implementer, reviewer, fixer, test-writer) and orchestration rules; ensures the framework's sub-agent pipeline ships in every preset
- **Canonical content re-tagged** (~117 of 175 artifacts) via auditable migration scripts left in place: `scripts/wave2-retag.ts` (main retag pass) and `scripts/wave2-fix-cli-skills.ts` (CLI-skill capability fix).
- **Preset item counts (brownfield / team / typescript context):** minimal = 93 (up from ~62; raised floor admits security + UI/UX + protocol), standard = 159 (board ✓, customize ✓, tier-2 CLI ✓), full = 168 (all 30 CLI-tool skills via `full.includeIds` for tier-3).
- **5 deprecation hawks removed** (verified zero cross-references per Council C's audit):
  - `rules/hatch3r-observability.md` + `.mdc` — `deprecated: true`; superseded by `hatch3r-observability-{logging,metrics,tracing}`
  - `rules/hatch3r-observability-tracing-detail.md` + `.mdc` — `deprecated: true`; consolidated into `hatch3r-observability-tracing`
  - `prompts/hatch3r-bug-triage.md` — orphaned; function subsumed by `cmd-hatch3r-bug-plan` + `cmd-hatch3r-debug`
  - `prompts/hatch3r-code-review.md` — orphaned; function subsumed by `hatch3r-reviewer` agent
  - `prompts/hatch3r-pr-description.md` — orphaned; function subsumed by `cmd-hatch3r-pr-resolve` + `hatch3r-pr-creation` skill
  
  Cross-reference cleanup in `rules/hatch3r-ai-evals.{md,mdc}` (re-pointed to consolidating rule), `rules/hatch3r-agent-orchestration.{md,mdc}` (enumeration trim), `governance/CONSTITUTION.md` (`*-detail` authorised list), `agents/shared/quality-charter.md`, `agents/hatch3r-reviewer.md`, `skills/hatch3r-observability-verify/SKILL.md`, `governance/hatch3r-prd.md`. `prompts/` directory is now empty; the `prompt` artifact type remains in `src/content/index.ts::TYPE_TO_SELECTION_KEY` for forward compat.
- **User-tier override migration.** User content under `.hatch3r/overrides/` carrying legacy tag values (`core`, `team`, `solo`, `greenfield`, `brownfield`, plain `security`) is no longer recognised by the new filter — items with no matching capability + no floor + not protected drop silently. Migration guide: `docs/MIGRATION-content-pack-redesign.md`.

### Breaking Changes

- **Adapter scope cut to 3.** Only `claude` (Claude Code), `cursor`, and `copilot` (GitHub Copilot) are supported. Hard cut — no compatibility stubs, no deprecation period.
- **`.agents/` no longer written into user repos.** Adapters now read canonical content from the bundled npm package via `resolveBundledContentRoot()`. The only hatch3r-managed directory in your repo is `.hatch3r/`.
- **Root `/AGENTS.md` removed.** Each adapter emits only its native surface (`.claude/` + `CLAUDE.md`, `.cursor/`, `.github/copilot-instructions.md` and related Copilot dirs). The shared bridge file is gone along with `SHARED_ADAPTER_KEY` / `SHARED_BRIDGE_FILES`.
- **Manifest moved to `.hatch3r/hatch.json`** (was `.agents/hatch.json`). Auto-migration shim relocates on first `init`/`sync`/`update`.
- **User-content escape hatch moved to `.hatch3r/overrides/`** (was `.agents/user/`). Adapters check overrides first, fall back to bundled canonical content.
- **Learnings, handoffs, and MCP config moved to `.hatch3r/learnings/`, `.hatch3r/handoffs/`, `.hatch3r/mcp/`** (were under `.agents/`). Migration shim handles the relocation.
- **Integrity manifest removed.** No more `.integrity.json` file, no SHA-256 per-file checksums. `hatch3r verify` and `hatch3r status` now do drift detection on adapter outputs only — compare regenerated output (from bundled content) against on-disk copy for every path in `manifest.managedFiles`.
- **Manifest `schemaVersion` bumped to 3.** Older manifests are auto-migrated on read.

### Removed

- 12 adapter implementations and their tests, snapshots, type entries, and CLI registry rows: `aider`, `amazonq`, `amp`, `antigravity`, `cline`, `codex`, `gemini`, `goose`, `kiro`, `opencode`, `windsurf`, `zed`.
- Adapter id surface trimmed in `src/types.ts` (`TOOLS` / `Tool`), `src/cli/shared/constants.ts` (`TOOL_DISPLAY_NAMES`, invocation syntax, secret notes), `src/pipeline/adapterToolTranslator.ts` (`NativeAgentConfig`, `ASK_USER_TOOLS`), `src/detect/repoAnalyzer.ts` (`TOOL_INDICATORS`), and `src/worktree/index.ts` (`ADAPTER_WORKTREE_PATTERNS`).
- `src/integrity/` integrity-manifest module is reduced to drift-only semantics; `.integrity.json` reads/writes deleted.
- `generateRootAgentsMd` and root-`AGENTS.md` emission paths in `src/cli/commands/init.ts` and `src/workspace/sync.ts`.

### Migration Notes

- **Auto-migration shim** runs on first `init`/`sync`/`update` against an existing project:
  - `.agents/hatch.json` → `.hatch3r/hatch.json`
  - `.agents/user/` → `.hatch3r/overrides/`
  - `.agents/learnings/` → `.hatch3r/learnings/`
  - `.agents/handoffs/` → `.hatch3r/handoffs/`
  - `.agents/mcp/mcp.json` → `.hatch3r/mcp/mcp.json`
  - Old paths are removed after a successful relocation; one-shot warning printed.
- **Removed-adapter directories are NOT auto-cleaned.** Per the maintainer's hard-cut decision, existing user repos with `.windsurf/`, `.gemini/`, `.codex/`, `.cline/`, `.kiro/`, `.goose/`, `.amazonq/`, `.antigravity/`, `.aider/`, `.amp/`, `.opencode/`, or `.rules` directories will see them as orphaned after upgrading. Remove them manually (`rm -rf .windsurf .gemini ...`). A follow-up `hatch3r migrate --remove-deprecated-adapters` command is queued for a later release.
- **CI scripts using `--tools` with removed adapter ids will fail at validation.** Trim invocations to `--tools claude,cursor,copilot` (or a subset). Unknown adapter ids are rejected, not silently ignored.
- **Custom content under `.agents/user/`** is preserved by the migration shim — but verify the move after first sync; the shim warns on collisions and skips overwrite.

### Init UX Overhaul (P1, P3, P4, P5)

`npx hatch3r init` is rebuilt around a weighted-signal project detector and a step-machine that reduces prompts and explains its defaults.

- **Weighted-signal detector** in `src/detect/projectType.ts` returns `{type, confidence, signals[]}` synthesised from git depth, `src/`/`lib/`/`app/` presence, `package.json` dependencies, README size, primary language, existing CLI-tool indicators, and any existing `.agents/` directory. The top-3 signals are appended to the prompt message so the user sees why the default greenfield/brownfield choice is what it is — no more opaque pre-selected radio button.
- **Feature picker reduced.** Agents, rules, and skills are always-on and no longer appear as checkbox options. MCP is lifted out of the feature checklist and into a dedicated `confirm` gate (opt-in default no), matching the 1.7.5 MCP-demotion contract.
- **Post-init "create your first artifact?" prompt removed.** The flow ends with a single tip line gated only by `!isQuiet()` — no extra decision after the canonical config is on disk.
- **Worktree-capable tools expanded** from `{claude}` to `{claude, cursor, copilot}` (verified against the current Cursor and Copilot platform docs). Same auto-enable is applied to the `update` migration checkpoint.
- **`src/cli/shared/initSteps.ts` (246 LOC, new module)** implements the step machine: `Step<S, K>` interface, `BACK` sentinel, `runStepMachine` driver, and `askSelect` / `askCheckbox` / `askConfirm` / `askInput` helpers reused by `init`, `config`, and `worktree-cleanup`.

Pillar service: P1 (fewer decisions, signal-explained defaults), P3 (worktree parity across all 3 adapters), P4 (replaces ad-hoc prompt chains with one reusable driver), P5 (the always-on artifact classes match the canonical content model).

### Shift+Tab Back-Navigation (P1, P4, P8)

Back-navigation is promoted from a per-prompt `← Back` menu choice / `:back` string literal to a real key control (CSI Z), closing the timer race and readline-conflict bugs that plagued the 1.8.0 stop-gap.

- **`src/cli/shared/backablePrompts.ts` (722 LOC, new module)** forks `select` / `checkbox` / `input` / `confirm` via `@inquirer/core::createPrompt` and registers each fork under its standard name. The fork intercepts Shift+Tab in `useKeypress` and resolves with a shared `BACK` sentinel — `Symbol.for("hatch3r.BACK")` so identity survives module-boundary crossings. Every fork renders a key-controls footer: `↑↓ navigate · ⏎ select · Shift+Tab back`.
- **`BACKABLE_COMMANDS` allow-list** in `src/cli/index.ts` — `init`, `config`, `worktree-cleanup`, `clean`, `update`, `mcp`, `cli-tools`. Stray Shift+Tab outside the allow-list cannot leak the `BACK` sentinel into a non-audited command's string consumers.
- **`config` and `worktree-cleanup` lifted to `runStepMachine`** so the new back-nav semantics propagate to every multi-step flow without per-command wiring.
- **Build wiring:** `@inquirer/core` and `@inquirer/figures` externalised in `tsup.config.ts`; `mute-stream` promoted to direct dependency so end-user installs resolve it via the package registry rather than relying on a transitive bring-along.

Pillar service: P1 (single key chord replaces per-prompt menu items), P4 (one fork module replaces ad-hoc back-strings across 7 commands), P8 (Shift+Tab is now the canonical back-out mechanism for ambiguity-resolution flows that need a do-over).

### Companion Content Emission (P3, P4)

Pre-1.9.0, companion/reference content under support subdirectories (`agents/modes/`, `agents/shared/`, `commands/board/`, `commands/revision/`, `checks/`) was materialised in the user's `.agents/` mirror. The bundled-content migration (e4e5126) removed that mirror without re-emitting the companion subtrees, so canonical references like `agents/shared/quality-charter.md` stopped resolving in user repos.

- **`BaseAdapter::emitCompanionContent` (new helper)** walks a canonical subdirectory, applies `substituteCanonicalContent` so the `PLATFORM-TOOL` marker in `user-question-protocol.md` is replaced per adapter, and emits each `.md` file as a managed-block output under the adapter's native path. Path references inside companion bodies are left intact — the runtime agent resolves filenames via Grep/Glob, which works against the per-adapter copies as written.
- **Wired into `claude`, `cursor`, and `copilot` adapters** so every shipped surface exposes the same companion content reachable from a canonical-content reference.

Pillar service: P3 (each adapter surface now ships the full companion-content set the canonical artifacts reference), P4 (one helper replaces three potential per-adapter implementations).

### Rule Precedence Application — 23 high + 2 critical (P2, P4, P5, P6)

The `precedence` frontmatter field shipped in 1.8.0 was unused on 46 of 52 rules. Cosmetic rules (theming, i18n, commit-conventions) shared the same default rank as security, secrets, auth, testing, migrations, supply-chain, observability, accessibility, and the entire CONSTITUTION §2 P2 "100% / 0" hard-mandate set.

- **Critical (rank 100, prefix `10-`):** `hatch3r-security-patterns`, `hatch3r-secrets-management`.
- **High (rank 300, prefix `30-`):** `hatch3r-auth-patterns`, `hatch3r-passkey-server`, `hatch3r-data-classification`, `hatch3r-testing`, `hatch3r-ai-evals`, `hatch3r-contract-testing`, `hatch3r-migrations`, `hatch3r-api-versioning`, `hatch3r-event-schema-evolution`, `hatch3r-ci-cd`, `hatch3r-container-hardening`, `hatch3r-dependency-management`, `hatch3r-observability-logging`, `hatch3r-observability-metrics`, `hatch3r-observability-tracing`, `hatch3r-operability`, `hatch3r-resilience-patterns`, `hatch3r-accessibility-standards`, `hatch3r-ux-states-and-flows`, `hatch3r-design-system-detection`. Framework-dev gatekeepers: `.claude/rules/pillar-compliance`, `governance-lean-thresholds`, `anti-slop-enforcement`, `security-patterns`, `content-authoring`, `test-requirements`.
- **Six framework-dev `.claude/rules/` files that lacked frontmatter** received full `id` / `type` / `description` / `tags` / `scope` / `precedence` blocks so the parity gate has something to compare against.
- **Mechanical change; gates green:** `validate:rule-parity` 40 pairs / 0 drift, `validate` (efficiency / bridge-budget / cli-skills / wiring), `hatch3r validate` 0 errors, `tsc` 0 errors, `eslint` 0 errors, `vitest` 131 files / 3355 tests.

Pillar service: P2 (rank now matches the §2 P2 hard-mandate set), P4 (cosmetic vs critical no longer collapsed into one rank), P5 (the frontmatter field shipped in 1.8.0 finally has consumers), P6 (security / secrets / auth / data-classification surface above defaults).

### Blueprint-v2 Feature Removal (P4, P5)

Maintainer directive: `blueprint-v2` (v2.0.0 clean-slate rebuild spec generator + governance workspace) removed in full. Sixth lifecycle preset with no use outside its own dialog runs; ~1300 lines of governance content that no longer fit the active 8-pillar framework.

- **Removed (tracked):** `governance/BLUEPRINT-V2.md`, `governance/blueprint-v2/` (README + `decisions/INDEX` + `workspace/`), `.claude/skills/h4tcher-blueprint-v2/SKILL.md`.
- **Cross-references scrubbed** in `CLAUDE.md` and `.claude/rules/capability-lifecycle.md` so the lifecycle decision tree and pillar/skills overview no longer point at a deleted preset.
- **Governance total: 2789 lines** (was ~4100 with blueprint-v2; CONSTITUTION lean limit 3000).

Pillar service: P4 (removes a preset with no use outside its own dialog runs; cuts ~1300 governance lines), P5 (governance total back under the 3000-line lean cap with margin to spare).

### Command-vs-Skill Refactor + CLI-toolbox Consolidation (P4, P5, P8)

A capability-lifecycle iteration that codifies when an artifact belongs in `commands/` vs `skills/`, then applies the new criterion across the canonical content surface.

- **Codified Command-vs-Skill criterion** in `governance/CONSTITUTION.md` §6 Decision #13 and `.claude/rules/content-authoring.md` (item #9). Commands are user-invocable orchestrators; skills are model-invoked capabilities. Mixed-purpose artifacts split or collapse.
- **Added reputable-source reconnaissance mandate** for content authoring in `governance/CONSTITUTION.md` §6 Decision #14, `.claude/rules/content-authoring.md` (item #10), and `.claude/skills/h4tcher-content-author/SKILL.md` (new Step 3). Every new agent / skill / rule / command / hook authored in this repo must cite ≥2 reputable sources (vendor docs, RFCs, OWASP, framework READMEs) before merging.
- **Collapsed the 4 customize commands** (`hatch3r-agent-customize`, `hatch3r-command-customize`, `hatch3r-rule-customize`, `hatch3r-skill-customize`) and their paired redirect skills into the single canonical `skills/hatch3r-customize/SKILL.md`. Net change approximately -651 LOC.
- **Demoted 5 commands to skills** (`context-health`, `cost-tracking`, `dep-audit`, `recipe`, `release`) and **converted 4 board-* commands to skills** (`board-init`, `board-groom`, `board-refresh`, `board-shared`). These 9 artifacts were model-invoked under the new criterion, not user-facing orchestrators. Net governance reduction approximately -900 LOC.
- **Consolidated 25 specialist CLI-tool skills** into a single category-indexed `skills/hatch3r-cli-toolbox/SKILL.md` (269 lines). 5 essentials kept standalone (`ripgrep`, `jq`, `gh`, `fd`, `fzf`). Net change approximately -1,960 LOC.
- **Inventory deltas:** commands 38 → 25 (Δ-13), skills 63 → 39 (Δ-24), CLI skills 30 → 6.
- **Total iteration:** approximately -3,500 LOC across canonical content + governance.

Pillar service: P4 (removes overlapping artifacts; single source of truth per capability), P5 (criterion is testable via the new content-authoring rule and the discover/refactor lifecycle presets), P8 (B1 reputable-source mandate makes ambiguity-resolution part of authoring, not an afterthought).

### RE-ENVISION Direct-Edit Pass + Two-Axis Pillar Framework (P5, P8)

Holistic governance sweep run via `/h4tcher-re-envision` on the open release branch. The §6.1 direct-edit pass landed 48 atomic edits across 9 files (VISION, CONSTITUTION, AUDIT, AUDIT-EXECUTE, EVOLVE, CLAUDE.md, quality-charter, user-question-protocol), and the §8 amendment queue cluster A-1 then restructured CONSTITUTION §2 around a two-axis pillar framework for hatch3r 2.0.0 (governance axis P1-P8 + content-quality axis CQ1-CQ9).

- **§6.1 direct-edit pass (commit 4f01064):** 48 edits across 9 files; lean thresholds satisfied (VISION 249/250, CONSTITUTION 244/410, AUDIT 549/600, AUDIT-EXECUTE 705/720, EVOLVE 361/400, quality-charter 263, user-question-protocol 97, CLAUDE.md 163/300). AUDIT-EXECUTE.md gate 11 anti-slop wordlist is now byte-identical to the CLAUDE.md §Anti-Slop block (atomic-pair invariant). EVOLVE §1.3 vs §6 CLAUDE.md scope contradiction closed; 6-pillar references updated to 8-pillar at 6 EVOLVE sites. Workspace artifacts persisted under `.re-envision-workspace/` (gitignored): refinement-plan, cl-3-handoff (60 CL-3 proposals queued), constitution-amendment-queue (9 §8 amendments queued), routing-table, direct-edits.log.
- **§8 Cluster A-1 — two-axis pillar framework (commit 3ed378e):** CONSTITUTION.md +170 / -17 lines. §2 split into §2.0 Axis Overview + §2A Governance Pillars (P1-P8) + §2B Content-Quality Pillars (CQ1-CQ9: UI, UX, Security, Reliability, Testability, Scalability, Performance, Maintainability, Enhancability). §3 traceability widened to §3.1 (governance × 9 file classes) + §3.2 (content-quality × 9 file classes); P6↔VISION and P7↔VISION cells flipped from `—` to `S`. Pillar Compliance Test extended from 4 to 6 questions (Q5 impact_horizon, Q6 P8 dominance). §6 Key Design Decisions extended with 17 new entries (#15-#31). §2 P5 lean-threshold cap raised to ≤550 lines accommodating two-axis growth.

Pillar service: P5 (governance corpus brought to one consistent state, atomic-pair invariants enforced by byte-diff), P8 (B1 ambiguity-resolution + B2 fan-out requirements now first-class entries in the Pillar Compliance Test).

### Audit Cycle 10 Bootstrap — CL-3 Phase (P2, P5)

Audit-self-evolution proposals from RE-ENVISION 2026-05-26 cl-3-handoff.md landed as 5 clusters (C-1 through C-5) ahead of the next audit cycle. CL-3 ships the orchestration scaffolding so Cycle 10 can run against 24 domains with impact-gated registration, SA batching by severity, proof-trace contracts, resumability, and learning consultation.

- **CL-3 C-1 — AUDIT.md (commit 2f9419e):** 11 atomic edits, AUDIT.md +30 / -17 lines (562/600 lean). D22 Content Architecture admitted to Tier B (count 7→8), D23 Agentic Engineering Trends + D24 Governance Self-Audit admitted to Tier C (count 8→10). Tier-weight math 0.308 + 0.348 + 0.304 + 0.040 = 1.000 exact. SA count refreshed: D5 8→9, D7 5→6, D13 4→5; grand total 110→113. Charter directives 21 (Learning Consultation) + 22 (Post-Write Duplication Scan) added. Universal Audit Checklist proof_trace row added. Concurrency-model rate-limit guidance (Tier B 41-SA burst chunking to batches of 20 default, --max-parallel-sa configurable).
- **CL-3 C-2 — AUDIT-EXECUTE.md (commit b309d5e):** 13 atomic edits, AUDIT-EXECUTE.md +127 / -116 lines (706/720 lean). Tier 2H (≤8 High per same-pattern batch) + Tier 2M (≤15 Medium) added, projecting 5x-15x SA spawn reduction for High/Medium severities. Impact-gated registration: Phase 1 Triage drops findings missing impact_horizon or progress_toward_pillar, logged to `.audit-workspace/phase-1-drops.log`. Resumability: `.audit-workspace/checkpoint.json` schema + `hatch3r audit-execute --resume` semantics. Cost projection per-wave (estimated_sa_count, input_tokens_static_frame, web_research_queries, duration_min, triage_tier). proof_trace field added to Sub-Agent Output Contract. Cycle Close Iteration Summary section with 9 mandatory sections (a-i). Execution History moved to `governance/audit/archive/execution-history.md` (+10 lines, single-line pointer from AUDIT-EXECUTE.md).
- **CL-3 C-3 — audit/templates/* (commit 708d7ee):** 9 edit groups across 5 templates, +74 / -8 lines. rigor-contract.md (144/200) gains impact_horizon + progress_toward_pillar fields, Impact-Gated Registration section, Proof Trace Contract section (claim/command/expected/actual/verdict/accessed); P3 name fix `Adapter & MCP Currency` → `Adapter & External Tool Currency`. implementation-sub-agent.md (165/200) gains Pre-Implementation Discovery Gate, Post-Write Duplication Scan (jscpd, tunable per maturity tier), Pre-Implementation Learning Consultation. reviewer-sub-agent.md (198/200) gains Pass 1.6 Learning Consultation Verification. tier1-batch-sub-agent.md (95/200) gains Enum Extension Protocol (5-criteria spec for new tier1_pattern proposals via CL-3). closed-loop-agents.md (151/200) adds Phase 7 carry-forward: accepted proposals carry source finding's impact_horizon + progress_toward_pillar into Conventional Commits trailers (`Impact-Horizon:` + `Progress:`).
- **CL-3 C-4 — audit/domains/* + cross-doc fix (commit ed90764):** 22 domain files updated via 4 parallel batch writer-SAs, +88 / -56 lines across 24 files (22 domains + CONSTITUTION.md +1/-1 + CLAUDE.md +1/-1). Universal edits: `**Pillars served:**` line gains two-axis tagging (`; content-quality-axis Qq (...)`) on the 19 domains with content-quality applicability (D17, D18, D21 governance-only). Impact-gating per-domain audit-checklist row added to 21/22 files. Per-file targeted edits: D01/D09/D11 §Domain Boundary replaced with pointers; D03 Test File Distribution table replaced with inventory.json pointer (88→64 lines); D05/D07/D09 comparable-artifact delta checklist; D09 capability-utilization scan + utilization-gap aggregation in SA 9.4; D14/D15/D20 maturity-tier semantics. All 22 files within lean thresholds. Cross-doc: CONSTITUTION §7 + CLAUDE.md governance refs row reference D15-trust-reference.md as governed appendix and note D22/D23/D24 future authoring.
- **CL-3 C-5 — anti-slop-enforcement.md (commit 636a273):** 1 atomic edit, +1 / -1 line. Updated stale reference `regression gate check 10` → `regression gate check 11` matching AUDIT-EXECUTE.md gate-checks table position 11 after L6-F11 numbering normalization in C-2. Paired with EVOLVE.md gate-10→11 update applied in commit 4f01064.

Pillar service: P2 (impact-gated registration drops untestable findings at Phase 1; proof_trace contract enforces falsifiable causal chains), P5 (Tier 2H/2M batching, resumability checkpoints, learning-consultation directives extend the audit self-evolution loop to 24 domains).

### Validator + Inventory Refresh (P5)

Phase B6 validation pass after the §8 A-1 amendment cluster restructured CONSTITUTION §2 heading from `## 2. The 8 Binding Pillars` to `## 2. Pillar Framework (Two-Axis)`.

- **`scripts/validate-rule-pillar-currency.ts` (+19 / -7 lines, commit 0eb1441):** HEADING_RE regex now accepts both legacy (`## N. The K Binding Pillars`) and 2.0.0+ formats (`## N. Pillar Framework` or `## N. Pillar Framework (Two-Axis)`). In the 2.0.0+ format the heading carries no count; declaredCount is derived from `### P{i}.` sectionCount (governance-axis P1-P8 pillars in §2A). Content-quality `### CQ{i}.` pillars (introduced in §2B) are reserved for future extension and not counted by this script.
- **Inventory regenerated via `npm run inventory`** (`governance/inventory.json` +1 / -1 line): 3 adapters, 19 agents, 39 skills (6 CLI), 40 rules (.md) / 40 (.mdc), 25 commands, 6 hooks, 18 pipeline modules, 14 CLI commands. Counts unchanged from pre-Phase-B state (Phase B authored no new content; new-content authoring deferred to fresh-session-prompt.md Bucket 1.5 per governance-only scope).
- **Validation results post-fix:** validate-rule-parity 40 pairs / 0 drift; validate-rule-pillar-currency P1-P8 canonical, 0 errors, 0 warnings; `npm test` 131 files / 3363 tests passed; `npx tsc --noEmit` 0 errors; `npx hatch3r validate` 0 errors / 2 pre-existing warnings; `npm run lint` 0 errors / 72 pre-existing warnings (unrelated).

Pillar service: P5 (rule-pillar-currency validator now matches the canonical CONSTITUTION §2 heading shape, restoring CI parity after the two-axis restructure).

---

## [1.8.0] - 2026-05-19

### Headline

Cycle 9 audit-execute closure — 149 of 154 targeted findings resolved across four progressive waves with a `FIX-AND-SHIP` reviewer verdict. 657 new regression tests (3162 → 3819, all green) and a 17/17 regression-gate sweep against the Phase 0 baseline (`477deef`) certify the cycle. Pillar service spans P1-P8.

### Added

- **`governance/pack-trust-model.md` (C9-H52)** — formal pack trust contract referenced by the `.claude-plugin/plugin.json::trust_model_ref` field (C9-H73), closing the P6 (Security & Trust) coverage gap for plug-in distribution. The document codifies trust tiers, signature requirements, and revocation flow.

- **`governance/amendment-procedure.md` (C9-M1)** — codified §8 amendment + queued-proposal workflow that splits direct-edit authority from framework-owner-only edits, plus four new CI validators (`scripts/validate-pillar-currency.ts`, `scripts/validate-lean-threshold-currency.ts`, `scripts/validate-fanout-emission.ts`, `scripts/validate-bridge-budget.ts`) that keep pillar text, lean-threshold tables, sub-agent fan-out emission, and the bridge budget in lockstep across CONSTITUTION, AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, CLAUDE.md, and the `.claude/rules/` mirror. Serves P5 (Governance Self-Quality).

- **`governance/audit/templates/calibration-protocol.md` (C9-H43)** — explicit calibration ritual for the rigor-contract trust-tier scoring so audit sub-agents converge on the same evidence weighting; serves P2 (Scientific Quality).

- **New validator scripts under `scripts/`** — `validate-wiring.ts` (C9-H56, dead-code / unreferenced-import scan), `validate-severity-vocabulary.ts` (C9-H58 partial, severity-ladder enforcement), and `scripts/check-mcp-cves.ts` (C9-H54, OSV.dev query on MCP dependencies). Wired into `npm run validate:*` and CI; each maps to a P5 gate.

- **`docs/license-rationale.md` + `docs/sustainability.md` (C9-H67)** — public-facing license-choice rationale and a sustainability plan (funding cadence, maintenance commitments, deprecation policy); serves P1 (CLI UX) and P5.

- **`.claude-plugin/plugin.json::trust_model_ref` field (C9-H73)** — Claude Code plug-in manifest gains a `trust_model_ref` pointer to the new pack-trust-model document, clearing a Marketplace-submission prerequisite. Serves P3 (Adapter Currency).

- **Three CL-2 content specs under `.audit-workspace/content-specs/`** — specifications generated by the closed-loop CL-2 phase identifying canonical content gaps; serves P4 (Lean Coverage).

- **`hatch3r explain --cost <command>` CLI command (C9-H13)** — new `src/cli/commands/explain.ts` returns triage-tier cost annotations on every orchestrator command, surfacing static-first prompt frame size, sub-agent count, and projected token cost per Phase. Serves P1 + P7.

- **SessionStart registry hook (C9-H77)** — `src/hooks/sessionStartRegistry.ts` plus `.claude/hooks/session-start-registry.mjs` boot against `governance/audit/finding-registry.json` v2 schema and surface the active-cycle finding count + reviewer status to every session; serves P5.

- **`src/pipeline/repoSubstitution.ts` (C9-H47)** — sync-time substitution tokens (repo owner, repo name, default branch) so generated artifacts no longer hard-code `hatch3r` references; serves P3 + P4.

- **`src/cli/shared/errors.ts::formatActionableError` (C9-M17)** — central CLI error funnel with optional `recoveryHint` on `HatchError`; every command path now routes through it for uniform actionable error output; serves P1.

- **`src/content/frontmatter.ts` (C9-M15)** — consolidated YAML frontmatter parser replacing three drifting in-tree parsers; serves P4.

- **`src/content/orphanScan.ts` (C9-M26)** — orphan-artifact scanner for unreferenced canonical files; serves P4 + P5.

### Security & Trust

- **C9-C1 — `hatch3r-creator` policy lockdown** closes the OWASP ASI02 privilege-escalation vector previously exposed by creator-mode tool delegation. Serves P6.
- **C9-C7 — `xsv` → `qsv` swap.** Replaced the archived `xsv` dependency (deprecated 2026-04-24) with the actively maintained `qsv` fork; the adapter currency manifest now flags upstream archive status. Serves P3.
- **C9-C8 — `jq` CVE-2026-32316 disclosure** plus six additional CVEs published 2026-04-15, all surfaced via `CliToolMeta.securityNote`; downstream consumers now see the disclosure in `hatch3r status` output. Serves P3 + P6.
- **C9-H4 — `BaseAdapter` path-traversal guard.** `HatchError` now raised on path-traversal attempts when resolving canonical-content reads, blocking writes outside project root. Serves P6.
- **C9-H5 / C9-M14 / C9-M27 / C9-M30 — 2026 prompt-injection-pattern classes** added to `src/pipeline/promptGuard.ts`: Unicode tag, zero-width joiner, base64 embed, homoglyph, ANSI control sequence, RTL/LTR override, Mongolian variation selector, and format-character abuse. Serves P6.
- **C9-H14 — `sanitizeUserContent` wrapper** guards `/learn` persistence against injection. Serves P6.
- **C9-H41 — `scanForDeniedPatterns` enforced on branch 2 of `safeWriteFile`** (previously only branch 1). Serves P6.
- **C9-H49 — hybrid allowlist classification with PreToolUse hook emission** for tool-call telemetry. Serves P6 + P5.
- **C9-H50 — `/learn` persistence hardening.** `scanForDeniedPatterns` + `validateAgentOutput` enforced on the `/learn` write path, with a new SHA-256 checksum field on stored entries. Serves P6.
- **C9-H51 — `npm audit signatures` gate on the self-update path.** Serves P6.
- **C9-H53 — `ON_DEMAND_FETCH_LAUNCHERS`** multi-launcher MCP allowlist gate. Serves P6 + P3.
- **C9-H54 — `scripts/check-mcp-cves.ts`** queries OSV.dev for every MCP dependency and fails CI on disclosed advisories. Serves P6 + P3.
- **C9-M31 — `DANGEROUS_ARG_CHARS` scan on MCP launcher args**, blocking shell-metacharacter injection. Serves P6.
- **C9-M34 — MCP HTTP transport SHA-256 pinning** of the transport descriptor. Serves P6.

### Changed

- **PRD §1 Executive Summary rewritten v4.5 → v4.7** (C9-C6 + Wave 2 H69/H70/H71/H74 + Wave 3 M50) — positioning, audience, and quality bar restated to match the current 15-adapter / 7-pillar / 21-domain shape.
- **19 orchestrator commands gain a `sub_agents_spawned` first-class output field in frontmatter (C9-H11)** — closes the P8 B2 directive (sub-agent count + rationale on every delegating artifact).
- **33 commands gain a §0 Detect Ambiguity block (C9-H42)** — applies the B1 clarification-default protocol before any write-tool invocation.
- **`AbortSignal` threaded through `Adapter.generate()` and pipeline timeouts (C9-H20)** — every adapter and every pipeline phase now propagates user cancellation. Serves P1 + P2.
- **11 adapters migrated from `readCanonicalFiles` to `readTrackedCanonicalFiles` (C9-H39)** — eliminates stale-content reads when canonical files move on disk between sync invocations. Serves P3.
- **`appendFailure` wired into `sync`, `verify`, `init`, and `update` catch paths (C9-M20)** — uniform telemetry on CLI failure. Serves P1 + P5.
- **`verifyIntegrity` returns a discriminated union (C9-M16)** instead of a string-bag — TypeScript catches every consumer of the legacy shape. Serves P2.
- **`safeWrite` gained parent-dir fsync + `.bak` auto-repair + `HATCH3R_LOCK` default-on under CI (C9-M8 / C9-M18 / C9-M22 / C9-M23).** Serves P6.
- **Silent-failure ESLint rule promoted from `warn` to `error` (C9-H19)** after a 13-file sweep — lint warnings dropped 147 → 70. Serves P5.
- **Atomic P8 propagation (C9-H76 + C9-H78)** — every governance file, every `.claude/rules/` rule, and every lifecycle skill now cites the full P1-P8 pillar set; CI gate fails on partial citation. Serves P5.

### Fixed

- **C9-H1 — AWS Full + Decorrelated jitter** in `retryWithBackoff` replaces fixed exponential. Serves P2.
- **C9-H2 / C9-H3 / C9-H40 — `SCANNED_DIRS` extended** to cover every governance subtree; cross-OS canonical path stringification fixes the CD-4 inconsistency on Windows. Serves P5.
- **C9-H18 — `verbose()` emission** on every catch path in `src/workspace/git.ts`. Serves P1.
- **C9-H77 — SessionStart hook bug-fix** for the `finding-registry.json` v2 schema. Serves P5.

### Tests

- 657 new regression tests added across the cycle. Suite total: 3162 → 3819, all passing. Critical-module thresholds (`src/merge/`, `src/integrity/`, `src/content/`, `src/adapters/customization.ts`) all pass at or above their 90/80/90/90 and 85/75/85/85 bars.

### Quality gates

17/17 regression-gate checks PASS vs Phase 0 baseline `477deef`. 0 typecheck errors. 0 lint errors. 70 lint warnings (down from 147 at Phase 0). 0 rule-parity drift. P1-P8 canonical across CONSTITUTION, AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, CLAUDE.md, and every `.claude/rules/` mirror. Inventory regenerated.

### Audit-execute protocol

103 sub-agents dispatched across this branch in four progressive waves — 4 Wave 1 (Critical) + 52 Wave 2 (High, 4 batches across 3 rounds) + 40 Wave 3 (Medium, 2 batches across 2 rounds) + 5 Wave 4 (Low / Info, Tier 1 batches) + 1 final reviewer + 3 triage planners. Reviewer verdict: `FIX-AND-SHIP`.

### Cycle 10 carry-forward

- 5 partials with explicit rollover entries — C9-H9 (CI required-check), C9-H58 (severity-vocab CONSTITUTION ladder), C9-H87 (jq additional CVEs), C9-M7 (vitest verification), C9-M12 (`AdapterContext` full refactor).
- 202 `deferred_cycle10` Medium / Low / Info entries flagged in the finding registry.
- 9 human-only strategic items — C9-C2 / C3 / C4 / C5 (D17 strategic positioning), C9-H61 / H62 / H66 / H68 (CONSTITUTION P9 amendment via `/h4tcher-re-envision`, AAIF outreach, marketplace submissions), C9-H72.

### Upgrade notes

No breaking changes. New optional fields on `CliToolMeta`: `securityNote`, `minVersion`, `releaseCadence`, `cve_scan`. New optional `recoveryHint` field on `HatchError`. Consumers reading these shapes through TypeScript see them as optional; runtime defaults preserve prior behavior.

### Pillar service summary

P1 (CLI UX), P2 (Scientific Quality), P3 (Adapter Currency), P4 (Lean Coverage), P5 (Governance Self-Quality), P6 (Security & Trust), P7 (Speed & Token Efficiency), and P8 (Clarification & Fan-out Discipline) — every binding pillar serviced by Cycle 9 work.

### Post-cycle additions

- **End-of-Turn Delegation Attestation protocol (follow-up to #73)** — closes the recurrent inline-edit bypass failure mode first logged in v1.7.5 (#73) and observed again in a Claude Code session that ran research and review fan-outs correctly but inlined Phase-2 implementation via `Edit`/`Write` instead of spawning `hatch3r-implementer`. The text mandate and the static `validate-fanout-emission` check declared intent; runtime adherence was on trust. Five normative changes pair an open-with-plan / close-with-proof bookend on every orchestrator turn. (a) `rules/hatch3r-agent-orchestration.{md,mdc}` gains an `### End-of-Turn Delegation Attestation` subsection between Per-Turn Pipeline-State Header and Mandatory Delegation Directive requiring orchestrators to emit a closing `[hatch3r-delegation-attestation]` block before the Iteration Summary that enumerates every file mutated, the spawning sub-agent invocation, and a `delegation_proof_id` quoted verbatim from that sub-agent's return value; unattributable rows are self-declared P8 B2 violations requiring re-delegation in the next turn. (b) `agents/hatch3r-implementer.md` §6 Return Structured Result adds a `Delegation proof ID` field with a forgery-resistant attribution contract — the orchestrator cannot quote a token it has not seen returned by a spawned implementer. (c) `rules/hatch3r-iteration-summary.{md,mdc}` Optional Sections cross-references the new closing block; the 5-field iteration-summary contract is unchanged so the 15 adapter outputs stay backward-compatible. (d) `CLAUDE.md` gains an `## Orchestrator Self-Discipline (Bypass Protection)` section binding both registered `/h4tcher-*` commands and ad-hoc multi-phase sessions. (e) `.claude/rules/fan-out-discipline.md` (auto-loaded each Claude Code session in this repo) appends a runtime-loaded restatement of the protocol so ad-hoc orchestrator flows are bound alongside registered commands. Test surface: rule-parity gate verifies `.md` / `.mdc` body parity across the two modified rule pairs (42 pairs / 0 drift); efficiency invariants gate confirms 20 orchestrator commands and all 15 adapters stay within bridge-budget. Pillar service: P8 (B2 fan-out discipline — closes declared-vs-actual gap), P5 (governance self-quality — self-detectable drift signal). Honest scope: text-only; detects accidental skip via a missing or unattributable closing block but does not prevent deliberate skip. A runtime ledger + `Stop` hook (Plan B option from the planning artifact) was de-scoped per maintainer choice and is queued as a follow-on CL-3 self-evolution proposal if recurrence is observed after this text fix lands; the text-layer attestation block becomes the schema the ledger would reconcile against.

- **`validate:wiring` regression gate clean on `release/1.8.0`** — three agent-runtime pipeline modules (`src/pipeline/agentIdentity.ts` for ASI03 provenance, `src/pipeline/diffHash.ts` for fixer-to-reviewer handoff verification, `src/pipeline/pipelineContext.ts` for the canonical phase-handoff schema) are consumed by `hatch3r-*` agents inside Claude Code / the host coding tool, not by the hatch3r CLI process — they have no CLI-side caller and were flagged as `WIRING-UNWIRED` at the v1.8.0 release commit. Each module now declares `@library_export_only` in its top-of-file JSDoc block with a one-sentence justification naming the actual consumer class (packs, downstream orchestrators, hatch3r-fixer / hatch3r-reviewer, the agent runtime). `validate:wiring` now reports `17 wired, 3 library-only; 0 error(s)`. Matches the F16.1.1 wired-vs-library-only split anticipated in `governance/AUDIT-REPORT.md:981` ("5-7 primitives wired + 5-7 flagged `library_export_only`"). Serves P5 (regression gate restored).

---

## [1.7.5] - 2026-05-18

### Fixed

- **Handoff readiness validator demoted ASI06 mitigation criteria from `errors[]` to `warnings[]` (PR #82 review)**: `validateHandoffContent` in `src/content/handoffs/validation.ts` previously evaluated criterion 3 (all 8 required sections present) and criterion 6 (injection-pattern scan over learnings P-LEARN-01..05 vectors) on the `warnings[]` track, meaning `writeHandoff` would not refuse the write — defeating the readiness rule (`rules/hatch3r-handoff-readiness.md`) and the ASI06 mitigation that scoped these as hard-fail. Both criteria now emit on `errors[]` with `valid: false`. `agents/hatch3r-handoff-preparer.md` force-write branch had `parent_handoff` and `superseded_by` inverted (new handoff was getting `superseded_by`, existing was getting `parent_handoff`); corrected so the new handoff carries `parent_handoff` and the existing one carries `superseded_by`. `.claude/skills/h4tcher-audit-cycle/SKILL.md` Tier C now includes D21 and counts read `21 domains / 121 sub-agents` to match `governance/AUDIT.md`. `scripts/generate-cli-skills.ts` and `scripts/fix-cli-skill-frontmatter.ts` no longer duplicate `TOOL_TRIGGERS` / `TOOL_CLOSERS` / `CATEGORY_CLOSERS` / `buildSkillDescription` — the shared module `src/cliTools/skillDescription.ts` is the source of truth (re-exported via `src/cliTools/index.ts`). `Math.min` / `Math.max` over `installedVersions` arrays guarded against empty-spread returning `±Infinity`. Pillar service: P2 (Scientific Quality — readiness rule once again refuses malformed handoffs), P4 (Lean Coverage — eliminates 200 lines of duplicated CLI-tool description code), P5 (Governance Self-Quality — orchestrator skill counts match canonical governance), P6 (Security & Trust — ASI06 mitigation restored).

- **Windows CI test stability (PR #82 review)**: `src/__tests__/helpers/configHelpers.ts` `ora` spinner mock now exposes `warn` / `info` / `stop` so the 3 `config.test.ts` cases that hit `cliSpinner.warn` no longer crash. `src/__tests__/content/cliSkills.test.ts` normalises CRLF before YAML parse — fixes Windows CI caveat assertion that previously received `pipe-output-corruption\r` instead of `pipe-output-corruption`. `src/__tests__/content/handoffs/validation.test.ts` updated to assert `errors[]` + `valid: false` for criteria 3 + 6 per the validator fix above.

- **Config picker mocks for non-empty CLI tools branch**: `src/__tests__/cli/config.test.ts` now mocks `cliTools/detect.findMissingCliTools → []` and `cliTools/install.offerInstaller` so the non-empty CLI tools branch in `config.ts:371` short-circuits before `offerInstaller`'s `inquirer.prompt` consumes the queued features answer. Fixes 3 Wave 5 §4.4 tests crashing at `selectedFeatures.includes`. No production-code change in this commit; test scaffold only.

- **`Features.handoffs` `expires_after` documented as ISO-8601 timestamp (matches code contract)**: Schema in `src/content/handoffs/validation.ts` and the `isHandoffExpired` `Date.parse` path already expected an ISO-8601 timestamp; the preparer stamps `created + HANDOFF_DEFAULT_EXPIRY_DAYS`. Docs in `agents/hatch3r-handoff-loader.md`, `commands/hatch3r-handoff.md`, `skills/hatch3r-handoff-resume/SKILL.md`, the `init.ts` seeded README, and the `HANDOFF_DEFAULT_EXPIRY_DAYS` JSDoc previously said "days" — now say timestamp. No semantics change.

- **`hatch3r update` self-update overwrote `npm link` symlinked global installs**: `src/detect/installContext.ts::isLinkedPackageDir` now uses `lstatSync().isSymbolicLink()` to classify linked packages as `kind: "dev-source"`, and `runSelfUpdate` skips them. A maintainer who ran `npm link` from a checked-out hatch3r clone will no longer have the registry tarball silently replace the dev-source symlink on `hatch3r update`. Test coverage: 2 new symlink-classification tests in `src/__tests__/detect/installContext.test.ts`.

- **YAML workflow file rejected by GitHub Actions due to HTML-comment managed-block markers (#76)**: `hatch3r init` / `hatch3r sync` previously wrote `.github/workflows/copilot-setup-steps.yml` starting with `<!-- HATCH3R:BEGIN -->`, which is invalid YAML on line 2 — GitHub Actions rejected the file with `Invalid workflow file ... line 2`, blocking every push on a freshly-installed repo. Root cause: `wrapInManagedBlock` (`src/merge/managedBlocks.ts`) hard-coded HTML-style markers regardless of the host file type, and the Copilot adapter (`src/adapters/copilot.ts`) reused the same helper for its YAML workflow output. Three coordinated changes ship the fix. (a) New `MANAGED_BLOCK_START_YAML` / `MANAGED_BLOCK_END_YAML` (`# HATCH3R:BEGIN` / `# HATCH3R:END`) constants in `src/types.ts`, a `MANAGED_BLOCK_VARIANTS` table, and a `getMarkersForPath(filePath?)` helper that returns the YAML variant for `.yml` / `.yaml` (case-insensitive) and the HTML/Markdown variant for every other path. (b) `wrapInManagedBlock(content, filePath?)` and `insertManagedBlock(existing, managed, filePath?)` now accept an optional path argument and emit path-appropriate markers; read-side helpers (`hasManagedBlock`, `extractManagedBlock`, `extractCustomContent`) scan for any known variant, so files written by v1.7.0 / v1.7.1 with the wrong-style markers are auto-repaired to the correct syntax on the next sync. User-authored content outside the markers is preserved through the swap. (c) `src/adapters/copilot.ts` passes `".github/workflows/copilot-setup-steps.yml"` to `wrapInManagedBlock` so the freshly-generated workflow uses YAML markers. `src/merge/safeWrite.ts` threads `filePath` through to `insertManagedBlock`, and `src/merge/orphanCleanup.ts::fileIsUserWrapped` swaps its hard-coded HTML-marker slicing for a call to `extractCustomContent` so the orphan sweep recognises wrapped YAML files. Markdown adapters (every other call site — 14 adapters plus `src/cli/shared/agentsContent.ts`) keep the historical HTML markers via the no-path default. Test surface: 18 new tests in `src/__tests__/merge/managedBlocks.test.ts` cover wrap/insert/extract across both variants, case-insensitivity on the extension, auto-repair from HTML to YAML markers, user-content preservation through auto-repair, and idempotency after auto-repair; the existing `src/__tests__/adapters/copilot.test.ts` workflow-file test now asserts YAML markers and explicitly rejects `<!--`; `src/__tests__/adapters/snapshots.test.ts` `extractMarkers` distinguishes `MANAGED_BLOCK_YAML` from `MANAGED_BLOCK` so a regression back to HTML markers in a YAML file shows up as a snapshot diff. JSON outputs are never wrapped in managed blocks (every JSON file is emitted via `JSON.stringify` in `safeWriteFile`'s no-managed-content branch) so no JSON variant is needed. Pillar service: P1 (CLI/UX excellence — install-then-push no longer fails immediately on Copilot setup), P3 (adapter currency — output matches the host platform's actual comment syntax), P5 (governance self-quality — read-side helpers accept any variant, write-side helpers pick the right one, no silent acceptance of an invalid file shape).

### Upgrade notes

- Existing `.github/workflows/copilot-setup-steps.yml` files written by 1.7.0 / 1.7.1 with HTML-comment markers are auto-repaired on the next `hatch3r sync`: the markers swap to YAML `#`-prefixed syntax, the workflow payload is unchanged, and user-authored content outside the markers is preserved. Run sync, verify the diff, and commit it before the next push so GitHub Actions accepts the file.

### Docs

- **README / CLAUDE.md / `.cursor-plugin/plugin.json` counts synced with `governance/inventory.json`**: `npm run inventory:check-docs` flagged 7 stale counts after the Wave 5 / production-readiness / handoff slices landed; counts now match the regenerated `inventory.json`. README.md: Skills `28 → 63` (adds the 30 per-tool CLI skills landed in Wave 5), Rules `29 → 42`. CLAUDE.md: `src/cli/commands/` row `11 → 13` (adds `cliTools`, `mcp`). `.cursor-plugin/plugin.json` description: 17 agents → 19, 26 skills → 63, 28 rules → 42, 37 commands → 38. Pillar service: P5 (Governance Self-Quality — the inventory.json CI gate is now green and the public-facing counts no longer mislead).

- **Website docs coverage extended across 7 previously-undocumented artifact surfaces**: An audit triggered by a user report flagging `/hatch3r-board-groom` (which on inspection was already documented across `agent-commands.md`, `board-management.md`, `agentic-process.md`, `quick-start.md`, and `README.md` — claim was false) found genuine gaps elsewhere: 49 of 117 user-facing artifacts had no website coverage. Six docs surfaces added or extended to close them. (a) New `website/docs/reference/hooks.md` (65 lines, sidebar_position 4) documenting all 6 hooks (`session-start` → `learnings-loader`, `file-save` → `context-rules`, `pre-commit` → `lint-fixer`, `pre-push` → `security-auditor`, `post-merge` → `ci-watcher`, `ci-failure` → `ci-watcher`) with trigger event, invoked agent, configuration knobs (`globs`, `debounceMs`, `timeoutMinutes`, `blockOnWarnings`, `autoRetryFlaky`, `scanFullHistory`), and per-adapter hook-emission support against `docs/adapter-capability-matrix.md`. (b) New `website/docs/reference/auxiliary-artifacts.md` (53 lines, sidebar_position 6) consolidating the 5 checks (accessibility, code-quality, performance, security, testing), 3 prompts (`hatch3r-bug-triage`, `hatch3r-code-review`, `hatch3r-pr-description`), and 4 GitHub agents (`hatch3r-docs-agent`, `hatch3r-lint-agent`, `hatch3r-security-agent`, `hatch3r-test-agent`) — each section has a compact Name | Purpose | Invoked-by table plus a canonical-location footer. (c) `website/docs/reference/agents.md` extended with the missing `hatch3r-creator` row in the Agent Reference table, plus two new sections — Agent Modes (compact Mode | Purpose | Used-by table covering all 20 files in `agents/modes/`, every mode parented to `hatch3r-researcher`) and Shared Agent Resources (File | Purpose table for the 7 files in `agents/shared/`, with `quality-charter.md` called out as the canonical quality authority). (d) `website/docs/reference/rules.md` filled with the two previously-missing rules (`iteration-summary` between `i18n` and `learning-consult`; `observability-tracing-detail` immediately after `observability-tracing`); descriptions copied verbatim from each rule's canonical frontmatter for fidelity. (e) New `website/docs/reference/commands/agent-commands.md` section for `/hatch3r-create` in the Customization Commands group (previously undocumented user-facing despite being the user-content authoring entry point that `init` itself promotes via post-init tip) and matching `website/docs/guides/customization.md` section "Authoring New User-Tier Artifacts" distinguishing `create` (authors new under `.agents/user/`, preserved across `update` and `clean`) from the `*-customize` family (modifies stock content). (f) `README.md` Command groupings patched: `pr-resolve` appended to Workflow, `report` appended to Operations, `create` prepended to Customization (the three commands previously had reference-doc sections but no README index entry). `website/sidebars.ts` wires the two new pages into the Reference category — `reference/hooks` after `reference/rules` and `reference/auxiliary-artifacts` after the Commands subcategory. All 7 modified docs files scanned against the 17-phrase anti-slop wordlist with zero hits; Docusaurus production build passes; `validate-rule-parity` (28 pairs, 0 drift) and `validate-efficiency-invariants` (0 errors, 0 warnings) remain green. Pillar service: P1 (CLI/UX excellence — `/hatch3r-create` and the four reference targets are now discoverable from the public docs surface), P4 (Comprehensive Lean Coverage — every shipped artifact category now has a website reference page), P5 (Governance Self-Quality — closes the coverage delta surfaced by the parallel docs-audit and prevents the same gap from re-emerging because newly-added artifacts will fail their own future audit cycle if not also referenced).

### Added

- **Post-flow missing-CLI-tools disclaimer + copy-paste one-liner installer**: After every flow that touches CLI-tool selection (`hatch3r init` main + workspace, `hatch3r config`, `hatch3r cli-tools`, `hatch3r cli-tools install`), a warning-style boxed message now surfaces any selected-but-not-installed tools alongside a copy-paste one-liner that chains installable tools through their shared package manager. New `src/cliTools/oneLiner.ts` groups installs per manager (`brew`, `apt`, `apt-get`, `dnf`, `yum`, `pacman`, `scoop`, `cargo`) into a single `<mgr> install pkgA pkgB ... && <next>` command; standalone commands (winget, snap, npm, curl pipes) stay verbatim; commands containing `&&` / `|` / `;` are rejected to keep multi-step recipes intact. `src/cliTools/install.ts::printMissingCliToolsDisclaimer` is invoked at each flow's end; `src/cli/shared/ui.ts::printBox` gains a new `"warning"` style (#f59e0b). Test coverage: new `src/__tests__/cliTools/oneLiner.test.ts`, new `src/__tests__/cli/commands/init.cliToolsDisclaimer.test.ts` (176 lines), plus `cli/cliTools`, `cli/config`, `cliTools/install` cases covering the disclaimer-rendering path and the install-plan + interactive-prompt regressions. Pillar service: P1 (CLI/UX excellence — the user no longer leaves a flow uncertain about which tools still need installing, with the one-liner removing transcription friction).

- **CLI tooling pivot — first-class agentic tool surface**: hatch3r now ships a CLI-tools surface area as the primary token-efficient agent-tooling story, with MCP demoted to opt-in. New `src/cliTools/` module (registry/detect/install/triggers/skill) catalogs 29 tools across 3 tiers — tier-1 (default): ripgrep, fd, jq, yq, gh, git-delta, bat, sd, ast-grep, zstd; tier-2 (conditional per project signal): Playwright, duckdb, xsv, taplo, glab, az-devops, Docker, llm, fzf, lazygit, difftastic; tier-3 (opt-in advanced): RTK, Stagehand, aichat, mods, Comby, miller, csvkit, Podman. Each tool carries a per-OS install command (brew/apt/dnf/winget/scoop with cargo/pipx/npm fallback) and a probe binary. Detection uses POSIX `command -v` / Windows `where` with 2s wall-clock timeout and fail-open semantics. Installer prints copy-paste commands grouped by package manager — never executes on the user's behalf. `npx hatch3r init` flow inserts a 3-tier grouped CLI-tools picker after worktree, runs detection + offers the installer, then surfaces required-env-var notes (e.g. `gh: GH_TOKEN`). Manifest gains optional `cliTools: {enabled, selected, overrides?}` field that survives `clean → reinit` via `PreservedManifestFields`. New `src/cli/shared/pickers.ts` extracts `pickCliTools`/`pickMcpServers`/`confirmMcpGate` for shared use across init/config. (Cite: Anthropic engineering — Code execution with MCP, Nov 4 2025; GitHub Blog — Improving token efficiency in agentic workflows, May 7 2026; Cloudflare — Code Mode, Feb 20 2026; ThoughtWorks Tech Radar Vol 34, Apr 2026.)

- **30 canonical CLI-tool skills (Closes #72)**: `skills/hatch3r-cli-overview/SKILL.md` (decision-tree umbrella with all 29 tools grouped by tier) plus 29 per-tool skills (`skills/hatch3r-cli-{id}/SKILL.md`). Each per-tool skill emits 3-6 concrete `bash`-fenced recipes, 2-3 anti-pattern callouts, an alternatives table, and a Detection/Install block — D05 prompt-engineering quality bar enforced. RTK skill opens with a `## ⚠ Critical: pipe-output corruption (issue #1282)` callout and the `export RTK_DISABLE_PIPE_REWRITE=1` mitigation as Recipe 1 (research surfaced the corruption pattern; users opt in informed). Skills emit per-adapter for the 13 skill-capable adapters via the new `BaseAdapter.readCliFilteredSkills` + `processSkillsRawCliFiltered` / `processSkillsWithFmCliFiltered` filter pipeline. Amp reads canonical skills natively; Zed (rules-only) gets a follow-up reference. Maintainer script `scripts/generate-cli-skills.ts` regenerates scaffolds idempotently from `AVAILABLE_CLI_TOOLS` via `renderCliToolSkillBody`. Frontmatter-only updater `scripts/fix-cli-skill-frontmatter.ts` refreshes descriptions without touching authored body content. New `scripts/validate-cli-skills.ts` CI gate cross-checks registry-vs-skill parity (29 entries + umbrella).

- **`npx hatch3r mcp` and `npx hatch3r cli-tools` subcommand groups**: side-door commands for users who skipped a section during init or want to revisit later. `hatch3r mcp setup` reopens the MCP server picker; `hatch3r mcp list` shows current configuration; `hatch3r mcp remove <id>` deletes a single server; `hatch3r mcp env-check` audits `.env.mcp` for missing required env vars. Symmetric `hatch3r cli-tools` (default action opens picker), `cli-tools list` (selection + install status), `cli-tools install` (re-runs offerInstaller for missing tools), `cli-tools detect` (read-only detection report). Wired into `src/cli/program.ts`.

- **Workspace mode parity**: `workspace.json` gains `defaults.cliTools` (workspace-wide CLI tool defaults); member manifests gain `workspace.localCliTools` / `workspace.excludedCliTools` for per-member overrides. Sync applies workspace defaults to new members, respecting member-local exclusions (exclusion wins, mirroring `excludedContent` semantics).

- **Status / validate / update touchpoints**: `npx hatch3r status` appends a CLI-tools detection block (`N/M installed`, list missing). `npx hatch3r validate` emits a warning per selected-but-missing CLI tool. `npx hatch3r update` adds a one-time info nudge when no CLI tools are opted in.

- **Governance pivot — P3 rewrite + new D21 + VISION principle**: Pillar P3 renamed "Adapter & MCP Currency" → "Adapter & External Tool Currency" (CONSTITUTION.md §2 P3), measurement extended to cover CLI tool currency delta and CVE acknowledgement count. New audit domain D21 "CLI Tool Currency" (`governance/audit/domains/D21-cli-tool-currency.md`) deploys 7 sub-agents covering search/file-ops/data/http/forge/browser+sandbox plus a sequential capability-matrix synthesis. New D15.7 sub-agent "CLI Tool Supply-Chain Trust" (5-item checklist) augments D15 for installer chain integrity, version pinning, CVE windows, tool provenance, and sandbox escape surface. D02 SA 2.4 renamed "MCP & TOML Utilities" → "External Tool Config Utilities" and expanded to cover `src/pipeline/agentToolAllowlist.ts` / `src/pipeline/adapterToolTranslator.ts`. D10 SA 10.3 line 45 swapped to combined CLI+MCP setup-guidance wording. AUDIT.md Charter Directive 12 expanded to include CLI tools and CVE feeds; sub-agent count 111 → 119 (D21 +7, D15.7 +1); Tier C now `D11–D16, D20–D21`. AUDIT-EXECUTE.md gains a new CLI-tool-currency regression gate and a Pillar-Revision Linkage invariant (gate count 17 → 18, Phase 7 tier weights rebalanced `A=0.308, B=0.348, C=0.304, D=0.040`). VISION.md adds principle 9 "CLI-first agent tooling" with renumber of subsequent principles. `governance/audit/finding-registry.json` gains a `pillar_revisions` header block preserving cross-cycle P3 lineage.

- **Cross-session handoff mechanism — canonical content + TypeScript module (Slice 1 of 3)**: hatch3r now ships a tool-agnostic mid-work handoff artifact at `.agents/handoffs/active/<id>.md` so any of the 15 supported tools can capture state at the end of one session and resume it cleanly in a later session — same tool, different tool, same developer, different developer. The artifact is plain Markdown with YAML frontmatter mapped 1:1 to the cross-framework consensus payload shape established across the 2026 agent ecosystem (OpenAI Agents SDK v0.17.1, Microsoft Agent Framework April 2026, softaworks/agent-toolkit, Synthesis Project Files): `state{problem, decisions, work_done, work_remaining, blockers, next_steps}` + `metadata{source_agent, target_agent, confidence, completeness, git_ref, timestamp, summary, requirements}` + compact `messages[]`. Required frontmatter fields: `id`, `type: handoff`, `created`, `updated`, `status` (one of `open | in-progress | blocked | handed-off | resumed | completed | archived`), `source_agent`, `target_agent`, `git_ref` (`branch@sha7`), `branch`, `confidence` (0–1), `completeness` (0–1), `integrity` (`sha256:<hex>` of body bytes). Optional: `work_item` (platform-prefixed `gh:owner/repo#42` / `ado:org/project:work-item/123` / `gl:owner/repo!42`), `expires_after` (default 30 days), `summary` (≤200 chars), `requirements[]`, `compaction_count`, `hatch3r_version`, `tags[]`, `superseded_by`, `parent_handoff`. Body has 8 required sections in canonical order (Problem, Decisions, Work Done, Work Remaining, Blockers, Next Steps, Build & Test Status, File Manifest) wrapped in `--- BEGIN USER-TIER CONTENT: handoff ---` / `--- END USER-TIER CONTENT: handoff ---` instruction-hierarchy markers per ASI06. Hard caps: body ≤ 50 KB (rejects token bloat), file ≤ 60 KB. Soft cap 25 active handoffs per repo (warns at 20, refuses briefing at 50 with prune prompt). ID scheme `<YYYY-MM-DD>_T<HHmm>_<5hex>_<kebab-slug>` is chronologically sortable and collision-safe (5-char hex from `crypto.randomBytes(3)` prevents same-minute collisions across parallel agents). Status transitions validated by `VALID_STATUS_TRANSITIONS` in `src/content/handoffs/schema.ts`: e.g. `open → in-progress | blocked | handed-off | archived`; `completed → archived`; `archived → {}` (immutable). Industry alignment cites the May 2026 verification that no T1 cross-vendor handoff specification exists — hatch3r is filling a real gap, not implementing an established standard.

- **`/hatch3r-handoff` command (orchestrator, 5 subcommands)**: New canonical command `commands/hatch3r-handoff.md` (`orchestrator: true`, `agentPipeline: [hatch3r-handoff-preparer]`, `triage_tiers: [1, 2]`) with `prepare | resume | list | complete | prune` subcommands. `prepare` delegates to the new `hatch3r-handoff-preparer` agent via the Task tool to capture session state into a new handoff; `resume` loads a previously-prepared handoff (with id selection if absent), validates schema + integrity + git_ref drift + expiry, and surfaces body content under user-tier markers before transitioning status to `resumed`; `list` shows active (and optionally archived) handoffs in a fixed-column table; `complete` transitions a handoff to `completed` and atomic-renames it to `.agents/handoffs/archived/`; `prune` scans for expired actives (auto-archive) and archives older than 90 days (optional delete) with `--dry-run` support. ASK checkpoints follow the platform-native question-tool protocol established earlier in 1.7.1 (`agents/shared/user-question-protocol.md`). Step 0 Triage classifies Tier 1 (list / complete / prune-dry) inline vs Tier 2 (prepare / resume / prune) with body composition or validation gates.

- **`skills/hatch3r-handoff-prepare/SKILL.md` + `skills/hatch3r-handoff-resume/SKILL.md`**: Two new skills under the standard `Quick Start + numbered Steps` pattern. Prepare: gather state (git_ref, branch, modified files, test status, work_item) → compose body (the 8 required sections; `Work Done` / `Work Remaining` / `Blockers` populated verbatim from the session's end-of-turn Iteration Summary block per `rules/hatch3r-iteration-summary.md`) → validate via the new `hatch3r-handoff-readiness` rule (10-criterion checklist: body ≤ 50KB, no full transcript, all 8 sections present, git_ref matches HEAD, frontmatter schema validates, injection scan clean, integrity computed, summary ≤ 200 chars, target_agent explicit, build/test status populated) → atomic-write via `atomicWriteFile` from `src/merge/safeWrite.ts`. Resume: locate by id or list-and-pick → validate integrity (warn + downgrade confidence on mismatch, never silently accept) → injection-pattern scan (exclude on hit per ASI06) → schema validate → drift check (git_ref vs current HEAD with commit log between them; `expires_after` past triggers Expired warning; `hatch3r_version` major mismatch flags migration needed) → surface content under user-tier markers (Problem + Work Remaining + Next Steps first as the actionable trio, then Decisions and Blockers) → transition status to `resumed`. Both skills include explicit Trust Boundary statements: handoff body is USER-TIER content, never promoted to system-level authority.

- **`agents/hatch3r-handoff-loader.md` + `agents/hatch3r-handoff-preparer.md`**: Two new agents. Loader is the session-start sibling to `hatch3r-learnings-loader` — it reads `.agents/handoffs/active/`, ranks entries by (1) work_item match to current branch, (2) recency of `updated`, (3) `in-progress` status priority over `open` / `blocked` / `handed-off`, validates each via the same ASI06 content-security pipeline as learnings (instruction-hierarchy markers, cross-file instruction enforcement, injection-pattern detection at read, integrity hash verification), and emits a structured briefing under the canonical Output Format (`## Active Handoffs Briefing` / `## Drift Warnings` / `## Integrity Warnings` / `## Validation Warnings` / `## Stats` / `**Suggested Next Action:**`). Empty-directory output mirrors the learnings-loader pattern: surface an actionable hint, never silent-skip per the Silent Failure Contract. Preparer is invoked by `/hatch3r-handoff prepare` and by the future `on-context-switch` hook (Slice 3); it gathers state, distills the ≤ 200-char summary, delegates composition to `skills/hatch3r-handoff-prepare`, and applies the readiness gate before invoking `writeHandoff`. Tool allowlists registered in `src/pipeline/agentToolAllowlist.ts`: preparer = `read, search, write` (no execute — handoffs are filesystem-only); loader = `read, search` (read-only).

- **`rules/hatch3r-handoff-readiness.md` + `.mdc`**: New rule (`scope: conditional`, `globs: .agents/handoffs/active/**/*.md`, `precedence: high`) encoding the 10-criterion pre-write checklist with 7 required criteria (refuse write on fail) and 3 recommended (warn on fail). `.md` and `.mdc` body bytes match per `scripts/validate-rule-parity.ts` (29 pairs checked, 0 drift). Enforced by the new `validateHandoffContent` function in `src/content/handoffs/validation.ts` — criteria 1–7 surface as `errors[]`, criteria 8–10 as `warnings[]`.

- **`src/content/handoffs/` TypeScript module (4 files, 1,313 lines source)**: New public API for handoff lifecycle management. `schema.ts` (111 lines) — `HandoffStatus` enum, `VALID_STATUS_TRANSITIONS` map with full transition matrix, `HandoffFrontmatter` / `Handoff` interfaces, type guards (`isHandoffStatus`, `isValidStatusTransition`). `validation.ts` (465 lines) — caps + ID regex + `validateHandoffContent` (size, schema, integrity, expiry, drift) + `computeHandoffIntegrity` (SHA-256 of trimmed body, `sha256:` prefix) + `verifyHandoffIntegrity` + `generateHandoffId` + `isHandoffExpired` + `validateHandoffsDirectory` (CLI-integration surface). Injection scan **imports** `LEARNINGS_INJECTION_PATTERNS` from `src/content/learningsValidation.ts` rather than duplicating — the same P-LEARN-01..05 ASI06 memory-poisoning vectors apply to handoff bodies. `index.ts` (538 lines) — `writeHandoff` (validate → recompute integrity → soft-cap check → `atomicWriteFile`), `listHandoffs` (filter by status / workItem / branch / includeArchived; sort by `updated` desc), `readHandoff` (scans both active and archived), `archiveHandoff` (atomic write-archived-then-unlink-active pattern that preserves body mutations), `pruneHandoffs` (expired actives → archive; old archives → optional delete; `--dry-run` support), `buildHandoffIndex` (full repo scan returning maps by id / work_item / branch). `payloadAdapter.ts` (199 lines) — bi-directional `toConsensusPayload` / `fromConsensusPayload` so non-hatch3r tools can consume hatch3r handoffs without parsing YAML; messages[] hard-capped at `MAX_CONSENSUS_MESSAGES = 10`; round-trip preserves all consensus fields with recomputed integrity. All writes go through `atomicWriteFile` from `src/merge/safeWrite.ts` (temp+rename, optional `HATCH3R_LOCK=1` cross-process lock via proper-lockfile). All catch blocks emit a diagnostic per the Silent Failure Contract; `HandoffWriteError` / `HandoffArchiveError` classes extend `HatchError` for structured CLI exit codes. Test surface: 4 new test files (`schema.test.ts`, `validation.test.ts`, `index.test.ts`, `payloadAdapter.test.ts`, 990 lines, 91 tests) cover all status transitions, every P-LEARN injection pattern, integrity mismatch / missing / malformed, expiry, drift, oversized body, write round-trip, list filters, archive atomicity, prune dry-run + execute, and round-trip through the consensus payload.

- **`npx hatch3r validate` extended for handoffs**: `src/cli/commands/validate.ts` imports `validateHandoffsDirectory` and runs it after the existing learnings validation, accumulating errors / warnings into the standard result. Validates schema, integrity, expiry, git_ref drift, and oversized files across both `.agents/handoffs/active/` and `.agents/handoffs/archived/`. The `DEFAULT_KNOWN_AGENTS` set gains `hatch3r-handoff-loader` and `hatch3r-handoff-preparer` so hooks referencing them validate clean.

- **`.agents/handoffs/` directory seeded by init**: `src/cli/commands/init.ts` now creates `.agents/handoffs/active/` and `.agents/handoffs/archived/` on fresh init, plus seeds `.agents/handoffs/README.md` with the canonical schema documentation (frontmatter table, body sections, ID scheme, lifecycle, caps, validation, cross-tool portability statement). Mirrors the learnings README seed pattern at `init.ts:332–345`: directory always created idempotently, README only on fresh init (never overwrites user-authored content on re-init). Includes the `gh:` / `ado:` / `gl:` work-item prefix convention.

- **`Features.handoffs: boolean` manifest field** (additive, default `true`): `src/types.ts` extends `Features` with `handoffs: boolean` so Slice 2 adapter outputs can opt-out of surfacing active handoffs in their primary context file via `manifest.features.handoffs: false`. Pre-1.7.5 manifests treated as `handoffs: true` (back-compat). All test fixtures updated to include the field explicitly.

### Changed

- **MCP demoted to opt-in by default**: The `npx hatch3r init` flow no longer prompts unconditionally for MCP servers. After the features picker, a single `Configure MCP servers? (CLI tools recommended as default — y/N)` gate gates the MCP server picker; default response is No. Declining the gate skips MCP entirely — no `.env.mcp` written, no `mcp.json` filter, no servers in manifest. `printCurrentConfig` in `npx hatch3r config` always shows the CLI tools row; the MCP row is hidden when `manifest.mcp.servers` is empty. The mutation flow in `config` mirrors init's MCP gate.

- **`--yes` non-interactive MCP default flipped**: `npx hatch3r init --yes` now produces an empty `manifest.mcp.servers` array by default. CI scripts that depend on MCP being auto-configured must add the new `--mcp` flag to opt back in. CLI tools default-on under `--yes`: tier-1 plus tier-2 triggered by `RepoInfo`. New flags: `--cli-tools <ids|tier1|all>`, `--no-cli-tools`, `--mcp`.

- **`AdapterCapability.cliTools`** added to the matrix in `src/adapters/index.ts`. `true` for cursor, claude, gemini, cline, codex, amazon-q, copilot, opencode, windsurf, kiro, aider, goose, antigravity (13 adapters); `false` for amp (reads canonical skills natively) and zed (skills:false; follow-up reference inline).

### Upgrade notes — CLI tooling pivot

- **BREAKING for `npx hatch3r init --yes` CI scripts**: MCP servers are no longer configured by default in non-interactive mode. Add `--mcp` to your invocation to restore prior behavior. Without the flag, `manifest.mcp.servers` will be empty and no `.env.mcp` will be created. The interactive init flow gates MCP behind a Yes/No prompt defaulting to No.
- Existing 1.7.1 manifests upgrade silently. `cliTools` is an optional field; absence is treated as `{enabled: false, selected: []}`. The first `npx hatch3r update` from 1.7.1 prints a one-time info nudge: "CLI tooling available as a token-efficient alternative to MCP — run `npx hatch3r cli-tools` to opt in."
- To opt into the new CLI tooling on an existing project: `npx hatch3r cli-tools` opens the picker. Detection runs against your PATH; the installer offer prints copy-paste commands per OS without executing them.
- `npx hatch3r clean` → `npx hatch3r init` preserves the user's `cliTools.selected` selection.

### Governance

- Pillar P3 renamed from "Adapter & MCP Currency" to "Adapter & External Tool Currency" with measurement extended to CLI tool currency and CVE acknowledgement. New audit domain D21 (CLI Tool Currency, 7 sub-agents). New SA 15.7 (CLI Tool Supply-Chain Trust). D02 SA 2.4 renamed and scope expanded. D10 setup-guidance line updated. AUDIT.md sub-agent count 111 → 119, Tier C now includes D21, Charter Directive 12 expanded. AUDIT-EXECUTE.md gains CLI-tool-currency regression gate and Pillar-Revision Linkage invariant (gate count 17 → 18). VISION.md adds principle 9 "CLI-first agent tooling". Finding-registry gains `pillar_revisions` header preserving cross-cycle P3 lineage.

- **Agent-produced production-readiness governance bundle** (closes scoped-audit findings across 8 topics: Observability, Migrations, API design, AI feature evaluation, Testing depth, Supply-chain hardening, SRE/reliability, Auth depth — each surfaced the same root cause: rules exist but are governance-invisible / orphaned from the reviewer checklist / no pillar measurement / no domain owns the surface). CONSTITUTION.md §2 P2 measurement extended with 8 production-readiness metric families (instrumented-route ratio = 100%; migration expand-contract conformance = 100%; API breaking-change events per release = 0; AI feature eval coverage = 100%; per-feature test-class mandate compliance = 100%; supply-chain floor = 100%; user-facing service SLO defined = 100%; auth depth coverage = 100%). CONSTITUTION §2 P5 lean thresholds gain 8 new rows enforcing those metrics. AUDIT.md behavioral charter directive count 15 → 16 (new Directive 16 mandates production-readiness evaluation for end-user runtime artifacts across all 8 topic surfaces). AUDIT.md sub-agent count 120 → 121 reconciled across AUDIT.md, CLAUDE.md, README.md. New SA15.8 "End-User Supply-Chain Floor Guidance Coverage" added to D15. Quality-charter (`agents/shared/quality-charter.md`) gains 8 new sections (one per topic) totaling +115 lines (120 → 235). Reviewer (`agents/hatch3r-reviewer.md`) gains items 13-19 (observability.review, migration.review, api.review strengthening item 11, eval.review, supply-chain.review, reliability.review, auth.review) totaling +77 lines with structured-output schema fields. Thirteen new canonical rules with `.md` + `.mdc` parity:
  - `rules/hatch3r-event-schema-evolution.md` (Avro/Protobuf/JSON-schema registry compatibility modes, dual-publish during migration, outbox + UUIDv7 idempotency)
  - `rules/hatch3r-api-versioning.md` (OAuth 2.1 + PKCE + refresh rotation, RFC 9457 errors, RFC 9745 Deprecation, RFC 8594 Sunset, RFC 8707 Resource Indicators, RFC 9449 DPoP, Idempotency-Key draft, Standard Webhooks signing, semver vs CalVer)
  - `rules/hatch3r-contract-testing.md` (Pact CDCT + PactFlow BDCT + Schemathesis spec-driven + `pact-broker can-i-deploy` deploy gate)
  - `rules/hatch3r-ai-evals.md` (eval harness mandate via promptfoo/DeepEval/RAGAS/Inspect/braintrust/TruLens/Arize; golden dataset versioning; prompt versioning; cost telemetry; Anthropic prompt caching 1h TTL 2x write cost; OpenAI prompt caching; model router/fallback; hallucination/groundedness/refusal-rate as SLIs; OTel GenAI semconv; safety/red-team via Garak/PyRIT/Inspect-redteam; tool-use evals via BFCL v4 + τ-bench)
  - `rules/hatch3r-container-hardening.md` (Wolfi/Chainguard zero-CVE baseline, digest pinning everywhere, multi-stage, non-root UID 65532, no-shell distroless, SBOM-in-image, cosign keyless signing + admission verify via Kyverno/Policy Controller, Trivy+Grype CI gate, &lt;200 MB budget)
  - `rules/hatch3r-resilience-patterns.md` (per-ecosystem circuit breakers — opossum 9.x / resilience4j 2.x / Polly 8.x / gobreaker / pybreaker; AWS decorrelated jitter retry; deadline propagation; hedged requests cutting p99.9 96% at 2% extra traffic; bulkheads via resilience4j; failure classification mirroring hatch3r's own pipeline)
  - `rules/hatch3r-operability.md` (k8s liveness/readiness/startup probe semantics; SIGTERM graceful shutdown with preStop hook 1-3s endpoint-propagation race; OpenFeature flag types — release/experiment/ops/permission; kill switch pattern; runbook URL on every alert; 2024-26 outage lessons — CrowdStrike Jul 2024, AWS us-east-1 Oct 2025, Azure East-US2 Sep 2025, Cloudflare Nov 2025)
  - `rules/hatch3r-progressive-delivery.md` (canary via Argo Rollouts/Flagger with Kayenta Mann-Whitney U analysis, blue-green, feature-flag rollout; staged 1%→10%→50%→100% cadence; SLO-burn auto-rollback; config-change canary)
  - `rules/hatch3r-auth-patterns.md` (OAuth 2.1 by name + RFC 9700 BCP operative; OIDC validation iss/aud/azp/exp/nonce + RP-initiated + back-channel logout; DPoP RFC 9449 + mTLS; JWT BCP RFC 8725; `__Host-` + `Partitioned` CHIPS cookies; NIST 800-63B-4 AAL + SMS-restricted + step-up; RBAC/ABAC/ReBAC rubric + AuthZEN Authorization API 1.0; multi-tenancy with Postgres RLS; BFF token storage; 2026 provider landscape — Clerk/Supabase/WorkOS/Auth0/Stytch/Better Auth/Auth.js/FusionAuth)
  - `rules/hatch3r-passkey-server.md` (server-side WebAuthn L3 ceremony; @simplewebauthn/server / webauthn4j / py-webauthn / webauthn-rs vetted libs; registration + authentication flows; RP-ID, counter clone detection, AAGUID handling, BE/BS backup flags; recovery patterns + FIDO CXP/CXF Feb 2026 cross-platform export awareness; discoverable credentials for passkey-first UX; step-up auth)
  - Three additional rules from the API design slice extend existing files: `rules/hatch3r-api-design.md` +58 lines (OpenAPI 3.1/AsyncAPI 3.1.0 floor, RFC 9457 errors, Federation v2, Connect-RPC, tRPC/oRPC scope, oasdiff/buf breaking/graphql-inspector CI gate); `rules/hatch3r-migrations.md` +45 lines (expand-contract canonical 3-deploy pattern; online schema changes via Postgres 18 `SET NOT NULL NOT VALID` + MySQL 8.4 ALGORITHM=INSTANT + gh-ost v1.1.8 + pt-osc; backfill idempotency; data integrity verification ladder including Datafold Reconcile; multi-region replica-lag 30s pause threshold); `rules/hatch3r-testing.md` +95 lines (per-ecosystem PBT via fast-check/Hypothesis 6.151+/proptest/jqwik/ScalaCheck; mutation per ecosystem with Stryker 50/60/80 thresholds + Mutmut 88.5%/Cosmic Ray 82.7% + PIT 1.22; fuzz with jazzer/atheris/cargo-fuzz/Go native + Trail of Bits gosentry fork 2026-05-12 for Go after jazzer.js OSS discontinuation; determinism contract; flake quarantine with 14-day SLA; per-feature mandate-map 10-row table; Qodo 2.0 + Diffblue Cover AI test gen). Two existing rules extended with supply-chain floor: `rules/hatch3r-dependency-management.md` +72 lines (npm Trusted Publishing OIDC; `--provenance`; SBOM via CycloneDX 1.6/SPDX 3.0.1 with syft/cdxgen/`npm sbom`; SLSA v1.1 via slsa-github-generator; layered malicious-package detection naming Axios Mar 2026 / Shai-Hulud Sep-Nov 2025 / Mini-Shai-Hulud May 2026 / DevTap May 2026; pnpm `minimumReleaseAge: 72`; pinned Action SHAs citing CVE-2025-30066 tj-actions 23k+ repos; OSV.dev/GHSA/NVD feeds; license allow-list); `rules/hatch3r-secrets-management.md` +29 lines (OIDC trust policies per cloud with `sub` claim binding; secret scanning via gitleaks/trufflehog + GitHub push protection; certificate automation via cert-manager/Caddy/lego with 30/14/7-day alerts; secret manager mandate). Five observability rule pairs (`hatch3r-observability*.{md,mdc}`) gain 7 service-layer glob patterns (`**/routes/**, **/handlers/**, **/services/**, **/api/**, **/middleware/**, **/controllers/**, **/lib/**`) so rules load when needed. Three new skills: `skills/hatch3r-observability-verify/SKILL.md` (9-gate: OTel span coverage / structured logs + trace_id / severity & message standards / RED+USE metrics / SLO + MWMBR burn-rate / error tracker / GenAI semconv on AI features / sampling & cost control / alerts-as-code with runbook URLs); `skills/hatch3r-ai-feature/SKILL.md` (9-step eval-driven workflow: define golden set → pick eval tool → write prompt → iterate → wire telemetry → wire fallback → CI gate → production verification → feedback loop); `skills/hatch3r-reliability-verify/SKILL.md` (9-gate: SLO defined / kill switch / timeouts / retries with decorrelated jitter / probes / graceful shutdown / runbook URL on alerts / staged rollout / blast-radius documented). `agents/hatch3r-security-auditor.md` gains an Authentication & Authorization Depth Checklist (+15 lines, 11 items). New domain tags added to taxonomy (already covered by 1.7.5 slice's TAG_FRONTEND/TAG_UI/TAG_UX/TAG_DESIGN_SYSTEM — no further tag additions needed; new rules reuse existing tags `[implementation, security, devops, review, ai, maintenance]`). Inventory totals: rules 32 → 42 (`.md` + `.mdc` parity, 10 new rule pairs added), skills 60 → 63 (3 new verify/feature skills). Sources cited per the Scientific Rigor Contract: W3C / IETF RFCs (RFC 9700, 9745, 9457, 8594, 9449, 8725, 8707, draft OAuth 2.1, draft Idempotency-Key, draft RateLimit), NIST SP 800-63B-4 (mid-2025), W3C WebAuthn L3 CR (Jan 2026), FIDO Alliance + CXP/CXF (Feb 2026), AuthZEN Authorization API 1.0 (OIDF Jan 2026), Google SRE workbook (MWMBR, hedging), Anthropic prompt caching + OpenAI prompt caching docs, OTel + OTel GenAI semconv (~Jan 2026 stable for client spans), CycloneDX 1.6 + SPDX 3.0.1, SLSA v1.1 (Apr 2025), 2024-26 supply-chain incidents (Axios Mar 2026, Shai-Hulud Sep-Nov 2025, Mini-Shai-Hulud May 2026, DevTap May 2026, tj-actions Mar 2025), 2024-26 outages (CrowdStrike Jul 2024, AWS us-east-1 Oct 2025, Azure East-US2 Sep 2025, Cloudflare Nov 2025).

- **New binding pillar P8 — Clarification & Fan-out Discipline**: A scoped audit across agents, commands, skills, governance, and rules found two systemic gaps: (B1) entry-point agents and user-invocable skills lacked upfront clarifying-question gates — 16/19 agents and 25/29 workflow skills proceeded under silent assumptions; (B2) delegating artifacts framed sub-agent fan-out as a token-cost lever, not a quality lever, with no rule forbidding under-fan-out for token savings. P8 codifies both as binding. **B1 directive (verbatim):** every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven. **B2 directive (verbatim):** sub-agent fan-out scales with task size; serialization is only valid on dependency edges; token cost is never a valid reason to serialize independent work; delegating artifacts emit `sub_agents_spawned: {count, rationale}` as a first-class output field. **Governance plumbing:** CONSTITUTION.md gains §2 P8 + §3 traceability matrix row (binding-pillar count 7 → 8); AUDIT.md behavioral charter directive 17 (Clarification-First Verification) and 13 → 17 directive-count refs corrected; AUDIT-EXECUTE.md Phase 0 sub-check; VISION.md principle 14. **Audit plumbing:** D05 SA5.9 (Clarification-Default Compliance), D07 SA7.6 (Sub-Agent Fan-out Discipline), D13 SA13.5 (Triage-First + Clarification Gate); D06 P7↔P8 boundary clause distinguishes static-frame token economics (P7) from fan-out width (P8); rigor-contract test 7. D05 compressed 104 → 69 to fit the 30-80 SA × 15-line lean threshold. **Rules:** `rules/hatch3r-agent-orchestration.md` Tier-2 hard gate + Cost-Dominance + Scaling Heuristic; `rules/hatch3r-deep-context.md` Tier-2 extension; `.mdc` parity; new framework-dev rules `.claude/rules/clarification-default.md` and `.claude/rules/fan-out-discipline.md`; `.claude/rules/capability-lifecycle.md` gate-checklist extensions for B1 + B2. **Content:** §0 ambiguity-detection block on 19 entry-point agents; cost-dominance + sub_agents_spawned output field on `hatch3r-security-auditor` and `hatch3r-perf-profiler`; Step 0 detection block on 28 workflow skills; Fan-out Discipline block on 25 inline-executing skills; hard threshold gate added to `/hatch3r-quick-change`, Tier-3 specialist mandate + low-confidence escalation added to `/hatch3r-pr-resolve`, research-completeness clause added to `/hatch3r-workflow`, Tier-3 greenfield gate added to `/hatch3r-board-fill`, scope-boundary check added to `/hatch3r-create`. **Gates:** rule-parity 42 pairs / 0 drift; efficiency invariants 0 errors / 0 warnings; cli-skills 29 entries / 0 drift; 3136/3136 tests; tsc + lint + anti-slop clean. Lean thresholds CONSTITUTION 223/250, AUDIT 543/600, AUDIT-EXECUTE 684/700, VISION 219/250.

- **RE-ENVISION redesigned as holistic governance sparring engine (314 → 507 lines, cap 550)**: RE-ENVISION was previously a vision-only 10-theme dialog; the redesign expands it to cover the entire governance corpus via 10 parallel layer sub-agents and an interactive 20-theme sparring dialog with hybrid edit authority. EVOLVE.md stays the automated proposal-only drift detector; its Route A now hands findings off to RE-ENVISION explicitly via pre-seeded `source: evolve-route-a` findings. **§0 Preflight:** P8 ambiguity gate (refs `agents/shared/user-question-protocol.md`), framework-owner authorization + 14-day cadence floor with Critical security / BLOCK audit override, three-mode selection (`full-rethink` / `occasional-check` / `targeted-layer:<layer>`), EVOLVE-REPORT Route A ingestion, Model-Independence Contract inherited from EVOLVE §0 by reference. **§2 Parallel drift-detection fan-out:** P8 directive-17 first-class sub-agent count + rationale, 10 layer SAs (L1 VISION · L2 Pillars · L3 Lean+Anti-Bloat · L4 Traceability+Amendment · L5 AUDIT · L6 AUDIT-EXECUTE · L7 Templates · L8 Domains · L9 Charters · L10 Anti-Slop + EVOLVE/RE-ENVISION boundary), YAML rigor-schema-header output contract, synthesis gate releases per-SA results from context. **§3 Synthesis + triage:** severity-tagged table, 2-of-3 dedup vs open `governance/audit/finding-registry.json` + EVOLVE Route A inbox, 7-field rigor contract enforcement, hard-stop pre-dialog ASK. **§4 Sparring dialog:** 20 theme blocks (T1-T10 existing vision themes + T11 Pillar Validity, T12 Lean Threshold Calibration, T13 Anti-Bloat + Silent Failure, T14 Traceability Matrix Health, T15 Audit Domain Coverage, T16 Execution Model Currency, T17 Charter Completeness, T18 Anti-Slop + Wordlist Parity, T19 Closed-Loop Effectiveness, T20 Routing Boundary Clarity), one block at a time with branching ASK + default-if-no-response. **§5-§6:** edit-authority matrix codified, 4-question Pillar Compliance Test per proposal, three batched per-route ASKs; direct-edit pass with per-file ASK + inline lean and anti-slop checks (delegate multi-file edits to fresh sub-agent per AUDIT-EXECUTE.md Guardrail 18); emits `.re-envision-workspace/cl-3-handoff.md` and `.re-envision-workspace/constitution-amendment-queue.md` with pre-populated dated rationale. **§7-§8:** cross-reference scrubbing, pillar coverage redraw, EVOLVE Route A closure log, inventory + rule-parity regen instruction, per-route counts, next-action bullets, metadata block. **18 Guardrails** covering 5 hard-stop ASK gates, edit-authority enforcement, rigor contract, Model-Independence inheritance, 14-day cadence floor, ephemeral workspace, orchestrator-never-edits delegation pattern. **CONSTITUTION amendments (229/250 lines):** header `Amended: 2026-05-18` line; §2 P5 RE-ENVISION lean-threshold row recalibrated `<=350 | ±20/theme-block` → `<=550 | ±25/theme-block` (calibration math: 10 vision themes + 10 governance-layer sparring themes); §3 traceability matrix RE-ENV column: P4 `—`, P5 `S → P`, P8 `— → P`; §6 Decision #11 ("RE-ENVISION is a holistic governance sparring engine with hybrid edit authority"); §8 amendment protocol adds "RE-ENVISION direct-edit authorization" paragraph enumerating permitted layers (VISION, lean thresholds, anti-bloat, Silent Failure, charter additions/refinements, anti-slop wordlist atomic-pair, EVOLVE mechanics, quality-charter, user-question-protocol, CLAUDE.md cross-refs); pillars / matrix / §8 / Key Design Decisions remain framework-owner direct-edit with dated rationale; audit-system routes to CL-3 / Phase 7. **EVOLVE.md updates (359/400 lines):** out-of-scope rewritten from VISION-only to broader governance content; amendment routing references RE-ENVISION's hybrid authority + CL-3 + §8; Route A definition expanded to match RE-ENVISION's direct-edit authority list; worked-examples refreshed; `hatch3r-evolve` renamed `h4tcher-evolve` (prefix convention parity). **New `.claude/skills/h4tcher-re-envision/SKILL.md` (78 lines):** slash command `/h4tcher-re-envision` with optional flag `--mode full-rethink|occasional-check|targeted-layer:<layer>`; mirrors `h4tcher-audit-cycle/SKILL.md` line economy; 28 numbered invocation steps; six Quality Gates. **Cross-reference updates:** `CLAUDE.md` RE-ENVISION row description; `.claude/rules/capability-lifecycle.md` decision-tree row + gate-checklist note clarifying RE-ENVISION is the only lifecycle preset authorized to direct-edit VISION and CONSTITUTION rows; `.gitignore` adds `.re-envision-workspace/`; `scripts/validate-efficiency-invariants.ts` comment-only confirmation of the RE-ENVISION audit-cycle exemption. Gates: 3160/3160 tests, tsc + build (672 KB) + lint + efficiency + rule-parity 42/0 + cli-skills 29/0 + anti-slop all green.

- **Agent-produced UI/UX governance slice** (closes the scoped-audit finding that no pillar, domain, or charter clause mandated UI/UX quality for code generated by hatch3r agents in end-user projects). CONSTITUTION.md §2 P2 measurement extended with WCAG 2.2 AA conformance (axe-core 0 serious/critical), design-token adoption ≥95% on color/spacing, four-state surface contract (loading/empty/error/partial) 100% coverage, and agent-produced one-shot UI/UX acceptance rate. CONSTITUTION §2 P5 lean thresholds gain three rows enforcing those metrics. VISION.md adds principle 16 "Design quality and accessibility for agent-produced output". AUDIT.md behavioral charter directive count 14 → 15 (new Directive 15 mandates WCAG 2.2 SC 2.5.8/2.4.11/2.5.7, design-system + component-library reuse before generation, four-state contract, AI-UX patterns, 2026 Core Web Vitals at p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1). AUDIT.md sub-agent count 119 → 120 reconciled across AUDIT.md, CLAUDE.md, README.md. New sub-agent SA10.9 "Agent-Generated UI/UX Output Quality" (8-item checklist) added to `governance/audit/domains/D10-documentation-devex.md` (87 → 100 lines, within SA × 15 calibration ceiling). Three new canonical rules with `.md` + `.mdc` parity: `rules/hatch3r-design-system-detection.md` (DTCG 2025.10 tokens, shadcn v4 CLI, Tailwind v4 `@theme`, Radix Primitives + WAI-ARIA APG, Interop 2026 baseline CSS, reuse-extend-create decision tree), `rules/hatch3r-ux-states-and-flows.md` (four-state contract with first-run-vs-filter-vs-network content structure, user-flow decomposition, form recovery semantics, microcopy + tone via GOV.UK + IBM Carbon, perceived performance + 2026 CWV, mobile/touch with 44pt iOS / 48dp Material), `rules/hatch3r-ai-ux-patterns.md` (streaming via Vercel AI SDK UI + AI Elements + `streamUI()` RSC, tool-call UI cards, human-approval gates for side-effectful tools, cancel/abort/undo, span-grounded citations, multi-step agent UX). Three existing rules extended: `rules/hatch3r-component-conventions.md` (+30 lines: library and token detection prerequisite, four-state contract, form error-recovery semantics); `rules/hatch3r-i18n.md` (+13 lines: Microcopy and Tone subsection); `rules/hatch3r-accessibility-standards.md` (+21 lines: WCAG 2.2 new SCs 2.5.8/2.4.11/2.5.7, mobile and touch). Two new skills: `skills/hatch3r-design-system-detect/SKILL.md` (5-step detection routine producing a Design System Inventory) and `skills/hatch3r-ui-ux-verify/SKILL.md` (9-gate verification: axe-core, keyboard trace, accessibility-tree snapshot, four-state coverage, visual regression, microcopy lint, Core Web Vitals 2026, AI-UX checks, one manual screen-reader pass per release). Two existing skills updated: `skills/hatch3r-visual-refactor/SKILL.md` replaces the unactionable "review design system" line with an Invoke reference to the new detection skill; `skills/hatch3r-qa-validation/SKILL.md` Step 3c routes to `hatch3r-ui-ux-verify` as the UI/UX gate. New researcher mode `agents/modes/user-flows.md` (76 lines) decomposes every user story into Happy Path + Alternative Paths + Error-Recovery Path with State Map and Microcopy Draft tables before implementation; `agents/modes/similar-implementation.md` extended with Component-library and Design-token-source extraction fields; `agents/modes/requirements-elicitation.md` UI/UX dimension gains component-library + design-token + user-flow probes. `agents/shared/quality-charter.md` gains a "UI/UX quality (for agent-produced output in end-user projects)" section (+13 lines) binding agents to accessibility, design-token reuse, four-state, microcopy, AI-UX, and the verification gate. `agents/hatch3r-reviewer.md` Review Checklist item 12 adds `copy.review` (tone, jargon scrub, specificity, i18n, empty/error CTAs) with the field surfacing in the reviewer's structured summary output. Inventory totals: rules 29 → 32 (`.md` + `.mdc` parity), skills 58 → 60, modes count grows by one. Sources cited per the Scientific Rigor Contract: W3C Design Tokens Community Group format spec 2025.10, WCAG 2.2 Recommendation, shadcn v4 CLI changelog (March 2026), Tailwind CSS v4 docs (`@theme`, OKLCH default), Interop 2026 dashboard (`:has()`, container queries, View Transitions, anchor positioning, native popover/dialog Baseline), Vercel AI Elements + AI SDK UI docs, Google Core Web Vitals 2026 thresholds (INP replaced FID at p75 ≤200ms), Playwright accessibility testing, Deque axe-core integration, NN/g 2025 AI-generated dashboard state-omission analysis, GOV.UK Design System voice + tone, IBM Carbon style.

## [1.7.1] - 2026-05-12

### Added

- **Platform-native user-question protocol for agentic triage**: New canonical reference file `agents/shared/user-question-protocol.md` (95 lines, single source of truth) defines when to ask a clarifying question (ambiguous requirement, branching path, irreversible decision, conflicting constraints, missing acceptance criteria), when not to ask, how to ask (platform-native question/triage tool preferred; structured numbered-options plain-text fallback otherwise), and a Plain-Text Fallback Template with required default-if-no-response. The new `ASK_USER_TOOLS` map in `src/pipeline/adapterToolTranslator.ts` is the per-adapter source of truth — `claude → AskUserQuestion`; the other 14 adapters (`cursor`, `copilot`, `windsurf`, `codex`, `cline`, `opencode`, `amp`, `aider`, `kiro`, `goose`, `zed`, `amazon-q`, `gemini`, `antigravity`) start as `null` pending per-cycle web-research verification by their respective adapter author. The new `nativeQuestionTool: boolean` column in `ADAPTER_CAPABILITIES` (`src/adapters/index.ts`) declares the capability and is invariant-tested against the map in `src/__tests__/adapters/capability-matrix.test.ts`. At canonical-write time `copySelectedContent` in `src/content/index.ts` post-processes shared `.md` files and replaces the `<!-- HATCH3R:PLATFORM-TOOL -->` marker with a markdown enumeration table built from the map — adapter-agnostic substitution so a single canonical write serves multi-adapter projects, and any platform's runtime agent looks up its own row. The protocol file is referenced by one-line additions in `agents/shared/quality-charter.md` §3, `agents/modes/requirements-elicitation.md`, the five ASK-checkpoint commands (`hatch3r-workflow`, `hatch3r-quick-change`, `hatch3r-board-fill`, `hatch3r-board-pickup`, `hatch3r-revision`), and the four ask-prone agents (`hatch3r-researcher`, `hatch3r-fixer`, `hatch3r-architect`, `hatch3r-implementer`) — 11 propagation references total, all preserving existing "Ask first" / ASK-directive sentence structure. `governance/audit/domains/D09-platform-adapters.md` gains a new per-adapter checklist line driving per-cycle official-doc verification of each adapter's native question tool name and the map↔flag agreement, keeping the file at 79 lines (within the 30–80 lean threshold) by removing one blank-line separator. Test surface: seven new unit tests for `ASK_USER_TOOLS`, `getAskUserToolEntry`, `toAskUserPlatformNote`, `buildAskUserPlatformTable`, `substituteCanonicalPlatformMarker` in `src/__tests__/pipeline/adapterToolTranslator.test.ts`; one new invariant test in `src/__tests__/adapters/capability-matrix.test.ts` asserting `nativeQuestionTool === true ⇔ ASK_USER_TOOLS[adapter] !== null` for all 15 adapters. Pillar service: P1 (CLI/UX excellence — native question tool produces structured triage UX over free-text replies), P3 (adapter currency — the new D09 line mandates web-research verification each cycle), P4 (single SoT, lean 1-line propagation refs, no duplication across the 11 referencing files), P5 (governance lean thresholds preserved: protocol file 95 lines, D09 79 lines, all propagation files ≤+1 line). Smoke-tested via `hatch3r init --tools claude` against scratch repositories — emitted `.agents/agents/shared/user-question-protocol.md` contains the substituted table with `AskUserQuestion` in the `claude` row and fallback prose for the other 14 adapters; zero marker leakage across all generated content.

- **Agentic action replay via `/hatch3r-report`**: New canonical command in `commands/hatch3r-report.md` (163 lines, `orchestrator: false`, inline-execution) that produces an in-chat report of what happened in a Claude Code session — every `tool_use` (Read / Edit / Write / Bash / Agent / Grep / etc.), every sub-agent `Agent` delegation (with `subagent_type` and prompt preview), every file edit, every hook event — with diagnostics that surface missed parallelism, redundant work, and over-serialization. Two audiences: (a) users who want to understand a session end-to-end, (b) hatch3r maintainers investigating runtime shape for framework-level optimization opportunities. The command reads the on-disk Claude Code session transcript at `~/.claude/projects/{cwd-as-slug}/{sessionId}.jsonl` (where each line is a `{type, message.content[], timestamp, sessionId, cwd, gitBranch}` record covering `tool_use`, `tool_result`, `thinking`, `text` blocks plus `hook_success` attachments). Aggregation is driven by a single `jq -s` pipeline — counts grouped by tool name, distinct read / edit paths, top-3 most-read files, per-turn tool_use array lengths (for parallel-vs-sequential classification), tool_result error rate via `/error|failed/i` substring match — so the LLM only sees aggregated structured data, never the raw JSONL (P7 token efficiency; no sub-agent round-trip needed regardless of session length). Four flags compose: `--session <id|path>` targets a past session (UUID resolved under the slug dir, or absolute path), `--list` enumerates the 5 most-recent sessions with sessionId / mtime / first-user-message preview, `--verbose` appends a chronological per-turn timeline with parallel (✓) / sequential (⚠) markers, `--save` writes the rendered markdown plus a `## Raw Counts (machine-readable)` JSON appendix to `.hatch3r/reports/{sessionId-short8}-{YYYYMMDD-HHMMSS}.md` for cross-session grep. Nine falsifiable diagnostic rules: D-PAR-01 (≥3 consecutive single-tool same-type turns on disjoint inputs → missed parallelism), D-PAR-02 (≥2 `Agent` calls within 10 turns on disjoint subsystems → missed fan-out), D-RED-01 (same `Read.file_path` ≥3x with no intervening Edit/Write → redundant Read), D-RED-02 (identical `Bash.command` ≥2x within 20 turns → re-Bash), D-LOOP-01 (thinking chars ÷ tool_use count > 1200 AND tool_use count < 8 → high think-to-action ratio), D-LOOP-02 (turn with ≥5 tool_use followed by ≥4 empty turns → burst then stall), D-ERR-01 (>20% tool_result error rate), D-PATH-01 (file staleness — read at N, edited at M, re-read at P>M+15 with no intervening edit), D-SUB-01 (`Agent` returning <200 chars with no follow-up edits → empty sub-agent). Each fired record carries `{id, severity, turns:[...], evidence, suggestion}`; same-rule fires consolidate into one record per session. Guardrails: never modify the JSONL (read-only via `mktemp` scratch), mask obvious secret patterns (`sk-`, `ghp_`, `xoxb-`, `AIza`, `Bearer `) in rendered tool_use input, never write outside `.hatch3r/reports/`, skip-and-count malformed records per the Silent Failure Contract (surface skip count in summary footer). The new `.hatch3r/` line in `.gitignore` lands alongside this feature — `.hatch3r/` was already used internally by `src/pipeline/observability.ts` for `efficiency-events.jsonl` but was previously untracked, so the `--save` target and the latent leak are both closed in one change. Pillar service: P1 (CLI/UX — progressive disclosure summary → `--verbose` → `--save`; actionable diagnostics with turn refs and explicit suggestions; `jq`-missing error message includes install hint), P5 (Governance Self-Quality — the framework can now see itself working; per-session execution data is empirical input for future audit cycles, particularly D05 prompt-engineering and D06 token-economics), P7 (Speed & Token Efficiency — the entire diagnostic table directly targets the parallelism and serialization patterns P7 was designed to enforce across all 36 other commands; `cache_friendly: true`, `parallel_tool_default: true`; the jq-aggregation strategy keeps the LLM context bounded regardless of transcript size). New command is auto-picked-up by all 15 platform adapters via `src/adapters/canonical.ts::readCanonicalFiles` — no per-adapter code change. Inventory regenerated: `governance/inventory.json` `counts.commands` 36 → 37; `files.commands` inserts `hatch3r-report.md` alphabetically between `hatch3r-release.md` and `hatch3r-revision.md`.

- **PR comment resolution via `/hatch3r-pr-resolve`**: New orchestrator command in `commands/hatch3r-pr-resolve.md` (666 lines) that closes the reviewer-to-contributor loop on an open PR. The command auto-detects the PR on the current branch (or accepts `<pr-number>` as a positional argument), fetches three comment scopes across GitHub / Azure DevOps / GitLab (inline review comments via `pulls/{N}/comments` + GraphQL `reviewThreads` for resolution state, review summaries via `pulls/{N}/reviews`, general PR discussion via `issues/{N}/comments`; Azure DevOps unifies these under threads, GitLab under discussions), evaluates each comment against current code using the six-test Scientific Rigor Contract (`governance/audit/templates/rigor-contract.md` — falsifiability, ≥3-step causal chain, confidence with basis, bias check, counter-argument), then presents one consolidated triage table with five routing buckets (FIX NOW, DECLINE — outdated/disagree/already-done, NEEDS_CLARIFICATION, Needs your call for low-confidence accepts, DEFER) gated by a single ASK checkpoint. After the user accepts triage the run is autonomous: Step 6 delegates fixes via blast-radius-aware specialist sub-agents (`hatch3r-implementer` > `hatch3r-lint-fixer` > `hatch3r-test-writer`); Step 7 runs the reviewer/fixer review loop (max 3 iterations, oscillation detection backed by `src/pipeline/reviewLoop.ts`) followed by parallel final-quality specialists (mandatory `hatch3r-test-writer` + `hatch3r-security-auditor`; conditional `hatch3r-docs-writer` / `hatch3r-a11y-auditor` / `hatch3r-perf-profiler` / `hatch3r-lint-fixer`); Step 8 posts a per-comment reply using one of seven templates keyed by decision (implemented-in-{sha}, attempted-but-blocked, declined-outdated, declined-disagree, declined-already-done, needs-clarification, deferred-to-todo.md) via the platform reply endpoints (`gh api ... -X POST -f in_reply_to=...`, `az rest -m POST --url '...threads/{tid}/comments...'`, `glab api '.../discussions/{did}/notes' -X POST`) with 2-retry / 2s+8s backoff resilience; Step 9 commits and pushes; Step 10 emits the canonical Iteration Summary block per `rules/hatch3r-iteration-summary.md`. Tier classification (1/2/3) drives pipeline depth — Tier 1 (≤5 nits, 0 critical) skips the review loop; Tier 3 (>30 comments OR any Critical OR architectural discussion) runs the full pipeline plus merge-readiness assessment. The single mutation gate is Step 5; reply replies do not abort on individual POST failure (failures surface in Step 10 under Not Done / Unverified). Guardrails forbid thread closure, review approval/dismissal, label / status-check mutation, cross-PR work, and base-branch push. Resolved threads are skipped by default (per `isResolved` for GitHub, `status: fixed/closed` for Azure, `resolved: true` for GitLab). Bot-authored comments are evaluated under the same rigor contract as human comments (no special-case skipping). The companion `commands/board/shared-{github,azure-devops,gitlab}.md` Cross-Cutting Tooling tables each gain 4–7 new rows for the PR-comment read and reply endpoints — additive context useful for future PR-related commands. Pillar service: P1 (single ASK + actionable errors), P2 (rigor contract per finding), P3 (per-platform CLI currency), P4 (single-file orchestrator at 666 lines, well under the orchestrator typical-size range), P5 (mirrors `hatch3r-revision` patterns rather than duplicating). New command is auto-picked up by all 15 platform adapters via `src/adapters/canonical.ts::readCanonicalFiles` — no per-adapter code change.

### Fixed

- **Worktree-setup drift on freshly-created worktrees (G6)**: `npx hatch3r worktree-setup <name>` now produces a worktree whose `git status` is clean immediately after creation. Previously, sync inside the new worktree could rewrite many tracked files with trailing-newline-only diffs because the merge layer did not enforce a POSIX final newline on managed-block output. `src/merge/managedBlocks.ts::wrapInManagedBlock` and `src/merge/managedBlocks.ts::insertManagedBlock` now both guarantee a trailing `\n` on every returned string; the three callers that previously compensated with `+ "\n"` (`src/adapters/copilot.ts:87`, `src/cli/shared/agentsContent.ts:453,538`) had their compensations removed so the result is no longer a double newline. Regression guards added: per-helper trailing-newline + idempotency tests in `src/__tests__/merge/managedBlocks.test.ts`; second-write-returns-unchanged invariant across all four `safeWriteFile` paths in `src/__tests__/merge/safeWrite.test.ts`; whole-project SHA-256 snapshot comparison across two consecutive syncs in `src/__tests__/cli/lifecycle.test.ts`; end-to-end real-git worktree round-trip assertion in `src/__tests__/worktree/setupCleanup.test.ts`.

- **macOS / agent-driven friction in `/hatch3r-board-fill` and `/hatch3r-pr-resolve` (#71)**: Three normative fixes in the board command surface address friction points reported when an agent ran board-fill under Copilot Chat on macOS (PR-reply HTTP 422, agent-synthesised bash-4 script failing on system `bash 3.2`, `gh api --jq` returning empty output due to alternate-screen pager). (a) `gh api -F in_reply_to={comment_id}` (capital `F`) replaces `-f` on the PR inline-comment-reply endpoints — `-f` sends a URL-encoded string and the GitHub REST API rejects it with HTTP 422 because `in_reply_to` is integer-typed; touches `commands/board/shared-github.md:173` (Cross-Cutting Tooling row) and `commands/hatch3r-pr-resolve.md:521` (Step 8b GitHub branch). (b) New **GitHub CLI Field-Typing Notes** subsection at the end of `commands/board/shared-github.md` enumerating the integer / boolean fields hatch3r touches (`sub_issue_id`, `in_reply_to`, `parent_issue_id`, `issue_number`, `pull_number`, `team_id`, `user_id`, `milestone_number`, `draft`, `merged`, `auto_merge`) and the `-F` vs `-f` rule. (c) Two new normative subsections in `commands/hatch3r-board-shared.md` Cross-Cutting Tooling Directives: **Agent-Synthesized Wrapper Scripts** (default to individual tool calls over synthesised bash; if a wrapper is unavoidable, target `bash 3.2` — bans `declare -A` / `${!ARR[@]}` / `mapfile` / `readarray`, requires `#!/usr/bin/env bash` shebang plus a `BASH_VERSINFO[0]` guard that exits 64 loudly, notes `zsh` is not a drop-in substitute) and **Pager-Bypass Directive** (every `gh api` / `gh pr view` / `gh issue view` / `gh project item-list` / `az pipelines run` / `glab api` invocation must run with `GH_PAGER=cat PAGER=cat` set — the default `less` pager opens the alternate screen buffer which loses `--jq` output in non-TTY contexts and is not defeated by `| cat`). Sibling board commands (`board-init`, `board-fill`, `board-pickup`, `board-groom`, `board-refresh`) inherit via their existing `hatch3r-board-shared` references — no per-command edits needed. `hatch3r-pr-resolve` gains an inline cross-reference next to its endpoint table pointing at both directives.

- **Pipeline-enforcement drift on Copilot Chat (#73)**: GitHub Copilot Chat bypassed hatch3r's "never implement inline; always delegate" mandate while implementing a Tier-3 epic (13 sub-issues), making direct `multi_replace_string_in_file` / `create_file` calls without ever spawning `hatch3r-implementer`. The mandate was text-only and gets bypassed when context decays or user phrasing is ambiguous ("Start implementation"). Copilot has `hooks: false` in the capability matrix (`src/adapters/index.ts:98`) — no `PreToolUse` hook, no transcript access from external processes, no tool-refusal API — so enforcement is necessarily instructional. Four normative changes ship together. (a) `rules/hatch3r-agent-orchestration.{md,mdc}` enumerates the inline-edit tool list explicitly (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`, `str_replace_based_edit_tool`, `apply_patch`, or any platform-equivalent), and adds a new `### Per-Turn Pipeline-State Header` directive: at Tier >= 2 on tracked tasks, the orchestrator MUST start every assistant turn with `[hatch3r-pipeline: phase {1-4} | last: {agent → status} | next: {agent or "user-confirmation"}]`; a missing header is a self-detectable drift signal. A companion `### Mandatory Delegation Directive (No Inline Implementation)` block restates the prohibition for sub-agent prompt inclusion. (b) `rules/hatch3r-deep-context.{md,mdc}` Tier-3 mandatory checkpoint changes from advisory ("Do NOT proceed until questions answered") to a hard gate: until the user has explicitly confirmed the Pre-Implementation Summary, the orchestrator MUST NOT call any code-writing tool AND MUST NOT spawn `hatch3r-implementer` or `hatch3r-fixer`; read-only / reasoning tools (`Read`, `Grep`, `Glob`, `Bash` for read-only, `WebFetch`, `WebSearch`, `Task` with researcher-only sub-agents) remain available. (c) `src/adapters/copilot.ts` emits a new `## Copilot Enforcement Model (no hook surface)` addendum into `.github/copilot-instructions.md` directly after the bridge orchestration block, citing the capability matrix explicitly and listing three self-detectable drift indicators. (d) `src/cli/commands/init.ts` extends `LEARNINGS_README_SEED` with a copy-paste-ready "Recommended First Learning — Pipeline Drift" section so users can drop one file into `.agents/learnings/` and `hatch3r-learnings-loader` will prime future sessions against the pattern. `rules/hatch3r-iteration-summary.{md,mdc}` gains a one-line cross-reference clarifying that the new start-of-turn pipeline-state header is a separate artifact from the end-of-turn Iteration Summary block. `docs/adapter-capability-matrix.md` adds a Hook-surface notes section explaining Copilot's `hooks: --` status. Test surface: rule-parity gate verifies `.md` / `.mdc` body parity across all three modified rule pairs; efficiency invariants gate confirms no `cache_friendly` / `parallel_tool_default` flag regression. Pillar service: P1 (visible per-turn state, drift detectability), P2 (depth-fitting Tier-3 hard gate), P5 (governance self-quality — pipeline integrity), P6 (security & trust — prevents unauthorised inline edits), P7 (speed & token efficiency — enforces proper sub-agent fan-out).

### Upgrade notes

- The first `hatch3r sync` after upgrading from 1.7.0 will rewrite every previously-managed hatch3r-* file by exactly one byte — a trailing `\n` appended. Run sync in your project root, review the diff, and commit it before invoking `hatch3r worktree-setup`. After this one-time migration, subsequent syncs are byte-stable and worktree-setup leaves a clean tree.

### Chore

- Dependency and CI-action bumps merged into the release branch (no runtime behavior change, no API surface change): production deps group (#68), development deps group with 6 updates (#69), `github/gh-aw` 0.68.1 → 0.73.0 (#67), `actions/setup-node` 6.3.0 → 6.4.0 (#62), `actions/github-script` 8.0.0 → 9.0.0 (#50), `actions/upload-pages-artifact` 4.0.0 → 5.0.0 (#49). The release PR itself is #74.

## [1.7.0] - 2026-04-27

### Added

- **User-content authoring via `/hatch3r-create`**: End users can now create their own custom agents, skills, rules, commands, and hooks for their project via a new unified slash command. The `/hatch3r-create` orchestrator (in `commands/hatch3r-create.md`) collects type/name/description/tags + type-specific extras (rule scope/precedence, hook event, command orchestrator/agentPipeline) over a Phase 1 → Phase 2 (delegate to sub-agent) → Phase 3 (validate + sync hint) flow, then delegates to the new `hatch3r-creator` sub-agent (`agents/hatch3r-creator.md`). The sub-agent assembles frontmatter and body from skeletons in `agents/shared/user-content-templates.md`, then calls `saveUserContent` in the new `src/content/userContent.ts` module which runs the strict + gentle gate funnel and atomic-writes to `.agents/user/{type}/{name}.md` (skills nested as `.agents/user/skills/{name}/SKILL.md`, rules paired with `.mdc` companions). User artifacts propagate to all 15 platform adapter outputs by default; an optional `adapters: [claude, cursor]` frontmatter list restricts emission per artifact. The companion subtree mirrors the existing `agents/modes/`, `agents/shared/` pattern so user content sits naturally outside `managedFiles` and is never overwritten by `hatch3r update` or deleted by `hatch3r clean`.

- **Audit domain D20 (User-Content Authoring & Governance)**: New audit domain with 2 sub-agents covering the new feature. D20.1 (Creation Tool Quality) audits `/hatch3r-create`, the `hatch3r-creator` agent, and the templates with an 8-item checklist: creator-command UX walkthrough across 5 type branches, agent body structure, template completeness, error-message actionability, charter-inheritance enforcement at write time, lean enforcement at write time, earn-existence prompt, negative-scenario coverage. D20.2 (Artifact Compliance) audits the user-authored artifacts produced by the creator with a 6-item checklist: frontmatter validity, security baseline inheritance from D15, quality-charter inheritance from D05, lean compliance (user agent ≤150 lines, user skill ≤200 lines, user rule ≤80 lines), pillar tagging, duplication against canonical (≥50% description-keyword overlap = Medium with rationale). D20.2 is sequential — depends on D20.1 plus D05 (charter) and D15 (security) baselines. The new domain file `governance/audit/domains/D20-user-content-authoring.md` is 46 lines, well within the 30–80 lean threshold for SA ≤5 domains.

- **Audit sub-agent 16.3 (Artifact Inventory & Redundancy)**: New cross-domain synthesis sub-agent that audits the canonical content corpus (16 agents + 26 skills + 27 rules + 34 commands + 6 hooks plus companions under `agents/modes/`, `agents/shared/`, `commands/board/`, `commands/revision/`, `checks/`; corpus snapshot at the time D16.3 was authored — see `governance/inventory.json` for current counts) for whole-artifact redundancy. Closes the asymmetry where Phase CL-2 specs net-new artifacts but no audit channel surfaced removal/merge candidates — `governance/audit/domains/D16-compound-system.md` previously held only 16.1 (cross-domain contradictions) and 16.2 (closed-loop effectiveness), both flagging missing-or-broken state without ever asking "should this artifact still exist?" The new sub-agent runs sequentially after Tier A+B, applies the Scientific Rigor Contract, and uses a 7-item checklist: cross-artifact functional overlap (within-type pairwise comparison), skill↔command redundancy (same workflow packaged twice), pillar coverage tally (P1–P6 over-/under-served signals), removal-candidate threshold (zero unique value AND ≤1 cross-reference AND no orchestrator dependency in any `agentPipeline:` — fail any one and it's a merge candidate at most), add-vs-remove bias check (default to consolidation), companion content scope drift (support files that became standalone artifacts), and severity discipline (merge=Medium max, removal=High max).

- **Pillar P7 (Speed & Token Efficiency)**: New 7th binding pillar in `governance/CONSTITUTION.md` §2 covering end-user runtime token economy and latency for hatch3r-generated agentic flows. Eight zero-quality-loss patterns codified in the new shared resource `agents/shared/efficiency-patterns.md` (70 lines, sibling of `quality-charter.md`, falls under the agents/shared/* filename-prefix exception): static-first prompt structure (cache-friendly across Anthropic/OpenAI/Google), parallel-tool-by-default, triage-first orchestration with auto-tiered depth (Tier 1/2/3), plan/act split, structured outputs over prose, lazy loading via reference-by-pointer, conditional skill/rule loading, diff-only outputs. The audit cycle (AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, commands/hatch3r-audit*.md) is hard-exempt throughout — depth there is non-negotiable. New audit-cycle Behavioral Charter directive 14 (Speed & Token Efficiency Awareness). D06 (Context Engineering & Token Economics) extended from 4 → 6 sub-agents — 6.5 End-User Runtime Efficiency (7-item checklist) and 6.6 Cross-Adapter Efficiency Consistency (4-item checklist). Two new regression gates 16 (`--triage-first`) and 17 (`--static-first`) in AUDIT-EXECUTE.md, enforced by the new 332-line `scripts/validate-efficiency-invariants.ts` validator with three flag modes plus a hard-coded audit-cycle exempt list. Passive `recordEfficiencyEvent` telemetry hook in `src/pipeline/observability.ts`, opt-in via `HATCH3R_EFFICIENCY_TELEMETRY=1`, writes JSONL to `.hatch3r/efficiency-events.jsonl`, never throws (Silent Failure Contract honored via the failureLog channel). Five new optional canonical-content frontmatter fields (`efficiency_patterns`, `efficiency_tier`, `cache_friendly`, `parallel_tool_default`, `triage_tiers`) recognized by `src/cli/commands/validate.ts` with soft-warning type checks; the hard requirement that orchestrator: true commands declare `triage_tiers` lives in the separate validator script and AUDIT-EXECUTE gate 16. New `validate:efficiency` and umbrella `validate` npm scripts. Full sweep applied across all 148 canonical content artifacts — every artifact now carries `cache_friendly: true` as the sweep-completion marker (43 agents, 50 commands including 15 board/revision support files, 26 skills, 27 rules `.md` only — `.mdc` parity preserved per the validate-rule-parity allowlist —, 6 hooks, 5 checks excluding README, 3 prompts, 4 github-agents). 17 orchestrator: true commands now declare `triage_tiers: [1, 2, 3]` and a Triage / Tier Assessment heading in body satisfying gate 17; `commands/hatch3r-quick-change.md` Step 2 heading renamed `Scale Assessment` → `Tier Assessment` so the new top-level `## Triage` block flows with the existing tier logic. `commands/hatch3r-create.md` received a parallel-dispatch directive clearing the only `P7-PARALLEL-MISS` warning. Final validator state: `tsx scripts/validate-efficiency-invariants.ts` reports `0 errors, 0 warnings`. Pillar is LLM-model-agnostic — provider-specific cache hints (Anthropic prompt caching, OpenAI Responses caching, Google Gemini implicit caching) auto-benefit when supported but degrade gracefully when absent.

- **Standardized iteration summary contract**: New `scope: always` rule pair `rules/hatch3r-iteration-summary.{md,mdc}` defining a 5-field canonical end-of-iteration block — Status (closed enum: SUCCESS | PARTIAL | FAILED | BLOCKED), Outcome (one sentence), Done, Not Done / Deferred / Unverified, Open Questions / Blockers, Confidence + basis — that every host AI (Claude Code, Cursor, Cline, Copilot, Windsurf, Gemini, Codex, OpenCode, Amp, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity) emits at the end of every user-facing iteration. Optional sections (Artifacts Touched, Verifications Run, Earliest Failure Point, Suggested Next Action) are appended only when they carry information. Quality charter (`agents/shared/quality-charter.md`) gains §10 referencing the rule. D10.2 audit checklist gains one verification row. Schema choice (Markdown sections + closed-enum `Status`) is backed by cross-model format-effect research (arXiv:2411.10541) showing JSON-mode degrades reasoning ~10–15% and Markdown reaches ~80% cross-model fidelity vs ~15% for constrained JSON; the required `Not Done / Deferred / Unverified` field directly addresses the MAST agent-failure taxonomy (arXiv:2503.13657) finding that false-positive self-validation is endemic in agentic systems. The rule propagates verbatim to all 15 platform adapter outputs via the existing rule-loading paths — zero per-adapter code. Internal canonical sub-agents (`agents/hatch3r-*.md`, `agents/modes/*.md`) keep their existing structured outputs unchanged; the contract targets only the top-level user-facing agent, preserving the implementer→reviewer→fixer handoff anchors at `agents/hatch3r-implementer.md:149-169` and `agents/hatch3r-reviewer.md:200-220`.

### Changed

- **`governance/AUDIT.md` audit baseline incremented 106 → 107**: Updates Purpose statement (line 9), Sub-Agent Strategy (line 57), Concurrency Model (line 87), Tier C launch row (line 118), Peak Context note (line 121), Quality Checklist (line 248), Summary Table D16 row (line 361 from `2|0|2` to `3|0|3`), and Summary Table totals (line 364 from `106|98|8` to `107|98|9`). Concurrency Model also corrected a pre-existing off-by-one — the prior wording said "97 immediate + 9 sequential = 106" while the table summed `98 + 8 = 106`; both numerators now align at "98 + 9 = 107". Dependency Graph adds a 16.3 entry depending on `D5, D14, pre-audit inventory`.

- **`governance/CONSTITUTION.md` P4 measurement extended**: Added `artifact-level redundancy candidates surfaced per cycle` to the Comprehensive Lean Coverage measurement line. Previous measurement bound P4 only to governance duplication index (<5%) and total line count (<=3000); the new measurement extends "every file earns its existence" to canonical content via the new D16.3 sub-agent.

- **`governance/audit/domains/D16-compound-system.md` sub-agent count 2 → 3**: Adds 16.3 to the table and a new checklist section. Stays within the 30–80-line domain-file lean threshold (file grows from 52 to ~64 lines).

- **`governance/AUDIT.md` audit baseline incremented 107 → 109**: Updates Purpose, Sub-Agent Strategy, Concurrency Model, Tiered Execution C row (D11–D16, D20 / 27 sub-agents), Peak Context note, Quality Checklist count, Summary Table (new D20 row at C / 2 / 1 / 1 and totals 109 / 99 / 10), and Dependency Graph (adds 20.2 row depending on 20.1, D5, D15). **Tier C weight redistribution**: D11–D16 weight bumped from 0.0443 to 0.038 each so that Tier C accommodates 7 domains (D11–D16 + D20) at 0.038 × 7 = 0.266, preserving the AUDIT-EXECUTE.md Phase 7 invariant `A=0.308, B=0.348, C=0.266, D=0.078`.

- **`governance/CONSTITUTION.md` P4 measurement extended (second pass)**: Added `user-content authoring tool quality` to the Comprehensive Lean Coverage measurement line; added `D20 (User-Content Authoring)` to P4 governance refs; appended D20 references to P1, P4, P5, P6 rows of the §3 Pillar-Governance Traceability Matrix in-place (no new lines).

- **`governance/VISION.md` content maintenance model extended**: New "Canonical Content vs Project-Local Content" sub-section in §Content Maintenance Model documents the canonical-vs-user split — canonical content maintained ONLY through the audit cycle by the framework owner; project-local content authored by end-users via `/hatch3r-create` and stored under `.agents/user/`, held to the same one-shot success standard via D20 (D20.1 audits the creator tool, D20.2 audits the artifacts). Both bodies of content subject to the shared quality charter and lean thresholds. §Quality Bar appended one-sentence clarification that user-authored artifacts use hybrid gates (creator-tool gates at write time, artifact-compliance gates at audit time).

- **`governance/AUDIT-EXECUTE.md` Phase 6 + Phase 7 extended**: Phase 6 now recognizes user-content adoption signals (≥3 user projects independently re-implementing the same project-local artifact) as P2 promotion candidates flowing into the canonical content gap pipeline. Phase 7 invariant check clarified to `C=0.266 split across D11–D16+D20 at 0.038 each`.

- **`governance/RE-ENVISION.md` triggers extended**: Adds a content-scope-expansion trigger (e.g., user-authored content scope added in cycle that introduced D20) so that the next vision-refresh cycle validates whether end-user adoption metrics warrant further vision adjustment.

- **`.claude/skills/audit-cycle/SKILL.md` description bumped 106 → 109 and Tier C 24 → 27**: The skill description was stale at 106 (pre-D16.3); this release fixes the staleness AND adds D20 in one go. Tier C count bumped from 24 (6 domains × 4 SA average) to 27 reflecting D20.1+D20.2.

- **Adapter pipeline now consumes user content**: `src/adapters/canonical.ts::readCanonicalFiles` gains a fourth `includeUser = true` parameter; when the user subtree exists at `${agentsDir}/user/{type}/`, the same `readGlobMd` / `readSkillSubdirs` helpers scan it and tag results `source: "user"` with parsed `adapters?: string[]` frontmatter. Concatenation order is canonical-first, user-second (predictable). The existing `scanCanonicalInjectionTokens` tamper-detection pass applies uniformly. `src/adapters/base.ts` adds a private `filterByAdapterScope(files)` helper called from both `readTrackedCanonicalFiles` and `readUserFacingCanonicalFiles`: canonical files always pass; user files with empty/omitted `adapters` array pass (full parity default); user files with non-empty `adapters` only emit when `this.name` is in the list.

- **`src/cli/commands/validate.ts` enforces strict + gentle user-content gates**: New `validateUserContent` function called after `validateContentConsistency`. Strict gates (push to `result.errors`, block save semantics): kebab-case id with no `hatch3r-` prefix, description ≥60 chars, ID-collision check via the new `user-shadow-canonical` collision kind in `src/content/index.ts`, deny-pattern scan via existing `scanForDeniedPatterns` (`src/adapters/customization.ts:290`), `.md`/`.mdc` parity for rules, orchestrator/`agentPipeline` contract via existing `validateCommandOrchestratorFrontmatter`, hook event enum via `isValidHookEvent`, file size ≤10240 bytes. Gentle gates (push to `result.warnings`, save proceeds): 12-entry anti-slop wordlist scan, body lean line threshold (>120 lines), missing `quality_charter:` reference, missing pillar declaration. The pre-existing prefix-enforcement lint at validate.ts:226–245 only inspects `manifest.managedFiles`, which never includes `.agents/user/` files — auto-exempt.

- **`src/cli/commands/init.ts` adds optional create-prompt**: After the existing "Hatch complete" boxen message, in non-`--yes` interactive mode, init asks "Would you like to create your first custom artifact now?" with default `false`. On `true` → prints "Run /hatch3r-create in your AI tool to start authoring". On `false` → prints "Tip: Run /hatch3r-create anytime to author your own agents, skills, rules, commands, or hooks". `--yes`, workspace-headless, and clean-reinit flows skip the prompt entirely (`runInit` gains an optional `yes?: boolean` field threaded through three internal callers).

- **`src/cli/commands/{sync,status,update,clean}.ts` and `src/clean/index.ts` extended**: `sync` logs "User content: N artifact(s) discovered" via `discoverUserContent`. `status` reads `manifest.userContent` and prints per-type counts + lastModified, with fallback scan of `.agents/user/`. `update::copyHatch3rFiles` adds a defensive `HatchError` invariant guard that throws if `srcDir` contains a `/user/` segment (no-op runtime today; cements the project-side-only contract). `clean::CleanInventory` gains optional `userContentCount?: number` populated by `inventoryArtifacts`; `printInventory` shows `.agents/user/ N user artifact(s) (kept — user-authored)`; `executeClean` walks `.agents/` children and skips `user` when content exists.

- **New `src/content/userContent.ts` (628 LOC)**: Public API `saveUserContent`, `discoverUserContent`, `validateUserArtifact` plus the `UserContentArtifact` and `SaveResult` types. Gate funnel sequence: strict gates → atomic write via `src/merge/safeWrite.ts::atomicWriteFile` → `.mdc` companion generation for rules via re-exported `cursorCompanionFrontmatter` from `src/content/index.ts` → `hatch.json` `userContent` counter update via the manifest write path (counter optional; older versions tolerate absence). Path-traversal guard rejects names containing `/`, `\`, `..`, or null bytes. Concurrent-save race produces one `written` and one `strictFailures` collision rather than corrupted state.

- **`src/content/index.ts::buildContentIndex` accepts optional `userRoot`**: When provided, scans `${userRoot}/{type}/` subdirectories using the same dual `glob | subdirectory` strategy as canonical, tags results `source: "user"`, parses optional `adapters` array. ID-collision detection extended to flag canonical↔user collisions distinctly with new `kind: "user-shadow-canonical"`. New helper `resolveUserContentRoot(rootDir)`. `extractContentReferences` regex documented as deliberately unchanged for canonical bodies (broadening would create false positives across canonical corpus); user-side cross-references handled via a separate scan path.

- **`src/types.ts` extended**: `CanonicalFile` and `CanonicalMetadata` gain optional `source?: "canonical" | "user"` and `adapters?: string[]`. `HatchManifest` gains optional `userContent?: { count: number; lastModified: string; types: Record<string, number> }`. Older versions tolerate absence (forward-compatible); newer versions tolerate older manifests without the field (backward-compatible). `src/manifest/hatchJson.ts` validator accepts the new optional field.

- **`governance/CONSTITUTION.md` lean threshold 200 → 225 lines**: Calibration note `+25 per binding pillar added` reflects the addition of P7. Compression applied (Pillar Compliance Test condensed from 5 to 4 lines, Anti-Bloat Principles list one-liners, §3 matrix legend collapsed) keeps the file at ~198 lines (under threshold). §2 heading "6 Binding Pillars" → "7 Binding Pillars". Pillar Compliance Test extended with a 4th item ("does it degrade end-user runtime efficiency?"). §3 traceability matrix gains a P7 row. §4 Layer 2 Concept Count 5 → 6. `.claude/rules/governance-lean-thresholds.md` synced (CONSTITUTION row updated, 4 efficiency invariant rows appended). `CLAUDE.md` pillar table extended with a P7 row.

- **`governance/AUDIT.md` directive count 13 → 14 and gates 15 → 17**: Behavioral Charter gains directive 14 (Speed & Token Efficiency Awareness). Universal Audit Checklist extended with one efficiency-invariants bullet (`for end-user runtime artifacts (not audit prompts/commands): efficiency invariants per D06 — static-first ordering, parallel-tool default, triage-first if orchestrator`). Layer 2 trait-count narrative updated. AUDIT-EXECUTE.md regression-gates table appended with gates 16 and 17 plus the audit-cycle exempt-list note.

- **`governance/audit/domains/D06-context-engineering.md` 4 → 6 sub-agents**: 6.5 End-User Runtime Efficiency (7 scenario items: static-first ordering, parallel-tool-by-default, triage-first orchestrator, plan/act split, structured outputs, lazy loading, conditional sub-agent invocation), 6.6 Cross-Adapter Efficiency Consistency (4 items covering all 15 platform adapters), Universal D06 checklist extended (anti-cache patterns ban, model-agnostic claim), Domain Boundary refined vs D05/D07/D15. Frontmatter sub-agent count and `Last updated` synced. File now 71 lines (under SA × 15 = 90 calibration for SA > 5). Correspondingly, `governance/AUDIT.md` audit baseline incremented 109 → 111 (commit `762b27e`).

- **`commands/hatch3r-quick-change.md` Step 2 heading**: `Scale Assessment` → `Tier Assessment` so the new top-level `## Triage` block above flows with the existing per-step tier logic.

### Tests

- 27 new tests in `src/__tests__/content/userContent.test.ts` covering all strict-gate rejection paths (prefix, kebab-case, description length, ID collision, deny patterns, orchestrator contract, hook event enum, file size cap, path traversal), all 5 happy-path artifact types (agent, skill subdir, rule + paired `.mdc`, command, hook), `hatch.json` counter updates, all 4 gentle-gate warnings, and a relaxed concurrency invariant (Promise.all of two same-name saves produces exactly one final file on disk).
- 8 new tests in `src/__tests__/content/buildContentIndex.user.test.ts` covering canonical-only behaviour preserved, user-empty handled, user-canonical merge with correct `source` tagging, `user-shadow-canonical` collision detection, `adapters[]` frontmatter parsed correctly, malformed `adapters` graceful fallback.
- 10 new tests in `src/__tests__/cli/commands/validate.user.test.ts` covering valid user content passes, prefix-lint exemption, deny pattern blocks, description <60 errors, ID-collision shadowing, gentle anti-slop produces warnings (not errors), missing pillar produces warning, invalid hook event, missing `agentPipeline`, and multiple errors compose correctly.
- 6 new tests in `src/__tests__/adapters/userContentParity.test.ts` covering full-parity default, `adapters: [claude]` claude-only emission, `adapters: [claude, cursor]` two-adapter scope, canonical content unaffected, managed-block markers preserved, prefix-less filename does not collide with canonical adapter outputs. Tests 4 representative adapters (claude, cursor, copilot, aider) since the filter sits at `BaseAdapter` and applies uniformly.
- 3 new tests in `src/__tests__/cli/commands/init.userPrompt.test.ts` covering `--yes` skips the prompt, interactive `false` prints the tip, interactive `true` prints the run-/hatch3r-create pointer.
- 3 new tests in `src/__tests__/cli/commands/clean.user.test.ts` covering dry-run lists `.agents/user/` as kept, `executeClean` does not delete user content, post-clean reinit preserves user content.
- 5 new tests in `src/__tests__/e2e/createFlow.test.ts` covering happy-path init→save→sync→adapter outputs, update preserves user files (SHA-256 byte-identical), validate succeeds with mixed canonical+user content, collision negative path, deny-pattern negative path.
- 9 new fixtures under `src/__tests__/fixtures/user-content/` exercising both strict-gate rejection paths and happy-path artifact shapes.
- 17 existing `src/__tests__/cli/init.test.ts` interactive tests updated to append `{ create: false }` to their inquirer mock answer queues for the new optional prompt.
- 1 existing `src/__tests__/content/compound.test.ts` "tag validity" failure resolved by correcting `customization` → `customize` (the canonical tag) on `commands/hatch3r-create.md` and `agents/hatch3r-creator.md`.
- 1 collateral fix in `src/__tests__/cli/agentsContent.test.ts`: now that `hatch3r-creator` carries the `customize` tag, the task-router model resolves the customize primary to an agent rather than a command — assertion updated.
- Existing test fixtures in `src/__tests__/cli/agentsContent.test.ts` and `src/__tests__/content/index.test.ts` updated to default `source: "canonical"` on `CatalogItem` literals after the field became required at the type level.
- Test count 2,613 → 2,676 (+63). Coverage on `src/content/`: 90.2 / 80.3 / 97.6 / 91.8 (target 85/75/85/85). Coverage on `src/content/userContent.ts`: 90.3 / 75.2 / 100 / 91.4. Coverage on `src/content/index.ts`: 91.0 / 83.1 / 98.3 / 93.3.
- 3 new tests in `src/__tests__/pipeline/observability.test.ts` for `recordEfficiencyEvent`: disabled-by-default no-op, enabled-appends-JSONL, unwritable-path-does-not-throw (Silent Failure Contract).
- 6 new tests in `scripts/__tests__/validate-efficiency-invariants.test.ts` covering the three flag modes plus the audit-cycle exempt list — Mode A (`--triage-first`) error and pass, Mode B (`--static-first`) error and pass, Mode C (`--parallel-tool`) warning non-blocking, audit-exempt suppression. Test file lives under `scripts/__tests__/` to stay outside the `src/` rootDir while remaining picked up by vitest's default discovery.
- 6 new tests in `src/__tests__/cli/validate.test.ts` under a `P7 efficiency frontmatter fields` describe block for the 5 new fields: all legal values pass, `efficiency_tier: deep` no error, `efficiency_tier: invalid` warning, `cache_friendly` type mismatch warning, `triage_tiers` out-of-range warning, backward-compat regression check.
- Test count 2,676 → 2,707 (+31).



### Fixed

- **Companion content no longer clutters the tool command/agent picker**: `hatch3r init` / `hatch3r sync` previously emitted every `.md` file under `commands/` and `agents/` as a user-invocable entry in each tool's picker — including ~40 companion files (5 `type: shared-context`, 20 `agents/modes/*` with `type: mode`, 4 `agents/shared/*` with `type: reference`, 11 sub-workflow files under `commands/board/pickup-*` and `commands/revision/*`) that exist only to be referenced by parent commands/agents, not invoked directly. The recursive `readGlobMd()` (`src/adapters/canonical.ts:460`) still reads the full tree so cross-references continue to resolve, but a new `filterUserFacing()` helper gates per-adapter emission on two signals: the file's path relative to its content-type baseDir must have no subdirectory separator, **and** its frontmatter `type:` must match the reader bucket (`command` / `agent`) or be absent. Applied to `processCommandsRaw` and a new `readUserFacingCanonicalFiles` wrapper in `src/adapters/base.ts`, plus direct call sites in `gemini.ts` and each of the 10 agent-emitting adapters (claude, cursor, copilot, opencode, codex, amazonq, goose, windsurf, cline, agentsmd). The `.agents/` canonical mirror in `src/content/index.ts` is unchanged, so parent commands that read shared context by name keep working.
- **`parseFrontmatter` now surfaces the author-declared type separately from the parser default**: `parseFrontmatter()` returns an additional `rawType?: string` that is `undefined` when `type:` is absent from frontmatter, distinct from `metadata.type` which falls back to `"rule"`. `CanonicalFile.frontmatterType` is populated from `rawType`, letting the adapter filter distinguish "user chose `type: command`" from "parser defaulted to rule" — a distinction the previous shape could not express.

### Tests

- 7 new unit tests for `filterUserFacing` in `src/__tests__/adapters/canonical.test.ts` covering top-level pass, subdirectory drop, frontmatter-type whitelist, both-signals-AND for agents, legacy back-compat for files without frontmatter `type:`, safe default when `sourcePath` lies outside `baseDir`, and trailing-slash tolerance on `baseDir`.
- 2 new adapter-level filter tests (claude, gemini) asserting that subdirectory fixtures (`pickup-fake`, `fake-mode`, `fake-reference`) and top-level `type: shared-context` fixture (`hatch3r-fake-shared`) are absent from `.claude/commands/`, `.claude/agents/`, and `.gemini/commands/` output while the primary `test-agent` / `test-command` fixtures survive.
- 4 new fixture files under `src/__tests__/fixtures/agents/` (`agents/modes/fake-mode.md`, `agents/shared/fake-reference.md`, `commands/board/pickup-fake.md`, `commands/hatch3r-fake-shared.md`) exercise both filter signals.
- 2 existing `readCanonicalFiles` tests adjusted to reflect the now-intentionally-larger fixture set (the raw reader sees all files; filtering happens at the emission layer). Test count 2,604 → 2,613.

### Removed

- **`agents-md` is no longer a selectable tool.** AGENTS.md is emitted unconditionally by `init`/`update` via `generateRootAgentsMd()` for every install — when both the standalone `agents-md` adapter and the `amp` adapter targeted the same root path, multi-adapter installs produced nested managed-block markers and grew AGENTS.md to thousands of lines on every sync. The standalone `AgentsMdAdapter` (`src/adapters/agentsmd.ts`) is deleted; the `AmpAdapter` no longer emits `AGENTS.md` (it retains skill emission to `.agents/skills/` and MCP config to `.amp/settings.json`); `"agents-md"` is removed from `TOOLS`, `ADAPTER_CAPABILITIES`, `TOOL_DISPLAY_NAMES`, `TOOL_COMMAND_SYNTAX`, `TOOL_PATH_PREFIXES`, `CONTEXT_BUDGET_TOKENS`, and `ADAPTER_WORKTREE_PATTERNS`. Existing `hatch.json` files with `"agents-md"` in `tools[]` are migrated transparently — `migrateManifest()` in `src/manifest/hatchJson.ts` strips the legacy token on first read.

### Added (1.7.0 stability fixes)

- **`HatchManifest.customization`**: New optional, versioned, additive payload (`schemaVersion: 1` plus typed per-content slots `agents`/`skills`/`rules`/`commands` and a free-form `integrations: Record<string, unknown>` for scalar config like GitHub project IDs and board overrides). Defined in `src/types.ts::CustomizationManifest`, persisted by `createManifest`, validated by `validateManifest`, and round-tripped through `clean` -> reinit via `captureConfig` in `src/cli/commands/clean.ts` so integration config survives the destroy/recreate cycle when the project-side `.hatch3r/*.customize.yaml` files are absent.
- **`safeWriteFile({ skipIfUnchanged })`** (default `true`): When set, `src/merge/safeWrite.ts` reads the existing file, compares the merged-expected bytes, and short-circuits with `{ action: "unchanged" }` instead of calling `atomicWriteFile`. This eliminates the cosmetic mtime bump on no-op syncs and is the primary fix for the "status flags drift, sync no-op, status now clean" loop. `MergeResult["action"]` widened to include `"unchanged"`.
- **`generateIntegrityManifest({ previousManifest })`**: When the new `files` map and adapter sets are byte-equal to the previous manifest, the previous manifest object is returned unchanged so the `generated` ISO timestamp stays stable across cosmetic syncs. `src/cli/commands/sync.ts` reads the previous manifest before regenerating and only writes when the returned object identity differs.
- **`src/manifest/mcpFilter.ts`**: New shared module (`filterMcpJsonOnDisk`) used by both `init` and `update` to filter `.agents/mcp/mcp.json` to the `manifest.mcp.servers` selection. Replaces the inline filter at `init.ts:249-271` and is also called from `update.ts::runRegenerate` after `copyHatch3rFiles` so update no longer re-introduces de-selected MCP servers.

### Changed (1.7.0 stability fixes)

- **`AGENTS.md` is now emitted exclusively by `init`/`update`** (via `generateRootAgentsMd()`), not by adapters. `update.ts::runRegenerate` now calls `addManagedFile(manifest, "AGENTS.md")` (previously missing — init registered the path, update didn't), so `clean` consistently sees the root file in its inventory regardless of how it was last written.
- **`insertManagedBlock` and `wrapInManagedBlock` trim their content** before composing the managed block (`src/merge/managedBlocks.ts`). `extractManagedBlock` already trimmed; without insert-side normalization, asymmetric whitespace round-trips produced spurious `status` drift on byte-equal canonical content. This is the deep-path companion to the `skipIfUnchanged` fast-path fix.
- **Validate noise reduced ~58%** (97 -> 41 warnings on a fresh install). Optional-directory and P7 efficiency-frontmatter checks moved behind `--verbose` via a new `verboseWarn` helper. Anti-slop user-content hits are now deduped per file into one combined emission (the wordlist at `src/cli/commands/validate.ts:663-676` is byte-untouched). Cost-tracking range checks (negative budgets, out-of-range thresholds) and missing-agent references in hook config lifted from warning to error. The managed-file prefix check now exempts files under `*/policy/`, mcp.json siblings, and any file inside a hatch3r-prefixed parent directory (covers `*/skills/hatch3r-*/SKILL.md`). Skill-directory walk no longer treats `agents/modes/`, `agents/shared/`, `commands/board/`, `commands/revision/` as missing-SKILL.md candidates. Github-agents now use `name:` (not `id:`) as their identifier per the existing convention.
- **All canonical agents (17) and github-agents (4) now declare `type:`** in frontmatter (`type: agent` or `type: github-agent`). The frontmatter convention in `CLAUDE.md` requires `id, type, description, tags`; these files previously omitted `type:`, surfacing 21 false-positive warnings on every install.
- **`commands/hatch3r-agent-customize.md`** documentation example no longer contains literal `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` markers (they triggered the merge logic's duplicate-marker guard, sending sync into an auto-repair loop on every run). The example now uses `[managed-block-start]` / `[managed-block-end]` placeholders with the actual marker syntax referenced in surrounding prose using a backslash-escaped colon.

### Fixed (1.7.0 stability fixes)

- **`hatch3r status` no longer flags spurious drift on managed-block whitespace asymmetry.** Combined effect of `insertManagedBlock` trim + `safeWriteFile` `skipIfUnchanged` + `generateIntegrityManifest` previous-manifest preservation. Verified end-to-end: `init` -> `sync` -> `status` -> `sync` -> `status` is fully idempotent (108/108 in sync, 0 drifted on a multi-adapter `claude,amp,codex` install; AGENTS.md is 107 lines with exactly 1 managed block, down from the reported 8000-line growth).
- **`hatch3r update` respects MCP server selection.** `mcp.json` is still in `update.ts::ALWAYS_COPY_FILES` so the file is copied during regenerate, but `runRegenerate` now calls `filterMcpJsonOnDisk` on the destination immediately after copy with `manifest.mcp.servers` as the selected set — matching `init`'s behavior.
- **`hatch3r clean` removes orphaned `.bak` files.** `src/clean/index.ts::inventoryArtifacts` now sweeps `*.bak` siblings of every adapter file in the inventory after the existing fileExists filter loop. `.bak` files are auto-repair artifacts produced by `safeWrite.ts` when a managed block is corrupted — they previously persisted across clean runs because they were never adapter-emitted and so missed the `TOOL_PATH_PREFIXES` walk.
- **Customization (GitHub project IDs, board overrides) now survives `clean` -> reinit.** `src/cli/commands/clean.ts::CapturedConfig` and `captureConfig()` capture `manifest.customization`; the reinit `RunInitOptions` carries it through to `runInit` and on to `createManifest`. `update.ts::runRegenerate` reads the manifest, mutates it in place, and writes it back — the validator change in `validateManifest` (above) is sufficient to make `customization` round-trip without explicit code in update.

### Tests (1.7.0 stability fixes)

- 4 stale tests in `src/__tests__/adapters/amp.test.ts` rewritten to assert amp does NOT emit root AGENTS.md (3 rewrites + 1 deletion of the now-irrelevant model-annotation assertion). 1 deleted test (model annotation in amp's bridge) — the model annotation moved to `generateRootAgentsMd` and is tested at the canonical-content level.
- 4 P7 efficiency-frontmatter tests in `src/__tests__/cli/validate.test.ts` updated to call `validateCommand({ verbose: true })` so the demoted warnings still fire (matches the new gate semantics — fields are warnings only when `--verbose`). The "backward compat: an artifact with no new fields still passes" test exercises the inverse default-mode path unchanged.
- `ADAPTER_CAPABILITIES["amp"]` rows updated to `agents: false, rules: false` (amp no longer ingests agents/rules into a bridge), reconciling the declarative matrix with the actual `doGenerate()` output. Capability-matrix drift test passes.
- 2 deleted source files: `src/adapters/agentsmd.ts`, `src/__tests__/adapters/agentsmd.test.ts`. Test count 2,690 -> 2,690 (4 amp test rewrites + 1 deletion offset by no new tests in this commit; the test set is already covering the new behavior via the rewritten assertions).

## [1.6.1] - 2026-04-22

### Fixed

- **`full` preset now actually installs everything**: the default `hatch3r init` profile silently dropped the 6 `hatch3r-board-*` commands (pickup, groom, refresh, init, fill, shared) and `hatch3r-onboard` because the solo team-size filter ran unconditionally over the resolved selection, even when the user's chosen preset explicitly promised "Everything including board management". The filter now scopes to non-`full` presets — users who opt into `full` receive the full catalog regardless of `teamSize`. Project-type and language filters continue to apply (they are technical compatibility filters, not preferences). Fix: `src/content/index.ts::resolveSelection` guard at line 436.
- **Worktree support now explicitly configurable in `init`**: previously `hatch3r init` auto-enabled worktree file isolation without prompting whenever a worktree-capable tool (currently `claude`) was selected, while `hatch3r config` did prompt — an asymmetric UX that hid a side-effect from interactive users. Init now mirrors the config prompt after tools selection and adds `--worktree` / `--no-worktree` CLI flags for headless callers. `--yes` without the flag preserves today's auto-enable behavior for CI compatibility. Fix: `src/cli/commands/init.ts` interactive and workspace branches; `src/cli/program.ts` flag registration; `src/manifest/hatchJson.ts::createManifest` honors explicit `worktreeEnabled` option. `src/cli/commands/clean.ts` reinit path threaded through the new option to keep `RunInitOptions` consistent.

### Tests

- 3 existing `resolveSelection` tests updated to reflect the new preset-aware semantic; 5 new tests cover `full + solo` behavior (keeps team/board items, still applies projectType filter, `standard + solo` unchanged as scope check, `skipContextFilters` path unchanged).
- 5 new `init.test.ts` cases cover the worktree prompt paths (interactive accept, interactive decline, `--no-worktree` override, `--worktree` force-enable, no prompt when no worktree-capable tool). 13 existing interactive init tests updated to queue the new prompt where applicable. Test count 2,594 → 2,604.

## [1.6.0] - 2026-04-21

### Added

- **Rule precedence system**: Optional `precedence: critical|high|normal|low` field in canonical frontmatter (default `normal`) with deterministic ordering across all adapters — `sortByPrecedence()` helper in `src/adapters/canonical.ts`, per-file adapters (cursor, windsurf, copilot, claude, cline) emit `NN-hatch3r-*` numeric filename prefixes, inline adapters (gemini, aider, amp, goose, zed, antigravity, amazonq, codex) sort before concatenation, OpenCode emits an explicit precedence-ordered `instructions[]` list. Parity-validated via `scripts/validate-rule-parity.ts`
- **Description quality lint**: `src/cli/commands/validate.ts` fails validation when a description is under 60 characters or collides within its tag cluster (cosine similarity ≥ 0.55). 27 offending descriptions rewritten across rules, customize family, planning, and maintenance commands
- **Mode tag backfill**: 16 subject modes under `agents/modes/` dual-tagged `[core, ...]` to preserve minimal preset membership; 4 meta-modes (current-state, library-docs, prior-art, similar-implementation) remain untagged by design
- **Task-type routing table**: `buildTaskRouterModel()` in `src/cli/shared/agentsContent.ts` emits 11 workflow+domain routing rows (agent/command/skill fallback with `/slash` and `_(skill)_` kind hints) inherited by the Claude, Cursor, Windsurf, and Copilot adapters
- **Orphan cleanup on sync**: `src/merge/orphanCleanup.ts` unlinks files previously emitted but no longer produced, tracked via manifest `managedFilesByAdapter`. Four safety refusals — user-wrapped content, paths outside adapter roots, non-`hatch3r-` basenames, and no-history first-run no-op
- **Board sync production-readiness review**: `board-init` adds programmatic workflow verification via GitHub GraphQL with a `--resume` flag and persists `board.workflows.{itemClosedEnabled,pullRequestMergedEnabled}` in `hatch.json`; `board-fill` Step 7.9 adds a reviewer/fixer loop that treats issue bodies as specs (6-criteria checklist, 4-iteration cap, oscillation detection); `pickup-post-impl` Step 9c adds terminal-state verification (label flip + V2 board state) after PR merge; `shared-github` mandates per-sync verification plus an option-mapping race rule and halts when both `gh` and MCP are unavailable; `board-shared` Board Sync Enforcement rules 8–10 add retry-then-halt with rollback, null-option abort, and a 20% batch retry-budget ceiling
- **Inventory and drift-gate scripts**: `scripts/inventory.ts` (tsx) derives `governance/inventory.json` from the filesystem and ships 11 count probes plus 2 `VERSION_PROBES` against `package.json` as single source of truth; `scripts/validate-rule-parity.ts` diffs body content across every `rules/hatch3r-*.md` ↔ `.mdc` pair. Wired as CI drift gates and surfaced via `npm run inventory`, `npm run inventory:check-docs`, `npm run validate:rule-parity`
- **Marketplace submission package**: `docs/marketplace-submission.md` and `.claude-plugin/plugin.json` prepared for submission to `anthropics/claude-plugins-official`; Claude adapter emits `.claude/hooks/hatch3r-hooks.json` alongside `settings.json`
- **Severity mapping template**: `governance/audit/templates/severity-mapping.md` (51 lines) with a 5-column canonical map across reviewer verdicts, reviewer levels, security-auditor severity, check tags, and audit severity, cross-referenced from reviewer, fixer, security-auditor, `checks/code-quality.md`, and both audit prompts
- **Resilience wiring across CLI**: `src/pipeline/retryWithBackoff.ts` (122 lines) plus circuitBreaker, adapterTimeout, phaseTimeout, pipelineTimeout, and phaseOutputSchema wired into the sync, update, and verify commands. `complianceVerification.ts` now verifies import-presence via 6 `resilience-*` ASI-RESILIENCE checks
- **EVOLVE proposal batch**: 15 EVOLVE proposals from the 2026-04-19 self-check run applied — aggressive one-sub-agent-per-finding fan-out, Scientific Rigor Contract elevated to core audit methodology, plus Cycle 7 CL-3 P1–P10 audit-self-evolution items (D16 18-file synthesis methodology, D18 live distribution baseline, `feature_status` taxonomy, D11 Medium severity cap at 8, per-adapter currency citations, home-domain redundancy rejection, Wave 4 systemic-patterns wave, domain orchestrator bundling, Inconclusive Areas MUST for <3 High domains, pre-audit inventory validation gate)

### Changed

- **Audit methodology rewrite**: Web research and the Scientific Rigor Contract (falsifiability, ≥2 independent sources with trust tier, confidence with basis, ≥3-step causal chain, bias check, adversarial peer review) are now required for every audit sub-agent in `governance/AUDIT.md` and `governance/AUDIT-EXECUTE.md` rather than optional rigor add-ons
- **Audit execution fan-out**: One sub-agent per finding replaces the prior severity-wave batching; same-file findings group into file-lock sub-agents, same-wave dependency chains serialize, and sub-agents write to `.audit-workspace/wave-{N}/{finding_id}.results.md` per the new Context Management Protocol with the orchestrator reading only `SUMMARY.md`
- **CLI entry point slimmed**: `src/cli/index.ts` refactored 209 → 67 lines, delegating to `src/cli/program.ts` (150 → 155 lines). `createProgram()` is the canonical builder; `index.ts` is a thin orchestrator for signal handling, error banner, and exit codes. All 11 commands plus `verify --fix` preserved (net −137 lines of duplication)
- **Update command split**: `runUpdate` now decomposes into `runPackageUpdate` + `runRegenerate`; `config` and `verify --fix` call `runRegenerate` only, avoiding the 30-second npm fetch penalty
- **HatchError migration**: 18 `throw new Error` sites across 11 production files converted to `throw new HatchError(message, exitCode, errorCode)` with codes from the existing `HatchErrorCode` union. A custom `hatch-error/use-hatch-error` ESLint plugin (severity warn) flags future regressions in `src/` outside tests
- **Silent-failure contract**: New `silent-failure/no-silent-catch` ESLint flat-config plugin surfaces empty or logging-only `catch` blocks (severity warn, does not break builds). Contract codified as a subsection under `governance/CONSTITUTION.md` §2 P5
- **Canonical read result shape**: `src/adapters/canonical.ts` now returns `CanonicalReadResult { file, content?, frontmatter?, body?, error? }` with an `error.code` enum (NOT_FOUND, PERMISSION_DENIED, UTF8_DECODE_ERROR, YAML_PARSE_ERROR, UNKNOWN) and an optional `warnings?: string[]` channel surfaced through 14 adapter files. `readCanonicalFiles()` keeps its backward-compatible 2-arg signature; `readCanonicalFilesDetailed` exported for strict consumers
- **Init write-order hardening**: `writeManifest` now deferred in `init.ts` until after adapter generation succeeds, preventing partial-state manifests when every adapter fails. Equivalent integrity-manifest contingency added to `update.ts:304` and `workspace/sync.ts:340`
- **Sync/update/add preflight integrity**: `verifyIntegrity()` runs before sync, update, and add with a `--force` escape hatch (`HatchError INTEGRITY_ERROR` on drift)
- **Language-aware content selection**: `projectLanguages` now threads through 5 `resolveSelection()` sites in `init.ts` plus 2 `estimatePresetItemCount` sites. `resolveLanguageTags` + `filterByLanguages` extracted into `src/content/tags.ts`; 3 language-specific rules (component-conventions, i18n, theming) tagged `lang:typescript` (covers JS via the TypeScript alias)
- **Confusables coverage widened**: `HOMOGLYPH_MAP` in `customization.ts` extended with 30 Coptic + 16 Deseret + 10 Osage confusables per UAX #39; `normalizeHomoglyphs` switched from NFKC to NFKD with `/[̀-ͯ]/g` combining-mark strip so Latin Extended Additional decomposes (for example ḅ → b). Supplementary-plane scripts handled via `/gu` regex flag
- **MCP version-pin check**: `checkVersionPin` helper in `mcp-utils.ts` wired into `validateMcpEntry` flags unpinned `npx @scope/pkg` patterns and `@latest` tags as supply-chain risk per Palo Alto Networks' 2025 npm supply-chain attack report and OWASP ASI 2026
- **Review confidence gate**: `evaluateReviewGate` in `src/pipeline/reviewLoop.ts` with an optional `confidence` field on `ReviewResult` routes low-confidence clean verdicts into `second_pass` or escalation rather than silent auto-pass
- **Amazon Q hook event names**: Fixed to the AWS canonical schema — `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop` — per `aws.github.io/amazon-q-developer-cli/agent-format.html`
- **Antigravity skills path**: Corrected `.antigravity/skills/` → `.agent/skills/` per Google's documentation
- **Kiro adapter**: Picked up Kiro Powers coverage (cycle 8 D9 Medium) per live platform documentation
- **Zed adapter**: Picked up `spawn_agent` coverage (cycle 8 D9 Medium) per live platform documentation
- **Parallel safety guidance**: `rules/hatch3r-agent-orchestration.md` (+ `.mdc`) documents 4 parallel-safe patterns, 5 not-parallel-safe patterns, and a three-conditions-to-parallelize gate

### Fixed

- **Cursor Bugbot PR #54 findings (8 resolved)**: Pipeline module count drift in `docs/marketplace-submission.md` (15 → 17, now matches `governance/inventory.json`); `board-fill` Step 7.8 now routes to Step 7.5 before Step 8 (dashboard refresh no longer skipped); Step 7.9b/c gain Azure DevOps and GitLab variants alongside the `gh` CLI; `board-fill` frontmatter flipped to `orchestrator: true` with `agentPipeline: [hatch3r-reviewer, hatch3r-fixer]` reflecting Task-tool delegation; version bumped across `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, and the embedded copy in `docs/marketplace-submission.md` with `VERSION_PROBES` guarding future drift; `.claude/settings.json` SessionStart hook restores `2>/dev/null` and the "Registry not found" graceful fallback; `.claude-plugin/plugin.json` removes the stale `hooks` key that pointed at a non-existent `hooks/hooks.json`; SessionStart cycle filter generalized to `execution_status=="pending"` (was hardcoded `cycle==7`, misreported on the 315-entry registry)
- **`writeManifest` schema revalidation**: New `validateManifest` guard in `src/manifest/hatchJson.ts` prevents in-memory invalid manifests from persisting; throws `HatchError(CONFIG_ERROR)` on schema failure
- **Verify command flag registration**: `--fix` and `--max-fix-attempts` now registered on the `verify` command in `src/cli/index.ts` (previously present in `program.ts` only)

### Tests

- Test suite grew from 1,734 at v1.5.1 to 2,594 passing across 100 files at release (+860, +50%)
- 13 new test files under `src/__tests__/`: `adapters/capability-matrix`, `cli/agentsContent`, `cli/errorClassification`, `helpers/configHelpers`, `importers/cursor`, `integrity/provenance`, `merge/orphanCleanup`, `merge/safeWrite.fileLock`, `pipeline/adapterToolTranslator`, `pipeline/injectionPatternsSync`, `pipeline/mcpDescriptionScan`, `pipeline/retryWithBackoff`, `types`
- 51 existing test files extended — heaviest deltas in `cli/config.test.ts` (rewritten against shared helpers), `cli/init.test.ts` (+1,193 lines across validation flags, partial adapter failure, re-init cleanup, worktree generation, language detection, and interactive flows), `cli/sync.test.ts` (+366), `adapters/canonical.test.ts` (+510), and `adapters/customization.test.ts` (+356)
- Aggregate test-directory diff: 64 files changed, 11,082 insertions, 1,244 deletions

### Documentation

- **PRD evolution through the cycle**: `governance/hatch3r-prd.md` updated in three increments — Cycle 7 CL-1, Cycle 7.5 Wave 2 Batch 2 CL-1 (v4.3), and Cycle 8 partial CL-1 (v4.5)
- **Audit report**: `governance/AUDIT-REPORT.md` extended with post-execution reports for Cycles 7, 7.5 Wave 2 Batch 2, and Cycle 8 partial. Cycle 8 verdict upgraded from PARTIAL-SHIP to SHIP after Wave 3 fix landed 3 rolled-back findings
- **Finding registry**: `governance/audit/finding-registry.json` extended with Cycle 7, 7.5, and 8 finding resolution tracking and per-wave execution telemetry
- **Marketplace submission manifest**: `docs/marketplace-submission.md` updated to 1.6.0 with the full `VERSION_PROBES` file map
- **`release-prep` skill** expanded with every version-file location so future bumps stay in sync

### Dependencies

- Add `proper-lockfile ^4.1.2` (production) — powers safe-write file locking
- Add `@types/proper-lockfile ^4.1.4` (dev)
- Add `tsx ^4.21.0` (dev) — runs `scripts/inventory.ts` and `scripts/validate-rule-parity.ts` for the new CI drift gates

## [1.5.1] - 2026-04-19

### Added

- **EVOLVE governance prompt**: `governance/EVOLVE.md` (375 lines) — a proposal-only constitutional self-check that assesses the 7-file governance corpus plus domain and template files against nine measurable dimensions. Routes each proposal to one of three buckets (Vision / Audit system / Constitution and prompt mechanics), enforces a Model-Independence Contract with a forbidden-pattern table, a Web Research Mandate requiring at least two independent sources per topic with trust-tier and recency constraints, a six-test Scientific Rigor Contract (falsifiability, citation + triangulation, confidence expression, root-cause orientation, bias check, adversarial peer-review), four hard-stop ASK gates, 16 guardrails, and a 15-proposal cap per run ranked by severity × pillar impact × North-Star multiplier
- **Shared custom content choices helper**: `src/cli/shared/customContentChoices.ts` extracts `CONTENT_TAG_LABELS` and `buildTagGroupedCustomContentChoices()` so `config` and `init` (including workspace flow) stay consistent when tags change

### Changed

- **Config content flow**: Replaced "Manage content items?" confirm prompt with direct preset selection (minimal/standard/full/custom) and tag-grouped custom picker, matching the init experience
- **Default content profile**: Changed default from "Standard" to "Full (recommended)" for both interactive and headless (`--yes`) init
- **Default tool fallback**: Changed fallback tool from Cursor to Claude Code when auto-detection finds no existing tools
- **Revision command decomposed**: Split monolithic `commands/hatch3r-revision.md` (517 lines) into a 5-file structure matching board-pickup quality patterns — `revision-delegation.md` (complexity-aware fix delegation with blast-radius grouping), `revision-quality.md` (two-stage quality pipeline with 3 conditional specialists), `revision-modes.md` (auto-advance mode, safety guardrails, platform-aware error handling), `revision-board-integration.md` (run cache, PR summary updates, dashboard refresh). Core file retains Steps 1-5 and 8-10 inline; platform abstraction added to Step 1b (GitHub, GitLab, Azure DevOps)
- **Custom content helpers module-private**: Restricted exposure of CLI helpers to reduce surface area

### Fixed

- **Config preset resolution ignored context filters**: `resolveSelection` applied `projectType`/`teamSize` filtering which silently dropped board/team-only items (e.g. `hatch3r-board-fill`, `hatch3r-onboard`) for solo users. Correct for `init`, wrong for `config` where the user is explicitly choosing a preset. Added `skipContextFilters` option and use it from `config`
- **Preset item count estimates were misleadingly low for solo users**: `estimatePresetItemCount` calls `resolveSelection` internally; now passes `skipContextFilters` so hints in the preset selector show the actual count (e.g. "Full (~109 items)" instead of "~95")
- **Manifest not persisted when only content preset metadata changed**: `isDiffEmpty` ignored `manifest.content` preset/projectType/teamSize, so switching to an equivalent item set (e.g. `full` → `custom`) skipped `writeManifest` and reverted the in-memory preset. Now tracks metadata changes and bypasses the early return when they differ

## [1.5.0] - 2026-04-13

### Added

- **Pipeline infrastructure**: 14 new modules in `src/pipeline/` — adapter timeout, agent identity verification, agent tool allowlist, circuit breaker, compliance verification, diff hashing, failure logging, observability spans, phase output schema validation, phase timeout, pipeline context, pipeline timeout, prompt guard, and review loop
- **Secret detection**: `src/env/secretDetection.ts` scans MCP environment variable values for accidentally committed API keys, tokens, passwords, and private keys
- **Verification gates**: `src/detect/verificationGates.ts` abstracts test/lint/typecheck commands per detected language (not just npm)
- **Learnings validation**: `src/content/learningsValidation.ts` enforces file size limits (64KB per file, 512KB total), safe filenames, and deny-pattern scanning on user-provided learnings
- **Worktree cleanup command**: `src/cli/commands/worktreeCleanup.ts` for removing stale worktree directories
- **Accessibility check**: `checks/accessibility.md` — WCAG compliance, semantic HTML, keyboard navigation, screen reader support, and inclusive design review criteria
- **Trust framework**: `governance/trust-delegation-chain.md` and `governance/trust-framework-compliance.md` documenting trust flow from user through orchestrator to agents and tools
- **Observability rule modules**: Split `hatch3r-observability` into three focused rules — `hatch3r-observability-logging`, `hatch3r-observability-metrics`, and `hatch3r-observability-tracing`
- **Competitive analysis**: `governance/COMPETITIVE-ANALYSIS.md` (772 lines) benchmarking hatch3r against the ecosystem
- **PRD refresh**: `governance/hatch3r-prd.md` fully rewritten (1,511 lines) reflecting current architecture and roadmap

### Changed

- **Goose adapter rewrite**: Replaced speculative recipe/ACP schema with actual Goose platform schema — `instructions` array, `stdio`/`sse` extension types, `env_keys` for environment variables
- **Verify command**: Added `--fix` flag for self-healing loop (verify → fix → re-verify, max 5 cycles)
- **Researcher agent**: Major restructuring (~960 lines changed) with improved analysis mode organization
- **Observability rule**: Comprehensive rewrite (~457 lines changed) with structured logging, metrics, and distributed tracing guidance
- **Agent orchestration rules**: Expanded with pipeline context propagation and phase boundary enforcement
- **16 agent spec files**: Updated with finding-driven improvements — structured reasoning sections, verification gate references, and cross-agent protocol alignment
- **CI hardening**: `persist-credentials: false` on all checkout steps, `timeout-minutes` on all jobs, supply chain security job (lockfile lint + tiered npm audit), DCO sign-off check
- **Adapter improvements**: Bug fixes and schema corrections across adapters
- **Validate command**: Extended with learnings validation and verification gate integration
- **Update command**: Enhanced reconciliation with verification output
- **46 rule files updated**: Content quality and tag alignment across all standard rules
- **45 command docs updated**: Content tag alignment and accuracy improvements
- **26 skill docs updated**: Content tag alignment

### Fixed

- **Goose adapter schema**: Replaced fabricated `recipes`, `acp`, and `name`/`description` profile fields with actual Goose platform schema
- **Adapter customization**: Duplicate `readCanonicalFiles` calls in Goose adapter eliminated
- **Content index**: Improved error handling and edge case coverage
- **TypeScript 6 compatibility**: Added explicit `@types/node` references for TypeScript 6 module resolution
- **DCO sign-off check**: Skip merge commits in CI sign-off verification to avoid false failures

### Security

- **Audit execution (Cycle 4)**: 233/249 agent-actionable findings resolved across 4 severity waves (Critical, High, Medium, Low) with zero rollbacks — framework score improved from 68/100 to 85/100
- **Secret pattern detection**: New `secretDetection` module prevents accidental credential exposure in MCP configuration
- **Trust delegation chain**: Documented monotonically decreasing privilege model from user through pipeline to tools
- **Trust framework compliance**: Mapped all pipeline boundaries to trust verification checkpoints
- **Supply chain hardening**: Lockfile-lint validation and tiered npm audit added to CI pipeline
- **DCO enforcement**: Signed-off-by trailer check on all PR commits
- **Credential persistence disabled**: All GitHub Actions checkout steps now use `persist-credentials: false`

### Tests

- 24 new test files with comprehensive coverage:
  - **Pipeline tests** (15 files): adapterTimeout, agentIdentity, agentToolAllowlist, circuitBreaker, complianceVerification, diffHash, failureLog, observability, phaseOutputSchema, phaseTimeout, pipelineContext, pipelineTimeout, promptGuard, reviewLoop, wave3Medium
  - **Security tests** (2 files): secretDetection, verificationGates
  - **CLI tests** (3 files): entrypoint, lifecycle, worktreeSetup
  - **Integration tests** (4 files): mcp-dataflow, concurrentWrite, learningsValidation, setupCleanup
- 51 total test files modified
- Test count: 1,089 → 1,734 (+645 new tests, +59%)

### Documentation

- Audit report: `governance/AUDIT-REPORT.md` (1,445 lines) with executive dashboard, domain heatmap, and holistic assessment
- Finding registry: `governance/audit/finding-registry.json` (7,306 lines) with full resolution tracking
- Execution insights: `governance/audit/execution-insights.json` documenting cross-cycle patterns
- 45 command documentation files updated
- 26 skill documentation files updated
- Website docs: quick-start, MCP setup guide, and adapter capability matrix updated

### Dependencies

- Bump inquirer from 13.3.2 to 13.4.1
- Bump dev dependencies: @vitest/coverage-v8, eslint, typescript, typescript-eslint, vitest (6 updates)
- Bump GitHub Actions: softprops/action-gh-release 2.2.2→2.6.1, actions/upload-artifact 6.0.0→7.0.0, actions/deploy-pages 4.0.5→5.0.0, github/codeql-action 0.62.5→0.65.6

## [1.4.0] - 2026-03-25

### Added

- VISION.md -- stable north-star vision document for the framework
- RE-ENVISION.md -- framework-owner prompt for structured vision capture and refinement
- Closed-loop audit phases: CL-1 (PRD Evolution), CL-2 (Content Gap Identification), CL-3 (Audit Self-Evolution) in AUDIT.md
- Post-execution phases: Phase 5 (PRD Update), Phase 6 (Content Generation Planning), Phase 7 (Audit Prompt Evolution) in AUDIT-EXECUTE.md
- Sub-agent 16.5 (Closed-Loop Effectiveness) in D16 compound system evaluation
- Audit templates for closed-loop agents (PRD Update, Content Spec, Audit Evolution)
- Dynamic inventory verification protocol in AUDIT.md
- **`status:done` label**: Added to the board label taxonomy, closing the gap between the existing `BoardConfig.statusOptions.done` TypeScript type and the agent command instructions. All platform status mapping tables now include the `status:done` row.
- **Post-Merge Terminal State handling**: New section in `hatch3r-board-shared` documenting platform-specific behavior after PR merge — GitHub Projects V2 built-in workflow verification, Azure DevOps opt-in checkbox, GitLab label drift advisory.
- **PR Closed Without Merge handling**: New section in `hatch3r-board-shared` defining revert behavior for abandoned PRs. Board-groom Step 3l detects orphaned `status:in-review` issues with no associated open PR/MR.
- **Abandoned work detection in collision check**: All three platform pickup files (GitHub, Azure DevOps, GitLab) now check for closed/abandoned PRs during Step 3 collision detection and surface context to the user.
- **Orphaned in-review remediation in board-groom**: Health Fix (Step 4i) expanded to remediate board sync drift (label vs. board status mismatch) and orphaned in-review issues (both open with no PR and closed but not status:done).
- **End-of-Run Reconciliation step 5**: Orphaned in-review detection for all cached `status:in-review` issues, not just those transitioned during the current run. Reconciliation report now includes orphaned in-review line.
- **Board-init automation guidance**: GitHub section recommends verifying the Projects V2 "Item closed" built-in workflow after board creation. GitLab section notes labels are not auto-updated on close. ADO section documents column split recommendations.
- Sub-Agent Behavioral Charter in AUDIT.md -- 10 directives governing audit sub-agent mindset and conduct
- Orchestrator Quality Guidance in AUDIT.md -- synthesis standards, cross-domain discovery, sub-agent failure handling, report assembly
- Shared agent quality charter (`agents/shared/quality-charter.md`) -- 7 behavioral standards for end-user agents
- Fix-to-Finding verification gate check in AUDIT-EXECUTE.md regression gates
- Adversarial verification pass (Pass 2.5) and fix-to-finding alignment pass (Pass 1.5) in reviewer template
- Execution Learning section in AUDIT-EXECUTE.md with cross-cycle pattern tracking and insights JSON
- Content Quality Principles checklist in D05 audit domain for verifying content against quality charter
- Holistic Assessment section in audit report Executive Dashboard output format
- False positive detection and tracking in AUDIT-EXECUTE.md final review
- governance/CONSTITUTION.md -- foundational decisions, quality principles, and design rationale for the governance system

### Changed

- PRD Section 2 references VISION.md as the north-star vision document
- PRD Section 6 adds 4 new principles: weekly audit cadence, closed-loop evolution, automatic learning, up-to-date information
- PRD Section 6 adds "Audit Cycle as Product Feature" subsection
- AUDIT.md sub-agent count updated from 106 to 107
- AUDIT.md adds pre-audit question for closed-loop phases
- AUDIT-EXECUTE.md adds 4 new guardrails (#17-20) for closed-loop phase governance
- AUDIT-EXECUTE.md finding registry gains 3 new fields (prd_impact, content_generated, audit_evolution)
- D18 (PRD, Roadmap & Distribution) now audits VISION.md alignment
- **Sub-issue linking fallback chain parity**: Azure DevOps and GitLab sub-issue linking upgraded from 2-tier to 3-tier fallback chains, matching GitHub's structure (Native -> Advisory body-reference -> Comment-only). The "Three-Tier" section headers now match their content.
- **Board Sync Enforcement rule 2**: Updated from "four canonical statuses" to "five canonical statuses" (Ready, In Progress, In Review, Done, Blocked).
- **GitLab required board lists**: Added "Done" (`status::done`) to the required board lists created during `board-init`.
- **Board-groom health-fix scope**: Expanded from missing metadata only to also include board sync drift remediation and orphaned in-review resolution.
- AUDIT.md Universal Audit Checklist expanded with git history context, measurable criteria, and multi-stakeholder impact directives
- AUDIT.md adds reproducibility/non-determinism note, scoring calibration check, adaptive resource allocation for mature domains, domain file quality standard, and enhanced context propagation mechanism
- AUDIT-EXECUTE.md finding registry gains `false_positive` field for tracking incorrectly identified findings
- Implementation sub-agent template expanded with 3 new requirements: understand the why, consider side effects, verify root cause
- D05, D07, D13, D16, D19 audit domain checklists expanded with content interaction testing, negative scenario testing, simulated execution, content quality principles, and assumption challenging
- VISION.md adds principles 13-14: quality through measurable standards and behavioral charter governance
- hatch3r-prd.md adds principle 17: behavioral quality standards referencing shared quality charter
- Consolidated all governance files into `governance/` directory: AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, VISION.md, hatch3r-prd.md, COMPETITIVE-ANALYSIS.md, AUDIT-REPORT.md, and audit/ subdirectory

### Documentation

- **ADO status granularity**: Documented the known limitation where `status:ready` and `status:in-progress` both map to ADO state "Active". Added recommendations for custom process templates and board column splits.
- **GitLab scoped labels caveat**: Noted that scoped labels (`status::done`) require GitLab Premium or Ultimate tier.

## [1.3.0] - 2026-03-18

### Added

- **Multi-repo workspace support**: Detect sub-repos in non-git parent directories, `workspace.json` manifest for repo registry and sync strategy, workspace-aware `hatch3r init --workspace` with auto-detection, `hatch3r config` workspace management (add/remove repos, per-repo overrides, sync strategy)
- **Sync cascade**: `hatch3r sync` propagates content from workspace root to sub-repos with `--repos`, `--dry-run`, `--force`, and `--minimal` flags; copy-based distribution so sub-repos work in isolation
- **Per-repo overrides**: Workspace repos can override tools, features, and content selection (include/exclude lists) relative to workspace defaults
- **`hatch3r status` command**: Check sync status between canonical `.agents/` and generated files, show drifted/missing files, estimated token count, workspace topology with repo sync timestamps
- **`hatch3r validate` command**: Validate `.agents/` structure including cross-references, orchestration dependencies, customizations, hooks, and deny-pattern scanning
- **`hatch3r config` workspace management**: Add/remove sub-repos, toggle sync, change per-repo overrides, switch sync strategy
- **AntiGravity adapter**: 15th platform adapter (`.antigravity/rules.md`, `.antigravity/skills/`, `.antigravity/settings.json`)
- **Enhanced Goose adapter**: Extended configuration generation with MCP server support and structured output
- **20 new agent analysis modes**: architecture, boundary-analysis, codebase-impact, complexity-risk, coverage-analysis, current-state, feature-design, impact-analysis, library-docs, migration-path, prior-art, refactoring-strategy, regression, requirements-elicitation, risk-assessment, risk-prioritization, root-cause, similar-implementation, symptom-trace, test-pattern
- **Shared external knowledge**: `agents/shared/external-knowledge.md` for cross-agent reference material
- **Board shared content supplement**: Additional board command shared content files
- **`.npmrc` with `ignore-scripts=true`**: Prevent lifecycle script execution during install

### Fixed

- **Compound content copy**: Non-prefixed support subdirectories (e.g. `commands/board/`) now correctly copied during `init` and `update` via `copyCompoundContentFiles()`
- **Adapter workspace awareness**: Claude, Cline, Copilot, Cursor, and Windsurf adapters updated to include workspace membership metadata in generated configs

### Changed

- **Init workspace detection**: `hatch3r init` auto-detects multi-repo workspace layout when run in a non-git directory with git subdirectories
- **Sync command signature**: `syncCommand()` now accepts options object (`repos`, `dryRun`, `force`, `minimal`) instead of zero-arg
- **Config command extended**: Workspace repo management integrated into existing `hatch3r config` flow
- **Content index**: `copyCompoundContentFiles()` added for compound content types with nested subdirectories
- **Agent orchestration rule**: Extended with workspace-aware directives
- **Learnings loader agent**: Enhanced with structured knowledge sections and provenance tracking

### Security

- **Audit completion**: 137/137 findings resolved across 4 audit waves (high, medium, low, finalization)
- **Safe path assertions**: Extended `assertSafePath` coverage for compound content paths
- **Content validation**: Strengthened cross-reference and orchestration dependency validation in `validate` command

### Tests

- 10 new/modified test files with ~3,300 lines of new test code:
  - `workspace/sync.test.ts` (451 lines) — workspace sync cascade
  - `content/compound.test.ts` (518 lines) — compound content copy
  - `worktree/resolve.test.ts` (373 lines) — worktree resolution
  - `adapters/snapshots.test.ts` (204 lines) — adapter snapshot tests
  - `workspace/manifest.test.ts` (179 lines) — workspace manifest I/O
  - `workspace/git.test.ts` (157 lines) — git remote parsing
  - `workspace/resolve.test.ts` (157 lines) — repo config resolution
  - `adapters/antigravity.test.ts` (149 lines) — AntiGravity adapter
  - `adapters/amazonq.test.ts` (127 lines) — Amazon Q adapter
  - `workspace/exports.test.ts` (117 lines) — workspace module exports
- Adapter snapshot suite: 574 lines of snapshot coverage
- Total test count: 851 → 1060

### Documentation

- **Workspace guide**: `website/docs/guides/workspace.md` — full setup, manifest reference, sync strategies, per-repo overrides
- **README**: Multi-repo workspace section with directory layout diagram and CLI examples
- **Quick start**: Updated with workspace init instructions
- **CLI commands reference**: Added `status`, `validate` commands; expanded `sync` and `init` flags
- **Configuration reference**: Workspace configuration documentation (+90 lines)

## [1.2.0] - 2026-03-10

### Added

- **Worktree file isolation**: Git worktree support for parallel agent sessions — `.worktreeinclude` generation, `hatch3r worktree-setup` CLI command, `WorktreeConfig` in manifest, auto-enabled for worktree-capable tools (claude), migration checkpoint for existing projects, Claude PostToolUse hook for automatic `git worktree add` detection
- **Dynamic bridge orchestration**: `generateBridgeOrchestration()` reads skills from disk and injects a Skill Dispatch Table into every adapter's bridge output (all 12 adapters migrated from static constant to dynamic generation)
- **Inline skill checklists in AGENTS.md**: `extractSkillChecklist()` pulls condensed steps from skill content (max 20 lines per skill), displayed as "Skill Quick Reference" in canonical AGENTS.md so agents don't need a separate file read
- **Cross-reference validation**: `validateCrossReferences()` scans installed content for broken `hatch3r-*` references between agents, skills, rules, and commands — integrated into `hatch3r validate`
- **Orchestration dependency guard**: `validateOrchestrationDependencies()` warns when content selection is missing pipeline-critical agents (researcher, implementer, reviewer, test-writer, security-auditor) — checks during both `init` and `validate`
- **Spec staleness detection**: `hatch3r sync` compares `docs/specs/` file modification times against latest git commit, warns if oldest spec is >7 days old
- **Spec awareness in agents**: Implementer agent reads `docs/specs/` headers for relevant specifications; reviewer agent cross-references specs against changed files for compliance checks
- **Mandatory behavior #5**: Bridge orchestration adds "Consult specs" directive for all adapters
- **`worktree-create` and `worktree-remove` hook events**: New lifecycle hooks for worktree operations
- **`specs` manifest field**: Tracks project spec paths and generation timestamps in `hatch.json`
- **Worktree configuration in `hatch3r config`**: Interactive prompt for enabling/disabling worktree isolation
- **`test-plan` command**: Plan comprehensive test strategies with parallel researchers (coverage analysis, complexity risk, test pattern extraction, boundary analysis, risk-based prioritization). Produces test plan specs, todo.md entries, and optional ADRs. Supports feature-scoped and module/codebase-level planning. Chains to `hatch3r-test-writer` or `hatch3r-board-fill`.
- 5 new researcher modes for test planning: `coverage-analysis`, `complexity-risk`, `test-pattern`, `boundary-analysis`, `risk-prioritization`
- **Selective init with content presets**: `hatch3r init` now asks project type (greenfield/brownfield), team size (solo/team), and content profile (minimal/standard/full/custom) to install only the content files you need
- Content tagging system: all 105 content files (agents, skills, rules, commands, prompts, hooks, github-agents) tagged with workflow, context, and domain tags for intelligent filtering
- 4 content presets: **Minimal** (core agents/workflows only), **Standard** (full dev lifecycle without niche audits, recommended), **Full** (everything), **Custom** (pick exactly what you need)
- Context-aware filtering: greenfield projects exclude brownfield-only items, solo developers exclude team-only items (board commands, onboard, etc.)
- `hatch3r config` content management: add/remove individual content items post-init via interactive checkbox
- Dynamic `AGENTS.md` generation: `.agents/AGENTS.md` now reflects only installed agents, skills, and commands instead of a static roster
- `ContentSelection` tracking in `hatch.json` manifest for explicit content item tracking
- Legacy migration checkpoint: `hatch3r update` on pre-selective-init projects auto-populates content tracking from disk
- `hatch3r config` CLI command for interactive reconfiguration of tools, MCP servers, features, and platform after init
- Archive system: removed tool outputs are moved to `.hatch3r-archive/<tool>/<timestamp>/` instead of being deleted
- Customization migration: manual customizations outside managed blocks are auto-migrated to `.hatch3r/<type>/<id>.customize.md` when a tool is removed
- Shared `runUpdate()` function extracted from the update command for reuse by config
- Signal handlers (SIGINT/SIGTERM) for graceful CLI shutdown
- OTel GenAI semantic conventions for AI agent observability (gen_ai.* spans, agent invocation, tool call, LLM tracing)
- Tool call audit trail schema in observability rule
- Correlation IDs for agent workflow tracing
- External verification signals (`npm test`, `npm run lint`, `npx tsc --noEmit`) in reviewer agent
- `_hatch3r` metadata markers on generated JSON adapter configs (Claude, Gemini, Cline, OpenCode)
- `protected: true` flag on implementer, fixer, researcher agents

### Fixed

- **Structured hook activation**: All 5 hook-enabled adapters (claude, gemini, cursor, cline, kiro) now emit `HATCH3R_HOOK_ACTIVATED` directives with explicit agent protocol paths instead of generic echo placeholders — 100% of hook-based automation was previously non-functional
- **Claude TaskCompleted hook**: Replaced generic quality gate message with `HATCH3R_QUALITY_GATE` directive listing Phase 3/4 verification checks
- **Claude TeammateIdle hook**: Replaced generic pipeline message with `HATCH3R_PIPELINE_CHECK` directive listing pending Phase 4 specialist tasks
- **Adapter capabilities**: Amp `commands` and Zed `skills` flags corrected in capability matrix
- **MCP filtering**: `readFilteredMcp` now respects `manifest.mcp.servers` selection instead of emitting all servers
- **Website documentation**: stale reference counts, ghost `error-handling` rule reference, `/.agents/` path inconsistencies across 6 docs pages
- **README**: reduced from 514 to 204 lines, bridge adapter count corrected 11→13
- **Bug report template**: Node.js version updated to 22.0.0+ minimum
- **Command files**: 4 stale `.cursor/commands/` paths updated to `.agents/commands/`
- **Content system**: `Error` → `HatchError` for consistent error handling in addContentItem
- Adapter singleton warning array leakage on failed `generate()` calls
- Customization warnings silently dropped in 10 adapters (14 call sites)
- Dead `CANONICAL_AGENTS_MD` constant and unused import removed
- `execFileSync` blocking without timeout — added 30s timeout with SIGTERM kill signal

### Security

- **Atomic writes**: `safeWriteFile` now uses write-to-temp-then-rename pattern to prevent corruption on crash
- **Path traversal guard**: `assertSafePath()` validates all content paths before copy/add/remove operations
- **Symlink detection**: canonical file reader skips symlinks via `lstat()` check to prevent directory traversal
- **Homoglyph normalization**: deny-list scanning normalizes Cyrillic confusables and strips zero-width characters
- **Archive verification**: copy verified via `stat()` before removing source files
- `atomicWriteFile` now used for all manifest writes (`hatch.json`, `.integrity.json`, `.env.mcp`)
- GitHub Actions pinned to SHA digests (11 references across 4 workflows)

### Changed

- **Bridge orchestration is now dynamic**: `BaseAdapter.bridgeHeader()` changed from synchronous (static constant) to async (reads skills from disk), ensuring every adapter's bridge output includes the current skill inventory
- **safeWrite simplified**: Removed `backup` option, `createBackup()`/`writeWithBackup()` functions, and `.backups/` directory. Corrupted managed blocks now rely on git for recovery. `MergeResult.action` no longer includes `"backed-up"`.
- **`docs/specs/` in worktree isolation**: Spec files are now included in worktree copy patterns so parallel agent sessions see project specifications
- **DRY extraction**: 8 shared constants/functions extracted from init.ts and config.ts to `src/cli/shared/constants.ts`
- **`TYPE_TO_SELECTION_KEY`**: content type mapping exported as single constant (was duplicated 3x)
- **Validate command**: refactored from monolithic 362-line function into 9 focused sub-validators
- **CI workflows**: added `permissions: { contents: read }` to ci.yml and pr-checks.yml
- **PRD**: added sections for content system (FR-12), config command (FR-13), archive functionality (FR-14)
- **Competitive analysis**: updated command/MCP counts, docs site status
- **Plugin metadata**: command count updated 33→34
- `hatch3r init --yes` defaults to **standard** preset with auto-detected greenfield/brownfield and solo team size
- `hatch3r update` now respects content selections — only updates files matching the manifest's content selection (legacy projects without selections continue copying everything)
- `hatch3r validate` uses dynamic agent roster from manifest instead of hardcoded agent list
- Init summary box now shows content profile and item count breakdown
- Board commands modularized: `board-shared.md` split into core + 4 sub-files, `board-pickup.md` split into core + 7 sub-files (under `commands/board/`)
- OWASP Agentic Top 10 (ASI01–ASI10) expanded with detection heuristics, code pattern examples, and remediation steps

### Tests

- Added 200 new tests across 4 files: `tags.test.ts` (15), `verify.test.ts` (20), `content/index.test.ts` (71), `config.test.ts` (79)
- New audit test suites: `toml-utils.test.ts` (9 tests), `constants.test.ts` (15 tests), `assertSafePath.test.ts` (19 tests) — +43 tests from audit execution
- Statement/line coverage: 77.54% → 90.5% (threshold: 80%)
- Total test count: 543 → 786

### Audit Execution (103/104 findings resolved — score 79→95)

#### Added
- Amazon Q adapter — 14th platform adapter (`.amazonq/rules/`, `.amazonq/mcp.json`)
- Kiro hook emission via steering file (`.kiro/steering/hatch3r-hooks.md`)
- Goose MCP config emission in `.goosehints`
- MCP setup guide (`website/docs/guides/mcp-setup.md`)
- Adapter depth strategy document (`website/docs/reference/architecture/`)
- Audit domain reports and execution templates (`audit/`)
- Migration checkpoint tests, malformed manifest tests (+65 tests total, 786→851)
- Hook condition fixtures (labels/branches)
- Base adapter error path and branch coverage tests
- Structured reasoning sections in implementer, reviewer, researcher agents
- Provenance tracking and confidence levels for learnings consumption
- Learnings dispute/correction workflow
- Token budget estimation in `hatch3r status`
- Non-JS monorepo markers (Cargo workspaces, Go workspaces, Gradle multi-project, Pants)
- Detected languages stored in manifest for tag filtering
- Content ID collision warnings in content index
- Archive pruning (max 5 entries per tool)
- MCP server name allowlist validation

#### Fixed
- `atomicWriteFile` now calls `fdatasync()` before rename for power-loss safety
- `atomicWriteFile` retries once on `EBUSY`/`EPERM` (Windows AV lock) with 100ms delay
- Managed block auto-repair now creates backup before overwriting
- Deny pattern replacement uses global regex (was only replacing first match)
- Customization input normalized: homoglyphs, boundary markers, zero-width chars, multi-line collapse
- Copilot MCP config key changed from `mcpServers` to `servers`
- Copilot envFile replaced with env object
- Windsurf trigger format corrected to YAML frontmatter
- OpenCode schema URL corrected (`config-schema.json` → `config.json`)
- Claude `teammateMode` updated to documented values
- Aider adapter now uses managed block support
- `unhandledRejection` handler prevents raw stack trace crashes
- Manifest validation now throws descriptive error (was silently returning null)
- Update timeout now shows timeout-specific message via `err.killed`/`err.signal` check
- Exit code 2 for usage/argument errors (POSIX convention)
- Signal handler drains stdout/stderr before exit
- Error messages include help URL (`https://hatch3r.dev/docs/troubleshooting`)
- `runInit` refactored from 12 positional params to `RunInitOptions` interface
- Warning array no longer reset on adapter `generate()` error
- npm pinned to `npm@11.5.1` in release workflow
- Release workflow adds `environment: npm-publish` protection
- Lockfile version synced to match package.json

#### Security
- HMAC integrity replaced with SHA-256 content-addressed hashing
- Greek-to-Latin homoglyph mappings added (~20 codepoints)
- Boundary marker spoofing blocked (strips `MANAGED-BLOCK:*` and `USER-CUSTOMIZATION:*` markers)
- MCP filesystem scope narrowed to exclude `.env.mcp`
- `npx -y` guidance expanded in security patterns
- Integrity manifest documents guarantees and limitations (no signing caveat)
- Structural verification heuristic for rule propagation to sub-agents
- Circuit breaker tracking (CLOSED/OPEN/HALF-OPEN states)

#### Changed
- Bridge orchestration minimized from ~2,500 to ~500 tokens
- Tiered rule inclusion per agent phase role
- PipelineContext schema with correlation IDs and phase handoffs
- Confirmation pass after clean reviewer verdict (non-determinism mitigation)
- Per-task review within multi-task batches
- Research completeness check before implementer handoff
- Canonical severity mapping across agent families
- Stall detection for oscillating fix-break cycles
- Blast radius summary passed from Phase 1 to specialists
- OTel span naming updated to `invoke_agent {gen_ai.agent.name}`
- Adapter capability matrix version updated to v1.2.0
- Kiro removed from Intentional Omissions in capability matrix
- Status codes standardized to SUCCESS/PARTIAL/BLOCKED
- 5 missing rules added to reference docs page
- Introduction file tree updated to show all adapter outputs
- Quick Start MCP server listing expanded

## [1.1.0] - 2026-03-05

### Added

- Multi-platform support: GitHub (default), Azure DevOps, and GitLab as first-class platforms
- Platform auto-detection from git remote during `hatch3r init`
- Azure DevOps MCP server integration (@tiberriver256/mcp-server-azure-devops)
- GitLab MCP server integration (glab mcp)
- 4 new adapter targets: Aider (`CONVENTIONS.md`), Kiro (`kiro.md`, specs), Goose (`.goosehints`), Zed (`.rules`)
- Fixer agent for targeted fix implementation in the agentic review loop
- Agentic review loop: reviewer + fixer cycle (max 3 iterations), four-phase pipeline (research, implement, review loop, final quality)
- Deep context analysis rule for codebase understanding and efficient context management
- `board-groom` command for ongoing backlog refinement (re-prioritize, reclassify, re-scope, archive, decompose, merge duplicates)
- `debug` command for structured root-cause analysis and debugging workflows
- `quick-change` command for small, board-free changes (typos, config tweaks, small refactors)
- `revision` command for structured post-implementation revision with specialist sub-agent delegation
- `hatch3r verify` CLI command for integrity verification of canonical sources
- `hatch3r add` CLI command for community pack installation (coming soon)
- Integrity verification system for validating `.agents/` structure and content
- MCP adapter utilities with TOML configuration support
- Package manager auto-detection (npm, yarn, pnpm, bun)
- Performance budget checks framework
- Migration infrastructure for existing users (`migrateManifest`, update checkpoints)
- Greenfield/brownfield post-init guidance
- Product vision support in `board-fill`
- Board operation batching with single-approval workflow
- Quick/defaults mode for `board-init`
- Docusaurus documentation site with getting started, architecture, configuration, and guide pages
- Agentic process diagrams and workflow documentation
- Cursor-format rule files (`.mdc`) for agent orchestration, deep context, and other rules
- PAT scope documentation with project scope guidance

### Changed

- Agent count expanded from 11 to 16; skills from 22 to 25; rules from 18 to 22; commands from 25 to 34
- MCP servers expanded from 5 to 8 (3 default + 5 opt-in: GitHub, Brave Search, Sentry, Postgres, Linear)
- Review cycle upgraded from single-pass to iterative reviewer + fixer loop (max 3 iterations)
- Board pickup now performs adaptive deep context analysis with complexity scoring and requirements elicitation
- Manifest schema version bumped to 2.0.0 with `namespace`/`project`/`repo` fields replacing `owner`/`repo` (backward-compatible)
- All board commands, agents, rules, and skills support GitHub, Azure DevOps, and GitLab
- All agents use platform-conditional CLI references
- All rules use platform-aware tooling hierarchy
- All command references standardized with `hatch3r-` prefix for consistency
- Quality improvements across all agents, commands, rules, skills, and hooks (100+ content files revised)
- CI matrix expanded to Node 22 + 24 across Ubuntu, macOS, and Windows
- PR checks: added bundle size reporting and conventional commit title validation
- Release workflow: added version tag validation against `package.json`
- Test coverage expanded with new suites for MCP utilities, CLI add command, and integrity verification
- Canonical source path corrected from `/.agents/` to `.agents/` across all references

### Fixed

- Claude Code `.mcp.json` compatibility: env var syntax and type field
- WSL multi-select checkbox rendering
- README command terminology consistency

### Removed

- `hatch3r-error-handling` rule (consolidated into security patterns and code standards)

## [1.0.0] - 2026-02-27

Initial release. Battle-tested agentic coding setup framework with 11 agents, 22 skills, 18 rules, 25 commands, and MCP integrations for Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, and Cline.
