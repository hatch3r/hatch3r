# hatch3r — Full Framework Audit Prompt

> **Reusable prompt for agentic AI to perform comprehensive, recurring audits of the hatch3r framework.**
> Invoke by reading this file and executing the instructions below.

---

## Purpose

Perform a deep, end-to-end audit of every area, aspect, and line of code or content in the hatch3r framework. The goal is to ensure this framework is production-ready, open-sourceable, and excels in every capability compared to the current market — enabling end users to build winning software products at scale.

This audit covers 9 domains in parallel. Every domain requires web research for current market context. The final deliverable is a structured audit report with severity-tagged findings and prioritized action items.

---

## Framework Context

hatch3r is an open-source CLI (`npx hatch3r init`) and Cursor plugin that installs a tool-agnostic agentic coding setup into any repository. It uses a canonical source model (`/.agents/`) and generates tool-specific configurations via adapters.

### Architecture

```
/.agents/                    <- Canonical source (tool-agnostic)
  ├── agents/                <- Agent definitions
  ├── skills/                <- Skill workflows (*/SKILL.md)
  ├── rules/                 <- Coding standards, conventions
  ├── commands/              <- Slash-command workflows
  ├── prompts/               <- Reusable prompt templates
  ├── hooks/                 <- Event-triggered automation
  ├── checks/                <- Review criteria
  ├── mcp/mcp.json           <- MCP server configuration
  ├── policy/                <- Guardrails and deny lists
  ├── learnings/             <- Project learnings
  ├── AGENTS.md              <- Canonical orchestration reference
  └── hatch.json             <- Manifest

Adapters generate tool-specific output:
  .cursor/          <- Cursor       .github/         <- Copilot
  CLAUDE.md         <- Claude Code  GEMINI.md        <- Gemini CLI
  .windsurfrules    <- Windsurf     .amp/            <- Amp
  AGENTS.md         <- OpenCode     .codex/          <- Codex CLI
  .roo/ .roomodes   <- Cline        .aider/          <- Aider
  .kiro/            <- Kiro         .goosehints      <- Goose
  .rules            <- Zed
```

### Component Inventory (verify counts during audit)

| Category | Directory | Approximate Count |
|----------|-----------|-------------------|
| Agents | `agents/` | 16 |
| Rules | `rules/` | 22 .md + 21 .mdc |
| Commands | `commands/` | 32 |
| Skills | `skills/` | 22 directories |
| Hooks | `hooks/` | 6 |
| Prompts | `prompts/` | 3 |
| Checks | `checks/` | 4 |
| GitHub Agents | `github-agents/` | 4 |
| Adapters | `src/adapters/` | 13 tool adapters |
| CLI Commands | `src/cli/commands/` | init, sync, status, update, validate, add |

### Orchestration Model

All tasks follow a four-phase sub-agent pipeline (defined in `src/cli/shared/agentsContent.ts`):
1. **Research** — `hatch3r-researcher` gathers context
2. **Implement** — `hatch3r-implementer` makes changes (one per task)
3. **Review Loop** — `hatch3r-reviewer` → `hatch3r-fixer` (max 3 iterations)
4. **Final Quality** — `hatch3r-test-writer`, `hatch3r-security-auditor`, `hatch3r-docs-writer`, plus conditional specialists

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | npm package (v1.0.0, MIT, Node >=18) |
| `README.md` | Public documentation |
| `CHANGELOG.md` | Release history |
| `todo.md` | Roadmap (gitignored) |
| `docs/adapter-capability-matrix.md` | Per-adapter capability tracking |
| `docs/model-selection.md` | Model configuration docs |
| `docs/mcp-setup.md` | MCP setup guide |
| `docs/troubleshooting.md` | Common issues |
| `docs/agent-teams.md` | Claude Code Agent Teams integration |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `.github/workflows/` | CI (ci.yml, pr-checks.yml, release.yml) |

---

## Execution Model

### Sub-Agent Strategy

Spawn **one sub-agent per audit domain** (9 total). Each sub-agent runs independently and in parallel. Inherit your LLM model to every sub-agent — do not downgrade. Each sub-agent (including the orchestrator) MUST use web research to validate findings against current market state.

### Web Research Requirements

Every domain requires web search for at least:
- Current platform documentation for any tool referenced (Cursor, Copilot, Claude Code, etc.)
- Competitor frameworks and their latest capabilities
- Industry standards and best practices (OWASP, WCAG, AAIF, MCP spec)
- Recent developments in the AI coding tools market

### Pre-Audit Questions

Before beginning, the orchestrating agent should ask the user:
1. Is there a previous audit report to compare against? If so, where?
2. Are there specific areas of concern or priority for this audit cycle?
3. Should the audit include the gitignored PRD (`hatch3r-prd.md`) and competitive analysis (`COMPETITIVE-ANALYSIS.md`) if available locally?
4. What is the intended distribution model being evaluated (open-source npm, private npm, marketplace plugins, or all)?
5. Are there any new tools or platforms to add to the adapter coverage assessment?

---

## Audit Domains

### Domain 1: Source Implementation

**Scope:** All TypeScript source code in `src/` and build/test infrastructure.

**Files to audit:**
- `src/adapters/` — 13 tool adapters + `base.ts`, `canonical.ts`, `customization.ts`, `index.ts`
- `src/cli/commands/` — init, sync, status, update, validate, add
- `src/cli/shared/` — `agentsContent.ts` (bridge orchestration), other shared modules
- `src/detect/` — Repository analyzer
- `src/env/` — MCP environment handling
- `src/hooks/` — Hook system types and index
- `src/manifest/` — `hatch.json` parsing
- `src/merge/` — Managed blocks, safe write
- `src/models/` — Model resolution, customization
- `src/__tests__/` — All test files (Vitest)

**Audit checklist:**
- [ ] Code quality: naming conventions, complexity, dead code, DRY, SOLID
- [ ] Type safety: strict TypeScript, no `any` escape hatches, proper generics
- [ ] Error handling: graceful failures, user-facing error messages, edge cases
- [ ] Test coverage: run `npm test`, assess coverage gaps, test quality
- [ ] Build pipeline: `tsup` config, output correctness, tree-shaking
- [ ] CI/CD: `.github/workflows/` — ci.yml, pr-checks.yml, release.yml completeness
- [ ] Dependency health: `npm audit`, outdated packages, CVE exposure, minimal dependency surface
- [ ] Performance: startup time, file I/O patterns, unnecessary work
- [ ] Security: input validation in CLI, path traversal protection, safe file writes

**Web research:** Current TypeScript best practices, Node.js LTS compatibility, npm package security standards.

---

### Domain 2: End-to-End Wiring

**Scope:** The full data flow from canonical source through adapters to tool-specific output.

**Audit checklist:**
- [ ] Canonical model integrity: `.agents/` directory structure, `hatch.json` schema validation
- [ ] Adapter pipeline: `readCanonicalFiles()` → `adapter.generate()` → `AdapterOutput[]` → file writes
- [ ] Every canonical file type (rules, agents, skills, prompts, commands, mcp, hooks, guardrails) is correctly read, transformed, and emitted by each relevant adapter
- [ ] Managed blocks: `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` merge integrity — user content outside blocks preserved on update
- [ ] CLI lifecycle: `init` → `sync` → `update` → `status` → `validate` — each command works correctly in sequence
- [ ] Feature flags: adapter capability gates work (e.g., disabling hooks for adapters that don't support them)
- [ ] MCP config propagation: `mcp.json` correctly transformed per adapter's expected format
- [ ] Secret management: `.env.mcp` generation, `envFile` injection for Copilot, `${env:VAR}` patterns for others
- [ ] Hook system: 6 hooks (`ci-failure`, `file-save`, `post-merge`, `pre-commit`, `pre-push`, `session-start`) correctly mapped to adapter-specific event formats
- [ ] Safe write: backup creation, atomic writes, rollback on failure
- [ ] Customization flow: `.hatch3r/{agents,commands,skills,rules}/{id}.customize.yaml` correctly overrides managed content without breaking updates
- [ ] Orchestration pipeline design: Is the four-phase pipeline (Research → Implement → Review Loop → Final Quality) optimally ordered? Why max 3 review iterations — is this calibrated or arbitrary? How does context degrade across phases?
- [ ] Context propagation efficiency: How much of the context window is consumed by propagating rules, learnings, and agent instructions to sub-agents? Are there token waste patterns?
- [ ] Multi-issue parallelism: Does the dependency graph construction and parallel dispatch actually work correctly for complex issue sets?
- [ ] Non-determinism handling: LLM-based agents produce different outputs across runs. Does the pipeline account for sampling variance? Are there retries, fallbacks, or consistency checks?
- [ ] Error recovery & resilience: What happens when an agent fails mid-pipeline (e.g., implementer crashes, reviewer times out, MCP server unreachable)? Is there graceful degradation, retry logic, or does the entire workflow fail?
- [ ] Agent observability: Can users trace what each agent did, which tools it called, what decisions it made, and how much it cost? Is there audit trail support (trace IDs, structured logs) for debugging failed pipelines? (Reference: OpenTelemetry GenAI semantic conventions, EU AI Act traceability requirements)

**Web research:** AGENTS.md specification (AAIF/Linux Foundation), MCP protocol current spec, each platform's latest config format documentation. Research on multi-agent orchestration patterns, context rotation strategies, review loop calibration, agent observability standards (OpenTelemetry GenAI conventions), and agentic system resilience patterns.

---

### Domain 3: Contents Quality

**Scope:** Every agent, rule, command, skill, check, hook, and prompt — their content quality, completeness, and alignment with state-of-the-art practices.

This is the largest domain. Audit EVERY artifact, not a sample.

#### 3A: Agents (`agents/`)

Audit each of the 16 agents:
- `hatch3r-a11y-auditor` — WCAG AA compliance
- `hatch3r-architect` — Architecture decisions
- `hatch3r-ci-watcher` — CI/CD failure diagnosis
- `hatch3r-context-rules` — Context rules
- `hatch3r-dependency-auditor` — Supply chain, CVEs
- `hatch3r-devops` — DevOps tasks
- `hatch3r-docs-writer` — Documentation
- `hatch3r-fixer` — Implements reviewer findings
- `hatch3r-implementer` — Code changes
- `hatch3r-learnings-loader` — Project learnings
- `hatch3r-lint-fixer` — Linting and formatting
- `hatch3r-perf-profiler` — Performance
- `hatch3r-researcher` — Research (15 modes, including requirements-elicitation, similar-implementation)
- `hatch3r-reviewer` — Code review
- `hatch3r-security-auditor` — Security (8 domains)
- `hatch3r-test-writer` — Testing

Per agent, evaluate:
- [ ] Instruction clarity and completeness — would an LLM execute this correctly?
- [ ] Output format specification — structured, parseable, actionable?
- [ ] Scope boundaries — clear what the agent does and does NOT do?
- [ ] Integration with the four-phase pipeline — correct phase assignment?
- [ ] State-of-the-art alignment — compare against latest research and competitor agents
- [ ] Missing agents — are there roles the framework should have but doesn't?

#### 3B: Rules (`rules/`)

Audit all rules (22 .md canonical + 21 .mdc Cursor-specific):
- Accessibility standards, agent orchestration, API design, browser verification, CI/CD, code standards, component conventions, data classification, dependency management, error handling, feature flags, git conventions, i18n, learning consult, migrations, observability, performance budgets, secrets management, security patterns, testing, theming, tooling hierarchy

Per rule, evaluate:
- [ ] Technical accuracy — do recommendations reflect current best practices?
- [ ] Actionability — concrete enough for an LLM to follow, not vague platitudes?
- [ ] Scope metadata — `alwaysApply`, `globs`, `description` correctly set?
- [ ] .md/.mdc parity — canonical .md and Cursor .mdc versions are in sync?
- [ ] Completeness — are there missing rules for important domains?
- [ ] Security focus — OWASP Top 10, OWASP Top 10 for Agentic Applications coverage?
- [ ] UI/UX focus — do rules drive state-of-the-art frontend quality in end-user projects?
- [ ] Performance focus — do rules enforce measurable budgets (Core Web Vitals, bundle size, latency)?

#### 3C: Commands (`commands/`)

Audit all 33 commands. Key commands to deeply assess:
- Board management: `board-init`, `board-fill`, `board-groom`, `board-pickup`, `board-refresh`, `board-shared`
- Planning: `feature-plan`, `bug-plan`, `refactor-plan`, `migration-plan`
- Execution: `workflow`, `quick-change`, `revision`, `debug`
- Audit: `security-audit`, `healthcheck`, `dep-audit`, `context-health`, `cost-tracking`
- Customization: `agent-customize`, `command-customize`, `skill-customize`, `rule-customize`
- Other: `onboard`, `learn`, `release`, `recipe`, `codebase-map`, `project-spec`, `api-spec`, `benchmark`, `roadmap`, `hooks`

Per command, evaluate:
- [ ] Workflow completeness — does the command handle all edge cases?
- [ ] Output quality — does it produce actionable, structured output?
- [ ] Integration — does it correctly invoke agents, skills, and platform features?
- [ ] Error handling — what happens when GitHub API fails, no board exists, etc.?
- [ ] UX — is the command intuitive and well-documented for end users?

#### 3D: Skills (`skills/`)

Audit all 22 skills (each is a directory with `SKILL.md`):
- `a11y-audit`, `agent-customize`, `api-spec`, `architecture-review`, `bug-fix`, `ci-pipeline`, `command-customize`, `context-health`, `cost-tracking`, `dep-audit`, `feature`, `gh-agentic-workflows`, `incident-response`, `issue-workflow`, `logical-refactor`, `migration`, `perf-audit`, `pr-creation`, `qa-validation`, `recipe`, `refactor`, `release`, `rule-customize`, `skill-customize`, `visual-refactor`

Per skill, evaluate:
- [ ] Step-by-step clarity — would an LLM produce correct output following these steps?
- [ ] Input/output contracts — what the skill expects and what it produces
- [ ] Guard rails — does the skill prevent common mistakes?
- [ ] Verification steps — does the skill include self-check mechanisms?
- [ ] Real-world applicability — would this actually help build production software?

#### 3E: Checks, Hooks, Prompts

- `checks/` (4 files): `code-quality.md`, `security.md`, `testing.md`, `README.md` — review criteria completeness
- `hooks/` (6 files): `ci-failure`, `file-save`, `post-merge`, `pre-commit`, `pre-push`, `session-start` — event coverage, trigger accuracy
- `prompts/` (3 files): `pr-description`, `code-review`, `bug-triage` — output quality, format usefulness

#### 3F: Cross-Cutting Content Assessment

After auditing individual artifacts:
- [ ] Consistency — do agents, rules, commands, and skills use consistent terminology, severity levels, and output formats?
- [ ] Coverage gaps — are there domains or workflows not covered by any artifact?
- [ ] Redundancy — are there overlapping artifacts that should be consolidated?
- [ ] Business value — does the content set actually help users build better software, or is it cargo-cult compliance?
- [ ] Security posture — OWASP Top 10 + OWASP Top 10 for Agentic Applications fully covered across all content?
- [ ] UI/UX guidance — do contents drive maximum state-of-the-art frontend quality?
- [ ] Performance guidance — do contents enforce measurable, research-backed budgets?
- [ ] Prompt engineering quality — are agent instructions, skill workflows, and command prompts optimally engineered for LLM consumption? Assess: token efficiency, instruction-following reliability, hallucination prevention patterns, structured output enforcement, and alignment with latest research on effective LLM instruction formats (e.g., AGENTS.md best practices: 6-10 rules, <150 lines, command references over inline detail)
- [ ] Observability guidance — do the rules and agents guide end-user projects toward proper observability (structured logging, distributed tracing, metrics, alerting)? Is the `hatch3r-observability` rule aligned with OpenTelemetry standards?
- [ ] Error recovery patterns — do agents and skills teach resilient error handling for end-user projects (retries, circuit breakers, graceful degradation), or just basic try/catch?

**Web research:** Latest OWASP guidelines, WCAG 2.2 AA, Core Web Vitals thresholds, agentic AI security research, competitor framework content (GSD workflows, AgentSys plugins, CrewSwarm agents). Research on prompt engineering best practices for multi-agent systems, instruction-following benchmarks, structured output techniques, OpenTelemetry semantic conventions, and resilience engineering patterns.

---

### Domain 4: Competition and Market Intelligence

**Scope:** Competitive landscape, market positioning, and strategic alignment.

**Audit checklist:**

#### 4A: Direct Competitor Analysis
- [ ] **AgentSys** — Multi-tool agent orchestration (plugins, agents, skills for Claude Code, OpenCode, Codex, Cursor, Kiro). Compare scope, quality, and approach.
- [ ] **GSD (Get Shit Done)** — Spec-driven development for Claude Code (23.7k+ stars). Compare workflow model, popularity, community.
- [ ] **CrewSwarm** — Runtime orchestrator for OpenCode, Cursor, Claude Code. Compare architecture (WebSocket vs config generation).
- [ ] **Crux** — Multi-agent orchestration with embedded SQLite/vector search. Compare infrastructure approach.
- [ ] **agentic-code** — CLI setup via `npx agentic-code`. Compare scope and zero-config approach.
- [ ] **awesome-cursorrules** — Curated cursor rules collection (36.3k+ stars). Compare breadth vs depth.
- [ ] **Superpower / Compound Engineering** — Claude Code plugin ecosystem. Compare distribution model.
- [ ] Any NEW competitors that have emerged since the last audit

#### 4B: Standards and Ecosystem Evolution
- [ ] **AAIF (Agentic AI Foundation)** — AGENTS.md, MCP, goose under Linux Foundation. Impact on hatch3r's adapter model?
- [ ] **AGENTS.md spec** — Current version, adoption, changes since last audit
- [ ] **MCP protocol** — Current spec version, new capabilities, breaking changes
- [ ] **AI coding tool updates** — New features, deprecations, API changes for all 13 supported platforms

#### 4C: Market Positioning
- [ ] Feature gap analysis: what do competitors offer that hatch3r doesn't?
- [ ] Unique differentiators: what does hatch3r offer that no competitor does?
- [ ] Community and adoption signals: GitHub stars, npm downloads, mentions, community size
- [ ] Pricing and distribution model comparison

#### 4D: Strategic Assessment
- [ ] Is the multi-tool adapter approach still the right bet, or is the market converging on AGENTS.md natively?
- [ ] Where should hatch3r invest next based on market gaps?
- [ ] Open-source vs private distribution recommendation with rationale

**Web research:** Search for every named competitor, AAIF announcements, tool changelog pages, npm download stats, GitHub trending in the AI/coding category.

---

### Domain 5: Platform Adapters and Capability Matrix

**Scope:** All 13 adapters and the capability matrix document.

**Reference:** `docs/adapter-capability-matrix.md` (last verified: check date in file)

**Adapters to audit:**

| # | Adapter | Source | Output Format |
|---|---------|--------|---------------|
| 1 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) |
| 2 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) |
| 3 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` |
| 4 | Cline | `src/adapters/cline.ts` | `.roo/`, `.roomodes`, `.cline/` |
| 5 | Codex | `src/adapters/codex.ts` | `.codex/config.toml`, AGENTS.md bridge |
| 6 | Gemini | `src/adapters/gemini.ts` | `GEMINI.md`, `.gemini/` |
| 7 | Windsurf | `src/adapters/windsurf.ts` | `.windsurfrules`, `.windsurf/` |
| 8 | Amp | `src/adapters/amp.ts` | `.amp/AGENTS.md`, `.amp/` |
| 9 | OpenCode | `src/adapters/opencode.ts` | `opencode.json`, `.opencode/` |
| 10 | Aider | `src/adapters/aider.ts` | `CONVENTIONS.md`, `.aider/` |
| 11 | Kiro | `src/adapters/kiro.ts` | `.kiro/steering/`, `.kiro/settings/` |
| 12 | Goose | `src/adapters/goose.ts` | `.goosehints` |
| 13 | Zed | `src/adapters/zed.ts` | `.rules` |

**Per-adapter audit:**
- [ ] Read the adapter source code and the corresponding test file in `src/__tests__/adapters/`
- [ ] Verify output file paths match the capability matrix documentation
- [ ] Verify output format matches what the platform actually expects (web research: read each platform's current docs)
- [ ] Test feature flag behavior: capabilities the adapter doesn't support are correctly skipped
- [ ] Bridge orchestration: adapters that emit bridge files include the full `BRIDGE_ORCHESTRATION` content
- [ ] Model emission: verify model preference rendering (native vs guidance) per platform
- [ ] MCP format: verify MCP config transformation matches platform's expected schema
- [ ] Secret management: verify secret loading method per adapter

**Capability matrix verification:**
- [ ] Cross-reference the Implementation Matrix table against actual adapter code
- [ ] Verify all "Intentional Omissions" are still valid (platform may have added support)
- [ ] Check for new platform capabilities not yet reflected in the matrix
- [ ] Verify "Canonical Path Matches" are still accurate
- [ ] Ensure maintenance guide is complete and accurate
- [ ] Emerging platforms: are there new AI coding tools that have gained significant traction since the last audit and should be added as adapters? (Search for new entrants, rising GitHub stars, VC-funded tools)

**Web research:** Visit each platform's official documentation (links in the matrix doc). Check for config format changes, new features, deprecated formats. Search for platform changelogs from the past 3 months.

---

### Domain 6: Documentation

**Scope:** All user-facing documentation, error messages, getting-started experience, and the CLI/IDE user experience of the framework itself.

**Files to audit:**
- `README.md` — Primary documentation
- `docs/adapter-capability-matrix.md` — Capability tracking
- `docs/model-selection.md` — Model configuration
- `docs/mcp-setup.md` — MCP setup guide
- `docs/troubleshooting.md` — Common issues
- `docs/agent-teams.md` — Claude Code Agent Teams
- `CHANGELOG.md` — Release history
- `CONTRIBUTING.md` — Contributor guide
- `.cursor-plugin/plugin.json` — Plugin manifest (description, version, keywords)

**Audit checklist:**
- [ ] **Accuracy:** Do documented counts (agents, skills, rules, commands) match actual filesystem? Do code examples work?
- [ ] **Completeness:** Are all features, commands, and configuration options documented?
- [ ] **Getting-started UX:** Can a new user go from zero to working setup in under 5 minutes?
- [ ] **Troubleshooting coverage:** Are common failure modes documented with solutions?
- [ ] **Information architecture:** Is information easy to find? Is the hierarchy logical?
- [ ] **Cross-references:** Do internal links work? Are related topics connected?
- [ ] **Changelog accuracy:** Does CHANGELOG.md reflect all actual changes since last release?
- [ ] **Plugin manifest:** Do version, description, and component counts match reality?
- [ ] **Missing docs:** Are there features or concepts that need documentation but don't have it?
- [ ] **Comparison to competitors:** How does hatch3r's documentation compare to GSD, AgentSys, etc.?
- [ ] **CLI UX:** Interactive prompts (inquirer) — are questions clear, defaults sensible, flow logical? Progress feedback (ora) — is it informative without being noisy? Output formatting (boxen, chalk) — is it readable and accessible? Error messages — are they actionable with clear next steps?
- [ ] **First-run experience:** Time from `npx hatch3r init` to working agentic setup. Number of decisions the user must make. Quality of defaults for users who just press Enter through everything
- [ ] **In-IDE experience:** Once installed, how intuitive is it to discover and use agents, commands, and skills within each supported tool?

**Web research:** Documentation best practices for CLI tools, competitor documentation quality (GSD's docs site, AgentSys README), npm package documentation standards. CLI UX best practices (ink, oclif patterns), developer experience benchmarks.

---

### Domain 7: Production Readiness

**Scope:** Is this framework ready for public release as an npm package and open-source project?

**Audit checklist:**

#### 7A: Package Quality
- [ ] `package.json` — `name`, `version`, `description`, `keywords`, `engines`, `bin`, `files`, `repository`, `homepage`, `bugs` all correct
- [ ] `files` array — only intended files are published (no test fixtures, no internal docs)
- [ ] `bin` entry — `hatch3r` CLI entry point works after `npm install -g`
- [ ] `engines` — `>=18.0.0` but README says 22+; reconcile
- [ ] `prepublishOnly` — build runs before publish
- [ ] License — MIT license file exists and is correct
- [ ] `.npmignore` or `files` — no sensitive files leak into published package

#### 7B: Robustness
- [ ] Error handling — CLI gracefully handles: missing Node.js version, no git repo, no internet, permission denied, corrupt `hatch.json`, missing `.agents/` directory
- [ ] Cross-platform — works on macOS, Linux, Windows (path separators, shell commands, line endings)
- [ ] Node.js compatibility — works on Node 18, 20, 22, 23+ (CI matrix tests this?)
- [ ] Idempotency — running `init` twice doesn't corrupt state; `sync` is repeatable
- [ ] Concurrent safety — multiple hatch3r processes in the same repo don't corrupt files

#### 7C: Security
- [ ] No secrets in published package
- [ ] Input validation — CLI arguments, `hatch.json` content, file paths
- [ ] Path traversal — adapter output can't write outside project root
- [ ] Dependency audit — `npm audit` clean, minimal attack surface
- [ ] Supply chain — lockfile integrity, no unnecessary dependencies
- [ ] `.gitignore` — sensitive files (`hatch3r-prd.md`, `COMPETITIVE-ANALYSIS.md`, `todo.md`, `.env.*`) correctly excluded
- [ ] Package provenance — npm provenance and OIDC signing configured for verifiable publish origin
- [ ] Lifecycle script safety — no `postinstall` or other lifecycle scripts that execute arbitrary code (post Shai-Hulud attack vector)
- [ ] `npm pack` dry-run — verify published artifact contains exactly the intended files, nothing more
- [ ] 2FA enforcement — npm account requires two-factor authentication for publish

#### 7D: Release Process
- [ ] Semantic versioning adherence
- [ ] Release workflow (`.github/workflows/release.yml`) — automated, correct triggers
- [ ] CHANGELOG.md — maintained, follows Keep a Changelog format
- [ ] Git tags — aligned with npm versions
- [ ] GitHub releases — created automatically with notes

#### 7E: Community Readiness
- [ ] `CONTRIBUTING.md` — clear contribution guide
- [ ] Issue templates — `.github/ISSUE_TEMPLATE/` useful and complete
- [ ] PR template — `.github/PULL_REQUEST_TEMPLATE.md` guides quality contributions
- [ ] Code of Conduct — present and appropriate
- [ ] Dependabot — `.github/dependabot.yml` configured

**Web research:** npm package best practices (2025-2026), open-source project readiness checklists, Node.js LTS schedule, security advisories for dependencies.

---

### Domain 8: PRD and Roadmap Alignment

**Scope:** Strategic alignment between product vision, roadmap, and current implementation.

**Files to check:**
- `hatch3r-prd.md` (gitignored — ask user if available)
- `COMPETITIVE-ANALYSIS.md` (gitignored — ask user if available)
- `todo.md` (gitignored — current roadmap)

**Audit checklist:**
- [ ] PRD vs implementation: what is specified but not built? What is built but not specified?
- [ ] `todo.md` priority assessment: are P4/P6 items correctly prioritized given current market?
- [ ] Roadmap items that should be reprioritized based on competitive landscape findings from Domain 4
- [ ] Missing roadmap items revealed by the audit
- [ ] Distribution strategy: docs site, Claude Code marketplace, Cursor marketplace, landing page — prioritization based on market data
- [ ] Long-term strategic items (benchmark suite, enterprise features, monorepo support) — still relevant? Priority shift needed?
- [ ] Technical debt: are there architectural decisions that should be revisited?

**Web research:** AI coding tools market trajectory, enterprise adoption patterns, marketplace distribution data (Cursor marketplace stats, Claude Code plugin ecosystem).

---

### Domain 9: Agentic Security & Trust Model

**Scope:** The security of the agentic system itself — not the security guidance hatch3r teaches to end-user projects (covered in Domain 3), but whether hatch3r's own architecture is resilient against agentic attack vectors.

This is a distinct concern from Domain 1 (source code security) and Domain 7 (production security). hatch3r generates instructions that guide AI agents with broad code-writing capabilities. The trust model of that system requires dedicated scrutiny.

**Audit checklist:**

#### 9A: Prompt Injection & Instruction Integrity
- [ ] **Managed block injection** — Can malicious content injected outside `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` blocks influence agent behavior in ways that bypass hatch3r's intended instructions?
- [ ] **Customization override abuse** — Can `.hatch3r/{agents,commands,skills,rules}/{id}.customize.yaml` files override safety-critical agent behaviors (e.g., disabling security checks, bypassing the review loop)?
- [ ] **Skill injection** — Can a malicious skill in `/.agents/skills/` escalate privileges, exfiltrate data, or override the orchestration pipeline?
- [ ] **Agent instruction tampering** — If an agent's `.md` file is modified (e.g., by a compromised dependency or malicious PR), what is the blast radius? Are there integrity checks?
- [ ] **MCP server trust** — Can a malicious MCP server registered in `mcp.json` compromise the agent pipeline? Are MCP server capabilities scoped appropriately?

#### 9B: Trust Boundaries Between Agents
- [ ] **Agent isolation** — Do sub-agents (implementer, reviewer, fixer, etc.) operate within well-defined capability boundaries? Can the implementer bypass the reviewer?
- [ ] **Context propagation safety** — When rules and learnings are propagated to sub-agent prompts, is there filtering to prevent instruction injection via those channels?
- [ ] **Review loop integrity** — Can the fixer mark its own output as clean without the reviewer actually re-reviewing? Is the max-3-iteration limit enforceable or just advisory?
- [ ] **Escalation paths** — When max review iterations are reached with remaining findings, is the escalation to the user reliable? Can it be suppressed?

#### 9C: OWASP Top 10 for Agentic Applications 2026 (Self-Assessment)

Apply every category from the official OWASP Top 10 for Agentic Applications (ASI01-ASI10) to hatch3r's own agentic architecture:

- [ ] **ASI01: Agent Goal Hijack** — Can hatch3r agent objectives be altered through malicious content in project files, user prompts, or poisoned learnings? Can the orchestration pipeline be redirected?
- [ ] **ASI02: Tool Misuse & Exploitation** — Can agents misuse tools they have access to (file writes, git commands, GitHub API, MCP servers) through parameter pollution or tool chain manipulation? Are permissions minimized?
- [ ] **ASI03: Identity & Privilege Abuse** — Do agents inherit the user's full system credentials? Can a sub-agent escalate privileges beyond what its role requires (e.g., implementer gaining reviewer-level trust)?
- [ ] **ASI04: Agentic Supply Chain Vulnerabilities** — Are external components (MCP servers, npm dependencies, community packs, model APIs) validated? Could a compromised Context7 or Playwright MCP server poison the pipeline?
- [ ] **ASI05: Unexpected Code Execution (RCE)** — Can agents be tricked into generating or executing malicious code? Does the implementer agent have RCE safeguards when writing code to the user's project?
- [ ] **ASI06: Memory & Context Poisoning** — Can the `/.agents/learnings/` system be poisoned to manipulate future agent behavior? Can corrupted context from one session persist and affect subsequent sessions?
- [ ] **ASI07: Insecure Inter-Agent Communication** — Are handoffs between agents (researcher→implementer, reviewer→fixer) validated? Can a compromised agent inject instructions into the next agent's prompt via its output?
- [ ] **ASI08: Cascading Failures** — If one agent in the pipeline fails (e.g., reviewer crashes), does the entire workflow fail gracefully or does it cascade? Are there circuit breakers or fallback behaviors?
- [ ] **ASI09: Human-Agent Trust Exploitation** — Does the framework create false confidence in agent output? Are users warned when agents are uncertain? Is the "0 Critical + 0 Warning" review gate trustworthy or can it be gamed?
- [ ] **ASI10: Rogue Agents** — Can an agent exhibit behavioral drift over long sessions? Can a sub-agent deviate from its defined role (e.g., implementer starting to review its own code)? Are there behavioral guardrails beyond prompt instructions?

#### 9D: Supply Chain of Agent Definitions
- [ ] **Update integrity** — When `hatch3r update` pulls new agent/skill/rule content from npm, is the content integrity verified? Could a compromised npm publish inject malicious agent instructions?
- [ ] **Pack system security** — The planned `hatch3r add [pack]` feature will install community-authored content. What is the trust model for community packs? Is there sandboxing, review, or signing?
- [ ] **Version pinning** — Can users pin to a specific version of agent content to avoid unexpected behavioral changes?

**Web research:** OWASP Top 10 for Agentic Applications 2026 (ASI01-ASI10) — read the full specification at genai.owasp.org. Cross-reference with OWASP Top 10 for LLM Applications. Research prompt injection in multi-agent systems, agentic AI security frameworks, supply chain attacks on AI agent definitions.

---

## Output Format

The final audit report MUST follow this structure:

### 1. Audit Metadata

```
Audit Date: YYYY-MM-DD
Framework Version: (from package.json)
Previous Audit: (date or "N/A")
Auditor: (model name and version)
Domains Covered: 9/9
```

### 2. Executive Summary

3-5 paragraph overview covering:
- Overall framework health (score out of 100)
- Top 3 strengths
- Top 3 critical issues requiring immediate attention
- Competitive positioning verdict (1 sentence)
- Distribution recommendation (open-source, private npm, or both) with rationale

### 3. Per-Domain Findings

For each of the 9 domains, provide:

#### Domain N: [Name]

**Health Score:** X/100

**Findings:**

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| 1 | Critical | ... | ... | ... | S/M/L/XL |
| 2 | High | ... | ... | ... | S/M/L/XL |
| ... | ... | ... | ... | ... | ... |

Severity levels:
- **Critical** — Blocks production release or creates security/correctness risk
- **High** — Significantly impacts quality, UX, or market competitiveness
- **Medium** — Improvement opportunity with clear benefit
- **Low** — Nice-to-have, polish item

Effort levels:
- **S** — < 2 hours
- **M** — 2-8 hours
- **L** — 1-3 days
- **XL** — 1+ weeks

### 4. Competitive Positioning Matrix

```
| Capability               | hatch3r | Competitor A | Competitor B | ... |
|--------------------------|---------|-------------|-------------|-----|
| Multi-tool support       | ...     | ...         | ...         | ... |
| Agent count              | ...     | ...         | ...         | ... |
| Board management         | ...     | ...         | ...         | ... |
| ...                      | ...     | ...         | ...         | ... |
```

### 5. Prioritized Action Items

Ordered by: Critical severity first, then impact-to-effort ratio.

```
| Priority | Domain | Action Item | Severity | Effort | Rationale |
|----------|--------|-------------|----------|--------|-----------|
| 1        | ...    | ...         | Critical | S      | ...       |
| 2        | ...    | ...         | Critical | M      | ...       |
| ...      | ...    | ...         | ...      | ...    | ...       |
```

### 6. Delta Since Previous Audit

(If a previous audit exists)
- New findings
- Resolved findings
- Regressed findings
- Score changes per domain

### 7. Next Version Release Plan

Concrete plan for what must be achieved before the next production release:

```
Target Version: X.Y.Z
Release Type: (major / minor / patch)

Blockers (must resolve before release):
| # | Domain | Item | Severity | Effort | Owner |
|---|--------|------|----------|--------|-------|
| 1 | ...    | ...  | Critical | S      | ...   |

Should-Have (strongly recommended for this release):
| # | Domain | Item | Severity | Effort | Owner |
|---|--------|------|----------|--------|-------|
| 1 | ...    | ...  | High     | M      | ...   |

Deferred (acceptable to postpone):
| # | Domain | Item | Severity | Effort | Rationale for Deferral |
|---|--------|------|----------|--------|------------------------|
| 1 | ...    | ...  | Medium   | L      | ...                    |
```

Include:
- Estimated total effort for the release
- Recommended release sequence (what to tackle first based on dependencies)
- Risk assessment: what could delay the release
- Acceptance criteria: how to verify the release is ready

### 8. Distribution Verdict

Detailed recommendation on:
- Open-source vs private npm package (or both)
- Marketplace strategy (Cursor, Claude Code, SkillKit)
- Timing recommendation (ready now, or what needs to happen first)
- Licensing considerations

---

## Audit History

Record completed audits here for delta tracking:

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| — | — | — | — | — |
