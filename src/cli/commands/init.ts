import { access, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import {
  createManifest,
  readManifest,
  writeManifest,
  addManagedFile,
} from "../../manifest/hatchJson.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import {
  AGENTS_DIR,
  DEFAULT_FEATURES,
  HatchError,
  VALID_TOOLS,
  type ContentSelection,
  type Features,
  type Platform,
  type RepoInfo,
  type Tool,
} from "../../types.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, generateCanonicalAgentsMd } from "../shared/agentsContent.js";
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
import { findPackageRoot } from "../shared/paths.js";
import { TOOL_DISPLAY_NAMES, TOOL_PROMPT_CHOICES, FEATURE_CHOICES, MCP_CHOICES, PLATFORM_DISPLAY_NAMES, PLATFORM_MCP_SERVER, sanitizeInput, isWSL } from "../shared/constants.js";
import { generateIntegrityManifest, writeIntegrityManifest } from "../../integrity/index.js";
import { HATCH3R_VERSION } from "../../version.js";
import { buildContentIndex, resolveSelection, copySelectedContent, countSelectionItems, selectionSummary, getAllContentIds, removeContentItem } from "../../content/index.js";
import { PRESETS, getPreset, type PresetId } from "../../content/presets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);

const DEFAULT_TOOLS: Tool[] = ["cursor"];
const DEFAULT_FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof Features)[];
const DEFAULT_MCP: string[] = ["playwright", "github", "context7"];

function parseGitRemote(): { owner: string; repo: string } {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      stdio: "pipe",
    })
      .toString()
      .trim();

    const sshMatch = url.match(/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return { owner: "", repo: "" };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e.code === "ENOENT") return { owner: "", repo: "" };
    if (e.status === 128) return { owner: "", repo: "" };
    throw err;
  }
}

function parseGitDefaultBranch(): string {
  try {
    const ref = execFileSync("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], {
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (ref && ref.startsWith("origin/")) {
      return ref.replace(/^origin\//, "");
    }
    return "main";
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e.code === "ENOENT") return "main";
    if (e.status === 128) return "main";
    throw err;
  }
}

function detectPlatformFromRemote(remoteUrl: string): Platform {
  if (remoteUrl.includes("dev.azure.com") || remoteUrl.includes("visualstudio.com")) return "azure-devops";
  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab.")) return "gitlab";
  return "github";
}

function getGitRemoteUrl(): string {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

interface RunInitOptions {
  rootDir: string;
  platform: Platform;
  owner: string;
  repo: string;
  namespace: string;
  project: string;
  defaultBranch: string;
  tools: Tool[];
  features: Features;
  mcpServers: string[];
  repoInfo: RepoInfo;
  contentSelection: ContentSelection;
}

async function runInit(options: RunInitOptions): Promise<void> {
  const { rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection } = options;
  const agentsDir = join(rootDir, AGENTS_DIR);
  const totalSteps = 4;

  const s1 = createSpinner(step(1, totalSteps, "Creating canonical files..."));
  s1.start();
  await mkdir(agentsDir, { recursive: true });

  // Detect re-init: check if manifest exists and compute content delta
  const existingManifest = await readManifest(rootDir);

  // Build content index from package and copy only selected items
  const index = await buildContentIndex(CONTENT_ROOT);
  await copySelectedContent(CONTENT_ROOT, agentsDir, contentSelection, index);

  // Clean up stale content from previous init
  if (existingManifest?.content) {
    const oldIds = getAllContentIds(existingManifest.content);
    const newIds = getAllContentIds(contentSelection);
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const item = index.byId.get(id);
        if (item) await removeContentItem(agentsDir, item, { rootDir });
      }
    }
  }

  await mkdir(join(agentsDir, "learnings"), { recursive: true });

  const mcpPath = join(agentsDir, "mcp", "mcp.json");
  try {
    const mcpRaw = await readFile(mcpPath, "utf-8");
    const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, Record<string, unknown>> };
    if (mcpParsed.mcpServers) {
      const selected = new Set(mcpServers);
      const filtered: Record<string, Record<string, unknown>> = {};
      for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
        if (!selected.has(name)) continue;
        const entry = { ...server };
        delete entry._disabled;
        filtered[name] = entry;
      }
      await safeWriteFile(
        mcpPath,
        JSON.stringify({ mcpServers: filtered }, null, 2) + "\n",
        { force: true },
      );
    }
  } catch (err) {
    const isExpected = (err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError;
    if (!isExpected) throw err;
  }

  // Generate dynamic AGENTS.md based on what's actually installed
  const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
  await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd, { force: true });

  s1.succeed(step(1, totalSteps, `Canonical files created (${countSelectionItems(contentSelection)} items)`));

  const s2 = createSpinner(step(2, totalSteps, "Writing manifest..."));
  s2.start();
  const manifest = createManifest({ platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, content: contentSelection, languages: repoInfo.languages });
  await writeManifest(rootDir, manifest);
  s2.succeed(step(2, totalSteps, "Manifest written"));

  const s3 = createSpinner(
    step(3, totalSteps, `Generating ${tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")} output...`),
  );
  s3.start();
  // On init, preserve existing user content: prepend managed block if file has no markers.
  await safeWriteFile(join(rootDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
    appendIfNoBlock: true,
  });
  addManagedFile(manifest, "AGENTS.md");

  const adapterFailures: { tool: string; error: string }[] = [];
  for (const tool of tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, manifest);
      for (const w of adapter.warnings) { warn(w); }
      for (const out of outputs) {
        await safeWriteFile(join(rootDir, out.path), out.content, {
          managedContent: out.managedContent,
          appendIfNoBlock: true,
        });
        addManagedFile(manifest, out.path);
      }
    } catch (err) {
      adapterFailures.push({
        tool: TOOL_DISPLAY_NAMES[tool] ?? tool,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === tools.length) {
      s3.fail(step(3, totalSteps, "All adapters failed"));
      throw new HatchError("All adapters failed", 1);
    }
  }
  s3.succeed(step(3, totalSteps, adapterFailures.length > 0
    ? `Adapter output generated (${adapterFailures.length} failed)`
    : "Adapter output generated"));

  for (const tool of tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, manifest);
    for (const w of warnings) {
      warn(w);
    }
  }

  const s4 = createSpinner(step(4, totalSteps, "Finalizing..."));
  s4.start();
  await writeManifest(rootDir, manifest);

  const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
  await writeIntegrityManifest(agentsDir, integrityManifest);

  let envResult: { action: string; path: string; newVars: string[] } | undefined;
  if (features.mcp && mcpServers.length > 0) {
    envResult = await ensureEnvMcp(rootDir, mcpServers);
    await ensureGitignoreEntry(rootDir);
  }

  s4.succeed(step(4, totalSteps, "Done"));

  console.log();
  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const presetLabel = contentSelection.preset.charAt(0).toUpperCase() + contentSelection.preset.slice(1);
  const summaryLines = [
    label("Profile", `${presetLabel} (${contentSelection.projectType}, ${contentSelection.teamSize})`),
    label("Content", `${countSelectionItems(contentSelection)} items (${selectionSummary(contentSelection)})`),
    label("Tools", tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")),
    label("Features", enabledFeatures.join(", ")),
  ];
  if (owner || repo) {
    const platformLabel = PLATFORM_DISPLAY_NAMES[platform];
    summaryLines.push(label(platformLabel, `${namespace || owner}/${project || repo}`));
  }
  if (defaultBranch) {
    summaryLines.push(label("Default branch", defaultBranch));
  }
  if (mcpServers.length > 0) {
    summaryLines.push(label("MCP", mcpServers.join(", ")));
  }
  if (envResult && envResult.action !== "skipped") {
    summaryLines.push(label("Secrets", `.env.mcp (fill in your API keys)`));
  }
  summaryLines.push("");
  summaryLines.push(label("Canonical", `${AGENTS_DIR}/`));
  summaryLines.push(label("Manifest", `${AGENTS_DIR}/hatch.json`));

  const isGreenfield =
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents;
  summaryLines.push("");
  if (isGreenfield) {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold("/project-spec")} to define your new project`);
  } else {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold("/codebase-map")} to map your existing codebase`);
  }

  printBox("Hatch complete", summaryLines, "success");

  if (envResult && envResult.newVars.length > 0) {
    warn(
      `Add your secrets to .env.mcp: ${envResult.newVars.join(", ")}`,
    );
    info(`Run this, then start or restart your editor: ${getSourceEnvMcpCommand()}`);
  }
}

async function checkExisting(rootDir: string, skipPrompt: boolean, newSelection?: ContentSelection): Promise<void> {
  const hatchJsonPath = join(rootDir, AGENTS_DIR, "hatch.json");
  try {
    await access(hatchJsonPath);
    if (!skipPrompt) {
      let message = "Existing .agents/ found. This will overwrite managed files. Continue?";

      // Compute removal count if we have both old and new selections
      if (newSelection) {
        const existingManifest = await readManifest(rootDir);
        if (existingManifest?.content) {
          const oldIds = getAllContentIds(existingManifest.content);
          const newIds = getAllContentIds(newSelection);
          let removeCount = 0;
          for (const id of oldIds) {
            if (!newIds.has(id)) removeCount++;
          }
          if (removeCount > 0) {
            const oldPreset = existingManifest.content.preset.charAt(0).toUpperCase() + existingManifest.content.preset.slice(1);
            const newPreset = newSelection.preset.charAt(0).toUpperCase() + newSelection.preset.slice(1);
            message = `Existing .agents/ found. ${removeCount} content item(s) will be removed (switching from ${oldPreset} to ${newPreset}). Continue?`;
          }
        }
      }

      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: "confirm",
          name: "proceed",
          message,
          default: false,
        },
      ]);
      if (!proceed) {
        console.log(chalk.dim("\n  Init cancelled.\n"));
        throw new HatchError("Init cancelled.", 0);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function validateFlag<T extends string>(value: string | undefined, valid: T[], fallback: T, name: string): T {
  if (!value) return fallback;
  if (!(valid as string[]).includes(value)) {
    logError(`Invalid --${name}: "${value}". Valid: ${valid.join(", ")}`);
    throw new HatchError(`Invalid --${name}: "${value}"`, 1);
  }
  return value as T;
}

export async function initCommand(
  opts: {
    tools?: string;
    yes?: boolean;
    preset?: string;
    projectType?: string;
    teamSize?: string;
  } = {},
): Promise<void> {
  printBanner();

  const rootDir = process.cwd();

  const detectSpinner = createSpinner("Detecting repository...");
  detectSpinner.start();
  const repoInfo = await analyzeRepo(rootDir);
  const remote = parseGitRemote();
  detectSpinner.succeed("Repository detected");

  const detected: string[] = [];
  if (repoInfo.languages.length > 0 && repoInfo.languages[0] !== "unknown") {
    detected.push(...repoInfo.languages);
  }
  if (repoInfo.packageManager !== "unknown") {
    detected.push(repoInfo.packageManager);
  }
  if (repoInfo.isMonorepo) detected.push("monorepo");
  if (detected.length > 0) {
    info(chalk.dim(`Detected: ${detected.join(", ")}`));
  }

  if (opts.yes) {
    const remoteUrl = getGitRemoteUrl();
    const platform = detectPlatformFromRemote(remoteUrl);
    const owner = sanitizeInput(remote.owner);
    const repo = sanitizeInput(remote.repo);
    const namespace = owner;
    const project = repo;

    let tools: Tool[];
    if (opts.tools) {
      const rawTools = opts.tools.split(",").map((t) => t.trim());
      const invalid = rawTools.filter((t) => !VALID_TOOLS.has(t));
      if (invalid.length > 0) {
        logError(`Invalid tool(s): ${invalid.join(", ")}`);
        console.log(chalk.dim(`  Valid tools: ${[...VALID_TOOLS].join(", ")}`));
        throw new HatchError(`Invalid tool(s): ${invalid.join(", ")}`, 1);
      }
      tools = rawTools as Tool[];
    } else if (repoInfo.existingTools.length > 0) {
      tools = repoInfo.existingTools;
    } else {
      tools = DEFAULT_TOOLS;
    }

    const features = { ...DEFAULT_FEATURES };
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    const mcpServers = features.mcp
      ? Array.from(new Set([platformMcp, ...DEFAULT_MCP.filter((s) => s !== "github")]))
      : [];
    const defaultBranch = parseGitDefaultBranch();

    // Use CLI flags with validation, falling back to auto-detect / defaults
    const isGreenfield =
      repoInfo.languages.length === 1 &&
      repoInfo.languages[0] === "unknown" &&
      repoInfo.existingTools.length === 0 &&
      !repoInfo.hasExistingAgents;
    const presetId = validateFlag(opts.preset, ["minimal", "standard", "full"], "standard", "preset");
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], isGreenfield ? "greenfield" : "brownfield", "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    const preset = getPreset(presetId);
    const index = await buildContentIndex(CONTENT_ROOT);
    const contentSelection = resolveSelection(preset, projectType, teamSize, index);

    await checkExisting(rootDir, true, contentSelection);
    await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection });
    return;
  }

  console.log();

  const remoteUrl = getGitRemoteUrl();
  const detectedPlatform = detectPlatformFromRemote(remoteUrl);

  const platformAnswer = await inquirer.prompt<{ platform: Platform }>([
    {
      type: "list",
      name: "platform",
      message: "Select your platform:",
      choices: [
        { name: "GitHub", value: "github" as Platform },
        { name: "Azure DevOps", value: "azure-devops" as Platform },
        { name: "GitLab", value: "gitlab" as Platform },
      ],
      default: detectedPlatform,
    },
  ]);
  const platform = platformAnswer.platform;

  let owner: string;
  let repo: string;
  let namespace: string;
  let project: string;

  if (platform === "azure-devops") {
    const adoAnswers = await inquirer.prompt<{ org: string; project: string; repo: string }>([
      { type: "input", name: "org", message: "Azure DevOps organization:", default: remote.owner || undefined },
      { type: "input", name: "project", message: "Azure DevOps project:" },
      { type: "input", name: "repo", message: "Repository name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(adoAnswers.org);
    repo = sanitizeInput(adoAnswers.repo);
    namespace = owner;
    project = sanitizeInput(adoAnswers.project);
  } else if (platform === "gitlab") {
    const glAnswers = await inquirer.prompt<{ namespace: string; project: string }>([
      { type: "input", name: "namespace", message: "GitLab namespace (group or username):", default: remote.owner || undefined },
      { type: "input", name: "project", message: "Project name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(glAnswers.namespace);
    repo = sanitizeInput(glAnswers.project);
    namespace = owner;
    project = repo;
  } else {
    const repoAnswers = await inquirer.prompt<{ owner: string; repo: string }>([
      { type: "input", name: "owner", message: "GitHub owner (org or username):", default: remote.owner || undefined },
      { type: "input", name: "repo", message: "Repository name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(repoAnswers.owner);
    repo = sanitizeInput(repoAnswers.repo);
    namespace = owner;
    project = repo;
  }

  const defaultBranchDefault = parseGitDefaultBranch();
  const defaultBranchAnswers = await inquirer.prompt<{ defaultBranch: string }>([
    {
      type: "input",
      name: "defaultBranch",
      message: "Default branch (for checkout, PR base, release):",
      default: defaultBranchDefault,
    },
  ]);
  const defaultBranch = defaultBranchAnswers.defaultBranch.trim() || defaultBranchDefault;

  // --- Project type ---
  const isAutoGreenfield =
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents;
  const projectTypeAnswer = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" }>([
    {
      type: "list",
      name: "projectType",
      message: "Is this a new (greenfield) or existing (brownfield) project?",
      choices: [
        { name: "Greenfield — new project from scratch", value: "greenfield" as const },
        { name: "Brownfield — existing codebase", value: "brownfield" as const },
      ],
      default: isAutoGreenfield ? "greenfield" : "brownfield",
    },
  ]);
  const projectType = projectTypeAnswer.projectType;

  // --- Team size ---
  const teamSizeAnswer = await inquirer.prompt<{ teamSize: "solo" | "team" }>([
    {
      type: "list",
      name: "teamSize",
      message: "Solo developer or team collaboration?",
      choices: [
        { name: "Solo — just me", value: "solo" as const },
        { name: "Team — multiple contributors", value: "team" as const },
      ],
      default: "solo",
    },
  ]);
  const teamSize = teamSizeAnswer.teamSize;

  // --- Content preset ---
  const presetAnswer = await inquirer.prompt<{ preset: PresetId }>([
    {
      type: "list",
      name: "preset",
      message: "Select content profile:",
      choices: PRESETS.map((p) => ({
        name: `${p.name} — ${p.description}`,
        value: p.id,
      })),
      default: "standard" as PresetId,
    },
  ]);
  const selectedPreset = getPreset(presetAnswer.preset);

  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;

  // --- Custom content selection ---
  let customSelections: string[] | undefined;
  if (selectedPreset.id === "custom") {
    const contentIndex = await buildContentIndex(CONTENT_ROOT);
    const tagGroups = new Map<string, typeof contentIndex.items>();
    for (const item of contentIndex.items) {
      const primaryTag = item.tags[0] ?? "other";
      if (!tagGroups.has(primaryTag)) tagGroups.set(primaryTag, []);
      tagGroups.get(primaryTag)!.push(item);
    }

    const customAnswer = await inquirer.prompt<{ items: string[] }>([
      {
        type: "checkbox",
        name: "items",
        message: "Select content items:",
        choices: contentIndex.items.map((item) => ({
          name: `${item.type}: ${item.id.replace(/^hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
          value: item.id,
          checked: item.protected || item.tags.includes("core"),
        })),
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    customSelections = customAnswer.items;
  }

  const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
  const toolAnswers = await inquirer.prompt<{ tools: Tool[] }>([
    {
      type: "checkbox",
      name: "tools",
      message: "Select tools to configure:",
      choices: TOOL_PROMPT_CHOICES,
      default: toolDefaults,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const tools = toolAnswers.tools.length > 0 ? toolAnswers.tools : DEFAULT_TOOLS;

  const featureAnswers = await inquirer.prompt<{ features: (keyof Features)[] }>([
    {
      type: "checkbox",
      name: "features",
      message: "Select features:",
      choices: FEATURE_CHOICES,
      default: DEFAULT_FEATURE_KEYS,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const selectedFeatures = featureAnswers.features;
  const features = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(features) as (keyof Features)[]) {
    features[k] = selectedFeatures.includes(k);
  }

  let mcpServers: string[] = [];
  if (features.mcp) {
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    const defaultMcpForPlatform = Array.from(
      new Set([platformMcp, ...DEFAULT_MCP.filter((s) => s !== "github")]),
    );
    const mcpAnswers = await inquirer.prompt<{ mcp: string[] }>([
      {
        type: "checkbox",
        name: "mcp",
        message: "Select MCP servers:",
        choices: MCP_CHOICES,
        default: defaultMcpForPlatform,
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    mcpServers = mcpAnswers.mcp ?? [];
    if (!mcpServers.includes(platformMcp)) {
      mcpServers.unshift(platformMcp);
    }
  }

  // --- Resolve content selection ---
  const contentIndex = await buildContentIndex(CONTENT_ROOT);
  const contentSelection = resolveSelection(selectedPreset, projectType, teamSize, contentIndex, customSelections);

  await checkExisting(rootDir, false, contentSelection);
  await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection });
}
