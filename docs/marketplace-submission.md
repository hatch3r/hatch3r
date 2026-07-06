# Claude Plugins Marketplace Submission

This document is the agent-prepared submission package for listing **hatch3r** on the official Anthropic Claude Plugins marketplace (`anthropics/claude-plugins-official`).

> **Status:** PARTIAL — agent portion of audit finding C7-H16 complete (description-count refresh against `governance/inventory.json` re-verified Cycle 10 close-out, 2026-05-28). Human portion remains pending: in-app form submission at https://claude.ai/settings/plugins/submit (see "Submission Channels" below).

## Submission Channels

Per `https://code.claude.com/docs/en/plugins` (accessed 2026-04-19), official-marketplace submissions are made through the in-app submission forms, not via PR to `external_plugins/`:

- Claude.ai: https://claude.ai/settings/plugins/submit
- Console: https://platform.claude.com/plugins/submit
- Plugin directory submission form: https://clau.de/plugin-directory-submission

The `external_plugins/` PR convention referenced in the original C7-H16 finding is superseded by the in-app submission flow. The agent portion of this work unit prepares everything that the submission form requires (manifest, README sections, capability declaration); the remaining human action is form completion.

## Submission Field Values

### Project name

`hatch3r`

### One-line description

10-cycle-audited agentic coding setup: 29 agents, 53 skills, 67 rules, 30 commands, 7 hooks, and MCP integrations for Claude Code.

### Long description

hatch3r is an open-source CLI and Claude Code plugin that installs a tool-agnostic agentic coding setup into any repository. One command installs 29 agents, 53 skills, 67 rules, 30 commands, 7 lifecycle hooks, and MCP integrations. Selective install lets users choose only what their project needs (greenfield vs brownfield, solo vs team, minimal/standard/full presets).

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

- [x] Skills (53 — listed under `skills/`)
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
  "description": "10-cycle-audited agentic coding setup: 29 agents, 53 skills, 67 rules, 30 commands, 7 hooks, and MCP integrations. Counts derived from governance/inventory.json.",
  "version": "2.1.1",
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

**Description:** 10-cycle-audited agentic coding setup framework. One command installs 29 agents, 53 skills, 67 rules, 30 commands, 7 hooks, and MCP integrations into any repo.

**License:** MIT
**Repository:** https://github.com/hatch3r/hatch3r
**Homepage:** https://docs.hatch3r.com
**Install:** `npx hatch3r init` or `/plugin install hatch3r@claude-plugins-official`

### Capabilities
- 29 sub-agents (researcher, implementer, reviewer, fixer, test-writer, security-auditor, creator, etc.)
- 53 skills covering bug-fix, feature, release, incident-response, customization, and more
- 67 rules (code standards, testing, observability, security patterns, agent orchestration)
- 30 commands (board management, planning, workflow, operations)
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
hatch3r generates native configuration for 3 AI coding tools (Claude Code, Cursor, GitHub Copilot) from a single canonical source. Claude Code is one of those targets and ships with Agent Teams compatibility, plugin-style hooks emission (`.claude/hooks/hatch3r-hooks.json`), and `.mcp.json`.
```

## Human Portion Remaining

After this agent-prepared package:

1. **Visit** https://claude.ai/settings/plugins/submit (or https://platform.claude.com/plugins/submit) and complete the in-app submission form using the field values listed above.
2. **Verify** the marketplace listing appears under `claude-plugins-official` and that `/plugin install hatch3r@claude-plugins-official` resolves.
3. **(Optional, if the convention reverts to PR-based)** Fork `anthropics/claude-plugins-official`, add an `external_plugins/hatch3r/` entry pointing at this repo via `{ "source": { "source": "github", "repo": "hatch3r/hatch3r" } }` in the marketplace `plugins` array, and open the PR using the PR-style description above.

## Verification before submission

```bash
# Validate plugin manifest with Claude Code's built-in validator
claude plugin validate .

# Confirm hooks file is well-formed
cat .claude/hooks/hatch3r-hooks.json | jq .

# Confirm inventory counts match plugin.json description
npm run inventory && diff <(jq -r '.counts | {adapters, agents, skills, rules, rulesMdc, commands, hooks, pipeline, cliCommands} | to_entries[] | "\(.key)=\(.value)"' governance/inventory.json | sort) <(echo "agents=29
adapters=3
cliCommands=20
commands=30
hooks=7
pipeline=22
rules=67
rulesMdc=67
skills=53" | sort)
```
