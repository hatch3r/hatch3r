# hatch3r — Product Requirements Document v4.5

**Product name:** hatch3r
**Mascot:** a tiny T-rex hatchling peeking out of an egg
**Primary slogan:** Crack the egg. Hatch better agents.
**Doc version:** v4.5
**Date:** 2026-04-21 (Europe/Berlin)
**Supersedes:** hatch3r PRD v4.4 (2026-04-20)
**Last updated:** 2026-04-21

---

## 1. Executive Summary

> **Posture (post Cycle 8, 2026-04-21):** Ship Ready — overall audit score 83.74/100, 0 Critical findings, 15 platform adapters wired, 19-domain governance audit cycle operational, resilience pipeline and trust-delegation per-adapter `tools:` emission landed in Cycle 7.5 W2B2 (H41/H44/H45/H46), Cycle 8 Wave 3 reached terminal status on all 40 targeted Medium findings (38 done + 1 partial by plan + 1 already-resolved; 3 initially-rolled-back findings re-landed in commit `0a03a92`) with the reviewer verdict upgraded to SHIP.

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository under `/.agents/`, then generates optimal native configuration for the developer's selected coding tool(s): Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity, and a standalone AGENTS.md output.

The product solves the "great agent setups don't travel well" problem by making agentic coding infrastructure:

- **Portable** — canonical source in `/.agents/`, works in any repo
- **Repeatable** — one `npx hatch3r init` command
- **Tool-optimized** — adapters generate native config per tool
- **Reviewable** — plain text, versioned in git
- **Safe by default** — guardrails, deny-lists, optional enforcement wrappers
- **Updatable** — `npx hatch3r update` pulls latest without overwriting customizations
- **Learnable** — captures insights from issues, reviews, and decisions; compounds project knowledge over time
- **Event-driven** — lifecycle hooks activate agents automatically on commits, merges, CI failures, and more
- **Proven** — patterns extracted from a production agentic setup; live counts in `governance/inventory.json` (auto-derived per cycle by `scripts/inventory.ts`); see also 10 MCP servers and 4 GitHub agents
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
- **Competing frameworks** (Superpowers ~130k stars, GitHub Spec Kit ~84k stars, BMAD ~41k stars, GSD ~32k stars, Ruflo ~29k stars, Compound Engineering ~10k stars) have validated that structured methodology, sub-agentic delegation, multi-agent orchestration, multi-tool support, and learning loops are table-stakes features for production agentic setups.

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

### Key Competitors

> **PRD pointer.** Per-framework star counts, focus areas, and strength tables are maintained in `governance/COMPETITIVE-ANALYSIS.md` and refreshed each audit cycle by D17 (Competition & Market Intelligence). The PRD intentionally does not duplicate the table to avoid the staleness pattern observed in v4.1 (Cycle 7 finding F18.1-H1: Superpowers PRD 130k vs live 160k, Spec Kit 84k vs 89.4k, OpenCode 114k vs 146k, Cline 60.5k absent). D17 outputs are the canonical, dated source.
>
> **D17 auto-refresh contract.** Every audit cycle re-verifies competitor stars via GitHub API and updates `COMPETITIVE-ANALYSIS.md` with access date + trust tier. Staleness >14 days is itself a finding per Cycle 7 evolution proposal #5.

### hatch3r Positioning

hatch3r occupies a unique position as the only framework combining: **deeply native adapter architecture** (tool-specific config generation via 16 adapters from a single canonical source — not template-based), **multi-platform board management** (GitHub Projects V2, Azure DevOps, and GitLab), and a **compounding learning loop**. No competitor combines all three. The key repositioning from v4.0: the differentiator is no longer "most tools" (Spec Kit has 20+, BMAD has 28 templates) but **"deepest native integration across the most tools"** — hatch3r generates configs that leverage each tool's specific features (Cursor `.mdc` frontmatter, Claude Code hooks, Kiro steering, Copilot instruction priorities) rather than applying one-size-fits-all templates.

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
| Multi-tool configuration generation | GitHub Spec Kit (20+ tools), Superpowers v5 (6 tools) |
| MCP Server Cards (upcoming) | MCP June 2026 specification |

**See [COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md) for detailed per-framework analysis, gap analysis, and strategic recommendations.**

### Standards Alignment

hatch3r's canonical-source-plus-adapter architecture aligns with the emerging Agentic AI Interoperability Format (AAIF) direction: a single `/.agents/` source maps to per-tool native configs (Cursor `.mdc`, Claude Code skills, Copilot instructions, AGENTS.md). hatch3r tracks AAIF and adjacent specifications (Anthropic Skills Library, AGENTS.md spec, MCP Server Cards June 2026) as inputs to adapter design — adopting standardized fields where they exist and contributing tool-specific extensions where they do not. Per Cycle 7 finding 17.3-C, explicit standards-alignment positioning differentiates hatch3r from template-only competitors.

### 5.x AAIF/ACP Standards Alignment (Cycle 7.5 W2B2 H57)

hatch3r emits AAIF-compatible artifacts today and monitors adjacent standards on a quarterly cadence defined in `governance/audit/domains/D17-competition.md`:

| Standard | hatch3r Status | Monitoring Cadence | Evidence |
|----------|---------------|--------------------|----------|
| AAIF (Agentic AI Interoperability Format, AGENTS.md spec) | Active — `src/adapters/agentsmd.ts` emits AAIF-compliant `AGENTS.md`; AAIF row added to `docs/adapter-capability-matrix.md` in H34 | Each audit cycle (D17 live-baseline per CL-3 P2) | 60,000+ repositories consume AGENTS.md per AAIF-governance releases |
| ACP (Agent Coordination Protocol) registry (JetBrains + Zed, launched 2026-01-28) | Monitoring — registry listing pending; no code blocker | Quarterly D17 sub-agent check | ACP registry endpoint at `jetbrains.com/help/ai-assistant/acp.html` |
| Claude Plugin Marketplace | Submitted via C7-H16 (Partial) | Tracked in §22.Mx milestone (a) | Anthropic marketplace PR open |
| MCP Server Cards (June 2026 spec) | Planned per §5 Standards Alignment paragraph | At spec finalization | See §22 M2 Cycle 4 Roadmap item 11 |

Pre-emptive emission strategy: hatch3r adapters emit standards-compliant output before consumption is required, so adoption lag by tools does not block hatch3r users. Concrete example: AAIF `AGENTS.md` row landed in adapter capability matrix before the AAIF registry began auditing config distributors.

### Comparison vs Ruler

README.md carries a "How hatch3r differs from Ruler" section derived from `governance/COMPETITIVE-ANALYSIS.md`. Ruler is the closest architectural analogue to hatch3r's canonical-source-plus-adapter model. Measured differences: hatch3r has 15 native adapters vs Ruler's 32 rule-distribution targets (Ruler wider, hatch3r deeper); hatch3r ships skills/commands/hooks/MCP/board/learning-loop/audit-cycle content vs Ruler's rules-only distribution; hatch3r runs a 20-domain governance audit cycle with 111 sub-agents, Ruler ships none. PRD defers the table to README to avoid duplication per the D17 single-source-of-truth contract.

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
18. **Coverage infrastructure must reflect actual quality** (test coverage metrics must accurately measure real codebase coverage — no inflated percentages from misconfigured exclusions; coverage is a quality signal, not a vanity metric. Added from Cycle 4 finding D3-C1)
19. **Architecture decisions are documented** (significant architectural choices are recorded as ADRs in `docs/decisions/`. ADR-001 documents the pipeline library-without-orchestrator pattern — hatch3r provides composable pipeline building blocks rather than a runtime orchestration engine. Added from Cycle 5 CL1-7)
20. **Destructive commands expose `--dry-run`** (any CLI command that writes, updates, or removes files under a managed path supports a `--dry-run` flag that previews the full action set — created/modified/removed paths with per-file rationale — without mutating the working tree. Rationale: reduces fear-of-use for `update`, `clean`, `worktree-cleanup`, and future write-capable commands by letting users verify intent before committing to changes. Landed for `update` in Cycle 8 via finding C8-D12-M2. Added from Cycle 8 CL-1)
21. **Not-yet-implemented is not a user error** (commands or subcommands whose canonical codepath is scaffolded but not wired — e.g., `hatch3r add <source>` pending full pack resolution — exit with code 0 and a "coming soon" message rather than exit 2 "usage error". Exit 2 is reserved for actual usage mistakes (unknown flag, missing required argument). Added from Cycle 8 finding C8-D1-M8)

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
- Tool adapters: Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity, AGENTS.md (per-cycle counts in `governance/inventory.json`)
- Cursor plugin distribution via Marketplace
- Canonical pack format under `/.agents/` including: agents, skills, rules, prompts, commands, hooks, learnings, MCP configuration, guardrails, GitHub agents
- `default` preset with full content; live counts in `governance/inventory.json` (auto-derived per cycle by `scripts/inventory.ts`)
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

**Environment detection (added from Cycle 4 finding D10-M7, D19-H4):**

- **TTY detection:** When `process.stdout.isTTY` is false (piped output, CI environment), skip interactive prompts and use `--yes`/`--preset` defaults. Display a clear message: "Non-interactive mode detected. Use `--preset default` or provide flags."
- **CI-mode detection:** When `CI=true` or common CI environment variables are present (`GITHUB_ACTIONS`, `GITLAB_CI`, `JENKINS_URL`, `CIRCLECI`), auto-select non-interactive defaults and suppress color output.
- **Preset-aware messaging:** When a preset is selected, show a summary of what the preset includes before proceeding, so users understand what they are getting without stepping through each choice.

**Interactive steps:**

1. **Detect repo basics** — language hints, package managers, monorepo structure, existing agent configs
2. **Choose platform** — GitHub, Azure DevOps, or GitLab (for board management and platform MCP server)
3. **Choose tool(s)** — multi-select: Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity, AGENTS.md
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

**`--docs` flag:** `npx hatch3r validate --docs` verifies that documented artifact counts in README.md match actual counts on disk (agents, skills, rules, commands, hooks). This flag is suitable for CI gating to prevent documentation drift. Content count automation is performed by this flag — no manual counting is required.

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
- `.github/hooks/hatch3r-*.md` — hook definitions (v1.5.0)

**Behavior:**

- Keep Copilot instruction files concise; link to `/.agents/AGENTS.md` for the full canonical guide
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `copilot-instructions.md`
- Prompts generated from `/.agents/prompts/*` with compatible headers
- Hook definitions from `/.agents/hooks/*.md` generate Copilot-compatible hook files (v1.5.0)

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
- `.windsurf/hooks/hatch3r-*.md` — hook definitions (v1.5.0)

**Behavior:**

- Windsurf also supports `AGENTS.md` — if the content exceeds `.windsurfrules` limit, use `AGENTS.md` as fallback
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks
- Hook definitions from `/.agents/hooks/*.md` generate Windsurf-compatible hook files (v1.5.0)

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
- `.zed/mcp.json` — project-level MCP configuration (v1.5.0)

**Behavior:**

- Zed reads `.rules` for project context
- Use `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks in `.rules`
- MCP servers from canonical config are transformed to Zed's `.zed/mcp.json` format using shell transport (v1.5.0)

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

### 10.16 AGENTS.md Adapter (v1.5.0)

**Generate:**

- `AGENTS.md` — standalone agent instructions file compiled from canonical `/.agents/` sources

**Behavior:**

- Generates a single `AGENTS.md` from all canonical agents, rules, and skills in `/.agents/`
- Consumed by OpenCode, Windsurf, Amp, Codex, and any tool that reads `AGENTS.md`
- Supports customization via `applyCustomization()`
- Does not generate hooks, MCP, commands, prompts, or GitHub agent outputs
- Resolves the AGENTS.md generation blocker identified in Cycle 4 (D5-H3, D16-C3)

### 10.17 Per-Adapter Context Budgets (v1.5.0)

`src/adapters/contextBudget.ts` defines per-adapter token limits to prevent context window overflow at sync time. Each adapter has a configured budget reflecting the target tool's context capacity. During `sync` and `init`, the adapter pipeline checks generated output size against the budget and emits warnings when output approaches or exceeds the limit. This addresses the context bloat risk (D6-C1) identified in Cycle 4.

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
| Zed | `.zed/mcp.json` (shell transport) |
| Amazon Q | `.amazonq/mcp.json` |
| Antigravity | `.antigravity/settings.json` (under `mcpServers` key) |

**Warning (always shown when MCP is enabled):** "Third-party MCP servers can execute actions and access data. Review server sources before enabling."

#### MCP Propagation Requirements (added from Cycle 4 findings D11-H1, D11-H2)

When adapters transform the canonical MCP config to tool-specific formats, the following must be preserved:

1. **Header forwarding:** Any `headers` object in the canonical config (e.g., GitHub MCP's `Authorization` and `X-MCP-Toolsets`) must be propagated to the tool-specific output format. Tools that support HTTP-based MCP connections (Cursor, Claude Code, Copilot) must include headers verbatim. Tools that do not support headers must emit a warning comment in the generated config.
2. **`env:VAR` transformation:** The `${env:VAR_NAME}` placeholder syntax in the canonical config must be transformed to each tool's native environment variable resolution syntax. For tools that support `envFile` (e.g., Copilot/VS Code), generate the appropriate `envFile` reference. For tools that use inline `env` objects, preserve the variable names. For tools that lack native env var support, emit a setup instruction comment.
3. **No silent drops:** If a canonical MCP field cannot be expressed in a target tool's format, the adapter must log a warning during `sync`/`init` — never silently omit configuration.

---

## 14. Distribution Channels

### Channel 1: CLI (Primary)

```bash
npx hatch3r init          # Interactive setup
npx hatch3r sync          # Re-generate from canonical state
npx hatch3r update        # Pull latest, safe merge
npx hatch3r add <pack>    # Add a community pack (stub — planned for full implementation)
npx hatch3r status        # Check sync state
npx hatch3r validate      # Validate .agents/ structure (--docs for count verification)
npx hatch3r verify        # Verify file integrity
npx hatch3r clean         # Remove generated files (optional --reinit)
npx hatch3r worktree-setup   # Set up git worktree isolation
npx hatch3r worktree-cleanup # Clean up worktree artifacts
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
| Copilot | `.github/hooks/hatch3r-*.md` hook definitions (v1.5.0) |
| Windsurf | `.windsurf/hooks/hatch3r-*.md` hook definitions (v1.5.0) |
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
- `validate` validates `/.agents/` structure, frontmatter, naming conventions, and MCP config. The `--docs` flag verifies documented artifact counts match actual on-disk counts, suitable for CI gating
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
  "tools": ["cursor", "copilot", "claude", "opencode", "windsurf", "amp", "codex", "gemini", "cline", "aider", "kiro", "goose", "zed", "amazon-q", "antigravity", "agents-md"],
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

### 20.1 Wiring Before Declaration (added Cycle 7, finding D16-SA16.1-1)

A capability is "shipped" only when its production codepath invokes the implementation. Existence of source code, test-only invocation, or compliance verification based on file presence does not satisfy this principle. Cycle 7 D8-SA8.4-1 surfaced 5 of 7 resilience modules (`circuitBreaker`, `adapterTimeout`, `phaseTimeout`, `pipelineTimeout`, `phaseOutputSchema`) as implemented but unwired — `complianceVerification.ts` reported PASS based on module existence rather than runtime invocation. Enforcement: `scripts/verify-wired.ts` CI check (CL-2 P1) scans `src/cli/commands/` for every compliance-declared module and fails CI when a module exists but is not invoked. The 4-tuple feature-status taxonomy (implemented / wired / CLI-registered / tested) is recorded per finding in `finding-registry.json` (Cycle 7 evolution proposal #3). See also §22 status legend.

### 20.2 Silent Failure Contract (added Cycle 7, finding D16-SA16.1-5)

Catch blocks must emit to at least one diagnostic channel — `warnings[]`, `observability.ts`, or the failure log — before swallowing or skipping. Cycle 7 found 10+ call-sites across 5 layers (D1, D2, D5, D9, D19) violating this contract; the most visible case was the SessionStart hook reporting "Registry not found" every session, masking a Python type error against `finding-registry.json`. Enforcement: ESLint rule (CL-2 P2) flags catch blocks without a diagnostic-emission call. The contract is codified in `governance/CONSTITUTION.md` per Wave 2 H11; this PRD section is the framework-convention pointer.

### 20.3 Trust Model Partitioning (added Cycle 7, finding D15 Overarching)

Trust controls divide into two classes; the PRD does not claim the same enforcement strength for both:

- **Runtime-enforced** — Controls invoked on every production codepath. Examples after Cycle 7 wiring work: `promptGuard` (500 KB input / 1 MB output limits + content safety patterns), `agentToolAllowlist` (deny-by-default per-agent capability restrictions), `safeWrite` (temp file plus atomic rename for all canonical writes), SHA-256 integrity verification at `init`/`update`.
- **Delegated** — Controls whose enforcement depends on the host AI tool, the user's environment, or external infrastructure. Examples: MCP server review (the user vets third-party MCP sources), guardrail policy execution (the host shell or `safe-run` wrapper), prompt-injection resistance of the underlying model.

Truthful per-control status (runtime-enforced vs delegated, plus current wiring state) is maintained in `SECURITY.md`. The PRD references but does not duplicate `SECURITY.md`; suggest the maintainer updates `SECURITY.md` with the per-control partition table referenced here.

### 20.4 Inventory as Single Source of Truth (added Cycle 8, findings C8-D10-M1, C8-D19-M1)

`governance/inventory.json` is the canonical source for every framework-wide content count surfaced in user-facing documentation: README.md inventory callouts, CLAUDE.md architecture tables, `.cursor-plugin/plugin.json` manifest summaries, the §1 Executive Summary "live counts" pointer, and the §22 status rows. The file is regenerated each cycle by `scripts/inventory.ts`. Enforcement: `scripts/inventory.ts --check-docs` (wired into CI) runs 11 drift probes comparing inventory-derived totals against literal digits in the tracked documents and fails the build on divergence. Rationale: Cycle 7 and Cycle 8 both surfaced rule-count and content-type drift in README / CLAUDE.md that would otherwise be caught only by manual audit; the drift guard eliminates a recurring finding class. Any new documentation surface that states framework-wide counts must cite `governance/inventory.json` and be added to the probe list in `scripts/inventory.ts`.

---

## 21. Success Metrics

> **Partition (v4.2, 2026-04-19, Cycle 7 finding F18.1-M1).** Metrics below are split by whether a measurement infrastructure exists and whether there is an installed-user base large enough to produce non-trivial data. "Measured today" metrics have live data or a deterministic local test. "Deferred pending N users" metrics need an installed base before targets can be validated (Cycle 7 D17 baseline: 20 GitHub stars, 326 monthly npm downloads).

### 21.1 Measured Today

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Coverage accuracy** | >=95% true coverage | Vitest `coverage.all` enabled; all source files instrumented (resolved v1.5.0, previously inflated to 90.66% reported vs ~70-75% true) |
| **Drift reduction** | Decreasing | Manual edits inside `hatch3r-*` files trend to zero (directional) |
| **Time-to-first-value** | <90s | Deterministic local test: `npx hatch3r init` (~30s interactive flow) plus first agent invocation (~60s) |

### 21.2 Deferred — Pending Installed-User Base

| Metric | Target | Measurement | Unblock Condition |
|--------|--------|-------------|-------------------|
| **Activation** | >85% | % of installs that generate at least one tool adapter | Needs >=500 installs for non-trivial data; requires plugin marketplace submission (Cycle 7 Wave 1) |
| **Tool breadth** | >1.5 | Average tools configured per repo | Same unblock as Activation |
| **Retention** | >20% | % of repos running `sync` or `update` within 30 days | Needs >=100 repeat installs over a 30-day window |
| **Plugin adoption** | Tracked | Cursor plugin installs + Claude Code marketplace installs | Blocked on Claude Code marketplace submission (see §22 M2) |
| **Pack ecosystem** | >=3 | Community packs published within 6 months of public launch | Needs community contributor base |
| **One-shot success rate** | Baseline TBD | % of agent tasks completed correctly on first attempt | D10-M19 measurement infrastructure; target set after 30 days of baseline data |
| **Adapter quality score** | >=4.0/5.0 | Tool-specific feature utilization from benchmark suite | Benchmark suite execution pending (COMPETITIVE-ANALYSIS.md §5.4) |

---

## 22. Release Plan

### Milestone 1 — MVP (Shipped, status legend below)

> **Feature-status taxonomy (added v4.2 Cycle 7, finding F18.1-H2 + D16-SA16.1-4).** Every shipped capability is reported against a 4-tuple: **implemented** (source code exists), **wired** (production codepath invokes it), **CLI-registered** (exposed via a CLI command surface where applicable), **tested** (covered by automated tests). A capability is "shipped" only when all four are true (where applicable to the capability). Cycle 7 D8-SA8.4-1 surfaced 5 of 7 resilience modules as implemented-but-unwired; this taxonomy prevents recurrence. Per-feature status is tracked in `governance/inventory.json` and `finding-registry.json`.

Status legend per row: **[I/W/C/T]** = implemented / wired / CLI-registered / tested. `n/a` means not applicable for that feature class.

- **CLI commands [I/W/C/T]** — `init`, `config`, `sync`, `update`, `status`, `validate` (with `--docs` CI gate), `verify`, `clean`, `worktree-setup`, `worktree-cleanup`. `add` is **[I/—/C/T]** (stub: CLI entry exists, full pack resolution not yet wired). Live count: see `governance/inventory.json` `cliCommands`.
- **Tool adapters [I/W/n/a/T]** — Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity, plus the AGENTS.md standalone adapter. Live count: see `governance/inventory.json` `adapters`.
- **Canonical content [I/W/n/a/T]** — agents, skills, rules, commands, hooks, prompts, GitHub agents. Live counts and per-artifact filenames: `governance/inventory.json` (auto-derived per cycle by `scripts/inventory.ts`).
- **MCP servers [I/W/n/a/T]** — 10 servers in canonical config (3 default: Filesystem, Context7, Playwright; 7 opt-in: GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab).
- **Hook system [I/W/C/T]** — 6 event types with adapter integration.
- **Learning system [I/W/C/T]** — `hatch3r-learn` capture command + `hatch3r-learning-consult` auto-consultation rule.
- **Project analysis commands [I/W/C/T]** — project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, migration-plan, api-spec.
- **Workflow commands [I/W/C/T]** — workflow, onboard, quick-change, revision, debug, benchmark.
- **Board management [I/W/C/T]** — init, fill, pickup, shared, refresh, groom.
- **Guardrails [I/W/n/a/T]** — denylist plus `safe-run` wrapper (delegated trust class per §20.3).
- **Safe merge [I/W/n/a/T]** — naming convention + managed blocks + backups + atomic temp+rename via `safeWrite`.
- **Cursor plugin manifest [I/n/a/n/a/n/a]** — present at repo root; marketplace submission tracked in M2.
- **Resilience pipeline modules — wiring status (Cycle 7 + Cycle 7.5 W2B2).** `circuitBreaker`, `adapterTimeout`, `phaseTimeout`, `pipelineTimeout`, `phaseOutputSchema` were **[I/—/n/a/T]** at Cycle 7 Wave 1 wiring work; Cycle 7.5 W2B2 landed resilience wiring (C7-C1) and the modules below. Per-module wiring status maintained in `finding-registry.json` against finding D8-SA8.4-1.
- **Trust-delegation per-adapter `tools:` emission [I/W/n/a/T]** — Cycle 7.5 W2B2 H41 landed; adapters that expose per-agent tool allowlists now emit `tools:` entries from canonical metadata (see `src/adapters/` and `src/pipeline/agentToolAllowlist.ts`).
- **Adapter tool translator [I/W/n/a/T]** — Cycle 7.5 W2B2 H45 landed; `src/adapters/adapterToolTranslator.ts` translates canonical tool IDs into per-adapter tool names with deny-by-default semantics.
- **MCP description scan [I/W/n/a/T]** — Cycle 7.5 W2B2 H46 landed; `src/pipeline/mcpDescriptionScan.ts` scans MCP server descriptions for prompt-injection patterns during generation.
- **Allowlist denial observability [I/W/n/a/T]** — Cycle 7.5 W2B2 H44 landed; `allowlistDenialEvent` telemetry fires from `src/pipeline/agentToolAllowlist.ts` when a denied tool is attempted, enabling audit replay via `src/pipeline/observability.ts`.
- **Cycle 8 security hardening layer [I/W/n/a/T]** — Five targeted Medium hardenings landed in Wave 3 (commit `34d2ba4`): (1) `DENY_PATTERNS` extended with 2026 injection variants P-PIPE-08..P-PIPE-12 covering Unicode tag chars, base64 directive overrides, homoglyphs, image-exfiltration URIs, and error-wrap exfiltration (C8-D15-M1); (2) deny-pattern normalization runs a 5-iteration cascade fixpoint preventing partial-replacement bypass (C8-D11-M1); (3) `validateToolPolicies` throws `HatchError(VALIDATION_ERROR)` with Levenshtein suggestion on unknown tool categories instead of warning and continuing (C8-D15-M3); (4) `worktree-setup` emits a CWE-552 blast-radius warning and interactive confirmation (with `--yes` bypass) when `.env.mcp` is detected, documenting credential-exposure risk (C8-D15-M2); (5) CI supply-chain job gates PRs via `actions/dependency-review-action@v4.9.0` SHA-pinned with `fail-on-severity:critical` (C8-D4-M1). All items covered by new tests (35 total across the 5 sub-findings).
- **Release quality gate (Cycle 4 findings D3-C1, D16-C1):** Every release must pass (1) typecheck with zero errors, (2) all tests pass, (3) coverage metrics reflect real codebase coverage (no inflated percentages from misconfigured exclusions), (4) no regressions from previous release. Coverage accuracy is a prerequisite for the other gates.
- **v4.0 historical changes:** `hatch3r-error-handling` merged into `hatch3r-code-standards`; 5 new agents (architect, context-rules, devops, fixer, learnings-loader); 3 new skills (api-spec, ci-pipeline, migration); 5 new rules (accessibility-standards, ci-cd, data-classification, deep-context, secrets-management); 8 new commands; 4 new adapters (Aider, Kiro, Goose, Zed).

#### Resolved Blockers

- ~~**Coverage infrastructure:**~~ The `coverage.all` Vitest configuration was misconfigured (excluding test files from coverage measurement inflated reported percentages). Fixed in v1.5.0 — coverage metrics now accurately reflect actual codebase coverage. This was a prerequisite for reliable quality gating.
- ~~**AGENTS.md generation:**~~ The AGENTS.md adapter was not generating from canonical source, blocking platform integration for Copilot, Codex, Amp, and other AGENTS.md-consuming tools. Fixed in v1.5.0.

### Milestone 2 — Expansion

- ~~**Additional tool adapters:**~~ Aider, Kiro, Goose, Zed shipped in v4.0; Amazon Q and Antigravity shipped in v1.3.0. **Remaining:** Continue adapter.
- **Preset packs:** `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`
- **Preset composability:** `--preset web-app,security` layering
- **Distribution:** Claude Code plugin marketplace, Cursor marketplace formalization. **Quality gate:** marketplace distribution requires passing quality infrastructure prerequisites — accurate coverage metrics (resolved in v1.5.0), AGENTS.md generation from canonical source (resolved in v1.5.0), and all adapter parity checks passing.
- **Claude Code plugin marketplace submission — P0, decoupled track (Cycle 7 finding F18.2-H1).** D17/D18 analysis confirms submission to `anthropics/claude-plugins-official/external_plugins` is a 1-day packaging exercise; hatch3r's canonical artifacts already match the plugin schema. **This track is independent of Agent Teams.** Cycle 7 sequence: Week 1 plugin marketplace submission (1 day) plus 6 preconditions totalling 4-5 eng days (AGENTS.md fixes, README/CLI repositioning, Show HN copy, vs-Ruler comparison). Cumulative ~5-6 eng days.
- **Claude Code Agent Teams integration — separate P1 track (D18-H15, finding #94).** Agent Teams support is its own multi-week capability — **not** a marketplace submission prerequisite. Plan: (1) map hatch3r's agent inventory to Agent Teams roles and capabilities, (2) generate Agent Teams configuration from canonical `/.agents/` source, (3) implement Team-mode compatibility in the Claude Code adapter, (4) enable native multi-agent orchestration to work with hatch3r's agent definitions, (5) test hatch3r-generated Agent Teams configs against the Claude Code research preview. **Effort:** Medium (3-4 weeks). **Dependencies:** Claude Code adapter updates for 2.0 features (persistent memory, multi-agent orchestration); Agent Teams API stability. Marketplace submission proceeds without waiting for this track.
- **Documentation site** (hatch3r.dev/docs): getting-started, architecture, reference, tutorials — *in progress*
- **Landing page** (hatch3r.dev): value proposition, quick start, comparison, social proof
- ~~**Pack ecosystem: authoring guide**~~ — completed (documented in CONTRIBUTING.md). **Remaining:** validation improvements, community sourcing.
- ~~**Selective init with content presets**~~ — shipped in v1.2.0 (4 presets: Minimal, Standard, Full, Custom)
- ~~**`hatch3r config` command**~~ — shipped in v1.2.0

#### Cycle 4 Roadmap Additions (12 items from audit findings #93)

> Added April 2, 2026. These items were identified during the Cycle 4 audit (D16, D17, D18 findings) and represent gaps that must be addressed for competitive positioning and framework quality.

**P1 — Content Gap Artifacts (address within 30 days):**

1. **Accessibility check definition** (hatch3r-accessibility-check) — 5th check currently missing; only 4 of expected 5 checks exist. Blocks accurate content inventory claims. (D16-C2, Effort S)
2. **AGENTS.md generation from canonical source** — ~~Fixed in v1.5.0.~~ Platform integration blocker resolved. (D5-H3, D16-C3)
3. **Junie adapter** (JetBrains Junie) — Emerging IDE-native agent platform with growing market share. Native adapter needed for competitive coverage. (D9-M32, Effort M)
4. **Augment Code adapter** — Emerging AI coding tool. Native adapter needed for competitive coverage. (D9-M33, Effort M)

**P2 — Content Quality Improvements (address within 60 days):**

5. **hatch3r-docs-writing skill** — Technical documentation writing workflow with audience awareness. No docs-writing skill currently exists despite docs-writer agent. (D16-H12, Effort M)
6. **hatch3r-containerize skill** — Containerization workflow (Dockerfile, docker-compose, K8s manifests). Missing from skill inventory despite devops agent. (D16-H13, Effort M)
7. **Error recovery addition to 20+ skills** — Error recovery sections absent from majority of skills. Degrades agent resilience. (D16-H10, Effort M)
8. **Shared prompt templates** (hatch3r-browser-automation, hatch3r-external-knowledge, hatch3r-error-recovery) — Currently duplicated across 5+ commands each. Extract to shared prompts. (D5-M48, D16-H15, Effort S each)

**P2 — Framework Quality (address within 60 days):**

9. **Multi-language support requirements** — Content is JS/TS-centric (npm run hardcoded, TS-specific rules always-loaded). Add Python, Go, Rust, Java support with language-aware content filtering. (D14-H1-H4, Effort M)
10. ~~**Context budget requirements**~~ — Per-adapter context budgets implemented in `src/adapters/contextBudget.ts` with sync-time overflow warnings. (D6-C1, resolved in v1.5.0)
11. **MCP Server Cards support** — June 2026 MCP spec introduces Server Cards. Early adoption is a competitive differentiator. See COMPETITIVE-ANALYSIS.md section 3.2a. (D17-H10, Effort M)
12. **Benchmark suite for native output quality** — Prove "deepest native integration" claim quantitatively. See COMPETITIVE-ANALYSIS.md section 5.4 for full specification. (D17-H13, Effort High)

### Milestone 2a — Distribution Execution Sequence (Cycle 7.5 W2B2 H55)

Five sequenced distribution milestones relative to Cycle 8 kickoff (W0). Each has a target week, a success metric, and a fallback plan. Cross-reference `governance/audit/domains/D17-competition.md` live-baseline npm/GitHub cadence (Cycle 7 CL-3 P2) — staleness >14 days is a D17 finding.

| # | Milestone | Target Week | Success Metric | Fallback Plan |
|---|-----------|-------------|----------------|---------------|
| a | Anthropic Claude Plugin Marketplace PR merge | External (tracked via C7-H16 PARTIAL) | PR merged into `anthropics/claude-plugins-official/external_plugins` | If not merged by W2: execute milestones b-c regardless; resubmit after feedback |
| b | Show HN post | W1 (post marketplace merge) | >=50 HN points in 24h, >=200 comments in 48h; title: "hatch3r v1.6 — tool-agnostic AI coding rule generator for Cursor/Claude/Copilot/Cline/Windsurf/Codex and 10 more" | If milestone (a) delayed past W2: post with "submitted to marketplace" framing instead of "in marketplace" |
| c | r/ClaudeAI post | W2 | >=100 upvotes, cross-link to HN thread if live | If post downvoted under 10 upvotes within 2h: analyze feedback, revise framing, repost to r/LocalLLaMA or r/ChatGPTCoding in W3 |
| d | docs.hatch3r.com launch | W3-W4 | Docusaurus site live at docs.hatch3r.com, getting-started + architecture + adapter matrix pages indexed by Google; relies on `docusaurus-generator` skill | If Docusaurus build blocks: ship minimal GitHub Pages fallback (README + inventory.json + adapter-capability-matrix.md) |
| e | AAIF/ACP registry listing | W4-W6 | hatch3r listed in AAIF public registry OR ACP registry; per D17 quarterly standards-monitoring cadence | If neither registry accepts listing within W8: publish "why we are not in X registry" post documenting the gap; add issue to respective upstream registry repos |

Execution invariants: (1) No milestone blocks on a later one; (2) each milestone has a named owner and a dated rollback condition; (3) week numbers are rescheduled (not deleted) if external dependencies slip. PRD §23 "Competitive traction gap" risk row covers mitigation if >=2 milestones slip past W+2.

### Milestone 3 — Ecosystem & Enterprise

- Pack registry/discovery (optional hosted directory)
- Benchmark suite (SWE-bench or custom evaluation) — **specification developed in Cycle 4** (see COMPETITIVE-ANALYSIS.md section 5.4)
- Enterprise features: team rules, shared configurations, usage analytics, compliance controls
- ~~Monorepo and multi-repo board management~~ — shipped in v1.3.0 (workspace support, sync cascade)
- SkillKit / Skill Creator AI marketplace integration
- CI integration patterns (husky hooks, GitHub Actions)
- Migration guides from existing setups
- **GitHub Spec Kit competitive response strategy** — Define differentiation approach against GitHub-backed competitor (D17-M16)
- **Show HN launch execution** — Plan and execute Show HN for maximum community impact (D18-H16)
- **hatch3r-diagnose command** — Diagnostic command for troubleshooting framework issues (CL-2 #10)

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
| **Competitive traction gap** | Cycle 8 baseline (2026-04-20): GitHub public + npm publish complete — repo public, npm package `hatch3r` v1.5.1 published with OIDC and provenance, 20 GitHub stars and 432 monthly npm downloads (sources: `api.github.com/repos/hatch3r/hatch3r`, `api.npmjs.org/downloads/point/last-month/hatch3r`, accessed 2026-04-20). Live competitor totals: Superpowers 160k, OpenCode 146k, Spec Kit 89.4k, Cline 60.5k, BMAD ~41k, Ruler 2.6k as closest single-source-distribution analogue (per `governance/COMPETITIVE-ANALYSIS.md`). Distribution channel work is now incremental, not an existential prerequisite. Remaining (all tracked in §22 M2 / §22 M2a): Claude Code plugin marketplace submission, `docs.hatch3r.com` site, landing page. Additional mitigation: AGENTS.md adapter fixes targeting `sst/opencode` (146k), README/CLI repositioning, Show HN plus `r/ClaudeAI` launch, and vs-Ruler comparison content. Defensible moats (managed blocks, SHA-256 integrity, 19-domain governance, 15 adapters) verified unique vs top-5 competitors per Cycle 7 D17. |
| **Context bloat** | Full content installations (110+ files) may degrade agent performance in tools with limited context windows. Research (Gloaguen et al. 2026) shows verbose context files harm agent effectiveness. Mitigation: tiered preset system (Minimal/Standard/Full/Custom) lets users control installed content volume; planned `--minimal` generation mode will produce compact configs; orchestration rule uses tiered rule inclusion to manage token budgets for subagent prompts. |
| **Standards ecosystem drift** | AAIF (`AGENTS.md`) and ACP (Agent Coordination Protocol) are the two emerging multi-vendor standards for agent configuration distribution (§5.x). Drift risk: (1) hatch3r aligns with the wrong standard and invests in dead-end emission; (2) a dominant standard emerges that hatch3r lags on. Mitigation: pre-emptive AAIF emission already landed (`src/adapters/agentsmd.ts`, H34 adapter-capability-matrix row); quarterly D17 registry-check sub-agent monitors ACP registry listings (JetBrains + Zed, launched 2026-01-28) plus AAIF public registry; §22.Mx milestone (e) tracks AAIF/ACP listing as a named milestone with a W8 fallback post if neither registry accepts a listing. Tracked per C7.5-W2B2-H57. |

---

## 24. Real-World Validation

hatch3r's patterns are not theoretical — they are extracted from a production agentic setup that has been iteratively refined:

### Proven Inventory

> **Counts deferred to derived inventory (Cycle 7 finding F18.1-H3 + F19.1.1/.2 + D16-SA16.1-2).** Per-cycle authoritative counts and full file lists for rules, agents, skills, commands, hooks, GitHub agents, and MCP servers are derived from the filesystem by `scripts/inventory.ts` and stored in `governance/inventory.json`. Hard-coded numbers were removed here to prevent the cross-surface drift pattern (CLAUDE.md tables, README badges, plugin.json, D5/D9 domain files) documented in Cycle 7 cross-domain finding #3.

| Category | Source of truth | Examples |
|----------|-----------------|---------|
| **Rules** | `inventory.json` `rules` | Code standards, testing, API design, observability, dependency management, feature flags, performance budgets, tooling hierarchy, migrations, component conventions, learning consultation, browser verification, git conventions, theming, i18n, security patterns, agent orchestration, deep context, accessibility standards, CI/CD, data classification, secrets management |
| **Agents** | `inventory.json` `agents` | Code reviewer, test writer, lint fixer, security auditor, docs writer, a11y auditor, performance profiler, CI watcher, dependency auditor, implementer, researcher, architect, context-rules, devops, fixer, learnings-loader |
| **Skills** | `inventory.json` `skills` | Bug fix, feature, refactor, logical refactor, visual refactor, PR creation, release, QA validation, incident response, a11y audit, performance audit, dependency audit, architecture review, issue workflow, GitHub agentic workflows, context health, cost tracking, recipe, agent/rule/skill/command customize, API spec, CI pipeline, migration |
| **Commands** | `inventory.json` `commands` | Board init/fill/pickup/shared/refresh/groom, project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, migration-plan, test-plan, api-spec, workflow, learn, hooks, onboard, quick-change, revision, debug, healthcheck, security-audit, dep-audit, release, benchmark, context-health, cost-tracking, recipe, agent/rule/skill/command-customize |
| **GitHub Agents** | filesystem under `github-agents/` | Docs, lint, security, test (simplified for Copilot/Codex) |
| **MCP Servers** | `mcp/mcp.json` | Context7, Filesystem, Playwright (default); GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab (opt-in) |

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

---

## 27. Changelog

### v4.5 (2026-04-21) — Cycle 8 Partial Phase 5 CL-1 PRD Evolution

Applied 4 non-Vision-Review CL-1 candidates derived from the 36 eligible Cycle 8 partial findings (35 done + 1 partial; 3 rolled-back and 1 already-resolved excluded per the Phase 5 guardrail). Scope deliberately narrow — Cycle 8 was a cleanup cycle, not a vision shift. All 4 candidates slot into existing PRD structure; no restructuring.

| ID | Change | Sections Updated | Source Finding(s) |
|----|--------|-----------------|------------------|
| CL1-1 | Inventory as Single Source of Truth principle — `governance/inventory.json` is canonical for README/CLAUDE.md/plugin.json content counts; `scripts/inventory.ts --check-docs` runs 11 drift probes in CI | §20.4 (new subsection) | C8-D10-M1-content-counts-reconcile, C8-D19-M1-inventory-rule-count-drift |
| CL1-2 | Product Principle #20 — destructive CLI commands expose `--dry-run` preview (landed for `update` via C8-D12-M2) | §6 (new principle) | C8-D12-M2-update-dry-run |
| CL1-3 | Product Principle #21 — "not-yet-implemented is not a user error": scaffolded-but-unwired commands exit 0 "coming soon", reserving exit 2 for real usage errors | §6 (new principle) | C8-D1-M8-add-command-exit-code |
| CL1-4 | Cycle 8 security hardening layer enumerated in Shipped Surface: 2026 injection variants (P-PIPE-08..P-PIPE-12), deny-pattern cascade fixpoint, `validateToolPolicies` hard errors with Levenshtein suggestion, `.env.mcp` worktree CWE-552 warning, CI dependency-review-action gating | §22 (new Shipped Surface row); §1 posture line refreshed to post-Cycle-8 state | C8-D15-M1, C8-D15-M2, C8-D15-M3, C8-D11-M1, C8-D4-M1 |

**Evaluation summary:** 36 eligible findings evaluated; 4 CL-1 candidates proposed and applied grouping 9 source findings; 0 pending Vision-Review; 26 findings declined for PRD text (principles already codified elsewhere — e.g., C8-D5-M1 orchestrator marker under §9 canonical content model, C8-D5-M2 injection-pattern extract under §20.3 trust partitioning, C8-D2-M3 CanonicalType extensions under §9, C8-D17-M1 Ruler comparison under §5 Comparison vs Ruler — or code-layer hardening without PRD signal). C8-D18-M1 is tracked in the v4.4 entry below; C8-D16-M1 (already-resolved) and the three rolled-back findings (C8-D1-M2, C8-D7-M1, C8-D13-M1) are excluded per the Phase 5 guardrail.

Finding traceability: C8-D10-M1, C8-D19-M1, C8-D12-M2, C8-D1-M8, C8-D15-M1, C8-D15-M2, C8-D15-M3, C8-D11-M1, C8-D4-M1 transition `cl1_status: none -> applied`; the 26 declined findings transition `cl1_status: none -> declined` in `governance/audit/finding-registry.json`. C8-D18-M1 transitions `cl1_status: none -> applied` reflecting the v4.4 §23 update.

### v4.4 (2026-04-20) — Cycle 8 Wave 3 D18-M1 §23 Shipped-Status Refresh

Rewrote §23 "Competitive traction gap" row per Cycle 8 Wave 3 Medium finding `C8-D18-M1-prd-23-shipped-status`. Frames distribution as "GitHub public + npm publish complete" (shipped), lists explicit remaining items (plugin marketplace, `docs.hatch3r.com`, landing page), and refreshes npm monthly downloads from 326 (Cycle 7 snapshot) to 432 (2026-04-20 last-month window, `api.npmjs.org/downloads/point/last-month/hatch3r`). GitHub stars and npm version unchanged (20 stars, v1.5.1). No other sections modified.

| ID | Change | Sections Updated | Source Finding |
|----|--------|-----------------|----------------|
| C8-D18-M1 | §23 existential-risk row rewritten to shipped framing with explicit "Remaining:" list and refreshed download count | §23 (competitive traction row) | C8-D18-M1-prd-23-shipped-status |

### v4.3 (2026-04-20) — Cycle 7.5 W2B2 Phase 5 CL-1 PRD Evolution

Applied 4 user-approved CL-1 candidates from the Cycle 7.5 Wave 2 Batch 2 audit (reviewer verdict SHIP). User pre-approved all 4 candidates (2 Vision Review + 2 Routine) in a single batch approval.

| ID | Change | Sections Updated | Source Finding |
|----|--------|-----------------|----------------|
| CL1-1 | Distribution Execution Sequence: 5 milestones (marketplace merge, Show HN, r/ClaudeAI, docs.hatch3r.com, AAIF/ACP registry) with target weeks + success metrics + fallbacks | §22 (new Milestone 2a subsection) | C7.5-W2B2-H55 (Vision Review) |
| CL1-2 | vs-Ruler positioning: PRD cross-reference to README.md "How hatch3r differs from Ruler" section + COMPETITIVE-ANALYSIS.md Ruler row | §5 (new Comparison vs Ruler subsection) | C7.5-W2B2-H56 (Routine) |
| CL1-3 | AAIF/ACP Standards Alignment: monitoring cadence, pre-emptive emission strategy, tracked standards list; Standards ecosystem drift risk row | §5.x (new subsection), §23 (new risk row) | C7.5-W2B2-H57 (Vision Review) |
| CL1-4 | README repositioning + Ship Ready posture: §1 tagline refresh (overall 81, 0 Criticals); §22 Shipped Surface [W] tags for H41/H44/H45/H46 resilience + trust-delegation landings | §1 (posture line), §22 (Shipped Surface [W] tags) | C7.5-W2B2-H58 (Routine) |

Finding traceability: C7.5-W2B2-H55, H56, H57, H58 all transition `cl1_status: candidate -> applied` in `governance/audit/finding-registry.json`.

**Note:** `src/cli/index.ts` description() string refresh is tracked as a Cycle 8 Medium-severity code follow-on per the candidate spec; it is NOT part of this PRD update.

### v4.2 (2026-04-19) — Cycle 7 CL-1 PRD Evolution

Applied 10 CL-1 candidates from the Cycle 7 audit (overall score 31 to 39; reviewer verdict SHIP). All candidates were eligible (D17/D18 retained per protocol; D15/D16 source findings resolved in Wave 2 H5/H6/H10/H11). User pre-approved batch application via plan approval ("Full sweep + closed-loop").

| ID | Change | Sections Updated | Source Finding(s) |
|----|--------|-----------------|------------------|
| CL1-1 | Adopt 4-tuple feature-status taxonomy (implemented / wired / CLI-registered / tested) in §22 "Shipped" list | §22 (Milestone 1 status legend, per-row [I/W/C/T] markers, resilience module wiring caveat) | F18.1-H2, D16-SA16.1-4 |
| CL1-2 | Replace §5 competitor table with pointer + D17 auto-refresh contract | §5 (Key Competitors) | F18.1-H1 |
| CL1-3 | Rewrite §23 existential-risk row for shipped baseline (GitHub public, npm v1.5.1, OIDC, 20 stars / 326 monthly downloads) | §23 (competitive traction row) | F18.1-I3, F18.3-H2 |
| CL1-4 | Prune §21 success metrics into "measured today" vs "deferred pending N users" | §21.1, §21.2 | F18.1-M1 |
| CL1-5 | Decouple Agent Teams from Claude Code marketplace submission in §22 M2 (P0 marketplace track + separate P1 Agent Teams track) | §22 M2 | F18.2-H1 |
| CL1-6 | Replace hard-coded content counts with derived-inventory pointer (`governance/inventory.json` via `scripts/inventory.ts`) | §1 (Executive Summary), §7 (In Scope MVP), §22 (Milestone 1), §24 (Proven Inventory) | F18.1-H3, F19.1.1, F19.1.2, D16-SA16.1-2 |
| CL1-7 | Add "Wiring Before Declaration" architectural principle | §20.1 (new subsection) | D16-SA16.1-1 |
| CL1-8 | Add "Silent Failure Contract" framework convention | §20.2 (new subsection) | D16-SA16.1-5 |
| CL1-9 | Honestly partition trust-model controls (runtime-enforced vs delegated; SECURITY.md as truth) | §20.3 (new subsection) | D15 Overarching |
| CL1-10 | AAIF standard alignment positioning | §5 (Standards Alignment subsection) | 17.3-C |

**Domain re-scores (Cycle 7 post-execution, source for header bump):** D1 0→14, D2 0→9, D3 41→49, D5 0→9, D8 19→47, D9 0→15, D10 28→44, D11 58→66, D14 58→66, D15 0→11, D16 38→54, D17 0→3, D18 4→8, D19 54→62; overall 31→39.

### v4.1 (2026-04-10) — Cycle 5 CL-1 PRD Evolution

Incorporates 6 approved CL-1 candidates from the Cycle 5 audit. All changes reflect already-implemented code.

| ID | Change | Sections Updated |
|----|--------|-----------------|
| CL1-1 | AGENTS.md standalone adapter (`src/adapters/agentsmd.ts`) added as 16th adapter | 1, 5, 7, 8.1, 10.16, 14, 19 (FR-1, FR-2), 22 |
| CL1-2 | `validate --docs` CI gate for artifact count verification | 8.6, 14, 19 (FR-1), 22 |
| CL1-3 | Per-adapter context budgets (`src/adapters/contextBudget.ts`) with sync-time warnings | 10.17, 22 (Cycle 4 item 10 resolved) |
| CL1-7 | Pipeline architecture ADR-001 (library-without-orchestrator pattern) documented | 6 (principle 19) |
| CL1-8 | Copilot/Windsurf hook generation, Zed MCP support | 10.2, 10.5, 10.13, 13 (MCP table), 16 (hook adapter table) |
| CL1-9 | Content count automation via `validate --docs` | 8.6 |

**Deferred/noted:** CL1-4 (distribution timeline) depends on SDR-1/SDR-2. CL1-5 (Kiro rename) excluded per SDR-5. CL1-6 (diagnose command) partially addressed via failure log. CL1-10 (community model) deferred to next cycle.
