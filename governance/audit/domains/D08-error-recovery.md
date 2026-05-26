# Domain 8: Error Recovery & Resilience

> Last updated: 2026-04-19

**Pillars served:** governance-axis P2 (primary), P5 (supporting); content-quality-axis CQ4 Reliability (primary — runtime resilience).

**Scope:** How the framework handles failures across CLI, filesystem, and pipeline layers.
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 8.1 | CLI Error Handling |
| 8.2 | Filesystem Resilience |
| 8.3 | Pipeline Failure Modes |
| 8.4 | Self-Healing Patterns |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Audit Checklists

> **Per-finding (Decision 17 / charter directive 18):** every finding declares `impact_horizon: short|medium|long` AND `progress_toward_pillar: <axis>.<pillar_id>+<delta>` (e.g., `governance.P5+0.15` or `content-quality.CQ4+0.20`); orchestrator DROPS at output time if either missing.

### 8.1 CLI Error Handling
- [ ] CLI graceful failure for: missing Node.js version, no git repo, no internet, permission denied, missing `.hatch3r/` directory or corrupt `hatch.json`, invalid arguments, interrupted operations
- [ ] Migration shim resilience — `src/migration/agentsToHatch3r.ts` (one-shot `.agents/*` → `.hatch3r/*` migration on first init/sync/update after 1.8 → 1.9 upgrade) handles: partial migration interruption (process killed mid-move), pre-existing `.hatch3r/` directory, missing source `.agents/` directory (already migrated or clean install), permission errors, file already present at destination.
- [ ] Error message quality — are error messages actionable with clear next steps?
- [ ] Exit codes — correct exit codes for different failure modes
- [ ] Recovery guidance — does the CLI tell the user how to fix the problem?
- [ ] Systematic external dependency failure enumeration:
  - npm registry unreachable during `hatch3r update`
  - Each MCP server unreachable (10 servers x failure modes)
  - GitHub API rate-limited during board commands
  - Model provider outage mid-agent-pipeline
  - For each: is there a fallback, timeout, or clear error message?

### 8.2 Filesystem Resilience
- [ ] File write failures — disk full, permissions, read-only filesystem
- [ ] Concurrent access safety — multiple processes do not corrupt shared files
- [ ] Atomic write guarantees — partial writes do not leave corrupt state
- [ ] Backup integrity — backups are valid and restorable
- [ ] Rollback reliability — failed operations restore previous state
- [ ] Symlink handling — symlinks do not cause infinite loops or path traversal
- [ ] Cross-platform path safety — Windows, macOS, Linux path differences

### 8.3 Pipeline Failure Modes
- [ ] What happens when: researcher agent fails? Implementer crashes mid-change? Reviewer times out? MCP server unreachable? Phase 4 agent fails?
- [ ] Graceful degradation vs total failure — does partial completion produce usable results?
- [ ] Partial result preservation — are completed phases preserved when a later phase fails?
- [ ] Timeout enforcement — is there a maximum execution time per agent?

### 8.4 Self-Healing Patterns
Audit against the 7 resilience patterns:
- [ ] **(1) Retry with backoff** — does the pipeline retry transient failures?
- [ ] **(2) Circuit breaker** — does the pipeline stop trying after repeated failures?
- [ ] **(3) Watchdog** — is there timeout enforcement per agent?
- [ ] **(4) Degradation chain** — does the pipeline produce partial results when full execution fails?
- [ ] **(5) Output validation** — are agent outputs validated before being used by the next phase?
- [ ] **(6) Dead man's switch** — is there a maximum total execution time?
- [ ] **(7) Audit trail** — are failures logged for debugging?

## Domain Boundary

> D01 audits per-command error correctness: "Does this specific command handle this specific error correctly?" D08 audits cross-framework error patterns and resilience: "Does the framework have consistent error handling patterns across all commands, and are recovery mechanisms (retry, circuit breaker, watchdog, rollback) implemented?" A D01 finding about a specific command's missing error case is not a D08 finding unless it reveals a systemic pattern gap affecting multiple commands.
