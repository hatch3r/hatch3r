import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_DIR,
  HatchError,
  MANIFEST_FILE,
  VALID_TOOLS,
  WORKTREE_CAPABLE_TOOLS,
  DEFAULT_FEATURES,
  type BoardConfig,
  type ClaudeConfig,
  type CliToolsConfig,
  type ContentSelection,
  type CostTrackingConfig,
  type CustomizationManifest,
  type HatchManifest,
  type HooksConfig,
  type ModelConfig,
  type PackageEntry,
  type Platform,
  type RepoEntry,
  type Tool,
} from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile } from "../merge/safeWrite.js";

/**
 * Validate a git branch name against the rules from `git check-ref-format`.
 *
 * Rejects names that:
 * - are empty or whitespace-only
 * - contain `..", `~`, `^`, `:`, `\`, spaces, or control characters
 * - start or end with `/` or `.`
 * - contain consecutive slashes `//`
 * - end with `.lock`
 * - contain `@{` (reflog syntax)
 * - are exactly `@`
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.trim() !== name) return false;
  if (/[~^:\\\x00-\x1f\x7f ]/.test(name)) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  if (name.includes("..")) return false;
  if (name.includes("//")) return false;
  if (name.endsWith(".lock")) return false;
  if (name.includes("@{")) return false;
  if (name === "@") return false;
  return true;
}

function createMinimalBoardConfig(owner: string, repo: string, defaultBranch: string): BoardConfig {
  return {
    owner,
    repo,
    defaultBranch,
    projectNumber: null,
    statusFieldId: null,
    statusOptions: {
      backlog: null,
      ready: null,
      inProgress: null,
      inReview: null,
      done: null,
    },
    labels: {
      types: ["type:bug", "type:feature", "type:refactor", "type:qa", "type:docs", "type:infra"],
      executors: ["executor:agent", "executor:human", "executor:hybrid"],
      statuses: ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:blocked"],
      meta: ["meta:board-overview"],
    },
    branchConvention: "{type}/{short-description}",
    areas: [],
  };
}

export function createManifest(options: {
  platform?: Platform;
  owner?: string;
  repo?: string;
  namespace?: string;
  project?: string;
  defaultBranch?: string;
  tools: Tool[];
  features?: Partial<HatchManifest["features"]>;
  mcpServers?: string[];
  content?: ContentSelection;
  languages?: string[];
  worktreeEnabled?: boolean;
  customization?: CustomizationManifest;
  /**
   * CLI-tooling pivot (1.7.2 / plan §4.2). When omitted the manifest is
   * left without a `cliTools` field — pre-1.7.2 manifest shape. When
   * supplied the field is written verbatim and consumers should read it
   * via {@link readCliToolsConfig} so absence still maps to
   * `{enabled: false, selected: []}`.
   */
  cliTools?: CliToolsConfig;
}): HatchManifest {
  const platform = options.platform ?? "github";
  const owner = options.owner ?? "";
  const repo = options.repo ?? "";
  const namespace = options.namespace ?? owner;
  const project = options.project ?? repo;
  const manifest: HatchManifest = {
    version: "2.0.0",
    hatch3rVersion: HATCH3R_VERSION,
    platform,
    owner,
    repo,
    namespace,
    project,
    tools: options.tools,
    features: { ...DEFAULT_FEATURES, ...options.features },
    mcp: { servers: options.mcpServers ?? [] },
    managedFiles: [],
  };
  if (options.content) {
    manifest.content = options.content;
  }
  if (options.customization) {
    manifest.customization = options.customization;
  }
  if (options.cliTools) {
    manifest.cliTools = options.cliTools;
  }
  if (options.languages && options.languages.length > 0 && options.languages[0] !== "unknown") {
    manifest.languages = options.languages;
  }
  if (options.defaultBranch) {
    manifest.board = createMinimalBoardConfig(owner, repo, options.defaultBranch);
  }
  const autoEnable = options.tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
  const shouldEnable = options.worktreeEnabled ?? autoEnable;
  if (shouldEnable) {
    manifest.worktree = { enabled: true };
  }
  return manifest;
}

export function migrateManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw };

  if (!migrated.namespace && typeof migrated.owner === "string") {
    migrated.namespace = migrated.owner;
  }
  if (!migrated.namespace) {
    migrated.namespace = "";
  }

  if (!migrated.project && typeof migrated.repo === "string") {
    migrated.project = migrated.repo;
  }
  if (!migrated.project) {
    migrated.project = "";
  }

  if (migrated.version === "1.0.0") {
    migrated.version = "2.0.0";
  }

  // 1.7.0: `agents-md` is no longer a selectable tool. AGENTS.md is emitted
  // unconditionally by init/update via generateRootAgentsMd; the standalone
  // adapter caused duplicate writes (managed-block nesting, 8000-line growth)
  // when combined with the amp adapter that targeted the same path.
  if (Array.isArray(migrated.tools)) {
    migrated.tools = (migrated.tools as unknown[]).filter(
      (t) => typeof t !== "string" || t !== "agents-md",
    );
  }

  return migrated;
}

function validateManifest(data: unknown): data is HatchManifest {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.version !== "string" ||
    typeof obj.hatch3rVersion !== "string" ||
    (obj.platform !== undefined && typeof obj.platform !== "string") ||
    !Array.isArray(obj.tools) ||
    obj.features === null ||
    typeof obj.features !== "object" ||
    obj.mcp === null ||
    typeof obj.mcp !== "object" ||
    !Array.isArray(obj.managedFiles)
  ) {
    return false;
  }

  // #108: Validate tools array entries are known tool strings
  for (const tool of obj.tools as unknown[]) {
    if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) return false;
  }

  // #108: Validate board sub-schema when present
  if (obj.board !== undefined) {
    if (typeof obj.board !== "object" || obj.board === null) return false;
    const board = obj.board as Record<string, unknown>;
    if (typeof board.owner !== "string") return false;
    if (typeof board.repo !== "string") return false;
    if (board.defaultBranch !== undefined) {
      if (typeof board.defaultBranch !== "string") return false;
      // #1.15: Validate defaultBranch against git branch naming rules
      if (!isValidGitBranchName(board.defaultBranch)) return false;
    }
  }

  // #108: Validate worktree.extraPatterns when present
  if (obj.worktree !== undefined) {
    const wt = obj.worktree as Record<string, unknown>;
    if (wt.extraPatterns !== undefined) {
      if (!Array.isArray(wt.extraPatterns)) return false;
      if (!(wt.extraPatterns as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.content !== undefined) {
    if (typeof obj.content !== "object" || obj.content === null) return false;
    const content = obj.content as Record<string, unknown>;
    if (typeof content.preset !== "string") return false;
    if (typeof content.projectType !== "string") return false;
    if (typeof content.teamSize !== "string") return false;
    if (!content.items || typeof content.items !== "object") return false;
    const items = content.items as Record<string, unknown>;
    const requiredKeys = ["agents", "skills", "rules", "commands", "prompts", "hooks", "githubAgents"];
    for (const key of requiredKeys) {
      if (!Array.isArray(items[key])) return false;
      if (!(items[key] as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.costTracking !== undefined) {
    if (typeof obj.costTracking !== "object" || obj.costTracking === null) return false;
    const ct = obj.costTracking as Record<string, unknown>;
    if (ct.sessionBudget !== undefined && typeof ct.sessionBudget !== "number") return false;
    if (ct.issueBudget !== undefined && typeof ct.issueBudget !== "number") return false;
    if (ct.epicBudget !== undefined && typeof ct.epicBudget !== "number") return false;
    if (ct.currency !== undefined && typeof ct.currency !== "string") return false;
    if (ct.warningThresholds !== undefined) {
      if (!Array.isArray(ct.warningThresholds)) return false;
      if (!(ct.warningThresholds as unknown[]).every((v) => typeof v === "number")) return false;
    }
    if (ct.hardStop !== undefined && typeof ct.hardStop !== "boolean") return false;
  }

  if (obj.customization !== undefined) {
    if (typeof obj.customization !== "object" || obj.customization === null) return false;
    const cu = obj.customization as Record<string, unknown>;
    if (cu.schemaVersion !== 1) return false;
    const perTypeKeys = ["agents", "skills", "rules", "commands"] as const;
    for (const key of perTypeKeys) {
      const v = cu[key];
      if (v === undefined) continue;
      if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
      for (const inner of Object.values(v as Record<string, unknown>)) {
        if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return false;
      }
    }
    if (cu.integrations !== undefined) {
      if (typeof cu.integrations !== "object" || cu.integrations === null || Array.isArray(cu.integrations)) return false;
    }
  }

  if (obj.specs !== undefined) {
    if (typeof obj.specs !== "object" || obj.specs === null) return false;
    const specs = obj.specs as Record<string, unknown>;
    if (!Array.isArray(specs.paths)) return false;
    if (!(specs.paths as unknown[]).every((v) => typeof v === "string")) return false;
    if (specs.lastGenerated !== undefined && typeof specs.lastGenerated !== "string") return false;
  }

  if (obj.workspace !== undefined) {
    if (typeof obj.workspace !== "object" || obj.workspace === null) return false;
    const ws = obj.workspace as Record<string, unknown>;
    if (typeof ws.rootPath !== "string") return false;
    if (typeof ws.lastSync !== "string") return false;
    if (typeof ws.syncVersion !== "string") return false;
    if (typeof ws.workspaceChecksum !== "string") return false;
    if (ws.excludedContent !== undefined) {
      if (!Array.isArray(ws.excludedContent)) return false;
      if (!(ws.excludedContent as unknown[]).every((v) => typeof v === "string")) return false;
    }
    if (ws.localContent !== undefined) {
      if (!Array.isArray(ws.localContent)) return false;
      if (!(ws.localContent as unknown[]).every((v) => typeof v === "string")) return false;
    }
  }

  if (obj.managedFilesByAdapter !== undefined) {
    if (typeof obj.managedFilesByAdapter !== "object" || obj.managedFilesByAdapter === null) return false;
    for (const [k, v] of Object.entries(obj.managedFilesByAdapter as Record<string, unknown>)) {
      if (typeof k !== "string") return false;
      if (!Array.isArray(v)) return false;
      if (!(v as unknown[]).every((p) => typeof p === "string")) return false;
    }
  }

  // D20 user-content counters (optional). Older manifests omit this field.
  if (obj.userContent !== undefined) {
    if (typeof obj.userContent !== "object" || obj.userContent === null) return false;
    const uc = obj.userContent as Record<string, unknown>;
    if (typeof uc.count !== "number") return false;
    if (typeof uc.lastModified !== "string") return false;
    if (typeof uc.types !== "object" || uc.types === null) return false;
    for (const [k, v] of Object.entries(uc.types as Record<string, unknown>)) {
      if (typeof k !== "string") return false;
      if (typeof v !== "number") return false;
    }
  }

  return true;
}

export async function readManifest(
  rootDir: string,
): Promise<HatchManifest | null> {
  const manifestPath = join(rootDir, AGENTS_DIR, MANIFEST_FILE);

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new HatchError(
      `Malformed JSON in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      1,
      "CONFIG_ERROR",
    );
  }

  const migrated = migrateManifest(parsed as Record<string, unknown>);

  if (!validateManifest(migrated)) {
    throw new HatchError(
      `Invalid manifest in ${manifestPath}: required fields missing or malformed. Run hatch3r init to regenerate.`,
      1,
      "CONFIG_ERROR",
    );
  }
  return migrated;
}

export async function writeManifest(
  rootDir: string,
  manifest: HatchManifest,
): Promise<void> {
  // C8-D1-M2: Validate manifest schema before persisting to disk.
  if (!validateManifest(manifest)) {
    throw new HatchError(
      "Invalid manifest schema: required fields missing or malformed. " +
      "Expected valid HatchManifest with tools, mcp, managedFiles populated. " +
      "Check that tools are in VALID_TOOLS and all required fields present.",
      undefined,
      "CONFIG_ERROR",
    );
  }
  const manifestPath = join(rootDir, AGENTS_DIR, MANIFEST_FILE);
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export function addManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  if (!manifest.managedFiles.includes(filePath)) {
    manifest.managedFiles.push(filePath);
  }
}

export function removeManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  manifest.managedFiles = manifest.managedFiles.filter((f) => f !== filePath);
}

/**
 * Subset of {@link HatchManifest} that carries user- and platform-specific state
 * which must survive `hatch3r clean` -> reinit and plain `hatch3r init` over an
 * existing `.agents/hatch.json`. Init options (platform, owner, repo, tools,
 * features, content, mcp) are intentionally excluded — those are user-confirmed
 * each run and must win over preserved values.
 *
 * `worktreeExtras` is split out so applying preserved extras never toggles
 * `manifest.worktree.enabled` on a user who opted out of worktrees on re-init.
 */
export interface PreservedManifestFields {
  board?: BoardConfig;
  costTracking?: CostTrackingConfig;
  specs?: HatchManifest["specs"];
  userContent?: HatchManifest["userContent"];
  hooks?: HooksConfig;
  models?: ModelConfig;
  claude?: ClaudeConfig;
  repos?: RepoEntry[];
  packages?: PackageEntry[];
  workspace?: HatchManifest["workspace"];
  /**
   * CLI-tooling pivot selection (added in 1.7.2). Preserved across `clean`
   * -> reinit so a user who opted in to ripgrep+jq does not have to re-pick
   * after running `hatch3r clean`. New init may override (init-supplied
   * selections always win over preserved, mirroring the board-config rule).
   */
  cliTools?: CliToolsConfig;
  worktreeExtras?: {
    extraPatterns?: string[];
    nodeModules?: "symlink" | "skip";
  };
}

export function extractPreservedManifestFields(
  manifest: HatchManifest,
): PreservedManifestFields {
  const out: PreservedManifestFields = {};
  if (manifest.board) out.board = manifest.board;
  if (manifest.costTracking) out.costTracking = manifest.costTracking;
  if (manifest.specs) out.specs = manifest.specs;
  if (manifest.userContent) out.userContent = manifest.userContent;
  if (manifest.hooks) out.hooks = manifest.hooks;
  if (manifest.models) out.models = manifest.models;
  if (manifest.claude) out.claude = manifest.claude;
  if (manifest.repos) out.repos = manifest.repos;
  if (manifest.packages) out.packages = manifest.packages;
  if (manifest.workspace) out.workspace = manifest.workspace;
  if (manifest.cliTools) out.cliTools = manifest.cliTools;
  if (
    manifest.worktree?.extraPatterns !== undefined ||
    manifest.worktree?.nodeModules !== undefined
  ) {
    out.worktreeExtras = {};
    if (manifest.worktree.extraPatterns !== undefined) {
      out.worktreeExtras.extraPatterns = manifest.worktree.extraPatterns;
    }
    if (manifest.worktree.nodeModules !== undefined) {
      out.worktreeExtras.nodeModules = manifest.worktree.nodeModules;
    }
  }
  return out;
}

/**
 * Mutate `manifest` in place, applying fields from `preserved`. Init-supplied
 * board owner/repo/defaultBranch always win — the user may be re-pointing the
 * project at a different repo while keeping their GitHub Projects v2 IDs (the
 * same semantics as `hatch3r config` at src/cli/commands/config.ts:557-560).
 *
 * Worktree extras only apply when the new manifest enables worktrees, so a
 * user who turned worktrees off during re-init does not end up with a
 * disabled config carrying stale `extraPatterns`.
 */
export function applyPreservedManifestFields(
  manifest: HatchManifest,
  preserved: PreservedManifestFields,
): void {
  if (preserved.board) {
    if (manifest.board) {
      manifest.board = {
        ...preserved.board,
        owner: manifest.board.owner,
        repo: manifest.board.repo,
        defaultBranch: manifest.board.defaultBranch ?? preserved.board.defaultBranch,
      };
    } else {
      // No new init-supplied board, but top-level manifest.owner/repo carry
      // the init-supplied identity (createManifest sets them unconditionally).
      // Override the preserved board's owner/repo so a re-init that re-points
      // the project does not leave manifest.board.{owner,repo} disagreeing
      // with manifest.{owner,repo}. Fall back to preserved values when the
      // new manifest has no identity set.
      manifest.board = {
        ...preserved.board,
        owner: manifest.owner || preserved.board.owner,
        repo: manifest.repo || preserved.board.repo,
      };
    }
  }
  if (preserved.costTracking) manifest.costTracking = preserved.costTracking;
  if (preserved.specs) manifest.specs = preserved.specs;
  if (preserved.userContent) manifest.userContent = preserved.userContent;
  if (preserved.hooks) manifest.hooks = preserved.hooks;
  if (preserved.models) manifest.models = preserved.models;
  if (preserved.claude) manifest.claude = preserved.claude;
  if (preserved.repos) manifest.repos = preserved.repos;
  if (preserved.packages) manifest.packages = preserved.packages;
  if (preserved.workspace) manifest.workspace = preserved.workspace;
  // init-supplied cliTools always wins (mirrors features / mcp re-confirmation
  // semantics); preserve only when re-init did not supply its own selection.
  if (preserved.cliTools && manifest.cliTools === undefined) {
    manifest.cliTools = preserved.cliTools;
  }
  if (preserved.worktreeExtras && manifest.worktree?.enabled) {
    if (preserved.worktreeExtras.extraPatterns !== undefined) {
      manifest.worktree.extraPatterns = preserved.worktreeExtras.extraPatterns;
    }
    if (preserved.worktreeExtras.nodeModules !== undefined) {
      manifest.worktree.nodeModules = preserved.worktreeExtras.nodeModules;
    }
  }
}

/**
 * Read the manifest's CLI-tooling pivot config, falling back to the
 * `{enabled: false, selected: []}` default when absent. Plan §4.2 — keeps
 * pre-1.7.2 manifests valid (no version bump required) by returning a
 * disabled-config sentinel rather than `undefined`. Centralises the
 * default so adapters and CLI commands do not duplicate the literal.
 */
export function readCliToolsConfig(m: HatchManifest): CliToolsConfig {
  return m.cliTools ?? { enabled: false, selected: [] };
}
