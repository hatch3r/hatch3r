# Domain 10: User Experience & Documentation

> Last updated: 2026-04-28

**Pillars served:** P1 (primary), P4 (supporting).

**Scope:** All user-facing documentation, CLI UX, first-run experience, adoption friction, and developer experience metrics. The gap between "code works correctly" and "user succeeds" — tracing user journeys to find where correct code creates confusion, surprise, or failure.
**Sub-agents:** 8
**Evaluation method:** Sub-agents 10.3-10.7 trace concrete user scenarios end-to-end through the codebase. Reference specific files, functions, output strings, and user-facing messages. Findings are about UX clarity and adoption friction, not code correctness.

| SA | Focus |
|----|-------|
| 10.1 | Documentation Accuracy |
| 10.2 | CLI UX & Output Quality |
| 10.3 | First-Run to First-Value Journey |
| 10.4 | Customization & Configuration Clarity |
| 10.5 | Multi-Tool Coexistence |
| 10.6 | Content Profile & Selection Impact |
| 10.7 | Workflow Chain Viability |
| 10.8 | Learning Curve & Adoption Metrics |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Audit Checklists

### 10.1 Documentation Accuracy
- [ ] README accuracy — counts, examples, links all correct and current
- [ ] `docs/` and `website/docs/` accuracy — reflect current implementation, navigation logical
- [ ] CHANGELOG accuracy — reflects all actual changes since last release
- [ ] Plugin manifest — `.cursor-plugin/plugin.json` version, description, counts match reality
- [ ] Cross-references — internal links work, related topics connected
- [ ] Competitor comparison — how does documentation quality compare?
### 10.2 CLI UX & Output Quality
- [ ] Interactive prompts (inquirer) — questions clear, defaults sensible, flow logical
- [ ] Progress feedback (ora) — informative without noise; users can track long operations
- [ ] Output formatting (boxen, chalk) — readable, accessible in high-contrast, screen readers, CI
- [ ] Error actionability — clear next steps for every error; severity levels visually distinct
- [ ] Agent and review output — structured, parseable, actionable; users understand findings
- [ ] Iteration summary contract — `rules/hatch3r-iteration-summary.md` exists with `scope: always`, rule-parity passes, the 5-field block (Status, Outcome, Done, Not Done, Open Questions, Confidence) reaches every adapter output
### 10.3 First-Run to First-Value Journey
Trace init to first useful agent output. Ref: `src/cli/commands/init.ts`, generated rules files, `quick-start.md`
- [ ] Zero-to-working in under 5 min — per-preset end-to-end test (default, minimal, full, custom)
- [ ] Decision count and default quality — choices per preset; Enter-through produces good setup
- [ ] Post-init message clarity — distinguishes CLI vs agent slash commands; adapts for greenfield/brownfield
- [ ] External tool setup guidance — CLI tool installer recommendations (brew/cargo/npm/release tarball) shown at the right moment with pinned-version commands; .env.mcp flow explained at the right moment when MCP servers are part of the selected preset; neither discovered on failure.
- [ ] First agent invocation — user reaches `/project-spec` or `/codebase-map` without external docs
- [ ] Common misstep errors — slash commands in terminal, missing env vars, unsourced `.env.mcp`
- [ ] Time-to-first-value and in-IDE discoverability — total steps to first output; intuitive discovery in each tool
- [ ] Simulated walkthrough — trace init-to-first-value on greenfield and brownfield repos, record friction
### 10.4 Customization & Configuration Clarity
Ref: `src/manifest/hatchJson.ts`, `src/cli/commands/config.ts`, `sync.ts`, `src/adapters/base.ts`
- [ ] Three mechanisms distinguished — managed blocks, `.customize.yaml`, manual edits explained where encountered
- [ ] Sync/update output — explains preserved vs overwritten, not just file counts
- [ ] `.customize.yaml` validation — syntax (valid YAML) and references (valid IDs) checked
- [ ] Marker recovery — path exists when user deletes `HATCH3R:BEGIN`/`HATCH3R:END`
- [ ] Config vs customize relationship — `hatch3r config` clarifies its role; removing content warns about dependencies
- [ ] Sync fear factor — messaging reassures customizations outside managed blocks are preserved
### 10.5 Multi-Tool Coexistence
Ref: `src/adapters/`, `src/cli/commands/config.ts`
- [ ] Output path collision audit — enumerate all adapter output paths; identify shared files
- [ ] Secret loading differences — documented at tool selection time, not discovered later
- [ ] Adapter cleanup on removal — removing a tool deletes its generated files
- [ ] Tool switching guidance — documented path for migrating between tools
### 10.6 Content Profile & Selection Impact
Ref: `src/content/index.ts`, `presets.ts`, `tags.ts`, `src/cli/commands/init.ts`
- [ ] Profile selector shows exclusions — Minimal/Standard/Full shows what's excluded, not just included
- [ ] Filter visibility — greenfield/brownfield and solo/team effects visible at selection time
- [ ] Content dependency chains — removing agent X breaks skills Y/Z; dependency surfaced to user
- [ ] Profile change after init — path from Minimal to Standard/Full is obvious and additive, not destructive
- [ ] Filter interaction effects — brownfield + solo + Minimal yields intended experience
### 10.7 Workflow Chain Viability
Ref: `.agents/commands/`, `.agents/skills/`, `website/docs/guides/`, `quick-start.md`
- [ ] Full chain mapped: init -> /project-spec -> /roadmap -> /board-init -> /board-fill -> /board-pickup -> /workflow -> /review -> /release
- [ ] Prerequisites per step — GitHub Projects V2, MCP servers, API keys, git remote identified
- [ ] Failure clarity — which steps fail silently vs with clear errors; which are falsely optional?
- [ ] Lite path — workflow chain viable without board management steps
- [ ] Progressive disclosure — features encountered at right time, not all visible from day one
- [ ] Quick-start accuracy — docs represent the minimum viable workflow
### 10.8 Learning Curve & Adoption Metrics
SPACE framework and learning curve assessment:
- [ ] **Satisfaction** — developer sentiment toward the framework
- [ ] **Performance** — task completion rate and quality
- [ ] **Activity** — usage metrics and engagement patterns
- [ ] **Communication** — impact on collaboration quality
- [ ] **Efficiency** — impact on flow state and productivity
- [ ] Learning curve — time to proficiency; concepts to learn; complexity revealed gradually
- [ ] Documentation-to-action ratio — reading required before productive use
