---
id: hatch3r-iteration-summary
type: rule
description: Every user-facing iteration ends with the canonical Iteration Summary block — a 5-field contract exposing status, gaps, and confidence at a glance.
scope: always
tags: [core]
quality_charter: agents/shared/quality-charter.md
precedence: high
cache_friendly: true
---
# Iteration Summary Contract

Every iteration with the user ends with the canonical block defined below — not a free-form prose paragraph. The block appears at the very end of the assistant turn, after any code, explanations, or tool-call results.

## When This Applies

Every user-facing iteration, regardless of size — multi-step coding tasks, single-file edits, read-only answers, failed or blocked attempts. No exceptions.

The per-turn pipeline-state header (defined in `hatch3r-agent-orchestration` → Per-Turn Pipeline-State Header) is a separate start-of-turn artifact and does not replace this end-of-turn block.

## The Required Block

Use this exact shape with these exact field names:

```markdown
## Iteration Summary

**Status:** SUCCESS | PARTIAL | FAILED | BLOCKED
**Outcome:** {one sentence — the bottom line}

**Done:**
- {what was completed this iteration}

**Not Done / Deferred / Unverified:**
- {required even if "None — full scope completed"}

**Open Questions / Blockers:**
- {required even if "None"}

**Confidence:** high | medium | low — {one-sentence basis}
```

`Status` is a closed enum:

- **SUCCESS** — all in-scope work completed and verified.
- **PARTIAL** — some in-scope work completed; remainder listed under Not Done.
- **FAILED** — attempted but did not produce a usable result; reason in Outcome.
- **BLOCKED** — cannot proceed without user input or external resolution.

## Optional Sections

Append only when they carry information. Do not include empty headers.

```markdown
**Artifacts Touched:**
| Path | Action | Notes |
| ---- | ------ | ----- |
| {file} | created/modified/deleted | {one line} |

**Verifications Run:**
| Check | Result |
| ----- | ------ |
| {command or test} | pass/fail/skipped |

**Earliest Failure Point:** {file:line or step name}  ← only when Status ≠ SUCCESS

**Suggested Next Action:** {one line}
```

## Field Semantics

- **Outcome** is one sentence. The user should grasp what happened from this line alone.
- **Done** lists completed actions, not intentions. "Wrote tests" beats "Will write tests".
- **Not Done / Deferred / Unverified** is required and may not be silently skipped. If full scope was completed, write `None — full scope completed`. If anything was attempted but not verified, list it here, not under Done.
- **Open Questions / Blockers** surfaces ambiguity proactively. Write `None` only after checking.
- **Confidence** uses the quality charter §1 scale. The one-sentence basis must name what was verified (high), what pattern was followed (medium), or that the answer is professional judgment (low).

## Anti-Patterns

- Substituting a prose paragraph for the block.
- Omitting the `## Iteration Summary` anchor — downstream agents and orchestrators locate the block by this header.
- Writing "None" reflexively without checking — list the uncertainty when in doubt.
- Inflating confidence — if you did not verify, say medium and name the unknown.
- Burying unverified work in `Done` — attempted-but-not-verified belongs in Not Done / Unverified.

## Reference

Confidence semantics: `agents/shared/quality-charter.md` §1.
