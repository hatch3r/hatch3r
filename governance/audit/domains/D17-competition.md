# Domain 17: Competition & Market Intelligence

> Last updated: 2026-04-19. **Pillars:** P3 (primary), P4 (supporting). **Scope:** competitive landscape, market positioning, strategic alignment. **Sub-agents:** 3 (17.3 sequential after 17.1/17.2).

| SA | Focus |
|----|-------|
| 17.1 | Direct Competitors |
| 17.2 | Standards & Ecosystem |
| 17.3 | Market Positioning & Strategy (SEQUENTIAL) |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

**Specific source set (D17-targeted):** competitor product docs <=6 months, GitHub-stars trajectories with date snapshots, third-party benchmarks (independent-analysis trust tier), funding/release news (vendor-note tier).

## Audit Checklists

### 17.1 Direct Competitor Analysis
Per competitor: scope / quality / community (stars, downloads) / approach (config-gen vs runtime vs curated) / feature gaps vs hatch3r.
- [ ] **AgentSys** — multi-tool orchestration (Claude Code, OpenCode, Codex, Cursor, Kiro)
- [ ] **GSD** — spec-driven dev for Claude Code (workflow model, community)
- [ ] **CrewSwarm** — runtime orchestrator (WebSocket vs config-gen)
- [ ] **Crux** — multi-agent with embedded SQLite/vector search
- [ ] **agentic-code** — `npx agentic-code` zero-config CLI
- [ ] **awesome-cursorrules** — curated breadth vs depth
- [ ] **Superpower / Compound Engineering** — Claude Code plugin distribution
- [ ] NEW competitors since last cycle — web research MANDATORY

### 17.2 Standards & Ecosystem Evolution
- [ ] **AAIF** — AGENTS.md/MCP/goose under Linux Foundation; impact on adapter model
- [ ] **AGENTS.md spec** — version, adoption, diff since last cycle
- [ ] **MCP protocol** — spec version, Server Cards, session monitoring, breaking changes
- [ ] **ACP** — JetBrains/Zed-backed; integration scope/timeline
- [ ] **All 3 supported platforms** (claude, cursor, copilot) — features, deprecations, API changes per platform. Plus a tracked candidate-platform watchlist (currently: opencode, gemini, codex, cline, aider, kiro, goose, zed, windsurf, amp, amazonq, antigravity — adapters retired in 1.9.0 but monitored for re-introduction signal).

### 17.3 Market Positioning & Strategy (SEQUENTIAL)
Synthesizes 17.1/17.2.
- [ ] Feature gaps + unique differentiators (hatch3r-only)
- [ ] Adoption signals — stars, downloads, mentions
- [ ] Distribution sequencing — npm, marketplace, Show HN, community
- [ ] Multi-tool bet assessment vs AGENTS.md convergence
- [ ] Investment recommendations from market gaps + open-source vs private rationale

## Strategic Decision Register

Human-decision items (open-source, branding, investment, distribution): no findings, no score impact; surfaced in Executive Dashboard "Stalled Strategic Decisions" after 3+ unresolved cycles; tagged `Owner: Human` + `disposition: "strategic_register"` if they do generate findings. Agent-verifiable items (competitor compare, doc currency, community metrics, platform updates) generate findings normally.
