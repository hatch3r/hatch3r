import { fileURLToPath } from "node:url";
import { access, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest, isValidGitBranchName, readMaturityTier } from "../../manifest/hatchJson.js";
import {
  DEFAULT_FEATURES,
  HATCH3R_DIR,
  HatchError,
  MANIFEST_FILE,
  MATURITY_TIERS,
  VALID_MATURITY_TIERS,
  WORKTREE_CAPABLE_TOOLS,
  WORKTREE_INCLUDE_FILE,
  type CliToolId,
  type CliToolsConfig,
  type ContentSelection,
  type Features,
  type HatchManifest,
  type MaturityTier,
  type Platform,
  type Tool,
} from "../../types.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import {
  printBanner,
  createSpinner,
  printBox,
  info,
  error as logError,
  step,
  label,
  warn,
  verbose,
} from "../shared/ui.js";
import { runRegenerate } from "./update.js";
import { archiveToolOutputs, removeManagedFilesForPaths, type MigrationNotice } from "../../archive/index.js";
import { findPackageRoot } from "../shared/paths.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { detectSubRepos, detectWorkspaceContext } from "../../workspace/detect.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { detectRepoGitIdentity } from "../../workspace/git.js";
import { TOOL_DISPLAY_NAMES, TOOL_PROMPT_CHOICES, FEATURE_CHOICES, PLATFORM_DISPLAY_NAMES, sanitizeInput, isWSL } from "../shared/constants.js";
import { pickCliTools, pickMcpServers, confirmMcpGate } from "../shared/pickers.js";
import {
  BACK,
  isBack,
  runStepMachine,
  type Step,
  type StepResult,
} from "../shared/initSteps.js";
import { findMissingCliTools } from "../../cliTools/detect.js";
import { offerInstaller, printMissingCliToolsDisclaimer } from "../../cliTools/install.js";
import { buildTagGroupedCustomContentChoices } from "../shared/customContentChoices.js";
import {
  buildContentIndex,
  addContentItem,
  removeContentItem,
  countSelectionItems,
  selectionSummary,
  extractContentReferences,
  validateOrchestrationDependencies,
  resolveSelection,
  countPresetExclusions,
  estimatePresetItemCount,
  getAllContentIds,
} from "../../content/index.js";
import { PRESETS, getPreset, type PresetId } from "../../content/presets.js";
import { acquireWriteLock, safeWriteFile } from "../../merge/safeWrite.js";
import { withSnapshot } from "../../pipeline/snapshot.js";
import { writeCheckpoint, type CheckpointMeta } from "../../pipeline/checkpoint.js";
import { HATCH3R_VERSION } from "../../version.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ConfigDiff {
  addedTools: Tool[];
  removedTools: Tool[];
  addedMcp: string[];
  removedMcp: string[];
  enabledFeatures: (keyof Features)[];
  disabledFeatures: (keyof Features)[];
  platformChanged: boolean;
  repoChanged: boolean;
  addedContent: Array<{ type: string; id: string }>;
  removedContent: Array<{ type: string; id: string }>;
  /** CLI-tooling pivot (plan §4.4): tools selected this run that weren't before. */
  addedCliTools: CliToolId[];
  /** CLI-tooling pivot: tools previously selected that the user removed this run. */
  removedCliTools: CliToolId[];
}

/**
 * D1-M5 (Cycle 10 Wave-3 Medium): structured input for content-side diff
 * pieces that are computed by the surrounding apply-loop (`addContentItem` /
 * `removeContentItem` side effects). Previously `computeDiff` returned
 * empty arrays for these fields and the caller patched them up after the
 * call, leaving the return shape misleading on its own. Accept the lists
 * here so the returned ConfigDiff is internally consistent without a
 * post-construction mutation step at the call-site.
 */
interface ContentChanges {
  added: Array<{ type: string; id: string }>;
  removed: Array<{ type: string; id: string }>;
}

function computeDiff(
  oldManifest: HatchManifest,
  newTools: Tool[],
  newFeatures: Features,
  newMcp: string[],
  newPlatform: Platform,
  newOwner: string,
  newRepo: string,
  newNamespace: string,
  newProject: string,
  newCliToolIds: CliToolId[],
  contentChanges: ContentChanges = { added: [], removed: [] },
): ConfigDiff {
  const oldToolSet = new Set(oldManifest.tools);
  const newToolSet = new Set(newTools);
  const oldMcpSet = new Set(oldManifest.mcp.servers);
  const newMcpSet = new Set(newMcp);
  const oldCliSet = new Set(oldManifest.cliTools?.selected ?? []);
  const newCliSet = new Set(newCliToolIds);

  const enabledFeatures: (keyof Features)[] = [];
  const disabledFeatures: (keyof Features)[] = [];
  for (const key of Object.keys(DEFAULT_FEATURES) as (keyof Features)[]) {
    if (newFeatures[key] && !oldManifest.features[key]) enabledFeatures.push(key);
    if (!newFeatures[key] && oldManifest.features[key]) disabledFeatures.push(key);
  }

  return {
    addedTools: newTools.filter((t) => !oldToolSet.has(t)),
    removedTools: oldManifest.tools.filter((t) => !newToolSet.has(t)),
    addedMcp: newMcp.filter((s) => !oldMcpSet.has(s)),
    removedMcp: oldManifest.mcp.servers.filter((s) => !newMcpSet.has(s)),
    enabledFeatures,
    disabledFeatures,
    platformChanged: newPlatform !== oldManifest.platform,
    repoChanged:
      newOwner !== oldManifest.owner ||
      newRepo !== oldManifest.repo ||
      newNamespace !== oldManifest.namespace ||
      newProject !== oldManifest.project,
    addedContent: contentChanges.added,
    removedContent: contentChanges.removed,
    addedCliTools: newCliToolIds.filter((id) => !oldCliSet.has(id)),
    removedCliTools: [...oldCliSet].filter((id) => !newCliSet.has(id)),
  };
}

function isDiffEmpty(diff: ConfigDiff): boolean {
  return (
    diff.addedTools.length === 0 &&
    diff.removedTools.length === 0 &&
    diff.addedMcp.length === 0 &&
    diff.removedMcp.length === 0 &&
    diff.enabledFeatures.length === 0 &&
    diff.disabledFeatures.length === 0 &&
    !diff.platformChanged &&
    !diff.repoChanged &&
    diff.addedContent.length === 0 &&
    diff.removedContent.length === 0 &&
    diff.addedCliTools.length === 0 &&
    diff.removedCliTools.length === 0
  );
}

/**
 * F10.4-2 (Cycle 10): Customization types scanned for `.customize.yaml` and
 * `.customize.md` overrides under `.hatch3r/<type>/`. Mirrors validate.ts's
 * CUSTOMIZATION_TYPES; duplicated here to avoid pulling the validate module
 * into the config-command code path.
 */
const CONFIG_CUSTOMIZATION_DIRS = ["agents", "commands", "skills", "rules"] as const;

/**
 * F10.4-2 (Cycle 10): Count `.customize.yaml` / `.customize.md` files present
 * under `.hatch3r/<type>/` for each customizable artifact type. Returns one
 * entry per type that has ≥1 override; types with zero overrides are omitted.
 * Missing directories (ENOENT) are silently treated as zero; other read
 * errors surface via verbose() per the Silent Failure Contract.
 */
async function countCustomizationsByType(
  rootDir: string,
): Promise<Array<{ type: string; count: number }>> {
  const results: Array<{ type: string; count: number }> = [];
  for (const type of CONFIG_CUSTOMIZATION_DIRS) {
    const dir = join(rootDir, HATCH3R_DIR, type);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      verbose(`config: countCustomizationsByType(${dir}) skipped — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const count = entries.filter(
      (f) => f.endsWith(".customize.yaml") || f.endsWith(".customize.md"),
    ).length;
    if (count > 0) results.push({ type, count });
  }
  return results;
}

async function printCurrentConfig(rootDir: string, manifest: HatchManifest): Promise<void> {
  const platformLabel = manifest.platform
    ? `${PLATFORM_DISPLAY_NAMES[manifest.platform]} (${manifest.namespace || manifest.owner}/${manifest.project || manifest.repo})`
    : "Not set";
  const branch = manifest.board?.defaultBranch ?? "main";
  const enabledFeatures = Object.entries(manifest.features)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const toolNames = manifest.tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ");

  const lines = [
    label("Platform", platformLabel),
    label("Branch", branch),
    label("Tools", toolNames),
    label("Features", enabledFeatures.join(", ")),
  ];

  // CLI-tooling pivot (plan §4.4): always show CLI tools row (signals
  // the new default surface area), show MCP only when non-empty.
  const cliSelected = manifest.cliTools?.selected ?? [];
  lines.push(label("CLI tools", cliSelected.length > 0 ? cliSelected.join(", ") : "none"));
  if (manifest.mcp.servers.length > 0) {
    lines.push(label("MCP", manifest.mcp.servers.join(", ")));
  }

  if (manifest.content) {
    const total = countSelectionItems(manifest.content);
    lines.push(label("Content", `${total} items (${selectionSummary(manifest.content)})`));
  }

  // F10.4-2 (Cycle 10): enumerate `.customize.yaml` / `.customize.md` overrides
  // per type so users see existing behavior-overrides BEFORE deciding whether
  // to remove an item from selection (which would also lose the override).
  const customizationCounts = await countCustomizationsByType(rootDir);
  if (customizationCounts.length > 0) {
    const summary = customizationCounts.map((c) => `${c.type}: ${c.count}`).join(", ");
    lines.push(label("Customizations", summary));
  }

  printBox("Current configuration", lines, "info");
}

/**
 * Known scalar config keys settable via `hatch3r config <key>=<value>` or
 * `hatch3r config set <key> <value>`. Each entry validates its input and
 * mutates the manifest in place; the caller persists with `writeManifest`.
 *
 * Today only `maturity` is exposed; the structure is shaped so further
 * scalar keys (e.g. `costTracking.currency`) can be added without changing
 * the dispatch layer.
 */
type ScalarConfigKey = "maturity";

const SCALAR_CONFIG_KEYS = new Set<string>(["maturity"]);

function isScalarConfigKey(key: string): key is ScalarConfigKey {
  return SCALAR_CONFIG_KEYS.has(key);
}

/**
 * Parse the first positional argument as either `<key>=<value>` (set form) or
 * a bare key (get form when paired with the leading `get` verb at the CLI
 * level). Returns null when the argument is absent or does not match the
 * scalar key/value contract — caller falls back to the interactive flow.
 */
function parseScalarKeyValue(arg: string | undefined): { key: ScalarConfigKey; value: string } | null {
  if (!arg) return null;
  const eq = arg.indexOf("=");
  if (eq === -1) return null;
  const key = arg.slice(0, eq).trim();
  const value = arg.slice(eq + 1).trim();
  if (!isScalarConfigKey(key)) return null;
  return { key, value };
}

/**
 * D1-SA1.2-L2: detect whether the leading argument(s) name a scalar config
 * form (`<key>=<value>`, `get <key>`, or `set <key> ...`). Used to decide
 * whether the workspace-member warning gate applies before the scalar
 * dispatch — the interactive flow already warns at config.ts's
 * workspace-context block, but `handleScalarConfig` short-circuits before
 * that block runs. Returns false for non-scalar args so a fall-through to
 * the interactive flow does not pay the workspace probe twice.
 */
function isScalarConfigForm(arg1?: string, arg2?: string): boolean {
  if (parseScalarKeyValue(arg1)) return true;
  if (arg1 === "get" && isScalarConfigKey((arg2 ?? "").trim())) return true;
  if (arg1 === "set") {
    const rest = (arg2 ?? "").trim();
    const eq = rest.indexOf("=");
    const key = eq !== -1 ? rest.slice(0, eq).trim() : rest.split(/\s+/)[0] ?? "";
    return isScalarConfigKey(key);
  }
  return false;
}

/**
 * Validate and apply a scalar config write to the in-memory manifest. Throws
 * `HatchError` (VALIDATION_ERROR) on invalid input. Returns the previous
 * value so the caller can render a before/after diff.
 */
function applyScalarConfigWrite(
  manifest: HatchManifest,
  key: ScalarConfigKey,
  value: string,
): { previous: string | undefined; next: string } {
  if (key === "maturity") {
    if (!VALID_MATURITY_TIERS.has(value)) {
      throw new HatchError(
        `Invalid maturity tier: "${value}". Valid: ${[...MATURITY_TIERS].join(", ")}`,
        undefined,
        "VALIDATION_ERROR",
        `Re-run with one of: ${[...MATURITY_TIERS].join(", ")}.`,
      );
    }
    const previous = manifest.maturity;
    manifest.maturity = value as MaturityTier;
    return { previous, next: value };
  }
  // Exhaustive guard for future keys — the type system enforces this branch
  // is unreachable today.
  throw new HatchError(
    `Unsupported config key: ${key}`,
    undefined,
    "VALIDATION_ERROR",
    `Use one of: ${[...SCALAR_CONFIG_KEYS].join(", ")}.`,
  );
}

/**
 * Render the current value for a scalar config key. Used by the `get` form.
 * Returns the persisted value, defaulting to the documented fallback when
 * absent (e.g. `maturity` defaults to "solo" per Decision 4).
 */
function readScalarConfigValue(manifest: HatchManifest, key: ScalarConfigKey): string {
  if (key === "maturity") {
    return readMaturityTier(manifest);
  }
  throw new HatchError(
    `Unsupported config key: ${key}`,
    undefined,
    "VALIDATION_ERROR",
    `Use one of: ${[...SCALAR_CONFIG_KEYS].join(", ")}.`,
  );
}

/**
 * Handle the non-interactive `hatch3r config <key>=<value>` and
 * `hatch3r config get|set <key> [<value>]` forms. Returns true when the
 * arguments were a known scalar form (caller short-circuits); false when
 * the call should fall through to the interactive flow.
 *
 * Accepts four shapes (D1-SA1.2-L3 — the verb+eq form was reachable but
 * previously undocumented):
 *   configCommand("maturity=team")        — set form (single arg with `=`)
 *   configCommand("set", "maturity team") — set form (verb + space-separated value)
 *   configCommand("set", "maturity=team") — set form (verb + `=`-joined value)
 *   configCommand("get", "maturity")      — get form (verb + key)
 */
async function handleScalarConfig(
  rootDir: string,
  manifest: HatchManifest,
  arg1?: string,
  arg2?: string,
): Promise<boolean> {
  // F16.1-C1 (Decision 27 / Bucket 2.2): record a `passed` checkpoint after a
  // scalar-config manifest write under `.config-workspace/checkpoint.json`.
  // The scalar set/get forms are a single-phase mutation (no adapter
  // regenerate), so one wave-1 "passed" marker is the complete progress
  // record. Best-effort: failure routes through verbose() and never blocks
  // the config write that already succeeded.
  const recordScalarCheckpoint = async (): Promise<void> => {
    const meta: CheckpointMeta = {
      baselineSha: HATCH3R_VERSION,
      lastPassedGateN: 1,
      registrySha: "",
      timestamp: new Date().toISOString(),
    };
    try {
      await writeCheckpoint(join(rootDir, ".config-workspace"), "config", 1, "passed", meta);
    } catch (err) {
      verbose(`config: scalar checkpoint write skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // D1-SA1.2-L2: the interactive flow warns workspace members that local
  // changes are overwritten on the next workspace sync (config.ts workspace-
  // context block), but the scalar setter short-circuits before that block.
  // Mirror the warning here for write forms (`<key>=<value>` and `set ...`) so
  // a `hatch3r config maturity=team` run inside a workspace-member repo is not
  // silently dropped on the next sync. Read-only `get` does not write, so it
  // is excluded. Non-blocking: the write proceeds after the warning.
  const isWriteScalarForm = Boolean(parseScalarKeyValue(arg1)) || arg1 === "set";
  if (isWriteScalarForm && isScalarConfigForm(arg1, arg2)) {
    const wsContext = await detectWorkspaceContext(rootDir);
    if (wsContext.type === "workspace-member") {
      warn(
        `This repo is managed by workspace at ${wsContext.workspaceRoot}. ` +
        `The scalar config write will be overwritten by next workspace sync.`,
      );
    }
  }

  // Form 1: bare `key=value` ─ e.g. `hatch3r config maturity=team`
  const inlineSet = parseScalarKeyValue(arg1);
  if (inlineSet) {
    const { previous, next } = applyScalarConfigWrite(manifest, inlineSet.key, inlineSet.value);
    // Decision 27 (Bucket 2.2): snapshot the manifest before the
    // scalar-config write so a misconfigured maturity tier can be undone
    // with `hatch3r rollback --session=<id>`.
    const scalarSnap = await withSnapshot(
      "config",
      [join(rootDir, HATCH3R_DIR, "hatch.json")],
      async (_sessionId) => undefined,
      { projectRoot: rootDir, onWarn: warn },
    );
    await writeManifest(rootDir, manifest);
    await recordScalarCheckpoint();
    if (previous === next) {
      info(`${inlineSet.key} is already set to "${next}". No change.`);
    } else {
      info(`Set ${inlineSet.key}: ${chalk.dim(previous ?? "<default>")} ${chalk.cyan("→")} ${chalk.bold(next)}`);
      if (scalarSnap.sessionId) {
        info(`Snapshot: ${scalarSnap.sessionId} (revert: hatch3r rollback --session=${scalarSnap.sessionId})`);
      }
    }
    return true;
  }

  // Form 2: `get <key>` ─ e.g. `hatch3r config get maturity`
  if (arg1 === "get") {
    const key = (arg2 ?? "").trim();
    if (!isScalarConfigKey(key)) {
      throw new HatchError(
        `Unknown config key: "${key}". Valid: ${[...SCALAR_CONFIG_KEYS].join(", ")}`,
        undefined,
        "VALIDATION_ERROR",
        `Re-run with one of: ${[...SCALAR_CONFIG_KEYS].join(", ")}.`,
      );
    }
    const value = readScalarConfigValue(manifest, key);
    console.log(value);
    return true;
  }

  // Form 3: `set <key> <value>` ─ e.g. `hatch3r config set maturity team`
  if (arg1 === "set") {
    // Accept either `set maturity team` or `set maturity=team` shapes.
    const rest = (arg2 ?? "").trim();
    let key: string;
    let value: string;
    const eq = rest.indexOf("=");
    if (eq !== -1) {
      key = rest.slice(0, eq).trim();
      value = rest.slice(eq + 1).trim();
    } else {
      const parts = rest.split(/\s+/);
      key = parts[0] ?? "";
      value = parts.slice(1).join(" ").trim();
    }
    if (!isScalarConfigKey(key)) {
      throw new HatchError(
        `Unknown config key: "${key}". Valid: ${[...SCALAR_CONFIG_KEYS].join(", ")}`,
        undefined,
        "VALIDATION_ERROR",
        `Re-run with one of: ${[...SCALAR_CONFIG_KEYS].join(", ")}.`,
      );
    }
    if (!value) {
      throw new HatchError(
        `Missing value for "${key}". Usage: hatch3r config set ${key} <value>`,
        undefined,
        "VALIDATION_ERROR",
        `Re-run as \`hatch3r config set ${key} <value>\` with a value.`,
      );
    }
    const { previous, next } = applyScalarConfigWrite(manifest, key, value);
    // Decision 27 (Bucket 2.2): snapshot before `set` form writes too.
    const scalarSnap = await withSnapshot(
      "config",
      [join(rootDir, HATCH3R_DIR, "hatch.json")],
      async (_sessionId) => undefined,
      { projectRoot: rootDir, onWarn: warn },
    );
    await writeManifest(rootDir, manifest);
    await recordScalarCheckpoint();
    if (previous === next) {
      info(`${key} is already set to "${next}". No change.`);
    } else {
      info(`Set ${key}: ${chalk.dim(previous ?? "<default>")} ${chalk.cyan("→")} ${chalk.bold(next)}`);
      if (scalarSnap.sessionId) {
        info(`Snapshot: ${scalarSnap.sessionId} (revert: hatch3r rollback --session=${scalarSnap.sessionId})`);
      }
    }
    return true;
  }

  return false;
}

export async function configCommand(arg1?: string, arg2?: string): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  // F1.2-H1 (Cycle 10): Hold a cross-process advisory lock on `hatch.json`
  // across the full read-modify-write window — `readManifest` happens after
  // acquire, every `writeManifest` happens before release. Without this, a
  // concurrent `hatch3r config | init | sync` running between our read and
  // write silently clobbers one side (safeWrite.ts: documented silent-clobber
  // risk is opt-in-only). Locking is opt-in via `HATCH3R_LOCK=1` so the
  // default single-process behavior is unchanged. The lock is reentrant
  // within this process so inner `atomicWriteFile` calls (invoked by
  // `writeManifest`) re-use the held lock instead of self-deadlocking.
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  const releaseManifestLock = await acquireWriteLock(manifestPath);
  try {
    await configCommandImpl(rootDir, arg1, arg2);
  } finally {
    try {
      await releaseManifestLock();
    } catch (releaseErr) {
      // Silent Failure Contract (P5): surface release failures so operators
      // can clear a stale lockfile before re-running. The release function
      // returned by acquireWriteLock is a no-op when locking was inactive,
      // so reaching this catch implies a real lock was taken (either via
      // env-var opt-in or D8-M3 workspace/worktree default-on).
      console.error(
        `hatch3r: failed to release manifest write lock at ${manifestPath}: ` +
          `${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
      );
    }
  }
}

/**
 * Body of `configCommand`. Lifted into a helper so the outer function can
 * acquire the cross-process manifest lock (F1.2-H1) once and hold it across
 * the full critical section — including every early `return` path — without
 * duplicating the `try/finally` release at every exit point.
 */
async function configCommandImpl(rootDir: string, arg1?: string, arg2?: string): Promise<void> {
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .hatch3r/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError(
      "No .hatch3r/hatch.json found.",
      undefined,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  // Scalar key/value dispatch — handles `hatch3r config <key>=<value>`,
  // `hatch3r config set <key> <value>`, and `hatch3r config get <key>`.
  // Returns true when the call was handled; false drops through to the
  // interactive flow below.
  if (await handleScalarConfig(rootDir, manifest, arg1, arg2)) {
    return;
  }

  // F10.4-2 (Cycle 10): Surface the selection-vs-customization distinction
  // up front — promoted from a dim one-liner buried mid-flow (which only
  // printed when `manifest.content` was set) to a top-level info box on
  // every interactive `hatch3r config` invocation. 1.6.x→1.8.x history shows
  // recurring confusion where users removed items from selection to change
  // behavior (losing the override); rendering this distinction before any
  // prompt nudges them to `.customize.yaml` / `.customize.md` instead.
  printBox(
    "Two ways to change content",
    [
      "Selection — adds or removes content items in this config flow.",
      "Customization — overrides an item's behavior without removing it.",
      "  Place .hatch3r/<type>/<id>.customize.yaml (settings) or",
      "  .hatch3r/<type>/<id>.customize.md (content append).",
    ],
    "info",
  );

  // Detect workspace context early to drive UI flow
  const wsContext = await detectWorkspaceContext(rootDir);

  if (wsContext.type === "workspace-member") {
    warn(
      `This repo is managed by workspace at ${wsContext.workspaceRoot}. ` +
      `Changes here may be overwritten on next workspace sync.`,
    );
    console.log();
    const actionAnswer = await inquirer.prompt<{ action: string | typeof BACK }>([
      {
        type: "select",
        name: "action",
        message: "How would you like to proceed?",
        choices: [
          { name: "Configure this repo locally", value: "local" },
          { name: "Switch to workspace root config", value: "workspace" },
        ],
        default: "local",
      },
    ]);
    if (isBack(actionAnswer.action)) {
      info("Config cancelled (Shift+Tab).");
      return;
    }
    const action = actionAnswer.action as string;
    if (action === "workspace") {
      info(`To configure the workspace, run: cd ${wsContext.workspaceRoot} && npx hatch3r config`);
      return;
    }
  }

  // Show workspace-aware header for workspace roots
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (wsContext.type === "workspace-root" && wsManifest) {
    const repoCount = wsManifest.repos.length;
    printBox(
      `Workspace configuration (${repoCount} repo${repoCount !== 1 ? "s" : ""})`,
      [
        label("Workspace", wsManifest.name),
        label("Strategy", wsManifest.syncStrategy),
        label("Repos", wsManifest.repos.map((r) => r.name ?? r.path).join(", ") || "(none)"),
      ],
      "info",
    );
  }

  await printCurrentConfig(rootDir, manifest);

  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;

  // --- Interactive flow (step machine) ---
  //
  // Lifted out of a linear sequence of inquirer.prompt calls so Shift+Tab
  // walks back through prior prompts the way it does in `hatch3r init`.
  // Each prompt is a step in `runStepMachine` — when a step returns BACK,
  // the driver re-renders the nearest live earlier step with the user's
  // prior answer pre-selected. The step body is the only place an answer
  // can be a BACK sentinel; downstream consumers (sanitizeInput, .trim,
  // .toLowerCase, JSON.stringify) see only real string/array values.

  const currentBranch = manifest.board?.defaultBranch ?? "main";

  // Pre-compute content-management inputs that the preset + customItems
  // steps close over. These are stable across the step machine because
  // they derive from the on-disk manifest (which the machine never
  // mutates).
  let contentRoot: string | undefined;
  let agentsDir: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contentIndex: any;
  let totalItems = 0;
  let contentProjectType: ContentSelection["projectType"] | undefined;
  let contentTeamSize: ContentSelection["teamSize"] | undefined;
  if (manifest.content) {
    // #145 (D19-16) / F10.4-2 (Cycle 10): the selection-vs-customization
    // distinction is now surfaced at the top of `configCommandImpl` via a
    // printBox(..., 'info') visible on every interactive invocation; no need
    // to restate the one-liner mid-flow.
    contentRoot = findPackageRoot(__dirname);
    // Wave 7: legacy `.agents/` literal — the `addContentItem` / canonical
    // AGENTS.md materialization block below operates on the pre-1.9
    // canonical tree, which Wave 3+4 has already eliminated for new installs.
    // Wired through here so existing `.agents/` installs that have not yet
    // run the migration shim continue to behave; replace with bundled-content
    // sourcing in a follow-up wave.
    agentsDir = join(rootDir, ".agents");
    contentIndex = await buildContentIndex(contentRoot);
    totalItems = contentIndex.items.length;
    contentProjectType = manifest.content.projectType;
    contentTeamSize = manifest.content.teamSize;
    // NOTE: `getAllContentIds(manifest.content)` is intentionally deferred
    // to the customItems step's run() (and to the trailing diff block) so
    // call ordering matches the pre-refactor behaviour — the
    // configHelpers `stubContentIdsTransition` test stub returns
    // oldIds-then-newIds across two calls.
  }

  interface ConfigState {
    platform: Platform;
    identity: { owner: string; repo: string; namespace: string; project: string };
    defaultBranch: string;
    tools: Tool[];
    cliTools: CliToolId[];
    features: (keyof Features)[];
    mcpGate: boolean;
    mcpServers: string[];
    worktreeEnabled: boolean;
    preset: PresetId;
    customItems: string[] | undefined;
  }

  const steps: Array<Step<ConfigState, keyof ConfigState>> = [
    {
      id: "platform",
      async run(_state, previous): Promise<StepResult<Platform>> {
        const answer = await inquirer.prompt<{ platform: Platform | typeof BACK }>([
          {
            type: "select",
            name: "platform",
            message: "Platform:",
            choices: [
              { name: "GitHub", value: "github" as Platform },
              { name: "Azure DevOps", value: "azure-devops" as Platform },
              { name: "GitLab", value: "gitlab" as Platform },
            ],
            default: previous ?? manifest.platform ?? "github",
          },
        ]);
        return isBack(answer.platform) ? BACK : (answer.platform as Platform);
      },
    },
    {
      id: "identity",
      async run(state, previous): Promise<StepResult<ConfigState["identity"]>> {
        const plat = state.platform!;
        if (plat === "azure-devops") {
          const ado = await inquirer.prompt<{ org: string | typeof BACK; project: string | typeof BACK; repo: string | typeof BACK }>([
            { type: "input", name: "org", message: "Azure DevOps organization:", default: previous?.owner || manifest.owner || undefined },
            { type: "input", name: "project", message: "Azure DevOps project:", default: previous?.project || manifest.project || undefined },
            { type: "input", name: "repo", message: "Repository name:", default: previous?.repo || manifest.repo || undefined },
          ]);
          if (isBack(ado.org) || isBack(ado.project) || isBack(ado.repo)) return BACK;
          const owner = sanitizeInput(ado.org as string);
          return {
            owner,
            repo: sanitizeInput(ado.repo as string),
            namespace: owner,
            project: sanitizeInput(ado.project as string),
          };
        } else if (plat === "gitlab") {
          const gl = await inquirer.prompt<{ namespace: string | typeof BACK; project: string | typeof BACK }>([
            { type: "input", name: "namespace", message: "GitLab namespace (group or username):", default: previous?.namespace || manifest.namespace || manifest.owner || undefined },
            { type: "input", name: "project", message: "Project name:", default: previous?.project || manifest.project || manifest.repo || undefined },
          ]);
          if (isBack(gl.namespace) || isBack(gl.project)) return BACK;
          const owner = sanitizeInput(gl.namespace as string);
          const repo2 = sanitizeInput(gl.project as string);
          return { owner, repo: repo2, namespace: owner, project: repo2 };
        } else {
          const gh = await inquirer.prompt<{ owner: string | typeof BACK; repo: string | typeof BACK }>([
            { type: "input", name: "owner", message: "GitHub owner (org or username):", default: previous?.owner || manifest.owner || undefined },
            { type: "input", name: "repo", message: "Repository name:", default: previous?.repo || manifest.repo || undefined },
          ]);
          if (isBack(gh.owner) || isBack(gh.repo)) return BACK;
          const owner = sanitizeInput(gh.owner as string);
          const repo2 = sanitizeInput(gh.repo as string);
          return { owner, repo: repo2, namespace: owner, project: repo2 };
        }
      },
    },
    {
      id: "defaultBranch",
      async run(_state, previous): Promise<StepResult<string>> {
        const answers = await inquirer.prompt<{ defaultBranch: string | typeof BACK }>([
          {
            type: "input",
            name: "defaultBranch",
            message: "Default branch (for checkout, PR base, release):",
            default: previous ?? currentBranch,
            // C8-D1-M9: reject values that fail `git check-ref-format`. Matches
            // the init.ts default-branch prompt so an invalid ref cannot reach
            // `manifest.board.defaultBranch`. Shift+Tab is intercepted before
            // the validator runs, so the validator only sees real strings.
            validate: (v: string) => {
              const trimmed = v.trim();
              if (trimmed === "") return true;
              return (
                isValidGitBranchName(trimmed) ||
                `Invalid git branch name: "${trimmed}". See git-check-ref-format(1).`
              );
            },
          },
        ]);
        if (isBack(answers.defaultBranch)) return BACK;
        return (answers.defaultBranch as string).trim() || currentBranch;
      },
    },
    {
      id: "tools",
      async run(_state, previous): Promise<StepResult<Tool[]>> {
        const toolAnswers = await inquirer.prompt<{ tools: Tool[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "tools",
            message: "Select tools to configure:",
            choices: TOOL_PROMPT_CHOICES,
            default: previous ?? manifest.tools,
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        if (isBack(toolAnswers.tools)) return BACK;
        return (toolAnswers.tools ?? []) as Tool[];
      },
    },
    {
      id: "cliTools",
      async run(_state, previous): Promise<StepResult<CliToolId[]>> {
        const existingCliTools = previous ?? manifest.cliTools?.selected ?? [];
        return await pickCliTools({
          existing: existingCliTools,
          wslTheme,
        });
      },
    },
    {
      id: "features",
      async run(_state, previous): Promise<StepResult<(keyof Features)[]>> {
        const currentFeatureKeys =
          previous ??
          (Object.keys(DEFAULT_FEATURES) as (keyof Features)[]).filter((k) => manifest.features[k]);
        const featureAnswers = await inquirer.prompt<{ features: (keyof Features)[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "features",
            message: "Select features:",
            choices: FEATURE_CHOICES,
            default: currentFeatureKeys,
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        if (isBack(featureAnswers.features)) return BACK;
        return (featureAnswers.features ?? []) as (keyof Features)[];
      },
    },
    {
      id: "mcpGate",
      skip: (s) => !(s.features?.includes("mcp")),
      async run(): Promise<StepResult<boolean>> {
        // Re-running config with no prior MCP servers defaults to No;
        // re-running with existing servers defaults to Yes so users
        // don't accidentally wipe their MCP setup by accepting the
        // default (plan §4.4 / `confirmMcpGate` semantics).
        const hasExistingMcp = manifest.mcp.servers.length > 0;
        return await confirmMcpGate({ hasExisting: hasExistingMcp });
      },
    },
    {
      id: "mcpServers",
      skip: (s) => !(s.features?.includes("mcp")) || !s.mcpGate,
      async run(state): Promise<StepResult<string[]>> {
        return await pickMcpServers({
          platform: state.platform!,
          existing: manifest.mcp.servers,
          wslTheme,
        });
      },
    },
    {
      id: "worktreeEnabled",
      skip: (s) => !(s.tools?.some((t) => WORKTREE_CAPABLE_TOOLS.has(t))),
      async run(_state, previous): Promise<StepResult<boolean>> {
        const wtAnswer = await inquirer.prompt<{ enabled: boolean | typeof BACK }>([{
          type: "confirm",
          name: "enabled",
          message: "Enable worktree file isolation (for parallel agent sessions)?",
          default: previous ?? manifest.worktree?.enabled ?? true,
        }]);
        if (isBack(wtAnswer.enabled)) return BACK;
        return wtAnswer.enabled as boolean;
      },
    },
    {
      id: "preset",
      skip: () => !manifest.content,
      async run(_state, previous): Promise<StepResult<PresetId>> {
        const presetAnswer = await inquirer.prompt<{ preset: PresetId | typeof BACK }>([
          {
            type: "select",
            name: "preset",
            message: "Select content profile:",
            choices: PRESETS.map((p) => {
              const excluded = countPresetExclusions(p, contentIndex);
              const estimated = p.id !== "custom"
                ? estimatePresetItemCount(
                    p,
                    contentProjectType!,
                    contentTeamSize!,
                    contentIndex,
                    undefined,
                    { skipContextFilters: true },
                  )
                : 0;
              const countHint = estimated > 0 ? ` (~${estimated} items)` : "";
              const suffix = excluded > 0 ? ` (excludes ${excluded} of ${totalItems})` : "";
              // F10.6-1 (D10): surface the omitted capability clusters by name
              // (not just a count) so reconfiguring a preset is an informed choice.
              // Optional-chain `omits` so a preset lacking the field (or a test
              // mock that omits it) renders no omit line instead of throwing.
              const omitLine = p.omits?.length ? `omits: ${p.omits.join(", ")}` : undefined;
              return {
                name: `${p.name} — ${p.description}${countHint}${suffix}`,
                value: p.id,
                description: omitLine,
              };
            }),
            default: previous ?? (manifest.content!.preset as PresetId),
          },
        ]);
        return isBack(presetAnswer.preset) ? BACK : (presetAnswer.preset as PresetId);
      },
    },
    {
      id: "customItems",
      skip: (s) => !manifest.content || s.preset !== "custom",
      async run(_state, previous): Promise<StepResult<string[] | undefined>> {
        const currentIds = getAllContentIds(manifest.content!);
        const groupedChoices = buildTagGroupedCustomContentChoices(
          contentIndex.items,
          (item: { id: string }) => (previous ? previous.includes(item.id) : currentIds.has(item.id)),
        );
        const customAnswer = await inquirer.prompt<{ items: string[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "items",
            message: "Select content items:",
            choices: groupedChoices,
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        if (isBack(customAnswer.items)) return BACK;
        return (customAnswer.items ?? []) as string[];
      },
    },
  ];

  const stepState = await runStepMachine<ConfigState>(steps);

  const platform = stepState.platform;
  const { owner, repo, namespace, project } = stepState.identity;
  const defaultBranch = stepState.defaultBranch;
  const tools = stepState.tools;

  if (tools.length === 0) {
    logError("At least one tool must be selected.");
    throw new HatchError(
      "At least one tool must be selected.",
      undefined,
      "VALIDATION_ERROR",
      "Re-run `hatch3r config` and select at least one tool (claude, cursor, or copilot).",
    );
  }

  // --- CLI tools (plan §4.4) ---
  const selectedCliTools = stepState.cliTools;
  if (selectedCliTools.length > 0) {
    const cliSpinner = createSpinner(`Detecting ${selectedCliTools.length} CLI tool(s)...`);
    cliSpinner.start();
    const missing = await findMissingCliTools(selectedCliTools);
    if (missing.length === 0) {
      cliSpinner.succeed(`All ${selectedCliTools.length} CLI tool(s) detected on PATH`);
    } else {
      cliSpinner.warn(`${selectedCliTools.length - missing.length}/${selectedCliTools.length} CLI tool(s) detected; ${missing.length} missing`);
      await offerInstaller(missing, { interactive: true });
    }
  }
  const cliToolsConfig: CliToolsConfig = {
    enabled: selectedCliTools.length > 0,
    selected: selectedCliTools,
  };

  // --- Features ---
  const selectedFeatures = stepState.features;
  const features: Features = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(features) as (keyof Features)[]) {
    features[k] = selectedFeatures.includes(k);
  }

  // --- MCP servers ---
  // When the mcp feature is on but the user declined the gate, preserve
  // the pre-existing list (plan §4.4); when the feature is off entirely,
  // keep the existing servers untouched so toggling the feature back on
  // restores the prior setup.
  const hasExistingMcp = manifest.mcp.servers.length > 0;
  let mcpServers: string[];
  if (features.mcp) {
    if (stepState.mcpGate && stepState.mcpServers !== undefined) {
      mcpServers = stepState.mcpServers;
    } else {
      mcpServers = hasExistingMcp ? [...manifest.mcp.servers] : [];
    }
  } else {
    mcpServers = hasExistingMcp ? [...manifest.mcp.servers] : [];
  }

  // --- Worktree isolation ---
  if (stepState.worktreeEnabled !== undefined) {
    manifest.worktree = {
      ...manifest.worktree,
      enabled: stepState.worktreeEnabled,
    };
  }

  // --- Content management ---
  const contentChanges: { added: Array<{ type: string; id: string }>; removed: Array<{ type: string; id: string }> } = { added: [], removed: [] };
  let contentMetadataChanged = false;
  if (manifest.content) {
    // The step-machine prelude initialised these inside the same
    // `manifest.content` guard — narrow here so TypeScript sees them as
    // defined for the trailing references.
    const contentRootLocal: string = contentRoot!;
    const agentsDirLocal: string = agentsDir!;
    const previousContent = manifest.content;
    const { projectType, teamSize } = manifest.content;
    const index = contentIndex;
    const selectedPreset = getPreset(stepState.preset);
    const customSelections = stepState.customItems;

    // --- Resolve new selection and diff against current ---
    const newSelection = resolveSelection(selectedPreset, projectType, teamSize, index, customSelections, undefined, { skipContextFilters: true });
    const oldIds = getAllContentIds(manifest.content);
    const newIds = getAllContentIds(newSelection);

    // Identify removed items and warn about dependents (D19-6)
    const pendingRemovals: string[] = [];
    for (const id of oldIds) {
      if (!newIds.has(id)) pendingRemovals.push(id);
    }

    if (pendingRemovals.length > 0) {
      // F10.4-10 (Cycle 10): the body-reference dependency scan reads each KEPT
      // item's source to check whether it free-references a REMOVED id. It
      // previously read from `agentsDirLocal` (the legacy `.agents/` tree), which
      // 1.9+ installs no longer materialize — so on every modern install the read
      // ENOENT'd and the scan silently no-op'd (a verbose-only line per file). Read
      // from the bundled content root instead (same canonical layout the content
      // index is built against: `<type>/<id>` with `/SKILL.md` for skills), so the
      // scan actually inspects bodies. Read failures are now counted and surfaced as
      // ONE warning per config run rather than buried per-file at verbose level.
      const dependencyWarnings: string[] = [];
      // F10.4-10 gate-fix (Cycle 10 Wave 4 R3): the body-reference scan is an
      // ADVISORY best-effort pass — its own warning copy says "may be
      // incomplete". `resolveBundledContentRoot()` THROWS (HatchError "Bundled
      // content not found") when no bundled content is locatable (e.g. a test
      // harness pointing at a fake package root, or any env without the npm
      // package's content shipped). A throw here previously crashed the entire
      // `configCommand`, aborting the content removal + summary. Wrap the root
      // resolution and the body-reference scan in try/catch so resolution
      // failure degrades to ONE advisory warning and the config command
      // continues. Orchestration dependency validation below does NOT need the
      // content root, so it stays outside this guard.
      try {
        const bundledContentRoot = resolveBundledContentRoot();
        // Track DISTINCT kept items whose body could not be read, so the
        // single end-of-scan warning reports an item count (not an inflated
        // per-(removed×kept) attempt count).
        const unreadableKeepIds = new Set<string>();
        for (const removedId of pendingRemovals) {
          const dependents: string[] = [];
          for (const keepId of newIds) {
            const keepItem = index.byId.get(keepId);
            if (!keepItem) continue;
            try {
              const filePath = keepItem.type === "skill"
                ? join(bundledContentRoot, keepItem.relativePath, "SKILL.md")
                : join(bundledContentRoot, keepItem.relativePath);
              const content = await readFile(filePath, "utf-8");
              const refs = extractContentReferences(content);
              if (refs.includes(removedId)) {
                dependents.push(keepId);
              }
            } catch (err) {
              unreadableKeepIds.add(keepId);
              const message = err instanceof Error ? err.message : String(err);
              verbose(`config: dependency check readFile(${keepId}) skipped — ${message}`);
            }
          }
          if (dependents.length > 0) {
            dependencyWarnings.push(
              `Removing "${removedId}" — referenced by: ${dependents.join(", ")}`,
            );
          }
        }

        if (unreadableKeepIds.size > 0) {
          warn(
            `Dependency scan could not read ${unreadableKeepIds.size} kept item(s) from the bundled content root ` +
            `(${bundledContentRoot}) — body-reference warnings may be incomplete. Re-run after \`npm i -g hatch3r\` ` +
            `or \`npm run build\` if this persists.`,
          );
        }
      } catch (err) {
        // resolveBundledContentRoot() (or a wholesale read failure) — skip the
        // advisory body-reference scan and continue. Content removal proceeds.
        const message = err instanceof Error ? err.message : String(err);
        verbose(`config: dependency scan skipped — ${message}`);
        warn(
          "Dependency scan skipped — bundled content root unavailable; body-reference warnings omitted.",
        );
      }

      const orchWarnings = validateOrchestrationDependencies(newSelection);
      dependencyWarnings.push(...orchWarnings);

      if (dependencyWarnings.length > 0) {
        console.log();
        warn("Dependency warnings for removed content:");
        for (const w of dependencyWarnings) {
          console.log(chalk.dim(`  ${w}`));
        }
        console.log();
      }
    }

    // Apply adds and removes
    for (const id of newIds) {
      if (!oldIds.has(id)) {
        const item = index.byId.get(id);
        if (item) {
          contentChanges.added.push({ type: item.type, id: item.id });
          await addContentItem(contentRootLocal, agentsDirLocal, item);
        }
      }
    }
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const item = index.byId.get(id);
        if (item) {
          contentChanges.removed.push({ type: item.type, id: item.id });
          await removeContentItem(agentsDirLocal, item, { rootDir });
        }
      }
    }

    // Update manifest content wholesale
    manifest.content = newSelection;
    contentMetadataChanged =
      previousContent.preset !== newSelection.preset ||
      previousContent.projectType !== newSelection.projectType ||
      previousContent.teamSize !== newSelection.teamSize;

    // F10.5-1 (Cycle 10): No canonical or root AGENTS.md emission here,
    // aligning with sync.ts:303 + init.ts:509-510 + update.ts:304-306 Wave 3
    // contract. Adapters source canonical content from the bundled package
    // via `resolveBundledContentRoot()`; archive `TOOL_PATH_PREFIXES` has no
    // AGENTS.md entry, so writing one from config left a dangling root
    // `AGENTS.md` after tool switches or `hatch3r clean`. `addContentItem` /
    // `removeContentItem` above already handle per-item materialization.
  }

  // --- Compute diff ---
  // D1-M5: pass content changes (computed by addContentItem/removeContentItem
  // side effects above) directly into computeDiff instead of patching the
  // returned struct afterwards.
  const diff = computeDiff(manifest, tools, features, mcpServers, platform, owner, repo, namespace, project, selectedCliTools, contentChanges);

  if (isDiffEmpty(diff) && defaultBranch === currentBranch && !contentMetadataChanged) {
    console.log();
    info("No changes detected.");
    console.log();
    return;
  }

  // --- Archive removed tool outputs ---
  const allMigrations: MigrationNotice[] = [];
  const allArchivedFiles: string[] = [];
  const totalArchiveSteps = diff.removedTools.length;

  if (totalArchiveSteps > 0) {
    // D10-M14 (Cycle 10): preview the file list `managedFilesByAdapter`
    // records for each tool BEFORE the archive runs. Previously the archive
    // step succeeded silently from the user's perspective ("Archived N files"),
    // so there was no chance to abort if the count was unexpected — a
    // destructive operation hidden behind an OK message. We now print the
    // per-tool file list and ask for explicit confirmation; `--yes` bypasses
    // the prompt for headless / CI flows.
    const previewLines: string[] = [];
    for (const tool of diff.removedTools) {
      const paths = manifest.managedFilesByAdapter?.[tool] ?? [];
      previewLines.push(`  ${chalk.red("-")} ${TOOL_DISPLAY_NAMES[tool] ?? tool}: ${paths.length} file(s) will be archived`);
      if (paths.length > 0 && paths.length <= 12) {
        for (const p of paths) previewLines.push(`      ${chalk.dim(p)}`);
      } else if (paths.length > 12) {
        for (const p of paths.slice(0, 10)) previewLines.push(`      ${chalk.dim(p)}`);
        previewLines.push(`      ${chalk.dim(`… and ${paths.length - 10} more`)}`);
      }
    }
    if (previewLines.length > 0) {
      console.log();
      console.log(chalk.yellow("Tool removal preview:"));
      for (const line of previewLines) console.log(line);
      console.log();
      // `configCommandImpl` runs fully interactively — there is no headless
      // override flag here. The confirm gives the user one chance to abort
      // before the archive step rewrites disk state. Cancelled config exits
      // before manifest mutation, so the prior state is intact.
      const { confirmArchive } = await inquirer.prompt<{ confirmArchive: boolean }>([
        {
          type: "confirm",
          name: "confirmArchive",
          message: "Archive these files? They move to `.hatch3r/archive/<tool>/` and can be recovered.",
          default: true,
        },
      ]);
      if (!confirmArchive) {
        info("Tool removal cancelled. No files changed.");
        return;
      }
    }
    console.log();
    for (let i = 0; i < diff.removedTools.length; i++) {
      const tool = diff.removedTools[i];
      const s = createSpinner(
        step(i + 1, totalArchiveSteps, `Archiving ${TOOL_DISPLAY_NAMES[tool] ?? tool} output...`),
      );
      s.start();

      const result = await archiveToolOutputs(rootDir, tool);
      removeManagedFilesForPaths(manifest, result.archivedFiles);
      allArchivedFiles.push(...result.archivedFiles);
      allMigrations.push(...result.migrations);

      s.succeed(
        step(i + 1, totalArchiveSteps, `Archived ${result.archivedFiles.length} files from ${TOOL_DISPLAY_NAMES[tool] ?? tool}`),
      );
    }
  }

  // --- Apply changes to manifest ---
  manifest.platform = platform;
  manifest.owner = owner;
  manifest.repo = repo;
  manifest.namespace = namespace;
  manifest.project = project;
  manifest.tools = tools;
  manifest.features = features;
  manifest.mcp = { servers: mcpServers };
  manifest.cliTools = cliToolsConfig;

  if (manifest.board) {
    manifest.board.owner = owner;
    manifest.board.repo = repo;
    manifest.board.defaultBranch = defaultBranch;
  } else if (defaultBranch !== "main" || owner || repo) {
    manifest.board = {
      owner,
      repo,
      defaultBranch,
      projectNumber: null,
      statusFieldId: null,
      statusOptions: { backlog: null, ready: null, inProgress: null, inReview: null, done: null },
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

  await writeManifest(rootDir, manifest);

  const hasWorktreeCapableTool = tools.some((t) => WORKTREE_CAPABLE_TOOLS.has(t));
  const worktreeActive = Boolean(manifest.worktree?.enabled) && hasWorktreeCapableTool;
  if (worktreeActive) {
    const wtContent = await generateWorktreeInclude(manifest, rootDir);
    const wtManaged = extractManagedContent(wtContent);
    await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
      managedContent: wtManaged,
    });
  } else {
    // D10-SA10.5-F6: `.worktreeinclude` is emitted only while worktree isolation
    // is active (a worktree-capable tool selected AND `worktree.enabled`). When a
    // config run flips that off — worktree disabled, or (future tools) the last
    // worktree-capable tool removed — the file has zero remaining consumers but
    // was never swept: config archives per-tool outputs via `TOOL_PATH_PREFIXES`,
    // which has no entry for this shared, adapter-neutral file. `hatch3r clean`
    // reclaims it, but reconfigure-via-config left it dangling. Remove the stale
    // file here, symmetric with the regeneration path. We only reach this block
    // after a real config change (the `isDiffEmpty` early-return guards no-ops).
    // Probe existence first so the confirmation line prints only when a managed
    // `.worktreeinclude` was actually reclaimed.
    const wtPath = join(rootDir, WORKTREE_INCLUDE_FILE);
    const wtPresent = await access(wtPath).then(() => true).catch(() => false);
    if (wtPresent) {
      try {
        await rm(wtPath, { force: true });
        info(`Removed ${WORKTREE_INCLUDE_FILE} — worktree isolation is no longer active.`);
      } catch (err) {
        verbose(`config: .worktreeinclude cleanup skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // --- Regenerate from currently-installed package (no network fetch) ---
  // C7-H9 (D1): Config changes only need to copy canonical content and
  // re-run adapters — not fetch a newer package. Using `runRegenerate`
  // skips the 30s npm update step that offered no value here.
  // Decision 27 (Bucket 2.2): pass `snapshotCommandName: "config"` so the
  // pre-mutation snapshot captured inside `runRegenerate` is namespaced
  // `config-...` rather than `update-...`.
  console.log();
  const updateResult = await runRegenerate(rootDir, manifest, { snapshotCommandName: "config" });

  // --- Handle .env.mcp for new MCP servers ---
  if (features.mcp && mcpServers.length > 0) {
    try {
      const envResult = await ensureEnvMcp(rootDir, mcpServers);
      await ensureGitignoreEntry(rootDir);
      if (envResult.newVars.length > 0) {
        warn(`New secrets needed in .env.mcp: ${envResult.newVars.join(", ")}`);
        info(`Run this, then start or restart your editor: ${getSourceEnvMcpCommand()}`);
      }
    } catch (err) {
      warn(`Could not update .env.mcp: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Print summary ---
  console.log();
  const summaryLines: string[] = [];

  if (diff.addedTools.length > 0) {
    summaryLines.push(`${chalk.green("+")} Tools added: ${diff.addedTools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")}`);
  }
  if (diff.removedTools.length > 0) {
    summaryLines.push(`${chalk.red("-")} Tools removed: ${diff.removedTools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")}`);
  }
  if (diff.addedMcp.length > 0) {
    summaryLines.push(`${chalk.green("+")} MCP added: ${diff.addedMcp.join(", ")}`);
  }
  if (diff.removedMcp.length > 0) {
    summaryLines.push(`${chalk.red("-")} MCP removed: ${diff.removedMcp.join(", ")}`);
  }
  if (diff.enabledFeatures.length > 0) {
    summaryLines.push(`${chalk.green("+")} Features enabled: ${diff.enabledFeatures.join(", ")}`);
  }
  if (diff.disabledFeatures.length > 0) {
    summaryLines.push(`${chalk.red("-")} Features disabled: ${diff.disabledFeatures.join(", ")}`);
  }
  if (diff.platformChanged) {
    summaryLines.push(`${chalk.yellow("~")} Platform: ${PLATFORM_DISPLAY_NAMES[platform]}`);
  }
  if (diff.repoChanged) {
    summaryLines.push(`${chalk.yellow("~")} Repo: ${namespace}/${project}`);
  }
  if (diff.addedContent.length > 0) {
    summaryLines.push(`${chalk.green("+")} Content added: ${diff.addedContent.length} item(s)`);
  }
  if (diff.removedContent.length > 0) {
    summaryLines.push(`${chalk.red("-")} Content removed: ${diff.removedContent.length} item(s)`);
  }
  if (diff.addedCliTools.length > 0) {
    summaryLines.push(`${chalk.green("+")} CLI tools added: ${diff.addedCliTools.join(", ")}`);
  }
  if (diff.removedCliTools.length > 0) {
    summaryLines.push(`${chalk.red("-")} CLI tools removed: ${diff.removedCliTools.join(", ")}`);
  }
  if (defaultBranch !== currentBranch) {
    summaryLines.push(`${chalk.yellow("~")} Default branch: ${defaultBranch}`);
  }

  summaryLines.push("");
  summaryLines.push(label("Files", `${updateResult.copiedFiles} canonical files updated`));
  summaryLines.push(label("Tools", `${updateResult.syncedTools} tool(s) synced`));
  summaryLines.push(label("Version", `v${updateResult.version}`));
  if (updateResult.snapshotSessionId) {
    summaryLines.push(
      label(
        "Snapshot",
        `${updateResult.snapshotSessionId} (revert: hatch3r rollback --session=${updateResult.snapshotSessionId})`,
      ),
    );
  }

  if (allArchivedFiles.length > 0) {
    summaryLines.push("");
    summaryLines.push(label("Archived", `${allArchivedFiles.length} files to .hatch3r-archive/`));
  }

  printBox("Config updated", summaryLines, "success");

  if (allMigrations.length > 0) {
    console.log();
    info("Customizations migrated to .hatch3r/ (tool-agnostic):");
    for (const m of allMigrations) {
      console.log(`  ${chalk.dim(m.from)} ${chalk.cyan("→")} ${m.to}`);
    }
    console.log();
  }

  // #146 (D19-17): Show migration guide when switching tools
  if (diff.addedTools.length > 0 || diff.removedTools.length > 0) {
    console.log();
    info("Tool migration notes:");
    if (diff.removedTools.length > 0) {
      info(chalk.dim(`  Removed tool output archived to .hatch3r-archive/ (recoverable).`));
      info(chalk.dim(`  Customizations in .hatch3r/ are tool-agnostic and carry forward.`));
      // D10-SA10.5-F4 (Cycle 10 Wave 4): point users at the "Switching tools"
      // guide so they know what carries forward, what is rebuilt, and that
      // learnings replay via .hatch3r/learnings/INDEX.md on the new tool.
      info(chalk.dim(`  See the "Switching tools" section of the Customization guide for what carries forward and how learnings replay.`));
      // D10-SA10.5-F5 (Cycle 10 Wave 4): MCP servers are a flat list shared
      // across tools (not per-tool scoped). Removing a tool does not prune them,
      // so a server selected only for the removed tool stays enabled for the
      // remaining tools. Remind the user they can deselect any now-unused server.
      // Informational only — no behavior change.
      if (manifest.mcp.servers.length > 0) {
        info(chalk.dim(`  Selected MCP servers (${manifest.mcp.servers.join(", ")}) remain enabled for your remaining tools — run \`hatch3r config\` to deselect any you no longer need.`));
      }
    }
    if (diff.addedTools.length > 0) {
      info(chalk.dim(`  New tool output generated. Restart your editor to pick up changes.`));
      info(chalk.dim(`  MCP secrets (.env.mcp) are shared across tools — no re-entry needed.`));
    }
    console.log();
  }

  // ── Workspace management ──────────────────────────────────────
  // Re-read workspace manifest in case it wasn't loaded earlier (e.g. standalone with workspace.json)
  const wsManifestFinal = wsManifest ?? await readWorkspaceManifest(rootDir);
  if (wsManifestFinal) {
    // Save workspace defaults when running at workspace root
    if (wsContext.type === "workspace-root") {
      wsManifestFinal.defaults.tools = tools;
      wsManifestFinal.defaults.features = features;
      wsManifestFinal.defaults.mcp = { servers: mcpServers };
      wsManifestFinal.defaults.cliTools = cliToolsConfig;
      if (manifest.content) {
        wsManifestFinal.defaults.content = manifest.content;
      }
      if (platform) {
        wsManifestFinal.defaults.platform = platform;
      }
    }

    console.log();
    info(chalk.bold("Workspace configuration"));
    const currentRepos = wsManifestFinal.repos.map((r) => r.path);
    console.log(chalk.dim(`  Repos: ${currentRepos.join(", ") || "(none)"}`));
    console.log(chalk.dim(`  Sync strategy: ${wsManifestFinal.syncStrategy}`));

    // Workspace block: defensive Shift+Tab guards. The workspace flow is
    // outside the step machine for now (its prompts depend on workspace
    // state computed during the main config flow), so a stray Shift+Tab
    // is not a back-nav request here — it just cancels gracefully so the
    // BACK sentinel never reaches a downstream string consumer.
    const manageWorkspaceAnswer = await inquirer.prompt<{ manageWorkspace: boolean | typeof BACK }>([
      {
        type: "confirm",
        name: "manageWorkspace",
        message: "Configure workspace settings?",
        default: wsContext.type === "workspace-root",
      },
    ]);
    if (isBack(manageWorkspaceAnswer.manageWorkspace)) {
      info("Config cancelled (Shift+Tab).");
      return;
    }
    const manageWorkspace = manageWorkspaceAnswer.manageWorkspace as boolean;

    if (manageWorkspace) {
      // Scan for new repos
      const detectedRepos = await detectSubRepos(rootDir);
      const existingPaths = new Set(wsManifestFinal.repos.map((r) => r.path));
      const newRepos = detectedRepos.filter((r) => !existingPaths.has(r.path));

      if (newRepos.length > 0) {
        const addReposAnswer = await inquirer.prompt<{ addRepos: string[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "addRepos",
            message: "New repos detected. Add to workspace?",
            choices: newRepos.map((r) => ({
              name: r.name,
              value: r.path,
              checked: false,
            })),
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        if (isBack(addReposAnswer.addRepos)) {
          info("Config cancelled (Shift+Tab).");
          return;
        }
        const addRepos = (addReposAnswer.addRepos ?? []) as string[];
        for (const path of addRepos) {
          wsManifestFinal.repos.push({ path, name: path, sync: false });
        }
      }

      // Toggle sync per repo
      if (wsManifestFinal.repos.length > 0) {
        const syncReposAnswer = await inquirer.prompt<{ syncRepos: string[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "syncRepos",
            message: "Select repos to sync:",
            choices: wsManifestFinal.repos.map((r) => ({
              name: r.name ?? r.path,
              value: r.path,
              checked: r.sync,
            })),
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        if (isBack(syncReposAnswer.syncRepos)) {
          info("Config cancelled (Shift+Tab).");
          return;
        }
        const syncRepos = (syncReposAnswer.syncRepos ?? []) as string[];
        const syncSet = new Set(syncRepos);
        for (const repo of wsManifestFinal.repos) {
          repo.sync = syncSet.has(repo.path);
        }
      }

      // Per-repo git identity
      if (wsManifestFinal.repos.length > 0) {
        const editIdentityAnswer = await inquirer.prompt<{ editIdentity: string | typeof BACK }>([
          {
            type: "select",
            name: "editIdentity",
            message: "Repo git identities:",
            choices: [
              { name: "Keep current", value: "keep" },
              { name: "Re-detect all from git remotes", value: "detect" },
              { name: "Edit manually", value: "edit" },
            ],
            default: "keep",
          },
        ]);
        if (isBack(editIdentityAnswer.editIdentity)) {
          info("Config cancelled (Shift+Tab).");
          return;
        }
        const editIdentity = editIdentityAnswer.editIdentity as string;

        if (editIdentity === "detect") {
          for (const repo of wsManifestFinal.repos) {
            const identity = detectRepoGitIdentity(join(rootDir, repo.path));
            repo.owner = identity.owner || undefined;
            repo.repo = identity.repo || undefined;
            repo.defaultBranch = identity.defaultBranch || undefined;
            repo.platform = identity.platform || undefined;
          }
          info("Re-detected git identities for all repos.");
        } else if (editIdentity === "edit") {
          for (const repo of wsManifestFinal.repos) {
            console.log(chalk.bold(`\n  ${repo.name ?? repo.path}:`));
            const identity = await inquirer.prompt<{ owner: string | typeof BACK; repo: string | typeof BACK; defaultBranch: string | typeof BACK }>([
              { type: "input", name: "owner", message: "  Owner:", default: repo.owner || undefined },
              { type: "input", name: "repo", message: "  Repo:", default: repo.repo || undefined },
              {
                type: "input",
                name: "defaultBranch",
                message: "  Default branch:",
                default: repo.defaultBranch || "main",
                // C8-D1-M9: enforce `git check-ref-format` on per-repo
                // identity prompts in workspace config.
                validate: (v: string) => {
                  const trimmed = v.trim();
                  if (trimmed === "") return true;
                  return (
                    isValidGitBranchName(trimmed) ||
                    `Invalid git branch name: "${trimmed}". See git-check-ref-format(1).`
                  );
                },
              },
            ]);
            if (isBack(identity.owner) || isBack(identity.repo) || isBack(identity.defaultBranch)) {
              info("Config cancelled (Shift+Tab).");
              return;
            }
            repo.owner = sanitizeInput(identity.owner as string) || undefined;
            repo.repo = sanitizeInput(identity.repo as string) || undefined;
            repo.defaultBranch = (identity.defaultBranch as string).trim() || undefined;
          }
        }
      }

      // Sync strategy
      const strategyAnswer = await inquirer.prompt<{ strategy: "manual" | "on-sync" | typeof BACK }>([
        {
          type: "select",
          name: "strategy",
          message: "Sync strategy:",
          choices: [
            { name: "Manual — sync sub-repos only with --repos flag", value: "manual" as const },
            { name: "On sync — auto-sync sub-repos when running hatch3r sync", value: "on-sync" as const },
          ],
          default: wsManifestFinal.syncStrategy,
        },
      ]);
      if (isBack(strategyAnswer.strategy)) {
        info("Config cancelled (Shift+Tab).");
        return;
      }
      const strategy = strategyAnswer.strategy as "manual" | "on-sync";
      wsManifestFinal.syncStrategy = strategy;

      // C8-D1-M7 (D1 Medium): Atomicity — sync BEFORE persisting the workspace
      // manifest so the manifest reflects the last successful state. If sync
      // fails, surface the partial outcome to the user before the persist so
      // they know the on-disk manifest may reference un-synced state.
      //
      // Ordering rationale:
      //   1. Prompt for sync-now (user intent)
      //   2. Attempt sync against the new in-memory config
      //   3. Persist the manifest after sync resolves (success / declined /
      //      zero-repos / error — we persist in every case so the user does
      //      not silently lose their repo/sync selections, but we warn on
      //      error so they know to reconcile with `hatch3r sync`).
      //
      // See: https://en.wikipedia.org/wiki/ACID — atomicity at the command
      // boundary. Either both (manifest + propagation) commit, or the user
      // is told which half failed.
      const syncCount = wsManifestFinal.repos.filter((r) => r.sync).length;
      let syncAttempted = false;
      let syncFailed = false;
      if (syncCount > 0) {
        const syncNowAnswer = await inquirer.prompt<{ syncNow: boolean | typeof BACK }>([
          {
            type: "confirm",
            name: "syncNow",
            message: `Sync ${syncCount} repo(s) now?`,
            default: false,
          },
        ]);
        if (isBack(syncNowAnswer.syncNow)) {
          info("Config cancelled (Shift+Tab).");
          return;
        }
        const syncNow = syncNowAnswer.syncNow as boolean;
        if (syncNow) {
          syncAttempted = true;
          const wsSpinner = createSpinner(`Syncing ${syncCount} repo(s)...`);
          wsSpinner.start();
          try {
            const result = await syncWorkspaceRepos(rootDir, { onWarn: (msg) => warn(msg) });
            const succeeded = result.repos.filter((r) => r.action === "synced").length;
            const errored = result.repos.filter((r) => r.action === "error").length;
            if (errored > 0) {
              syncFailed = true;
              wsSpinner.fail(
                `Workspace sync: ${succeeded}/${result.repos.length} repo(s) synced ` +
                `(${errored} failed — manifest will still be persisted so retry is possible)`,
              );
            } else {
              wsSpinner.succeed(`Workspace sync: ${succeeded} repo(s) synced`);
            }
          } catch (err) {
            syncFailed = true;
            wsSpinner.fail(
              `Workspace sync failed: ${err instanceof Error ? err.message : String(err)} ` +
              `(manifest will still be persisted so retry is possible)`,
            );
          }
        }
      }

      // Persist the workspace manifest AFTER sync completes (or is declined).
      // We persist even on sync failure so the user does not lose their
      // in-memory repo/sync/strategy selections — but the warning below
      // tells them the on-disk manifest now references un-synced state that
      // should be reconciled by re-running `hatch3r sync`.
      await writeWorkspaceManifest(rootDir, wsManifestFinal);

      if (syncAttempted && syncFailed) {
        warn(
          "Workspace manifest persisted, but one or more sub-repos did not " +
          "sync — re-run `hatch3r sync` to reconcile.",
        );
      }
    } else if (wsContext.type === "workspace-root") {
      // Even without managing repos/sync, save workspace defaults
      await writeWorkspaceManifest(rootDir, wsManifestFinal);
    }
  }

  if (selectedCliTools.length > 0) {
    const finalMissing = await findMissingCliTools(selectedCliTools);
    printMissingCliToolsDisclaimer(finalMissing, selectedCliTools.length);
  }
}
