---
id: pre-commit-lint-fixer
type: hook
event: pre-commit
agent: lint-fixer
description: Auto-fix lint and formatting issues before commit
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx"
tags: [implementation]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: pre-commit → lint-fixer

Activate the lint-fixer agent before each commit to automatically detect and fix lint errors, formatting issues, and style violations in staged files.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Identify all staged files matching the configured globs.
2. Run the project's configured linter (ESLint, Biome, etc.) and formatter (Prettier, dprint, etc.) against only the staged files.
3. Auto-fix any fixable violations (formatting, import ordering, unused imports, trailing whitespace).
4. If unfixable violations remain, report them clearly with file paths and line numbers so the developer can address them before committing.
5. Re-stage any auto-fixed files so the commit includes the corrections.

## Expected Output

- A summary of fixes applied (e.g., "Fixed 3 formatting issues in 2 files").
- If unfixable issues remain: a list of violations with file, line, rule ID, and message.
- If all files pass: a short confirmation ("All staged files pass lint and formatting checks").

## Configuration

`globs` is the one machine-parsed knob — it is a real frontmatter field. The severity behavior below is an agent-runtime default, not a config-file setting; to change it, state your preference in your prompt when the hook fires.

- **Globs**: Controlled by the `globs` frontmatter field. Adjust to match your project's source file extensions.
- **Tooling**: The agent auto-detects the project's lint/format stack from config files (`eslint.config.*`, `.prettierrc`, `biome.json`, etc.).
- **Severity**: By default, only errors block the commit. Ask the agent in your prompt to also block on warnings.
