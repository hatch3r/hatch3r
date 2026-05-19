# hatch3r — Atomic Amendment Procedure

> Established: 2026-05-19 (Cycle 9 Wave 3 — D16-F16.2.5)
> Status: governance/CONSTITUTION.md §8 companion. Operationalizes the Amendment Protocol.

This document specifies the **atomic amendment workflow** for governance edits that touch more than one artifact. Selective propagation — landing the canonical edit in `governance/CONSTITUTION.md` without simultaneously updating every downstream artifact that references the same concept — is the root cause D16 surfaced for the Cycle 8 P8 pillar drift (CLAUDE.md, `.claude/rules/pillar-compliance.md`, `.claude/settings.json` hooks fell out of sync) and the Cycle 9 B2 emission gap (commands and agents inherited the directive selectively). This file closes the propagation gap with three deliverables: (1) a closed enumeration of **amendment classes**, (2) per-class **propagation manifests**, and (3) a **gate that rejects partial amendments**.

---

## 1. Atomicity contract

Every amendment that satisfies the **multi-file trigger** lands in **one commit** with **every file in its propagation manifest updated**. Partial amendments — a commit that updates `governance/CONSTITUTION.md` but omits `.claude/rules/pillar-compliance.md`, or vice versa — are rejected by the validators wired into `npm run validate:efficiency`:

- `scripts/validate-pillar-currency.ts` (this cycle) — fails when CLAUDE.md, `agents/shared/quality-charter.md`, or `.claude/rules/pillar-compliance.md` reference a pillar range or count that drifts from the CONSTITUTION §2 canonical value.
- `scripts/validate-lean-threshold-currency.ts` (this cycle) — fails when `.claude/rules/governance-lean-thresholds.md` or CLAUDE.md `## Lean Thresholds` lists a Limit value that drifts from the CONSTITUTION §2 P5 canonical row.
- `scripts/validate-rule-pillar-currency.ts` (Cycle 9 H78) — preexisting; fails on stale `P1-P{j}` ranges inside `.claude/rules/{pillar-compliance,content-authoring}.md`.

A partial amendment fails CI; the maintainer either expands the commit to cover every artifact in the manifest, or routes the change through `/h4tcher-re-envision` (when direct-edit authority applies) or CL-3 (when audit-system mutation applies).

---

## 2. Multi-file trigger

An amendment is "multi-file" — and bound by this procedure — when ANY of the following hold:

1. It changes the **count, range, or definition** of any pillar in CONSTITUTION §2 P1..P{K}.
2. It changes a **Lean Thresholds row** in CONSTITUTION §2 P5 (file limit, item ceiling, calibration formula).
3. It adds or removes a **behavioral charter directive** in `governance/AUDIT.md`.
4. It modifies the **anti-slop wordlist** in `governance/AUDIT-EXECUTE.md` regression gate 11 (paired atomically with `CLAUDE.md` anti-slop section per CONSTITUTION §6 Decision #11).
5. It changes the **Key Design Decisions** table in CONSTITUTION §6.
6. It changes the **Pillar-to-Governance Traceability Matrix** in CONSTITUTION §3.
7. It modifies the **Amendment Protocol itself** in CONSTITUTION §8.

Single-file fixes (typo correction inside one rule, measurement formula clarification inside one domain) are out of scope; they pass through the normal capability-lifecycle preset (`/h4tcher-capability-add`, `/h4tcher-capability-refactor`).

---

## 3. Propagation manifests (per amendment class)

Each row lists the **complete** artifact set that an atomic amendment of that class must touch. The validators verify the listed files; reviewers verify completeness against this manifest. Files in **bold** are the canonical source; the others are downstream references.

### 3.1 Pillar addition / removal / range change

| Artifact | Required edit |
|----------|---------------|
| **`governance/CONSTITUTION.md`** §2 heading "The K Binding Pillars" | Update count K; add or remove `### P{i}.` block |
| **`governance/CONSTITUTION.md`** §3 Pillar-to-Governance Traceability Matrix | Add or remove the row for the changed pillar; update the column cell set |
| `CLAUDE.md` "## The K Binding Pillars" table | Update count K + table rows P1..P{K} |
| `.claude/rules/pillar-compliance.md` | Update `P1-P{K}` range + "The K pillars: …" enumeration |
| `.claude/rules/content-authoring.md` | Update `P1-P{K}` range under Pillar alignment |
| `agents/shared/quality-charter.md` cross-references | Update any `CONSTITUTION §2 P{j}` reference whose j > new K |
| `.claude/settings.json` SessionStart hook output | Update pillar count emitted on session start (if hook references count literally) |
| `governance/VISION.md` Quality Bar references | Update any pillar enumeration |

Validator: `scripts/validate-pillar-currency.ts` (this cycle) + `scripts/validate-rule-pillar-currency.ts` (preexisting).
Direct-edit authority: framework owner only (CONSTITUTION §8 — pillars are §8 framework-owner direct edit; `/h4tcher-re-envision` emits a queued proposal in `.re-envision-workspace/constitution-amendment-queue.md`).

### 3.2 Lean threshold row change

| Artifact | Required edit |
|----------|---------------|
| **`governance/CONSTITUTION.md`** §2 P5 Lean Thresholds table | Update Limit + Calibration column for the changed row |
| `.claude/rules/governance-lean-thresholds.md` | Update the corresponding row Limit value |
| `CLAUDE.md` "## Lean Thresholds" table | Update the corresponding row Limit value |

Validator: `scripts/validate-lean-threshold-currency.ts` (this cycle).
Direct-edit authority: `/h4tcher-re-envision` direct-edit with per-file consent (CONSTITUTION §8 RE-ENVISION authorization — Lean threshold rows are RE-ENVISION-permitted).

### 3.3 Behavioral charter directive addition / refinement

| Artifact | Required edit |
|----------|---------------|
| **`governance/AUDIT.md`** §Sub-Agent Behavioral Charter | Add or refine the directive (authoritative location) |
| `governance/CONSTITUTION.md` §3 traceability matrix | Update Domains column cell set if the directive maps a new pillar-to-domain edge |
| `agents/shared/quality-charter.md` | Mirror the directive into the agent-output side if it binds agent behavior |
| `.claude/rules/` per-rule body | Update any rule whose body restates the directive (e.g., `clarification-default.md` mirrors directive 17) |

Validator: no automated gate (charter-directive text is canonical in one location); review-time check via `/h4tcher-governance-check`.
Direct-edit authority: `/h4tcher-re-envision` direct-edit with per-file consent for additions and refinements. Removals route to CL-3.

### 3.4 Anti-slop wordlist change (atomic pair per CONSTITUTION §6 Decision #11)

| Artifact | Required edit |
|----------|---------------|
| **`governance/AUDIT-EXECUTE.md`** regression gate 11 wordlist | Add or remove the banned phrase row |
| `CLAUDE.md` Anti-Slop Wordlist section | Add or remove the matching row (atomically with the AUDIT-EXECUTE.md edit) |
| `.claude/rules/anti-slop-enforcement.md` | Add or remove the matching row |

Validator: no automated gate today (proposed cycle-10 deliverable); review-time check via `/h4tcher-governance-check`.
Direct-edit authority: `/h4tcher-re-envision` direct-edit (atomic pair) with per-file consent.

### 3.5 Key Design Decisions row addition / removal

| Artifact | Required edit |
|----------|---------------|
| **`governance/CONSTITUTION.md`** §6 Key Design Decisions | Add or remove the row |
| `governance/CONSTITUTION.md` heading frontmatter `> Amended: YYYY-MM-DD …` | Append the date + one-line rationale |

Direct-edit authority: framework owner only (§8 protocol).

### 3.6 Traceability matrix row change (§3)

| Artifact | Required edit |
|----------|---------------|
| **`governance/CONSTITUTION.md`** §3 matrix | Update the row |
| `governance/CONSTITUTION.md` heading frontmatter | Append amendment date + rationale |

Direct-edit authority: framework owner only (§8 protocol).

### 3.7 Amendment Protocol change (§8)

| Artifact | Required edit |
|----------|---------------|
| **`governance/CONSTITUTION.md`** §8 | Update the protocol |
| **`governance/amendment-procedure.md`** (this file) | Mirror the change into the propagation manifest set |
| `.claude/rules/capability-lifecycle.md` final paragraph | Update any reference to RE-ENVISION direct-edit authorization scope |

Direct-edit authority: framework owner only (§8 protocol).

---

## 4. Workflow

A maintainer or `/h4tcher-re-envision` invocation that intends an amendment runs:

1. **Classify** the amendment against §2 multi-file triggers and §3 manifest rows. If no row matches and the change is single-file, the procedure does not apply.
2. **Collect** every file in the matching manifest. Read them. Compose the edits in one branch / one staging area.
3. **Commit** all edits in a single commit. Conventional Commits scope: `audit(governance)` or `chore(governance)` per `.claude/rules/commit-conventions.md`.
4. **Validate** locally: `npm run validate` (which runs `validate:efficiency` → `validate-pillar-currency.ts` + `validate-lean-threshold-currency.ts`) and `npm run validate:rule-parity`. Any drift error fails the gate; expand the commit to cover the missing artifact, do not bypass.
5. **Route** for approval per the authority column in §3 (framework-owner direct edit, RE-ENVISION direct edit with per-file consent, or CL-3 proposal). Do not split the multi-file amendment across separate PRs.

---

## 5. Failure modes the gate catches

| Failure mode | Validator | Symptom |
|--------------|-----------|---------|
| CONSTITUTION declares K pillars; CLAUDE.md table still has K-1 rows | `validate-pillar-currency.ts` | `PILLAR-TABLE-COUNT-DRIFT` error |
| CONSTITUTION declares K pillars; quality-charter cross-ref says P{K+1} | `validate-pillar-currency.ts` | `PILLAR-RANGE-OUT-OF-BAND` error |
| CONSTITUTION §2 P5 says CONSTITUTION.md ≤250; lean-thresholds rule still says ≤225 | `validate-lean-threshold-currency.ts` | `LEAN-THRESHOLD-LIMIT-DRIFT` error |
| Anti-slop wordlist row added to AUDIT-EXECUTE.md but missing from CLAUDE.md | (manual review today; cycle-10 validator candidate) | Reviewer surface |

---

## 6. Why this lives outside CONSTITUTION §8

The Amendment Protocol in CONSTITUTION §8 declares **authority** ("who can amend what"). This file declares **mechanics** ("which files atomically change together"). Keeping the manifest in a companion file lets the propagation-table grow as new cross-artifact references appear (new rule mirrors a directive; new CLI surface reads a pillar count) without expanding CONSTITUTION.md past its 250-line lean threshold. The split mirrors the rationale for `pack-trust-model.md` (operational detail) vs `CONSTITUTION.md` §2 P6 (declarative authority).

Cross-reference: `governance/CONSTITUTION.md` §8 (authority + RE-ENVISION direct-edit authorization), `.claude/rules/capability-lifecycle.md` (lifecycle preset routing), D16-F16.2.5 (synthesis finding that drove this artifact).
