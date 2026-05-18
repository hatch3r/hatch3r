---
id: hatch3r-cli-glab
description: "GitLab CLI — merge requests, issues, pipelines. Use when GitLab merge-request review, pipeline retries, and issue triage; invoke `glab`. Authenticates via the platform's native token mechanism (OAuth / PAT)."
tags: ["cli-tools", "forge"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: glab
  bin: glab
  tier: 2
  category: forge
  homepage: https://gitlab.com/gitlab-org/cli
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# glab

GitLab CLI — merge requests, issues, pipelines

## When to Use

Reach for `glab` when the task is in the **forge** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
glab mr list --assignee=@me --output json | jq '.[] | {iid, title, web_url}'
```
List merge requests assigned to the authenticated user; `--output json` keeps stdout structured.

```bash
glab mr view 42 --output json
```
Fetch a single MR's metadata as JSON — avoids the HTML-decorated default view.

```bash
glab mr diff 42
```
Print the unified diff for an MR to stdout; pipe to `delta` for review or `diff -u` parsing.

```bash
glab issue create --title 'tracking-id mismatch on import' --label bug --label backend
```
Open an issue from a script; the URL is printed on stdout for the agent to capture.

```bash
glab ci view --branch main
```
Show the pipeline status for `main`; agents should re-run with `--output json` for parseable output.

```bash
glab api projects/:fullpath/jobs --paginate
```
Raw API call with auto-pagination for endpoints the high-level commands do not cover.

## Wrong Choice When

- The repo lives on GitHub, not GitLab — use `gh` (Tier 1) which has parity for issues/PRs/checks.
- The repo lives in Azure Repos — use `az devops` (Tier 2 sibling) with the same credential model.
- You only need to read a public file at a known URL — `curl` is one HTTP round-trip versus `glab`'s auth dance.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `gh` | GitHub-hosted repository. |
| `az devops` | Azure DevOps / Azure Repos. |
| `curl` + `GITLAB_TOKEN` | Endpoint not exposed by `glab api`; need explicit retry/timeout control. |

## Detection / Install

Verify with:
```bash
command -v glab
```

Install (mac):

```bash
# brew
brew install glab
```

Homepage: https://gitlab.com/gitlab-org/cli
