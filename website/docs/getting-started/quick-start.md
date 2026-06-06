---
sidebar_position: 2
title: Quick Start
---

# Quick Start

A copy-paste-runnable walkthrough that takes a project from empty to released using hatch3r. The path is the same for greenfield and brownfield work — the spec step (Step 4) auto-detects which one you are in and branches for you.

:::info Last verified
2026-05-28 against hatch3r 2.0.0. URLs and credential flows reverified each audit cycle (P3 — Adapter & MCP Currency). MCP became opt-in in 1.7.5 — leaving the MCP multi-select empty skips MCP entirely; selecting any server triggers automatic platform-MCP inclusion.
:::

## Prerequisites

- **Node.js 22 or later** — the only hard prerequisite. Check with `node --version`.
- **A git repository** at the working directory, OR a non-git folder containing one or more git subdirectories (workspace mode is auto-detected).
- **One of the [supported tools](./supported-tools)** — Cursor, Claude Code, or GitHub Copilot. (As of 1.9.0, hatch3r supports these 3 adapters only; see [CHANGELOG](https://github.com/hatch3r-dev/hatch3r/blob/main/CHANGELOG.md) for the 1.9.0 scope cut.)

That is it. No global install, no preflight setup.

---

## Step 1 — Initialize hatch3r

```bash
npx hatch3r init
```

Interactive flow (~2 minutes). On a fresh GitHub greenfield repo hatch3r asks 6 prompts (Azure DevOps adds 1, GitLab matches GitHub at 6); `custom` preset adds 1; a workspace root with detected sub-repos adds 1; missing CLI tools add a single confirm:

1. **Platform** — GitHub, Azure DevOps, or GitLab. Auto-detected from your git remote; press Enter to accept.
2. **Repo identity** — 2 sub-prompts for GitHub (owner + repo) and GitLab (namespace + project); 3 for Azure DevOps (org + project + repo). Auto-filled from git remote where possible. Default branch is git-detected, not prompted; project type and team size are inferred and no longer prompted.
3. **Content profile** — `minimal`, `standard` (recommended), `full`, or `custom`. See the [profile table](#content-profiles) below.
4. **Custom content items** — only when `custom` is selected at step 3.
5. **Tools** — multi-select from the 3 supported adapters (Cursor, Claude Code, Copilot).
6. **MCP servers** — multi-select from 10 servers (3 default, 7 opt-in). Leaving everything unchecked is the `(none)` no-op and skips MCP entirely; selecting any server auto-includes the platform MCP that matches your detected platform (per `src/cli/commands/init.ts` mcpServers step).

Headless `--yes` skips every prompt; `cli-tools` selection is auto-inferred from project triggers (no separate picker prompt). If detected CLI tools are missing from PATH, hatch3r prints copy-paste install commands and adds one `Mark these tools as 'install pending' and continue?` confirm.

For headless / CI use, pass `--yes` with optional flags:

```bash
npx hatch3r init --yes --preset standard --tools claude --project-type brownfield --team-size team
```

### What gets created

| Path | Purpose |
|------|---------|
| `.hatch3r/hatch.json` | Manifest with content selection, tool list, MCP servers (schemaVersion 3) |
| `.hatch3r/overrides/` | User-authored canonical overrides (escape hatch — adapters prefer overrides over bundled canonical content) |
| `.hatch3r/learnings/`, `.hatch3r/handoffs/`, `.hatch3r/mcp/` | `/learn` outputs, cross-session handoff bundles, resolved MCP config |
| Tool-specific outputs | `.cursor/` (Cursor), `.claude/` + `CLAUDE.md` (Claude), `.github/copilot-instructions.md` + `.github/instructions/` + `.github/prompts/` + `.github/agents/` (Copilot) |
| `.env.mcp` | Secret placeholder file (gitignored) — only created if you enabled MCP |
| `.gitignore` | Updated to exclude `.env.mcp` |
| `.worktreeinclude` | Created only if a worktree-capable tool is selected |

Canonical content (agents, skills, rules, commands, hooks) is no longer materialized into `.agents/` in your repo — it's read from the bundled npm package by each adapter.

### Content profiles

| Profile | What's included | Best for |
|---------|----------------|----------|
| **Minimal** | Capability dial set to core orchestration + implementation, plus the security, UI/UX & content-quality floor. Non-floor planning/review/devops/board helpers are off — pick Standard or Full to dial them in | Quick setup, minimal footprint |
| **Standard** (recommended) | Full development lifecycle (planning, implementation, review, devops, maintenance, board, customize) plus the security, UI/UX & content-quality floor. The performance and AI feature-engineering dials are off — pick Full to turn them on | Most projects |
| **Full** | Every capability, including AI feature engineering and performance, plus the security, UI/UX & content-quality floor and customize | Large teams, full coverage |
| **Custom** | Interactive picker per artifact type | Fine-grained control |

The floor (security, UI/UX, content-quality specialists) ships at every profile and is never dropped — a profile narrows the *capability* dial, not the floor. Because most cluster artifacts also carry a floor tag, a profile drops fewer items than its capability list implies: the `init` / `config` picker computes the realized `omits:` line per profile so you see exactly what a profile leaves out before committing.

The profile is combined with greenfield/brownfield and solo/team filters, so a `solo + greenfield + standard` install carries materially less content than `team + brownfield + full`.

Maturity is a separate axis. The `--maturity` dial (`solo`/`team`/`scaleup`/`enterprise`) does **not** change *what* installs — every tier installs the full corpus — only *how deeply* agents invest. See [Maturity Tiers](../guides/maturity-tiers).

**Upgrading between profiles is additive.** A Minimal → Standard re-run of `npx hatch3r init` shows the explicit add count in the confirmation prompt (e.g. `Switching Minimal → Standard (+45 added). Continue?`). User overrides under `.hatch3r/overrides/`, learnings under `.hatch3r/learnings/`, and handoffs under `.hatch3r/handoffs/` survive the upgrade — only managed adapter outputs regenerate. Downgrades (e.g. Full → Standard) surface a `−N removed` line so the change is visible before commit.

### Time to first value

Only the `init` row below is instrumented and measured; the spec and PR rows are **model-dependent estimates**, not benchmarked wall-clock numbers. They scale with the agentic model you run, task complexity, and (for the PR row) human review latency, so treat them as a rough planning guide rather than a guarantee.

| Milestone | Wall clock | Basis |
|-----------|------------|-------|
| `npx hatch3r init` (interactive ≤5 prompts, default flags) | 1-2 min | Measured: clean macOS / Linux box, Node 22, fresh git repo on `main` |
| First successful spec (`/hatch3r-spec` → committed plan) | 5-10 min (estimate) | Model-dependent — varies with model + task scope |
| First PR from board pickup (`/hatch3r-board-pickup` → merged PR) | 30-60 min (estimate) | Model-dependent — varies with model, task scope, and review latency |

The `init` figure is the only one hatch3r can self-time: `hatch3r init` prints a `Completed in Xs` line via the `printTimingSummary` helper (D10-M9) so you can compare your local install time against the measured row above. If your init exceeds ~3 minutes, the most common cause is npm cache cold-start — re-running `npx hatch3r init --yes` shows the typical steady-state cost. hatch3r does not instrument the spec or PR milestones, so those two ranges are not produced by a reproducible benchmark.

---

## Step 2 — Add MCP credentials

Skip this step if you did not enable any credential-requiring MCP server. The 3 default servers (Playwright, Context7, Filesystem) need nothing.

The 7 opt-in servers each need an API key or token. Open `.env.mcp` and fill the placeholder values:

```bash
# .env.mcp — generated by hatch3r init (gitignored)
GITHUB_PAT=ghp_xxxxxxxxxxxx
BRAVE_API_KEY=BSA_xxxxxxxx
# ... and any others your selected servers need
```

### Where to obtain each credential

| Server | Env var | Where to obtain | Required scopes / notes |
|--------|---------|-----------------|-------------------------|
| **GitHub** | `GITHUB_PAT` | [github.com/settings/tokens/new](https://github.com/settings/tokens/new) | Classic PAT: `repo`, `read:org`, `project`. Fine-grained PATs still cannot access **user-owned** Projects V2 as of 2026 — for board commands on user-owned projects, classic is required. |
| **Brave Search** | `BRAVE_API_KEY` | [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register) | Brave retired the free tier in 2026. New users get $5/month in credits (~1,000 queries); legacy free-plan users grandfathered to 2,000/month. Credit card required. |
| **Sentry** | `SENTRY_AUTH_TOKEN` | [sentry.io/settings/account/api/auth-tokens/](https://sentry.io/settings/account/api/auth-tokens/) | User token for personal MCP. Org-scoped tokens (Org Settings → Auth Tokens) are preferred for shared / CI use. |
| **Postgres** | `POSTGRES_URL` | Your database provider | Format: `postgresql://user:pass@host:5432/db`. Treat as a secret. |
| **Linear** | `LINEAR_API_KEY` | [linear.app/settings/api](https://linear.app/settings/api) | Personal API keys are still supported. OAuth 2.0 is preferred for shared installations. |
| **Azure DevOps** | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Microsoft Learn — Use PATs](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) | Scopes: Work Items (R/W), Code (R/W), Build (R), Project and Team (R). Microsoft now recommends Entra ID over PATs; PATs still work for hatch3r MCP, but Entra-backed orgs require sign-in every 90 days to keep PATs active. |
| **GitLab** | `GITLAB_TOKEN` | [gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens) | Scope: `api`. For automation contexts, consider Project Access Tokens or Group Access Tokens instead of personal PATs. Self-hosted: also set `GITLAB_HOST=https://gitlab.example.com`. |

For deeper guidance — fine-grained PAT permission tables, Claude Code permission opinions, custom MCP server registration — see the [MCP Setup guide](../guides/mcp-setup).

### Loading secrets into your editor

Two patterns, depending on the tool:

**Auto-loaded** — VS Code / Copilot read env vars from the `env` object hatch3r writes into `.vscode/mcp.json`. No sourcing needed; just fill `.env.mcp` and let the adapter regenerate the per-tool config on the next `sync`.

**Source-and-launch** — Cursor and Claude Code expect env vars to be present in the process that launches the editor:

```bash
# macOS / Linux (zsh, bash)
set -a && source .env.mcp && set +a && cursor .          # or: claude .
```

```powershell
# Windows (PowerShell)
Get-Content .env.mcp | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
cursor .
```

Persist tokens by adding the `set -a; source .env.mcp; set +a` lines to `~/.zshrc` / `~/.bashrc`, or paste them into Cursor's per-server pencil-icon UI.

---

## Step 3 — Restart your editor

MCP configs are read on editor launch. Close and reopen so the new `.cursor/mcp.json` / `.mcp.json` / etc. takes effect.

Verify connection: most editors show MCP status in their Tools / Settings panel. In Cursor, Settings → Tools & MCP — each enabled server should show a green dot and its tools should appear in the Available Tools list inside chat.

---

## Step 4 — Define scope

Pick the path that matches the work in front of you.

### Full project — greenfield or brownfield

```
/hatch3r-spec       # Auto-detects greenfield vs brownfield and runs the matching spec flow
/hatch3r-roadmap    # Phased plan with epics, broken into milestones
```

`hatch3r-spec` is the 2.0.0 unified spec orchestrator: on a new project it generates specs from your vision; on an existing codebase it reverse-engineers specs from the current code. It picks the branch by detecting project state — you do not choose greenfield vs brownfield yourself.

If you need to force one branch, the split commands still exist as a legacy path: `/hatch3r-project-spec` (greenfield only) or `/hatch3r-codebase-map` (brownfield only), each followed by `/hatch3r-roadmap`.

### Single feature (no full project)

```
/hatch3r-feature-plan   # Plan one feature in depth — no board needed
```

After `/hatch3r-feature-plan` produces the plan, run `/hatch3r-workflow` (Quick Mode) — it walks the implement → review → test pipeline standalone, no board required.

### Tiny change (typo / config tweak / one-file refactor)

```
/hatch3r-quick-change   # Skip everything below; this is a complete one-shot flow
```

If you took the tiny-change path, you are done — jump to [Step 8](#step-8--maintain-canonical-state).

---

## Step 5 — Set up the board

:::note Board workflows are team-scoped
Steps 5–7 (board init / fill / pickup) install only when your repo resolved to **team** size. `hatch3r init` infers team size from git history (more than one distinct commit-author email ⇒ team) and defaults a single-author or fresh repo to **solo**, where the board cluster is not installed. If you ran a solo install, `init` prints a one-line note saying so — re-run with `--team-size team` (or switch later via `hatch3r config`) to add the board chain. Solo developers who work issue-by-issue can skip to [Step 8](#step-8--maintain-canonical-state) and drive single features without a board.
:::

Invoke the `hatch3r-board-init` skill from your editor (Claude Code: `Skill: hatch3r-board-init`; Cursor: load the skill from the skills picker; Copilot: reference the skill in the chat).

This creates or connects a project board on your detected platform — a GitHub Projects V2 board, an Azure DevOps board, or a GitLab Issues board. It writes back the resolved board owner / project number / area labels into `hatch.json` so subsequent commands target the correct board.

Skip this step for the single-feature path.

---

## Step 6 — Fill the board

Write a `todo.md` at the project root with one line per work item:

```markdown
- Add OIDC login support for the customer portal
- Migrate analytics events to the new schema
- Replace Stripe webhook polling with idempotent event ingestion
```

Then run:

```
/hatch3r-board-fill
```

`board-fill` parses `todo.md`, classifies each item (feature / bug / refactor / migration / test), groups items into epics, builds a dependency DAG, and marks ready items as `status:ready` on the board.

For backlog hygiene later: invoke the `hatch3r-board-groom` skill — it surfaces stale items, priority imbalances, and decomposition candidates.

---

## Step 7 — Pick up work

```
/hatch3r-board-pickup
```

`board-pickup` selects the next `status:ready` issue by dependency order and priority, creates a feature branch, and runs the four-phase agent pipeline: research → implement → review loop (reviewer + fixer, max 3 iterations) → final quality gates (test-writer + security-auditor). When the loop converges clean, it opens a PR.

The reviewer + fixer loop is automatic — there is no separate `review` command.

Repeat this step until the board drains.

---

## Step 8 — Maintain canonical state

Day-to-day commands you will run as you edit `.hatch3r/overrides/` content or rotate tools:

| Command | When to run |
|---------|-------------|
| `npx hatch3r sync` | After editing anything under `.hatch3r/overrides/` or upgrading hatch3r. Re-generates all tool outputs from bundled canonical content + your overrides. |
| `npx hatch3r status` | Drift check — does any adapter-output file differ from what hatch3r would regenerate now? |
| `npx hatch3r validate` | Pre-commit / CI structural check — frontmatter, cross-references, content compliance on bundled content + your overrides. Exit 0 means clean. |
| `npx hatch3r verify` | Thin wrapper around `status` that exits non-zero on drift. |
| `npx hatch3r config` | Reconfigure platform, tools, MCP servers, features, or content selection — fully interactive. |
| `npx hatch3r update` | Pull the latest hatch3r templates, safe-merging into your customizations. Use `--offline` to skip the npm fetch. |
| `npx hatch3r clean` | Remove all hatch3r-managed artifacts (preserves `.hatch3r/overrides/`, `.hatch3r/learnings/`, `.hatch3r/handoffs/`, `.hatch3r/mcp/`). |

---

## Step 9 — Release

Prerequisite: `npm run lint && npm run typecheck && npm run test && npm run build` must pass — the release skill verifies these and halts on failure. Before invoking it, also run `npx hatch3r validate` to confirm canonical content has not drifted (it is the framework's drift-detection gate and the release skill does not run it for you).

Invoke the `hatch3r-release` skill.

The release skill reads the conventional-commit history since the last tag, decides the semver bump (patch / minor / major), generates a changelog entry, tags, and publishes per your project's release config.

That closes the loop: init → spec → board → pickup → release.

---

## Multi-Repo Workspace

If your working directory is a non-git folder containing multiple git subdirectories (e.g. `frontend/`, `backend/`, `infra/`), hatch3r auto-detects workspace mode. Force it explicitly with `--workspace`:

```bash
npx hatch3r init --workspace
npx hatch3r sync                          # cascade to all repos
npx hatch3r sync --repos frontend         # sync only frontend/
npx hatch3r sync --dry-run                # preview without writing
npx hatch3r config                        # add or remove repos, change sync strategy
```

The shared `.hatch3r/` lives at the workspace root; each sub-repo gets independent adapter outputs (not symlinks), with optional per-repo overrides for tools, features, and content. See the [Workspace guide](../guides/workspace) for details.

---

## Where to read next

- [MCP Setup](../guides/mcp-setup) — full per-server configuration, PAT scope tables, custom MCP servers, Claude Code permissions
- [Workflow guide](../guides/workflow) — the deeper view of the four-phase pipeline and review loop
- [Adapter Capability Matrix](../reference/adapter-capability-matrix) — which adapters emit MCP, hooks, skills, etc.
- [Troubleshooting](../troubleshooting) — common init / sync / MCP errors and fixes
