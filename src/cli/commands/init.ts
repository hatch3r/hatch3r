import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter } from "../../adapters/index.js";
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
  type Features,
  type Tool,
} from "../../types.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { ensureEnvMcp, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);
const CONTENT_DIRS = ["agents", "commands", "rules", "skills", "prompts", "github-agents", "mcp", "hooks"];

const TOOL_CHOICES: { name: string; value: Tool }[] = [
  { name: "Cursor", value: "cursor" },
  { name: "GitHub Copilot", value: "copilot" },
  { name: "Claude Code", value: "claude" },
  { name: "OpenCode", value: "opencode" },
  { name: "Windsurf", value: "windsurf" },
  { name: "Amp", value: "amp" },
  { name: "Codex CLI", value: "codex" },
  { name: "Gemini CLI", value: "gemini" },
  { name: "Cline / Roo Code", value: "cline" },
  { name: "Aider", value: "aider" },
  { name: "Kiro", value: "kiro" },
  { name: "Goose", value: "goose" },
  { name: "Zed", value: "zed" },
];

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
const VALID_TOOLS: Tool[] = ["cursor", "copilot", "claude", "opencode", "windsurf", "amp", "codex", "gemini", "cline", "aider", "kiro", "goose", "zed"];
const DEFAULT_FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof Features)[];
const DEFAULT_MCP: string[] = ["github", "context7", "filesystem", "playwright", "brave-search"];

function sanitizeInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
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
  } catch {
    return { owner: "", repo: "" };
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
  } catch {
    return "main";
  }
}

function toolDisplayName(tool: Tool): string {
  const names: Record<Tool, string> = {
    cursor: "Cursor",
    copilot: "GitHub Copilot",
    claude: "Claude Code",
    opencode: "OpenCode",
    windsurf: "Windsurf",
    amp: "Amp",
    codex: "Codex CLI",
    gemini: "Gemini CLI",
    cline: "Cline",
    aider: "Aider",
    kiro: "Kiro",
    goose: "Goose",
    zed: "Zed",
  };
  return names[tool] ?? tool;
}

async function runInit(
  rootDir: string,
  owner: string,
  repo: string,
  defaultBranch: string,
  tools: Tool[],
  features: Features,
  mcpServers: string[],
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
    } catch {
      // source dir may not exist in this distribution
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
      await writeFile(
        mcpPath,
        JSON.stringify({ mcpServers: filtered }, null, 2) + "\n",
        "utf-8",
      );
    }
  } catch {
    // mcp.json may not exist or be unreadable; skip filtering
  }

  await writeFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD, "utf-8");

  s1.succeed(step(1, totalSteps, "Canonical files created"));

  const s2 = createSpinner(step(2, totalSteps, "Writing manifest..."));
  s2.start();
  const manifest = createManifest({ owner, repo, defaultBranch, tools, features, mcpServers });
  await writeManifest(rootDir, manifest);
  s2.succeed(step(2, totalSteps, "Manifest written"));

  const s3 = createSpinner(
    step(3, totalSteps, `Generating ${tools.map(toolDisplayName).join(", ")} output...`),
  );
  s3.start();
  // On init, preserve existing user content: prepend managed block if file has no markers.
  await safeWriteFile(join(rootDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
    appendIfNoBlock: true,
  });
  addManagedFile(manifest, "AGENTS.md");

  for (const tool of tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, manifest);
      for (const out of outputs) {
        await safeWriteFile(join(rootDir, out.path), out.content, {
          managedContent: out.managedContent,
          appendIfNoBlock: true,
        });
        addManagedFile(manifest, out.path);
      }
    } catch (err) {
      s3.fail(step(3, totalSteps, `Failed to generate ${toolDisplayName(tool)} output`));
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  s3.succeed(step(3, totalSteps, "Adapter output generated"));

  const s4 = createSpinner(step(4, totalSteps, "Finalizing..."));
  s4.start();
  await writeManifest(rootDir, manifest);

  let envResult: { action: string; path: string; newVars: string[] } | undefined;
  if (features.mcp && mcpServers.length > 0) {
    envResult = await ensureEnvMcp(rootDir, mcpServers);
  }

  s4.succeed(step(4, totalSteps, "Done"));

  console.log();
  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const summaryLines = [
    label("Tools", tools.map(toolDisplayName).join(", ")),
    label("Features", enabledFeatures.join(", ")),
  ];
  if (owner || repo) {
    summaryLines.push(label("GitHub", `${owner}/${repo}`));
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
        process.exit(0);
      }
    }
  } catch {
    // fresh init
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
    const owner = sanitizeInput(remote.owner);
    const repo = sanitizeInput(remote.repo);

    let tools: Tool[];
    if (opts.tools) {
      const rawTools = opts.tools.split(",").map((t) => t.trim());
      const invalid = rawTools.filter((t) => !VALID_TOOLS.includes(t as Tool));
      if (invalid.length > 0) {
        logError(`Invalid tool(s): ${invalid.join(", ")}`);
        console.log(chalk.dim(`  Valid tools: ${VALID_TOOLS.join(", ")}`));
        process.exit(1);
      }
      tools = rawTools as Tool[];
    } else if (repoInfo.existingTools.length > 0) {
      tools = repoInfo.existingTools;
    } else {
      tools = DEFAULT_TOOLS;
    }

    const features = { ...DEFAULT_FEATURES };
    const mcpServers = features.mcp ? DEFAULT_MCP : [];
    const defaultBranch = parseGitDefaultBranch();

    await checkExisting(rootDir, true);
    await runInit(rootDir, owner, repo, defaultBranch, tools, features, mcpServers);
    return;
  }

  console.log();

  const repoAnswers = await inquirer.prompt<{ owner: string; repo: string }>([
    {
      type: "input",
      name: "owner",
      message: "GitHub owner (org or username):",
      default: remote.owner || undefined,
    },
    {
      type: "input",
      name: "repo",
      message: "Repository name:",
      default: remote.repo || undefined,
    },
  ]);
  const owner = sanitizeInput(repoAnswers.owner);
  const repo = sanitizeInput(repoAnswers.repo);

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

  const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
  const toolAnswers = await inquirer.prompt<{ tools: Tool[] }>([
    {
      type: "checkbox",
      name: "tools",
      message: "Select tools to configure:",
      choices: TOOL_CHOICES,
      default: toolDefaults,
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
    },
  ]);
  const selectedFeatures = featureAnswers.features;
  const features = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(features) as (keyof Features)[]) {
    features[k] = selectedFeatures.includes(k);
  }

  let mcpServers: string[] = [];
  if (features.mcp) {
    const mcpAnswers = await inquirer.prompt<{ mcp: string[] }>([
      {
        type: "checkbox",
        name: "mcp",
        message: "Select MCP servers:",
        choices: MCP_CHOICES,
        default: DEFAULT_MCP,
      },
    ]);
    mcpServers = mcpAnswers.mcp ?? [];
  }

  await checkExisting(rootDir, false);
  await runInit(rootDir, owner, repo, defaultBranch, tools, features, mcpServers);
}
