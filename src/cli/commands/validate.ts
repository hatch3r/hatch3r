import { readdir, readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readManifest } from "../../manifest/hatchJson.js";
import { isValidHookEvent } from "../../hooks/types.js";
import { AGENTS_DIR, HATCH3R_PREFIX, HatchError } from "../../types.js";
import type { HatchManifest } from "../../types.js";
import { scanForDeniedPatterns } from "../../adapters/customization.js";
import { buildContentIndex, validateCrossReferences, validateOrchestrationDependencies } from "../../content/index.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import { readCustomizationWithWarnings } from "../../models/customize.js";
import type { CustomizableType } from "../../models/customize.js";
import { parseEnvFile } from "../../env/mcpEnv.js";
import { detectSecrets } from "../../env/secretDetection.js";
import { runComplianceChecks, formatComplianceReport } from "../../pipeline/complianceVerification.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  warn,
  info,
  setVerbose,
  verbose,
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

async function validateCostTracking(
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.costTracking) return;

  const ct = manifest.costTracking;
  if (ct.sessionBudget !== undefined && ct.sessionBudget <= 0) {
    result.warnings.push("hatch.json: costTracking.sessionBudget should be a positive number");
  }
  if (ct.issueBudget !== undefined && ct.issueBudget <= 0) {
    result.warnings.push("hatch.json: costTracking.issueBudget should be a positive number");
  }
  if (ct.epicBudget !== undefined && ct.epicBudget <= 0) {
    result.warnings.push("hatch.json: costTracking.epicBudget should be a positive number");
  }
  if (ct.warningThresholds) {
    for (const t of ct.warningThresholds) {
      if (t < 0 || t > 1) {
        result.warnings.push(`hatch.json: costTracking.warningThresholds values should be between 0 and 1, got ${t}`);
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

      // Run denied-pattern scan on all free-text string fields
      for (const field of ["description", "scope", "model"] as const) {
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
          if (!allContentIds.has(itemId) && !allContentIds.has(`${HATCH3R_PREFIX}${itemId}`) && !allContentIds.has(`cmd-${itemId}`) && !allContentIds.has(`cmd-${HATCH3R_PREFIX}${itemId}`)) {
            result.warnings.push(`Orphaned customization: .hatch3r/${dir}/${f} (content not in manifest)`);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }

  // Validate learnings: schema, size, encoding, and denied patterns (#19 D15/D6)
  const learningsDir = join(agentsDir, "learnings");
  const learningsResult = await validateLearningsDirectory(learningsDir);
  for (const e of learningsResult.errors) {
    result.errors.push(e);
  }
  for (const w of learningsResult.warnings) {
    result.warnings.push(w);
  }
}

export async function validateDocsCounts(rootDir: string): Promise<{ mismatches: string[]; checked: number }> {
  const mismatches: string[] = [];
  let checked = 0;

  const actual: Record<string, number> = {};
  const dirs: [string, string, (e: string) => boolean][] = [
    ["adapters", join(rootDir, "src/adapters"), (e) => e.endsWith(".ts") && !["base.ts", "index.ts", "canonical.ts", "customization.ts", "types.ts", "mcp-utils.ts", "toml-utils.ts", "contextBudget.ts", "agentsmd.ts"].includes(e)],
    ["commands", join(rootDir, "src/cli/commands"), (e) => e.endsWith(".ts")],
    ["agents", join(rootDir, "agents"), (e) => e.endsWith(".md")],
    ["skills", join(rootDir, "skills"), (e) => true],
    ["rules", join(rootDir, "rules"), (e) => e.endsWith(".md")],
    ["hooks", join(rootDir, "hooks"), (e) => e.endsWith(".md")],
  ];

  for (const [name, dir, filter] of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      if (name === "skills") {
        actual[name] = entries.filter(e => e.isDirectory()).length;
      } else {
        actual[name] = entries.filter(e => e.isFile() && filter(e.name)).length;
      }
    } catch { actual[name] = 0; }
  }

  const readmePath = join(rootDir, "README.md");
  try {
    const readme = await readFile(readmePath, "utf-8");
    const countPatterns: [string, RegExp][] = [
      ["adapters", /(\d+)\s+Adapters/i],
      ["skills", /(\d+)\s+skills/i],
      ["rules", /(\d+)\s+rules/i],
    ];
    for (const [name, pattern] of countPatterns) {
      const match = readme.match(pattern);
      if (match) {
        checked++;
        const documented = parseInt(match[1], 10);
        if (documented !== actual[name]) {
          mismatches.push(`${name}: README says ${documented}, actual is ${actual[name]}`);
        }
      }
    }
  } catch { /* README not found */ }

  return { mismatches, checked };
}

export async function validateCommand(opts?: { docs?: boolean; verbose?: boolean }): Promise<void> {
  setVerbose(!!opts?.verbose);
  printBanner(true);

  const rootDir = process.cwd();

  if (opts?.docs) {
    const spinner = createSpinner("Verifying documentation counts...");
    spinner.start();
    const { mismatches, checked } = await validateDocsCounts(rootDir);
    if (mismatches.length > 0) {
      spinner.fail("Documentation count mismatches found");
      for (const m of mismatches) logError(m);
      throw new HatchError("Documentation counts do not match", 1, "VALIDATION_ERROR");
    }
    spinner.succeed(`Documentation counts verified (${checked} checks, 0 mismatches)`);
    return;
  }
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
    throw new HatchError(".agents/ directory not found.", 1, "CONFIG_ERROR");
  }

  const manifest = await readManifest(rootDir);

  verbose("Checking manifest...");
  await validateManifest(rootDir, manifest, result);
  verbose("Checking directory structure...");
  await validateDirectories(agentsDir, result);
  verbose("Checking frontmatter...");
  await validateFrontmatter(agentsDir, result);

  if (manifest) {
    verbose("Checking file prefixes...");
    await validateManagedFilePrefixes(manifest, result);
    verbose("Checking hooks...");
    await validateHooks(agentsDir, manifest, result);
    verbose("Checking MCP configuration...");
    await validateMcp(agentsDir, manifest, result);
    verbose("Checking model configuration...");
    await validateModels(manifest, result);
    verbose("Checking cost tracking...");
    await validateCostTracking(manifest, result);
    verbose("Checking customizations...");
    await validateCustomizations(rootDir, agentsDir, manifest, result);
    await validateCustomizeYaml(rootDir, result);
    verbose("Checking content consistency...");
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
    } catch (err) {
      // #252 (D8-8.19): Log content scanning errors instead of silently swallowing them.
      // This helps diagnose broken cross-references or index build failures.
      result.warnings.push(
        `Content scanning failed — cross-reference and collision validation skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Orchestration dependency validation: check required agents are selected
    if (manifest.content) {
      const orchWarnings = validateOrchestrationDependencies(manifest.content);
      for (const w of orchWarnings) {
        result.warnings.push(w);
      }
    }

    // Secret detection in .env.mcp (#82 D15)
    await validateEnvMcpSecrets(rootDir, result);
  }

  // Security compliance verification (#86 D15)
  await validateSecurityCompliance(result);

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
    throw new HatchError("Validation failed", 1, "VALIDATION_ERROR");
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
 * Scan .env.mcp for accidentally committed secrets (#82 D15).
 */
async function validateEnvMcpSecrets(
  rootDir: string,
  result: ValidationResult,
): Promise<void> {
  const envMcpPath = join(rootDir, ".env.mcp");
  if (!existsSync(envMcpPath)) return;

  try {
    const raw = await readFile(envMcpPath, "utf-8");
    const vars = parseEnvFile(raw);
    const detection = detectSecrets(vars);

    for (const finding of detection.findings) {
      const msg =
        `Secret detected in .env.mcp: ${finding.variableName} contains a ${finding.secretType} ` +
        `(${finding.maskedValue}). ${finding.guidance}`;
      if (finding.severity === "critical") {
        result.errors.push(msg);
      } else {
        result.warnings.push(msg);
      }
    }
  } catch {
    // File unreadable — skip silently
  }
}

/**
 * Run security compliance checks and fold results into validation (#86 D15).
 */
async function validateSecurityCompliance(result: ValidationResult): Promise<void> {
  const report = await runComplianceChecks();

  for (const check of report.checks) {
    if (check.status === "fail") {
      result.errors.push(
        `Security compliance [${check.controlRef}]: ${check.description}` +
        (check.detail ? ` — ${check.detail}` : ""),
      );
    } else if (check.status === "warn") {
      result.warnings.push(
        `Security compliance [${check.controlRef}]: ${check.description}` +
        (check.detail ? ` — ${check.detail}` : ""),
      );
    }
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
  console.log(chalk.dim("  2. Managed blocks: Sections between <!-- HATCH3R:BEGIN --> and"));
  console.log(chalk.dim("     <!-- HATCH3R:END --> are auto-updated. Add content outside these markers."));
  console.log(chalk.dim("  3. .customize.yaml/.md: Place in .hatch3r/{type}/ to override model, scope,"));
  console.log(chalk.dim("     description, or disable items. Use .customize.md for content additions."));
  console.log(chalk.dim("  See: https://docs.hatch3r.com/docs/guides/customization"));
}
