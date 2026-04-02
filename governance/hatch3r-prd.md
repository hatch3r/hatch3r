# hatch3r — Product Requirements Document v4.0

**Product name:** hatch3r
**Mascot:** a tiny T-rex hatchling peeking out of an egg
**Primary slogan:** Crack the egg. Hatch better agents.
**Doc version:** v4.0
**Date:** 2026-03-04 (Europe/Berlin)
**Supersedes:** hatch3r PRD v3.0 (2026-02-23)

---

## 1. Executive Summary

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository under `/.agents/`, then generates optimal native configuration for the developer's selected coding tool(s): Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, and Antigravity.

The product solves the "great agent setups don't travel well" problem by making agentic coding infrastructure:

- **Portable** — canonical source in `/.agents/`, works in any repo
- **Repeatable** — one `npx hatch3r init` command
- **Tool-optimized** — adapters generate native config per tool
- **Reviewable** — plain text, versioned in git
- **Safe by default** — guardrails, deny-lists, optional enforcement wrappers
- **Updatable** — `npx hatch3r update` pulls latest without overwriting customizations
- **Learnable** — captures insights from issues, reviews, and decisions; compounds project knowledge over time
- **Event-driven** — lifecycle hooks activate agents automatically on commits, merges, CI failures, and more
- **Proven** — patterns extracted from a production agentic setup (16 agents, 25 skills, 22 rules, 34 commands, 4 GitHub agents, 10 MCP servers)
- **Multi-platform** — supports GitHub, Azure DevOps, and GitLab for board management and MCP integration

hatch3r works equally well for greenfield products, existing codebases, and legacy systems. It includes dedicated commands for greenfield project specification, brownfield codebase analysis, and roadmap generation — providing a complete path from idea to board-managed delivery.

---

## 2. Vision

> **North-star vision document:** See [VISION.md](VISION.md) for the stable, aspirational framework vision. This PRD implements that vision as detailed requirements. VISION.md owns the "why and what"; this PRD owns the "how and when."

### North Star

Every repo should be able to "hatch" into a high-performing agent environment — in one command — with conventions, skills, prompts, MCP integrations, sub-agentic workflows, and safety rules aligned to the team.

### Product Thesis

1. Keep one source of truth in `/.agents/`.
2. Generate tool-specific files only where they measurably improve results (Cursor `.mdc` rules, Copilot prompts, Claude skills, etc.).
3. Make installs frictionless via `npx` and idempotent via `sync`.
4. Ship with patterns proven in production — not theoretical templates.
5. Support the full spectrum: greenfield scaffolding, existing project augmentation, and legacy system incremental adoption.
6. Compound project knowledge over time — capture learnings from issues, reviews, and decisions so agents get smarter with each iteration.

### Why Now

The ecosystem is converging on repo-native agent guidance, sub-agentic delegation, and lifecycle automation:

- **AGENTS.md** is promoted as a simple, open format used broadly as "README for agents."
- **OpenCode** explicitly reads agent rules from `AGENTS.md`.
- **GitHub Copilot** supports repo instruction files and prompt files inside `.github/`.
- **Claude Code** reads `CLAUDE.md` and supports project-scoped skills, MCP, and 12+ lifecycle hook events.
- **Windsurf** supports both `.windsurfrules` and `AGENTS.md`.
- **Cursor** now has a plugin marketplace with support for rules, skills, agents, commands, and MCP.
- **Competing frameworks** (Superpowers ~71k stars, BMAD ~41k stars, GSD ~23k stars, Ruflo ~19k stars, Compound Engineering ~10k stars) have validated that structured methodology, sub-agentic delegation, multi-agent orchestration, and learning loops are table-stakes features for production agentic setups.

---

## 3. Target Users

### Persona A — Individual Power User

Has a "personal agent stack" (prompts, rules, MCP servers) and wants it replicated in every project instantly. Uses multiple AI tools and needs a single source of truth.

### Persona B — Team Lead / Platform Owner

Wants standardized agent behavior across repos and tools. Needs versioned, reviewable agent configuration that can be updated centrally and rolled out to all projects.

### Persona C — OSS Maintainer

Wants contributors to follow project conventions without long onboarding. Agents should understand the project's architecture, patterns, and constraints from their first interaction.

### Persona D — Legacy System Maintainer

Works with large, established codebases. Needs an incremental, non-destructive way to add agentic support without reorganizing existing tooling or conventions. Needs conservative agent behavior that preserves existing patterns.

---

## 4. Problem Statement

Agentic coding setups are currently:

- **Hard to extract** — spread across dotfolders, prompts, docs, personal settings
- **Hard to reuse** — each tool expects different config layouts and formats
- **Prone to drift** — copy/paste + local tweaks diverge from the canonical setup
- **Unsafe by default** — terminal/tool permissions, third-party MCP servers lack guardrails
- **Not updatable** — no mechanism to pull improvements without losing customizations
- **Not delegatable** — sub-agentic patterns (parallel issue implementation, structured workflows) are rarely codified
- **Not learnable** — agent setups are static; each session starts from scratch without benefiting from past decisions, reviews, or resolved issues

hatch3r packages these into a portable "agent pack" and compiles tool-specific adapters reliably, with a proven update mechanism that respects project customizations and a learning loop that compounds project knowledge over time.

---

## 5. Competitive & Adjacent Landscape

The agentic coding framework space has segmented into four tiers: full-lifecycle methodology frameworks, multi-agent orchestration runtimes (new in early 2026), autonomous coding agents, and IDE-native platforms. hatch3r uniquely straddles the first and fourth tiers — it is a methodology framework that generates native configurations for multiple IDE platforms.

### Key Competitors (March 2026)

| Framework | Stars | Focus | Key Strength | hatch3r Differentiation |
|-----------|-------|-------|-------------|------------------------|
| Superpowers | ~71k | Disciplined TDD workflow | Largest community (118k+ marketplace installs), plugin marketplace | Tool-agnostic adapters vs. Claude Code-primary |
| BMAD Method | ~41k | Full SDLC coverage | 28-tool claim (template-based), 110+ contributors | Deepest native integration (15 tools) + board management + learning loop |
| GSD | ~23k | Context rot prevention | 27 commands, cost tracking, auto-advance, +34% growth | Multi-tool native generation vs. Claude Code-primary |
| Ruflo | ~19k | Multi-agent orchestration | 60+ agents, 215 MCP tools, enterprise-grade | Multi-tool adapter breadth vs. Claude Code-only runtime |
| Compound Engineering | ~10k | Learning loops | Compounding knowledge, learnings researcher | Broader tool support + board management |
| OpenCode | ~114k | Agent rules via AGENTS.md | Open-source, direct AGENTS.md consumption | Full multi-tool adapter architecture vs. single-tool |
| SkillKit | 382 | Skill distribution | 15k+ skill marketplace, 44 agent formats | Complete setup vs. skill-only distribution |

### hatch3r Positioning

hatch3r occupies a unique position: **tool-agnostic adapter architecture** (native config generation for 15 tools from a single canonical source), **multi-platform board management** (GitHub Projects V2, Azure DevOps, and GitLab), and a **learning loop** (compounding project knowledge). No competitor combines all three.

### Adopted Patterns

| Pattern | Validated By |
|---------|-------------|
| Interactive init + template copying | cursor-rules-cli, BMAD Method |
| Cross-tool syncing from canonical source | skillshare, agent-skills-cli, SkillKit |
| Sub-agentic delegation with parallel execution | Superpowers, GSD, Compound Engineering |
| Learning/compounding loop | Compound Engineering |
| Lifecycle hooks and event-driven automation | Claude Code hooks, Kiro Agent Hooks |
| Structured development methodology | BMAD (4-phase), Superpowers (brainstorm-plan-execute-verify) |
| Plugin marketplace distribution | Superpowers, Compound Engineering (Claude Code marketplace) |

**See [COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md) for detailed per-framework analysis, gap analysis, and strategic recommendations.**

---

## 6. Product Principles

1. **Canonical source lives in `/.agents/`** (always)
2. **Everything is plain text** (reviewable, diffable)
3. **Generate, don't hand-edit tool configs** (avoid drift)
4. **Idempotent operations** (safe sync)
5. **Naming convention for ownership** (`hatch3r-*` = managed, no prefix = custom)
6. **Tool-agnostic whenever possible, tool-native when it improves outcomes** (e.g., Cursor `.mdc` rules with frontmatter for scoping)
7. **Proven patterns over theoretical templates** (extracted from production use)
8. **Incremental adoption** (legacy-friendly, non-destructive)
9. **Sub-agentic by design** (implementer delegation, structured workflows, parallel execution)
10. **Update without destruction** (managed blocks, prefix strategy, backups)
11. **Compound over time** (learnings from issues, reviews, and decisions accumulate as project knowledge)
12. **Event-driven when beneficial** (lifecycle hooks activate agents automatically, reducing manual orchestration)
13. **Weekly audit cadence** (PRD → AUDIT → AUDIT-EXECUTE → PRD, every cycle surfaces and resolves gaps)
14. **Closed-loop evolution** (audit findings flow back into the PRD as requirements; the framework improves itself)
15. **Automatic learning** (every completed issue, review, and decision is a learning opportunity captured on the fly; agents get smarter with each iteration without manual intervention)
16. **Up-to-date information** (agents use web research and live documentation via Context7 MCP, not stale training data; this is a general principle baked into all content)
17. **Behavioral quality standards** (all content artifacts inherit from a shared quality charter (`agents/shared/quality-charter.md`) that defines measurable behavioral standards: confidence expression, root-cause orientation, stakeholder awareness, graceful failure, and measurable acceptance criteria — verified by the weekly audit)

### Audit Cycle as Product Feature

The weekly audit cycle (PRD → AUDIT → AUDIT-EXECUTE) is a first-class product capability, not just a development process. It ensures:

1. Every capability is evaluated against the competitive landscape weekly
2. Findings are triaged by severity and executed in regression-gated waves
3. The PRD evolves from audit findings — competitive gaps (D17), coverage gaps (D16), user journey friction (D19) become requirements
4. Content gaps are identified and specified for the next cycle
5. The audit system itself evolves (with user consent) to stay current
6. VISION.md provides the stable reference point that prevents scope drift during rapid audit-driven evolution

The audit produces a structured report (AUDIT-REPORT.md) with 19-domain coverage, severity-weighted scoring, and a prioritized action item table. The execution companion (AUDIT-EXECUTE.md) implements findings in severity-based waves with regression gates between each wave. Post-execution, three closed-loop phases update the PRD, identify new content, and evolve the audit system.

---

## 7. Scope

### In Scope (MVP — Shipped)

- `npx hatch3r init` — interactive setup
- `npx hatch3r sync` — re-generate from canonical state
- `npx hatch3r update` — pull latest templates, safe merge
- `npx hatch3r add <pack>` — add a community pack (stub; full implementation planned)
- `npx hatch3r status` — check sync state between canonical and generated files
- `npx hatch3r validate` — validate `/.agents/` structure, frontmatter, and naming conventions
- `npx hatch3r verify` — verify integrity of canonical files via SHA-256 hashing and HMAC-signed manifest
- Tool adapters: Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity (15 adapters)
- Cursor plugin distribution via Marketplace
- Canonical pack format under `/.agents/` including: agents, skills, rules, prompts, commands, hooks, learnings, MCP configuration, guardrails, GitHub agents
- `default` preset with full content (16 agents, 25 skills, 22 rules, 34 commands, 3 prompts, 4 GitHub agents)
- 34 commands including: board management (init, fill, pickup, shared, refresh, groom), project analysis (project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, migration-plan, test-plan, api-spec), workflow (workflow, hooks, learn, onboard, quick-change, revision, debug), operations (healthcheck, security-audit, dep-audit, release, benchmark), monitoring (context-health, cost-tracking), automation (recipe, agent-customize, skill-customize, rule-customize, command-customize)
- Community pack sourcing (`--pack git:<url>#<tag>` or `--pack ./local`)
- Enhanced MCP config template with 10 servers (3 default + 7 opt-in)
- Safe merges with naming convention (`hatch3r-*` prefix) and managed blocks
- Sub-agentic architecture: implementer agent, issue-workflow skill, parallel delegation
- Hook system with 6 event types: `pre-commit`, `post-merge`, `ci-failure`, `file-save`, `session-start`, `pre-push`
- Learning system: capture insights from issues/reviews/decisions, auto-consult on similar future work
- Guided workflow mode: structured development phases (analyze, plan, implement, review)
- Project analysis: greenfield specification (project-spec), brownfield codebase analysis (codebase-map), roadmap generation, single-feature planning (feature-plan), complex bug investigation (bug-plan), refactoring/migration planning (refactor-plan)
- Multi-repo workspace support (v1.3.0): `hatch3r init` auto-detects workspace layouts with `--workspace` flag, `workspace.json` manifest, sync cascade with `--repos`/`--dry-run`/`--force`, per-repo overrides, content inheritance
- Git worktree isolation (v1.3.0): `.worktreeinclude` generation for parallel agent sessions, `hatch3r worktree-setup` CLI command, auto-detection of worktree-capable tools, `worktree-create` and `worktree-remove` hook events, per-worktree learnings divergence

### In Scope (Milestone 2 — Expansion)

- Additional tool adapters: Continue (Aider, Kiro, Goose, and Zed adapters shipped in v4.0)
- Preset packs: `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`
- Preset composability: `npx hatch3r init --preset web-app,security`
- Distribution: Claude Code plugin marketplace, Cursor marketplace formalization
- Documentation site and landing page
- Community pack ecosystem improvements

### Explicit Non-Goals (Current)

- No hosted marketplace/registry (pack sources can expand later)
- No background service or daemon
- No proprietary prompt logic (OSS-first)
- No runtime agent execution (hatch3r is a setup tool, not a runtime)

---

## 8. User Experience

### 8.1 Primary Flow: `npx hatch3r init`

Goal: install a complete "agent setup" into an existing or new repo.

**Interactive steps:**

1. **Detect repo basics** — language hints, package managers, monorepo structure, existing agent configs
2. **Choose platform** — GitHub, Azure DevOps, or GitLab (for board management and platform MCP server)
3. **Choose tool(s)** — multi-select: Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity
4. **Choose preset(s)** — composable: `default` (recommended), `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`
5. **Choose features** — agents, skills, rules, prompts/commands, MCP, guardrails, GitHub agents, hooks
6. **Choose MCP servers** — from the enhanced template (3 default: Context7, Filesystem, Playwright; opt-in: GitHub, Azure DevOps, GitLab, Brave Search, Sentry, Postgres, Linear)
7. **Show file plan summary** — list of files to create/modify with action (create/update/skip)
8. **Write `/.agents/*`** — canonical source files
9. **Generate tool-specific outputs** — adapter-generated files per selected tool

### 8.2 Secondary Flow: `npx hatch3r sync`

Goal: re-generate tool adapters from the canonical `/.agents/` state.

1. Read `/.agents/hatch.json` manifest
2. Re-render tool outputs from canonical sources
3. Use safe merge strategy (naming convention + managed blocks + backups)
4. Print short diff summary and warnings

### 8.3 Update Flow: `npx hatch3r update`

Goal: pull latest hatch3r templates without overwriting customizations.

1. Read `/.agents/hatch.json` to identify managed files and current version
2. Download updated templates for the latest hatch3r version
3. For each managed file, apply merge strategy:
   - **`hatch3r-*` prefixed files:** fully replaced (customizations live in non-prefixed files)
   - **Shared files with managed blocks** (`AGENTS.md`, `CLAUDE.md`, `copilot-instructions.md`): only content within `<!-- HATCH3R:BEGIN -->...<!-- HATCH3R:END -->` is updated; content outside markers is preserved
   - **`hatch.json` manifest:** version bumped, features/tools preserved
4. Create `.bak` files before any destructive write
5. Print diff summary of what changed

### 8.4 Add Pack Flow: `npx hatch3r add <source>`

Goal: add a community or custom pack on top of existing setup.

```bash
npx hatch3r add git:github.com/org/custom-pack#v1.0
npx hatch3r add ./local-pack
```

1. Fetch pack from source (git clone or local copy)
2. Validate pack structure matches `/.agents/` format
3. Merge pack contents with existing `/.agents/` (additive, no overwrites without confirmation)
4. Re-run sync to generate updated tool outputs
5. Update `hatch.json` to record pack source

### 8.5 Status Flow: `npx hatch3r status`

Goal: check whether generated tool files are in sync with the canonical `/.agents/` state.

1. Read `/.agents/hatch.json` manifest
2. For each configured tool, compare generated files against canonical sources
3. Report per-file status: synced, drifted, or missing
4. Print summary with actionable next steps (`run npx hatch3r sync to fix`)

### 8.6 Validate Flow: `npx hatch3r validate`

Goal: validate the `/.agents/` directory structure and contents.

1. Check `/.agents/hatch.json` exists and is valid JSON
2. Validate frontmatter in all canonical files (required fields: `id`, `type`, `description`)
3. Check naming conventions (`hatch3r-*` prefix for managed files)
4. Validate MCP config JSON structure
5. Report errors and warnings with file locations

### 8.7 Verify Flow: `npx hatch3r verify`

Goal: verify that canonical files in `/.agents/` have not been modified since the integrity manifest was generated.

1. Read `/.agents/.integrity.json` (generated during `init` or `update`)
2. For each file in the manifest, compute SHA-256 hash and compare to stored value
3. Detect new files (on disk but not in manifest) and tampering (manifest checksum mismatch)
4. Report per-file status: pass, modified, missing, new, or tampered
5. Exit with error if any modified, missing, or tampered files

### 8.8 Project Analysis Commands

Commands for bootstrapping agent context in greenfield and brownfield projects (platform-aware for GitHub, Azure DevOps, and GitLab):

- **`hatch3r-project-spec`** — Greenfield project specification. Spawns parallel researcher sub-agents (stack, features, architecture, pitfalls, UX). Produces `docs/specs/`, `docs/adr/`, initial `todo.md`.
- **`hatch3r-codebase-map`** — Brownfield codebase analysis. Spawns parallel analyzer sub-agents to reverse-engineer specs from existing code. Discovers modules, dependencies, conventions, tech stack. Outputs to `docs/specs/` and `docs/adr/`.
- **`hatch3r-roadmap`** — Generate phased roadmap from specs/vision. Breaks into epics and features. Outputs to `todo.md` (feeds directly into `board-fill`).
- **`hatch3r-feature-plan`** — Single-feature deep planning. Spawns parallel researcher sub-agents (codebase impact, feature design, architecture, risk & pitfalls) to break a feature idea into a detailed spec, ADR(s), and structured `todo.md` entries for `board-fill`.
- **`hatch3r-bug-plan`** — Complex bug investigation planning. Spawns parallel researcher sub-agents (symptom tracer, root cause investigator, impact assessor, regression researcher) to diagnose ambiguous bugs. Produces investigation reports (`docs/investigations/`) with ranked hypotheses, evidence, and reproduction strategy, plus scoped `todo.md` entries.
- **`hatch3r-refactor-plan`** — Refactoring and migration planning. Spawns parallel researcher sub-agents (current state analyzer, strategy designer, impact/risk assessor, migration path planner). Auto-detects refactoring dimension (structural, logical, visual, migration, or mixed). Produces refactoring spec, ADR(s), and phased `todo.md` entries mapped to the appropriate execution skill.
- **`hatch3r-migration-plan`** — Migration-specific planning. Focused variant of refactor-plan for cross-technology or cross-platform migrations with compatibility matrices and rollback strategies.
- **`hatch3r-api-spec`** — API specification generation. Produces OpenAPI/REST/GraphQL specs from project context, with endpoint design, schema definitions, and versioning strategy.

### 8.9 Workflow and Operations Commands

- **`hatch3r-workflow`** — Guided development workflow. Walks through structured phases (analyze, plan, implement, review) using hatch3r's agents and skills. Includes quick mode for small tasks.
- **`hatch3r-learn`** — Learning capture. Records insights from completed issues, reviews, and decisions into `/.agents/learnings/`. Auto-consulted on similar future work.
- **`hatch3r-hooks`** — Interactive hook management. View, add, remove, and test lifecycle hooks.
- **`hatch3r-onboard`** — Project onboarding guide. Generates a structured onboarding walkthrough for new contributors, covering architecture, conventions, and key workflows.
- **`hatch3r-quick-change`** — Rapid small-change workflow. Streamlined path for simple, well-scoped changes that skip full planning phases.
- **`hatch3r-revision`** — Iterative revision workflow. Structured approach for refining existing implementations based on feedback or changed requirements.
- **`hatch3r-debug`** — Structured debugging workflow. Systematic diagnosis using hypothesis-driven investigation with evidence collection and root-cause analysis.
- **`hatch3r-benchmark`** — Performance benchmarking. Establishes baseline metrics, runs comparative benchmarks, and produces performance regression reports.
- **`hatch3r-board-groom`** — Board grooming and prioritization. Reviews backlog items, refines estimates, identifies stale issues, and suggests priority adjustments.

---

## 9. Canonical Repository Structure (`/.agents/`)

hatch3r installs and maintains:

```
.agents/
  AGENTS.md                        # Canonical agent README/instructions
  hatch.json                       # Manifest: tools, features, presets, version
  agents/
    hatch3r-a11y-auditor.md        # Accessibility audit agent
    hatch3r-architect.md           # Architecture design and review agent
    hatch3r-ci-watcher.md          # CI/CD monitoring agent
    hatch3r-context-rules.md       # Context-aware rule activation agent
    hatch3r-dependency-auditor.md  # Dependency audit agent
    hatch3r-devops.md              # DevOps and infrastructure agent
    hatch3r-docs-writer.md         # Documentation agent
    hatch3r-fixer.md               # General-purpose code fixer agent
    hatch3r-implementer.md         # Focused sub-issue implementation agent
    hatch3r-learnings-loader.md    # Learnings retrieval and injection agent
    hatch3r-lint-fixer.md          # Lint/format fix agent
    hatch3r-perf-profiler.md       # Performance profiling agent
    hatch3r-researcher.md          # Context gathering and research agent
    hatch3r-reviewer.md            # Code review agent
    hatch3r-security-auditor.md    # Security audit agent
    hatch3r-test-writer.md         # Test authoring agent
  skills/
    hatch3r-a11y-audit/SKILL.md
    hatch3r-agent-customize/SKILL.md
    hatch3r-api-spec/SKILL.md
    hatch3r-architecture-review/SKILL.md
    hatch3r-bug-fix/SKILL.md
    hatch3r-ci-pipeline/SKILL.md
    hatch3r-command-customize/SKILL.md
    hatch3r-context-health/SKILL.md
    hatch3r-cost-tracking/SKILL.md
    hatch3r-dep-audit/SKILL.md
    hatch3r-feature/SKILL.md
    hatch3r-gh-agentic-workflows/SKILL.md
    hatch3r-incident-response/SKILL.md
    hatch3r-issue-workflow/SKILL.md
    hatch3r-logical-refactor/SKILL.md
    hatch3r-migration/SKILL.md
    hatch3r-perf-audit/SKILL.md
    hatch3r-pr-creation/SKILL.md
    hatch3r-qa-validation/SKILL.md
    hatch3r-recipe/SKILL.md
    hatch3r-refactor/SKILL.md
    hatch3r-release/SKILL.md
    hatch3r-rule-customize/SKILL.md
    hatch3r-skill-customize/SKILL.md
    hatch3r-visual-refactor/SKILL.md
  rules/
    hatch3r-accessibility-standards.md
    hatch3r-agent-orchestration.md
    hatch3r-api-design.md
    hatch3r-browser-verification.md
    hatch3r-ci-cd.md
    hatch3r-code-standards.md          # includes error-handling (merged from hatch3r-error-handling in v4.0)
    hatch3r-component-conventions.md
    hatch3r-data-classification.md
    hatch3r-deep-context.md
    hatch3r-dependency-management.md
    hatch3r-feature-flags.md
    hatch3r-git-conventions.md
    hatch3r-i18n.md
    hatch3r-learning-consult.md
    hatch3r-migrations.md
    hatch3r-observability.md
    hatch3r-performance-budgets.md
    hatch3r-secrets-management.md
    hatch3r-security-patterns.md
    hatch3r-testing.md
    hatch3r-theming.md
    hatch3r-tooling-hierarchy.md
  prompts/
    hatch3r-pr-description.md
    hatch3r-bug-triage.md
    hatch3r-code-review.md
  commands/
    hatch3r-agent-customize.md       # Per-agent customization via .customize.yaml
    hatch3r-api-spec.md              # API specification generation
    hatch3r-benchmark.md             # Performance benchmarking
    hatch3r-board-fill.md            # Create epics/issues from todo.md
    hatch3r-board-groom.md           # Board grooming and prioritization
    hatch3r-board-init.md            # Initialize GitHub Projects V2 board
    hatch3r-board-pickup.md          # Pick up issues, delegate to sub-agents, create PRs
    hatch3r-board-refresh.md         # Refresh board state and sync statuses
    hatch3r-board-shared.md          # Configurable shared board context
    hatch3r-bug-plan.md              # Complex bug investigation planning
    hatch3r-codebase-map.md          # Brownfield codebase analysis
    hatch3r-command-customize.md     # Per-command customization
    hatch3r-context-health.md        # Context health monitoring
    hatch3r-cost-tracking.md         # Token usage and cost tracking
    hatch3r-debug.md                 # Structured debugging workflow
    hatch3r-dep-audit.md             # Dependency scan + upgrade tracking
    hatch3r-feature-plan.md          # Single-feature deep planning
    hatch3r-healthcheck.md           # Full product QA audit
    hatch3r-hooks.md                 # Interactive hook management
    hatch3r-learn.md                 # Learning capture from issues/reviews
    hatch3r-migration-plan.md        # Migration-specific planning
    hatch3r-onboard.md               # Project onboarding guide
    hatch3r-project-spec.md          # Greenfield project specification
    hatch3r-quick-change.md          # Rapid small-change workflow
    hatch3r-recipe.md                # Composable workflow recipes
    hatch3r-refactor-plan.md         # Refactoring and migration planning
    hatch3r-release.md               # Version + changelog + deploy
    hatch3r-revision.md              # Iterative revision workflow
    hatch3r-roadmap.md               # Phased roadmap generation
    hatch3r-rule-customize.md        # Per-rule customization
    hatch3r-security-audit.md        # Full product security audit
    hatch3r-skill-customize.md       # Per-skill customization
    hatch3r-workflow.md              # Guided development workflow
  hooks/
    *.md                             # Hook definitions (frontmatter: id, event, agent)
  learnings/
    *.md                             # Captured learnings from issues/reviews/decisions
  github-agents/
    hatch3r-docs-agent.md
    hatch3r-lint-agent.md
    hatch3r-security-agent.md
    hatch3r-test-agent.md
  mcp/
    mcp.json                       # Canonical MCP server definitions (3 default + 7 opt-in)
  policy/
    deny-commands.yml
  tools/
    safe-run                       # Optional enforcement wrapper
```

### Canonical Instruction Format

`/.agents/AGENTS.md` follows the "setup commands / project structure / code style / safety" pattern recommended for agent instruction files. It includes `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` markers around managed sections. Project-specific content lives outside these markers.

### Canonical File Format

Rules, agents, skills, and commands in `/.agents/` use plain `.md` with a metadata header:

```markdown
---
id: hatch3r-code-standards
type: rule
description: TypeScript and naming conventions
scope: always
---
# Code Standards
...
```

Adapters transform this to tool-native formats:

| Field | Cursor `.mdc` | Copilot `.instructions.md` | Claude `CLAUDE.md` | OpenCode `AGENTS.md` | Windsurf `.windsurfrules` | Amp/Codex `AGENTS.md` | Gemini `GEMINI.md` | Cline `.clinerules` | Aider `.aider.conf.yml` | Kiro `KIRO.md` | Goose `.goosehints` | Zed `.rules` | Amazon Q `.amazonq/rules/` | Antigravity `.antigravity/rules.md` |
|-------|--------------|---------------------------|--------------------|--------------------|--------------------------|----------------------|--------------------|--------------------|--------------------------|----------------|---------------------|-----------------|---------------------------|-------------------------------------|
| `scope: always` | `alwaysApply: true` | (included in repo instructions) | (included in CLAUDE.md) | (included in AGENTS.md) | (included in .windsurfrules) | (included in AGENTS.md) | (included in GEMINI.md) | (included in .clinerules) | (included in conventions) | (included in KIRO.md) | (included in .goosehints) | (included in AGENTS.md) | (included in .amazonq/rules/) | (included in .antigravity/rules.md) |
| `scope: "**/*.ts"` | `globs: ["**/*.ts"]` | `applyTo: "**/*.ts"` | (directory-scoped CLAUDE.md) | (directory-scoped AGENTS.md) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) | (N/A, global only) |

---

## 10. Tool Adapter Requirements

### 10.1 Cursor Adapter

**Generate:**

- `.cursor/rules/hatch3r-*.mdc` — rules with `.mdc` frontmatter for `description`, `alwaysApply`, and `globs`
- `.cursor/rules/hatch3r-hook-*.mdc` — hook definitions as Cursor rules with event-based activation
- `.cursor/agents/hatch3r-*.md` — subagent definitions with `name` and `description` frontmatter
- `.cursor/skills/hatch3r-*/SKILL.md` — skills with `name` and `description` frontmatter
- `.cursor/commands/hatch3r-*.md` — executable commands
- `.cursor/mcp.json` — derived from `/.agents/mcp/mcp.json`

**Behavior:**

- Add a bridge rule (`hatch3r-bridge.mdc`) that points Cursor to `/.agents/AGENTS.md` as canonical instructions
- Generate hook rules from `/.agents/hooks/*.md` as `.cursor/rules/hatch3r-hook-*.mdc` with appropriate globs and activation conditions
- Only create Cursor files when Cursor is selected
- Never touch files without the `hatch3r-` prefix

### 10.2 GitHub Copilot Adapter

**Generate:**

- `.github/copilot-instructions.md` — repo-wide baseline instructions (managed blocks)
- `.github/instructions/hatch3r-*.instructions.md` — path-scoped instructions
- `.github/prompts/hatch3r-*.prompt.md` — custom prompts/commands
- `.github/agents/hatch3r-*.md` — GitHub agent files
- `.github/copilot-setup-steps.yml` — Copilot setup steps configuration

**Behavior:**

- Keep Copilot instruction files concise; link to `/.agents/AGENTS.md` for the full canonical guide
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `copilot-instructions.md`
- Prompts generated from `/.agents/prompts/*` with compatible headers

### 10.3 Claude Code Adapter

**Generate:**

- `CLAUDE.md` — project-level instructions (managed blocks), including hook event mappings
- `.claude/skills/hatch3r-*/SKILL.md` — from `/.agents/skills/*`
- `.claude/settings.json` — Claude Code project settings
- `.mcp.json` — from `/.agents/mcp/mcp.json` (project-scoped MCP)

**Behavior:**

- Preserve Claude's expectation that skills are folder-based with `SKILL.md`
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `CLAUDE.md`
- Map hook definitions to Claude Code hook events and append to `CLAUDE.md` managed block
- Respect `CLAUDE.local.md` for personal settings (never generate this file)

### 10.4 OpenCode Adapter

**Generate:**

- `AGENTS.md` — rules source (managed blocks). OpenCode reads this directly.
- `opencode.json` or `opencode.jsonc` based on `/.agents/hatch.json` selections

**Behavior:**

- OpenCode uses `AGENTS.md` directly as its rules source, so the managed blocks approach applies

### 10.5 Windsurf Adapter

**Generate:**

- `.windsurfrules` — project rules file (managed blocks). Limited to 6,000 characters.
- `.windsurf/rules/hatch3r-*.md` — individual rules with trigger frontmatter
- `.windsurf/skills/hatch3r-*/SKILL.md` — skills
- `.windsurf/agents/hatch3r-*.md` — agent definitions

**Behavior:**

- Windsurf also supports `AGENTS.md` — if the content exceeds `.windsurfrules` limit, use `AGENTS.md` as fallback
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks

### 10.6 Amp Adapter

**Generate:**

- `AGENTS.md` — shared instructions (managed blocks)

**Behavior:**

- Amp reads `AGENTS.md` directly as its rules source
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks

### 10.7 Codex CLI Adapter

**Generate:**

- `AGENTS.md` — shared instructions (managed blocks)
- `codex.md` — Codex-specific project instructions

**Behavior:**

- Codex reads `AGENTS.md` and `codex.md` for project context
- Use managed blocks in `AGENTS.md`

### 10.8 Gemini CLI Adapter

**Generate:**

- `GEMINI.md` — project-level instructions (managed blocks)

**Behavior:**

- Gemini CLI reads `GEMINI.md` for project context
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks

### 10.9 Cline / Roo Code Adapter

**Generate:**

- `.clinerules` — project rules file
- `.cursorrules` — fallback rules (Cline also reads this)

**Behavior:**

- Cline reads `.clinerules` and `.cursorrules` for project context
- Rules are inlined as a single file (similar to Windsurf)

### 10.10 Aider Adapter

**Generate:**

- `.aider.conf.yml` — Aider project configuration
- `CONVENTIONS.md` — project conventions file (managed blocks)

**Behavior:**

- Aider reads `.aider.conf.yml` for project settings and `CONVENTIONS.md` for coding conventions
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `CONVENTIONS.md`
- Rules are inlined into the conventions file

### 10.11 Kiro Adapter

**Generate:**

- `KIRO.md` — project-level instructions (managed blocks)
- `.kiro/steering/hatch3r-*.md` — individual rule files, agents, and skills

**Behavior:**

- Kiro reads `KIRO.md` for project context and supports directory-based rules
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `KIRO.md`
- Hook definitions mapped to Kiro Agent Hooks where supported

### 10.12 Goose Adapter

**Generate:**

- `.goosehints` — project hints file (managed blocks)

**Behavior:**

- Goose reads `.goosehints` for project context and conventions
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks
- Rules are inlined as a single file (similar to Windsurf)

### 10.13 Zed Adapter

**Generate:**

- `.rules` — shared instructions (managed blocks)

**Behavior:**

- Zed reads `.rules` for project context
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `.rules`

### 10.14 Amazon Q Adapter

**Generate:**

- `.amazonq/rules/hatch3r-agents.md` — rules and agent instructions (managed blocks)
- `.amazonq/rules/hatch3r-skill-*.md` — skill definitions
- `.amazonq/mcp.json` — MCP server configuration

**Behavior:**

- Amazon Q reads `.amazonq/rules/` for project context and agent instructions
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks

### 10.15 Antigravity Adapter

**Generate:**

- `.antigravity/rules.md` — project rules file (managed blocks)
- `.antigravity/skills/hatch3r-*/SKILL.md` — skill definitions
- `.antigravity/settings.json` — MCP server configuration

**Behavior:**

- Antigravity reads `.antigravity/rules.md` for project context
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks
- Bridge file references canonical `.agents/AGENTS.md`

---

## 11. Preset Packs System (Milestone 2)

hatch3r currently ships with the `default` preset which includes the complete set of rules, agents, skills, and commands. Additional preset packs are planned for future releases:

- **`web-app`** — Frontend patterns, a11y, design tokens, component conventions
- **`api-service`** — API design, rate limiting, observability, contract testing
- **`cli-tool`** — CLI patterns, argument parsing, help text conventions
- **`monorepo`** — Nested `AGENTS.md`, workspace-scoped rules, cross-package conventions
- **`legacy`** — Conservative rules, migration-first patterns, incremental adoption
- **`security`** — Stricter guardrails, privacy invariants, threat modeling

Presets will be composable: `npx hatch3r init --preset web-app,security` will merge both overlays onto `default`.

---

## 12. Community Pack Ecosystem

### Pack Format

A pack is any directory matching the `/.agents/` structure. Packs can provide additional or replacement rules, agents, skills, commands, and MCP configs.

```
my-pack/
  agents/
    my-custom-agent.md
  skills/
    my-custom-skill/SKILL.md
  rules/
    my-custom-rule.md
```

### Pack Sourcing

```bash
npx hatch3r add git:github.com/org/custom-pack#v1.0
npx hatch3r add ./local-pack
```

### Pack Authoring Guide

1. Follow the canonical file format (`.md` with metadata header)
2. Use a unique prefix for your pack files (e.g., `mypack-` instead of `hatch3r-`)
3. Include a `pack.json` with name, version, description, and compatibility info
4. Test your pack with `npx hatch3r init --pack ./my-pack`

---

## 13. MCP Configuration Template

The canonical MCP config at `/.agents/mcp/mcp.json` ships with 10 MCP servers: 3 enabled by default (Filesystem, Context7, Playwright) and 7 opt-in servers that require additional configuration or API keys (GitHub, Azure DevOps, GitLab, Brave Search, Sentry, Postgres, Linear). All are selectable during `init`.

```json
{
  "mcpServers": {
    "github": {
      "_description": "GitHub repository management, code review, issues, PRs, and project boards",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${env:GITHUB_PAT}",
        "X-MCP-Toolsets": "all"
      }
    },
    "context7": {
      "_description": "Up-to-date, version-specific library documentation for LLMs",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "filesystem": {
      "_description": "File management and code editing operations",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    },
    "playwright": {
      "_description": "Browser automation, web testing, and UI interaction",
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "brave-search": {
      "_description": "Web research, fact-checking, and current information retrieval",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "${env:BRAVE_API_KEY}" }
    },
    "sentry": {
      "_disabled": true,
      "_description": "Error tracking and performance monitoring",
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": { "SENTRY_AUTH_TOKEN": "${env:SENTRY_AUTH_TOKEN}" }
    },
    "postgres": {
      "_disabled": true,
      "_description": "PostgreSQL database queries and schema inspection",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "POSTGRES_URL": "${env:POSTGRES_URL}" }
    },
    "linear": {
      "_disabled": true,
      "_description": "Linear issue tracking and project management",
      "command": "npx",
      "args": ["-y", "@mkusaka/mcp-server-linear"],
      "env": { "LINEAR_API_KEY": "${env:LINEAR_API_KEY}" }
    },
    "azure-devops": {
      "_disabled": true,
      "_description": "Azure DevOps work items, repos, pipelines, and boards",
      "command": "npx",
      "args": ["-y", "@tiberriver256/mcp-server-azure-devops"],
      "env": {
        "AZURE_DEVOPS_PAT": "${env:AZURE_DEVOPS_PAT}",
        "AZURE_DEVOPS_ORG": "${env:AZURE_DEVOPS_ORG}"
      }
    },
    "gitlab": {
      "_disabled": true,
      "_description": "GitLab issues, merge requests, pipelines, and project management",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": { "GITLAB_TOKEN": "${env:GITLAB_TOKEN}" }
    }
  }
}
```

During `init`, the user selects which MCPs to enable. The generator writes only selected servers with env var placeholders. Servers marked `_disabled` require explicit opt-in and environment variable configuration. Adapters transform the canonical config to tool-specific formats:

| Tool | MCP Output |
|------|-----------|
| Cursor | `.cursor/mcp.json` |
| Claude Code | `.mcp.json` (project scope) |
| Copilot / VS Code | `.vscode/mcp.json` (with `envFile` for native secret loading) |
| OpenCode | `opencode.json` MCP section |
| Windsurf | `.windsurf/mcp.json` |
| Amp | `.amp/settings.json` (under `amp.mcpServers` key) |
| Codex CLI | `.codex/config.toml` (TOML `[mcp_servers.<name>]` sections) |
| Gemini CLI | `.gemini/settings.json` (under `mcpServers` key) |
| Cline / Roo | `.roo/mcp.json` |
| Kiro | `.kiro/settings/mcp.json` |
| Aider | N/A (Aider manages MCP separately) |
| Goose | N/A (Goose manages MCP separately) |
| Zed | N/A (Zed manages MCP separately) |
| Amazon Q | `.amazonq/mcp.json` |
| Antigravity | `.antigravity/settings.json` (under `mcpServers` key) |

**Warning (always shown when MCP is enabled):** "Third-party MCP servers can execute actions and access data. Review server sources before enabling."

---

## 14. Distribution Channels

### Channel 1: CLI (Primary)

```bash
npx hatch3r init          # Interactive setup
npx hatch3r sync          # Re-generate from canonical state
npx hatch3r update        # Pull latest, safe merge
npx hatch3r add <pack>    # Add a community pack (stub — planned for full implementation)
npx hatch3r status        # Check sync state
npx hatch3r validate      # Validate .agents/ structure
npx hatch3r verify        # Verify file integrity
```

Published as `hatch3r` on npm. Cross-platform (macOS, Linux, Windows).

### Channel 2: Cursor Plugin

hatch3r is also distributed as a Cursor plugin on the Cursor Marketplace.

**Plugin structure:**

```
.cursor-plugin/
  plugin.json
rules/
  hatch3r-code-standards.mdc
  hatch3r-deep-context.mdc
  hatch3r-testing.mdc
  ...
skills/
  hatch3r-bug-fix/SKILL.md
  hatch3r-feature/SKILL.md
  hatch3r-issue-workflow/SKILL.md
  ...
agents/
  hatch3r-reviewer.md
  hatch3r-test-writer.md
  hatch3r-implementer.md
  ...
commands/
  hatch3r-healthcheck.md
  hatch3r-security-audit.md
  hatch3r-dep-audit.md
  hatch3r-release.md
mcp.json
README.md
```

**`plugin.json` manifest:**

```json
{
  "name": "hatch3r",
  "displayName": "hatch3r",
  "description": "Battle-tested agentic coding setup: rules, skills, agents, commands, and MCP — in one plugin.",
  "version": "0.1.0",
  "author": "hatch3r",
  "keywords": ["agents", "skills", "rules", "mcp", "coding-assistant"],
  "license": "MIT"
}
```

The Cursor plugin provides passive integration — rules, skills, agents, and commands are available immediately when enabled. The CLI provides active integration with `init`, `sync`, and `update` workflows.

**Relationship:** The CLI generates project-specific outputs from canonical `/.agents/` sources. The plugin provides the same content as a Cursor-native plugin that doesn't require `/.agents/`. Teams can use either or both.

### Channel 3: npm Dependency (CI / Programmatic)

```bash
npm install -D hatch3r
npx hatch3r sync     # In CI or husky hook
```

---

## 15. Update & Customization Mechanism

### Naming Convention Strategy

hatch3r uses a file naming convention to separate managed files from project customizations:

- **`hatch3r-*` prefixed files** — fully managed by hatch3r. Replaced on `update`.
- **Non-prefixed files** — project-specific customizations. Never touched by hatch3r.

**Example in `.cursor/rules/`:**

```
.cursor/rules/
  hatch3r-code-standards.mdc      # Managed — replaced on update
  hatch3r-deep-context.mdc        # Managed — replaced on update
  behavior-engine.mdc             # Custom — never touched
  privacy-security.mdc            # Custom — never touched
```

### Managed Blocks Strategy

For shared files that contain both hatch3r-managed and project-specific content:

```markdown
<!-- HATCH3R:BEGIN -->
## Agent Infrastructure (managed by hatch3r)
...generated content...
<!-- HATCH3R:END -->

## Project-Specific Context
...custom content, never overwritten...
```

Used in: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.windsurfrules`

### Update Protocol

1. Read `/.agents/hatch.json` → identify managed files and current version
2. Download latest hatch3r templates
3. Replace all `hatch3r-*` prefixed files with latest versions
4. Update managed block content in shared files
5. Bump version in `hatch.json`, preserve features/tools/presets
6. Create `.bak` backup before any destructive write
7. Print diff summary

### Backup & Recovery

Every `update` and `sync` creates timestamped backups:

```
.agents/.backups/
  2026-02-20T14-30-00/
    hatch3r-code-standards.md
    AGENTS.md
    ...
```

---

## 16. Hooks Architecture

hatch3r supports event-driven agent activation through lifecycle hooks. Hooks allow agents to run automatically in response to development events, reducing manual orchestration.

### Hook Events

| Event | Trigger | Example Use |
|-------|---------|-------------|
| `pre-commit` | Before a git commit | Lint fixer auto-fixes style issues |
| `post-merge` | After a git merge/pull | CI watcher checks pipeline status |
| `ci-failure` | CI pipeline fails | CI watcher diagnoses and suggests fixes |
| `file-save` | File is saved in IDE | Context-specific rule activation |
| `session-start` | New coding session begins | Load relevant learnings and context |
| `pre-push` | Before a git push | Security auditor scans for secrets |

### Hook Definition Format

Hooks are defined as markdown files in `/.agents/hooks/` with frontmatter:

```markdown
---
id: pre-commit-lint-fixer
event: pre-commit
agent: hatch3r-lint-fixer
description: Auto-fix lint and formatting issues before commit
globs: "**/*.ts, **/*.tsx"
---
# Pre-Commit Lint Fixer

Automatically runs the lint-fixer agent on staged files before commit.
```

### Conditions

Hooks support optional conditions for targeted activation:

- **`globs`** — file patterns that trigger the hook (e.g., `**/*.ts, **/*.tsx`)
- **`labels`** — issue labels that activate the hook (e.g., `type:bug`)
- **`branches`** — branch patterns for scoped activation (e.g., `main, release/*`)

### Adapter Integration

| Tool | Hook Output |
|------|-------------|
| Cursor | `.cursor/rules/hatch3r-hook-*.mdc` with glob-based activation |
| Claude Code | Hook event mappings appended to `CLAUDE.md` managed block |
| Other adapters | Hooks included in canonical `AGENTS.md` instructions |

---

## 17. Learning System

hatch3r implements a compounding knowledge loop that captures insights from completed issues, code reviews, and architectural decisions. Unlike static rule sets, the learning system grows with the project.

### Learning Capture

The `hatch3r-learn` command captures learnings from:

- Completed issues and their resolution patterns
- Code review feedback and recurring themes
- Architectural decisions and their rationale
- Bug patterns and their root causes
- Performance insights and optimization strategies

### Storage

Learnings are stored as structured markdown in `/.agents/learnings/`:

```markdown
---
id: learning-001
date: 2026-02-20
source: issue #42
tags: [performance, database, N+1]
---
# N+1 Query Pattern in User Endpoints

When adding new user-facing endpoints, always check for N+1 query patterns.
The `getUserWithPosts` endpoint had a hidden N+1 that was caught in review.
Resolution: Use eager loading with `include` for associated models.
```

### Auto-Consultation

The `hatch3r-learning-consult` rule automatically injects relevant learnings when working on similar issues. Matching is based on:

- Issue type and area labels
- File path patterns
- Tag similarity
- Historical recurrence

### Integration with Board Workflow

The board-pickup workflow triggers learning capture after PR merge: when an issue is completed, the learn command is suggested to capture insights before moving to the next issue.

---

## 18. Sub-Agentic Architecture

hatch3r ships with a proven sub-agentic delegation system extracted from production use.

### Implementer Agent (`hatch3r-implementer`)

A focused implementation agent that receives a single sub-issue and delivers a complete implementation. It does NOT handle git, branches, commits, or PRs — the parent orchestrator owns those.

**Protocol:**
1. Receive issue context: number, body, acceptance criteria, type, parent epic context
2. Load the matching skill based on issue type (bug-fix, feature, refactor, etc.)
3. Implement within acceptance criteria scope
4. Write tests (unit, integration, regression as appropriate)
5. Verify quality gates (lint, typecheck, test)
6. Return structured result (status, files changed, tests written, issues encountered)

### Issue Workflow Skill (`hatch3r-issue-workflow`)

An 8-step structured workflow for handling any GitHub issue:

1. **Parse the issue** — type, area, priority, acceptance criteria
2. **Load the issue-type skill** — bug-fix, feature, refactor, etc.
3. **Read relevant docs** — project specs, ADRs, architecture docs
4. **Produce a plan** — approach, files, tests, risks
5. **Implement** — follow the plan, stay within scope
6. **Test** — unit, integration, e2e, regression
7. **Open PR** — template, checklist, evidence
8. **Address review** — respond, fix, re-request

**Sub-agent delegation for epics:** When working on an epic with multiple sub-issues, the workflow delegates each sub-issue to a dedicated implementer sub-agent. Sub-issues at the same dependency level run in parallel — as many concurrently as the platform supports. Results are collected and conflicts resolved before proceeding to the next level.

### Tooling Hierarchy

hatch3r codifies a knowledge augmentation priority:

1. **Project documentation** — specs, ADRs, architecture docs (authoritative for project-specific decisions)
2. **Codebase exploration** — grep, semantic search, explore sub-agents (ground truth for current implementation)
3. **Library documentation** — Context7 MCP or equivalent (authoritative for external API patterns)
4. **Web research** — current events, best practices, security advisories

---

## 19. Functional Requirements

### FR-1: Install, Sync, and Validate

- `init` creates canonical `/.agents/` and tool outputs
- `sync` re-generates tool outputs from canonical state
- `update` pulls latest templates with safe merge
- `add` merges community packs (stub — CLI entry point exists but full pack resolution is not yet implemented)
- `status` checks sync state between canonical and generated files (reports synced/drifted/missing)
- `validate` validates `/.agents/` structure, frontmatter, naming conventions, and MCP config
- `verify` verifies integrity of canonical files via SHA-256 hashing and HMAC-signed manifest
- All commands must be cross-platform (Windows/macOS/Linux)

### FR-2: Manifest (`/.agents/hatch.json`)

Must track:

```json
{
  "version": "1.0.0",
  "hatch3rVersion": "0.1.0",
  "platform": "github",
  "owner": "my-org",
  "repo": "my-repo",
  "tools": ["cursor", "copilot", "claude", "opencode", "windsurf", "amp", "codex", "gemini", "cline", "aider", "kiro", "goose", "zed", "amazon-q", "antigravity"],
  "presets": ["default"],
  "features": {
    "agents": true,
    "skills": true,
    "rules": true,
    "prompts": true,
    "commands": true,
    "mcp": true,
    "guardrails": true,
    "githubAgents": true,
    "hooks": true
  },
  "mcp": {
    "servers": ["github", "context7"]
  },
  "board": {
    "owner": "my-org",
    "repo": "my-repo",
    "defaultBranch": "main",
    "projectNumber": 1,
    "statusFieldId": null,
    "statusOptions": {
      "backlog": null, "ready": null, "inProgress": null, "inReview": null, "done": null
    },
    "labels": {
      "types": ["type:bug", "type:feature", "type:refactor", "type:qa", "type:docs", "type:infra"],
      "executors": ["executor:agent", "executor:human", "executor:hybrid"],
      "statuses": ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:blocked"],
      "meta": ["meta:board-overview"]
    },
    "branchConvention": "{type}/{short-description}",
    "areas": []
  },
  "hooks": {
    "enabled": true
  },
  "models": {
    "default": "opus",
    "agents": {
      "hatch3r-implementer": "codex"
    }
  },
  "packs": [],
  "managedFiles": [
    ".cursor/rules/hatch3r-code-standards.mdc",
    ".cursor/agents/hatch3r-reviewer.md",
    "AGENTS.md"
  ]
}
```

- **`platform`** — Target platform for board management and MCP: `github` | `azure-devops` | `gitlab`. Determines which platform MCP server is used (GitHub, Azure DevOps, or GitLab) and how board commands resolve work items.
- **`models`** (optional) — Model selection for agents and tools:
  - **`default`** — Default model alias for all agents when not overridden (e.g., `opus`, `sonnet`, `codex`).
  - **`agents`** — Per-agent model overrides (e.g., `"hatch3r-implementer": "codex"`).
  - Model aliases (e.g., `opus` → `claude-opus-4-6`, `codex` → `gpt-5.3-codex`) are resolved at adapter generation time. Adapters that support model selection (Cursor, Claude Code, Copilot, Codex, OpenCode) emit tool-native model configuration from these settings.

### FR-3: Safe Write / Merge Strategy

- Never silently overwrite user content
- `hatch3r-*` prefixed files: fully replaced on update
- Non-prefixed files: never touched
- Shared files: use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks
- Create `.bak` backup before any destructive write
- Print diff summary after every write operation

### FR-4: Guardrails

- Always install `/.agents/policy/deny-commands.yml` when guardrails enabled
- Optionally install `/.agents/tools/safe-run`
- Add canonical instructions: "Use safe-run for shell commands" (policy-level)

### FR-5: MCP Support

- Canonical MCP config lives in `/.agents/mcp/mcp.json`
- Adapters map it to tool-specific formats (`.cursor/mcp.json`, `.mcp.json`, etc.)
- Print warnings when MCP is enabled
- Support env var placeholders (`${env:GITHUB_PAT}`, `${env:BRAVE_API_KEY}`)

### FR-6: Preset Composability

- Presets are layered: `default` is always the base
- Additional presets add/override files from `default`
- Multiple presets can be composed: `--preset web-app,security`
- Conflicts resolved by last-preset-wins ordering

### FR-7: Community Packs

- Accept packs from git URLs or local directories
- Validate pack structure before merging
- Track pack sources in `hatch.json`
- Support pack versioning via git tags

### FR-8: Hook System

- Hook definitions stored in `/.agents/hooks/*.md` with frontmatter (`id`, `event`, `agent`, `description`)
- Support 6 event types: `pre-commit`, `post-merge`, `ci-failure`, `file-save`, `session-start`, `pre-push`
- Optional conditions: `globs` (file patterns), `labels` (issue labels), `branches` (branch patterns)
- Adapters generate tool-native hook configurations (Cursor rules, Claude Code hooks)
- Hooks are opt-in via `features.hooks` in manifest
- `hatch3r-hooks` command for interactive hook management

### FR-9: Learning System

- `hatch3r-learn` command captures insights from completed issues, reviews, and decisions
- Learnings stored as structured markdown in `/.agents/learnings/` with frontmatter (`id`, `date`, `source`, `tags`)
- `hatch3r-learning-consult` rule auto-injects relevant learnings based on issue type, file patterns, and tags
- Deduplication: learnings with overlapping content are merged or flagged
- Board-pickup workflow suggests learning capture after PR merge

### FR-10: Project Analysis

- `hatch3r-project-spec` command: greenfield specification with parallel researcher sub-agents producing `docs/specs/`, `docs/adr/`, initial `todo.md`
- `hatch3r-codebase-map` command: brownfield analysis with parallel analyzers reverse-engineering specs from existing code
- `hatch3r-roadmap` command: phased roadmap generation from specs/vision, outputting to `todo.md` (feeds into `board-fill`)
- `hatch3r-migration-plan` command: migration-specific planning with compatibility matrices and rollback strategies
- `hatch3r-api-spec` command: API specification generation (OpenAPI/REST/GraphQL) from project context
- Pipeline: project-spec or codebase-map produces specs, roadmap produces todo.md, board-fill creates GitHub issues

### FR-11: Integrity Verification

- **SHA-256 hashing** — Canonical files in `/.agents/` (agents, commands, rules, skills, hooks, prompts, github-agents, mcp) are hashed with SHA-256. Hashes use the `sha256:` prefix for clarity.
- **`.integrity.json` manifest** — Stored in `/.agents/.integrity.json`. Contains `version`, `generated`, `hatchVersion`, `files` (path → hash), and optional `checksum`.
- **HMAC signing** — The manifest `checksum` is an HMAC-SHA256 of the `files` object keyed by `hatchVersion`, detecting tampering of the manifest itself.
- **`hatch3r verify` command** — Compares on-disk file hashes against the manifest. Reports: `pass`, `modified`, `missing`, `new`, or `tampered`. Exits with error if any file is modified, missing, or manifest is tampered.
- **Generation** — Integrity manifest is generated during `init` and `update`; verification is available as a standalone command for CI or manual checks.

### FR-12: Content System (Selective Init, Tags, Presets)

- **Selective init** — `hatch3r init` installs only what the user needs based on content profile (minimal/standard/full/custom), project context (greenfield/brownfield), and team size (solo/team).
- **Content tagging** — Every canonical file (agent, skill, rule, command) has frontmatter `tags` categorized as: workflow tags (`core`, `planning`, `implementation`, `review`, `devops`, `maintenance`), context tags (`greenfield`, `brownfield`, `solo`, `team`), and domain tags (`board`, `security`, `a11y`, `performance`, `customize`).
- **Profile filtering** — The chosen profile + context filters determine which files are copied during init. The `core` tag represents the minimum viable agent setup.
- **Presets** — Named preset packs (e.g., `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`) compose content selections for common project types. Presets are layered: `default` is always the base, additional presets add/override. Multiple presets can be composed via `--preset web-app,security`.
- **Post-init reconfiguration** — `hatch3r config` allows adding or removing individual content items after init without re-running the full setup.

### FR-13: Config Command

- **`hatch3r config`** — Interactive reconfiguration of an existing hatch3r installation. Allows modifying tools, MCP servers, features, content items, and platform settings without re-running `hatch3r init`.
- **Tool management** — Add or remove coding tool adapters. Adding a tool generates its adapter output; removing a tool deletes the generated files.
- **MCP server management** — Add or remove MCP servers from the configuration. Updates `.env.mcp` with required environment variables for newly added servers.
- **Feature toggles** — Enable or disable feature categories (agents, skills, rules, commands, hooks, MCP, guardrails, GitHub agents).
- **Content item management** — Add or remove individual agents, skills, rules, or commands. Removed items are deleted from `/.agents/` and tool-specific outputs; they can be re-added later from the package.
- **Platform reconfiguration** — Change the target platform (GitHub, Azure DevOps, GitLab) and update platform-specific content accordingly.
- **Safe operation** — All changes use the same safe-write strategy as `init` (backups, managed blocks, naming conventions).

### FR-14: Archive Functionality

- **Content archival** — When content items (agents, skills, rules, commands) are removed via `hatch3r config`, they are deleted from the canonical `/.agents/` directory and from all tool-specific generated outputs.
- **Reversibility** — Removed items are not permanently lost; they remain in the hatch3r npm package and can be re-added at any time via `hatch3r config`.
- **Board archival** — `hatch3r-board-groom` supports archiving stale board items. Archived issues are closed with a `Closed during board grooming` comment and can be reopened if needed.
- **Managed file cleanup** — When a tool adapter is removed via `hatch3r config`, all `hatch3r-*` prefixed files generated for that tool are cleaned up. User-created files (without the `hatch3r-` prefix) are never touched.

---

## 20. Non-Functional Requirements

- **Speed:** `init` completes in a few seconds (no network calls for default preset)
- **Determinism:** same inputs produce the same outputs
- **Transparency:** all generated outputs readable and attributable
- **Portability:** no reliance on per-user settings; everything stored in repo
- **Compatibility:** Node.js 22+ required; no native dependencies
- **OSS:** MIT license; contribution guidelines; good templates

---

## 21. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Activation** | >90% | % of installs that generate at least one tool adapter |
| **Tool breadth** | >1.5 | Average number of tools configured per repo |
| **Retention** | >30% | % of repos that run `sync` or `update` within 30 days |
| **Drift reduction** | Decreasing | Manual edits inside `hatch3r-*` files (should trend to zero) |
| **Plugin adoption** | Tracked | Cursor plugin installs (marketplace) |
| **Pack ecosystem** | >5 | Community packs published within 6 months |
| **Time-to-first-value** | <60s | Time from `npx hatch3r init` to agent producing a correct change |

---

## 22. Release Plan

### Milestone 1 — MVP (Shipped, updated in v4.0)

All core functionality is implemented and functional:

- 8 CLI commands: `init`, `config`, `sync`, `update`, `status`, `validate`, `verify`, `add` (stub — CLI entry point exists, full pack resolution planned)
- 15 tool adapters: Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity
- `default` preset: 16 agents, 25 skills, 22 rules, 34 commands, 3 prompts, 4 GitHub agents
- 10 MCP servers (3 default: Filesystem, Context7, Playwright + 7 opt-in: GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab)
- Hook system with 6 event types and adapter integration
- Learning system with capture command and auto-consultation rule
- Project analysis commands: project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, migration-plan, api-spec
- Workflow commands: workflow, onboard, quick-change, revision, debug, benchmark
- Board management: init, fill, pickup, shared, refresh, groom
- Guardrails denylist + safe-run wrapper
- Safe merge with naming convention + managed blocks + backups
- Cursor plugin manifest
- **v4.0 changes:** hatch3r-error-handling rule merged into hatch3r-code-standards; 5 new agents (architect, context-rules, devops, fixer, learnings-loader); 3 new skills (api-spec, ci-pipeline, migration); 5 new rules (accessibility-standards, ci-cd, data-classification, deep-context, secrets-management); 8 new commands; 4 new adapters (Aider, Kiro, Goose, Zed)

#### Resolved Blockers

- ~~**Coverage infrastructure:**~~ The `coverage.all` Vitest configuration was misconfigured (excluding test files from coverage measurement inflated reported percentages). Fixed in v1.5.0 — coverage metrics now accurately reflect actual codebase coverage. This was a prerequisite for reliable quality gating.
- ~~**AGENTS.md generation:**~~ The AGENTS.md adapter was not generating from canonical source, blocking platform integration for Copilot, Codex, Amp, and other AGENTS.md-consuming tools. Fixed in v1.5.0.

### Milestone 2 — Expansion

- ~~**Additional tool adapters:**~~ Aider, Kiro, Goose, Zed shipped in v4.0; Amazon Q and Antigravity shipped in v1.3.0. **Remaining:** Continue adapter.
- **Preset packs:** `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`
- **Preset composability:** `--preset web-app,security` layering
- **Distribution:** Claude Code plugin marketplace, Cursor marketplace formalization. **Quality gate:** marketplace distribution requires passing quality infrastructure prerequisites — accurate coverage metrics (resolved in v1.5.0), AGENTS.md generation from canonical source (resolved in v1.5.0), and all adapter parity checks passing.
- **Documentation site** (hatch3r.dev/docs): getting-started, architecture, reference, tutorials — *in progress*
- **Landing page** (hatch3r.dev): value proposition, quick start, comparison, social proof
- ~~**Pack ecosystem: authoring guide**~~ — completed (documented in CONTRIBUTING.md). **Remaining:** validation improvements, community sourcing.
- ~~**Selective init with content presets**~~ — shipped in v1.2.0 (4 presets: Minimal, Standard, Full, Custom)
- ~~**`hatch3r config` command**~~ — shipped in v1.2.0

### Milestone 3 — Ecosystem & Enterprise

- Pack registry/discovery (optional hosted directory)
- Benchmark suite (SWE-bench or custom evaluation)
- Enterprise features: team rules, shared configurations, usage analytics, compliance controls
- ~~Monorepo and multi-repo board management~~ — shipped in v1.3.0 (workspace support, sync cascade)
- SkillKit / Skill Creator AI marketplace integration
- CI integration patterns (husky hooks, GitHub Actions)
- Migration guides from existing setups

---

## 23. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| **Tool formats change** | Canonical format is stable; changes isolated inside adapters. Pin known patterns to docs. Generator is versioned. |
| **Config drift from manual edits** | Naming convention (`hatch3r-*`) + managed blocks + backups + warnings. Non-prefixed files are explicitly custom. |
| **MCP security concerns** | Explicit warnings and opt-in enabling. Sensitive server templates require env vars. |
| **Windows path/exec differences** | Test matrix + cross-platform Node.js. Avoid bash-only assumptions. |
| **Cursor plugin format changes** | Plugin manifest is minimal. Monitor Cursor docs and adapt. |
| **Community pack quality** | Validation on `add`. Optional trust tiers. Pack authoring guide with best practices. |
| **Naming conflicts** | `hatch3r-` prefix is distinctive. Community packs use their own prefix. |
| **Learning data quality** | Learnings may accumulate noise over time. Mitigation: structured frontmatter format with tags, periodic curation, and deduplication. |
| **Hook security** | Event-driven agents could execute unintended actions. Mitigation: hooks are explicitly opt-in, condition guards (globs/labels/branches) scope activation, and guardrails policy applies to hook-triggered agents. |
| **Competitive traction gap** | No published star count vs. competitors with 10k-71k stars. Mitigation: aggressive distribution (plugin marketplaces, documentation site, landing page) and focus on unique differentiators (board management, tool-agnosticism). |
| **Context bloat** | Full content installations (110+ files) may degrade agent performance in tools with limited context windows. Research (Gloaguen et al. 2026) shows verbose context files harm agent effectiveness. Mitigation: tiered preset system (Minimal/Standard/Full/Custom) lets users control installed content volume; planned `--minimal` generation mode will produce compact configs; orchestration rule uses tiered rule inclusion to manage token budgets for subagent prompts. |

---

## 24. Real-World Validation

hatch3r's patterns are not theoretical — they are extracted from a production agentic setup that has been iteratively refined:

### Proven Inventory

| Category | Count | Examples |
|----------|-------|---------|
| **Rules** | 22 | Code standards (includes error handling, merged in v4.0), testing, API design, observability, dependency management, feature flags, performance budgets, tooling hierarchy, migrations, component conventions, learning consultation, browser verification, git conventions, theming, i18n, security patterns, agent orchestration, deep context, accessibility standards, CI/CD, data classification, secrets management |
| **Agents** | 16 | Code reviewer, test writer, lint fixer, security auditor, docs writer, a11y auditor, performance profiler, CI watcher, dependency auditor, implementer, researcher, architect, context-rules, devops, fixer, learnings-loader |
| **Skills** | 25 | Bug fix, feature, refactor, logical refactor, visual refactor, PR creation, release, QA validation, incident response, a11y audit, performance audit, dependency audit, architecture review, issue workflow, GitHub agentic workflows, context health, cost tracking, recipe, agent customize, rule customize, skill customize, command customize, API spec, CI pipeline, migration |
| **Commands** | 34 | Board init/fill/pickup/shared/refresh/groom, project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, migration-plan, test-plan, api-spec, workflow, learn, hooks, onboard, quick-change, revision, debug, healthcheck, security-audit, dep-audit, release, benchmark, context-health, cost-tracking, recipe, agent-customize, rule-customize, skill-customize, command-customize |
| **GitHub Agents** | 4 | Docs, lint, security, test (simplified for Copilot/Codex) |
| **MCP Servers** | 10 | Context7, Filesystem, Playwright (default); GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab (opt-in) |

### Key Patterns Validated

- **Naming convention for ownership:** `hatch3r-*` prefix cleanly separates managed from custom files
- **Sub-agentic delegation:** implementer agent + issue-workflow skill + board-pickup command enable parallel issue execution with structured handoffs
- **Board management:** board-init + board-fill + board-pickup provide a complete todo-to-PR pipeline with dependency DAG construction, readiness assessment, collision detection, and sub-agent orchestration
- **Tooling hierarchy:** GitHub MCP > Context7 MCP > web research prevents hallucinated APIs and stale patterns
- **Structured skill workflows:** step-by-step protocols with checkpoints, escalation triggers, and quality gates produce consistent output
- **Agent system prompts:** frontmatter metadata + role + checklist + output format + boundaries = reliable agent behavior
- **Learning loop:** learning capture from completed issues + auto-consultation on similar future work compounds project knowledge
- **Event-driven hooks:** lifecycle hooks activate agents automatically (pre-commit lint fixing, session-start context loading) reducing manual orchestration
- **Project analysis pipeline:** project-spec/codebase-map -> roadmap -> board-fill provides end-to-end project bootstrapping
- **Guided workflow:** structured development phases (analyze, plan, implement, review) with quick mode for small tasks

---

## 25. Branding & Messaging

### Mascot

A cute but capable "ops assistant" vibe:

- Small T-rex hatchling
- Egg shell cracked open
- Conveys: "new project → instantly alive with agent power"

### Slogan (primary)

**Crack the egg. Hatch better agents.**

### Backup Slogans

- "One command to hatch your agent stack."
- "From empty repo to agent-ready."
- "Your team's agent instincts — packaged."

---

## 26. Appendix: Adopted Patterns

| Pattern | Source |
|---------|--------|
| Interactive init + template copying | cursor-rules-cli, BMAD Method |
| Cross-tool syncing from canonical source | skillshare, agent-skills-cli, SkillKit |
| Canonical repo instruction files | GitHub Copilot docs, AGENTS.md spec |
| Claude Code skills packaging | Claude Code docs |
| OpenCode rules via AGENTS.md | OpenCode docs |
| Cursor `.mdc` rule format | Cursor docs |
| Cursor plugin manifest + marketplace | Cursor Marketplace docs |
| Windsurf `.windsurfrules` + AGENTS.md | Windsurf docs |
| Sub-agentic delegation pattern | Superpowers, GSD, production agentic setup |
| Structured issue workflow | Production agentic setup |
| Tooling hierarchy (MCP-first) | Production agentic setup |
| Learning/compounding loop | Compound Engineering |
| Lifecycle hooks and event-driven automation | Claude Code hooks, Kiro Agent Hooks |
| Parallel researcher sub-agents for project analysis | GSD `/new-project` |
| Guided development methodology | BMAD (4-phase), Superpowers (brainstorm-plan-execute-verify) |
| Plugin marketplace distribution | Superpowers, Compound Engineering |
