---
id: hatch3r-adr-template
type: shared-context
description: Single source of truth for the ADR (Architectural Decision Record) artifact skeleton emitted by the planning commands. Cited by bug-plan, feature-plan, project-spec, refactor-plan, and test-plan via a one-line pointer instead of restating the ~30-line skeleton.
tags: [planning, reference]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---

# ADR Template (shared artifact skeleton)

> Last updated: 2026-07-11
> Pillars: P4 (Lean Coverage, primary — kills the ~30-line ADR skeleton restated verbatim across the 5 planning commands), P7 (Speed & Token Efficiency, supporting — static cacheable frame).

The ADR-emission skeleton recurs near-verbatim across the `commands/hatch3r-*.md` planning commands that write `docs/adr/` artifacts (bug-plan, feature-plan, project-spec, refactor-plan, test-plan — the 5 files whose ADR body carries the `# ADR-{NNNN}` heading at the D22-SA22.2-02 measurement). This file is its single source of truth. A command cites the skeleton with a one-line pointer and supplies only its per-command slots (the `## Context` guidance, an optional `## Decision` tail, and the `## Related` back-reference); everything outside those slots is invariant and lives here.

Citation template (drop into the command where the ADR skeleton used to live):

```
> ADR artifact template: see `commands/shared/adr-template.md` → ADR Skeleton. Per-command slots: context-guidance = "<## Context reason>"; related-ref = "<## Related bullet, or `none` for the dual-lens variant>".
```

`<…>` slots below are the only text a command varies; everything outside them is invariant and lives here.

---

## ADR Skeleton

Emit one ADR per decision to `docs/adr/{NNNN}_{decision-slug}.md`. Determine the next sequential `{NNNN}` by scanning existing files in `docs/adr/` (`0001`, `0002`, …); use slugified decision titles (lowercase, hyphens).

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Context

{Why this decision is needed — <context-guidance>}

## Decision

{What was decided and why<decision-guidance>}

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| {option} | {pros} | {cons} | {reason} |

## Consequences

### Positive
- {consequence}

### Negative
- {consequence}

### Risks
- {risk}: {mitigation}

## Related

- <related-ref>
```

Per-command slots:
- `<context-guidance>` — the command-specific reason filling the tail after `Why this decision is needed — ` (e.g. bug-plan: "the bug revealed a systemic issue that requires an architectural response, not just a point fix"; refactor-plan: "the refactoring goal, the current state problem, and why a design choice must be made"). A command whose lead-in differs supplies its full `## Context` placeholder line instead (test-plan opens "Why this testing infrastructure decision is needed — …").
- `<decision-guidance>` — OPTIONAL. Left empty by default (`{What was decided and why}`); a command that scopes the decision phrasing supplies the tail (refactor-plan: " — which approach, pattern, or technology was chosen").
- `<related-ref>` — the single back-reference bullet under `## Related` pointing at the command's source artifact (e.g. bug-plan: "Investigation report: `docs/investigations/{NN}_{bug-slug}.md`"; feature-plan: "Feature spec: `docs/specs/{NN}_{feature-slug}.md`"). Supply `none` to drop the section entirely (dual-lens variant).

### Dual-lens variant (project-spec)

`hatch3r-project-spec` emits business-and-technical ADRs that carry two extra headed fields and no back-reference. Its variant of the skeleton above: insert

```markdown
## Scope

{Technical / Business / Both}

## Decision Makers

{tbd}
```

between `## Date` and `## Context`, and set `related-ref = none` so the trailing `## Related` section is omitted (project-spec ADRs are indexed by sequence, not linked to a single source spec). All other rows are invariant.
