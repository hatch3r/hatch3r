---
id: hatch3r-pack-install
type: command
orchestrator: true
agentPipeline: [hatch3r-security, hatch3r-pack-installer]
description: "Walk the user through the pack trust-model gate (tier + signature + body-scan + capability declaration), confirm the trust posture, then delegate the verified install to hatch3r-pack-installer."
argument-hint: "<pack-source>"
disable-model-invocation: true
tags: [devops, supply-chain, ctx:brownfield-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 2
  rationale: One trust-verification pass (hatch3r-security, CQ3 supply-chain gate) then one install pass (hatch3r-pack-installer); the install depends on a clean verification verdict, so the two run on a dependency edge, not in parallel — per CONSTITUTION §2 P8 token cost never serializes independent work, but a true dependency does.
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the request for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Pack-install ambiguity triggers: which pack source is meant (npm spec, git URL, local path) when more than one resolves, whether the user accepts the pack's declared capability set, and whether an `--allow-untrusted` override is intended for an unsigned source. Installing a pack writes third-party content into the repo — an unsigned-pack override is irreversible-by-effect, so the trust posture is always confirmed at the Step 3 gate before any install runs.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Resolve pack | Orchestrator (inline) | No | Yes |
| 2. Trust verification | `hatch3r-security` | No | Yes |
| 3. Trust gate + ASK | Orchestrator (inline) | No | Yes |
| 4. Install | `hatch3r-pack-installer` | No | When the gate clears |
| 5. Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety note** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): Stages 2 and 4 are a dependency chain — the install consumes the verification verdict — so they run sequentially. This is a true dependency edge, not a cost-driven serialization (P8 B2).

---

# Pack Install — Trust Gate, then Delegated Install

Drives `hatch3r add <pack>` through the trust contract in the hatch3r trust model (https://docs.hatch3r.com/docs/reference/trust-model) before any pack content lands in the repo. Resolves the pack reference, runs the supply-chain verification gate via `hatch3r-security`, presents the trust posture as one consolidated ASK, then delegates the verified atomic write to `hatch3r-pack-installer`.

Use `hatch3r-pack-install` when installing a third-party (marketplace / git-URL / local) pack. Canonical content shipped with the npm package does not flow through this command — it installs via `hatch3r init` / `hatch3r sync`.

> **Status note:** The hatch3r trust model (https://docs.hatch3r.com/docs/reference/trust-model) §1 marks the trust contract SPEC ONLY — `hatch3r add` is a placeholder today (`src/cli/commands/add.ts`). This command's orchestration contract lands the moment `hatch3r add` is wired up; until then it documents the gate sequence the install path will run.

---

## Argument Parsing

Positional argument: `<pack-source>` (required) — an npm spec, a git URL, or a local path.
Optional flag: `--allow-untrusted` — bypass the signature gate for an unsigned source. Surfaced at the Step 3 ASK; never applied silently.

If `<pack-source>` is absent, halt with the actionable error in Step 1c.

---

## Workflow

Execute these steps in order. The only ASK gate is Step 3; after the user confirms the trust posture, run autonomously through Step 5.

## Step 0: Triage

Classify the install before delegating, calibrated to pack-install against the Light/Standard/Deep tiers in `agents/shared/triage-vocabulary.md`:

- **Tier 1 (Light)** — a single canonical-tier npm pack carrying provenance, a small declared write set (≤5 files), and no capability escalation: one `hatch3r-security` verify pass (Step 2), then the Step 4 install. Step 3 confirms a clean posture in one ASK.
- **Tier 2 (Standard)** — a marketplace or git-URL pack, a moderate write set, a declared capability set inside the authorized envelope, signature present: the full trust gate plus a capability/tool-footprint cross-check, then install.
- **Tier 3 (Deep)** — any of: an unsigned source, an `--allow-untrusted` request, a capability set that escalates the declared tool footprint, or a pack writing >20 files or touching multiple adapter surfaces: the full pipeline run under the sandbox-install posture (trust model §1.3, https://docs.hatch3r.com/docs/reference/trust-model) with an explicit irreversibility confirmation at the Step 3 gate.

**Classify upward on uncertainty:** an unverifiable signature or an undeclared capability classifies at Tier 3, never down — the missing signal is treated as the higher-risk reading.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 2 `hatch3r-security` dispatch, emit the cost preview per `rules/hatch3r-cost-visibility.md`, calibrated to the Step 0 tier:

```yaml
cost_estimate:
  expected_sa_count: 2
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>   # 0 unless a transparency-log / advisory lookup is needed
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 5 Iteration Summary; `--effort=light|standard|deep` (Decision 17) forces the tier — record both the auto-classified tier and the override.

## Step 1: Resolve the Pack

#### 1a. Classify the source

- npm spec (`name@version`) → npm-published tier; verification uses `npm audit signatures`.
- git URL → non-npm tier; require a 40-char commit SHA pin (trust model §2.2, https://docs.hatch3r.com/docs/reference/trust-model); verification uses `cosign verify-blob`.
- local path → non-npm tier; cosign-signed `pack-manifest.json` + SHA-256 manifest expected.

#### 1b. Read the manifest

Read the pack's `pack-manifest.json` (§5.1): `pack_id`, `version`, `hatch3r_min_version`, `required_capabilities`, `tool_footprint`, `declared_tools`, `signing`, `review_queue`. A missing or malformed manifest is a halt (exit 1) with the specific missing field.

#### 1c. Halt on missing source

If no `<pack-source>` was supplied, halt verbatim (P1 actionable-error contract):

```
No pack source supplied.

To install a pack:
  /hatch3r-pack-install <npm-spec | git-url | local-path>

Example:
  /hatch3r-pack-install @acme/hatch3r-react-pack@1.2.0
```

Exit code 2 (usage error).

## Step 2: Trust Verification (delegated)

Spawn `hatch3r-security` via the Task tool with `subagent_type: "generalPurpose"`. The prompt MUST include:

1. The resolved pack reference + source tier from Step 1.
2. The full `pack-manifest.json` from Step 1b.
3. The trust-contract checklist to verify (cite the hatch3r trust model, https://docs.hatch3r.com/docs/reference/trust-model): signature (§2.1 npm-provenance OR §2.2 cosign-keyless), body scan against DENY_PATTERNS (§3.1), lifecycle-script ban (§4.1), capability + tool-footprint declaration (§5.2–§5.4).
4. All `scope: always` rule directives from `rules/`.
5. The confidence expression requirement (verbatim): rate every finding high/medium/low per `agents/shared/quality-charter.md` — high = signature + scan verified clean; medium = pattern match without verified exploit; low = heuristic, recommend human review.

`hatch3r-security` returns its `PASS | FINDINGS | CRITICAL` verdict (map to canonical severity via `agents/shared/severity-mapping.md`), the signature-verification evidence, and the body-scan result.

## Step 3: Trust Gate + ASK (only mutation gate)

Present one consolidated trust posture, then ASK before any install runs.

```
Pack: {pack_id}@{version-or-SHA}  ({npm | git | local} tier)

Trust posture:
  signature:        {PASS | FAIL}  — {npm audit signatures | cosign verify-blob evidence}
  body scan:        {0 hits | matched: <pattern>}
  lifecycle scripts:{none | BANNED: <name>}
  capabilities:     {required_capabilities} — {within authorized set? yes/no}
  tool footprint:   {within declared caps? yes/no}
  review queue:     {submission_id | none}

hatch3r-security verdict: {PASS | FINDINGS | CRITICAL} (confidence: {high|medium|low})
```

#### 3a. ASK (only gate)

> Reviewed the trust posture for {pack_id}@{version}. Proceed with install?
>
> 1. `install` — apply the pack (only when signature PASS and verdict is not CRITICAL).
> 2. `install --allow-untrusted` — apply despite a signature FAIL or absent signature (records the override in the manifest; install only under a sandbox per trust-model §1.3).
> 3. `abort` — do not install.
>
> Default if no response: 3 (abort — lowest-blast-radius; an unverified pack is a supply-chain attack vector).

Gate rules:
- A `CRITICAL` verdict from `hatch3r-security` (e.g., a DENY_PATTERNS body-scan hit, a banned lifecycle script) blocks `install`. Only `abort` or an explicit `install --allow-untrusted` with written user rationale may proceed, and a body-scan hit is never overridable — re-route to `abort`.
- A signature FAIL is overridable only via option 2 with explicit confirmation; record the override and the user's rationale for the manifest install record.
- After the user confirms `install`, the run is autonomous through Step 5.

## Step 4: Install (delegated)

Spawn `hatch3r-pack-installer` via the Task tool with `subagent_type: "generalPurpose"`. The prompt MUST include:

1. The resolved + pinned pack reference from Step 1.
2. The `hatch3r-security` verification verdict + evidence from Step 2 (so the installer re-verifies at write time rather than trusting a stale check).
3. The user's Step 3 decision, including any `--allow-untrusted` override + rationale.
4. All `scope: always` rule directives from `rules/`.
5. The confidence expression requirement (verbatim, as in Step 2).
6. Explicit: preview the write set as a dry-run before the first write; apply atomically; roll back every written path on any failure; run `hatch3r verify` post-apply.

`hatch3r-pack-installer` returns `COMPLETE | BLOCKED`, the write-set table, the manifest install record, and the rollback state. Quote its per-file `delegation_proof_id` in the Step 5 attestation.

## Step 5: Iteration Summary

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output — save for that rule's sanctioned post-recap trailers (here, the `## Remaining Work` terminal block when the `Not done:` line carries items): a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default for every line except the always-emitted `Not done:`. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 28, superseded in place 2026-07-06).

Worked example for this domain:

```markdown
## Iteration Summary

**SUCCESS** — Installed @acme/hatch3r-react-pack@1.2.0: signature PASS, 0 body-scan hits, post-apply hatch3r verify clean.
files 4 (+96/−0) · sa 2/2 · gates 3/3 · cost Δ+3% tok / Δ−12% min · tier 1
Not done: none — full scope completed
Next: run /hatch3r-capability-discover to see the newly installed pack artifacts.
```

Status decision rules:
- **SUCCESS** — signature PASS, scan clean, install COMPLETE, `hatch3r verify` zero drift.
- **PARTIAL** — install COMPLETE but a non-blocking advisory surfaced (e.g., marketplace takedown notice on a different version).
- **FAILED** — install returned BLOCKED and rolled back; repo unchanged.
- **BLOCKED** — cannot proceed without user input (CRITICAL verdict without an authorized override, or `--allow-untrusted` rationale not provided).

---

## Sub-agent fan-out contract

This command emits the `sub_agents_spawned` field declared in frontmatter (`count: 2`) per `rules/hatch3r-fan-out-discipline.md`. The two sub-agents (`hatch3r-security` verification, then `hatch3r-pack-installer` install) run on a dependency edge — the install consumes the verification verdict — so serialization here is dependency-driven, not cost-driven. Per CONSTITUTION §2 P8 B2, token cost is never a valid reason to serialize independent work; this serialization is valid only because a true dependency exists.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: pack content written to the repo.

## Resumability (Decision 27/30)

pack-install is checkpoint-light: Steps 1-3 (resolve, verify, trust gate) are read-only, and Step 4 is a single atomic install. The temp+rename write set (`src/merge/safeWrite.ts`) is itself the resumability unit — a SIGKILL mid-install leaves the repo at its pre-install state with no partial pack — so a resumed run re-runs from the trust gate.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.pack-install-workspace/`; step range the Step 1 → Step 5 progression; `wave` = the fan-out batch index; snapshot/rollback paths the command's output paths. Write points: after Step 1 resolution, after the Step 2 verification verdict, after the Step 3 trust decision, and after the Step 4 installer return. Recording the trust decision means a resume does not re-prompt for a confirmed posture.

## Guardrails

1. **One ASK gate.** Step 3 is the only user-facing checkpoint. After confirmation the run proceeds through Steps 4–5 without further prompting.
2. **No silent override.** `--allow-untrusted` is never applied without explicit Step 3 confirmation + recorded rationale.
3. **Body-scan hits are non-overridable.** A DENY_PATTERNS match (§3.1) routes to `abort` regardless of override flags.
4. **Re-verify at write time.** Step 4 passes the verification evidence to the installer, which re-runs the signature check at write time to close any time-of-check/time-of-use gap.
5. **Atomic install or full rollback.** A failed apply reverts every written path; the repo is never left in a partial-pack state.
6. **No canonical packs.** This command installs third-party packs only; canonical content flows through `hatch3r init` / `hatch3r sync`.

## References

- [SLSA Build Track Levels (L0–L3)](https://slsa.dev/spec/v1.0/levels) (accessed 2026-06-02, OpenSSF / SLSA, official-docs; v1.0 superseded by current line) — the provenance → signing → isolation ladder this command's trust gate maps onto: L1 documented provenance, L2 signed provenance from a hosted build (the npm-provenance / cosign tier this command verifies), L3 tamper-resistant isolated builds. Source for framing the signature gate as the L2 floor for third-party packs.
- [npm Supply Chain Security in 2026: What Your Package Manager Does (and Doesn't) Protect You From](https://mondoo.com/blog/npm-supply-chain-security-package-manager-defenses-2026) (accessed 2026-06-02, Mondoo, independent-analysis) — 2026 synthesis of npm provenance + trusted-publishing coverage and gaps (signature proves CI-built, not publish-authorized; lifecycle-script and stolen-credential surfaces remain). Source for the lifecycle-script ban + non-overridable body-scan posture this command enforces ahead of any install write.
