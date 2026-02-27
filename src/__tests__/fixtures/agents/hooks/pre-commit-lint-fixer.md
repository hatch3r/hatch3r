---
id: pre-commit-lint-fixer
type: hook
event: pre-commit
agent: lint-fixer
description: Run lint fixes before committing
globs: src/**/*.ts, src/**/*.tsx
---
# Hook: pre-commit → lint-fixer

Automatically activate the lint-fixer agent before commits to catch and fix lint errors.
