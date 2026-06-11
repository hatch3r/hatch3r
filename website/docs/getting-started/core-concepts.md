---
sidebar_position: 2
title: Core Concepts
slug: core-concepts
---

# Core Concepts

Six terms carry most of hatch3r's mental model. Read this once before the [Quick Start](./quick-start) and the rest of the docs read faster. Each term links to the reference page that goes deeper.

## Canonical source vs. adapters

hatch3r keeps **one** copy of your agent setup — the **canonical source** — bundled inside the npm package, and *generates* tool-specific files from it. The generators are **adapters**: one per supported tool (Cursor, Claude Code, GitHub Copilot). You edit intent in one place; adapters translate it into each tool's native config (`.cursor/`, `.claude/` + `CLAUDE.md`, `.github/copilot-instructions.md`). Your repo holds only the manifest, your overrides, and the generated outputs — not the canonical content itself. Details: [Content Model](../reference/architecture/content-model) · [Adapter System](../reference/architecture/adapter-system).

## Agent / skill / command / rule

These are the four content types you will hear about most. Each is a markdown file with YAML frontmatter in the canonical source:

| Type | What it is | When it acts |
|------|-----------|--------------|
| **Agent** | A role with behavioral instructions (reviewer, implementer, security-auditor). | Invoked by a command or another agent to do one job. |
| **Skill** | An on-demand instruction bundle for a specific task (bug-fix, release, incident-response). | Loaded when an agent needs that procedure. |
| **Command** | A slash-command workflow that orchestrates one or more agents. | You run it (e.g. `/feature-plan`) inside your coding tool. |
| **Rule** | A persistent standard always in context (code-standards, security-patterns). | Applies passively to every relevant edit. |

(Two more types — **hooks** for event-triggered automation and **checks** for quality gates — round out the catalog.) See [What You Get](./what-you-get) for the full inventory and the per-type [reference pages](../reference/agents).

## Review loop

After an implementer agent makes a change, hatch3r runs a bounded **review loop**: `hatch3r-reviewer` inspects the diff for correctness, security, performance, and accessibility; if it raises Critical or Warning findings, `hatch3r-fixer` addresses them and the reviewer re-checks. The loop runs at most **3 iterations**, then hands back. This is how generated code earns a quality bar without an unbounded back-and-forth. See [Agentic Process](../guides/agentic-process).

## Content profile

At `init` you pick a **content profile** that decides *which* artifacts get generated: **Minimal** (core only), **Standard** (recommended — core, planning, implementation, review, devops, maintenance), **Full** (everything), or **Custom** (you pick item by item). Greenfield/brownfield and solo/team context further filter the set. Change it later with `hatch3r config`. See the [profile table](./quick-start#content-profiles).

## Maturity dial

**Maturity** (`solo` · `team` · `scaleup` · `enterprise`) is a single dial — set once at `init` — that calibrates *how deeply* your agents invest in reliability, scale-handling, testing, and operational depth. It is **not** a content filter: every tier installs the same full corpus, anchored by a universal security/UI/protocol/content-quality floor that never relaxes. A higher tier means deeper investment and stricter review rigor, not a different file set. (Distinct from `--team-size`, which is a context filter for `ctx:team-only` artifacts like board management and handoffs.) See [Maturity Tiers](../guides/maturity-tiers).

## Next Steps

- [Quick Start](./quick-start) — install hatch3r in under a minute
- [What You Get](./what-you-get) — the full catalog of agents, skills, rules, and commands
