---
id: researcher-mode-similar-implementation
type: mode
description: Search the codebase for analogous features and extract implementation conventions.
parent: hatch3r-researcher
---
### Mode: `similar-implementation`

Search the codebase for analogous features, components, or modules and extract their implementation conventions as a reference for the implementer. The goal is that new code follows established patterns rather than inventing new approaches.

**Protocol:**

1. Parse the task to extract the core *type* of work — CRUD resource, dashboard widget, API endpoint, auth flow, data pipeline, form, modal, notification, list/table view, search feature, file upload, webhook handler, background job, etc.
2. Search the codebase for modules and components that perform the same *type* of work. Use file name patterns, directory structure, import analysis, and semantic code search.
3. Rank matches by structural similarity: file organization, patterns used, complexity level, recency.
4. For the top 2-3 matches, extract:
   - File structure and naming conventions (file names, directory placement, barrel exports)
   - State management pattern (local state, context, store, server state, URL state)
   - Error handling approach (try/catch style, error boundaries, toast notifications, inline errors)
   - Data fetching / API pattern (hooks, services, direct fetch, query library)
   - Test structure and coverage approach (co-located vs separate, naming, mock strategy)
   - Component composition pattern (container/presenter, compound components, render props — if UI)
5. Identify where the proposed feature MUST differ from references and why (different data shape, different auth model, different performance requirements).
6. Present reference implementations with a recommendation for which to follow.

**Output structure:**

```markdown
## Similar Implementation Analysis

### Work Type Classification
- **Detected type:** {type of work — e.g., "CRUD resource with list view and detail page"}
- **Search strategy:** {how references were found — file patterns, directory scan, semantic search}

### Reference Implementations
| # | Module / Feature | Location | Similarity | Why It's a Good Reference |
|---|-----------------|----------|-----------|--------------------------|
| 1 | {name} | {directory/file path} | High/Med | {what makes it analogous} |
| 2 | {name} | {directory/file path} | High/Med | {what makes it analogous} |

### Convention Extraction

#### Reference 1: {name}
| Aspect | Convention | Files |
|--------|-----------|-------|
| File structure | {pattern — e.g., "feature directory with index barrel, component, hook, types, test files"} | {example files} |
| State management | {pattern — e.g., "React Query for server state + local useState for UI state"} | {example files} |
| Error handling | {pattern — e.g., "ErrorBoundary wrapper + toast for mutations + inline for forms"} | {example files} |
| Data fetching | {pattern — e.g., "custom hook wrapping useQuery, service layer for API calls"} | {example files} |
| Test structure | {pattern — e.g., "co-located .test.tsx, RTL for components, msw for API mocks"} | {example files} |
| Component composition | {pattern — e.g., "container fetches data, presenter renders, shared via compound"} | {example files} |

### Recommendation
- **Primary reference:** {name} — follow this for {rationale}
- **Secondary reference:** {name} — consult for {specific aspect}

### Divergence Warnings
| # | Aspect | Reference Pattern | Required Divergence | Reason |
|---|--------|------------------|-------------------|--------|
| 1 | {aspect} | {what the reference does} | {what the new feature must do differently} | {why} |

### Pattern-Match Checklist for Implementer
- [ ] File structure follows {reference} convention
- [ ] State management uses {pattern} as established in {reference}
- [ ] Error handling follows {pattern} from {reference}
- [ ] Data fetching uses {pattern} from {reference}
- [ ] Test structure matches {pattern} from {reference}
- [ ] Component composition follows {pattern} from {reference}
- [ ] Documented divergences with justification for each
```
