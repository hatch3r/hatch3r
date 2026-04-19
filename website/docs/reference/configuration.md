---
title: Configuration
---

# Configuration

hatch3r is configured through `hatch.json` (the project manifest), `.env.mcp` (secrets), and optional customization YAML files.

## hatch.json

The project manifest lives at `.agents/hatch.json` and is created by `npx hatch3r init`. It controls which tools are enabled, which MCP servers are active, board configuration, and model preferences.

To change your configuration after init, run `npx hatch3r config`. This interactive command walks through all settings (platform, tools, features, MCP servers, content items) pre-populated with current values, archives removed tool outputs, migrates any manual customizations, and runs a full update.

### Minimal example

```json
{
  "version": "2.0.0",
  "hatch3rVersion": "1.0.0",
  "platform": "github",
  "namespace": "my-org",
  "project": "my-repo",
  "repo": "my-repo",
  "tools": ["cursor", "claude"],
  "features": {
    "agents": true,
    "skills": true,
    "rules": true,
    "prompts": true,
    "commands": true,
    "mcp": true,
    "guardrails": false,
    "githubAgents": true,
    "hooks": true
  },
  "mcp": {
    "servers": ["playwright", "context7", "filesystem", "github"]
  },
  "managedFiles": []
}
```

### Key fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Manifest schema version (2.0.0) |
| `hatch3rVersion` | `string` | hatch3r version that generated this manifest |
| `platform` | `string` | Target platform: `github`, `azure-devops`, or `gitlab` (auto-detected from git remote) |
| `namespace` | `string` | Organization, group, or collection (replaces `owner`) |
| `project` | `string` | Project name (Azure DevOps project or GitLab group) |
| `repo` | `string` | Repository name |
| `owner` | `string` | *(deprecated)* GitHub organization or user -- use `namespace` instead |
| `tools` | `string[]` | Enabled coding tools (`cursor`, `copilot`, `claude`, `opencode`, `windsurf`, `amp`, `codex`, `gemini`, `cline`, `aider`, `kiro`, `goose`, `zed`) |
| `features` | `object` | Feature flags for content types |
| `mcp` | `object` | MCP server configuration |
| `board` | `object` | GitHub Projects V2 board configuration |
| `models` | `object` | AI model preferences |
| `claude` | `object` | Claude Code permissions and teammate mode |
| `content` | `object` | Content selection from init (preset, project type, team size, selected item IDs) |
| `workspace` | `object` | Workspace settings for workspace-managed repos (optional) |
| `worktree` | `object` | Git worktree file-isolation settings (see below) |
| `specs` | `object` | Project spec tracking (`paths`, `lastGenerated`) |
| `managedFiles` | `string[]` | List of files managed by hatch3r |

### Board configuration

```json
{
  "board": {
    "owner": "my-org",
    "repo": "my-repo",
    "defaultBranch": "main",
    "projectNumber": 1,
    "statusFieldId": null,
    "statusOptions": {
      "backlog": null,
      "ready": null,
      "inProgress": null,
      "inReview": null,
      "done": null
    },
    "labels": {
      "types": [],
      "executors": [],
      "statuses": [],
      "meta": []
    },
    "branchConvention": "type/issue-number-short-description",
    "areas": ["area:frontend", "area:backend", "area:infra"]
  }
}
```

The `statusFieldId`, `statusOptions`, and `labels` fields are populated automatically by `hatch3r-board-init`.

### Model configuration

```json
{
  "models": {
    "default": "opus",
    "agents": {
      "hatch3r-lint-fixer": "sonnet",
      "hatch3r-test-writer": "gemini-pro"
    }
  }
}
```

Model aliases are resolved before emission: `opus` -> `claude-opus-4-6`, `sonnet` -> `claude-sonnet-4-6`, `haiku` -> `claude-haiku-4-5`, `codex` -> `gpt-5.3-codex`, etc.

Resolution order (highest precedence first):

1. `.hatch3r/agents/{id}.customize.yaml`
2. `hatch.json` -> `models.agents.{id}`
3. Agent frontmatter `model:` field
4. `hatch.json` -> `models.default`
5. Platform auto-select

See the [Model Selection guide](../guides/model-selection) for full details.

### Content selection

The `content` field tracks which content items are installed. It is populated during `hatch3r init` and updated by `hatch3r config`.

```json
{
  "content": {
    "preset": "full",
    "projectType": "brownfield",
    "teamSize": "solo",
    "items": {
      "agents": ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-researcher"],
      "skills": ["hatch3r-feature", "hatch3r-bug-fix", "hatch3r-refactor"],
      "rules": ["hatch3r-code-standards", "hatch3r-testing", "hatch3r-git-conventions"],
      "commands": ["hatch3r-workflow", "hatch3r-quick-change", "hatch3r-feature-plan"],
      "prompts": ["hatch3r-bug-triage", "hatch3r-code-review", "hatch3r-pr-description"],
      "hooks": ["..."],
      "githubAgents": []
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `preset` | Content profile used during init: `minimal`, `standard`, `full`, or `custom` |
| `projectType` | `greenfield` (new project) or `brownfield` (existing codebase) |
| `teamSize` | `solo` or `team` |
| `items` | Explicit list of installed content IDs per type |

When `content` is `undefined` (legacy projects), `hatch3r update` and `hatch3r sync` treat it as "full" and operate on all files. The first `hatch3r update` on a legacy project auto-migrates by scanning disk and populating the `content` field.

### Workspace configuration

When `hatch3r init --workspace` is run in a directory containing multiple git repos, hatch3r creates a `workspace.json` manifest in `.agents/`. This file tracks workspace-level configuration and per-repo overrides.

```json
{
  "version": "1.0.0",
  "hatch3rVersion": "1.3.0",
  "name": "my-project",
  "syncStrategy": "on-sync",
  "defaults": {
    "platform": "github",
    "tools": ["cursor", "claude"],
    "features": { "agents": true, "skills": true, "rules": true, "...": true },
    "mcp": { "servers": ["github", "playwright"] },
    "content": { "preset": "full", "projectType": "brownfield", "teamSize": "team", "items": { "...": [] } }
  },
  "repos": [
    {
      "path": "frontend",
      "name": "frontend",
      "sync": true,
      "overrides": {
        "contentOverrides": {
          "include": ["hatch3r-a11y-audit"],
          "exclude": ["hatch3r-board-fill"]
        }
      }
    },
    {
      "path": "backend",
      "name": "backend",
      "sync": true,
      "overrides": {
        "tools": ["claude"]
      }
    },
    {
      "path": "infra",
      "name": "infra",
      "sync": false
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Workspace manifest schema version (1.0.0) |
| `hatch3rVersion` | `string` | hatch3r version that created/last updated this workspace |
| `name` | `string` | Workspace display name (defaults to directory name) |
| `syncStrategy` | `string` | `"manual"` (explicit `--repos` flag only) or `"on-sync"` (cascade on every sync) |
| `defaults` | `object` | Workspace-level defaults inherited by all sub-repos (tools, features, MCP, content) |
| `defaults.platform` | `string` | Default platform: `github`, `azure-devops`, or `gitlab` |
| `defaults.tools` | `string[]` | Default tools for all repos |
| `defaults.features` | `object` | Default feature flags |
| `defaults.mcp` | `object` | Default MCP server config |
| `defaults.content` | `object` | Default content selection (same format as hatch.json `content`) |
| `repos` | `array` | Registered sub-repo entries |
| `repos[].path` | `string` | Relative path from workspace root to the sub-repo |
| `repos[].name` | `string` | Display name (defaults to directory name) |
| `repos[].sync` | `boolean` | Whether to include this repo in sync cascades |
| `repos[].lastSync` | `string` | ISO timestamp of last successful sync |
| `repos[].overrides` | `object` | Per-repo overrides (all optional) |
| `repos[].overrides.tools` | `string[]` | Replaces workspace tools entirely |
| `repos[].overrides.features` | `object` | Partial merge on top of workspace features |
| `repos[].overrides.mcp` | `object` | Replaces workspace MCP config entirely |
| `repos[].overrides.contentOverrides.include` | `string[]` | Content IDs to add beyond workspace selection |
| `repos[].overrides.contentOverrides.exclude` | `string[]` | Content IDs to remove from workspace selection |

Content inheritance follows three layers: workspace defaults, then per-repo `include` additions, then per-repo `exclude` removals. Protected items (core agents) cannot be excluded.

When a sub-repo is synced, its `hatch.json` receives a `workspace` field with provenance metadata:

```json
{
  "workspace": {
    "rootPath": "..",
    "lastSync": "2026-03-16T10:00:00.000Z",
    "syncVersion": "1.3.0",
    "workspaceChecksum": "a1b2c3...",
    "excludedContent": ["hatch3r-board-fill"],
    "localContent": []
  }
}
```

Manage repos and sync settings interactively with `hatch3r config` or edit `workspace.json` directly.

### Worktree isolation

```json
{
  "worktree": {
    "enabled": true,
    "extraPatterns": [],
    "nodeModules": "symlink"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` (auto-enabled for Claude) | Enable worktree file isolation |
| `extraPatterns` | `string[]` | `[]` | Additional gitignore patterns to include in worktrees |
| `nodeModules` | `string` | `"symlink"` | Strategy for node_modules: `"symlink"` or `"skip"` |

When enabled, `hatch3r init` and `hatch3r sync` generate a `.worktreeinclude` file listing gitignored files that should be copied or symlinked into new worktrees. The Claude adapter automatically triggers `hatch3r worktree-setup` when it detects `git worktree add`.

### Claude Code permissions

```json
{
  "claude": {
    "permissions": {
      "allow": ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"],
      "deny": []
    },
    "teammateMode": "tool-using"
  }
}
```

## .env.mcp

Secrets for MCP servers are stored in `.env.mcp` at the project root. This file is gitignored and generated by `hatch3r init`.

```bash
# GitHub MCP server -- Classic PAT: repo, read:org, project.
# Fine-grained: Contents(RW), Issues(RW), Pull Requests(RW), Projects(RW)
GITHUB_PAT=ghp_xxxxxxxxxxxx

# Brave Search (free: 2,000 queries/month)
BRAVE_API_KEY=xxxxxxxx
```

When you add new MCP servers and re-run `hatch3r init` or `hatch3r sync`, new variables are appended without overwriting existing values.

### Required environment variables

| Server | Env Var | How to Get It |
|--------|---------|---------------|
| GitHub | `GITHUB_PAT` | [Create a PAT](https://github.com/settings/tokens/new) |
| Azure DevOps | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) |
| GitLab | `GITLAB_TOKEN` | [Create a PAT](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) |
| Brave Search | `BRAVE_API_KEY` | [Brave Search API](https://brave.com/search/api/) |
| Sentry | `SENTRY_AUTH_TOKEN` | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) |
| Postgres | `POSTGRES_URL` | Your PostgreSQL connection string |
| Linear | `LINEAR_API_KEY` | [Linear API keys](https://linear.app/settings/api) |

Playwright, Context7, and Filesystem are enabled by default and require no configuration. Platform-specific MCP servers (GitHub, Azure DevOps, or GitLab) are configured based on your selected platform during init.

## Customization Files

hatch3r supports per-entity customization via YAML files in `.hatch3r/`. See the [Customization guide](../guides/customization) for full details.

```
.hatch3r/
  agents/
    hatch3r-reviewer.customize.yaml
    hatch3r-implementer.customize.yaml
  commands/
    hatch3r-workflow.customize.yaml
  skills/
    hatch3r-feature.customize.yaml
  rules/
    hatch3r-code-standards.customize.yaml
```

Customization files take highest precedence in model resolution and allow project-specific behavior overrides without modifying managed agent definitions. Use `hatch3r-agent-customize`, `hatch3r-command-customize`, `hatch3r-skill-customize`, or `hatch3r-rule-customize` to manage them.

## Adapter Settings

Each adapter reads the manifest and canonical content to generate tool-specific output. The adapter determines:

- **Output paths** -- where generated files are written (e.g., `.cursor/rules/`, `.github/agents/`)
- **Format** -- how content is transformed (MDC frontmatter, YAML frontmatter, TOML, bridge markdown)
- **Feature gates** -- which content types are emitted based on `features.*` flags

See the [Adapter Capability Matrix](adapter-capability-matrix) for the full per-tool breakdown of output paths, formats, and capabilities.
