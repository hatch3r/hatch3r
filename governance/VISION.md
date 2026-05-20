# hatch3r — Vision

> Last updated: 2026-05-20

**Crack the egg. Hatch better agents.**

---

## What hatch3r Is

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository. Canonical content ships inside the npm package; adapters read it directly from the bundle and generate native configuration for 3 supported AI coding platforms (Claude Code, Cursor, GitHub Copilot). The single user-visible footprint is `.hatch3r/` (manifest, learnings, handoffs, overrides, MCP credentials). Weekly-audited and continuously improved through a closed-loop system.

Run `npx hatch3r init`. Get a production-grade agentic setup. Start building.

Everything is plain text — reviewable, diffable, versionable. hatch3r generates configuration; it does not execute agents. The framework manages the how-to-instruct; the AI tools do the work.

---

## Who It's For

hatch3r is for everyone building software with AI coding assistants — solo developers to enterprise teams, any software type, any maturity level.

### Four Personas

**Individual Power User** — Wants a proven agentic setup without spending weeks hand-tuning prompts across tools. Picks up hatch3r, runs init, and immediately gets senior-engineer-quality results from their AI assistant.

**Team Lead / Platform Owner** — Needs consistent AI-assisted development practices across a team. Standardizes on hatch3r so every developer gets the same quality bar regardless of which AI tool they prefer.

**OSS Maintainer** — Wants contributors using AI tools to produce PRs that pass the project's code-review standards on first submission. Adopts hatch3r so adapter-generated platform configs (CLAUDE.md, `.cursor/`, `.github/`) carry the project's conventions, architecture, and quality expectations from day one.

**Legacy System Maintainer** — Needs AI assistance that respects existing patterns, understands old codebases, and makes incremental improvements without breaking things. hatch3r's outside-in perspective and non-destructive adoption model make this safe.

### Any Stack, Any Stage

Web apps, APIs, CLIs, mobile, infrastructure-as-code, monorepos, legacy systems. MVP prototypes to enterprise-grade production systems. The framework ships generic content that works everywhere; customization handles project-specific concerns.

---

## The Quality Bar

The north star metric is **one-shot success rate and post-implementation quality**.

The standard: senior engineer quality with an outside-in, user-facing perspective. Small-to-mid tasks should succeed on the first attempt. The result should be something a senior engineer would approve in code review — correct, well-structured, and considering edge cases.

Larger features (reusable components, styling consistency, i18n keys, complex wiring, edge cases across multiple files) are harder. This is a known gap, partly model limitations, partly content optimization opportunity. The framework continuously optimizes for these cases but acknowledges the boundary.

The revision loop — human tests as user, provides targeted feedback, agent fixes efficiently — works well. Optimize it, don't rethink it. Minimize the number of revision cycles needed, but make each cycle fast and effective when it happens.

User-authored artifacts produced via /hatch3r-create are held to the same one-shot success standard as canonical content; D20 enforces this via hybrid gates (creator-tool gates at write time, artifact-compliance gates at audit time). Project-local overrides land under `.hatch3r/overrides/` (the D20 user-content escape hatch, relocated from `.agents/user/` in 1.9.0).

---

## Up-to-Date Information

Agents must ALWAYS ground their work in current information. Sources: web search, official documentation, CLI tools that wrap live data (search, file, http, forge, browser), Context7 or other MCP servers when CLI access is not practical, and project-specific context. Never rely solely on training data.

This is not a feature of specific agents or skills. It is a general principle baked into how all content instructs agents. Every agent, every skill, every prompt assumes access to current information and instructs the AI to use it.

---

## The Closed Loop

hatch3r improves itself through a continuous closed-loop system.

### Weekly Cadence

```
Vision --> PRD --> Build --> Audit --> Execute Findings --> Update PRD --> repeat
```

The audit deploys all audit domains and all sub-agents for maximum depth. Findings are severity-tagged, scored, and prioritized. Execution follows a wave-based approach with regression gates between waves.

### Three Additional Loops

**Content Gap Identification** — Audit findings reveal missing agents, skills, rules, or commands. These become new content artifacts in the next cycle.

**Audit Self-Evolution** — The audit prompt itself improves over time. New domains, sharper sub-agents, better detection patterns. Changes require explicit user consent per proposal — the audit does not silently evolve.

**Learning System** — Project knowledge compounds over time. Each project gets smarter with each iteration. The framework captures learnings automatically and agents consult past learnings when working on similar problems.

### PRD as Living Document

The PRD evolves automatically from audit findings. Vision changes flow down through the PRD into content. The PRD handles the "how and when" — this document handles the "why and what."

---

## Content Maintenance Model

Content is ONLY maintained through the weekly audit cycle or in-between agentic work triggered by the framework owner. There is no separate maintenance process, no ad-hoc editing, no drift. Maximum end quality is the only metric that matters.

### Canonical Content vs Project-Local Content

Canonical content (under `agents/`, `skills/`, `rules/`, `commands/`, `hooks/` in the framework repository) is maintained ONLY through the weekly audit cycle and framework-owner agentic work. **Project-local content** — agents, skills, rules, commands, and hooks authored by an end-user via `/hatch3r-create` and stored under their project's `.hatch3r/overrides/` — is held to the same one-shot success standard via Domain 20 (D20.1 audits the creator tool, D20.2 audits the artifacts). Project-local artifacts are not maintained by the framework owner; they are maintained by their project owner. Both bodies of content are subject to the shared quality charter and the lean thresholds in CONSTITUTION.md §2 P5.

### Seven Content Types

| Type | Purpose |
|------|---------|
| **Agents** | Role definitions with expertise, constraints, and orchestration behavior |
| **Commands** | Slash-command workflows triggered by the user |
| **Prompts** | Reusable prompt templates for common patterns |
| **Rules** | Coding standards, conventions, and guardrails |
| **Skills** | Multi-step skill workflows (structured procedures) |
| **Hooks** | Event-triggered automation |
| **GitHub Agents** | CI/CD-integrated agent definitions |

Every content artifact must be auditable, versionable, and improvable through the audit cycle.

---

## Platform Strategy

All 3 supported adapters are equally supported. No first-class vs second-class platforms. Each gets the full capability set that the platform's native format can express. Scope reduced to 3 in 1.9.0 (CONSTITUTION §6 Decision #12) to concentrate maintenance and raise the per-adapter currency bar.

### Supported Platforms

| Platform | Output paths |
|----------|--------------|
| Claude Code | `CLAUDE.md` (root, managed-block wrapped) |
| Cursor | `.cursor/rules/`, `.cursor/mcp.json`, `.cursor/commands/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/`, `.github/prompts/` |

Canonical content lives inside the npm package; adapters read it via `resolveBundledContentRoot()` and emit platform-native config into the paths above. The user repo carries no `.agents/` directory in 1.9.0 — only `.hatch3r/` (manifest, learnings, handoffs, overrides, MCP credentials) plus the adapter output paths.

### Parity and Adaptation

Platform changes — new features, API changes, deprecations — are detected and adapted within the weekly audit cycle. The adapter infrastructure maps bundled canonical content to each platform's native format. Capability gaps between platforms are tracked and documented, not hidden.

---

## End-to-End Lifecycle Coverage

hatch3r covers the full software development lifecycle through its agents, skills, and commands — 11 phases from idea to maintenance.

| # | Phase | What It Covers |
|---|-------|---------------|
| 1 | **Vision Capture** | Re-envision — structured dialog to capture or refine project and framework vision |
| 2 | **Specification** | Project spec, codebase map — grounding agents in what exists |
| 3 | **Planning** | Roadmap, feature/bug/refactor/migration/test plans, API spec |
| 4 | **Board Management** | Board init, fill, groom, pickup, refresh — across GitHub, Azure DevOps, GitLab |
| 5 | **Implementation** | Implementer, workflow, quick-change, sub-agentic delegation |
| 6 | **Quality Assurance** | Reviewer, test writer, security/accessibility/performance auditors |
| 7 | **Revision** | Human tests as user, provides feedback, agent fixes efficiently |
| 8 | **Operations** | Release, healthcheck, dependency audit, cost tracking |
| 9 | **Knowledge Capture** | Automatic learning on the fly, onboarding |
| 10 | **Customization** | Per-agent/skill/rule/command overrides, recipes |
| 11 | **Framework Quality** | Weekly audit cycle keeps everything at peak |

---

## CLI Scope

The CLI handles framework management only:

- `init` — Install the agentic setup into a repository
- `sync` — Regenerate adapter output from canonical source
- `update` — Pull latest framework content
- `config` — Configure framework settings
- `status` — Show framework state
- `validate` — Check content integrity
- `verify` — Verify adapter output matches canonical source

The CLI is NOT a runtime. It generates configuration; it does not execute agents. Good standard developer experience — polished, fast, clear errors — but the CLI is not the primary differentiator. The content is.

---

## Learning System

Learning is automatic. The system captures learnings on the fly after each learning moment — not only when the user explicitly instructs it.

**Project-level only.** Users work on their projects, not on the framework itself. Learnings are scoped to the project and stored in the project's `.hatch3r/learnings/` directory.

**Must not bloat.** Efficient storage, no redundancy, no noise. Old learnings that are superseded get consolidated or removed. The learning store stays lean and useful.

**Agents consult learnings.** When working on problems similar to past work, agents reference captured learnings. The project gets smarter with each iteration — patterns that worked, mistakes to avoid, project-specific conventions discovered through use.

---

## Principles

Stable and aspirational. These do not change week-to-week.

1. **Canonical source bundled in the npm package** — One truth, many outputs. Adapters read canonical content via `resolveBundledContentRoot()`; user repos carry only `.hatch3r/` plus adapter outputs.

2. **Everything is plain text** — Reviewable, diffable, versionable. No binary blobs, no opaque databases.

3. **Generate, don't hand-edit tool configs** — Adapter output is derived. Edit the source, regenerate the output.

4. **Proven patterns over theoretical templates** — Content comes from what works in practice, not what sounds good in theory.

5. **Compound knowledge over time** — Every project interaction makes the next one better.

6. **Weekly audit cadence** — Continuous improvement is not aspirational; it is scheduled.

7. **Closed-loop evolution** — Audit findings flow into the PRD, the PRD drives content changes, content changes get audited. The loop never stops.

8. **Up-to-date information always** — Web search, Context7, official docs. Never rely on stale training data.

9. **CLI-first agent tooling** — Agents prefer terminal-native CLI tools (search, file ops, data, http, forge, browser, sandbox, archive) over wrapped protocols. CLI tools are battle-tested, portable across hosts, and produce structured stdout that any agent can parse. MCP servers are recommended only where no CLI equivalent exists or where the protocol's stateful affordances are required (e.g., long-running indices, push notifications).

10. **One-shot success as the north star** — Every content change is measured against: does this make first-attempt success more likely?

11. **Equal adapter parity across the 3 supported platforms** — Claude Code, Cursor, GitHub Copilot each get the full capability set their native format can express. No first-class or second-class citizens within the supported set.

12. **Incremental adoption** — Legacy-friendly, non-destructive. Works with what exists, does not demand a rewrite.

13. **Sub-agentic by design** — Implementer delegation, structured workflows, parallel execution. Complex tasks decompose into focused sub-tasks.

14. **Clarification & Fan-out Discipline** — Every hatch3r workflow opens with detected ambiguity surfaced as user questions (via the platform-native question tool per user-question-protocol.md) and closes with fan-out width matched to task complexity. Quality dominates token cost on both dimensions.

15. **Quality through measurable standards** — Content quality is verified weekly against the shared quality charter (`agents/shared/quality-charter.md`). Agents think like senior engineers: question assumptions, consider multiple stakeholders, express uncertainty honestly, and ground every recommendation in current information.

16. **Behavioral charter governs agent conduct** — Agent behavioral standards are defined once and inherited everywhere. Audit sub-agents follow the audit behavioral charter (in AUDIT.md); end-user agents follow the shared quality charter. Both charters are living documents that evolve through the weekly audit cycle.

17. **Design quality and accessibility for agent-produced output** — Agents that generate UI for end-user projects meet a WCAG 2.2 AA baseline verified by axe-core (0 serious/critical violations per route and per component), reuse the project's design tokens and component library before authoring new primitives, and ship the four-state surface contract on every async view (loading + empty + error + partial). Measured under P2 (see [CONSTITUTION.md](CONSTITUTION.md) §2 P2).

---

## Distribution

hatch3r is open-source. The focus is on building the ideal framework first. Distribution channels (npm, marketplace plugins, private registries) are secondary concerns that follow from getting the framework right.

---

*This document captures the stable vision — the "why and what." For the "how and when," see the PRD. For quality verification, see AUDIT.md.*
