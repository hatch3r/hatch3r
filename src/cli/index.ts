import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";
import { statusCommand } from "./commands/status.js";
import { HATCH3R_VERSION } from "../version.js";

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
    "Comma-separated tools (cursor,copilot,claude,opencode,windsurf,amp,codex,gemini,cline)",
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
  .option("--backup", "Create backups before overwriting", true)
  .action(updateCommand);

program
  .command("validate")
  .description("Validate the canonical .agents/ structure")
  .action(validateCommand);

program
  .command("add [pack]")
  .description("Install a community pack (coming soon)")
  .action(addCommand);

program.parse();
