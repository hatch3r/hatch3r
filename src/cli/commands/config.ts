import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest, isValidGitBranchName, readMaturityTier } from "../../manifest/hatchJson.js";
import {
  DEFAULT_FEATURES,
  HATCH3R_DIR,
  HatchError,
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
  getAvailableItems,
  addContentItem,
  removeContentItem,
  countSelectionItems,
  selectionSummary,
  extractContentReferences,
  validateOrchestrationDependencies,
  TYPE_TO_SELECTION_KEY,
  resolveSelection,
  countPresetExclusions,
  estimatePresetItemCount,
  getAllContentIds,
} from "../../content/index.js";
import { PRESETS, getPreset, type PresetId } from "../../content/presets.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../shared/agentsContent.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { withSnapshot } from "../../pipeline/snapshot.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";

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
    addedContent: [],
    removedContent: [],
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

function printCurrentConfig(manifest: HatchManifest): void {
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
        1,
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
  throw new HatchError(`Unsupported config key: ${key}`, 1, "VALIDATION_ERROR");
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
  throw new HatchError(`Unsupported config key: ${key}`, 1, "VALIDATION_ERROR");
}

/**
 * Handle the non-interactive `hatch3r config <key>=<value>` and
 * `hatch3r config get|set <key> [<value>]` forms. Returns true when the
 * arguments were a known scalar form (caller short-circuits); false when
 * the call should fall through to the interactive flow.
 *
 * Accepts:
 *   configCommand("maturity=team")        — set form (single arg with `=`)
 *   configCommand("set", "maturity team") — set form (verb + arg)
 *   configCommand("get", "maturity")      — get form (verb + key)
 */
async function handleScalarConfig(
  rootDir: string,
  manifest: HatchManifest,
  arg1?: string,
  arg2?: string,
): Promise<boolean> {
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
        1,
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
        1,
        "VALIDATION_ERROR",
        `Re-run with one of: ${[...SCALAR_CONFIG_KEYS].join(", ")}.`,
      );
    }
    if (!value) {
      throw new HatchError(
        `Missing value for "${key}". Usage: hatch3r config set ${key} <value>`,
        1,
        "VALIDATION_ERROR",
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
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }

  // Scalar key/value dispatch — handles `hatch3r config <key>=<value>`,
  // `hatch3r config set <key> <value>`, and `hatch3r config get <key>`.
  // Returns true when the call was handled; false drops through to the
  // interactive flow below.
  if (await handleScalarConfig(rootDir, manifest, arg1, arg2)) {
    return;
  }

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

  printCurrentConfig(manifest);

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
    // #145 (D19-16): Explain config vs .customize.yaml distinction
    info(
      chalk.dim("Config adds/removes content items. To customize an item's behavior without ") +
      chalk.dim("removing it, use .hatch3r/<type>/<id>.customize.yaml instead."),
    );
    console.log();

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
              return {
                name: `${p.name} — ${p.description}${countHint}${suffix}`,
                value: p.id,
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
    throw new HatchError("At least one tool must be selected.", 1, "VALIDATION_ERROR");
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
      const dependencyWarnings: string[] = [];
      for (const removedId of pendingRemovals) {
        const dependents: string[] = [];
        for (const keepId of newIds) {
          const keepItem = index.byId.get(keepId);
          if (!keepItem) continue;
          try {
            const filePath = keepItem.type === "skill"
              ? join(agentsDirLocal, keepItem.relativePath, "SKILL.md")
              : join(agentsDirLocal, keepItem.relativePath);
            const content = await readFile(filePath, "utf-8");
            const refs = extractContentReferences(content);
            if (refs.includes(removedId)) {
              dependents.push(keepId);
            }
          } catch (err) {
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

    // Regenerate canonical and root AGENTS.md after content changes
    if (contentChanges.added.length > 0 || contentChanges.removed.length > 0) {
      const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDirLocal);
      await safeWriteFile(join(agentsDirLocal, "AGENTS.md"), canonicalAgentsMd);
      const rootAgentsMd = await generateRootAgentsMd(agentsDirLocal);
      await safeWriteFile(join(rootDir, "AGENTS.md"), rootAgentsMd.full, {
        managedContent: rootAgentsMd.inner,
      });
    }
  }

  // --- Compute diff ---
  const diff = computeDiff(manifest, tools, features, mcpServers, platform, owner, repo, namespace, project, selectedCliTools);
  diff.addedContent = contentChanges.added;
  diff.removedContent = contentChanges.removed;

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

  if (manifest.worktree?.enabled) {
    const wtContent = await generateWorktreeInclude(manifest, rootDir);
    const wtManaged = extractManagedContent(wtContent);
    await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
      managedContent: wtManaged,
    });
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
