---
id: shared-rigor-contract
type: reference
description: Scientific rigor contract and web-research mandate for sub-agent prompts and finding-recording workflows.
tags: [reference]
---

# Scientific Rigor Contract & Web Research Mandate

> Last updated: 2026-07-09
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
3. **Confidence with basis.** Express as High / Medium / Low with the basis named — direct measurement, sampled observation, inference from analogue. Self-reported or perceived-productivity claims rank below measured delivery outcomes and are inadmissible as a finding's sole basis (measured-vs-perceived divergence: ≈39 points in a randomized controlled evaluation of experienced developers, published 2025, accessed 2026-07-09). Overclaiming confidence is itself a finding.
4. **Root-cause chain.** Distinguish symptom from systemic driver using a causal chain of at minimum three steps. Symptomatic fixes ship as Info; the systemic driver is the Medium-or-higher finding.
5. **Bias check.** Name the specific bias risks that apply (confirmation, availability, anchoring) and flag any finding that depends on prior-report framing. A finding that cannot pass this check is downgraded one severity band.
6. **Adversarial peer-review.** Re-read each finding as a sceptic and record one genuine counter-argument; the resolution of the counter-argument appears in the finding body.

---

## Role-claim evidence classes
| Role-artifact class | Minimum evidence |
|---------------------|------------------|
| Product Manager (discovery / market claims) | Sourced user/market evidence with access dates |
| Software Architect (ADRs) | Trade-offs + rejected alternatives recorded |
| UI/Design-System Engineer | Design-token adoption + a11y scan results |
| UX Designer | Flow/state coverage evidence |
| Software Engineer / Data Engineer (implementation) | Executed verification (tests/commands + outputs) |
| QA Engineer | Coverage + edge-case/mutation evidence |
| Security Engineer / Compliance | Scan results + control mapping |
| SRE/Operations | SLO/telemetry data |
| Platform/DevOps Engineer | Pipeline/provenance evidence |
| Tech Writer | Doc-accuracy verification against the shipped surface |
| Engineering Lead | Attestation trail (delegation proofs) |

Rigor extends from findings to role claims: a role claim missing its evidence class is inadmissible for sign-off (role taxonomy ratified 2026-07-09; sign-off doctrine: `agents/shared/senior-expert-charter.md`).

---

## Grading directives

Severity-floor directives applied when grading artifact classes — distinct from the six finding-quality tests above, which accept or reject a finding on its evidence.

**Clarification gate (P8 B1).** When grading an agent, command, skill, or rule, a missing ambiguity-detection gate — or one not referencing `agents/shared/user-question-protocol.md`, or one that is exception-only rather than default — is a finding at **Medium minimum**. For entry-point agents and always-on rules, the minimum severity is **High**. Per the Clarification-First Verification behavioral charter directive and the clarification & fan-out discipline pillar P8 B1.

---

## Required Finding Output Schema

Every **individual sub-agent finding** written to `.audit-workspace/D{N}-SA{M}.findings.md` AND every EVOLVE scanner finding written to `.evolve-workspace/S{N}.findings.md` carries this YAML-style header before the prose body. **Synthesis files** (`.audit-workspace/D{N}-synthesis.md`) are aggregations and MUST instead open with a domain-level metadata block (see §Synthesis File Header Schema below); per-finding rigor details are referenced by finding ID, not restated per finding in synthesis.

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
impact_horizon: short | medium | long  # 2.0.0 (Decision 24) — mandatory pre-triage filter
progress_toward_pillar: <axis>.<pillar_id>+<delta>  # 2.0.0 (Decision 24) — e.g., "governance.P5+0.15" or "content-quality.CQ3+0.20"
```

The body of the finding may then describe the issue, file references, recommendation, and effort per the host prompt's finding format (the audit prompt's Tier 3 finding format or the evolve prompt's §2.3 output contracts).

---

## Schema Enforcement

- **Audit** — `governance/AUDIT.md` §Shallow Finding Detector flags any finding lacking the schema header (placeholder values such as `confidence_basis: "based on analysis"` without a named basis are equivalent to missing) or carrying a single-source empirical claim (single source is acceptable only when its trust tier is `official-docs` AND the claim is platform-specific), and requires the producing sub-agent to deepen before acceptance.
- **Audit execution** — `governance/AUDIT-EXECUTE.md` Phase 1 carries `confidence`, `causal_chain_depth`, and `sources` verbatim from each finding into the finding registry and forward through the execution lifecycle; a finding missing any of these fields is flagged for re-research before triage — placeholder values are never assigned.
- **Evolve** — scanner findings and researcher brief items enter via the `governance/EVOLVE.md` §0.7 rigor & research mandate (this contract applied by reference); a finding missing any schema field is excluded at §3.3 as `dropped_for_rigor: <field>` (Guardrail 7), and re-research on re-dispatch belongs to the producing scanner, not the orchestrator.

---

## Impact-Gated Registration (Decision 24 — added 2026-05-26)

Findings without both `impact_horizon` and `progress_toward_pillar` are DROPPED at sub-agent output time before orchestrator triage. The audit signals framework-level progress, not analytical depth without payoff. The impact-gating behavioral charter directive and Pillar Compliance Test Q5/Q6 encode the enforcement.

---

## Proof Trace Contract (Decision 19 — added 2026-05-26)

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

Pillar Compliance Test answers: (1) P2 Scientific & Practical Quality primary — the six-test contract operationalises P2 at the per-finding level for every audit sub-agent and every EVOLVE scanner finding; P5 Governance Self-Quality and P3 Adapter & External Tool Currency supporting — single-source-of-truth referencing per §Purpose, plus Web Research Mandate source-and-date capture for platform docs, CLI tool releases, and CVE feeds. (2) Measurable improvement — every finding passes the six-test contract and carries the 9-mandatory-field schema header, every role claim carries a named evidence class, and placeholder findings are detectable and routed to re-research. (3) Net governance size impact: one shared file capped at ≤170 lines (CONSTITUTION §2 P5, recalibrated 2026-07-09 for role-claim evidence classes), offset by reference-instead-of-restate across the audit/evolve prompts and domain files.

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
