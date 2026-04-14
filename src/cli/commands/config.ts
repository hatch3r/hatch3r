import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import {
  AGENTS_DIR,
  DEFAULT_FEATURES,
  HatchError,
  WORKTREE_CAPABLE_TOOLS,
  WORKTREE_INCLUDE_FILE,
  type ContentSelection,
  type Features,
  type HatchManifest,
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
} from "../shared/ui.js";
import { runUpdate } from "./update.js";
import { archiveToolOutputs, removeManagedFilesForPaths, type MigrationNotice } from "../../archive/index.js";
import { findPackageRoot } from "../shared/paths.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { detectSubRepos, detectWorkspaceContext } from "../../workspace/detect.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { detectRepoGitIdentity } from "../../workspace/git.js";
import { TOOL_DISPLAY_NAMES, TOOL_PROMPT_CHOICES, FEATURE_CHOICES, MCP_CHOICES, PLATFORM_DISPLAY_NAMES, PLATFORM_MCP_SERVER, sanitizeInput, isWSL } from "../shared/constants.js";
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
): ConfigDiff {
  const oldToolSet = new Set(oldManifest.tools);
  const newToolSet = new Set(newTools);
  const oldMcpSet = new Set(oldManifest.mcp.servers);
  const newMcpSet = new Set(newMcp);

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
    diff.removedContent.length === 0
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
    label("MCP", manifest.mcp.servers.length > 0 ? manifest.mcp.servers.join(", ") : "none"),
  ];

  if (manifest.content) {
    const total = countSelectionItems(manifest.content);
    lines.push(label("Content", `${total} items (${selectionSummary(manifest.content)})`));
  }

  printBox("Current configuration", lines, "info");
}

export async function configCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }

  // Detect workspace context early to drive UI flow
  const wsContext = await detectWorkspaceContext(rootDir);

  if (wsContext.type === "workspace-member") {
    warn(
      `This repo is managed by workspace at ${wsContext.workspaceRoot}. ` +
      `Changes here may be overwritten on next workspace sync.`,
    );
    console.log();
    const { action } = await inquirer.prompt<{ action: string }>([
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

  // --- Platform ---
  const platformAnswer = await inquirer.prompt<{ platform: Platform }>([
    {
      type: "select",
      name: "platform",
      message: "Platform:",
      choices: [
        { name: "GitHub", value: "github" as Platform },
        { name: "Azure DevOps", value: "azure-devops" as Platform },
        { name: "GitLab", value: "gitlab" as Platform },
      ],
      default: manifest.platform ?? "github",
    },
  ]);
  const platform = platformAnswer.platform;

  // --- Repo identity ---
  let owner: string;
  let repo: string;
  let namespace: string;
  let project: string;

  if (platform === "azure-devops") {
    const adoAnswers = await inquirer.prompt<{ org: string; project: string; repo: string }>([
      { type: "input", name: "org", message: "Azure DevOps organization:", default: manifest.owner || undefined },
      { type: "input", name: "project", message: "Azure DevOps project:", default: manifest.project || undefined },
      { type: "input", name: "repo", message: "Repository name:", default: manifest.repo || undefined },
    ]);
    owner = sanitizeInput(adoAnswers.org);
    repo = sanitizeInput(adoAnswers.repo);
    namespace = owner;
    project = sanitizeInput(adoAnswers.project);
  } else if (platform === "gitlab") {
    const glAnswers = await inquirer.prompt<{ namespace: string; project: string }>([
      { type: "input", name: "namespace", message: "GitLab namespace (group or username):", default: manifest.namespace || manifest.owner || undefined },
      { type: "input", name: "project", message: "Project name:", default: manifest.project || manifest.repo || undefined },
    ]);
    owner = sanitizeInput(glAnswers.namespace);
    repo = sanitizeInput(glAnswers.project);
    namespace = owner;
    project = repo;
  } else {
    const repoAnswers = await inquirer.prompt<{ owner: string; repo: string }>([
      { type: "input", name: "owner", message: "GitHub owner (org or username):", default: manifest.owner || undefined },
      { type: "input", name: "repo", message: "Repository name:", default: manifest.repo || undefined },
    ]);
    owner = sanitizeInput(repoAnswers.owner);
    repo = sanitizeInput(repoAnswers.repo);
    namespace = owner;
    project = repo;
  }

  // --- Default branch ---
  const currentBranch = manifest.board?.defaultBranch ?? "main";
  const branchAnswer = await inquirer.prompt<{ defaultBranch: string }>([
    {
      type: "input",
      name: "defaultBranch",
      message: "Default branch (for checkout, PR base, release):",
      default: currentBranch,
    },
  ]);
  const defaultBranch = branchAnswer.defaultBranch.trim() || currentBranch;

  // --- Tools ---
  const toolAnswers = await inquirer.prompt<{ tools: Tool[] }>([
    {
      type: "checkbox",
      name: "tools",
      message: "Select tools to configure:",
      choices: TOOL_PROMPT_CHOICES,
      default: manifest.tools,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const tools = toolAnswers.tools;

  if (tools.length === 0) {
    logError("At least one tool must be selected.");
    throw new HatchError("At least one tool must be selected.", 1, "VALIDATION_ERROR");
  }

  // --- Features ---
  const currentFeatureKeys = (Object.keys(DEFAULT_FEATURES) as (keyof Features)[])
    .filter((k) => manifest.features[k]);

  const featureAnswers = await inquirer.prompt<{ features: (keyof Features)[] }>([
    {
      type: "checkbox",
      name: "features",
      message: "Select features:",
      choices: FEATURE_CHOICES,
      default: currentFeatureKeys,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const selectedFeatures = featureAnswers.features;
  const features: Features = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(features) as (keyof Features)[]) {
    features[k] = selectedFeatures.includes(k);
  }

  // --- MCP servers ---
  let mcpServers: string[] = [];
  if (features.mcp) {
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    const mcpAnswers = await inquirer.prompt<{ mcp: string[] }>([
      {
        type: "checkbox",
        name: "mcp",
        message: "Select MCP servers:",
        choices: MCP_CHOICES,
        default: manifest.mcp.servers,
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    mcpServers = mcpAnswers.mcp ?? [];
    if (!mcpServers.includes(platformMcp)) {
      mcpServers.unshift(platformMcp);
    }
  }

  // --- Worktree isolation ---
  const hasWorktreeTool = tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
  if (hasWorktreeTool) {
    const wtAnswer = await inquirer.prompt<{ enabled: boolean }>([{
      type: "confirm",
      name: "enabled",
      message: "Enable worktree file isolation (for parallel agent sessions)?",
      default: manifest.worktree?.enabled ?? true,
    }]);
    manifest.worktree = {
      ...manifest.worktree,
      enabled: wtAnswer.enabled,
    };
  }

  // --- Content management ---
  const contentChanges: { added: Array<{ type: string; id: string }>; removed: Array<{ type: string; id: string }> } = { added: [], removed: [] };
  if (manifest.content) {
    // #145 (D19-16): Explain config vs .customize.yaml distinction
    info(
      chalk.dim("Config adds/removes content items. To customize an item's behavior without ") +
      chalk.dim("removing it, use .hatch3r/<type>/<id>.customize.yaml instead."),
    );
    console.log();

    const contentRoot = findPackageRoot(__dirname);
    const agentsDir = join(rootDir, AGENTS_DIR);
    const index = await buildContentIndex(contentRoot);
    const { projectType, teamSize } = manifest.content;

    // --- Content preset selection (mirrors init flow) ---
    const totalItems = index.items.length;
    const presetAnswer = await inquirer.prompt<{ preset: PresetId }>([
      {
        type: "select",
        name: "preset",
        message: "Select content profile:",
        choices: PRESETS.map((p) => {
          const excluded = countPresetExclusions(p, index);
          const estimated = p.id !== "custom" ? estimatePresetItemCount(p, projectType, teamSize, index) : 0;
          const countHint = estimated > 0 ? ` (~${estimated} items)` : "";
          const suffix = excluded > 0 ? ` (excludes ${excluded} of ${totalItems})` : "";
          return {
            name: `${p.name} — ${p.description}${countHint}${suffix}`,
            value: p.id,
          };
        }),
        default: manifest.content.preset as PresetId,
      },
    ]);
    const selectedPreset = getPreset(presetAnswer.preset);

    // --- Custom content selection (tag-grouped, mirrors init flow) ---
    let customSelections: string[] | undefined;
    if (selectedPreset.id === "custom") {
      const currentIds = getAllContentIds(manifest.content);
      const tagGroups = new Map<string, typeof index.items>();
      for (const item of index.items) {
        const primaryTag = item.tags[0] ?? "other";
        if (!tagGroups.has(primaryTag)) tagGroups.set(primaryTag, []);
        tagGroups.get(primaryTag)!.push(item);
      }

      const TAG_LABELS: Record<string, string> = {
        core: "Core", planning: "Planning", implementation: "Implementation",
        review: "Review", devops: "DevOps", maintenance: "Maintenance",
        greenfield: "Greenfield", brownfield: "Brownfield", board: "Board",
        security: "Security", a11y: "Accessibility", performance: "Performance",
        customize: "Customization", other: "Other",
      };
      const groupedChoices: Array<InstanceType<typeof inquirer.Separator> | { name: string; value: string; checked: boolean }> = [];
      for (const [tag, items] of tagGroups) {
        groupedChoices.push(new inquirer.Separator(`── ${TAG_LABELS[tag] ?? tag} (${items.length}) ──`));
        for (const item of items) {
          groupedChoices.push({
            name: `${item.type}: ${item.id.replace(/^(cmd-)?hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
            value: item.id,
            checked: currentIds.has(item.id),
          });
        }
      }

      const customAnswer = await inquirer.prompt<{ items: string[] }>([
        {
          type: "checkbox",
          name: "items",
          message: "Select content items:",
          choices: groupedChoices,
          ...(wslTheme && { theme: wslTheme }),
        },
      ]);
      customSelections = customAnswer.items;
    }

    // --- Resolve new selection and diff against current ---
    const newSelection = resolveSelection(selectedPreset, projectType, teamSize, index, customSelections);
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
              ? join(agentsDir, keepItem.relativePath, "SKILL.md")
              : join(agentsDir, keepItem.relativePath);
            const content = await readFile(filePath, "utf-8");
            const refs = extractContentReferences(content);
            if (refs.includes(removedId)) {
              dependents.push(keepId);
            }
          } catch {
            // File not readable, skip
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
          await addContentItem(contentRoot, agentsDir, item);
        }
      }
    }
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const item = index.byId.get(id);
        if (item) {
          contentChanges.removed.push({ type: item.type, id: item.id });
          await removeContentItem(agentsDir, item, { rootDir });
        }
      }
    }

    // Update manifest content wholesale
    manifest.content = newSelection;

    // Regenerate canonical and root AGENTS.md after content changes
    if (contentChanges.added.length > 0 || contentChanges.removed.length > 0) {
      const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
      await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd);
      const rootAgentsMd = await generateRootAgentsMd(agentsDir);
      await safeWriteFile(join(rootDir, "AGENTS.md"), rootAgentsMd.full, {
        managedContent: rootAgentsMd.inner,
      });
    }
  }

  // --- Compute diff ---
  const diff = computeDiff(manifest, tools, features, mcpServers, platform, owner, repo, namespace, project);
  diff.addedContent = contentChanges.added;
  diff.removedContent = contentChanges.removed;

  if (isDiffEmpty(diff) && defaultBranch === currentBranch) {
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

  // --- Run full update (pull latest + copy templates + sync adapters) ---
  console.log();
  const updateResult = await runUpdate(rootDir, manifest);

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
  if (defaultBranch !== currentBranch) {
    summaryLines.push(`${chalk.yellow("~")} Default branch: ${defaultBranch}`);
  }

  summaryLines.push("");
  summaryLines.push(label("Files", `${updateResult.copiedFiles} canonical files updated`));
  summaryLines.push(label("Tools", `${updateResult.syncedTools} tool(s) synced`));
  summaryLines.push(label("Version", `v${updateResult.version}`));

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

    const { manageWorkspace } = await inquirer.prompt<{ manageWorkspace: boolean }>([
      {
        type: "confirm",
        name: "manageWorkspace",
        message: "Configure workspace settings?",
        default: wsContext.type === "workspace-root",
      },
    ]);

    if (manageWorkspace) {
      // Scan for new repos
      const detectedRepos = await detectSubRepos(rootDir);
      const existingPaths = new Set(wsManifestFinal.repos.map((r) => r.path));
      const newRepos = detectedRepos.filter((r) => !existingPaths.has(r.path));

      if (newRepos.length > 0) {
        const { addRepos } = await inquirer.prompt<{ addRepos: string[] }>([
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
        for (const path of addRepos) {
          wsManifestFinal.repos.push({ path, name: path, sync: false });
        }
      }

      // Toggle sync per repo
      if (wsManifestFinal.repos.length > 0) {
        const { syncRepos } = await inquirer.prompt<{ syncRepos: string[] }>([
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
        const syncSet = new Set(syncRepos);
        for (const repo of wsManifestFinal.repos) {
          repo.sync = syncSet.has(repo.path);
        }
      }

      // Per-repo git identity
      if (wsManifestFinal.repos.length > 0) {
        const { editIdentity } = await inquirer.prompt<{ editIdentity: string }>([
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
            const identity = await inquirer.prompt<{ owner: string; repo: string; defaultBranch: string }>([
              { type: "input", name: "owner", message: "  Owner:", default: repo.owner || undefined },
              { type: "input", name: "repo", message: "  Repo:", default: repo.repo || undefined },
              { type: "input", name: "defaultBranch", message: "  Default branch:", default: repo.defaultBranch || "main" },
            ]);
            repo.owner = sanitizeInput(identity.owner) || undefined;
            repo.repo = sanitizeInput(identity.repo) || undefined;
            repo.defaultBranch = identity.defaultBranch.trim() || undefined;
          }
        }
      }

      // Sync strategy
      const { strategy } = await inquirer.prompt<{ strategy: "manual" | "on-sync" }>([
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
      wsManifestFinal.syncStrategy = strategy;

      await writeWorkspaceManifest(rootDir, wsManifestFinal);

      // Offer to sync now
      const syncCount = wsManifestFinal.repos.filter((r) => r.sync).length;
      if (syncCount > 0) {
        const { syncNow } = await inquirer.prompt<{ syncNow: boolean }>([
          {
            type: "confirm",
            name: "syncNow",
            message: `Sync ${syncCount} repo(s) now?`,
            default: false,
          },
        ]);
        if (syncNow) {
          const wsSpinner = createSpinner(`Syncing ${syncCount} repo(s)...`);
          wsSpinner.start();
          const result = await syncWorkspaceRepos(rootDir, { onWarn: (msg) => warn(msg) });
          const succeeded = result.repos.filter((r) => r.action === "synced").length;
          wsSpinner.succeed(`Workspace sync: ${succeeded} repo(s) synced`);
        }
      }
    } else if (wsContext.type === "workspace-root") {
      // Even without managing repos/sync, save workspace defaults
      await writeWorkspaceManifest(rootDir, wsManifestFinal);
    }
  }

}
