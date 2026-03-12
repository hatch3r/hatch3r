// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

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
  .option("--preset <preset>", "Content preset: minimal, standard, full")
  .option("--project-type <type>", "Project type: greenfield, brownfield")
  .option("--team-size <size>", "Team size: solo, team")
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

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Allow pending writes to flush
    process.stdout.write("", () => {
      process.stderr.write("", () => {
        process.exit(0);
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
  console.error("  For help, see: https://hatch3r.dev/docs/troubleshooting");
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(isUsageError ? 2 : 1);
}
