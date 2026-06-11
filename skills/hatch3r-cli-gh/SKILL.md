---
id: hatch3r-cli-gh
name: hatch3r-cli-gh
type: skill
description: "GitHub CLI — repos, issues, PRs, releases, gists. Use when drafting GitHub pull requests, issues, releases, gists, or workflow dispatches; invoke `gh`. Authenticates via the platform's native token mechanism (OAuth / PAT)."
tags: ["cli-tools", "forge", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
# D9-H-6 (D9, P1): pre-approve the wrapped shell binary on the GitHub Copilot
# Skills surface so the runtime skips per-invocation confirmation for `gh`.
# Rendered as an `allowed-tools:` frontmatter line on `.github/skills/.../SKILL.md`
# by the Copilot adapter; other adapters ignore the field.
allowed_tools: ["gh"]
cli_tool:
  id: gh
  bin: gh
  tier: 1
  category: forge
  homepage: https://cli.github.com/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# gh

GitHub CLI — repos, issues, PRs, releases, gists

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking `gh`, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the target repo/PR/issue number is not explicit (e.g. "close the PR" with several open), confirm which one before acting — never guess the number.
- **Irreversibility:** `gh pr close`, `gh pr merge`, `gh release create`, `gh issue close`, `gh repo delete`, and `gh api -X DELETE/POST/PATCH` mutate remote state. Confirm intent before running any of these; they are not safe to assume.
- **Ambiguity:** when the request maps to two or more flag combinations with materially different blast radius (e.g. `--squash` vs `--rebase` on `gh pr merge`), ask which one.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a single-tool usage reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `rules/hatch3r-fan-out-discipline.md` (P8 B2).

## When to Use

Reach for `gh` when the task is in the **forge** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
gh pr view 123 --json title,state,body,reviewDecision
```
Targeted JSON projection — pulls just the fields the agent needs, not the whole PR payload.

```bash
gh issue list --label bug --json number,title,author --limit 50
```
Label-filtered list with capped page size — avoids paginating the entire issue corpus into context.

```bash
gh api repos/:owner/:repo/contents/path/to/file.ts --jq '.sha'
```
Direct REST passthrough with built-in `--jq` filter — single round-trip, no jq install required at call site.

```bash
gh run watch
```
Blocks until the most recent CI run finishes — pairs with PR creation flows so the agent doesn't poll.

```bash
gh release create v1.7.5 --notes-from-tag --target release/1.7.5
```
Cuts a release using annotated-tag notes; deterministic input avoids hand-edited release bodies.

```bash
gh pr checks 78 --watch
```
Live-tail status checks for a PR — return value reflects the worst check state, scripts can branch on it.

## Wrong Choice When

- Don't reach for `gh` against a GitLab or Azure DevOps remote. Reach for `glab` or `az repos`/`az devops` (both covered in `hatch3r-cli-toolbox` — Forges section).
- Don't use `gh auth login` flows when an audit trail of who authorized what is required; OAuth scopes granted to the CLI are user-bound. Reach for the GitHub web UI plus org-level SSO logs.
- Don't use `gh api` for high-volume bulk fetches (>10k records) — rate limits bite. Reach for the GraphQL endpoint via `gh api graphql -F query=@file.gql` with pagination, or a GitHub App token.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `glab` (toolbox section) | GitLab forges — same operations, different vendor. |
| `az-devops` (toolbox section) | Azure DevOps forges. |
| `git` + `curl` against REST | Minimal environment (CI runner) where installing `gh` is blocked; trade convenience for raw HTTP. |
| GitHub web UI | Operations needing org-level approval flows or SAML re-auth that the CLI cannot proxy. |

## Detection / Install

Verify with:
```bash
command -v gh
```

Install (macOS — default for this machine):

```bash
# brew
brew install gh
```

Install (Linux):

```bash
# apt
sudo apt install gh
```

Install (Windows):

```bash
# winget
winget install GitHub.cli
```

Homepage: https://cli.github.com/

## Security

Minimum recommended version: `>=2.93.0`. Builds below this floor carry known unpatched advisories — upgrade before relying on the tool.

GHSA-8xvp-7hj6-mcj9 (CVE-2026-48501, High): gh CLI 2.92.0 and earlier attach the Authorization header to TUF repository-mirror requests issued by `gh attestation`, `gh release verify`, and `gh release verify-asset` — sending the github.com token (or `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN`) to hosts that are not GitHub API endpoints (`tuf-repo.github.com`, `tuf-repo-cdn.sigstore.dev`, and an Azure blob host). Any token previously used with those commands should be treated as exposed and rotated. Fixed in 2.93.0 — upgrade before running attestation or release-verify flows.

GHSA-crc3-h8v6-qh57 (CVE-2026-45803, Low): `gh run view --log` and `gh run view --log-failed` stream GitHub Actions workflow log lines to stdout or the pager without sanitizing terminal control sequences, so a malicious workflow can embed escape sequences that execute when a maintainer views the log (altered window titles, manipulated output, command execution in emulators such as `screen`). This is an escape-sequence-injection issue, not a token leak. Fixed in 2.92.0 — upgrade before viewing logs from untrusted workflows.

GHSA-55v3-xh23-96gh (token-leak note, `cli/go-gh` library): inside a codespace, `auth.TokenForHost` could source `GITHUB_TOKEN` for a non-`github.com`/`ghe.com` host, sending the token to an unintended host. Fixed in go-gh 2.11.1, vendored into gh ≥ 2.42.0; the `>=2.93.0` floor already clears it. Relevant when running gh against untrusted GitHub Enterprise hosts from a codespace.

## References

- GHSA-8xvp-7hj6-mcj9 / CVE-2026-48501 — https://github.com/cli/cli/security/advisories/GHSA-8xvp-7hj6-mcj9 (accessed 2026-06-06; tier: vendor advisory — GitHub CLI maintainers)
- GHSA-crc3-h8v6-qh57 / CVE-2026-45803 — https://github.com/cli/cli/security/advisories/GHSA-crc3-h8v6-qh57 (accessed 2026-06-05; tier: vendor advisory — GitHub CLI maintainers)
- GHSA-55v3-xh23-96gh — https://github.com/cli/go-gh/security/advisories/GHSA-55v3-xh23-96gh (accessed 2026-06-05; tier: vendor advisory — GitHub CLI maintainers)
- GitHub Advisory Database (queried via `gh api /repos/cli/cli/security-advisories`, accessed 2026-06-05; tier: official advisory feed)
