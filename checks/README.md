# Checks

Review criteria definitions for automated and agent-assisted code review. Each check file defines a set of criteria that agents reference when reviewing code changes.

## How Checks Work

- Agents load check files during code review to evaluate changes against defined criteria.
- Each check file focuses on one concern (code quality, security, testing, etc.).
- Criteria are pass/fail — a change either meets the criterion or doesn't.
- Agents report findings per-criterion, noting which passed and which need attention.

## File Format

Each check file uses frontmatter with:

```yaml
---
id: check-name
type: check
description: What this check evaluates
---
```

The body contains sections of review criteria organized by category.

## Usage

Agents (particularly `hatch3r-reviewer`) reference checks during code review:

1. Load the relevant check files based on the type of change.
2. Evaluate each criterion against the diff.
3. Report pass/fail per criterion with specific findings.
4. Block merging if any critical criterion fails.

## Available Checks

| Check | Focus Area |
|-------|------------|
| `code-quality` | Code standards, complexity, maintainability |
| `security` | Vulnerability patterns, input validation, secrets |
| `testing` | Test coverage, test quality, regression tests |

## Adding New Checks

1. Create a new `.md` file in this directory with the frontmatter format above.
2. Define criteria grouped by category — each criterion should be specific and actionable.
3. Mark criteria as `[CRITICAL]` if failure should block the PR, or `[RECOMMENDED]` for advisory.
4. Update this README with the new check in the Available Checks table.
