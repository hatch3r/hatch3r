// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { worktreeSetupCommand } from "./commands/worktreeSetup.js";
import { worktreeCleanupCommand } from "./commands/worktreeCleanup.js";
import { cleanCommand } from "./commands/clean.js";
import { configCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";
import { verifyCommand } from "./commands/verify.js";
import { statusCommand } from "./commands/status.js";
import { HATCH3R_VERSION } from "../version.js";
import { HatchError, TOOL_CHOICES } from "../types.js";

const program = new Command();

program
  .name("hatch3r")
  .description(
    "Battle-tested agentic coding setup framework. Crack the egg. Hatch better agents.",
  )
  .version(HATCH3R_VERSION);

program
  .command("init")
  .description("Install a complete agent setup into the current repo (first-run: creates .agents/ directory)")
  .option(
    "--tools <tools>",
    `Comma-separated tools (${TOOL_CHOICES})`,
  )
  .option("--yes", "Skip interactive prompts, use defaults")
  .option("--preset <preset>", "Content preset: minimal, standard, full (default: standard)")
  .option("--project-type <type>", "Project type: greenfield, brownfield")
  .option("--team-size <size>", "Team size: solo, team")
  .option("--workspace", "Initialize as a multi-repo workspace")
  .action(initCommand);

program
  .command("sync")
  .description("Re-generate tool outputs from canonical .agents/ state (run after editing .agents/)")
  .option("--repos [paths...]", "Sync workspace content to sub-repos (all opted-in if no paths given)")
  .option("--dry-run", "Show what would change without modifying files")
  .option("--diff", "Show a before/after diff summary for each generated file")
  .option("--force", "Overwrite locally modified files in sub-repos")
  .option("--minimal", "Generate stripped-down output (no comments, minimal formatting) to reduce token usage")
  .option("--verbose", "Show detailed output for each file processed")
  .action(syncCommand);

program
  .command("status")
  .description("Check sync status between canonical .agents/ and generated files")
  .option("--verbose", "Show detailed per-file status information")
  .action(statusCommand);

program
  .command("update")
  .description("Pull latest hatch3r templates with safe merge (preserves customizations)")
  .option("--yes", "Skip interactive prompts, use defaults")
  .option("--diff", "Show a before/after diff summary for each generated file")
  .action(updateCommand);

program
  .command("validate")
  .description("Validate the canonical .agents/ structure (checks frontmatter, content, security)")
  .option("--verbose", "Show detailed validation output for each check")
  .action(validateCommand);

program
  .command("verify")
  .description("Verify integrity of canonical agent files (detect tampering)")
  .action(verifyCommand);

program
  .command("config")
  .description("Reconfigure tools, MCP servers, features, and platform")
  .action(configCommand);

program
  .command("clean")
  .description("Remove all hatch3r artifacts from the current repo (optionally reinitialize after)")
  .option("--yes", "Skip confirmation prompts (cleans without reinit)")
  .option("--dry-run", "Show what would be removed without modifying files")
  .action(cleanCommand);

program
  .command("add [pack]")
  .description("Install a community pack (coming soon)")
  .action(addCommand);

program
  .command("worktree-setup [worktree-path]")
  .description("Set up gitignored files in a git worktree")
  .option("--from <path>", "Main repo path (auto-detected by default)")
  .option("--dry-run", "Show what would be done without changes")
  .option("--force", "Overwrite existing files in the worktree")
  .action(worktreeSetupCommand);

program
  .command("worktree-cleanup")
  .description("Remove symlinks and copied files created by worktree-setup")
  .option("--dry-run", "Show what would be done without changes")
  .action(worktreeCleanupCommand);

// Agent command names that users might try to run directly in the terminal.
// These are slash commands meant to be invoked inside an AI-powered editor, not from the CLI.
const AGENT_COMMAND_NAMES = new Set([
  "workflow", "project-spec", "codebase-map", "debug", "release",
  "refactor-plan", "test-plan", "bug-plan", "feature-plan", "migration-plan",
  "roadmap", "onboard", "recipe",
  "board-init", "board-pickup", "board-groom", "board-refresh", "board-fill",
  "board-shared",
  "security-audit", "dep-audit", "benchmark", "healthcheck", "context-health",
  "learn", "revision", "cost-tracking", "api-spec", "hooks", "quick-change",
  "command-customize", "agent-customize", "rule-customize", "skill-customize",
]);

// Catch-all for unknown commands -- redirect agent commands to the editor
program.on("command:*", (operands: string[]) => {
  const cmd = operands[0];
  if (cmd && AGENT_COMMAND_NAMES.has(cmd)) {
    console.error(
      `\n  "${cmd}" is a hatch3r agent command meant to be run inside your AI editor (e.g. /${cmd}).` +
      `\n  It cannot be invoked from the terminal CLI.` +
      `\n\n  To use agent commands, open your project in Cursor, Claude Code, or another supported tool` +
      `\n  and type /${cmd} in the AI chat.\n`,
    );
  } else {
    console.error(
      `\n  Unknown command: ${cmd}` +
      `\n  Run "hatch3r --help" for available commands.` +
      `\n\n  Common commands:` +
      `\n    hatch3r init      Set up agent configuration in current repo` +
      `\n    hatch3r sync      Regenerate tool outputs from .agents/` +
      `\n    hatch3r clean     Remove hatch3r artifacts (optionally reinit)` +
      `\n    hatch3r status    Check sync status` +
      `\n    hatch3r validate  Validate .agents/ structure\n`,
    );
  }
  process.exit(1);
});

const nodeVersion = parseInt(process.version.slice(1), 10);
if (nodeVersion < 22) {
  console.error(
    `hatch3r requires Node.js >= 22.0.0 (current: ${process.version}). Please upgrade Node.js.`,
  );
  process.exit(1);
}

let shuttingDown = false;
const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Allow pending writes to flush, then exit with POSIX-correct code (128 + signal)
    process.stdout.write("", () => {
      process.stderr.write("", () => {
        process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
      });
    });
  });
}

process.on("unhandledRejection", (reason) => {
  console.error(
    `\nhatch3r: unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  if (process.env.DEBUG) {
    console.error(reason);
  }
  process.exit(1);
});

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof HatchError) {
    process.exit(err.exitCode);
  }
  const isUsageError = err instanceof Error && (
    err.message.includes("Invalid") ||
    err.message.includes("Unknown") ||
    err.message.includes("missing required")
  );
  console.error(
    `\nhatch3r encountered an ${isUsageError ? "usage" : "unexpected"} error: ${err instanceof Error ? err.message : String(err)}`,
  );
  if (isUsageError) {
    console.error(`  Run "hatch3r --help" for usage information.`);
  } else {
    console.error("  For help, see: https://github.com/hatch3r/hatch3r#troubleshooting");
    console.error("  Check .agents/.failure-log.jsonl for recent failure details.");
    console.error("  Set DEBUG=1 for a full stack trace.");
  }
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(isUsageError ? 2 : 1);
}
