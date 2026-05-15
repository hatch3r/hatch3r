---
id: hatch3r-cli-podman
description: "Daemonless container engine, rootless by default (Docker alternative). Use when rootless OCI-image execution without a privileged daemon; invoke `podman`. Forks per-pod processes directly under the invoking user; ideal for hardened CI workers."
tags: ["cli-tools", "container", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: podman
  bin: podman
  tier: 3
  category: container
  homepage: https://podman.io/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# podman

Daemonless container engine, rootless by default (Docker alternative)

## When to Use

Reach for `podman` when the task is in the **container** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
podman build -t myapp:dev .
```
Build an image from the local Dockerfile — same CLI surface as docker build.

```bash
podman run --rm -v "$PWD:/app:Z" -w /app node:22 npm test
```
Run a one-shot container with the working directory bind-mounted; the `:Z` suffix triggers SELinux relabel on Fedora/RHEL hosts.

```bash
podman compose up
```
Run a `compose.yaml` workflow under podman — uses the podman-compose plugin or docker-compose adapter.

```bash
podman run --userns=keep-id -v "$PWD:/work" myapp
```
Preserve the host UID inside the rootless container so written files do not end up owned by a high-mapped UID.

```bash
podman system service --time=0 &
```
Expose a docker-API-compatible socket so docker-only tooling (e.g. testcontainers) can talk to podman unchanged.

## Wrong Choice When

- **Enterprise compose / swarm orchestration:** `hatch3r-cli-docker` (tier 2) is the established path for Swarm and Docker Desktop integration; podman's swarm support is minimal.
- **macOS developer experience parity:** docker desktop has native macOS VM tuning; podman runs in a QEMU machine with extra overhead and bind-mount caveats.
- **Tooling that hard-codes `/var/run/docker.sock`:** unless you start `podman system service`, those tools fail.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-docker` (tier 2) | Mainstream CI, Docker Desktop, Swarm, broad ecosystem assumptions |
| nerdctl + containerd | Kubernetes-aligned runtime, OCI-faithful CLI |
| buildah | Image builds without a full container runtime (rootless, scriptable) |

## Detection / Install

Verify with:
```bash
command -v podman
```

Install (mac):

```bash
# brew
brew install podman
```

Homepage: https://podman.io/
