---
id: researcher-mode-user-flows
type: mode
description: Decompose a user story into Happy Path + Alternative Paths + Error-Recovery Path before implementation.
tags: [ux, research, mode]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `user-flows`

Decompose each user story into three explicit flows before implementation: Happy Path, Alternative Paths, and Error-Recovery Path. Skipping this mode means the implementer codes from acceptance criteria alone and misses alternative paths plus error recovery. This mode runs inside `hatch3r-researcher` and gates `hatch3r-feature-plan` and `hatch3r-implementer`.

**Inputs:**

- User story (from `feature-plan` or `requirements-elicitation`)
- Acceptance criteria
- Known constraints (auth state, network conditions, device class, locale)

**Protocol:**

1. Take one user story and acceptance criteria pair at a time. Do not batch multiple stories into a single flow block.
2. Map the Happy Path step-by-step using `user action -> system response` notation. State the final visible state explicitly.
3. Enumerate Alternative Paths as branch points from numbered Happy Path steps. Cover at least: pre-filled data, user-adjusted inputs, and retry-after-edit.
4. Enumerate Error-Recovery Paths for the failure modes triggered by each async step: network timeout, validation failure, permission denied, conflict. Pair each error with the recovery control surfaced to the user.
5. For every branch and error, record the decision point: what data the system inspects, the default branch, and how the user overrides it.
6. Map every step that triggers an async operation to one of the four UI states (loading / empty / error / partial) per `rules/hatch3r-ux-states-and-flows.md`.
7. Draft microcopy for each user-visible string (button label, error message, empty-state heading) inline using GOV.UK + IBM Carbon style (plain language, second person, corrective verb). Cross-reference the Microcopy subsection of `rules/hatch3r-i18n.md` and `rules/hatch3r-ux-states-and-flows.md`.

**Output structure:**

```markdown
## User Flow Decomposition

### Story: {user story one-liner}

**Happy Path:** {one-line summary}
1. {user action} -> {system response}
2. {user action} -> {system response}
3. {user action} -> {system response}
Final state: {what the user sees}

**Alternative Paths:**
- {variant 1, e.g., "user has pre-filled data"} -> branch from step {N}
- {variant 2, e.g., "user adjusts filters"} -> branch from step {M}
- {variant 3, e.g., "user retries after edit"} -> branch from step {K}

**Error-Recovery Path:**
- {error 1, e.g., "network timeout at step 3"} -> retry control + cached state shown
- {error 2, e.g., "validation failure at step 2"} -> error summary + focus to summary + field anchors
- {error 3, e.g., "permission denied"} -> upsell or contact CTA

### Decision Points
| # | Branch | Data Inspected | Default | User Override |
|---|--------|---------------|---------|---------------|
| 1 | {branch label} | {fields or state the system reads} | {default branch taken} | {control or flow that overrides} |

### State Map
| Step | Async Operation | State Triggered | UI Surface |
|------|----------------|----------------|------------|
| 1 | {operation} | loading / empty / error / partial | {component or region} |

### Microcopy Draft
| Surface | String | Style Notes |
|---------|--------|-------------|
| {button / error / empty heading} | {drafted copy} | {plain language + second person + corrective verb} |
```

**Verification:**

- Every story has all three flows (Happy, Alternative, Error-Recovery) populated.
- Every async step maps to a state in the State Map.
- Every user-visible string has a microcopy draft.
- Missing any of the three flows or the state map blocks downstream `hatch3r-feature-plan` and `hatch3r-implementer`; this gate is enforced inside the implementer Convention Lock.
