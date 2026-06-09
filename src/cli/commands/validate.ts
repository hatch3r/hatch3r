import { readdir, readFile, access, stat } from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readManifest } from "../../manifest/hatchJson.js";
import { isValidHookEvent, VALID_HOOK_EVENTS } from "../../hooks/types.js";
import { HATCH3R_DIR, HATCH3R_PREFIX, HatchError, exitCodeForErrorCode, getMarkersForPath, MANAGED_BLOCK_VARIANTS } from "../../types.js";
import type { HatchManifest } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { scanForDeniedPatterns } from "../../adapters/customization.js";
import { readCanonicalFilesDetailed } from "../../adapters/canonical.js";
import type { CanonicalType, CanonicalReadError } from "../../adapters/canonical.js";
import { ALL_TAGS, facetOf } from "../../content/tags.js";
import { buildContentIndex, validateCrossReferences, validateOrchestrationDependencies, resolveUserContentRoot } from "../../content/index.js";
import type { CatalogItem, ContentIndex } from "../../content/index.js";
import { findPackageRoot } from "../shared/paths.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import { validateHandoffsDirectory } from "../../content/handoffs/index.js";
import { readCustomizationWithWarnings } from "../../models/customize.js";
import type { CustomizableType } from "../../models/customize.js";
import { parseEnvFile } from "../../env/mcpEnv.js";
import { detectSecrets } from "../../env/secretDetection.js";
import { runComplianceChecks } from "../../pipeline/complianceVerification.js";
import { detectCliTools } from "../../cliTools/detect.js";
import {
  printBanner,
  createSpinner,
  printBox,
  printTimingSummary,
  error as logError,
  warn,
  info,
  setVerbose,
  verbose,
} from "../shared/ui.js";

/**
 * C9-M7 (Cycle 10 Wave-3 Medium): the previous DEFAULT_KNOWN_AGENTS literal
 * hard-coded the agent roster, so any cycle that added or retired an agent
 * (e.g. F16.3-H1's 5 legacy meta-agent retirement + 9 CQ specialist intake)
 * had to manually re-sync this constant against the on-disk `agents/`
 * directory. Drift between the constant and the filesystem produced
 * inventory false-positives — a freshly-added agent surfaced as "not in the
 * standard hatch3r agent roster" until the next manual edit.
 *
 * Build the fallback set dynamically from the bundled `agents/` directory
 * the first time it is needed (cached per process). The hook-validation
 * path below uses `manifest.content` when available; this fallback only
 * runs when the manifest predates the content-tracking schema.
 */
let cachedKnownAgents: Set<string> | undefined;
async function getKnownAgents(canonicalRoot: string): Promise<Set<string>> {
  if (cachedKnownAgents) return cachedKnownAgents;
  const index = await buildContentIndex(canonicalRoot);
  cachedKnownAgents = new Set(
    index.items.filter((i) => i.type === "agent").map((i) => i.id),
  );
  return cachedKnownAgents;
}

export interface ValidationResult {
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
    // Wave 6 moves the manifest to `.hatch3r/hatch.json`; a missing manifest
    // is a warning (project may not yet be hatch3r-managed) rather than a
    // hard error so bundled-canonical validation can still run for tooling.
    result.warnings.push("Missing hatch.json manifest (run `hatch3r init` to create one)");
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
  canonicalRoot: string,
  result: ValidationResult,
): Promise<void> {
  const requiredDirs = ["agents", "skills", "rules"];
  const optionalDirs = ["commands", "prompts", "mcp", "policy", "github-agents"];

  for (const dir of requiredDirs) {
    try {
      await access(join(canonicalRoot, dir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      result.errors.push(`Required canonical directory missing: ${dir}/ (under bundled content root)`);
    }
  }

  for (const dir of optionalDirs) {
    try {
      await access(join(canonicalRoot, dir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      verboseWarn(result, `Optional canonical directory missing: ${dir}/ (under bundled content root)`);
    }
  }
}

async function validateFrontmatter(
  canonicalRoot: string,
  result: ValidationResult,
): Promise<void> {
  const requiredDirs = ["agents", "skills", "rules"];
  const optionalDirs = ["commands", "prompts", "mcp", "policy", "github-agents"];

  for (const dir of [...requiredDirs, ...optionalDirs]) {
    const dirPath = join(canonicalRoot, dir);
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const filePath = join(dirPath, entry.name);
          const content = await readFile(filePath, "utf-8");
          const label = `${dir}/${entry.name}`;
          if (!content.startsWith("---")) {
            result.warnings.push(`Missing frontmatter: ${label}`);
          } else {
            const endIdx = content.indexOf("---", 3);
            if (endIdx === -1) {
              result.errors.push(`Invalid frontmatter (no closing ---): ${label}`);
            } else {
              const frontmatter = content.slice(3, endIdx).trim();
              const parsedFm = parseYaml(frontmatter) as Record<string, unknown> | null;
              // github-agents use `name:` as their identifier; everything else uses `id:`.
              const idField = dir === "github-agents" ? "name" : "id";
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm[idField]) {
                result.warnings.push(`Missing '${idField}' in frontmatter: ${label}`);
              }
              if (!parsedFm || typeof parsedFm !== "object" || !parsedFm.type) {
                result.warnings.push(`Missing 'type' in frontmatter: ${label}`);
              }
              // C8-D5-M1: Commands must declare orchestrator marker so adapters
              // and runtime gates can distinguish orchestrator commands (which
              // delegate to sub-agents) from inline-execution commands.
              // F1.4-H1 (Cycle 10 Wave 2): canonical commands additionally must
              // satisfy Decision #13 (orchestrator: true + non-empty
              // agentPipeline), enforced via `isCanonicalCommand=true`.
              if (dir === "commands" && parsedFm && typeof parsedFm === "object") {
                validateCommandOrchestratorFrontmatter(parsedFm, label, result, { isCanonicalCommand: true });
              }
              // P7: Recognize and type-check the five new optional efficiency
              // frontmatter fields. Unknown values produce warnings only; the
              // hard `triage_tiers` requirement on orchestrator commands is
              // enforced separately by scripts/validate-efficiency-invariants.ts.
              if (parsedFm && typeof parsedFm === "object") {
                validateEfficiencyFrontmatter(parsedFm, label, dir, result);
              }
              // D2-M12 (D2 Medium, Cycle 10 Wave 3 rollover): runtime
              // unknown-tag scan. `ALL_TAGS` lives only at TypeScript
              // compile time, so a YAML author who wrote
              // `tags: [floor:contntquality]` (typo) previously surfaced no
              // diagnostic — the typo would survive `validate` and only
              // misbehave at preset-resolution time when the unknown tag
              // failed every facet predicate. Validate the tag list against
              // the registry via `facetOf`; unknown tags surface as
              // warnings with a "Did you mean?" suggestion from the closest
              // known tag (Levenshtein ≤ 2).
              if (parsedFm && typeof parsedFm === "object") {
                validateTagsAgainstRegistry(parsedFm, label, result);
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
            result.warnings.push(`Skill directory missing SKILL.md: ${dir}/${entry.name}/`);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // D2-11 (Cycle 11 Wave 3, Medium): the per-file loop above is non-recursive
  // and only checks id/type presence — a strictly weaker diagnostic set than the
  // canonical reader. Run `readCanonicalFilesDetailed` over each canonical type
  // so the deeper checks the reader already implements (TYPE_MISMATCH for a
  // wrong-typed id/tags field, INJECTION_TOKEN for a structural-injection body
  // token, UTF8/encoding decode failures, and subdirectory coverage the flat
  // readdir misses) surface here too instead of slipping past `validate` to
  // misbehave at preset-resolution / adapter-generation time. NOT_FOUND is the
  // normal skills-strategy "no SKILL.md" / absent-dir signal and is suppressed,
  // matching `readCanonicalFiles`. `mcp` is excluded — it is a JSON config dir,
  // not a CanonicalType.
  await scanCanonicalReadDiagnostics(canonicalRoot, result);

  // Wave 4: the root AGENTS.md is no longer emitted (W3). Bundled content
  // contains no AGENTS.md either — the bridge file is the orchestration doc.
}

/**
 * D2-11: surface the per-file diagnostics that `readCanonicalFilesDetailed`
 * already computes (TYPE_MISMATCH / INJECTION_TOKEN / encoding / recursive
 * subdir coverage) as warnings on the validation result. The canonical reader
 * keeps the file loaded with the offending field coerced to its empty fallback,
 * so every diagnostic here is advisory (warning), matching how the
 * `readCanonicalFiles` adapter path treats the same channel. NOT_FOUND is
 * suppressed (normal absent-file / absent-dir signal).
 */
function formatCanonicalDiagnostic(error: CanonicalReadError): string {
  return `[canonical] ${error.code}: ${error.message}`;
}

export async function scanCanonicalReadDiagnostics(
  canonicalRoot: string,
  result: ValidationResult,
): Promise<void> {
  // Canonical types that overlap the frontmatter-bearing content dirs above.
  // `mcp` is intentionally absent (JSON config, not a CanonicalType).
  const types: CanonicalType[] = [
    "agents",
    "skills",
    "rules",
    "commands",
    "prompts",
    "policy",
    "github-agents",
  ];
  for (const type of types) {
    let results;
    try {
      results = await readCanonicalFilesDetailed(canonicalRoot, type);
    } catch (err) {
      // A reader-level throw (not a per-file error) is itself a diagnostic —
      // surface it rather than letting validateFrontmatter abort (Silent
      // Failure Contract, CONSTITUTION §2 P5).
      const message = err instanceof Error ? err.message : String(err);
      result.warnings.push(`[canonical] reader failed for "${type}": ${message}`);
      continue;
    }
    for (const r of results) {
      if (r.error) {
        // NOT_FOUND is the normal skills "no SKILL.md" / absent-dir signal.
        if (r.error.code === "NOT_FOUND") continue;
        result.warnings.push(formatCanonicalDiagnostic(r.error));
      }
      if (r.typeMismatches) {
        for (const m of r.typeMismatches) {
          result.warnings.push(formatCanonicalDiagnostic(m));
        }
      }
    }
  }
}

/**
 * D2-M12 (D2 Medium, Cycle 10 Wave 3 rollover): validate the `tags:` array
 * against the canonical `TAG_REGISTRY` so an unknown tag in YAML frontmatter
 * surfaces as a warning instead of slipping past `validate` to misbehave at
 * preset-resolution time. `ALL_TAGS` is a TypeScript compile-time export and
 * never reaches a YAML author's editor; this validator closes that loop at
 * runtime.
 *
 * `tier:*` and `floor:enterprise-only` are accepted through the registry
 * (they are registered facet entries). Tags with no facet match surface as a
 * warning with a "Did you mean?" suggestion within Levenshtein distance ≤ 2.
 */
export function validateTagsAgainstRegistry(
  parsedFm: Record<string, unknown>,
  fileLabel: string,
  result: ValidationResult,
): void {
  const tags = parsedFm.tags;
  if (!Array.isArray(tags)) return;
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    if (facetOf(tag) !== undefined) continue;
    const suggestion = nearestKnownTag(tag);
    const didYouMean = suggestion ? ` Did you mean "${suggestion}"?` : "";
    result.warnings.push(
      `Unknown tag "${tag}" in frontmatter: ${fileLabel} — not present in TAG_REGISTRY.${didYouMean}`,
    );
  }
}

/**
 * D2-M12: nearest-known-tag suggestion via Levenshtein distance ≤ 2. Returns
 * undefined when no registered tag is within the threshold. TAG_REGISTRY is
 * bounded (~80 entries) so the full sweep stays cheap.
 */
function nearestKnownTag(tag: string): string | undefined {
  const editDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const curr = new Array<number>(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = [...curr];
    }
    return prev[b.length];
  };
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const known of ALL_TAGS) {
    const d = editDistance(tag, known);
    if (d < bestDistance) {
      bestDistance = d;
      best = known;
    }
    if (bestDistance === 0) break;
  }
  return best && bestDistance > 0 && bestDistance <= 2 ? best : undefined;
}

/**
 * C8-D5-M1: Validate the `orchestrator` + `agentPipeline` frontmatter contract
 * on command files. The orchestrator marker distinguishes commands that
 * delegate to sub-agents (orchestrator: true) from inline-execution commands
 * (orchestrator: false). When orchestrator is true, the file must declare
 * `agentPipeline:` as a non-empty array of sub-agent IDs (e.g.
 * `hatch3r-researcher`) so adapters and the validate gate know which agents
 * must be selected for the command to function.
 *
 * F1.4-H1 (Cycle 10 Wave 2, D1 High): when invoked against canonical commands
 * (`isCanonicalCommand: true`), this helper additionally enforces Decision #13
 * from `.claude/rules/content-authoring.md` §9: every `commands/hatch3r-*.md`
 * MUST be orchestrator-tier — `orchestrator: false` is a structural error.
 * Inline-execution flows belong in `skills/hatch3r-{name}/SKILL.md`. User
 * overrides under `.hatch3r/overrides/commands/` MAY be inline (legacy
 * carve-out), so the gate flips off there.
 */
export function validateCommandOrchestratorFrontmatter(
  parsedFm: Record<string, unknown>,
  fileLabel: string,
  result: ValidationResult,
  opts?: { isCanonicalCommand?: boolean },
): void {
  const orchestrator = parsedFm.orchestrator;
  const agentPipeline = parsedFm.agentPipeline;
  const isCanonical = !!opts?.isCanonicalCommand;

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
  } else {
    // orchestrator === false branch.
    if (isCanonical) {
      // F1.4-H1: Decision #13 enforcement on canonical commands. A canonical
      // command MUST be orchestrator-tier; inline-execution flows MUST be
      // re-authored as skills under `skills/hatch3r-{name}/SKILL.md`.
      result.errors.push(
        `${fileLabel} violates Decision #13: a canonical command MUST have orchestrator: true + non-empty agentPipeline. orchestrator: false is a structural error — promote to orchestrator: true by delegating to a sub-agent OR collapse into skills/hatch3r-{name}/SKILL.md per .claude/rules/content-authoring.md §9.`,
      );
    } else if (Array.isArray(agentPipeline) && agentPipeline.length > 0) {
      // orchestrator: false — agentPipeline should not list sub-agents
      result.warnings.push(
        `Unused 'agentPipeline' in ${fileLabel}: command declares orchestrator: false but lists sub-agents; either set orchestrator: true or remove the agentPipeline field`,
      );
    }
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

export function validateEfficiencyFrontmatter(
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
    // D6-SA6.6-Finding4: efficiency_tier is valid on agents/*.md AND on
    // orchestrator commands (`orchestrator: true`). It carries no meaning on
    // any other file class, so the "unexpected" advisory fires only there.
    const tierAllowed = dir === "agents" || parsedFm.orchestrator === true;
    if (typeof tier !== "string" || !EFFICIENCY_TIER_VALUES.has(tier)) {
      verboseWarn(result, `Invalid 'efficiency_tier' in ${fileLabel}: expected one of light|standard|deep, got ${typeof tier === "string" ? `"${tier}"` : typeof tier}`);
    } else if (!tierAllowed) {
      verboseWarn(result, `Unexpected 'efficiency_tier' in ${fileLabel}: field applies to agents/*.md or orchestrator commands only`);
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
  canonicalRoot: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.features.hooks) return;

  const hooksDir = join(canonicalRoot, "hooks");
  try {
    const hookFiles = await readdir(hooksDir);
    const mdHooks = hookFiles.filter(f => f.endsWith(".md"));
    if (mdHooks.length === 0) {
      result.warnings.push("Hooks feature enabled but no hook definitions found in bundled hooks/");
    }

    let agentFiles: Set<string> | undefined;
    try {
      const agentEntries = await readdir(join(canonicalRoot, "agents"));
      agentFiles = new Set(agentEntries.filter(f => f.endsWith(".md")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    for (const hookFile of mdHooks) {
      const hookContent = await readFile(join(hooksDir, hookFile), "utf-8");
      if (!hookContent.startsWith("---")) {
        result.warnings.push(`Hook missing frontmatter: hooks/${hookFile}`);
        continue;
      }
      const endIdx = hookContent.indexOf("---", 3);
      if (endIdx === -1) continue;
      const fm = parseYaml(hookContent.slice(3, endIdx).trim()) as Record<string, unknown> | null;
      if (fm?.event && typeof fm.event === "string") {
        if (!isValidHookEvent(fm.event)) {
          result.errors.push(`Hook "${hookFile}" has invalid event "${fm.event}". Valid events: ${[...VALID_HOOK_EVENTS].join(", ")}`);
        }
      }
      if (fm?.agent && typeof fm.agent === "string" && agentFiles) {
        const agentName = typeof fm.agent === "string" && fm.agent.startsWith(HATCH3R_PREFIX)
          ? fm.agent
          : `${HATCH3R_PREFIX}${fm.agent}`;
        const expectedFile = `${agentName}.md`;
        if (!agentFiles.has(expectedFile)) {
          result.errors.push(`Hook "${hookFile}" references agent "${fm.agent}" but agents/${expectedFile} does not exist`);
        }
        // Build known agents set from manifest content or fallback to the
        // dynamic index of the bundled `agents/` directory (C9-M7).
        const knownAgents = manifest.content
          ? new Set(manifest.content.items.agents)
          : await getKnownAgents(canonicalRoot);
        if (!knownAgents.has(agentName)) {
          result.warnings.push(`Hook "${hookFile}" references agent "${fm.agent}" which is not in the standard hatch3r agent roster`);
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    result.warnings.push("Hooks feature enabled but bundled hooks/ directory not found");
  }
}

async function validateMcp(
  canonicalRoot: string,
  manifest: HatchManifest,
  result: ValidationResult,
): Promise<void> {
  if (!manifest.features.mcp || manifest.mcp.servers.length === 0) return;

  const mcpPath = join(canonicalRoot, "mcp", "mcp.json");
  try {
    const mcpContent = await readFile(mcpPath, "utf-8");
    const mcpParsed = JSON.parse(mcpContent);
    if (!mcpParsed.mcpServers || typeof mcpParsed.mcpServers !== "object") {
      result.errors.push("MCP config missing 'mcpServers' key");
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      result.errors.push("Invalid JSON in mcp/mcp.json (bundled content root)");
    } else {
      result.warnings.push("MCP servers configured but mcp/mcp.json not found in bundled content root");
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
  // D10-30 (Cycle 11 Wave 3, Medium): resolve the backing canonical artifact
  // through `findContentFile` rather than a flat `join`. The prior flat join
  // mislocated two artifact classes:
  //   - skills resolved to a bare `skills/<id>` directory (the real artifact is
  //     `skills/<id>/SKILL.md`), so a `.customize.yaml` for a non-existent skill
  //     never warned when an empty same-named directory happened to exist.
  //   - commands joined flat under `commands/<id>.md`, missing the `board/` and
  //     `revision/` subdirs (and the manifest `cmd-` prefix), so a legitimate
  //     override of a subdir command false-warned as "non-existent".
  // `findContentFile` handles the subdir walk, the `cmd-` prefix strip, the
  // frontmatter-id fallback, and asserts `skills/<id>/SKILL.md` for the subdir
  // strategy — the same resolver `validateContentConsistency` already uses.
  for (const { dir, canonical } of CUSTOMIZATION_TYPES) {
    const customDir = join(rootDir, ".hatch3r", dir);
    const strategy: "glob" | "subdir" = canonical === "skills" ? "subdir" : "glob";
    try {
      const customFiles = await readdir(customDir);
      for (const file of customFiles) {
        if (file.endsWith(".customize.yaml")) {
          const itemId = file.replace(".customize.yaml", "");
          const found = await findContentFile(agentsDir, { dir: canonical, strategy }, itemId);
          if (!found) {
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
          result.warnings.push(`Content "${id}" (${key}) in manifest but missing from bundled ${cfg.dir}/`);
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

  // Validate learnings: schema, size, encoding, and denied patterns (#19 D15/D6).
  // F6.4-C1: learnings and handoffs live under the user's `.hatch3r/` state
  // directory, NOT under the bundled canonical content tree. Scanning the
  // bundled tree (which ships zero learnings) short-circuited via ENOENT and
  // silently passed poisoned user learnings.
  const learningsDir = join(rootDir, HATCH3R_DIR, "learnings");
  const learningsResult = await validateLearningsDirectory(learningsDir);
  for (const e of learningsResult.errors) {
    result.errors.push(e);
  }
  for (const w of learningsResult.warnings) {
    result.warnings.push(w);
  }

  // Validate handoffs: schema, size, integrity, expiry, git_ref drift
  const handoffsActiveDir = join(rootDir, HATCH3R_DIR, "handoffs", "active");
  const handoffsArchivedDir = join(rootDir, HATCH3R_DIR, "handoffs", "archived");
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
 * name it must live under inside `.hatch3r/overrides/`. Used by the type/dir
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
 * `.hatch3r/overrides/`. Strict failures push to `result.errors`; gentle failures
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
    const fileLabel = `.hatch3r/overrides/${item.relativePath}`;

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
    //
    // D14-M8 (Cycle 10 rollover): `override: true` in the user artifact's
    // frontmatter is the documented escape hatch — collision emits a
    // warning instead of an error so an intentional override does not fail
    // CI. Any other gate (deny-pattern, injection, size, etc.) still
    // applies.
    const fmOverride = fm.override === true;
    for (const collision of index.collisions) {
      if (collision.kind !== "user-shadow-canonical") continue;
      // Match either the existing OR duplicate path against this user item
      // so the error fires once per colliding pair regardless of scan order.
      if (collision.duplicatePath === item.relativePath || collision.existingPath === item.relativePath) {
        const canonicalSide = collision.duplicatePath === item.relativePath
          ? `${collision.existingType} ${collision.existingPath}`
          : `${collision.duplicateType} ${collision.duplicatePath}`;
        if (fmOverride) {
          result.warnings.push(
            `${fileLabel}: id "${collision.id}" overrides canonical ${canonicalSide} (override: true in frontmatter). The user version will shadow canonical in adapter output.`,
          );
        } else {
          result.errors.push(
            `${fileLabel}: id "${collision.id}" collides with canonical ${canonicalSide} — choose a different name or add 'override: true' to frontmatter`,
          );
        }
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
      const validEventList = [...VALID_HOOK_EVENTS].join(", ");
      if (!event) {
        result.errors.push(
          `${fileLabel}: hook missing 'event' field — declare one of ${validEventList}`,
        );
      } else if (!isValidHookEvent(event)) {
        result.errors.push(
          `${fileLabel}: hook has invalid event "${event}" — valid: ${validEventList}`,
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
 * Cycle 11 D5-35: imperative (base-form) verbs that, when they LEAD a skill
 * `description:`, read as a command rather than the third-person capability
 * statement Anthropic's SKILL.md spec recommends (so the model reads the
 * description as "what this skill does", e.g. "Generates ..." not
 * "Generate ..."). Matched only as a standalone first word (followed by
 * whitespace, not a hyphen) so compound-adjective leads like "Opt-in" or
 * "Eval-driven" — and noun-phrase leads like "Verification" / "Workflow" /
 * "Shared" — never trip the check. Curated from the canonical skill corpus
 * rather than morphologically derived, so it has no false positives on
 * non-verb leads.
 */
const IMPERATIVE_LEAD_VERBS = new Set<string>([
  "add", "audit", "author", "build", "capture", "configure", "containerize",
  "create", "cut", "define", "design", "detect", "diagnose", "draft", "elicit",
  "evaluate", "execute", "generate", "handle", "implement", "initialize",
  "load", "manage", "migrate", "monitor", "optimize", "persist", "plan",
  "profile", "refactor", "regenerate", "remove", "review", "run", "scaffold",
  "set", "track", "update", "validate", "verify", "write",
]);

/**
 * The third-person singular form the author should switch a flagged leading
 * verb to. Irregular/spelling cases are mapped explicitly; the rest take the
 * regular `+s` rule applied by {@link toThirdPersonSingular}.
 */
const THIRD_PERSON_OVERRIDES: Readonly<Record<string, string>> = {
  audit: "Audits",
  author: "Authors",
};

/** Capitalized third-person singular suggestion for an imperative verb. */
export function toThirdPersonSingular(verbLower: string): string {
  const override = THIRD_PERSON_OVERRIDES[verbLower];
  if (override) return override;
  const cap = verbLower.charAt(0).toUpperCase() + verbLower.slice(1);
  // Regular `+es` after a sibilant ending, else `+s`.
  if (/(?:s|x|z|ch|sh)$/.test(verbLower)) return `${cap}es`;
  return `${cap}s`;
}

/**
 * Cycle 11 D5-35: flag skill descriptions that LEAD with an imperative verb,
 * which degrades skill discovery under Anthropic's SKILL.md spec (third-person
 * capability statements read as "what the skill does"). Advisory WARNING — the
 * "Use when ..." clause and the rest of the description are left untouched;
 * only the leading verb is reported with a third-person suggestion. Scoped to
 * `type === "skill"` because the agent/rule/command classes carry different
 * description conventions (role nouns, scope clauses, orchestration verbs).
 */
export function validateSkillDescriptionVoice(artifacts: CatalogItem[]): string[] {
  const findings: string[] = [];
  for (const item of artifacts) {
    if (item.type !== "skill") continue;
    const desc = (item.description ?? "").trim();
    if (desc.length === 0) continue;
    // First word = leading run of letters; require a whitespace boundary after
    // it so hyphenated compounds ("Opt-in", "Eval-driven") are not first words.
    const m = /^([A-Za-z]+)\s/.exec(desc);
    if (!m) continue;
    const firstLower = m[1].toLowerCase();
    if (!IMPERATIVE_LEAD_VERBS.has(firstLower)) continue;
    findings.push(
      `skill ${item.relativePath}: description leads with imperative "${m[1]}" — use third-person "${toThirdPersonSingular(firstLower)}" for SKILL.md discovery (keep the "Use when ..." clause)`,
    );
  }
  return findings;
}

/**
 * Hook point: run the description-quality checks against the canonical
 * content index and fold the findings into the shared ValidationResult.
 * Length + collision findings emit on the errors channel (Wave C1 — same
 * pattern as validateCommandOrchestratorFrontmatter); the D5-35 third-person
 * voice check emits on the warnings channel (advisory, skill-scoped).
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
  for (const w of validateSkillDescriptionVoice(scoped)) {
    result.warnings.push(w);
  }
}

/**
 * C9-M29 (D5-content-body lint): scan canonical content `.md` bodies for
 * anti-slop wordlist hits and missing pillar references.
 *
 * Wordlist source: `governance/CONSTITUTION.md` §2 P5 (Anti-Slop principle)
 * mirrored in `.claude/rules/anti-slop-enforcement.md`. A hit is flagged
 * only when the banned phrase has no measurable qualifier within an 8-word
 * lookahead — the same heuristic as AUDIT-EXECUTE.md regression gate
 * "Anti-slop" (two-pass wordlist scan, hits lacking a measurable qualifier
 * within 8 words).
 *
 * Pillar-reference rule: every canonical `.md` under agents/, commands/,
 * rules/, skills/, hooks/ must declare at least one Binding Pillar (P1-P8)
 * via one of these channels:
 *   - frontmatter `pillars: [P1, P4]` (preferred)
 *   - body line `**Pillars:** P1, P4`
 *   - inline mention of any single token `P1`..`P8` in the body
 * Missing all three is flagged.
 *
 * Default emission is `warnings[]` so the lint surfaces drift without
 * tripping CI on legacy artifacts that predate the rule. The
 * `--strict-content` flag (opts.strictContent) escalates every finding to
 * an error so author skills and the audit cycle can hard-gate new artifacts
 * without disturbing the legacy backlog.
 */
const ANTI_SLOP_WORDLIST: Array<{ phrase: RegExp; label: string }> = [
  { phrase: /\bbest possible\b/i, label: "best possible" },
  { phrase: /\bbest-in-class\b/i, label: "best-in-class" },
  { phrase: /\bworld-class\b/i, label: "world-class" },
  { phrase: /\bcomprehensive and thorough\b/i, label: "comprehensive and thorough" },
  { phrase: /\bexhaustive\b/i, label: "exhaustive" },
  { phrase: /\brobust and resilient\b/i, label: "robust and resilient" },
  { phrase: /\bhigh-quality\b/i, label: "high-quality" },
  { phrase: /\bas needed\b/i, label: "as needed" },
  { phrase: /\bas appropriate\b/i, label: "as appropriate" },
  { phrase: /\bscalable\b/i, label: "scalable" },
  { phrase: /\bcarefully\b/i, label: "carefully" },
  { phrase: /\bthoroughly\b/i, label: "thoroughly" },
  { phrase: /\bit is important to note\b/i, label: "it is important to note" },
  { phrase: /\bthis section describes\b/i, label: "this section describes" },
];

// Qualifier-shaped tokens within the 8-word lookahead window that exempt a
// banned phrase: explicit numerics (% / digits / ratios), measurement units
// (ms/s/min/lines/files/MB/KB/calls/req/qps), confidence levels, severity
// terms, and section/code-fence references. The list mirrors the "measurable
// criteria" definition in CONSTITUTION §2 P5: a phrase escapes the wordlist
// only when paired with a specific testable measure.
const MEASURABLE_QUALIFIER_RE =
  /\b(\d+%|\d+(?:\.\d+)?(?:\s*(?:ms|s|sec|min|h|hr|hour|day|week|line|lines|file|files|byte|bytes|kb|mb|gb|call|calls|req|qps|rps|tokens|items))?|95th|90th|99th|p50|p95|p99|tier-?[123]|severity\s+(?:critical|high|medium|low|info)|confidence\s+(?:high|medium|low)|<=|>=|≤|≥|<|>|±|N\/M|per\s+\d+|\bSLA\b|\bSLO\b|\b<\d|\d+x)\b/i;

/**
 * Walk the supplied directory recursively, returning the absolute paths
 * of every `.md` file (excluding `.mdc` siblings and dotfiles).
 */
/**
 * F16.3-H3 (D16) / Decision 13: returns true when the command file at
 * `commandPath` is a genuine orchestrator — frontmatter `orchestrator: true`
 * with a non-empty `agentPipeline` array. Used to decide whether a
 * command↔skill ID collision is a legitimate delegation/inline pair or a
 * Decision-13 duplicate. A read/parse failure returns false (fail toward
 * surfacing the collision) and records a diagnostic on `result.warnings`
 * (Silent Failure Contract, CONSTITUTION §2 P5) rather than swallowing it.
 */
async function commandOrchestrates(commandPath: string, result: ValidationResult): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(commandPath, "utf-8");
  } catch (err) {
    result.warnings.push(
      `Could not read command ${commandPath} to verify Decision-13 orchestrator status — treating its id collision as a duplicate (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
  if (!raw.startsWith("---")) return false;
  const endIdx = raw.indexOf("---", 3);
  if (endIdx === -1) return false;
  let fm: Record<string, unknown> | null;
  try {
    fm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
  } catch (err) {
    result.warnings.push(
      `Could not parse frontmatter of command ${commandPath} to verify Decision-13 orchestrator status — treating its id collision as a duplicate (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
  if (!fm) return false;
  const orchestrator = fm.orchestrator === true;
  const pipeline = fm.agentPipeline;
  const hasPipeline = Array.isArray(pipeline) && pipeline.length > 0;
  return orchestrator && hasPipeline;
}

// D5-H8 / D16-H10 (Decision 13): the mandatory handoff-section marker a
// skill twin must carry to document a command↔skill execution-model split.
// Heading form: `## Relationship to ... (Decision 13 handoff)`. The
// `(Decision 13 handoff)` label is the load-bearing token; the linked
// command path between "Relationship to" and the label varies per skill.
const DECISION13_HANDOFF_MARKER = /^#{1,4}\s+Relationship to\b.*\(Decision 13 handoff\)/im;

/**
 * D5-H8 / D16-H10 (Decision 13): returns true when a skill body declares the
 * Decision-13 handoff section that documents the command↔skill split. Pure
 * (no I/O) so the marker contract is unit-testable; `skillDocumentsDecision13Split`
 * is the file-reading wrapper used by the collision gate.
 */
export function bodyHasDecision13Handoff(raw: string): boolean {
  return DECISION13_HANDOFF_MARKER.test(raw);
}

/**
 * D5-H8 / D16-H10 (Decision 13): returns true when the skill twin at
 * `skillPath` carries the mandatory Decision-13 handoff section. Without
 * this documentation an orchestrating command and its id-sharing skill ship
 * as an undocumented twin pair: Claude Code resolves the slash name to the
 * skill, shadowing the command, with no artifact recording the split. A read
 * failure returns false (fail toward surfacing the gap) and records a
 * diagnostic on `result.warnings` (Silent Failure Contract, CONSTITUTION §2
 * P5).
 */
async function skillDocumentsDecision13Split(
  skillPath: string,
  result: ValidationResult,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(skillPath, "utf-8");
  } catch (err) {
    result.warnings.push(
      `Could not read skill ${skillPath} to verify the Decision-13 handoff section — treating the command↔skill twin as undocumented (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
  return bodyHasDecision13Handoff(raw);
}

async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childPath = join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(childPath);
      } else if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(childPath);
        for (const p of nested) found.push(p);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return found;
}

/**
 * Two-pass scan: find each banned phrase, then check the 8-word lookahead
 * window for a measurable qualifier per CONSTITUTION §2 P5. Returns one
 * finding string per surviving hit.
 */
export function scanAntiSlopHits(body: string, fileLabel: string): string[] {
  const findings: string[] = [];
  for (const entry of ANTI_SLOP_WORDLIST) {
    // Walk every match position so multiple hits in the same body are caught.
    const globalRe = new RegExp(entry.phrase.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalRe.exec(body)) !== null) {
      const tail = body.slice(match.index + match[0].length);
      const lookaheadWords = tail.split(/\s+/, 8).join(" ");
      if (MEASURABLE_QUALIFIER_RE.test(lookaheadWords)) continue;
      // Locate the 1-based line number for the matched offset to make the
      // finding actionable (file:line label).
      const upTo = body.slice(0, match.index);
      const lineNumber = upTo.split("\n").length;
      findings.push(
        `${fileLabel}:${lineNumber}: anti-slop "${entry.label}" without a measurable qualifier in the next 8 words — replace per CONSTITUTION.md §2 P5 wordlist`,
      );
      // Cap per-file per-phrase findings at 1 to keep the report bounded.
      break;
    }
  }
  return findings;
}

/**
 * Pillar-reference detection: returns true when the file declares at least
 * one P1..P8 reference via frontmatter `pillars:` or any body mention.
 */
export function hasPillarReference(parsedFm: Record<string, unknown> | null, body: string): boolean {
  if (parsedFm) {
    const fmPillars = parsedFm.pillars;
    if (Array.isArray(fmPillars) && fmPillars.some((v) => typeof v === "string" && /^P[1-8]$/.test(v))) {
      return true;
    }
    if (typeof fmPillars === "string" && /\bP[1-8]\b/.test(fmPillars)) {
      return true;
    }
  }
  // Body-line forms: `**Pillars:** P1, P4`, `Pillars: P1`, or any inline P1..P8.
  if (/\bP[1-8]\b/.test(body)) return true;
  return false;
}

/**
 * Entry point invoked from validateCommand. Scans every canonical `.md`
 * under {canonicalRoot}/agents, /commands, /rules, /skills, /hooks for
 * anti-slop hits and missing pillar references.
 *
 * Findings emit on the warnings channel by default; with strictContent=true
 * they escalate to errors.
 */
async function validateContentBody(
  canonicalRoot: string,
  result: ValidationResult,
  strictContent: boolean,
): Promise<void> {
  const scanDirs = ["agents", "commands", "rules", "skills", "hooks"];
  const sink: string[] = strictContent ? result.errors : result.warnings;

  for (const dir of scanDirs) {
    const dirPath = join(canonicalRoot, dir);
    const files = await listMarkdownFiles(dirPath);
    for (const filePath of files) {
      // Skip `.mdc` siblings — only `.md` is canonical (rule-parity validator
      // keeps the pair in sync). Skip frontmatter-only files (no body to scan).
      let raw: string;
      try {
        raw = await readFile(filePath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        continue;
      }
      // Compute the relative label for the finding message — relative to the
      // canonical content root so the label reads e.g. `rules/foo.md`.
      // Windows: `filePath` carries native `\` separators (join in
      // listMarkdownFiles), but this label is both shown to users as a POSIX
      // path AND matched against POSIX `/` prefixes/suffixes in
      // requiresAmbiguityGate (e.g. `agents/shared/`, `/SKILL.md`). Without
      // normalization the `agents/shared/` + `agents/modes/` companion-file
      // exemption misses on Windows, raising a spurious "missing §0 ambiguity
      // gate" error that fails every validate run. Force forward slashes.
      const fileLabel = filePath.slice(canonicalRoot.length + 1).split(/[\\/]/).join(posix.sep);

      // Split frontmatter vs body. The body is the only scan target — banned
      // phrases inside frontmatter `description:` are caught by the
      // description-quality lint, not this one.
      let parsedFm: Record<string, unknown> | null = null;
      let body = raw;
      if (raw.startsWith("---")) {
        const endIdx = raw.indexOf("---", 3);
        if (endIdx !== -1) {
          try {
            parsedFm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
          } catch (err) {
            // D8-M2 (Silent Failure Contract, CONSTITUTION §2 P5): emit a
            // warning so operators see the parse failure even when the
            // anti-slop/pillar pass is the only consumer that runs against
            // this file. validateFrontmatter reports the same defect for
            // canonical agents/skills/commands/hooks but is not guaranteed
            // to fire here (sink is the per-pass results buffer); a silent
            // skip was previously the only diagnostic surface.
            const message = err instanceof Error ? err.message : String(err);
            sink.push(
              `${fileLabel}: YAML frontmatter parse failed during anti-slop scan — ${message}`,
            );
            parsedFm = null;
          }
          body = raw.slice(endIdx + 3);
        }
      }

      // Anti-slop scan over the body only.
      for (const finding of scanAntiSlopHits(body, fileLabel)) {
        sink.push(finding);
      }

      // Pillar-reference rule.
      if (!hasPillarReference(parsedFm, body)) {
        sink.push(
          `${fileLabel}: missing pillar reference — declare at least one of P1..P8 via 'pillars: [P1, ...]' in frontmatter or a '**Pillars:** P1, ...' line in the body (CLAUDE.md "7 Binding Pillars")`,
        );
      }

      // F13.5-F01 (D13, P8 B1): the §0 ambiguity-detection gate is mandated on
      // every published agent / command / skill by
      // `rules/hatch3r-clarification-default.md`. Enforce it here so an artifact
      // that drops the gate fails CI rather than silently shipping without
      // clarification-default behavior. Reference subdirectories
      // (agents/shared, agents/modes, commands/board, commands/revision,
      // commands/shared) are companion material, not standalone mutating
      // artifacts, so they are exempt — matching the prefix-exemption split in
      // content-authoring.
      if (requiresAmbiguityGate(dir, fileLabel)) {
        const gate = checkAmbiguityGate(body);
        if (!gate.hasMarker) {
          // Missing the gate entirely is always an error: it is a hard floor.
          result.errors.push(
            `${fileLabel}: missing §0 ambiguity-detection gate — every agent/command/skill must declare a "§0"/"Step 0 — Ambiguity" block (or reference agents/shared/user-question-protocol.md) per rules/hatch3r-clarification-default.md (P8 B1)`,
          );
        } else if (!gate.referencesProtocol) {
          // Marker present but no protocol reference is weak prose: warn so the
          // author wires it to the canonical "how to ask" surface — directly or
          // via the blessed one-hop frames (clarification-default-block.md /
          // quality-specialist-frame.md), both accepted by checkAmbiguityGate.
          result.warnings.push(
            `${fileLabel}: §0 ambiguity gate present but does not reference the canonical question protocol — cite agents/shared/user-question-protocol.md directly OR via agents/shared/clarification-default-block.md / quality-specialist-frame.md (P8 B1)`,
          );
        }
      }
    }
  }
}

/**
 * F13.5-F01 (D13): which scanned files must carry the §0 ambiguity gate.
 * Applies to top-level published agents, commands, and skills. Companion
 * material under reference subdirectories (agents/shared, agents/modes,
 * commands/board, commands/revision, commands/shared) is exempt — it is not a
 * standalone mutating artifact, mirroring the filename-prefix exemption in
 * `.claude/rules/content-authoring.md`.
 */
export function requiresAmbiguityGate(dir: string, fileLabel: string): boolean {
  if (dir !== "agents" && dir !== "commands" && dir !== "skills") return false;
  const EXEMPT_SUBDIRS = [
    "agents/shared/",
    "agents/modes/",
    "commands/board/",
    "commands/revision/",
    "commands/shared/", // shared command boilerplate (e.g. orchestration-frame.md, type: shared-context) — companion material cited by orchestrators, not a standalone mutating command
    "skills/hatch3r-board-shared/", // board companion skill (parity with commands/board/)
  ];
  if (EXEMPT_SUBDIRS.some((prefix) => fileLabel.startsWith(prefix))) return false;
  // Skill reference material is companion content, not a standalone mutating
  // entry point: only the top-level SKILL.md carries the §0 gate. This exempts
  // every `skills/<id>/references/**` (and any non-SKILL.md file under a skill).
  if (dir === "skills" && !fileLabel.endsWith("/SKILL.md")) return false;
  return true;
}

/**
 * F13.5-F01 (D13): detect the §0 ambiguity-detection gate in an artifact body.
 * `hasMarker` is true when a recognizable gate heading/marker is present;
 * `referencesProtocol` is true when the body points at the canonical question
 * protocol either directly (`agents/shared/user-question-protocol.md` — the
 * "how to ask" surface) OR via the blessed one-hop indirection through the
 * shared clarification frames: `agents/shared/clarification-default-block.md`
 * (the canonical pointer that agents.md authoring-rule 1 mandates citing) or
 * `agents/shared/quality-specialist-frame.md` (the transitive frame the 9 CQ
 * specialists incorporate per authoring-rule 2). Accepting the one-hop forms
 * closes F24.4-D13-8: `clarification-default-block.md` explicitly FORBIDS
 * inlining the protocol body, so the 15 agents that satisfy B1 through it must
 * not be flagged for "not referencing user-question-protocol" — that made the
 * §2 P5 "100%" B1 invariant false against its own check. Every `hasMarker`
 * disjunct is heading-anchored (D5-36): the trigger phrase must lead a markdown
 * heading, so an inline blockquote or body sentence no longer counts as a gate.
 * Heading phrasing itself stays flexible (e.g. "## §0 — Ambiguity & Safety
 * Gate", "## Step 0 — Ambiguity gate", "## Step 0 — Detect Ambiguity (P8 B1)").
 */
export function checkAmbiguityGate(body: string): { hasMarker: boolean; referencesProtocol: boolean } {
  // D5-36 (Cycle 11 Wave 3, D5 Medium): every marker disjunct is now anchored
  // to a markdown heading line. Previously only the §0 disjunct (D13-26) was
  // heading-anchored; the three Step-0/ambiguity disjuncts matched bare prose
  // anywhere in the body, so an inline blockquote — e.g. `> **Ambiguity
  // detection (P8 B1):** ...` in skills/hatch3r-feature/SKILL.md:40 — registered
  // hasMarker===true without a real §0/Step-0 section. That let a skill ship the
  // gate-coverage floor as a sentence instead of a structured gate, while the
  // §2 P5 "Ambiguity-detection gate coverage" row demands a real block.
  // `HEADING` matches an ATX heading start (`#`..`####`, up to 3 leading
  // spaces); each disjunct requires its trigger phrase to appear on that same
  // heading line, so only a genuine gate section satisfies the marker. The
  // `(?!\.\d)` lookahead on the §0 disjunct still rejects a `§0.5` subsection.
  const HEADING = String.raw`^\s{0,3}#{1,4}\s*`;
  const hasMarker =
    new RegExp(HEADING + String.raw`§\s*0\b(?!\.\d)`, "m").test(body) ||
    new RegExp(HEADING + String.raw`[^\n]*\bstep\s*0\b[^\n]*ambig`, "im").test(body) ||
    new RegExp(HEADING + String.raw`[^\n]*\bambiguity[- ](detection|gate|&)`, "im").test(body) ||
    new RegExp(HEADING + String.raw`[^\n]*\bambiguity\b[^\n]*\bgate\b`, "im").test(body);
  const referencesProtocol =
    /user-question-protocol/.test(body) ||
    /clarification-default-block/.test(body) ||
    /quality-specialist-frame/.test(body);
  return { hasMarker, referencesProtocol };
}

/**
 * F2.4-F1 (Cycle 10 Wave 1, D2 Critical, ASI02): enumerate every published
 * agent under `<canonicalRoot>/agents/*.md` (frontmatter `type: agent`) and
 * verify each id has a registered entry in `AGENT_TOOL_POLICIES`. Closes the
 * NO_POLICY silent-denial path under the Claude PreToolUse hook for the 11
 * 2.0.0 agents (9 quality specialists + 2 spec agents) that were absent from
 * the registry. Mirrors the runtime check used by
 * `src/__tests__/pipeline/agentToolAllowlist.test.ts` so the build-time and
 * validate-time gates stay aligned.
 *
 * Errors emit on `result.errors` so CI exits non-zero when an agent file
 * exists without a matching policy.
 */
async function validateAgentToolPolicyCoverage(
  canonicalRoot: string,
  result: ValidationResult,
  userRepoRoot?: string,
): Promise<void> {
  // Lazy-import the registry to avoid pulling the pipeline module into every
  // validate invocation when the canonical agents/ directory is absent
  // (e.g., consumer repo with a partial bundle).
  const agentsDir = join(canonicalRoot, "agents");
  let entries: Dirent[];
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Canonical agents/ absent — still scan the user override tree below so
      // a consumer repo with only user agents gets coverage warnings.
      entries = [];
    } else {
      throw err;
    }
  }

  const filesystemIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(agentsDir, entry.name);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!raw.startsWith("---")) continue;
    const endIdx = raw.indexOf("---", 3);
    if (endIdx === -1) continue;
    let fm: Record<string, unknown> | null;
    try {
      fm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
    } catch (err) {
      // D8-M2 (Silent Failure Contract, CONSTITUTION §2 P5): a silent skip
      // here previously hid malformed agent frontmatter from the
      // AGENT_TOOL_POLICIES coverage gate, so an agent with broken YAML
      // would slip past ASI02 deny-by-default detection. Surface the
      // parse failure on `result.warnings` so the maintainer sees the
      // root cause even when validateFrontmatter ran first.
      const message = err instanceof Error ? err.message : String(err);
      result.warnings.push(
        `agents/${entry.name}: YAML frontmatter parse failed during agent-tool-policy coverage scan — ${message}`,
      );
      continue;
    }
    if (!fm || typeof fm !== "object") continue;
    if (fm.type !== "agent") continue;
    if (typeof fm.id !== "string") continue;
    filesystemIds.push(fm.id);
  }

  const { AGENT_TOOL_POLICIES } = await import("../../pipeline/agentToolAllowlist.js");
  const policyIds = new Set(AGENT_TOOL_POLICIES.map((p) => p.agentId));
  if (filesystemIds.length > 0) {
    const missing = filesystemIds.filter((id) => !policyIds.has(id)).sort();
    for (const id of missing) {
      result.errors.push(
        `Agent "${id}" (agents/${id}.md) has no AGENT_TOOL_POLICIES entry — ` +
          `add an AgentToolPolicy in src/pipeline/agentToolAllowlist.ts so ASI02 deny-by-default ` +
          `does not silently block every tool call by this agent.`,
      );
    }
  }

  // D20-1 (X5/CD5): user-authored agents under `.hatch3r/overrides/agents/` are
  // re-prefixed to `hatch3r-<slug>` and have no canonical AGENT_TOOL_POLICIES
  // entry by construction. The Claude adapter derives a runtime policy from
  // each user agent's authored `tools.allowed`/`tools.denied` grant, so the
  // policy doc the PreToolUse hook reads DOES carry a row for them. But a user
  // agent that declared no `tools` grant (or an empty `allowed`) derives an
  // empty allowlist — the hook then denies its every tool call. Warn (not
  // error: user content lives outside the framework's commit gate, and the
  // disposition is "fix your grant", not "block CI") so the author adds a
  // `tools: { allowed: [...] }` block. Canonical-id collisions are impossible
  // (the user-content slug gate forbids the `hatch3r-` prefix), so this scan
  // never double-reports a canonical agent.
  await scanUserAgentPolicyCoverage(userRepoRoot, result);
}

/**
 * D20-1 (X5/CD5): scan `.hatch3r/overrides/agents/` and warn for any user agent
 * whose authored `tools` grant resolves to an empty allowlist — that agent is
 * NO_POLICY/deny-all under the Claude PreToolUse hook at runtime. A user agent
 * with a non-empty `tools.allowed` (minus `tools.denied`) is covered by the
 * Claude adapter's derived policy and produces no warning.
 *
 * Read-only; tolerates an absent override tree (the common case) and surfaces
 * malformed user-agent YAML on the warning channel rather than skipping it
 * silently (Silent Failure Contract).
 */
async function scanUserAgentPolicyCoverage(
  userRepoRoot: string | undefined,
  result: ValidationResult,
): Promise<void> {
  if (!userRepoRoot) return;
  const userAgentsDir = join(resolveUserContentRoot(userRepoRoot), "agents");
  let entries: Dirent[];
  try {
    entries = await readdir(userAgentsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const { ALL_TOOL_CATEGORIES } = await import("../../pipeline/agentToolAllowlist.js");
  const known = new Set<string>(ALL_TOOL_CATEGORIES);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(userAgentsDir, entry.name);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!raw.startsWith("---")) continue;
    const endIdx = raw.indexOf("---", 3);
    if (endIdx === -1) continue;
    let fm: Record<string, unknown> | null;
    try {
      fm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.warnings.push(
        `.hatch3r/overrides/agents/${entry.name}: YAML frontmatter parse failed during user-agent tool-policy coverage scan — ${message}`,
      );
      continue;
    }
    if (!fm || typeof fm !== "object") continue;
    if (fm.type !== "agent") continue;

    // Resolve the authored grant the same way the Claude adapter does:
    // allowed minus denied, restricted to known categories (deny-by-default).
    const toolsRaw = fm.tools;
    let allowed: string[] = [];
    let denied: string[] = [];
    if (toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)) {
      const t = toolsRaw as Record<string, unknown>;
      if (Array.isArray(t.allowed)) {
        allowed = t.allowed.filter((c): c is string => typeof c === "string" && known.has(c));
      }
      if (Array.isArray(t.denied)) {
        denied = t.denied.filter((c): c is string => typeof c === "string");
      }
    }
    const deniedSet = new Set(denied);
    const effective = allowed.filter((c) => !deniedSet.has(c));
    if (effective.length === 0) {
      const name = entry.name.replace(/\.md$/, "");
      result.warnings.push(
        `User agent ".hatch3r/overrides/agents/${entry.name}" has no effective tool grant — ` +
          `the Claude PreToolUse hook will deny its every tool call (NO_POLICY/deny-all) at runtime. ` +
          `Add a 'tools: { allowed: [read, search, ...] }' block (canonical categories: ${ALL_TOOL_CATEGORIES.join(", ")}) ` +
          `so the adapter derives a runtime policy for the emitted "hatch3r-${name}" agent.`,
      );
    }
  }
}

/**
 * D5-2 (Cycle 11 Wave 2, High): body-vs-policy capability-coverage gate.
 *
 * The F2.4-F1 gate above only checks that a policy EXISTS for each agent. It
 * does not check that the policy GRANTS the capabilities the agent's prompt
 * body instructs it to use. The D5-2 finding caught five agents
 * (architect / ci-watcher / context-rules / docs-writer / lint-fixer) whose
 * bodies told them to run web research, Context7 MCP `resolve-library-id`
 * lookups, and (for ci-watcher/docs-writer) platform-CLI / lint shell commands,
 * while their `AGENT_TOOL_POLICIES` allowlist omitted the matching `web`/`mcp`/
 * `execute` category. Under the Claude PreToolUse hook those calls were denied
 * silently (TOOL_NOT_ALLOWED) — the agent followed its own instructions and was
 * blocked with no actionable signal, the same silent-failure class as the
 * NO_POLICY path. The policies were corrected in the same finding; this gate
 * regression-locks the body⊆policy property so a future prompt edit that adds a
 * capability instruction (or a policy edit that drops a category) fails CI.
 *
 * Scope: the five agents named in D5-2. The gate is deliberately NOT corpus-wide
 * — several review-only agents (the 9 CQ specialists, hatch3r-reviewer,
 * hatch3r-learnings-loader) carry prose that mentions shell commands they
 * describe but do not themselves run (e.g. the shared VERIFY_GATE placeholder,
 * an illustrative `gh run list` for reading CI history), and producer agents
 * (implementer/fixer) name `WebSearch`/Context7 in boundary/never clauses or
 * when describing the researcher's modes, not as their own directives. Their
 * `["read","search"]` (review-only) and execute-only (producer) policies are
 * deliberate invariants (agentToolAllowlist.test.ts "applies review-only
 * allowlist"). A naive "any capability mention ⇒ require the category" scan
 * false-positives on ~15 such prose sites, so the gate binds an explicit
 * allowlist of producer agents whose bodies issue genuine self-directives;
 * full-corpus generalization is a separate change that must first reconcile that
 * review-only/boundary prose.
 *
 * D5-25 (Cycle 11 Wave 3, Medium) confirms this gate IS the body-vs-policy
 * heuristic the finding requires (its root cause — "no validator detects a body
 * instructing a denied capability" — predates this D5-2 gate). D5-24 (same wave)
 * closed the one named coverage gap, hatch3r-devops: it grants the devops
 * `web`+`mcp` categories in src/pipeline/agentToolAllowlist.ts and adds the devops
 * scope entry to D5_2_BODY_CAPABILITY_AGENTS in the same atomic commit, so the
 * gate fires on devops only after the grant exists. See the literal below — the
 * scanned set is now six agents.
 *
 * Detection uses high-precision directive patterns (not loose keyword matching)
 * so an incidental mention ("the agent does not need WebFetch") does not trip a
 * false positive. Each detected capability is checked against the agent's
 * registered policy; a miss emits on `result.errors` so CI exits non-zero.
 */
const D5_2_BODY_CAPABILITY_AGENTS = [
  "hatch3r-architect",
  "hatch3r-ci-watcher",
  "hatch3r-context-rules",
  "hatch3r-docs-writer",
  "hatch3r-lint-fixer",
  // D5-24 (Cycle 11 Wave 3, Medium): hatch3r-devops's body issues genuine "Use
  // web research" / "Use Context7 MCP" directives (agents/hatch3r-devops.md
  // §Design steps + §External Knowledge focus sections). D5-24 grants the matching
  // `web`+`mcp` categories in src/pipeline/agentToolAllowlist.ts AND adds this
  // scope entry in the same atomic wave commit, so the gate activates only after
  // the grant exists (no false-positive ERROR). The D5-25 root cause — "a
  // body-vs-policy capability gate exists at all" — is satisfied by
  // validateAgentBodyCapabilityCoverage (this function); adding devops here closes
  // the one named coverage gap D5-25 deferred to D5-24.
  "hatch3r-devops",
] as const;

/**
 * High-precision body→capability directive detectors. Each entry maps a
 * canonical tool category to the instruction patterns that mean "this agent is
 * told to exercise this capability itself". Patterns are intentionally narrow:
 * they match imperative directive forms, a populated focus section, or a
 * `tools.allow` token — not every incidental keyword.
 */
const CAPABILITY_BODY_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  // Web research: the imperative "Use web research", a populated
  // "Web research focus for this agent:" section, or a WebSearch/WebFetch token.
  web: [
    /\bUse web research\b/i,
    /\*\*Web research focus for this agent:\*\*/,
    /\bWebSearch\b/,
    /\bWebFetch\b/,
  ],
  // Context7 MCP: the imperative "Use Context7 MCP", the resolve-library-id /
  // query-docs call pair, or a populated "Context7 focus for this agent:" section.
  mcp: [
    /\bUse Context7 MCP\b/i,
    /\bresolve-library-id\b/,
    /\bquery-docs\b/,
    /\*\*Context7 focus for this agent:\*\*/,
  ],
  // Execute (shell): platform CI CLI verbs, the markdown-lint command, or the
  // lint auto-fix directive these agents run to reproduce/verify locally.
  execute: [
    /\bgh run (?:list|view|watch)\b/,
    /\baz pipelines run\b/,
    /\bglab ci\b/,
    /\bnpx markdownlint\b/,
    /\blint:fix\b/,
  ],
};

/**
 * Negation guard: a line that explicitly disclaims a capability ("does not need
 * WebFetch", "No execute") must not be read as an instruction to use it. Applied
 * per matched line before counting a capability as instructed.
 */
function lineDisclaimsCapability(line: string): boolean {
  // Tolerate markdown emphasis around "not" (e.g. "does **not** need WebFetch")
  // so a disclaimer that uses bold/italic is still recognized as a disclaimer.
  const notMarker = "[*_]{0,2}not[*_]{0,2}";
  return new RegExp(`\\bdo(?:es)?\\s+${notMarker}\\s+need\\b`, "i").test(line) ||
    /\b(?:no longer use|never use|out of scope|not (?:in scope|required))\b/i.test(line) ||
    /^\s*[-*]\s*\*\*Never:\*\*/.test(line);
}

async function validateAgentBodyCapabilityCoverage(
  canonicalRoot: string,
  result: ValidationResult,
): Promise<void> {
  const agentsDir = join(canonicalRoot, "agents");
  const { getAgentToolPolicy } = await import("../../pipeline/agentToolAllowlist.js");

  for (const agentId of D5_2_BODY_CAPABILITY_AGENTS) {
    const filePath = join(agentsDir, `${agentId}.md`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // partial bundle
      throw err;
    }

    // Strip frontmatter so a `tags:`/`description:` keyword cannot be misread as
    // a body directive; the capability instructions all live in the prose body.
    let body = raw;
    if (raw.startsWith("---")) {
      const endIdx = raw.indexOf("---", 3);
      if (endIdx !== -1) body = raw.slice(endIdx + 3);
    }

    const policy = getAgentToolPolicy(agentId);
    if (!policy) {
      // The F2.4-F1 coverage gate already errors on a missing policy; do not
      // double-report. Skip the body check — there is nothing to compare against.
      continue;
    }
    const granted = new Set(policy.allowedTools);

    for (const [category, patterns] of Object.entries(CAPABILITY_BODY_PATTERNS)) {
      // A capability is "instructed" when a pattern matches on a non-disclaiming
      // line.
      let instructed = false;
      for (const pattern of patterns) {
        for (const line of body.split("\n")) {
          if (pattern.test(line) && !lineDisclaimsCapability(line)) {
            instructed = true;
            break;
          }
        }
        if (instructed) break;
      }
      if (instructed && !granted.has(category)) {
        result.errors.push(
          `Agent "${agentId}" (agents/${agentId}.md) instructs the "${category}" capability in its body ` +
            `but its AGENT_TOOL_POLICIES allowlist (${policy.allowedTools.join(", ")}) does not grant it — ` +
            `the Claude PreToolUse hook will deny that tool call silently (TOOL_NOT_ALLOWED). ` +
            `Add "${category}" to this agent's policy in src/pipeline/agentToolAllowlist.ts, or remove the ` +
            `instruction from the body. (D5-2 body⊆policy gate.)`,
        );
      }
    }
  }
}

/**
 * D9-H-6 (Cycle 10 D9, Pillar P1): a canonical skill that declares an execute
 * capability — i.e. it wraps a shell binary via a `cli_tool.bin` frontmatter
 * field — MUST also declare a non-empty `allowed_tools` (or `allowed-tools`)
 * array. The Copilot adapter renders that array as an `allowed-tools:` line on
 * `.github/skills/<id>/SKILL.md` so the GitHub Copilot Skills runtime
 * pre-approves the wrapped binary and skips the per-invocation
 * tool-confirmation prompt
 * (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills,
 * accessed 2026-05-26). Without the field the skill ships, Copilot re-prompts
 * for every shell call, and the friction the finding closes returns silently.
 *
 * Scope: only `skills/<id>/SKILL.md` files whose frontmatter carries a
 * `cli_tool.bin`. Reference/selection skills that wrap no executable (e.g.
 * `hatch3r-cli-toolbox`, which indexes 29 tools but invokes none itself) have
 * no `cli_tool.bin` and are exempt — they expose no execute capability to
 * pre-approve.
 *
 * Errors emit on `result.errors` so CI exits non-zero when an execute-capable
 * skill omits `allowed_tools`.
 */
export async function validateSkillAllowedTools(
  canonicalRoot: string,
  result: ValidationResult,
): Promise<void> {
  const skillsDir = join(canonicalRoot, "skills");
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillPath, "utf-8");
    } catch (err) {
      // Missing SKILL.md is reported by validateFrontmatter; not this gate's
      // concern. Any other read error propagates.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!raw.startsWith("---")) continue;
    const endIdx = raw.indexOf("---", 3);
    if (endIdx === -1) continue;
    let fm: Record<string, unknown> | null;
    try {
      fm = parseYaml(raw.slice(3, endIdx).trim()) as Record<string, unknown> | null;
    } catch (err) {
      // D8-M2 (Silent Failure Contract, CONSTITUTION §2 P5): a silent skip
      // here previously hid malformed skill frontmatter from the
      // allowed_tools coverage gate, so a skill with broken YAML could
      // ship without the Copilot-skills pre-approval field and re-prompt
      // every invocation. Surface the parse failure on result.warnings.
      const message = err instanceof Error ? err.message : String(err);
      result.warnings.push(
        `skills/${entry.name}/SKILL.md: YAML frontmatter parse failed during allowed_tools coverage scan — ${message}`,
      );
      continue;
    }
    if (!fm || typeof fm !== "object") continue;

    // Execute capability = a `cli_tool.bin` shell binary. Skills without it
    // wrap no executable and are exempt.
    const cliTool = fm.cli_tool;
    const bin =
      cliTool && typeof cliTool === "object" && !Array.isArray(cliTool)
        ? (cliTool as Record<string, unknown>).bin
        : undefined;
    if (typeof bin !== "string" || bin.length === 0) continue;

    // The skill wraps `bin` → it MUST pre-approve at least one tool.
    const allowed = fm.allowed_tools ?? fm["allowed-tools"];
    const hasAllowed =
      Array.isArray(allowed) && allowed.some((t) => typeof t === "string" && t.length > 0);
    if (!hasAllowed) {
      result.errors.push(
        `Skill "${entry.name}" (skills/${entry.name}/SKILL.md) wraps shell binary "${bin}" ` +
          `(cli_tool.bin) but declares no allowed_tools — add a non-empty ` +
          `\`allowed_tools: ["${bin}"]\` frontmatter array so the Copilot Skills runtime ` +
          `pre-approves the binary and skips the per-invocation confirmation prompt ` +
          `(D9-H-6, P1).`,
      );
    }
  }
}

export async function validateDocsCounts(rootDir: string): Promise<{ mismatches: string[]; checked: number }> {
  const mismatches: string[] = [];
  let checked = 0;

  const actual: Record<string, number> = {};
  const dirs: [string, string, (e: string) => boolean][] = [
    ["adapters", join(rootDir, "src/adapters"), (e) => e.endsWith(".ts") && !["base.ts", "index.ts", "canonical.ts", "customization.ts", "types.ts", "mcp-utils.ts", "contextBudget.ts"].includes(e)],
    ["commands", join(rootDir, "src/cli/commands"), (e) => e.endsWith(".ts")],
    ["agents", join(rootDir, "agents"), (e) => e.endsWith(".md")],
    ["skills", join(rootDir, "skills"), (_e) => true],
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
 * D11-SA11.2-F13 (Wave 7+8, D11, P5+P6): structural-integrity scan over the
 * managed blocks in on-disk adapter outputs under `.claude/`, `.cursor/`, and
 * `.github/`. This is the complement to `hatch3r status` / `hatch3r verify`,
 * which already do full regenerate-and-diff content drift. This scan does NOT
 * re-derive canonical content; it only checks that the HATCH3R:BEGIN/END
 * marker structure on disk is well-formed, so a hand-broken block surfaces as
 * an actionable warning instead of failing silently the next time an adapter
 * tries to merge into it.
 *
 * Detected anomalies (one warning string each):
 *   1. Orphan marker — a BEGIN with no matching END (or an END with no
 *      preceding BEGIN).
 *   2. Duplicate / nested marker — a second BEGIN before the open block's END,
 *      or a duplicate END.
 *   3. Wrong host-comment syntax — HTML `<!-- -->` markers inside a `.yml` /
 *      `.yaml` file, or YAML `#` markers inside a `.md` / `.mdc` file. The
 *      expected syntax per extension is read from {@link getMarkersForPath}
 *      (the same selector adapters write through), so this stays in lockstep
 *      with marker emission. Issue #76: HTML markers inside a YAML workflow
 *      break the GitHub Actions parse on line 2.
 *
 * Every anomaly names the file, the anomaly, and the remedy (`hatch3r sync`).
 * All findings are warnings — a tampered block is advisory and fixable via a
 * resync, never a hard error. ENOENT and unreadable files are skipped, not
 * thrown; a missing adapter directory yields an empty array.
 */
export async function scanManagedBlockTampering(rootDir: string): Promise<string[]> {
  const warnings: string[] = [];

  // Adapter-output roots and the leaf-file filter each one contributes. Globbed
  // by walking each directory; missing dirs are skipped (catch below).
  const adapterDirs = [".claude", ".cursor", ".github"];

  // Recursively collect managed-block-candidate files (text extensions only;
  // JSON is never wrapped in a managed block per getMarkersForPath).
  const candidateExt = [".md", ".mdc", ".yml", ".yaml"];
  const files: string[] = [];
  async function collect(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: tamper-scan readdir(${dir}) skipped — ${message}`);
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(full);
      } else if (entry.isFile() && candidateExt.some((e) => entry.name.toLowerCase().endsWith(e))) {
        files.push(full);
      }
    }
  }
  for (const d of adapterDirs) {
    await collect(join(rootDir, d));
  }

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`validate: tamper-scan readFile(${file}) skipped — ${message}`);
      continue;
    }

    const rel = file.startsWith(rootDir) ? file.slice(rootDir.length).replace(/^[/\\]/, "") : file;
    const remedy = "run `hatch3r sync` to regenerate the managed block";

    // Expected marker syntax for this path (the same selector adapters emit
    // through). The OTHER variant is the wrong-syntax signal for this file.
    const expected = getMarkersForPath(file);
    const wrongVariants = MANAGED_BLOCK_VARIANTS.filter(
      (v) => v.start !== expected.start || v.end !== expected.end,
    );

    // Wrong host-comment syntax: a marker from a non-expected variant is
    // present. Detect before the structural walk so the operator gets the
    // root-cause syntax message rather than a downstream orphan report.
    let wrongSyntax = false;
    for (const v of wrongVariants) {
      if (content.includes(v.start) || content.includes(v.end)) {
        wrongSyntax = true;
        const ext = file.toLowerCase().endsWith(".yml") || file.toLowerCase().endsWith(".yaml")
          ? "YAML"
          : "Markdown";
        warnings.push(
          `${rel}: managed block uses the wrong host-comment syntax — found ${v.start.includes("<!--") ? "HTML <!-- -->" : "YAML #"} markers in a ${ext} file (expected ${expected.start.includes("<!--") ? "HTML <!-- -->" : "YAML #"}); ${remedy}`,
        );
        break;
      }
    }
    if (wrongSyntax) continue;

    // Structural walk over the EXPECTED variant only. Count opens/closes in
    // document order to surface orphan and duplicate/nested markers. Using the
    // expected variant keeps this scan from double-reporting a wrong-syntax
    // file (already handled above).
    const lines = content.split("\n");
    let open = false;
    let sawAny = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasStart = line.includes(expected.start);
      const hasEnd = line.includes(expected.end);
      if (hasStart) {
        sawAny = true;
        if (open) {
          warnings.push(
            `${rel}: duplicate/nested managed-block start marker at line ${i + 1} (a second HATCH3R:BEGIN before the open block's HATCH3R:END); ${remedy}`,
          );
        }
        open = true;
      }
      if (hasEnd) {
        sawAny = true;
        if (!open) {
          warnings.push(
            `${rel}: orphan managed-block end marker at line ${i + 1} (HATCH3R:END with no preceding HATCH3R:BEGIN); ${remedy}`,
          );
        }
        open = false;
      }
    }
    // Unterminated open block: a BEGIN with no matching END.
    if (open) {
      warnings.push(
        `${rel}: orphan managed-block start marker (HATCH3R:BEGIN with no matching HATCH3R:END); ${remedy}`,
      );
    }
    void sawAny; // files with zero markers are unmanaged and correctly ignored.
  }

  return warnings;
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

/**
 * F1.4-H2 (Cycle 10 Wave 1E close-out, D1, P1+P5): execute a sub-validator
 * script under `<packageRoot>/scripts/` via `spawnSync("npx", ["tsx", path])`
 * and fold its findings into the shared `ValidationResult`. Sub-validators
 * exit non-zero on error, zero on pass; their stdout/stderr is captured and,
 * on failure, the first non-empty line is surfaced as the error message with
 * the full transcript appended in verbose mode.
 *
 * The wrapper is gated on script presence: published npm bundles ship only
 * `dist/` (per package.json `files`), so `scripts/` is absent in consumer
 * repos. In that case the sub-validator is silently skipped — these checks
 * are framework-dev invariants, not consumer-repo gates. A verbose log line
 * records the skip so the omission is observable.
 *
 * Why spawnSync (not import): the existing sub-validator scripts call
 * `process.exit(1)` directly from their `main()` and `.catch()` paths (see
 * `validate-rule-parity.ts:342`, `validate-efficiency-invariants.ts:581`).
 * An in-process import would terminate the whole `hatch3r validate` process
 * mid-run, losing every subsequent check's findings. Spawning isolates the
 * exit semantics.
 */
function runSubValidator(
  scriptPath: string,
  scriptLabel: string,
  result: ValidationResult,
): void {
  if (!existsSync(scriptPath)) {
    verbose(
      `validate: sub-validator ${scriptLabel} skipped — ${scriptPath} not present (consumer-repo install, expected)`,
    );
    return;
  }

  const child = spawnSync("npx", ["tsx", scriptPath], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: dirname(dirname(scriptPath)),
  });

  if (child.error) {
    result.warnings.push(
      `Sub-validator ${scriptLabel} failed to launch (${child.error.message}) — ` +
        `verify Node.js + tsx are installed and re-run \`npx hatch3r validate\``,
    );
    return;
  }

  const stdout = (child.stdout ?? "").trim();
  const stderr = (child.stderr ?? "").trim();
  const status = child.status ?? 0;

  if (status === 0) {
    // On pass, the script prints a one-line summary to stdout (e.g.
    // "validate:rule-parity: 14 pairs checked, 0 drift"). Surface it in
    // verbose mode so operators see the coverage even on green runs.
    if (stdout) verbose(`${scriptLabel}: ${stdout.split("\n")[0]}`);
    return;
  }

  // Non-zero exit: fold the first non-empty stderr/stdout line into warnings[]
  // (not errors[]) so a single `hatch3r validate` surfaces the failure summary
  // for operator visibility without failing validate-command when the cwd is
  // a user-content sandbox missing the canonical content tree. Append the full
  // transcript as a verbose log line so --verbose preserves detail.
  const firstLine =
    [...stderr.split("\n"), ...stdout.split("\n")]
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? `${scriptLabel} exited with status ${status}`;
  result.warnings.push(`${scriptLabel} reported issues: ${firstLine}`);
  const transcript = [stderr, stdout].filter((s) => s.length > 0).join("\n");
  if (transcript) {
    verbose(`${scriptLabel} transcript:\n${transcript}`);
  }
}

/**
 * F1.4-H2 (Cycle 10 Wave 1E close-out, D1, P5): rule-parity sub-validators.
 * Mirrors `npm run validate:rule-parity` from package.json — runs both
 * `validate-rule-parity.ts` (`.md`/`.mdc` body + frontmatter twin parity) and
 * `validate-rule-pillar-currency.ts` (precedence + pillar-assignment policy).
 * Each script is invoked independently so a failure in one does not mask a
 * failure in the other.
 */
function runRuleParityCheck(packageRoot: string, result: ValidationResult): void {
  runSubValidator(
    join(packageRoot, "scripts", "validate-rule-parity.ts"),
    "validate:rule-parity",
    result,
  );
  runSubValidator(
    join(packageRoot, "scripts", "validate-rule-pillar-currency.ts"),
    "validate:rule-pillar-currency",
    result,
  );
}

/**
 * F1.4-H2 (Cycle 10 Wave 1E close-out, D1, P7+P8): efficiency-invariant
 * sub-validators. Mirrors `npm run validate:efficiency` from package.json —
 * runs `validate-efficiency-invariants.ts` (P7 cache-friendly / parallel-tool /
 * triage-tiers floors), `validate-bridge-budget.ts` (token-budget caps on the
 * AGENTS.md bridge surface), and `validate-fanout-emission.ts` (P8 B2
 * sub-agent count + rationale emission on delegating artifacts). Each script
 * is invoked independently so a failure in one does not mask the others.
 */
function runEfficiencyInvariantCheck(
  packageRoot: string,
  result: ValidationResult,
): void {
  runSubValidator(
    join(packageRoot, "scripts", "validate-efficiency-invariants.ts"),
    "validate:efficiency-invariants",
    result,
  );
  runSubValidator(
    join(packageRoot, "scripts", "validate-bridge-budget.ts"),
    "validate:bridge-budget",
    result,
  );
  runSubValidator(
    join(packageRoot, "scripts", "validate-fanout-emission.ts"),
    "validate:fanout-emission",
    result,
  );
}

export async function validateCommand(opts?: {
  docs?: boolean;
  verbose?: boolean;
  format?: ValidateOutputFormat;
  strictContent?: boolean;
}): Promise<void> {
  const format: ValidateOutputFormat = opts?.format === "json" ? "json" : "human";
  const jsonMode = format === "json";
  // C9-M29: opt-in escalation of the content-body lint (anti-slop + pillar
  // reference) from warnings to errors. Off by default to avoid disturbing
  // the legacy backlog; CI gates and author skills can flip this on.
  const strictContent = !!opts?.strictContent;

  // In JSON mode: suppress verbose logging (sent to stdout via info()) and the
  // banner, which would corrupt the machine-readable output. Errors/warnings
  // still reach the final JSON object via the ValidationResult aggregator.
  setVerbose(jsonMode ? false : !!opts?.verbose);
  setVerboseWarnEnabled(jsonMode ? false : !!opts?.verbose);
  if (!jsonMode) printBanner(true);

  const rootDir = process.cwd();
  const timestamp = new Date().toISOString();
  // D10-SA10.2-F6 (Cycle 10 Wave 4, D10, P1): capture wall-clock at command
  // entry so the human-mode success paths emit a `Completed in Xs` line via
  // `printTimingSummary`. Validating the full bundled canonical corpus +
  // inline sub-validators exceeds the 1s threshold CLI Guidelines
  // (clig.dev#output) cite for showing elapsed time. The helper is a no-op
  // under quiet/json mode, so the single-JSON-document contract is preserved.
  const validateStartMs = Date.now();

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
        // D1-SA1.4-F12 (Cycle 10 Wave 4, P5): in JSON mode the single payload
        // above IS the contract (validate.ts:1467 "Do NOT interleave other
        // stdout writes"). Throwing here would propagate to the top-level CLI
        // handler, which prints a human-readable error to stderr — polluting
        // the stream a CI parser consumes. Exit cleanly with the same sysexits
        // code the HatchError would have carried (VALIDATION_ERROR → 64).
        process.exit(exitCodeForErrorCode("VALIDATION_ERROR"));
      }
      spinner?.fail("Documentation count mismatches found");
      for (const m of mismatches) logError(m);
      throw new HatchError(
        "Documentation counts do not match",
        undefined,
        "VALIDATION_ERROR",
        "Run `npm run inventory` to regenerate the counts, then re-run validation.",
      );
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
  const result: ValidationResult = { errors: [], warnings: [] };

  const spinner = jsonMode ? null : createSpinner("Validating bundled canonical content...");
  spinner?.start();

  // Wave 4: validation now reads from the bundled canonical-content root
  // resolved via `resolveBundledContentRoot()`. The user-repo `.agents/`
  // materialisation no longer exists (W3 dropped it from init/sync/update),
  // so the prior "`.agents/` not found → error" branch is gone. When the
  // cwd is the framework source repo (dev mode), `resolveBundledContentRoot`
  // already returns the repo root, so dev/install/consumer paths converge
  // on the same canonical scan.
  let canonicalRoot: string;
  try {
    canonicalRoot = resolveBundledContentRoot();
  } catch (err) {
    spinner?.fail("Validation failed");
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      emitJson({
        errors: [message],
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
      // D1-SA1.4-F12: exit cleanly after the single JSON payload rather than
      // throwing into the stderr-printing top-level handler (CONFIG_ERROR → 65).
      process.exit(exitCodeForErrorCode("CONFIG_ERROR"));
    }
    logError(message);
    console.log();
    throw new HatchError(
      message,
      undefined,
      "CONFIG_ERROR",
      "Re-run `hatch3r update` to refresh bundled content, or reinstall hatch3r if the package is corrupted.",
    );
  }

  // Manifest is now read from `.hatch3r/hatch.json` (Wave 6 will finalize the
  // move; `readManifest` already accepts the user repo root). A missing
  // manifest is no longer fatal — bundled-canonical validation still runs.
  const manifest = await readManifest(rootDir);

  // Wave 4: track whether the description-quality lint has already run on
  // the canonical index so the legacy canonical-source pass below does not
  // duplicate findings.
  let descriptionLintRan = false;

  verbose("Checking manifest...");
  await validateManifest(rootDir, manifest, result);
  verbose("Checking directory structure...");
  await validateDirectories(canonicalRoot, result);
  verbose("Checking frontmatter...");
  await validateFrontmatter(canonicalRoot, result);

  if (manifest) {
    verbose("Checking file prefixes...");
    await validateManagedFilePrefixes(manifest, result);
    verbose("Checking hooks...");
    await validateHooks(canonicalRoot, manifest, result);
    verbose("Checking MCP configuration...");
    await validateMcp(canonicalRoot, manifest, result);
    verbose("Checking CLI tools...");
    await validateCliTools(manifest, result);
    verbose("Checking model configuration...");
    await validateModels(manifest, result);
    verbose("Checking cost tracking...");
    await validateCostTracking(manifest, result);
    verbose("Checking customizations...");
    await validateCustomizations(rootDir, canonicalRoot, manifest, result);
    await validateCustomizeYaml(rootDir, result);
    verbose("Checking content consistency...");
    await validateContentConsistency(rootDir, canonicalRoot, manifest, result);

    // C9-M29: scan canonical content bodies for anti-slop wordlist hits and
    // missing pillar references. Default emission = warnings; --strict-content
    // escalates to errors so author skills can hard-gate new artifacts.
    verbose("Checking content body (anti-slop + pillar references)...");
    await validateContentBody(canonicalRoot, result, strictContent);

    // Cross-reference validation runs against the bundled canonical index.
    // Wave 5 will reintroduce the `.hatch3r/overrides/` user-tier subtree;
    // until then, the index is canonical-only.
    try {
      const index = await buildContentIndex(canonicalRoot, {
        userRoot: resolveUserContentRoot(rootDir),
      });
      if (index.items.length > 0) {
        const crossRefResult = await validateCrossReferences(canonicalRoot, index);
        for (const w of crossRefResult.warnings) {
          result.warnings.push(w);
        }
        // Description-quality lint on the bundled content — when this runs,
        // we skip the canonical-package pass below to avoid duplicate findings.
        runDescriptionQualityChecks(index, result);
        descriptionLintRan = true;
      }
      // D20: strict + gentle gates for user-authored content under the new
      // `.hatch3r/overrides/` root (Wave 5). The function no-ops when the user
      // root is absent, so projects that never authored overrides incur no
      // findings.
      verbose("Checking user content (D20 gates)...");
      await validateUserContent(rootDir, canonicalRoot, result, index);

      // Content ID collision validation.
      //
      // F16.3-H3 (D16) / D5-H8 / D16-H10 / Decision 13: a command↔skill ID
      // pair is legitimate ONLY when BOTH (1) the command genuinely
      // orchestrates — `orchestrator: true` with a non-empty `agentPipeline`
      // — so the command (delegation) and the skill (inline execution) are
      // distinct artifacts, AND (2) the skill twin carries the Decision-13
      // handoff section documenting the split. Either gap is a finding:
      //   - command does NOT orchestrate -> Decision-13 duplicate (collapse
      //     to one artifact or promote the command to a real orchestrator).
      //   - command orchestrates but the skill twin OMITS the handoff doc ->
      //     the slash-name collision (Claude resolves `/hatch3r-X` to the
      //     skill, shadowing the command) ships undocumented. The fix is the
      //     `## Relationship to ... (Decision 13 handoff)` section, modeled
      //     on `skills/hatch3r-api-spec/SKILL.md`.
      // Previously a qualifying command silently exempted the pair, which let
      // the undocumented twin ship (D5-H8: "no artifact documents it").
      // Same-type duplicates and other cross-type pairs are always warnings.
      for (const collision of index.collisions) {
        if (collision.kind === "cross-type") {
          const types = new Set([collision.existingType, collision.duplicateType]);
          if (types.size === 2 && types.has("command") && types.has("skill")) {
            const commandPath = collision.existingType === "command"
              ? collision.existingPath
              : collision.duplicatePath;
            const skillPath = collision.existingType === "skill"
              ? collision.existingPath
              : collision.duplicatePath;
            const qualifies = await commandOrchestrates(join(canonicalRoot, commandPath), result);
            if (!qualifies) {
              result.warnings.push(
                `Content ID collision: "${collision.id}" exists as both a command (${commandPath}) and a skill (${skillPath}), but the command is not orchestrator:true with a non-empty agentPipeline — per Decision 13 this is a duplicate: collapse to one artifact or promote the command to a real orchestrator (.claude/rules/content-authoring.md item 9)`,
              );
              continue;
            }
            const documented = await skillDocumentsDecision13Split(
              join(canonicalRoot, skillPath),
              result,
            );
            if (!documented) {
              result.warnings.push(
                `Content ID collision: "${collision.id}" — command ${commandPath} orchestrates, but its id-sharing skill ${skillPath} omits the Decision-13 handoff section, so the command↔skill split is undocumented (Claude Code resolves /hatch3r-${collision.id.replace(/^hatch3r-/, "")} to the skill, shadowing the command). Add a "## Relationship to \`${commandPath}\` (Decision 13 handoff)" section to the skill (model: skills/hatch3r-api-spec/SKILL.md), OR collapse the pair to one artifact.`,
              );
              continue;
            }
            // Legitimate, documented Decision-13 command/skill pair — the
            // command delegates via agentPipeline; the skill is its inline
            // sibling and records the split.
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

  // F2.4-F1 (Cycle 10 Wave 1, D2 Critical, ASI02): every agents/*.md with
  // frontmatter `type: agent` must have a registered AGENT_TOOL_POLICIES
  // entry. Without this, NO_POLICY silently denies every tool call by the
  // affected agent under the Claude PreToolUse hook and widens privilege
  // silently under Cursor/Copilot (no readonly frontmatter emitted).
  verbose("Checking AGENT_TOOL_POLICIES coverage...");
  await validateAgentToolPolicyCoverage(canonicalRoot, result, rootDir);

  // D5-2 (Cycle 11 Wave 2, High): the coverage gate above only checks a policy
  // EXISTS; this gate checks each of the five D5-2 agents' policies GRANT the
  // web/mcp/execute capabilities their prompt body instructs, so a future
  // body↔policy drift fails CI instead of denying tool calls silently.
  verbose("Checking agent body⊆policy capability coverage (D5-2)...");
  await validateAgentBodyCapabilityCoverage(canonicalRoot, result);

  // D9-H-6 (D9, P1): execute-capable skills must pre-approve their wrapped
  // shell binary via `allowed_tools` so the Copilot Skills runtime skips the
  // per-invocation confirmation prompt.
  await validateSkillAllowedTools(canonicalRoot, result);

  // Security compliance verification (#86 D15)
  await validateSecurityCompliance(result);

  // F1.4-H2 (Cycle 10 Wave 1E close-out, D1, P1+P5): single-command coverage
  // of framework-dev invariants. The validate CLI used to hint operators at
  // `npm run validate` for rule-parity + efficiency / fan-out / bridge-budget
  // checks; this branch now invokes the sub-validators inline via spawnSync
  // so one `hatch3r validate` aggregates structural + parity + efficiency in
  // one pass. The wrappers gracefully skip when `scripts/` is absent (npm
  // bundle ships only `dist/`), so consumer repos see no regression.
  const __filename_self = fileURLToPath(import.meta.url);
  const packageRoot = findPackageRoot(dirname(__filename_self));
  verbose("Checking rule .md/.mdc parity + pillar-currency...");
  runRuleParityCheck(packageRoot, result);
  verbose("Checking P7 efficiency + P8 fan-out + bridge-budget invariants...");
  runEfficiencyInvariantCheck(packageRoot, result);

  // Description-quality lint on the canonical package content. This runs
  // only when the bundled-content lint above did not run (empty index).
  if (!descriptionLintRan) {
    await validateCanonicalDescriptionQuality(rootDir, result);
  }

  // D11-SA11.2-F13 (Wave 7+8, D11, P5+P6): structural-integrity scan over the
  // managed blocks in on-disk adapter outputs (`.claude/`, `.cursor/`,
  // `.github/`). Complements `hatch3r status` / `hatch3r verify` (full content
  // drift) by surfacing hand-broken marker structure as advisory warnings.
  // Cheap and read-only, so it always runs.
  verbose("Scanning adapter-output managed blocks for structural tampering...");
  const tamperWarnings = await scanManagedBlockTampering(rootDir);
  for (const w of tamperWarnings) {
    result.warnings.push(w);
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
      // D1-SA1.4-F12: the JSON `errors` array is the machine-readable contract;
      // exit with the sysexits code instead of throwing into the top-level
      // handler, which would write a duplicate human-readable error to stderr
      // and break CI parsers that read the combined stream (VALIDATION_ERROR → 64).
      process.exit(exitCodeForErrorCode("VALIDATION_ERROR"));
    }
    return;
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    printBox("Validation", [chalk.green("All checks passed")], "success");
    if (hasCustomizations) {
      printCustomizationHint();
    }
    // F1.4-H2 (Cycle 10 Wave 1E close-out): framework-dev surface coverage
    // hint. The `hatch3r validate` CLI now invokes rule-parity, P7 efficiency,
    // P8 fan-out, bridge-budget, and pillar-currency sub-validators inline via
    // spawnSync (see runRuleParityCheck + runEfficiencyInvariantCheck above).
    // The remaining `scripts/validate-*.ts` invariants (CLI-skill parity,
    // wiring, anti-slop, specialist-roster) still live under separate
    // `npm run validate:*` scripts. Emit in verbose mode only to avoid
    // distracting end users who do not author canonical content.
    if (opts?.verbose) {
      console.log();
      verbose(
        "Sub-validators (rule-parity, rule-pillar-currency, efficiency-invariants, bridge-budget, fanout-emission) ran inline. Remaining framework-dev gates (validate:cli-skills, validate:wiring, validate:anti-slop, validate:specialist-roster) run under `npm run validate`.",
      );
    }
    // D10-SA10.2-F6: elapsed-time read-out on the clean-pass path.
    printTimingSummary(validateStartMs);
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
    throw new HatchError(
      "Validation failed",
      undefined,
      "VALIDATION_ERROR",
      "Fix the errors listed above, then re-run `hatch3r validate`.",
    );
  } else {
    const summaryLines = [
      `${chalk.green("✔")} 0 errors`,
      `${chalk.yellow("⚠")} ${result.warnings.length} warning(s)`,
    ];
    printBox("Validation passed", summaryLines, "success");
    // D10-SA10.2-F6: elapsed-time read-out on the warnings-only pass path.
    // Omitted on the error path above (the throw exits before any tail).
    printTimingSummary(validateStartMs);
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
