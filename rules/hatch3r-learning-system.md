---
id: hatch3r-learning-system
type: rule
description: Project-level learning system with structured frontmatter, auto-consolidation triggers, and mandatory consultation gate for Implementer + Reviewer + Researcher agents.
tags: [learning, knowledge-capture, floor:content-quality]
precedence: high
scope: always
---
# hatch3r Learning System

**Pillars:** P5 (Governance Self-Quality), P4 (Lean Coverage)

Project-level learnings live in the project's `.hatch3r/learnings/` directory. Canonical content authoring lives in this rule. Source: the Learning System principle and the learning-capture design decision (Decision #27).

## Learning Capture Triggers

1. **Non-trivial bug fix** — captures root cause + class + verified preventive measure
2. **Surprising codebase behavior** — undocumented invariant, hidden constraint, version-specific quirk
3. **User correction** — explicit feedback signaling a wrong assumption
4. **Verified pattern that worked** — non-obvious approach the user accepted on first attempt

Skip when: the finding is already documented in a rule, when the fix is purely cosmetic, when the context is too narrow to recur.

## Structured Frontmatter

Every learning in `.hatch3r/learnings/` carries:

```yaml
---
id: <YYYY-MM-DD-short-slug>
topic: <short topic, e.g., "vitest coverage thresholds">
applies-to: <file globs OR module paths, e.g., "src/merge/**">
confidence: high|medium|low
supersedes: [<id1>, <id2>]  # optional; auto-consolidation candidate
created: YYYY-MM-DD
---

<one-paragraph rule + Why: + How to apply: lines>
```

Field semantics:

- `id` — date-prefixed short slug; collisions resolved by appending `-2`, `-3`, etc.
- `topic` — match key for consultation lookup; one topic per learning. Multi-topic findings split into separate files.
- `applies-to` — glob or path prefix the learning binds to; consulted agents test the current file path against this set.
- `confidence` — high (verified via test or repeated observation), medium (single observation + reasoning), low (single anecdote, pending verification).
- `supersedes` — when set, archives the listed older entries on next consolidation pass.
- `created` — ISO date; used for age-based re-evaluation triggers.

## Canonical Schema — Single Source of Truth

The frontmatter block above is the sole authoritative schema for every learning file written to `.hatch3r/learnings/`. CONSTITUTION §6 Decision #27 names this rule as the canonical author. When a writer (the `hatch3r-learn` skill), a reader (`hatch3r-learnings-loader`, `hatch3r-learning-consult`), or a consultation gate (`agents/shared/quality-charter.md` §10) declares fields that diverge from this block, this rule wins; the other artifact is the defect.

Migration targets — fields some consumers still emit or scan that MUST converge on this block:

| Divergent field (consumer) | Canonical replacement |
|----------------------------|------------------------|
| `date` (learn skill) | `created` |
| `recorded` (learnings-loader provenance) | `created` |
| `category` + `area` + `tags` as match keys (learn skill / consult / loader) | `topic` (match key) + `applies-to` (path-glob binding) |
| `confidence: proven\|experimental\|hypothesis` (learn skill) | `confidence: high\|medium\|low` |
| `source` + `author` (learnings-loader) | derive from capture context; not part of the match schema |
| `supersedes` vs `superseded_by`/`deprecated` (learn skill) | `supersedes: [<id>, ...]` |

Enforcement gap (open): no validator binds learning files to this schema. A schema check (proposed for `scripts/` alongside `validate-rule-parity.ts`) must assert every `.hatch3r/learnings/*.md` carries `id`/`topic`/`applies-to`/`confidence`/`created` and rejects the divergent field names above. Until that validator ships, schema conformance is audit-time only.

## Integrity Hash — Single Source of Truth (D13-SA13.4-F10)

This section is the sole authoritative contract for the optional `integrity` frontmatter field on a learning file. Every other artifact that generates, verifies, or documents the integrity hash MUST reference this section rather than restate the contract (the restated-contract-drifts vs pointer-only-documents principle, CONSTITUTION §2 P5 Anti-Bloat Principle 1 Single Source of Truth). Consuming artifacts: `agents/hatch3r-learnings-loader.md` (verification on read), the `hatch3r-learn` skill (generation on write), and the enforcement implementation `src/content/learningsValidation.ts::persistLearning` (the runtime gate).

| Property | Contract |
|----------|----------|
| Algorithm | SHA-256. |
| Scope | The learning **body** content only — everything after the closing `---` of the frontmatter — `.trim()`-normalized (leading/trailing whitespace stripped) before hashing, so editors that add or strip a trailing newline do not change the digest. |
| Format | `integrity: sha256:{hex}` where `{hex}` is 64 lowercase hex chars. |
| Enforcement | `src/content/learningsValidation.ts::persistLearning` computes the digest via `computeLearningIntegrity(body)` and, when an `expectedIntegrity` is supplied, refuses to write on mismatch (closes the in-memory tamper window between extract and write). The digest is always computed for audit visibility even when not compared. |
| Verification on read | A reader (e.g., `hatch3r-learnings-loader`) recomputes the digest of the trimmed body and compares against the field; a mismatch or a missing field downgrades the entry to `confidence: low` (it is not excluded — missing integrity is a quality issue, not an injection trigger). |
| Threat model | Tamper DETECTION (accidental or unnoticed edits), not cryptographic signing. Rationale + the forward-compatible upgrade path to `hmac-sha256:`/`ed25519:` are documented in `agents/hatch3r-learnings-loader.md` → "Design Choice: Hash-Based Integrity". |

## Injection Gate — Deterministic, Not LLM Self-Policing (D6-7)

Context-poisoning defense for learnings (and handoffs) is a deterministic JS read-path gate, not agent prose. A loader agent instructed to "sanitize before consuming" cannot enforce that on itself — it is the actor being hijacked and has no JS runtime. The enforcement point is `src/content/learningsValidation.ts::validateLearningsDirectory`, which scans every `.hatch3r/learnings/*.md` for the denied-pattern set plus the `LEARNINGS_INJECTION_PATTERNS` catalog (`P-LEARN-01..05`, defined in `agents/shared/injection-patterns.md` §B) and returns the matches in an `injectionHits[]` field.

| Property | Contract |
|----------|----------|
| Auto-run trigger | Every `hatch3r sync` and `hatch3r update` runs the scan on the materialization write path BEFORE any adapter pours `.hatch3r/learnings/` into a tool context file. It is no longer opt-in to `hatch3r validate`. |
| Block on hit | A non-empty `injectionHits[]` refuses the run with exit code 2 (`VALIDATION_ERROR`); `--force` overrides and materializes as-is. Structural errors (oversize, binary, malformed name) block the same way. |
| Handoffs parity | `src/content/handoffs/validation.ts::validateHandoffsDirectory` runs on the same path; it already classifies `P-LEARN` hits + integrity mismatch + malformed frontmatter as blocking `errors`. |
| Per-file defense-in-depth | `loadValidatedLearnings` additionally skips an individual poisoned file from materialization even under `--force`, routing the skip through `.failures.log`. |

## Mandatory Consultation Gate

Before answering project-specific questions, these agents MUST read `.hatch3r/learnings/INDEX.md` and any `applies-to` matched entries:

- `hatch3r-implementer`
- `hatch3r-reviewer`
- `hatch3r-researcher`
- `hatch3r-fixer`

Bound agents cite consulted entry IDs in the iteration summary's `Open Questions / Blockers` or a dedicated `Consulted Learnings:` line. Citing zero entries when `applies-to` matched is a gate failure visible at audit time.

When `.hatch3r/learnings/INDEX.md` does not exist or contains zero entries: consultation step is recorded as "no learnings available" in the iteration summary and the agent proceeds.

## Mid-Edit Learning Surfacing

The Mandatory Consultation Gate fires once, before work starts (write-then-consult). State-of-art assistants additionally surface knowledge *during* the edit (ambient-teach). To close that gap without runtime support, bound agents surface relevant learnings inline as they touch files:

- **Trigger:** while editing, when the file or pattern being changed matches a captured learning, surface that learning inline in the iteration summary BEFORE completing the edit (not only at Step 0).
- **Relevant-learning criteria** (any one qualifies): (1) **path overlap** — the edited path matches the learning's `applies-to` glob; (2) **applies-to match** — an explicit module/path-prefix hit; (3) **semantic overlap** — the edit intent matches the learning `topic` (e.g. editing a retry path while a `topic: retry-backoff` learning exists).
- **Surfacing format:** add a `Surfaced Learnings:` line to the iteration summary citing the entry IDs and a one-clause why-relevant; cite zero only when none matched.
- **Bound agents:** `hatch3r-implementer`, `hatch3r-fixer` (the code-mutating agents whose edits benefit most). This complements — does not replace — the once-per-run Consultation Gate above.

## Auto-Consolidation

Triggers consolidation when:

1. Two or more learnings share the same `topic` AND overlapping `applies-to` — merge by retaining the highest-confidence entry plus a one-line summary referencing the merged IDs; archive the others to `.hatch3r/learnings/archive/`.
2. A newer learning sets `supersedes:` — older entries archived to `.hatch3r/learnings/archive/` with a forwarding pointer in the archive header.
3. Confidence on a 90-day-or-older learning is contradicted by recent commits or test runs — re-evaluate confidence; downgrade to `low` or archive if the contradiction is verified.

Consolidation is an agent-performed pass: the capturing skill or orchestrator runs it (reading + archiving with file tools per `skills/hatch3r-learn/SKILL.md` → Learning Lifecycle) at the end of every meaningful session that captured a new learning, or on demand when a maintainer asks. There is no `hatch3r learnings consolidate` CLI subcommand — the only learnings CLI is `hatch3r learn capture` (a single-file guarded write). The pass is idempotent.

## INDEX.md Format

`.hatch3r/learnings/INDEX.md` is an agent-maintained file: the capturing skill or orchestrator regenerates it from the directory contents after every capture or consolidation (Capture Workflow step 2 below; no CLI writes it). Format:

```markdown
# Learnings Index

| ID | Topic | Applies-To | Confidence | Created |
|----|-------|------------|------------|---------|
| <id> | <topic> | <applies-to> | <confidence> | <created> |
```

Sorted by `created` descending. Archived entries are not listed. Bound agents scan the table first and read only matched-row files.

## Capture Workflow

When a trigger fires:

1. The capturing agent writes a new file `.hatch3r/learnings/<id>.md` with the structured frontmatter and a body paragraph (rule + Why + How to apply).
2. The agent regenerates `.hatch3r/learnings/INDEX.md` from the directory contents.
3. The iteration summary records the captured learning ID under `Learnings Captured`.

Project-local; learnings never escape the project boundary. The canonical framework repository's `agents/` and `rules/` do not consume project learnings.

## Outcome-Weighted Promotion (D13 — outcome quality, not reference count)

Reference count alone is a popularity signal, not a quality signal. A bad learning consulted by every implementer is still bad. To promote learnings by outcome quality rather than raw consultation count, the consulting agent emits an `outcome` field after the iteration completes:

```yaml
outcome: helpful|neutral|harmful|untested
```

- `helpful` — applying the learning produced a verified pass (test green, review clean, no fixer churn).
- `neutral` — learning was read but not directly applied.
- `harmful` — applying the learning produced a regression (test red, review rejected, fixer reverted).
- `untested` — applying was inconclusive (no verification ran or signals were ambiguous).

After every meaningful run that consulted at least one learning, the orchestrating agent appends one line per consulted entry to `.hatch3r/learnings/.usage.jsonl` with its file tools — append-only (never rewrite prior rows), one whole line per write to match the single-atomic-append discipline of `src/merge/safeWrite.ts` (the agent follows that pattern; it does not call the function — there is no `.usage.jsonl` CLI writer):

```json
{"ts": "<ISO-8601>", "learning_id": "<id>", "agent": "<consumer agent id>", "outcome": "helpful|neutral|harmful|untested", "session_id": "<id>", "verification": "<test-pass|review-clean|test-fail|fixer-revert|none>"}
```

Promotion / demotion at the next auto-consolidation pass:

1. Rolling 20-row outcome window per `learning_id`.
2. `helpful` ratio >=70% → promote confidence one band (low→medium, medium→high).
3. `harmful` ratio >=30% → demote confidence one band (high→medium, medium→low) and flag for review.
4. `harmful` ratio >=50% → archive automatically with `archive_reason: outcome-harmful` in the archived file's frontmatter.

Outcome telemetry never leaves the project boundary. The `.usage.jsonl` is project-local and excluded from any sync to the canonical corpus.

## Pillar Service

- P5 — learning system applies to itself via auto-consolidation (no learning bloat)
- CQ8 (content-quality.Maintainability) — patterns reused across iterations reduce duplication

## References

- The Learning System principle — surface prior learnings before acting (accessed 2026-05-26, trust tier: canonical)
- The learning-capture design decision (Decision #27) + pillar P5 (accessed 2026-05-26, trust tier: canonical)
- `agents/shared/quality-charter.md` §10 Consult Prior Learnings (accessed 2026-05-26, trust tier: canonical)
- `rules/hatch3r-learning-consult.md` — companion rule for consultation procedure (accessed 2026-05-26, trust tier: canonical)
