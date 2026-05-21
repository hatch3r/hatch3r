# Implementation Sub-Agent Template

> Last updated: 2026-04-20

**Pillars served:** P2 (primary), P4 (supporting).

## Task

Implement the following audit findings for [project name].
You are executing **Wave [N] of [M]** -- [severity level] findings.

## Wave Context

- Wave: [N] ([Critical/High/Medium/Low])
- Work Unit: [name/description]
- Concurrent work units in this wave: [list of other work units and their file scopes]
- Files shared with other work units: [list, if any]
- Baseline state: [pre-existing test failures, lint warnings, etc. from Phase 0]

## Findings to Implement

For each finding, provide:
- **Finding [ID]** (Registry: [registry_id]): [Action item description from Enhanced Action Items]
  - **Detail**: [Finding + Recommendation from Tier 2 — Domain Summaries]
  - **Files**: [Specific files to read and modify]
  - **Effort**: [S/M/L/XL]
  - **Domain**: [Domain number and name]
  - **Owner**: Agent / Mixed
  - **Depends On**: [Finding IDs this depends on, if any]
  - **Mixed decomposition** (Mixed items only):
    - Agent portion: [concrete, self-contained change]
    - Human portion: [what cannot be automated]
    - Boundary: [agent work is complete without human part]
    - Completion criteria: [how to verify agent portion]

## Requirements

1. **Read before writing.** Read every file you will modify before making changes.
   Understand the surrounding context, conventions, and patterns in use.

2. **Research when needed.** If the finding references external standards, platform
   documentation, or best practices, use web search to verify current guidance
   before implementing.

3. **Atomic changes.** Each finding should be a self-contained, correct change.
   Do not introduce partial implementations.

4. **Preserve existing behavior.** Do not break existing tests, introduce lint
   errors, or change unrelated code. If a finding requires modifying a public API,
   update every caller and verify with `grep` across the codebase.

5. **Follow project conventions.** Match the existing code style, naming patterns,
   and architectural patterns. Do not introduce new dependencies without explicit
   justification.

6. **No placeholders.** Every file must be complete and compilable. No `// TODO`,
   `// ...`, or `"existing code here"` stubs.

7. **Verify your work.** After all changes:
   - Run the test suite (`npm test`)
   - Run the type checker (`npx tsc --noEmit`)
   - Run the linter (`npm run lint`)
   - Fix any failures you introduced

8. **Mixed item boundaries.** For findings with Owner: Mixed, implement ONLY the
   agent-actionable portion as defined in the mixed decomposition. Mark the finding
   as PARTIAL in your results. Specify the remaining human action in your output.
   Do not attempt the human-required portion.

9. **Registry reporting.** Report results using registry IDs. For each finding,
   report: registry_id, status (done/partial/failed), and any notes. This enables
   the orchestrator to update the Finding Registry accurately.

10. **Root cause fixes.** Changes must address the root cause identified in
    the finding, not just the symptom. Adding a comment, suppressing a warning,
    wrapping in a try-catch without actual handling, or adding a `// validated`
    annotation is not a fix.

11. **Understand the "why" before implementing, then verify the fix
    addresses it.** Before writing any changes, read the finding's full
    justification and the referenced code path; understand the intent
    behind the recommendation, not just the literal change requested.
    If the intent is unclear, implement the conservative interpretation.
    After implementing, re-read the finding and confirm the change
    addresses the root cause, not the surface symptom (e.g., a finding
    about "inconsistent error handling" is not resolved by one try-catch
    — it must address the systemic pattern). If only the symptom can be
    addressed within your scope, mark the finding PARTIAL and explain
    what remains.

12. **Consider side effects.** If your change modifies a shared module,
    trace all callers to verify no downstream breakage. If your change
    modifies an adapter base class or utility function, verify all 3
    supported adapters (claude, cursor, copilot) or all consumers still
    work correctly. Use grep to find all references before editing.

13. **Source freshness re-check.** Before implementing any finding whose
    recommendation cites external research, re-fetch each cited URL from
    the finding's `sources` block per [rigor-contract.md](rigor-contract.md).
    If 404 or content has materially changed since the audit's `accessed`
    date, mark the finding PARTIAL and request re-research before
    proceeding. Do not implement against a stale source.

## Output Schema (MANDATORY)

Write your full results to:
`.audit-workspace/wave-{N}/{finding_id}.results.md`

Use exactly this schema:

```
## Finding {finding_id}
- Status: done | partial | failed
- Files modified: <comma list>
- Commit-ready: yes | no
- Rigor re-check: fresh | stale
- Causal chain addressed: yes (depth N) | no
- Notes: <≤3 sentences>

### Diff Summary
<bullet list of logical changes, ≤8 bullets>

### Risk Flags
<list any same-file concurrency you avoided, side effects observed>
```

## Reply to Orchestrator

Your chat reply MUST be a single line — nothing else:

`Finding {finding_id}: {status} → .audit-workspace/wave-{N}/{finding_id}.results.md`

Do NOT include diffs, file contents, or explanations in chat. The orchestrator reads them from your results file when needed.

## Constraints

- Do not modify files outside the scope of your assigned findings
- Do not refactor code beyond what the finding requires
- If a finding is ambiguous, implement the conservative interpretation
- If a finding conflicts with another finding in your set, flag it and
  implement whichever is safer
- **Wave discipline:** Do not fix issues outside your severity scope. If you
  notice a Medium-severity issue while implementing a Critical fix, note it
  but do not fix it -- it belongs to a later wave.
- **Conflict awareness:** If your work unit shares files with another work unit
  in this wave, coordinate changes to avoid conflicts. Make minimal, targeted
  changes to shared files.
- **Baseline awareness:** Pre-existing test failures (recorded in Phase 0) are
  NOT regressions. Only flag failures you introduce.
