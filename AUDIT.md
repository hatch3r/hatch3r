# hatch3r — Full Framework Audit Prompt

> **Reusable prompt for agentic AI to perform comprehensive, recurring audits of the hatch3r framework.**
> Invoke by reading this file and executing the instructions below.

---

## Purpose

Perform a deep, end-to-end audit of every area, aspect, and line of code or content in the hatch3r framework. The goal is to ensure this framework is production-ready, open-sourceable, and excels in every capability compared to the current market — enabling end users to build winning software products at scale.

This audit covers **18 domains** organized across **4 tiers**, deploying **98 sub-agents** for maximum depth. Every domain requires web research for current market context. The final deliverable is a structured audit report with severity-tagged findings, weighted domain scores, and prioritized action items using 3-tier progressive disclosure.

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

| Category | Directory | Count |
|----------|-----------|-------|
| Agents | `agents/` | 16 |
| Rules | `rules/` | 22 .md + 22 .mdc = 44 files |
| Commands | `commands/` | 34 |
| Skills | `skills/` | 25 directories |
| Hooks | `hooks/` | 6 |
| Prompts | `prompts/` | 3 |
| Checks | `checks/` | 5 |
| GitHub Agents | `github-agents/` | 4 |
| **Total Content Artifacts** | | **137** |
| Adapters | `src/adapters/` | 13 tool adapters (19 files total) |
| CLI Commands | `src/cli/commands/` | 8 (add, config, init, status, sync, update, validate, verify) |
| Content System | `src/content/` | 3 files (index.ts 587 LOC, tags.ts 91 LOC, presets.ts 48 LOC) = 726 LOC |
| Integrity | `src/integrity/` | 1 file |
| Archive | `src/archive/` | 1 file (index.ts, 217 LOC) |
| TypeScript Source | `src/` | 50 files (excluding tests) |
| Test Files | `src/__tests__/` | 39 test files |
| CI Workflows | `.github/workflows/` | 5 workflows |
| Website Docs | `website/docs/` | 23 files |

### Orchestration Model

All tasks follow a four-phase sub-agent pipeline (defined in `src/cli/shared/agentsContent.ts`):
1. **Research** — `hatch3r-researcher` gathers context
2. **Implement** — `hatch3r-implementer` makes changes (one per task)
3. **Review Loop** — `hatch3r-reviewer` then `hatch3r-fixer` (max 3 iterations)
4. **Final Quality** — `hatch3r-test-writer`, `hatch3r-security-auditor`, `hatch3r-docs-writer`, plus conditional specialists

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | npm package (MIT, Node >=18) |
| `README.md` | Public documentation |
| `CHANGELOG.md` | Release history |
| `todo.md` | Roadmap (gitignored) |
| `docs/adapter-capability-matrix.md` | Per-adapter capability tracking |
| `docs/model-selection.md` | Model configuration docs |
| `docs/mcp-setup.md` | MCP setup guide |
| `docs/troubleshooting.md` | Common issues |
| `docs/agent-teams.md` | Claude Code Agent Teams integration |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `.github/workflows/` | CI (ci.yml, pr-checks.yml, release.yml, deploy-docs.yml, docs-pr-preview.yml) |

---

## Execution Model

### Sub-Agent Strategy

Spawn **98 sub-agents** across 18 audit domains organized in 4 tiers. Each domain decomposes into multiple focused sub-agents for maximum depth. Sub-agents within the same domain run in parallel unless a sequential dependency is noted. Domain-level synthesis sub-agents run only after their prerequisite sub-agents complete. Inherit your LLM model to every sub-agent — do not downgrade. Each sub-agent MUST use web research. **Never optimize for token efficiency — optimize for audit quality and depth.**

### Dependency Graph

The following sub-agents have sequential dependencies and MUST NOT launch until their prerequisites complete:

| Sub-Agent | Depends On | Reason |
|-----------|-----------|--------|
| 9.14 (Capability Matrix Verification) | 9.1–9.13 | Requires all per-adapter audit findings |
| 9.15 (Emerging Platforms) | 9.1–9.13 | Requires understanding of current adapter landscape |
| 16.1 (One-Shot Success Analysis) | D5, D7 | Requires prompt quality and orchestration findings |
| 16.2 (Content Coverage Gap Analysis) | D5, D9 | Requires content and adapter findings |
| 16.3 (Prompt Consistency) | D5, D7 | Requires cross-artifact analysis |
| 16.4 (Regression & Maintenance) | D3, D4 | Requires test and CI findings |
| 17.3 (Market Positioning & Strategy) | 17.1, 17.2 | Requires competitor and ecosystem data |
| 18.1 (PRD Alignment) | D16, D17 | Requires compound system and competitive findings |
| 18.2 (Roadmap Reprioritization) | D16, D17 | Requires compound system and competitive findings |
| 18.3 (Distribution Verdict) | 18.1, 18.2 | Requires PRD and roadmap analysis |

### Concurrency Model

Of the 98 total sub-agents, **88 launch immediately** in parallel (respecting platform concurrency limits). The remaining **10 sub-agents** launch sequentially after their dependencies complete:

| Tier | Sequential Sub-Agents |
|------|----------------------|
| B | 9.14, 9.15 |
| C | 16.1, 16.2, 16.3, 16.4 |
| D | 17.3, 18.1, 18.2, 18.3 |

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

## Scoring Methodology

### Domain Weighting

Each domain receives a weight reflecting its impact on framework quality. Weights sum to 1.0.

| Tier | Domains | Weight Per Domain | Tier Total |
|------|---------|-------------------|------------|
| A — Foundational | D1–D4 | 0.08 | 0.32 |
| B — Quality | D5–D10 | 0.06 | 0.36 |
| C — System-Level | D11–D16 | 0.04 | 0.24 |
| D — Strategic | D17–D18 | 0.04 | 0.08 |
| **Total** | | | **1.00** |

### Weighted Score Formula

```
Overall Score = SUM(domain_score[i] * weight[i]) for i in 1..18
```

Each `domain_score[i]` is 0–100, assessed by the sub-agents within that domain. The overall score is therefore 0–100.

### Score Bands

| Score | Band | Meaning |
|-------|------|---------|
| 90–100 | Ship Ready | Production release with confidence |
| 80–89 | Minor Issues | Release acceptable, address findings post-release |
| 70–79 | Needs Work | Significant issues must be resolved before release |
| 60–69 | Significant Risk | Major rework required across multiple domains |
| < 60 | Not Ready | Fundamental issues prevent release |

### Severity Ceiling

Any domain with an unresolved **Critical** finding has its domain score capped at **50/100** regardless of the formula output. This prevents a domain from scoring well while harboring a critical deficiency. If any domain triggers this cap, the overall score band is also capped at **Needs Work**.

### Quality Score Formula

Within each domain, the score is calculated from finding severity counts:

```
domain_score = 100 - (critical * 25) - (high * 10) - (medium * 3) - (low * 1) - (info * 0)
```

Floor at 0. Ceiling at 100.

---

## Finding Severity Taxonomy

| Severity | Definition | Release Impact | Examples |
|----------|-----------|----------------|----------|
| **Critical** | Blocks production release or creates security/correctness risk | Must resolve before any release | Data loss, security vulnerability, silent corruption |
| **High** | Significantly impacts quality, UX, or market competitiveness | Should resolve before release; deferral requires justification | Missing adapter feature, incorrect pipeline behavior, UX blocker |
| **Medium** | Improvement opportunity with clear benefit | Can defer to next release with tracking | Suboptimal error messages, missing edge case handling, documentation gaps |
| **Low** | Nice-to-have, polish item | Defer freely | Code style, minor naming, cosmetic improvements |
| **Info** | Observation, suggestion, or context for future consideration | No release impact | Architecture notes, research findings, trend observations |

### Effort Levels

| Level | Duration | Description |
|-------|----------|-------------|
| **S** | < 2 hours | Quick fix, isolated change |
| **M** | 2–8 hours | Moderate change, limited scope |
| **L** | 1–3 days | Significant change, cross-cutting |
| **XL** | 1+ weeks | Major initiative, architectural |

---

## Deduplication Protocol

Multiple sub-agents may identify the same underlying issue from different perspectives. Apply the following deduplication protocol before finalizing findings.

### 3-Signal Dedup

A finding is a duplicate if it matches on **2 of 3** signals:

| Signal | Description |
|--------|-------------|
| **File** | Same file or module referenced |
| **Root Cause** | Same underlying technical issue |
| **Recommendation** | Same or substantially similar fix |

### Merge Strategy

When duplicates are detected:
1. **Keep the highest-severity instance** as the primary finding.
2. **Record all domain references** — note which domains identified the issue (e.g., "Also identified in D3, D7").
3. **Preserve unique perspectives** — if different domains add distinct analysis (e.g., D5 analyzes prompt quality while D15 analyzes security), preserve both perspectives as sub-points under the primary finding.
4. **Do not inflate finding counts** — deduplicated findings count as one finding in domain scoring.

---

## Quality Gates

### Expected Finding Counts

A thorough audit of a framework this size should produce findings in these ranges:

| Severity | Expected Range | Below Range Suggests | Above Range Suggests |
|----------|---------------|---------------------|---------------------|
| Critical | 0–5 | Genuine maturity OR shallow audit | Fundamental issues |
| High | 5–20 | Shallow audit OR exceptional quality | Significant quality gaps |
| Medium | 20–50 | Insufficient depth | Exhaustive analysis |
| Low | 15–40 | Insufficient granularity | Over-reporting |
| Info | 10–30 | Missing strategic context | Appropriate depth |
| **Total** | **50–145** | **Audit quality concern** | **Thorough audit** |

If total findings fall below 50, the orchestrating agent MUST re-examine whether sub-agents achieved sufficient depth before finalizing.

### Quality Checklist

Before finalizing the audit report, verify:

- [ ] All 18 domains have findings (no domain should be "clean" — there is always room for improvement)
- [ ] All 98 sub-agents produced output (no silent failures)
- [ ] Every Critical and High finding has a specific, actionable recommendation
- [ ] Every finding references specific files, line numbers, or artifacts where applicable
- [ ] Web research was performed for every domain (cite sources)
- [ ] Deduplication protocol was applied
- [ ] Finding counts fall within expected ranges

### Shallow Finding Detector

Flag any finding that matches these patterns as potentially shallow and require the sub-agent to deepen:

| Pattern | Example | Required Depth |
|---------|---------|----------------|
| Generic recommendation | "Improve error handling" | Specify which function, what error case, what the improved handling looks like |
| No file reference | "The CLI could be better" | Identify specific files, functions, and line numbers |
| No web research citation | "Industry best practice suggests..." | Cite the specific standard, paper, or documentation |
| Tautological finding | "Tests should be more comprehensive" | Identify specific untested paths, branches, or scenarios |
| Copy of checklist item | Restating the checklist as a finding | Provide analysis specific to hatch3r's implementation |

### Web Research Verification

For each domain, verify that web research addressed:
- [ ] At least one current (within 6 months) source was cited
- [ ] Platform-specific documentation was checked for format changes
- [ ] Competitor capabilities were verified against current state, not cached knowledge
- [ ] Industry standards were referenced by version/date

---

## Audit Domains

---

### Tier A — Foundational

> **25 sub-agents, all parallel.** These domains cover the core implementation, adapter infrastructure, test suite, and build pipeline. They launch first and produce the foundation for all higher-tier analysis.

---

### Domain 1: Core Source Implementation (8 Sub-Agents)

**Scope:** All `src/` TypeScript except adapters and content system. Covers all 8 CLI commands, merge infrastructure, manifest/model/detect modules, environment/hooks/shared utilities, and the CLI entry point.

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Key Files |
|-----------|-------|-----------|
| 1.1 | CLI Command: init | `src/cli/commands/init.ts` |
| 1.2 | CLI Command: config | `src/cli/commands/config.ts` |
| 1.3 | CLI Commands: update, sync, add | `src/cli/commands/{update,sync,add}.ts` |
| 1.4 | CLI Commands: validate, verify, status | `src/cli/commands/{validate,verify,status}.ts` |
| 1.5 | Merge & Safe Write | `src/merge/{safeWrite,managedBlocks}.ts` |
| 1.6 | Manifest, Models & Detect | `src/manifest/`, `src/models/`, `src/detect/` |
| 1.7 | Env, Hooks & Shared | `src/env/`, `src/hooks/`, `src/cli/shared/` |
| 1.8 | CLI Entry & Types | `src/cli/index.ts`, `src/types.ts`, `src/version.ts` |

#### Per Sub-Agent Audit Checklist

**1.1 CLI Command: init**
- [ ] Init flow correctness — full lifecycle from invocation to completed installation
- [ ] Preset handling — default, minimal, full, custom presets produce correct output
- [ ] Selective init integration — content system interaction, tag filtering, preset application
- [ ] Idempotency — running init twice does not corrupt state or duplicate content
- [ ] Error handling for existing installations — graceful handling of partial, corrupt, or complete prior installs

**1.2 CLI Command: config**
- [ ] Config command correctness — reads and writes `hatch.json` accurately
- [ ] Adapter enable/disable — correctly toggles adapter state and regenerates output
- [ ] Validation — rejects invalid configuration values with clear error messages

**1.3 CLI Commands: update, sync, add**
- [ ] Update flow — npm version check, content delta computation, safe merge execution
- [ ] Sync correctness — regenerates adapter output from current canonical source without data loss
- [ ] Add command — pack installation flow, content injection, dependency resolution

**1.4 CLI Commands: validate, verify, status**
- [ ] Validate — schema validation, reference integrity checking, adapter output verification
- [ ] Verify — integrity manifest checking, tamper detection, drift reporting
- [ ] Status — display correctness, drift detection between canonical and adapter output

**1.5 Merge & Safe Write**
- [ ] Managed block integrity — `HATCH3R:BEGIN`/`HATCH3R:END` markers preserved correctly
- [ ] User content preservation — content outside managed blocks survives updates
- [ ] Safe write atomicity — writes complete fully or not at all
- [ ] Backup creation — backups created before destructive operations
- [ ] Rollback on failure — failed writes restore previous state
- [ ] Concurrent safety — multiple processes in the same repo do not corrupt files
- [ ] Force mode behavior — correctly overrides managed blocks when requested

**1.6 Manifest, Models & Detect**
- [ ] Manifest parsing and validation — `hatch.json` schema enforcement, edge cases
- [ ] Model resolution — `resolve.ts` correctly resolves model preferences per adapter
- [ ] Customization models — `customize.ts` correctly processes override files
- [ ] Repo analysis — detect module accurately identifies project characteristics

**1.7 Env, Hooks & Shared**
- [ ] MCP env generation — `.env.mcp` created correctly with all required variables
- [ ] Hook definition reading — all 6 hooks correctly parsed and available
- [ ] Adapter integration hooks — hook format transformation per adapter
- [ ] Shared utilities — `agentsContent.ts` pipeline content, `constants.ts` value correctness

**1.8 CLI Entry & Types**
- [ ] CLI entry point routing — commander setup, command registration, global flags
- [ ] Global error handling — uncaught exceptions, unhandled rejections, SIGINT
- [ ] Type definitions completeness — `src/types.ts` covers all domain types accurately
- [ ] Version management — `src/version.ts` reports correct version

#### Common Checklist for ALL 1.x Sub-Agents

- [ ] Code quality: naming conventions, complexity, dead code, DRY, SOLID
- [ ] Type safety: strict TypeScript, no `any` escape hatches, proper generics
- [ ] Error handling: graceful failures, user-facing error messages, edge cases
- [ ] Input validation and sanitization

**Web research:** Current TypeScript best practices, Node.js LTS compatibility, commander.js patterns, npm package security standards.

---

### Domain 2: Adapter Infrastructure (7 Sub-Agents)

**Scope:** All adapter support code — the base contract, canonical reader, customization pipeline, utilities, registry, content system, and integrity/archive systems. Does NOT cover per-adapter implementations (those are Domain 9).

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Key Files |
|-----------|-------|-----------|
| 2.1 | Base Adapter Contract | `src/adapters/base.ts` |
| 2.2 | Canonical Reader | `src/adapters/canonical.ts` |
| 2.3 | Customization Pipeline | `src/adapters/customization.ts` |
| 2.4 | MCP & TOML Utilities | `src/adapters/mcp-utils.ts`, `src/adapters/toml-utils.ts` |
| 2.5 | Adapter Index & Registry | `src/adapters/index.ts` |
| 2.6 | Content System | `src/content/index.ts` (587 LOC), `src/content/tags.ts` (91 LOC), `src/content/presets.ts` (48 LOC) |
| 2.7 | Integrity & Archive Systems | `src/integrity/index.ts`, `src/archive/index.ts` (217 LOC) |

#### Per Sub-Agent Audit Checklist

**2.1 Base Adapter Contract**
- [ ] Contract completeness — all required abstract methods defined
- [ ] Extensibility patterns — new adapters can be added without modifying base
- [ ] Capability declaration — adapters correctly declare supported features
- [ ] Hook support interface — base contract supports hook transformation

**2.2 Canonical Reader**
- [ ] Correctness for ALL content types — agents, rules, commands, skills, hooks, prompts, checks, mcp, policy, learnings
- [ ] File discovery — correctly finds all canonical files in `/.agents/`
- [ ] Frontmatter parsing — metadata extracted accurately from all file types
- [ ] Error handling for malformed content — graceful failures with actionable messages

**2.3 Customization Pipeline**
- [ ] Override system integrity — `.hatch3r/{agents,commands,skills,rules}/{id}.customize.yaml` processed correctly
- [ ] Deny pattern enforcement — safety-critical content cannot be overridden
- [ ] Merge correctness — customizations merge with canonical content without corruption
- [ ] Override precedence — when multiple overrides apply, precedence is well-defined and documented

**2.4 MCP & TOML Utilities**
- [ ] MCP config transformation correctness — `mcp.json` transformed per adapter format
- [ ] Per-adapter MCP format handling — each adapter receives its expected MCP schema
- [ ] TOML generation — codex adapter TOML output is valid and correct
- [ ] Utility robustness — edge cases, malformed input, missing fields

**2.5 Adapter Index & Registry**
- [ ] Registry completeness — all 13 adapters registered and discoverable
- [ ] Adapter discovery — dynamic lookup works correctly
- [ ] Enable/disable logic — toggling adapters in config takes effect
- [ ] Capability querying — callers can query adapter capabilities accurately

**2.6 Content System**
- [ ] Selective init flow correctness — tag-based filtering produces correct content subsets
- [ ] Tag system (`tags.ts`) — tags accurately describe content, no misclassifications
- [ ] Preset definitions (`presets.ts`) — presets map to correct tag combinations
- [ ] Content filtering — inclusion/exclusion logic handles edge cases
- [ ] Content resolution and deduplication — no duplicate or missing artifacts
- [ ] Integration with CLI init — content system correctly feeds into the init flow

**2.7 Integrity & Archive Systems**
- [ ] Integrity manifest generation — all managed files tracked with correct hashes
- [ ] Tamper detection — modified files detected accurately, no false positives/negatives
- [ ] Archive/backup creation and restoration — backups are complete and restorable
- [ ] Archive cleanup — old archives pruned to avoid disk bloat
- [ ] Integrity verification during update — updates verify integrity before modifying files

**Web research:** Adapter pattern best practices, content management system patterns, integrity verification approaches.

---

### Domain 3: Test Infrastructure (5 Sub-Agents)

**Scope:** All 39 test files across the test suite. Coverage analysis, test quality assessment, and testing infrastructure evaluation.

#### Test File Distribution

| Category | Files | Count |
|----------|-------|-------|
| Adapters | `src/__tests__/adapters/` | 17 |
| CLI | `src/__tests__/cli/` | 8 |
| Content | `src/__tests__/content/` | 2 |
| Models | `src/__tests__/models/` | 2 |
| Merge | `src/__tests__/merge/` | 2 |
| Hooks | `src/__tests__/hooks/` | 2 |
| Detect | `src/__tests__/detect/` | 1 |
| Env | `src/__tests__/env/` | 1 |
| Integrity | `src/__tests__/integrity/` | 1 |
| Manifest | `src/__tests__/manifest/` | 1 |
| Archive | `src/__tests__/archive/` | 1 |
| Fixtures | `src/__tests__/fixtures/` | 1 |
| **Total** | | **39** |

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Files |
|-----------|-------|-------|
| 3.1 | Adapter Tests | 17 test files in `src/__tests__/adapters/` |
| 3.2 | CLI Tests | 8 test files in `src/__tests__/cli/` |
| 3.3 | Content & Manifest Tests | `src/__tests__/content/{index,tags}.test.ts`, `src/__tests__/manifest/hatchJson.test.ts` |
| 3.4 | Integration Tests | `src/__tests__/{hooks,models,detect,env,integrity,archive,merge}/` (10 files) |
| 3.5 | Coverage Meta-Analysis | All 39 test files, coverage report, test infrastructure |

#### Per Sub-Agent Audit Checklist

**3.1 Adapter Tests**
- [ ] Each adapter test covers: output path correctness, format validation, feature flag behavior, MCP format, hook format, managed blocks
- [ ] Test isolation — no cross-test state leakage
- [ ] Mocking patterns — mocks are minimal and realistic
- [ ] Coverage of error paths — adapter failures are tested

**3.2 CLI Tests**
- [ ] Each CLI command test covers: happy path, error cases, edge cases (existing install, corrupt state, missing dependencies)
- [ ] Mock completeness — filesystem, network, and process mocks are accurate
- [ ] Interactive prompt testing — inquirer prompts are correctly simulated
- [ ] Exit code verification — correct exit codes for success and failure

**3.3 Content & Manifest Tests**
- [ ] Content index tests cover tag filtering, preset application, selective init scenarios
- [ ] Tag tests verify classification accuracy for all content types
- [ ] Manifest tests cover schema validation, parsing edge cases, malformed input

**3.4 Integration Tests**
- [ ] Hook integration tests — hook lifecycle, adapter-specific format transformation
- [ ] Model resolution/customization tests — override application, precedence
- [ ] Repo analyzer tests — detection accuracy across project types
- [ ] MCP env tests — environment variable generation correctness
- [ ] Integrity verification tests — tamper detection accuracy
- [ ] Archive tests — backup creation, restoration, cleanup
- [ ] Safe write/managed block tests — merge integrity, concurrent access

**3.5 Coverage Meta-Analysis**
- [ ] Run `npm test` and analyze overall coverage percentage
- [ ] Identify untested modules — source files with zero coverage
- [ ] Identify untested branches — conditional paths not exercised
- [ ] Test quality assessment — assertions per test, meaningful vs trivial tests
- [ ] Test determinism — no flaky tests, no order dependencies
- [ ] Fixture management — test data is organized and maintainable
- [ ] Missing test scenarios — identify gaps based on source code analysis

**Web research:** Vitest best practices, TypeScript testing patterns, coverage analysis methodology.

---

### Domain 4: Build, CI/CD & Dependencies (5 Sub-Agents)

**Scope:** Build tooling, dependency health, CI workflows, release pipeline, and community readiness for open-source distribution.

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Key Files |
|-----------|-------|-----------|
| 4.1 | Build Configuration | `tsup.config.ts`, `tsconfig.json`, `package.json` (build scripts) |
| 4.2 | Dependency Health | `package.json`, `package-lock.json`, `npm audit` |
| 4.3 | CI Workflows | `.github/workflows/` (5 workflows: `ci.yml`, `pr-checks.yml`, `release.yml`, `deploy-docs.yml`, `docs-pr-preview.yml`) |
| 4.4 | Release Pipeline & OIDC | `.github/workflows/release.yml`, npm provenance, OIDC signing |
| 4.5 | Community & OSS Readiness | `CONTRIBUTING.md`, issue templates, PR template, CoC, dependabot, license |

#### Per Sub-Agent Audit Checklist

**4.1 Build Configuration**
- [ ] tsup config correctness — entry points, output paths, format options
- [ ] Output format — ESM/CJS dual output, correct module resolution
- [ ] Tree-shaking — unused code eliminated from output
- [ ] Sourcemaps — generated and correctly mapped
- [ ] Bundle size analysis — compare against budget, identify bloat
- [ ] tsconfig strictness — strict mode enabled, no permissive overrides

**4.2 Dependency Health**
- [ ] `npm audit` clean — zero known vulnerabilities
- [ ] Outdated packages — all dependencies on current or LTS versions
- [ ] CVE exposure — no dependencies with unpatched CVEs
- [ ] Minimal dependency surface — no unnecessary dependencies
- [ ] Lockfile integrity — `package-lock.json` is consistent and committed
- [ ] Unnecessary dependencies — identify and recommend removal

**4.3 CI Workflows**
- [ ] All 5 workflows: completeness, correctness, trigger configuration
- [ ] Security — no secret leaks, pinned action versions (SHA, not tags)
- [ ] Matrix testing — Node versions (18, 20, 22), OS (ubuntu, macos, windows)
- [ ] Caching — dependency caching configured for performance
- [ ] Workflow triggers — correct event triggers, no unnecessary runs

**4.4 Release Pipeline & OIDC**
- [ ] Release workflow integrity — correct trigger, build, publish sequence
- [ ] npm provenance — provenance attestation enabled for verifiable publish origin
- [ ] OIDC trusted publishing — GitHub Actions OIDC token exchange configured
- [ ] Semver adherence — version bumps follow semantic versioning rules
- [ ] Git tag alignment — npm version matches git tag
- [ ] GitHub release creation — release notes generated automatically
- [ ] Lifecycle script safety — no `postinstall` or other lifecycle scripts that execute arbitrary code
- [ ] 2FA enforcement — npm account requires two-factor authentication for publish

**4.5 Community & OSS Readiness**
- [ ] CONTRIBUTING.md quality — clear, complete contribution guide
- [ ] Issue templates — `.github/ISSUE_TEMPLATE/` useful and actionable
- [ ] PR template — guides quality contributions
- [ ] Code of Conduct — present and appropriate
- [ ] Dependabot — `.github/dependabot.yml` configured for automated dependency updates
- [ ] LICENSE file — MIT license correct and present
- [ ] `.gitignore` completeness — sensitive files excluded, no unnecessary entries

**Web research:** npm package security standards 2025-2026, GitHub Actions security best practices, Node.js LTS schedule, open-source project readiness checklists.

---

### Tier B — Quality

> **41 sub-agents, 39 parallel + 2 sequential.** These domains evaluate the quality of content artifacts, context engineering, orchestration design, resilience, platform adapter implementations, and developer experience.

---

### Domain 5: Prompt Engineering Quality (7 Sub-Agents)

**Scope:** ALL 137 content artifacts evaluated for prompt engineering quality, instruction clarity, and LLM execution reliability.

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Artifact Count |
|-----------|-------|---------------|
| 5.1 | Pipeline Agents | 4 agents: researcher, implementer, reviewer, fixer |
| 5.2 | Specialist Agents | 8 agents: a11y-auditor, architect, ci-watcher, context-rules, dep-auditor, devops, docs-writer, lint-fixer |
| 5.3 | Meta Agents | 4 agents: perf-profiler, security-auditor, test-writer, learnings-loader |
| 5.4 | Rules | 22 .md + 22 .mdc = 44 files |
| 5.5 | Commands | 34 command files |
| 5.6 | Skills | 25 skill directories (SKILL.md each) |
| 5.7 | Supporting Artifacts | 5 checks + 6 hooks + 3 prompts + 4 github-agents = 18 files |

#### Universal Checklist (apply to ALL sub-agents)

- [ ] **One-shot success prediction** — Would an LLM execute this artifact correctly on the first attempt without clarification? Rate 1-5.
- [ ] **Instruction clarity scoring** — Are instructions unambiguous, sequenced logically, and free of contradictions? Rate 1-5.
- [ ] **Output format specification** — Is the expected output format explicitly defined, structured, and parseable?
- [ ] **Scope boundaries** — Clear what the artifact does and does NOT do? Are there implicit assumptions?
- [ ] **Cross-agent handoff contract analysis** — For pipeline agents: are handoff contracts between phases (researcher to implementer, reviewer to fixer) explicitly defined with data schemas?
- [ ] **Golden test case methodology** — Could you write a deterministic test case to verify this artifact produces correct output? If not, why?
- [ ] **Prompt drift detection** — Are there version markers or checksums to detect when artifact content has drifted from intended behavior?
- [ ] **Token efficiency** — Is the artifact optimally sized? Could it be shorter without losing effectiveness? (Reference: AGENTS.md best practices: 6-10 rules, <150 lines)
- [ ] **Hallucination prevention** — Does the artifact include grounding mechanisms (file references, schema constraints, verification steps)?
- [ ] **State-of-the-art alignment** — Compare against latest research on effective LLM instruction formats

#### Additional Per Sub-Agent Checklist

**5.1 Pipeline Agents**
- [ ] Phase sequencing correctness — research, implement, review, final quality in correct order
- [ ] Context propagation between phases — critical information flows forward without loss
- [ ] Review loop termination conditions — clear criteria for when to stop iterating
- [ ] Phase 4 specialist dispatch logic — which specialists are invoked and when

**5.2 Specialist Agents**
- [ ] Domain expertise depth — does each specialist demonstrate deep knowledge?
- [ ] Tool usage instructions — are MCP tools, file operations, and external tools correctly referenced?
- [ ] Output actionability — can a user act on the specialist's output without interpretation?
- [ ] Integration with review loop — specialist findings feed back correctly into fixer

**5.3 Meta Agents**
- [ ] Cross-cutting concern coverage — do meta agents address concerns that span multiple domains?
- [ ] Learning system effectiveness — does the learnings-loader actually improve future agent behavior?
- [ ] Security coverage breadth — does the security-auditor cover the full attack surface?

**5.4 Rules**
- [ ] Technical accuracy — do recommendations reflect current best practices?
- [ ] .md/.mdc parity — canonical .md and Cursor .mdc versions are in sync
- [ ] Scope metadata correctness — `alwaysApply`, `globs`, `description` correctly set
- [ ] OWASP coverage — security rules cover OWASP Top 10 and OWASP Agentic Top 10
- [ ] Performance budget specificity — measurable thresholds, not vague guidance

**5.5 Commands**
- [ ] Workflow completeness — edge cases, error paths, alternative flows handled
- [ ] Platform feature integration — commands leverage platform capabilities (GitHub API, git, etc.)
- [ ] UX quality — intuitive naming, helpful output, clear error messages

**5.6 Skills**
- [ ] Step-by-step correctness — each step is executable and produces expected results
- [ ] Input/output contracts — what the skill expects and what it produces is explicit
- [ ] Guardrails — skill prevents common mistakes and dangerous operations
- [ ] Verification steps — skill includes self-check mechanisms
- [ ] Real-world applicability — skill addresses actual production scenarios

**5.7 Supporting Artifacts**
- [ ] Check criteria completeness — all 5 checks cover their domain thoroughly
- [ ] Hook trigger accuracy — all 6 hooks fire on correct events
- [ ] Prompt output quality — all 3 prompts produce useful, structured output
- [ ] GitHub Actions integration quality — all 4 github-agents work correctly in CI

**Web research:** Latest prompt engineering research, AGENTS.md spec best practices, instruction-following benchmarks, structured output techniques, multi-agent prompt patterns.

---

### Domain 6: Context Engineering & Token Economics (4 Sub-Agents)

**Scope:** How the framework manages context windows, instruction density, and token costs across the agent pipeline.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 6.1 | Context Window Utilization |
| 6.2 | Instruction Density & Redundancy |
| 6.3 | Cost Modeling |
| 6.4 | Memory Safety & Context Poisoning |

#### Per Sub-Agent Audit Checklist

**6.1 Context Window Utilization**
- [ ] BRIDGE_ORCHESTRATION content token measurement — how many tokens does the full bridge content consume?
- [ ] Inline rules token cost per adapter — measure token overhead of inlined rules
- [ ] Per-phase context window consumption analysis — how much of the context window does each pipeline phase consume?
- [ ] Context window overflow scenarios — what happens when content exceeds the window?
- [ ] Caching opportunities — which content is static vs dynamic, and can static content be cached?

**6.2 Instruction Density & Redundancy**
- [ ] Instruction redundancy across agents — are the same instructions repeated in multiple agents?
- [ ] Information density scoring — ratio of actionable instructions to boilerplate
- [ ] Compression opportunities — can instructions be shortened without losing effectiveness?
- [ ] Rule consolidation potential — can overlapping rules be merged?

**6.3 Cost Modeling**
- [ ] Per-task estimated token cost — research + implement + review + final quality total
- [ ] Cost scaling with project size — how does token cost grow with repository size?
- [ ] Cost comparison with competitors — how does hatch3r's token overhead compare?
- [ ] Optimization opportunities — identify the highest-cost areas with room for reduction

**6.4 Memory Safety & Context Poisoning**
- [ ] Learnings poisoning prevention — can `/.agents/learnings/` be weaponized to manipulate future agent behavior?
- [ ] Context injection via user-controlled files — can project files inject instructions into agent context?
- [ ] Session isolation — does corrupted context from one session persist and affect subsequent sessions?
- [ ] Memory safety boundaries — are there limits on what learnings can contain?

**Web research:** Anthropic's context engineering best practices, token optimization research, context window management patterns, AI agent cost benchmarking.

---

### Domain 7: Agent Orchestration Optimization (5 Sub-Agents)

**Scope:** The four-phase pipeline architecture and its optimization for maximum task success rate.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 7.1 | Pipeline Design |
| 7.2 | Review Loop Calibration |
| 7.3 | Phase 4 Dispatch |
| 7.4 | Dynamic Adaptation |
| 7.5 | Multi-Task Orchestration |

#### Per Sub-Agent Audit Checklist

**7.1 Pipeline Design**
- [ ] Is the four-phase pipeline optimally ordered? Should research and implementation be more tightly coupled?
- [ ] Pipeline linearity vs DAG assessment — are there phases that could run in parallel?
- [ ] Phase skipping heuristics — should the pipeline skip research for trivial tasks?
- [ ] Phase handoff contracts — are data formats between phases well-defined?

**7.2 Review Loop Calibration**
- [ ] Review loop convergence analysis — does the reviewer-fixer loop converge in practice?
- [ ] Max 3 iterations — is this calibrated from data or arbitrary?
- [ ] Typical convergence pattern — findings resolved per iteration
- [ ] Loop escape conditions — when to stop even with remaining findings

**7.3 Phase 4 Dispatch**
- [ ] Resource contention — how many Phase 4 agents run simultaneously?
- [ ] Dispatch logic for conditional specialists — when is a11y-auditor invoked vs skipped?
- [ ] Phase 4 completion criteria — what defines "done" for final quality?
- [ ] Specialist output integration — how are specialist findings consolidated?

**7.4 Dynamic Adaptation**
- [ ] Dynamic phase skipping heuristics — can the pipeline skip phases based on task type?
- [ ] Context degradation across phases — how much useful context is lost between research and final quality?
- [ ] Non-determinism handling — does the pipeline account for LLM sampling variance?
- [ ] Adaptive complexity — does the pipeline scale effort to task difficulty?

**7.5 Multi-Task Orchestration**
- [ ] Simultaneous task handling — how does the pipeline handle multiple concurrent tasks?
- [ ] Resource contention between concurrent pipelines
- [ ] Task priority and scheduling
- [ ] Cross-task context sharing — can insights from one task benefit another?

**Web research:** Multi-agent orchestration patterns (Stripe's one-shot Minions architecture), review loop calibration research, pipeline optimization, agentic system design patterns.

---

### Domain 8: Error Recovery & Resilience (4 Sub-Agents)

**Scope:** How the framework handles failures across CLI, filesystem, and pipeline layers.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 8.1 | CLI Error Handling |
| 8.2 | Filesystem Resilience |
| 8.3 | Pipeline Failure Modes |
| 8.4 | Self-Healing Patterns |

#### Per Sub-Agent Audit Checklist

**8.1 CLI Error Handling**
- [ ] CLI graceful failure for: missing Node.js version, no git repo, no internet, permission denied, corrupt `hatch.json`, missing `/.agents/` directory, invalid arguments, interrupted operations
- [ ] Error message quality — are error messages actionable with clear next steps?
- [ ] Exit codes — correct exit codes for different failure modes
- [ ] Recovery guidance — does the CLI tell the user how to fix the problem?

**8.2 Filesystem Resilience**
- [ ] File write failures — disk full, permissions, read-only filesystem
- [ ] Concurrent access safety — multiple processes do not corrupt shared files
- [ ] Atomic write guarantees — partial writes do not leave corrupt state
- [ ] Backup integrity — backups are valid and restorable
- [ ] Rollback reliability — failed operations restore previous state
- [ ] Symlink handling — symlinks do not cause infinite loops or path traversal
- [ ] Cross-platform path safety — Windows, macOS, Linux path differences

**8.3 Pipeline Failure Modes**
- [ ] What happens when: researcher agent fails? Implementer crashes mid-change? Reviewer times out? MCP server unreachable? Phase 4 agent fails?
- [ ] Graceful degradation vs total failure — does partial completion produce usable results?
- [ ] Partial result preservation — are completed phases preserved when a later phase fails?
- [ ] Timeout enforcement — is there a maximum execution time per agent?

**8.4 Self-Healing Patterns**
Audit against the 7 resilience patterns:
- [ ] **(1) Retry with backoff** — does the pipeline retry transient failures?
- [ ] **(2) Circuit breaker** — does the pipeline stop trying after repeated failures?
- [ ] **(3) Watchdog** — is there timeout enforcement per agent?
- [ ] **(4) Degradation chain** — does the pipeline produce partial results when full execution fails?
- [ ] **(5) Output validation** — are agent outputs validated before being used by the next phase?
- [ ] **(6) Dead man's switch** — is there a maximum total execution time?
- [ ] **(7) Audit trail** — are failures logged for debugging?

**Web research:** Agentic system resilience patterns, error recovery in multi-agent systems, circuit breaker patterns for AI pipelines.

---

### Domain 9: Platform Adapters (15 Sub-Agents)

**Scope:** All 13 adapters and the capability matrix. One sub-agent per adapter for maximum depth.

Sub-agents 9.14 and 9.15 are **sequential** — they run only after 9.1-9.13 complete.

**Reference:** `docs/adapter-capability-matrix.md` (last verified: check date in file)

#### Sub-Agent Decomposition

| Sub-Agent | Adapter | Source | Output Format |
|-----------|---------|--------|---------------|
| 9.1 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) |
| 9.2 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) |
| 9.3 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` |
| 9.4 | Cline | `src/adapters/cline.ts` | `.roo/`, `.roomodes`, `.cline/` |
| 9.5 | Codex | `src/adapters/codex.ts` | `.codex/config.toml`, AGENTS.md bridge |
| 9.6 | Gemini | `src/adapters/gemini.ts` | `GEMINI.md`, `.gemini/` |
| 9.7 | Windsurf | `src/adapters/windsurf.ts` | `.windsurfrules`, `.windsurf/` |
| 9.8 | Amp | `src/adapters/amp.ts` | `.amp/AGENTS.md`, `.amp/` |
| 9.9 | OpenCode | `src/adapters/opencode.ts` | `opencode.json`, `.opencode/` |
| 9.10 | Aider | `src/adapters/aider.ts` | `CONVENTIONS.md`, `.aider/` |
| 9.11 | Kiro | `src/adapters/kiro.ts` | `.kiro/steering/`, `.kiro/settings/` |
| 9.12 | Goose | `src/adapters/goose.ts` | `.goosehints` |
| 9.13 | Zed | `src/adapters/zed.ts` | `.rules` |
| 9.14 | **Capability Matrix Verification (SEQUENTIAL)** | `docs/adapter-capability-matrix.md` | Cross-adapter synthesis |
| 9.15 | **Emerging Platforms (SEQUENTIAL)** | Web research only | New adapter candidates |

#### Per-Adapter Audit Checklist (9.1-9.13)

Each adapter sub-agent MUST:
1. Read the adapter source code (`src/adapters/{name}.ts`)
2. Read the corresponding test file (`src/__tests__/adapters/{name}.test.ts`)
3. Web research the platform's current documentation for config format changes
4. Verify against the following checklist:

- [ ] Output file paths match the capability matrix documentation
- [ ] Output format matches what the platform actually expects (current docs, not assumptions)
- [ ] Feature flag behavior: capabilities the adapter doesn't support are correctly skipped
- [ ] Bridge orchestration: adapters that emit bridge files include the full `BRIDGE_ORCHESTRATION` content
- [ ] Model emission: verify model preference rendering (native vs guidance) per platform
- [ ] MCP format: verify MCP config transformation matches platform's expected schema
- [ ] Secret management: verify secret loading method per adapter
- [ ] Hook format: verify hook/event mapping is correct for this platform
- [ ] New platform features: has the platform added capabilities not yet supported by the adapter?
- [ ] Test coverage: does the test file adequately cover the adapter's output paths?

#### Capability Matrix Verification (9.14 — SEQUENTIAL)

This sub-agent runs after all 13 adapter sub-agents complete:
- [ ] Cross-reference the Implementation Matrix table against all adapter audit findings
- [ ] Verify all "Intentional Omissions" are still valid (platform may have added support)
- [ ] Check for new platform capabilities not yet reflected in the matrix
- [ ] Verify "Canonical Path Matches" are still accurate
- [ ] Ensure maintenance guide is complete and accurate

#### Emerging Platforms (9.15 — SEQUENTIAL)

- [ ] Search for new AI coding tools with significant traction
- [ ] Identify VC-funded tools gaining market share
- [ ] Monitor rising GitHub stars in the AI/coding category
- [ ] Recommend adapter additions with priority ranking and rationale

**Web research:** Visit each platform's official documentation. Check for config format changes, new features, deprecated formats, changelogs from the past 3 months. Search for new entrants in the AI coding tools space.

---

### Domain 10: Documentation & Developer Experience (6 Sub-Agents)

**Scope:** All user-facing documentation, CLI UX, first-run experience, and developer experience metrics.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 10.1 | README, Docs & Website |
| 10.2 | CLI UX |
| 10.3 | First-Run Experience |
| 10.4 | SPACE DevEx Metrics |
| 10.5 | Output Clarity |
| 10.6 | Learning Curve |

#### Per Sub-Agent Audit Checklist

**10.1 README, Docs & Website**
- [ ] README accuracy — counts, examples, links all correct and current
- [ ] `docs/` accuracy — all docs files reflect current implementation
- [ ] `website/docs/` accuracy and completeness — all features documented, navigation logical
- [ ] CHANGELOG accuracy — reflects all actual changes since last release
- [ ] Plugin manifest — `.cursor-plugin/plugin.json` version, description, counts match reality
- [ ] Cross-references — internal links work, related topics connected
- [ ] Comparison to competitors — how does documentation quality compare?

**10.2 CLI UX**
- [ ] Interactive prompts clarity (inquirer) — questions clear, defaults sensible, flow logical
- [ ] Progress feedback (ora) — informative without being noisy
- [ ] Output formatting (boxen, chalk) — readable and accessible
- [ ] Error message actionability — clear next steps for every error
- [ ] Accessibility — works in high-contrast terminals, screen readers, CI environments

**10.3 First-Run Experience**
- [ ] Getting-started UX — can a new user go from zero to working setup in under 5 minutes?
- [ ] Per-preset end-to-end test — default, minimal, full, custom presets all work
- [ ] Decision count per preset — how many choices must the user make?
- [ ] Quality of defaults — pressing Enter through everything produces a good setup
- [ ] Post-init guidance — CLI tells the user what to do next
- [ ] In-IDE discoverability — once installed, how intuitive is discovery within each supported tool?

**10.4 SPACE DevEx Metrics**
Apply the SPACE framework to assess hatch3r's impact on developer experience:
- [ ] **Satisfaction** — developer sentiment toward the framework
- [ ] **Performance** — task completion rate and quality with the framework
- [ ] **Activity** — usage metrics and engagement patterns
- [ ] **Communication** — how the framework affects collaboration quality
- [ ] **Efficiency** — impact on developer flow state and productivity

**10.5 Output Clarity**
- [ ] Agent output quality — are outputs structured, parseable, actionable?
- [ ] Review loop output clarity — can users understand what was found and fixed?
- [ ] Error output — are errors distinguishable from warnings and info?
- [ ] Progress output — can users track what the framework is doing?

**10.6 Learning Curve**
- [ ] Learning curve estimation — time from first use to proficient use
- [ ] Cognitive load measurement — how many concepts must a user learn?
- [ ] Progressive disclosure evaluation — does the framework reveal complexity gradually?
- [ ] Documentation-to-action ratio — how much reading before productive use?

**Web research:** CLI UX best practices, SPACE DevEx framework, developer experience benchmarks, competitor documentation quality.

---

### Tier C — System-Level

> **26 sub-agents, 22 parallel + 4 sequential.** These domains evaluate cross-cutting system properties: data flow integrity, observability, human-AI collaboration, adaptability, security, and compound system behavior.

---

### Domain 11: End-to-End Data Flow (4 Sub-Agents)

**Scope:** The full data flow from canonical source through adapters to tool-specific output.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 11.1 | Canonical to Adapter to Output Tracing |
| 11.2 | Managed Blocks & Safe Write |
| 11.3 | MCP Propagation & Secrets |
| 11.4 | Customization & CLI Lifecycle |

#### Per Sub-Agent Audit Checklist

**11.1 Canonical to Adapter to Output Tracing**
- [ ] Trace every canonical file type (rules, agents, skills, prompts, commands, mcp, hooks, guardrails, learnings) through `readCanonicalFiles()` to `adapter.generate()` to `AdapterOutput[]` to file writes
- [ ] Verify no content is lost or corrupted in transformation
- [ ] Multi-issue parallelism correctness — dependency graph construction and parallel dispatch
- [ ] Adapter-specific content transformation — each adapter's unique formatting applied correctly

**11.2 Managed Blocks & Safe Write**
- [ ] Managed blocks (`HATCH3R:BEGIN`/`HATCH3R:END`) merge integrity
- [ ] User content preservation on update — content outside blocks survives
- [ ] Safe write atomicity — writes complete fully or not at all
- [ ] Backup creation before destructive operations
- [ ] Rollback on failure — failed writes restore previous state
- [ ] Concurrent safety — multiple processes do not corrupt files
- [ ] Force mode behavior — correctly overrides when requested

**11.3 MCP Propagation & Secrets**
- [ ] MCP config propagation per adapter format — each adapter receives correctly formatted MCP config
- [ ] `.env.mcp` generation — all MCP server environment variables included
- [ ] `envFile` injection for Copilot — correct path and format
- [ ] `${env:VAR}` patterns — variable substitution works across adapters
- [ ] Secret leakage prevention — no secrets in generated config files or managed blocks

**11.4 Customization & CLI Lifecycle**
- [ ] CLI lifecycle correctness — init, sync, update, status, validate, verify sequence
- [ ] Customization override flow — `.hatch3r/{id}.customize.yaml` correctly applied
- [ ] Deny pattern enforcement — safety-critical content protected
- [ ] Idempotency — repeated operations produce consistent results
- [ ] Hook mapping — 6 hooks correctly mapped to adapter-specific formats

**Web research:** AGENTS.md specification, MCP protocol current spec, each platform's latest config format.

---

### Domain 12: Agent Observability & Debuggability (4 Sub-Agents)

**Scope:** Can users understand, trace, and debug what agents do?

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 12.1 | Decision Logging |
| 12.2 | Tool Call Audit Trails |
| 12.3 | Pipeline Traceability |
| 12.4 | OpenTelemetry AI Agent Alignment |

#### Per Sub-Agent Audit Checklist

**12.1 Decision Logging**
- [ ] Can users see what decisions each agent made?
- [ ] Is there structured logging of agent reasoning?
- [ ] Are decision points documented in agent output?
- [ ] Are decision logs machine-parseable for post-hoc analysis?

**12.2 Tool Call Audit Trails**
- [ ] Are tool calls (file reads, writes, web searches, MCP calls) logged with inputs and outputs?
- [ ] Can users replay a tool call sequence?
- [ ] Are tool call costs tracked and attributed to specific agents?
- [ ] Is there a tool call budget or rate limiting mechanism?

**12.3 Pipeline Traceability**
- [ ] Can users trace the full pipeline execution (research, implement, review, final quality)?
- [ ] Are there trace IDs or correlation IDs linking related operations?
- [ ] Can users see time spent per phase?
- [ ] Are inter-phase handoffs visible in trace output?

**12.4 OpenTelemetry AI Agent Alignment**
- [ ] Alignment with OpenTelemetry AI agent semantic conventions
- [ ] Does hatch3r's observability guidance (rules, agents) align with the emerging standard?
- [ ] Reasoning trace capability — can the system explain why an agent made a specific choice?
- [ ] Replay/simulation support — can a pipeline execution be replayed with different inputs?
- [ ] EU AI Act traceability requirements — does the framework support the level of traceability regulators expect?

**Web research:** OpenTelemetry GenAI semantic conventions, EU AI Act traceability requirements, agent observability standards, reasoning trace research.

---

### Domain 13: Human-AI Collaboration Quality (4 Sub-Agents)

**Scope:** How well the framework facilitates productive human-AI interaction.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 13.1 | Interaction Patterns |
| 13.2 | Trust Calibration |
| 13.3 | Confidence Indication |
| 13.4 | Feedback Loops & Educational Value |

#### Per Sub-Agent Audit Checklist

**13.1 Interaction Patterns**

Coverage of interaction types — does the framework support all 11 common interaction patterns?
- [ ] (1) Task delegation
- [ ] (2) Collaborative editing
- [ ] (3) Code review
- [ ] (4) Debugging assistance
- [ ] (5) Architecture discussion
- [ ] (6) Learning/teaching
- [ ] (7) Planning/specification
- [ ] (8) Testing strategy
- [ ] (9) Incident response
- [ ] (10) Dependency management
- [ ] (11) Release management

**13.2 Trust Calibration**
- [ ] Trust calibration assessment — does the framework create appropriate levels of trust in agent output?
- [ ] Uncertainty warnings — are users warned when agents are uncertain?
- [ ] Review gate trustworthiness — is the "0 Critical + 0 Warning" gate reliable or gameable?
- [ ] Over-trust risks — does the framework create false confidence in agent output?

**13.3 Confidence Indication**
- [ ] Do agents indicate their confidence level in recommendations?
- [ ] Are there graduated confidence signals (high confidence on formatting, low confidence on architecture)?
- [ ] Can users calibrate agent assertiveness?
- [ ] Are confidence levels backed by verifiable signals (test results, lint output)?

**13.4 Feedback Loops & Educational Value**
- [ ] Can users provide feedback that improves future agent performance?
- [ ] Educational value — does the framework teach users better practices, or just do the work?
- [ ] Learning system (`/.agents/learnings/`) effectiveness assessment
- [ ] Knowledge transfer — do agents explain their reasoning to help users learn?

**Web research:** Human-AI collaboration research, trust calibration in AI systems, confidence calibration, feedback loop design for AI assistants.

---

### Domain 14: Cross-Project Adaptability & Scalability (4 Sub-Agents)

**Scope:** How well the framework works across different project types, sizes, and team configurations.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 14.1 | Tech Stack Generalization |
| 14.2 | Monorepo & Enterprise |
| 14.3 | Team Scalability |
| 14.4 | Convention Self-Discovery |

#### Per Sub-Agent Audit Checklist

**14.1 Tech Stack Generalization**
- [ ] Does the framework work equally well for: React/Next.js, Vue/Nuxt, Angular, Svelte, Python/Django, Ruby/Rails, Go, Rust, Java/Spring, mobile (React Native, Flutter)?
- [ ] Are rules and agents tech-stack-neutral or frontend-biased?
- [ ] Portability scoring — rate each tech stack's support level (full, partial, minimal, none)
- [ ] Language-specific gaps — are there missing rules or agents for non-JavaScript ecosystems?

**14.2 Monorepo & Enterprise**
- [ ] Monorepo support (Turborepo, Nx, Lerna) — can hatch3r manage per-package agent configs?
- [ ] Enterprise scale — does it work with 100+ developers, 1000+ files?
- [ ] Performance at scale — init time, sync time, file count handling
- [ ] Multi-team configuration — different teams within the same monorepo

**14.3 Team Scalability**
- [ ] Solo developer experience — minimal overhead, fast feedback
- [ ] Small team (2-10) — shared conventions, consistent output
- [ ] Large team (10-100+) — governance, customization, role-based config
- [ ] Team conventions management — can teams define and enforce their own conventions?

**14.4 Convention Self-Discovery**
- [ ] Automatic detection of existing conventions (linting config, test framework, CI provider)
- [ ] Graduated customization — progressive disclosure of advanced features
- [ ] Migration path from other tools — can users switch from competitors?
- [ ] Convention conflict resolution — what happens when detected conventions conflict with hatch3r defaults?

**Web research:** Cross-platform development tool patterns, monorepo tooling best practices, enterprise development tool adoption patterns.

---

### Domain 15: Agentic Security & Trust Model (6 Sub-Agents)

**Scope:** The security of the agentic system itself — not the security guidance hatch3r teaches to end-user projects (covered in Domain 5), but whether hatch3r's own architecture is resilient against agentic attack vectors.

This is a distinct concern from Domain 1 (source code quality) and Domain 4 (production security). hatch3r generates instructions that guide AI agents with broad code-writing capabilities. The trust model of that system requires dedicated scrutiny.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 15.1 | Prompt Injection & Instruction Integrity |
| 15.2 | Trust Boundaries Between Agents |
| 15.3 | OWASP Top 10 for Agentic Applications (ASI01-ASI10) |
| 15.4 | Supply Chain of Agent Definitions |
| 15.5 | MCP Trust Model |
| 15.6 | Agentic Trust Framework Compliance |

#### Per Sub-Agent Audit Checklist

**15.1 Prompt Injection & Instruction Integrity**
- [ ] **Managed block injection** — Can malicious content injected outside `HATCH3R:BEGIN`/`HATCH3R:END` blocks influence agent behavior in ways that bypass hatch3r's intended instructions?
- [ ] **Customization override abuse** — Can `.hatch3r/{id}.customize.yaml` files override safety-critical agent behaviors (disabling security checks, bypassing the review loop)?
- [ ] **Skill injection** — Can a malicious skill in `/.agents/skills/` escalate privileges, exfiltrate data, or override the orchestration pipeline?
- [ ] **Agent instruction tampering** — If an agent's `.md` file is modified (compromised dependency, malicious PR), what is the blast radius? Are there integrity checks?
- [ ] **Content system as attack vector** — Can tag/preset manipulation cause malicious content to be included in or excluded from initialization?

**15.2 Trust Boundaries Between Agents**
- [ ] **Agent isolation** — Do sub-agents operate within well-defined capability boundaries? Can the implementer bypass the reviewer?
- [ ] **Context propagation safety** — When rules and learnings are propagated to sub-agent prompts, is there filtering to prevent instruction injection?
- [ ] **Review loop integrity** — Can the fixer mark its own output as clean without the reviewer actually re-reviewing? Is the max-3-iteration limit enforceable or just advisory?
- [ ] **Escalation path reliability** — When max review iterations are reached with remaining findings, is user escalation reliable? Can it be suppressed?
- [ ] **Max-iteration enforcement** — Is the review loop iteration limit enforced at the infrastructure level or only by prompt instruction?

**15.3 OWASP Top 10 for Agentic Applications (Self-Assessment)**

Apply every category from the official OWASP Top 10 for Agentic Applications (ASI01-ASI10) to hatch3r's own agentic architecture. **Web research is MANDATORY** — read the full specification at genai.owasp.org before assessing.

- [ ] **ASI01: Agent Goal Hijack** — Can hatch3r agent objectives be altered through malicious content in project files, user prompts, or poisoned learnings? Can the orchestration pipeline be redirected?
- [ ] **ASI02: Tool Misuse & Exploitation** — Can agents misuse tools they have access to (file writes, git commands, GitHub API, MCP servers) through parameter pollution or tool chain manipulation? Are permissions minimized?
- [ ] **ASI03: Identity & Privilege Abuse** — Do agents inherit the user's full system credentials? Can a sub-agent escalate privileges beyond what its role requires (implementer gaining reviewer-level trust)?
- [ ] **ASI04: Agentic Supply Chain Vulnerabilities** — Are external components (MCP servers, npm dependencies, community packs, model APIs) validated? Could a compromised MCP server poison the pipeline?
- [ ] **ASI05: Unexpected Code Execution (RCE)** — Can agents be tricked into generating or executing malicious code? Does the implementer agent have RCE safeguards when writing code to the user's project?
- [ ] **ASI06: Memory & Context Poisoning** — Can the `/.agents/learnings/` system be poisoned to manipulate future agent behavior? Can corrupted context from one session persist and affect subsequent sessions?
- [ ] **ASI07: Insecure Inter-Agent Communication** — Are handoffs between agents (researcher to implementer, reviewer to fixer) validated? Can a compromised agent inject instructions into the next agent's prompt via its output?
- [ ] **ASI08: Cascading Failures** — If one agent in the pipeline fails (reviewer crashes), does the entire workflow fail gracefully or does it cascade? Are there circuit breakers or fallback behaviors?
- [ ] **ASI09: Human-Agent Trust Exploitation** — Does the framework create false confidence in agent output? Are users warned when agents are uncertain? Is the "0 Critical + 0 Warning" review gate trustworthy or can it be gamed?
- [ ] **ASI10: Rogue Agents** — Can an agent exhibit behavioral drift over long sessions? Can a sub-agent deviate from its defined role (implementer starting to review its own code)? Are there behavioral guardrails beyond prompt instructions?

**15.4 Supply Chain of Agent Definitions**
- [ ] **Update integrity** — When `hatch3r update` pulls new content from npm, is content integrity verified? Could a compromised npm publish inject malicious agent instructions?
- [ ] **Pack system security** — The `hatch3r add [pack]` feature installs community-authored content. What is the trust model for community packs? Is there sandboxing, review, or signing?
- [ ] **Version pinning** — Can users pin to a specific version of agent content to avoid unexpected behavioral changes?
- [ ] **Integrity manifest tamper detection** — Does the integrity system (`src/integrity/`) provide reliable tamper detection for agent definitions?

**15.5 MCP Trust Model**
- [ ] MCP server trust model — how are MCP servers authenticated and authorized?
- [ ] MCP server capability scoping — are MCP server permissions minimized?
- [ ] Malicious MCP server scenarios — what happens if a registered MCP server is compromised?
- [ ] MCP transport security — are connections encrypted and authenticated?
- [ ] MCP tool permission model — can individual MCP tools be allowed/denied?

**15.6 Agentic Trust Framework Compliance**
- [ ] Agentic Trust Framework compliance assessment — does hatch3r's trust model align with the emerging framework?
- [ ] Trust delegation — how is trust delegated from user to agent to sub-agent?
- [ ] Trust verification — how is agent behavior verified against expected behavior?
- [ ] Trust revocation — can trust be revoked for misbehaving agents?

**Web research:** OWASP Top 10 for Agentic Applications 2026 (ASI01-ASI10) at genai.owasp.org, Agentic Trust Framework, NIST AI Agent Standards Initiative, prompt injection research, MCP security best practices.

---

### Domain 16: Compound System Evaluation (4 Sub-Agents)

**Scope:** Evaluating hatch3r as a complete compound system rather than individual components.

ALL sub-agents are **sequential** — they run only after their cross-domain dependencies complete.

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Depends On |
|-----------|-------|-----------|
| 16.1 | One-Shot Success Analysis | D5, D7 |
| 16.2 | Content Coverage Gap Analysis | D5, D9 |
| 16.3 | Prompt Consistency Across System | D5, D7 |
| 16.4 | Regression & Maintenance Quality | D3, D4 |

#### Per Sub-Agent Audit Checklist

**16.1 One-Shot Success Analysis**
- [ ] SWE-bench style success rate analysis — estimate the probability that a user's first task (feature, bug fix, refactor) succeeds end-to-end without manual intervention
- [ ] Instruction clarity impact (from D5) — how does prompt quality affect success rate?
- [ ] Pipeline design impact (from D7) — how does orchestration design affect success rate?
- [ ] Error recovery impact (from D8) — how do failure modes reduce success rate?
- [ ] One-shot vs multi-shot success rates — how many iterations does a typical task require?

**16.2 Content Coverage Gap Analysis**
- [ ] Map content artifacts to user workflows — which workflows are fully covered, partially covered, or uncovered?
- [ ] Tech stack coverage — are there project types not served by any content artifact?
- [ ] Workflow type coverage — are there common development workflows (CI/CD, database migration, API design) with no supporting content?
- [ ] Gap prioritization — rank uncovered areas by user impact

**16.3 Prompt Consistency Across System**
- [ ] Consistent terminology — do all artifacts use the same terms for the same concepts?
- [ ] Consistent severity levels — are "Critical", "High", "Medium", "Low" used uniformly?
- [ ] Consistent output formats — do all artifacts produce structurally compatible output?
- [ ] Cross-artifact contradiction detection — do any artifacts give conflicting instructions?

**16.4 Regression & Maintenance Quality**
- [ ] Zero-regression rate — how well does the framework maintain quality across updates?
- [ ] Regression testing infrastructure — are there tests that catch content regressions?
- [ ] Maintenance burden analysis — effort required to keep the framework current
- [ ] Content freshness — are artifacts up-to-date with current platform capabilities?

**Web research:** SWE-bench evaluation methodology, compound AI system evaluation, system-level vs component-level testing.

---

### Tier D — Strategic

> **6 sub-agents, 2 parallel + 4 sequential.** These domains evaluate market positioning and strategic alignment. They run last because they depend on findings from all previous tiers.

---

### Domain 17: Competition & Market Intelligence (3 Sub-Agents)

**Scope:** Competitive landscape, market positioning, and strategic alignment.

Sub-agent 17.3 is **sequential** — it runs only after 17.1 and 17.2 complete.

#### Sub-Agent Decomposition

| Sub-Agent | Focus |
|-----------|-------|
| 17.1 | Direct Competitors |
| 17.2 | Standards & Ecosystem |
| 17.3 | **Market Positioning & Strategy (SEQUENTIAL)** |

#### Per Sub-Agent Audit Checklist

**17.1 Direct Competitor Analysis**
- [ ] **AgentSys** — Multi-tool agent orchestration (plugins, agents, skills for Claude Code, OpenCode, Codex, Cursor, Kiro). Compare scope, quality, and approach.
- [ ] **GSD (Get Shit Done)** — Spec-driven development for Claude Code. Compare workflow model, popularity, community.
- [ ] **CrewSwarm** — Runtime orchestrator for OpenCode, Cursor, Claude Code. Compare architecture (WebSocket vs config generation).
- [ ] **Crux** — Multi-agent orchestration with embedded SQLite/vector search. Compare infrastructure approach.
- [ ] **agentic-code** — CLI setup via `npx agentic-code`. Compare scope and zero-config approach.
- [ ] **awesome-cursorrules** — Curated cursor rules collection. Compare breadth vs depth.
- [ ] **Superpower / Compound Engineering** — Claude Code plugin ecosystem. Compare distribution model.
- [ ] Any NEW competitors that have emerged since the last audit — web research MANDATORY

Per competitor, assess: scope comparison, quality comparison, community size (stars, downloads), approach (config-gen vs runtime vs curated), unique features hatch3r lacks.

**17.2 Standards & Ecosystem Evolution**
- [ ] **AAIF (Agentic AI Foundation)** — AGENTS.md, MCP, goose under Linux Foundation. Impact on hatch3r's adapter model?
- [ ] **AGENTS.md spec** — Current version, adoption, changes since last audit
- [ ] **MCP protocol** — Current spec version, new capabilities, breaking changes
- [ ] **All 13 platform updates** — New features, deprecations, API changes for every supported platform

**17.3 Market Positioning & Strategy (SEQUENTIAL)**

Synthesizes findings from 17.1 and 17.2:
- [ ] Feature gap analysis — what do competitors offer that hatch3r does not?
- [ ] Unique differentiators — what does hatch3r offer that no competitor does?
- [ ] Community and adoption signals — GitHub stars, npm downloads, mentions, community size
- [ ] Distribution model comparison — npm, marketplace, runtime, curated collections
- [ ] Multi-tool bet assessment — is the multi-adapter approach still the right strategy, or is the market converging on AGENTS.md natively?
- [ ] Investment recommendations — where should hatch3r invest next based on market gaps?
- [ ] Open-source vs private recommendation with rationale

**Web research:** Search for every named competitor, AAIF announcements, tool changelog pages, npm download stats, GitHub trending in the AI/coding category.

---

### Domain 18: PRD, Roadmap & Distribution (3 Sub-Agents)

**Scope:** Strategic alignment between product vision, roadmap, and current implementation.

ALL sub-agents are **sequential** — they run only after D16 and D17 complete.

#### Sub-Agent Decomposition

| Sub-Agent | Focus | Depends On |
|-----------|-------|-----------|
| 18.1 | PRD Alignment | D16, D17 |
| 18.2 | Roadmap Reprioritization | D16, D17 |
| 18.3 | Distribution Verdict | D16, D17, 18.1, 18.2 |

**Files to check:**
- `hatch3r-prd.md` (gitignored — ask user if available)
- `COMPETITIVE-ANALYSIS.md` (gitignored — ask user if available)
- `todo.md` (gitignored — current roadmap)

#### Per Sub-Agent Audit Checklist

**18.1 PRD Alignment**
- [ ] PRD vs implementation gap — what is specified but not built? What is built but not specified?
- [ ] PRD relevance — does the PRD reflect the current competitive landscape from D17?
- [ ] Feature prioritization — are high-impact features prioritized correctly?
- [ ] Technical debt — are there architectural decisions that should be revisited?

**18.2 Roadmap Reprioritization**
- [ ] Reprioritization based on compound system evaluation (D16)
- [ ] Reprioritization based on competitive landscape (D17)
- [ ] Priority reassignment for existing roadmap items
- [ ] Missing roadmap items revealed by the audit
- [ ] Long-term strategic items — still relevant? Priority shift needed?

**18.3 Distribution Verdict**

Requires 18.1 and 18.2 results:
- [ ] Open-source vs private npm (or both) recommendation with rationale
- [ ] Marketplace strategy — Cursor marketplace, Claude Code marketplace, other distribution channels
- [ ] Timing recommendation — ready now, or what needs to happen first?
- [ ] Licensing considerations — MIT suitability, dual licensing options
- [ ] Community building strategy — how to grow adoption and contributions

**Web research:** AI coding tools market trajectory, enterprise adoption patterns, marketplace distribution data.

---

## Summary Table

| Tier | Domain | Sub-Agents | Parallel | Sequential |
|------|--------|-----------|----------|------------|
| A | 1: Core Source Implementation | 8 | 8 | 0 |
| A | 2: Adapter Infrastructure | 7 | 7 | 0 |
| A | 3: Test Infrastructure | 5 | 5 | 0 |
| A | 4: Build, CI/CD & Dependencies | 5 | 5 | 0 |
| B | 5: Prompt Engineering Quality | 7 | 7 | 0 |
| B | 6: Context Engineering & Token Economics | 4 | 4 | 0 |
| B | 7: Agent Orchestration Optimization | 5 | 5 | 0 |
| B | 8: Error Recovery & Resilience | 4 | 4 | 0 |
| B | 9: Platform Adapters | 15 | 13 | 2 (9.14, 9.15) |
| B | 10: Documentation & Developer Experience | 6 | 6 | 0 |
| C | 11: End-to-End Data Flow | 4 | 4 | 0 |
| C | 12: Agent Observability & Debuggability | 4 | 4 | 0 |
| C | 13: Human-AI Collaboration Quality | 4 | 4 | 0 |
| C | 14: Cross-Project Adaptability & Scalability | 4 | 4 | 0 |
| C | 15: Agentic Security & Trust Model | 6 | 6 | 0 |
| C | 16: Compound System Evaluation | 4 | 0 | 4 |
| D | 17: Competition & Market Intelligence | 3 | 2 | 1 (17.3) |
| D | 18: PRD, Roadmap & Distribution | 3 | 0 | 3 |
| **Total** | | **98** | **88** | **10** |

---

## Output Format

The final audit report MUST use 3-tier progressive disclosure for maximum utility across audiences.

---

### Tier 1: Executive Dashboard

```
Audit Date: YYYY-MM-DD
Framework Version: (from package.json)
Previous Audit: (date or "N/A")
Auditor: (model name and version)
Domains Covered: 18/18
Sub-Agents Deployed: 98

Overall Score: XX/100 (Weighted)
Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]
Severity Ceiling Applied: [Yes/No — if any domain has unresolved Critical]

Top 3 Strengths:
1. ...
2. ...
3. ...

Top 3 Critical Issues:
1. ...
2. ...
3. ...

Competitive Positioning: (1 sentence)
Distribution Recommendation: (1 sentence)
```

#### Domain Heatmap

```
| Domain | Score | Critical | High | Medium | Low | Info |
|--------|-------|----------|------|--------|-----|------|
| D1: Core Source Implementation | XX | N | N | N | N | N |
| D2: Adapter Infrastructure | XX | N | N | N | N | N |
| D3: Test Infrastructure | XX | N | N | N | N | N |
| D4: Build, CI/CD & Dependencies | XX | N | N | N | N | N |
| D5: Prompt Engineering Quality | XX | N | N | N | N | N |
| D6: Context Engineering | XX | N | N | N | N | N |
| D7: Orchestration Optimization | XX | N | N | N | N | N |
| D8: Error Recovery & Resilience | XX | N | N | N | N | N |
| D9: Platform Adapters | XX | N | N | N | N | N |
| D10: Documentation & DevEx | XX | N | N | N | N | N |
| D11: End-to-End Data Flow | XX | N | N | N | N | N |
| D12: Observability | XX | N | N | N | N | N |
| D13: Human-AI Collaboration | XX | N | N | N | N | N |
| D14: Adaptability & Scalability | XX | N | N | N | N | N |
| D15: Agentic Security | XX | N | N | N | N | N |
| D16: Compound System | XX | N | N | N | N | N |
| D17: Competition & Market | XX | N | N | N | N | N |
| D18: PRD, Roadmap & Distribution | XX | N | N | N | N | N |
```

---

### Tier 2: Domain Summaries

For each of the 18 domains, provide:

```
#### Domain N: [Name]

**Health Score:** X/100
**Finding Count:** N Critical, N High, N Medium, N Low, N Info

**Top 3 Findings:**
1. [Severity] Finding summary — recommendation (Effort)
2. [Severity] Finding summary — recommendation (Effort)
3. [Severity] Finding summary — recommendation (Effort)

**Key Recommendation:** (1 sentence)
```

---

### Tier 3: Domain Detail

For each domain, the full finding table:

```
#### Domain N: [Name] — Detailed Findings

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| 1 | Critical | ... | ... | ... | S/M/L/XL |
| 2 | High | ... | ... | ... | S/M/L/XL |
| ... | ... | ... | ... | ... | ... |
```

---

### Cross-Domain Analysis

Findings that span multiple domains, with references to each domain's perspective:

```
| # | Finding | Domains | Primary Domain | Severity | Recommendation |
|---|---------|---------|---------------|----------|----------------|
| 1 | ... | D3, D7, D16 | D7 | High | ... |
| ... | ... | ... | ... | ... | ... |
```

---

### Competitive Positioning Matrix

```
| Capability               | hatch3r | Competitor A | Competitor B | ... |
|--------------------------|---------|-------------|-------------|-----|
| Multi-tool support       | ...     | ...         | ...         | ... |
| Agent count              | ...     | ...         | ...         | ... |
| Board management         | ...     | ...         | ...         | ... |
| ...                      | ...     | ...         | ...         | ... |
```

---

### Enhanced Action Items

Ordered by: Critical severity first, then impact-to-effort ratio.

```
| Priority | Domain | Action Item | Severity | Effort | Owner | Depends On | Status |
|----------|--------|-------------|----------|--------|-------|-----------|--------|
| 1 | ... | ... | Critical | S | ... | — | Open |
| 2 | ... | ... | Critical | M | ... | — | Open |
| ... | ... | ... | ... | ... | ... | ... | ... |
```

---

### Enhanced Release Plan

```
Target Version: X.Y.Z
Release Type: (major / minor / patch)
Release Confidence Score: X/100

Blockers:
| # | Domain | Item | Severity | Effort | Owner | Risk Score | Status |
|---|--------|------|----------|--------|-------|-----------|--------|
(Risk Score = Impact x Likelihood x Reversibility, each 1-5)

Should-Have:
| # | Domain | Item | Severity | Effort | Owner | Risk Score | Status |
|---|--------|------|----------|--------|-------|-----------|--------|
(same format)

Deferred:
| # | Domain | Item | Severity | Effort | Rationale for Deferral |
|---|--------|------|----------|--------|------------------------|

Rollback Plan: (what to do if the release fails)
Acceptance Criteria: (how to verify the release is ready)
Estimated Total Effort: (sum of blockers + should-have)
Recommended Sequence: (what to tackle first based on dependencies)
Risk Assessment: (what could delay the release)
```

---

### Distribution Verdict

Detailed recommendation on:
- Open-source vs private npm package (or both)
- Marketplace strategy (Cursor, Claude Code, SkillKit)
- Timing recommendation (ready now, or what needs to happen first)
- Licensing considerations
- Community building strategy

---

### Delta Since Previous Audit

(If a previous audit exists)
- New findings
- Resolved findings
- Regressed findings
- Score changes per domain

---

## Audit History

Record completed audits here for delta tracking:

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| — | — | — | — | — |
