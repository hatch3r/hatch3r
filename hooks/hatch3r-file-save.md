---
id: file-save-context-rules
type: hook
event: file-save
agent: context-rules
description: Activate context-specific rules on file save
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx"
tags: [core]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: file-save → context-rules

Activate context-specific rules when a file is saved, applying relevant coding standards and patterns based on the file's location and type.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Determine the saved file's path and match it against the project's rule definitions in `the canonical `rules/` directory or `.hatch3r/rules/` (for customizations)`.
2. Load all rules where `scope: always` applies, plus any rules with glob patterns matching the saved file's path.
3. Evaluate the saved file's contents against the loaded rules — check for convention violations, pattern mismatches, or missing required elements (e.g., missing error handling in API routes, missing accessibility attributes in components).
4. If violations are found, surface them as inline warnings or suggestions (not blocking — file-save hooks should be non-disruptive).
5. Cache loaded rules for the session to avoid re-reading on every save.

## Expected Output

- **If violations found**: Non-blocking inline suggestions with rule ID, description, and the specific line(s) that violate the rule.
- **If clean**: No output (silent pass — do not emit noise on every save).

## Configuration

- **Globs**: Controlled by the `globs` frontmatter field. Adjust to match your project's source file extensions.
- **Rule sources**: Reads from `the canonical `rules/` directory or `.hatch3r/rules/` (for customizations)`. Rules with matching `globs` or `scope: always` are activated.
- **Debounce**: To avoid excessive processing during rapid saves, the agent debounces with a 2-second window (configurable via `debounceMs`).
