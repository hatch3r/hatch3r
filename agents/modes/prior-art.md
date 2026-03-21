---
id: researcher-mode-prior-art
type: mode
description: Research best practices, known issues, and ecosystem trends via web search.
parent: hatch3r-researcher
---
### Mode: `prior-art`

Research best practices, known issues, ecosystem trends, and prior art via web search. Use for novel problems, security advisories, or approaches not covered by local docs or Context7.

**Output structure:**

```markdown
## Prior Art Research

### Best Practices
| # | Practice | Source | Applicability |
|---|---------|--------|--------------|
| 1 | {practice} | {source — blog, docs, RFC} | {how it applies to the subject} |

### Known Issues / CVEs
| # | Issue | Severity | Affected Versions | Mitigation |
|---|-------|----------|-------------------|------------|
| 1 | {issue or CVE} | {severity} | {versions} | {fix or workaround} |

### Ecosystem Trends
- {trend}: {relevance to the subject}

### Reference Implementations
- {project/example}: {what it demonstrates and how it's relevant}
```
