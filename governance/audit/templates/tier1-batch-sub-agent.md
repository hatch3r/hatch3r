# Tier 1 Batch Sub-Agent Template

> Last updated: 2026-05-26

**Pillars served:** P7 (primary — speed and token efficiency), P2 (rigor preservation), P4 (lean coverage).

## Task

Apply the same mechanical fix-shape to multiple audit findings in one sub-agent invocation. Every finding in your work unit shares the same `tier1_pattern` (closed enum from `governance/AUDIT-EXECUTE.md` §Tier Classification §Tier 1) and lives on a unique single file (no cross-batch file conflicts).

## Wave Context

- Wave: [N] ([Critical/High/Medium/Low])
- Work Unit: `tier1-batch:<pattern>:<batch_index>` (1–30 findings)
- `tier1_pattern`: [one of `anti_slop_swap` / `currency_header_add` / `doc_count_update` / `frontmatter_field_add` / `typo_fix` / `version_bump` / `lint_disable_removal`]
- Concurrent work units in this wave: [list]
- Baseline state: [pre-existing test failures, lint warnings, etc. from Phase 0]

## Findings to Implement

For each finding, the registry provides:
- **Finding [ID]**: [single-file path], `causal_chain_depth`, `sources`, `tier1_pattern`
- **Detail**: [Fix-shape-specific detail — e.g., the banned word and its replacement, the count to update, the typo to fix]

## Pattern Definitions

Pick the procedure for your assigned `tier1_pattern`:

- **`anti_slop_swap`** — Read the file, locate the banned phrase from `governance/CONSTITUTION.md` §2 P5 wordlist, replace with the prescribed alternative (or rewrite the surrounding clause if the swap doesn't compose). Verify the replacement carries a measurable qualifier when required by the Anti-Slop Wordlist.
- **`currency_header_add`** — Read the file. If a `> Last updated: YYYY-MM-DD` header is missing within the first three lines, add it. If it exists but is older than the commit date, refresh the date.
- **`doc_count_update`** — Read the file, run the verification command (`ls`/`find`) referenced in the finding to get the current actual, replace the stated count with the actual.
- **`frontmatter_field_add`** — Read the file's YAML frontmatter, add the declared key with the declared value. Do not modify other keys.
- **`typo_fix`** — Read the file, locate the typo, replace with the corrected single word.
- **`version_bump`** — Read the file (`package.json` or `hatch.json`), bump the version field per the finding's target.
- **`lint_disable_removal`** — Read the file, remove the `// eslint-disable-next-line <rule>` comment. Run `npm run lint -- <file>` mentally to confirm the rule now passes; if it doesn't, mark this finding `failed` with `tier1_pattern_mismatch` and continue.

## Enum Extension Protocol

New `tier1_pattern` values flow via CL-3 proposal. Proposal MUST specify:
1. **Pattern name** (snake_case verb_phrase, e.g., `references_section_add`)
2. **Eligibility:** severity bucket (Low/Info only), effort=S, single-file, non-source
3. **Verification command** — what the SA runs to confirm the pattern applies (e.g., `grep -c "^## References" $FILE`)
4. **Failure mode** — what triggers `tier1_pattern_mismatch` (e.g., file has multiple ## References sections)
5. **≥3-cycle observation** of recurrence justifying batch treatment

Approved patterns added to `governance/AUDIT-EXECUTE.md` §Tier Classification §Tier 1 enum + this template's §Pattern Definitions in same CL-3 batch.

## Per-Finding Procedure

Iterate over your assigned findings in registry order. For each:

1. **Read** the target file.
2. **Verify** the `tier1_pattern` is editable as expected (the banned word actually appears, the typo is present, the version is below target, etc.). If verification fails: write a `failed` results file with `Notes: tier1_pattern_mismatch`, mark the finding for promotion to `execution_tier = 3` next wave, continue to the next finding.
3. **Apply** the mechanical edit using the Edit tool. Single file, single fix-shape. No refactoring beyond the pattern definition.
4. **Write** `.audit-workspace/wave-{N}/{finding_id}.results.md` with the schema below — one results file per finding, even when many findings share this batch sub-agent.

## Output Schema (per finding)

```
## Finding {finding_id}
- Status: done | failed
- Files modified: <single file path>
- Commit-ready: yes | no
- Rigor re-check: fresh | stale
- Causal chain addressed: yes (depth N) | no
- Notes: tier1_pattern: <enum>; execution_tier: 1; <≤2 sentences>

### Diff Summary
<one bullet describing the mechanical change>

### Risk Flags
<usually empty; same-file concurrency avoided by Tier Classification rule 3>
```

Carry `causal_chain_depth` and `sources` from the registry into each results file. The rigor contract holds for Tier 1 — the sub-agent records the same provenance the audit found, just executes a mechanical fix instead of a single-finding deep implementation.

## Reply to Orchestrator

Your chat reply MUST be a single line summarizing the batch outcome — one line, not one per finding:

`Batch tier1-batch:{pattern}:{batch_index}: {N_done} done, {N_failed} failed → .audit-workspace/wave-{N}/`

The orchestrator reads each `{finding_id}.results.md` to populate the wave SUMMARY.md.

## Constraints

- One file per finding. If the registry lists multiple files for a single finding, the classifier mis-routed it — flag the finding as a classifier-bug and mark `failed`.
- No source code edits. The classifier excludes paths under `src/` and `src/__tests__/` (Tier Classification rule 2). Reaching this template with such a path is a classifier-bug.
- No cross-pattern fixes. If you notice a different `tier1_pattern`-eligible problem in the same file (e.g., you're fixing a typo and notice a stale currency header), do NOT fix it — it belongs to a different batch in this or the next wave.
- **Wave discipline:** Do not fix issues outside your assigned `tier1_pattern`.
- **Baseline awareness:** Pre-existing test failures (recorded in Phase 0) are NOT regressions.

## Failure Threshold (per-batch)

If more than 30% of findings in your batch produce `tier1_pattern_mismatch`, stop the batch (do not edit further), write the failed results files, and report the high mismatch rate in your one-line reply: `Batch tier1-batch:{pattern}:{batch_index}: HIGH MISMATCH ({pct}%) — halting`. The orchestrator's gate aggregates per-pattern mismatch rates; >20% across a wave triggers re-triage.
