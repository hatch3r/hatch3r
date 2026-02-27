import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { AGENTS_DIR } from "../../types.js";
import { ensureEnvMcp, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, CANONICAL_AGENTS_MD } from "../shared/agentsContent.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  step,
  warn,
} from "../shared/ui.js";

export async function syncCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    process.exit(1);
  }

  const m = manifest;
  const results: { path: string; action: string }[] = [];
  const totalSteps = m.tools.length + 1;
  let currentStep = 0;

  const s1 = createSpinner(step(++currentStep, totalSteps, "Syncing AGENTS.md..."));
  s1.start();
  const agentsMdResult = await safeWriteFile(join(rootDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
  });
  results.push({ path: "AGENTS.md", action: agentsMdResult.action });
  await writeFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD, "utf-8");
  results.push({ path: `${AGENTS_DIR}/AGENTS.md`, action: "updated" });
  s1.succeed(step(currentStep, totalSteps, "AGENTS.md synced"));

  for (const tool of m.tools) {
    const s = createSpinner(step(++currentStep, totalSteps, `Generating ${tool} output...`));
    s.start();
    try {
      const adapter = getAdapter(tool);
      const outputs = await adapter.generate(agentsDir, m);
      for (const out of outputs) {
        const fullPath = join(rootDir, out.path);
        if (out.managedContent) {
          const result = await safeWriteFile(fullPath, out.content, {
            managedContent: out.managedContent,
          });
          results.push({ path: out.path, action: result.action });
        } else {
          await mkdir(dirname(fullPath), { recursive: true });
          let action: string;
          try {
            const existing = await readFile(fullPath, "utf-8");
            if (existing === out.content) {
              action = "skipped";
            } else {
              await writeFile(fullPath, out.content, "utf-8");
              action = "updated";
            }
          } catch {
            await writeFile(fullPath, out.content, "utf-8");
            action = "created";
          }
          results.push({ path: out.path, action });
        }
      }
      s.succeed(step(currentStep, totalSteps, `${tool} output generated`));
    } catch (err) {
      s.fail(step(currentStep, totalSteps, `Failed to generate ${tool} output`));
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (m.features.mcp && m.mcp.servers.length > 0) {
    const envResult = await ensureEnvMcp(rootDir, m.mcp.servers);
    if (envResult.action !== "skipped") {
      results.push({ path: envResult.path, action: envResult.action });
    }
    if (envResult.newVars.length > 0) {
      warn(
        `New secrets needed in .env.mcp: ${envResult.newVars.join(", ")}`,
      );
      info(`Run this, then start or restart your editor: ${getSourceEnvMcpCommand()}`);
    }
  }

  console.log();

  const icons: Record<string, string> = {
    created: chalk.green("+"),
    updated: chalk.yellow("~"),
    skipped: chalk.dim("="),
  };

  const summaryLines = results.map((r) => {
    const icon = icons[r.action] ?? chalk.dim(" ");
    return `${icon} ${r.path} ${chalk.dim(`(${r.action})`)}`;
  });

  printBox("Sync complete", summaryLines, "success");
}
