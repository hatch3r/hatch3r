---
id: researcher-mode-boundary-analysis
type: mode
description: Map integration boundaries, external dependencies, and data flow seams for test targeting.
parent: hatch3r-researcher
---
### Mode: `boundary-analysis`

Map integration boundaries, external dependencies, data flow boundaries, and event chains to identify where integration and contract tests are most needed. Used by `hatch3r-test-plan` to ensure test coverage at system seams.

**Output structure:**

```markdown
## Boundary Analysis

### Module Boundaries
| Boundary | Module A | Module B | Interface Type | Current Test Coverage | Test Need |
|----------|----------|----------|---------------|---------------------|----------|
| {boundary name} | {module} | {module} | {API / import / event / shared state} | Covered/Partial/None | Integration/Contract/E2E |

### External Dependencies
| Dependency | Type | Mock Strategy | Current Mock Coverage | Risk if Unmocked |
|-----------|------|-------------|---------------------|-----------------|
| {database / API / service / SDK} | {runtime / build-time / optional} | {fake / stub / MSW / emulator / none} | Covered/Partial/None | {what breaks without proper mocking} |

### Data Flow Boundaries
| Flow | Source | Transform(s) | Sink | Validation Points | Test Coverage |
|------|--------|-------------|------|------------------|-------------|
| {flow name} | {where data enters} | {processing steps} | {where data is consumed} | {where validation happens} | Covered/Partial/None |

### Event / Callback Chains
| Event | Emitter | Listener(s) | Side Effects | Test Coverage |
|-------|---------|------------|-------------|-------------|
| {event name} | {where emitted} | {where consumed} | {what changes} | Covered/Partial/None |

### API Surface Coverage
| Endpoint / Interface | Methods | Parameters | Response Shapes | Test Coverage | Priority |
|---------------------|---------|-----------|----------------|-------------|----------|
| {endpoint or public interface} | {methods} | {param count / complexity} | {shape count} | Covered/Partial/None | P0/P1/P2/P3 |
```

**Depth scaling:**
- **quick**: Module boundaries + external dependencies only (top 5 each).
- **standard**: Full module boundaries, external dependencies, data flow boundaries, and API surface coverage.
- **deep**: All sections exhaustively. Include event/callback chains, full data flow tracing, and priority-ranked API surface analysis.
