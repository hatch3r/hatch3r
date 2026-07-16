---
id: hatch3r-diagnose
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-fixer]
description: "Troubleshoot a hatch3r framework issue (setup, config, adapter wiring, drift). Gathers state, delegates root-cause analysis to hatch3r-researcher, proposes a fix, and applies it via hatch3r-fixer after one confirmation gate."
argument-hint: "[symptom]"
tags: [maintenance, devops, ctx:brownfield-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
plan_gate: true
sub_agents_spawned:
  count: 2
  rationale: One hatch3r-researcher (root-cause mode against the captured state bundle) plus one hatch3r-fixer (applies the single proposed remediation). Independent symptom domains fan out to N parallel researchers; serialization holds only on the diagnose -> fix dependency edge. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes the diagnosis from the fix when both are needed.
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request for unresolved questions in symptom scope, target adapter, or expected-vs-actual behavior. If the symptom maps to two or more distinct failure domains (e.g., "sync is broken" could mean adapter output drift OR a manifest schema mismatch OR a path-traversal guard rejection), ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not guess which subsystem to probe. Proceed without asking ONLY when the symptom names a single subsystem and a single expected behavior. Any residual ambiguity discovered mid-diagnosis re-invokes the same protocol. Source: `rules/hatch3r-clarification-default.md`.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Capture state bundle | Orchestrator (inline, read-only) | No | Yes |
| 2. Triage symptom domain | Orchestrator (inline) | No | Yes |
| 3. Root-cause analysis | `hatch3r-researcher` (`root-cause` + `symptom-trace` modes) | Per independent symptom domain | Yes |
| 4. Propose remediation + ASK gate | Orchestrator (inline) | No | Yes |
| 5. Apply fix | `hatch3r-fixer` | Per fix group | When user accepts a code/config fix |
| 6. Verify + Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): when the captured state surfaces two or more independent symptom domains (e.g., one adapter's output drift AND an unrelated manifest field), fan out one `hatch3r-researcher` per domain — each reads a disjoint file set, aggregation is deterministic (union of root-cause records), and no shared mutable state exists. A single symptom domain spawns one researcher.

---

# Diagnose -- Troubleshoot a hatch3r Framework Issue

Closes the **symptom -> root cause -> fix** loop on a hatch3r setup, configuration, adapter-wiring, or drift problem in a repo where hatch3r is installed. Captures a read-only state bundle, delegates root-cause analysis to `hatch3r-researcher`, presents one remediation with an ASK gate, then delegates the fix to `hatch3r-fixer` and verifies.

Use `hatch3r-diagnose` when a hatch3r command misbehaves, adapter output looks wrong, `hatch3r status`/`hatch3r verify` reports drift, or the install is in an unexpected state. Use `/hatch3r-healthcheck` for a routine read-only health report with no fix step; use `/hatch3r-debug` for application-code debugging unrelated to the hatch3r framework itself.

---

## Argument Parsing

Optional positional argument: `<symptom>` (free-text description of the problem).

- If supplied: seed the Step 2 triage with the described symptom.
- If omitted: capture the full state bundle (Step 1) and ASK the user which symptom to investigate before delegating — a blind full-surface diagnosis is over-fan-out per `rules/hatch3r-fan-out-discipline.md`.

---

## Step 1: Capture State Bundle (read-only)

Gather the diagnostic state once; cache and pass it into the Step 3 researcher prompt so the sub-agent does not re-read. All commands are read-only.

| Probe | Command | Captures |
|-------|---------|----------|
| Version | `npx hatch3r --version` | installed CLI version |
| Manifest | read `.hatch3r/hatch.json` | `schemaVersion`, adapters, `managedFiles`, board config |
| Drift | `npx hatch3r status` (and `npx hatch3r verify` if status is ambiguous) | adapter-output drift vs bundled canonical content |
| Validation | `npx hatch3r validate` | content-structure / frontmatter / cross-ref failures |
| On-disk adapters | list `.cursor/`, `CLAUDE.md`, `.github/` adapter outputs present | which adapters actually materialized |
| Recent changes | `git log --oneline -10` + `git status --short` | uncommitted edits to managed files |

Record each probe's exit code and the first failing line. A non-zero exit on `status`/`verify`/`validate` is the primary lead; an unexpected `schemaVersion` (not 3) or a missing adapter output is a secondary lead.

---

## Step 2: Triage Symptom Domain

Classify the captured state into one or more domains before delegating. The domain determines which researcher modes and which file globs the Step 3 prompt scopes to.

| Domain | Lead signal | Researcher scope |
|--------|-------------|------------------|
| Setup / install | missing adapter output, first-run failure, Node version mismatch | `src/cli/commands/init.ts`, `.hatch3r/hatch.json`, install logs |
| Config / manifest | unexpected `schemaVersion`, malformed `.hatch3r/hatch.json`, override not applied | `.hatch3r/hatch.json`, `.hatch3r/overrides/`, `src/content/` precedence |
| Adapter wiring | adapter output absent/malformed, customization layer ignored | `src/adapters/`, `.customize.yaml`, `.customize.md`, managed-block markers |
| Drift | `hatch3r status`/`verify` reports on-disk vs canonical mismatch | the specific drifted file path + `src/merge/managedBlocks.ts` |

Triage tier (calibrates fan-out and the Step 0.5 cost preview):

- **Tier 1** — single domain, single drifted file or one obvious config typo. One researcher, no parallel fan-out.
- **Tier 2** — single domain, multiple files, root cause not obvious from the state bundle alone. One researcher at `standard` depth.
- **Tier 3** — two or more independent symptom domains. One researcher per domain in parallel (per the Parallel-safety conditions above).

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 4 ASK gate (the only mutation gate), surface the cost preview so a multi-domain diagnosis is never approved blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 2 tier.

```yaml
cost_estimate:
  expected_sa_count: <Tier 1 ~1 researcher (+1 fixer if a fix lands); Tier 3 = N researchers + 1 fixer>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>   # usually 0 — diagnosis reads local state, not the web
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 6 Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

`--effort=light|standard|deep` forces the named tier, bypassing the Step 2 auto-classification. The override wins; record both the auto-detected tier and the override so the cost block reports the budget delta. No override passed → the auto-classification stands.

---

## Step 3: Root-Cause Analysis (sub-agent delegation)

Delegate to `hatch3r-researcher` via the Task tool with the `root-cause` and `symptom-trace` modes (`agents/modes/root-cause.md`, `agents/modes/symptom-trace.md`). Launch one researcher per independent symptom domain in parallel.

Each researcher prompt MUST include:

1. The Step 1 state bundle verbatim (probe outputs + exit codes) so the sub-agent does not re-run probes.
2. The Step 2 domain classification and the scoped file globs for that domain.
3. The user's symptom description (or the answer to the Step 1 ASK).
4. All `scope: always` rule directives from `rules/` (loaded once at session start).
5. The confidence expression requirement (verbatim): rate every finding high/medium/low per `agents/shared/quality-charter.md` §1 — high = root cause reproduced against the captured state; medium = pattern-based; low = best judgment, recommend human review.
6. Explicit: do NOT create files, modify code, create branches/commits, or change board status — return a structured root-cause record only (the researcher's standing contract).

Await all researchers. Each returns a root-cause record with a `causal_chain` (≥3 steps: symptom → driver → root) and a proposed remediation. If a researcher returns `BLOCKED_AMBIGUITY` or `BLOCKED_PREMISE_CHALLENGE`, halt and surface the blocker to the user per the researcher's BLOCKED Output Schema — do not proceed to a fix on a contested premise.

---

## Step 4: Propose Remediation + ASK Checkpoint (only mutation gate)

Consolidate the researcher root-cause records into one remediation table. Each row: `[#] {domain} • {root cause one-line} • {proposed fix} • {confidence} • {reversible? yes/no}`.

```
hatch3r-diagnose — PR #n/a (Tier {1|2|3})

Findings:
  [1] adapter-wiring • CLAUDE.md managed block hand-edited, so `hatch3r status` reports drift • re-run `hatch3r sync` to regenerate the block (discards the hand-edit) • high • reversible
  [2] config • .hatch3r/hatch.json schemaVersion is 2; current is 3 • run `hatch3r update` to migrate the manifest • high • reversible (snapshot taken)

Tier: 2
Confidence: high — root cause reproduced against the captured state bundle.
```

**In-Session Plan Gate (Tier >= 2).** The remediation table above IS the run's plan artifact — persist it to `docs/plans/{YYYY-MM-DD}-diagnose-{symptom-slug}.md` before the ASK, per `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: slug from the symptom; gated dispatch = Step 5 fixer; revise = `fix N` narrowing (re-persist the narrowed table); no unattended flag — this ASK is the interactive seam.

ASK (only gate), per `agents/shared/user-question-protocol.md`:

> Diagnosed {N} root cause(s). Review the proposed remediation:
> - `accept` — apply every proposed fix via hatch3r-fixer
> - `fix N` — apply only finding N
> - `explain N` — print the full causal chain + counter-argument for finding N
> - `skip` — report the diagnosis only; apply nothing
>
> (accept / fix N / explain N / skip)

If a proposed fix is irreversible (deletes a file, drops a manifest field, force-resets a managed block over uncommitted edits), the ASK MUST state that explicitly and default to `skip` per the irreversible-action trigger in `rules/hatch3r-clarification-default.md`. At Tier >= 2 the gate maps onto this ASK: `accept` / `fix N` = execute now over the persisted artifact, `skip` = stop — the artifact remains as the diagnosis record. After the user accepts, the run is autonomous through Step 6.

---

## Step 5: Apply Fix (sub-agent delegation)

For each accepted finding, delegate to `hatch3r-fixer` via the Task tool. Group same-file fixes into one fixer invocation; dispatch disjoint-file fixes in parallel.

Each fixer prompt MUST include:

1. The finding as a structured reviewer-style record: `[CRITICAL|WARNING] {file} — {root cause} — {suggested fix}` (the fixer consumes Critical/Warning findings per its Fix Protocol).
2. The researcher's causal chain so the fixer fixes the root cause, not the symptom.
3. All `scope: always` rule directives.
4. The confidence expression requirement (verbatim).
5. Explicit: do NOT create branches, commits, or PRs — the fixer's standing boundary; this command stops before commit for human review.

Await the fixer's structured result. Capture its `Delegation proof ID` per file (quoted verbatim in the Step 6 attestation) and its `Reviewer re-run required` signal. When a fix touches framework source under `src/`, honor the fixer's reviewer-loop continuation signal — but this command does not run the full Phase 3 review loop; it surfaces `Reviewer re-run required: true` on the `Next:` line of the Step 6 recap rather than auto-spawning a reviewer.

---

## Step 6: Verify + Iteration Summary

Re-run the relevant Step 1 probe(s) to confirm the fix cleared the symptom: re-run `hatch3r status` after a drift/adapter fix, `hatch3r validate` after a content fix, `npx tsc --noEmit` after a `src/` fix. Record each re-run command and its exit code.

### End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: `<path>` via `hatch3r-fixer` when Step 5 applied a fix. A skip-path run (Step 4 `skip`, diagnosis-only) mutated nothing — state `inline_edits_by_orchestrator: none` and `mutating_subagent_invocations: 0`.

### Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

Worked example for this domain:

```markdown
## Iteration Summary

**PARTIAL** — Diagnosed manifest schema drift; migrated .hatch3r/hatch.json to schemaVersion 3; primary symptom resolved (hatch3r status re-run clean); second symptom not yet reproduced.
files 1 (+3/−1) · sa 3/3 · gates 2/2 · cost Δ−8% tok / Δ+5% min · tier 3
Not done: intermittent sync stall (second symptom) — unverified: not reproduced, no fix applied
Blockers: second symptom (intermittent sync stall) not reproduced against the captured state bundle — needs a failing transcript
Confidence: medium — primary fix verified by re-run probe; residual symptom unreproduced.
Next: commit the manifest migration; re-run /hatch3r-diagnose if the stall recurs.

## Remaining Work

Not done: intermittent sync stall (second symptom) — unverified: not reproduced, no fix applied
Blockers: second symptom (intermittent sync stall) not reproduced against the captured state bundle — needs a failing transcript
```

Status decision rules:
- **SUCCESS** — every accepted fix applied and the re-run probe confirms the symptom cleared.
- **PARTIAL** — some fixes applied, others BLOCKED, or a re-run probe still reports a residual symptom.
- **FAILED** — the fixer returned BLOCKED on every finding; no change landed.
- **BLOCKED** — a researcher returned `BLOCKED_PREMISE_CHALLENGE`, or an irreversible fix needs a user decision not yet given.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for diagnose: `1` = state capture + triage, `2` = researcher root-cause dispatch, `3` = fixer apply + verify + summary. Tier 1 runs are exempt per the Tier 1 exemption.

---

## Guardrails

1. **One ASK gate.** Step 4 is the only user-facing checkpoint. State capture (Step 1) and root-cause analysis (Step 3) are read-only and need no gate.
2. **No commit or push.** This command stops before commit so the maintainer reviews every change. Git operations are out of scope.
3. **Read-only probes.** Step 1 runs only read-only hatch3r and git commands; it never mutates the install or the manifest.
4. **No blind full-surface diagnosis.** A symptom must be named (argument or Step 1 ASK) before delegating — fan-out scales with named symptom domains, not the whole install.
5. **Irreversible-fix consent.** Any fix that deletes a file, drops a manifest field, or overwrites uncommitted managed-block edits requires an explicit ASK with `skip` as the default.

## Resumability (Decision 27/30)

diagnose is checkpoint-light — Step 1 state capture and Step 3 root-cause analysis are read-only, so an interrupted run re-captures cheaply; the only mutation point is Step 5 (fixer apply), so checkpoint there to avoid re-applying a fix already landed.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.diagnose-workspace/`; step range the Step 1 → Step 6 progression; `wave` = the per-finding fix index in Step 5; snapshot/rollback paths every file a Step 5 fixer touches. Write points: after Step 1 state capture, after the Step 3 researcher batch returns, after the Step 4 ASK decision (Tier >= 2: the plan-gate artifact path + approval persist with it, so a resume re-enters after the gate, not before it), and after each Step 5 fixer returns. The read-only steps record their result so a resume skips re-running probes when the baseline SHA is unchanged.

## References

- `agents/hatch3r-researcher.md` -> `root-cause` / `symptom-trace` modes, BLOCKED Output Schema (accessed 2026-06-02, in-repo canonical, official-docs) — the diagnosis-stage delegate and its structured root-cause-record contract.
- `agents/hatch3r-fixer.md` -> Fix Protocol, Return Structured Result, Delegation proof ID (accessed 2026-06-02, in-repo canonical, official-docs) — the fix-stage delegate and the forgery-resistant attribution token quoted in the attestation.
- `agents/shared/user-question-protocol.md` (accessed 2026-06-02, in-repo canonical, official-docs) — B1 gate format for the Step 1 symptom ASK and the Step 4 remediation ASK.
- `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation (accessed 2026-06-02, in-repo canonical, official-docs) — bypass-protection block formats.
