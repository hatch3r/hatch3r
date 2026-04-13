import { rm } from "node:fs/promises";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  printBanner,
  createSpinner,
  printBox,
  info,
  warn,
  error as logError,
  step,
  label,
} from "../shared/ui.js";
import { HatchError, type ContentSelection, type Features, type Platform, type Tool } from "../../types.js";
import { inventoryArtifacts, executeClean, backupLearnings, restoreLearnings, type CleanInventory } from "../../clean/index.js";
import { runInit, type RunInitOptions } from "./init.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";

interface CapturedConfig {
  platform: Platform;
  owner: string;
  repo: string;
  namespace: string;
  project: string;
  defaultBranch: string;
  tools: Tool[];
  features: Features;
  mcpServers: string[];
  contentSelection: ContentSelection;
}

function captureConfig(manifest: NonNullable<CleanInventory["manifest"]>): CapturedConfig {
  return {
    platform: manifest.platform ?? "github",
    owner: manifest.owner,
    repo: manifest.repo,
    namespace: manifest.namespace,
    project: manifest.project,
    defaultBranch: manifest.board?.defaultBranch ?? "main",
    tools: [...manifest.tools],
    features: { ...manifest.features },
    mcpServers: [...manifest.mcp.servers],
    contentSelection: manifest.content ?? {
      preset: "standard",
      projectType: "brownfield",
      teamSize: "solo",
      items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
    },
  };
}

function printInventory(inventory: CleanInventory): void {
  const sections: string[] = [];

  if (inventory.adapterFiles.length > 0) {
    sections.push(`  ${chalk.red("×")} ${inventory.adapterFiles.length} adapter output file(s)`);
  }
  if (inventory.canonicalDir) {
    sections.push(`  ${chalk.red("×")} .agents/ canonical directory`);
  }
  if (inventory.worktreeInclude) {
    sections.push(`  ${chalk.red("×")} .worktreeinclude`);
  }
  if (inventory.archiveDir) {
    sections.push(`  ${chalk.red("×")} .hatch3r-archive/`);
  }

  // Kept items
  if (inventory.envMcp) {
    sections.push(`  ${chalk.green("✓")} .env.mcp ${chalk.dim("(kept — contains secrets)")}`);
  }
  if (inventory.customizeDir) {
    sections.push(`  ${chalk.green("✓")} .hatch3r/ ${chalk.dim("(kept — customizations)")}`);
  }
  if (inventory.learnings.length > 0) {
    sections.push(`  ${chalk.green("✓")} ${inventory.learnings.length} learning(s) ${chalk.dim("(backed up for reinit)")}`);
  }

  if (sections.length > 0) {
    console.log("");
    console.log(chalk.bold("  Cleanup inventory:"));
    for (const s of sections) {
      console.log(s);
    }
    console.log("");
  }
}

export async function cleanCommand(
  opts: { yes?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();

  // 1. Inventory
  const s1 = createSpinner(step(1, 3, "Scanning artifacts..."));
  s1.start();
  const inventory = await inventoryArtifacts(rootDir);
  s1.succeed(step(1, 3, "Scan complete"));

  // Check if there's anything to clean
  const hasAnything =
    inventory.adapterFiles.length > 0 ||
    inventory.canonicalDir ||
    inventory.worktreeInclude ||
    inventory.archiveDir;

  if (!hasAnything) {
    info("No hatch3r artifacts found. Nothing to clean.");
    return;
  }

  // 2. Capture config before cleanup (for potential reinit)
  const config = inventory.manifest ? captureConfig(inventory.manifest) : null;

  // 3. Backup learnings before cleanup
  const learningsBackup = await backupLearnings(rootDir);

  // 4. Display inventory
  printInventory(inventory);

  // Workspace warnings
  if (inventory.isWorkspaceRoot) {
    warn("This is a workspace root. Member repos still reference this workspace.");
    console.log(chalk.dim("  Clean member repos individually or reinitialize them.\n"));
  }
  if (inventory.isWorkspaceMember) {
    warn(`This repo is managed by a workspace at ${chalk.bold(inventory.workspaceRootPath ?? "..")}.`);
    console.log("");
  }

  // 5. Dry run
  if (opts.dryRun) {
    const result = await executeClean(rootDir, inventory, true);
    console.log(chalk.bold("  Would remove:"));
    for (const f of result.removed) {
      console.log(`    ${chalk.red("×")} ${f}`);
    }
    if (result.kept.length > 0) {
      console.log(chalk.bold("\n  Would keep:"));
      for (const f of result.kept) {
        console.log(`    ${chalk.green("✓")} ${f}`);
      }
    }
    console.log("");
    // Clean up learnings backup since we're not proceeding
    if (learningsBackup) {
      await rm(learningsBackup, { recursive: true, force: true });
    }
    return;
  }

  // 6. Confirm cleanup
  if (!opts.yes) {
    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
      {
        type: "confirm",
        name: "proceed",
        message: "Remove all hatch3r artifacts from this repo?",
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim("\n  Clean cancelled.\n"));
      // Clean up learnings backup
      if (learningsBackup) {
        const { rm } = await import("node:fs/promises");
        await rm(learningsBackup, { recursive: true, force: true });
      }
      throw new HatchError("Clean cancelled.", 0);
    }
  }

  // 7. Execute cleanup
  const s2 = createSpinner(step(2, 3, "Cleaning artifacts..."));
  s2.start();
  const result = await executeClean(rootDir, inventory, false);
  s2.succeed(step(2, 3, `Removed ${result.removed.length} item(s)`));

  // Report errors
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      warn(`Could not remove: ${e}`);
    }
  }

  // Report kept items
  for (const k of result.kept) {
    info(k);
  }

  // 8. Ask about reinit (skipped with --yes)
  if (!opts.yes && config) {
    console.log("");
    const { reinit } = await inquirer.prompt<{ reinit: boolean }>([
      {
        type: "confirm",
        name: "reinit",
        message: "Would you like to reinitialize hatch3r?",
        default: true,
      },
    ]);

    if (reinit) {
      console.log("");
      const s3 = createSpinner(step(3, 3, "Analyzing repo..."));
      s3.start();

      try {
        const repoInfo = await analyzeRepo(rootDir);
        s3.succeed(step(3, 3, "Repo analyzed"));

        const initOpts: RunInitOptions = {
          rootDir,
          platform: config.platform,
          owner: config.owner,
          repo: config.repo,
          namespace: config.namespace,
          project: config.project,
          defaultBranch: config.defaultBranch,
          tools: config.tools,
          features: config.features,
          mcpServers: config.mcpServers,
          repoInfo,
          contentSelection: config.contentSelection,
        };

        await runInit(initOpts);

        // Restore learnings
        if (learningsBackup) {
          await restoreLearnings(rootDir, learningsBackup);
        }

        const summaryLines = [
          label("Tools", config.tools.join(", ")),
          label("Preset", config.contentSelection.preset),
          "",
        ];
        if (learningsBackup) {
          summaryLines.push(`${chalk.green("✓")} Learnings restored`);
        }
        if (inventory.customizeDir) {
          summaryLines.push(`${chalk.green("✓")} Customizations preserved`);
        }
        if (inventory.envMcp) {
          summaryLines.push(`${chalk.green("✓")} .env.mcp preserved`);
        }

        printBox("Reinit complete", summaryLines, "success");
      } catch (err) {
        s3.fail(step(3, 3, "Reinit failed"));
        if (err instanceof HatchError && err.exitCode === 0) throw err;
        logError(`Reinit failed: ${(err as Error).message}`);
        if (learningsBackup) {
          warn(`Learnings backup preserved at: ${learningsBackup}`);
          warn(`  To restore: cp -r "${learningsBackup}" .agents/learnings/`);
        }
        throw new HatchError("Reinit failed during clean.", 1, "CLEAN_ERROR");
      }
      return;
    }
  }

  // User chose not to reinit, --yes was used, or no manifest to reinit from
  if (learningsBackup) {
    await rm(learningsBackup, { recursive: true, force: true });
  }

  const summaryLines = [
    `${chalk.red("×")} ${result.removed.length} artifact(s) removed`,
  ];
  if (inventory.envMcp) {
    summaryLines.push(`${chalk.green("✓")} .env.mcp preserved`);
  }
  if (inventory.customizeDir) {
    summaryLines.push(`${chalk.green("✓")} .hatch3r/ customizations preserved`);
  }
  summaryLines.push("");
  summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold("hatch3r init")} when ready to set up again.`);

  printBox("Clean complete", summaryLines, "success");
}
