import { Command } from "commander";
import { addCommand } from "./commands/add.js";
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
  .description("Install a complete agent setup into the current repo")
  .option(
    "--tools <tools>",
    `Comma-separated tools (${TOOL_CHOICES})`,
  )
  .option("--yes", "Skip interactive prompts, use defaults")
  .action(initCommand);

program
  .command("sync")
  .description("Re-generate tool outputs from canonical .agents/ state")
  .action(syncCommand);

program
  .command("status")
  .description("Check sync status between canonical .agents/ and generated files")
  .action(statusCommand);

program
  .command("update")
  .description("Pull latest hatch3r templates with safe merge")
  .action(updateCommand);

program
  .command("validate")
  .description("Validate the canonical .agents/ structure")
  .action(validateCommand);

program
  .command("verify")
  .description("Verify integrity of canonical agent files")
  .action(verifyCommand);

program
  .command("config")
  .description("Reconfigure tools, MCP servers, features, and platform")
  .action(configCommand);

program
  .command("add [pack]")
  .description("Install a community pack (coming soon)")
  .action(addCommand);

const nodeVersion = parseInt(process.version.slice(1), 10);
if (nodeVersion < 22) {
  console.error(
    `hatch3r requires Node.js >= 22.0.0 (current: ${process.version}). Please upgrade Node.js.`,
  );
  process.exit(1);
}

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof HatchError) {
    process.exit(err.exitCode);
  }
  console.error(
    `\nhatch3r encountered an unexpected error: ${err instanceof Error ? err.message : String(err)}`,
  );
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(1);
}
