# Test Requirements

Testing standards from `vitest.config.ts`:

**Global thresholds:** 78% statements, 65% branches, 80% functions, 80% lines.

**Critical module thresholds:**
- `src/merge/` and `src/integrity/`: 90/80/90/90 (stmt/branch/func/line)
- `src/content/` and `src/adapters/customization.ts`: 85/75/85/85

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
