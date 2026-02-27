---
id: hatch3r-tooling-hierarchy
type: rule
description: Priority order for tools and knowledge sources
scope: always
---
# Tooling Hierarchy

## A. GitHub CLI-First

**Prefer `gh` CLI over GitHub MCP tools** for GitHub operations. CLI tools are optimized for agent use — lower token cost, faster execution, and deterministic output parsing.

**Prerequisites:** `gh auth login` must be completed, or `GITHUB_TOKEN` environment variable set. For Projects v2: `gh auth refresh -s project`.

**Primary tool for:**
- Issue CRUD: `gh issue create`, `gh issue edit`, `gh issue view`, `gh issue list`
- PR CRUD: `gh pr create`, `gh pr view`, `gh pr list`, `gh pr merge`
- Search: `gh search issues`, `gh search prs`, `gh search code`
- Labels: `gh label create`, `gh label list`
- Releases: `gh release create`
- CI/Actions: `gh run list`, `gh run view`, `gh run watch`
- Projects v2: `gh project item-add`, `gh project item-edit`, `gh project item-list`, `gh project field-list`, `gh project view`

**Fallback to GitHub MCP only when:**
- The `gh` CLI lacks the specific capability (e.g., sub-issue management via `sub_issue_write`).
- GraphQL queries are needed that `gh api graphql` cannot express concisely.

**Never** use GitHub MCP for operations that `gh` CLI handles well (issue CRUD, PR CRUD, search, labels, releases).

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

## D. Browser Verification for UI Changes

Use browser automation MCP tools to visually verify UI changes after automated tests pass.

**When to use:**
- Verifying UI component changes render correctly.
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
