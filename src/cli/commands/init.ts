import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import {
  applyPreservedManifestFields,
  createManifest,
  extractPreservedManifestFields,
  readManifest,
  writeManifest,
  addManagedFile,
  isValidGitBranchName,
  type PreservedManifestFields,
} from "../../manifest/hatchJson.js";
import { filterMcpJsonOnDisk } from "../../manifest/mcpFilter.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import {
  AGENTS_DIR,
  DEFAULT_FEATURES,
  HatchError,
  VALID_TOOLS,
  WORKTREE_CAPABLE_TOOLS,
  WORKTREE_INCLUDE_FILE,
  type CliToolId,
  type CliToolsConfig,
  type ContentSelection,
  type CustomizationManifest,
  type Features,
  type Platform,
  type RepoInfo,
  type Tool,
} from "../../types.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../shared/agentsContent.js";
import {
  printBanner,
  createSpinner,
  printBox,
  info,
  error as logError,
  step,
  label,
  warn,
} from "../shared/ui.js";
import { findPackageRoot } from "../shared/paths.js";
import { buildTagGroupedCustomContentChoices } from "../shared/customContentChoices.js";
import { TOOL_DISPLAY_NAMES, TOOL_PROMPT_CHOICES, FEATURE_CHOICES, MCP_CHOICES, PLATFORM_DISPLAY_NAMES, PLATFORM_MCP_SERVER, sanitizeInput, isWSL, formatCommandHint, TOOL_SECRET_NOTES } from "../shared/constants.js";
import { pickCliTools, pickMcpServers, confirmMcpGate } from "../shared/pickers.js";
import {
  AVAILABLE_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  DEFAULT_CLI_TOOLS,
  TIER1_CLI_TOOLS,
} from "../../cliTools/registry.js";
import { findMissingCliTools } from "../../cliTools/detect.js";
import { offerInstaller } from "../../cliTools/install.js";
import { applyPlatformTriggers, evaluateTier2Triggers } from "../../cliTools/triggers.js";
import { generateIntegrityManifest, writeIntegrityManifest } from "../../integrity/index.js";
import { HATCH3R_VERSION } from "../../version.js";
import { buildContentIndex, resolveSelection, copySelectedContent, countSelectionItems, selectionSummary, getAllContentIds, removeContentItem, validateOrchestrationDependencies, countPresetExclusions, countProjectTypeExclusions, countTeamSizeExclusions, estimatePresetItemCount } from "../../content/index.js";
import { PRESETS, getPreset, type PresetId } from "../../content/presets.js";
import { detectSubRepos, shouldSuggestWorkspace } from "../../workspace/detect.js";
import { createWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import type { WorkspaceRepoEntry } from "../../workspace/types.js";
import { parseGitRemote, parseGitDefaultBranch, getGitRemoteUrl, detectPlatformFromRemote, detectRepoGitIdentity } from "../../workspace/git.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);

const DEFAULT_TOOLS: Tool[] = ["claude"];
const DEFAULT_FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof Features)[];
const DEFAULT_MCP: string[] = ["playwright", "github", "context7"];

// D5-SA5.3-H1: Seed content for `.agents/learnings/README.md`. Explains the
// directory's purpose so `hatch3r-learnings-loader` surfaces an actionable
// starting point on first session instead of silently skipping when empty.
const LEARNINGS_README_SEED = `# Project Learnings

This directory holds project-specific learnings surfaced by the
\`hatch3r-learnings-loader\` agent at session start.

## What to capture

| Category | Examples |
| --- | --- |
| Decisions | Architecture choices, library selections, trade-off rationale |
| Patterns | Established code patterns, naming conventions, data flow norms |
| Pitfalls | Known gotchas, edge cases, things that look wrong but are intentional |
| Context | Domain knowledge, business rules, regulatory constraints |

## Format

Add one markdown file per learning with YAML frontmatter:

\`\`\`yaml
---
id: <kebab-case-slug>
category: decision | pattern | pitfall | context
area: <subsystem or feature area>
recorded: <ISO-8601 date>
source: session | <agent-name> | manual
confidence: high | medium | low
author: agent | human
tags: [<tag>, ...]
---

## Learning

<What was learned, in 1-3 sentences.>

## Evidence

<Files, commits, or commands that support the learning.>
\`\`\`

The loader agent applies content-security and integrity checks to every
entry; see \`hatch3r-learnings-loader\` for the full protocol.

## Recommended First Learning — Pipeline Drift

Copy the markdown block below into \`.agents/learnings/pipeline-drift-rule-73.md\`
to prime your AI tool against the bypass pattern reported in hatch3r
issue #73 (GitHub Copilot Chat skipping the four-phase sub-agent
pipeline on Tier-3 epics). The \`hatch3r-learnings-loader\` agent will
surface it on session start.

\`\`\`markdown
---
id: pipeline-drift-rule-73
category: pitfall
area: orchestration
recorded: 2026-05-12
source: manual
confidence: high
author: human
tags: [orchestration, copilot, drift]
---

## Learning

The hatch3r four-phase sub-agent pipeline (Research -> Implement ->
Review -> Quality) is trust-based on Copilot Chat — Copilot has
\`hooks: false\` in \`src/adapters/index.ts\`, exposes no PreToolUse /
pre-edit hook, and does not surface its chat transcript to external
processes. Drift is invisible by default: Copilot can call
\`multi_replace_string_in_file\` / \`create_file\` inline on a Tier-3
task and the build can still pass.

Self-detectable signals:

- The orchestrator's reply does NOT start with the
  \`[hatch3r-pipeline: phase N | last: ... | next: ...]\` header on
  a tracked Tier 2+ task -> halt and re-ground.
- A code-writing tool was called before the user confirmed the
  Pre-Implementation Summary on a Tier 3 task -> bypass mode.
- An \`Edit\` / \`Write\` / equivalent fired from the orchestrator
  turn rather than from inside a \`hatch3r-implementer\` Task
  sub-agent -> bypass mode.

## Evidence

- Issue: https://github.com/hatch3r-dev/hatch3r/issues/73
- Rules: \`rules/hatch3r-agent-orchestration.md\` (Per-Turn
  Pipeline-State Header, Mandatory Delegation Directive);
  \`rules/hatch3r-deep-context.md\` (Tier 3 — Deep hard gate).
- Adapter capability: \`src/adapters/index.ts\` — \`copilot\` is the
  only adapter with \`hooks: false\`.
\`\`\`

Customize the \`recorded\` date and \`tags\` to match your setup.
Adapters other than Copilot also benefit from this learning when
the bypass pattern is plausible on their host (e.g., long-context
sessions on any adapter).

Delete this README once you have authored real learnings.
`;

/**
 * Check if a content selection includes any board-related content.
 * Board content IDs follow the pattern "cmd-hatch3r-board-*" (prefixed during indexing).
 */
function selectionHasBoardContent(selection: ContentSelection): boolean {
  return selection.items.commands.some((id) => id.startsWith("cmd-hatch3r-board"));
}

/**
 * Surface board command prerequisites when board content is included in the selection.
 * Board commands require GitHub Projects V2 and a PAT with the `project` scope.
 */
function warnBoardPrerequisites(selection: ContentSelection): void {
  if (!selectionHasBoardContent(selection)) return;
  info(
    `Board commands selected. Prerequisites: ${chalk.bold("GitHub Projects V2")} must be enabled ` +
    `and your PAT needs the ${chalk.bold("project")} scope. ` +
    `See ${chalk.dim("https://docs.github.com/en/issues/planning-and-tracking-with-projects")}`,
  );
}

// Git detection functions imported from ../../workspace/git.js

/**
 * Derive the projectLanguages array passed to resolveSelection from a RepoInfo.
 * Filters out the synthetic "unknown" sentinel so language filtering becomes
 * a no-op when detection fails, rather than excluding all language-tagged items.
 */
function languagesForSelection(repoInfo: RepoInfo): string[] {
  return repoInfo.languages.filter((l) => l !== "unknown");
}

function deriveWorkspacePlatform(identities: Array<{ platform: Platform }>): Platform {
  const counts = new Map<Platform, number>();
  for (const id of identities) {
    counts.set(id.platform, (counts.get(id.platform) ?? 0) + 1);
  }
  let best: Platform = "github";
  let max = 0;
  for (const [p, c] of counts) { if (c > max) { best = p; max = c; } }
  return best;
}

export interface RunInitOptions {
  rootDir: string;
  platform: Platform;
  owner: string;
  repo: string;
  namespace: string;
  project: string;
  defaultBranch: string;
  tools: Tool[];
  features: Features;
  mcpServers: string[];
  repoInfo: RepoInfo;
  contentSelection: ContentSelection;
  worktreeEnabled: boolean;
  /**
   * CLI-tooling pivot (1.7.2 / plan §4.3). When omitted, runInit treats
   * the project as having no CLI-tools opt-in (`{enabled: false,
   * selected: []}`) — matching the manifest default for pre-1.7.2 repos.
   * Threaded through to `createManifest` so the manifest carries the
   * selection across `clean` -> reinit cycles.
   */
  cliTools?: CliToolsConfig;
  /**
   * 1.7.0 (Phase D): optional customization payload forwarded to
   * `createManifest`. Set by `clean` -> reinit so integration config and
   * per-artifact overrides survive when `.hatch3r/*.customize.yaml` files
   * are absent. Omitted on first init.
   */
  customization?: CustomizationManifest;
  /**
   * 1.7.1: platform/user-specific manifest fields (GitHub Projects v2 IDs,
   * costTracking, specs, extension config, worktree extras, workspace state)
   * forwarded from `clean` -> reinit. When omitted, `runInit` falls back to
   * extracting the same fields from an existing `.agents/hatch.json` if
   * present, so a plain `hatch3r init` over an existing repo also preserves
   * them. Init-supplied owner/repo/defaultBranch always win over the
   * preserved board's identity fields (matches `hatch3r config` semantics).
   */
  preservedManifestFields?: PreservedManifestFields;
  /**
   * Suppress all interactive prompts emitted by `runInit` itself (e.g. the
   * post-init "create your first user artifact?" prompt). When true, runInit
   * never reads stdin. Defaults to false. Set by callers that already
   * exhausted stdin (e.g. `--yes`, CI workflows, tests).
   */
  yes?: boolean;
}

// C8-D1-M3: Guard against a double `runInit` on the same target directory.
// Workspace init constructs a canonical `.agents/` at the workspace root and
// also syncs selected sub-repos. A bug or re-entry path that called runInit
// twice for the same rootDir in one process would race on manifest reads,
// content copies, and managed-file writes. The guard holds for the lifetime
// of a single CLI invocation.
const RUNNING_INITS = new Set<string>();

export async function runInit(options: RunInitOptions): Promise<void> {
  const { rootDir } = options;

  // C8-D1-M3: idempotency guard — fail fast on reentrant calls rather than
  // producing a half-written `.agents/`.
  if (RUNNING_INITS.has(rootDir)) {
    throw new HatchError(
      `runInit already in progress for ${rootDir}`,
      1,
      "CONFIG_ERROR",
    );
  }
  RUNNING_INITS.add(rootDir);

  try {
    await runInitInner(options);
  } finally {
    RUNNING_INITS.delete(rootDir);
  }
}

async function runInitInner(options: RunInitOptions): Promise<void> {
  const { rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, customization, cliTools } = options;
  const skipInitPrompts = options.yes === true;
  const agentsDir = join(rootDir, AGENTS_DIR);
  const totalSteps = 4;

  const s1 = createSpinner(step(1, totalSteps, "Creating canonical files..."));
  s1.start();
  await mkdir(agentsDir, { recursive: true });

  // Detect re-init: check if manifest exists and compute content delta
  const existingManifest = await readManifest(rootDir);

  // Build content index from package and copy only selected items
  const index = await buildContentIndex(CONTENT_ROOT);
  await copySelectedContent(CONTENT_ROOT, agentsDir, contentSelection, index);

  // Clean up stale content from previous init
  if (existingManifest?.content) {
    const oldIds = getAllContentIds(existingManifest.content);
    const newIds = getAllContentIds(contentSelection);
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const item = index.byId.get(id);
        if (item) await removeContentItem(agentsDir, item, { rootDir });
      }
    }
  }

  await mkdir(join(agentsDir, "learnings"), { recursive: true });
  // D5-SA5.3-H1: Seed learnings/ with a README so `hatch3r-learnings-loader`
  // has something to surface instead of silently skipping. Only created when
  // absent (fresh init) — never overwrites user-authored content on re-init.
  const learningsReadmePath = join(agentsDir, "learnings", "README.md");
  try {
    await access(learningsReadmePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await safeWriteFile(learningsReadmePath, LEARNINGS_README_SEED);
    } else {
      throw err;
    }
  }

  const mcpPath = join(agentsDir, "mcp", "mcp.json");
  await filterMcpJsonOnDisk(mcpPath, new Set(mcpServers));

  // Generate dynamic AGENTS.md based on what's actually installed
  const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
  await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd, { force: true });

  s1.succeed(step(1, totalSteps, `Canonical files created (${countSelectionItems(contentSelection)} items)`));

  // C7-H8 (D1): Build the manifest in memory but defer the disk write until
  // after adapter generation succeeds. Writing the manifest before adapters
  // run would leave a `.agents/hatch.json` referencing tools whose output
  // never reached disk if all adapters fail (line 215 throw below).
  const s2 = createSpinner(step(2, totalSteps, "Preparing manifest..."));
  s2.start();
  // 1.7.1: when re-initing over an existing manifest without an explicit
  // `options.customization` (e.g. plain `hatch3r init`), fall back to the
  // existing manifest's customization so it survives. Clean -> reinit
  // already supplies `options.customization` directly via captureConfig.
  const effectiveCustomization = customization ?? existingManifest?.customization;
  const manifest = createManifest({ platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, content: contentSelection, languages: repoInfo.languages, worktreeEnabled, customization: effectiveCustomization, cliTools });
  // 1.7.1: reapply platform/user state so a `clean` -> reinit (explicit
  // `preservedManifestFields`) and a plain `hatch3r init` over an existing
  // `.agents/hatch.json` (fallback to existingManifest extraction) both
  // preserve fields like board.projectNumber, costTracking, specs, hooks,
  // models, claude, repos, packages, workspace, and worktree extras —
  // instead of resetting them to defaults from `createManifest`.
  const preservedFields =
    options.preservedManifestFields
    ?? (existingManifest ? extractPreservedManifestFields(existingManifest) : undefined);
  if (preservedFields) {
    applyPreservedManifestFields(manifest, preservedFields);
  }
  s2.succeed(step(2, totalSteps, "Manifest prepared"));

  const s3 = createSpinner(
    step(3, totalSteps, `Generating ${tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")} output...`),
  );
  s3.start();
  // On init, preserve existing user content: prepend managed block if file has no markers.
  // Generate rich root AGENTS.md with agent/skill/command rosters for platform discovery.
  const rootAgentsMd = await generateRootAgentsMd(agentsDir);
  await safeWriteFile(join(rootDir, "AGENTS.md"), rootAgentsMd.full, {
    managedContent: rootAgentsMd.inner,
    appendIfNoBlock: true,
  });
  addManagedFile(manifest, "AGENTS.md");

  const adapterFailures: { tool: string; error: string }[] = [];
  // Task #11 orphan-cleanup: populate managedFilesByAdapter on init so the
  // first sync has a history to diff against (otherwise first-run behaviour
  // would silently skip cleanup, and an upgrade-over-existing-init would
  // miss the first opportunity to drop pre-B3 rule files).
  manifest.managedFilesByAdapter = manifest.managedFilesByAdapter ?? {};
  for (const tool of tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, manifest);
      for (const w of adapter.warnings) { warn(w); }
      const toolPaths: string[] = [];
      for (const out of outputs) {
        await safeWriteFile(join(rootDir, out.path), out.content, {
          managedContent: out.managedContent,
          appendIfNoBlock: true,
        });
        addManagedFile(manifest, out.path);
        toolPaths.push(out.path);
      }
      manifest.managedFilesByAdapter[tool] = toolPaths;
    } catch (err) {
      adapterFailures.push({
        tool: TOOL_DISPLAY_NAMES[tool] ?? tool,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === tools.length) {
      s3.fail(step(3, totalSteps, "All adapters failed"));
      throw new HatchError("All adapters failed", 1, "ADAPTER_ERROR");
    }
  }
  s3.succeed(step(3, totalSteps, adapterFailures.length > 0
    ? `Adapter output generated (${adapterFailures.length} failed)`
    : "Adapter output generated"));

  for (const tool of tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, manifest);
    for (const w of warnings) {
      warn(w);
    }
  }

  // Generate .worktreeinclude when manifest.worktree.enabled is true.
  // createManifest sets this based on the worktreeEnabled option (honored when
  // defined) or auto-detection of worktree-capable tools (back-compat fallback).
  if (manifest.worktree?.enabled) {
    const wtContent = await generateWorktreeInclude(manifest, rootDir);
    const wtManaged = extractManagedContent(wtContent);
    await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
      managedContent: wtManaged,
      appendIfNoBlock: true,
    });
    addManagedFile(manifest, WORKTREE_INCLUDE_FILE);
  }

  const s4 = createSpinner(step(4, totalSteps, "Finalizing..."));
  s4.start();
  await writeManifest(rootDir, manifest);

  const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
  await writeIntegrityManifest(agentsDir, integrityManifest);

  let envResult: { action: string; path: string; newVars: string[] } | undefined;
  if (features.mcp && mcpServers.length > 0) {
    envResult = await ensureEnvMcp(rootDir, mcpServers);
    await ensureGitignoreEntry(rootDir);
  }

  s4.succeed(step(4, totalSteps, "Done"));

  console.log();
  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const presetLabel = contentSelection.preset.charAt(0).toUpperCase() + contentSelection.preset.slice(1);
  const summaryLines = [
    label("Profile", `${presetLabel} (${contentSelection.projectType}, ${contentSelection.teamSize})`),
    label("Content", `${countSelectionItems(contentSelection)} items (${selectionSummary(contentSelection)})`),
    label("Tools", tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")),
    label("Features", enabledFeatures.join(", ")),
  ];
  if (owner || repo) {
    const platformLabel = PLATFORM_DISPLAY_NAMES[platform];
    summaryLines.push(label(platformLabel, `${namespace || owner}/${project || repo}`));
  }
  if (defaultBranch) {
    summaryLines.push(label("Default branch", defaultBranch));
  }
  if (mcpServers.length > 0) {
    summaryLines.push(label("MCP", mcpServers.join(", ")));
  }
  if (manifest.worktree?.enabled) {
    summaryLines.push(label("Worktree", "isolation enabled"));
  }
  if (envResult && envResult.action !== "skipped") {
    summaryLines.push(label("Secrets", `.env.mcp (fill in your API keys)`));
  }
  summaryLines.push("");
  summaryLines.push(label("Canonical", `${AGENTS_DIR}/`));
  summaryLines.push(label("Manifest", `${AGENTS_DIR}/hatch.json`));

  const isGreenfield =
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents;
  summaryLines.push("");
  if (isGreenfield) {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "project-spec"))} to define your new project`);
  } else {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "codebase-map"))} to map your existing codebase`);
  }

  if (envResult && envResult.newVars.length > 0) {
    summaryLines.push("");
    summaryLines.push(`${chalk.yellow("!")} Add your secrets to ${chalk.bold(".env.mcp")}: ${envResult.newVars.join(", ")}`);
    summaryLines.push(`  Then run: ${chalk.dim(getSourceEnvMcpCommand())}`);
  }

  printBox("Hatch complete", summaryLines, "success");

  // D20: post-init "create your first user artifact?" prompt. Skipped when
  // the caller passed `yes: true` (CI / `--yes` flow / tests) so the
  // non-interactive contract is preserved. Interactive callers see one of
  // two short hints depending on whether they accept or decline.
  if (!skipInitPrompts) {
    const { create } = await inquirer.prompt<{ create: boolean }>([{
      type: "confirm",
      name: "create",
      message: "Would you like to create your first custom artifact now?",
      default: false,
    }]);
    if (create) {
      info(`Run /hatch3r-create in your AI tool to start authoring. The slash command is now installed under your tool's commands directory.`);
    } else {
      info(`Tip: Run /hatch3r-create anytime to author your own agents, skills, rules, commands, or hooks.`);
    }
  }
}

async function checkExisting(rootDir: string, skipPrompt: boolean, newSelection?: ContentSelection): Promise<void> {
  const hatchJsonPath = join(rootDir, AGENTS_DIR, "hatch.json");
  try {
    await access(hatchJsonPath);
    if (!skipPrompt) {
      let message = "Existing .agents/ found. This will overwrite managed files. Continue?";

      // Compute removal count if we have both old and new selections
      if (newSelection) {
        const existingManifest = await readManifest(rootDir);
        if (existingManifest?.content) {
          const oldIds = getAllContentIds(existingManifest.content);
          const newIds = getAllContentIds(newSelection);
          let removeCount = 0;
          for (const id of oldIds) {
            if (!newIds.has(id)) removeCount++;
          }
          if (removeCount > 0) {
            const oldPreset = existingManifest.content.preset.charAt(0).toUpperCase() + existingManifest.content.preset.slice(1);
            const newPreset = newSelection.preset.charAt(0).toUpperCase() + newSelection.preset.slice(1);
            message = `Existing .agents/ found. ${removeCount} content item(s) will be removed (switching from ${oldPreset} to ${newPreset}). Continue?`;
          }
        }
      }

      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: "confirm",
          name: "proceed",
          message,
          default: false,
        },
      ]);
      if (!proceed) {
        console.log(chalk.dim("\n  Init cancelled.\n"));
        throw new HatchError("Init cancelled.", 0);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function validateFlag<T extends string>(value: string | undefined, valid: T[], fallback: T, name: string): T {
  if (!value) return fallback;
  if (!(valid as string[]).includes(value)) {
    logError(`Invalid --${name}: "${value}". Valid: ${valid.join(", ")}`);
    throw new HatchError(`Invalid --${name}: "${value}"`, 1, "VALIDATION_ERROR");
  }
  return value as T;
}

export async function initCommand(
  opts: {
    tools?: string;
    yes?: boolean;
    preset?: string;
    projectType?: string;
    teamSize?: string;
    workspace?: boolean;
    worktree?: boolean;
    quick?: boolean;
    default?: boolean;
    /**
     * CLI-tools selection for `--yes` non-interactive init (plan §4.3).
     * Accepts `"tier1"`, `"all"`, or a comma-separated list of registry
     * ids (e.g. `"ripgrep,jq,gh"`). When omitted on a `--yes` run, the
     * default tier-1 + triggered-tier-2 selection is applied.
     */
    cliTools?: string;
    /** Disable CLI tools entirely on `--yes` (plan §4.3). */
    noCliTools?: boolean;
    /**
     * Re-opt-in to MCP on `--yes`. Default is now off — the pivot moved
     * MCP behind a Yes/No gate (plan §4.3 step 8 / §2 decision row).
     */
    mcp?: boolean;
  } = {},
): Promise<void> {
  printBanner();

  // C8-D1-M4: Validate `--preset`, `--project-type`, and `--team-size` flag
  // values eagerly, before any prompt or detection work runs. Previously
  // these flags were only validated on the `--yes` branch, so an interactive
  // invocation with `--preset kitchen-sink` silently discarded the bad flag
  // and still prompted the user. Per CLI Guidelines fail-fast validation,
  // invalid values abort with exit 1 before any side-effect.
  if (opts.preset !== undefined) {
    validateFlag(opts.preset, ["minimal", "standard", "full", "custom"], "full", "preset");
  }
  if (opts.projectType !== undefined) {
    validateFlag(opts.projectType, ["greenfield", "brownfield"], "brownfield", "project-type");
  }
  if (opts.teamSize !== undefined) {
    validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
  }

  // C8-D10-M2: `--quick` / `--default` collapses the 9-prompt interactive
  // flow to smart defaults by routing to the existing `--yes` path. This
  // reconciles the README "One command gives you..." claim with the
  // interactive first-run experience.
  if (opts.quick || opts.default) {
    opts.yes = true;
  }

  const rootDir = process.cwd();

  // Workspace auto-detection: if no .git but has git subdirectories, suggest workspace mode
  if (!opts.workspace) {
    const suggestWs = await shouldSuggestWorkspace(rootDir);
    if (suggestWs) {
      const detectedRepos = await detectSubRepos(rootDir);
      if (opts.yes) {
        opts.workspace = true;
        info(chalk.dim(`No git repo found. ${detectedRepos.length} git repo(s) detected in subdirectories — initializing as workspace.`));
      } else {
        info(`No git repo found, but ${detectedRepos.length} git repo(s) detected in subdirectories.`);
        const { useWorkspace } = await inquirer.prompt<{ useWorkspace: boolean }>([
          {
            type: "confirm",
            name: "useWorkspace",
            message: "Initialize as a multi-repo workspace?",
            default: true,
          },
        ]);
        opts.workspace = useWorkspace;
      }
    }
  }

  // Workspace: branch into dedicated flow that skips single-repo identity prompts
  if (opts.workspace) {
    const detectedRepos = await detectSubRepos(rootDir);
    const repoInfo = await analyzeRepo(rootDir);
    await runWorkspaceInit(rootDir, detectedRepos, repoInfo, opts);
    return;
  }

  const detectSpinner = createSpinner("Detecting repository...");
  detectSpinner.start();
  const repoInfo = await analyzeRepo(rootDir);
  const remote = parseGitRemote();
  detectSpinner.succeed("Repository detected");

  const detected: string[] = [];
  if (repoInfo.languages.length > 0 && repoInfo.languages[0] !== "unknown") {
    detected.push(...repoInfo.languages);
  }
  if (repoInfo.packageManager !== "unknown") {
    detected.push(repoInfo.packageManager);
  }
  if (repoInfo.isMonorepo) detected.push("monorepo");
  if (detected.length > 0) {
    info(chalk.dim(`Detected: ${detected.join(", ")}`));
  }

  if (opts.yes) {
    const remoteUrl = getGitRemoteUrl();
    const platform = detectPlatformFromRemote(remoteUrl);
    const owner = sanitizeInput(remote.owner);
    const repo = sanitizeInput(remote.repo);
    const namespace = owner;
    const project = repo;

    let tools: Tool[];
    if (opts.tools) {
      const rawTools = opts.tools.split(",").map((t) => t.trim());
      const invalid = rawTools.filter((t) => !VALID_TOOLS.has(t));
      if (invalid.length > 0) {
        logError(`Invalid tool(s): ${invalid.join(", ")}`);
        console.log(chalk.dim(`  Valid tools: ${[...VALID_TOOLS].join(", ")}`));
        throw new HatchError(`Invalid tool(s): ${invalid.join(", ")}`, 1, "VALIDATION_ERROR");
      }
      tools = rawTools as Tool[];
    } else if (repoInfo.existingTools.length > 0) {
      tools = repoInfo.existingTools;
    } else {
      tools = DEFAULT_TOOLS;
    }

    // Worktree: honor explicit --worktree/--no-worktree, else auto-enable for
    // worktree-capable tools (preserves pre-1.6.1 --yes behavior for CI callers).
    const worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));

    const features = { ...DEFAULT_FEATURES };
    // CLI-tooling pivot (plan §4.3): MCP is now opt-in on `--yes`. Users
    // who still want MCP defaults pass `--mcp` explicitly. Without that
    // flag, MCP server list stays empty and no .env.mcp is generated.
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    const mcpServers = features.mcp && opts.mcp
      ? Array.from(new Set([platformMcp, ...DEFAULT_MCP.filter((s) => s !== "github")]))
      : [];

    // CLI-tooling pivot (plan §4.3 `--yes` path): default to tier-1 +
    // triggered-tier-2 unless the user passed `--no-cli-tools`. Explicit
    // `--cli-tools` selections always override the default.
    let cliToolsConfig: CliToolsConfig;
    if (opts.noCliTools) {
      cliToolsConfig = { enabled: false, selected: [] };
    } else {
      const explicit = resolveCliToolsFlag(opts.cliTools, repoInfo, platform);
      const selected = explicit ?? Array.from(new Set([
        ...DEFAULT_CLI_TOOLS,
        ...applyPlatformTriggers(platform, evaluateTier2Triggers(repoInfo)),
      ]));
      cliToolsConfig = { enabled: selected.length > 0, selected };
    }

    const defaultBranch = parseGitDefaultBranch();

    // Use CLI flags with validation, falling back to auto-detect / defaults
    const isGreenfield =
      repoInfo.languages.length === 1 &&
      repoInfo.languages[0] === "unknown" &&
      repoInfo.existingTools.length === 0 &&
      !repoInfo.hasExistingAgents;
    const presetId = validateFlag(opts.preset, ["minimal", "standard", "full"], "full", "preset");
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], isGreenfield ? "greenfield" : "brownfield", "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    const preset = getPreset(presetId);
    const index = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    const contentSelection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages);

    // Warn if orchestration-critical agents are missing from selection
    const orchWarnings = validateOrchestrationDependencies(contentSelection);
    for (const w of orchWarnings) { warn(w); }

    warnBoardPrerequisites(contentSelection);

    await checkExisting(rootDir, true, contentSelection);
    await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, cliTools: cliToolsConfig, yes: true });
    return;
  }

  console.log();

  const remoteUrl = getGitRemoteUrl();
  const detectedPlatform = detectPlatformFromRemote(remoteUrl);

  const platformAnswer = await inquirer.prompt<{ platform: Platform }>([
    {
      type: "select",
      name: "platform",
      message: "Select your platform:",
      choices: [
        { name: "GitHub", value: "github" as Platform },
        { name: "Azure DevOps", value: "azure-devops" as Platform },
        { name: "GitLab", value: "gitlab" as Platform },
      ],
      default: detectedPlatform,
    },
  ]);
  const platform = platformAnswer.platform;

  let owner: string;
  let repo: string;
  let namespace: string;
  let project: string;

  if (platform === "azure-devops") {
    const adoAnswers = await inquirer.prompt<{ org: string; project: string; repo: string }>([
      { type: "input", name: "org", message: "Azure DevOps organization:", default: remote.owner || undefined },
      { type: "input", name: "project", message: "Azure DevOps project:" },
      { type: "input", name: "repo", message: "Repository name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(adoAnswers.org);
    repo = sanitizeInput(adoAnswers.repo);
    namespace = owner;
    project = sanitizeInput(adoAnswers.project);
  } else if (platform === "gitlab") {
    const glAnswers = await inquirer.prompt<{ namespace: string; project: string }>([
      { type: "input", name: "namespace", message: "GitLab namespace (group or username):", default: remote.owner || undefined },
      { type: "input", name: "project", message: "Project name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(glAnswers.namespace);
    repo = sanitizeInput(glAnswers.project);
    namespace = owner;
    project = repo;
  } else {
    const repoAnswers = await inquirer.prompt<{ owner: string; repo: string }>([
      { type: "input", name: "owner", message: "GitHub owner (org or username):", default: remote.owner || undefined },
      { type: "input", name: "repo", message: "Repository name:", default: remote.repo || undefined },
    ]);
    owner = sanitizeInput(repoAnswers.owner);
    repo = sanitizeInput(repoAnswers.repo);
    namespace = owner;
    project = repo;
  }

  const defaultBranchDefault = parseGitDefaultBranch();
  const defaultBranchAnswers = await inquirer.prompt<{ defaultBranch: string }>([
    {
      type: "input",
      name: "defaultBranch",
      message: "Default branch (for checkout, PR base, release):",
      default: defaultBranchDefault,
      // C8-D1-M9: reject values that fail `git check-ref-format`. Empty
      // input is allowed through (falls back to detected default below).
      validate: (v: string) => {
        const trimmed = v.trim();
        if (trimmed === "") return true;
        return (
          isValidGitBranchName(trimmed) ||
          `Invalid git branch name: "${trimmed}". See git-check-ref-format(1).`
        );
      },
    },
  ]);
  const defaultBranch = defaultBranchAnswers.defaultBranch.trim() || defaultBranchDefault;

  // --- Project type (with filter exclusion counts) ---
  const filterIndex = await buildContentIndex(CONTENT_ROOT);
  const projectLanguages = languagesForSelection(repoInfo);
  const isAutoGreenfield =
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents;
  const greenfieldExcl = countProjectTypeExclusions("greenfield", filterIndex.items);
  const brownfieldExcl = countProjectTypeExclusions("brownfield", filterIndex.items);
  const projectTypeAnswer = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" }>([
    {
      type: "select",
      name: "projectType",
      message: "Is this a new (greenfield) or existing (brownfield) project?",
      choices: [
        { name: `Greenfield — new project from scratch${greenfieldExcl > 0 ? ` (filters out ${greenfieldExcl} brownfield-only item${greenfieldExcl === 1 ? "" : "s"})` : ""}`, value: "greenfield" as const },
        { name: `Brownfield — existing codebase${brownfieldExcl > 0 ? ` (filters out ${brownfieldExcl} greenfield-only item${brownfieldExcl === 1 ? "" : "s"})` : ""}`, value: "brownfield" as const },
      ],
      default: isAutoGreenfield ? "greenfield" : "brownfield",
    },
  ]);
  const projectType = projectTypeAnswer.projectType;

  // --- Team size (with filter exclusion counts) ---
  const soloExcl = countTeamSizeExclusions("solo", filterIndex.items);
  const teamSizeAnswer = await inquirer.prompt<{ teamSize: "solo" | "team" }>([
    {
      type: "select",
      name: "teamSize",
      message: "Solo developer or team collaboration?",
      choices: [
        { name: `Solo — just me${soloExcl > 0 ? ` (filters out ${soloExcl} team-only item${soloExcl === 1 ? "" : "s"})` : ""}`, value: "solo" as const },
        { name: "Team — multiple contributors", value: "team" as const },
      ],
      default: "solo",
    },
  ]);
  const teamSize = teamSizeAnswer.teamSize;

  // --- Content preset (with exclusion counts) ---
  const totalItems = filterIndex.items.length;
  const presetAnswer = await inquirer.prompt<{ preset: PresetId }>([
    {
      type: "select",
      name: "preset",
      message: "Select content profile:",
      choices: PRESETS.map((p) => {
        const excluded = countPresetExclusions(p, filterIndex);
        const estimated = p.id !== "custom" ? estimatePresetItemCount(p, projectType, teamSize, filterIndex, projectLanguages) : 0;
        const countHint = estimated > 0 ? ` (~${estimated} items)` : "";
        const suffix = excluded > 0 ? ` (excludes ${excluded} of ${totalItems})` : "";
        return {
          name: `${p.name} — ${p.description}${countHint}${suffix}`,
          value: p.id,
        };
      }),
      default: "full" as PresetId,
    },
  ]);
  const selectedPreset = getPreset(presetAnswer.preset);

  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;

  // --- Custom content selection ---
  // #148 (D19-19): Group content by tags in custom profile display
  let customSelections: string[] | undefined;
  if (selectedPreset.id === "custom") {
    const contentIndex = filterIndex;
    const groupedChoices = buildTagGroupedCustomContentChoices(
      contentIndex.items,
      (item) => item.protected || item.tags.includes("core"),
    );

    const customAnswer = await inquirer.prompt<{ items: string[] }>([
      {
        type: "checkbox",
        name: "items",
        message: "Select content items:",
        choices: groupedChoices,
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    customSelections = customAnswer.items;
  }

  const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
  const toolAnswers = await inquirer.prompt<{ tools: Tool[] }>([
    {
      type: "checkbox",
      name: "tools",
      message: "Select tools to configure:",
      choices: TOOL_PROMPT_CHOICES,
      default: toolDefaults,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const tools = toolAnswers.tools.length > 0 ? toolAnswers.tools : DEFAULT_TOOLS;

  // Worktree file isolation: mirrors config.ts prompt. Honor explicit
  // --worktree/--no-worktree flag. Else prompt when a worktree-capable tool
  // is selected, else disable. Prompt order: tools -> worktree -> CLI tools -> features -> MCP.
  const hasWorktreeTool = tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
  let worktreeEnabled: boolean;
  if (opts.worktree !== undefined) {
    worktreeEnabled = opts.worktree;
  } else if (hasWorktreeTool) {
    const wtAnswer = await inquirer.prompt<{ enabled: boolean }>([{
      type: "confirm",
      name: "enabled",
      message: "Enable worktree file isolation (for parallel agent sessions)?",
      default: true,
    }]);
    worktreeEnabled = wtAnswer.enabled;
  } else {
    worktreeEnabled = false;
  }

  // CLI-tooling pivot (plan §4.3 steps 2-5): pick CLI tools, run a
  // detection sweep, and surface install-pending commands for missing
  // binaries. The picker pre-checks tier-1 and project-triggered tier-2.
  const tier2Suggested = Array.from(new Set([
    ...evaluateTier2Triggers(repoInfo),
    ...applyPlatformTriggers(platform, []),
  ]));
  const selectedCliTools = await pickCliTools({
    tier2Suggested,
    wslTheme,
  });
  if (selectedCliTools.length > 0) {
    const detectSpinner = createSpinner(`Detecting ${selectedCliTools.length} CLI tool(s)...`);
    detectSpinner.start();
    const missing = await findMissingCliTools(selectedCliTools);
    if (missing.length === 0) {
      detectSpinner.succeed(`All ${selectedCliTools.length} CLI tool(s) detected on PATH`);
    } else {
      detectSpinner.warn(`${selectedCliTools.length - missing.length}/${selectedCliTools.length} CLI tool(s) detected; ${missing.length} missing`);
      await offerInstaller(missing, { interactive: true });
    }
    // Surface CLI_TOOL_SECRET_NOTES for selected tools (plan §4.3 step 5)
    const cliEnvVars: string[] = [];
    for (const id of selectedCliTools) {
      const notes = CLI_TOOL_SECRET_NOTES[id];
      if (notes && notes.length > 0) {
        cliEnvVars.push(`${id}: ${notes.join(", ")}`);
      }
    }
    if (cliEnvVars.length > 0) {
      info(chalk.dim("CLI tool environment variables required:"));
      for (const note of cliEnvVars) {
        info(chalk.dim(`  ${note}`));
      }
    }
  }
  const cliToolsConfig: CliToolsConfig = {
    enabled: selectedCliTools.length > 0,
    selected: selectedCliTools,
  };

  // #143 (D19-14): Streamline MCP onboarding — surface secret notes inline
  const secretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
  if (secretNotes.length > 0) {
    info(chalk.dim("MCP secret loading by tool:"));
    for (const note of secretNotes) {
      info(chalk.dim(`  ${note}`));
    }
  }

  const featureAnswers = await inquirer.prompt<{ features: (keyof Features)[] }>([
    {
      type: "checkbox",
      name: "features",
      message: "Select features (MCP provides tool-server integration):",
      choices: FEATURE_CHOICES,
      default: DEFAULT_FEATURE_KEYS,
      ...(wslTheme && { theme: wslTheme }),
    },
  ]);
  const selectedFeatures = featureAnswers.features;
  const features = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(features) as (keyof Features)[]) {
    features[k] = selectedFeatures.includes(k);
  }

  // CLI-tooling pivot (plan §4.3 step 8): MCP is now behind a Yes/No
  // gate that defaults to No. Users opt in explicitly and only then see
  // the server picker. `hatch3r mcp setup` exists as a side-door for
  // users who skipped here and changed their mind later.
  let mcpServers: string[] = [];
  if (features.mcp) {
    const proceedMcp = await confirmMcpGate({ hasExisting: false, defaultYes: false });
    if (proceedMcp) {
      mcpServers = await pickMcpServers({ platform, wslTheme });
    }
  }

  // --- Resolve content selection ---
  const contentSelection = resolveSelection(selectedPreset, projectType, teamSize, filterIndex, customSelections, projectLanguages);

  // Warn if orchestration-critical agents are missing from selection
  const orchWarnings = validateOrchestrationDependencies(contentSelection);
  for (const w of orchWarnings) { warn(w); }

  warnBoardPrerequisites(contentSelection);

  await checkExisting(rootDir, false, contentSelection);
  await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, cliTools: cliToolsConfig, yes: false });
}

// ── Workspace initialization ──────────────────────────────────────

async function runWorkspaceInit(
  rootDir: string,
  detectedRepos: Awaited<ReturnType<typeof detectSubRepos>>,
  repoInfo: RepoInfo,
  opts: { tools?: string; yes?: boolean; preset?: string; projectType?: string; teamSize?: string; worktree?: boolean; cliTools?: string; noCliTools?: boolean; mcp?: boolean },
): Promise<void> {
  const headless = !!opts.yes;

  // Step 1: Detect sub-repo git identities
  console.log();
  const wsSpinner = createSpinner("Detecting workspace repos...");
  wsSpinner.start();

  if (detectedRepos.length === 0) {
    wsSpinner.succeed("Workspace created (no sub-repos found)");
    // Create empty workspace manifest with defaults
    const platform: Platform = "github";
    const tools: Tool[] = resolveToolsFromOpts(opts.tools, repoInfo);
    const features = { ...DEFAULT_FEATURES };
    // CLI-tooling pivot: MCP opt-in via --mcp on `--yes`. Defaults empty.
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    const mcpServers = features.mcp && opts.mcp
      ? Array.from(new Set([platformMcp, ...DEFAULT_MCP.filter((s) => s !== "github")]))
      : [];
    const cliToolsBase = opts.noCliTools
      ? { enabled: false, selected: [] as CliToolId[] }
      : ((): CliToolsConfig => {
          const explicit = resolveCliToolsFlag(opts.cliTools, repoInfo, platform);
          const selected = explicit ?? Array.from(new Set([
            ...DEFAULT_CLI_TOOLS,
            ...applyPlatformTriggers(platform, evaluateTier2Triggers(repoInfo)),
          ]));
          return { enabled: selected.length > 0, selected };
        })();
    const index = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    const contentSelection = resolveSelection(getPreset("full"), "brownfield", "solo", index, undefined, projectLanguages);
    const wsManifest = createWorkspaceManifest(
      basename(rootDir) || "workspace",
      { platform, tools, features, mcp: { servers: mcpServers }, cliTools: cliToolsBase, content: contentSelection },
      [],
      "manual",
    );
    await writeWorkspaceManifest(rootDir, wsManifest);
    return;
  }

  const enriched = detectedRepos.map((r) => ({
    ...r,
    ...detectRepoGitIdentity(join(rootDir, r.path)),
  }));

  wsSpinner.succeed(`Workspace: ${detectedRepos.length} repo(s) detected`);

  // Step 2: Display detected repos with git identity
  console.log();
  console.log(chalk.dim("  Repo            Platform      Owner/Repo                      Branch"));
  for (const r of enriched) {
    const name = (r.name ?? r.path).padEnd(16);
    if (r.owner && r.repo) {
      const platLabel = PLATFORM_DISPLAY_NAMES[r.platform].padEnd(14);
      const identity = `${r.owner}/${r.repo}`.padEnd(32);
      console.log(`  ${name}${chalk.dim(platLabel)}${chalk.dim(identity)}${chalk.dim(r.defaultBranch)}`);
    } else {
      console.log(`  ${name}${chalk.dim("(no remote detected)")}`);
    }
  }
  console.log();

  // Step 3: Interactive — confirm/edit repo identities
  if (!headless) {
    const { acceptIdentity } = await inquirer.prompt<{ acceptIdentity: boolean }>([
      {
        type: "confirm",
        name: "acceptIdentity",
        message: "Accept detected repo identities?",
        default: true,
      },
    ]);

    if (!acceptIdentity) {
      for (const r of enriched) {
        console.log(chalk.bold(`\n  ${r.name ?? r.path}:`));
        const identity = await inquirer.prompt<{ owner: string; repo: string; defaultBranch: string }>([
          { type: "input", name: "owner", message: "  Owner:", default: r.owner || undefined },
          { type: "input", name: "repo", message: "  Repo:", default: r.repo || undefined },
          {
            type: "input",
            name: "defaultBranch",
            message: "  Default branch:",
            default: r.defaultBranch || "main",
            // C8-D1-M9: enforce `git check-ref-format` on per-repo workspace
            // identity prompts as well as the top-level default-branch prompt.
            validate: (v: string) => {
              const trimmed = v.trim();
              if (trimmed === "") return true;
              return (
                isValidGitBranchName(trimmed) ||
                `Invalid git branch name: "${trimmed}". See git-check-ref-format(1).`
              );
            },
          },
        ]);
        r.owner = sanitizeInput(identity.owner);
        r.repo = sanitizeInput(identity.repo);
        r.defaultBranch = identity.defaultBranch.trim() || "main";
      }
    }
  }

  // Step 4: Derive workspace-root platform from sub-repos (workspace root has no git remote)
  const platform = deriveWorkspacePlatform(enriched);

  // Step 5: Resolve workspace-wide config (tools, features, content, MCP)
  let tools: Tool[];
  let features: Features;
  let mcpServers: string[];
  let contentSelection: ContentSelection;
  let worktreeEnabled: boolean;
  let wsCliTools: CliToolsConfig;

  if (headless) {
    tools = resolveToolsFromOpts(opts.tools, repoInfo);
    // Worktree: honor explicit --worktree/--no-worktree, else auto-enable for
    // worktree-capable tools (preserves pre-1.6.1 --yes behavior).
    worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
    features = { ...DEFAULT_FEATURES };
    // CLI-tooling pivot (plan §4.3): MCP is opt-in on `--yes`; default to
    // empty server list unless `--mcp` is set. Mirrors single-repo flow.
    const platformMcp = PLATFORM_MCP_SERVER[platform];
    mcpServers = features.mcp && opts.mcp
      ? Array.from(new Set([platformMcp, ...DEFAULT_MCP.filter((s) => s !== "github")]))
      : [];
    if (opts.noCliTools) {
      wsCliTools = { enabled: false, selected: [] };
    } else {
      const explicit = resolveCliToolsFlag(opts.cliTools, repoInfo, platform);
      const selected = explicit ?? Array.from(new Set([
        ...DEFAULT_CLI_TOOLS,
        ...applyPlatformTriggers(platform, evaluateTier2Triggers(repoInfo)),
      ]));
      wsCliTools = { enabled: selected.length > 0, selected };
    }
    const isGreenfield =
      repoInfo.languages.length === 1 &&
      repoInfo.languages[0] === "unknown" &&
      repoInfo.existingTools.length === 0 &&
      !repoInfo.hasExistingAgents;
    const presetId = validateFlag(opts.preset, ["minimal", "standard", "full"], "full", "preset");
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], isGreenfield ? "greenfield" : "brownfield", "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    const preset = getPreset(presetId);
    const index = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    contentSelection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages);
  } else {
    // Interactive workspace-wide config prompts
    const wslTheme = isWSL()
      ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
      : undefined;

    const wsFilterIndex = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    const isAutoGreenfield =
      repoInfo.languages.length === 1 &&
      repoInfo.languages[0] === "unknown" &&
      repoInfo.existingTools.length === 0 &&
      !repoInfo.hasExistingAgents;
    const wsGreenfieldExcl = countProjectTypeExclusions("greenfield", wsFilterIndex.items);
    const wsBrownfieldExcl = countProjectTypeExclusions("brownfield", wsFilterIndex.items);
    const projectTypeAnswer = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" }>([
      {
        type: "select",
        name: "projectType",
        message: "Is this a new (greenfield) or existing (brownfield) project?",
        choices: [
          { name: `Greenfield — new project from scratch${wsGreenfieldExcl > 0 ? ` (filters out ${wsGreenfieldExcl} brownfield-only item${wsGreenfieldExcl === 1 ? "" : "s"})` : ""}`, value: "greenfield" as const },
          { name: `Brownfield — existing codebase${wsBrownfieldExcl > 0 ? ` (filters out ${wsBrownfieldExcl} greenfield-only item${wsBrownfieldExcl === 1 ? "" : "s"})` : ""}`, value: "brownfield" as const },
        ],
        default: isAutoGreenfield ? "greenfield" : "brownfield",
      },
    ]);
    const projectType = projectTypeAnswer.projectType;

    const wsSoloExcl = countTeamSizeExclusions("solo", wsFilterIndex.items);
    const teamSizeAnswer = await inquirer.prompt<{ teamSize: "solo" | "team" }>([
      {
        type: "select",
        name: "teamSize",
        message: "Solo developer or team collaboration?",
        choices: [
          { name: `Solo — just me${wsSoloExcl > 0 ? ` (filters out ${wsSoloExcl} team-only item${wsSoloExcl === 1 ? "" : "s"})` : ""}`, value: "solo" as const },
          { name: "Team — multiple contributors", value: "team" as const },
        ],
        default: "solo",
      },
    ]);
    const teamSize = teamSizeAnswer.teamSize;

    const wsTotalItems = wsFilterIndex.items.length;
    const presetAnswer = await inquirer.prompt<{ preset: PresetId }>([
      {
        type: "select",
        name: "preset",
        message: "Select content profile:",
        choices: PRESETS.map((p) => {
          const excluded = countPresetExclusions(p, wsFilterIndex);
          const wsEstimated = p.id !== "custom" ? estimatePresetItemCount(p, projectType, teamSize, wsFilterIndex, projectLanguages) : 0;
          const wsCountHint = wsEstimated > 0 ? ` (~${wsEstimated} items)` : "";
          const suffix = excluded > 0 ? ` (excludes ${excluded} of ${wsTotalItems})` : "";
          return {
            name: `${p.name} — ${p.description}${wsCountHint}${suffix}`,
            value: p.id,
          };
        }),
        default: "full" as PresetId,
      },
    ]);
    const selectedPreset = getPreset(presetAnswer.preset);

    // #148 (D19-19): Group content by tags in workspace custom profile display
    let customSelections: string[] | undefined;
    if (selectedPreset.id === "custom") {
      const contentIndex = wsFilterIndex;
      const wsGroupedChoices = buildTagGroupedCustomContentChoices(
        contentIndex.items,
        (item) => item.protected || item.tags.includes("core"),
      );

      const customAnswer = await inquirer.prompt<{ items: string[] }>([
        {
          type: "checkbox",
          name: "items",
          message: "Select content items:",
          choices: wsGroupedChoices,
          ...(wslTheme && { theme: wslTheme }),
        },
      ]);
      customSelections = customAnswer.items;
    }

    const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
    const toolAnswers = await inquirer.prompt<{ tools: Tool[] }>([
      {
        type: "checkbox",
        name: "tools",
        message: "Select tools to configure:",
        choices: TOOL_PROMPT_CHOICES,
        default: toolDefaults,
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    tools = toolAnswers.tools.length > 0 ? toolAnswers.tools : DEFAULT_TOOLS;

    // Worktree file isolation: mirrors config.ts prompt. Honor explicit
    // --worktree/--no-worktree flag. Else prompt when a worktree-capable tool
    // is selected, else disable.
    const wsHasWorktreeTool = tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
    if (opts.worktree !== undefined) {
      worktreeEnabled = opts.worktree;
    } else if (wsHasWorktreeTool) {
      const wsWtAnswer = await inquirer.prompt<{ enabled: boolean }>([{
        type: "confirm",
        name: "enabled",
        message: "Enable worktree file isolation (for parallel agent sessions)?",
        default: true,
      }]);
      worktreeEnabled = wsWtAnswer.enabled;
    } else {
      worktreeEnabled = false;
    }

    // CLI-tooling pivot (plan §4.3 + §4.8 workspace parity): pick CLI
    // tools at workspace creation so the workspace defaults carry a
    // baseline tier-1 selection to all members.
    const wsTier2Suggested = Array.from(new Set([
      ...evaluateTier2Triggers(repoInfo),
      ...applyPlatformTriggers(platform, []),
    ]));
    const wsSelectedCliTools = await pickCliTools({
      tier2Suggested: wsTier2Suggested,
      wslTheme,
    });
    if (wsSelectedCliTools.length > 0) {
      const wsDetectSpinner = createSpinner(`Detecting ${wsSelectedCliTools.length} CLI tool(s)...`);
      wsDetectSpinner.start();
      const wsMissing = await findMissingCliTools(wsSelectedCliTools);
      if (wsMissing.length === 0) {
        wsDetectSpinner.succeed(`All ${wsSelectedCliTools.length} CLI tool(s) detected on PATH`);
      } else {
        wsDetectSpinner.warn(`${wsSelectedCliTools.length - wsMissing.length}/${wsSelectedCliTools.length} CLI tool(s) detected; ${wsMissing.length} missing`);
        await offerInstaller(wsMissing, { interactive: true });
      }
    }
    wsCliTools = {
      enabled: wsSelectedCliTools.length > 0,
      selected: wsSelectedCliTools,
    };

    // Surface per-editor secret loading notes
    const wsSecretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
    if (wsSecretNotes.length > 0) {
      info(chalk.dim("MCP secret loading by tool:"));
      for (const note of wsSecretNotes) {
        info(chalk.dim(`  ${note}`));
      }
    }

    const featureAnswers = await inquirer.prompt<{ features: (keyof Features)[] }>([
      {
        type: "checkbox",
        name: "features",
        message: "Select features:",
        choices: FEATURE_CHOICES,
        default: DEFAULT_FEATURE_KEYS,
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);
    const selectedFeatures = featureAnswers.features;
    features = { ...DEFAULT_FEATURES };
    for (const k of Object.keys(features) as (keyof Features)[]) {
      features[k] = selectedFeatures.includes(k);
    }

    // CLI-tooling pivot: MCP picker is behind a Yes/No gate (plan §4.3
    // step 8 / §4.4). Default No on first init, Yes on re-run with
    // existing servers (workspace root has no manifest, so default No).
    mcpServers = [];
    if (features.mcp) {
      const wsProceedMcp = await confirmMcpGate({ hasExisting: false, defaultYes: false });
      if (wsProceedMcp) {
        mcpServers = await pickMcpServers({ platform, wslTheme });
      }
    }

    contentSelection = resolveSelection(selectedPreset, projectType, teamSize, wsFilterIndex, customSelections, projectLanguages);
  }

  // Warn if orchestration-critical agents are missing from selection
  const orchWarnings = validateOrchestrationDependencies(contentSelection);
  for (const w of orchWarnings) { warn(w); }

  warnBoardPrerequisites(contentSelection);

  // Step 6: Create canonical .agents/ at workspace root (empty identity — workspace root is not a repo)
  await checkExisting(rootDir, headless, contentSelection);
  await runInit({
    rootDir,
    platform,
    owner: "",
    repo: "",
    namespace: "",
    project: "",
    defaultBranch: "",
    tools,
    features,
    mcpServers,
    repoInfo,
    contentSelection,
    worktreeEnabled,
    cliTools: wsCliTools,
    yes: headless,
  });

  // Step 7: Build repo entries and select which to sync
  let repoEntries: WorkspaceRepoEntry[];

  if (headless) {
    repoEntries = enriched.map((r) => ({
      path: r.path,
      name: r.name,
      sync: false,
      owner: r.owner || undefined,
      repo: r.repo || undefined,
      defaultBranch: r.defaultBranch || undefined,
      platform: r.platform || undefined,
    }));
  } else {
    const wslTheme = isWSL()
      ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
      : undefined;

    const { syncRepos } = await inquirer.prompt<{ syncRepos: string[] }>([
      {
        type: "checkbox",
        name: "syncRepos",
        message: "Select repos to sync workspace content to:",
        choices: enriched.map((r) => ({
          name: `${r.name}${r.hasHatch3r ? chalk.dim(" (has existing hatch3r)") : ""}`,
          value: r.path,
          checked: false,
        })),
        ...(wslTheme && { theme: wslTheme }),
      },
    ]);

    const syncSet = new Set(syncRepos);

    // C8-D1-M3: Managed-file conflict guard. If any selected sub-repo already
    // has `.agents/hatch.json`, warn before letting `syncWorkspaceRepos`
    // overwrite managed files in those sub-repos. Managed content outside
    // HATCH3R:BEGIN/END blocks is preserved by `safeWriteFile`, but the
    // managed portions will be replaced — the user must explicitly consent.
    const conflictingRepos = enriched.filter((r) => syncSet.has(r.path) && r.hasHatch3r);
    if (conflictingRepos.length > 0) {
      warn(
        `${conflictingRepos.length} selected repo(s) already have hatch3r installed; their managed files will be overwritten by workspace content.`,
      );
      for (const r of conflictingRepos) {
        console.log(chalk.dim(`  - ${r.name ?? r.path}`));
      }
      const { confirmConflict } = await inquirer.prompt<{ confirmConflict: boolean }>([
        {
          type: "confirm",
          name: "confirmConflict",
          message: "Proceed with overwriting managed files in existing hatch3r sub-repos?",
          default: false,
        },
      ]);
      if (!confirmConflict) {
        // Drop the conflicting repos from the sync set; keep them registered
        // in the workspace manifest so the user can sync later with
        // `hatch3r sync --repos <path>` after reviewing their managed files.
        for (const r of conflictingRepos) {
          syncSet.delete(r.path);
        }
        info(chalk.dim("  Skipped syncing conflicting repos. They remain registered in the workspace — run `hatch3r sync --repos <path>` after reviewing their managed files."));
      }
    }

    repoEntries = enriched.map((r) => ({
      path: r.path,
      name: r.name,
      sync: syncSet.has(r.path),
      owner: r.owner || undefined,
      repo: r.repo || undefined,
      defaultBranch: r.defaultBranch || undefined,
      platform: r.platform || undefined,
    }));
  }

  // Step 8: Create workspace manifest and sync
  const dirName = basename(rootDir) || "workspace";
  const wsManifest = createWorkspaceManifest(
    dirName,
    { platform, tools, features, mcp: { servers: mcpServers }, cliTools: wsCliTools, content: contentSelection },
    repoEntries,
    "manual",
  );
  await writeWorkspaceManifest(rootDir, wsManifest);

  const syncCount = repoEntries.filter((r) => r.sync).length;
  if (syncCount > 0) {
    const syncSpinner = createSpinner(`Syncing ${syncCount} repo(s)...`);
    syncSpinner.start();

    const result = await syncWorkspaceRepos(rootDir, {
      onWarn: (msg) => warn(msg),
    });

    const succeeded = result.repos.filter((r) => r.action === "synced").length;
    const failed = result.repos.filter((r) => r.action === "error").length;

    if (failed > 0) {
      syncSpinner.warn(`Workspace sync: ${succeeded} synced, ${failed} failed`);
      for (const r of result.repos.filter((r) => r.action === "error")) {
        logError(`  ${r.path}: ${r.error}`);
      }
    } else {
      syncSpinner.succeed(`Workspace sync: ${succeeded} repo(s) synced`);
    }
  }

  console.log();
  const wsLines = [
    label("Mode", "workspace"),
    label("Repos", `${repoEntries.length} registered, ${syncCount} synced`),
    label("Strategy", "manual (use hatch3r sync --repos to propagate)"),
    label("Manifest", `${AGENTS_DIR}/workspace.json`),
  ];
  printBox("Workspace ready", wsLines, "success");
}

function resolveToolsFromOpts(toolsFlag: string | undefined, repoInfo: RepoInfo): Tool[] {
  if (toolsFlag) {
    const rawTools = toolsFlag.split(",").map((t) => t.trim());
    const invalid = rawTools.filter((t) => !VALID_TOOLS.has(t));
    if (invalid.length > 0) {
      logError(`Invalid tool(s): ${invalid.join(", ")}`);
      console.log(chalk.dim(`  Valid tools: ${[...VALID_TOOLS].join(", ")}`));
      throw new HatchError(`Invalid tool(s): ${invalid.join(", ")}`, 1);
    }
    return rawTools as Tool[];
  }
  if (repoInfo.existingTools.length > 0) return repoInfo.existingTools;
  return DEFAULT_TOOLS;
}

/**
 * Resolve the `--cli-tools <ids|tier1|all>` flag (plan §4.3 / §7 item 15)
 * to a list of CLI-tool ids. Accepts:
 *   - `"tier1"` → `TIER1_CLI_TOOLS` verbatim.
 *   - `"all"` → every id in `AVAILABLE_CLI_TOOLS`.
 *   - comma-separated id list → validated against the registry.
 *
 * Returns `undefined` when `flag` is empty (caller falls back to the
 * default tier-1 + triggered-tier-2 selection).
 */
function resolveCliToolsFlag(
  flag: string | undefined,
  _repoInfo: RepoInfo,
  _platform: Platform,
): CliToolId[] | undefined {
  if (!flag) return undefined;
  const trimmed = flag.trim();
  if (trimmed === "") return undefined;
  if (trimmed === "tier1") return [...TIER1_CLI_TOOLS];
  if (trimmed === "all") return Object.keys(AVAILABLE_CLI_TOOLS);
  const rawIds = trimmed.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  const valid = new Set(Object.keys(AVAILABLE_CLI_TOOLS));
  const invalid = rawIds.filter((id) => !valid.has(id));
  if (invalid.length > 0) {
    logError(`Invalid CLI tool(s): ${invalid.join(", ")}`);
    console.log(chalk.dim(`  Valid ids: ${[...valid].join(", ")}`));
    throw new HatchError(`Invalid CLI tool(s): ${invalid.join(", ")}`, 1, "VALIDATION_ERROR");
  }
  return rawIds;
}
