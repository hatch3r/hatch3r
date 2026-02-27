---
id: hatch3r-pr-description
type: prompt
description: Generate a pull request description from staged changes
---
# PR Description

Generate a pull request description for the current changes. Analyze the diff and produce a structured, reviewer-friendly PR description.

## Instructions

1. **Analyze the staged diff and recent commits** on this branch. Identify all files changed, lines added/removed, and the nature of each change.
2. **Identify the type of change:**

   | Type | Prefix | When to Use |
   |------|--------|-------------|
   | Feature | `feat:` | New functionality or capability |
   | Fix | `fix:` | Bug fix or error correction |
   | Refactor | `refactor:` | Code restructuring without behavior change |
   | Docs | `docs:` | Documentation only |
   | Test | `test:` | Adding or updating tests only |
   | Infra | `infra:` | CI/CD, build config, tooling |
   | Perf | `perf:` | Performance improvement |
   | Security | `security:` | Security fix or hardening |

3. **Write a concise title** following Conventional Commits: `{type}: {short description}` (max 72 characters).
4. **Write the body** with structured sections (see template below).
5. **Assess risk level** — low (docs, tests), medium (new feature, refactor), high (auth, data model, security).

## Edge Cases to Handle

- **Multiple change types:** If the PR spans types (e.g., feature + tests + docs), use the primary type and note others in the summary.
- **Breaking changes:** Always include a `## Breaking Changes` section with migration instructions. Prefix title with `feat!:` or `fix!:`.
- **Large PRs:** If the diff exceeds 500 lines, suggest splitting. List logical split points.
- **No linked issue:** Flag this — every PR should reference an issue.
- **Reverts:** Use `revert:` prefix and link to the original PR being reverted.

## Output Template

```markdown
## {type}: {short description}

### Summary

- {what changed — 1-3 bullet points explaining the change and why it was needed}

### Changes

| File | Change | Description |
|------|--------|-------------|
| `{path}` | Added / Modified / Deleted | {what and why} |

### Test Plan

- [ ] {how to verify the changes work — specific steps}
- [ ] {edge case verified}
- [ ] Lint and typecheck pass
- [ ] All tests pass

### Risk Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| **Scope** | Low / Med / High | {number of files, modules touched} |
| **Data impact** | None / Low / High | {any schema or data changes} |
| **Security** | None / Low / High | {auth, input validation, secrets} |
| **Rollback** | Easy / Complex | {can this be reverted cleanly?} |

### Breaking Changes

{None, or describe what breaks and how to migrate}

### Related

- Closes #{issue_number}
- Related: #{other_issue}
```

## Few-Shot Examples

### Example 1: Feature PR

**Input:** Diff adds a new rate-limiting middleware, updates 3 route files, adds tests.

**Output:**

```markdown
## feat: add rate limiting to public API endpoints

### Summary

- Add token-bucket rate limiter middleware to prevent abuse of public endpoints
- Apply 100 req/min limit to auth endpoints, 1000 req/min to read endpoints
- Return standard `429 Too Many Requests` with `Retry-After` header

### Changes

| File | Change | Description |
|------|--------|-------------|
| `src/middleware/rateLimiter.ts` | Added | Token-bucket implementation with Redis backing |
| `src/routes/auth.ts` | Modified | Apply rate limiter with auth-tier limits |
| `src/routes/api.ts` | Modified | Apply rate limiter with standard-tier limits |
| `tests/unit/rateLimiter.test.ts` | Added | 8 tests covering burst, steady-state, and reset |

### Test Plan

- [ ] Verify 429 returned after exceeding limit
- [ ] Verify `Retry-After` header is accurate
- [ ] Verify rate limit resets after window expires
- [ ] Load test confirms no false positives under normal traffic

### Risk Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| **Scope** | Medium | 3 route files + new middleware |
| **Data impact** | None | No schema changes |
| **Security** | Low | Additive security improvement |
| **Rollback** | Easy | Remove middleware from routes |

### Breaking Changes

None

### Related

- Closes #42
```

### Example 2: Bug Fix PR

**Input:** Diff fixes an off-by-one error in pagination, adds a regression test.

**Output:**

```markdown
## fix: correct off-by-one in cursor pagination

### Summary

- Fix pagination returning duplicate items when cursor falls on page boundary
- Root cause: `>=` comparison should have been `>` in cursor offset calculation

### Changes

| File | Change | Description |
|------|--------|-------------|
| `src/db/pagination.ts` | Modified | Fix boundary comparison operator |
| `tests/unit/pagination.test.ts` | Modified | Add regression test for boundary cursor |

### Test Plan

- [ ] Verify no duplicates at page boundary (regression test added)
- [ ] Verify first page, last page, and empty result still work
- [ ] Existing pagination tests still pass

### Risk Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| **Scope** | Low | Single line fix + test |
| **Data impact** | None | Read-only query change |
| **Security** | None | No auth changes |
| **Rollback** | Easy | Revert single commit |

### Breaking Changes

None

### Related

- Closes #87
```
