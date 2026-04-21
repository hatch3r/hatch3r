---
id: hatch3r-tooling-hierarchy
type: rule
description: Platform MCP-first priority, documentation MCP for library APIs, web research for CVEs, and browser MCP for UI verification with fallback guidance
scope: "**/.agents/**,**/mcp/**,**/mcp.json,**/.cursor/**,**/.github/copilot*,**/.windsurf/**,**/hatch.json,**/.claude/**"
tags: [core]
quality_charter: agents/shared/quality-charter.md
---
# Tooling Hierarchy

## A. Platform MCP-First (when available)

**Prefer platform MCP tools over the platform CLI** when the MCP server provides typed tools with structured input/output. Use them as the primary interface for issue tracker and repository operations.

Read `platform` from `.agents/hatch.json` to determine which platform tools to use.

### Prerequisites

| Platform | Auth Setup |
|----------|-----------|
| **GitHub** | `gh auth login` or `GITHUB_TOKEN` env var. For Projects v2: `gh auth refresh -s project` |
| **Azure DevOps** | `az login` and `az devops configure --defaults organization=ORG project=PROJECT` |
| **GitLab** | `glab auth login` or `GITLAB_TOKEN` env var |

### Platform CLI Fallback Reference

**Fallback to the platform CLI only when:**
- The MCP tool catalog lacks the specific capability.
- An MCP call fails repeatedly and the CLI provides a viable alternative.

**Never** use the platform CLI for operations that have a direct MCP equivalent (issue CRUD, PR/MR CRUD, search, labels).

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

## B. Documentation MCP for Library Documentation

Use documentation MCP (e.g., Context7) to retrieve up-to-date, version-specific documentation for external libraries and frameworks. This prevents hallucinated APIs and outdated patterns.

**When to use:**
- Working with any external dependency.
- Verifying API signatures, configuration options, or migration paths.
- Reviewing code that uses third-party libraries.
- Writing tests with external test frameworks.
- Debugging errors from external libraries.

**When NOT to use:**
- Internal project specs — use project docs.
- Internal codebase patterns — use Grep, SemanticSearch, or exploration tools.
- General programming concepts not tied to a specific library.

## C. Web Research for External Context

Use web search to retrieve current, real-world information not available in project docs or library documentation.

**When to use:**
- Latest security advisories, CVEs, or vulnerability disclosures for dependencies.
- Breaking changes or deprecations in upcoming dependency versions.
- Current best practices for architecture patterns, deployment strategies, or tooling.
- Novel problems with no match in docs (e.g., obscure error messages, platform-specific quirks).
- Comparing alternative approaches or tools with current community consensus.

**When NOT to use:**
- Questions answerable from project specs or codebase exploration.
- Standard library API questions (use documentation MCP instead).
- Internal project decisions (use project ADRs).

**Fallback when web search is unavailable:**
If no web search MCP server is configured (e.g., `brave-search` is not in `mcp.servers` in `.agents/hatch.json`), web research cannot be performed. In this case:
- Note in your output when web research would have been valuable (e.g., "Web research recommended for CVE verification but not available").
- Rely more heavily on Context7 documentation MCP and codebase exploration.
- Flag security-sensitive decisions that would benefit from current advisory data.
- Do NOT silently skip web research — surface the limitation so the user can decide whether to enable it.

## D. Browser Verification for UI Changes

Use browser automation MCP tools to visually verify UI changes after automated tests pass.

**When to use:**
- Verifying UI component changes render as specified in the design or acceptance criteria.
- Reproducing and confirming fixes for visually observable bugs.
- Accessibility auditing (keyboard nav, contrast, focus indicators).
- Frontend performance profiling (CPU, frame rate, memory).
- Capturing screenshot evidence for PRs.

**When NOT to use:**
- Pure backend or API changes with no visual impact.
- Configuration or infrastructure changes.
- Code refactors that do not alter rendered output.

**Available tools:**
- IDE-native browser MCP (e.g., `cursor-ide-browser` in Cursor).
- Playwright MCP (`@anthropic/mcp-playwright`) for cross-editor browser automation.

## E. Knowledge Augmentation Priority

When seeking information, follow this priority order:

1. **Project specs and ADRs** — authoritative for project-specific behavior, constraints, and decisions.
2. **Codebase exploration** (code search tools, semantic code search) — ground truth for current implementation.
3. **Documentation MCP** — authoritative for external library/framework APIs and patterns.
4. **Web research** — current events, best practices, security advisories, novel problems.
5. **Browser verification** — visual confirmation of UI changes after automated tests pass.

Combine sources when valuable: read the spec first, then verify external API usage with docs MCP, then check for recent advisories via web research.
