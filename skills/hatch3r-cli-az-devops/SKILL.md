---
id: hatch3r-cli-az-devops
description: "Azure DevOps work items, repos, pipelines via az CLI extension. Use when Azure DevOps work-item edits, repo pushes, and pipeline runs; invoke `az`. Authenticates via the platform's native token mechanism (OAuth / PAT)."
tags: ["cli-tools", "forge", "maintenance"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: az-devops
  bin: az
  tier: 2
  category: forge
  homepage: https://learn.microsoft.com/en-us/cli/azure/azure-devops
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# az-devops

Azure DevOps work items, repos, pipelines via az CLI extension

## When to Use

Reach for `az` when the task is in the **forge** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
az repos pr list --status active --query '[].pullRequestId' --output tsv
```
Print active PR IDs as a newline-separated list; `--query` (JMESPath) trims the payload before stdout.

```bash
az repos pr show --id 42 --output json
```
Fetch a single PR's metadata as JSON for downstream `jq` filters.

```bash
az boards work-item show --id 4242 --output json
```
Pull a work item (bug, task, user story) by numeric ID; one round-trip, structured output.

```bash
az boards work-item create --type Bug --title 'flaky import test' --description 'Repro: ...'
```
Open a work item from CI or an agent; the new ID is printed on stdout.

```bash
az pipelines run --name CI --branch main
```
Queue a pipeline run on a named definition; returns the build ID for polling.

```bash
az artifacts universal download --feed myfeed --name pkg --version 1.0.0 --path .
```
Fetch a Universal Package into the cwd — avoids the larger Azure Artifacts MCP equivalents.

## Wrong Choice When

- The repo is on GitHub — use `gh` (Tier 1); `az repos` will return 404s without a configured Azure project.
- The repo is on GitLab — use `glab` (Tier 2 sibling); same operations, native auth.
- You only need to download a public release asset — `curl` to the artifact URL is one hop.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `gh` | GitHub-hosted code or issues. |
| `glab` | GitLab-hosted code or issues. |
| `curl` + `AZURE_DEVOPS_PAT` | Endpoint not surfaced by `az devops`; need raw header control. |

## Detection / Install

Verify with:
```bash
command -v az
```

Install (mac):

```bash
# brew
brew install azure-cli && az extension add --name azure-devops
```

Homepage: https://learn.microsoft.com/en-us/cli/azure/azure-devops
