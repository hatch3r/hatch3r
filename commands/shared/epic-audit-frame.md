---
id: hatch3r-epic-audit-frame
type: shared-context
description: Single source of truth for the epic-audit command scaffold — module-discovery taxonomy, Board Integration sync step, error-handling table, and guardrails — shared by the audit-epic-creating commands. Cited by healthcheck and security-audit via one-line pointers instead of restating the blocks.
tags: [board, reference]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---

# Epic-Audit Frame (shared audit-command scaffold)

> Last updated: 2026-07-11
> Pillars: P4 (Lean Coverage, primary — kills the epic-audit shell restated verbatim across the audit-epic commands), P7 (Speed & Token Efficiency, supporting — static cacheable frame).

Four scaffold blocks recur near-verbatim across the `commands/hatch3r-*.md` commands that open an audit epic, fan out one sub-issue per module, then sync the board (healthcheck, security-audit at the D22-SA22.2-03 measurement — the "open-epic → per-module fan-out → board-sync" shape). This file is their single source of truth. A command cites the block it needs with a one-line pointer and supplies only its per-command slots (spec-kind, epic-kind, epic label, extra guardrails); everything outside those slots is invariant and lives here.

The board-integration primitive itself — the Projects v2 Sync Procedure, Board Overview Template, and sub-issue linking — lives one level deeper in the `hatch3r-board-shared` skill; this frame's Board Integration block is the audit-epic Step 7 wrapper around it, not a competing definition. `board-fill` and `board-pickup` reach that same primitive directly through `hatch3r-board-shared` and do not use this wrapper.

Citation template (drop into the command where the block used to live):

```
> Epic-audit scaffold: see `commands/shared/epic-audit-frame.md` → {Module Discovery | Board Integration | Error Handling | Guardrails}. Per-command slot: <the varying detail — spec-kind, epic-kind, epic label, extra guardrails>.
```

`<…>` slots below are the only text a command varies; everything outside them is invariant and lives here.

---

## Module Discovery

The product is divided into logical modules. Discover modules from the project structure:

1. **Scan for modules:** Inspect top-level directories (e.g., `src/`, `functions/`, `packages/`) and identify logical units.
2. **Map to specs:** If `docs/specs/` exists, map each module to its relevant spec files.
3. **Build taxonomy:** Produce a table of modules with their directories and specs.

Example structure (adapt to project):

| # | Module | Directories | Specs |
|---|--------|-------------|-------|
| 1 | {Module} | `src/{dir}/` | `{spec}.md` |
| ... | ... | ... | ... |

The command then names its two Level-2 cross-cutting audits inline (they are referenced again by its scope presentation and its cross-cutting sub-issue step), each as a `| # | Audit | Scope |` row under a "Plus two cross-cutting audits:" line.

Per-command slot: `<spec-kind>` — the spec facet each module maps to. healthcheck uses the general form above as-is (primary specs). security-audit narrows step 2 to security-relevant spec files (threat model, permissions, data model, privacy docs) and notes the gap when no security-specific specs exist.

---

## Board Integration

Authoritative procedure: the **Projects v2 Sync Procedure** and **Board Overview Template** in the `hatch3r-board-shared` skill. This block is the audit-epic Step 7 wrapper around them.

All issue and epic operations in this command MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

1. **Projects v2 Sync:** Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary) for the <epic-kind> epic and ALL sub-issues. Set status to Ready using the project's status field option ID.
2. **Board Overview Regeneration:** Regenerate the Board Overview using the **Board Overview Template** from the shared context. Use cached board data from Step 1, updated with the newly created <epic-kind> epic. Skip silently if no board overview issue exists.

Per-command slot: `<epic-kind>` (e.g. "healthcheck" / "security audit").

---

## Error Handling

- `search_issues` failure: retry once, then warn and proceed (assume no existing <epic-kind>).
- `issue_write` failure: report the error, retry once. If still failing, present the drafted body for manual creation.
- `sub_issue_write` failure: report but do not delete the created sub-issue. Note the unlinking for manual fix.
- Projects v2 sync failure (gh CLI or MCP): warn and continue. Board sync can be fixed later via board-refresh.

Per-command slot: `<epic-kind>` in the first bullet (e.g. "healthcheck" / "security audit").

---

## Guardrails

- **Never skip ASK checkpoints.**
- **Use GitHub MCP tools for issue operations** (create, update, link). For Projects v2 board integration, follow the sync procedure from hatch3r-board-shared (gh CLI primary).
- **The command ONLY creates issues.** It does NOT execute any audits, run tests, or modify code.
- **Always include the `meta:<epic-label>` label** on the epic.
- **Always include `meta:<epic-label>-findings`** in the output instructions for audit sub-issues.
- **Preserve dependency ordering.** Level 2 sub-issues must reference all Level 1 sub-issues in their Dependencies section.
- **Board Overview is auto-maintained.** Exclude it from all analysis. One board overview issue at a time.
- **Do not expand scope.** The command creates exactly the discovered modules plus the two cross-cutting audits. No additional issue types.

Per-command slots:
- `<epic-label>` — the `meta:` label stem (healthcheck: `healthcheck`; security-audit: `security-audit`).
- `<extra-guardrails>` — any command-specific guardrails appended after the invariant set above (security-audit adds: never downgrade finding severity without explicit user approval; critical/high findings must always generate sub-issues; every finding references its security domain 1–8).
