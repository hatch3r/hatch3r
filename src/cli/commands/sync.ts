import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { AGENTS_DIR, HatchError } from "../../types.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, CANONICAL_AGENTS_MD } from "../shared/agentsContent.js";
import { verifyIntegrity } from "../../integrity/index.js";
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
    throw new HatchError("No .agents/hatch.json found.", 1);
  }

  const m = manifest;

  const integrityResults = await verifyIntegrity(agentsDir);
  const modified = integrityResults.filter((r) => r.status === "modified");
  const missing = integrityResults.filter((r) => r.status === "missing");
  if (modified.length > 0 || missing.length > 0) {
    warn("Integrity issues detected in canonical files:");
    for (const r of modified) {
      warn(`  MODIFIED: ${r.file}`);
    }
    for (const r of missing) {
      warn(`  MISSING:  ${r.file}`);
    }
    warn("These files may have been tampered with. Syncing will propagate their current content.");
    console.log();
  }

  const results: { path: string; action: string }[] = [];
  const totalSteps = m.tools.length + 1;
  let currentStep = 0;

  const s1 = createSpinner(step(++currentStep, totalSteps, "Syncing AGENTS.md..."));
  s1.start();
  const agentsMdResult = await safeWriteFile(join(rootDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
    backup: true,
  });
  if (agentsMdResult.warning) warn(agentsMdResult.warning);
  results.push({ path: "AGENTS.md", action: agentsMdResult.action });
  const canonicalResult = await safeWriteFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD, { backup: true });
  if (canonicalResult.warning) warn(canonicalResult.warning);
  results.push({ path: `${AGENTS_DIR}/AGENTS.md`, action: canonicalResult.action });
  s1.succeed(step(currentStep, totalSteps, "AGENTS.md synced"));

  const adapterFailures: { tool: string; error: string }[] = [];
  for (const tool of m.tools) {
    const s = createSpinner(step(++currentStep, totalSteps, `Generating ${tool} output...`));
    s.start();
    try {
      const adapter = getAdapter(tool);
      const outputs = await adapter.generate(agentsDir, m);
      for (const w of adapter.warnings) { warn(w); }
      for (const out of outputs) {
        const fullPath = join(rootDir, out.path);
        if (out.managedContent) {
          const result = await safeWriteFile(fullPath, out.content, {
            managedContent: out.managedContent,
            backup: true,
          });
          if (result.warning) warn(result.warning);
          results.push({ path: out.path, action: result.action });
        } else {
          const result = await safeWriteFile(fullPath, out.content, { backup: true });
          if (result.warning) warn(result.warning);
          results.push({ path: out.path, action: result.action });
        }
      }
      s.succeed(step(currentStep, totalSteps, `${tool} output generated`));
    } catch (err) {
      s.fail(step(currentStep, totalSteps, `Failed to generate ${tool} output`));
      adapterFailures.push({
        tool,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === m.tools.length) {
      throw new HatchError("All adapters failed", 1);
    }
  }

  for (const tool of m.tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, m);
    for (const w of warnings) {
      warn(w);
    }
  }

  if (m.features.mcp && m.mcp.servers.length > 0) {
    const envResult = await ensureEnvMcp(rootDir, m.mcp.servers);
    await ensureGitignoreEntry(rootDir);
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
