---
id: hatch3r-cli-mods
description: "Charm mods — Unix-friendly LLM pipeline tool. Use when Unix-pipeline LLM inference reading Markdown stdin and writing Markdown stdout; invoke `mods`. Streams tokens to stdout so downstream `grep`/`tee` consumers see partial results."
tags: ["cli-tools", "ai", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: mods
  bin: mods
  tier: 3
  category: ai
  homepage: https://github.com/charmbracelet/mods
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# mods

Charm mods — Unix-friendly LLM pipeline tool

## When to Use

Reach for `mods` when the task is in the **ai** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
cat README.md | mods 'summarize in 3 bullets'
```
Pipe a file into mods with an inline instruction; output prints to stdout.

```bash
git diff | mods 'write a conventional-commits message for this diff'
```
Generate a commit message from staged changes — pairs well with `git commit -F -`.

```bash
mods -m gpt-4o 'rewrite for clarity' < draft.md
```
Override the default model per invocation.

```bash
mods --no-cache 'fresh response please' < input.txt
```
Bypass the on-disk response cache when you need a non-deterministic re-roll.

```bash
mods -f json 'extract action items as a JSON array' < meeting-notes.md
```
Force a structured-output format — pipes cleanly into `hatch3r-cli-jq`.

## Wrong Choice When

- **Plugin ecosystem needed (templates, embeddings, multi-step chains):** `hatch3r-cli-llm` (tier 2) covers these; mods is intentionally minimal.
- **Multi-turn conversational sessions:** mods is single-shot; use `hatch3r-cli-aichat` for persisted history.
- **Interactive prompt iteration with feedback:** mods has no TUI — `aichat` has REPL mode.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-llm` (tier 2) | Plugin ecosystem, templates, embeddings, CI workflows |
| `hatch3r-cli-aichat` (tier 3) | Multi-turn sessions, RAG mode, role library |
| Raw `curl` against provider API | Custom request shape, streaming, no client process |

## Detection / Install

Verify with:
```bash
command -v mods
```

Install (mac):

```bash
# brew
brew install charmbracelet/tap/mods
```

Homepage: https://github.com/charmbracelet/mods
