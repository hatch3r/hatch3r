---
id: researcher-mode-symptom-trace
type: mode
description: Trace reported symptoms through the codebase to find divergence points.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `symptom-trace`

Trace reported symptoms through the codebase. Map the execution path from user action to observed failure. Identify where expected behavior diverges from actual behavior.

**Output structure:**

```markdown
## Symptom Trace

### Execution Path
| # | Step | File / Function | Expected Behavior | Observed / Likely Behavior |
|---|------|----------------|-------------------|---------------------------|
| 1 | {user action or trigger} | {entry point} | {what should happen} | {what likely happens} |
| 2 | {next step in flow} | {file:function} | {expected} | {observed or inferred} |

### Divergence Point
- **Where:** {file:function or module where behavior diverges}
- **What:** {description of the divergence}
- **Evidence:** {code patterns, conditions, or state that suggest this is the divergence point}

### Error Propagation
| From | To | How | Observable? |
|------|----|-----|-------------|
| {origin} | {downstream} | {mechanism — exception, bad state, silent failure} | Yes/No |

### Affected Code Paths
| Path | Entry Point | Risk of Symptom | Notes |
|------|-------------|----------------|-------|
| {flow name} | {file:function} | High/Med/Low | {why this path is affected} |

### Data Flow Concerns
- {any data integrity, state management, or concurrency concerns identified during tracing}
```
