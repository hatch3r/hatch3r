---
id: hatch3r-architecture-review
description: Evaluate architectural decisions and produce ADRs following the project template. Use when making architectural decisions, evaluating trade-offs, or creating ADRs.
---
# Architecture Review Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read existing ADRs and the template
- [ ] Step 2: Define the decision context — problem, constraints, options
- [ ] Step 3: Evaluate options — pros/cons, prototype if needed, check ADR constraints
- [ ] Step 4: For external library docs and current best practices, follow the project's tooling hierarchy
- [ ] Step 5: Write ADR following the template
- [ ] Step 6: Update affected specs or docs to reference the new ADR
```

## Step 1: Read Existing ADRs and Template

- Read all ADRs in project docs to understand current architecture and constraints.
- Read the ADR template (e.g., `docs/adr/0001_template.md` or equivalent).
- Template sections: Status, Date, Decision Makers, Context, Decision, Alternatives Considered, Consequences, Compliance, Related.
- Check if any existing ADR is superseded or conflicts with the proposed decision.
- Read foundational ADRs for invariants.

## Step 2: Define the Decision Context

- **Problem:** What issue or opportunity motivates this decision?
- **Constraints:** Technical (stack, performance budgets), organizational (timeline, team), regulatory (privacy, security).
- **Options:** List 2–4 viable alternatives. Include "do nothing" or "status quo" if relevant.
- **Stakeholders:** Who is affected? Who decides?

Reference:

- Performance budgets: project rules
- Privacy/security invariants: project rules and specs
- Data model: project documentation
- Event model: project documentation

## Step 3: Evaluate Options

- For each option, list **pros** and **cons**.
- Consider: complexity, maintainability, performance, security, cost, migration effort.
- Prototype or spike if uncertainty is high — document findings.
- Check against existing ADR constraints: does this align with core architecture?
- Use a comparison table (as in the template):

| Option | Pros | Cons |
| ------ | ---- | ---- |
| A      | ...  | ...  |
| B      | ...  | ...  |

## Step 4: External Research

- For external library docs and current best practices, follow the project's tooling hierarchy.
- **GitHub MCP:** Search for related issues, prior discussions, or similar decisions in the repo.
- **Context7 MCP:** Look up current API patterns for relevant libraries.
- **Web search:** For novel problems, security advisories, or best practices.

## Step 5: Write ADR

Follow the project ADR template:

- **Title:** `ADR-XXXX: Short descriptive title`
- **Status:** `PROPOSED` (draft) or `ACCEPTED` (approved)
- **Date:** YYYY-MM-DD
- **Decision Makers:** Names/roles
- **Context:** Problem, constraints, motivation
- **Decision:** What we are doing
- **Alternatives Considered:** Table with pros/cons
- **Consequences:** Positive, negative, risks
- **Compliance checklist:**
  - [ ] Aligns with privacy/security specs
  - [ ] Aligns with performance budgets
  - [ ] Does not introduce new dependencies without justification
- **Related:** Specs, issues, previous ADRs

Save as `docs/adr/XXXX_short-title.md` (or project convention). Use next available number.

## Step 6: Update Affected Docs

- Add references to the new ADR in relevant specs (e.g., data model, event model, quality engineering).
- Update ADR index if the project maintains one.
- Link from related GitHub issues or PRs.
- If superseding an ADR, update the old ADR's Status to `SUPERSEDED by ADR-XXXX`.

## Definition of Done

- [ ] ADR written following project template
- [ ] Options evaluated with pros/cons table
- [ ] Tooling-hierarchy followed for external research where relevant
- [ ] Compliance checklist completed
- [ ] Affected specs or docs updated to reference the ADR
- [ ] No privacy/security invariant violations
- [ ] Performance budgets considered
