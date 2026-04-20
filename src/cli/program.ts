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
import { TOOL_CHOICES } from "../types.js";

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

/**
 * Create and configure the Commander program with all commands registered.
 * Single source of truth for command/option registration. Separated from
 * index.ts so tests can import without triggering side effects (signal
 * handlers, parseAsync, Node version check).
 */
export function createProgram(): Command {
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
    .option("--quick", "Skip all prompts and use smart defaults (alias for --yes)")
    .option("--default", "Skip all prompts and use smart defaults (alias for --yes)")
    .option("--preset <preset>", "Content preset: minimal, standard, full (default: full)")
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
    .option("--strict-budget", "Fail sync if any adapter's generated output exceeds its context budget (default: warn)")
    .option("--verbose", "Show detailed output for each file processed")
    .action(syncCommand);

  program
    .command("status")
    .description("Check sync status between canonical .agents/ and generated files")
    .option("--verbose", "Show detailed per-file status information")
    .option("--deep", "Regenerate every adapter's output in-memory to compare byte-for-byte (slower; default uses integrity-manifest fast path)")
    .action(statusCommand);

  program
    .command("update")
    .description("Pull latest hatch3r templates with safe merge (preserves customizations)")
    .option("--yes", "Skip interactive prompts, use defaults")
    .option("--diff", "Show a before/after diff summary for each generated file")
    .option("--force", "Override the preflight integrity check and proceed despite drift")
    .option("--offline, --skip-fetch", "Skip the package fetch step; regenerate only from already-installed canonical content")
    .option("--dry-run", "Preview what would change (added/modified/unchanged per adapter) without writing files")
    .action(updateCommand);

  program
    .command("validate")
    .description("Check .agents/ structure: frontmatter, cross-references, content safety, compliance")
    .option("--verbose", "Show detailed validation output for each check")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .action(validateCommand);

  program
    .command("verify")
    .description("Check file integrity: SHA-256 hashes vs manifest (detect unauthorized modifications)")
    .option("--fix", "Auto-fix integrity issues by running hatch3r update")
    .option("--max-fix-attempts <n>", "Maximum verify-fix cycles (default: 2, max: 5)", parseInt)
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
    .option("--force", "Override the preflight integrity check and proceed despite drift")
    .addHelpText(
      "after",
      [
        "",
        "Roadmap:",
        "  Community pack installation is not yet shipped. The command exits 0 today and",
        "  prints a pointer to the repo's releases + discussions. Scripts that probe for the",
        "  subcommand (e.g. feature-flagged CI) will not see a usage error (exit 2) anymore.",
        "  - Releases:    https://github.com/hatch3r/hatch3r/releases",
        "  - Discussions: https://github.com/hatch3r/hatch3r/discussions",
        "",
        "Exit codes:",
        "  0  Informational (feature pending; no action required)",
        "  1  Integrity drift blocked the command (use --force to override; see `hatch3r verify`)",
        "",
      ].join("\n"),
    )
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
        `\n    hatch3r status    Check sync status` +
        `\n    hatch3r validate  Check .agents/ structure and content` +
        `\n    hatch3r verify    Check file integrity (SHA-256)` +
        `\n    hatch3r config    Reconfigure tools, features, MCP` +
        `\n    hatch3r clean     Remove hatch3r artifacts\n`,
      );
    }
    process.exit(1);
  });

  return program;
}
