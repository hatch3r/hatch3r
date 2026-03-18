---
id: researcher-mode-codebase-impact
type: mode
description: Analyze current codebase to understand what exists in the areas the subject touches.
parent: hatch3r-researcher
---
### Mode: `codebase-impact`

Analyze the current codebase to understand what exists today in the areas the subject touches. Map files, modules, components, integration points, and coupling.

**Output structure:**

```markdown
## Codebase Impact Analysis

### Affected Modules
| Module / Area | Current State | Changes Needed | Coupling Risk |
|---------------|--------------|----------------|---------------|
| {module} | {what exists today} | {what needs to change} | Low/Med/High |

### Affected Files
| File Path | Change Type | Description |
|-----------|-------------|-------------|
| {path} | Create/Modify/Extend | {what changes and why} |

### Integration Points
| Integration | Current Behavior | Required Change | Breaking? |
|-------------|-----------------|-----------------|-----------|
| {component/API/event} | {current} | {new} | Yes/No |

### Patterns in Use
- **{pattern}**: {where used} — {implications for this subject}

### Transitive Dependency Trace
For each file expected to change, trace importers up to 3 levels deep. This reveals the full blast radius beyond directly modified files.

| Modified File | Direct Importers (L1) | Transitive Importers (L2) | Deep Importers (L3) |
|--------------|----------------------|--------------------------|-------------------|
| {file path} | {files that import this} | {files that import L1} | {files that import L2} |

### API Consumer Map
For each function, class, or interface expected to change, list all call sites across the codebase.

| Symbol | Type | Call Sites | Contract Change Risk |
|--------|------|-----------|---------------------|
| {function/class/interface name} | Function/Class/Interface/Type | {file:line — list of all usages} | High/Med/Low — {why} |

### Type Contract Surface
For each modified type or interface, list all consumers and flag potential contract violations.

| Type / Interface | Consumers | Fields Affected | Breaking Potential |
|-----------------|-----------|----------------|-------------------|
| {type name} | {list of files/modules using this type} | {which fields change} | Yes/No — {what could break} |

### Event / Callback Chain
Trace event emitters, listeners, callback registrations, and pub/sub patterns that depend on modified behavior.

| Event / Callback | Emitter | Listeners / Subscribers | Behavior Change? |
|-----------------|---------|------------------------|-----------------|
| {event name or callback} | {where it's emitted/called} | {where it's consumed} | Yes/No — {what changes} |

### Blast Radius Summary
| Category | Count | Risk Level |
|----------|-------|-----------|
| Directly modified files | {N} | — |
| Direct importers (L1) | {N} | High |
| Transitive importers (L2) | {N} | Medium |
| Deep importers (L3) | {N} | Low |
| API consumers with contract risk | {N} | High |
| Type consumers with breaking potential | {N} | High |
| Event/callback chain participants | {N} | Medium |
| **Total files at risk** | **{N}** | — |

### Current State Summary
{2-3 paragraphs describing the relevant codebase area, existing conventions, and how the subject fits into the current architecture}
```

**Depth scaling for transitive tracing:**
- **quick**: Skip transitive tracing sections entirely. Only produce the standard tables (Affected Modules, Affected Files, Integration Points, Patterns in Use).
- **standard**: Produce Transitive Dependency Trace (L1 only) and Blast Radius Summary. Skip API Consumer Map, Type Contract Surface, and Event/Callback Chain.
- **deep**: Produce all sections — full 3-level trace, API Consumer Map, Type Contract Surface, Event/Callback Chain, and Blast Radius Summary.
