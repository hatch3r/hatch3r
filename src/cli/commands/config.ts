import { readFileSync } from "node:fs";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import {
  AVAILABLE_MCP_SERVERS,
  DEFAULT_FEATURES,
  HatchError,
  TOOLS,
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

const TOOL_DISPLAY_NAMES: Record<Tool, string> = {
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  claude: "Claude Code",
  opencode: "OpenCode",
  windsurf: "Windsurf",
  amp: "Amp",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  cline: "Cline / Roo Code",
  aider: "Aider",
  kiro: "Kiro",
  goose: "Goose",
  zed: "Zed",
};

const TOOL_PROMPT_CHOICES: { name: string; value: Tool }[] = TOOLS.map((t) => ({
  name: TOOL_DISPLAY_NAMES[t],
  value: t,
}));

const FEATURE_CHOICES: { name: string; value: keyof Features }[] = [
  { name: "Agents", value: "agents" },
  { name: "Skills", value: "skills" },
  { name: "Rules", value: "rules" },
  { name: "Prompts", value: "prompts" },
  { name: "Commands", value: "commands" },
  { name: "MCP", value: "mcp" },
  { name: "Hooks", value: "hooks" },
  { name: "GitHub agents", value: "githubAgents" },
];

const MCP_CHOICES = Object.entries(AVAILABLE_MCP_SERVERS).map(([id, meta]) => ({
  name: `${id}: ${meta.description}`,
  value: id,
}));

const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  github: "GitHub",
  "azure-devops": "Azure DevOps",
  gitlab: "GitLab",
};

const PLATFORM_MCP_SERVER: Record<Platform, string> = {
  github: "github",
  "azure-devops": "azure-devops",
  gitlab: "gitlab",
};

function sanitizeInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf-8"));
  } catch {
    return false;
  }
}

interface ConfigDiff {
  addedTools: Tool[];
  removedTools: Tool[];
  addedMcp: string[];
  removedMcp: string[];
  enabledFeatures: (keyof Features)[];
  disabledFeatures: (keyof Features)[];
  platformChanged: boolean;
  repoChanged: boolean;
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
    !diff.repoChanged
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

  printBox("Current configuration", [
    label("Platform", platformLabel),
    label("Branch", branch),
    label("Tools", toolNames),
    label("Features", enabledFeatures.join(", ")),
    label("MCP", manifest.mcp.servers.length > 0 ? manifest.mcp.servers.join(", ") : "none"),
  ], "info");
}

export async function configCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1);
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
    throw new HatchError("At least one tool must be selected.", 1);
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

  // --- Compute diff ---
  const diff = computeDiff(manifest, tools, features, mcpServers, platform, owner, repo, namespace, project);

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
}
