---
id: researcher-mode-impact-analysis
type: mode
description: Map the blast radius of an issue across flows, modules, data, and users.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `impact-analysis`

Map the blast radius. Identify all flows, modules, data, and users affected. Find related issues or symptoms that might share the same cause. Assess data integrity risk and downstream consumers.

**Output structure:**

```markdown
## Impact Assessment

### Affected Flows
| Flow | Impact | Users Affected | Data at Risk? |
|------|--------|---------------|---------------|
| {user flow or system process} | {how it is affected} | {persona or segment} | Yes/No — {details} |

### Affected Modules
| Module / Area | How Affected | Severity | Coupling |
|---------------|-------------|----------|----------|
| {module} | {direct failure / degraded / cascading} | Critical/High/Med/Low | Direct/Indirect |

### Downstream Consumers
| Consumer | Coupling Type | Impact | Action Needed |
|----------|-------------|--------|--------------|
| {module/service/user} | {direct API / import / event / data} | {none / update needed / rewrite needed} | {what to do} |

### Data Integrity Risk
| Data | Risk | Detection | Recovery |
|------|------|-----------|----------|
| {what data is at risk} | {corruption / loss / inconsistency} | {how to detect damage} | {how to recover} |

### Related Symptoms
| # | Symptom | Reported? | Likely Same Cause? |
|---|---------|-----------|-------------------|
| 1 | {other observed issue} | Yes (#{issue}) / No | Yes/Likely/Unlikely |

### User-Facing Impact
- **Severity:** {Critical/High/Med/Low}
- **Scope:** {how many users, what percentage of traffic}
- **Workaround available:** {yes — describe / no}
```
