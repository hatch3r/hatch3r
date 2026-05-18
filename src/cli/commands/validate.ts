import { readdir, readFile, access, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readManifest } from "../../manifest/hatchJson.js";
import { isValidHookEvent } from "../../hooks/types.js";
import { AGENTS_DIR, HATCH3R_PREFIX, HatchError } from "../../types.js";
import type { HatchManifest } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { scanForDeniedPatterns } from "../../adapters/customization.js";
import { buildContentIndex, validateCrossReferences, validateOrchestrationDependencies, resolveUserContentRoot } from "../../content/index.js";
import type { CatalogItem, ContentIndex } from "../../content/index.js";
import { findPackageRoot } from "../shared/paths.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import { validateHandoffsDirectory } from "../../content/handoffs/index.js";
import { readCustomizationWithWarnings } from "../../models/customize.js";
import type { CustomizableType } from "../../models/customize.js";
import { parseEnvFile } from "../../env/mcpEnv.js";
import { detectSecrets } from "../../env/secretDetection.js";
import { runComplianceChecks, formatComplianceReport } from "../../pipeline/complianceVerification.js";
import { detectCliTools } from "../../cliTools/detect.js";
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
  "hatch3r-handoff-loader", "hatch3r-handoff-preparer",
  "hatch3r-implementer", "hatch3r-learnings-loader", "hatch3r-lint-fixer", "hatch3r-perf-profiler",
  "hatch3r-researcher", "hatch3r-reviewer", "hatch3r-security-auditor", "hatch3r-test-writer",
]);

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

// Phase H: verbose-only warning channel. Mirrors verbose() in shared/ui.ts
// to demote over-zealous validators without losing signal under --verbose.
let verboseWarnEnabled = false;
function setVerboseWarnEnabled(enabled: boolean): void { verboseWarnEnabled = enabled; }
function verboseWarn(result: ValidationResult, message: string): void {
  if (verboseWarnEnabled) result.warnings.push(message);
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
      verboseWarn(result, `Optional directory missing: .agents/${dir}/`);
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
              // github-agents use `name:` as their identifier; everything else uses `id:`.
              const idField = dir === "github-agents" ? "name" : "id";
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm[idField]) {
                result.warnings.push(`Missing '${idField}' in frontmatter: .agents/${dir}/${entry.name}`);
              }
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm.type) {
                result.warnings.push(`Missing 'type' in frontmatter: .agents/${dir}/${entry.name}`);
              }
              // C8-D5-M1: Commands must declare orchestrator marker so adapters
              // and runtime gates can distinguish orchestrator commands (which
              // delegate to sub-agents) from inline-execution commands.
              if (dir === "commands" && parsedFm && typeof parsedFm === "object") {
                validateCommandOrchestratorFrontmatter(parsedFm, `.agents/${dir}/${entry.name}`, result);
              }
              // P7: Recognize and type-check the five new optional efficiency
              // frontmatter fields. Unknown values produce warnings only; the
              // hard `triage_tiers` requirement on orchestrator commands is
              // enforced separately by scripts/validate-efficiency-invariants.ts.
              if (parsedFm && typeof parsedFm === "object") {
                validateEfficiencyFrontmatter(parsedFm, `.agents/${dir}/${entry.name}`, dir, result);
              }
            }
          }
        } else if (entry.isDirectory()) {
          // SKILL.md is only the convention under skills/. Other dirs have their
          // own substructure (agents/modes/, agents/shared/, commands/board/,
          // commands/revision/) that doesn't carry SKILL.md.
          if (dir !== "skills") continue;
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

/**
 * C8-D5-M1: Validate the `orchestrator` + `agentPipeline` frontmatter contract
 * on command files. The orchestrator marker distinguishes commands that
 * delegate to sub-agents (orchestrator: true) from inline-execution commands
 * (orchestrator: false). When orchestrator is true, the file must declare
 * `agentPipeline:` as a non-empty array of sub-agent IDs (e.g.
 * `hatch3r-researcher`) so adapters and the validate gate know which agents
 * must be selected for the command to function.
 */
function validateCommandOrchestratorFrontmatter(
  parsedFm: Record<string, unknown>,
  fileLabel: string,
  result: ValidationResult,
): void {
  const orchestrator = parsedFm.orchestrator;
  const agentPipeline = parsedFm.agentPipeline;

  if (orchestrator === undefined) {
    result.warnings.push(
      `Missing 'orchestrator' in frontmatter: ${fileLabel} (add 'orchestrator: true' when the command delegates to sub-agents, or 'orchestrator: false' when it runs inline)`,
    );
    return;
  }

  if (typeof orchestrator !== "boolean") {
    result.errors.push(
      `Invalid 'orchestrator' value in ${fileLabel}: expected boolean (true|false), got ${typeof orchestrator}`,
    );
    return;
  }

  if (orchestrator === true) {
    if (agentPipeline === undefined) {
      result.errors.push(
        `Missing 'agentPipeline' in ${fileLabel}: orchestrator commands must list delegated sub-agents (e.g. agentPipeline: [hatch3r-researcher, hatch3r-implementer])`,
      );
      return;
    }
    if (!Array.isArray(agentPipeline)) {
      result.errors.push(
        `Invalid 'agentPipeline' in ${fileLabel}: expected array of sub-agent IDs, got ${typeof agentPipeline}`,
      );
      return;
    }
    if (agentPipeline.length === 0) {
      result.errors.push(
        `Empty 'agentPipeline' in ${fileLabel}: orchestrator commands must list at least one sub-agent`,
      );
      return;
    }
    const nonStringEntries = agentPipeline.filter((a) => typeof a !== "string");
    if (nonStringEntries.length > 0) {
      result.errors.push(
        `Invalid 'agentPipeline' entry in ${fileLabel}: all entries must be strings (sub-agent IDs)`,
      );
    }
  } else if (Array.isArray(agentPipeline) && agentPipeline.length > 0) {
    // orchestrator: false — agentPipeline should not list sub-agents
    result.warnings.push(
      `Unused 'agentPipeline' in ${fileLabel}: command declares orchestrator: false but lists sub-agents; either set orchestrator: true or remove the agentPipeline field`,
    );
  }
}

/**
 * P7: Soft-validate the five new optional efficiency frontmatter fields:
 *   - efficiency_patterns (string ending in .md)
 *   - efficiency_tier (enum: light | standard | deep) — agents only
 *   - cache_friendly (boolean)
 *   - parallel_tool_default (boolean)
 *   - triage_tiers (array of integers in [1,2,3])
 *
 * All checks are warning-level. The hard `triage_tiers` requirement on
 * orchestrator commands lives in scripts/validate-efficiency-invariants.ts.
 * Missing fields are not flagged here — they are optional. Unknown fields are
 * not flagged either; the existing frontmatter validator does not maintain an
 * allowlist, so this helper only type-checks the five fields when present.
 */
const EFFICIENCY_TIER_VALUES = new Set(["light", "standard", "deep"]);

function validateEfficiencyFrontmatter(
  parsedFm: Record<string, unknown>,
  fileLabel: string,
  dir: string,
  result: ValidationResult,
): void {
  if ("efficiency_patterns" in parsedFm) {
    const ep = parsedFm.efficiency_patterns;
    if (typeof ep !== "string" || !ep.endsWith(".md")) {
      verboseWarn(result, `Invalid 'efficiency_patterns' in ${fileLabel}: expected string path ending in .md, got ${typeof ep === "string" ? `"${ep}"` : typeof ep}`);
    }
  }

  if ("efficiency_tier" in parsedFm) {
    const tier = parsedFm.efficiency_tier;
    if (typeof tier !== "string" || !EFFICIENCY_TIER_VALUES.has(tier)) {
      verboseWarn(result, `Invalid 'efficiency_tier' in ${fileLabel}: expected one of light|standard|deep, got ${typeof tier === "string" ? `"${tier}"` : typeof tier}`);
    } else if (dir !== "agents") {
      verboseWarn(result, `Unexpected 'efficiency_tier' in ${fileLabel}: field applies to agents/*.md only`);
    }
  }

  if ("cache_friendly" in parsedFm && typeof parsedFm.cache_friendly !== "boolean") {
    verboseWarn(result, `Invalid 'cache_friendly' in ${fileLabel}: expected boolean (true|false), got ${typeof parsedFm.cache_friendly}`);
  }

  if ("parallel_tool_default" in parsedFm && typeof parsedFm.parallel_tool_default !== "boolean") {
    verboseWarn(result, `Invalid 'parallel_tool_default' in ${fileLabel}: expected boolean (true|false), got ${typeof parsedFm.parallel_tool_default}`);
  }

  if ("triage_tiers" in parsedFm) {
    const tt = parsedFm.triage_tiers;
    if (!Array.isArray(tt)) {
      verboseWarn(result, `Invalid 'triage_tiers' in ${fileLabel}: expected array of integers from [1,2,3], got ${typeof tt}`);
    } else {
      const invalid = tt.filter((n) => !Number.isInteger(n) || (n !== 1 && n !== 2 && n !== 3));
      if (invalid.length > 0) {
        verboseWarn(result, `Invalid 'triage_tiers' entries in ${fileLabel}: expected integers from [1,2,3], got ${JSON.stringify(invalid)}`);
      }
    }
  }
}

async function validateManagedFilePrefixes(
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  // Wave B3: accept both the legacy `hatch3r-*` shape and the new
  // `NN-hatch3r-*` shape (precedence-prefixed rule outputs from cursor /
  // windsurf / copilot-scoped / claude / cline adapters).
  // Phase H: also exempt .agents/policy/* and mcp.json siblings (files
  // co-located with mcp.json under .agents/mcp/), plus files inside
  // hatch3r-prefixed parent directories (e.g. SKILL.md under
  // .claude/skills/hatch3r-X/ where the directory carries the prefix).
  const NN_HATCH3R_PREFIX_RE = /^\d{2}-hatch3r-/;
  for (const managedFile of manifest.managedFiles ?? []) {
    const fileName = posix.basename(managedFile) || "";
    const dir = posix.dirname(managedFile);
    const parentDir = posix.basename(dir) || "";
    const isSharedFile = [
      "AGENTS.md", "CLAUDE.md", "copilot-instructions.md", ".windsurfrules",
      "mcp.json", "opencode.json", ".mcp.json", "copilot-setup-steps.yml", "settings.json",
      // Platform-required filenames (verbatim per tool convention).
      "GEMINI.md", "CONVENTIONS.md",
      ".codex/config.toml", ".cursor/environment.json", ".windsurf/hooks.json",
      ".goose/profiles/hatch3r.yaml", ".antigravity/rules.md",
    ].some(
      (sf) => fileName === sf || managedFile.endsWith(sf),
    );
    const isExempt =
      dir.endsWith("/policy") || dir.includes("/policy/") ||
      dir.endsWith("/mcp") || dir.includes("/mcp/") ||
      parentDir.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(parentDir);
    const hasHatch3rPrefix =
      fileName.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(fileName);
    if (!isSharedFile && !isExempt && !hasHatch3rPrefix && !fileName.startsWith(".")) {
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

/**
 * Validate CLI tool selection (plan §4.7). Each tool the user opted in
 * to that is missing from PATH yields a warning (not an error) — the
 * tool may simply not be installed yet. Run with `cliTools.enabled` off
 * is a no-op.
 */
async function validateCliTools(
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  const cli = manifest.cliTools;
  if (!cli?.enabled || cli.selected.length === 0) return;
  const detection = await detectCliTools(cli.selected);
  for (const r of detection) {
    if (!r.installed) {
      result.warnings.push(
        `CLI tool '${r.id}' not found on PATH — run \`npx hatch3r cli-tools install\``,
      );
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
    result.errors.push("hatch.json: costTracking.sessionBudget must be a positive number");
  }
  if (ct.issueBudget !== undefined && ct.issueBudget <= 0) {
    result.errors.push("hatch.json: costTracking.issueBudget must be a positive number");
  }
  if (ct.epicBudget !== undefined && ct.epicBudget <= 0) {
    result.errors.push("hatch.json: costTracking.epicBudget must be a positive number");
  }
  if (ct.warningThresholds) {
    for (const t of ct.warningThresholds) {
      if (t < 0 || t > 1) {
        result.errors.push(`hatch.json: costTracking.warningThresholds values must be between 0 and 1, got ${t}`);
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

/**
 * Locate the on-disk file backing a manifest content id. Handles two
 * sources of mismatch between manifest ids and filenames:
 *   1. Type prefixes — commands carry a `cmd-` prefix in the manifest
 *      (applied by `applyCommandPrefix` in src/content/index.ts) but
 *      not in filenames.
 *   2. Subdirectory layout — `commands/` has `board/` and `revision/`
 *      subdirs that the legacy flat-join check did not recurse into.
 *   3. Frontmatter-derived ids — hooks store ids like
 *      `ci-failure-ci-watcher` in frontmatter while the file is
 *      `hatch3r-ci-failure.md`. We walk the directory and parse
 *      frontmatter `id` to match in this case.
 *
 * Returns the absolute path of the matching file, or null if no
 * match is found.
 */
async function findContentFile(
  agentsDir: string,
  cfg: { dir: string; strategy: "glob" | "subdir" },
  id: string,
): Promise<string | null> {
  // Strip command type prefix when computing the candidate filename.
  const baseId = id.startsWith("cmd-") ? id.slice(4) : id;

  if (cfg.strategy === "subdir") {
    const path = join(agentsDir, cfg.dir, baseId, "SKILL.md");
    try {
      await access(path);
      return path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: findContentFile access(${path}) → null — ${message}`);
      return null;
    }
  }

  // Glob: walk subdirectories matching by filename first (cheap), then
  // fall back to frontmatter `id` lookup for cases where the manifest
  // id is derived from frontmatter rather than the filename.
  const root = join(agentsDir, cfg.dir);
  const stack: string[] = [root];
  const mdFiles: string[] = [];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: findContentFile readdir(${dir}) skipped — ${message}`);
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (entry.name === `${baseId}.md`) {
          return full;
        }
        mdFiles.push(full);
      }
    }
  }

  // Frontmatter id fallback: parse each .md file's `id:` and match.
  for (const file of mdFiles) {
    try {
      const raw = await readFile(file, "utf-8");
      if (!raw.startsWith("---")) continue;
      const endIdx = raw.indexOf("---", 3);
      if (endIdx === -1) continue;
      const fm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
      const fmId = fm && typeof fm === "object" && typeof fm.id === "string" ? fm.id : null;
      if (fmId && (fmId === id || fmId === baseId)) {
        return file;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: findContentFile fm-fallback readFile(${file}) skipped — ${message}`);
    }
  }

  return null;
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
        const found = await findContentFile(agentsDir, cfg, id);
        if (!found) {
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

  // Validate handoffs: schema, size, integrity, expiry, git_ref drift
  const handoffsActiveDir = join(agentsDir, "handoffs", "active");
  const handoffsArchivedDir = join(agentsDir, "handoffs", "archived");
  const handoffsResult = await validateHandoffsDirectory(handoffsActiveDir, {
    archivedDir: handoffsArchivedDir,
  });
  for (const e of handoffsResult.errors) {
    result.errors.push(e);
  }
  for (const w of handoffsResult.warnings) {
    result.warnings.push(w);
  }
}

// ── D20 user-content gates (strict + gentle) ───────────────────

/**
 * D20 gentle-gate anti-slop wordlist for user-authored content. Mirrors the
 * 12-entry list in src/content/userContent.ts. Hits emit warnings only —
 * users may override with measurable rationale per CLAUDE.md banned-phrase
 * table. Case-insensitive substring match.
 */
const USER_CONTENT_ANTI_SLOP: readonly string[] = [
  "best possible",
  "best-in-class",
  "world-class",
  "comprehensive and thorough",
  "exhaustive",
  "robust and resilient",
  "high-quality",
  "ensure",
  "properly",
  "correctly",
  "as needed",
  "scalable",
];

/** Body line count above this threshold is a gentle "lean" warning. */
const USER_CONTENT_LEAN_LINE_THRESHOLD = 120;

/** User-authored composed file size cap (bytes). */
const USER_CONTENT_MAX_BYTES = 10_240;

/** Minimum description length (matches userContent.ts strict gate). */
const USER_CONTENT_MIN_DESCRIPTION = 60;

/** Slug regex shared with userContent.ts (lowercase kebab, leading [a-z]). */
const USER_CONTENT_SLUG_REGEX = /^[a-z][a-z0-9-]*$/;

/**
 * Map a user content item's `type` (canonical category) to the directory
 * name it must live under inside `.agents/user/`. Used by the type/dir
 * mismatch strict gate.
 */
const USER_CONTENT_TYPE_DIRS: Record<string, string> = {
  agent: "agents",
  skill: "skills",
  rule: "rules",
  command: "commands",
  hook: "hooks",
};

/**
 * D20 strict + gentle validation gates for user-authored content under
 * `.agents/user/`. Strict failures push to `result.errors`; gentle failures
 * push to `result.warnings`. Reuses `scanForDeniedPatterns`,
 * `validateCommandOrchestratorFrontmatter`, and `isValidHookEvent` so the
 * gate logic does not diverge from canonical-content checks.
 *
 * Pillars served: P5 (Governance Self-Quality — gates enforce charter),
 * P6 (Security & Trust — deny-pattern scan + size cap), P4 (Lean Coverage
 * — gentle warnings on bloat / anti-slop / missing pillar declarations).
 */
async function validateUserContent(
  rootDir: string,
  agentsDir: string,
  result: ValidationResult,
  index: ContentIndex,
): Promise<void> {
  const userRoot = resolveUserContentRoot(rootDir);
  try {
    await stat(userRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const userItems = index.items.filter((i) => i.source === "user");
  if (userItems.length === 0) return;

  for (const item of userItems) {
    const fileLabel = `.agents/user/${item.relativePath}`;

    // Resolve the on-disk path and read the body.
    const absPath =
      item.type === "skill"
        ? join(userRoot, item.relativePath, "SKILL.md")
        : join(userRoot, item.relativePath);

    let raw: string;
    try {
      raw = await readFile(absPath, "utf-8");
    } catch (err) {
      result.errors.push(
        `User content unreadable: ${fileLabel} (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }

    // Strict gate: composed file size cap.
    if (Buffer.byteLength(raw, "utf-8") > USER_CONTENT_MAX_BYTES) {
      result.errors.push(
        `${fileLabel}: file exceeds ${USER_CONTENT_MAX_BYTES}-byte size cap — split or compress the artifact`,
      );
    }

    // Parse frontmatter; treat missing/malformed frontmatter as strict failure.
    if (!raw.startsWith("---")) {
      result.errors.push(`${fileLabel}: missing YAML frontmatter (must start with '---')`);
      continue;
    }
    const fmEnd = raw.indexOf("---", 3);
    if (fmEnd === -1) {
      result.errors.push(`${fileLabel}: invalid frontmatter (no closing '---')`);
      continue;
    }
    const fmRaw = raw.slice(3, fmEnd).trim();
    let fm: Record<string, unknown> | null;
    try {
      fm = parseYaml(fmRaw) as Record<string, unknown> | null;
    } catch (err) {
      result.errors.push(
        `${fileLabel}: YAML parse error in frontmatter — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!fm || typeof fm !== "object") {
      result.errors.push(`${fileLabel}: frontmatter is empty or not an object`);
      continue;
    }
    const body = raw.slice(fmEnd + 3).replace(/^\n/, "");

    // Strict gate: id present, kebab-case, no `hatch3r-` prefix.
    const id = typeof fm.id === "string" ? fm.id : undefined;
    if (!id) {
      result.errors.push(`${fileLabel}: frontmatter missing 'id' field`);
    } else if (!USER_CONTENT_SLUG_REGEX.test(id)) {
      result.errors.push(
        `${fileLabel}: id "${id}" must match ${USER_CONTENT_SLUG_REGEX.source} (lowercase kebab-case starting with [a-z])`,
      );
    } else if (id.startsWith("hatch3r-")) {
      result.errors.push(
        `${fileLabel}: id "${id}" must not start with 'hatch3r-' (reserved for canonical artifacts)`,
      );
    }

    // Strict gate: description present and ≥60 chars.
    const description = typeof fm.description === "string" ? fm.description.trim() : "";
    if (!description) {
      result.errors.push(`${fileLabel}: frontmatter missing 'description' field`);
    } else if (description.length < USER_CONTENT_MIN_DESCRIPTION) {
      result.errors.push(
        `${fileLabel}: description is ${description.length} chars (minimum ${USER_CONTENT_MIN_DESCRIPTION} for disambiguation)`,
      );
    }

    // Strict gate: type matches the directory the file lives under.
    const expectedDir = USER_CONTENT_TYPE_DIRS[item.type];
    if (expectedDir && !item.relativePath.startsWith(expectedDir + "/") && item.relativePath !== expectedDir) {
      result.errors.push(
        `${fileLabel}: artifact type '${item.type}' does not match its directory (expected under '${expectedDir}/')`,
      );
    }
    // Frontmatter `type` should also match the directory category (when present).
    const fmType = typeof fm.type === "string" ? fm.type : undefined;
    if (fmType && fmType !== item.type) {
      result.errors.push(
        `${fileLabel}: frontmatter type '${fmType}' does not match directory category '${item.type}'`,
      );
    }

    // Strict gate: ID collision against canonical artifacts. The
    // user-shadow-canonical collisions populated by buildContentIndex are
    // surfaced here as errors with both file paths.
    for (const collision of index.collisions) {
      if (collision.kind !== "user-shadow-canonical") continue;
      // Match either the existing OR duplicate path against this user item
      // so the error fires once per colliding pair regardless of scan order.
      if (collision.duplicatePath === item.relativePath || collision.existingPath === item.relativePath) {
        const canonicalSide = collision.duplicatePath === item.relativePath
          ? `${collision.existingType} ${collision.existingPath}`
          : `${collision.duplicateType} ${collision.duplicatePath}`;
        result.errors.push(
          `${fileLabel}: id "${collision.id}" collides with canonical ${canonicalSide} — choose a different name`,
        );
      }
    }

    // Strict gate: deny-pattern scan on body content.
    const denyHits = scanForDeniedPatterns(body);
    for (const hit of denyHits) {
      result.errors.push(`${fileLabel}: body contains denied pattern — ${hit}`);
    }

    // Strict gate: rule .md/.mdc parity.
    if (item.type === "rule") {
      const mdcPath = absPath.replace(/\.md$/, ".mdc");
      try {
        await stat(mdcPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          result.errors.push(
            `${fileLabel}: rule missing paired .mdc companion at ${mdcPath.replace(rootDir + "/", "")} — regenerate via /hatch3r-create`,
          );
        } else {
          throw err;
        }
      }
    }

    // Strict gate: command orchestrator/agentPipeline contract (reuses helper).
    if (item.type === "command") {
      validateCommandOrchestratorFrontmatter(fm, fileLabel, result);
    }

    // Strict gate: hook event enum.
    if (item.type === "hook") {
      const event = typeof fm.event === "string" ? fm.event : undefined;
      if (!event) {
        result.errors.push(
          `${fileLabel}: hook missing 'event' field — declare one of pre-commit, post-merge, ci-failure, file-save, session-start, pre-push, worktree-create, worktree-remove`,
        );
      } else if (!isValidHookEvent(event)) {
        result.errors.push(
          `${fileLabel}: hook has invalid event "${event}" — valid: pre-commit, post-merge, ci-failure, file-save, session-start, pre-push, worktree-create, worktree-remove`,
        );
      }
    }

    // ── Gentle gates (warn but accept) ─────────────────────────
    // Phase H: dedupe — emit ONE warning per file naming all matched phrases.
    const lowerBody = body.toLowerCase();
    const matched = new Set<string>();
    for (const phrase of USER_CONTENT_ANTI_SLOP) {
      if (lowerBody.includes(phrase)) matched.add(phrase);
    }
    if (matched.size > 0) {
      const phraseList = [...matched].map((p) => `'${p}'`).join(", ");
      result.warnings.push(
        `${fileLabel}: anti-slop phrases — replace with measurable criteria: ${phraseList}`,
      );
    }

    const lineCount = body.split(/\r?\n/).length;
    if (lineCount > USER_CONTENT_LEAN_LINE_THRESHOLD) {
      result.warnings.push(
        `${fileLabel}: body has ${lineCount} lines (lean threshold: ${USER_CONTENT_LEAN_LINE_THRESHOLD}) — consider compressing`,
      );
    }

    if (!("quality_charter" in fm) && !/quality[_-]charter/i.test(body)) {
      result.warnings.push(
        `${fileLabel}: missing quality_charter reference — add 'quality_charter: agents/shared/quality-charter.md' to frontmatter or reference it in the body`,
      );
    }

    const hasPillarFm = Array.isArray(fm.pillars) && fm.pillars.length > 0;
    const hasPillarBody = /(^|\n)\s*##\s*Pillar/i.test(body) ||
      /\*\*Pillars?:\*\*/i.test(body);
    if (!hasPillarFm && !hasPillarBody) {
      result.warnings.push(
        `${fileLabel}: missing pillar declaration — add 'pillars: [P1...P6]' to frontmatter or a '**Pillars:**' line in the body`,
      );
    }
  }
}

// ── Description quality lint (Wave A2 → Wave C1) ────────────────
//
// Wave A2 introduced these checks as warnings; Wave B1 rewrote the 28
// offending artifacts so the warning count reached 0. Wave C1 promotes them
// from warnings to errors so future regressions (short/colliding descriptions
// on new or edited canonical content) surface as non-zero-exit validation
// failures. They run on the canonical package content root (agents/, skills/,
// rules/, commands/) so they trigger regardless of whether `.agents/` has been
// initialized.

const DESCRIPTION_MIN_LENGTH = 60;
const DESCRIPTION_COSINE_THRESHOLD = 0.55;

const DESCRIPTION_STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "or", "to", "of", "in", "on", "at",
  "by", "use", "when", "from", "as", "is", "are", "this", "that", "it", "its",
  "be", "has", "have",
]);

/**
 * Tokenize a description for cosine-similarity comparison. Lowercase, split
 * on non-word characters, drop stopwords and empty tokens.
 */
function tokenizeDescription(description: string): string[] {
  return description
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0 && !DESCRIPTION_STOPWORDS.has(t));
}

/**
 * Build a term-frequency vector from a token list.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/**
 * Cosine similarity between two TF vectors. Returns 0 if either vector is empty.
 */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  for (const [term, aCount] of a) {
    const bCount = b.get(term);
    if (bCount !== undefined) dot += aCount * bCount;
  }
  if (dot === 0) return 0;
  let aMag = 0;
  for (const count of a.values()) aMag += count * count;
  let bMag = 0;
  for (const count of b.values()) bMag += count * count;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

/**
 * Flag artifacts whose `description:` is shorter than the disambiguation
 * threshold. Short descriptions increase the risk of agent selection
 * collisions at dispatch time. Wave C1: findings emit as errors (same
 * pattern as validateCommandOrchestratorFrontmatter) so regressions cause
 * a non-zero validate exit code.
 */
function validateDescriptionLength(artifacts: CatalogItem[]): string[] {
  const findings: string[] = [];
  for (const item of artifacts) {
    const desc = (item.description ?? "").trim();
    if (desc.length < DESCRIPTION_MIN_LENGTH) {
      findings.push(
        `${item.type} ${item.relativePath}: description is ${desc.length} chars (min ${DESCRIPTION_MIN_LENGTH} required for disambiguation)`,
      );
    }
  }
  return findings;
}

/**
 * Flag artifact pairs that share (type, primaryTag) cluster and have
 * cosine-similar descriptions. The cluster scoping keeps the pairwise
 * comparison tractable and focuses findings on likely-confusable pairs.
 * Wave C1: findings emit as errors.
 */
function validateDescriptionCollisions(artifacts: CatalogItem[]): string[] {
  const findings: string[] = [];

  // Group by (type, primaryTag)
  const clusters = new Map<string, CatalogItem[]>();
  for (const item of artifacts) {
    const primaryTag = item.tags?.[0] ?? "_untagged";
    const key = `${item.type}/${primaryTag}`;
    const bucket = clusters.get(key);
    if (bucket) bucket.push(item);
    else clusters.set(key, [item]);
  }

  for (const [clusterKey, members] of clusters) {
    if (members.length < 2) continue;

    // Pre-compute TF vectors once per member
    const vectors = members.map((item) => ({
      item,
      tf: termFrequency(tokenizeDescription(item.description ?? "")),
    }));

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const score = cosineSimilarity(vectors[i].tf, vectors[j].tf);
        if (score >= DESCRIPTION_COSINE_THRESHOLD) {
          findings.push(
            `Description collision: ${vectors[i].item.relativePath} ↔ ${vectors[j].item.relativePath} (cosine=${score.toFixed(2)}, cluster=${clusterKey})`,
          );
        }
      }
    }
  }

  return findings;
}

/**
 * Hook point: run both description-quality checks against the canonical
 * content index and fold the findings into the shared ValidationResult.
 * Wave C1: emits on the errors channel (previously warnings) — same
 * pattern as validateCommandOrchestratorFrontmatter's error emissions.
 */
function runDescriptionQualityChecks(
  index: ContentIndex,
  result: ValidationResult,
): void {
  // Restrict to published artifact types; hooks/prompts/github-agents are
  // out of scope for this lint (per plan: agents, skills, rules, commands).
  const scoped = index.items.filter(
    (i) => i.type === "agent" || i.type === "skill" || i.type === "rule" || i.type === "command",
  );

  for (const e of validateDescriptionLength(scoped)) {
    result.errors.push(e);
  }
  for (const e of validateDescriptionCollisions(scoped)) {
    result.errors.push(e);
  }
}

export async function validateDocsCounts(rootDir: string): Promise<{ mismatches: string[]; checked: number }> {
  const mismatches: string[] = [];
  let checked = 0;

  const actual: Record<string, number> = {};
  const dirs: [string, string, (e: string) => boolean][] = [
    ["adapters", join(rootDir, "src/adapters"), (e) => e.endsWith(".ts") && !["base.ts", "index.ts", "canonical.ts", "customization.ts", "types.ts", "mcp-utils.ts", "toml-utils.ts", "contextBudget.ts"].includes(e)],
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`validate: README count-check readFile(${readmePath}) skipped — ${message}`);
  }

  return { mismatches, checked };
}

/**
 * Output format for the validate command.
 * - "human" (default): banner, spinner, boxed summary, coloured error/warning list.
 * - "json": single JSON object `{errors, warnings, summary}` to stdout, no banner.
 *   Intended for CI consumers (see C8-D1-M10 / D1-SA1.4.3).
 */
export type ValidateOutputFormat = "human" | "json";

interface ValidateJsonOutput {
  errors: string[];
  warnings: string[];
  summary: {
    status: "passed" | "failed";
    errorCount: number;
    warningCount: number;
    docsMode: boolean;
    hatch3rVersion: string;
    timestamp: string;
  };
}

function emitJson(output: ValidateJsonOutput): void {
  // Write a single JSON document followed by a newline — one-shot payload for
  // CI parsers. Do NOT interleave other stdout writes in json mode.
  process.stdout.write(JSON.stringify(output) + "\n");
}

export async function validateCommand(opts?: {
  docs?: boolean;
  verbose?: boolean;
  format?: ValidateOutputFormat;
}): Promise<void> {
  const format: ValidateOutputFormat = opts?.format === "json" ? "json" : "human";
  const jsonMode = format === "json";

  // In JSON mode: suppress verbose logging (sent to stdout via info()) and the
  // banner, which would corrupt the machine-readable output. Errors/warnings
  // still reach the final JSON object via the ValidationResult aggregator.
  setVerbose(jsonMode ? false : !!opts?.verbose);
  setVerboseWarnEnabled(jsonMode ? false : !!opts?.verbose);
  if (!jsonMode) printBanner(true);

  const rootDir = process.cwd();
  const timestamp = new Date().toISOString();

  if (opts?.docs) {
    const spinner = jsonMode ? null : createSpinner("Verifying documentation counts...");
    spinner?.start();
    const { mismatches, checked } = await validateDocsCounts(rootDir);
    if (mismatches.length > 0) {
      if (jsonMode) {
        emitJson({
          errors: mismatches.map((m) => `Documentation count mismatch: ${m}`),
          warnings: [],
          summary: {
            status: "failed",
            errorCount: mismatches.length,
            warningCount: 0,
            docsMode: true,
            hatch3rVersion: HATCH3R_VERSION,
            timestamp,
          },
        });
      } else {
        spinner?.fail("Documentation count mismatches found");
        for (const m of mismatches) logError(m);
      }
      throw new HatchError("Documentation counts do not match", 1, "VALIDATION_ERROR");
    }
    if (jsonMode) {
      emitJson({
        errors: [],
        warnings: [],
        summary: {
          status: "passed",
          errorCount: 0,
          warningCount: 0,
          docsMode: true,
          hatch3rVersion: HATCH3R_VERSION,
          timestamp,
        },
      });
    } else {
      spinner?.succeed(`Documentation counts verified (${checked} checks, 0 mismatches)`);
    }
    return;
  }
  const agentsDir = join(rootDir, AGENTS_DIR);
  const result: ValidationResult = { errors: [], warnings: [] };

  const spinner = jsonMode ? null : createSpinner("Validating .agents/ structure...");
  spinner?.start();

  // Wave A2: when cwd is a hatch3r framework source repo (has canonical
  // content roots but no .agents/), run the description-quality lint on
  // the canonical source and exit 0. This lets framework maintainers run
  // the lint as a worklist generator without having to `hatch3r init`
  // their own repo.
  const cwdIsFrameworkSource =
    existsSync(join(rootDir, "agents")) &&
    existsSync(join(rootDir, "skills")) &&
    existsSync(join(rootDir, "rules")) &&
    existsSync(join(rootDir, "commands"));

  try {
    await access(agentsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;

    if (cwdIsFrameworkSource) {
      spinner?.stop();
      await validateCanonicalDescriptionQuality(rootDir, result);
      if (jsonMode) {
        const hasErrors = result.errors.length > 0;
        emitJson({
          errors: result.errors,
          warnings: result.warnings,
          summary: {
            status: hasErrors ? "failed" : "passed",
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
            docsMode: false,
            hatch3rVersion: HATCH3R_VERSION,
            timestamp,
          },
        });
        if (hasErrors) {
          throw new HatchError("Validation failed", 1, "VALIDATION_ERROR");
        }
        return;
      }
      if (result.errors.length > 0) {
        console.log();
        for (const e of result.errors) logError(e);
        console.log();
        if (result.warnings.length > 0) {
          for (const w of result.warnings) warn(w);
          console.log();
        }
        printBox(
          "Canonical content lint failed",
          [
            `${chalk.red("✖")} ${result.errors.length} error(s)`,
            `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
            chalk.dim("(framework-source mode — .agents/ not required)"),
          ],
          "error",
        );
        throw new HatchError("Validation failed", 1, "VALIDATION_ERROR");
      }
      if (result.warnings.length > 0) {
        console.log();
        for (const w of result.warnings) warn(w);
        console.log();
        printBox(
          "Canonical content lint",
          [
            `${chalk.green("✔")} 0 errors`,
            `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
            chalk.dim("(framework-source mode — .agents/ not required)"),
          ],
          "success",
        );
      } else {
        printBox(
          "Canonical content lint",
          [chalk.green("All checks passed")],
          "success",
        );
      }
      return;
    }

    if (jsonMode) {
      emitJson({
        errors: [".agents/ directory not found. Run `hatch3r init` first."],
        warnings: [],
        summary: {
          status: "failed",
          errorCount: 1,
          warningCount: 0,
          docsMode: false,
          hatch3rVersion: HATCH3R_VERSION,
          timestamp,
        },
      });
    } else {
      spinner?.fail("Validation failed");
      logError(".agents/ directory not found. Run `hatch3r init` first.");
      console.log();
    }
    throw new HatchError(".agents/ directory not found.", 1, "CONFIG_ERROR");
  }

  const manifest = await readManifest(rootDir);

  // Wave A2: track whether the description-quality lint has already run on
  // installed `.agents/` content, so we don't duplicate findings from a
  // second canonical-source pass below.
  let descriptionLintRan = false;

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
    verbose("Checking CLI tools...");
    await validateCliTools(manifest, result);
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
      // Build the index with the user-content subtree included so the D20
      // validator and collision detector see user artifacts. The userRoot
      // option no-ops when the .agents/user/ directory does not exist.
      const index = await buildContentIndex(agentsDir, {
        userRoot: resolveUserContentRoot(rootDir),
      });
      if (index.items.length > 0) {
        const crossRefResult = await validateCrossReferences(agentsDir, index);
        for (const w of crossRefResult.warnings) {
          result.warnings.push(w);
        }
        // Wave A2: description-quality lint on the installed content.
        // When this runs, we skip the canonical pass below to avoid duplicate
        // findings.
        runDescriptionQualityChecks(index, result);
        descriptionLintRan = true;
      }
      // D20: strict + gentle gates for user-authored content. No-op when
      // .agents/user/ does not exist or has no items.
      verbose("Checking user content (D20 gates)...");
      await validateUserContent(rootDir, agentsDir, result, index);

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

  // Wave A2: Description-quality lint on the canonical package content
  // (agents/, skills/, rules/, commands/ at the package root). This runs
  // only when the installed-content lint above did not run (no .agents/ or
  // empty index) — the source of truth for content rewrites is the canonical
  // tree, and the worklist must reflect it.
  if (!descriptionLintRan) {
    await validateCanonicalDescriptionQuality(rootDir, result);
  }

  spinner?.stop();

  // Detect if customization files exist for contextual help (#56 D19-4)
  let hasCustomizations = false;
  for (const { dir } of CUSTOMIZATION_TYPES) {
    try {
      const files = await readdir(join(rootDir, ".hatch3r", dir));
      if (files.some(f => f.endsWith(".customize.yaml") || f.endsWith(".customize.md"))) {
        hasCustomizations = true;
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: customization probe readdir(.hatch3r/${dir}) skipped — ${message}`);
    }
  }

  // JSON mode: emit one structured payload and either return or throw based on
  // errors. Customization hint and boxes are human-only output.
  if (jsonMode) {
    const hasErrors = result.errors.length > 0;
    emitJson({
      errors: result.errors,
      warnings: result.warnings,
      summary: {
        status: hasErrors ? "failed" : "passed",
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        docsMode: false,
        hatch3rVersion: HATCH3R_VERSION,
        timestamp,
      },
    });
    if (hasErrors) {
      throw new HatchError("Validation failed", 1, "VALIDATION_ERROR");
    }
    return;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`validate: .env.mcp secret-scan readFile skipped — ${message}`);
  }
}

/**
 * Wave A2 canonical-source lint. Scans the package-root canonical content
 * (agents/, skills/, rules/, commands/) and runs the description-quality
 * checks. This runs independently of `.agents/` so the lint produces a
 * worklist even when the validator is invoked against the framework repo
 * itself (no .agents/ present) or a project whose .agents/ is absent or
 * out of sync with its source.
 *
 * When invoked from a consumer repo whose `rootDir` is not a hatch3r
 * package root, `findPackageRoot` still returns the framework's package
 * root via __dirname, so the lint always targets the installed canonical
 * content that Wave B would rewrite.
 */
async function validateCanonicalDescriptionQuality(
  rootDir: string,
  result: ValidationResult,
): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const packageRoot = findPackageRoot(dirname(__filename));

  // Prefer the cwd-resolved package root when cwd IS the framework repo
  // (development mode); otherwise fall back to the installed package root.
  const canonicalRoot = existsSync(join(rootDir, "agents"))
    && existsSync(join(rootDir, "skills"))
    && existsSync(join(rootDir, "rules"))
    && existsSync(join(rootDir, "commands"))
    ? rootDir
    : packageRoot;

  try {
    const index = await buildContentIndex(canonicalRoot);
    if (index.items.length === 0) return;
    runDescriptionQualityChecks(index, result);
  } catch (err) {
    // Non-fatal: lint is an advisory warning channel only.
    result.warnings.push(
      `Description-quality lint skipped — canonical content scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Run security compliance checks and fold results into validation (#86 D15).
 */
async function validateSecurityCompliance(result: ValidationResult): Promise<void> {
  const report = await runComplianceChecks();
  // Phase H: failures emit per-control; warnings collapse to one summary
  // unless --verbose, where per-control detail is preserved.
  const warnChecks: typeof report.checks = [];
  for (const check of report.checks) {
    if (check.status === "fail") {
      result.errors.push(
        `Security compliance [${check.controlRef}]: ${check.description}` +
        (check.detail ? ` — ${check.detail}` : ""),
      );
    } else if (check.status === "warn") {
      warnChecks.push(check);
    }
  }
  if (warnChecks.length === 0) return;
  if (verboseWarnEnabled) {
    for (const check of warnChecks) {
      result.warnings.push(
        `Security compliance [${check.controlRef}]: ${check.description}` +
        (check.detail ? ` — ${check.detail}` : ""),
      );
    }
  } else {
    const refs = warnChecks.map((c) => c.controlRef).join(", ");
    result.warnings.push(
      `Security compliance: ${warnChecks.length} control(s) with warnings (${refs}) — re-run with --verbose for per-control detail`,
    );
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
