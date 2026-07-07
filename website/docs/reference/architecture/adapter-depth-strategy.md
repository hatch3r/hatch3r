---
title: Adapter Depth Strategy
---

# Adapter Depth Strategy

hatch3r supports 3 AI coding tools, each with different platform capabilities, market adoption, and integration depth. This document defines a three-tier investment model that allocates engineering effort proportionally to each adapter's impact and platform maturity. As of 1.9.0 the adapter set was hard-cut to the 3 Tier-1 adapters; Tier 2 and Tier 3 currently hold no adapters and define the depth bar a future adapter must clear (see [CHANGELOG](https://github.com/hatch3r/hatch3r/blob/main/CHANGELOG.md) for the 12 adapters removed in the cut).

## Tier Model

### Tier 1 -- Deep

Full feature parity with the canonical content model. These adapters receive first-class support because the underlying platforms have the richest integration surfaces and the largest user bases. **All 3 currently supported adapters are Tier 1.**

**Adapters:** Claude Code, Cursor, Copilot

**Scope:**
- All content types: agents, rules, skills, commands, hooks
- MCP server configuration and tool routing
- Managed blocks with safe partial updates
- Both output strategies (native per-file config, bridge files)
- Platform-specific optimizations (Claude `CLAUDE.md` conventions, Cursor `.mdc` frontmatter, Copilot YAML frontmatter)
- GitHub Agents support (Copilot)

### Tier 2 -- Standard

Core feature support covering the content types most teams rely on daily — the bar for a platform with solid capabilities and growing adoption that does not yet justify full parity investment.

**Adapters:** none currently (reserved for future additions).

**Scope a Tier-2 adapter would receive:**
- Core content types: agents, rules, commands
- Managed blocks with safe partial updates
- Primary output format per platform (bridge file or native config)
- MCP configuration where the platform supports it
- Skills and hooks emitted when the platform has a matching primitive

**Not in scope (deferred to tier promotion):**
- Platform-specific optimizations beyond the primary output format
- Advanced prompt/hook routing
- GitHub Agents integration

### Tier 3 -- Basic

Minimal viable adapter producing enough configuration for the tool to operate with hatch3r content — the bar for an emerging or niche platform with a limited configuration surface.

**Adapters:** none currently (reserved for future additions).

**Scope a Tier-3 adapter would receive:**
- Config file generation (tool-specific settings file)
- Bridge file with concatenated rules and project context
- Basic agent instructions (single instruction file or convention doc)

**Not in scope (deferred to tier promotion):**
- Managed blocks (full file regeneration on sync)
- Per-content-type output (rules, commands, skills emitted separately)
- MCP configuration
- Multi-file output strategies

## Strategy Rationale

Depth investment follows a simple principle: allocate engineering effort where the combination of market share and platform capability produces the highest return.

- **Tier 1 platforms** have both large user bases and rich integration APIs. A bug or missing feature here affects the most users and leaves the most capability on the table. These adapters are tested against every content model change. All 3 supported adapters sit here.
- **Tier 2** is the bar for a platform with either strong adoption or strong capability, but not both at the level of Tier 1. A future Tier-2 adapter would receive the features that deliver the most value with the least platform-specific engineering.
- **Tier 3** is the bar for a platform that is early in its lifecycle, has a minimal configuration surface, or serves a niche audience. A future Tier-3 adapter would get a basic config so hatch3r works, while keeping maintenance cost low until promotion criteria are met.

## Adapter Capability Matrix

The 3 supported adapters (all Tier 1):

| Adapter | Tier | Agents | Rules | Commands | Skills | Hooks | MCP | Managed Blocks | Output Strategy |
|---------|------|--------|-------|----------|--------|-------|-----|----------------|-----------------|
| Cursor | 1 | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Native (`.mdc`) |
| Claude Code | 1 | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Bridge (`CLAUDE.md`) + Native |
| Copilot | 1 | Yes | Yes | Yes | Yes | -- | Yes | Yes | Native (YAML frontmatter) |

## Tier Promotion Criteria

An adapter is promoted to the next tier when it meets **at least three** of the following criteria:

### Tier 3 to Tier 2

| Criterion | Measurement |
|-----------|-------------|
| **User demand** | 10+ GitHub issues or feature requests referencing the adapter in a 90-day window |
| **Platform capability additions** | The platform ships a multi-file config system, custom agent definitions, or MCP support |
| **Market share growth** | The tool enters the top 10 in developer survey adoption rankings (Stack Overflow, JetBrains, etc.) |
| **Community contribution** | An external contributor submits and maintains adapter enhancements for two release cycles |
| **Competitive pressure** | A competing agent framework ships a deeper integration for the same platform |

### Tier 2 to Tier 1

| Criterion | Measurement |
|-----------|-------------|
| **User demand** | 25+ GitHub issues or the adapter is in the top 3 most-requested by hatch3r users |
| **Platform capability parity** | The platform supports per-file rules, agent definitions, MCP configuration, and managed content regions |
| **Market share** | The tool is in the top 5 AI coding tools by active users |
| **Feature gap impact** | Missing Tier 1 features are cited as a reason users cannot adopt hatch3r |
| **Maintenance capacity** | The team (or a dedicated maintainer) can commit to testing the adapter against every content model release |

Promotion decisions are reviewed each minor release. Demotion is possible if a platform is discontinued, loses significant market share, or removes integration capabilities.
