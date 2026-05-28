import { access, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_MATURITY_TIER,
  HATCH3R_DIR,
  HatchError,
  MANIFEST_FILE,
  VALID_MATURITY_TIERS,
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
  type MaturityTier,
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
  /**
   * C9-H47 (D14-SA14.4-H01): detected toolchain results from
   * `analyzeRepo`. Persisted on the manifest so adapter sync — which does
   * not re-run `analyzeRepo` — can resolve `${HATCH3R:LINTER}` etc.
   * tokens from the manifest alone. Omitted from the written manifest
   * when every field is empty so older fixtures stay byte-identical.
   */
  detected?: {
    linters?: string[];
    testFrameworks?: string[];
    ciProviders?: string[];
  };
  worktreeEnabled?: boolean;
  customization?: CustomizationManifest;
  /**
   * CLI-tooling pivot (1.7.5 / plan §4.2). When omitted the manifest is
   * left without a `cliTools` field — pre-1.7.5 manifest shape. When
   * supplied the field is written verbatim and consumers should read it
   * via {@link readCliToolsConfig} so absence still maps to
   * `{enabled: false, selected: []}`.
   */
  cliTools?: CliToolsConfig;
  /**
   * F14.2-H1 (D14): monorepo package layout enumerated by
   * `detectMonorepoPackages` at init time. Persisted on the manifest so
   * `hatch3r sync` knows which `<package>/.hatch3r/` targets to refresh
   * without re-running repo detection. Absence collapses to "no packages"
   * — sync behaves as a single-package repo. Empty array is treated the
   * same as absence (preserves manifest byte-identity for non-monorepo
   * repos).
   */
  packages?: PackageEntry[];
}): HatchManifest {
  const platform = options.platform ?? "github";
  const owner = options.owner ?? "";
  const repo = options.repo ?? "";
  const namespace = options.namespace ?? owner;
  const project = options.project ?? repo;
  const manifest: HatchManifest = {
    // schemaVersion 3 (Wave 6): manifest moved from `.agents/hatch.json` to
    // `.hatch3r/hatch.json`, root AGENTS.md bridge removed, and
    // `managedFilesByAdapter._shared` dropped (the sentinel bucket that
    // tracked the legacy root-AGENTS.md bridge — no shared bridge files
    // remain after Wave 3 removed AGENTS.md emission).
    version: "3.0.0",
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
  // F14.2-H1 (D14): persist the package layout so sync.ts can fan adapter
  // output into each `<package>/.hatch3r/` without re-running `analyzeRepo`.
  // Empty/absent collapses to single-package emission (no field written).
  if (options.packages && options.packages.length > 0) {
    manifest.packages = options.packages;
  }
  if (options.languages && options.languages.length > 0 && options.languages[0] !== "unknown") {
    manifest.languages = options.languages;
  }
  // C9-H47: persist detection results when at least one axis has content.
  // Empty arrays collapse to omission so the written manifest stays
  // byte-identical to pre-1.8.0 fixtures when detection found nothing
  // useful — the substitution layer treats absence as "unknown".
  if (options.detected) {
    const linters = options.detected.linters?.filter(Boolean) ?? [];
    const testFrameworks = options.detected.testFrameworks?.filter(Boolean) ?? [];
    const ciProviders = options.detected.ciProviders?.filter(Boolean) ?? [];
    if (linters.length > 0 || testFrameworks.length > 0 || ciProviders.length > 0) {
      manifest.detected = {};
      if (linters.length > 0) manifest.detected.linters = linters;
      if (testFrameworks.length > 0) manifest.detected.testFrameworks = testFrameworks;
      if (ciProviders.length > 0) manifest.detected.ciProviders = ciProviders;
    }
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

  // Wave 6 (1.9.0 / schemaVersion 3): drop the `_shared` sentinel bucket
  // from `managedFilesByAdapter`. It previously tracked the root AGENTS.md
  // bridge (Wave 3 removed the bridge); leaving the empty bucket on disk
  // would survive forever. Idempotent — runs every load until cleared.
  if (
    migrated.managedFilesByAdapter !== null &&
    typeof migrated.managedFilesByAdapter === "object"
  ) {
    const mfba = migrated.managedFilesByAdapter as Record<string, unknown>;
    if ("_shared" in mfba) {
      delete mfba._shared;
    }
  }

  if (migrated.version === "2.0.0") {
    migrated.version = "3.0.0";
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
    Array.isArray(obj.features) ||
    obj.mcp === null ||
    typeof obj.mcp !== "object" ||
    Array.isArray(obj.mcp) ||
    !Array.isArray(obj.managedFiles)
  ) {
    return false;
  }

  // F3.3-C1: Validate `mcp.servers` sub-schema — required, must be string[].
  // Mirrors the pattern used for `tools` below. Previously `mcp` was permitted
  // as `{}` with no servers field, leaving downstream consumers (adapters that
  // read `manifest.mcp.servers.length`) to throw TypeError instead of HatchError.
  const mcp = obj.mcp as Record<string, unknown>;
  if (!Array.isArray(mcp.servers)) return false;
  if (!(mcp.servers as unknown[]).every((s) => typeof s === "string")) return false;

  // #108: Validate tools array entries are known tool strings
  for (const tool of obj.tools as unknown[]) {
    if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) return false;
  }

  // F1.2-H2 (Cycle 10 D1): Validate the optional `maturity` scalar at the
  // persistence boundary. Previously `validateManifest` never inspected
  // `obj.maturity`, so a hand-edited `.hatch3r/hatch.json` carrying
  // `"maturity": "enterprice"` (typo) loaded without diagnostic and
  // `readMaturityTier` silently fell back to "solo" — the user got the
  // solo content surface with zero signal that their tier was discarded.
  // Reject an out-of-enum or non-string value here so `readManifest`
  // throws HatchError(CONFIG_ERROR) instead of degrading silently
  // (CONSTITUTION §2 P5 Silent Failure Contract).
  if (obj.maturity !== undefined) {
    if (typeof obj.maturity !== "string" || !VALID_MATURITY_TIERS.has(obj.maturity)) {
      return false;
    }
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

  // C9-H47 (D14-SA14.4-H01): detected toolchain context (optional).
  // Older manifests omit this field — token substitution falls back to
  // the "unknown" sentinel in that case.
  if (obj.detected !== undefined) {
    if (typeof obj.detected !== "object" || obj.detected === null) return false;
    const det = obj.detected as Record<string, unknown>;
    const detectionKeys = ["linters", "testFrameworks", "ciProviders"] as const;
    for (const key of detectionKeys) {
      const v = det[key];
      if (v === undefined) continue;
      if (!Array.isArray(v)) return false;
      if (!(v as unknown[]).every((s) => typeof s === "string")) return false;
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

/**
 * Wave 6 manifest-relocation shim. Migrates `.agents/hatch.json` ->
 * `.hatch3r/hatch.json` on first read against an existing pre-1.9 install.
 * Idempotent: returns immediately when the new path already holds the file,
 * and never touches `.agents/` when `.hatch3r/hatch.json` is present.
 *
 * Emits a single one-shot console warning per migration so operators see why
 * the directory changed; no warning when the layout is already current.
 *
 * Surrounding state moves (`learnings/`, `handoffs/`, `mcp/mcp.json`) are
 * handled by `src/migration/agentsToHatch3r.ts::migrateAgentsToHatch3r`,
 * which is called from `runInit`/`runSync`/`runUpdate`/`runRegenerate`/
 * `syncWorkspaceRepos`. The shim here is a defensive duplicate for callers
 * that exercise `readManifest` outside those entry points.
 */
async function migrateManifestPath(rootDir: string): Promise<void> {
  // Legacy `.agents/` literal — migration shim only; new writes target
  // `.hatch3r/`.
  const oldPath = join(rootDir, ".agents", MANIFEST_FILE);
  const newPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  // Fast path: new layout already in place.
  try {
    await access(newPath);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Old path must exist for a migration to make sense.
  try {
    await access(oldPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await mkdir(join(rootDir, HATCH3R_DIR), { recursive: true });
  await rename(oldPath, newPath);
  console.warn(
    `[hatch3r] Migrated manifest from .agents/${MANIFEST_FILE} ` +
      `to ${HATCH3R_DIR}/${MANIFEST_FILE}.`,
  );
}

export async function readManifest(
  rootDir: string,
): Promise<HatchManifest | null> {
  await migrateManifestPath(rootDir);
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);

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
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  // Wave 6: ensure the destination directory exists. `writeManifest` is the
  // first writer touching `.hatch3r/` in several pipelines (workspace init,
  // some test fixtures); pre-creating the directory keeps the atomic write
  // from failing with ENOENT on the temp-file path.
  await mkdir(dirname(manifestPath), { recursive: true });
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
 * existing `.hatch3r/hatch.json`. Init options (platform, owner, repo, tools,
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
   * CLI-tooling pivot selection (added in 1.7.5). Preserved across `clean`
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
 * pre-1.7.5 manifests valid (no version bump required) by returning a
 * disabled-config sentinel rather than `undefined`. Centralises the
 * default so adapters and CLI commands do not duplicate the literal.
 */
export function readCliToolsConfig(m: HatchManifest): CliToolsConfig {
  return m.cliTools ?? { enabled: false, selected: [] };
}

/**
 * Read the manifest's maturity tier (Decision 4 / #16). Absence collapses to
 * `DEFAULT_MATURITY_TIER` ("solo") so pre-2.0 manifests stay valid without a
 * schema version bump.
 *
 * As of F1.2-H2 (Cycle 10) an out-of-enum persisted `maturity` is rejected at
 * the persistence boundary by `validateManifest`, so a manifest that reaches
 * this function has already passed that membership check. The fallback here is
 * retained as defense-in-depth for the `null`/`undefined` manifest callers
 * (e.g. callers that pass a not-yet-read manifest) and for the absent-field
 * case; the `config maturity=<tier>` setter also rejects invalid input at
 * write time.
 */
export function readMaturityTier(m: HatchManifest | null | undefined): MaturityTier {
  const value = m?.maturity;
  if (value && VALID_MATURITY_TIERS.has(value)) {
    return value;
  }
  return DEFAULT_MATURITY_TIER;
}
