---
id: hatch3r-code-review
type: prompt
description: Review code changes for quality, security, and correctness
---
# Code Review

Review the provided code changes for quality, security, and correctness. Produce a structured review report with actionable feedback.

## Instructions

1. **Correctness** — Does the code do what it is supposed to? Verify against acceptance criteria, spec references, and expected behavior. Check for off-by-one errors, missing null/undefined handling, incorrect operator usage, and logic inversions.
2. **Security** — Input validation at boundaries, auth checks on every route, no secrets in code or logs, CSRF protection on mutations, parameterized queries, safe deserialization. Flag any trust boundary violations.
3. **Code Quality** — Naming follows conventions, functions < 50 lines, files < 400 lines, cyclomatic complexity ≤ 10, no dead code or unused imports, DRY without over-abstraction.
4. **Type Safety** — No `any`, no `@ts-ignore` without a linked issue, discriminated unions preferred over type assertions, `satisfies` over `as` where applicable.
5. **Performance** — No N+1 queries, no unnecessary allocations in hot paths, lazy loading for large imports, no unbounded list fetches, bundle size impact assessed.
6. **Testing** — New logic has unit tests, bug fixes have regression tests, edge cases covered, mocks are minimal and focused.
7. **Accessibility** — If UI changes: keyboard navigation, WCAG AA contrast (4.5:1), ARIA attributes, `prefers-reduced-motion` respected.
8. **Error Handling** — Errors caught and handled at the appropriate level, user-facing errors are informative but safe (no stack traces), fail-closed defaults.

## Edge Cases to Watch

- Empty collections and null/undefined inputs at boundaries
- Concurrent modifications and race conditions
- Unicode and multi-byte string handling
- Timezone-sensitive date operations
- Large payload sizes and pagination exhaustion
- Partial failures in batch operations

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Security vulnerability, data loss risk, privacy violation, incorrect business logic | Must fix before merge |
| **Warning** | Performance regression, missing tests, code quality violation, poor error handling | Should fix, PR author decides timing |
| **Suggestion** | Naming improvement, alternative pattern, readability enhancement | Nice to have, not blocking |

## Output Template

```markdown
## Code Review: {file or PR scope}

**Verdict:** APPROVE | REQUEST CHANGES | COMMENT

### Critical

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/auth.ts:42` | Missing token expiry check | Add `if (isExpired(token)) throw new AuthError(...)` |

### Warnings

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/api/users.ts:78` | No test for empty input case | Add unit test for `getUser(undefined)` |

### Suggestions

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/utils.ts:15` | `data` is vague | Rename to `userProfile` for clarity |

### Summary

- Critical: {n} | Warnings: {n} | Suggestions: {n}
- Test coverage: {assessed / not assessed}
- Security: {no issues / issues found}
```

## Few-Shot Examples

### Example 1: Security Issue Found

**Input:** A diff adding a new API endpoint:

```typescript
app.post("/api/admin/users", async (req, res) => {
  const user = await db.createUser(req.body);
  res.json(user);
});
```

**Output:**

```markdown
## Code Review: src/routes/admin.ts

**Verdict:** REQUEST CHANGES

### Critical

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/routes/admin.ts:12` | No auth middleware on admin endpoint | Add `requireAuth("admin")` middleware before handler |
| 2 | `src/routes/admin.ts:13` | `req.body` used without validation | Add zod schema: `const body = CreateUserSchema.parse(req.body)` |

### Warnings

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/routes/admin.ts:14` | Full user object returned including password hash | Return `omit(user, ["passwordHash"])` |

### Summary

- Critical: 2 | Warnings: 1 | Suggestions: 0
- Security: AUTH MISSING, INPUT UNVALIDATED
```

### Example 2: Clean Code with Minor Suggestions

**Input:** A utility function refactor with tests.

**Output:**

```markdown
## Code Review: src/utils/format.ts

**Verdict:** APPROVE

### Suggestions

| # | File:Line | Issue | Suggestion |
|---|-----------|-------|------------|
| 1 | `src/utils/format.ts:8` | `formatDate` accepts `any` | Use `Date | string | number` union type |

### Summary

- Critical: 0 | Warnings: 0 | Suggestions: 1
- Test coverage: 4 new tests added, edge cases covered
- Security: no issues
```
