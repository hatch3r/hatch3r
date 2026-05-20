---
id: hatch3r-cli-lazygit
description: "Terminal UI for git with keyboard-driven workflows. Use when keyboard-driven terminal UI for staging, rebasing, branch switching; invoke `lazygit`. Reads `.git/objects` directly without invoking external services or remotes."
tags: ["cli-tools", "git", "maintenance"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: lazygit
  bin: lazygit
  tier: 2
  category: git
  homepage: https://github.com/jesseduffield/lazygit
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# lazygit

Terminal UI for git with keyboard-driven workflows

## When to Use

Reach for `lazygit` when the task is in the **git** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

`lazygit` is a TUI for humans; agents should call plain `git` instead. The recipes below are key bindings inside the running TUI, not shell commands.

```bash
lazygit
```
Launch the TUI in the cwd repo — requires an interactive terminal; will hang in a non-TTY context.

```bash
lazygit -p path/to/repo
```
Open the TUI on a specific repo without changing directory first.

Key bindings inside the TUI (human reference):
- `a` — stage all changes in the focused file
- `c` — open the commit message editor
- `P` — push current branch
- `p` — pull current branch
- `?` — show the full keymap

## Wrong Choice When

- The caller is an autonomous agent (no human at the terminal) — use plain `git status` / `git add` / `git commit` instead; they emit parseable stdout.
- The task is part of a CI script — `lazygit` cannot run headless; rely on `git` plumbing commands.
- You need a scriptable diff view — pair `git diff` with `delta` or `difftastic` rather than launching a TUI.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `git` (plain) | Anything an agent or CI script runs. |
| `tig` | Prefer a different TUI keymap; broadly similar capability. |
| `gh` / `glab` | The operation is forge-side (PRs, issues), not local repo state. |

## Detection / Install

Verify with:
```bash
command -v lazygit
```

Install (mac):

```bash
# brew
brew install lazygit
```

Homepage: https://github.com/jesseduffield/lazygit
