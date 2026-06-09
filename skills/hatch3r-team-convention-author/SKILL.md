---
id: hatch3r-team-convention-author
name: hatch3r-team-convention-author
type: skill
description: Interactive workflow to elicit, draft, align, and persist a team's coding conventions and working agreements as a versioned project rule or convention doc. Use when a team is setting up shared norms, codifying tacit practices, or reconciling conflicting style decisions.
tags: [maintenance, board]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Team Convention Author — Elicit, Draft, Align, Persist

Captures a team's tacit coding conventions and working agreements into a single versioned artifact the whole team can read and an agent can enforce. Two output shapes: a **convention doc** (`docs/process/` markdown — for human-facing working agreements: ownership, review norms, communication) and a **project rule** (`.hatch3r/overrides/rules/` — for machine-enforceable code conventions: naming, structure, lint deltas — so the rule is tracked by `hatch3r status`/`verify` and regenerated into the adapter surfaces on `sync`, not written drift-invisibly into a generated file). The load-bearing step is Step 1: a convention written FOR a team by one person decays; a convention written BY the team through elicitation holds (team-charter methodology — see References).

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Elicit the team's conventions and working agreements
- [ ] Step 2: Classify each item — code convention (rule) vs working agreement (doc)
- [ ] Step 3: Cross-check against existing project rules and style guides
- [ ] Step 4: Draft to the matching template
- [ ] Step 5: Review with the team, then persist as a versioned artifact
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any write, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target surface, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: which convention class is wanted (machine-enforceable code rule vs human working agreement); whether an existing convention doc/rule is being amended (a section rewrite that drops prior agreements is irreversible to readers who relied on them); the authoritative style guide for the stack (a new convention that contradicts an adopted style guide needs an explicit override decision); and who ratifies (one maintainer's preference is not a team agreement — see Step 5).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Tier boundaries for THIS skill:
- Tier 1 (single convention class, one stack): inline.
- Tier 2 (both a code-rule set AND a working-agreement doc, or conventions spanning ≥2 stacks): spawn one sub-agent per disjoint artifact via the Task tool; each drafts its own file.
- Tier 3 (full team-handbook codification across many domains — frontend, backend, infra, review process): one fresh sub-agent per domain; orchestrator integrates the index only.

Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Elicit the Team's Conventions and Working Agreements

A convention is only adopted if the team shaped it. Elicit, do not dictate. Ask the team (or the maintainer relaying for the team) across these prompts, one focused question per turn:

1. **Code conventions** — naming (files, types, functions), module/folder structure, import ordering, error-handling shape, test-file placement, comment style. Pull candidates from the existing codebase rather than from memory: a convention the code already follows in 80%+ of cases is a documented-default candidate, not a debate.
2. **Working agreements** — review turnaround expectation, branch/PR naming, merge policy (squash vs merge-commit), required approvals, what blocks a merge, how disagreements are resolved, communication norms (where decisions are recorded).
3. **Authority and overrides** — which published style guide is the tie-breaker for pure-style points (per Google eng-practices: the style guide is the absolute authority on style, and any style point not in the guide is personal preference — see References). Record the chosen style guide by name and URL.

For each candidate, capture: the convention, one concrete example, and the rationale (why this over the alternative). A convention with no rationale is a preference, not an agreement — flag it for Step 5 ratification.

## Step 2: Classify — Code Convention vs Working Agreement

Route each elicited item to its output shape. The distinction drives where the artifact lands and how it is enforced.

| Item type | Output shape | Lands in | Enforcement |
|-----------|--------------|----------|-------------|
| Machine-checkable code rule (naming, structure, import order, lint delta) | Project rule | `.hatch3r/overrides/rules/<id>.md` (+ `.mdc` companion) so `hatch3r status`/`verify` track it and `sync` regenerates it into the adapter surfaces; OR a linter config | Agent reads the rule each session; linter where expressible |
| Human working agreement (review norms, merge policy, communication, decision-recording) | Convention doc | `docs/process/<topic>.md` | Read by humans; cited in PR templates and onboarding |
| Pure-style point already owned by an adopted style guide | Neither — link to the style guide | The convention doc's "Authority" section | The style guide is the source of truth; do not restate it |

Do not duplicate a rule the adopted style guide or an existing linter config already enforces — link to it instead (single-source-of-truth; restating drifts). A code convention that a linter can check belongs in the linter config with a one-line pointer from the rule, not as prose the agent must interpret.

Write a machine rule into `.hatch3r/overrides/rules/`, not directly into a generated adapter surface such as `.cursor/rules/*.mdc` or `docs/process/`. A rule authored straight into the adapter output is invisible to `hatch3r status`/`verify` drift detection and is overwritten on the next `sync` regeneration (SA14.3-F6). The overrides subtree is the user-content surface `hatch3r` re-emits with overrides on every sync; `docs/process/` stays the home for human working agreements only.

## Step 3: Cross-Check Against Existing Project Rules and Style Guides

Before drafting, reconcile against what already exists:

1. **Read the current rule surface** — list every existing rule file and its `description`. A new convention that overlaps an existing rule is an amendment to that rule, not a new file (per content-authoring duplication check).
2. **Read the adopted style guide** — if a candidate convention contradicts the team's published style guide, surface the conflict to the team with both positions and a recommended resolution; do not silently override. Record the resolution as an explicit override decision with rationale.
3. **Detect internal contradictions** — two elicited agreements that conflict (e.g., "squash all PRs" vs "preserve commit history for releases") are a Step 5 ratification blocker, not a draft-time guess.

Output of this step: a reconciliation list — `{ candidate, status: new | amends:<rule-id> | conflicts:<source> | duplicate-drop }`.

## Step 4: Draft to the Matching Template

**Project rule** (machine-enforceable code convention):
- Target path: `.hatch3r/overrides/rules/<id>.md` plus the `.mdc` companion (same body bytes; `scope: always` → `alwaysApply: true`, `scope: conditional` + `globs` → `globs: [...]` + `alwaysApply: false`). This is the user-content override surface `hatch3r` tracks for drift and regenerates on sync — the same path the `cursor` rule importer writes to.
- Frontmatter: `id`, `description` (one line, what the rule enforces), scope (`always` for repo-wide, or a glob for path-scoped).
- Body: each convention as `Convention → one concrete example → rationale`. State the passing condition concretely ("test files live next to source as `*.test.ts`", not "tests organized well").
- Link, do not restate, anything a linter or the adopted style guide already enforces.

**Convention doc** (`docs/process/<topic>.md`, working agreement):
1. Purpose — one sentence: what this agreement governs and who it binds.
2. Agreements — a table or numbered list, each row: the agreement, the rationale, and how it is verified or observed.
3. Authority — the adopted style guide (name + URL) that wins on pure-style points; the decision-recording location.
4. Review and revision — how the team amends this doc (so it stays a living agreement, not a frozen edict).
5. Ownership footer — owner, ratifying team, last-updated date.

Both shapes: every agreement carries a rationale; no agreement is stated as an unexplained mandate. Use measurable passing conditions, not subjective adjectives ("PR description states the change and the why", not "good PR descriptions").

## Step 5: Review With the Team, Then Persist

A convention written for a team is weaker than one written by a team; ownership is built, not delegated (team-charter methodology — see References). Before persisting:

1. **Present the draft to the team for ratification** — every flagged item (no-rationale preferences, internal contradictions, style-guide overrides) is resolved by the team, not assumed. Surface them as explicit decisions.
2. **Confirm scope** — repo-wide rule vs path-scoped; project doc vs shared-across-repos.
3. **Persist each output to its tracked surface:**
   - **Machine rule** → write `.hatch3r/overrides/rules/<id>.md` + its `.mdc` companion. This registers the rule in the user-content override surface, so `hatch3r status`/`verify` report drift on it and `hatch3r sync` regenerates it into the adapter outputs (`.cursor/rules/`, `CLAUDE.md`, Copilot instructions). A convention written straight into a generated adapter file instead is drift-invisible and is clobbered on the next sync (SA14.3-F6) — never persist there. If the team is instead amending an existing canonical rule rather than adding a new one, register the delta in `.hatch3r/hatch.json` `customization` (or the `.customize.md` layer) for that rule id, not a fresh override file.
   - **Working agreement** → write the doc to `docs/process/<topic>.md` (human-facing; not a drift-tracked machine artifact).
   Set the ownership footer (owner, ratifying team, last-updated) on each. Link the doc from the contributing guide or PR template so it is discoverable; an unlinked convention doc is not adopted.
4. **Record the decision trail** — note which conventions were team-ratified and which are documented codebase-defaults, so a later reader knows what is negotiable.

## Error Handling

- **Maintainer relays for an absent team and cannot ratify:** persist the draft marked `status: proposed — pending team ratification` and list the unresolved items; do not stamp it as an adopted agreement.
- **Candidate convention contradicts the adopted style guide:** surface both positions and a recommended resolution to the team; record the chosen override as an explicit decision with rationale. Never silently override the style guide.
- **Two elicited agreements conflict:** stop at Step 3, present both with trade-offs, and require a team decision before drafting. Do not guess the winner.
- **Overlap with an existing rule:** amend the existing rule rather than create a near-duplicate; cite the rule id in your output (duplication check).
- **Convention has no rationale:** flag it as a preference at Step 5 for the team to either justify or drop; do not persist unexplained mandates.

## Definition of Done

- [ ] Conventions elicited from the team (or relayed) with one concrete example + rationale each
- [ ] Each item classified to its output shape (project rule vs working-agreement doc vs style-guide link)
- [ ] Reconciled against existing rules and the adopted style guide; conflicts and overrides resolved by the team, not assumed
- [ ] Drafted to the matching template with measurable passing conditions and per-agreement rationale
- [ ] Team-ratified (or marked `proposed — pending ratification`); ownership + last-updated footer present
- [ ] Machine rules written to `.hatch3r/overrides/rules/<id>.md` (+ `.mdc`) — or registered via `.hatch3r/hatch.json` `customization` when amending a canonical rule — so `hatch3r status`/`verify` track them and `sync` regenerates them; not authored straight into a generated adapter file
- [ ] Working agreements persisted to `docs/process/`, linked from contributing guide / PR template, and the negotiable-vs-default decision trail recorded
- [ ] No duplication of a rule an adopted style guide or linter already enforces

## References

- Google. "Google's Engineering Practices documentation — The Standard of Code Review." `https://google.github.io/eng-practices/review/reviewer/standard.html` (accessed 2026-06-02, google.github.io, established-library / official-docs; CC-BY 3.0). Source for Step 1's authority principle (the style guide is the absolute authority on pure-style points; any style point not in the guide is personal preference) and the improvement-over-perfection framing applied to convention adoption. Repository: `https://github.com/google/eng-practices`.
- Atlassian. "How to Create a Team Charter — The Workstream." `https://www.atlassian.com/work-management/project-collaboration/team-charter` (accessed 2026-06-02, atlassian.com, established-library). Source for Step 1's elicitation stance and Step 5's ratification principle (a charter written BY the team holds; one written FOR the team decays — ownership is built, not delegated) and the purpose/values/roles/communication-norm component set behind the convention-doc template. Corroborated by Easy Agile, "Team Charter, Working Agreement, & Social Contract — Template and Guide." `https://www.easyagile.com/blog/team-charter-working-agreement-social-contract-template-guide` (accessed 2026-06-02, easyagile.com, established-library).
