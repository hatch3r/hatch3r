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
- [ ] **MCP protocol** — Current spec version, new capabilities, breaking changes. Track Server Cards and session monitoring features
- [ ] **ACP (Agent Communication Protocol)** — JetBrains/Zed-backed standard. Evaluate integration scope and timeline
- [ ] **All 15 platform updates** — New features, deprecations, API changes for every supported platform

### 17.3 Market Positioning & Strategy (SEQUENTIAL)

Synthesizes findings from 17.1 and 17.2:
- [ ] Feature gap analysis — what do competitors offer that hatch3r does not?
- [ ] Unique differentiators — what does hatch3r offer that no competitor does?
- [ ] Community and adoption signals — GitHub stars, npm downloads, mentions, community size
- [ ] Distribution strategy — npm, marketplace, Show HN, community channels with sequencing and prerequisites
- [ ] Multi-tool bet assessment — is the multi-adapter approach still the right strategy, or is the market converging on AGENTS.md natively?
- [ ] Investment recommendations — where should hatch3r invest next based on market gaps?
- [ ] Open-source vs private recommendation with rationale

## Strategic Decision Register

Items classified as human-decision (open-source, branding, investment, distribution strategy) are tracked here, not as findings. They:
- Do not generate findings or affect domain score
- Are listed in the Executive Dashboard under "Stalled Strategic Decisions" if unresolved for 3+ cycles
- Require `Owner: Human` classification and `disposition: "strategic_register"` in the finding registry if they do generate findings

Agent-verifiable items (competitor feature comparison, documentation currency, community metrics, platform update tracking) remain as standard checklist items and generate findings normally.
