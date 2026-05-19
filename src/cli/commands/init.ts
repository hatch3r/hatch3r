import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter, getUnsupportedFeatureWarnings, SHARED_ADAPTER_KEY, SHARED_BRIDGE_FILES } from "../../adapters/index.js";
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
import { detectProjectType } from "../../detect/projectType.js";
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
  setQuiet,
  setJson,
  isJson,
  isQuiet,
} from "../shared/ui.js";
import { findPackageRoot } from "../shared/paths.js";
import { buildTagGroupedCustomContentChoices } from "../shared/customContentChoices.js";
import { TOOL_DISPLAY_NAMES, TOOL_PROMPT_CHOICES, MCP_CHOICES, PLATFORM_DISPLAY_NAMES, PLATFORM_MCP_SERVER, sanitizeInput, isWSL, formatCommandHint, TOOL_SECRET_NOTES } from "../shared/constants.js";
import { pickCliTools, pickMcpServers } from "../shared/pickers.js";
import {
  BACK,
  isBack,
  runStepMachine,
  type Step,
  type StepResult,
} from "../shared/initSteps.js";
import {
  AVAILABLE_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  DEFAULT_CLI_TOOLS,
  TIER1_CLI_TOOLS,
} from "../../cliTools/registry.js";
import { findMissingCliTools } from "../../cliTools/detect.js";
import { offerInstaller, printMissingCliToolsDisclaimer } from "../../cliTools/install.js";
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
const DEFAULT_MCP: string[] = ["playwright", "github", "context7"];

// Seed content for `.agents/handoffs/README.md`. Documents the schema so
// `hatch3r-handoff-loader` and `/hatch3r-handoff resume` have a single
// on-disk source of truth.
const HANDOFFS_README_SEED = `# Project Handoffs

This directory holds active and archived handoff documents surfaced by the
\`hatch3r-handoff-loader\` agent at session start and consumed by
\`/hatch3r-handoff resume\`.

## Layout

- \`active/<id>.md\` — handoffs in any non-terminal status (open, in-progress, blocked, handed-off, resumed)
- \`archived/<id>.md\` — handoffs in terminal status (completed, expired, superseded)

## ID scheme

\`<YYYY-MM-DD>_T<HHmm>_<5hex>_<kebab-slug>\` — chronologically sortable, collision-safe.

Example: \`2026-05-17_T1430_a3f2c_issue-42-cache-refactor.md\`.

## Lifecycle

- Created by \`/hatch3r-handoff prepare\` or the \`on-context-switch\` hook.
- Loaded at session start by \`hatch3r-handoff-loader\`.
- Resumed via \`/hatch3r-handoff resume [<id>]\` (lists actives if no id given).
- \`expires_after\`: ISO-8601 timestamp; preparer default stamps \`created + 30 days\`.
- Archived (never deleted by hatch3r) on completion or expiry.

## Required frontmatter

| Field | Type | Notes |
| --- | --- | --- |
| \`id\` | string | Filename without \`.md\` |
| \`type\` | literal \`handoff\` | |
| \`created\` | ISO-8601 | Immutable |
| \`updated\` | ISO-8601 | Re-stamped on status change |
| \`status\` | enum | open \\| in-progress \\| blocked \\| handed-off \\| resumed \\| completed \\| archived |
| \`source_agent\` | string | Tool/role that prepared the handoff |
| \`target_agent\` | string | \`any\` allowed but warned (avoids handoff loops) |
| \`git_ref\` | string | \`branch@sha7\` — staleness signal |
| \`branch\` | string | |
| \`confidence\` | 0..1 | |
| \`completeness\` | 0..1 | |
| \`integrity\` | string | \`sha256:<hex>\` — SHA-256 of body |

Optional: \`work_item\` (platform-prefixed: \`gh:owner/repo#42\`, \`ado:org/project:work-item/123\`, \`gl:owner/repo!42\`), \`expires_after\`, \`summary\` (≤200 chars), \`requirements\`, \`compaction_count\`, \`hatch3r_version\`, \`tags\`, \`superseded_by\`, \`parent_handoff\`.

## Body sections (required, in order)

Wrap the body in user-tier instruction-hierarchy markers:

\`\`\`markdown
--- BEGIN USER-TIER CONTENT: handoff ---

## Problem            (1-3 paragraphs)
## Decisions          (bullet list)
## Work Done          (from end-of-session Iteration Summary)
## Work Remaining
## Blockers
## Next Steps         (ordered list)
## Build & Test Status (table: Check | Status | Notes)
## File Manifest      (table: Path | Status | Last action)

--- END USER-TIER CONTENT: handoff ---
\`\`\`

## Caps and validation

- Body ≤ 50 KB, total file ≤ 60 KB.
- Soft cap 25 active handoffs per repo (warn at 20, refuse briefing at 50).
- Injection-pattern scan (P-LEARN-01..05) at write and read; reuses learnings catalog.
- Integrity hash mismatch downgrades confidence to low; included with warning.

## Cross-tool portability

Handoffs are plain Markdown — readable by humans and any AI tool. Tool-specific adapters (Cursor, Claude, Copilot, etc.) surface active handoffs in their native context file on session-start so a handoff written from one tool resumes cleanly in another.

See \`agents/hatch3r-handoff-loader.md\`, \`skills/hatch3r-handoff-resume/SKILL.md\`, and \`rules/hatch3r-handoff-readiness.md\` for the full protocols.
`;

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
   * CLI-tooling pivot (1.7.5 / plan §4.3). When omitted, runInit treats
   * the project as having no CLI-tools opt-in (`{enabled: false,
   * selected: []}`) — matching the manifest default for pre-1.7.5 repos.
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
      "Wait for the in-flight init to finish, or check for a stale process holding the directory.",
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

  // Seed handoffs/ directory tree and README. Mirrors the learnings idempotent
  // seed: directory always created, README only on fresh init.
  await mkdir(join(agentsDir, "handoffs", "active"), { recursive: true });
  await mkdir(join(agentsDir, "handoffs", "archived"), { recursive: true });
  const handoffsReadmePath = join(agentsDir, "handoffs", "README.md");
  try {
    await access(handoffsReadmePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await safeWriteFile(handoffsReadmePath, HANDOFFS_README_SEED);
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
  const manifest = createManifest({
    platform,
    owner,
    repo,
    namespace,
    project,
    defaultBranch,
    tools,
    features,
    mcpServers,
    content: contentSelection,
    languages: repoInfo.languages,
    // C9-H47 (D14-SA14.4-H01): persist detected toolchain so adapter
    // sync can resolve `${HATCH3R:LINTER}` etc. tokens from the manifest
    // alone (sync.ts does not re-run analyzeRepo).
    detected: {
      linters: repoInfo.linters,
      testFrameworks: repoInfo.testFrameworks,
      ciProviders: repoInfo.ciProviders,
    },
    worktreeEnabled,
    customization: effectiveCustomization,
    cliTools,
  });
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
  // C9-H31 (D10-SA10.5-F1): Track bridge files (e.g. root AGENTS.md) that
  // are written outside any single adapter's `doGenerate()` under the
  // `_shared` sentinel key. The `hatch3r clean` cleanup contract honours
  // managed-block preservation for these paths. AGENTS.md was already added
  // to `manifest.managedFiles` above; the _shared bucket gives clean +
  // future tooling explicit ownership semantics. See
  // `src/adapters/index.ts::SHARED_ADAPTER_KEY` for the full contract.
  manifest.managedFilesByAdapter[SHARED_ADAPTER_KEY] = [...SHARED_BRIDGE_FILES];
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
      throw new HatchError(
        "All adapters failed",
        1,
        "ADAPTER_ERROR",
        "Re-run with `--verbose` to see per-adapter detail, then check `npx hatch3r validate` for upstream content errors.",
      );
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

  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // C9-H26 (D10-SA10.2-F1): `--json` emits one machine-readable line on
  // stdout and skips the decorated success box, multi-CTA hint, and
  // CLI-tooling disclaimer. `--quiet` (without `--json`) skips the box but
  // still calls printBox (which is a no-op when isQuiet()). The summary
  // payload is a stable JSON schema for CI consumers.
  if (isJson()) {
    const isGreenfieldForJson =
      repoInfo.languages.length === 1 &&
      repoInfo.languages[0] === "unknown" &&
      repoInfo.existingTools.length === 0 &&
      !repoInfo.hasExistingAgents;
    const payload = {
      status: "ok" as const,
      version: HATCH3R_VERSION,
      rootDir,
      platform,
      owner,
      repo,
      namespace,
      project,
      defaultBranch,
      tools,
      features: enabledFeatures,
      mcpServers,
      cliTools: cliTools?.selected ?? [],
      preset: contentSelection.preset,
      projectType: contentSelection.projectType,
      teamSize: contentSelection.teamSize,
      contentItemCount: countSelectionItems(contentSelection),
      worktreeEnabled: !!manifest.worktree?.enabled,
      isGreenfield: isGreenfieldForJson,
      adapterFailures: adapterFailures.map((f) => ({ tool: f.tool, error: f.error })),
      canonicalDir: AGENTS_DIR,
      manifestPath: `${AGENTS_DIR}/hatch.json`,
    };
    console.log(JSON.stringify(payload));
    return;
  }

  if (!isQuiet()) {
    console.log();
  }
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
    summaryLines.push(`  ${chalk.dim("Disable with: hatch3r config set worktree.enabled false")}`);
  }
  if (envResult && envResult.action !== "skipped") {
    summaryLines.push(label("Secrets", `.env.mcp (fill in your API keys)`));
  }
  summaryLines.push("");
  summaryLines.push(label("Canonical", `${AGENTS_DIR}/`));
  summaryLines.push(label("Manifest", `${AGENTS_DIR}/hatch.json`));

  // C9-H29 (D10-SA10.3-F2): Multi-CTA post-init hint based on context.
  // Surfaces the 4 README paths (greenfield: project-spec + roadmap;
  // brownfield: codebase-map; single feature: feature-plan; small change:
  // quick-change) so the user can pick the route that matches their
  // immediate intent. The primary CTA stays at the top (highest signal for
  // context) and the remaining three render as dimmed alternates.
  const isGreenfield =
    repoInfo.languages.length === 1 &&
    repoInfo.languages[0] === "unknown" &&
    repoInfo.existingTools.length === 0 &&
    !repoInfo.hasExistingAgents;
  summaryLines.push("");
  if (isGreenfield) {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "project-spec"))} to define your new project, then ${chalk.bold(formatCommandHint(tools, "roadmap"))}`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Existing codebase later? ")}${chalk.bold(formatCommandHint(tools, "codebase-map"))}`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Single feature: ")}${chalk.bold(formatCommandHint(tools, "feature-plan"))}`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Small change: ")}${chalk.bold(formatCommandHint(tools, "quick-change"))}`);
  } else {
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "codebase-map"))} to map your existing codebase`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Single feature: ")}${chalk.bold(formatCommandHint(tools, "feature-plan"))}`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Small change: ")}${chalk.bold(formatCommandHint(tools, "quick-change"))}`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Greenfield project? ")}${chalk.bold(formatCommandHint(tools, "project-spec"))}`);
  }

  if (envResult && envResult.newVars.length > 0) {
    summaryLines.push("");
    summaryLines.push(`${chalk.yellow("!")} Add your secrets to ${chalk.bold(".env.mcp")}: ${envResult.newVars.join(", ")}`);
    summaryLines.push(`  Then run: ${chalk.dim(getSourceEnvMcpCommand())}`);
  }

  printBox("Hatch complete", summaryLines, "success");

  if (cliTools && cliTools.selected.length > 0 && !isQuiet()) {
    const finalMissing = await findMissingCliTools(cliTools.selected);
    printMissingCliToolsDisclaimer(finalMissing, cliTools.selected.length);
  }

  if (!isQuiet()) {
    info(`Tip: Run /hatch3r-create anytime to author your own agents, skills, rules, commands, or hooks.`);
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
        // Exit 0 + no recoveryHint: user-initiated cancellation is success.
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
    throw new HatchError(
      `Invalid --${name}: "${value}"`,
      1,
      "VALIDATION_ERROR",
      `Re-run with one of: ${valid.join(", ")}.`,
    );
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
    /**
     * C9-H26 (D10-SA10.2-F1): Suppress all stdout chrome (banner, spinner
     * text, success box, multi-CTA hints). Diagnostic warnings/errors still
     * route to stderr per POSIX. Useful for CI logs where the banner +
     * decorated boxes clutter output. Implies the `--no-banner` effect.
     */
    quiet?: boolean;
    /**
     * C9-H26 (D10-SA10.2-F1): Emit a single machine-readable JSON line on
     * stdout instead of the decorated success box. Schema:
     *   {"status":"ok","version":"<ver>","rootDir":"<abs>","tools":[...],
     *    "preset":"<id>","mcpServers":[...],"cliTools":[...]}
     * Errors continue to throw HatchError; callers receive the normal
     * non-zero exit code. Implies `--quiet`.
     */
    json?: boolean;
    /**
     * C9-H26 (D10-SA10.2-F1): Skip the multi-line ASCII banner emitted at
     * the top of `hatch3r init`. Independent of `--quiet`; useful when a
     * CI badge tool wants the banner gone but the success box kept.
     */
    noBanner?: boolean;
  } = {},
): Promise<void> {
  // C9-H26 (D10-SA10.2-F1): chrome-suppression flags.
  // - `--json` implies `--quiet` (the structured emission replaces all chrome).
  // - `--quiet` implies `--no-banner` (banner is chrome).
  // - `--no-banner` alone keeps spinner/success-box output.
  // Reset state explicitly each call so flags from a previous invocation
  // never leak into the current one (matters under vitest where the module
  // is shared across tests in the same process).
  const jsonMode = opts.json === true;
  const quietMode = jsonMode || opts.quiet === true;
  const skipBanner = quietMode || opts.noBanner === true;
  setJson(jsonMode);
  setQuiet(quietMode);
  if (!skipBanner) {
    printBanner();
  }

  // C8-D1-M4: Validate `--preset`, `--project-type`, and `--team-size` flag
  // values eagerly, before any prompt or detection work runs. Previously
  // these flags were only validated on the `--yes` branch, so an interactive
  // invocation with `--preset kitchen-sink` silently discarded the bad flag
  // and still prompted the user. Per CLI Guidelines fail-fast validation,
  // invalid values abort with exit 1 before any side-effect.
  if (opts.preset !== undefined) {
    validateFlag(opts.preset, ["minimal", "standard", "full", "custom"], "standard", "preset");
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
        throw new HatchError(
          `Invalid tool(s): ${invalid.join(", ")}`,
          1,
          "VALIDATION_ERROR",
          `Re-run with --tools set to one or more of: ${[...VALID_TOOLS].join(", ")}.`,
        );
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
    const detection = await detectProjectType(repoInfo, rootDir);
    const presetId = validateFlag(opts.preset, ["minimal", "standard", "full"], "standard", "preset");
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], detection.type, "project-type");
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

  const filterIndex = await buildContentIndex(CONTENT_ROOT);
  const projectLanguages = languagesForSelection(repoInfo);
  const detection = await detectProjectType(repoInfo, rootDir);
  const greenfieldExcl = countProjectTypeExclusions("greenfield", filterIndex.items);
  const brownfieldExcl = countProjectTypeExclusions("brownfield", filterIndex.items);
  const detectionHint = detection.signals.length > 0
    ? ` (detected: ${detection.signals.slice(0, 3).join(", ")})`
    : "";
  const soloExcl = countTeamSizeExclusions("solo", filterIndex.items);
  const totalItems = filterIndex.items.length;
  const defaultBranchDefault = parseGitDefaultBranch();
  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;
  const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
  const tier2Suggested = Array.from(new Set([
    ...evaluateTier2Triggers(repoInfo),
    ...applyPlatformTriggers(detectedPlatform, []),
  ]));

  // Step-machine drives the interactive flow with back-navigation.
  // Each step's `run()` calls inquirer with the same shape the
  // pre-Slice-E inline prompts used so existing test queues match
  // unchanged. The orchestrator awaits `runStepMachine` and consumes
  // the resolved state below.
  interface SingleRepoState {
    platform: Platform;
    identity: { owner: string; repo: string; namespace: string; project: string };
    defaultBranch: string;
    projectType: "greenfield" | "brownfield";
    teamSize: "solo" | "team";
    preset: PresetId;
    customItems: string[] | undefined;
    tools: Tool[];
    wantMcp: boolean;
    mcpServers: string[];
    cliTools: CliToolId[];
  }

  const steps: Array<Step<SingleRepoState, keyof SingleRepoState>> = [
    {
      id: "platform",
      async run(_state, previous): Promise<StepResult<Platform>> {
        const answer = await inquirer.prompt<{ platform: Platform | typeof BACK }>([
          {
            type: "select",
            name: "platform",
            message: "Select your platform: (or ← Back)",
            choices: [
              { name: "← Back", value: BACK as unknown as Platform },
              { name: "GitHub", value: "github" as Platform },
              { name: "Azure DevOps", value: "azure-devops" as Platform },
              { name: "GitLab", value: "gitlab" as Platform },
            ],
            default: previous ?? detectedPlatform,
          },
        ]);
        return isBack(answer.platform) ? BACK : (answer.platform as Platform);
      },
    },
    {
      id: "identity",
      async run(state, previous): Promise<StepResult<SingleRepoState["identity"]>> {
        const plat = state.platform!;
        if (plat === "azure-devops") {
          const ado = await inquirer.prompt<{ org: string; project: string; repo: string }>([
            { type: "input", name: "org", message: "Azure DevOps organization: (type :back to go back)", default: previous?.owner || remote.owner || undefined },
            { type: "input", name: "project", message: "Azure DevOps project: (type :back to go back)", default: previous?.project || undefined },
            { type: "input", name: "repo", message: "Repository name: (type :back to go back)", default: previous?.repo || remote.repo || undefined },
          ]);
          if ([ado.org, ado.project, ado.repo].some((v) => v.trim() === ":back")) return BACK;
          const owner = sanitizeInput(ado.org);
          return {
            owner,
            repo: sanitizeInput(ado.repo),
            namespace: owner,
            project: sanitizeInput(ado.project),
          };
        } else if (plat === "gitlab") {
          const gl = await inquirer.prompt<{ namespace: string; project: string }>([
            { type: "input", name: "namespace", message: "GitLab namespace (group or username): (type :back to go back)", default: previous?.namespace || remote.owner || undefined },
            { type: "input", name: "project", message: "Project name: (type :back to go back)", default: previous?.project || remote.repo || undefined },
          ]);
          if ([gl.namespace, gl.project].some((v) => v.trim() === ":back")) return BACK;
          const owner = sanitizeInput(gl.namespace);
          const repo2 = sanitizeInput(gl.project);
          return { owner, repo: repo2, namespace: owner, project: repo2 };
        } else {
          const gh = await inquirer.prompt<{ owner: string; repo: string }>([
            { type: "input", name: "owner", message: "GitHub owner (org or username): (type :back to go back)", default: previous?.owner || remote.owner || undefined },
            { type: "input", name: "repo", message: "Repository name: (type :back to go back)", default: previous?.repo || remote.repo || undefined },
          ]);
          if ([gh.owner, gh.repo].some((v) => v.trim() === ":back")) return BACK;
          const owner = sanitizeInput(gh.owner);
          const repo2 = sanitizeInput(gh.repo);
          return { owner, repo: repo2, namespace: owner, project: repo2 };
        }
      },
    },
    {
      id: "defaultBranch",
      async run(_state, previous): Promise<StepResult<string>> {
        const answers = await inquirer.prompt<{ defaultBranch: string }>([
          {
            type: "input",
            name: "defaultBranch",
            message: "Default branch (for checkout, PR base, release): (type :back to go back)",
            default: previous ?? defaultBranchDefault,
            // C8-D1-M9: reject values that fail `git check-ref-format`. Empty
            // input is allowed through (falls back to detected default below).
            // `:back` short-circuits validation so back-nav always works.
            validate: (v: string) => {
              const trimmed = v.trim();
              if (trimmed === "" || trimmed === ":back") return true;
              return (
                isValidGitBranchName(trimmed) ||
                `Invalid git branch name: "${trimmed}". See git-check-ref-format(1).`
              );
            },
          },
        ]);
        if (answers.defaultBranch.trim() === ":back") return BACK;
        return answers.defaultBranch.trim() || defaultBranchDefault;
      },
    },
    {
      id: "projectType",
      async run(_state, previous): Promise<StepResult<"greenfield" | "brownfield">> {
        const answer = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" | typeof BACK }>([
          {
            type: "select",
            name: "projectType",
            message: `Is this a new (greenfield) or existing (brownfield) project?${detectionHint} (or ← Back)`,
            choices: [
              { name: "← Back", value: BACK as unknown as "greenfield" },
              { name: `Greenfield — new project from scratch${greenfieldExcl > 0 ? ` (filters out ${greenfieldExcl} brownfield-only item${greenfieldExcl === 1 ? "" : "s"})` : ""}`, value: "greenfield" as const },
              { name: `Brownfield — existing codebase${brownfieldExcl > 0 ? ` (filters out ${brownfieldExcl} greenfield-only item${brownfieldExcl === 1 ? "" : "s"})` : ""}`, value: "brownfield" as const },
            ],
            default: previous ?? detection.type,
          },
        ]);
        return isBack(answer.projectType) ? BACK : (answer.projectType as "greenfield" | "brownfield");
      },
    },
    {
      id: "teamSize",
      async run(_state, previous): Promise<StepResult<"solo" | "team">> {
        const answer = await inquirer.prompt<{ teamSize: "solo" | "team" | typeof BACK }>([
          {
            type: "select",
            name: "teamSize",
            message: "Solo developer or team collaboration? (or ← Back)",
            choices: [
              { name: "← Back", value: BACK as unknown as "solo" },
              { name: `Solo — just me${soloExcl > 0 ? ` (filters out ${soloExcl} team-only item${soloExcl === 1 ? "" : "s"})` : ""}`, value: "solo" as const },
              { name: "Team — multiple contributors", value: "team" as const },
            ],
            default: previous ?? "solo",
          },
        ]);
        return isBack(answer.teamSize) ? BACK : (answer.teamSize as "solo" | "team");
      },
    },
    {
      id: "preset",
      async run(state, previous): Promise<StepResult<PresetId>> {
        const projectType2 = state.projectType!;
        const teamSize2 = state.teamSize!;
        const answer = await inquirer.prompt<{ preset: PresetId | typeof BACK }>([
          {
            type: "select",
            name: "preset",
            message: "Select content profile: (or ← Back)",
            choices: [
              { name: "← Back", value: BACK as unknown as PresetId },
              ...PRESETS.map((p) => {
                const excluded = countPresetExclusions(p, filterIndex);
                const estimated = p.id !== "custom" ? estimatePresetItemCount(p, projectType2, teamSize2, filterIndex, projectLanguages) : 0;
                const countHint = estimated > 0 ? ` (~${estimated} items)` : "";
                const suffix = excluded > 0 ? ` (excludes ${excluded} of ${totalItems})` : "";
                return {
                  name: `${p.name} — ${p.description}${countHint}${suffix}`,
                  value: p.id,
                };
              }),
            ],
            default: previous ?? ("standard" as PresetId),
          },
        ]);
        return isBack(answer.preset) ? BACK : (answer.preset as PresetId);
      },
    },
    {
      id: "customItems",
      skip: (s) => s.preset !== "custom",
      async run(_state, previous): Promise<StepResult<string[] | undefined>> {
        const groupedChoices = buildTagGroupedCustomContentChoices(
          filterIndex.items,
          (item) => item.protected || item.tags.includes("core"),
        );
        const customAnswer = await inquirer.prompt<{ items: Array<string | typeof BACK> }>([
          {
            type: "checkbox",
            name: "items",
            message: "Select content items: (or ← Back)",
            choices: [
              { name: "← Back", value: BACK as unknown as string },
              ...groupedChoices,
            ],
            ...(previous ? { default: previous } : {}),
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        const items = customAnswer.items ?? [];
        if (Array.isArray(items) && items.some(isBack)) return BACK;
        return (items as string[]).filter((v) => !isBack(v));
      },
    },
    {
      id: "tools",
      async run(_state, previous): Promise<StepResult<Tool[]>> {
        const toolAnswers = await inquirer.prompt<{ tools: Array<Tool | typeof BACK> }>([
          {
            type: "checkbox",
            name: "tools",
            message: "Select tools to configure: (or ← Back)",
            choices: [
              { name: "← Back", value: BACK as unknown as Tool },
              ...TOOL_PROMPT_CHOICES,
            ],
            default: previous ?? toolDefaults,
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        const arr = toolAnswers.tools ?? [];
        if (Array.isArray(arr) && arr.some(isBack)) return BACK;
        const filtered = (arr as Tool[]).filter((v) => !isBack(v));
        return filtered.length > 0 ? filtered : DEFAULT_TOOLS;
      },
    },
    {
      id: "wantMcp",
      async run(): Promise<StepResult<boolean>> {
        // Confirm prompts have no ← Back affordance (single yes/no). Walk
        // back via the NEXT step's ← Back option.
        const { wantMcp } = await inquirer.prompt<{ wantMcp: boolean }>([
          {
            type: "confirm",
            name: "wantMcp",
            message: "Configure MCP servers (tool-server integration)?",
            default: false,
            ...(wslTheme && { theme: wslTheme }),
          },
        ]);
        return wantMcp;
      },
    },
    {
      id: "mcpServers",
      skip: (s) => !s.wantMcp,
      async run(state): Promise<StepResult<string[]>> {
        return await pickMcpServers({ platform: state.platform!, wslTheme });
      },
    },
    {
      id: "cliTools",
      async run(): Promise<StepResult<CliToolId[]>> {
        return await pickCliTools({ tier2Suggested, wslTheme });
      },
    },
  ];

  const stepState = await runStepMachine<SingleRepoState>(steps);

  const platform = stepState.platform;
  const { owner, repo, namespace, project } = stepState.identity;
  const defaultBranch = stepState.defaultBranch;
  const projectType = stepState.projectType;
  const teamSize = stepState.teamSize;
  const selectedPreset = getPreset(stepState.preset);
  const customSelections = stepState.customItems;
  const tools = stepState.tools;
  const features: Features = { ...DEFAULT_FEATURES, mcp: stepState.wantMcp };

  // C9-H32 (D10-SA10.5-F2): Surface MCP secret-loading divergence at
  // tool-selection time — before commit — so a user picking Claude alongside
  // auto-loaders (Cursor / Copilot / Windsurf) sees the divergent shell-source
  // requirement immediately.
  const secretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
  if (secretNotes.length > 0) {
    info(chalk.dim("MCP secret loading by tool:"));
    for (const note of secretNotes) {
      info(chalk.dim(`  ${note}`));
    }
  }

  // Worktree file isolation: auto-enable when a worktree-capable tool is
  // selected; honor explicit --worktree/--no-worktree override.
  const worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));

  // MCP server list is empty unless the user opted in via the gate.
  const mcpServers: string[] = stepState.mcpServers ?? [];

  // CLI tools selection + detection + installer follow-up.
  const selectedCliTools = stepState.cliTools;
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
    const contentSelection = resolveSelection(getPreset("standard"), "brownfield", "solo", index, undefined, projectLanguages);
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

  // Step 2: Display detected repos with git identity. C9-H26: skip the
  // table render under quiet/json — the JSON success payload already lists
  // the repos under `repos`.
  if (!isQuiet()) {
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
  }

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
    const wsDetection = await detectProjectType(repoInfo, rootDir);
    const presetId = validateFlag(opts.preset, ["minimal", "standard", "full"], "standard", "preset");
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], wsDetection.type, "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    const preset = getPreset(presetId);
    const index = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    contentSelection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages);
  } else {
    // Interactive workspace-wide config prompts — driven by the
    // step-machine for back-navigation. The per-repo identity-edit loop
    // and the final `syncRepos` checkbox remain outside the state
    // machine (Slice E §workspace).
    const wslTheme = isWSL()
      ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
      : undefined;

    const wsFilterIndex = await buildContentIndex(CONTENT_ROOT);
    const projectLanguages = languagesForSelection(repoInfo);
    const wsDetection = await detectProjectType(repoInfo, rootDir);
    const wsGreenfieldExcl = countProjectTypeExclusions("greenfield", wsFilterIndex.items);
    const wsBrownfieldExcl = countProjectTypeExclusions("brownfield", wsFilterIndex.items);
    const wsDetectionHint = wsDetection.signals.length > 0
      ? ` (detected: ${wsDetection.signals.slice(0, 3).join(", ")})`
      : "";
    const wsSoloExcl = countTeamSizeExclusions("solo", wsFilterIndex.items);
    const wsTotalItems = wsFilterIndex.items.length;
    const wsToolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;
    const wsTier2Suggested = Array.from(new Set([
      ...evaluateTier2Triggers(repoInfo),
      ...applyPlatformTriggers(platform, []),
    ]));

    interface WorkspaceState {
      projectType: "greenfield" | "brownfield";
      teamSize: "solo" | "team";
      preset: PresetId;
      customItems: string[] | undefined;
      tools: Tool[];
      wantMcp: boolean;
      mcpServers: string[];
      cliTools: CliToolId[];
    }

    const wsSteps: Array<Step<WorkspaceState>> = [
      {
        id: "projectType",
        async run(_state, previous): Promise<StepResult<"greenfield" | "brownfield">> {
          const answer = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" | typeof BACK }>([
            {
              type: "select",
              name: "projectType",
              message: `Is this a new (greenfield) or existing (brownfield) project?${wsDetectionHint} (or ← Back)`,
              choices: [
                { name: "← Back", value: BACK as unknown as "greenfield" },
                { name: `Greenfield — new project from scratch${wsGreenfieldExcl > 0 ? ` (filters out ${wsGreenfieldExcl} brownfield-only item${wsGreenfieldExcl === 1 ? "" : "s"})` : ""}`, value: "greenfield" as const },
                { name: `Brownfield — existing codebase${wsBrownfieldExcl > 0 ? ` (filters out ${wsBrownfieldExcl} greenfield-only item${wsBrownfieldExcl === 1 ? "" : "s"})` : ""}`, value: "brownfield" as const },
              ],
              default: previous ?? wsDetection.type,
            },
          ]);
          return isBack(answer.projectType) ? BACK : (answer.projectType as "greenfield" | "brownfield");
        },
      },
      {
        id: "teamSize",
        async run(_state, previous): Promise<StepResult<"solo" | "team">> {
          const answer = await inquirer.prompt<{ teamSize: "solo" | "team" | typeof BACK }>([
            {
              type: "select",
              name: "teamSize",
              message: "Solo developer or team collaboration? (or ← Back)",
              choices: [
                { name: "← Back", value: BACK as unknown as "solo" },
                { name: `Solo — just me${wsSoloExcl > 0 ? ` (filters out ${wsSoloExcl} team-only item${wsSoloExcl === 1 ? "" : "s"})` : ""}`, value: "solo" as const },
                { name: "Team — multiple contributors", value: "team" as const },
              ],
              default: previous ?? "solo",
            },
          ]);
          return isBack(answer.teamSize) ? BACK : (answer.teamSize as "solo" | "team");
        },
      },
      {
        id: "preset",
        async run(state, previous): Promise<StepResult<PresetId>> {
          const pt = state.projectType!;
          const ts = state.teamSize!;
          const answer = await inquirer.prompt<{ preset: PresetId | typeof BACK }>([
            {
              type: "select",
              name: "preset",
              message: "Select content profile: (or ← Back)",
              choices: [
                { name: "← Back", value: BACK as unknown as PresetId },
                ...PRESETS.map((p) => {
                  const excluded = countPresetExclusions(p, wsFilterIndex);
                  const wsEstimated = p.id !== "custom" ? estimatePresetItemCount(p, pt, ts, wsFilterIndex, projectLanguages) : 0;
                  const wsCountHint = wsEstimated > 0 ? ` (~${wsEstimated} items)` : "";
                  const suffix = excluded > 0 ? ` (excludes ${excluded} of ${wsTotalItems})` : "";
                  return {
                    name: `${p.name} — ${p.description}${wsCountHint}${suffix}`,
                    value: p.id,
                  };
                }),
              ],
              default: previous ?? ("standard" as PresetId),
            },
          ]);
          return isBack(answer.preset) ? BACK : (answer.preset as PresetId);
        },
      },
      {
        id: "customItems",
        skip: (s) => s.preset !== "custom",
        async run(_state, previous): Promise<StepResult<string[] | undefined>> {
          const wsGroupedChoices = buildTagGroupedCustomContentChoices(
            wsFilterIndex.items,
            (item) => item.protected || item.tags.includes("core"),
          );
          const customAnswer = await inquirer.prompt<{ items: Array<string | typeof BACK> }>([
            {
              type: "checkbox",
              name: "items",
              message: "Select content items: (or ← Back)",
              choices: [
                { name: "← Back", value: BACK as unknown as string },
                ...wsGroupedChoices,
              ],
              ...(previous ? { default: previous } : {}),
              ...(wslTheme && { theme: wslTheme }),
            },
          ]);
          const items = customAnswer.items ?? [];
          if (Array.isArray(items) && items.some(isBack)) return BACK;
          return (items as string[]).filter((v) => !isBack(v));
        },
      },
      {
        id: "tools",
        async run(_state, previous): Promise<StepResult<Tool[]>> {
          const toolAnswers = await inquirer.prompt<{ tools: Array<Tool | typeof BACK> }>([
            {
              type: "checkbox",
              name: "tools",
              message: "Select tools to configure: (or ← Back)",
              choices: [
                { name: "← Back", value: BACK as unknown as Tool },
                ...TOOL_PROMPT_CHOICES,
              ],
              default: previous ?? wsToolDefaults,
              ...(wslTheme && { theme: wslTheme }),
            },
          ]);
          const arr = toolAnswers.tools ?? [];
          if (Array.isArray(arr) && arr.some(isBack)) return BACK;
          const filtered = (arr as Tool[]).filter((v) => !isBack(v));
          return filtered.length > 0 ? filtered : DEFAULT_TOOLS;
        },
      },
      {
        id: "wantMcp",
        async run(): Promise<StepResult<boolean>> {
          const { wantMcp } = await inquirer.prompt<{ wantMcp: boolean }>([
            {
              type: "confirm",
              name: "wantMcp",
              message: "Configure MCP servers (tool-server integration)?",
              default: false,
              ...(wslTheme && { theme: wslTheme }),
            },
          ]);
          return wantMcp;
        },
      },
      {
        id: "mcpServers",
        skip: (s) => !s.wantMcp,
        async run(): Promise<StepResult<string[]>> {
          return await pickMcpServers({ platform, wslTheme });
        },
      },
      {
        id: "cliTools",
        async run(): Promise<StepResult<CliToolId[]>> {
          return await pickCliTools({
            tier2Suggested: wsTier2Suggested,
            wslTheme,
          });
        },
      },
    ];

    const wsState = await runStepMachine<WorkspaceState>(wsSteps);

    const projectType = wsState.projectType;
    const teamSize = wsState.teamSize;
    const selectedPreset = getPreset(wsState.preset);
    const customSelections = wsState.customItems;
    tools = wsState.tools;

    // C9-H32 (D10-SA10.5-F2): Surface per-editor MCP secret-loading
    // divergence at tool-selection time — before commit — matching the
    // single-repo flow. Workspace parity prevents user surprise.
    const wsSecretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
    if (wsSecretNotes.length > 0) {
      info(chalk.dim("MCP secret loading by tool:"));
      for (const note of wsSecretNotes) {
        info(chalk.dim(`  ${note}`));
      }
    }

    worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
    features = { ...DEFAULT_FEATURES, mcp: wsState.wantMcp };
    mcpServers = wsState.mcpServers ?? [];

    const wsSelectedCliTools = wsState.cliTools;
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

  // C9-H26 (D10-SA10.2-F1): json/quiet aware workspace summary. Skip the
  // decorated box (printBox is already a no-op under quiet) and emit a
  // JSON line that lists every repo and the sync count.
  if (isJson()) {
    const payload = {
      status: "ok" as const,
      version: HATCH3R_VERSION,
      mode: "workspace" as const,
      rootDir,
      platform,
      tools,
      mcpServers,
      cliTools: wsCliTools.selected,
      preset: contentSelection.preset,
      projectType: contentSelection.projectType,
      teamSize: contentSelection.teamSize,
      contentItemCount: countSelectionItems(contentSelection),
      repos: repoEntries.map((r) => ({
        path: r.path,
        name: r.name,
        sync: r.sync,
        owner: r.owner ?? null,
        repo: r.repo ?? null,
        defaultBranch: r.defaultBranch ?? null,
        platform: r.platform ?? null,
      })),
      syncCount,
      worktreeEnabled,
      manifestPath: `${AGENTS_DIR}/workspace.json`,
    };
    console.log(JSON.stringify(payload));
    return;
  }

  if (!isQuiet()) {
    console.log();
  }
  const wsLines = [
    label("Mode", "workspace"),
    label("Repos", `${repoEntries.length} registered, ${syncCount} synced`),
    label("Strategy", "manual (use hatch3r sync --repos to propagate)"),
    label("Manifest", `${AGENTS_DIR}/workspace.json`),
  ];
  printBox("Workspace ready", wsLines, "success");

  if (wsCliTools.selected.length > 0 && !isQuiet()) {
    const finalMissing = await findMissingCliTools(wsCliTools.selected);
    printMissingCliToolsDisclaimer(finalMissing, wsCliTools.selected.length);
  }
}

function resolveToolsFromOpts(toolsFlag: string | undefined, repoInfo: RepoInfo): Tool[] {
  if (toolsFlag) {
    const rawTools = toolsFlag.split(",").map((t) => t.trim());
    const invalid = rawTools.filter((t) => !VALID_TOOLS.has(t));
    if (invalid.length > 0) {
      logError(`Invalid tool(s): ${invalid.join(", ")}`);
      console.log(chalk.dim(`  Valid tools: ${[...VALID_TOOLS].join(", ")}`));
      throw new HatchError(
        `Invalid tool(s): ${invalid.join(", ")}`,
        1,
        "VALIDATION_ERROR",
        `Re-run with --tools set to one or more of: ${[...VALID_TOOLS].join(", ")}.`,
      );
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
    throw new HatchError(
      `Invalid CLI tool(s): ${invalid.join(", ")}`,
      1,
      "VALIDATION_ERROR",
      "Re-run with --cli-tools=tier1, --cli-tools=all, or a comma-separated subset of valid ids (run `hatch3r cli-tools list` to see them).",
    );
  }
  return rawIds;
}
