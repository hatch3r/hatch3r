---
id: hatch3r-proof-model
type: rule
description: Mandatory citation per factual claim + pre-execution verification gates + proof_trace block schema. Hallucination prevention via verifiable proof, not citation alone.
tags: [proof, verification, citation, floor:content-quality]
precedence: high
scope: always
---
# hatch3r Proof Model

**Pillars:** P2 (Scientific Quality), P5 (Governance Self-Quality)

This rule operationalises Decision #19 (CONSTITUTION §6): hallucination prevention via verifiable proof, not citation alone. It defines WHEN proof is required, WHAT schema each proof emits, and WHICH gates a hatch3r-driven agent must pass before issuing a factual assertion.

## When Proof Trace Is Required

Emit a `proof_trace:` block under any state-dependent claim:
- File existence or absence
- File content matching a pattern (specific bytes, frontmatter field, exported symbol)
- grep match presence/count (zero matches is itself a state-dependent claim)
- Type-check pass/fail (`npx tsc --noEmit` exit code)
- Test exit code + output (`npm test` per-suite pass/fail counts)
- Command exit code + output (any shell invocation whose result the agent is about to cite)
- Web fetch success + content matching (URL resolves AND target string present)

State-independent claims (definitional, axiomatic, design-rationale) do NOT require proof_trace — citing the file:line where the definition lives is sufficient.

## Proof Trace Schema

```yaml
proof_trace:
  claim: <one-sentence assertion>
  command: <bash invocation OR Read tool call OR grep pattern>
  expected: <pattern OR quoted output>
  actual: <verbatim ≤200 chars from command output>
  verdict: matched | mismatched
  accessed: YYYY-MM-DD
```

Field rules:
- `claim` — one sentence; what the proof verifies. Never a multi-clause assertion.
- `command` — runnable verbatim by a reviewer. No paraphrase.
- `expected` — either a regex/pattern OR the verbatim string the command should emit.
- `actual` — verbatim slice of the command output, truncated to 200 characters with `…` suffix if longer.
- `verdict` — `matched` when actual satisfies expected; `mismatched` otherwise. A `mismatched` verdict still belongs in the proof trace — it documents that verification was attempted.
- `accessed` — ISO-8601 date when the command was run.

## Pre-Execution Verification Gates

Before issuing any agent-generated assertion that affects a downstream decision, the agent passes these gates in order:

1. **State-dependent claim?** If yes, prepare a `proof_trace` block — do not emit the claim without it.
2. **External dependency claim** (library version, API behavior, platform feature)? Verify against current documentation per `agents/shared/quality-charter.md` §15 Currency Verification (≤180 days). Cite URL + access date + trust tier per `agents/shared/rigor-contract.md` §Web Research Mandate.
3. **Cross-file claim** (file X imports file Y, function A calls function B)? Run grep + cite file:line. Do not infer from filename or directory.
4. **Behavioral claim** (function does X under condition Y)? Either point to a test that exercises Y → X, or write one before asserting.
5. **Negative claim** (X does NOT exist, Y does NOT happen)? Run the search command and emit the zero-match output in `actual:`. Absence is harder to prove than presence — make the search command explicit.

A claim that fails its gate is either dropped, or downgraded to confidence `low` per `agents/shared/quality-charter.md` §1 with the gap explicitly named.

## Citation Alone Is Insufficient

Per CONSTITUTION §6 Decision #19: "Citation alone insufficient — verification commands close the loop." Documents become stale; commands return current state. A citation without a verification command is a Medium-minimum finding under D24 self-audit.

Concrete failure modes citation-alone leaves open:
- File path moved or renamed since the cited revision
- Section heading rewritten such that the citation refers to absent content
- Behavior changed in a way the prose has not yet caught up to
- Reviewer reading the citation does not have the cited file open

A proof_trace defeats all four — the command runs against current state at review time.

## Acceptable Failure Modes

- **Verification impossible at write time** (e.g., production database state from local dev) — explicitly state the verification gap + lower confidence to medium per quality-charter §1.
- **Verification cost prohibitive** (e.g., 30-minute integration suite for a docs typo) — log a `verification_skipped: <reason>` field; flag for downstream check. The skip must be documented, not silent.
- **Source 404 / withdrawn** — re-research before relying; do not cite a dead URL per rigor-contract.md §Web Research Mandate. Re-running the fetch with a `accessed:` date earlier than the 404 does not rescue the citation.
- **Verification command itself unreliable** (flaky test, intermittent network) — note the unreliability + run the command N≥3 times + cite the majority outcome.

## Examples

State-dependent claim WITH proof_trace:

```yaml
proof_trace:
  claim: rigor-contract.md defines a Proof Trace Contract section
  command: grep -n "Proof Trace Contract" agents/shared/rigor-contract.md
  expected: line-numbered match referencing "Proof Trace Contract"
  actual: "84:## Proof Trace Contract (Decision 9 — added 2026-05-26)"
  verdict: matched
  accessed: 2026-05-26
```

Negative claim WITH proof_trace:

```yaml
proof_trace:
  claim: no occurrences of "TODO" remain in src/content/contentRoot.ts
  command: grep -c "TODO" src/content/contentRoot.ts
  expected: "0"
  actual: "0"
  verdict: matched
  accessed: 2026-05-26
```

External dependency claim WITH proof_trace:

```yaml
proof_trace:
  claim: Commander.js 12.x supports async action handlers
  command: WebFetch https://github.com/tj/commander.js/blob/master/Readme.md#action-handler
  expected: section "Action handler" describes async support
  actual: "Action handler functions can also be async. Use parseAsync()…"
  verdict: matched
  accessed: 2026-05-26
```

## Enforcement

The audit prompt's Behavioral Charter directive 20 (added 2.0.0) and `agents/shared/rigor-contract.md` §Proof Trace Contract (added 2026-05-26) operationalise this rule at audit time. Findings missing proof_trace on state-dependent claims are dropped at SA output time per the charter's directive 20 + rigor-contract §Schema Enforcement.

Reviewer-class artifacts (`agents/hatch3r-reviewer.md`, future Reviewer Pass 1.5 per rigor-contract §Proof Trace Contract) read proof_trace blocks to verify implementation against documented runtime state. Implementer-class artifacts (`agents/hatch3r-implementer.md`) emit proof_trace blocks before declaring task completion.

## Pillar Service
- P2 — every factual claim becomes verifiable; placeholder findings are detectable and retryable.
- P5 — governance system applies proof to itself; the rule that mandates proof is itself bound by proof at audit time.

## Cross-References
- Decision #19 — proof-trace + mandatory citation as 2.0.0 hallucination-prevention floor
- `agents/shared/rigor-contract.md` §Proof Trace Contract — schema canonical location + Shallow Finding Detector linkage
- The audit prompt's Behavioral Charter directive 20 — audit-time enforcement at SA output time
- `agents/shared/quality-charter.md` §15 Currency Verification — external-dependency claim freshness window (≤180 days)
