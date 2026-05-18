---
id: hatch3r-cli-docker
description: "Container runtime and CLI. Use when image build, container run, exec inspection, or registry push commands; invoke `docker`. Talks to a running Docker Engine daemon over a Unix socket; perfect for x86 build hosts."
tags: ["cli-tools", "container"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: docker
  bin: docker
  tier: 2
  category: container
  homepage: https://docs.docker.com/get-docker/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# docker

Container runtime and CLI

## When to Use

Reach for `docker` when the task is in the **container** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
docker build -t myapp:dev .
```
Build a local tag from the cwd Dockerfile; layer cache hits keep rebuilds under a second.

```bash
docker run --rm -v "$PWD":/app -w /app node:22 npm test
```
Run a one-shot test container with the host repo mounted — no image rebuild, no leftover container.

```bash
docker compose up -d --build
```
Bring up the multi-service stack from `docker-compose.yml` in the background, rebuilding stale images.

```bash
docker run --rm -e DEBUG=1 myapp:dev sh -c 'env | sort'
```
Inspect the runtime environment a container actually sees; useful for diagnosing missing env vars.

```bash
docker inspect myapp:dev --format '{{.Config.Cmd}} {{.Config.Entrypoint}}'
```
Extract a single image setting via Go template — avoids piping 10KB of JSON to `jq`.

```bash
docker ps --format '{{.ID}} {{.Names}} {{.Status}}' --filter status=running
```
Compact running-container summary; one line per container, easy to grep.

## Wrong Choice When

- The goal is per-agent isolation only (file scoping, no service runtime) — `container-use` provides that without a long-running daemon.
- You are deploying to a Kubernetes cluster — go through `kubectl`/`helm`; `docker run` does not understand cluster semantics.
- The host already has `podman` and rootless containers — prefer it for security; the CLI surface is nearly identical.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `podman` | Want rootless containers and a daemonless model. |
| `container-use` | Need lightweight per-agent isolation; no service orchestration. |
| `nerdctl` | Existing containerd installation; do not need Docker Desktop. |

## Detection / Install

Verify with:
```bash
command -v docker
```

Install (mac):

```bash
# brew
brew install --cask docker
```

Homepage: https://docs.docker.com/get-docker/
