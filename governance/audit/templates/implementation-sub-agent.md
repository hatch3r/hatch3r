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
   ensure all callers are updated.

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

11. **Understand the "why" before implementing.** Read the finding's full
    justification and the referenced code path before writing any changes.
    Understand what the finding is trying to achieve — the intent behind
    the recommendation — not just what it literally says to change. If the
    intent is unclear, implement the conservative interpretation.

12. **Consider side effects.** If your change modifies a shared module,
    trace all callers to verify no downstream breakage. If your change
    modifies an adapter base class or utility function, verify all 14
    adapters or all consumers still work correctly. Use grep to find
    all references before editing.

13. **Verify fix addresses root cause.** After implementing, re-read the
    original finding and confirm your change addresses the root cause
    identified in the finding, not just the surface symptom. A finding
    about "inconsistent error handling" should not be fixed by adding
    one try-catch — it should address the systemic pattern. If you can
    only address the symptom within your scope, mark as PARTIAL with
    an explanation of what remains.

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
