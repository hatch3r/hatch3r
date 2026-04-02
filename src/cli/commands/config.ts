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
import { detectSubRepos } from "../../workspace/detect.js";
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
} from "../../content/index.js";
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

  // Warn early if this repo is managed by a workspace
  if (manifest.workspace) {
    warn(
      `This repo is managed by workspace at ${manifest.workspace.rootPath}. ` +
      `Changes here may be overwritten on next workspace sync.`,
    );
    console.log();
  }

  printCurrentConfig(manifest);

  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;

  // --- Platform ---
  const platformAnswer = await inquirer.prompt<{ platform: Platform }>([
    {
      type: "list",
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
  const worktreeCapableTools = new Set(["claude"]);
  const hasWorktreeTool = tools.some(t => worktreeCapableTools.has(t));
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
    const manageContent = await inquirer.prompt<{ manage: boolean }>([
      {
        type: "confirm",
        name: "manage",
        message: "Manage content items?",
        default: false,
      },
    ]);

    if (manageContent.manage) {
      // #145 (D19-16): Explain config vs .customize.yaml distinction
      info(
        chalk.dim("Config adds/removes content items. To customize an item's behavior without ") +
        chalk.dim("removing it, use .hatch3r/<type>/<id>.customize.yaml instead."),
      );
      console.log();

      const contentRoot = findPackageRoot(__dirname);
      const agentsDir = join(rootDir, AGENTS_DIR);
      const index = await buildContentIndex(contentRoot);

      // Build current installed set from manifest
      const currentIds = new Set<string>();
      for (const ids of Object.values(manifest.content.items)) {
        for (const id of ids) currentIds.add(id);
      }

      const contentAnswer = await inquirer.prompt<{ items: string[] }>([
        {
          type: "checkbox",
          name: "items",
          message: "Select content items (space to toggle):",
          choices: index.items.map((item) => ({
            name: `${item.type}: ${item.id.replace(/^hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
            value: item.id,
            checked: currentIds.has(item.id),
          })),
          ...(wslTheme && { theme: wslTheme }),
        },
      ]);

      const newIds = new Set(contentAnswer.items);

      // Identify removed items and warn about dependents (D19-6)
      const pendingRemovals: string[] = [];
      for (const id of currentIds) {
        if (!newIds.has(id)) pendingRemovals.push(id);
      }

      if (pendingRemovals.length > 0) {
        const dependencyWarnings: string[] = [];
        for (const removedId of pendingRemovals) {
          const dependents: string[] = [];
          for (const keepId of contentAnswer.items) {
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

        // Check orchestration dependencies with the proposed new selection
        const proposedSelection: ContentSelection = {
          ...manifest.content!,
          items: {
            agents: [], skills: [], rules: [], commands: [],
            prompts: [], hooks: [], githubAgents: [],
          },
        };
        for (const id of contentAnswer.items) {
          const proposedItem = index.byId.get(id);
          if (proposedItem) {
            const key = TYPE_TO_SELECTION_KEY[proposedItem.type];
            if (key) proposedSelection.items[key].push(proposedItem.id);
          }
        }
        const orchWarnings = validateOrchestrationDependencies(proposedSelection);
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

      // Find added and removed items
      for (const id of contentAnswer.items) {
        if (!currentIds.has(id)) {
          const item = index.byId.get(id);
          if (item) {
            contentChanges.added.push({ type: item.type, id: item.id });
            await addContentItem(contentRoot, agentsDir, item);
          }
        }
      }
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          const item = index.byId.get(id);
          if (item) {
            contentChanges.removed.push({ type: item.type, id: item.id });
            await removeContentItem(agentsDir, item, { rootDir });
          }
        }
      }

      // Update manifest content items
      const newItems: ContentSelection["items"] = {
        agents: [], skills: [], rules: [], commands: [],
        prompts: [], hooks: [], githubAgents: [],
      };
      for (const id of contentAnswer.items) {
        const item = index.byId.get(id);
        if (item) {
          const key = TYPE_TO_SELECTION_KEY[item.type];
          if (key) newItems[key].push(item.id);
        }
      }
      manifest.content.items = newItems;

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
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (wsManifest) {
    console.log();
    info(chalk.bold("Workspace configuration"));
    const currentRepos = wsManifest.repos.map((r) => r.path);
    console.log(chalk.dim(`  Repos: ${currentRepos.join(", ") || "(none)"}`));
    console.log(chalk.dim(`  Sync strategy: ${wsManifest.syncStrategy}`));

    const { manageWorkspace } = await inquirer.prompt<{ manageWorkspace: boolean }>([
      {
        type: "confirm",
        name: "manageWorkspace",
        message: "Configure workspace settings?",
        default: false,
      },
    ]);

    if (manageWorkspace) {
      // Scan for new repos
      const detectedRepos = await detectSubRepos(rootDir);
      const existingPaths = new Set(wsManifest.repos.map((r) => r.path));
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
          wsManifest.repos.push({ path, name: path, sync: false });
        }
      }

      // Toggle sync per repo
      if (wsManifest.repos.length > 0) {
        const { syncRepos } = await inquirer.prompt<{ syncRepos: string[] }>([
          {
            type: "checkbox",
            name: "syncRepos",
            message: "Select repos to sync:",
            choices: wsManifest.repos.map((r) => ({
              name: r.name ?? r.path,
              value: r.path,
              checked: r.sync,
            })),
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        const syncSet = new Set(syncRepos);
        for (const repo of wsManifest.repos) {
          repo.sync = syncSet.has(repo.path);
        }
      }

      // Per-repo git identity
      if (wsManifest.repos.length > 0) {
        const { editIdentity } = await inquirer.prompt<{ editIdentity: string }>([
          {
            type: "list",
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
          for (const repo of wsManifest.repos) {
            const identity = detectRepoGitIdentity(join(rootDir, repo.path));
            repo.owner = identity.owner || undefined;
            repo.repo = identity.repo || undefined;
            repo.defaultBranch = identity.defaultBranch || undefined;
            repo.platform = identity.platform || undefined;
          }
          info("Re-detected git identities for all repos.");
        } else if (editIdentity === "edit") {
          for (const repo of wsManifest.repos) {
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
          type: "list",
          name: "strategy",
          message: "Sync strategy:",
          choices: [
            { name: "Manual — sync sub-repos only with --repos flag", value: "manual" as const },
            { name: "On sync — auto-sync sub-repos when running hatch3r sync", value: "on-sync" as const },
          ],
          default: wsManifest.syncStrategy,
        },
      ]);
      wsManifest.syncStrategy = strategy;

      await writeWorkspaceManifest(rootDir, wsManifest);

      // Offer to sync now
      const syncCount = wsManifest.repos.filter((r) => r.sync).length;
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
    }
  }

}
