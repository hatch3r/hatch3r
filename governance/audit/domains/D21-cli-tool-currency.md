# Domain 21: CLI Tool Currency

> Last updated: 2026-05-15

**Pillars served:** P3 (primary), P6 (supporting), P4 (supporting).

**Scope:** End-user-recommended CLI tools (`hatch3r-cli-*` skills) across six functional categories — search, file ops, data, http, forge, browser/sandbox. Verifies each tier-1 and tier-2 tool against latest vendor release notes (≤90 days), CVE feeds (≤90 days), alternative-tool emergence, and adapter rendering correctness. D02 owns adapter contracts; D09 owns per-adapter implementations; D15 owns supply-chain trust. D21 owns whether the tool catalog itself is current, accurate, and safe to recommend.
**Sub-agents:** 7

## Sub-Agent Decomposition

| SA | Category | Tools |
|----|----------|-------|
| 21.1 | Search | ripgrep, ast-grep, fd |
| 21.2 | File ops | bat, sd |
| 21.3 | Data | jq, miller, csvkit, dasel, yq |
| 21.4 | HTTP | curl, httpie, xh |
| 21.5 | Forge | gh, glab, az-devops |
| 21.6 | Browser & sandbox | playwright-cli, docker, container-use |
| 21.7 | **Capability Matrix + Synthesis (SEQUENTIAL)** | All of 21.1–21.6 |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding. Each per-category SA (21.1–21.6) MUST write a `**Last web-research date:** YYYY-MM-DD` line at the top of `.audit-workspace/D21-SA21.{N}.findings.md`. Omitting the date line is itself a Medium finding.

**Specific source set (D21-targeted):** vendor release notes (URL + access date YYYY-MM-DD) for each tool, GitHub release tags ≤90 days old, vendor CVE advisories ≤90 days, CVE feeds (NVD, GitHub Security Advisories) ≤90 days, install-channel changelogs (brew, apt, scoop, winget, cargo, pipx, npm). Single-source acceptable only when the trust tier is `official-docs` AND the claim is tool-specific.

## Audit Checklists

### Per-Category Sub-Agent Checklist (SA 21.1–21.6)

Each per-category sub-agent MUST verify every tool in its category against the following 6 checks. Cite vendor URL + access date + trust tier per the rigor contract for each verification. Findings reference specific files: `src/cliTools/registry.ts` (`AVAILABLE_CLI_TOOLS` entry), `skills/hatch3r-cli-{id}/SKILL.md` (recipe + install body), `governance/audit/execution-insights.json::d21_tool_research_dates.{tool_id}` (prior cycle baseline).

- [ ] **Currency check (≤90 days)** — last vendor release tag ≤90 days from cycle date. Scenario: when the last published release tag predates the cycle date by more than 90 days, emit a Medium finding citing the release URL; >180 days → High. The check passes when GitHub release URL or vendor changelog URL is cited with access date and trust tier per the rigor contract.
- [ ] **CVE check (≤90 days window)** — scan NVD + GitHub Security Advisories for the tool's CPE/package coordinates over the last 90 days. Scenario: a published advisory affecting the tool's recommended version emits a High finding with CVE ID, CVSS score, and mitigation path. Missing CVE check is a High finding per CONSTITUTION.md §2 P3.
- [ ] **Alternative-tool monitor** — search vendor blogs + Hacker News + ThoughtWorks Tech Radar (current volume) for newer alternatives in the same category that have surpassed the recommended tool on a measurable axis (benchmark numbers, install footprint, reliability percent). Scenario: an alternative cited in ≥2 independent sources as superior on a measurable axis emits an Info finding feeding next cycle's CL-2 candidate list.
- [ ] **Integration health** — adapter rendering for `hatch3r-cli-{id}` skill files emits to the correct path across the 13 skill-capable adapters (cursor, claude, gemini, cline, codex, amazon-q, copilot, opencode, windsurf, kiro, aider, goose, antigravity); `skill.cli_tool.bin` matches the registry probe binary; frontmatter passes `validate-cli-skills.ts`. Scenario: when a skill's probe binary changes upstream (e.g., `rg` → `ripgrep`), the adapter output and registry must agree, else Medium finding.
- [ ] **Staleness flag emission** — when currency or CVE windows lapse, the finding carries `pillar: ["P3"]` in the registry and references `governance/audit/execution-insights.json::d21_tool_research_dates.{tool_id}` for prior-cycle baseline comparison. Scenario: a tool whose research date is ≥90 days older than the current cycle's date triggers a Medium finding regardless of the tool's vendor release date — the audit owns the staleness, not the tool.
- [ ] **Version-pinning recommendation** — verify the `hatch3r-cli-{id}` skill's `## Detection / Install` section pins a version (or commits to a tested-against version) per OS install channel. Scenario: an unpinned `brew install <tool>` recommendation that pulls a major-version bump between cycles is a Low finding; absent install guidance for any of mac/linux/windows is a Medium finding.

### Category-Specific Source Notes

Each per-category SA grounds its currency check in the canonical vendor source for that category. Cite the URL with access date for every finding.

- **21.1 Search** — ripgrep releases (https://github.com/BurntSushi/ripgrep/releases), ast-grep releases (https://github.com/ast-grep/ast-grep/releases), fd releases (https://github.com/sharkdp/fd/releases).
- **21.2 File ops** — bat releases (https://github.com/sharkdp/bat/releases), sd releases (https://github.com/chmln/sd/releases).
- **21.3 Data** — jq releases (https://github.com/jqlang/jq/releases), miller releases (https://github.com/johnkerl/miller/releases), csvkit (https://csvkit.readthedocs.io/), dasel (https://github.com/tomwright/dasel/releases), yq Go (https://github.com/mikefarah/yq/releases).
- **21.4 HTTP** — curl (https://curl.se/changes.html), httpie (https://github.com/httpie/cli/releases), xh (https://github.com/ducaale/xh/releases).
- **21.5 Forge** — gh (https://github.com/cli/cli/releases), glab (https://gitlab.com/gitlab-org/cli/-/releases), az-devops (https://github.com/Azure/azure-devops-cli-extension/releases).
- **21.6 Browser & sandbox** — playwright-cli (https://github.com/microsoft/playwright/releases), docker (https://docs.docker.com/engine/release-notes/), container-use (https://github.com/dagger/container-use/releases).

### 21.7 Capability Matrix + Synthesis (SEQUENTIAL)

This sub-agent runs after 21.1–21.6 complete. It owns cross-category currency synthesis and the canonical capability matrix between recommended CLI tools and the 13 skill-capable adapters.

- [ ] **Capability matrix verification** — every tool listed in `src/cliTools/registry.ts::AVAILABLE_CLI_TOOLS` has a corresponding `skills/hatch3r-cli-{id}/SKILL.md`; every skill has a registry entry. Scenario: drift between registry and on-disk skills (orphan skill OR orphan registry entry) is a Medium finding; the `validate-cli-skills.ts` CI gate must already prevent it but this SA confirms the gate ran.
- [ ] **Tier-1 readiness gate** — every tier-1 tool has a `**Last web-research date:**` ≤90 days from cycle date across SA 21.1–21.6 findings files. Scenario: any tier-1 tool with research date >120 days from cycle start triggers a regression-gate failure per AUDIT-EXECUTE.md `Regression Gates` table. The check passes when every tier-1 tool ID appears in `.audit-workspace/current-insights.json::d21_tool_research_dates` with a date ≤90 days old.
- [ ] **Cross-category alternative synthesis** — collate alternative-tool signals from 21.1–21.6 and rank by recurrence. Scenario: a tool cited as a superior alternative in ≥2 independent sources across ≥2 category SAs becomes a CL-2 content gap candidate for the next cycle, with one-line rationale and source citations carried forward.
- [ ] **Per-cycle research-date promotion** — orchestrator writes the verified per-tool research dates to `.audit-workspace/current-insights.json::d21_tool_research_dates` so `npm run audit:archive` promotes them to `governance/audit/execution-insights.json::history[]`. Scenario: a research date that is verified by an SA but missing from the insights file at cycle close fails the promotion step and is flagged as Low for the next cycle.

## Domain Boundary

> D02.4 audits the external-tool config utilities (`src/cliTools/`, `src/pipeline/agentToolAllowlist.ts`, `src/pipeline/adapterToolTranslator.ts`) at the abstraction level: do MCP transformation, TOML generation, tool-allowlist translation, and tool-name translation preserve canonical intent across all 15 adapters? D09 audits per-adapter `hatch3r-cli-*` skill rendering: does each adapter emit the skill file to its documented output path with frontmatter intact and probe-binary match? D15.5 owns MCP supply-chain trust; D15.7 owns CLI tool supply-chain trust (installer chain, version pinning, CVE windows, provenance, sandbox escape surface). D21 owns whether the catalog itself is current (≤90-day research window), the tools are still industry-relevant (alternative-tool monitor), and recommendations are not silently stale (per-cycle research-date promotion). Findings about adapter code paths belong in D09; findings about utility code belong in D02.4; findings about supply-chain trust mechanics belong in D15.7; findings about a recommended tool's vendor release going stale, a CVE going unacknowledged, or a superior alternative emerging belong in D21.
