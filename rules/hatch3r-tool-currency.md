---
id: hatch3r-tool-currency
type: rule
description: CLI-tool version pinning, vendor-release research cadence (≤90 days), CVE feed acknowledgement (≤90 days), and release-readiness gate for any new tool added to src/cliTools/
scope: conditional
globs: "src/cliTools/**,skills/hatch3r-cli-*/SKILL.md,.audit-workspace/**"
tags: [security, currency, maintenance]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# CLI Tool Currency

**Pillars:** P3 (Adapter & External Tool Currency), CQ3 (Security Quality)

## Scope

This rule binds every CLI tool entry in `src/cliTools/registry.ts::AVAILABLE_CLI_TOOLS` and every per-tool skill under `skills/hatch3r-cli-{id}/SKILL.md`. Tier-1 entries are unconditionally installed; tier-2 entries are conditional per `src/cliTools/triggers.ts`; tier-3 entries are user-opt-in. The currency policy below applies tier-wide; only the staleness threshold varies per tier.

## Vendor-Release Research Cadence

Source of truth: `governance/CONSTITUTION.md` §2 P3 ("vendor changelogs ≤12 months old, CVE feeds ≤90 days old, staleness >90 days for any tier-1 tool is a Medium finding"). D21 owns the per-cycle verification (`governance/audit/domains/D21-cli-tooling-recency.md`).

Per-cycle research-date promotion is required for every tool listed in the registry. The audit workspace `.audit-workspace/current-insights.json::d21_tool_research_dates.{tool_id}` must carry an ISO date ≤90 days from cycle start. Records >120 days from cycle start trigger a regression-gate failure per `governance/AUDIT-EXECUTE.md` Regression Gates table.

| Tier | Staleness threshold | Action on breach |
|------|---------------------|------------------|
| Tier 1 (unconditional, e.g. `ripgrep`, `fd`, `jq`, `gh`, `delta`) | 90 days | Medium finding; block cycle close until research-date updated |
| Tier 2 (conditional, e.g. `qsv`, `playwright`, `duckdb`) | 120 days | Medium finding when trigger fires; Info otherwise |
| Tier 3 (opt-in) | 180 days | Low finding; surface for cycle backlog |

## CVE Feed Acknowledgement

Every cycle MUST inspect the upstream advisory feed for each registered tool:

- GitHub Security Advisories (`https://github.com/{owner}/{repo}/security/advisories`) — primary feed for tools published on GitHub.
- NVD CVE feed (`https://nvd.nist.gov/vuln/search/results?form_type=Basic&search_type=all&query={tool}`) — backstop for non-GitHub tools.
- Vendor security mailing lists where the vendor publishes there in preference to GHSA (e.g. `oss-security@lists.openwall.com`).

The `securityNote` field on the registry entry MUST be populated when an unfixed advisory ≤90 days old applies, with the GHSA-id and required mitigation. Existing examples to mirror: `jq` (advisory roster on `jqlang/jq`), `gh` (GHSA-crc3-h8v6-qh57 pre-2.92.0). Missing CVE check is a High finding per CONSTITUTION §2 P3.

## Version Pinning Policy

Registry entries declare install commands per OS / package manager (`brew`, `apt`, `scoop`, `cargo`, etc.). The pinning rules:

- Production CI workflows MUST pin the tool's binary version when the install command supports it (e.g. `brew install jq@1.7`, `cargo install ripgrep --version 14.1.0 --locked`, `gh ext install owner/repo@v1.2.3`).
- GitHub Actions step entries that consume a CLI tool MUST SHA-pin the action emitting the install (40-char commit SHA), per `rules/hatch3r-secrets-management.md` and CONSTITUTION §2B CQ3 supply-chain floor.
- Local-developer install commands MAY omit a version pin (homebrew tracks vendor-current); the registry MUST document the last-verified vendor release tag in `lastVendorReleaseTag` (proposal field — populate when adding the tool) so audit cycles can detect drift.
- A tool whose vendor stops publishing releases (cadence `stable` + last release >18 months) is escalated to D21 SA21.7 for replacement evaluation; the alternative-tool monitor in `src/cliTools/triggers.ts` records candidate replacements.

## Release-Readiness Gate for New Tools

Adding a new tool to `src/cliTools/registry.ts::AVAILABLE_CLI_TOOLS` MUST satisfy every gate below before the PR merges. The gate set is enforced by the D21 audit checklist and the `validate-cli-skills.ts` CI gate:

1. **Vendor verification** — record the upstream repository URL, current release tag, release date (ISO), and license SPDX identifier on the registry entry.
2. **Web-research recency** — the audit-workspace research-date for the tool MUST be ≤14 days from PR open date; older research requires re-verification.
3. **CVE scan** — inspect GHSA + NVD for advisories ≤180 days old; populate `securityNote` if any unfixed advisory matches, else record `null` with a comment citing the search date.
4. **Skill parity** — a matching `skills/hatch3r-cli-{id}/SKILL.md` with frontmatter (`id`, `type=skill`, `description`, `tags`), Quick Start, and Step pattern exists; `npm run validate:cli-skills` exits 0.
5. **Tier assignment justification** — the registry entry's `tier` field is documented inline: Tier 1 needs evidence of unconditional value (>80% of recommended workflows); Tier 2 needs at least one named trigger from `Tier2Trigger`; Tier 3 needs a use-case statement.
6. **Install-command coverage** — install commands present for `mac` / `linux` / `win` keys covering the CI matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`); WSL is treated as `linux`.
7. **Capability matrix** — `src/adapters/canonical.ts` renders the skill to all 3 adapter outputs (cursor, claude, copilot); the per-adapter render path is tested in `src/__tests__/adapters/{name}.test.ts`.
8. **Alternative-tool comparison** — the PR body lists at least 2 named alternatives considered (with rejection rationale citing measurable trade-offs); avoids tool-duplication per `rules/hatch3r-anti-duplication.md`.
9. **Probe binary registration** — the `probe` field on the registry entry names the binary used by `detectInstalled()`; the probe MUST be the exact executable name printed by the install command output (e.g. `rg` for ripgrep, `fd` for fd, `jq` for jq).
10. **Iteration-summary entry** — the addition emits one row in `rules/hatch3r-iteration-summary.md` §Changes Made with the registry-entry diff link, per the iteration-summary template.

## Removing or Demoting a Tool

A tool moves to `deprecated: true` (proposal field) or out of `AVAILABLE_CLI_TOOLS` only when ALL hold:

- Vendor archived the upstream repository OR last release >24 months AND cadence `stable` no longer holds.
- A named alternative tool already in the registry covers ≥95% of the same use cases.
- A documented migration note in `skills/hatch3r-cli-{old}/SKILL.md` points users to the replacement and lists at least 1 example of the replacement command for each top-level recipe.

Demotion is irreversible at the audit-cycle granularity per `rules/hatch3r-clarification-default.md` B1 — confirm with the framework owner via the user-question protocol before merging the PR.

## Cross-Cycle Currency Records

`governance/audit/execution-insights.json::d21_tool_research_dates` stores the per-cycle research-date promotion log; per CONSTITUTION §2 P3 and D21 SA21.7, the promotion is the only audit artifact that survives between cycles. Wave-level findings in `.audit-workspace/wave-{N}/` are ephemeral.

## D09 + D21 Boundary

D09 (`governance/audit/domains/D09-platform-adapters.md`) audits the per-adapter render of `hatch3r-cli-{id}` skills. D21 audits whether the underlying tool registry is current, accurate, and safe. A render-path bug routes to D09; a stale-tool finding routes to D21. Cross-cycle escalation between D09 and D21 happens via the registry-vs-skills drift check in D21 SA21.7 — drift is a Medium finding regardless of which side is out of sync.

## References

- `governance/CONSTITUTION.md` §2 P3 (currency policy + Decision 21 capability matrix metric).
- `governance/CONSTITUTION.md` §6 Decision 26 (Conventional Commits + supply-chain floor + CI matrix).
- `governance/audit/domains/D21-cli-tooling-recency.md` (per-category sub-agent checklists).
- `src/cliTools/registry.ts` (`AVAILABLE_CLI_TOOLS` schema + tier definitions + cadence enum).
- `src/cliTools/triggers.ts` (tier-2 conditional evaluation + alternative-tool monitor).
- `scripts/validate-cli-skills.ts` (CI gate verifying registry-vs-skill drift).
