---
id: test-requirements
type: rule
description: Testing standards from vitest.config.ts — 78/65/80/80 global coverage, 90/80/90/90 for src/merge, 85/70/85/85 for src/content, 85/75/85/85 for adapters/customization, 85/75/85/85 for src/install and src/audit.
tags: [maintainer, testing, p2, p5]
scope: always
precedence: high
---

# Test Requirements

> Last updated: 2026-07-09

**Pillars:** P2 (Scientific Quality), P5 (Governance Self-Quality)

Testing standards from `vitest.config.ts`:

**Global thresholds:** 78% statements, 65% branches, 80% functions, 80% lines.

**Critical module thresholds:**
- `src/merge/`: 90/80/90/90 (stmt/branch/func/line)
- `src/content/`: 85/70/85/85 (stmt/branch/func/line)
- `src/adapters/customization.ts`: 85/75/85/85
- `src/install/` and `src/audit/`: 85/75/85/85

**Rules:**
- Every new source file in `src/` gets a corresponding test in `src/__tests__/`
- No `test.skip` or `test.todo` without a tracking issue reference
- Tests use vitest — do not introduce other test frameworks
- Run `npm test` before committing to verify no regressions
- Run `npx tsc --noEmit` and `npm run lint` alongside tests

**Coverage check after changes:**
```
npm test -- --coverage
```
