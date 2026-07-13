---
sidebar_position: 0
title: About hatch3r
---

# About hatch3r

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI (and Cursor plugin) that installs a tool-agnostic agentic coding setup into any repository. It maintains a single canonical source of agent configuration — agents, skills, rules, commands, hooks, and MCP integrations — and generates native configuration for 3 AI coding platforms: Claude Code, Cursor, and GitHub Copilot. You define your setup once; hatch3r adapts it to whichever supported tool you use.

One command (`npx hatch3r init`) gives you the full set, optimized for your coding tool of choice. Selective init installs only what your project type and team size need.

## What hatch3r is

- **A generation pipeline.** hatch3r owns the entire path from one canonical content source to tool-native output: `.mdc` rules with frontmatter scoping for Cursor, `CLAUDE.md` with managed blocks for Claude Code, and `.github/instructions/` + `.github/prompts/` + `.github/agents/` for GitHub Copilot. It also emits board commands, MCP server config, and event-driven hooks.
- **Tool-agnostic by design.** A single source of truth with adapters for the 3 supported platforms. The canonical content ships inside the bundled npm package; adapters read from there directly.
- **Audited per release.** Canonical content is reviewed each release across 24 governance domains before it ships.
- **Customizable without forking.** Managed blocks (`<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->`) preserve your edits across updates, per-agent model selection is configurable, and `.hatch3r/overrides/` is an escape hatch for user-authored canonical content.

## What hatch3r is not

- **Not a single instruction file.** [AGENTS.md](https://agents.md) is the greatest-common-denominator markdown standard for agent instructions, consumed by 20+ tools. hatch3r is complementary, not a competitor: AGENTS.md describes one file's content; hatch3r generates structured, platform-specific output across 5 artifact classes (rules, skills, commands, hooks, MCP servers) for the 3 supported platforms. Use AGENTS.md alone when one flat file suffices; use hatch3r when you need the full content-plus-tooling stack.
- **Not a rule-distribution tool.** hatch3r is complementary to tools like Ruler that distribute a single instruction file. hatch3r owns the full generation pipeline rather than syncing one file.
- **Not a runtime sandbox.** hatch3r generates configuration; it does not isolate or sandbox the AI coding tool that consumes it. Tools run with your shell credentials. See the [trust model reference](./reference/trust-model) for what the framework does and does not guarantee.
- **Not multi-tool sprawl.** As of 1.9.0, hatch3r supports exactly 3 adapters (Claude Code, Cursor, GitHub Copilot). Twelve earlier adapters were removed in a deliberate scope cut to keep the supported surface current and maintainable.

## Who it is for

hatch3r is for developers and teams who use AI coding tools and want a maintained, structured agentic setup instead of hand-rolling per-tool configuration. It fits:

- **Solo developers** who want a working setup in one command (`npx hatch3r init --default`).
- **Teams** standardizing agent behavior across Claude Code, Cursor, and Copilot from one source.
- **Greenfield and brownfield projects** alike — init detects your repo context (greenfield/brownfield, solo/team) and platform (GitHub, Azure DevOps, GitLab auto-detected from the git remote), and filters content accordingly.

The only prerequisite for first-run success is Node.js 22+.

## The quality bar

hatch3r holds the content it generates to measurable standards rather than informal judgment. Generated end-user code is evaluated against named, checkable targets — for example:

| Target | Threshold |
|--------|-----------|
| Generated UI accessibility violations (axe-core, serious/critical) | 0 |
| Design-token adoption in generated code (color, spacing, typography) | >= 95% |
| Four-state surface contract coverage on generated async views (loading, empty, error, partial) | 100% |
| Generated-service observability (OpenTelemetry) on the request path | 100% |
| API breaking-change events on stable endpoints | 0 per release |
| Supply-chain floor coverage | 100% |

These are a representative slice; the full list of content-quality thresholds ships with the framework.

## Pillar framework

This summarizes the pillar framework from hatch3r's internal governance constitution (maintained in a private governance repo); the tables below are the public reference.

Every change to hatch3r serves at least one pillar on one of two axes.

**Governance axis (P1-P8)** — how the framework operates:

| Pillar | Name |
|--------|------|
| P1 | CLI UI/UX Excellence |
| P2 | Scientific & Practical Quality |
| P3 | Adapter & External Tool Currency |
| P4 | Comprehensive Lean Coverage |
| P5 | Governance Self-Quality |
| P6 | Security & Trust Governance |
| P7 | Speed & Token Efficiency |
| P8 | Clarification & Fan-out Discipline |

**Content-quality axis (CQ1-CQ10)** — what the framework produces in end-user code and its upstream spec artifacts. Each pillar is owned by a specialist agent invoked at quality gates with measurable thresholds:

| Pillar | Name |
|--------|------|
| CQ1 | UI |
| CQ2 | UX |
| CQ3 | Security |
| CQ4 | Reliability |
| CQ5 | Testability |
| CQ6 | Scalability |
| CQ7 | Performance |
| CQ8 | Maintainability |
| CQ9 | Enhancability |
| CQ10 | Product & Spec |

See [Quality-Vector Specialists](./guides/quality-vector-specialists) for the per-pillar specialist agents and their thresholds.

## Principles

- **Single source of truth.** One canonical content set generates every adapter's output. No per-tool copy drifts on its own.
- **Lean coverage.** Every artifact earns its place: no duplication, no bloat. Overlapping content is merged, not multiplied.
- **Clarification before action.** Ambiguous requests are resolved with a question before any irreversible change — default behavior, not an exception.
- **Adversarial, root-cause quality.** Findings carry measurable criteria and a causal chain, not vibes. Currency (adapter docs, CLI tool releases, security advisories) is re-checked each release.
- **Security and trust by default.** Atomic file writes, path-traversal guards, prompt-injection defenses, and per-agent tool allowlists are built in, not bolted on.

## Next steps

- [Quick Start](./getting-started/quick-start) — install hatch3r in under a minute.
- [What You Get](./getting-started/what-you-get) — explore the agents, skills, rules, and commands included.
- [Supported Tools](./getting-started/supported-tools) — the 3 supported adapters and their outputs.
- [Trust Model](./reference/trust-model) — how distributed packs are trusted and verified.
