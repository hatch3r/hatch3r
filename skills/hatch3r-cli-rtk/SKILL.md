---
id: hatch3r-cli-rtk
description: "CLI output-compression proxy (see ⚠ caveat). Use when compressing oversize tool output payloads before they enter an LLM prompt; invoke `rtk`. Streams tokens to stdout so downstream `grep`/`tee` consumers see partial results."
tags: ["cli-tools", "ai-cat", "opt-in", "caveat"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: rtk
  bin: rtk
  tier: 3
  category: ai
  homepage: https://github.com/rtk-ai/rtk
  caveat: pipe-output-corruption
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# rtk

CLI output-compression proxy (see ⚠ caveat)

## ⚠ Critical: pipe-output corruption (issue #1282)

rtk's compressed output can corrupt downstream consumers when stdout is piped or redirected. Upstream issue #1282 ("Silent output corruption when stdout is piped or redirected") is open as of 2026-05-20; the upstream-suggested fix is a runtime `isatty` check that has not landed yet.

Verified workaround (README §usage + issue #1282 body, re-checked 2026-05-20):
- Wrap any piped or redirected invocation as `rtk proxy <cmd>` — `proxy` is a documented raw-passthrough subcommand that skips compression for that one call.

For other potential flags or env-var kill switches, consult the upstream README directly before relying on them — none are documented at the time of this skill's last verification.

Track upstream: https://github.com/rtk-ai/rtk/issues/1282

## When to Use

Reach for `rtk` when the task is in the **ai** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
rtk run npm test
```
Run the package's test suite under rtk to compress vitest/jest output before it reaches the agent's context.

```bash
rtk run pytest -x
```
Compress pytest output and stop on first failure — fits a multi-thousand-line traceback into a few KB.

```bash
rtk eval 'function foo() { return 42 }'
```
Sandboxed JavaScript eval — returns just the value, no surrounding noise.

```bash
rtk proxy go test ./...
```
Per-invocation opt-out of the pipe rewrite via the `proxy` wrapper when piping output into a downstream parser (`| jq`, `| grep`).

## Wrong Choice When

- **Piping to `jq` / `grep` / `awk` without wrapping the upstream command in `rtk proxy`:** the rewrite mangles byte boundaries (issue #1282) — corruption is silent. Reach for plain shell + `tee` or `hatch3r-cli-jq` directly on raw command output.
- **Safety-critical CI where masked failures matter:** rtk's compression can elide stack frames a downstream check needs. Run the underlying test command directly and capture full output to a file.
- **One-shot small commands under ~100 lines:** the compression overhead exceeds the saved context — invoke the underlying tool directly.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| Plain shell + `tee output.log` | When you need a verbatim log file for forensics or CI artifacts |
| `hatch3r-cli-jq` (tier 1) on raw output | When the upstream command already emits JSON and you want a deterministic projection |
| Direct `npm test` / `pytest -x` with `--reporter` flags | When the test runner has a built-in compact reporter (jest `--silent`, pytest `-q`) |

## Detection / Install

Verify with:
```bash
command -v rtk
```

Install (mac):

```bash
# brew
brew install rtk-ai/tap/rtk
```

Homepage: https://github.com/rtk-ai/rtk
