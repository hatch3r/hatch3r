# Domain 1: Core Source Implementation

**Scope:** All `src/` TypeScript except adapters and content system. Covers all 9 CLI commands, merge infrastructure, manifest/model/detect modules, workspace/worktree modules, environment/hooks/shared utilities, and the CLI entry point.
**Sub-agents:** 10

## Sub-Agent Decomposition

| SA | Focus | Key Files |
|----|-------|-----------|
| 1.1 | CLI Command: init | `src/cli/commands/init.ts` |
| 1.2 | CLI Command: config | `src/cli/commands/config.ts` |
| 1.3 | CLI Commands: update, sync, add | `src/cli/commands/{update,sync,add}.ts` |
| 1.4 | CLI Commands: validate, verify, status | `src/cli/commands/{validate,verify,status}.ts` |
| 1.5 | Merge & Safe Write | `src/merge/{safeWrite,managedBlocks}.ts` |
| 1.6 | Manifest, Models & Detect | `src/manifest/`, `src/models/`, `src/detect/` |
| 1.7 | Env, Hooks & Shared | `src/env/`, `src/hooks/`, `src/cli/shared/` |
| 1.8 | CLI Entry & Types | `src/cli/index.ts`, `src/types.ts`, `src/version.ts` |
| 1.9 | Workspace Module | `src/workspace/{index,types,manifest,detect,resolve,sync}.ts` |
| 1.10 | Worktree Module | `src/worktree/{index,resolve,types}.ts`, `src/cli/commands/worktreeSetup.ts` |

## Audit Checklists

### 1.1 CLI Command: init
- [ ] Init flow correctness — full lifecycle from invocation to completed installation
- [ ] Preset handling — default, minimal, full, custom presets produce correct output
- [ ] Selective init integration — content system interaction, tag filtering, preset application
- [ ] Idempotency — running init twice does not corrupt state or duplicate content
- [ ] Error handling for existing installations — graceful handling of partial, corrupt, or complete prior installs

### 1.2 CLI Command: config
- [ ] Config command correctness — reads and writes `hatch.json` accurately
- [ ] Adapter enable/disable — correctly toggles adapter state and regenerates output
- [ ] Validation — rejects invalid configuration values with clear error messages

### 1.3 CLI Commands: update, sync, add
- [ ] Update flow — npm version check, content delta computation, safe merge execution
- [ ] Sync correctness — regenerates adapter output from current canonical source without data loss
- [ ] Add command — pack installation flow, content injection, dependency resolution
- [ ] Clean removal path — can a user fully remove hatch3r output? Is there an `hatch3r remove` command or documented manual steps?
- [ ] Cross-adapter state coherence — after a partial adapter failure during update (e.g., 3/5 succeed, 2/5 fail), are the generated configs in a consistent state? Is the integrity manifest accurate?

### 1.4 CLI Commands: validate, verify, status
- [ ] Validate — schema validation, reference integrity checking, adapter output verification
- [ ] Verify — integrity manifest checking, tamper detection, drift reporting
- [ ] Status — display correctness, drift detection between canonical and adapter output

### 1.5 Merge & Safe Write
- [ ] Managed block integrity — `HATCH3R:BEGIN`/`HATCH3R:END` markers preserved correctly
- [ ] User content preservation — content outside managed blocks survives updates
- [ ] Safe write atomicity — writes complete fully or not at all
- [ ] Backup creation — backups created before destructive operations
- [ ] Rollback on failure — failed writes restore previous state
- [ ] Concurrent safety — multiple processes in the same repo do not corrupt files
- [ ] Force mode behavior — correctly overrides managed blocks when requested

### 1.6 Manifest, Models & Detect
- [ ] Manifest parsing and validation — `hatch.json` schema enforcement, edge cases
- [ ] Model resolution — `resolve.ts` correctly resolves model preferences per adapter
- [ ] Customization models — `customize.ts` correctly processes override files
- [ ] Repo analysis — detect module accurately identifies project characteristics

### 1.7 Env, Hooks & Shared
- [ ] MCP env generation — `.env.mcp` created correctly with all required variables
- [ ] Hook definition reading — all 6 hooks correctly parsed and available
- [ ] Adapter integration hooks — hook format transformation per adapter
- [ ] Shared utilities — `agentsContent.ts` pipeline content, `constants.ts` value correctness

### 1.8 CLI Entry & Types
- [ ] CLI entry point routing — commander setup, command registration, global flags
- [ ] Global error handling — uncaught exceptions, unhandled rejections, SIGINT
- [ ] Type definitions completeness — `src/types.ts` covers all domain types accurately
- [ ] Version management — `src/version.ts` reports correct version

### 1.9 Workspace Module
- [ ] Workspace detection — `detectSubRepos()`, `shouldSuggestWorkspace()`, `isWorkspaceRoot()` against varied directory structures (monorepo, multi-repo, nested, flat)
- [ ] Manifest CRUD — `readWorkspaceManifest()`, `writeWorkspaceManifest()`, `createWorkspaceManifest()` handle missing, corrupt, and valid manifests
- [ ] Config resolution — `resolveRepoConfig()` correctly merges workspace defaults with per-repo overrides, precedence is well-defined
- [ ] Multi-repo sync — `syncWorkspaceRepos()` orchestrates init/sync across sub-repos without cross-contamination
- [ ] Error isolation — failure in one sub-repo does not corrupt others or halt the entire workspace operation
- [ ] Integration with existing CLI — workspace features integrated into init/sync/config/status (not a separate command group)

### 1.10 Worktree Module
- [ ] Worktree detection — `findMainWorktree()` correctly identifies main worktree across git configurations
- [ ] Pattern resolution — `resolvePatterns()` resolves adapter-specific file patterns correctly
- [ ] Copy/symlink strategy — per-adapter worktree patterns applied correctly, files land in expected locations
- [ ] Cross-worktree isolation — changes in one worktree do not contaminate others
- [ ] worktreeSetup CLI command — end-to-end flow from invocation to completion, including error handling

## Domain Boundary

> D01 audits per-command error correctness: "Does this specific command handle this specific error correctly?" D08 audits cross-framework error patterns and resilience: "Does the framework have consistent error handling patterns across all commands, and are recovery mechanisms (retry, circuit breaker, watchdog, rollback) implemented?" A D01 finding about a specific command's missing error case is not a D08 finding unless it reveals a systemic pattern gap affecting multiple commands.
