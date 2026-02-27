---
id: hatch3r-git-conventions
type: rule
description: Git commit message and branching conventions
scope: always
---
# Git Conventions

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope)?: description

[optional body]

[optional footer(s)]
```

### Types
- `feat` — new feature (triggers minor version bump)
- `fix` — bug fix (triggers patch version bump)
- `chore` — maintenance, dependencies, config
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or updating tests
- `ci` — CI/CD configuration changes
- `perf` — performance improvement
- `build` — build system changes
- `style` — formatting, whitespace (no logic change)

### Rules
- Subject line: imperative mood, lowercase, no period, max 72 characters
- Body: wrap at 80 characters, explain what and why (not how)
- Breaking changes: add `!` after type/scope and `BREAKING CHANGE:` footer
- Reference issues: `Closes #123`, `Fixes #456`

## Branch Naming

Format: `{type}/{short-description}`

Examples:
- `feat/user-authentication`
- `fix/null-pointer-on-login`
- `chore/update-dependencies`
- `refactor/extract-adapter-base`
