# Domain 17: Competition & Market Intelligence

**Scope:** Competitive landscape, market positioning, and strategic alignment.
**Sub-agents:** 3

Sub-agent 17.3 is **sequential** — it runs only after 17.1 and 17.2 complete.

| SA | Focus |
|----|-------|
| 17.1 | Direct Competitors |
| 17.2 | Standards & Ecosystem |
| 17.3 | **Market Positioning & Strategy (SEQUENTIAL)** |

## Audit Checklists

### 17.1 Direct Competitor Analysis
- [ ] **AgentSys** — Multi-tool agent orchestration (plugins, agents, skills for Claude Code, OpenCode, Codex, Cursor, Kiro). Compare scope, quality, and approach.
- [ ] **GSD (Get Shit Done)** — Spec-driven development for Claude Code. Compare workflow model, popularity, community.
- [ ] **CrewSwarm** — Runtime orchestrator for OpenCode, Cursor, Claude Code. Compare architecture (WebSocket vs config generation).
- [ ] **Crux** — Multi-agent orchestration with embedded SQLite/vector search. Compare infrastructure approach.
- [ ] **agentic-code** — CLI setup via `npx agentic-code`. Compare scope and zero-config approach.
- [ ] **awesome-cursorrules** — Curated cursor rules collection. Compare breadth vs depth.
- [ ] **Superpower / Compound Engineering** — Claude Code plugin ecosystem. Compare distribution model.
- [ ] Any NEW competitors that have emerged since the last audit — web research MANDATORY

Per competitor, assess: scope comparison, quality comparison, community size (stars, downloads), approach (config-gen vs runtime vs curated), unique features hatch3r lacks.

### 17.2 Standards & Ecosystem Evolution
- [ ] **AAIF (Agentic AI Foundation)** — AGENTS.md, MCP, goose under Linux Foundation. Impact on hatch3r's adapter model?
- [ ] **AGENTS.md spec** — Current version, adoption, changes since last audit
- [ ] **MCP protocol** — Current spec version, new capabilities, breaking changes
- [ ] **All 14 platform updates** — New features, deprecations, API changes for every supported platform (including Amazon Q)

### 17.3 Market Positioning & Strategy (SEQUENTIAL)

Synthesizes findings from 17.1 and 17.2:
- [ ] Feature gap analysis — what do competitors offer that hatch3r does not?
- [ ] Unique differentiators — what does hatch3r offer that no competitor does?
- [ ] Community and adoption signals — GitHub stars, npm downloads, mentions, community size
- [ ] Distribution model comparison — npm, marketplace, runtime, curated collections
- [ ] Multi-tool bet assessment — is the multi-adapter approach still the right strategy, or is the market converging on AGENTS.md natively?
- [ ] Investment recommendations — where should hatch3r invest next based on market gaps?
- [ ] Open-source vs private recommendation with rationale
