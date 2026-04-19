# Closed-Loop Agent Templates

> Last updated: 2026-04-19

**Pillars served:** P2 (primary), P5 (supporting).

Templates for AUDIT-EXECUTE.md Phases 5-7. Replace placeholders with registry values.

---

## PRD Update Agent (Phase 5)

### Task
Apply approved PRD Evolution Candidates from the audit report to `governance/hatch3r-prd.md`.

### Inputs
- `[PRD_EVOLUTION_TABLE]` — PRD Evolution Candidates table from audit report
- `[PRD_PATH]` — Path to `governance/hatch3r-prd.md`
- `[VISION_PATH]` — Path to `governance/VISION.md` (if available)
- `[REVIEWER_VERDICT]` — Final reviewer verdict
- `[DOMAIN_RESCORES]` — Domain re-scores from execution

### Process
1. Read the PRD Evolution Candidates table.
2. Filter: remove candidates tied to `failed` or `rolled_back` findings. Keep D17 (competitive) candidates regardless of execution status.
3. Present filtered candidates to user for batch approval (individual override for "Requires Vision Review" items).
4. For each approved candidate:
   a. Locate the target PRD section.
   b. Apply the proposed change (addition, modification, removal, or reprioritization).
   c. Preserve surrounding content and formatting.
5. Increment PRD version in the header. Update "Date" and "Supersedes" fields.
6. Add a "Changes in vX.Y" subsection with audit finding references.

### Constraints
- Do NOT restructure the PRD.
- "Requires Vision Review" items must be presented individually.
- Commit PRD changes separately from wave commits.

### Output
```
PRD Updated: vX.Y → vX.Z
Changes applied: N
  - [Section X]: [Change description] (Finding #N)
  ...
Skipped: N (user declined)
Vision conflicts: N (presented individually)
```

---

## Content Spec Agent (Phase 6)

### Task
Produce structured specifications for content gaps identified by the audit.

### Inputs
- `[CONTENT_GAP_TABLE]` — Content Gap Artifacts table from audit report
- `[VERIFIED_INVENTORY]` — Path to `.audit-workspace/verified-inventory.json`
- `[CONTENT_DIRS]` — Paths to existing content directories (agents/, skills/, rules/, commands/, prompts/, hooks/)

### Process
1. Read the Content Gap Artifacts table.
2. Scan existing content directories for naming conventions, frontmatter patterns, and file structure.
3. For each P1 item: produce a full specification (purpose, scope, file structure, key sections, dependencies, acceptance criteria).
4. For each P2 item: produce an outline specification (purpose, scope, file structure).
5. For each P3 item: list only (name, type, purpose).
6. Write specs to `.audit-workspace/content-specs/[proposed-name].md`.

### Constraints
- Do NOT implement content — produce specifications only.
- Follow existing naming conventions (`hatch3r-{name}`).
- Follow existing frontmatter patterns for the content type.
- Specs are ephemeral in `.audit-workspace/`.

### Output
```
Content Specs Produced:
  P1 (full): N specifications
  P2 (outline): N specifications
  P3 (listed): N items

Location: .audit-workspace/content-specs/
```

---

## Audit Evolution Agent (Phase 7)

### Task
Apply accepted Audit Self-Evolution Proposals to AUDIT.md and domain files.

### Inputs
- `[EVOLUTION_TABLE]` — Audit Self-Evolution Proposals table from audit report
- `[AUDIT_PATH]` — Path to `governance/AUDIT.md`
- `[DOMAINS_DIR]` — Path to `governance/audit/domains/`

### Process
1. Read the Audit Self-Evolution Proposals table.
2. For each proposal, present individually to the user:
   ```
   Proposal [N of M]:
   Target: [file/section]
   Change: [description]
   Evidence: [what triggered this]
   Risk: [potential issues]

   Accept? (yes / no / modify)
   ```
3. If "modify": capture user's modification before proceeding.
4. Apply accepted proposals:
   - AUDIT.md changes: modify the specific section in `governance/AUDIT.md`.
   - Domain file changes: modify the specific file in `governance/audit/domains/`.
   - New domain: create `governance/audit/domains/D{NN}-{name}.md` with scope, sub-agent table, and checklists.
   - Weight adjustments: recalculate all weights in the affected tier. Tier totals must sum to 1.00.
   - Sub-agent count changes: update Summary Table totals (parallel, sequential, total).
5. Run invariant checks:
   - All tier weight subtotals sum to 1.00
   - Total sub-agent count = sum of all domain sub-agent counts
   - Every domain in Summary Table has a corresponding file in `governance/audit/domains/`
   - No orphaned domain files
6. Update Component Inventory if count discrepancies were found.
7. Update Audit History table.

### Constraints
- Maximum 10 proposals per cycle.
- Each proposal requires individual user consent — no batch approval.
- Rejected proposals logged but not applied.
- Weight changes must preserve tier totals exactly.
- Never remove a domain — only add, split, or harden.
- This phase runs LAST.

### Output
```
Audit Evolution Applied:
  Accepted: N proposals
  Rejected: N proposals
  Modified: N proposals

  Invariant checks: [PASS/FAIL]
  Weight totals: A=[X] B=[X] C=[X] D=[X] Total=[1.00]
  Sub-agent total: [N]
```
