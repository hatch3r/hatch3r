---
id: file-save-context-rules
type: hook
event: file-save
agent: context-rules
description: Activate context-specific rules on file save
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx"
---
# Hook: file-save → context-rules

Activate context-specific rules when a file is saved, applying relevant coding standards and patterns based on the file's location and type.
