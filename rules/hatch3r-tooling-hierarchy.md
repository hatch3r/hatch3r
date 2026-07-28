---
id: hatch3r-tooling-hierarchy
type: rule
description: Platform MCP-first priority, installed CLI tools, documentation MCP for library APIs, web research for CVEs, and spec-run-first browser verification with fallback guidance
scope: conditional
globs: "**/.hatch3r/**,**/mcp/**,**/mcp.json,**/.cursor/**,**/.github/copilot*,**/hatch.json,**/.claude/**"
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Tooling Hierarchy

**Pillars:** P3 (Adapter & External Tool Currency), P7 (Speed & Token Efficiency)

## A. Platform MCP-First (when available)

**Prefer platform MCP tools over the platform CLI** when the MCP server provides typed tools with structured input/output. Use them as the primary interface for issue tracker and repository operations. Read `platform` from `.hatch3r/hatch.json` to determine which platform tools to use.

### Prerequisites

| Platform | Auth Setup |
|----------|-----------|
| **GitHub** | `gh auth login` or `GITHUB_TOKEN` env var. For Projects v2: `gh auth refresh -s project` |
| **Azure DevOps** | `az login` and `az devops configure --defaults organization=ORG project=PROJECT` |
| **GitLab** | `glab auth login` or `GITLAB_TOKEN` env var |

### Platform CLI Fallback Reference

**Fallback to the platform CLI only when** the MCP tool catalog lacks the capability, or an MCP call fails repeatedly and the CLI provides a viable alternative. **Never** use the CLI for operations that have a direct MCP equivalent (issue CRUD, PR/MR CRUD, search, labels).

| Action | GitHub | Azure DevOps | GitLab |
|--------|--------|--------------|--------|
| Create issue | `gh issue create` | `az boards work-item create` | `glab issue create` |
| Edit issue | `gh issue edit` | `az boards work-item update` | `glab issue update` |
| View issue | `gh issue view` | `az boards work-item show --id N` | `glab issue view` |
| List issues | `gh issue list` | `az boards work-item list` | `glab issue list` |
| Create PR/MR | `gh pr create` | `az repos pr create` | `glab mr create` |
| View PR/MR | `gh pr view` | `az repos pr show` | `glab mr view` |
| List PRs/MRs | `gh pr list` | `az repos pr list` | `glab mr list` |
| Merge PR/MR | `gh pr merge` | `az repos pr complete` | `glab mr merge` |
| Search issues | `gh search issues` | `az boards query` | `glab issue list --search` |
| Search PRs | `gh search prs` | `az repos pr list --status all` | `glab mr list --search` |
| Search code | `gh search code` | `az repos show` | `glab search` |
| Labels | `gh label create/list` | `az boards work-item update --fields` | `glab label create/list` |
| Releases | `gh release create` | `az repos release` | `glab release create` |
| CI runs | `gh run list/view/watch` | `az pipelines run list/show` | `glab ci list/view` |
| Projects | `gh project item-add/edit/list` | `az boards iteration/area` | GitLab Boards API |

## B. Installed CLI Tools

Between platform tools and any web or MCP round-trip, check the installed CLI tool set — structured stdout that fits agent context at a fraction of an MCP call's payload.

- **Always-on five:** `rg` (ripgrep), `jq`, `gh`, `fd`, `fzf` — text search, JSON slicing, forge queries, file finding, fuzzy selection.
- **Specialist registry:** `skills/hatch3r-cli-toolbox/SKILL.md` — category-indexed selection reference (HTTP clients, structural rewrite, format converters, data ops, containers, browser automation incl. `playwright-cli`). Consult it whenever the task matches a category; install gaps via `npx hatch3r cli-tools`.

**When to use:** repo-local questions answerable from files or process output — search, JSON/YAML/TOML slicing, forge queries, structural rewrites, spec runs.
**When NOT to use:** external library API questions (§C), or current events and advisories (§D).

## C. Documentation MCP for Library Documentation

Use documentation MCP (e.g., Context7) to retrieve up-to-date, version-specific documentation for external libraries and frameworks. This prevents hallucinated APIs and outdated patterns.

**When to use:** any external dependency — verifying API signatures, configuration options, or migration paths; writing tests with external test frameworks; debugging errors from external libraries.
**When NOT to use:** internal project specs (use project docs), internal codebase patterns (use §B search tools plus code exploration), or general programming concepts not tied to a specific library.

**Fallback when documentation MCP is unavailable:**
If no documentation MCP server (e.g., Context7) is in `mcp.servers` in `.hatch3r/hatch.json`:
- Fall back to web research (§D) for the library's official docs, then read the installed version's type definitions in `node_modules` (or the language equivalent).
- Note in your output when a version-specific lookup would have been valuable (e.g., "Context7 lookup recommended for the express@5 migration but not available").
- Do NOT assert API signatures from memory — flag any unverified third-party API as needing confirmation.

## D. Web Research for External Context

Use web search to retrieve current, real-world information not available in project docs or library documentation.

**When to use:** latest security advisories, CVEs, or vulnerability disclosures for dependencies; breaking changes or deprecations in upcoming versions; current architecture, deployment, or tooling practice compared against community consensus; novel problems with no match in docs (obscure error messages, platform-specific quirks).
**When NOT to use:** questions answerable from project specs or codebase exploration; standard library API questions (use §C); internal project decisions (use project ADRs).

**Fallback when web search is unavailable:**
If no web search MCP server (e.g., `brave-search`) is in `mcp.servers` in `.hatch3r/hatch.json`:
- Note in your output when web research would have been valuable (e.g., "Web research recommended for CVE verification but not available"), and flag security-sensitive decisions that would benefit from current advisory data.
- Rely more heavily on documentation MCP (§C) and codebase exploration.
- Do NOT silently skip web research — surface the limitation so the user can decide whether to enable it.

## E. Browser Verification for UI Changes

Spec-run-first: verify UI changes by writing or updating a Playwright spec and running it headless (`npx playwright test <spec> --reporter=line`), reading only the failure output — assertions execute in the browser process, not in agent context. Full command shape, Tier 2 conditions, and result tokens: `rules/hatch3r-browser-verification.md` → Invocation Contract.

**When to use:** verifying UI component changes render as specified in the design or acceptance criteria; reproducing and confirming fixes for visually observable bugs; accessibility auditing (keyboard nav, contrast, focus indicators); frontend performance profiling.
**When NOT to use:** pure backend or API changes with no visual impact; configuration or infrastructure changes; code refactors that do not alter rendered output.

**Step driving (exception, never the default):** when no spec can express the check or the failure is not yet understood, drive via `playwright-cli` (hosts with skills support — see the §B registry) or Playwright MCP (`@playwright/mcp`) in its default snapshot mode — read page state from accessibility snapshots, never screenshots.

**Fallback when no runner or driver is available:**
- For accessibility, run an in-process axe-core check (`@axe-core/playwright`, `jest-axe`, or `axe-core` in a jsdom test) in the test suite to catch violations without a live browser.
- Report `BLOCKED_MISSING_TOOL` per the invocation contract in `rules/hatch3r-browser-verification.md` — name the missing tool, recommend manual review before merge, and do NOT silently skip.

## F. Knowledge Augmentation Priority

When seeking information, follow this priority order, combining sources when valuable (e.g., read the spec, then verify external API usage with docs MCP, then check for recent advisories via web research):

1. **Project specs and ADRs** — authoritative for project-specific behavior, constraints, and decisions.
2. **Codebase exploration** (code search, semantic code search) — ground truth for current implementation.
3. **Installed CLI tools** (§B) — structured repo-local queries and spec runs before any network round-trip.
4. **Documentation MCP** — authoritative for external library/framework APIs and patterns. Falls back to web research + installed type definitions when unavailable (§C).
5. **Web research** — current events, best practices, security advisories, novel problems.
6. **Browser verification** — spec-run confirmation of UI changes after automated tests pass; falls back to in-process axe-core for a11y when unavailable (§E).
