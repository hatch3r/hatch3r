---
id: hatch3r-cli-yq
description: "YAML processor (mikefarah Go implementation). Use when editing Kubernetes manifests, Helm values, or GitHub-Actions workflows in place; invoke `yq`. Preserves YAML anchors, comments, and ordering when editing in place."
tags: ["cli-tools", "yaml", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: yq
  bin: yq
  tier: 1
  category: yaml
  homepage: https://github.com/mikefarah/yq
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# yq

YAML processor (mikefarah Go implementation)

## When to Use

Reach for `yq` when the task is in the **yaml** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
yq '.spec.containers[].image' k8s/deployment.yml
```
Project every container image across multi-doc Kubernetes manifests — same path syntax as `jq`.

```bash
yq -i '.version = "1.7.5"' .hatch3r/hatch.json
```
In-place edit (`-i`) — single-shot version bumps without shelling out to a templating step.

```bash
yq -o=json '.' config.yml | jq '.servers | length'
```
Convert YAML to JSON on the wire so `jq` can take over for richer querying.

```bash
yq eval-all '. as $i ireduce ({}; . * $i)' base.yml override.yml
```
Deep-merge multiple YAML documents into one — pattern for layered config (base + env override).

```bash
yq -P -i '.tags |= sort | .' content.yml
```
Pretty-print preservation (`-P`) keeps comments/anchors stable while sorting the `tags` array in place.

## Wrong Choice When

- Don't assume `yq` flags work when the binary is actually the Python `kislyuk/yq` wrapper around jq — flags and filter dialect differ. Confirm `yq --version` reports `mikefarah` first; otherwise reach for `python-yq` documentation or install the Go build.
- Don't expect round-trip comment preservation without the `-P` (pretty) output mode; default JSON-style output drops comments. Reach for `yq -P` or `taplo` for TOML.
- Don't use `yq` on Kubernetes manifests when you actually need schema-aware validation. Reach for `kubectl explain` / `kubeconform` and use `yq` only for projection.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `jq` (`hatch3r-cli-jq`) | JSON input, or YAML converted via `yq -o=json` — jq's filter language has more rebuild idioms. |
| `dasel` | Multi-format (JSON/YAML/TOML/XML) single-binary path queries in CI. |
| `taplo` | TOML-specific formatting and schema validation (`pyproject.toml`, `Cargo.toml`). |
| `kubectl explain` | Kubernetes-resource schema lookup — `yq` projects, kubectl explains. |

## Detection / Install

Verify with:
```bash
command -v yq
```

Install (mac):

```bash
# brew
brew install yq
```

Homepage: https://github.com/mikefarah/yq
