# Domain 2: Adapter Infrastructure

**Scope:** All adapter support code — the base contract, canonical reader, customization pipeline, utilities, registry, content system, and integrity/archive systems. Does NOT cover per-adapter implementations (those are Domain 9).
**Sub-agents:** 7

## Sub-Agent Decomposition

| SA | Focus | Key Files |
|----|-------|-----------|
| 2.1 | Base Adapter Contract | `src/adapters/base.ts` |
| 2.2 | Canonical Reader | `src/adapters/canonical.ts` |
| 2.3 | Customization Pipeline | `src/adapters/customization.ts` |
| 2.4 | MCP & TOML Utilities | `src/adapters/mcp-utils.ts`, `src/adapters/toml-utils.ts` |
| 2.5 | Adapter Index & Registry | `src/adapters/index.ts` |
| 2.6 | Content System | `src/content/index.ts` (686 LOC), `src/content/tags.ts` (91 LOC), `src/content/presets.ts` (48 LOC) |
| 2.7 | Integrity & Archive Systems | `src/integrity/index.ts`, `src/archive/index.ts` (263 LOC) |

## Audit Checklists

### 2.1 Base Adapter Contract
- [ ] Contract completeness — all required abstract methods defined
- [ ] Extensibility patterns — new adapters can be added without modifying base
- [ ] Capability declaration — adapters correctly declare supported features
- [ ] Hook support interface — base contract supports hook transformation

### 2.2 Canonical Reader
- [ ] Correctness for ALL content types — agents, rules, commands, skills, hooks, prompts, checks, mcp, policy, learnings
- [ ] File discovery — correctly finds all canonical files in `/.agents/`
- [ ] Frontmatter parsing — metadata extracted accurately from all file types
- [ ] Error handling for malformed content — graceful failures with actionable messages

### 2.3 Customization Pipeline
- [ ] Override system integrity — `.hatch3r/{agents,commands,skills,rules}/{id}.customize.yaml` processed correctly
- [ ] Deny pattern enforcement — safety-critical content cannot be overridden
- [ ] Merge correctness — customizations merge with canonical content without corruption
- [ ] Override precedence — when multiple overrides apply, precedence is well-defined and documented

### 2.4 MCP & TOML Utilities
- [ ] MCP config transformation correctness — `mcp.json` transformed per adapter format
- [ ] Per-adapter MCP format handling — each adapter receives its expected MCP schema
- [ ] TOML generation — codex adapter TOML output is valid and correct
- [ ] Utility robustness — edge cases, malformed input, missing fields

### 2.5 Adapter Index & Registry
- [ ] Registry completeness — all 15 adapters registered and discoverable
- [ ] Adapter discovery — dynamic lookup works correctly
- [ ] Enable/disable logic — toggling adapters in config takes effect
- [ ] Capability querying — callers can query adapter capabilities accurately

### 2.6 Content System
- [ ] Selective init flow correctness — tag-based filtering produces correct content subsets
- [ ] Tag system (`tags.ts`) — tags accurately describe content, no misclassifications
- [ ] Preset definitions (`presets.ts`) — presets map to correct tag combinations
- [ ] Content filtering — inclusion/exclusion logic handles edge cases
- [ ] Content resolution and deduplication — no duplicate or missing artifacts
- [ ] Integration with CLI init — content system correctly feeds into the init flow

### 2.7 Integrity & Archive Systems
- [ ] Integrity manifest generation — all managed files tracked with correct hashes
- [ ] Tamper detection — modified files detected accurately, no false positives/negatives
- [ ] Archive/backup creation and restoration — backups are complete and restorable
- [ ] Archive cleanup — old archives pruned to avoid disk bloat
- [ ] Integrity verification during update — updates verify integrity before modifying files
