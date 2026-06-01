---
id: shared-rigor-contract
type: reference
description: Scientific rigor contract and web-research mandate for sub-agent prompts and finding-recording workflows.
tags: [reference]
---

# Scientific Rigor Contract & Web Research Mandate

> Last updated: 2026-05-26
> Pillars: P2 (primary), P5 (supporting), P3 (supporting).
> Canonical for: all sub-agent prompts and audit/evolve workflows that record findings.

## Purpose

Single source of truth for the rigor every governance prompt and audit sub-agent applies before recording a finding. The audit prompt, the evolve prompt, and all audit domain files reference this file rather than restating it (Anti-Bloat Principle 1: Single Source of Truth, per the governance self-quality pillar P5).

---

## Web Research Mandate

Every empirical claim and every "current practice" assertion grounds in live web research, not training-data recall.

1. **Source minimum.** ≥2 independent sources per empirical claim. Independence = different author, organisation, and funder.
2. **Citation format.** URL + access date (YYYY-MM-DD) + author/organisation + trust tier. Inline format example: `[source](https://example.com) (accessed 2026-04-19, OWASP, official-docs)`.
3. **Trust tiers** (highest → lowest):
   - `official-docs` — vendor or standards-body primary documentation
   - `peer-reviewed` — published research with peer review
   - `vendor-note` — vendor blog, technical note, changelog
   - `independent-analysis` — third-party benchmark or analysis from a credentialed source
   - `blog-post` — individual technical blog or community write-up
4. **Recency windows.** Technology and platform-documentation claims ≤12 months old; published research ≤36 months. Stale source → confidence downgrade one band.
5. **Paywall handling.** Paywalled sources accepted only if a public summary OR a secondary citation is available; otherwise the dependent claim downgrades to Low confidence.
6. **404 / withdrawn sources.** Trigger a re-research pass before the finding is accepted. Do not cite a source that no longer resolves.

---

## Scientific Rigor Contract

Every finding satisfies six tests, drawn from established empirical practice. A finding missing any test is rejected before inclusion.

1. **Falsifiability (Popper).** Record one observation that would disprove the finding. A non-falsifiable claim is rejected.
2. **Triangulation.** ≥2 independent sources per empirical claim, OR a file path + line number reference for code-behaviour claims. Where the claim depends on external state, triangulate across at least two independent sources per the Web Research Mandate.
3. **Confidence with basis.** Express as High / Medium / Low with the basis named — direct measurement, sampled observation, inference from analogue. Overclaiming confidence is itself a finding.
4. **Root-cause chain.** Distinguish symptom from systemic driver using a causal chain of at minimum three steps. Symptomatic fixes ship as Info; the systemic driver is the Medium-or-higher finding.
5. **Bias check.** Name the specific bias risks that apply (confirmation, availability, anchoring) and flag any finding that depends on prior-report framing. A finding that cannot pass this check is downgraded one severity band.
6. **Adversarial peer-review.** Re-read each finding as a sceptic and record one genuine counter-argument; the resolution of the counter-argument appears in the finding body.
7. **Clarification gate (P8 B1).** When grading an agent, command, skill, or rule, a missing ambiguity-detection gate — or one not referencing `agents/shared/user-question-protocol.md`, or one that is exception-only rather than default — is a finding at **Medium minimum**. For entry-point agents and always-on rules, the minimum severity is **High**. Per the Clarification-First Verification behavioral charter directive and the clarification & fan-out discipline pillar P8 B1.

---

## Required Finding Output Schema

Every **individual sub-agent finding** written to `.audit-workspace/D{N}-SA{M}.findings.md` AND every EVOLVE proposal block carries this YAML-style header before the prose body. **Synthesis files** (`.audit-workspace/D{N}-synthesis.md`) are aggregations and MUST instead open with a domain-level metadata block (see §Synthesis File Header Schema below); per-finding rigor details are referenced by finding ID, not restated per finding in synthesis.

```
confidence: high | medium | low
confidence_basis: <one phrase — direct measurement | sampled observation | inference from analogue>
falsifiability: <observation that would disprove this finding>
causal_chain: <step1 → step2 → step3 (≥3 links, symptom → driver → root)>
bias_check: <named bias(es) considered + mitigation>
counter_argument: <one genuine sceptic position + the resolution>
sources:
  - url: https://...
    accessed: YYYY-MM-DD
    author: <author or organisation>
    trust_tier: official-docs | peer-reviewed | vendor-note | independent-analysis | blog-post
impact_horizon: short | medium | long  # 2.0.0 (Decision 17) — mandatory pre-triage filter
progress_toward_pillar: <axis>.<pillar_id>+<delta>  # 2.0.0 (Decision 17) — e.g., "governance.P5+0.15" or "content-quality.CQ3+0.20"
```

The body of the finding may then describe the issue, file references, recommendation, and effort per the host prompt's finding format (the audit prompt's Tier 3 finding format or the evolve prompt's proposal format).

---

## Schema Enforcement

- The audit prompt's `Shallow Finding Detector` rejects any finding lacking the schema header or with a single-source empirical claim (unless the source is `official-docs` AND the claim is platform-specific).
- The evolve prompt's rejection filters reject any finding that cannot answer all six contract tests.
- The audit-execute `Finding Registry` carries `confidence`, `causal_chain_depth`, and `sources` fields forward through the execution lifecycle. Missing fields block Phase 1 Triage.
- The audit-execute `Sub-Agent Failure Handling` retries any sub-agent whose findings contain placeholder values (e.g. `confidence_basis: "based on analysis"` without a named basis).

---

## Impact-Gated Registration (Decision 17 — added 2026-05-26)

Findings without both `impact_horizon` and `progress_toward_pillar` are DROPPED at sub-agent output time before orchestrator triage. The audit signals framework-level progress, not analytical depth without payoff. The impact-gating behavioral charter directive and Pillar Compliance Test Q5/Q6 encode the enforcement.

---

## Proof Trace Contract (Decision 9 — added 2026-05-26)

For every state-dependent claim (file existence, file content, grep match, type-check pass, test output, command exit code), emit a `proof_trace:` block under the finding body containing:

```yaml
proof_trace:
  claim: <one-sentence assertion>
  command: <bash invocation OR Read tool call OR grep pattern>
  expected: <pattern OR quoted output>
  actual: <verbatim ≤200 chars from command output>
  verdict: matched | mismatched
  accessed: <YYYY-MM-DD>
```

Sub-agents that omit proof_trace on state-dependent claims trigger Shallow Finding Detector. The reviewer sub-agent's Pass 1.5 reads proof_trace blocks to verify implementation against documented runtime state. Citation alone insufficient — verification commands close the loop.

---

## Per-Domain Source Targets

Default research targets per audit domain (overridable in domain-specific source-set blocks):

| Domain group | Primary sources | Recency window |
|--------------|-----------------|----------------|
| D1 / D3 / D8 (code patterns) | Current best-practice references for the specific pattern | 12 months |
| D9 (platform adapters) | Official platform documentation + changelog diff vs prior cycle | 12 months |
| D15 (security) | OWASP ASI current revision + CVE feeds + vendor security advisories | 12 months |
| D17 (competition) | Competitor product docs ≤6 months + GitHub-stars trajectory + third-party benchmarks | 6 months |
| D19 (Claude Code) | Current Claude Code documentation (hooks, settings.json schema, skill format, Agent Teams API) | 12 months |
| All other domains | At minimum, verify any external references (tool docs, standards) are current | 12 months |

---

## Pillar Service

This template serves the framework's North Star through:

- **P2 Scientific & Practical Quality (primary).** The six-test contract operationalises P2 at the per-finding level for every audit sub-agent and every EVOLVE proposal.
- **P5 Governance Self-Quality (supporting).** Single source of truth eliminates duplication across the audit prompt, the evolve prompt, and the audit domain files.
- **P3 Adapter & External Tool Currency (supporting).** Web Research Mandate enforces source-and-date capture for platform docs, CLI tool releases, and CVE feeds (per the adapter & external tool currency pillar P3).

Pillar Compliance Test answers: (1) P2 primary, P5 / P3 supporting. (2) Measurable improvement — every finding gains 6 enforcement gates and a 7-field schema; placeholder findings are detectable and retryable. (3) Net governance size impact: +85 lines for this file, offset by reference-instead-of-restate across the audit/evolve prompts and domain files.

---

## Synthesis File Header Schema

Domain synthesis files (`.audit-workspace/D{N}-synthesis.md`) open with a single metadata block, not per-finding rigor headers:

```yaml
domain: D{N}
cycle: {cycle_number}
date: YYYY-MM-DD
framework_version: {version}
commit: {short_sha}
rigor_contract: applied | partial | n/a
sub_agents:
  - SA{N}.{M} Name (count findings)
```

Per-finding rigor lives in `.audit-workspace/D{N}-SA{M}.findings.md`; synthesis references findings by ID.
