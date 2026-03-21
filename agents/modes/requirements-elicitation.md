---
id: researcher-mode-requirements-elicitation
type: mode
description: Detect ambiguities and missing requirements, generate structured questions across 10 dimensions.
parent: hatch3r-researcher
---
### Mode: `requirements-elicitation`

Analyze the task description against the codebase to detect ambiguities, unstated assumptions, and missing requirements. Generate structured questions for the user across 10 dimensions to resolve unknowns before implementation. Triggered by the `hatch3r-deep-context` rule based on complexity tier.

**Protocol:**

1. Parse the task description for vague language ("improve", "better", "proper", "handle", "support", "clean up", "fix", "update") and flag each instance.
2. Identify unstated assumptions by comparing the task against the codebase structure — what does the task imply but not state explicitly?
3. For each of the 10 dimensions below, determine if the task description addresses it. If not, generate a targeted question.
4. Scan the codebase for modules that will be affected by the task. For each, check whether the task description accounts for its consumers, contracts, and side effects. Generate dependency-derived questions from gaps.
5. Check for cross-cutting concerns triggered by the task and list them with status (addressed / unaddressed).

**10 Dimensions:**

1. **Data** — schema shape, data source, expected volume, validation rules, migration needs
2. **Behavior** — success flow, error/failure flow, edge cases, concurrent access, idempotency
3. **UI/UX** — loading states, empty states, error states, responsive behavior, accessibility, animations
4. **Security** — auth/authz model, data sensitivity classification, input validation, rate limiting, CSRF/XSS
5. **Performance** — expected data volume, caching strategy, pagination, lazy loading, bundle impact
6. **Integration** — existing features this interacts with, shared state, event chains, API consumers
7. **Migration** — existing data or behavior that changes, backward compatibility, rollback strategy
8. **Observability** — logging requirements, metrics, error tracking, audit trail for the new behavior
9. **Testing** — what constitutes "working", acceptance test scenarios, edge case coverage expectations
10. **Rollout** — feature flags, phased rollout, A/B testing, rollback trigger conditions

**Output structure:**

```markdown
## Requirements Elicitation

### Ambiguity Detection
| # | Term / Phrase | Context | Why It's Ambiguous | Suggested Clarification |
|---|--------------|---------|-------------------|------------------------|
| 1 | {vague term} | {where it appears} | {what's unclear} | {specific question} |

### Dimension Probe Questions
| # | Dimension | Question | Why This Matters | Default If Unanswered |
|---|-----------|----------|-----------------|----------------------|
| 1 | {dimension} | {specific question} | {what could go wrong without an answer} | {safe default the implementer would assume} |

### Dependency-Derived Questions
| # | Module / Interface | Consumers | Question |
|---|-------------------|-----------|----------|
| 1 | {module being changed} | {list of consumers} | {question about contract impact} |

### Cross-Cutting Concern Checklist
| Concern | Triggered? | Addressed in Task? | Action Needed |
|---------|-----------|-------------------|--------------|
| Authentication / Authorization | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Internationalization (i18n) | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Accessibility (a11y) | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Error Handling | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Data Validation | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Observability / Logging | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Backward Compatibility | Yes/No | Yes/No/Partial | {what to clarify or confirm} |
| Feature Flags / Rollout | Yes/No | Yes/No/Partial | {what to clarify or confirm} |

### Requirements Summary
- **Resolved:** {N} dimensions fully addressed
- **Needs clarification:** {N} questions requiring user input before implementation
- **Safe defaults available:** {N} questions where a reasonable default exists if the user defers
```
