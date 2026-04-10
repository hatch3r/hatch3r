---
id: researcher-mode-library-docs
type: mode
description: Look up current API documentation for specific libraries via Context7 MCP.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `library-docs`

Look up current API documentation for specific libraries or frameworks using Context7 MCP.

**Protocol:**
1. Call `resolve-library-id` with the library name to get the Context7-compatible ID.
2. Call `query-docs` with the resolved ID and the specific API question.
3. Summarize findings in structured output.

**Output structure:**

```markdown
## Library Documentation

### {Library Name} ({version})
| API / Function | Signature | Notes |
|---------------|-----------|-------|
| {API} | {signature or usage pattern} | {relevant constraints, deprecations, or gotchas} |

### Key Patterns
- {pattern}: {usage example with required parameters and expected output}

### Breaking Changes / Deprecations
- {item}: {migration path}
```
