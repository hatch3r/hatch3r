---
id: hatch3r-contract-census
type: rule
description: Shared-contract discipline for brownfield changes — contract taxonomy, repo-wide consumer census as lane-exit gate, seam-owner protocol for parallel lanes, façade contract-hold on field drop/rename, value-drift census for shared constants.
tags: [implementation, review, orchestration, ctx:brownfield-only]
precedence: high
scope: always
---
# hatch3r Contract Census

**Pillars:** P2 (Scientific & Practical Quality), P8 (Clarification & Fan-out Discipline), CQ8 (Maintainability Quality)

## Binding Condition

This rule binds any diff that mutates a contract in the Shared-Contract Taxonomy below, in a repo where that contract has existing consumers. A change touching no taxonomy class exits with `Consumer census: N/A (no shared-contract change)`. A greenfield-new contract with zero consumers exits trivially — the census grep returns nothing and reports `clean`.

The failure class this rule closes: parallel file-disjoint lanes silently breaking a shared runtime contract — a renamed persisted collection, a changed store symbol, a dropped wire field — that no quality gate and, in a no-static-types stack, no compiler checks. File disjointness is not contract disjointness: two lanes whose diffs share zero files still collide when both touch the same contract.

## Shared-Contract Taxonomy

Seven contract classes. Each line states why file-disjointness does not protect it.

- **(a) Exported symbol** — function, class, or store: its name, signature, or subpath. Importers live in other files by definition. (researcher: `api_signature` for signature changes, `public_interface` for name/visibility/subpath changes)
- **(b) Persisted collection/table/field name** — string-typed: writer and reader each spell the string independently; no compiler links them. (researcher: `data_migration`)
- **(c) Client↔server wire field** — a JSON key crossing the network: serializer and deserializer sit in different trees, often different languages. (researcher: `type_shape`)
- **(d) Event name + payload schema** — emitter and subscribers are decoupled by design; the bus hides the seam. (researcher: `event_schema`)
- **(e) Shared constant** — rate, default, threshold, or enum value: copies compile independently, and a stale copy computes wrong values with no error. (researcher: `type_shape` for enum members, `cli_contract` for surfaced defaults; value-only drift sits below the researcher's radar → §Value-Drift Census)
- **(f) CLI flag / config / env key** — the producer is code; the consumers are shell scripts, CI YAML, and dotfiles no type-checker loads. (researcher: `cli_contract`)
- **(g) Type or schema shape where no checker is authoritative** — plain JS, dynamic access, JSON blobs: shape agreement exists only by convention, so classes (a)-(f) all degrade to grep.

The parenthesized categories map classes (a)-(f) onto the researcher's breaking-change vocabulary — `api_signature / type_shape / event_schema / public_interface / data_migration / cli_contract` (`agents/hatch3r-researcher.md` → Full-Mode Breaking-Change Detection) — so a researcher Breaking Change Candidates row converts directly into a taxonomy class and back.

## Consumer Census

**Trigger:** any taxonomy mutation — rename, removal, re-signature, revalue, key add/drop.

**Procedure:**

1. Repo-wide grep of the OLD identifier AND the NEW identifier. Never limit the grep to the lane's `affectedFiles` — consumers live outside the lane's file set by definition.
2. Per-class patterns:
   - **String contracts** (classes b, d, f) — grep the quoted forms: `'name'` and `"name"` (plus template-literal and heredoc forms where the language has them).
   - **Wire fields** (class c) — grep BOTH the client and server trees, plus fixtures, mocks, and recorded payloads: a test fixture still asserting the old key is an unreconciled consumer.
   - **Constants** (class e) — grep the NAME and the literal VALUE; an independent copy defines the value without the name.
   - **Infra/config** (class f) — include non-code files: CI YAML, Dockerfiles, `.env*`, deploy manifests.
3. Narrowing tactics for short identifiers that over-match: qualified member access (`\.field\b`), collection-prefixed forms (`users.field`), and quoted-literal-only matches.

**Reconciled** — a consumer counts as reconciled when it is updated to the new shape in this diff, OR reads through a guard added in this diff (façade-hold null-guard), OR is justified by name. Exactly three justifications are valid:

1. Consumer owned by another lane's seam — name the lane/issue.
2. Dead code with a linked deletion.
3. Dynamic/reflective access grep cannot resolve — name the mechanism, add a runtime guard.

**Output grammar** — the census field emits exactly one of:

```
Consumer census: clean | reconciled(N) | N unreconciled — justification | N/A (no shared-contract change)
```

- `clean` — the grep found zero consumers of the old shape outside this diff.
- `reconciled(N)` — N consumers found; every one updated, guarded, or justified by name.
- `N unreconciled — justification` — N consumers not yet updated or guarded; each carries one of the three justifications above. `unreconciled` WITHOUT a named justification caps the producing agent's Status at PARTIAL — done is declared from grep evidence, not assumed (the large-scale-change discipline of *Software Engineering at Google* ch. 22).
- `N/A (no shared-contract change)` — the diff touches no taxonomy class.

**Spec-time seed:** when a brownfield spec exists, its Integration-Surface consumer inventory (`agents/hatch3r-brownfield-spec.md` → Integration-Surface Analysis) seeds the grep list. The lane still re-runs the grep at lane exit: parallel lanes may have added consumers since spec time.

**Where it runs:** `agents/hatch3r-implementer.md` Step 5d and `agents/hatch3r-fixer.md` Step 5b carry this census as a lane-exit gate — `Status: SUCCESS` requires census ∈ {`clean`, `reconciled(N)`, `N/A`}.

## Consumer-Scoped Review

The reviewer re-derives the census itself — a self-run grep of every changed contract's OLD and NEW identifier. The implementer's census field and the Phase-1 blast radius, when present, seed the list; neither substitutes for the reviewer's own grep.

The reviewer then OPENS and READS each consumer at its use site, both sides of every seam:

- serializer AND deserializer for a wire field;
- exporter AND importers for a store symbol;
- writer AND readers for a persisted name.

The verdict cites the captured grep output per the reviewer's Grounding rule. Severity: a consumer left reading the old shape is **Critical**; an implementer census of `unreconciled` without a named justification is **Critical**; a taxonomy diff with no census field at all is a **Warning** (protocol violation). Mirrors `agents/hatch3r-reviewer.md` item 11 (contract preservation, consumer-scoped, two-lens).

## Seam-Owner Protocol

A contract touched by ≥2 parallel lanes in the same batch gets exactly ONE owning lane: the lane whose acceptance criteria REQUIRE the mutation. The owner lands the emitter change AND all consumer reconciliation in one diff. Every peer lane's dispatch prompt gains the line:

```
Seam constraint: contract <X> is owned by issue #<N> this batch — consume the current shape; do not mutate it
```

Two lanes that BOTH require mutating the same contract are re-leveled sequential — the later lane consumes the owner's landed shape.

**Detection — two passes:**

1. First-pass textual scan of issue bodies and linked specs at batch triage: endpoint paths, collection/table names, event names, exported symbols, shared constants named in ≥2 issues (`commands/hatch3r-board-pickup.md` Step 3 item 5).
2. Authoritative cross-check before dispatch: union the per-issue researcher Breaking Change Candidates tables; any contract appearing in ≥2 issues of the same level is a collision (`commands/board/pickup-delegation-multi.md` Step 6c.2 item 4).

**Violation surface:** a post-batch semantic conflict on an owned contract names the violating peer lane. Reconciliation routes to the seam owner — one diff owns the contract; the conflict is never patched in the merge.

**Normative amendment to parallel safety:** the parallel-safety condition "disjoint writes" holds at file AND contract granularity (`rules/hatch3r-agent-orchestration.md` → parallel-safety conditions point here). Two lanes are NOT disjoint when their file-disjoint diffs mutate the same shared contract.

## Façade Contract-Hold

Never delete a field out from under consumers. On drop or rename of a shared output field:

1. **Hold the key-set** — the façade keeps emitting every key it emitted before, through the compatibility window.
2. **Hard-null the dropped field** — key present, value `null`. Absence is a silent shape change a consumer misreads without error; an explicit null fails loudly at the value, at the consumer, on the first read.
3. **Reconcile every consumer to guarded reads** — null-tolerant access, census-tracked: each guarded read counts as reconciled.
4. **Delete the key only at the contract phase** — when the census shows zero unguarded readers. This is Fowler's ParallelChange termination criterion: contract begins only "once all usages have been migrated"; skipping contract leaves you worse than you started (martinfowler.com/bliki/ParallelChange.html, accessed 2026-07-08).

**Renames** are a drop plus an add: the new key is added, the old key is held nulled or aliased through the window, and consumers migrate key-by-key under the census.

**Lane-exit question, answered verbatim before returning:**

**"Did you delete the field, or null it behind the façade?"**

"Deleted" during the compatibility window is a gate failure — revert to the hold pattern before returning.

**Precedence carve-out:** a held nulled field and its guarded reads are NOT dead code until the contract phase. The `rules/hatch3r-code-standards.md` dead-code reference sweep runs at the contract phase, when the held field is deleted — that rule carries the matching exception.

**Boundary:** this section is the in-code analog of expand-contract for the database (`rules/hatch3r-migrations.md`) and of the API field-removal lifecycle for public endpoints (`rules/hatch3r-api-versioning.md`). Those rules own their boundaries; this section owns every contract they do not load for — internal wire fields, store symbols, event payloads inside the app. Through the window the system builds and runs at all times, the BranchByAbstraction invariant.

## Value-Drift Census

A shared constant — rate, default, threshold, enum value — consumed by ≥2 features has exactly one owning module; every reader imports it. On touching such a constant:

1. Grep the constant NAME and the literal VALUE repo-wide.
2. Each independently-defined copy is a drift candidate.
3. Remedy per copy: import from the owner, or an inline ADR comment documenting intentional divergence.

**Damage ranking — silent-wrong beats loud-broken.** A deleted import fails at build; a stale copy computes wrong values in production with no signal.

One-line literals sit below clone-scan thresholds (≥30-line block matching) — this census is name+value grep, not block matching. `rules/hatch3r-anti-duplication.md` → Value-Drift Census carries the anti-duplication-side enforcement hook.

## Ownership Boundaries

| Surface | Owning artifact |
|---------|-----------------|
| Database schema (expand/migrate/contract, online DDL, backfill) | `rules/hatch3r-migrations.md` |
| Public API lifecycle (versioning, deprecation, `Sunset`) | `rules/hatch3r-api-versioning.md` |
| Event registry compatibility (BACKWARD/FORWARD/FULL) | `rules/hatch3r-event-schema-evolution.md` |
| Spec-time consumer inventory | `agents/hatch3r-brownfield-spec.md` → Integration-Surface Analysis |
| Code clones / block duplication | `rules/hatch3r-anti-duplication.md` |

This rule owns: internal cross-lane seams, the census output grammar, seam-owner assignment, the façade contract-hold, and value drift on shared constants.

## Enforcement Wiring

- `agents/hatch3r-implementer.md` Step 5d — consumer census as lane-exit gate.
- `agents/hatch3r-fixer.md` Step 5b — consumer census on shared-contract fixes.
- `agents/hatch3r-reviewer.md` item 11 — consumer-scoped review with self-run grep.
- `commands/hatch3r-board-pickup.md` Step 3 item 5 — first-pass contract-overlap scan at batch triage.
- `commands/board/pickup-delegation-multi.md` Step 6c.2 item 4 — seam-owner assignment; Step 6c.4 — per-lane census verification + cross-lane old-identifier grep.
- `agents/shared/quality-charter.md` → Data integrity quality — shared-contract census row + verification gate.
- `checks/code-quality.md` → Shared Contracts and Constants.

## References

- Fowler, M. "ParallelChange." martinfowler.com/bliki/ParallelChange.html (accessed 2026-07-08, T3 canonical, 2014). Expand/migrate/contract for any interface change; contract begins only "once all usages have been migrated" — skipping contract leaves you worse than you started.
- Fowler, M. "BranchByAbstraction." martinfowler.com/bliki/BranchByAbstraction.html (accessed 2026-07-08, T3 canonical, 2014). The system builds and runs at all times during the hold; the abstraction layer outlives the old supplier.
- Winters, T., Manshreck, T., Wright, H. *Software Engineering at Google*, ch. 22 "Large-Scale Changes." abseil.io/resources/swe-book/html/ch22.html (accessed 2026-07-08, T2, 2020). Tool-driven consumer discovery sharded by ownership; reintroduction guards; done is declared from evidence, not assumed.
- Sourcegraph. "Batch Changes." sourcegraph.com/docs/batch-changes (accessed 2026-07-08, T1, current). Text-search census as the consumer-discovery primitive; burndown-to-zero completion tracking.
- Pact. "can-i-deploy." docs.pact.io/pact_broker/can_i_deploy (accessed 2026-07-08, T1, current). Verification is recorded evidence per consumer; all known consumers gate the deploy.
