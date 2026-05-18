---
id: hatch3r-cli-gh
description: "GitHub CLI — repos, issues, PRs, releases, gists. Use when drafting GitHub pull requests, issues, releases, gists, or workflow dispatches; invoke `gh`. Authenticates via the platform's native token mechanism (OAuth / PAT)."
tags: ["cli-tools", "forge", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: gh
  bin: gh
  tier: 1
  category: forge
  homepage: https://cli.github.com/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# gh

GitHub CLI — repos, issues, PRs, releases, gists

## When to Use

Reach for `gh` when the task is in the **forge** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
gh pr view 123 --json title,state,body,reviewDecision
```
Targeted JSON projection — pulls just the fields the agent needs, not the whole PR payload.

```bash
gh issue list --label bug --json number,title,author --limit 50
```
Label-filtered list with capped page size — avoids paginating the entire issue corpus into context.

```bash
gh api repos/:owner/:repo/contents/path/to/file.ts --jq '.sha'
```
Direct REST passthrough with built-in `--jq` filter — single round-trip, no jq install required at call site.

```bash
gh run watch
```
Blocks until the most recent CI run finishes — pairs with PR creation flows so the agent doesn't poll.

```bash
gh release create v1.7.5 --notes-from-tag --target release/1.7.5
```
Cuts a release using annotated-tag notes; deterministic input avoids hand-edited release bodies.

```bash
gh pr checks 78 --watch
```
Live-tail status checks for a PR — return value reflects the worst check state, scripts can branch on it.

## Wrong Choice When

- Don't reach for `gh` against a GitLab or Azure DevOps remote. Reach for `glab` (`hatch3r-cli-glab`) or `az repos`/`az devops` (`hatch3r-cli-az-devops`).
- Don't use `gh auth login` flows when an audit trail of who authorized what is required; OAuth scopes granted to the CLI are user-bound. Reach for the GitHub web UI plus org-level SSO logs.
- Don't use `gh api` for high-volume bulk fetches (>10k records) — rate limits bite. Reach for the GraphQL endpoint via `gh api graphql -F query=@file.gql` with pagination, or a GitHub App token.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `glab` (`hatch3r-cli-glab`) | GitLab forges — same operations, different vendor. |
| `az-devops` (`hatch3r-cli-az-devops`) | Azure DevOps forges. |
| `git` + `curl` against REST | Minimal environment (CI runner) where installing `gh` is blocked; trade convenience for raw HTTP. |
| GitHub web UI | Operations needing org-level approval flows or SAML re-auth that the CLI cannot proxy. |

## Detection / Install

Verify with:
```bash
command -v gh
```

Install (mac):

```bash
# brew
brew install gh
```

Homepage: https://cli.github.com/
