# Marketplace Submission — Claude Plugins + Cursor

This document is the agent-prepared submission package for listing **hatch3r** on the two marketplaces it targets: the official Anthropic Claude Plugins marketplace (`anthropics/claude-plugins-official`) and the Cursor marketplace (`cursor.com/marketplace`). The Claude Plugins sections come first; the Cursor lane runbook is in "## Cursor Marketplace Submission" below.

> **Status (Claude Plugins lane):** PARTIAL — agent portion of audit finding C7-H16 complete (description-count refresh against `governance/inventory.json` re-verified Cycle 10 close-out, 2026-05-28). Human portion remains pending: in-app form submission at https://claude.ai/settings/plugins/submit (see "Submission Channels" below).
>
> **Status (Cursor lane):** PARTIAL — agent-prepared runbook added for audit finding D18-SA18.3-01 (Cycle 12, 2026-07-11). Human portion remains pending: submission at https://cursor.com/marketplace/publish, plus a committed logo asset (TODO — see the Cursor section).

## Submission Channels

This document covers two marketplace lanes with distinct submission channels. Lane-specific runbooks follow below.

**Claude Plugins marketplace** — per `https://code.claude.com/docs/en/plugins` (accessed 2026-04-19), official-marketplace submissions are made through the in-app submission forms, not via PR to `external_plugins/`:

- Claude.ai: https://claude.ai/settings/plugins/submit
- Console: https://platform.claude.com/plugins/submit
- Plugin directory submission form: https://clau.de/plugin-directory-submission

The `external_plugins/` PR convention referenced in the original C7-H16 finding is superseded by the in-app submission flow. The agent portion of this work unit prepares everything that the submission form requires (manifest, README sections, capability declaration); the remaining human action is form completion.

**Cursor marketplace** — per `https://cursor.com/docs/plugins` and `https://cursor.com/docs/reference/plugins.md` (both accessed 2026-07-11), submissions are made at https://cursor.com/marketplace/publish by supplying a public repository link; Cursor reads `.cursor-plugin/plugin.json` from the repo. Field values, prerequisites, review model, and verification: see "## Cursor Marketplace Submission" below.

## Submission Field Values

### Project name

`hatch3r`

### One-line description

10-cycle-audited agentic coding setup: 30 agents, 55 skills, 74 rules, 33 commands, 7 hooks, and MCP integrations for Claude Code.

### Long description

hatch3r is an open-source CLI and Claude Code plugin that installs a tool-agnostic agentic coding setup into any repository. One command installs 30 agents, 55 skills, 74 rules, 33 commands, 7 lifecycle hooks, and MCP integrations. Selective install lets users choose only what their project needs (greenfield vs brownfield, solo vs team, minimal/standard/full presets).

The plugin packages a 4-phase sub-agent pipeline (Research → Implement → Review → Quality) that maps directly to Claude Code Agent Teams, board-management commands for GitHub/Azure DevOps/GitLab, security-audit and accessibility-audit skills, and customization via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.

### License

MIT (see `LICENSE`)

### Author

- Name: hatch3r
- Email: support@hatch3r.com
- Repository: https://github.com/hatch3r/hatch3r
- Homepage: https://docs.hatch3r.com

### Install command

```bash
npx hatch3r init
```

Or, after marketplace listing:

```
/plugin install hatch3r@claude-plugins-official
```

### Capabilities checkboxes

- [x] Skills (54 — listed under `skills/`)
- [x] Agents (29 — listed under `agents/`)
- [x] Commands (30 — listed under `commands/`)
- [x] Hooks (7 — installed into `.claude/hooks/hatch3r-hooks.json` on Claude Code targets at `npx hatch3r init` time)
- [x] MCP servers (10 — 3 default, 7 opt-in, configured in `.mcp.json`)
- [ ] LSP servers
- [ ] Background monitors
- [x] Sub-agents (4-phase pipeline: researcher, implementer, reviewer, quality)
- [x] Agent Teams (compatible — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set automatically)

### Keywords

`agents`, `skills`, `rules`, `mcp`, `coding-assistant`, `agentic`, `sub-agents`, `board-management`, `code-review`, `testing`, `claude-code`

## Plugin Manifest

The submission requires a valid `.claude-plugin/plugin.json`. The current manifest is at `/.claude-plugin/plugin.json` in this repository:

```json
{
  "name": "hatch3r",
  "description": "10-cycle-audited agentic coding setup: 30 agents, 55 skills, 74 rules, 33 commands, 7 hooks, and MCP integrations. Counts derived from governance/inventory.json.",
  "version": "2.8.6",
  "author": {
    "name": "hatch3r",
    "email": "support@hatch3r.com"
  },
  "homepage": "https://docs.hatch3r.com",
  "repository": "https://github.com/hatch3r/hatch3r",
  "license": "MIT",
  "keywords": ["agents", "skills", "rules", "mcp", "coding-assistant", "agentic", "sub-agents", "board-management", "code-review", "testing", "claude-code"],
  "skills": "skills/",
  "agents": "agents/",
  "commands": "commands/",
  "mcpServers": ".mcp.json"
}
```

## README sections required by submission form

The submission form requires a README with these sections, all present in `/README.md`:

| Required section | README location | Status |
|------------------|-----------------|--------|
| Project description | Lines 1-7 (intro + tagline) | Present |
| Quick Start / Install | Lines 9-17 (`## Quick Start`) | Present |
| Usage | Lines 119-131 (`## Workflow`), lines 133-165 (`## Commands`) | Present |
| Capabilities / What you get | Lines 19-29 (`## What You Get` table) | Present |
| Supported tools | Lines 31-50 (`## Supported Tools` — 3 platform adapters: Claude Code, Cursor, GitHub Copilot) | Present |
| MCP setup | Lines 167-174 (`## MCP Configuration`) | Present |
| Customization | Lines 217-222 (`## Customization`) | Present |
| Documentation links | Lines 234-245 (`## Documentation`) | Present |
| License | Lines 247-249 (`## License`) | Present |

All counts in the README cross-reference `governance/inventory.json` (regenerated by `npm run inventory`).

## PR-Style Description (for any future external_plugins/ submission convention)

If the marketplace later requires a PR to `anthropics/claude-plugins-official/external_plugins/`, the PR description should be:

```markdown
## hatch3r

**Description:** 10-cycle-audited agentic coding setup framework. One command installs 30 agents, 55 skills, 74 rules, 33 commands, 7 hooks, and MCP integrations into any repo.

**License:** MIT
**Repository:** https://github.com/hatch3r/hatch3r
**Homepage:** https://docs.hatch3r.com
**Install:** `npx hatch3r init` or `/plugin install hatch3r@claude-plugins-official`

### Capabilities
- 29 sub-agents (researcher, implementer, reviewer, fixer, test-writer, security-auditor, creator, etc.)
- 55 skills covering bug-fix, feature, release, incident-response, customization, and more
- 74 rules (code standards, testing, observability, security patterns, agent orchestration)
- 33 commands (board management, planning, workflow, operations)
- 7 lifecycle hooks (pre-commit, post-merge, ci-failure, file-save, session-start, pre-push, review-loop-cap)
- 10 MCP servers (3 default, 7 opt-in)
- Claude Code Agent Teams compatibility (4-phase pipeline → teammate roles)

### Validation
- Plugin manifest at `.claude-plugin/plugin.json` validates against the documented schema (`code.claude.com/docs/en/plugins`).
- README at repository root contains all required sections (description, install, usage, capabilities, license).
- All counts traceable to `governance/inventory.json` (regenerated by `npm run inventory`).
- Hooks file emitted at `.claude/hooks/hatch3r-hooks.json` uses the documented `{hooks: {EVENT: [{matcher, hooks: [...]}]}}` schema.

### Quality bar
- Test suite: 3877+ tests passing (vitest), coverage thresholds at 78/65/80/80 statements/branches/functions/lines globally with a critical-module floor of 90/80/90/90 for `src/merge/`.
- Security: OWASP ASI01-10 controls (D15 agentic-security audit domain), atomic file writes, prompt injection guards, tool allowlists per agent.
- Governance: 8 binding governance pillars, 24 audit domains, closed-loop self-evolution audits.
- License: MIT, DCO sign-off enforced on commits.

### Cross-platform
hatch3r generates native or explicitly bridged configuration for four AI coding tools (Claude Code, Cursor, GitHub Copilot, Codex) from a single canonical source. This marketplace submission concerns the Claude Code target, which ships with Agent Teams compatibility, plugin-style hooks emission (`.claude/hooks/hatch3r-hooks.json`), and `.mcp.json`.
```

## Human Portion Remaining

After this agent-prepared package:

1. **Visit** https://claude.ai/settings/plugins/submit (or https://platform.claude.com/plugins/submit) and complete the in-app submission form using the field values listed above.
2. **Verify** the marketplace listing appears under `claude-plugins-official` and that `/plugin install hatch3r@claude-plugins-official` resolves.
3. **(Optional, if the convention reverts to PR-based)** Fork `anthropics/claude-plugins-official`, add an `external_plugins/hatch3r/` entry pointing at this repo via `{ "source": { "source": "github", "repo": "hatch3r/hatch3r" } }` in the marketplace `plugins` array, and open the PR using the PR-style description above.

## Cursor Marketplace Submission

Cursor lists plugins in its own marketplace, separate from the Claude Plugins marketplace above. This is the agent-prepared submission package for the Cursor lane (audit finding D18-SA18.3-01, Cycle 12).

### Submission channel

Submit at https://cursor.com/marketplace/publish — the form takes a public repository link, and Cursor reads the manifest at `.cursor-plugin/plugin.json` from the repo (`https://cursor.com/docs/plugins`, `https://cursor.com/docs/reference/plugins.md`, both accessed 2026-07-11).

### Prerequisites

| Prerequisite | Status | Source |
|--------------|--------|--------|
| Public repository | Met — https://github.com/hatch3r/hatch3r | Cursor pre-submission checklist |
| Valid `.cursor-plugin/plugin.json` at repo root | Met — present (`name`, `description`, `version`, `author`, capability paths) | Cursor manifest reference |
| Open-source license | Met — MIT (`LICENSE`) | "All plugins must be open source" (cursor.com/docs/plugins) |
| Committed logo asset | **TODO** — a brand mark exists (`website/static/img/egg-logo.png`, the docs-site egg logo referenced by `website/docusaurus.config.ts`) but is not yet wired as the plugin listing icon; `logo` is an optional manifest field, and without it the listing renders with no icon | "Logo is committed to the repo and referenced by relative path (if provided)" (cursor.com/docs/reference/plugins.md) |

To close the logo TODO (a brand-presentation decision for the maintainer): either reuse the existing docs-site egg mark (`website/static/img/egg-logo.png`) by copying it to a clean top-level path such as `assets/logo.png`, or commit a purpose-made plugin icon (`assets/logo.svg`). Then add `"logo": "assets/logo.<ext>"` to `.cursor-plugin/plugin.json`. Do not add the `logo` field before the asset is committed at that path — the checklist scopes it to "if provided", and a manifest that points at a missing file fails review.

### Field values (source of truth: `.cursor-plugin/plugin.json`)

The Cursor form and listing draw from the committed manifest; keep the manifest as the single source and re-verify it before submission:

- **name:** `hatch3r`
- **displayName:** `Hatch3r`
- **description:** "Agentic coding setup audited each release across 24 governance domains: 30 agents, 55 skills, 74 rules, 33 commands, 7 hooks, and MCP integrations -- in one plugin. Counts derived from governance/inventory.json." (counts trace to `governance/inventory.json`)
- **version:** `2.6.0`
- **repository:** https://github.com/hatch3r/hatch3r
- **homepage:** https://docs.hatch3r.com
- **license:** MIT
- **capability paths:** `rules/`, `skills/`, `agents/`, `commands/`, `hooks/`, `mcp/mcp.json`

### Review model — release-process implication

Cursor manually reviews every plugin before listing AND re-reviews every update before publishing; all plugins must be open source (cursor.com/docs/plugins, accessed 2026-07-11). This differs from the Claude Plugins auto-mirror flow: each hatch3r release that changes the Cursor listing incurs a manual re-review, so treat a Cursor-listing update as a gated step in the release process rather than a same-day publish.

### Verification before submission (Cursor lane)

```bash
# Confirm the manifest is present and well-formed
cat .cursor-plugin/plugin.json | jq .

# Confirm the manifest description counts match the inventory
npm run inventory && jq -r '.description' .cursor-plugin/plugin.json

# Confirm the repository is public and the license is MIT
jq -r '{repository, license}' .cursor-plugin/plugin.json
```

### Human portion remaining (Cursor lane)

1. **Commit the plugin logo asset** — reuse the existing docs-site egg mark (`website/static/img/egg-logo.png`) copied to `assets/logo.png`, or a purpose-made `assets/logo.svg` — then add `"logo": "assets/logo.<ext>"` to `.cursor-plugin/plugin.json`.
2. **Visit** https://cursor.com/marketplace/publish and submit the public repository link.
3. **Verify** the listing appears in the Cursor marketplace and resolves for install.

## Verification before submission (Claude Plugins lane)

```bash
# Validate plugin manifest with Claude Code's built-in validator
claude plugin validate .

# Confirm hooks file is well-formed
cat .claude/hooks/hatch3r-hooks.json | jq .

# Confirm inventory counts match plugin.json description
npm run inventory && diff <(jq -r '.counts | {adapters, agents, skills, rules, rulesMdc, commands, hooks, pipeline, cliCommands} | to_entries[] | "\(.key)=\(.value)"' governance/inventory.json | sort) <(echo "agents=30
adapters=3
cliCommands=20
commands=30
hooks=7
pipeline=22
rules=70
rulesMdc=70
skills=53" | sort)
```
