export type Platform = "github" | "azure-devops" | "gitlab";

/**
 * Project maturity tier. Decision 4 / #16: gates content admission so install
 * footprint and gate strictness scale with the project's operational maturity.
 *
 * - `solo`     — individual developer / hobby project. Drops items tagged
 *                `floor:enterprise-only`. Default at init.
 * - `team`     — small team with shared repo. Admits team-tagged items.
 * - `scaleup`  — multi-team org with formal review processes.
 * - `enterprise` — regulated environment, full audit/compliance posture.
 *                  Admits every artifact regardless of tier tag.
 *
 * Persisted in `.hatch3r/hatch.json` under the `maturity` field.
 * Set via `hatch3r config maturity=<tier>`.
 */
export const MATURITY_TIERS = ["solo", "team", "scaleup", "enterprise"] as const;
export type MaturityTier = (typeof MATURITY_TIERS)[number];
export const VALID_MATURITY_TIERS = new Set<string>(MATURITY_TIERS);
export const DEFAULT_MATURITY_TIER: MaturityTier = "solo";

/** Tier ordering — higher index = stricter / broader admission. */
export const MATURITY_TIER_RANK: Record<MaturityTier, number> = {
  solo: 0,
  team: 1,
  scaleup: 2,
  enterprise: 3,
};

export interface ModelConfig {
  default?: string;
  agents?: Record<string, string>;
}

export interface ClaudeConfig {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  /**
   * Claude Code Agent Teams teammate display mode.
   *
   * GA values: "auto" (default), "in-process", "tmux".
   * Deprecated values (pre-GA): "tool-using", "full-trust", "manual-approval".
   * #264 (D9-9.35): Legacy values are still accepted for backward compatibility
   * but map to "auto" at runtime. Use GA values in new configurations.
   */
  teammateMode?: "auto" | "in-process" | "tmux" | "tool-using" | "full-trust" | "manual-approval";
  agentTeams?: boolean | "ga";
}

/** Controls how adapter output is generated (verbosity), not what content is selected. */
export type GenerationMode = "standard" | "minimal";

export interface CostTrackingConfig {
  /** Maximum estimated cost per session in configured currency. */
  sessionBudget?: number;
  /** Maximum estimated cost per issue in configured currency. */
  issueBudget?: number;
  /** Maximum estimated cost per epic in configured currency. */
  epicBudget?: number;
  /** Currency code for cost display (default: "USD"). */
  currency?: string;
  /** Budget percentage thresholds that trigger warnings (default: [0.5, 0.75, 0.9]). */
  warningThresholds?: number[];
  /** When true, halt work when budget is exhausted. When false, warn only (default: false). */
  hardStop?: boolean;
}

/**
 * Versioned, additive customization payload persisted in `hatch.json`.
 *
 * Two-tier model:
 *   - Per-content overrides (agents/skills/rules/commands) mirror the
 *     `.hatch3r/<dir>/*.customize.yaml` keying so manifest-level rehydration
 *     survives `clean` -> reinit cycles when the YAML files are absent.
 *   - `integrations` is the free-form escape hatch for scalar config that
 *     does not fit the per-artifact YAML model (GitHub project IDs, board
 *     overrides, organisation-level toggles).
 *
 * `schemaVersion` is independent from `HatchManifest.version` and gates
 * forward migration of the customization payload itself without forcing
 * a manifest-level version bump.
 */
export interface CustomizationManifest {
  schemaVersion: 1;
  agents?: Record<string, Record<string, unknown>>;
  skills?: Record<string, Record<string, unknown>>;
  rules?: Record<string, Record<string, unknown>>;
  commands?: Record<string, Record<string, unknown>>;
  integrations?: Record<string, unknown>;
}

export interface HatchManifest {
  version: string;
  hatch3rVersion: string;
  /**
   * F15.4-H2 (Cycle 10 D15-SA15.4, Pillar P6): optional pinned semver
   * range or exact version that `hatch3r update` honors when present.
   * When set, the npm install spec becomes `hatch3r@<versionConstraint>`
   * instead of `hatch3r@latest`. Format: any valid npm semver expression.
   * Set via `hatch3r update --pin-version <semver>` or by hand-editing
   * `.hatch3r/hatch.json`.
   */
  versionConstraint?: string;
  platform?: Platform;
  owner: string;
  repo: string;
  namespace: string;
  project: string;
  tools: Tool[];
  features: Features;
  mcp: McpConfig;
  /**
   * CLI-tooling pivot (added in 1.7.5 as an additive optional field — no
   * manifest version bump). Absence is equivalent to `{ enabled: false,
   * selected: [] }`. Read via
   * `src/manifest/hatchJson.ts::readCliToolsConfig`.
   */
  cliTools?: CliToolsConfig;
  board?: BoardConfig;
  repos?: RepoEntry[];
  packages?: PackageEntry[];
  hooks?: HooksConfig;
  models?: ModelConfig;
  claude?: ClaudeConfig;
  /** Token usage and cost tracking configuration. */
  costTracking?: CostTrackingConfig;
  /**
   * Optional customization payload that round-trips through
   * `clean` -> reinit so integration config (e.g. GitHub project IDs) and
   * per-artifact overrides survive when the project-side
   * `.hatch3r/*.customize.yaml` files are absent.
   */
  customization?: CustomizationManifest;
  /** Content selection from init. undefined = legacy "full" (backward compat). */
  content?: ContentSelection;
  /**
   * Project maturity tier (Decision 4 / #16). Gates content admission in
   * `resolveSelection`: higher tiers admit broader sets, lower tiers drop
   * `floor:enterprise-only` items. Absence is treated as `"solo"` by
   * consumers — see `readMaturityTier` in `src/manifest/hatchJson.ts`.
   * Set via `hatch3r config maturity=<tier>`.
   */
  maturity?: MaturityTier;
  /** Detected project languages from repo analysis. */
  languages?: string[];
  /**
   * C9-H47 (D14-SA14.4-H01): detected toolchain context persisted from
   * `analyzeRepo` at init time. Used by the adapter pipeline to substitute
   * `${HATCH3R:LINTER}` / `${HATCH3R:TEST_FRAMEWORK}` / `${HATCH3R:CI_PROVIDER}`
   * tokens in canonical content (see
   * `src/pipeline/repoSubstitution.ts`). Absence on pre-1.8.0 manifests
   * collapses to the `"unknown"` sentinel — adapters keep emitting valid
   * output rather than leaking the raw token.
   */
  detected?: {
    linters?: string[];
    testFrameworks?: string[];
    ciProviders?: string[];
  };
  /** Git worktree file-isolation settings. */
  worktree?: WorktreeConfig;
  /** Tracks project specs generated by /project-spec or /api-spec commands. */
  specs?: {
    paths: string[];
    lastGenerated?: string;
  };
  /**
   * User-content authoring counters surfaced by `hatch3r status`. Populated by
   * `saveUserContent` in `src/content/userContent.ts` after each save. Older
   * hatch3r versions tolerate absence (treated as zero counts).
   */
  userContent?: {
    /** Total user-authored artifacts on disk under `.hatch3r/overrides/`. */
    count: number;
    /** ISO-8601 timestamp of the most recent successful save. */
    lastModified: string;
    /** Per-type counts (agent/skill/rule/command/hook). */
    types: Record<string, number>;
  };
  /** Present when this repo is managed by a workspace. */
  workspace?: {
    /** Relative path from this repo back to workspace root. */
    rootPath: string;
    /** ISO timestamp of last workspace sync. */
    lastSync: string;
    /** hatch3r version used for last sync. */
    syncVersion: string;
    /** SHA-256 of workspace.json at time of sync. */
    workspaceChecksum: string;
    /** Content IDs explicitly excluded by this repo. */
    excludedContent?: string[];
    /** Content IDs added locally (not from workspace). */
    localContent?: string[];
    /**
     * CLI tools added at this member only (plan §4.8). Mirrors
     * `localContent` for content. Workspace `defaults.cliTools.selected`
     * is the baseline; this list extends it for this member.
     */
    localCliTools?: CliToolId[];
    /**
     * CLI tools the member opts out of even though the workspace
     * defaults include them (plan §4.8). Exclusion wins (matches
     * `excludedContent` semantics).
     */
    excludedCliTools?: CliToolId[];
  };
  managedFiles: string[];
  /**
   * Per-adapter output paths from the most recent successful generation.
   *
   * Populated by `hatch3r init`, `hatch3r sync`, and `hatch3r update` after
   * each adapter emits its outputs. Keyed by adapter tool name (matches
   * `Tool` values, e.g. `"cursor"`, `"claude"`). Values are flat lists of
   * repo-relative output paths (matches the shape used inside `managedFiles`).
   *
   * Consumed by {@link src/merge/orphanCleanup} to detect and remove files
   * previously written by hatch3r but no longer emitted by the current
   * adapter set — e.g. Wave B3's `NN-hatch3r-*.mdc` rename left old
   * `hatch3r-*.mdc` rule files in place on repos upgrading from <1.5.0.
   *
   * Optional for backward compatibility: pre-feature manifests lack this
   * field, in which case orphan cleanup is skipped (no history -> no
   * inferrable orphans). First-run behaviour is "no-op cleanup, populate
   * the record for next time."
   */
  managedFilesByAdapter?: Record<string, string[]>;
}

export interface WorktreeConfig {
  enabled: boolean;
  /** Additional user-specified gitignore patterns to include. */
  extraPatterns?: string[];
  /** Strategy for node_modules: "symlink" (default) or "skip". */
  nodeModules?: "symlink" | "skip";
}

export const TOOLS = ["cursor", "copilot", "claude"] as const;
export type Tool = (typeof TOOLS)[number];
export const VALID_TOOLS = new Set<string>(TOOLS);
export const TOOL_CHOICES = TOOLS.join(", ");

/** Tools that support git worktree file isolation. Shared across init, update, and config. */
export const WORKTREE_CAPABLE_TOOLS = new Set<string>(["claude", "cursor", "copilot"]);

export interface BoardConfig {
  owner: string;
  repo: string;
  /** Default branch for checkout, PR base, and release. Fallback: "main". */
  defaultBranch?: string;
  projectNumber: number | null;
  statusFieldId: number | null;
  statusOptions: {
    backlog: string | null;
    ready: string | null;
    inProgress: string | null;
    inReview: string | null;
    done: string | null;
  };
  labels: {
    types: string[];
    executors: string[];
    statuses: string[];
    meta: string[];
  };
  branchConvention: string;
  areas: string[];
}

export interface RepoEntry {
  owner: string;
  repo: string;
  name?: string;
}

export interface PackageEntry {
  name: string;
  path: string;
}

export interface Features {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  prompts: boolean;
  commands: boolean;
  mcp: boolean;
  githubAgents: boolean;
  hooks: boolean;
  /**
   * Controls whether adapter outputs surface active handoff documents from
   * `.agents/handoffs/active/` in their primary tool-context file. Default
   * `true`. Absent on pre-1.8.0 manifests; consumers treat absence as `true`.
   */
  handoffs: boolean;
}

export interface McpConfig {
  servers: string[];
  /**
   * Optional MCP protocol version emitted into generated client config
   * (`.mcp.json` `protocolVersion` field for Claude Code; cursor/copilot
   * mirror it). Defaults to the most-recent stable spec revision
   * (`MCP_DEFAULT_PROTOCOL_VERSION` in `src/adapters/mcp-utils.ts`) when
   * absent. Operators override via `.hatch3r/hatch.json` to pin a server
   * fleet to a specific revision ahead of the 2026-07-28 RC GA
   * (blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate,
   * accessed 2026-05-27). F17.2.3 (Cycle 10, D17, P3).
   */
  protocolVersion?: string;
}

/**
 * Identifier for a CLI tool entry in `AVAILABLE_CLI_TOOLS`
 * (`src/cliTools/registry.ts`). Free-form string for forward compatibility
 * with future tools added by maintainers; runtime validation lives in
 * `src/cliTools/registry.ts`.
 */
export type CliToolId = string;

/**
 * Manifest payload that captures the CLI-tooling pivot: a master enable
 * switch plus the selected tool ids. `overrides` lets a project disable a
 * tool that came from a workspace or preset default without removing the
 * id from `selected` (matching the per-content override pattern used by
 * `customization`).
 *
 * Absent on pre-1.7.5 manifests; consumers must treat absence as
 * `{ enabled: false, selected: [] }` (see
 * `src/manifest/hatchJson.ts::readCliToolsConfig`).
 */
export interface CliToolsConfig {
  enabled: boolean;
  selected: CliToolId[];
  overrides?: Record<CliToolId, { disabled?: boolean; note?: string }>;
}

export interface HooksConfig {
  enabled: boolean;
}

/**
 * Rule precedence bucket. Optional frontmatter on rule `.md`/`.mdc` files;
 * defaults to `"normal"` when absent. Consumers use {@link precedenceRank}
 * and {@link sortByPrecedence} in `src/adapters/canonical.ts` to order
 * rules so higher-priority buckets appear first in generated output.
 *
 * Enum order (priority): critical (100) > high (300) > normal (500) > low (700).
 */
export type RulePrecedence = "critical" | "high" | "normal" | "low";

export interface CanonicalFile {
  id: string;
  type: "rule" | "agent" | "skill" | "command" | "prompt" | "github-agent" | "hook" | "check" | "policy" | "learning";
  /**
   * Raw frontmatter `type:` value as declared by the author. Distinct from
   * `type` above, which is the reader-category bucket set from the directory
   * the file lives in. Used by adapter emission filters (see
   * `filterUserFacing` in `src/adapters/canonical.ts`) to distinguish
   * user-invocable commands/agents from companion content like
   * `shared-context`, `reference`, and `mode` that lives in the same
   * directory tree but must not appear in tool command/agent pickers.
   */
  frontmatterType?: string;
  description: string;
  scope?: string;
  model?: string;
  protected?: boolean;
  /** Agent runs with restricted write permissions (Cursor v2.5+ subagents). */
  readonly?: boolean;
  /** Agent runs in background without blocking the parent (Cursor v2.5+ async subagents). */
  background?: boolean;
  tags?: string[];
  /**
   * Optional rule precedence bucket (see {@link RulePrecedence}). When
   * absent, consumers treat the rule as `"normal"`. Pass-through value —
   * not interpreted here; sorting lives in `src/adapters/canonical.ts`.
   */
  precedence?: RulePrecedence;
  content: string;
  rawContent: string;
  sourcePath: string;
  /**
   * Provenance of the canonical file. Defaults to "canonical" everywhere;
   * "user" only when the file was loaded from the project-local
   * `.hatch3r/overrides/` subtree (D20 user-content authoring).
   */
  source?: "canonical" | "user";
  /**
   * When present, restricts which platform adapters emit this artifact.
   * Empty / omitted means full parity (all adapters emit it). Used by
   * adapter filters to honour `adapters: [claude, cursor]` frontmatter
   * declared on user-tier artifacts.
   */
  adapters?: string[];
  /**
   * D9-H-6 (Cycle 10 D9, Pillar P1): optional list of tools a skill
   * pre-approves. Parsed from the canonical frontmatter `allowed_tools:`
   * (or `allowed-tools:`) array. Consumed by the Copilot adapter's skill
   * emission ({@link src/adapters/base.ts} `processSkillsWithFmCliFiltered`
   * with `emitAllowedTools`), which renders an `allowed-tools:` line so the
   * GitHub Copilot Skills runtime pre-approves those tools and skips the
   * per-invocation confirmation prompt
   * (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills,
   * accessed 2026-05-26). Absent / empty means no pre-approval line is
   * emitted — the runtime falls back to per-tool confirmation. Other
   * adapters (cursor/claude) ignore the field; their SKILL.md format does
   * not document `allowed-tools`.
   */
  allowedTools?: string[];
}

export interface CanonicalMetadata {
  id: string;
  type: string;
  description: string;
  name?: string;
  scope?: string;
  model?: string;
  agent?: string;
  event?: string;
  globs?: string;
  protected?: boolean;
  alwaysApply?: boolean;
  /** Agent runs with restricted write permissions (Cursor v2.5+ subagents). */
  readonly?: boolean;
  /** Agent runs in background without blocking the parent (Cursor v2.5+ async subagents). */
  background?: boolean;
  tags?: string[];
  /** Optional rule precedence bucket; see {@link RulePrecedence}. */
  precedence?: RulePrecedence;
  /**
   * Provenance of the metadata source. Defaults to "canonical"; "user" only
   * when loaded from `.hatch3r/overrides/` (D20 user-content authoring).
   */
  source?: "canonical" | "user";
  /**
   * When present, restricts adapter emission. Empty / omitted = full parity.
   * Mirrors {@link CanonicalFile.adapters}.
   */
  adapters?: string[];
  /**
   * D9-H-6: optional skill tool pre-approval list parsed from the
   * `allowed_tools:` / `allowed-tools:` frontmatter array. Mirrors
   * {@link CanonicalFile.allowedTools}; see that field for emission semantics.
   */
  allowedTools?: string[];
}

export interface ContentSelection {
  preset: "minimal" | "standard" | "full" | "custom";
  projectType: "greenfield" | "brownfield";
  teamSize: "solo" | "team";
  /** Explicit list of selected content IDs (without hatch3r- prefix).
   *  Populated for all presets — the resolved result of preset + context filters. */
  items: {
    agents: string[];
    skills: string[];
    rules: string[];
    commands: string[];
    prompts: string[];
    hooks: string[];
    githubAgents: string[];
  };
}

export interface AdapterOutput {
  path: string;
  content: string;
  /** Inner content for the managed block (used for merge on update). */
  managedContent?: string;
  action: "create" | "update" | "skip";
  /**
   * C8-D12-M3: Per-output source provenance — the canonical files (by
   * absolute `sourcePath`) that contributed content to this adapter output.
   *
   * Populated by {@link BaseAdapter.generate} when the adapter reads
   * canonical files through the tracked reader. Empty or absent when the
   * adapter output has no canonical inputs (e.g. a pure-config file like
   * `.zed/mcp.json` assembled from `mcp.json`).
   *
   * Consumers (`sync` -> `.agents/.provenance.json`) use this to answer
   * "which canonical files shaped this generated file?" so operators can
   * trace drift back to the source artifact without re-running generation.
   */
  sourceFiles?: string[];
}

export interface MergeResult {
  path: string;
  action: "created" | "updated" | "skipped" | "unchanged";
  warning?: string;
}

export type Framework =
  | "next"
  | "angular"
  | "vue"
  | "svelte"
  | "sveltekit"
  | "remix"
  | "astro"
  | "nuxt"
  | "react"
  | "express"
  | "fastify"
  | "hono"
  | "nestjs"
  | "django"
  | "flask"
  | "rails"
  | "spring"
  | "laravel"
  // D14-M1 (Cycle 10 rollover): 2026 stacks — Tanstack Start, SolidStart,
  // Qwik (JS meta-frameworks), FastAPI (Python ASGI), Phoenix (Elixir),
  // axum + actix (Rust web). Each is dep-detected via package.json (JS),
  // pyproject.toml/requirements.txt (Python), mix.exs (Elixir), or
  // Cargo.toml (Rust) — see FRAMEWORK_DEP_INDICATORS in
  // src/detect/repoAnalyzer.ts.
  | "tanstack-start"
  | "solid-start"
  | "qwik"
  | "fastapi"
  | "phoenix"
  | "axum"
  | "actix";

export interface RepoInfo {
  languages: string[];
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  frameworks: Framework[];
  isMonorepo: boolean;
  hasExistingAgents: boolean;
  existingTools: Tool[];
  rootDir: string;
  /** D14 Medium (#14.5): Detected linter/formatter tools. */
  linters?: string[];
  /** D14 Medium (#14.6): Detected test framework(s). */
  testFrameworks?: string[];
  /** D14 Medium (#14.7): Detected CI provider(s). */
  ciProviders?: string[];
  /**
   * F14.2-H1 (D14): Enumerated monorepo package directories resolved from the
   * package manager's workspace globs (pnpm-workspace.yaml `packages:`,
   * package.json `workspaces`, lerna.json `packages`). Populated by
   * `analyzeRepo` via {@link detectMonorepoPackages} when `isMonorepo` is true
   * and at least one glob resolves to a `package.json`-bearing directory.
   * Absent / empty when the repo is single-package or the workspace globs
   * resolve to zero candidate directories.
   *
   * Consumed by `init`/`sync` to fan adapter outputs into each
   * `<package>/.hatch3r/` so per-package tool context files reflect the
   * canonical content set without forcing the user to re-run init in every
   * sub-directory.
   */
  packages?: PackageEntry[];
}

export const MANAGED_BLOCK_START = "<!-- HATCH3R:BEGIN -->";
export const MANAGED_BLOCK_END = "<!-- HATCH3R:END -->";

/**
 * Issue #76: HATCH3R:BEGIN/END markers must adopt the host file's comment
 * syntax — embedding HTML-style `<!-- -->` markers inside a YAML workflow
 * file produces a parse error on line 2 and GitHub Actions rejects the file.
 *
 * `MANAGED_BLOCK_START` / `MANAGED_BLOCK_END` above remain the Markdown/HTML
 * default and the canonical name used everywhere markdown is the host. The
 * YAML variant below is used for `.yml` / `.yaml` outputs (currently only
 * `.github/workflows/copilot-setup-steps.yml`).
 *
 * Read-side helpers in `src/merge/managedBlocks.ts` accept any variant in
 * `MANAGED_BLOCK_VARIANTS` so a file written by an earlier hatch3r release
 * with the wrong-style markers (the bug in v1.7.0/v1.7.1 produced HTML
 * markers inside the YAML workflow) can be auto-repaired on the next sync.
 */
export const MANAGED_BLOCK_START_YAML = "# HATCH3R:BEGIN";
export const MANAGED_BLOCK_END_YAML = "# HATCH3R:END";

/** A pair of markers that delimit a hatch3r managed block in a specific host syntax. */
export interface ManagedBlockMarkers {
  readonly start: string;
  readonly end: string;
}

/**
 * Ordered list of marker variants. Read-side functions scan in this order;
 * Markdown is listed first because it is the historical default and the
 * vast majority of managed files. Adding a new variant requires appending
 * an entry here — no other code change needed for detection.
 */
export const MANAGED_BLOCK_VARIANTS: readonly ManagedBlockMarkers[] = [
  { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END },
  { start: MANAGED_BLOCK_START_YAML, end: MANAGED_BLOCK_END_YAML },
];

/**
 * Choose the marker variant for a given output path. Currently:
 * - `.yml` / `.yaml` → YAML `#`-prefixed markers (issue #76)
 * - everything else  → HTML/Markdown `<!-- -->` markers (default)
 *
 * JSON files are never wrapped in managed blocks (adapters emit JSON
 * via `JSON.stringify` without merge), so no JSON variant is needed.
 */
export function getMarkersForPath(filePath?: string): ManagedBlockMarkers {
  if (filePath) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
      return { start: MANAGED_BLOCK_START_YAML, end: MANAGED_BLOCK_END_YAML };
    }
  }
  return { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END };
}
export const HATCH3R_PREFIX = "hatch3r-";
/**
 * Wave 6: single visible hatch3r directory in user repos. Holds the manifest
 * (`hatch.json`), per-project `learnings/`, `handoffs/`, filtered MCP config
 * (`mcp/mcp.json`), and (Wave 5) user-authored content overrides
 * (`overrides/`).
 *
 * Wave 7 removed the `AGENTS_DIR` constant. The legacy `.agents/` literal
 * survives only as a local constant inside the migration shim
 * (`src/migration/agentsToHatch3r.ts`) and as inline fallback probes in a
 * handful of legacy-aware code paths (see grep `\.agents`); every other
 * call site targets `HATCH3R_DIR` directly.
 */
export const HATCH3R_DIR = ".hatch3r";
export const ARCHIVE_DIR = ".hatch3r-archive";
export const CUSTOMIZE_DIR = ".hatch3r";

/** Structured error codes for programmatic error handling (e.g., CI scripts). */
export type HatchErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "FS_ERROR"
  | "INTEGRITY_ERROR"
  | "ADAPTER_ERROR"
  | "NETWORK_ERROR"
  | "CLEAN_ERROR"
  | "LOCK_TIMEOUT"
  | "UNKNOWN_ERROR";

/**
 * C8-D1-M5: Central mapping from HatchErrorCode to POSIX exit code. Keeps the
 * "what kind of failure" (errorCode) and "how the CLI surfaces it" (exitCode)
 * in one place so call sites can throw `new HatchError(msg, undefined, CODE)`
 * without hand-picking an exit code. Explicit exitCode (incl. 0 for user
 * cancellation, 2 for usage errors) always wins over this mapping.
 *
 * SA12.1-F-D12-M1 (Cycle 10 Wave 3, D12, P1): differentiated per the
 * sysexits.h convention (FreeBSD `/usr/include/sysexits.h`, accessed
 * 2026-05-28) so CI consumers and shell pipelines can branch on the kind
 * of failure. The kept codes are the subset that maps cleanly to hatch3r
 * errors:
 *   - 64 EX_USAGE         — command-line usage error (VALIDATION_ERROR)
 *   - 65 EX_DATAERR       — input data malformed (CONFIG_ERROR)
 *   - 69 EX_UNAVAILABLE   — service unavailable (ADAPTER_ERROR)
 *   - 70 EX_SOFTWARE      — internal software error (UNKNOWN_ERROR)
 *   - 73 EX_CANTCREAT     — file output error (INTEGRITY_ERROR — adapter
 *                            output cannot be regenerated to match canonical)
 *   - 74 EX_IOERR         — I/O error (FS_ERROR, CLEAN_ERROR)
 *   - 75 EX_TEMPFAIL      — temporary failure, retryable (NETWORK_ERROR,
 *                            LOCK_TIMEOUT)
 *
 * The pre-2.0.0 contract collapsed every code to exit 1; consumers relying
 * on the legacy behavior can grep stderr for the `errorCode` string (still
 * surfaced via `HatchError.errorCode`) or branch on the structured JSON
 * mode emitted by `validate --format json`.
 */
export const ERROR_CODE_TO_EXIT_CODE: Record<HatchErrorCode, number> = {
  VALIDATION_ERROR: 64,
  CONFIG_ERROR: 65,
  FS_ERROR: 74,
  INTEGRITY_ERROR: 73,
  ADAPTER_ERROR: 69,
  NETWORK_ERROR: 75,
  CLEAN_ERROR: 74,
  LOCK_TIMEOUT: 75,
  UNKNOWN_ERROR: 70,
};

export function exitCodeForErrorCode(code: HatchErrorCode): number {
  return ERROR_CODE_TO_EXIT_CODE[code];
}

/**
 * C9-H27 (D10-SA10.2-F2): structured CLI error with an optional
 * `recoveryHint` that surfaces an actionable next step at the top-level
 * error handler (`src/cli/index.ts`). The hint is a single-line, imperative
 * suggestion (e.g. "Run `hatch3r validate` first" / "Re-run with `--verbose`
 * to see detail") — it must NOT restate the failure or duplicate the
 * message. When omitted, the CLI falls back to the generic troubleshooting
 * footer.
 */
export class HatchError extends Error {
  public readonly exitCode: number;
  public readonly errorCode: HatchErrorCode;
  public readonly recoveryHint?: string;

  constructor(
    message: string,
    exitCode?: number,
    errorCode: HatchErrorCode = "UNKNOWN_ERROR",
    recoveryHint?: string,
  ) {
    super(message);
    this.errorCode = errorCode;
    this.exitCode = exitCode ?? ERROR_CODE_TO_EXIT_CODE[errorCode];
    this.recoveryHint = recoveryHint;
    this.name = "HatchError";
  }
}

/** Remove characters that are not alphanumeric, dot, hyphen, or underscore from an ID. */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "");
}

/** Returns id with exactly one hatch3r- prefix (strips existing prefix before adding). */
export function toPrefixedId(id: string, prefix = HATCH3R_PREFIX): string {
  const base = id.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
  return `${prefix}${base}`;
}
export const MANIFEST_FILE = "hatch.json";
export const WORKTREE_INCLUDE_FILE = ".worktreeinclude";

export const DEFAULT_FEATURES: Features = {
  agents: true,
  skills: true,
  rules: true,
  prompts: true,
  commands: true,
  mcp: true,
  githubAgents: true,
  hooks: true,
  handoffs: true,
};

export interface McpServerMeta {
  description: string;
  requiresEnv?: string[];
}

export const ENV_VAR_HELP: Record<string, { comment: string; url: string }> = {
  GITHUB_PAT: {
    comment: "GitHub MCP server — Classic PAT: repo, read:org, project. Fine-grained: Contents(RW), Issues(RW), Pull Requests(RW), Projects(RW)",
    url: "https://github.com/settings/tokens/new",
  },
  AZURE_DEVOPS_PAT: {
    comment: "Azure DevOps Personal Access Token (Work Items, Code, Build RW)",
    url: "https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate",
  },
  AZURE_DEVOPS_ORG: {
    comment: "Azure DevOps organization name",
    url: "https://dev.azure.com/",
  },
  GITLAB_TOKEN: {
    comment: "GitLab Personal Access Token (api scope)",
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
  },
  BRAVE_API_KEY: {
    comment: "Brave Search (free: 2,000 queries/month)",
    url: "https://brave.com/search/api/",
  },
  SENTRY_AUTH_TOKEN: {
    comment: "Sentry error tracking",
    url: "https://sentry.io/settings/account/api/auth-tokens/",
  },
  POSTGRES_URL: {
    comment: "PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db)",
    url: "",
  },
  LINEAR_API_KEY: {
    comment: "Linear issue tracking",
    url: "https://linear.app/settings/api",
  },
};

export const AVAILABLE_MCP_SERVERS: Record<string, McpServerMeta> = {
  github: {
    description:
      "GitHub repository management, code review, issues, PRs, and project boards",
    requiresEnv: ["GITHUB_PAT"],
  },
  "azure-devops": {
    description:
      "Azure DevOps work items, repos, pipelines, and boards",
    requiresEnv: ["AZURE_DEVOPS_PAT", "AZURE_DEVOPS_ORG"],
  },
  gitlab: {
    description:
      "GitLab issues, merge requests, pipelines, and project management",
    requiresEnv: ["GITLAB_TOKEN"],
  },
  context7: {
    description:
      "Up-to-date, version-specific library documentation for LLMs",
  },
  filesystem: {
    description: "File management and code editing operations",
  },
  playwright: {
    description: "Browser automation, web testing, and UI interaction",
  },
  "brave-search": {
    description:
      "Web research, fact-checking, and current information retrieval",
    requiresEnv: ["BRAVE_API_KEY"],
  },
  sentry: {
    description:
      "Error tracking and performance monitoring (enable and configure with your Sentry auth token)",
    requiresEnv: ["SENTRY_AUTH_TOKEN"],
  },
  postgres: {
    description:
      "PostgreSQL database queries and schema inspection (enable and configure with your connection string)",
    requiresEnv: ["POSTGRES_URL"],
  },
  linear: {
    description:
      "Linear issue tracking and project management (enable and configure with your Linear API key)",
    requiresEnv: ["LINEAR_API_KEY"],
  },
};
