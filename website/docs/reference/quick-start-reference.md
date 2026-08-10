---
title: Quick Start Reference
---

# Quick Start Reference

Deep-reference companion to the [Quick Start](../getting-started/quick-start): the prompt-by-prompt init walkthrough, created-files table, `--import` migration details, content-profile comparison, timing data, and MCP credential notes the fast path links out to.

:::info Last verified
2026-07-11 against hatch3r 2.5.0. URLs and credential flows reverified each audit cycle (P3 — Adapter & MCP Currency).
:::

## Interactive init prompts {#init-prompts}

`npx hatch3r init` on a fresh GitHub greenfield repo asks 7 prompts (Azure DevOps adds 1, GitLab matches GitHub at 7); `custom` preset adds 1; a workspace root with detected sub-repos adds 1; missing CLI tools add a single confirm:

1. **Platform** — GitHub, Azure DevOps, or GitLab. Auto-detected from your git remote; press Enter to accept.
2. **Repo identity** — 2 sub-prompts for GitHub (owner + repo) and GitLab (namespace + project); 3 for Azure DevOps (org + project + repo). Auto-filled from git remote where possible. Default branch is git-detected, not prompted; project type and team size are inferred and no longer prompted.
3. **Content profile** — `minimal`, `standard` (recommended), `full`, or `custom`. See the [profile table](#content-profiles) below.
4. **Project maturity** — `solo` / `team` / `scaleup` / `enterprise` investment dial, seeded at a git-inferred default; press Enter to accept. Shown unless you pass `--maturity`. See [Maturity Tiers](../guides/maturity-tiers).
5. **Communication style** — `plain` (default: outcome-first, glossed terms) or `technical` operator register for generated-agent output, persisted as the manifest `communicationStyle` dial. Shown unless you pass `--communication-style` or run headless/`--resume` (added 2.8.5 — previously flag-only).
6. **Custom content items** — only when `custom` is selected at step 3.
7. **Tools** — multi-select from the four supported adapters (Claude Code, Cursor, Copilot, Codex).
8. **CLI tools** — tier-grouped picker (tier-1 + trigger-matched tier-2 pre-checked; enter-through equals the `--yes` smart default). MCP is not prompted — opt in with `npx hatch3r init --mcp` or `npx hatch3r mcp setup` later (see [MCP Setup](../guides/mcp-setup)).

Headless `--yes` skips every prompt; the CLI-tools selection falls back to the smart default (tier-1 + trigger-matched tier-2). If detected CLI tools are missing from PATH, hatch3r prints copy-paste install commands and adds one `Mark these tools as 'install pending' and continue?` confirm.

## What gets created {#what-gets-created}

| Path | Purpose |
|------|---------|
| `.hatch3r/hatch.json` | Manifest with content selection, tool list, MCP servers (schemaVersion 3) |
| `.hatch3r/overrides/` | User-authored canonical overrides (escape hatch — adapters prefer overrides over bundled canonical content) |
| `.hatch3r/learnings/`, `.hatch3r/handoffs/`, `.hatch3r/mcp/` | `/learn` outputs, cross-session handoff bundles, resolved MCP config |
| Tool-specific outputs | `.claude/` + `CLAUDE.md` (Claude), `.cursor/` (Cursor), `.github/copilot-instructions.md` + `.github/instructions/` + `.github/prompts/` + `.github/agents/` (Copilot), or `AGENTS.md`/active `AGENTS.override.md` + `.agents/skills/` + `.codex/` + `.hatch3r/codex-support/` (Codex) |
| `.env.mcp` | Secret placeholder file (gitignored) — only created if you enabled MCP |
| `.gitignore` | Updated to exclude `.env.mcp` |
| `.worktreeinclude` | Created only if a worktree-capable tool is selected |

Canonical content is read from the bundled npm package rather than copied into a full `.agents/` mirror. Codex uses only the documented `.agents/skills/hatch3r-*/` projection; the obsolete `.codex/skills/` layout is never emitted.

Slash-command examples on this page apply to Claude Code, Cursor, and GitHub Copilot. Codex has no repository-defined slash-command surface: invoke the generated command-skill bridge as `$hatch3r-command-<name>` instead—for example, `$hatch3r-command-spec` and `$hatch3r-command-board-pickup`.

## Migrating from another tool {#migrating-from-another-tool}

Already have a `.cursor/rules/` setup — or Copilot, Windsurf, a legacy `.cursorrules` file, or a root `AGENTS.md`? Carry your existing rules across on the same `init` run with `--import`:

```bash
npx hatch3r init --import cursor   # or: copilot | windsurf | cursorrules | agents
npx hatch3r init --import auto      # detect and import every supported format in one pass
```

What happens:

- Your existing Cursor rules are converted into hatch3r's canonical form and written under `.hatch3r/overrides/rules/` as paired `.md` + `.mdc` files — the override directory adapters prefer over bundled canonical content, so your rules survive every later `hatch3r sync` / `update`.
- Before writing, hatch3r prints a preview and asks `Write N imported rule(s) (.md + .mdc) to .hatch3r/overrides/rules/?` (skipped under `--yes`).
- The summary reports three counts — `converted`, `conflicts`, and `manual-review`. A **conflict** means an imported rule id collides with a shipped or already-imported rule (it is reported, not silently overwritten); a **manual-review** item is one that could not be auto-converted cleanly. Both are listed per-file so you know exactly what to reconcile by hand.

All five source formats — `cursor`, `copilot`, `windsurf`, `cursorrules` (legacy `.cursorrules`), and `agents` (a root `AGENTS.md`, or its `AGENT.md` singular alias) — are reachable from `--import`. Pass a single format to migrate one tool, or `--import auto` to run every format in one pass; each converted rule lands under `.hatch3r/overrides/rules/` as a paired `.md` + `.mdc`. An `AGENTS.md` that hatch3r itself emitted (it carries `HATCH3R:BEGIN`/`HATCH3R:END` markers) is skipped, never re-imported.

## Content profiles {#content-profiles}

| Profile | What's included | Best for |
|---------|----------------|----------|
| **Minimal** | Capability dial set to core orchestration + implementation, plus the security, UI/UX & content-quality floor. Non-floor planning/review/devops/board helpers are off — pick Standard or Full to dial them in | Quick setup, minimal footprint |
| **Standard** (recommended) | Full development lifecycle (planning, implementation, review, devops, maintenance, board, customize) plus the security, UI/UX & content-quality floor. The performance and AI feature-engineering dials are off — pick Full to turn them on | Most projects |
| **Full** | Every capability, including AI feature engineering and performance, plus the security, UI/UX & content-quality floor and customize | Large teams, full coverage |
| **Custom** | Interactive picker per artifact type | Fine-grained control |

The floor (security, UI/UX, content-quality specialists) ships at every profile and is never dropped — a profile narrows the *capability* dial, not the floor. Because most cluster artifacts also carry a floor tag, a profile drops fewer items than its capability list implies: the `init` / `config` picker computes the realized `omits:` line per profile so you see exactly what a profile leaves out before committing.

The profile is combined with greenfield/brownfield and solo/team filters, so a `solo + greenfield + standard` install carries materially less content than `team + brownfield + full`.

Maturity is a separate axis. `init` prompts for it interactively (the 4th prompt, seeded at a git-inferred tier — press Enter to accept), and you can also set it up front with the `--maturity` flag (`solo`/`team`/`scaleup`/`enterprise`). Either way, maturity does **not** change *what* installs — every tier installs the full corpus — only *how deeply* agents invest. See [Maturity Tiers](../guides/maturity-tiers).

**Upgrading between profiles is additive.** A Minimal → Standard re-run of `npx hatch3r init` shows the explicit add count in the confirmation prompt (e.g. `Switching Minimal → Standard (+45 added). Continue?`). User overrides under `.hatch3r/overrides/`, learnings under `.hatch3r/learnings/`, and handoffs under `.hatch3r/handoffs/` survive the upgrade — only managed adapter outputs regenerate. Downgrades (e.g. Full → Standard) surface a `−N removed` line so the change is visible before commit.

## Time to first value {#time-to-first-value}

Only the `init` row below is instrumented and measured; the spec and PR rows are **model-dependent estimates**, not benchmarked wall-clock numbers. They scale with the agentic model you run, task complexity, and (for the PR row) human review latency, so treat them as a rough planning guide rather than a guarantee.

| Milestone | Wall clock | Basis |
|-----------|------------|-------|
| `npx hatch3r init` (interactive 7 prompts, default flags) | 1-2 min | Measured: clean macOS / Linux box, Node 22.13+, fresh git repo on `main` |
| First successful spec (`/hatch3r-spec` → committed plan) | 5-10 min (estimate) | Model-dependent — varies with model + task scope |
| First PR from board pickup (`/hatch3r-board-pickup` → merged PR) | 30-60 min (estimate) | Model-dependent — varies with model, task scope, and review latency |

The `init` figure is the only one hatch3r can self-time: `hatch3r init` prints a `Completed in Xs` line via the `printTimingSummary` helper (D10-M9) so you can compare your local install time against the measured row above. If your init exceeds ~3 minutes, the most common cause is npm cache cold-start — re-running `npx hatch3r init --yes` shows the typical steady-state cost. hatch3r does not instrument the spec or PR milestones, so those two ranges are not produced by a reproducible benchmark.

## MCP credentials {#mcp-credentials}

Per-server obtain links, required scopes, fine-grained PAT permission tables, and per-editor secret-loading patterns live in the [MCP Setup guide](../guides/mcp-setup#managing-secrets): see [required environment variables](../guides/mcp-setup#required-environment-variables), [GitHub PAT scopes](../guides/mcp-setup#github-pat-scopes), and [how secrets are loaded per editor](../guides/mcp-setup#how-secrets-are-loaded-per-editor). Three notes that guide does not carry:

- **Postgres URL format** — `POSTGRES_URL` is a standard connection string: `postgresql://user:pass@host:5432/db`. Treat it as a secret.
- **Azure DevOps PAT scopes** — Work Items (Read & write), Code (Read & write), Build (Read), Project and Team (Read).
- **GitLab token scope** — `api`.

Codex, Cursor, and Claude Code expect MCP env vars in the process that launches the tool. Source `.env.mcp`, then launch the tool from that same shell. The examples below load values from the local file; they do not contain literal secrets.

```bash
# macOS/Linux (bash/zsh)
set -a && source .env.mcp && set +a && codex
# Alternatives from the same sourced shell: cursor .  /  claude .
```

```powershell
# Windows (PowerShell)
Get-Content .env.mcp | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
codex
# Alternatives from this PowerShell process: cursor .  /  claude .
```

Persist environment loading by adding `set -a; source .env.mcp; set +a` to `~/.zshrc` / `~/.bashrc` (macOS / Linux), or paste values into Cursor's per-server pencil-icon UI. Start Codex from the environment where the variables were loaded.
