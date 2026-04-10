# Governance Lean Thresholds

Before modifying any governance file, check `wc -l` against these limits from `governance/CONSTITUTION.md` §2 P5:

| File | Limit |
|------|-------|
| `governance/CONSTITUTION.md` | <=200 lines |
| `governance/AUDIT.md` | <=600 lines |
| `governance/AUDIT-EXECUTE.md` | <=700 lines |
| Domain files (`governance/audit/domains/D*.md`) | 30-80 lines each |
| Cross-file duplication | <5% |
| Checklist items per sub-agent | 4-8 |

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.
