---
id: researcher-mode-migration-path
type: mode
description: Design a phased execution plan with safe ordering and rollback points.
tags: [core, planning, implementation]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `migration-path`

Design a phased execution plan with safe ordering. Each phase must leave the codebase in a working state. Identify parallel lanes, rollback points, and map phases to execution skills.

**Output structure:**

```markdown
## Migration Path

### Phase Overview
| Phase | Title | Scope | Depends On | Skill | Effort | Rollback Point? |
|-------|-------|-------|-----------|-------|--------|----------------|
| 0 | {test scaffolding} | {add missing tests before refactoring} | — | hatch3r-qa-validation | S/M | Yes |
| 1 | {first transformation} | {what changes} | Phase 0 | hatch3r-refactor | S/M/L | Yes |

### Phase Details

#### Phase {N}: {Title}
- **Goal:** {what this phase achieves}
- **Transformations:** {list of specific changes}
- **Files:** {list with change descriptions}
- **Behavioral invariants:** {what must still hold after this phase}
- **Verification:** {how to confirm the phase is successful}
- **Rollback:** {how to revert this phase without affecting others}

### Parallel Lanes
| Lane | Phases | Why Independent |
|------|--------|----------------|
| A | {phase numbers} | {no shared files or interfaces} |
| B | {phase numbers} | {no shared files or interfaces} |

### Critical Path
{phase X} → {phase Y} → {phase Z} (total: {effort estimate})

### Completion Criteria
- [ ] All phases completed and verified
- [ ] All behavioral invariants confirmed via tests
- [ ] No regression in existing test suite
- [ ] Dead code from old patterns removed
- [ ] Documentation updated (specs, ADRs)

### Skill Mapping
| Phase | Execution Skill | Why |
|-------|----------------|-----|
| {phase} | hatch3r-refactor | Structural code quality improvement |
| {phase} | hatch3r-logical-refactor | Behavior or logic flow change |
| {phase} | hatch3r-visual-refactor | UI/UX component change |
| {phase} | hatch3r-qa-validation | Test scaffolding before refactoring |
```
