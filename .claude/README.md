# .claude/ — Claude Code project configuration

This directory holds the Claude Code configuration that ships with the repository.

## Files in this directory

| Path | Source-of-truth | Tracked in git? |
|------|-----------------|-----------------|
| `settings.json` | Shared team settings (permissions, hooks, teammate mode) | Yes |
| `settings.local.json` | **User-local overrides** layered on top of `settings.json` at session start | No — gitignored |
| `rules/*.md` | Project rules auto-loaded each session | 12 of 13 — `audit-cycle-awareness.md` ships via the private overlay (`.gitignore:42`) |
| `skills/h4tcher-*/SKILL.md` | Framework-internal slash commands (`/h4tcher-*`) | 9 of 15 — six governance-facing skills ship via the private overlay (`.gitignore:36-41`) |
| `hooks/session-start-registry.mjs` | SessionStart hook implementation referenced from `settings.json`; inert on a public clone — the governance-context loader targets the private `governance/` overlay and is guarded by `[ -f ]` | Yes |
| `hooks/pretooluse-allowlist.mjs`, `hooks/agent-tool-policies.json`, `hooks/hatch3r-hooks.json` | Generated dogfood: hatch3r's Claude adapter (`src/adapters/claude.ts`) writes these into this dev `.claude/` when the framework is run on itself; referenced from the generated `hooks/hatch3r-hooks.json`, not from `settings.json` | No — gitignored (`.gitignore` lines 54-56) |

Six governance-facing skills (`/h4tcher-audit-cycle`, `/h4tcher-audit-execute`, `/h4tcher-evolve`, `/h4tcher-domain-author`, `/h4tcher-governance-check`, `/h4tcher-scoped-audit`) and one rule (`audit-cycle-awareness.md`) ship only via the private `hatch3r-governance` overlay (`.gitignore:36-42`), so a public clone runs the framework without them — references to those `/h4tcher-*` commands and the SessionStart governance-context loader resolve only in the maintainer checkout.

## User-local overrides

To add permissions, hooks, or settings that should NOT be shared with other
contributors (for example: `Bash(rg:*)` allowlist for your personal workflow,
or a local-only `model` pin), put them in `.claude/settings.local.json`.

Claude Code merges `settings.local.json` over `settings.json` at session
start. `.gitignore` excludes `settings.local.json` so it never lands in a
commit.

If you need a setting available to every contributor, add it to
`settings.json` and commit the change.

## Reference

- Claude Code settings docs: https://code.claude.com/docs/en/settings
- Project pillar alignment: `governance/CONSTITUTION.md` §2 P5 (Governance Self-Quality)
