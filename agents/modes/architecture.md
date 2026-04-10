---
id: researcher-mode-architecture
type: mode
description: Design the architectural approach with data model changes, API contracts, and component design.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `architecture`

Design the architectural approach. Identify data model changes, API contracts, component design, and whether existing patterns should be followed or new ones introduced. Flag any decisions that warrant ADRs.

**Output structure:**

```markdown
## Architecture Design

### Data Model Changes
| Entity / Table | Change Type | Fields / Schema | Migration Needed? |
|---------------|-------------|-----------------|-------------------|
| {entity} | Create/Alter/None | {fields or schema changes} | Yes/No |

### API / Interface Contracts
| Endpoint / Interface | Method | Input | Output | Notes |
|---------------------|--------|-------|--------|-------|
| {endpoint or interface} | {method} | {shape} | {shape} | {constraints} |

### Component Design
| Component | Responsibility | Depends On | New/Existing |
|-----------|---------------|-----------|--------------|
| {name} | {what it does} | {dependencies} | New/Existing |

### Pattern Alignment
- **Follows existing:** {patterns from the codebase this should follow}
- **New patterns needed:** {any new patterns introduced, with justification}

### Architectural Decisions Requiring ADRs
| # | Decision | Context | Recommended | Alternatives |
|---|----------|---------|-------------|--------------|
| 1 | {title} | {why this decision matters} | {pick} | {alt1}, {alt2} |

### Dependency Analysis
| Dependency | Type | Status | Notes |
|-----------|------|--------|-------|
| {what this depends on} | Hard/Soft | Exists/Needs building | {notes} |
```
