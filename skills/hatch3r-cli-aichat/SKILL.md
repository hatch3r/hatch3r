---
id: hatch3r-cli-aichat
description: "Multi-provider LLM chat CLI with RAG and session memory. Use when RAG-enabled multi-provider conversational shell with saved session history; invoke `aichat`. Streams tokens to stdout so downstream `grep`/`tee` consumers see partial results."
tags: ["cli-tools", "ai-cat", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: aichat
  bin: aichat
  tier: 3
  category: ai
  homepage: https://github.com/sigoden/aichat
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# aichat

Multi-provider LLM chat CLI with RAG and session memory

## When to Use

Reach for `aichat` when the task is in the **ai** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
aichat 'explain this commit message' < commit.txt
```
One-shot prompt with stdin as the input payload.

```bash
aichat -r 'tech writer' 'rewrite as bullets' < draft.md
```
Apply a saved role (`~/.config/aichat/roles/tech-writer.md`) as the system prompt.

```bash
aichat --model claude-3-5-sonnet -e 'summarize' README.md
```
Pin the model and pass a file argument directly — `-e` executes the prompt non-interactively.

```bash
aichat --rag mydocs 'how do we configure auth?'
```
Query a pre-built RAG index over local documentation — runs embeddings locally, no remote indexer needed.

```bash
aichat --session refactor-plan
```
Resume a named session with persisted history — useful for multi-turn refinement loops.

## Wrong Choice When

- **Scripted Unix-style pipelines with a rich plugin ecosystem:** `hatch3r-cli-llm` (tier 2) has plugin support for templates, embeddings, and provider adapters not in aichat.
- **Offline-only / fully local inference:** aichat supports Ollama backends but adds an unneeded abstraction; talk to Ollama's HTTP API directly via `curl`.
- **CI batch tasks that benefit from `mods` pipe semantics:** `hatch3r-cli-mods` reads a single piped payload then exits — simpler for one-shot transforms.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-llm` (tier 2) | Plugin ecosystem, templates, embeddings, structured CI use |
| `hatch3r-cli-mods` (tier 3) | Single-piped-payload transforms, Unix-pipe ergonomics |
| Raw `curl` against Ollama / provider HTTP API | Maximum control, no client-side caching or session state |

## Detection / Install

Verify with:
```bash
command -v aichat
```

Install (mac):

```bash
# brew
brew install aichat
```

Homepage: https://github.com/sigoden/aichat
