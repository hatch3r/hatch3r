---
name: domain-author
description: Create or modify an audit domain file with sub-agent decomposition, scenario-based checklists, and governance invariant verification.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

# Domain Author

Create or modify an audit domain definition in `governance/audit/domains/`.

## Step 1: Understand Domain Standards

1. Read `governance/AUDIT.md` — sections: Domain Weighting, Summary Table, Sub-Agent Behavioral Charter
2. Read `governance/CONSTITUTION.md` §2 — lean thresholds for domain files (30-80 lines)

## Step 2: Study Existing Domains

3. Read 2-3 existing domain files in `governance/audit/domains/` to understand pattern:
   - Scope line with artifact count
   - Sub-agent count declaration
   - Sub-agent decomposition table (SA | Focus | Artifact Count)
   - Audit checklists per sub-agent (4-8 items each)
   - Domain boundary paragraph

## Step 3: Design the Domain

4. Determine tier placement:
   - **Tier A (Foundational):** Core infrastructure everything depends on
   - **Tier B (Quality):** Content and operational quality assurance
   - **Tier C (System-Level):** Cross-cutting behavior and patterns
   - **Tier D (Strategic):** Market and roadmap alignment
5. Calculate domain weight: tier total must remain constant. New domain splits weight equally with tier peers
6. Define sub-agents (target: 4-6 per domain, each focused on a distinct scope)

## Step 4: Write Checklists

7. Per sub-agent, write 4-8 checklist items. Prefer scenario-based items over question-based:
   - Scenario: "What happens when a user runs `hatch3r init` in a monorepo with 5 packages?"
   - Question (weaker): "Is monorepo support implemented?"
8. Include specific file references in checklist items
9. Write domain boundary paragraph clarifying scope overlap with adjacent domains

## Step 5: Update Governance

10. Update `governance/AUDIT.md` Summary Table: add row, update sub-agent totals
11. Update Domain Weighting table: recalculate peer weights so tier total is preserved
12. Verify invariants:
    - All tier weight subtotals sum to 1.000
    - Total sub-agent count matches sum of all domain counts
    - Every domain in the Summary Table has a file in `governance/audit/domains/`
    - No orphaned domain files
13. Check lean threshold: domain file should be 30-80 lines
