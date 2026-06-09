---
id: hatch3r-docs-writing
name: hatch3r-docs-writing
type: skill
description: Authors technical documentation through a repeatable workflow — audience analysis, Diátaxis-mode selection, structure, draft, review, publish. Covers READMEs, ADRs, API docs, and runbooks. Use when writing or restructuring any project documentation.
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Technical Documentation Workflow

Companion workflow to the `hatch3r-docs-writer` agent: that agent is the Phase-4 specialist invoked to update specs after a code change; this skill is the step-by-step procedure a human or agent follows to author a documentation artifact from scratch. Use the agent when documentation must track a `src/` diff; use this skill when authoring a new doc and you need the audience-analysis-through-publish sequence.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Classify the doc by Diátaxis mode + name the audience
- [ ] Step 2: Pick the structure template for the chosen mode
- [ ] Step 3: Draft to the template, one mode per document
- [ ] Step 4: Run the review checklist (audience, accuracy, style, structure)
- [ ] Step 5: Publish — link from an index, set owner + last-updated, verify cross-references
```

The load-bearing decision is Step 1: a document serves exactly one of four user needs. Mixing learning content into a reference table, or burying a how-to procedure inside an explanation, is the most common defect this workflow prevents (Diátaxis — see References).

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target audience, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: which doc type is wanted (README vs ADR vs API reference vs runbook), the reader's existing competence (new user vs maintainer vs on-call), whether an existing doc is being restructured (irreversible section moves), and where the published doc is linked from.

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Tier boundaries for THIS skill:
- Tier 1 (single doc, single mode): inline.
- Tier 2 (multi-doc set, e.g. README + API reference + runbook for one feature): spawn one sub-agent per document via the Task tool; each authors to its own Diátaxis mode.
- Tier 3 (full docs-site restructure across many modes): one fresh sub-agent per top-level section; orchestrator integrates the index only.

Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Classify by Diátaxis Mode and Name the Audience

Every document answers exactly one of four user needs. Pick one mode before writing a single sentence; if a request spans two, split it into two documents.

| Mode | User need | Reader state | Writing stance |
|------|-----------|--------------|----------------|
| Tutorial | Learning by doing | Newcomer, no prior context | Lesson — guarantee a working result, hide edge cases |
| How-to guide | Achieving a stated goal | Already competent, has a task | Recipe — numbered steps to one outcome, no theory |
| Reference | Looking up a fact | Working, needs accuracy | Description — complete, dry, structured, no narrative |
| Explanation | Understanding why | Studying, off-task | Discussion — context, trade-offs, alternatives, rationale |

Map common artifacts to modes:

| Artifact | Primary mode | Note |
|----------|--------------|------|
| README | How-to (quickstart) + Reference (config) | Lead with the 60-second "get it running" path; link out to deep docs |
| API docs | Reference | Endpoint, params, request/response shapes, error codes, auth — one entry per endpoint |
| Runbook | How-to | Operational procedure: prerequisites, numbered steps, verification, rollback |
| ADR | Explanation | A decision and its rationale — context, decision, consequences |

Name the audience explicitly in one sentence (e.g., "on-call engineer mid-incident, has shell access, has not seen this service before"). Write to a US-English global-audience reader: short unambiguous sentences, active voice, direct address with "you" (Google dev-docs style — see References). The audience sentence drives every later choice — vocabulary, assumed prerequisites, depth.

## Step 2: Pick the Structure Template

Use the template for the mode chosen in Step 1.

**README (how-to + reference):**
1. One-line description of what the project is.
2. Quickstart — the shortest verified path from clone to a running result.
3. Prerequisites (versions, accounts, tools).
4. Configuration reference (table: option, type, default, description).
5. Links to deeper docs (tutorial, full reference, contributing).

**ADR (Nygard format — see References):**
1. Title (`NNNN-short-decision-name`).
2. Status (proposed | accepted | rejected | deprecated | superseded by NNNN).
3. Context (the forces and problem that motivate the decision).
4. Decision (the change, stated as "we will…").
5. Consequences (positive and negative effects, including new obligations).

**API reference (one block per endpoint):**
- Method + path; one-line purpose.
- Authentication required (scheme + scope).
- Request: path/query/body params (table: name, type, required, description).
- Response: success shape + status, paginated where applicable.
- Errors: status code + meaning + when it fires.

**Runbook (how-to):**
1. Trigger — what condition this runbook handles.
2. Prerequisites — access, tools, on-call context.
3. Numbered steps — each step one action with the exact command.
4. Verification — the observable signal that confirms success.
5. Rollback — how to undo if a step fails.
6. Escalation — who to page if the runbook does not resolve it.

## Step 3: Draft to the Template

- Write to the one chosen mode. If you reach for "but first, some background" inside a how-to, that background belongs in a separate explanation doc — link to it instead.
- Use a descriptive heading that matches the content type: a bare infinitive for a task heading ("Configure the database"), a noun phrase for a concept heading ("Database configuration") — Google dev-docs style.
- Put structured facts in tables (config options, params, error codes, invariants), not prose.
- Put acceptance criteria and operational steps in checklists or numbered lists.
- Use stable IDs from the project glossary (event IDs, invariant IDs) so the doc survives renames.
- Every code example uses a current, non-deprecated API — verify against the library's docs at draft time.
- State confidence on any claim you could not verify against source: mark it `[unverified]` and recommend a maintainer check before publish (quality charter — confidence levels).

## Step 4: Review Checklist

Run all four lenses before publishing. A failure on any line is a blocker.

**Audience:**
- [ ] The named reader can act on this doc with only the prerequisites it lists — no unstated assumed knowledge.
- [ ] Depth matches the audience: a tutorial hides edge cases; a reference omits none.

**Accuracy:**
- [ ] Every command, code block, and config value was run or read against the current source — no copy-from-memory.
- [ ] Cross-references resolve (no dead links, no renamed-away anchors).
- [ ] Stable IDs match the glossary.

**Style:**
- [ ] Active voice, second person, short sentences (Google dev-docs style).
- [ ] No filler ("it is important to note", "simply", "just"); state the fact directly.
- [ ] Headings match content type (infinitive for task, noun phrase for concept).

**Structure:**
- [ ] One Diátaxis mode per document — no learning content in a reference, no theory in a how-to.
- [ ] Findable from an index or parent doc.
- [ ] README leads with a runnable quickstart; runbook ends with verification + rollback; ADR records consequences.

## Step 5: Publish

- Link the new doc from its index or parent (a doc no one can find does not exist).
- Add an ownership footer: owner, reviewers, last-updated date.
- Re-verify cross-references after the file lands at its final path (anchors shift when filenames change).
- For docs that mirror code (API reference, config reference), note the source-of-truth file path so the next editor knows what to re-check against.
- Lint markdown before declaring done (e.g., `npx markdownlint <path>`); a broken table or heading level is a structure defect.

## Error Handling

- **Source code contradicts the existing doc:** the code is the source of truth for behavior. Update the doc to match observed behavior and flag the stale section in the change summary; do not document the intended-but-absent behavior.
- **Request spans two Diátaxis modes:** do not blend them. Split into two documents (e.g., a how-to guide plus a linked explanation) and state the split in your output.
- **Cannot verify a code example against source:** mark the example `[unverified]`, recommend a maintainer run it, and lower the document's stated confidence to medium rather than publishing an unverified example as fact.
- **No index or parent to link from:** create or identify the index entry as part of this work — an unlinked doc fails Step 5.

## Definition of Done

- [ ] Document classified to exactly one Diátaxis mode with a one-sentence named audience
- [ ] Authored to the matching structure template
- [ ] All four review-checklist lenses pass (audience, accuracy, style, structure)
- [ ] Linked from an index/parent; ownership + last-updated footer present
- [ ] Cross-references resolve and code examples verified against current source (or marked `[unverified]`)
- [ ] No secrets, tokens, or internal-only URLs in the published text

## References

- Procida, Daniele. "Diátaxis — Start here." `https://diataxis.fr/start-here/` (accessed 2026-06-02, diataxis.fr, peer-reviewed-methodology). Source for the four-mode classification in Step 1 (tutorial / how-to / reference / explanation) and the one-mode-per-document discipline enforced in Steps 3–4.
- Google. "Google developer documentation style guide — Highlights." `https://developers.google.com/style/highlights` (accessed 2026-06-02, Google for Developers, official-docs). Source for the global-audience writing stance (active voice, second person, short sentences) and the task-vs-concept heading rule (bare infinitive vs noun phrase) in Steps 1–4. Procedures guidance: `https://developers.google.com/style/procedures`.
- Nygard, Michael. "Documenting Architecture Decisions." `https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions` (accessed 2026-06-02, Cognitect, established-library; ADR template used in 723+ open-source repositories per `https://adr.github.io/`). Source for the ADR structure template in Step 2 (Title / Status / Context / Decision / Consequences).
