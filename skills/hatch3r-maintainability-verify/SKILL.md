---
id: hatch3r-maintainability-verify
name: hatch3r-maintainability-verify
type: skill
description: Maintainability verification gate before commit/release — jscpd duplication index, pattern reuse ratio, cyclomatic complexity, expand-contract migrations, API breaking-change discipline, ADR presence
tags: [review, maintainability, code-standards, floor:content-quality]
scope: conditional
globs: "src/**,**/migrations/**,**/db/migrations/**,**/prisma/migrations/**,openapi.yaml,openapi.json,**/*.proto,**/schema.graphql,**/docs/adr/**"
precedence: normal
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Maintainability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping code, schema migrations, or API spec changes. Run before declaring a feature complete. The 8 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (API breaking-change diff at release-cut). Skipping any gate = the feature is not done. Reviewer approval and passing tests alone do not satisfy this bar — a destructive single-deploy schema change ships data loss; a breaking change without a major bump breaks consumers silently.

Inputs the skill expects:

- A repository with `src/` source modules (or equivalent).
- Migration files under `migrations/`, `db/migrations/`, `prisma/migrations/`, or framework-equivalent.
- API spec files (`openapi.yaml`, `openapi.json`, `*.proto`, GraphQL SDL).
- An ADR directory (`docs/adr/`, `doc/adr/`) when architectural decisions are touched.
- Tooling: `jscpd` (duplication), `eslint` with `complexity` rule (JS/TS) or `radon` (Python) or `lizard` (polyglot), `oasdiff` (REST), `buf breaking` (Protobuf), `graphql-inspector diff` (GraphQL).

Outputs the skill produces: an 8-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/maintainability-verify-<sha>.json` for downstream consumption by `hatch3r-release`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Default path, not exception. Triggers for THIS skill: module scope (single directory vs package boundary vs whole repo), gate selection (duplication-only vs complexity-only vs migration-only vs API-breaking-only vs full), threshold tier per maturity (solo vs team vs scaleup vs enterprise), and refactor authority (propose extraction vs report-only).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each maintainability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-maintainability.md` — invokes this skill as the closing maintainability gate (CQ8) on PRs touching code, schema, or API spec. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 8-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW.

## Gate 1: Duplication index ≤5%

- Command: `npx jscpd <scope> --threshold 5 --reporters json --output .jscpd-report.json --min-lines 30 --min-tokens 50`.
- Pass criterion: exit code 0. Non-zero exit = breach; report the percentage and file pairs.
- Tool reference: Rabin-Karp tokenizer, 223+ language support per `jscpd.dev`.
- Attach the top 3 offending pairs in the finding.

## Gate 2: Pattern-reuse ratio ≥70%

- Command: `grep -rE '(<NamedPattern>)' <diff-paths>` against the named-pattern list in `rules/hatch3r-code-standards.md`.
- Computation: `reused / (reused + newly-authored) ≥ 0.70`.
- Record raw numerator and denominator in the finding body.
- Bias check: a 1/1 ratio is suspect (sample-size availability bias) — flag for adversarial review.

## Gate 3: Cyclomatic complexity per function ≤10

- JS/TS: ESLint with `complexity: ["error", 10]`.
- Python: `radon cc -n C <scope>` (grades C and below = complexity >10).
- Polyglot: `lizard --CCN 10 <scope>`.
- Every function above threshold is a finding with `file:line` + CCN score. Refactor recommendation cites the named extraction pattern (guard clause / strategy / table-driven dispatch / early return).

## Gate 4: Documentation currency ≤180 days on user-facing API surfaces

- Compute Δ = `mtime` of API-reference docs minus latest mtime of the corresponding spec file.
- If Δ > 180 days OR spec mtime > docs mtime, flag as stale.
- Cross-check against `git log --follow` on the spec file to detect undocumented behavioral changes.

## Gate 5: Expand-contract migration conformance 100%

- For every migration in the diff, verify the 3-deploy (expand → migrate → contract) or 4-deploy variant per Wellhausen + Fowler ParallelChange.
- Reject destructive single-deploy schema changes per `rules/hatch3r-migrations.md`.
- Online-DDL tooling required on tables above the documented size threshold (`pt-online-schema-change` / `gh-ost` / platform-native online DDL).
- Reversibility: every forward migration declares a documented rollback path.
- Replica-lag awareness: backfills are idempotent + resumable + throttled to a documented lag budget.

## Gate 6: API breaking-change events on stable endpoints = 0 per release

- REST: `oasdiff breaking <base> <head>` exit-code 0 (450+ breaking-change rules per `oasdiff.com`).
- Protobuf: `buf breaking --against <base>` exit-code 0.
- GraphQL: `graphql-inspector diff <base> <head>` with no `BREAKING` rule hits.
- CI gate blocks merge on any breach.
- Deprecation timeline + `Sunset` (RFC 8594) + `Deprecation` (RFC 9745) headers required per `rules/hatch3r-api-versioning.md` when intentionally removing a stable endpoint behind a major-version bump.

## Gate 7: Named pattern adoption on cross-cutting concerns

- Required named patterns: circuit-breaker, retry-with-decorrelated-jitter, error-handler, idempotency-key handler.
- Each must use the project's named abstraction, not ad-hoc inline code.
- Verified by grep against the abstraction's import path; record import-path hit count per pattern.
- Ad-hoc instances at ≥2 call sites are Medium findings (rule-of-three: single-site ad-hoc acceptable; ≥2 = duplication signal demanding the named abstraction).

## Gate 8: ADR present for every architectural decision

- For every non-trivial decision touched by the diff (per `rules/hatch3r-code-standards.md` ADR-trigger list), an ADR file exists under `docs/adr/` (or `doc/adr/`).
- Status field ∈ {Proposed, Accepted, Superseded, Deprecated} per Nygard format.
- Immutability: an Accepted ADR is never edited in place — superseded ADRs are added as new files referencing the prior.
- Missing ADR on a decision-class change → Medium finding; status field outside the four values → High.

## Pass criteria

All 8 gates pass = the feature is "done". Anything less = not done.

- Duplication index: ≤5% (jscpd exit 0).
- Pattern-reuse ratio: ≥70% across the diff.
- Cyclomatic complexity: ≤10 per function (ESLint / radon / lizard exit 0).
- Doc currency: ≤180 days vs spec file mtime.
- Migration conformance: 100% expand-contract; 0 destructive single-deploy changes.
- API breaking-change count: 0 on stable endpoints per release.
- Named pattern adoption: ≥2 ad-hoc instances trigger the named abstraction.
- ADR presence: 100% on decision-class changes per ADR-trigger list.

## On fail

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of reviewer approval status.

Failure escalation per `agents/hatch3r-maintainability.md` Boundaries → Never section: API breaking change on stable endpoint without major bump → CRITICAL; destructive single-deploy schema change → CRITICAL; missing ADR on decision-class change → High; complexity threshold breach on a single function → Medium; duplication index 5-10% → Medium; >10% → High.

## When this skill runs

- Reviewer on every PR that mutates code, schema, or API spec.
- Implementer post-write to scan own diff for duplication before declaring completion.
- Reviewer pre-merge gate runs the full CQ8 suite (duplication + complexity + pattern-reuse + migration + API-breaking + ADR-presence) and blocks merge on any breach.
- Schema-change audits on any migration file under `migrations/`, `db/migrations/`, `prisma/migrations/`.
- API-change audits on any diff touching `openapi.yaml`, `openapi.json`, `*.proto`, GraphQL SDL.
- Release-prep audit as part of the CQ8 floor verification before publishing.

## Cross-References

- `rules/hatch3r-migrations.md` — expand-contract spec.
- `rules/hatch3r-api-design.md` — RFC 9457 error format + spec-first mandate.
- `rules/hatch3r-api-versioning.md` — deprecation timeline + Sunset header policy.
- `rules/hatch3r-code-standards.md` — pattern-reuse precedence + complexity threshold + ADR-trigger list.

## References

- jscpd — `jscpd.dev`
- oasdiff — `oasdiff.com`
- buf breaking — `docs.buf.build/breaking/overview`
- graphql-inspector — `graphql-inspector.com/`
- Martin Fowler ParallelChange — `martinfowler.com/bliki/ParallelChange.html`
- Tim Wellhausen Expand and Contract — `www.tim-wellhausen.de/papers/ExpandAndContract/ExpandAndContract.html`
- Microsoft Azure Well-Architected ADR — `learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record`
