---
id: hatch3r-cli-gh
description: "GitHub CLI — repos, issues, PRs, releases, gists. Use when drafting GitHub pull requests, issues, releases, gists, or workflow dispatches; invoke `gh`. Authenticates via the platform's native token mechanism (OAuth / PAT)."
tags: ["cli-tools", "forge", "orchestration"]
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

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking `gh`, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the target repo/PR/issue number is not explicit (e.g. "close the PR" with several open), confirm which one before acting — never guess the number.
- **Irreversibility:** `gh pr close`, `gh pr merge`, `gh release create`, `gh issue close`, `gh repo delete`, and `gh api -X DELETE/POST/PATCH` mutate remote state. Confirm intent before running any of these; they are not safe to assume.
- **Ambiguity:** when the request maps to two or more flag combinations with materially different blast radius (e.g. `--squash` vs `--rebase` on `gh pr merge`), ask which one.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a single-tool usage reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `.claude/rules/fan-out-discipline.md` (P8 B2).

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

- Don't reach for `gh` against a GitLab or Azure DevOps remote. Reach for `glab` or `az repos`/`az devops` (both covered in `hatch3r-cli-toolbox` — Forges section).
- Don't use `gh auth login` flows when an audit trail of who authorized what is required; OAuth scopes granted to the CLI are user-bound. Reach for the GitHub web UI plus org-level SSO logs.
- Don't use `gh api` for high-volume bulk fetches (>10k records) — rate limits bite. Reach for the GraphQL endpoint via `gh api graphql -F query=@file.gql` with pagination, or a GitHub App token.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `glab` (toolbox section) | GitLab forges — same operations, different vendor. |
| `az-devops` (toolbox section) | Azure DevOps forges. |
| `git` + `curl` against REST | Minimal environment (CI runner) where installing `gh` is blocked; trade convenience for raw HTTP. |
| GitHub web UI | Operations needing org-level approval flows or SAML re-auth that the CLI cannot proxy. |

## Detection / Install

Verify with:
```bash
command -v gh
```

Install (macOS — default for this machine):

```bash
# brew
brew install gh
```

Install (Linux):

```bash
# apt
sudo apt install gh
```

Install (Windows):

```bash
# winget
winget install GitHub.cli
```

Homepage: https://cli.github.com/

## Security

Minimum recommended version: `>=2.92.0`. Builds below this floor carry known unpatched advisories — upgrade before relying on the tool.

GHSA-crc3-h8v6-qh57: gh CLI before 2.92.0 may leak authentication tokens via auxiliary host extension calls. Upgrade to 2.92.0 or later before using gh against untrusted GitHub Enterprise hosts.
