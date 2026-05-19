---
name: h4tcher-scoped-audit
description: Run a bounded quality audit of a maintainer-described slice (single file, small group, or subsystem) with a fresh checklist grounded in the rigor contract and an in-chat severity-graded report.
effort: medium
allowed-tools: Read Grep Glob Bash(*) Task WebSearch WebFetch
triage_tiers: [1, 2, 3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
---

## Scoped Audit (Maintainer)

Read-only focused audit. Takes a natural-language scope from the invocation, authors a fresh 4-8 item checklist grounded in `governance/audit/templates/rigor-contract.md`, runs it (inline for T1, parallel sub-agents for T2/T3), and emits an in-chat severity-graded report. No repo writes; sub-agent artifacts only under `.audit-workspace/`.

## Step 0: Triage

Classify scope by file count and pillar surface:

| Tier | Criteria | Pipeline |
|------|----------|----------|
| T1 | Single file, ≤1 pillar surface | Inline; skip Step 5 |
| T2 | 2-10 files, 1-2 pillars | 1-3 parallel sub-agent auditors |
| T3 | >10 files OR multi-pillar | ≥3 parallel sub-agent auditors |

Hard cap: if scope expands to >50 files, halt with the message: "Scope exceeds scoped-audit ceiling — invoke `/h4tcher-audit-cycle` for full 21-domain coverage." Do not proceed.

## Step 1: Scope Intake

1. Parse the natural-language scope from the invocation prompt (e.g., `src/pipeline/promptGuard.ts`, `P6 surface in src/`, `the cursor adapter`).
2. Resolve to file paths via glob expansion (`Glob` tool). Record the resolved file list.
3. Identify pillars implicated:
   - Read frontmatter `tags` on canonical content files in scope.
   - Grep pillar markers (`P1`, `P2`, ..., `P7`) inside in-scope files.
   - Map adapters/pipeline/CLI/governance dirs to their default pillars (e.g., `src/cli/` → P1, `src/pipeline/promptGuard.ts` → P6, `governance/` → P5).

## Step 2: Discover

4. Enumerate the slice — list every resolved file with line count.
5. Cross-reference scan: grep references INTO the slice and OUT of the slice across `agents/ skills/ rules/ commands/ hooks/ src/ governance/ docs-site/ CLAUDE.md`.
6. Classify artifact types present: agent, skill, rule, command, hook, adapter, pipeline module, governance domain, CLI command, test. The mix drives the gate selection in Step 3.

## Step 3: Checklist Authoring (4-8 items)

Derive each item from one of three inputs and tag it with an audit-domain citation for traceability:

| Input | Items generated | Domain citation |
|-------|----------------|-----------------|
| Pillars implicated | One pillar test per pillar surfaced | D05 (prompt), D10 (CLI), D15 (security), D16 (synthesis) |
| Artifact types | Anti-slop scan if `.md/.mdc`; frontmatter completeness if canonical content; rule parity if rules present; P7 efficiency invariants if commands or agents | D05.4 (anti-slop), D06 (efficiency), D09 (adapters) |
| Cross-refs | Consistency check (referenced file exists, name match, `agentPipeline` resolvable) | D16.3 (cross-domain synthesis) |

Cap at 8 items per `governance/CONSTITUTION.md` §2 P5. Do NOT execute a full domain — cite the domain item for traceability only.

## Step 4: Web Research (conditional)

Run per `governance/audit/templates/rigor-contract.md` only when a checklist item makes an empirical claim about external state (vendor docs, CVE, CLI behavior of a third-party tool). Skip otherwise. ≥2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency window (≤90d CVE, ≤12mo vendor docs, ≤36mo peer-reviewed). Record sources for Step 7.

## Step 5: Sub-Agent Dispatch (T2/T3 only)

Spawn parallel auditors via `Task`. Each owns 1-3 checklist items, writes findings to `.audit-workspace/scoped-audit-{slot}.md`. Sub-agent prompt MUST include:

1. The assigned checklist items (verbatim with domain citations from Step 3).
2. The file slice paths from Step 2.
3. Hatch3r context block (pillar test, lean thresholds, anti-slop wordlist reference, rigor contract path).
4. Confidence expression requirement (rigor contract §"Confidence with basis").
5. Workspace write target and a "no branches, no commits, no repo writes" guardrail.

T1: skip this step; the orchestrator executes the checklist inline.

## Step 6: Synthesis

After sub-agents return (or inline run completes):

1. Read each `.audit-workspace/scoped-audit-{slot}.md`. Dedupe findings by `(file, line, root-cause)` tuple.
2. Apply the rigor contract to every finding: ≥3-step causal chain documented, confidence with basis recorded, adversarial counter-argument noted, bias check passed.
3. Assign severity (Critical / High / Medium / Low / Info) per the rigor contract severity rubric.
4. If T2 or T3, write the resolved file list to `.audit-workspace/scoped-audit-manifest.md` so the Step 7 report can reference it instead of inlining the full list.

## Step 7: In-Chat Report (target ≤80 lines)

Emit verbatim — no preamble, no closing prose:

```
Scoped Audit Report
-------------------
Scope: <one line>
Files in scope: <count> (full list in .audit-workspace/scoped-audit-manifest.md if T2/T3)
Pillars implicated: P1, P5

Checklist (N items): <bullet list — what was checked>

Findings (M):
  [Sev] <file:line> — <root cause> → <fix>

Sources: <per-claim citation list, only when empirical claims were made>
Overall confidence: high | medium | low
Suggested next step: <none | h4tcher-capability-refactor | h4tcher-capability-remove | h4tcher-audit-cycle>
```

## Constraints

- Read-only on the repo. No `Write`, no `Edit`. Workspace files under `.audit-workspace/` only.
- Hard cap at ~50 files — escalate to `/h4tcher-audit-cycle` above that.
- Findings without a ≥3-step causal chain are dropped, not emitted at low confidence.
- Severity follows `governance/audit/templates/rigor-contract.md`; do not invent grades.

## Distinctness

- vs `/h4tcher-capability-discover` — discover maps existing artifacts for lifecycle decisions (pre-flight inventory); scoped-audit grades quality of an arbitrary slice against a fresh checklist.
- vs `/h4tcher-audit-cycle` — the cycle is the full 21-domain pass with finding-registry writes and wave execution; scoped-audit is bounded, read-only, in-chat, single emission.
- vs `/h4tcher-governance-check` — governance-check runs fixed PASS/FAIL gates against governance invariants; scoped-audit authors a fresh checklist per invocation and emits severity-graded findings.

## References

- Rigor contract: `governance/audit/templates/rigor-contract.md`
- Pillar definitions: `governance/CONSTITUTION.md` §2 P1-P8
- Anti-slop wordlist: `.claude/rules/anti-slop-enforcement.md`
- Lean thresholds: `.claude/rules/governance-lean-thresholds.md`
- Quality charter: `agents/shared/quality-charter.md`
- Domain index: `governance/audit/domains/D01-D21.md`
