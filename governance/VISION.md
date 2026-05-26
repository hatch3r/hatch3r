# hatch3r — Vision

> Last updated: 2026-05-26

**Crack the egg. Hatch better agents.**

---

## What hatch3r Is

hatch3r is an open-source CLI and Cursor plugin that installs a tool-agnostic agentic coding setup (weekly-audited across 21 domains) into any repository. Canonical content ships inside the npm package; adapters read it from the bundle and generate native configuration for 3 supported AI coding platforms (Claude Code, Cursor, GitHub Copilot). The single user-visible footprint is `.hatch3r/` (manifest, learnings, handoffs, overrides, MCP credentials). Continuously improved through a closed-loop system.

Run `npx hatch3r init`. Get an audit-cycle-graded agentic setup. Start building. Everything is plain text — reviewable, diffable, versionable. hatch3r generates configuration; it does not execute agents. The framework manages the how-to-instruct; the AI tools do the work.

---

## Who It's For

hatch3r is for everyone building software with AI coding assistants — solo developers to enterprise teams, any software type, any maturity level. **Primary audience: solo/early-stage developer.** Team and enterprise opt in via maturity-tier config (`hatch3r config maturity=solo|team|scaleup|enterprise`). Each tier admits different content + audit depth + floor mandates.

### Four Personas

**Individual Power User** — Proven agentic setup without weeks of hand-tuning prompts; runs init and gets senior-engineer-quality results immediately.
**Team Lead / Platform Owner** — Consistent AI-assisted practices across the team, same quality bar regardless of preferred AI tool.
**OSS Maintainer** — Contributors using AI tools produce PRs that pass code review on first submission; adapter-generated configs (CLAUDE.md, `.cursor/`, `.github/`) carry conventions, architecture, and quality expectations.
**Legacy System Maintainer** — AI assistance that respects existing patterns and makes incremental improvements without breaking things; outside-in perspective and non-destructive adoption.

Default maturity tier per persona: Individual Power User → solo; Team Lead/Platform Owner → team or scaleup; OSS Maintainer → solo or team; Legacy System Maintainer → scaleup or enterprise. Configurable via `hatch3r config maturity=<tier>`.

### Any Stack, Any Stage

Web apps, APIs, CLIs, mobile, IaC, monorepos, legacy systems — MVP prototypes to enterprise production. Generic content everywhere; customization handles project-specific concerns.

---

## The Quality Bar

The north star metric is **one-shot success rate and post-implementation quality**.

The standard: senior engineer quality with an outside-in, user-facing perspective. Small-to-mid tasks should succeed on the first attempt. The result should be something a senior engineer would approve in code review — correct, well-structured, and considering edge cases.

Larger features (reusable components, styling consistency, i18n keys, complex wiring, multi-file edge cases) are harder — a known gap, partly model limitations, partly content optimization. The framework continuously optimizes for these cases but acknowledges the boundary.

The revision loop — human tests as user, provides targeted feedback, agent fixes efficiently — works well. Optimize it, don't rethink it. Minimize the number of revision cycles needed, but make each cycle fast and effective when it happens.

Operationalised via the measurable list in [CONSTITUTION.md](CONSTITUTION.md) §2 P2 — axe-core 0 violations, design-token ≥95% adoption, four-state surface coverage 100%, AI eval coverage 100%, SBOM + npm provenance + SHA-pinned actions, expand-contract migration conformance.

User-authored artifacts produced via /hatch3r-create are held to the same one-shot success standard as canonical content; D20 enforces this via hybrid gates (creator-tool gates at write time, artifact-compliance gates at audit time). Project-local overrides land under `.hatch3r/overrides/` (the D20 user-content escape hatch, relocated from `.agents/user/` in 1.9.0).

---

## Up-to-Date Information

Agents must ALWAYS ground their work in current information. Sources: web search, official documentation, CLI tools that wrap live data (search, file, http, forge, browser), Context7 or other MCP servers when CLI access is not practical, and project-specific context. Never rely solely on training data.

This is not a feature of specific agents or skills. It is a general principle baked into how all content instructs agents. Every agent, every skill, every prompt assumes access to current information and instructs the AI to use it.

Every significant agent claim emits a proof_trace block — file path, grep match, command output, or URL with access date. Pre-execution verification gates apply to state-dependent assertions (file existence, type check, test output). Hallucination prevention is operationalised, not assumed.

---

## The Closed Loop

hatch3r improves itself through a continuous weekly cadence:

```
Vision --> PRD --> Build --> Audit --> Execute Findings --> Update PRD --> repeat
```

The audit deploys all 24+ audit domains and 124 sub-agents for maximum depth (D22 Content Architecture + D23 Agentic Engineering Trends + D24 Governance Self-Audit added in 2.0.0). Findings are severity-tagged, scored, and prioritized. Execution follows a wave-based approach with regression gates between waves.

### Three Additional Loops

**Content Gap Identification** — Audit findings reveal missing agents/skills/rules/commands, which become new content artifacts next cycle. **Audit Self-Evolution** — The audit prompt itself improves over time; changes require explicit user consent per proposal. **Learning System** — Project knowledge compounds; agents consult past learnings on similar problems.

### PRD as Living Document

The PRD evolves automatically from audit findings; it handles "how and when," this document handles "why and what."

---

## Content Maintenance Model

Content is maintained through the weekly audit cycle or in-between agentic work triggered by the framework owner. **Exception:** trivial fixes (typos, link rot, dead references, currency-header refreshes, anti-slop wordlist hits without semantic change) may land between cycles via direct-edit. Non-trivial maintenance routes through the weekly audit cycle. No silent drift; no ad-hoc rewrites.

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

Per-cycle adapter capability matrix audit (D09 extended) measures twin metrics — adapter currency + adapter capability utilization. Unutilized platform-native features surface as findings each cycle.

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

End users invoke `/hatch3r-*` workflows; framework contributors invoke `/h4tcher-*` lifecycle presets — same engine, different prefix marks the audience.

---

## CLI Scope

The CLI handles framework management only:

- `init` — Install the agentic setup into a repository
- `sync` — Regenerate adapter output from canonical source
- `update` — Pull latest framework content
- `config` — Configure framework settings (including `maturity=solo|team|scaleup|enterprise`)
- `status` — Show framework state
- `validate` — Check content integrity
- `verify` — Verify adapter output matches canonical source
- `clean` — Remove generated artifacts
- `add` — Add specific content artifacts
- `worktree-setup` / `worktree-cleanup` — Git worktree integration
- `cliTools` — Configure end-user CLI tool recommendations
- `mcp` — Configure MCP server credentials
- `explain` — Explain framework configuration
- `--resume` flag on long-running orchestrators (Decision 27); `rollback --session=<id>` for per-session snapshot rollback

The CLI is NOT a runtime. It generates configuration; it does not execute agents. Good standard developer experience — polished, fast, clear errors — but the CLI is not the primary differentiator. The content is.

Orchestrator commands emit a pre-execution cost estimate (expected sub-agents, estimated input tokens for static frame, triage tier, web research budget, estimated duration) and post-execution actuals + delta in the iteration summary (Decision 24).

---

## Learning System

Learning is automatic. The system captures learnings on the fly after each learning moment — not only when the user explicitly instructs it.

**Project-level only.** Users work on their projects, not on the framework itself. Learnings are scoped to the project and stored in the project's `.hatch3r/learnings/` directory.

**Must not bloat.** Efficient storage, no redundancy, no noise. Old learnings that are superseded get consolidated or removed. The learning store stays lean and useful.

**Agents consult learnings.** When working on problems similar to past work, agents reference captured learnings. The project gets smarter with each iteration — patterns that worked, mistakes to avoid, project-specific conventions discovered through use.

**Decision 22 enhancements:** Each learning carries structured frontmatter (topic, applies-to, supersedes-IDs, confidence). Auto-consolidation when redundant or contradicted. Every Implementer + Reviewer + Researcher agent reads `.hatch3r/learnings/INDEX.md` before answering project-specific questions. Encoded as `rules/hatch3r-learning-system.md` (authored in subsequent audit cycle).

---

## Principles

Stable and aspirational. These do not change week-to-week.

1. **Canonical source bundled in the npm package** — One truth, many outputs. Adapters read canonical content via `resolveBundledContentRoot()`; user repos carry only `.hatch3r/` plus adapter outputs.

2. **Everything is plain text** — Reviewable, diffable, versionable. No binary blobs, no opaque databases.

3. **Generate, don't hand-edit tool configs** — Adapter output is derived. Edit the source, regenerate the output.

4. **Proven patterns over theoretical templates** — Content comes from what works in practice, not what sounds good in theory. Real-deal testing over mocked dependencies (mocks require `// MOCK: <reason>` justification + audit review); discovery-before-write to prevent duplication (pre-implementation pattern search + post-write duplication scan).

5. **Compound knowledge over time** — Every interaction sharpens the next via the learning system.

6. **Weekly audit cadence** — Continuous improvement is not aspirational; it is scheduled.

7. **Closed-loop evolution** — Audit findings flow into the PRD, the PRD drives content changes, content changes get audited. The loop never stops.

8. **Up-to-date information always** — Web search, Context7, official docs; never stale training data.

9. **CLI-first agent tooling** — Agents prefer terminal-native CLI tools (search, file ops, data, http, forge, browser, sandbox, archive) over wrapped protocols. CLI tools are audited per cycle (D21 CLI tool currency) and portable across hosts. Every MCP recommendation in canonical content carries a per-artifact rationale: 'why no CLI equivalent exists.' Rationales audited per cycle (D2.4); MCP whitelist is small and shrinking. New MCP additions require a queued §8 amendment.

10. **One-shot success as the north star** — Every content change is measured against: does this make first-attempt success more likely?

11. **Equal adapter parity across the 3 supported platforms** — Claude Code, Cursor, GitHub Copilot each get the full capability set their native format can express. No first-class or second-class citizens within the supported set. (P3)

12. **Incremental adoption** — Legacy-friendly, non-destructive. Works with what exists, does not demand a rewrite.

13. **Sub-agentic by design** — Delegation + parallel execution decompose complex tasks into focused sub-tasks.

14. **Clarification & Fan-out Discipline** — Every hatch3r workflow opens with detected ambiguity surfaced as user questions (via the platform-native question tool per user-question-protocol.md) and closes with fan-out width matched to task complexity. Quality dominates token cost on both dimensions. (P8)

15. **Quality through measurable standards** — Content quality is verified weekly against the shared quality charter (`agents/shared/quality-charter.md`). Agents think like senior engineers: question assumptions, consider multiple stakeholders, express uncertainty honestly, and ground every recommendation in current information.

16. **Behavioral charter governs agent conduct** — Agent behavioral standards are defined once and inherited everywhere. Audit sub-agents follow the audit behavioral charter (in AUDIT.md); end-user agents follow the shared quality charter. Both charters are living documents that evolve through the weekly audit cycle.

17. **Design quality and accessibility for agent-produced output** — Agents that generate UI for end-user projects meet a WCAG 2.2 AA baseline verified by axe-core (0 serious/critical violations per route and per component), reuse the project's design tokens and component library before authoring new primitives, and ship the four-state surface contract on every async view (loading + empty + error + partial). Measured under P2 (see [CONSTITUTION.md](CONSTITUTION.md) §2 P2).

18. **Security and trust as identity** — OWASP ASI baseline, per-cycle CVE review, trust delegation chain reference (D15 Part B). Security and trust are first-class concerns at every layer (P6).

19. **Runtime token economy** — End-user agentic flows tune for token economy and latency via static-first prompt structure, parallel-tool-by-default, triage-first orchestration, plan/act split, structured outputs over prose, lazy loading by reference (P7).

20. **Structured learning with consultation gate** — Project-level learnings (`.hatch3r/learnings/`) carry structured frontmatter + auto-consolidate; Implementer + Reviewer + Researcher agents consult before answering (P5).

21. **Standardized iteration summary** — Every orchestrator + meaningful skill run emits a 9-section summary (request, fan-out + cost, web research, files mutated, gates, pillar impact, verification, open questions, learnings captured). Encoded as `rules/hatch3r-iteration-summary.md` (P5).

22. **Cost visibility** — Pre-execution estimate + post-execution actuals + delta surfaced in the iteration summary; token telemetry from `src/pipeline/observability.ts` exposed to end user (P7).

23. **Resumability and rollback** — Long-running orchestrators carry workspace checkpoints (`hatch3r {cmd} --resume`); pre-mutation snapshots in `.hatch3r/snapshots/<session-id>/` enable `hatch3r rollback --session=<id>`. Atomic temp+rename writes already in `src/merge/safeWrite.ts` (P1).

24. **Audit-cycle OSS posture** — Conventional Commits drive automated SemVer + dual-tier changelog (Highlights for users + Technical for contributors). npm provenance + SBOM + SHA-pinned actions per supply-chain floor. CI matrix Ubuntu/macOS/Windows × Node LTS. CODE_OF_CONDUCT + CONTRIBUTING + SECURITY.md present (P3).

---

## Distribution

hatch3r is open-source. Build the ideal framework first; distribution channels (npm, marketplace plugins, private registries) follow.

---

*Stable vision — the "why and what." For "how and when," see the PRD. For quality verification, see AUDIT.md.*
