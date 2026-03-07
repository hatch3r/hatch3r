import { access, cp, mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import {
  createManifest,
  writeManifest,
  addManagedFile,
} from "../../manifest/hatchJson.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import {
  AGENTS_DIR,
  AVAILABLE_MCP_SERVERS,
  DEFAULT_FEATURES,
  HatchError,
  VALID_TOOLS,
  TOOLS,
  type Features,
  type Platform,
  type RepoInfo,
  type Tool,
} from "../../types.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, CANONICAL_AGENTS_MD } from "../shared/agentsContent.js";
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
import { generateIntegrityManifest, writeIntegrityManifest } from "../../integrity/index.js";
import { HATCH3R_VERSION } from "../../version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);
const CONTENT_DIRS = ["agents", "checks", "commands", "rules", "skills", "prompts", "github-agents", "mcp", "hooks"];

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

const DEFAULT_TOOLS: Tool[] = ["cursor"];
const DEFAULT_FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof Features)[];
const DEFAULT_MCP: string[] = ["playwright", "github", "context7"];

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

async function runInit(
  rootDir: string,
  platform: Platform,
  owner: string,
  repo: string,
  namespace: string,
  project: string,
  defaultBranch: string,
  tools: Tool[],
  features: Features,
  mcpServers: string[],
  repoInfo: RepoInfo,
): Promise<void> {
  const agentsDir = join(rootDir, AGENTS_DIR);
  const totalSteps = 4;

  const s1 = createSpinner(step(1, totalSteps, "Creating canonical files..."));
  s1.start();
  await mkdir(agentsDir, { recursive: true });
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(CONTENT_ROOT, dir);
    const destDir = join(agentsDir, dir);
    try {
      await cp(srcDir, destDir, { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
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

  await safeWriteFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD, { force: true });

  s1.succeed(step(1, totalSteps, "Canonical files created"));

  const s2 = createSpinner(step(2, totalSteps, "Writing manifest..."));
  s2.start();
  const manifest = createManifest({ platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers });
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

  const summaryLines = [
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

async function checkExisting(rootDir: string, skipPrompt: boolean): Promise<void> {
  const hatchJsonPath = join(rootDir, AGENTS_DIR, "hatch.json");
  try {
    await access(hatchJsonPath);
    if (!skipPrompt) {
      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: "confirm",
          name: "proceed",
          message: "Existing .agents/ found. This will overwrite managed files. Continue?",
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

export async function initCommand(
  opts: {
    tools?: string;
    yes?: boolean;
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

    await checkExisting(rootDir, true);
    await runInit(rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo);
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

  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;

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

  await checkExisting(rootDir, false);
  await runInit(rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo);
}
