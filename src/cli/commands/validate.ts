import { readdir, readFile, access } from "node:fs/promises";
import { join, posix } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readManifest } from "../../manifest/hatchJson.js";
import { isValidHookEvent } from "../../hooks/types.js";
import { AGENTS_DIR, HATCH3R_PREFIX, HatchError } from "../../types.js";
import type { HatchManifest } from "../../types.js";
import { scanForDeniedPatterns } from "../../adapters/customization.js";
import { buildContentIndex, validateCrossReferences, validateOrchestrationDependencies } from "../../content/index.js";
import { readCustomizationWithWarnings } from "../../models/customize.js";
import type { CustomizableType } from "../../models/customize.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  warn,
  info,
} from "../shared/ui.js";

// Default fallback set; overridden by manifest.content when available
const DEFAULT_KNOWN_AGENTS = new Set([
  "hatch3r-a11y-auditor", "hatch3r-architect", "hatch3r-ci-watcher", "hatch3r-context-rules",
  "hatch3r-dependency-auditor", "hatch3r-devops", "hatch3r-docs-writer", "hatch3r-fixer",
  "hatch3r-implementer", "hatch3r-learnings-loader", "hatch3r-lint-fixer", "hatch3r-perf-profiler",
  "hatch3r-researcher", "hatch3r-reviewer", "hatch3r-security-auditor", "hatch3r-test-writer",
]);

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const CUSTOMIZATION_TYPES = [
  { dir: "agents", canonical: "agents" },
  { dir: "commands", canonical: "commands" },
  { dir: "skills", canonical: "skills" },
  { dir: "rules", canonical: "rules" },
];

async function validateManifest(
  rootDir: string,
  manifest: HatchManifest | null,
  result: ValidationResult,
): Promise<void> {
  if (!manifest) {
    result.errors.push("Missing .agents/hatch.json manifest");
    return;
  }
  if (!manifest.version) result.errors.push("hatch.json: missing 'version' field");
  if (!manifest.tools || manifest.tools.length === 0) result.warnings.push("hatch.json: no tools configured");

  for (const managedFile of manifest.managedFiles ?? []) {
    try {
      await access(join(rootDir, managedFile));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      result.warnings.push(`Managed file missing from disk: ${managedFile}`);
    }
  }
}

async function validateDirectories(
  agentsDir: string,
  result: ValidationResult,
): Promise<void> {
  const requiredDirs = ["agents", "skills", "rules"];
  const optionalDirs = ["commands", "prompts", "mcp", "policy", "github-agents"];

  for (const dir of requiredDirs) {
    try {
      await access(join(agentsDir, dir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      result.errors.push(`Required directory missing: .agents/${dir}/`);
    }
  }

  for (const dir of optionalDirs) {
    try {
      await access(join(agentsDir, dir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      result.warnings.push(`Optional directory missing: .agents/${dir}/`);
    }
  }
}

async function validateFrontmatter(
  agentsDir: string,
  result: ValidationResult,
): Promise<void> {
  const requiredDirs = ["agents", "skills", "rules"];
  const optionalDirs = ["commands", "prompts", "mcp", "policy", "github-agents"];

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
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            result.warnings.push(`Skill directory missing SKILL.md: .agents/${dir}/${entry.name}/`);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  try {
    await access(join(agentsDir, "AGENTS.md"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    result.warnings.push("Missing .agents/AGENTS.md");
  }
}

async function validateManagedFilePrefixes(
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  for (const managedFile of manifest.managedFiles ?? []) {
    const fileName = posix.basename(managedFile) || "";
    const isSharedFile = ["AGENTS.md", "CLAUDE.md", "copilot-instructions.md", ".windsurfrules", "mcp.json", "opencode.json", ".mcp.json", "copilot-setup-steps.yml", "settings.json"].some(
      (sf) => fileName === sf || managedFile.endsWith(sf),
    );
    if (!isSharedFile && !fileName.startsWith(HATCH3R_PREFIX) && !fileName.startsWith(".")) {
      result.warnings.push(`Managed file without hatch3r- prefix: ${managedFile}`);
    }
  }
}

async function validateHooks(
  agentsDir: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.features.hooks) return;

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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
      if (fm?.event && typeof fm.event === "string") {
        if (!isValidHookEvent(fm.event)) {
          result.errors.push(`Hook "${hookFile}" has invalid event "${fm.event}". Valid events: pre-commit, post-merge, ci-failure, file-save, session-start, pre-push`);
        }
      }
      if (fm?.agent && typeof fm.agent === "string" && agentFiles) {
        const agentName = typeof fm.agent === "string" && fm.agent.startsWith(HATCH3R_PREFIX)
          ? fm.agent
          : `${HATCH3R_PREFIX}${fm.agent}`;
        const expectedFile = `${agentName}.md`;
        if (!agentFiles.has(expectedFile)) {
          result.errors.push(`Hook "${hookFile}" references agent "${fm.agent}" but .agents/agents/${expectedFile} does not exist`);
        }
        // Build known agents set from manifest content or fallback
        const knownAgents = manifest.content
          ? new Set(manifest.content.items.agents)
          : DEFAULT_KNOWN_AGENTS;
        if (!knownAgents.has(agentName)) {
          result.warnings.push(`Hook "${hookFile}" references agent "${fm.agent}" which is not in the standard hatch3r agent roster`);
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    result.warnings.push("Hooks feature enabled but .agents/hooks/ directory not found");
  }
}

async function validateMcp(
  agentsDir: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.features.mcp || manifest.mcp.servers.length === 0) return;

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

async function validateModels(
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.models) return;

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

/**
 * Validate .customize.yaml files for syntax and known field usage.
 * Checks that YAML parses correctly, uses only recognized fields,
 * and that field values have the expected types.
 */
async function validateCustomizeYaml(
  rootDir: string,
  result: ValidationResult,
): Promise<void> {
  const VALID_FIELDS = new Set(["model", "scope", "description", "enabled"]);
  const FIELD_TYPES: Record<string, string> = {
    model: "string",
    scope: "string",
    description: "string",
    enabled: "boolean",
  };

  for (const { dir } of CUSTOMIZATION_TYPES) {
    const customDir = join(rootDir, ".hatch3r", dir);
    let files: string[];
    try {
      files = await readdir(customDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }

    const yamlFiles = files.filter(f => f.endsWith(".customize.yaml"));
    for (const file of yamlFiles) {
      const filePath = join(customDir, file);
      const itemId = file.replace(".customize.yaml", "");

      let raw: string;
      try {
        raw = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      // Check size limit (same as customize.ts: 10KB)
      if (Buffer.byteLength(raw, "utf-8") > 10_240) {
        result.warnings.push(
          `.customize.yaml for "${itemId}" exceeds 10KB limit and will be skipped during generation`,
        );
        continue;
      }

      // Check YAML syntax
      let parsed: Record<string, unknown> | null;
      try {
        parsed = parseYaml(raw) as Record<string, unknown> | null;
      } catch {
        result.errors.push(
          `Invalid YAML syntax in .hatch3r/${dir}/${file}`,
        );
        continue;
      }

      if (!parsed || typeof parsed !== "object") {
        result.warnings.push(
          `.customize.yaml for "${itemId}" is empty or not an object`,
        );
        continue;
      }

      // Check for unknown fields
      for (const key of Object.keys(parsed)) {
        if (!VALID_FIELDS.has(key)) {
          result.warnings.push(
            `.hatch3r/${dir}/${file}: unknown field "${key}" (valid: ${[...VALID_FIELDS].join(", ")})`,
          );
        }
      }

      // Check field types
      for (const [key, expectedType] of Object.entries(FIELD_TYPES)) {
        if (key in parsed && parsed[key] !== undefined && parsed[key] !== null) {
          const actualType = typeof parsed[key];
          if (actualType !== expectedType) {
            result.warnings.push(
              `.hatch3r/${dir}/${file}: field "${key}" should be ${expectedType} but is ${actualType}`,
            );
          }
        }
      }

      // Run denied-pattern scan on string fields
      for (const field of ["description", "scope"] as const) {
        const value = parsed[field];
        if (typeof value === "string") {
          const violations = scanForDeniedPatterns(value);
          for (const v of violations) {
            result.warnings.push(
              `.hatch3r/${dir}/${file}: field "${field}" contains denied pattern: ${v}`,
            );
          }
        }
      }

      // Validate the customization through the canonical reader for deeper checks
      const type = dir as CustomizableType;
      const readResult = await readCustomizationWithWarnings(rootDir, type, itemId);
      for (const w of readResult.warnings) {
        result.warnings.push(w);
      }
    }
  }
}

async function validateCustomizations(
  rootDir: string,
  agentsDir: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  for (const { dir, canonical } of CUSTOMIZATION_TYPES) {
    const customDir = join(rootDir, ".hatch3r", dir);
    try {
      const customFiles = await readdir(customDir);
      for (const file of customFiles) {
        if (file.endsWith(".customize.yaml")) {
          const itemId = file.replace(".customize.yaml", "");
          const canonicalPath = canonical === "skills"
            ? join(agentsDir, canonical, itemId)
            : join(agentsDir, canonical, `${itemId}.md`);
          try {
            await access(canonicalPath);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            result.warnings.push(`Customization file for non-existent ${canonical.slice(0, -1)}: .hatch3r/${dir}/${file}`);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

async function validateContentConsistency(
  rootDir: string,
  agentsDir: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  // Content consistency: manifest items vs disk
  if (manifest.content) {
    const contentDirs: Record<keyof typeof manifest.content.items, { dir: string; strategy: "glob" | "subdir" }> = {
      agents: { dir: "agents", strategy: "glob" },
      skills: { dir: "skills", strategy: "subdir" },
      rules: { dir: "rules", strategy: "glob" },
      commands: { dir: "commands", strategy: "glob" },
      prompts: { dir: "prompts", strategy: "glob" },
      hooks: { dir: "hooks", strategy: "glob" },
      githubAgents: { dir: "github-agents", strategy: "glob" },
    };
    for (const [key, cfg] of Object.entries(contentDirs)) {
      const ids = manifest.content.items[key as keyof typeof manifest.content.items];
      for (const id of ids) {
        const checkPath = cfg.strategy === "subdir"
          ? join(agentsDir, cfg.dir, id, "SKILL.md")
          : join(agentsDir, cfg.dir, `${id}.md`);
        try {
          await access(checkPath);
        } catch {
          result.warnings.push(`Content "${id}" (${key}) in manifest but missing from .agents/${cfg.dir}/`);
        }
      }
    }

    // Orphaned customize files
    const allContentIds = new Set<string>();
    for (const ids of Object.values(manifest.content.items)) {
      for (const id of ids) allContentIds.add(id);
    }
    for (const { dir } of CUSTOMIZATION_TYPES) {
      const customDir = join(rootDir, ".hatch3r", dir);
      try {
        const files = await readdir(customDir);
        for (const f of files.filter(f => f.endsWith(".customize.yaml") || f.endsWith(".customize.md"))) {
          const itemId = f.replace(/\.customize\.(yaml|md)$/, "");
          if (!allContentIds.has(itemId) && !allContentIds.has(`${HATCH3R_PREFIX}${itemId}`)) {
            result.warnings.push(`Orphaned customization: .hatch3r/${dir}/${f} (content not in manifest)`);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }

  // Validate learnings for denied patterns
  const learningsDir = join(agentsDir, "learnings");
  try {
    const learningFiles = await readdir(learningsDir);
    const mdFiles = learningFiles.filter(f => f.endsWith(".md"));
    for (const file of mdFiles) {
      const content = await readFile(join(learningsDir, file), "utf-8");
      const violations = scanForDeniedPatterns(content);
      if (violations.length > 0) {
        for (const v of violations) {
          result.warnings.push(`Learning file "${file}" contains suspicious content: ${v}`);
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    spinner.fail("Validation failed");
    logError(".agents/ directory not found. Run `hatch3r init` first.");
    console.log();
    throw new HatchError(".agents/ directory not found.", 1);
  }

  const manifest = await readManifest(rootDir);

  await validateManifest(rootDir, manifest, result);
  await validateDirectories(agentsDir, result);
  await validateFrontmatter(agentsDir, result);

  if (manifest) {
    await validateManagedFilePrefixes(manifest, result);
    await validateHooks(agentsDir, manifest, result);
    await validateMcp(agentsDir, manifest, result);
    await validateModels(manifest, result);
    await validateCustomizations(rootDir, agentsDir, manifest, result);
    await validateCustomizeYaml(rootDir, result);
    await validateContentConsistency(rootDir, agentsDir, manifest, result);

    // Cross-reference validation: check that installed content doesn't have broken references
    try {
      const index = await buildContentIndex(agentsDir);
      if (index.items.length > 0) {
        const crossRefResult = await validateCrossReferences(agentsDir, index);
        for (const w of crossRefResult.warnings) {
          result.warnings.push(w);
        }
      }

      // Content ID collision validation
      // Expected: command/skill cross-type pairs (by design, commands and skills share IDs)
      // Unexpected: same-type duplicates, or cross-type pairs that aren't command↔skill
      const EXPECTED_CROSS_TYPE_PAIRS = new Set(["command", "skill"]);
      for (const collision of index.collisions) {
        if (collision.kind === "cross-type") {
          const types = new Set([collision.existingType, collision.duplicateType]);
          if (types.size === 2 && [...types].every(t => EXPECTED_CROSS_TYPE_PAIRS.has(t))) {
            // Expected command/skill collision — skip
            continue;
          }
        }
        result.warnings.push(
          `Content ID collision: "${collision.id}" exists as ${collision.existingType} (${collision.existingPath}) and ${collision.duplicateType} (${collision.duplicatePath})`,
        );
      }
    } catch {
      // Content scanning failed — skip cross-ref and collision validation
    }

    // Orchestration dependency validation: check required agents are selected
    if (manifest.content) {
      const orchWarnings = validateOrchestrationDependencies(manifest.content);
      for (const w of orchWarnings) {
        result.warnings.push(w);
      }
    }
  }

  spinner.stop();

  // Detect if customization files exist for contextual help (#56 D19-4)
  let hasCustomizations = false;
  for (const { dir } of CUSTOMIZATION_TYPES) {
    try {
      const files = await readdir(join(rootDir, ".hatch3r", dir));
      if (files.some(f => f.endsWith(".customize.yaml") || f.endsWith(".customize.md"))) {
        hasCustomizations = true;
        break;
      }
    } catch {
      // directory doesn't exist
    }
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    printBox("Validation", [chalk.green("All checks passed")], "success");
    if (hasCustomizations) {
      printCustomizationHint();
    }
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
    throw new HatchError("Validation failed", 1);
  } else {
    const summaryLines = [
      `${chalk.green("✔")} 0 errors`,
      `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
    ];
    printBox("Validation passed", summaryLines, "success");
  }

  if (hasCustomizations) {
    printCustomizationHint();
  }
}

/**
 * Print a contextual explanation of the three customization mechanisms
 * when customization files are detected (D19-4).
 */
function printCustomizationHint(): void {
  console.log();
  info(chalk.bold("Customization mechanisms detected. Quick reference:"));
  console.log(chalk.dim("  1. hatch3r- prefix: Files prefixed with hatch3r- are managed by hatch3r and"));
  console.log(chalk.dim("     overwritten on update. Do not edit these directly."));
  console.log(chalk.dim("  2. Managed blocks: Sections between <!-- MANAGED-BLOCK:BEGIN --> and"));
  console.log(chalk.dim("     <!-- MANAGED-BLOCK:END --> are auto-updated. Add content outside these markers."));
  console.log(chalk.dim("  3. .customize.yaml/.md: Place in .hatch3r/{type}/ to override model, scope,"));
  console.log(chalk.dim("     description, or disable items. Use .customize.md for content additions."));
  console.log(chalk.dim("  See: https://docs.hatch3r.com/docs/guides/customization"));
}
