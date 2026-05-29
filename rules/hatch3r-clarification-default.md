---
id: hatch3r-clarification-default
type: rule
description: "P8 B1 floor: every hatch3r-invoked agentic workflow detects and resolves ambiguity via the platform-native question tool BEFORE executing — default behavior, not exception-driven. Names the 4-trigger set and mandates a §0 ambiguity gate on every mutating agent, command, and skill."
tags: [orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Clarification Default

**Pillars:** P8 (Clarification & Fan-out Discipline)

Canonical reference for the *how* of asking: `agents/shared/user-question-protocol.md`. This rule governs the *whether* — it is the corpus-wide, always-on floor that every adapter ships to the end-user repo, so B1 enforcement does not depend on per-artifact body inheritance alone.

## B1 directive (verbatim)

> Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

Default-path, not exception: a workflow that proceeds without resolving a live trigger below has violated B1, even if it later succeeds. Asking is the baseline; silent assumption is the deviation that must be justified.

## Four-trigger set

Apply the protocol before any write-tool invocation when ANY of these hold:

1. **Ambiguous scope** — the request maps to two or more reasonable interpretations that produce different artifacts.
2. **Multiple valid interpretations** — two or more viable approaches with materially different cost, scope, or risk.
3. **Irreversible action** — deleting an artifact, renaming a public artifact id, dropping a frontmatter field, force-pushing a branch.
4. **Missing acceptance criteria** — no testable definition of done for the requested change.

If none of the four hold and the safer default is obvious and reversible, proceed and note the default — do not manufacture a question (anti-pattern per `agents/shared/user-question-protocol.md` "Echo-as-question").

## §0 ambiguity gate (every mutating artifact)

Every artifact under `agents/`, `commands/`, and `skills/` that can mutate files MUST carry a §0 (or "Step 0 — Ambiguity gate") block as its first procedural step. The block:

- scans the request against the four-trigger set above before any write;
- on a live trigger, asks via the platform-native question tool per `agents/shared/user-question-protocol.md` and awaits the answer before proceeding;
- declares the default-if-no-response option so the workflow never deadlocks.

A mutating artifact with no §0 ambiguity gate, or one whose gate does not reference `agents/shared/user-question-protocol.md`, is a P8 B1 finding (D05 prompt-engineering audit, D13 human-AI collaboration audit).

## How to ask

Use the platform-native question tool per `agents/shared/user-question-protocol.md`. One question per turn; bundle related sub-questions into a single multiple-choice prompt; supply 2–4 numbered options with one-line trade-offs; declare the default-if-no-response option. When no native tool exists on the runtime platform, use the Plain-Text Fallback Template from the same protocol.

## Scope

Binds every hatch3r-invoked workflow that mutates artifacts in the end-user repo — every `agents/hatch3r-*.md`, every `commands/hatch3r-*.md` with `orchestrator: true`, and every mutating `skills/hatch3r-*/SKILL.md`. Read-only or report-only workflows ask only when the report would be meaningless without scope clarification.

## Confidence-floor calibration (D13-SA13.3-F13.3.3)

The four-trigger set above is the floor for *scope/intent* ambiguity. Orthogonally, the `--confidence-floor=any|medium|high` flag (and the persisted `hatch3r config confidence_floor=...` default) calibrates a *result-confidence* ASK surface in the core orchestrators (`hatch3r-workflow`, `hatch3r-board-pickup`, `hatch3r-quick-change`, `hatch3r-revision`). At floor `high`, the orchestrator ASKs the user on every low-confidence finding regardless of severity — an additional, user-selected ASK trigger layered on top of the always-on four-trigger set. The floor never relaxes the four triggers; it only adds ASK pressure on uncertain results. Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`.

## Exemptions (D5-M5)

A subset of skills carry §0 only as a defensive Ambiguity & Safety Gate (Tier 1 reference cards) — they neither orchestrate sub-agents nor mutate files on their own. The exemption set:

1. **CLI tool reference skills** (`skills/hatch3r-cli-{fd,fzf,gh,jq,ripgrep,toolbox}/SKILL.md`) — single-tool usage references an agent consults inline. The §0 block on these files documents tool-specific scope/irreversibility hazards (e.g., `fd … -x rm` is destructive; `jq` redirecting over its own input truncates the file) so the calling workflow can resolve them before invoking the tool; it does NOT gate this skill's own execution because the skill performs no actions. The §0 phrasing on CLI skills is therefore advisory-to-caller, not gate-on-self. Removal of §0 from these files would lose the tool-specific hazard documentation; retention without misinterpretation requires this exemption rubric.
2. **Redirect / dispatcher skills** that exist solely to point the caller at another skill (e.g., `skills/hatch3r-cli-toolbox` redirects the caller to a category-specific tool by listing discriminators). These skills perform no writes; their §0 is the safety advisory for the downstream tool, not a gate on themselves.

How to declare the exemption in the skill body: a Tier 1 CLI/reference skill states `Tier 1 reference card — no fan-out` (or equivalent) in its Fan-out Discipline block AND keeps the §0 block as an advisory list of caller-resolvable hazards. The audit (D5.9 P8 B1 verification) treats the exemption as satisfied when both signals are present. Mutating skills (e.g., `skills/hatch3r-pr-creation`, `skills/hatch3r-handoff-prepare`) carry no exemption — §0 there is a hard gate on the skill's own writes.

## References

- `governance/CONSTITUTION.md` §2 P8 B1 (source directive).
- `agents/shared/user-question-protocol.md` (how to ask: triggers, native-tool preference, fallback template, anti-patterns).
- `agents/shared/quality-charter.md` §3 "Question Unclear Requirements", §8 "Escalate Ambiguity Early".
- `governance/audit/domains/D05-prompt-engineering.md`, `governance/audit/domains/D13-human-ai-collaboration.md` (audit the §0 gate per cycle).
