---
id: hatch3r-report
type: skill
description: Generate an in-chat session report from the active or named transcript — every tool call, sub-agent delegation, and file edit, with diagnostics for missed parallelism, redundant work, and over-serialization. Default = current session, executive summary, in-chat.
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Session Report — Agentic Action Replay

Render an in-chat report of what happened in a Claude Code session: every tool call, every sub-agent `Agent` delegation, every file edit, every hook event. Default = current session, executive summary, in-chat. Flags extend scope and depth. Two audiences: (a) users who want to understand the session end-to-end; (b) maintainers investigating runtime shape for framework-level optimizations.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1) — only if invocation arguments are ambiguous
- [ ] Step 1: Discover the session
- [ ] Step 2: Aggregate via jq
- [ ] Step 3: Compute diagnostics
- [ ] Step 4: Render executive summary
- [ ] Step 5: Render verbose timeline (--verbose only)
- [ ] Step 6: Save to disk (--save only)
```

## Step 0 — Detect Ambiguity (P8 B1)

This skill is read-only over local transcripts and produces no file mutations outside `.hatch3r/reports/` (and only with `--save`). The platform-native question tool is invoked only when the user's `--session <value>` argument fails to resolve to a readable file or when `--save` would overwrite an existing report — see Error Handling. Otherwise the skill runs without an ASK gate.

## Argument Parsing

| Flag | Effect |
|------|--------|
| `--session <id\|path>` | Target a UUID under the project slug dir, or an absolute `.jsonl` path. Default = newest-mtime jsonl in current project slug. |
| `--list` | Exclusive. Print the 5 most-recent sessions in this project (sessionId, mtime, first-user-message preview 60 chars). Skips all other rendering. |
| `--verbose` | Append a chronological per-turn timeline after the executive summary. |
| `--save` | After rendering in-chat, also write to `.hatch3r/reports/{sessionId-short8}-{YYYYMMDD-HHMMSS}.md`. |

`--list` takes precedence over `--session`, `--verbose`, `--save`. All other flags compose.

## Step 1 — Discover the Session

Compute the project slug from the working directory: `SLUG="$(pwd | sed 's|/|-|g')"`. The transcript directory is `~/.claude/projects/${SLUG}`. List `*.jsonl` files; the active session is the newest by mtime (`ls -t *.jsonl | head -1`). When `--session <value>` is provided, resolve a 36-char UUID against the slug dir as `${value}.jsonl`, otherwise treat as an absolute path. When `--list` is set, enumerate the top-5 newest jsonl files; for each, parse the first `type=user` record and emit `<short-id>  <mtime>  <first-60-chars-of-user-text>`.

## Step 2 — Aggregate via jq

Run jq over the JSONL to produce a single structured JSON of counts. Persist to `$(mktemp)` so the LLM reads aggregated data only. Sample pipeline:

```bash
jq -s '
  def tu: [.[] | select(.message.content?) | .message.content[] | select(.type=="tool_use")];
  def tr: [.[] | select(.message.content?) | .message.content[] | select(.type=="tool_result")];
  def asst_turns: [.[] | select(.type=="assistant" and (.message.content?))];
  def thinks: [.[] | select(.message.content?) | .message.content[] | select(.type=="thinking") | .text];
  {
    sessionId: .[0].sessionId, firstTs: .[0].timestamp, lastTs: .[-1].timestamp,
    cwd: .[0].cwd, gitBranch: .[0].gitBranch, records: length,
    toolCounts: (tu | group_by(.name) | map({tool: .[0].name, count: length}) | sort_by(-.count)),
    distinctReads: (tu | map(select(.name=="Read") | .input.file_path) | unique | length),
    distinctEdits: (tu | map(select(.name=="Edit" or .name=="Write") | .input.file_path) | unique | length),
    topReads: (tu | map(select(.name=="Read") | .input.file_path) | group_by(.) | map({path: .[0], count: length}) | sort_by(-.count) | .[0:3]),
    agentCalls: (tu | map(select(.name=="Agent") | {sub: (.input.subagent_type // "general-purpose"), prompt: (.input.prompt[:80] // "")})),
    bashCmds: (tu | map(select(.name=="Bash") | .input.command)),
    turnLens: [asst_turns[] | (.message.content | map(select(.type=="tool_use")) | length)],
    thinkingChars: ([thinks[] | length] | add // 0),
    errorResults: (tr | map(select((.content | tostring) | test("error|failed"; "i"))) | length),
    totalResults: (tr | length)
  }' "$JSONL"
```

`thinkingChars` is the summed length of every `thinking` block's text — required input for D-LOOP-01 (`thinking chars ÷ (tool_use count + 1) > 1200`).

The LLM reads the resulting JSON, computes derived metrics (parallel-batch count = turns with ≥2 tool_use; sequential count = turns with exactly 1), and builds the rendered tables.

## Step 3 — Compute Diagnostics

Apply each rule in §Diagnostic Heuristics over the aggregated structure. Each fired diagnostic produces a record `{id, severity, turns:[...], evidence, suggestion}`. Emit at most one fire per rule per session (consolidate same-rule fires across turns into one record). If zero rules fire, render `None — execution shape is clean.`

## Step 4 — Render Executive Summary

Always emit. Headings, order, and content per §Output Format. Mask obvious secret patterns (`sk-...`, `ghp_...`, `xoxb-...`, `AIza...`, `Bearer ...`) in any rendered tool_use input field. Truncate Bash commands and Agent prompts to ≤80 chars in tables.

## Step 5 — Render Verbose Timeline (--verbose only)

Append `## Timeline`. For each assistant turn containing ≥1 tool_use, emit a numbered block: turn index, ISO timestamp, elapsed-since-start, optional `thinking: N chars` summary, one line per tool_use (tool name + first 60 chars of primary input field), and a parallel/sequential marker — `→ {n} tool_use blocks ✓ parallel` when n≥2, `→ 1 tool_use ⚠ sequential` when n=1.

## Step 6 — Save to Disk (--save only)

Create `.hatch3r/reports/` if missing. Write the rendered markdown (executive summary + timeline if `--verbose` set) to `.hatch3r/reports/{sessionId-short8}-{YYYYMMDD-HHMMSS}.md`. Append a `## Raw Counts (machine-readable)` section containing the jq-aggregated JSON in a fenced ```json``` block — this lets future tooling grep across sessions without re-parsing the source JSONL. Print the file path back to chat. The `.hatch3r/` directory is gitignored.

## Output Format

```markdown
## Session Report — a5d750f7

**Window:** 2026-05-12 09:14:03 → 09:47:21 (33m 18s, 272 records)
**Project:** hatch3r (release/1.7.1)

### Tool Activity (91 tool calls)

| Tool | Calls | Notable |
|------|------:|---------|
| Read | 47 | 12 distinct files; validate.ts read 4x |
| Bash | 21 | 6 parallel batches, 15 sequential |
| Edit | 18 | 9 distinct files |
| Task |  4 | 3 general-purpose, 1 explore — all sequential |
| Grep |  1 | — |

### Sub-Agent Delegation (4 Agent calls)

| # | Subagent | Prompt (first 60) | Files touched |
|---|----------|-------------------|---------------|
| 1 | general-purpose | "Find references to validateCommandOrch..." | 0 |
| 2 | Explore | "Map existing commands that overlap..." | 0 |
| 3 | Explore | "Find conversation transcript access..." | 0 |
| 4 | Plan | "Design hatch3r-report command..." | 0 |

### File Footprint

- 12 distinct files read; 9 distinct files edited
- Top 3 most-read: src/cli/commands/validate.ts (4x), skills/hatch3r-context-health/SKILL.md (2x), CHANGELOG.md (2x)

### Diagnostics

- WARN D-PAR-01 Missed parallelism: turns 7, 9, 11 each issued one Read on disjoint paths → batch into one assistant turn.
- WARN D-RED-01 Redundant Read: src/cli/commands/validate.ts read at turns 4, 8, 22, 31 with no Edit between turns 4 and 31.
- INFO D-PAR-02 Sub-agent fan-out: 4 Agent calls at turns 44, 53, 67, 78 — disjoint subsystems → eligible for parallel fan-out.

### Suggested Next Action

Re-run `/hatch3r-report --verbose` for the chronological timeline.
```

## Diagnostic Heuristics

| ID | Heuristic | Trigger | Severity |
|----|-----------|---------|----------|
| D-PAR-01 | Missed parallelism (same-tool sequential) | ≥3 consecutive assistant turns each with exactly 1 `tool_use` of the **same** tool type targeting disjoint inputs | WARN |
| D-PAR-02 | Sub-agent fan-out missed | ≥2 `Agent` tool_use blocks within 10 turns where prompt subjects target disjoint path prefixes | WARN |
| D-RED-01 | Redundant Read | Same `Read.file_path` in ≥3 tool_use blocks with no intervening `Edit`/`Write` on that path | WARN |
| D-RED-02 | Re-Bash identical command | Same `Bash.command` (trimmed exact match) ≥2 times within 20 turns | INFO |
| D-LOOP-01 | High thinking-to-action ratio | Total `thinking` chars ÷ (tool_use count + 1) > 1200 AND tool_use count < 8 | WARN |
| D-LOOP-02 | Tool burst → stall | One turn with ≥5 tool_use blocks AND next turn with 0 AND ≥3 subsequent turns with 0 tool_use | INFO |
| D-ERR-01 | Tool-result error rate | `tool_result.content` matches `/error\|failed/i` in >20% of results | WARN |
| D-PATH-01 | File staleness | Path read at turn N, edited at turn M, re-read at turn P>M+15 with no intervening edit on that path | INFO |
| D-SUB-01 | Sub-agent returning empty | `Agent` tool_result body <200 chars AND no subsequent Edit on any path the prompt referenced | WARN |

Each fired record: `{id, severity, turns:[n,...], evidence, suggestion}`. Consolidate same-rule fires into one record per session.

## Error Handling

| Condition | Action |
|-----------|--------|
| `~/.claude/projects/{slug}` does not exist | Print: "No Claude Code transcripts found for this project. Slug: {slug}". Exit. |
| Slug dir exists but contains no `*.jsonl` | Print: "Project directory empty — no sessions to report on." Exit. |
| `--session <id>` does not resolve to a readable file | Print: "Session {id} not found under {slug}. Use --list to see available sessions." Exit. |
| `jq` not installed | Print: "jq is required. Install via `brew install jq` (macOS) or your distro's package manager, then retry." Exit. |
| Malformed JSONL record encountered | Skip the record; increment a `skipped` counter; surface the count in the executive summary footer when non-zero. |
| Read access denied to a transcript file | Print: "Cannot read {path}: permission denied." Exit. |

## Guardrails

- **Never modify the JSONL.** Read-only access. All scratch files go to `$(mktemp)` and are deleted at end-of-run.
- **Mask obvious secret patterns** (`sk-`, `ghp_`, `xoxb-`, `AIza`, `Bearer `) in any rendered tool_use input — substitute `{REDACTED-{prefix}}`. The transcript may contain ephemeral tokens from user pastes.
- **Never write outside `.hatch3r/reports/`.** The `--save` target is fixed; do not honor flags or env vars that redirect output to other paths.
- **Never abort on a malformed record.** Skip-and-count is the contract; aborting would hide the rest of the session from the operator (Silent Failure Contract — surface the skip count rather than swallowing it).
- **Honor the iteration summary contract** (`rules/hatch3r-iteration-summary.md`) at the end of the parent assistant turn that invoked this skill. The report content is not a substitute for the canonical Status / Outcome / Done block.
