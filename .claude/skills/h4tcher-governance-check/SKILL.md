---
name: h4tcher-governance-check
description: Validate governance system health — lean thresholds, anti-slop compliance, invariant consistency, and pillar coverage. Pre-audit health check.
effort: medium
allowed-tools: Read Grep Glob Bash(*)
---

# Governance Check

Validate the governance system's internal consistency between audit cycles.

## Step 1: Lean Thresholds

1. Read `governance/CONSTITUTION.md` §2 P5 for lean threshold table
2. Count lines in each governance file:
   ```bash
   wc -l governance/CONSTITUTION.md governance/AUDIT.md governance/AUDIT-EXECUTE.md
   wc -l governance/audit/domains/D*.md
   ```
3. Flag any file exceeding its limit

## Step 2: Anti-Slop Scan

4. Read anti-slop wordlist from CLAUDE.md or `governance/AUDIT-EXECUTE.md` regression gate 10
5. Scan all governance markdown files:
   ```bash
   grep -rni "best possible\|best-in-class\|world-class\|comprehensive and thorough\|exhaustive\|robust and resilient\|high-quality\|it is important to note\|this section describes" governance/
   ```
6. Flag any hits — each is a governance quality violation

## Step 3: AUDIT.md Invariants

7. Read `governance/AUDIT.md` Summary Table
8. Verify:
   - Sub-agent totals match: sum of all domain SA counts = declared total
   - Tier weight sums: A + B + C + D = 1.000
   - Domain count in table matches file count in `governance/audit/domains/`
   - No orphaned domain files (files not in table)

## Step 4: Finding Registry

9. Read `governance/audit/finding-registry.json`
10. Verify:
    - Every finding has a unique ID
    - `merge_into`/`merged_from` links are bidirectional
    - No finding has status "in_progress" from a previous cycle (stale state)

## Step 5: Baseline

11. Read `governance/audit/baseline.json`
12. Verify schema completeness: commit SHA, test results, typecheck errors, lint warnings, build status, per-domain scores

## Step 6: Pillar Coverage

13. For each pillar (P1-P8), verify at least one governance file provides primary coverage
14. Cross-reference against CONSTITUTION.md §3 traceability matrix

## Report

Produce structured output:
```
## Governance Health Report
- Lean Thresholds: PASS/FAIL (list violations)
- Anti-Slop: PASS/FAIL (list hits with file:line)
- AUDIT.md Invariants: PASS/FAIL (list broken invariants)
- Finding Registry: PASS/FAIL (list issues)
- Baseline: PASS/FAIL (list missing fields)
- Pillar Coverage: PASS/FAIL (list uncovered pillars)
```
