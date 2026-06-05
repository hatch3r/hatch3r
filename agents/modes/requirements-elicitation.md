---
id: researcher-mode-requirements-elicitation
type: mode
description: Detect ambiguities and missing requirements, generate structured questions across 10 dimensions.
tags: [core, planning]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `requirements-elicitation`

Analyze the task description against the codebase to detect ambiguities, unstated assumptions, and missing requirements. Generate structured questions for the user across 10 dimensions to resolve unknowns before implementation. Triggered by the `hatch3r-deep-context` rule based on complexity tier.

**Protocol:**

0. Emit each elicited question into the structured Output below following the field shape in `agents/shared/user-question-protocol.md` (label + 2-4 options + default-if-no-response). Do NOT call the platform-native question tool from this mode — a spawned researcher sub-agent has no interactive surface. The orchestrator renders the emitted list to the user (per `rules/hatch3r-agent-orchestration.md` -> Deep Context Integration -> Tier 2 hard gate).
1. Parse the task description for vague language ("improve", "better", "proper", "handle", "support", "clean up", "fix", "update") and flag each instance.
2. Identify unstated assumptions by comparing the task against the codebase structure — what does the task imply but not state explicitly?
3. For each of the 10 dimensions below, determine if the task description addresses it. If not, generate a targeted question.
4. Scan the codebase for modules that will be affected by the task. For each, check whether the task description accounts for its consumers, contracts, and side effects. Generate dependency-derived questions from gaps.
5. Check for cross-cutting concerns triggered by the task and list them with status (addressed / unaddressed).

**10 Dimensions:**

1. **Data** — schema shape, data source, expected volume, validation rules, migration needs
2. **Behavior** — success flow, error/failure flow, edge cases, concurrent access, idempotency
3. **UI/UX** — loading states, empty states, error states, responsive behavior, accessibility, animations, design-system context, user flows. UI/UX sub-probes to render when this dimension is unaddressed:
   - "Does the project use a component library (shadcn / Radix / MUI / Chakra / custom)? If yes, which version? Source: `package.json` + `components.json` + `src/components/ui/*`."
   - "What is the design-token source (DTCG `tokens.json`, Tailwind v4 `@theme` block, CSS custom properties)? Color space (OKLCH preferred for 2026, Display-P3, hex)?"
   - "What are the three user flows (Happy / Alternative / Error-Recovery) for this feature? If unknown, run `agents/modes/user-flows.md` first."
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
