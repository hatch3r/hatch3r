---
id: code-quality
type: check
description: Code quality review criteria covering standards compliance, complexity, maintainability, and architectural patterns
---
# Code Quality Check

Review criteria for evaluating code quality in pull requests.

## Standards Compliance

- `[CRITICAL]` No type escape hatches (`any`, `@ts-ignore`, `// @ts-expect-error`) without a linked issue justification.
- `[CRITICAL]` All new functions and variables follow the project naming conventions (camelCase functions, PascalCase types, SCREAMING_SNAKE constants).
- `[CRITICAL]` No linter warnings introduced. The diff must not increase the warning count.
- `[RECOMMENDED]` Import ordering follows the canonical order: built-in, external, internal aliases, relative, type-only.

## Complexity

- `[CRITICAL]` No function exceeds 50 lines. If it does, it must be decomposed.
- `[CRITICAL]` Cyclomatic complexity does not exceed 10 per function.
- `[RECOMMENDED]` No file exceeds 400 lines. Large files should be split by responsibility.
- `[RECOMMENDED]` Nesting depth does not exceed 3 levels. Use early returns or extract helpers.

## Maintainability

- `[CRITICAL]` No dead code: unused imports, variables, functions, or commented-out code blocks.
- `[CRITICAL]` No placeholder code (`// TODO`, `// FIXME`, `// HACK`) without a linked tracking issue.
- `[RECOMMENDED]` Complex logic has inline comments explaining the *why*, not the *what*.
- `[RECOMMENDED]` Public API functions have JSDoc/docstring with parameter and return descriptions.

## Error Handling

- `[CRITICAL]` No swallowed errors (empty `catch` blocks or `catch` that only logs without re-throwing or returning an error result).
- `[CRITICAL]` Error messages are descriptive and include context (what failed, with what input, suggested action).
- `[RECOMMENDED]` Domain errors use custom error classes, not raw `Error("message")`.
- `[RECOMMENDED]` External call failures (HTTP, DB, file I/O) have retry or graceful degradation logic.

## Architecture

- `[CRITICAL]` No circular imports between modules. Check with dependency graph tools.
- `[CRITICAL]` New dependencies are justified — include a comment or PR description explaining why the existing stack doesn't suffice.
- `[RECOMMENDED]` Cross-module imports go through barrel exports (`index.ts`), not internal file paths.
- `[RECOMMENDED]` Side effects are isolated at the edges (API handlers, CLI entry points), not embedded in domain logic.

## Performance

- `[RECOMMENDED]` No N+1 query patterns in data fetching code.
- `[RECOMMENDED]` Large collections use pagination or streaming, not full in-memory loading.
- `[RECOMMENDED]` Expensive operations (crypto, compression, network) are not performed synchronously in request handlers.
