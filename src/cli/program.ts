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
import { explainCommand } from "./commands/explain.js";
import {
  mcpSetupCommand,
  mcpListCommand,
  mcpRemoveCommand,
  mcpEnvCheckCommand,
} from "./commands/mcp.js";
import {
  cliToolsCommand,
  cliToolsListCommand,
  cliToolsInstallCommand,
  cliToolsDetectCommand,
} from "./commands/cliTools.js";
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
    .option("--preset <preset>", "Content preset: minimal, standard, full (default: standard)")
    .option("--project-type <type>", "Project type: greenfield, brownfield")
    .option("--team-size <size>", "Team size: solo, team")
    .option("--worktree", "Enable git worktree file isolation (overrides tool auto-detect)")
    .option("--no-worktree", "Disable git worktree file isolation")
    .option("--workspace", "Initialize as a multi-repo workspace")
    .option("--cli-tools <ids>", "CLI tools to opt in on --yes: 'tier1', 'all', or comma-separated ids (default: tier-1 + triggered tier-2)")
    .option("--no-cli-tools", "Skip the CLI-tools opt-in on --yes")
    .option("--mcp", "Re-opt-in to MCP servers on --yes (MCP is now opt-in by default)")
    .option("--quiet", "Suppress stdout chrome (banner, spinner, success box); stderr diagnostics still emit (C9-H26)")
    .option("--json", "Emit a machine-readable JSON summary on stdout; implies --quiet (C9-H26)")
    .option("--no-banner", "Skip the ASCII banner at startup (C9-H26)")
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
    .option("--skip-audit-signatures", "EMERGENCY OVERRIDE: skip `npm audit signatures` verification on the freshly-fetched package. Default is to refuse update on signature failure.")
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
    .command("worktree-setup [name]")
    .description("Create a git worktree by name and populate hatch3r files (auto-resolved to .worktrees/<name>)")
    .option("--from <path>", "Main repo path (auto-detected by default)")
    .option("--from-path <path>", "Legacy mode: populate an existing worktree at <path> (skips git worktree add). Used by editor hooks.")
    .option("--dry-run", "Show what would be done without changes")
    .option("--force", "Overwrite existing files in the worktree")
    .option("--yes", "Skip the secret-propagation confirmation prompt")
    .action(worktreeSetupCommand);

  program
    .command("worktree-cleanup")
    .description("Discover hatch3r-managed worktrees from the main repo, then clean files and remove the selected worktree(s)")
    .option("--dry-run", "Show what would be done without changes")
    .option("--all", "Skip the all/specific prompt and clean every hatch3r-managed worktree")
    .option("--yes", "Skip selection and confirmation prompts (implies --all unless paths are filtered upstream)")
    .option("--files-only", "Remove hatch3r-managed files only; keep the git worktree and its directory")
    .action(worktreeCleanupCommand);

  // CLI-tooling pivot (plan §4.5): side-door commands for MCP and CLI tools.
  // `hatch3r init` no longer opens the MCP picker by default; users opt in
  // via the Yes/No gate during init or run `hatch3r mcp setup` later.
  const mcpCmd = program
    .command("mcp")
    .description("Manage MCP servers (now opt-in; CLI tools are the default)");
  mcpCmd
    .command("setup")
    .description("Open the MCP server picker and update the manifest + .env.mcp")
    .action(mcpSetupCommand);
  mcpCmd
    .command("list")
    .description("Show current MCP server configuration plus .env.mcp status")
    .action(mcpListCommand);
  mcpCmd
    .command("remove <id>")
    .description("Remove an MCP server by id")
    .action(mcpRemoveCommand);
  mcpCmd
    .command("env-check")
    .description("Audit .env.mcp for missing required environment variables")
    .action(mcpEnvCheckCommand);

  const cliCmd = program
    .command("cli-tools")
    .description("Manage CLI tool integrations (ripgrep, jq, gh, …)")
    .action(cliToolsCommand);
  cliCmd
    .command("list")
    .description("Show current CLI tool selection plus detection status")
    .action(cliToolsListCommand);
  cliCmd
    .command("install")
    .description("Print install commands for any selected CLI tools missing on PATH")
    .action(cliToolsInstallCommand);
  cliCmd
    .command("detect")
    .description("Read-only detection report for the current CLI tool selection")
    .action(cliToolsDetectCommand);

  // C9-H13: surface the triage-first cost model declared in canonical
  // command frontmatter (triage_tiers + agentPipeline) so users can answer
  // "what will this command cost at each tier?" without running it.
  program
    .command("explain")
    .description("Explain the per-tier cost model of a hatch3r command (reads triage_tiers from frontmatter)")
    .requiredOption("--cost <command-id>", "Command id to explain (e.g. hatch3r-quick-change, quick-change)")
    .option("--input-rate <usd-per-1m>", "Override input rate in USD per 1M tokens")
    .option("--output-rate <usd-per-1m>", "Override output rate in USD per 1M tokens")
    .option("--verbose", "Show detailed output")
    .action(explainCommand);

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
