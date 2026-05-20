---
id: hatch3r-cli-llm
description: "simonw/llm — invoke LLMs from the command line with prompt templates. Use when model-agnostic shell prompting with template files and conversation memory; invoke `llm`. Streams tokens to stdout so downstream `grep`/`tee` consumers see partial results."
tags: ["cli-tools", "ai-cat", "maintenance"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: llm
  bin: llm
  tier: 2
  category: ai
  homepage: https://llm.datasette.io/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# llm

simonw/llm — invoke LLMs from the command line with prompt templates

## When to Use

Reach for `llm` when the task is in the **ai** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
llm 'summarize this' < file.txt
```
Pipe a file into the default model; output is plain text on stdout.

```bash
llm -m claude-3-5-sonnet 'rewrite as bullet points' < draft.md > bullets.md
```
Pick a model explicitly and redirect output — useful in batch scripts.

```bash
llm -t code-review -m claude-3-5-sonnet < patch.diff
```
Use a saved prompt template (`-t code-review`); template files live under `~/.config/io.datasette.llm/templates/`.

```bash
llm logs --last 5 --json | jq '.[] | {model, prompt, response}'
```
Inspect recent prompt/response pairs; the local SQLite log is queryable with standard SQL via `llm logs sql`.

```bash
llm templates list
```
List installed templates so the agent picks an existing one instead of writing a new prompt from scratch.

## Wrong Choice When

- You are already running inside an agent driven by an LLM (this assistant) — nesting another LLM call adds latency and cost without new capability.
- The task is deterministic text transformation (e.g., rename a variable across files) — use `sd`/`comby`/`ast-grep`, not an LLM.
- Working offline without a configured local backend — set up Ollama or `llm-local` first; `llm` with no provider errors out.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `aichat` | Want a richer multi-turn TTY chat experience. |
| `mods` | Bias toward shell-friendly piping, prompt-as-flag UX. |
| `curl` to provider API | Need explicit request shape, streaming, or headers `llm` does not expose. |

## Detection / Install

Verify with:
```bash
command -v llm
```

Install (mac):

```bash
# brew
brew install llm
```

Homepage: https://llm.datasette.io/
