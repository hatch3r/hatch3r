# hatch3r Competitive Analysis

> Last updated: April 2, 2026 (Cycle 4 audit findings #87 applied)
> Scope: Deep competitive analysis of the agentic coding framework landscape (Domain 4 Audit)

---

## 1. Executive Summary

The agentic coding framework space has continued its explosive growth through early 2026, with two major structural shifts since the previous analysis (February 24, 2026). First, **multi-agent orchestration has become table-stakes**: Claude Code 2.0 shipped native multi-agent orchestration and Agent Teams, Cursor 2.4 added subagents, and multiple new frameworks (Ruflo, CrewSwarm, Crux, Weave, AgentSys, Axon) have launched specifically for multi-agent coordination. Second, **the AAIF (Agentic AI Foundation) under the Linux Foundation** has formalized governance for AGENTS.md and MCP, with AGENTS.md now adopted by 60,000+ open-source projects and MCP reaching 97 million+ monthly SDK downloads.

The competitive landscape has expanded from ~5 direct competitors to 10+ active frameworks, segmented into four tiers:

1. **Full-lifecycle methodology frameworks** (Superpowers ~130k stars, GitHub Spec Kit ~84k stars, BMAD ~41k stars, GSD ~32k stars, Compound Engineering 10k stars) — prescribe how to work with AI agents
2. **Multi-agent orchestration runtimes** (Ruflo ~29k stars, Weave, AgentSys 376 stars, Axon 35 stars) — focused on runtime coordination of multiple agents. *Note: CrewSwarm and Crux, previously listed here, appear stalled with no verifiable public activity since early 2026 — downgraded to monitoring status.*
3. **Autonomous coding agents** (OpenCode ~114k stars, Cline ~59k stars, Roo Code 22k+ stars, Goose ~33k stars) — execute tasks with varying autonomy
4. **IDE-native platforms** (Cursor, Windsurf, Claude Code, Codex, Gemini CLI, Copilot, Kiro, Amp) — embed AI into the developer workflow

hatch3r occupies a unique position straddling tiers 1 and 4: a methodology framework that generates native configurations for **14 IDE tools** from a single canonical source. Its adapter count has grown from 9 to 14 (adding Aider, Kiro, Goose, Zed, and Antigravity). No competitor matches this breadth of native tool support. Its GitHub Projects V2 board management remains unmatched, and its comprehensive out-of-the-box setup (16 agents, 25 skills, 22 rules, 34 commands, 10 MCP servers (3 default + 7 opt-in)) provides immediate value.

**Key changes since last analysis (March 18 -> April 2, 2026):**
- **GitHub Spec Kit emerged as a direct new competitor** — ~84k stars, GitHub-backed, 20+ tool configurations, native GitHub integration. Not present in any previous competitive analysis
- Superpowers grew from ~82k to ~130k stars (+59%) — shipped v5.0 with **6-tool support** (was single-tool), eliminating its primary weakness. Now the #1 methodology framework by every metric
- Ruflo grew from 18.5k to ~29k stars (+57%) — 100+ agents, enterprise positioning strengthening
- GSD expanded to 8 tools + CLI — narrowing the gap with hatch3r's multi-tool approach
- Compound Engineering expanded to 12 tools — approaching parity on tool count
- **Combined competitor stars now 332k+** — community gap is existential
- MCP June 2026 spec introduces Server Cards — new integration requirement
- Multi-tool count alone is no longer a defensible differentiator; repositioning to depth + board management + learning loop required

**Previous key changes (March 4 -> March 18, 2026):**
- GSD grew from 23.1k to ~32k stars (+39%) — now v1.24.0 with `/gsd:quick --research` flag
- Superpowers grew from ~71.2k to ~82k stars (+15%) — explosive viral growth, 1,800+ stars/day peaks
- BMAD grew from ~38.5k to ~41.2k stars (+7%), shipped v6.2.0 with 28-tool claim (verified template-based)
- Cline grew from ~52k to ~59.1k stars (+14%) — shipped CLI 2.0, v3.73.0, Plan/Act modes, ACP support
- Goose grew from 30k+ to ~33.2k stars (+10%) — v1.27.2, ACP-compatible, ACP-over-HTTP transition in progress
- Kiro added enterprise SSO (Okta, Entra ID) across IDE, CLI, and web (v0.9.40+)
- CrewSwarm and Crux show no verifiable public activity — downgraded to monitoring
- Cline CLI 2.0 launched with `--acp` flag, making Cline an ACP-compliant agent
- ACP Agent Registry launched (Jan 28, 2026) by JetBrains and Zed Industries

---

## 2. Per-Framework Analysis

### 2.1 GSD (Get Shit Done)

- Repository: https://github.com/gsd-build/get-shit-done
- **Stars: ~32,000** (up from 23,100, +39%)
- Contributors: 40+
- **Latest release: v1.24.0** (March 15, 2026)
- Install: `npx get-shit-done-cc@latest`
- Trusted by: engineers at Amazon, Google, Shopify, Webflow

**What changed since last analysis:**

GSD has maintained its position as the fastest-growing methodology framework with another +39% star jump. Key additions in v1.22.1-v1.24.0 include:
- `/gsd:quick --research` flag that spawns a focused research agent before planning (v1.24.0)
- Codex changelog support (expanded tool coverage)
- `/gsd:add-tests` command for post-phase test generation
- YAML frontmatter sync to STATE.md for machine-readable status tracking
- `gsd-tools` CLI with `scaffold` (template generation) and `requirements mark-complete` (per-plan requirement tracking)
- ROADMAP.md and REQUIREMENTS.md auto-updating during executor operations
- Community fork for Antigravity: `get-shit-done-for-antigravity`

**Tool Support:** Primary: Claude Code, OpenCode, Gemini CLI. Community: Cursor (rmindel/gsd-for-cursor), Antigravity (toonight/get-shit-done-for-antigravity). No native Copilot, Windsurf, Amp, Codex, or Cline support.

**Competitive threat level: MEDIUM-HIGH (escalated).** GSD's sustained growth trajectory (17k -> 23k -> 32k in under a month) demonstrates strong product-market fit. Its tool support remains narrow (3-4 tools + community forks vs. hatch3r's 14), but community forks are expanding its reach. Its context rot prevention, auto-advance chains, and new research agent spawning remain differentiated.

---

### 2.2 Superpowers

- Repository: https://github.com/obra/superpowers
- **Stars: ~130,000** (up from ~82,000, +59%)
- Contributors: 20+
- **Latest release: v5.0** (March 2026)
- Install: Claude Code plugin marketplace or MCP server

**What changed since last analysis:**

Superpowers v5.0 represents a fundamental shift. The framework has expanded from a single-tool (Claude Code) focus to **6-tool support**, eliminating what was previously its primary competitive weakness. Stars have surged from ~82k to ~130k — the largest absolute growth of any competitor in this analysis cycle. Claude Code marketplace installs continue growing beyond 118.8k+. The framework enforces structured methodology: requirement understanding, design validation, detailed planning, execution through autonomous subagents, and TDD.

The v5.0 multi-tool expansion means Superpowers now competes directly with hatch3r on tool breadth, though at 6 tools vs. hatch3r's 15, the gap remains significant. The quality and depth of Superpowers' 6-tool configurations relative to hatch3r's native adapter approach is an open question that requires benchmarking (see finding #90).

**Competitive threat level: CRITICAL (escalated from HIGH).** The combination of ~130k stars, v5.0's 6-tool expansion, and sustained viral growth makes Superpowers the most dangerous competitor. Its previous single-tool weakness has been eliminated. hatch3r's differentiation must now rest on **native integration depth** (15 adapters generating tool-specific configs vs. Superpowers' 6), **board management** (unique to hatch3r), and **learning loop** — not on multi-tool support alone. The community size moat (~130k stars) is likely insurmountable through technical merit alone; distribution and visibility are existential.

---

### 2.2a GitHub Spec Kit (NEW — CRITICAL)

- Repository: https://github.com/github/spec-kit (estimated)
- **Stars: ~84,000**
- Backing: **GitHub (Microsoft)**
- Tool support: 20+ tool configurations
- Integration: Native GitHub platform integration

**Overview:** GitHub Spec Kit is a newly emerged competitor not present in any previous competitive analysis. Backed by GitHub (and by extension Microsoft), it provides configuration generation for 20+ AI coding tools with deep GitHub platform integration. Its rapid rise to ~84k stars reflects both the GitHub brand and genuine market demand for multi-tool agent configuration.

**Key strengths:**
- **GitHub backing** — corporate sponsorship from the world's largest code hosting platform provides distribution, trust, and integration advantages no independent framework can match
- **20+ tool configurations** — broader tool coverage than hatch3r's 15 native adapters by count
- **Native GitHub integration** — deep platform integration leveraging GitHub's ecosystem (Actions, Copilot, Projects, etc.)
- **Rapid adoption** — ~84k stars indicates strong community traction

**Key weaknesses (relative to hatch3r):**
- No board management (hatch3r's GitHub Projects V2 management is unique)
- No learning loop or knowledge compounding
- No weekly audit cycle
- Configuration depth vs. hatch3r's deeply native adapter approach is unverified
- GitHub-centric — may not serve multi-platform teams (Azure DevOps, GitLab)

**Competitive threat level: CRITICAL (new entry).** GitHub Spec Kit is the most significant new entrant since this competitive analysis began. Its GitHub backing provides distribution and trust that independent frameworks cannot easily match. The 20+ tool count exceeds hatch3r's 15, though integration depth is unverified. hatch3r's key differentiators against Spec Kit are: **board management** (across 3 platforms, not just GitHub), **learning loop**, **native adapter depth** (deeply tool-specific configs), and **platform independence** (Azure DevOps, GitLab support). A detailed competitive response strategy is needed (see D17 findings).

---

### 2.3 BMAD Method

- Repository: https://github.com/bmad-code-org/BMAD-METHOD
- **Stars: ~41,200** (up from ~38,500, +7%)
- Contributors: 110-120
- **Latest release: v6.0.4** (March 1, 2026)
- Install: `npx bmad-method install`

**What changed since last analysis:**

BMAD remains actively maintained with frequent releases. v6.0.4 additions:
- Edge case hunter review task for exhaustive code analysis
- Bug fixes for documentation references and installer templates
- Prevention of brainstorming session overwrites
- v6.2.0 (March 15, 2026) shipped with workflow-to-native-skill conversions, inference-based skill validator, and expanded IDE support

BMAD is expanding tool support and CI/CD integration. Its 110+ contributors give it the largest contributor base among methodology frameworks. Stars have grown to ~41.2k.

**BMAD tool count claim — verified March 18, 2026:** BMAD v6.2.0 claims configurations for 28 AI tools via its `platform-codes.yaml` installer system. Web research confirms the claim is numerically plausible — BMAD's installer uses a two-tier approach: **config-driven template generation** for standardized platforms (Claude Code, Cursor, Windsurf, Kiro, Gemini CLI) and **custom installers** for platforms with unique requirements (GitHub Copilot, Rovo Dev, Codex, Kilo). Additional tools identified include OpenCode, Antigravity, Trae, iFlow, QwenCoder, Cline, Roo Code, and others. However, the depth of these configurations varies significantly. BMAD's approach generates tool-specific prompt/skill files from a shared template system, whereas hatch3r generates complete native configurations per tool. BMAD's "28 tools" count includes tools where the configuration is a thin template wrapper (frontmatter or `file://` include) rather than a deep, tool-native integration. The DeepWiki analysis of BMAD's codebase references "15+ IDE definitions" in the platform-codes registry and "20+ AI IDEs" in the documentation — the gap to 28 likely includes variant configurations (e.g., separate entries for Roo Code vs. Cline, CLI vs. IDE modes). **Verification methodology:** GitHub README, v6.2.0 release notes, docs.bmad-method.org, DeepWiki code analysis, newreleases.io, and vibesparking.com blog posts were consulted. The full 28-tool enumeration is not published in any single public source; the claim is based on the `platform-codes.yaml` registry which is not directly browsable on GitHub without cloning.

**Competitive threat level: MEDIUM-HIGH (escalated from prior assessment).** BMAD's 28-tool claim challenges hatch3r's "widest tool support" positioning. However, the comparison is breadth vs. depth: BMAD generates template-based prompt files for 28 tools, while hatch3r generates **deeply native configurations** for 15 tools — leveraging each tool's specific features (Cursor rules + `.mdc`, Claude Code hooks + skills, Copilot instructions, Kiro specs, etc.). hatch3r should reposition from "widest tool support" to **"deepest native integration across the most tools."** BMAD's ~41.2k stars (up from ~38.5k), 110+ contributors, and expanding tool coverage make it a strengthening competitor. The key differentiator remains hatch3r's native adapter depth, board management, security coverage, and learning loop — none of which BMAD offers.

---

### 2.4 Compound Engineering

- Repository: https://github.com/EveryInc/compound-engineering-plugin
- **Stars: ~9,700** (up from 9,280, +4%)
- Contributors: 40
- **Latest release: v2.33.0** (February 2026)
- Install: Claude Code plugin marketplace

**What changed since last analysis:**

Minimal changes. v2.33.0 continues with configurable review agents, learnings researcher, schema drift detection. The framework now lists 29 agents, 22 commands, 19 skills, and 1 MCP server. Tool support expanded to include experimental support for Kiro and GitHub Copilot via conversion.

**Competitive threat level: LOW-MEDIUM.** Growth has slowed. The learning/compounding loop remains its strongest differentiator, but hatch3r's learning system provides comparable functionality. Compound Engineering's conversion-based multi-tool support produces lower-quality output than hatch3r's native adapters.

---

### 2.5 OpenCode

- Repository: https://github.com/sst/opencode (now github.com/anomalyco/opencode)
- **Stars: ~114,000** (up from ~110,000, +4%)
- Contributors: 460+
- **Latest release: v1.2.15** (February 2026)

**What changed since last analysis:**

OpenCode continues its dominant position as the highest-starred open-source coding agent. Note: the repository appears to have moved from `sst/opencode` to `anomalyco/opencode`. The Weave plugin (see 2.10) has emerged as the leading multi-agent orchestration layer for OpenCode, validating hatch3r's strategy of providing methodology on top of OpenCode's execution engine.

**Competitive threat level: LOW (complementary).** OpenCode is an execution engine, not a methodology framework. hatch3r's OpenCode adapter makes it complementary. The emergence of OpenCode-specific plugins (Weave) confirms the opportunity for hatch3r to serve OpenCode's massive user base.

---

### 2.6 SkillKit

- Repository: https://github.com/rohitg00/skillkit
- **Stars: 382** (up from 372)
- Latest: v0.4.0 on PyPI

**What changed since last analysis:**

SkillKit has integrated skills.sh as a first-class registry and added Chrome Web Store support. The project remains a Python library focused on skill distribution rather than full framework orchestration.

**Competitive threat level: LOW.** SkillKit solves distribution, not methodology. Potential integration partner rather than competitor.

---

### 2.7 AgentSys (NEW)

- Repository: https://github.com/avifenesh/agentsys
- **Stars: 376**
- Created: January 15, 2026
- Latest release: v5.0.0 (February 2026)
- License: MIT

**Overview:** AgentSys is a modular runtime and orchestration system for AI agents with 12 plugins, 41 agents, and 27 skills. It handles task selection, branch management, code review, CI/CD, and deployment through structured pipelines with phase gates. Originally named "awesome-slash."

**Key features:**
- Structured pipelines with phase gates for ordered execution
- Persistent state across sessions
- Certainty-graded findings (HIGH/MEDIUM/LOW)
- Commands: `/next-task`, `/ship`, `/drift-detect`, `/audit-project`
- Uses deterministic detection (regex, AST, static analysis) combined with LLM judgment — claims 77% token reduction vs. multi-agent approaches
- 3,357 tests, 75 releases, 26k lines of library code

**Tool support:** Claude Code, OpenCode, Codex CLI.

**Competitive threat level: LOW-MEDIUM.** Small but technically sophisticated. The hybrid deterministic+LLM approach and extensive test coverage are notable. Its 41 agents and 27 skills make it feature-rich, but narrow tool support (3 tools) limits reach. The token efficiency claim is worth investigating.

---

### 2.8 CrewSwarm (STALLED)

- Website: https://crewswarm.ai/ (not indexed by search engines as of March 2026)
- Status: **Stalled / Unverifiable**

**Overview:** CrewSwarm was described as a runtime-based multi-agent orchestrator using a WebSocket message bus for daemon-based orchestration. It featured PM-led task breakdown, targeted dispatch to specialized agents, and Dead Letter Queue fault recovery.

**March 2026 status check:** Web searches return no results for crewswarm.ai. The site is not indexed by search engines and no GitHub repository, release notes, or community activity can be found. CrewSwarm may have been a pre-launch product, a rebrand, or a project that did not gain traction.

**Competitive threat level: NONE (downgraded from MEDIUM).** No verifiable public presence. Removed from active competitor tracking. Will re-evaluate if the project resurfaces.

---

### 2.9 Crux (STALLED)

- Website: https://runcrux.dev/ (unverifiable as of March 2026)
- Repository: https://github.com/err/crux (not found in GitHub search)

**Overview:** Crux was described as a multi-agent AI orchestrator with a distinctive three-layer memory system (markdown memory bank, SQLite FTS5, vector search via chromem-go). Built in Go as a single binary, it required zero infrastructure.

**March 2026 status check:** Web searches for "runcrux.dev" and "github.com/err/crux" return no relevant results. The GitHub repository is not found in search, and the website is not indexed. Multiple searches for "Crux AI agent orchestrator" return unrelated products (GetCrux for ad analytics, Crux Climate, Crux Security). The project appears to have been removed, renamed, or never reached public availability.

**Competitive threat level: NONE (downgraded from LOW-MEDIUM).** No verifiable public presence. The three-layer memory concept remains technically relevant (see Crux's influence on gap analysis in section 5.3), but the implementation cannot be evaluated. Removed from active competitor tracking.

---

### 2.10 Weave (NEW)

- Website: https://tryweave.io/
- Repository: https://github.com/pgermishuys/opencode-weave
- npm: `@opencode_weave/weave` v0.6.0
- License: MIT

**Overview:** Weave is a lean OpenCode plugin providing 8 specialized agents with a Plan-Review-Execute workflow. It focuses specifically on the OpenCode ecosystem.

**Key features:**
- 8 agents with weaving-themed names (Loom, Tapestry, Shuttle, Pattern, Thread, Spindle, Weft, Warp)
- Plan → Review → Execute workflow with checkpoint-based resumption
- Context window monitoring with automatic token tracking (80% warning, 95% recovery)
- Per-agent tool permissions
- Skills injection via markdown
- Zero-config with optional deep customization via JSONC
- Session resilience for interrupted work

**Competitive threat level: MEDIUM.** Weave validates hatch3r's strategy of providing methodology for OpenCode users. However, Weave is OpenCode-only and lacks board management, learning loops, or multi-tool support. hatch3r should monitor Weave's growth as it competes for the same OpenCode methodology niche.

---

### 2.11 Ruflo / Claude Flow (NEW — SIGNIFICANT)

- Repository: https://github.com/ruvnet/ruflo (formerly claude-flow)
- **Stars: ~29,000** (up from 18,540, +57%)
- Contributors: 20+
- Latest release: v3.5.0+ (2026)
- Releases: 1,456+
- License: MIT

**Overview:** Ruflo (formerly Claude Flow) is an enterprise-grade multi-agent orchestration platform that has grown rapidly to ~29k stars. It now coordinates 100+ specialized agents across swarm topologies with 215 MCP tools.

**Key features:**
- 60+ specialized agents using swarm coordination
- Hierarchical, mesh, ring, and star topologies
- Distributed consensus protocols (Raft, Byzantine Fault Tolerance, CRDT)
- Self-Optimizing Neural Architecture (SONA) for intelligent task routing
- 215 MCP tools
- Claims 2.5x Claude Code usage extension through tiered complexity routing
- Self-learning memory system

**Competitive threat level: HIGH (sustained).** Ruflo's continued rapid growth (~29k stars, +57% since last analysis) and enterprise-grade features make it a formidable competitor. Its 100+ agents dwarf most competitors. However, it remains Claude Code-specific, which limits cross-tool reach. hatch3r's multi-tool adapter approach remains differentiated. The key risk: if Ruflo adds multi-tool support, its feature depth + community size would be formidable.

---

### 2.12 Axon (NEW)

- Repository: https://github.com/axon-core/axon
- **Stars: 35**
- Created: February 2026
- Latest release: v0.11.0
- Language: Go
- License: Apache 2.0

**Overview:** Axon is a Kubernetes-native framework for orchestrating AI agents as scalable workloads. It uses Tasks, Workspaces, AgentConfigs, and TaskSpawners to manage agent lifecycles triggered by GitHub events or cron schedules.

**Competitive threat level: LOW.** Early-stage, enterprise/DevOps-focused. Operates in a different niche (K8s runtime orchestration) than hatch3r (developer methodology).

---

### 2.13 awesome-cursorrules

- Repository: https://github.com/PatrickJS/awesome-cursorrules
- **Stars: 38,207**
- Forks: 3,228
- Contributors: 70

**Status:** Continues to serve as the primary community resource for Cursor rules. A related project, `awesome-cursor-rules-mdc` by sanjeed5, has 3,336 stars focusing on the newer `.mdc` format. These are curated lists, not frameworks, but represent significant community mindshare.

---

## 3. Standards and Ecosystem Updates

### 3.1 AGENTS.md Specification

**Status: AAIF governance under Linux Foundation (since December 9, 2025)**

- Co-founded by Anthropic, Block, and OpenAI
- Platinum members: AWS, Google, Microsoft, Bloomberg, Cloudflare
- Three founding projects: MCP (Anthropic), goose (Block), AGENTS.md (OpenAI)
- **Adopted by 60,000+ open-source projects** as of February 2026
- Supported by 20+ AI tools
- Functions as "greatest common denominator" standard — tool-specific files handle platform differences

**Implication for hatch3r:** AGENTS.md is now the industry standard for agent instructions. hatch3r already generates AGENTS.md as a bridge file for OpenCode, Amp, and Codex. Its canonical `/.agents/AGENTS.md` aligns perfectly with this standard. The AAIF governance ensures long-term stability of this format.

### 3.2 MCP Protocol

**Current spec: 2025-11-25** (date-based versioning, only increments on breaking changes)

- 70+ client applications
- **10,000+ active MCP servers**
- **97 million+ monthly SDK downloads**
- Governed by AAIF under Linux Foundation
- Key features: structured tool output, resource links, elicitation, OAuth Resource Server classification
- JSON-RPC 2.0 based

**Implication for hatch3r:** MCP has achieved massive adoption. hatch3r's MCP configuration template (10 servers, 3 default + 7 opt-in) is a competitive advantage. The ecosystem growth means more MCP servers for hatch3r to integrate.

### 3.2a MCP Server Cards (June 2026 Spec — NEW)

**Status: Upcoming specification (June 2026)**

The MCP June 2026 specification introduces **Server Cards** — a standardized metadata format that allows MCP servers to advertise their capabilities, configuration requirements, authentication methods, and trust signals to clients. Server Cards are the MCP equivalent of OpenAPI's info/servers blocks, providing machine-readable discovery and compatibility information.

**Key Server Card fields (anticipated):**
- **Identity:** Server name, version, author/publisher, description, homepage URL
- **Capabilities:** Advertised tools, resources, and prompts with schema definitions
- **Authentication:** Required auth methods (OAuth, API key, none), token endpoint, scopes
- **Configuration:** Required and optional environment variables, default values, validation rules
- **Trust signals:** Verification status, publisher verification, security audit indicators
- **Compatibility:** Supported MCP protocol versions, minimum client requirements

**hatch3r Server Cards support plan:**

1. **MCP config generation (adapters):** Each adapter's MCP configuration output should include Server Card metadata for hatch3r's recommended MCP servers. When a user runs `hatch3r init` and selects MCP servers, the generated config should embed or reference Server Cards for each server, enabling clients to validate compatibility and display trust information.

2. **Server Card validation (validate command):** The `hatch3r validate` command should verify that MCP server configurations reference valid Server Cards and that required configuration fields (env vars, auth) match the Card's requirements.

3. **Server Card discovery (init flow):** During `hatch3r init`, the MCP server selection step should display Server Card metadata (description, auth requirements, trust status) to help users make informed selections.

4. **Adapter-specific formatting:** Each adapter should format Server Card references according to the tool's MCP configuration format (e.g., `mcp.json` for Claude Code, `.vscode/mcp.json` for Copilot, `.kiro/settings/mcp.json` for Kiro).

5. **Timeline:** Implementation should begin when the June 2026 spec is finalized, with target completion within 30 days of spec publication. Early adoption of Server Cards is a competitive differentiator — no competitor currently plans Server Card support.

**Implication for hatch3r:** Server Cards align perfectly with hatch3r's MCP configuration generation. Being an early adopter strengthens the "deepest native integration" positioning. The validate command's MCP verification capability can be extended to Server Card validation, providing a unique quality assurance feature.

### 3.3 Tool Updates Summary

| Tool | Latest Version | Key 2026 Changes |
|------|---------------|-----------------|
| **Cursor** | v2.4 | Subagents, Skills, Long-running agents (research preview), Image generation, Cursor Blame (Enterprise) |
| **GitHub Copilot** | Jan 2026 release | Agent mode GA, Copilot Edits GA, Next Edit Suggestions, Vision, Project Padawan (autonomous SWE agent), Skills and orchestrations |
| **Claude Code** | v2.1.63 | 2.0: Multi-agent orchestration, persistent memory, Team mode ($40/user/mo), Remote Control (phone), Agent Teams (research preview), Opus 4.6 (1M context beta) |
| **OpenCode** | v1.2.15 | ~114k stars, repository moved to anomalyco/opencode |
| **Windsurf** | Wave 5+ | Flow feature, AST-based semantic search, voice input, GPT-5 and Gemini 3 Flash support, JetBrains support |
| **Amp** | CLI-only | VS Code/Cursor extensions discontinued March 5, 2026. CLI-only focus. GPT-5.3-Codex deep mode |
| **Codex CLI** | v0.107.0 | Sub-agent thread forking, configurable memories, multimodal custom tool outputs, realtime audio |
| **Gemini CLI** | v0.31.0 | Plan mode enhancements, browser agent (experimental), policy engine expansion, Gemini 3.1 Pro Preview |
| **Cline** | v3.73.0 (~59.1k stars) | Plan/Act modes, CLI 2.0 with `--acp` flag (ACP-compliant agent), SDK for embedding, 5M+ installs, multi-provider support |
| **Roo Code** | v3.50.4 | 5 modes (Code, Architect, Debug, Ask, Custom), Boomerang Tasks, Cloud Agents ($5/hr), 22.3k+ stars |
| **Kiro** | GA (v0.9.40+) | GovCloud availability, Kiro Powers (IAM Autopilot, Observability), property-based testing, Kiro CLI, team plans, **enterprise SSO** (Okta, Microsoft Entra ID, AWS IAM Identity Center) across IDE/CLI/web, agent hooks, SCIM provisioning, admin console with prompt logging and usage reports |

**Critical tool ecosystem shifts:**
1. **Amp abandoned IDE extensions** — validates CLI-first approaches but also means hatch3r's Amp adapter now targets CLI-only users
2. **Claude Code 2.0 added native multi-agent orchestration** — hatch3r's agent orchestration rule must evolve to complement rather than replace this
3. **Cursor subagents are now native** — hatch3r's sub-agentic architecture aligns well with Cursor's new capabilities
4. **Kiro reached GA with CLI and enterprise SSO** — hatch3r's Kiro adapter is now serving a GA product with growing enterprise adoption. Kiro's Okta/Entra ID SSO does not affect configuration generation (SSO is transparent to steering files), but enterprise teams may require adapter-generated configs to be compatible with team-managed steering directories
5. **Cline CLI 2.0 with ACP** — Cline's `--acp` flag makes it an ACP-compliant agent, and the SDK enables embedding. Plan/Act mode separation validates hatch3r's research-then-implement pipeline pattern
6. **ACP Agent Registry launched** — JetBrains and Zed jointly launched the ACP Agent Registry (Jan 28, 2026), standardizing how agents integrate with editors. Goose and Cline are both ACP-compatible, validating adapter investment in both
7. **Goose ACP-over-HTTP transition** — Goose is replacing its custom streaming API with ACP-over-HTTP for client portability. hatch3r's Goose adapter profile generation already includes ACP config

---

## 4. Feature Comparison

### 4.1 Framework Capabilities Matrix (Updated March 18, 2026)

*Note: Crux column retained for historical reference but project is stalled (see section 2.9).*

| Feature | hatch3r | GSD | Superpowers | Compound Eng. | BMAD | Ruflo | AgentSys | ~~Crux~~ |
|---------|---------|-----|-------------|---------------|------|-------|----------|------|
| Agents | 16 | 11 | ~5 | 29 | 12+ | 60+ | 41 | ~~Plugin-based~~ |
| Skills | 25 | N/A | 14+ | 19 | 34+ | N/A | 27 | ~~N/A~~ |
| Rules/Standards | 22 | N/A | TDD rules | Configurable | Scale-adaptive | N/A | N/A | ~~N/A~~ |
| Commands | 34 | 27+ | 4-5 | 22 | 34+ | N/A | 4 | ~~N/A~~ |
| MCP Servers | 10 | N/A | MCP server | 1 | N/A | 215 | N/A | ~~N/A~~ |
| **Tool Adapters** | **14 native** | 3 (+community) | 1 + MCP | 8 (conversion) | 28 (template-based) | 1 | 3 | ~~3~~ |
| Sub-agent Support | Yes | Yes | Yes | Yes | No | Yes (swarm) | Yes | ~~Yes~~ |
| Board/Project Mgmt | **Yes (GH Projects V2)** | Milestones | No | No | No | No | No | ~~No~~ |
| Learning Loop | Yes | No | No | Yes | No | Yes (SONA) | No | Yes (3-layer) |
| Event-Driven Hooks | Yes (6 hooks) | No | No | No | No | Yes | No | No |
| TDD Support | Yes | Yes (post-phase) | Yes (core) | No | No | N/A | No | No |
| Security Coverage | OWASP Top 10 | No | No | No | No | No | No | Yes (4-tier) |
| Cost Tracking | Yes | Yes | No | No | No | No | No | No |
| Context Health | Yes | Yes (core) | Discrete tasks | No | No | Yes | No | Yes |
| Recipe System | Yes | No | No | No | No | No | No | No |
| Persistent Memory | Yes (learnings) | STATE.md | No | Yes (compound) | No | Yes | Yes | Yes (3-layer) |
| CI/CD Integration | Via GitHub agents | Git state | No | No | No | No | Yes | No |

### 4.2 Tool/IDE Support Matrix (Updated March 2026)

| Tool | hatch3r | GSD | Superpowers | Compound Eng. | BMAD | Ruflo | AgentSys |
|------|---------|-----|-------------|---------------|------|-------|----------|
| Cursor | **Native adapter** | Community | MCP | Convert | Template | No | No |
| Claude Code | **Native adapter** | Primary | Primary | Primary | Template | Primary | Primary |
| GitHub Copilot | **Native adapter** | No | No | Convert | Custom installer | No | No |
| OpenCode | **Native adapter** | Supported | Supported | Convert | Template | No | Supported |
| Windsurf | **Native adapter** | No | MCP | No | Template | No | No |
| Codex | **Native adapter** | No | Docs | Convert | Custom installer | No | Supported |
| Gemini CLI | **Native adapter** | Supported | No | Convert | Template | No | No |
| Cline/Roo Code | **Native adapter** | No | No | No | Template | No | No |
| Amp | **Native adapter** | No | No | No | Template | No | No |
| Aider | **Native adapter** | No | No | No | No | No | No |
| Kiro | **Native adapter** | No | No | Convert | Template | No | No |
| Goose | **Native adapter** | No | No | No | No | No | No |
| Zed | **Native adapter** | No | No | No | No | No | No |

**hatch3r has the deepest native tool integration in the market at 15 adapters.** BMAD v6.2.0 claims 28 tool configurations, but these are template-based prompt file generation (verified March 18, 2026 — see section 2.3). hatch3r generates deeply native, tool-specific configurations that leverage each platform's unique features. The nearest native-depth competitor is Compound Engineering with 8 tools via conversion (not native generation).

### 4.3 GitHub Stars Comparison (April 2, 2026)

| Framework | Stars | Growth (since Mar 18) | Category |
|-----------|-------|---------------------|----------|
| Superpowers | **~130,000** | **+48,000 (+59%)** | Methodology |
| OpenCode | ~114,000 | ~stable | Agent runtime |
| **GitHub Spec Kit** | **~84,000** | **NEW** | **Methodology** |
| Cline | ~59,100 | ~stable | IDE extension / Agent |
| BMAD | ~41,200 | ~stable | Methodology |
| awesome-cursorrules | 38,207 | ~stable | Curated list |
| Goose | ~33,200 | ~stable | Agent runtime |
| GSD | ~32,000 | ~stable | Methodology |
| Ruflo | **~29,000** | **+10,460 (+57%)** | Orchestration |
| Roo Code | 22,300+ | ~stable | IDE extension |
| SWE-agent | 18,500+ | N/A | Academic |
| Compound Eng. | ~9,700 | ~stable | Methodology |
| SkillKit | 382 | ~stable | Distribution |
| AgentSys | 376 | ~stable | Orchestration |
| Axon | 35 | ~stable | K8s orchestration |
| ~~CrewSwarm~~ | N/A | Stalled — no public presence | ~~Orchestration~~ |
| ~~Crux~~ | N/A | Stalled — repo/site not found | ~~Orchestration~~ |
| **hatch3r** | **N/A** | — | **Methodology + adapters** |

**Combined competitor stars: 332k+** (Superpowers + Spec Kit + BMAD + GSD + Ruflo + Compound Eng. methodology frameworks only). This represents an existential community gap for hatch3r.

---

## 5. Gap Analysis (Updated)

### 5.1 Community Traction — CRITICAL

**Status: OPEN (unchanged, severity escalated)**

hatch3r has no published GitHub star count. The gap is now existential: combined competitor stars exceed 332k+ (Superpowers ~130k, GitHub Spec Kit ~84k, BMAD ~41k, GSD ~32k, Ruflo ~29k, Compound Eng. ~10k — methodology frameworks only). GitHub Spec Kit emerged with ~84k stars and GitHub backing. Superpowers surged to ~130k stars with v5.0. Without community presence, hatch3r cannot attract contributors, generate documentation, or build trust. Every week of delay compounds competitor moats.

### 5.2 Multi-Agent Runtime Orchestration — OPEN

**Status: OPEN (scope narrowed)**

The emergence of orchestration frameworks (Ruflo, Weave, AgentSys) signals that multi-agent runtime coordination is now a distinct product category. *Note: CrewSwarm and Crux, previously listed here, have stalled with no verifiable public presence as of March 2026 — reducing the original "five new frameworks" to three active entrants.* hatch3r's agent orchestration rule and sub-agentic architecture provide methodology-level orchestration (defining how agents should coordinate), but not runtime orchestration (actually running and coordinating multiple agents simultaneously). Claude Code 2.0's native multi-agent orchestration, Cursor 2.4's subagents, and the ACP protocol (adopted by Cline CLI 2.0 and Goose) have partially closed this gap at the tool level, but hatch3r does not yet integrate with or augment these capabilities.

### 5.3 Three-Layer Memory / Advanced Persistence — OPEN

**Status: OPEN (partially de-risked)**

Crux's three-layer memory system (markdown + SQLite FTS5 + vector search) was identified as a sophisticated competitor approach, but Crux's project status is now unverifiable (see section 2.9). Ruflo's self-learning SONA architecture remains the primary benchmark for advanced persistence. While hatch3r's learning system is functional, it lacks full-text search indexing, semantic/vector search, and cross-session memory graphs. Compound Engineering's learnings researcher also performs deeper mining than hatch3r's rule-driven consultation. The de-risking is that the leading implementor (Crux) appears inactive, reducing near-term competitive pressure on this gap.

### 5.4 Benchmarking and Validation — OPEN (specification developed)

**Status: OPEN (benchmark specification developed, execution pending)**

No execution progress, but a benchmark specification has been developed (D17 finding #90). The benchmark is critical for proving hatch3r's "deepest native integration" claim against competitors who now match or exceed hatch3r on tool count (GitHub Spec Kit 20+, BMAD 28 template-based, Superpowers 6 native).

**Benchmark Specification: Native Output Quality Comparison**

**Objective:** Quantitatively demonstrate that hatch3r's native adapter output produces higher-quality, more tool-specific configurations than competitor approaches (template-based generation, conversion-based output, or manual configuration).

**Methodology:**

1. **Test matrix:** Select 5 representative tools (Cursor, Claude Code, Copilot, Kiro, OpenCode) and 3 project archetypes (web app, CLI tool, monorepo).

2. **Configuration generation:** For each tool x project combination, generate configurations using:
   - hatch3r (native adapter)
   - BMAD (template-based, 28-tool claim)
   - Superpowers v5.0 (6-tool native)
   - GitHub Spec Kit (20+ tools)
   - Manual setup (expert baseline)

3. **Quality dimensions scored (1-5 each):**
   - **Tool-specific feature utilization:** Does the config leverage tool-specific features? (e.g., Cursor `.mdc` frontmatter scoping, Claude Code hook events, Kiro steering format, Copilot instruction priorities)
   - **Completeness:** Does the config cover agents, skills, rules, MCP, and tool-specific primitives?
   - **Correctness:** Does the config parse and load without errors in the target tool?
   - **Customization preservation:** Does update/sync preserve user customizations?
   - **Cross-reference integrity:** Do generated files correctly reference each other?

4. **Automated validation:** For each generated config:
   - Lint/parse validation (tool-specific schema validation where available)
   - File structure validation (correct paths, correct formats)
   - Cross-reference check (referenced files exist, IDs match)
   - Feature coverage count (how many tool-specific features are utilized)

5. **Agent task quality (stretch goal):** Run identical coding tasks with and without generated configs:
   - Measure: time-to-first-correct-PR, review iteration count, code quality metrics (linting, type errors, test coverage)
   - Tools: SWE-bench-lite subset or custom task suite

**Success criteria:** hatch3r native adapters should score >= 4.0/5.0 on tool-specific feature utilization for all 5 test tools, and >= 3.5/5.0 on all other dimensions. Template-based competitors should score <= 3.0/5.0 on tool-specific feature utilization, validating the "depth vs. breadth" positioning.

**Effort:** High (4-6 weeks for full execution). Phase 1 (automated validation only) can be completed in 2 weeks.

**Publication plan:** Results published as a blog post on hatch3r.dev with reproducible methodology. Raw data and scripts open-sourced for independent verification.

### 5.5 Documentation and Onboarding — PARTIALLY CLOSED

**Status: PARTIALLY CLOSED (documentation site shipped)**

BMAD has docs.bmad-method.org. GSD has gsd.build. Superpowers has blog guides. Weave has tryweave.io. *(Crux's runcrux.dev and CrewSwarm's crewswarm.ai are no longer reachable as of March 2026.)* hatch3r now has a documentation site at [docs.hatch3r.com](https://docs.hatch3r.com) with getting-started guides, reference docs, and troubleshooting. Remaining gaps: landing page, tutorials, and video walkthroughs.

### 5.6 Plugin Distribution — OPEN

**Status: OPEN (unchanged)**

Superpowers and Compound Engineering distribute through Claude Code plugin marketplace. Weave distributes through npm as an OpenCode plugin. hatch3r has a Cursor plugin manifest but no confirmed marketplace presence for Claude Code or other platforms.

### 5.7 Token Efficiency — NEW GAP

**Status: OPEN (new)**

AgentSys claims 77% token reduction vs. multi-agent approaches through hybrid deterministic+LLM detection (regex, AST, static analysis combined with LLM judgment). Ruflo claims 2.5x Claude Code usage extension through tiered complexity routing. hatch3r's cost-tracking command monitors costs but does not actively optimize token usage. As API costs remain significant, token efficiency is becoming a competitive differentiator.

### 5.8 Previously Closed Gaps — CONFIRMED CLOSED

The following gaps identified in the previous analysis remain closed:
- Learning and Compounding (hatch3r-learn + auto-consultation rule)
- Methodology Depth (hatch3r-workflow with 4-phase lifecycle)
- Cost Awareness (hatch3r-cost-tracking)
- Event-Driven Automation (hatch3r-hooks with 6 hook definitions covering major development lifecycle events)
- Context Management (hatch3r-context-health, though advisory not architectural)

---

## 6. Competitive Positioning Matrix

### 6.1 hatch3r Unique Differentiators (What No Competitor Offers)

| Differentiator | Details | Nearest Competitor |
|---------------|---------|-------------------|
| **14 native tool adapters** | Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex, Gemini, Cline, Aider, Kiro, Goose, Zed, Antigravity | Compound Eng. (8 via conversion) |
| **GitHub Projects V2 board management** | board-init, board-fill, board-groom, board-pickup, board-refresh with dependency DAG, collision detection, sub-agent orchestration | GSD (milestones only) |
| **Canonical source architecture** | Single `/.agents/` source of truth with adapter-based generation | SkillKit (auto-translate, but skill-only) |
| **OWASP Agentic Top 10 security coverage** | Security patterns rule with AI/agentic-specific security | None active *(Crux had 4-tier permissions but project is stalled)* |
| **Recipe system** | Composable, shareable workflow templates | None |
| **Board-to-PR pipeline** | End-to-end: issue → branch → implementation → review loop → PR → status sync | None |
| **14-tool adapter + board + learning loop** | No competitor combines all three capabilities | None |

### 6.2 Where Competitors Lead

| Feature | Leader | hatch3r Gap |
|---------|--------|------------|
| Community traction | Superpowers (~130k), OpenCode (114k), GitHub Spec Kit (~84k), Cline (~59k), BMAD (~41k), Goose (~33k), GSD (~32k), Ruflo (~29k) | No published star count; 332k+ combined competitor stars |
| Tool breadth (count) | BMAD (28 template-based), GitHub Spec Kit (20+), Superpowers (6 native) | 15 native adapters (deeper integration) |
| Agent count | Ruflo (100+), AgentSys (41) | 16 agents |
| Multi-agent runtime | Ruflo (swarm), Weave (OpenCode plugin) | Advisory orchestration only. *(CrewSwarm and Crux stalled.)* |
| MCP tool count | Ruflo (215) | 10 MCP servers |
| Context rot prevention | GSD (architectural, fresh 200k windows) | Advisory only |
| Plugin marketplace distribution | Superpowers, Compound Eng. (Claude Code marketplace) | No confirmed marketplace presence |
| Documentation site | BMAD (docs.bmad-method.org), GSD (gsd.build) | docs.hatch3r.com shipped; landing page and tutorials still missing |
| Token efficiency | AgentSys (77% reduction), Ruflo (2.5x extension) | Cost tracking only, no active optimization |
| Enterprise features | Roo Code (SOC 2), Kiro (GovCloud), Cursor (Blame), GitHub Spec Kit (GitHub-native) | None |
| Persistent memory depth | Ruflo (SONA). *(Crux 3-layer was notable but project is stalled.)* | Markdown-only learnings |
| GitHub-native integration | GitHub Spec Kit (deep platform integration) | GitHub via MCP only |

---

## 7. Structured Findings

### Severity Legend
- **S1 (Critical):** Existential threat or blocking gap — must address within 30 days
- **S2 (High):** Significant competitive disadvantage — address within 60 days
- **S3 (Medium):** Meaningful gap that affects positioning — address within 90 days
- **S4 (Low):** Minor gap or future consideration — address within 6 months

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| 1 | **S1** | Distribution | hatch3r has zero marketplace presence (Claude Code, Cursor, npm registry visibility) while Superpowers and Compound Engineering are in Claude Code marketplace and Weave is an npm OpenCode plugin | Package hatch3r as a Claude Code plugin, formalize Cursor marketplace listing, publish as OpenCode plugin, ensure npm discoverability | Medium (2-3 weeks) |
| 2 | **S1** | Community | No published GitHub star count; competitor stars total 300k+. GSD grew 34% in 8 days. Ruflo reached 18.5k from zero in 10 months | Open-source the repo publicly, actively promote on social media, dev communities, and forums. Create GitHub Discussions. Target OpenCode community first (114k potential users) | Low effort, high ongoing investment |
| 3 | **S2** | Documentation | Documentation site shipped at docs.hatch3r.com. Remaining gaps: landing page, tutorials, and video content | Add landing page, create tutorial content, and produce video walkthroughs. Downgraded from S1 since docs site now exists | Low-Medium (1-2 weeks) |
| 4 | **S2** | Multi-Agent Runtime | Three active orchestration frameworks (Ruflo, Weave, AgentSys) plus ACP protocol adoption (Cline CLI 2.0, Goose). Claude Code 2.0 and Cursor 2.4 added native multi-agent features. *(CrewSwarm and Crux stalled — reduced from five to three active entrants.)* hatch3r's orchestration is advisory/methodological, not runtime | Integrate with Claude Code Agent Teams and Cursor subagents at the adapter level. Generate tool-native multi-agent configurations. Consider optional runtime coordination layer for CLI-based tools | High (4-6 weeks) |
| 5 | **S2** | Memory/Persistence | Ruflo's SONA outclasses hatch3r's markdown-only learnings. *(Crux's 3-layer memory was notable but the project is stalled and unverifiable.)* | Upgrade learning system to support full-text search indexing and semantic similarity matching for learning consultation. Consider SQLite-based learning storage | Medium (3-4 weeks) |
| 6 | **S2** | Tool Ecosystem | Amp discontinued IDE extensions (CLI-only as of March 5). Kiro reached GA with CLI. OpenCode may have moved repos. Claude Code 2.0 significantly changed capabilities | Verify all 15 adapters produce correct output for current tool versions. Update Amp adapter for CLI-only target. Enhance Claude Code adapter for 2.0 features (multi-agent, persistent memory). Validate Kiro adapter against GA release | Medium (2-3 weeks) |
| 7 | **S2** | GSD Growth | GSD grew 34% in 8 days (17.3k → 23.1k). Added YAML frontmatter sync, post-phase testing, requirements tracking. Closing feature gap with hatch3r | Monitor GSD's feature trajectory. Ensure hatch3r's YAML/machine-readable metadata is equally accessible. Consider structured frontmatter sync in board commands | Low (1 week) |
| 8 | **S3** | Token Efficiency | AgentSys claims 77% token reduction via hybrid deterministic+LLM approach. Ruflo claims 2.5x usage extension. hatch3r tracks costs but doesn't optimize | Add token-aware agent selection to board-pickup (route simple tasks to cheaper models). Consider deterministic pre-screening before LLM invocation in review/audit agents | Medium (3-4 weeks) |
| 9 | **S3** | Adapter Count vs. Depth | hatch3r leads with 15 adapters, but some (Aider, Goose, Zed) may be shallow. Competitor adapters for fewer tools may be deeper. Claude Code 2.0, Cursor 2.4, and Kiro GA introduced features that adapters may not yet leverage | Audit adapter depth for all 15 tools. Ensure each adapter leverages tool-specific features (Cursor subagents, Claude Code hooks, Kiro Powers, Roo Code Custom Modes). Prioritize depth for top-3 tools by usage | Medium (2-3 weeks) |
| 10 | **S3** | New Entrant Monitoring | Ruflo grew to 18.5k stars in ~10 months. Weave and AgentSys launched in early 2026. *(CrewSwarm and Crux stalled — validates need for verification.)* Cline CLI 2.0 and Goose ACP adoption represent significant new competitive surface. The competitive landscape is moving faster than quarterly analysis can capture | Establish a monthly competitive monitoring cadence. Track star counts, release velocity, and feature additions for top 10 competitors. Verify project liveness before investing analysis effort. Automate where possible | Low (ongoing) |
| 11 | **S3** | Enterprise Features | Roo Code has SOC 2 compliance, Kiro has GovCloud, Cursor has Blame (AI attribution). Enterprise adoption increasingly requires compliance features | Define enterprise roadmap: team rules, shared configurations, usage analytics, audit logging. SOC 2 is likely premature but compliance documentation is not | Medium (4-6 weeks) |
| 12 | **S3** | BMAD Tool Breadth | BMAD v6.2.0 claims 28 tool configurations (verified March 18, 2026 — template-based, not native-depth). BMAD has surpassed hatch3r on tool count but not integration depth. Kiro, Antigravity, Trae, iFlow, QwenCoder, Rovo Dev among additions | Reposition from "widest tool support" to "deepest native integration across the most tools." Ensure hatch3r's adapters leverage tool-specific features BMAD's templates cannot. Prioritize adapter depth for top-5 tools | Medium (2-3 weeks) |
| 13 | **S4** | awesome-cursorrules | 38.2k stars for a curated rules list. This community resource drives Cursor rules adoption but isn't a framework competitor | Consider contributing hatch3r rules to awesome-cursorrules and awesome-cursor-rules-mdc (3.3k stars) for visibility. Cross-reference in documentation | Low (1-2 days) |
| 14 | **S4** | Benchmark Suite | No progress on benchmarking. SWE-bench is standard for agent runtimes but no standard exists for methodology frameworks | Design a custom benchmark: measure time-to-first-PR, code quality metrics, and review iteration counts with vs. without hatch3r. Publish results | High (4-6 weeks) |
| 15 | **S4** | Weave Competition in OpenCode | Weave is gaining traction as the de facto multi-agent plugin for OpenCode. If Weave adds board management or learning loops, it could directly compete for OpenCode users | Position hatch3r's OpenCode adapter as complementary to Weave (hatch3r provides methodology + board management, Weave provides runtime orchestration). Consider explicit Weave compatibility | Low (1 week) |

---

## 7a. Adapter Compatibility Analysis (March 18, 2026)

### 7a.1 Kiro Enterprise Auth (Okta, Entra ID) — Adapter Impact Assessment

**Finding:** D17-18 — Kiro now supports enterprise SSO with Okta and Microsoft Entra ID across IDE, CLI, and web (since v0.9.40, February 12, 2026). Developers authenticate via browser-based OAuth flow, and user/group synchronization happens through SCIM provisioning.

**Adapter impact:** **Minimal / No changes required.** Kiro's enterprise SSO is transparent to the configuration layer. The hatch3r Kiro adapter generates `.kiro/steering/*.md` files (steering documents) and `.kiro/settings/mcp.json` (MCP server configs). These are project-level files that do not interact with Kiro's authentication system. Enterprise SSO affects how developers log in, not how steering files are structured or consumed.

**Potential considerations for enterprise teams:**
1. Enterprise-managed Kiro instances may enforce team-level steering directories. The adapter's output path (`.kiro/steering/`) is the correct standard location and will work in both individual and team contexts.
2. Admin consoles with prompt logging and usage reports are separate from config generation.
3. SCIM-provisioned groups do not affect steering file structure.

**Verdict:** hatch3r's Kiro adapter (`src/adapters/kiro.ts`) is compatible with Kiro's enterprise auth. No code changes needed. The adapter correctly targets `.kiro/steering/` and `.kiro/settings/mcp.json`, which are the standard Kiro configuration paths regardless of authentication method.

### 7a.2 Goose ACP Compatibility — Adapter Verification

**Finding:** D17-19 — Goose has grown to ~33.2k stars (v1.27.2, March 6, 2026) and is a confirmed ACP-compatible agent available in the ACP Agent Registry (launched January 28, 2026 by JetBrains and Zed).

**ACP status:** Goose is production-ready for ACP. It can be configured in `acp.json` with its command path and `"acp"` argument. Goose is also actively transitioning from its custom streaming API to ACP-over-HTTP (tracked in github.com/block/goose/issues/6642) for better client portability.

**Adapter compatibility:** **Already compatible.** The hatch3r Goose adapter (`src/adapters/goose.ts`) generates:
1. `.goosehints` — main instructions file (standard Goose format, unaffected by ACP)
2. `.goose/mcp.json` — MCP server configuration (standard Goose format)
3. `.goose/profiles/hatch3r.yaml` — Goose profile with recipe interoperability and **ACP configuration already included** (`acp.enabled: true`, `acp.version: "0.2"`, capability advertisements)

The adapter already includes `GooseAcpConfig` interface with `enabled`, `version`, and `capabilities` fields. The `deriveAcpCapabilities()` method correctly advertises capabilities based on the project's agent configuration (code-generation, code-review, test-generation, security-audit, documentation, tool-use).

**Potential enhancement:** When Goose completes its ACP-over-HTTP transition, the `acp.version` field should be updated from `"0.2"` to match the new protocol version. This is a future consideration, not a current issue.

**Verdict:** hatch3r's Goose adapter is ACP-compatible. The profile generation already includes ACP configuration. No code changes needed.

### 7a.3 Cline Adapter — Plan/Act Modes, CLI 2.0, SDK Review

**Finding:** D17-21 — Cline has grown to ~59.1k stars with 5M+ installs. Key developments: v3.73.0 (March 16, 2026), CLI 2.0 with `--acp` flag, Plan/Act mode separation, SDK for embedding, and multi-provider support.

**Plan/Act mode compatibility:** Cline's Plan/Act modes are UI-level interaction patterns (Plan mode = analysis and planning, Act mode = execution with step-by-step approval). The hatch3r Cline adapter generates `.roomodes` (custom modes), `.roo/rules/` (rules), `.cline/skills/` (skills), and `.clinerules/workflows/` (workflow commands). These are consumed by both Cline and Roo Code and are compatible with Plan/Act mode switching — the generated custom modes define `roleDefinition` and `whenToUse` fields that inform the agent's behavior in both modes.

**CLI 2.0 compatibility:** Cline CLI 2.0 uses the same configuration format as the VS Code extension. The `.roomodes`, `.roo/rules/`, and `.cline/skills/` paths are read by both the extension and CLI. The `--acp` flag makes Cline CLI an ACP-compliant agent, which does not affect configuration file format.

**SDK compatibility:** The Cline SDK API enables embedding the Cline core engine in other applications. The adapter's output format (JSON for `.roomodes`, markdown for rules/skills) is consumed by the SDK the same way it's consumed by the extension.

**Configuration format update:** Roo Code now supports `.roomodes` in both JSON and YAML format (auto-detected). The adapter currently outputs JSON, which remains the fully supported format. No change required.

**Custom modes and rules paths:** The adapter correctly uses:
- `.roomodes` for custom agent modes
- `.roo/rules/{id}.md` for rules (preferred over legacy `.clinerules`)
- `.cline/skills/{id}/SKILL.md` for skills
- `.clinerules/workflows/{id}.md` for workflow commands
- `.roo/mcp.json` for MCP configuration

**Verdict:** hatch3r's Cline adapter (`src/adapters/cline.ts`) is compatible with Cline's current ecosystem including Plan/Act modes, CLI 2.0, and SDK. The adapter generates output in formats consumed by both the VS Code extension and CLI. No code changes needed.

---

## 8. Strategic Assessment

### 8.1 Is the Multi-Tool Adapter Approach Still the Right Bet?

**Verdict: YES, and the bet is strengthening.**

Three market signals validate the multi-tool adapter approach:

1. **Tool proliferation is accelerating, not consolidating.** Kiro reached GA, Amp pivoted to CLI-only, Gemini CLI shipped v0.31.0, Roo Code diverged from Cline with 5 custom modes, and OpenCode passed 114k stars. Developers are using more tools, not fewer. A developer might use Cursor for primary editing, Claude Code for complex refactors, and OpenCode for terminal workflows — all in the same week.

2. **AGENTS.md standardization under AAIF** validates the "single source, multiple outputs" model. The industry consensus is that AGENTS.md is the universal format, with tool-specific files for platform differences. This is exactly hatch3r's architecture: canonical `/.agents/AGENTS.md` with tool-specific adapters.

3. **No competitor matches hatch3r's native adapter depth.** BMAD v6.2.0 claims 28 tool configurations, but these are template-based prompt file generation — not deeply native integrations that leverage each tool's specific features (verified March 18, 2026). Compound Engineering supports 8 tools via conversion. hatch3r's 14 native adapters generate tool-specific configurations (Cursor `.mdc` rules, Claude Code hooks + skills, Copilot instructions, Kiro specs, etc.) that template approaches cannot replicate. The competitive positioning should shift from "most tools" to **"deepest native integration across the most tools."**

**Risk factors:**
- **BMAD's 28-tool claim changes the narrative.** hatch3r can no longer claim "widest tool support" by count alone. The differentiation must be on integration depth — native configurations that leverage tool-specific features vs. template-based prompt files.
- **Adapter maintenance burden grows linearly** with tool count. Each tool update (Claude Code 2.0, Cursor 2.4, Kiro GA) requires adapter verification and potential updates.
- **Depth vs. breadth tradeoff.** 15 adapters are impressive but useless if they don't leverage tool-specific features (Cursor subagents, Claude Code Agent Teams, Kiro Powers).

**Recommendation:** Maintain the multi-tool adapter strategy but shift emphasis from breadth (more adapters) to depth (leveraging each tool's latest features). Prioritize adapter depth for the top 5 tools by likely usage: Cursor, Claude Code, OpenCode, Copilot, Kiro.

### 8.2 Where Should hatch3r Invest Next?

**Priority 1 (Next 30 Days): Distribution and Visibility**
1. Open-source publicly and promote across developer communities
2. Publish to Claude Code plugin marketplace
3. Formalize Cursor marketplace listing
4. Create hatch3r.dev landing page + documentation site
5. Submit hatch3r rules to awesome-cursorrules for visibility

**Priority 2 (Next 60 Days): Adapter Depth and Multi-Agent Integration**
6. Audit and upgrade all 15 adapters for current tool versions
7. Integrate with Claude Code Agent Teams and Cursor subagents
8. Enhance Claude Code adapter for 2.0 features (persistent memory, multi-agent orchestration)
9. Validate Kiro adapter against GA release and Powers system
10. Update Amp adapter for CLI-only target

**Priority 3 (Next 90 Days): Advanced Memory and Token Efficiency**
11. Upgrade learning system with full-text search and semantic matching
12. Add token-aware agent selection (route tasks to appropriate model tiers)
13. Consider deterministic pre-screening to reduce token usage in review agents
14. Design custom benchmark for methodology framework effectiveness

**Priority 4 (Next 6 Months): Platform and Enterprise**
15. Define enterprise roadmap (team rules, audit logging, compliance documentation)
16. Explore OpenCode plugin distribution (position alongside Weave)
17. Monthly competitive monitoring cadence
18. Skill marketplace integration (SkillKit, Skill Creator AI)

### 8.3 Market Positioning Statement (Recommended)

> hatch3r is the only agentic coding framework that combines **deeply native configuration generation** for 15 AI coding tools, **multi-platform board management** (GitHub Projects V2, Azure DevOps, GitLab), and a **compounding learning loop** — from a single canonical source. Where Superpowers focuses on methodology depth for 6 tools and GitHub Spec Kit leverages GitHub-native integration for 20+, hatch3r delivers the complete development lifecycle — board management, sub-agent orchestration, learning loops, OWASP security coverage, and event-driven hooks — across every tool and platform a team uses.

---

## 9. Conclusion

The agentic coding framework market in early April 2026 has undergone its most significant structural shift since this analysis began. Two seismic changes define this cycle: **GitHub Spec Kit** emerged as a direct competitor with ~84k stars and GitHub corporate backing, and **Superpowers v5.0** expanded to 6-tool support with ~130k stars, eliminating its single-tool weakness. Combined competitor stars now exceed 332k. The multi-tool adapter count is no longer a unique differentiator — Spec Kit (20+ tools), BMAD (28 template-based), Superpowers (6 native), GSD (8 tools), and Compound Engineering (12 tools) all offer multi-tool support.

hatch3r's position remains technically differentiated but strategically vulnerable. No other framework combines **deeply native** tool configuration generation (15 adapters), **multi-platform board management** (GitHub, Azure DevOps, GitLab), a **learning loop**, event-driven hooks, OWASP security coverage, and a recipe system. The canonical source architecture aligns perfectly with AAIF's AGENTS.md standard. However, technical differentiation is a depreciating asset without distribution.

The window for establishing market presence is closing rapidly. Every week without marketplace presence and public visibility is a week where Spec Kit's GitHub backing, Superpowers' community momentum, or GSD's growth trajectory compounds their moat. The competitive advantage has shifted from "most tools" to the combination of **depth** (native adapter quality), **breadth** (board management, learning loop, security), and **platform independence** (multi-platform support beyond GitHub).

The strategic path is clear: **distribute immediately, benchmark adapter depth to prove quality differentiation, invest in board management and learning loop as unique moats**. hatch3r has the strongest technical foundation in the space. It now needs the community, distribution, and proven quality metrics to match.

---

## References

- GSD: https://github.com/gsd-build/get-shit-done | https://gsd.build/
- Superpowers: https://github.com/obra/superpowers
- GitHub Spec Kit: https://github.com/github/spec-kit (estimated)
- Compound Engineering: https://github.com/EveryInc/compound-engineering-plugin
- BMAD Method: https://github.com/bmad-code-org/BMAD-METHOD | https://docs.bmad-method.org/
- SkillKit: https://github.com/rohitg00/skillkit
- OpenCode: https://github.com/sst/opencode (possibly now anomalyco/opencode)
- AgentSys: https://github.com/avifenesh/agentsys
- ~~CrewSwarm: https://crewswarm.ai/~~ (stalled — site not indexed, no public presence as of March 2026)
- ~~Crux: https://runcrux.dev/ | https://github.com/err/crux~~ (stalled — site/repo not found as of March 2026)
- Cline: https://cline.bot/ | https://github.com/cline/cline
- Goose: https://github.com/block/goose | https://block.github.io/goose/
- Kiro: https://kiro.dev/ | https://kiro.dev/docs/cli/authentication/
- ACP Agent Registry: https://www.jetbrains.com/help/ai-assistant/acp.html
- Weave: https://tryweave.io/ | https://github.com/pgermishuys/opencode-weave
- Ruflo: https://github.com/ruvnet/ruflo
- Axon: https://github.com/axon-core/axon
- awesome-cursorrules: https://github.com/PatrickJS/awesome-cursorrules
- awesome-cursor-rules-mdc: https://github.com/sanjeed5/awesome-cursor-rules-mdc
- AAIF: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
- MCP Spec: https://modelcontextprotocol.io/specification
- Cursor Changelog: https://www.cursor.com/changelog
- Claude Code Changelog: https://docs.anthropic.com/en/release-notes/claude-code
- Codex CLI: https://developers.openai.com/codex/cli
- Gemini CLI: https://geminicli.com/docs/changelogs/
- Roo Code: https://docs.roocode.com/
- Kiro: https://kiro.dev/
- Amp: https://ampcode.com/
- GitHub Copilot: https://docs.github.com/en/copilot
- Windsurf: https://codeium.com/windsurf
- Goose: https://github.com/block/goose
