---
id: pre-commit-lint-fixer
type: hook
event: pre-commit
agent: lint-fixer
description: Auto-fix lint and formatting issues before commit
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx"
---
# Hook: pre-commit → lint-fixer

Activate the lint-fixer agent before each commit to automatically detect and fix lint errors, formatting issues, and style violations in staged files.
