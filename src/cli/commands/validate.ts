import { readdir, readFile, access } from "node:fs/promises";
import { join, posix } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readManifest } from "../../manifest/hatchJson.js";
import { AGENTS_DIR, HATCH3R_PREFIX } from "../../types.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  warn,
} from "../shared/ui.js";

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export async function validateCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const result: ValidationResult = { errors: [], warnings: [] };

  const spinner = createSpinner("Validating .agents/ structure...");
  spinner.start();

  try {
    await access(agentsDir);
  } catch {
    spinner.fail("Validation failed");
    logError(".agents/ directory not found. Run `hatch3r init` first.");
    console.log();
    process.exit(1);
  }

  const manifest = await readManifest(rootDir);
  if (!manifest) {
    result.errors.push("Missing .agents/hatch.json manifest");
  } else {
    if (!manifest.version) result.errors.push("hatch.json: missing 'version' field");
    if (!manifest.tools || manifest.tools.length === 0) result.warnings.push("hatch.json: no tools configured");

    for (const managedFile of manifest.managedFiles ?? []) {
      try {
        await access(join(rootDir, managedFile));
      } catch {
        result.warnings.push(`Managed file missing from disk: ${managedFile}`);
      }
    }
  }

  const requiredDirs = ["agents", "skills", "rules"];
  const optionalDirs = ["commands", "prompts", "mcp", "policy", "github-agents"];

  for (const dir of requiredDirs) {
    try {
      await access(join(agentsDir, dir));
    } catch {
      result.errors.push(`Required directory missing: .agents/${dir}/`);
    }
  }

  for (const dir of optionalDirs) {
    try {
      await access(join(agentsDir, dir));
    } catch {
      result.warnings.push(`Optional directory missing: .agents/${dir}/`);
    }
  }

  for (const dir of [...requiredDirs, ...optionalDirs]) {
    const dirPath = join(agentsDir, dir);
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const filePath = join(dirPath, entry.name);
          const content = await readFile(filePath, "utf-8");
          if (!content.startsWith("---")) {
            result.warnings.push(`Missing frontmatter: .agents/${dir}/${entry.name}`);
          } else {
            const endIdx = content.indexOf("---", 3);
            if (endIdx === -1) {
              result.errors.push(`Invalid frontmatter (no closing ---): .agents/${dir}/${entry.name}`);
            } else {
              const frontmatter = content.slice(3, endIdx).trim();
              const parsedFm = parseYaml(frontmatter) as Record<string, unknown> | null;
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm.id) {
                result.warnings.push(`Missing 'id' in frontmatter: .agents/${dir}/${entry.name}`);
              }
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm.type) {
                result.warnings.push(`Missing 'type' in frontmatter: .agents/${dir}/${entry.name}`);
              }
            }
          }
        } else if (entry.isDirectory()) {
          const skillPath = join(dirPath, entry.name, "SKILL.md");
          try {
            await access(skillPath);
          } catch {
            result.warnings.push(`Skill directory missing SKILL.md: .agents/${dir}/${entry.name}/`);
          }
        }
      }
    } catch {
      // already reported
    }
  }

  try {
    await access(join(agentsDir, "AGENTS.md"));
  } catch {
    result.warnings.push("Missing .agents/AGENTS.md");
  }

  if (manifest) {
    for (const managedFile of manifest.managedFiles ?? []) {
      const fileName = posix.basename(managedFile) || "";
      const isSharedFile = ["AGENTS.md", "CLAUDE.md", "copilot-instructions.md", ".windsurfrules", "mcp.json", "opencode.json", ".mcp.json", "copilot-setup-steps.yml", "settings.json"].some(
        (sf) => fileName === sf || managedFile.endsWith(sf),
      );
      if (!isSharedFile && !fileName.startsWith(HATCH3R_PREFIX) && !fileName.startsWith(".")) {
        result.warnings.push(`Managed file without hatch3r- prefix: ${managedFile}`);
      }
    }

    if (manifest.features.hooks) {
      const hooksDir = join(agentsDir, "hooks");
      try {
        const hookFiles = await readdir(hooksDir);
        const mdHooks = hookFiles.filter(f => f.endsWith(".md"));
        if (mdHooks.length === 0) {
          result.warnings.push("Hooks feature enabled but no hook definitions found in .agents/hooks/");
        }

        let agentFiles: Set<string> | undefined;
        try {
          const agentEntries = await readdir(join(agentsDir, "agents"));
          agentFiles = new Set(agentEntries.filter(f => f.endsWith(".md")));
        } catch {
          // agents dir unreadable; skip agent-ref validation
        }

        for (const hookFile of mdHooks) {
          const hookContent = await readFile(join(hooksDir, hookFile), "utf-8");
          if (!hookContent.startsWith("---")) {
            result.warnings.push(`Hook missing frontmatter: .agents/hooks/${hookFile}`);
            continue;
          }
          const endIdx = hookContent.indexOf("---", 3);
          if (endIdx === -1) continue;
          const fm = parseYaml(hookContent.slice(3, endIdx).trim()) as Record<string, unknown> | null;
          if (fm?.agent && typeof fm.agent === "string" && agentFiles) {
            const expectedFile = `${HATCH3R_PREFIX}${fm.agent}.md`;
            if (!agentFiles.has(expectedFile)) {
              result.errors.push(`Hook "${hookFile}" references agent "${fm.agent}" but .agents/agents/${expectedFile} does not exist`);
            }
          }
        }
      } catch {
        result.warnings.push("Hooks feature enabled but .agents/hooks/ directory not found");
      }
    }

    if (manifest.features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpContent = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpContent);
        if (!mcpParsed.mcpServers || typeof mcpParsed.mcpServers !== "object") {
          result.errors.push("MCP config missing 'mcpServers' key");
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          result.errors.push("Invalid JSON in .agents/mcp/mcp.json");
        } else {
          result.warnings.push("MCP servers configured but .agents/mcp/mcp.json not found");
        }
      }
    }

    if (manifest.models) {
      if (manifest.models.default && typeof manifest.models.default !== "string") {
        result.errors.push("hatch.json: models.default must be a string");
      }
      if (manifest.models.agents) {
        for (const [agentId, model] of Object.entries(manifest.models.agents)) {
          if (typeof model !== "string") {
            result.errors.push(`hatch.json: models.agents.${agentId} must be a string`);
          }
        }
      }
    }

    const customizeDir = join(rootDir, ".hatch3r", "agents");
    try {
      const customizeFiles = await readdir(customizeDir);
      for (const file of customizeFiles) {
        if (file.endsWith(".customize.yaml")) {
          const agentId = file.replace(".customize.yaml", "");
          const agentFile = join(agentsDir, "agents", `${agentId}.md`);
          try {
            await access(agentFile);
          } catch {
            result.warnings.push(`Customization file for non-existent agent: .hatch3r/agents/${file}`);
          }
        }
      }
    } catch {
      // No customization directory
    }
  }

  spinner.stop();

  if (result.errors.length === 0 && result.warnings.length === 0) {
    printBox("Validation", [chalk.green("All checks passed")], "success");
    return;
  }

  console.log();

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      logError(err);
    }
    console.log();
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      warn(w);
    }
    console.log();
  }

  if (result.errors.length > 0) {
    const summaryLines = [
      `${chalk.red("✖")} ${result.errors.length} error(s)`,
      `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
    ];
    printBox("Validation failed", summaryLines, "error");
    process.exit(1);
  } else {
    const summaryLines = [
      `${chalk.green("✔")} 0 errors`,
      `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
    ];
    printBox("Validation passed", summaryLines, "success");
  }
}
