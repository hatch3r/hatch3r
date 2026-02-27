---
id: hatch3r-bug-triage
type: prompt
description: Triage a bug report and suggest investigation steps
---
# Bug Triage

Triage the described bug and produce a structured investigation plan with severity classification, root cause hypotheses, and recommended fix approach.

## Instructions

1. **Classify severity** using the matrix below. Consider both user impact and data integrity risk.
2. **Identify affected area** from the description — map to specific modules, services, or components.
3. **Assess blast radius** — how many users are affected? Is data at risk? Are there downstream effects?
4. **List 3–5 investigation steps** with specific files, functions, or logs to check. Order by likelihood of finding the root cause.
5. **Suggest a minimal reproduction path** — exact steps a developer can follow to reproduce the bug locally.
6. **Propose a fix approach** if the root cause is evident, including which files to change and what tests to add.
7. **Flag related issues** — check for similar past bugs, related symptoms, or recent regressions.

## Severity Matrix

| Priority | Criteria | Response SLA | Examples |
|----------|----------|-------------|----------|
| **P0** | Data loss, security breach, complete service outage | Immediate (drop everything) | Credential leak, database corruption, auth bypass |
| **P1** | Core feature broken, no workaround, significant user impact | Same day | Login fails, payments broken, data not saving |
| **P2** | Feature degraded, workaround exists, moderate user impact | Within sprint | Slow page load, intermittent error, UI glitch on edge case |
| **P3** | Cosmetic issue, minor inconvenience, low frequency | Backlog | Typo, alignment off by 1px, tooltip truncated |

## Edge Cases to Consider

- Is this a regression? Check recent deploys and PRs merged near the reported time.
- Is this environment-specific? Different behavior in dev/staging/prod, different browsers, or different locales.
- Is this timing-dependent? Race conditions, timezone issues, cache staleness.
- Is this data-dependent? Specific user data, edge-case input values, empty/null states.
- Is this intermittent? Flaky behavior suggests concurrency, caching, or external dependency issues.

## Output Template

```markdown
## Bug Triage: {short title}

### Classification

| Field | Value |
|-------|-------|
| **Priority** | P0 / P1 / P2 / P3 |
| **Affected Area** | {module / service / component} |
| **Blast Radius** | {all users / subset / single user} |
| **Regression?** | Yes (since {version/date}) / No / Unknown |
| **Data at Risk?** | Yes ({what data}) / No |

### Reproduction Steps

1. {exact step}
2. {exact step}
3. {exact step}
- **Expected:** {what should happen}
- **Actual:** {what happens instead}
- **Environment:** {browser, OS, locale, or server environment}

### Investigation Plan

| # | Step | Where to Look | What to Check |
|---|------|---------------|---------------|
| 1 | {action} | `{file:function}` | {what to look for} |
| 2 | {action} | `{log source}` | {pattern or error message} |
| 3 | {action} | `{git log / deploy history}` | {recent changes in area} |

### Root Cause Hypotheses

| Rank | Hypothesis | Likelihood | Evidence |
|------|-----------|-----------|----------|
| 1 | {most likely cause} | High / Med / Low | {supporting evidence} |
| 2 | {alternative cause} | High / Med / Low | {supporting evidence} |

### Recommended Fix

- **Approach:** {description of fix}
- **Files to change:** {list}
- **Tests to add:** {regression test description}
- **Rollback plan:** {if fix is risky}

### Related Issues

- #{N} — {title} ({similarity reason})
```

## Few-Shot Examples

### Example 1: P0 Security Bug

**Input:** "Users can see other users' billing information by changing the user ID in the URL."

**Output:**

```markdown
## Bug Triage: IDOR in billing endpoint

### Classification

| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Affected Area** | API — billing routes |
| **Blast Radius** | All users with billing data |
| **Regression?** | Unknown — check when `/api/billing/:userId` was added |
| **Data at Risk?** | Yes — billing addresses, payment method last-4, invoice history |

### Investigation Plan

| # | Step | Where to Look | What to Check |
|---|------|---------------|---------------|
| 1 | Check auth middleware | `src/routes/billing.ts` | Is `requireAuth` applied? Does it verify `userId === req.user.id`? |
| 2 | Check authorization | `src/middleware/auth.ts` | Is ownership validated, not just authentication? |
| 3 | Check other user-scoped routes | `src/routes/*.ts` | Same pattern may exist elsewhere |

### Recommended Fix

- **Approach:** Add ownership check: `if (params.userId !== req.user.id) return 403`
- **Files to change:** `src/routes/billing.ts`, `src/middleware/auth.ts` (add `requireOwnership` helper)
- **Tests to add:** Test that user A cannot access user B's billing endpoint
```

### Example 2: P2 UI Bug

**Input:** "Date picker shows wrong month when timezone is UTC-12."

**Output:**

```markdown
## Bug Triage: Date picker timezone offset

### Classification

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Affected Area** | UI — DatePicker component |
| **Blast Radius** | Users in far-west timezones (low frequency) |
| **Regression?** | No — likely always present |
| **Data at Risk?** | No — display only |

### Investigation Plan

| # | Step | Where to Look | What to Check |
|---|------|---------------|---------------|
| 1 | Check date construction | `src/components/DatePicker.ts` | Is `new Date()` used without timezone normalization? |
| 2 | Check locale formatting | `src/utils/dates.ts` | Is `Intl.DateTimeFormat` using the correct timezone? |
| 3 | Test with mocked timezone | `tests/unit/` | Set `TZ=Etc/GMT+12` and verify month calculation |

### Recommended Fix

- **Approach:** Normalize to UTC before extracting month/year for display
- **Tests to add:** Parameterized test across UTC-12, UTC, UTC+14
```
