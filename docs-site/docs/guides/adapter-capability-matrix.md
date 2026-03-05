---
sidebar_position: 3
title: Adapter Capability Matrix
---

# Adapter Capability Matrix

Living reference for framework capabilities vs. adapter implementations. Tracks what each adapter emits, what each platform supports natively, and where gaps remain.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Y** | Adapter emits files for this capability |
| **~** | Platform reads canonical `.agents/` paths natively; no adapter output needed |
| **B** | Bridge: content folded into an instruction file the platform reads |
| **--** | Platform has no known support for this capability |

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | githubAgents | hooks | model | agentTeams |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:------------:|:-----:|:-----:|:----------:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **copilot** | Y | Y | Y | Y | Y | Y | -- | Y | -- | Y | -- |
| **claude** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | Y |
| **cline** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **codex** | B | B | Y | -- | -- | Y | -- | -- | -- | Y | -- |
| **gemini** | B | B | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **windsurf** | Y | B | Y | -- | Y | Y | -- | -- | -- | Y | -- |
| **amp** | B | B | Y | -- | ~ | Y | -- | -- | -- | Y | -- |
| **opencode** | Y | Y | Y | -- | Y | Y | -- | -- | -- | Y | -- |
| **aider** | B | B | Y | -- | -- | -- | -- | -- | -- | Y | -- |
| **kiro** | Y | B | Y | -- | -- | Y | -- | -- | -- | Y | -- |
| **goose** | B | B | B | -- | -- | -- | -- | -- | -- | Y | -- |
| **zed** | B | B | -- | -- | -- | -- | -- | -- | -- | Y | -- |

**Claude Code `.mcp.json` compatibility:** The Claude adapter converts env var placeholders from `${env:VAR}` to `${VAR}` syntax and adds `type` fields (`stdio`/`http`) to each server entry, ensuring Claude Code can parse MCP config without manual editing.

For detailed output paths, bridge orchestration, and file format specifics per adapter, see the full [adapter-capability-matrix.md](https://github.com/hatch3r/hatch3r/blob/main/docs/adapter-capability-matrix.md) in the repository.
