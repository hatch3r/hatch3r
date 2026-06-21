import { rm } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  createSpinner,
  info,
  warn,
  error as logError,
  step,
  label,
  verbose,
} from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { HATCH3R_DIR, HatchError, WORKTREE_INCLUDE_FILE, type CliToolsConfig, type ContentSelection, type CustomizationManifest, type Features, type Platform, type Tool } from "../../types.js";
import { inventoryArtifacts, executeClean, backupLearnings, restoreLearnings, type CleanInventory } from "../../clean/index.js";
import { runInit, type RunInitOptions } from "./init.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { extractPreservedManifestFields, type PreservedManifestFields } from "../../manifest/hatchJson.js";
import { isBack } from "../shared/initSteps.js";
import { withSnapshot } from "../../pipeline/snapshot.js";

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
  worktreeEnabled: boolean;
  /**
   * CLI-tooling pivot (1.7.5 / plan §4.7 clean touchpoint): captured so
   * reinit re-applies the same selection without forcing the picker
   * again. Falls back through `preservedFields.cliTools` when absent.
   */
  cliTools?: CliToolsConfig;
  /**
   * Customization payload carried forward from the pre-clean manifest so a
   * `clean` -> reinit cycle preserves integration config (e.g. GitHub project
   * IDs) and per-artifact overrides when the project-side
   * `.hatch3r/*.customize.yaml` files are absent.
   */
  customization?: CustomizationManifest;
  /**
   * Platform- and user-specific manifest state (GitHub Projects v2 IDs,
   * costTracking budgets, specs paths, extension config, worktree extras,
   * etc.) captured before clean removes `.agents/hatch.json`. Handed to
   * runInit so reinit reapplies these instead of resetting them to defaults.
   * See {@link extractPreservedManifestFields} for the exact field set.
   */
  preservedFields?: PreservedManifestFields;
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
    worktreeEnabled: manifest.worktree?.enabled ?? false,
    customization: manifest.customization,
    cliTools: manifest.cliTools,
    preservedFields: extractPreservedManifestFields(manifest),
  };
}

function printInventory(inventory: CleanInventory): void {
  const sections: string[] = [];

  if (inventory.adapterFiles.length > 0) {
    sections.push(`  ${chalk.red("×")} ${inventory.adapterFiles.length} adapter output file(s)`);
  }
  if (inventory.manifestPresent) {
    sections.push(`  ${chalk.red("×")} .hatch3r/hatch.json`);
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
  if (inventory.hatch3rDir) {
    sections.push(
      `  ${chalk.green("✓")} .hatch3r/ ${chalk.dim("(kept — learnings, handoffs, overrides, mcp, customizations)")}`,
    );
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

/**
 * D1-21 (Cycle 11 Wave 3): full-uninstall surface. The standard clean is
 * partial-removal by design — it preserves `.hatch3r/` state (learnings,
 * handoffs, overrides, mcp, snapshots, customizations) and `.env.mcp`
 * (secrets). `--purge` removes those two surfaces after the standard clean
 * has run, leaving the repo with no hatch3r footprint.
 *
 * Irreversible by construction: deleting `.hatch3r/` removes
 * `.hatch3r/snapshots/`, so the pre-clean rollback session captured earlier in
 * the flow is destroyed alongside everything else. There is no recovery path,
 * which is why the caller gates this behind a second explicit confirmation.
 *
 * Returns the list of removed top-level paths (relative to `rootDir`) for the
 * summary box.
 */
async function purgeUserState(rootDir: string, envMcpPresent: boolean): Promise<string[]> {
  const purged: string[] = [];
  const targets: Array<{ rel: string; abs: string; present: boolean }> = [
    { rel: `${HATCH3R_DIR}/`, abs: join(rootDir, HATCH3R_DIR), present: true },
    { rel: ".env.mcp", abs: join(rootDir, ".env.mcp"), present: envMcpPresent },
  ];
  for (const t of targets) {
    if (!t.present) continue;
    try {
      await rm(t.abs, { recursive: true, force: true });
      purged.push(t.rel);
    } catch (err) {
      warn(`Could not purge ${t.rel}: ${(err as Error).message}`);
    }
  }
  return purged;
}

export async function cleanCommand(
  opts: {
    yes?: boolean;
    dryRun?: boolean;
    learnings?: boolean;
    purge?: boolean;
    format?: string;
    quiet?: boolean;
    verbose?: boolean;
  } = {},
): Promise<void> {
  // W5: beginCommand resolves --format/--quiet/--verbose and gates the banner
  // (previously printed unconditionally, corrupting any future json stdout).
  // Interactivity is per-invocation: --dry-run never prompts, so json is valid
  // there without --yes; every other path prompts unless --yes (beginCommand's
  // interactive gate enforces exactly that pairing).
  const format = beginCommand(opts, {
    banner: "compact",
    interactive: opts.dryRun !== true,
  });
  const jsonMode = format === "json";

  const rootDir = process.cwd();

  // D6-M7 (Cycle 9 Wave 3): documented session-corruption recovery path.
  // When `--learnings` is passed, the operator opts in to wiping the
  // `.hatch3r/learnings/` and `.hatch3r/handoffs/` directories — the two
  // user-state surfaces that can poison subsequent agent invocations if a
  // prior session left corrupted entries. The default clean flow preserves
  // these directories.
  const wipeLearnings = !!opts.learnings;

  // 1. Inventory
  const s1 = createSpinner(step(1, 3, "Scanning artifacts..."));
  s1.start();
  const inventory = await inventoryArtifacts(rootDir);
  s1.succeed(step(1, 3, "Scan complete"));

  // Check if there's anything to clean
  const hasAnything =
    inventory.adapterFiles.length > 0 ||
    inventory.manifestPresent ||
    inventory.worktreeInclude ||
    inventory.archiveDir;

  if (!hasAnything) {
    if (jsonMode) {
      finishCommand(format, {
        command: "clean",
        title: "Clean",
        lines: [],
        style: "info",
        json: {
          removed: [],
          kept: [],
          errors: [],
          message: "No hatch3r artifacts found. Nothing to clean.",
        },
      });
    } else {
      info("No hatch3r artifacts found. Nothing to clean.");
    }
    return;
  }

  // 2. Capture config before cleanup (for potential reinit)
  const config = inventory.manifest ? captureConfig(inventory.manifest) : null;

  // 3. Backup learnings before cleanup
  const learningsBackup = await backupLearnings(rootDir);

  // 4. Display inventory (human only — json mode is a single stdout document)
  if (!jsonMode) printInventory(inventory);

  // Workspace warnings
  if (inventory.isWorkspaceRoot) {
    warn("This is a workspace root. Member repos still reference this workspace.");
    if (!jsonMode) console.log(chalk.dim("  Clean member repos individually or reinitialize them.\n"));
  }
  if (inventory.isWorkspaceMember) {
    warn(`This repo is managed by a workspace at ${chalk.bold(inventory.workspaceRootPath ?? "..")}.`);
    if (!jsonMode) console.log("");
  }

  // 5. Dry run
  if (opts.dryRun) {
    const result = await executeClean(rootDir, inventory, true);
    // D1-21: with --purge, .hatch3r/ and .env.mcp move from "would keep" to
    // "would remove" so the preview matches what a live --purge run does.
    const wouldKeep = opts.purge
      ? result.kept.filter((k) => !k.startsWith(HATCH3R_DIR) && !k.startsWith(".env.mcp"))
      : result.kept;
    if (jsonMode) {
      const wouldRemove = [...result.removed];
      if (opts.purge) {
        if (inventory.hatch3rDir) wouldRemove.push(`${HATCH3R_DIR}/`);
        if (inventory.envMcp) wouldRemove.push(".env.mcp");
      }
      finishCommand(format, {
        command: "clean",
        title: "Clean (dry-run)",
        lines: [],
        style: "info",
        json: { dryRun: true, purge: !!opts.purge, wouldRemove, wouldKeep },
      });
    } else {
      console.log(chalk.bold("  Would remove:"));
      for (const f of result.removed) {
        console.log(`    ${chalk.red("×")} ${f}`);
      }
      if (opts.purge) {
        if (inventory.hatch3rDir) {
          console.log(`    ${chalk.red("×")} ${HATCH3R_DIR}/ ${chalk.dim("(purge — state, snapshots, overrides)")}`);
        }
        if (inventory.envMcp) {
          console.log(`    ${chalk.red("×")} .env.mcp ${chalk.dim("(purge — secrets)")}`);
        }
      }
      if (wouldKeep.length > 0) {
        console.log(chalk.bold("\n  Would keep:"));
        for (const f of wouldKeep) {
          console.log(`    ${chalk.green("✓")} ${f}`);
        }
      }
      console.log("");
    }
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
        // D1-21: the standard clean removes adapter outputs + manifest and
        // preserves .hatch3r/ state + .env.mcp, so the prompt must not claim
        // "all" (that overstatement is what --purge actually delivers).
        message: opts.purge
          ? "Remove hatch3r adapter outputs + manifest from this repo? (--purge will then also delete .hatch3r/ and .env.mcp)"
          : "Remove hatch3r adapter outputs + manifest from this repo? (.hatch3r/ state and .env.mcp are preserved)",
        default: false,
      },
    ]);
    if (isBack(proceed)) {
      info("Clean cancelled (Shift+Tab).");
      if (learningsBackup) {
        await rm(learningsBackup, { recursive: true, force: true });
      }
      return;
    }
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
  // Decision 27 (Bucket 2.2): capture every file `executeClean` is about
  // to delete BEFORE the rm calls run. The snapshot covers each adapter
  // output, the manifest, and the worktree include — the same surface
  // `inventoryArtifacts` enumerates. A subsequent `hatch3r rollback
  // --session=<id>` restores all removed files (tombstone semantics do not
  // apply because every captured path existed at snapshot time).
  const cleanSnapshotPaths: string[] = inventory.adapterFiles.map((rel) => join(rootDir, rel));
  if (inventory.manifestPresent) {
    cleanSnapshotPaths.push(join(rootDir, HATCH3R_DIR, "hatch.json"));
  }
  if (inventory.worktreeInclude) {
    cleanSnapshotPaths.push(join(rootDir, WORKTREE_INCLUDE_FILE));
  }
  const cleanSnap = await withSnapshot(
    "clean",
    cleanSnapshotPaths,
    async (_sessionId) => undefined,
    { projectRoot: rootDir, onWarn: warn },
  );
  const cleanSessionId = cleanSnap.sessionId;

  const s2 = createSpinner(step(2, 3, "Cleaning artifacts..."));
  s2.start();
  const result = await executeClean(rootDir, inventory, false);
  s2.succeed(step(2, 3, `Removed ${result.removed.length} item(s)`));

  // W5: --verbose wires the per-file removal list (previously dry-run-only)
  // into the live run via the stderr [verbose] channel.
  for (const f of result.removed) {
    verbose(`removed ${f}`);
  }

  // D6-M7 (Cycle 9 Wave 3): session-corruption recovery — wipe learnings
  // and handoffs when the operator explicitly opts in via `--learnings`.
  // Default-preserved by `executeClean`; this branch is the documented
  // recovery path for poisoned sessions.
  if (wipeLearnings) {
    const learningsDir = join(rootDir, HATCH3R_DIR, "learnings");
    const handoffsDir = join(rootDir, HATCH3R_DIR, "handoffs");
    for (const dir of [learningsDir, handoffsDir]) {
      try {
        await rm(dir, { recursive: true, force: true });
        result.removed.push(dir.replace(rootDir + "/", ""));
      } catch (err) {
        result.errors.push(`${dir}: ${(err as Error).message}`);
      }
    }
  }

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

  // 7b. Full uninstall (--purge): D1-21. Remove the two surfaces the standard
  // clean deliberately preserves — `.hatch3r/` state and `.env.mcp` secrets.
  // This supersedes reinit (reinitializing immediately after a full uninstall
  // is contradictory), so the function returns after purging. Irreversible:
  // it deletes `.hatch3r/snapshots/`, so the pre-clean rollback session no
  // longer exists.
  if (opts.purge) {
    if (!opts.yes) {
      warn("--purge will delete .hatch3r/ (including snapshots — the pre-clean rollback session) and .env.mcp.");
      console.log(chalk.dim("  This is irreversible: no rollback snapshot survives a purge.\n"));
      const { confirmPurge } = await inquirer.prompt<{ confirmPurge: boolean }>([
        {
          type: "confirm",
          name: "confirmPurge",
          message: "Permanently delete .hatch3r/ and .env.mcp?",
          default: false,
        },
      ]);
      if (isBack(confirmPurge)) {
        info("Purge cancelled (Shift+Tab); standard clean already applied.");
        if (learningsBackup) {
          await rm(learningsBackup, { recursive: true, force: true });
        }
        return;
      }
      if (!confirmPurge) {
        info("Purge declined; standard clean already applied, .hatch3r/ and .env.mcp kept.");
        if (learningsBackup) {
          await rm(learningsBackup, { recursive: true, force: true });
        }
        return;
      }
    }

    const purged = await purgeUserState(rootDir, inventory.envMcp);
    if (learningsBackup) {
      await rm(learningsBackup, { recursive: true, force: true });
    }

    const purgeLines = [
      `${chalk.red("×")} ${result.removed.length} artifact(s) removed`,
    ];
    for (const p of purged) {
      purgeLines.push(`${chalk.red("×")} ${p} purged`);
    }
    finishCommand(format, {
      command: "clean",
      title: "Purge complete",
      lines: purgeLines,
      style: "success",
      nextSteps: ["Run `npx hatch3r init` to set up again."],
      json: { removed: result.removed, purged, errors: result.errors },
    });
    return;
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

    if (isBack(reinit)) {
      info("Clean cancelled (Shift+Tab).");
      if (learningsBackup) {
        await rm(learningsBackup, { recursive: true, force: true });
      }
      return;
    }

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
          worktreeEnabled: config.worktreeEnabled,
          // 1.7.0 (Phase D): carry customization forward so the rebuilt
          // manifest preserves integration config and per-artifact overrides
          // across a clean -> reinit cycle.
          customization: config.customization,
          // 1.7.5 (CLI-tooling pivot): carry the previous CLI-tools
          // selection forward so clean -> reinit does not silently
          // re-pick from the default.
          cliTools: config.cliTools,
          // 1.7.1: carry full platform/user manifest state (board IDs,
          // costTracking, specs, extension config, worktree extras) forward
          // so a clean -> reinit cycle no longer wipes them.
          preservedManifestFields: config.preservedFields,
          // Reinit-after-clean already prompted the user; suppress runInit's
          // own post-init create-prompt so we do not stack two confirmations.
          yes: true,
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
        if (inventory.hatch3rDir) {
          summaryLines.push(`${chalk.green("✓")} Customizations preserved`);
        }
        if (inventory.envMcp) {
          summaryLines.push(`${chalk.green("✓")} .env.mcp preserved`);
        }
        if (cleanSessionId) {
          summaryLines.push(
            `${chalk.dim("Pre-clean snapshot:")} ${cleanSessionId} ${chalk.dim(`(revert: hatch3r rollback --session=${cleanSessionId})`)}`,
          );
        }

        // W5: no reinit-path next-step — the repo was just set up again, so
        // pointing at `hatch3r init` would be contradictory.
        finishCommand(format, {
          command: "clean",
          title: "Reinit complete",
          lines: summaryLines,
          style: "success",
          json: {
            removed: result.removed,
            kept: result.kept,
            errors: result.errors,
            reinit: true,
            snapshotSession: cleanSessionId ?? null,
          },
        });
      } catch (err) {
        s3.fail(step(3, 3, "Reinit failed"));
        if (err instanceof HatchError && err.exitCode === 0) throw err;
        logError(`Reinit failed: ${(err as Error).message}`);
        // Wave 7: learnings live under `.hatch3r/learnings/` and are never
        // moved by clean, so no rollback message is needed when a reinit
        // fails. `learningsBackup` is always null on the new code path.
        void learningsBackup;
        throw new HatchError(
          "Reinit failed during clean.",
          undefined,
          "CLEAN_ERROR",
          "Re-run `npx hatch3r init` to complete setup, or `--verbose` for the underlying failure.",
        );
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
  if (inventory.hatch3rDir) {
    summaryLines.push(`${chalk.green("✓")} .hatch3r/ customizations preserved`);
  }
  if (cleanSessionId) {
    summaryLines.push(`${chalk.dim("Snapshot:")} ${cleanSessionId}`);
    summaryLines.push(`${chalk.dim("Revert with:")} hatch3r rollback --session=${cleanSessionId}`);
  }

  // W5: the legacy in-box "→ Run hatch3r init …" line moved into the
  // standardized next-steps block (suppressed after the reinit path above,
  // which returns before reaching here).
  finishCommand(format, {
    command: "clean",
    title: "Clean complete",
    lines: summaryLines,
    style: "success",
    nextSteps: ["Run `npx hatch3r init` to set up again."],
    json: {
      removed: result.removed,
      kept: result.kept,
      errors: result.errors,
      snapshotSession: cleanSessionId ?? null,
    },
  });
}
