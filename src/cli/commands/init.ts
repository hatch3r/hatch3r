import { access, mkdir, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { checkContextBudget, formatBudgetWarning } from "../../adapters/contextBudget.js";
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
import { rehydrateCustomization } from "../../manifest/rehydrate.js";
import { writeProvenance, type PerAdapterOutputs } from "../../manifest/provenance.js";
import { migrateAgentsToHatch3r } from "../../migration/agentsToHatch3r.js";
import { safeWriteFile, atomicWriteFile, sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic } from "../../merge/orphanCleanup.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import {
  COMMUNICATION_STYLES,
  DEFAULT_COMMUNICATION_STYLE,
  DEFAULT_FEATURES,
  DEFAULT_MATURITY_TIER,
  HATCH3R_DIR,
  HatchError,
  MATURITY_TIERS,
  ORCHESTRATION_EFFORTS,
  VALID_TOOLS,
  WORKTREE_CAPABLE_TOOLS,
  WORKTREE_INCLUDE_FILE,
  type CliToolId,
  type CliToolsConfig,
  type CommunicationStyle,
  type ContentSelection,
  type ConventionConflict,
  type CustomizationManifest,
  type Features,
  type MaturityTier,
  type OrchestrationEffort,
  type Platform,
  type RepoInfo,
  type Tool,
} from "../../types.js";
import { readFile } from "node:fs/promises";
import { analyzeRepo, isGreenfield, analyzeConventionConflicts, formatConventionConflicts } from "../../detect/repoAnalyzer.js";
import { detectProjectType } from "../../detect/projectType.js";
import { classifyDetectedStacks } from "../../detect/stackSupport.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { planPerPackageOutputs, emitsPerPackage } from "../../content/monorepoEmission.js";
import {
  printBanner,
  createSpinner,
  printBox,
  printNextSteps,
  info,
  error as logError,
  step,
  label,
  warn,
  verbose,
  isJson,
  isQuiet,
  printTimingSummary,
} from "../shared/ui.js";
import { emitJson } from "../shared/output.js";
import { beginCommand } from "../shared/commandOutput.js";
import { maybeSelfUpdateBeforeInit } from "../shared/initUpdateCheck.js";
import { TOOL_DISPLAY_NAMES, PLATFORM_DISPLAY_NAMES, PLATFORM_MCP_SERVER, sanitizeInput, isWSL, formatCommandHint, TOOL_SECRET_NOTES } from "../shared/constants.js";
import {
  runStepMachine,
  type Step,
} from "../shared/initSteps.js";
import {
  cliToolsStep,
  communicationStyleStep,
  customItemsStep,
  identityStep,
  maturityStep,
  platformStep,
  presetStep,
  toolsStep,
} from "../shared/flowSteps.js";
import {
  AVAILABLE_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  DEFAULT_CLI_TOOLS,
  TIER1_CLI_TOOLS,
} from "../../cliTools/registry.js";
import { findMissingCliTools } from "../../cliTools/detect.js";
import { offerInstaller, printMissingCliToolsDisclaimer } from "../../cliTools/install.js";
import { applyPlatformTriggers, evaluateTier2Triggers } from "../../cliTools/triggers.js";
import { HATCH3R_VERSION } from "../../version.js";
import { buildContentIndex, resolveSelection, countSelectionItems, selectionSummary, getAllContentIds, validateOrchestrationDependencies, resolveUserContentRoot, type ContentIndex } from "../../content/index.js";
import {
  getPreset,
  resolvePresetArg,
  KNOWN_PRESET_IDS,
  type PresetId,
  type ContentPreset,
} from "../../content/presets.js";
import { KNOWN_ROLES, KNOWN_FACETS, type RoleId, type FacetId } from "../../content/tags.js";
import { detectSubRepos, shouldSuggestWorkspace } from "../../workspace/detect.js";
import { createWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import type { WorkspaceRepoEntry } from "../../workspace/types.js";
import { parseGitRemote, parseGitDefaultBranch, getGitRemoteUrl, detectPlatformFromRemote, detectRepoGitIdentity } from "../../workspace/git.js";
import {
  runImport,
  IMPORT_TARGETS,
  type ImportTarget,
  type FormatImportSummary,
} from "../../importers/index.js";
import { createSnapshot } from "../../pipeline/snapshot.js";
import { countTrackedFiles, estimateCost, formatCostBlock } from "../../pipeline/costEstimator.js";
import { recordFirstRunSuccess, recordSpaceMetric } from "../../pipeline/spaceTelemetry.js";
import { readCheckpoint, writeCheckpoint, checkpointPath, workspaceDir, type CheckpointMeta } from "../../pipeline/checkpoint.js";
import { execFileSync } from "node:child_process";

// release/2.8.5 BUG-2/BUG-1 root cause A: the content index used to be built
// against `findPackageRoot(__dirname)` — the PACKAGE root. The published npm
// tarball ships canonical content under `dist/content/` only (no root
// `agents/`), so every published install silently indexed 0 items: empty
// preset counts, empty `manifest.content.items`, and a crashing Custom picker.
// Every index build now resolves through `resolveBundledContentRoot()` (the
// same chokepoint the adapter emission path already used at runInitInner),
// which probes `dist/content/` first, falls back to the dev checkout layout,
// and throws an actionable HatchError instead of resolving an empty root.
const DEFAULT_TOOLS: Tool[] = ["claude"];
const DEFAULT_MCP: string[] = ["playwright", "github", "context7"];

/**
 * W3-mcp-optin: default MCP server set applied when the user opts in via
 * `--mcp` (path-independent — interactive, `--yes`, and workspace inits all
 * resolve through here). The platform server leads; DEFAULT_MCP's "github"
 * entry is dropped from the tail so a non-GitHub platform does not pull the
 * GitHub server alongside its own (the Set dedupes it back in for GitHub).
 * Single source for the expression previously copy-pasted at the three
 * headless resolution sites.
 */
function defaultMcpServers(platform: Platform): string[] {
  return Array.from(
    new Set([PLATFORM_MCP_SERVER[platform], ...DEFAULT_MCP.filter((s) => s !== "github")]),
  );
}

// D10-SA10.5-H1 (D10, P1): MCP-secret-loading classes used to tailor the
// post-init `.env.mcp` guidance in the success box. The semantics are the
// authoritative ones documented on `TOOL_SECRET_NOTES` (src/cli/shared/
// constants.ts): `claude`, `cursor`, and `codex` require `.env.mcp` to be
// sourced into the launching process; Copilot's emitted STDIO config has a
// real envFile loader. Kept as explicit Sets — not a substring scan of note
// text — so wording changes do not silently re-classify a tool.
const MCP_SHELL_SOURCE_TOOLS = new Set<Tool>(["claude", "cursor", "codex"]);
const MCP_AUTO_LOAD_TOOLS = new Set<Tool>(["copilot"]);

function skillInvocationGuidance(tools: Tool[]): string {
  const hasCodex = tools.includes("codex");
  if (hasCodex && tools.length === 1) {
    return "Some workflows ship as skills (not /commands) — in Codex, invoke them with the documented `$skill-name` syntax.";
  }
  if (hasCodex) {
    return "Some workflows ship as skills (not /commands) — Claude Code: skill picker or `Skill: name`; Cursor/Copilot: their skill surfaces; Codex: `$skill-name`.";
  }
  return "Some workflows ship as skills (not /commands) — use the selected tool's skill surface (Claude Code also accepts a `Skill:` prefix).";
}

// D14-SA14.2-H1 (D14, P4/P1): soft cap on package count for opt-in per-package
// emission. Above this, `outputs × packages` file writes (e.g. 50 packages × 3
// adapters ≈ 25k files) become a scale liability rather than a convenience, so
// init warns and skips the per-package copies above the cap (the root emission
// is unaffected). 25 mirrors the handoffs active-soft-cap convention used
// elsewhere (`HANDOFFS_README_SEED` "Soft cap 25 active handoffs").
const PER_PACKAGE_COUNT_CAP = 25;

// D14-SA14.2-H1: bounded fan-out width for the per-package write batch. Caps
// concurrent `safeWriteFile` calls so a large monorepo writes in parallel
// without exhausting file descriptors (the prior code awaited each write in a
// serial nested for-loop). Mirrors a conservative default; raise only with a
// measured fd-exhaustion headroom check.
const PER_PACKAGE_WRITE_CONCURRENCY = 8;

// D1-SA1.1-04 (D1, P2): named init checkpoint waves. `recordPhase` writes these
// as the checkpoint `wave` field; the `--resume` reader distinguishes a mid-run
// generation checkpoint (GENERATION — written by recordPhase after adapter
// writes, before finalize) from a fully-finalized run (FINALIZE — written after
// the manifest + seeds + mcp land). Requiring FINALIZE in the reader stops a
// wave-1 `passed` checkpoint (the exact shape recordPhase leaves mid-run) from
// being misreported as "already completed".
const INIT_GENERATION_WAVE = 1;
const INIT_FINALIZE_WAVE = 2;

/**
 * D14-SA14.2-H1: run `task` over `items` with at most `limit` in flight at
 * once, preserving input order in the returned results array. Used to batch
 * per-package adapter writes with bounded concurrency instead of a serial
 * `for ... await` loop. A rejected task rejects the whole batch (callers wrap
 * per-item failures themselves when partial success is desired).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    while (true) {
      const current = next++;
      if (current >= items.length) return;
      results[current] = await task(items[current], current);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * D14-SA14.2-H1: append literal `.gitignore` entries (e.g. per-package
 * generated-copy paths) when not already present. Idempotent — each entry is
 * checked against the existing trimmed lines before being added, so a re-run
 * never duplicates. Distinct from `ensureGitignoreEntry` (which manages the
 * fixed `REQUIRED_GITIGNORE_ENTRIES` set): this appends caller-computed,
 * per-run entries. Writes through `atomicWriteFile` (temp+rename) for crash
 * safety, matching `ensureGitignoreEntry`'s #240 convention — the composed
 * content is append-only over the existing bytes, and `safeWriteFile` would
 * skip the write once `.gitignore` exists (silent-writes sweep, release/2.7.1).
 * Best-effort — a write failure routes through `warn()` (Silent Failure
 * Contract — P5) and never aborts init.
 */
async function appendLocalGitignoreEntries(rootDir: string, entries: string[]): Promise<void> {
  const gitignorePath = join(rootDir, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch (err) {
    verbose(`init: appendLocalGitignoreEntries readFile — will create — ${err instanceof Error ? err.message : String(err)}`);
  }
  const existing = new Set(content.split("\n").map((l) => l.trim()));
  const missing = entries.filter((e) => !existing.has(e));
  if (missing.length === 0) return;
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  try {
    // Silent-writes sweep (release/2.7.1): `.gitignore` is not a
    // hatch3r-managed filename, so safeWriteFile skipped the write whenever
    // the file already existed — the per-package entries were silently never
    // registered on any repo with a pre-existing .gitignore. The composed
    // content preserves every existing byte (append-only), so write it
    // through the crash-safe atomic writer directly, matching the sibling
    // `ensureGitignoreEntry` (src/env/mcpEnv.ts, #240 convention).
    await atomicWriteFile(gitignorePath, `${content}${separator}${missing.join("\n")}\n`);
  } catch (err) {
    warn(`init: could not register per-package .gitignore entries — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Seed content for `.hatch3r/handoffs/README.md` (Wave 6 relocation; previously
// `.agents/handoffs/README.md`). Documents the schema so `hatch3r-handoff-loader`
// and `/hatch3r-handoff resume` have a single on-disk source of truth.
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

// D5-SA5.3-H1: Seed content for `.hatch3r/learnings/README.md` (Wave 6
// relocation; previously `.agents/learnings/README.md`). Explains the
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

Add one markdown file per learning with YAML frontmatter. These five keys are
the canonical schema — \`rules/hatch3r-learning-system.md\` is the single source
of truth and \`hatch3r-learnings-loader\` downgrades any entry that omits them
(or that emits the deprecated \`category\`/\`area\`/\`recorded\`/\`source\`/\`author\`/
\`date\`/\`tags\` match keys) to \`confidence: low\`:

\`\`\`yaml
---
id: <YYYY-MM-DD-short-slug>
topic: <short topic, e.g., "vitest coverage thresholds">
applies-to: <file globs OR module paths, e.g., "src/merge/**">
confidence: high | medium | low
supersedes: [<id1>, <id2>]   # optional
created: <YYYY-MM-DD>
---

<one-paragraph rule>

Why: <why it holds — the root cause, not the symptom>
How to apply: <the concrete check or action on a matching file>
\`\`\`

- \`topic\` is the relevance match key (one topic per file; split multi-topic findings).
- \`applies-to\` is the path glob the loader tests the current files against.
- \`confidence\`: high (verified by test or repeated observation), medium (single observation + reasoning), low (single anecdote, pending verification).

The loader agent applies content-security and integrity checks to every
entry; see \`hatch3r-learnings-loader\` for the full protocol.

## Recommended First Learning — Pipeline Drift

Copy the markdown block below into \`.hatch3r/learnings/2026-05-12-pipeline-drift-rule-73.md\`
to prime your AI tool against the bypass pattern reported in hatch3r
issue #73 (GitHub Copilot Chat skipping the four-phase sub-agent
pipeline on Tier-3 epics). The \`hatch3r-learnings-loader\` agent will
surface it on session start.

\`\`\`markdown
---
id: 2026-05-12-pipeline-drift-rule-73
topic: orchestrator pipeline drift on hook-less adapters
applies-to: "rules/hatch3r-agent-orchestration.md, src/adapters/**"
confidence: high
created: 2026-05-12
---

The hatch3r four-phase sub-agent pipeline (Research -> Implement ->
Review -> Quality) is trust-based on Copilot Chat — Copilot has
\`hooks: false\` in \`src/adapters/index.ts\`, exposes no PreToolUse /
pre-edit hook, and does not surface its chat transcript to external
processes. Drift is invisible by default: Copilot can call
\`multi_replace_string_in_file\` / \`create_file\` inline on a Tier-3
task and the build can still pass.

Why: a hook-less adapter cannot enforce delegation mechanically, so the
orchestrator self-discipline is the only guard; without it, code mutations
land outside the implementer sub-agent and review/quality phases are skipped.

How to apply: treat any of these as bypass mode and halt + re-ground —
(1) the orchestrator reply does NOT start with the
\`[hatch3r-pipeline: phase N | last: ... | next: ...]\` header on a tracked
Tier 2+ task; (2) a code-writing tool was called before the user confirmed
the Pre-Implementation Summary on a Tier 3 task; (3) a file mutation was
performed from the orchestrator turn rather than through a dedicated
\`hatch3r-implementer\` subagent. Source: issue
https://github.com/hatch3r-dev/hatch3r/issues/73; rules
\`rules/hatch3r-agent-orchestration.md\` (Per-Turn Pipeline-State Header,
Mandatory Delegation Directive) and \`rules/hatch3r-deep-context.md\`
(Tier 3 — Deep hard gate); \`copilot\` is the only adapter with
\`hooks: false\` in \`src/adapters/index.ts\`.
\`\`\`

Customize the \`id\` / \`created\` date and \`applies-to\` globs to match your setup.
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

/**
 * D10-15 (Cycle 11 Wave 2, P1): when a solo developer's selection drops the
 * board cluster, say so explicitly. All board commands/skills carry
 * `[board, ctx:team-only]` (no floor tag), so `resolveSelection`'s solo
 * team-size filter removes them silently — yet the quick-start presents the
 * board chain (Steps 5-7) as the primary workflow. Without this note a solo
 * user who follows the quick-start hits "skill not found" with no explanation.
 *
 * Fires only when the SAME preset would ship board content at team size but the
 * realized solo selection has none — i.e. the team-only filter is the reason
 * board is absent, not the preset's capability dial (e.g. `minimal`, which
 * never requested board, prints nothing). Re-resolves once at `teamSize:
 * "team"` to make that distinction; the call is in-memory and only runs on the
 * solo path, so it adds no cost to team installs.
 */
function warnBoardDroppedForSolo(
  teamSize: "solo" | "team",
  preset: ContentPreset,
  projectType: "greenfield" | "brownfield",
  index: ContentIndex,
  projectLanguages: string[],
  selectionOptions: { role?: RoleId; facets?: FacetId[] },
  soloSelection: ContentSelection,
): void {
  if (teamSize !== "solo") return;
  if (selectionHasBoardContent(soloSelection)) return; // board shipped; nothing dropped
  // Would this preset ship board content for a team? If not, the absence is by
  // capability dial, not the solo filter — stay silent.
  const teamSelection = resolveSelection(
    preset, projectType, "team", index, undefined, projectLanguages, selectionOptions,
  );
  if (!selectionHasBoardContent(teamSelection)) return;
  // release/2.8.6: name the two REAL levers. The prior "or `hatch3r config` to
  // switch later" pointed at a dead end — config had no team-size surface
  // (SCALAR_CONFIG_KEYS carried no team_size and no interactive step existed).
  // Both levers below re-resolve the selection with the team filter.
  info(
    `Board workflows are team-scoped (ctx:team-only) and are not part of this solo selection. ` +
    `Add them by re-running ${chalk.bold("hatch3r init --team-size team")}, ` +
    `or later via ${chalk.bold("hatch3r config team_size=team")} (also settable in the interactive \`hatch3r config\` team-size step).`,
  );
}

/**
 * release/2.8.6 (D10-37 extension): compute the item set the solo team-size
 * filter excluded from `soloSelection` — the items the SAME preset ships at
 * `teamSize: "team"` that the realized solo selection lacks. Derived from a
 * fresh `resolveSelection` at team size, never from a hard-coded id list, so
 * tag/id changes in the canonical corpus keep the disclosure honest. Pure and
 * in-memory (same cost class as `warnBoardDroppedForSolo`'s probe); callers
 * invoke it only on solo selections. Consumed by init's success-box/JSON
 * disclosure and by `hatch3r config`'s re-selection disclosure (config.ts).
 */
export function computeTeamOnlyFilteredItems(
  preset: ContentPreset,
  projectType: "greenfield" | "brownfield",
  index: ContentIndex,
  projectLanguages: string[] | undefined,
  selectionOptions: { role?: RoleId; facets?: FacetId[] },
  soloSelection: ContentSelection,
): Array<{ type: string; id: string }> {
  const teamSelection = resolveSelection(
    preset, projectType, "team", index, undefined, projectLanguages, selectionOptions,
  );
  const soloIds = getAllContentIds(soloSelection);
  const filtered: Array<{ type: string; id: string }> = [];
  for (const id of getAllContentIds(teamSelection)) {
    if (soloIds.has(id)) continue;
    const item = index.byId.get(id);
    filtered.push({ type: item?.type ?? "unknown", id });
  }
  return filtered;
}

/**
 * Group a filtered-item list by content class for one-line-per-class display
 * (`commands: a, b; skills: c, …`). Class order follows first appearance in
 * the resolution, keeping output deterministic for a given corpus.
 */
export function formatTeamOnlyFilteredByClass(
  filtered: ReadonlyArray<{ type: string; id: string }>,
): string[] {
  const byType = new Map<string, string[]>();
  for (const { type, id } of filtered) {
    const bucket = byType.get(type) ?? [];
    bucket.push(id);
    byType.set(type, bucket);
  }
  return [...byType.entries()].map(([type, ids]) => `${type}s: ${ids.join(", ")}`);
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

/**
 * D1-SA1.1-07 (D1, P2): GitHub App bots (dependabot, renovate, github-actions,
 * …) author commits under a distinct `<name>[bot]@users.noreply.github.com`
 * email, so a solo repo with automation enabled carries ≥2 distinct author
 * emails and mis-infers as `team`. Exclude any author whose email carries the
 * `[bot]` App marker before counting. Human GitHub noreply addresses
 * (`<id>+<user>@users.noreply.github.com`, no `[bot]`) are kept — they are real
 * contributors masking their email, not bots — matching the finding's
 * "match on `[bot]` specifically" disposition.
 */
function isBotAuthorEmail(email: string): boolean {
  return /\[bot\]/i.test(email);
}

/**
 * F10.3-2 (D10, P1): infer team size from git history instead of prompting.
 * The interactive `teamSize` prompt was dropped to keep the first-run flow
 * within the P1 prompt ceiling (Decision 25 / Vercel-Heroku benchmark; the
 * ceiling is ≤6 as of 2.1.0, the 6th being the maturity prompt). teamSize is
 * still inferred, not prompted. We count distinct NON-bot commit authors via
 * `git log` (D1-SA1.1-07: `isBotAuthorEmail` drops `[bot]` App authors first) —
 * `>1` distinct human author email implies a `team` repo; a single author (or
 * an unreadable / empty / non-git / bots-only history) falls back to `solo`.
 * Degradation mirrors `parseGitDefaultBranch`: any git error returns the safe
 * default rather than throwing. Overridable post-init via `hatch3r config`.
 *
 * D1-SA1.1-07 divergence note (unification deferred): only the interactive path
 * calls this; the `--yes`/headless path hard-defaults `solo` (see the
 * `validateFlag(opts.teamSize, …, "solo", …)` sites in `initCommand`). Making
 * both paths infer the SAME default is a user-visible behavior change (CI
 * `--yes` installs on a multi-author repo would gain team-only content), so it
 * is gated behind a B1 maintainer decision (`.claude/rules/clarification-default.md`)
 * and NOT flipped here.
 */
function inferTeamSizeFromGit(cwd: string): "solo" | "team" {
  try {
    const out = execFileSync("git", ["log", "--format=%ae", "-n", "200"], {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (out.length === 0) return "solo";
    const distinct = new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0)
        // D1-SA1.1-07: exclude bot authors so automation does not inflate a
        // solo repo to "team".
        .filter((email) => !isBotAuthorEmail(email)),
    );
    return distinct.size > 1 ? "team" : "solo";
  } catch (err) {
    // No git, no commits, or git not on PATH — fall back to the historical
    // prompt default. Surface under --verbose per the Silent Failure Contract
    // (P5) so the inference outcome is observable; this is a convenience over
    // an explicit prompt, not a correctness gate, so we never throw.
    verbose(`init: inferTeamSizeFromGit fell back to "solo" — ${err instanceof Error ? err.message : String(err)}`);
    return "solo";
  }
}

/**
 * D14-SA14.4-F7 (Pillar P1): true when at least one
 * `.hatch3r/{type}/*.customize.yaml` Layer-2 override file exists on disk.
 * Used to gate the post-init customization-discovery CTA so it shows only to
 * users who have not already adopted the customization layer. Probe failures
 * (dir absent, unreadable) resolve to `false` — i.e. "no customize files
 * found, surface the hint" — and are non-fatal (verbose-only per the Silent
 * Failure Contract). Mirrors the Layer-2 path in
 * `src/adapters/customization.ts` (`.hatch3r/{type}/{id}.customize.yaml`).
 */
async function hasCustomizeFiles(rootDir: string): Promise<boolean> {
  for (const type of ["agents", "skills", "rules", "commands"]) {
    try {
      const entries = await readdir(join(rootDir, HATCH3R_DIR, type));
      if (entries.some((name) => name.endsWith(".customize.yaml"))) return true;
    } catch (err) {
      // Directory absent / unreadable — treat as "no customize file here".
      verbose(`init: hasCustomizeFiles probe of ${type} fell through — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return false;
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
  /**
   * F1.1-H1 / F14.3-H1 (Decision 16): operational maturity tier of the
   * project. Persisted in `.hatch3r/hatch.json` as a runtime
   * investment-calibration dial (it does NOT gate content selection — that is
   * tier-invariant per the Decision 16 reframe). Delivered to runtime agents
   * via the adapter header and consumed by user-content gate strictness.
   * Default `DEFAULT_MATURITY_TIER` ("solo") when omitted.
   */
  maturity?: MaturityTier;
  /**
   * How generated agents talk to the human operator (2.8.0 additive scalar;
   * release/2.8.5 also prompts for it on init's interactive path — see the
   * honest prompt-count note in `initCommand`). Persisted under
   * `manifest.communicationStyle`; omission preserves an existing
   * manifest's value, else writes no field (consumers default to "plain"
   * via `readCommunicationStyle`).
   */
  communicationStyle?: CommunicationStyle;
  /**
   * 2.8.0 additive scalar (flag-only — `--default-effort`): persisted
   * default orchestration intensity. Persisted under
   * `manifest.defaultEffort`; omission preserves an existing manifest's
   * value, else writes no field (absent ⇒ auto-tier; an explicit `--effort`
   * run flag overrides — see `readDefaultEffort`).
   */
  defaultEffort?: OrchestrationEffort;
  /**
   * release/2.8.5 (BUG-4): the effective `--role` / `--facets` selection
   * filter this init resolved `contentSelection` with. Persisted under
   * `manifest.contentFilter` so `hatch3r config`'s re-resolution and the
   * `hatch3r update` selection refresh apply the SAME filter instead of
   * silently widening the set. Omission preserves an existing manifest's
   * filter; absent everywhere ⇒ no field is written.
   */
  contentFilter?: { role?: RoleId; facets?: FacetId[] };
  /**
   * release/2.8.6 (D10-37 extension): the items the solo team-size filter
   * excluded from `contentSelection` — computed by
   * {@link computeTeamOnlyFilteredItems} at the selection site (callers pass
   * it only for solo+full resolutions, where the disclosure fires). Threaded
   * so the success box can enumerate the actual filtered ids grouped by class
   * and the `--format json` payload can carry them as
   * `teamOnlyFilteredItems`; omitted/empty ⇒ the generic one-line note.
   */
  teamOnlyFiltered?: Array<{ type: string; id: string }>;
  /**
   * D14-SA14.2-H1 (D14, P4/P1): opt-in for per-package monorepo emission.
   * When false/omitted (the default), `runInit` writes adapter output only to
   * the repo root even on a monorepo — per-package copying (`outputs ×
   * packages` extra files) is off. Set true by `--per-package` to materialize
   * tool context adjacent to each package. The emission is additionally capped
   * ({@link PER_PACKAGE_COUNT_CAP}) and batched with bounded concurrency to
   * keep large monorepos from a serial `outputs × packages` write storm.
   */
  perPackage?: boolean;
  /**
   * D14-13 (D14-SA14.4-F3, P1/P4): mutually-exclusive convention conflicts
   * detected from `repoInfo` (via `analyzeConventionConflicts`). Forwarded to
   * `createManifest` so they persist on `HatchManifest.conflicts` and a later
   * `status`/`verify` can re-surface the warning. Omitted/empty when the repo
   * carries no competing toolchains (no field is written to the manifest).
   */
  conflicts?: ConventionConflict[];
  /**
   * W5-bigfour (P1): `--dry-run` — run adapter generation up to the write
   * boundary (Pass 1, in-memory), render the per-tool would-write summary,
   * and skip every disk mutation: orphan-tmp sweep, legacy-state migration,
   * customization rehydration, snapshot, adapter outputs, per-package copies,
   * `.worktreeinclude`, manifest, provenance, learnings/handoffs seeds,
   * mcp.json, `.env.mcp`, `.gitignore` entries, telemetry, and checkpoints.
   * Prompts on the interactive path still run; only writes are skipped.
   */
  dryRun?: boolean;
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
      undefined,
      "CONFIG_ERROR",
      // D1-SA1.1-F12: the guard is in-process only (a module-scope Set cleared
      // in `finally`), so the only way to reach it is a concurrent/reentrant
      // `runInit` call in the same process — not a filesystem lock or a stale
      // OS process. Describe that condition + a bug-report path instead of
      // implying a stale lockfile the implementation does not create.
      "Wait for the concurrent runInit call in this process to finish. If you hit this consistently, the hatch3r process may be stuck — file a bug at https://github.com/hatch3r-dev/hatch3r/issues with steps to reproduce.",
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
  const { rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, customization, cliTools, maturity, communicationStyle, defaultEffort, perPackage, conflicts, teamOnlyFiltered } = options;
  // D14-SA14.2-H1 (D14, P4/P1): per-package monorepo emission is opt-in.
  // `emitPerPackage` is the single gate the snapshot-path collection and the
  // write pass both read; the `manifest.packages` non-empty check is applied
  // alongside it at each site (the manifest is built further below).
  const emitPerPackage = perPackage === true;
  const totalSteps = 4;
  // D10-M9 (Cycle 10): capture time-to-first-value at init entry so the
  // success path can emit a `Completed in Xs` line via `printTimingSummary`.
  // Pairs with the SPACE-framework "Efficiency" dimension in D10.8.
  const initStartMs = Date.now();

  // D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): sweep orphan `.tmp.<8-hex>` files
  // left under the project root by a prior SIGKILL'd run before the init writes
  // begin. `init` writes through `safeWriteFile`/`atomicWriteFile` (temp+rename),
  // so an interrupted init can strand temp files that no entry-point sweep would
  // otherwise reclaim if the operator never re-runs a sweeping command. Best-
  // effort: the sweep only removes files older than the 60s in-flight-write floor
  // ({@link ORPHAN_MIN_AGE_MS}), surfaces removals + any unlink failures via
  // `warn()` per the Silent Failure Contract (P5), and never aborts init.
  // Mirrors the `update`/`sync` entry-point sweep — including its `--dry-run`
  // skip (the sweep unlinks files; dry-run promises no writes).
  if (options.dryRun !== true) {
    try {
      const sweptTmp = await sweepOrphanTmpFiles(rootDir, { recursive: true });
      const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
      if (tmpDiag) warn(tmpDiag);
    } catch (err) {
      verbose(`init: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Decision 24 / Bucket 2.x: surface a pre-execution cost estimate so an
  // operator sees the fan-out and token envelope before mutations begin.
  // `init` is a single-pass orchestrator with no sub-agent fan-out — use the
  // "light" triage tier baseline with an explicit `subAgentDeclared: 0` so the
  // emitted block reflects in-process work (no sub-agents).
  // D6-20: scale the static-frame token component by the target repo's size band
  // (`git ls-files` count). `countTrackedFiles` returns null for a non-git dir;
  // passing `?? undefined` keeps the repo-size-independent estimate in that case.
  const trackedFiles = countTrackedFiles(rootDir);
  const costEstimate = estimateCost({
    triageTier: "light",
    subAgentDeclared: 0,
    webResearchDeclared: 0,
    repoFileCount: trackedFiles ?? undefined,
  });
  if (!isQuiet()) {
    info(chalk.dim(`Pre-execution cost estimate:\n${formatCostBlock(costEstimate)}`));
  }

  // Decision 27 / Bucket 2.2: every long-running orchestrator captures a
  // pre-mutation snapshot under `.hatch3r/snapshots/<sessionId>/` so a single
  // `hatch3r rollback --session=<id>` can revert the run. Session id format
  // matches the canonical pattern used by `src/pipeline/snapshot.ts` examples
  // (`init-<ISO-timestamp>`, alphanumeric + hyphen, no path separators).
  const initSessionId = `init-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-Z$/, "Z")}`;

  // F16.1-C1 (Decision 27 / Bucket 2.2): write a checkpoint after each init
  // mutation phase under `.init-workspace/checkpoint.json` — the same path
  // `initCommand --resume` reads. Wave 1 = adapter generation/write,
  // wave 2 = finalize (manifest + seeds + mcp). This makes the resumability
  // substrate functional: a `--resume` after a completed init detects the
  // `passed` checkpoint and reports it; a crashed init leaves an in-progress
  // marker. Best-effort — a checkpoint-write failure routes to a warning and
  // never aborts a fresh install (matches the snapshot Silent Failure Contract).
  const initWorkspace = workspaceDir(rootDir, "init");
  const recordPhase = async (
    wave: number,
    status: "in-progress" | "passed" | "failed",
  ): Promise<void> => {
    // W5-bigfour: `--dry-run` promises zero writes — checkpoints included.
    if (options.dryRun === true) return;
    const meta: CheckpointMeta = {
      baselineSha: HATCH3R_VERSION,
      lastPassedGateN: status === "passed" ? wave : Math.max(0, wave - 1),
      registrySha: "",
      timestamp: new Date().toISOString(),
    };
    try {
      await writeCheckpoint(initWorkspace, "init", wave, status, meta);
    } catch (err) {
      // Surface under non-quiet so the operator knows resume state was not
      // captured, but never block the install.
      if (!isQuiet()) {
        warn(`init: checkpoint write (wave ${wave}, ${status}) skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // Wave 6: relocate any pre-1.9 `.agents/` state (hatch.json, learnings/,
  // handoffs/, mcp/mcp.json) to `.hatch3r/` before reading the manifest so a
  // re-init over a legacy install discovers the manifest at the new path.
  // W5-bigfour: the relocation moves files, so `--dry-run` skips it — on a
  // legacy repo the preview then reads no manifest and renders as a fresh
  // install, which matches what a subsequent real run would migrate into.
  if (options.dryRun !== true) {
    await migrateAgentsToHatch3r(rootDir);
  }

  const s1 = createSpinner(step(1, totalSteps, "Resolving canonical content..."));
  s1.start();

  // Wave 3: Detect re-init via manifest only — no `.agents/` materialization.
  // Adapters source canonical content from the bundled package (see
  // `resolveBundledContentRoot`), not from a user-repo directory.
  const existingManifest = await readManifest(rootDir);

  s1.succeed(step(1, totalSteps, `Canonical content resolved (${countSelectionItems(contentSelection)} items)`));

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
    // D14-M7 (Cycle 11): persist the detected package manager so sync-time
    // `${HATCH3R:VERIFY_GATE_*}` resolution renders the project's native run
    // command (pnpm/yarn/bun) instead of always `npm run test`.
    packageManager: repoInfo.packageManager,
    // C9-H47 (D14-SA14.4-H01): persist detected toolchain so adapter
    // sync can resolve `${HATCH3R:LINTER}` etc. tokens from the manifest
    // alone (sync.ts does not re-run analyzeRepo).
    detected: {
      linters: repoInfo.linters,
      testFrameworks: repoInfo.testFrameworks,
      ciProviders: repoInfo.ciProviders,
    },
    // F14.2-H1 (D14): persist enumerated monorepo packages so sync.ts knows
    // which `<package>/.hatch3r/` targets to refresh without re-detecting
    // the workspace layout.
    packages: repoInfo.packages,
    // D14-13 (D14-SA14.4-F3): persist detected convention conflicts so
    // `status`/`verify` can re-surface the single-toolchain-guidance warning
    // without re-running detection. Empty/absent writes no field.
    conflicts,
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
  // F1.1-H1 / F14.3-H1 (Decision 4 / #16): persist maturity tier so
  // `resolveSelection` honours it across `sync` / `update` / `config`.
  // Init-supplied `maturity` wins over a preserved/legacy value; omission
  // falls back to the existing manifest's tier or "solo" via readMaturityTier.
  if (maturity) {
    manifest.maturity = maturity;
  } else if (existingManifest?.maturity) {
    manifest.maturity = existingManifest.maturity;
  }
  // 2.8.0: persist the flag-only additive scalars with the same precedence
  // as `maturity` — init-supplied value wins; otherwise preserve an existing
  // manifest's field; absent everywhere ⇒ no field is written (absent fields
  // stay absent on round-trip; consumers apply the documented fallbacks).
  if (communicationStyle) {
    manifest.communicationStyle = communicationStyle;
  } else if (existingManifest?.communicationStyle) {
    manifest.communicationStyle = existingManifest.communicationStyle;
  }
  if (defaultEffort) {
    manifest.defaultEffort = defaultEffort;
  } else if (existingManifest?.defaultEffort) {
    manifest.defaultEffort = existingManifest.defaultEffort;
  }
  // release/2.8.5 (BUG-4): persist the effective --role/--facets filter with
  // the same precedence family — init-supplied wins; else preserve an existing
  // manifest's filter; absent everywhere ⇒ no field (byte-identity for
  // unfiltered repos). Consumers: config's selection re-resolution + update's
  // content-selection-refresh checkpoint (both via readContentFilter).
  const suppliedFilter = options.contentFilter;
  if (suppliedFilter && (suppliedFilter.role !== undefined || (suppliedFilter.facets?.length ?? 0) > 0)) {
    manifest.contentFilter = {
      ...(suppliedFilter.role !== undefined ? { role: suppliedFilter.role } : {}),
      ...((suppliedFilter.facets?.length ?? 0) > 0 ? { facets: [...suppliedFilter.facets!] } : {}),
    };
  } else if (existingManifest?.contentFilter) {
    manifest.contentFilter = existingManifest.contentFilter;
  }
  s2.succeed(step(2, totalSteps, "Manifest prepared"));

  // F2.3-H1 (Cycle 10 Phase B Wave 1A): materialize Layer-4 manifest
  // customization payload into Layer-2 `.customize.yaml` files when the YAML
  // is absent. `applyCustomizationImpl` only reads Layer 2 (yaml) and Layer 3
  // (md) — without this step, manifest.customization round-trips through
  // `clean` → reinit but never re-emerges at the adapter boundary
  // (JSDoc-promised but un-implemented Layer-4 read). See
  // `src/manifest/rehydrate.ts` for the rationale and idempotency guarantee.
  // Existing `.customize.yaml` files are preserved (Layer 2 wins by
  // precedence; this is a Layer-4 fallback).
  // W5-bigfour: rehydration writes `.customize.yaml` files, so `--dry-run`
  // skips it. Tradeoff: a repo whose Layer-4 manifest customization has no
  // Layer-2 yaml yet previews adapter output WITHOUT that customization (the
  // adapters read Layer 2 from disk); the no-writes contract dominates.
  if (options.dryRun !== true) {
    const rehydration = await rehydrateCustomization(rootDir, manifest.customization);
    for (const w of rehydration.warnings) { warn(w); }
  }

  const s3 = createSpinner(
    step(3, totalSteps, `Generating ${tools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")} output...`),
  );
  s3.start();

  // F16.1-C1: generation phase begins — an in-progress checkpoint so a
  // `--resume` after a crash mid-generation sees the run did not complete.
  await recordPhase(INIT_GENERATION_WAVE, "in-progress");

  // Decision 27 (Bucket 2.2) wiring coordination: the pre-mutation
  // snapshot for init is captured below as part of F1.1-C1's two-pass
  // adapter handling (Pass 1 collects outputs, Pass 2 snapshots then
  // writes). The session id is defined further up (`initSessionId`) so
  // the success summary can surface it as the rollback target.
  const sessionId = initSessionId;

  const adapterFailures: { tool: string; error: string }[] = [];
  // Task #11 orphan-cleanup: populate managedFilesByAdapter on init so the
  // first sync has a history to diff against (otherwise first-run behaviour
  // would silently skip cleanup, and an upgrade-over-existing-init would
  // miss the first opportunity to drop pre-B3 rule files).
  manifest.managedFilesByAdapter = manifest.managedFilesByAdapter ?? {};
  // Wave 3: adapters read canonical content from the bundled package, not
  // from a user-repo `.agents/` directory. No root AGENTS.md is emitted at
  // init time (per blueprint v2 decision #3).
  const canonicalContentRoot = resolveBundledContentRoot();

  // Decision 27 wiring: two-pass adapter handling so we can snapshot the
  // pre-mutation state of every file we are about to write. Pass 1 calls
  // `adapter.generate(...)` (in-memory, no disk writes) and collects outputs.
  // Pass 2 captures the snapshot then issues the actual `safeWriteFile`
  // calls. Failure semantics from the prior single-pass loop are preserved:
  // a per-adapter throw in Pass 1 is recorded and propagated through the
  // existing `adapterFailures` accounting; all-adapters-failed still throws
  // HatchError before the manifest is written (C7-H8 invariant).
  type PendingAdapter = {
    tool: Tool;
    warnings: string[];
    outputs: Awaited<ReturnType<ReturnType<typeof getAdapter>["generate"]>>;
  };
  const pendingAdapters: PendingAdapter[] = [];
  for (const tool of tools) {
    const adapter = getAdapter(tool);
    try {
      // Wave 5: pass rootDir as userRepoRoot so D20 overrides under
      // .hatch3r/overrides/ are picked up by readCanonicalFiles.
      const outputs = await adapter.generate(canonicalContentRoot, manifest, rootDir);
      pendingAdapters.push({ tool, warnings: adapter.warnings.slice(), outputs });
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
      // D1-SA1.1-F08: tailor the recovery hint to the failure class instead of
      // always pointing at `hatch3r validate` (which only surfaces upstream
      // content errors, never I/O faults). An I/O-class failure (ENOSPC /
      // EACCES / EPERM / ENOENT / EROFS) is a filesystem problem `validate`
      // cannot diagnose, so steer the user to permissions/free-space checks.
      // Anything else keeps the content-oriented `validate` hint.
      const ioFailure = adapterFailures.some((f) =>
        /\b(ENOSPC|EACCES|EPERM|ENOENT|EROFS)\b/.test(f.error),
      );
      const recoveryHint = ioFailure
        ? `Filesystem error writing adapter output. Check write permissions on \`${rootDir}\` and free disk space (\`df -h\`), then re-run \`hatch3r init\`.`
        : "Re-run with `--verbose` to see per-adapter detail, then check `npx hatch3r validate` for upstream content errors.";
      // D10-39 (D10, P1): this all-adapters-failed terminus is the canonical
      // first-run FAILURE site — the user reached no adapter output. Record the
      // primary SPACE metric `firstRunSuccessRate` as value=0 here (the success
      // terminus records value=1) so `firstRunSuccessRate` reflects BOTH outcomes
      // and is not survivorship-biased to 1. recordFirstRunSuccess honours the
      // Silent Failure Contract (never throws), so it runs before — and does not
      // mask — the ADAPTER_ERROR throw below.
      // W5-bigfour: this site sits BEFORE the dry-run terminus, so it must
      // carry its own `--dry-run` gate — telemetry writes
      // `.hatch3r/telemetry/space-<date>.jsonl`, and dry-run promises zero
      // writes (matches the orphan-sweep / checkpoint / migration /
      // rehydration gates above). The success-path recording is unreachable
      // under dry-run (the terminus returns first), so it needs no gate.
      if (options.dryRun !== true) {
        recordFirstRunSuccess(false, {
          source: "hatch3r-init",
          projectRoot: rootDir,
          tags: {
            failure: ioFailure ? "io" : "content",
            tools: tools.join("+"),
          },
        });
        // D10-SA10.8-01 (D10, P5): record the init wall-clock to the SPACE
        // `efficiency` axis at the FAILURE terminus too (time-to-failure), so
        // the efficiency signal is not survivorship-biased to successful runs.
        // Reuses the same JSONL sink + Silent Failure Contract; dry-run-gated by
        // the enclosing block (telemetry writes a file, dry-run promises none).
        recordSpaceMetric(
          {
            metricId: "timeToFirstValueMs",
            axis: "efficiency",
            value: Date.now() - initStartMs,
            source: "hatch3r-init",
            tags: { outcome: "failed", tools: tools.join("+") },
          },
          rootDir,
        );
      }
      throw new HatchError(
        "All adapters failed",
        undefined,
        "ADAPTER_ERROR",
        recoveryHint,
      );
    }
  }

  // D6-12 (D6, P7): context-budget coverage on the first-run/highest-output
  // path. `init` generates the same adapter outputs as `sync` but previously had
  // 0 budget checks, so a content selection whose always-loaded slice overflows
  // a platform's context window (e.g. copilot's ~64K) installed silently and the
  // user only learned of the overflow on a later `sync`. Route init through the
  // SAME shared assessment `sync` uses (`checkContextBudget` + `formatBudgetWarning`
  // over `isAlwaysLoaded`, `src/adapters/contextBudget.ts`) so both code paths
  // measure the identical always-loaded slice. WARN-ONLY here by design: unlike
  // sync, init is the first-run path (P1 first-run success — Node 22 only), so
  // an over-budget selection must not abort a fresh install; the warning is the
  // signal and `hatch3r sync --strict-budget` remains the hard gate for CI.
  for (const pa of pendingAdapters) {
    const budgetResult = checkContextBudget(pa.tool, pa.outputs);
    const budgetWarning = formatBudgetWarning(budgetResult);
    if (budgetWarning) {
      warn(budgetWarning);
    }
  }

  // W5-bigfour (P1): `--dry-run` terminus. Pass 1 above produced the complete
  // in-memory output set without touching disk, so every write below this
  // point (snapshot, adapter outputs, per-package copies, .worktreeinclude,
  // manifest, provenance, learnings/handoffs seeds, mcp.json, .env.mcp,
  // .gitignore entries, telemetry, checkpoints) is skipped wholesale. The
  // rendering mirrors `update --dry-run` (`runUpdateDryRun` in update.ts):
  // per-tool added/modified/unchanged classification by raw byte comparison
  // of the generated content against the on-disk copy.
  if (options.dryRun === true) {
    s3.succeed(step(3, totalSteps, "Adapter output generated (dry run — no writes)"));
    const dryRunChanges: Array<{
      tool: Tool;
      added: string[];
      modified: string[];
      unchanged: string[];
    }> = [];
    for (const pa of pendingAdapters) {
      const bucket = {
        tool: pa.tool,
        added: [] as string[],
        modified: [] as string[],
        unchanged: [] as string[],
      };
      for (const out of pa.outputs) {
        let existing: string | null = null;
        try {
          existing = await readFile(join(rootDir, out.path), "utf-8");
        } catch (err) {
          void err; // missing file → "added"
        }
        if (existing === null) bucket.added.push(out.path);
        else if (existing !== out.content) bucket.modified.push(out.path);
        else bucket.unchanged.push(out.path);
      }
      dryRunChanges.push(bucket);
    }
    if (isJson()) {
      emitJson({
        status: "dry-run",
        version: HATCH3R_VERSION,
        rootDir,
        tools,
        preset: contentSelection.preset,
        projectType: contentSelection.projectType,
        teamSize: contentSelection.teamSize,
        contentItemCount: countSelectionItems(contentSelection),
        adapterFailures: adapterFailures.map((f) => ({ tool: f.tool, error: f.error })),
        adapterChanges: dryRunChanges,
      });
      return;
    }
    const dryLines: string[] = [];
    for (const f of adapterFailures) {
      dryLines.push(`${chalk.red("x")} ${f.tool}: ${f.error}`);
    }
    for (const bucket of dryRunChanges) {
      dryLines.push(chalk.bold(TOOL_DISPLAY_NAMES[bucket.tool] ?? bucket.tool));
      for (const p of bucket.added) dryLines.push(`  ${chalk.green("+ added")}    ${p}`);
      for (const p of bucket.modified) dryLines.push(`  ${chalk.yellow("~ modified")} ${p}`);
      for (const p of bucket.unchanged) dryLines.push(`  ${chalk.dim("= unchanged")} ${p}`);
    }
    dryLines.push("");
    dryLines.push(
      chalk.dim(
        `Skipped writes: ${HATCH3R_DIR}/hatch.json, learnings/handoffs seeds, mcp.json, ` +
          `.env.mcp, .gitignore entries, provenance, snapshots, checkpoints.`,
      ),
    );
    printBox(
      "Init dry run (no writes)",
      dryRunChanges.length > 0 ? dryLines : [chalk.dim("No adapters configured.")],
      "info",
    );
    printTimingSummary(initStartMs);
    return;
  }

  // Decision 27: capture a pre-mutation snapshot of every file we are about
  // to write. The snapshot module's tombstone mode records "did not exist"
  // for files we will create, so `hatch3r rollback --session=<id>` deletes
  // newly-created files and restores pre-existing files byte-for-byte.
  // Silent Failure Contract: snapshot I/O failures route through warn() and
  // never abort init. The mutation phase remains best-effort revertable but
  // an unwritable `.hatch3r/snapshots/` does not block a fresh install.
  const mutationPaths: string[] = [];
  for (const pa of pendingAdapters) {
    for (const out of pa.outputs) {
      mutationPaths.push(join(rootDir, out.path));
    }
  }
  // release/2.8.5 (BUG-3 secondary — stale-adapter reclamation): adapters the
  // PREVIOUS manifest recorded but this init no longer selects. Their recorded
  // outputs are swept after generation (with consent — see the reclamation
  // block below), so include them in the pre-mutation snapshot: a
  // `hatch3r rollback --session=<id>` then restores the reclaimed files too.
  const staleAdapterEntries: Array<[string, string[]]> = Object.entries(
    existingManifest?.managedFilesByAdapter ?? {},
  ).filter(([adapter, paths]) => !tools.includes(adapter as Tool) && paths.length > 0);
  for (const [, paths] of staleAdapterEntries) {
    for (const rel of paths) mutationPaths.push(join(rootDir, rel));
  }
  // F14.2-H1: include per-package emission targets in the pre-mutation
  // snapshot so `hatch3r rollback --session=<id>` can revert them too. Only
  // when per-package emission is opted in (D14-SA14.2-H1) and the package
  // count is within the cap — matches the write pass below so the snapshot
  // covers exactly the files that get written.
  if (emitPerPackage && manifest.packages && manifest.packages.length > 0 && manifest.packages.length <= PER_PACKAGE_COUNT_CAP) {
    for (const pa of pendingAdapters) {
      // D14-6: planPerPackageOutputs returns [] for non-per-package tools
      // (claude/copilot), so the snapshot path set matches the write pass —
      // only cursor's per-package copies are recorded for rollback.
      const perPackageOutputs = planPerPackageOutputs(pa.tool, manifest.packages, pa.outputs);
      for (const p of perPackageOutputs) {
        mutationPaths.push(join(rootDir, p.output.path));
      }
    }
  }
  if (manifest.worktree?.enabled) {
    mutationPaths.push(join(rootDir, WORKTREE_INCLUDE_FILE));
  }
  mutationPaths.push(join(rootDir, HATCH3R_DIR, "hatch.json"));
  mutationPaths.push(join(rootDir, HATCH3R_DIR, "learnings", "README.md"));
  mutationPaths.push(join(rootDir, HATCH3R_DIR, "handoffs", "README.md"));
  if (features.mcp && mcpServers.length > 0) {
    mutationPaths.push(join(rootDir, HATCH3R_DIR, "mcp", "mcp.json"));
  }
  try {
    await createSnapshot(initSessionId, mutationPaths, { projectRoot: rootDir });
  } catch (err) {
    warn(
      `Pre-mutation snapshot failed for session ${initSessionId}: ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `Continuing init; \`hatch3r rollback --session=${initSessionId}\` will not be available.`,
    );
  }

  // Pass 2: write the adapter outputs we collected in Pass 1.
  for (const pa of pendingAdapters) {
    for (const w of pa.warnings) { warn(w); }
    const toolPaths: string[] = [];
    for (const out of pa.outputs) {
      const writeResult = await safeWriteFile(join(rootDir, out.path), out.content, {
        managedContent: out.managedContent,
        appendIfNoBlock: true,
        force: out.validatedFullDocument,
        backup: out.validatedFullDocument ? false : undefined,
      });
      // S2b (release/2.6.0): init previously discarded the MergeResult, so
      // per-write warnings (marker recovery on a re-init over an existing
      // repo, marker-syntax auto-repair, frontmatter-stub heal) were dropped
      // while sync/update print them — a Silent Failure Contract gap
      // (CONSTITUTION §2 P5). `warn` writes to stderr, matching the
      // sync.ts/update.ts warning channel under `--quiet`.
      if (writeResult.warning) warn(writeResult.warning);
      addManagedFile(manifest, out.path);
      toolPaths.push(out.path);
      // W5-bigfour: `--verbose` per-file written-output detail (stderr;
      // no-op when verbose mode is off).
      verbose(`init: wrote ${out.path} (${pa.tool})`);
    }
    manifest.managedFilesByAdapter[pa.tool] = toolPaths;
  }

  // F14.2-H1 / D14-SA14.2-H1 (D14, P4/P1): OPT-IN per-package emission for
  // monorepo roots. When `--per-package` is set AND `manifest.packages` is
  // non-empty, additionally write each adapter's output into every
  // `<package>/.hatch3r/<rel>` so a developer working inside a package
  // sub-directory has tool context adjacent to the package. The root emission
  // above remains the primary surface; per-package copies are additive.
  //
  // Scale guards (D14-SA14.2-H1 — was unbounded/opt-out-less/serial):
  //   - default OFF: no per-package writes unless `--per-package` is passed.
  //   - count cap: above {@link PER_PACKAGE_COUNT_CAP} packages the copies are
  //     skipped with a warning ( `outputs × packages` would balloon, e.g. 50
  //     packages × 3 adapters ≈ 25k files); the root emission still stands.
  //   - bounded-concurrency batch: writes go through `mapWithConcurrency`
  //     (≤ {@link PER_PACKAGE_WRITE_CONCURRENCY} in flight) instead of a serial
  //     nested `for ... await`.
  //   - `.gitignore` coverage: each package's `.hatch3r/` copy tree is ignored
  //     so `git add .` does not commit the generated duplicates.
  // Per-write failures route through `warn` (Silent Failure Contract — P5) so
  // a permissions issue on one package does not abort the init.
  if (emitPerPackage && manifest.packages && manifest.packages.length > 0) {
    if (manifest.packages.length > PER_PACKAGE_COUNT_CAP) {
      warn(
        `init: --per-package skipped — ${manifest.packages.length} packages exceeds the ${PER_PACKAGE_COUNT_CAP}-package cap ` +
          `(per-package copying writes outputs × packages files). Root adapter output is unaffected; ` +
          `work inside a package using the root setup, or split the monorepo into smaller workspaces.`,
      );
    } else {
      // D14-6: per-package emission is scoped to tools whose load model reads
      // per-directory context files (cursor). claude (ancestor-loads root
      // CLAUDE.md) and copilot (root-only .github/copilot-instructions.md) get
      // no copies — planPerPackageOutputs returns [] for them. Surface the
      // token-cost tradeoff once, naming only the tools that actually emit.
      const perPackageTools = pendingAdapters.filter((pa) => emitsPerPackage(pa.tool)).map((pa) => pa.tool);
      if (perPackageTools.length > 0) {
        warn(
          `init: --per-package writing per-directory copies for ${perPackageTools.join(", ")} ` +
            `across ${manifest.packages.length} package(s). These duplicate the root tool context into each ` +
            `package and add token/context cost when an agent loads several at once; they are .gitignore'd. ` +
            `Re-run without --per-package to keep root-only output (claude/copilot already ancestor- or root-load and get no copies).`,
        );
      }
      const perPackageGitignoreDirs = new Set<string>();
      for (const pa of pendingAdapters) {
        const perPackageOutputs = planPerPackageOutputs(pa.tool, manifest.packages, pa.outputs);
        const existingPaths = new Set<string>(manifest.managedFilesByAdapter[pa.tool] ?? []);
        const written = await mapWithConcurrency(
          perPackageOutputs,
          PER_PACKAGE_WRITE_CONCURRENCY,
          async (p) => {
            try {
              const perPkgResult = await safeWriteFile(join(rootDir, p.output.path), p.output.content, {
                managedContent: p.output.managedContent,
                appendIfNoBlock: true,
                force: p.output.validatedFullDocument,
                backup: p.output.validatedFullDocument ? false : undefined,
              });
              // S2b (release/2.6.0): surface per-package MergeResult warnings
              // exactly like the root-output loop above — previously dropped.
              if (perPkgResult.warning) warn(perPkgResult.warning);
              return p;
            } catch (err) {
              warn(
                `init: per-package emission failed for ${pa.tool} -> ${p.output.path} ` +
                  `(package ${p.packageName}): ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            }
          },
        );
        for (const p of written) {
          if (!p) continue;
          addManagedFile(manifest, p.output.path);
          existingPaths.add(p.output.path);
          // Ignore the exact generated copy path (POSIX-normalized, leading
          // `/` so the match is anchored to the repo root and cannot collide
          // with an identically-named file deeper in the tree). Per-package
          // copies land at the per-package tool's native path under the
          // package (`<pkg>/.cursor/...` — D14-6 scopes emission to cursor), so
          // ignoring the concrete written paths is precise where a single
          // directory glob would be wrong.
          perPackageGitignoreDirs.add(`/${p.output.path.replace(/\\/g, "/")}`);
        }
        manifest.managedFilesByAdapter[pa.tool] = [...existingPaths];
      }
      // D14-SA14.2-H1: ignore every package's generated copy so the
      // per-package duplicates are not committed by a blanket `git add .`.
      if (perPackageGitignoreDirs.size > 0) {
        await appendLocalGitignoreEntries(rootDir, [...perPackageGitignoreDirs].sort());
      }
    }
  }

  s3.succeed(step(3, totalSteps, adapterFailures.length > 0
    ? `Adapter output generated (${adapterFailures.length} failed)`
    : "Adapter output generated"));

  // F16.1-C1: adapter generation/write phase done.
  await recordPhase(INIT_GENERATION_WAVE, "passed");

  // release/2.8.5 (BUG-3 secondary): reclaim stale adapter outputs. Before
  // this, a re-init that switched tools (e.g. claude → cursor) rebuilt the
  // manifest WITHOUT the dropped adapter's `managedFilesByAdapter` entry and
  // never touched its files — `.claude/` + CLAUDE.md stayed on disk forever
  // (update/sync deliberately preserve non-run adapters, so no later command
  // reclaimed them either). Diff the PREVIOUS manifest's recorded adapters
  // against the newly selected tools and orphan-sweep the dropped adapters'
  // recorded paths through `sweepOrphansForAdapter` (same safety filters as
  // the sync/update orphan sweep: adapter-root containment, hatch3r-basename,
  // user-wrapped veto). Consent semantics:
  //   - interactive TTY → explicit confirm (default Yes), listing the files;
  //   - `--yes` → the flag IS the consent (proceed, then report);
  //   - non-interactive without `--yes` → never delete silently: skip + warn.
  // The reclaimed paths were added to the pre-mutation snapshot above, so
  // `hatch3r rollback --session=<id>` restores them.
  if (staleAdapterEntries.length > 0) {
    const emittedThisRun = new Set<string>();
    for (const pa of pendingAdapters) {
      for (const rel of manifest.managedFilesByAdapter[pa.tool] ?? []) emittedThisRun.add(rel);
    }
    let proceedWithReclaim: boolean;
    if (options.yes === true) {
      proceedWithReclaim = true;
    } else if (process.stdin.isTTY) {
      if (!isQuiet()) {
        console.log();
        console.log(chalk.yellow("Stale adapter output detected (tools no longer selected):"));
        for (const [adapter, paths] of staleAdapterEntries) {
          console.log(`  ${chalk.red("-")} ${TOOL_DISPLAY_NAMES[adapter as Tool] ?? adapter}: ${paths.length} recorded file(s)`);
          for (const p of paths.slice(0, 10)) console.log(`      ${chalk.dim(p)}`);
          if (paths.length > 10) console.log(`      ${chalk.dim(`… and ${paths.length - 10} more`)}`);
        }
        console.log();
      }
      const { confirmReclaim } = await inquirer.prompt<{ confirmReclaim: boolean }>([
        {
          type: "confirm",
          name: "confirmReclaim",
          message: `Remove these files from the deselected tool(s)? (revert later: hatch3r rollback --session=${initSessionId})`,
          default: true,
        },
      ]);
      proceedWithReclaim = confirmReclaim === true;
    } else {
      proceedWithReclaim = false;
      warn(
        `init: ${staleAdapterEntries.length} deselected adapter(s) left recorded output on disk ` +
          `(${staleAdapterEntries.map(([a]) => a).join(", ")}). Skipping removal — non-interactive run without --yes. ` +
          `Re-run \`hatch3r init --yes\` (or interactively) to reclaim them.`,
      );
    }
    if (proceedWithReclaim) {
      const reclaimEntries = [];
      for (const [adapter, paths] of staleAdapterEntries) {
        // trustedExactPaths: these exact paths are manifest-recorded outputs
        // of the deselected adapter, swept under explicit consent — so
        // non-`hatch3r-*` managed artifacts (CLAUDE.md) are reclaimable; the
        // containment + user-wrapped safety filters still apply.
        reclaimEntries.push(
          ...(await sweepOrphansForAdapter(adapter, rootDir, paths, emittedThisRun, undefined, {
            trustedExactPaths: new Set(paths.map((p) => p.replace(/\\/g, "/"))),
          })),
        );
      }
      const reclaimDiag = formatOrphanCleanupDiagnostic(reclaimEntries);
      if (reclaimDiag) warn(reclaimDiag);
      const removedCount = reclaimEntries.filter((e) => e.removed).length;
      if (removedCount > 0 && !isQuiet()) {
        info(`Reclaimed ${removedCount} stale adapter file(s) from deselected tool(s).`);
      }
    } else if (options.yes !== true && process.stdin.isTTY) {
      info(chalk.dim("Stale adapter files kept. Remove them later by re-running `hatch3r init` or with `hatch3r clean`."));
    }
  }

  // D1-SA1.1-04 (D1, P2): mark entry to the finalize phase (worktree include +
  // manifest + provenance + seeds + mcp + env + .gitignore). Without this
  // marker a crash anywhere in finalize would leave the wave-1 `passed`
  // checkpoint on disk, indistinguishable from a completed run to a naive
  // reader; recording FINALIZE/in-progress here makes a finalize-window crash
  // observable (the `--resume` reader treats a non-`passed` checkpoint as an
  // interrupted run and re-executes). Overwritten by the FINALIZE/passed write
  // below once finalize completes.
  await recordPhase(INIT_FINALIZE_WAVE, "in-progress");

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
  // Wave 6: ensure `.hatch3r/` exists for the manifest write — it is now the
  // only on-disk hatch3r directory the user sees.
  await mkdir(join(rootDir, HATCH3R_DIR), { recursive: true });
  await writeManifest(rootDir, manifest);

  // D12-4 (Cycle 11 Wave 2, D12, P2): write `.hatch3r/provenance.json` at init
  // via the shared `writeProvenance` helper so `hatch3r explain --source all`
  // resolves immediately after a fresh `init` (previously it reported "No
  // provenance manifest found … Run `hatch3r sync`" because only `sync` wrote
  // it). `pendingAdapters` holds exactly the adapters whose generation
  // succeeded (failures were diverted to `adapterFailures` above and the
  // all-failed case already threw), so each entry's outputs carry the
  // `sourceFiles[]` populated by `BaseAdapter.generate()`. `lastCommand:
  // "init"` attributes the manifest to the originating run; a write failure is
  // surfaced via `warn()` and never aborts init (Silent Failure Contract, P5).
  const initProvenanceOutputs: PerAdapterOutputs[] = pendingAdapters.map((pa) => ({
    adapter: pa.tool,
    outputs: pa.outputs,
  }));
  await writeProvenance(rootDir, initProvenanceOutputs, "init", {
    failedAdapters: tools.filter((t) => !pendingAdapters.some((pa) => pa.tool === t)),
    onWarn: warn,
  });

  // Wave 6: seed `.hatch3r/learnings/` and `.hatch3r/handoffs/` with README
  // primers (relocated from W3-removed `.agents/` seeding). Idempotent —
  // README is only written when absent so user-authored content is never
  // overwritten on re-init.
  const hatch3rDir = join(rootDir, HATCH3R_DIR);
  await mkdir(join(hatch3rDir, "learnings"), { recursive: true });
  const learningsReadmePath = join(hatch3rDir, "learnings", "README.md");
  try {
    await access(learningsReadmePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await safeWriteFile(learningsReadmePath, LEARNINGS_README_SEED);
    } else {
      throw err;
    }
  }
  await mkdir(join(hatch3rDir, "handoffs", "active"), { recursive: true });
  await mkdir(join(hatch3rDir, "handoffs", "archived"), { recursive: true });
  const handoffsReadmePath = join(hatch3rDir, "handoffs", "README.md");
  try {
    await access(handoffsReadmePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await safeWriteFile(handoffsReadmePath, HANDOFFS_README_SEED);
    } else {
      throw err;
    }
  }

  // Wave 6: emit `.hatch3r/mcp/mcp.json` filtered to the user's selected
  // servers. Reads the unfiltered template from the bundled-content root
  // (`<pkg>/mcp/mcp.json`), copies it to the user repo, then runs the
  // existing in-place filter. Skipped when MCP is disabled or no servers
  // selected — keeps the directory absent rather than emitting an empty
  // file.
  if (features.mcp && mcpServers.length > 0) {
    const bundledMcpPath = join(resolveBundledContentRoot(), "mcp", "mcp.json");
    const targetMcpPath = join(hatch3rDir, "mcp", "mcp.json");
    try {
      const raw = await readFile(bundledMcpPath, "utf-8");
      await mkdir(join(hatch3rDir, "mcp"), { recursive: true });
      await safeWriteFile(targetMcpPath, raw);
      await filterMcpJsonOnDisk(targetMcpPath, new Set(mcpServers));
    } catch (err) {
      // Missing bundled MCP template is non-fatal — log and continue so init
      // still completes. The user can re-run init or sync once the package
      // payload is restored.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        warn(
          `Bundled MCP template not found at ${bundledMcpPath}; ` +
            `${HATCH3R_DIR}/mcp/mcp.json not written.`,
        );
      } else {
        throw err;
      }
    }
  }

  // Wave 3: integrity manifest writes removed (per blueprint v2 decision #8).
  // Wave 7 will reintroduce the integrity model against the bundled content
  // root, not against `.agents/`.

  let envResult: { action: string; path: string; newVars: string[] } | undefined;
  if (features.mcp && mcpServers.length > 0) {
    envResult = await ensureEnvMcp(rootDir, mcpServers);
  }
  // D1-SA1.1-H1 (D1, P1/P6): register the required `.gitignore` entries
  // unconditionally — decoupled from the `.env.mcp` step above. Every init
  // writes operational state that must not be committed: `.hatch3r/snapshots/`
  // (pre-mutation rollback snapshots, written on every run) and the init
  // checkpoint workspace, plus `.hatch3r/handoffs/` seeds. Gating this behind
  // `features.mcp && mcpServers.length > 0` (the prior placement) left a
  // default `hatch3r init --yes` (MCP off by default) with `.hatch3r/snapshots/`
  // staged on the next `git add .`. `ensureGitignoreEntry` is idempotent
  // (per-entry coverage scan) so an MCP run that already needs `.env.mcp`
  // ignored is unaffected.
  await ensureGitignoreEntry(rootDir);

  s4.succeed(step(4, totalSteps, "Done"));

  // F16.1-C1: finalize phase (manifest + learnings/handoffs seeds + mcp +
  // env) committed. Record FINALIZE passed — the resumable "done" marker for
  // init. A subsequent `init --resume` reads this (FINALIZE + passed +
  // on-disk manifest) and reports completion.
  await recordPhase(INIT_FINALIZE_WAVE, "passed");

  // D10-17 (D10, P1): record the primary SPACE metric `firstRunSuccessRate` at
  // the success terminus. Reaching this line means `runInitInner` completed
  // without throwing AND at least one adapter wrote a first output — a total
  // adapter failure throws the `ADAPTER_ERROR` HatchError above, before this
  // point, so this is unambiguously a success (value=1) recording site. A
  // PARTIAL adapter failure still reached a first adapter output, so it counts
  // as success and is tagged so the post-run aggregator can segment it. Persists
  // a JSONL line under `.hatch3r/telemetry/space-<date>.jsonl` (gitignored via
  // `.hatch3r/`); `hatch3r status` reads it back. recordFirstRunSuccess honours
  // the Silent Failure Contract (never throws) so telemetry can never break the
  // install. This is the canonical first-run-success measurement called out in
  // CONSTITUTION §6 P1 Measurement + §6 CQ2 Measurement.
  recordFirstRunSuccess(true, {
    source: "hatch3r-init",
    projectRoot: rootDir,
    tags: {
      partialAdapterFailure: String(adapterFailures.length > 0),
      tools: tools.join("+"),
      preset: contentSelection.preset,
    },
  });

  // D10-SA10.8-01 (D10, P5): wire the two feasible SPACE axes the CONSTITUTION
  // §2 P1 line names but that had no feeder — raising the realized surface from
  // 1/5 (performance only) to 3/5. `efficiency`: time-to-first-value, computed
  // from `initStartMs` and otherwise only console.log'd by printTimingSummary
  // and discarded. `activity`: the count of adapters that generated output this
  // run. Both reuse recordFirstRunSuccess's JSONL sink + Silent Failure Contract
  // (never throws); `status` surfaces them via its per-axis rollup. Unreachable
  // under dry-run (that terminus returns before this line), so no extra gate.
  recordSpaceMetric(
    {
      metricId: "timeToFirstValueMs",
      axis: "efficiency",
      value: Date.now() - initStartMs,
      source: "hatch3r-init",
      tags: { outcome: "success", tools: tools.join("+") },
    },
    rootDir,
  );
  recordSpaceMetric(
    {
      metricId: "adaptersGenerated",
      axis: "activity",
      value: tools.length - adapterFailures.length,
      source: "hatch3r-init",
      tags: { tools: tools.join("+") },
    },
    rootDir,
  );

  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // C9-H26 (D10-SA10.2-F1): `--json` emits one machine-readable line on
  // stdout and skips the decorated success box, multi-CTA hint, and
  // CLI-tooling disclaimer. `--quiet` (without `--json`) skips the box but
  // still calls printBox (which is a no-op when isQuiet()). The summary
  // payload is a stable JSON schema for CI consumers.
  if (isJson()) {
    const isGreenfieldForJson = isGreenfield(repoInfo);
    // D10-SA10.6-F10.6-9: surface a non-fatal degraded state in the machine
    // payload so a `--yes`/CI caller can grep `status` instead of only the
    // human stderr `warn()` stream. Orchestration-dependency warnings (a
    // required agent missing from the selection) and partial adapter failures
    // both escalate `status` from "ok" to "warning"; the install still
    // completed (a total adapter failure throws earlier), so "warning" — not a
    // non-zero exit — is the correct signal. `validateOrchestrationDependencies`
    // is re-run here (cheap, pure) so every entry path (single-repo, workspace,
    // interactive) reflects the same gate without threading the warnings in.
    const jsonOrchWarnings = validateOrchestrationDependencies(contentSelection);
    const jsonStatus: "ok" | "warning" =
      jsonOrchWarnings.length > 0 || adapterFailures.length > 0 ? "warning" : "ok";
    const payload = {
      status: jsonStatus,
      orchestrationWarnings: jsonOrchWarnings,
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
      // release/2.8.6 (D10-37 extension): the ids the solo team-size filter
      // excluded (solo+full disclosure data) — machine-readable so a `--yes
      // --format json` caller sees the filtered set without parsing human
      // chrome (which json mode suppresses via quiet). Empty when nothing was
      // filtered or the selection is team-sized.
      teamOnlyFilteredItems: teamOnlyFiltered ?? [],
      worktreeEnabled: !!manifest.worktree?.enabled,
      isGreenfield: isGreenfieldForJson,
      adapterFailures: adapterFailures.map((f) => ({ tool: f.tool, error: f.error })),
      // Wave 6: the on-disk hatch3r footprint is now `.hatch3r/`. Adapters
      // source canonical content from the bundled package (Wave 3), so the
      // legacy `canonicalDir` field surfaces the new state directory instead
      // of a non-existent `.agents/`.
      canonicalDir: HATCH3R_DIR,
      manifestPath: `${HATCH3R_DIR}/hatch.json`,
      snapshotSessionId: sessionId,
    };
    // W5-bigfour (P1): single-document JSON contract — emit via the shared
    // emitJson funnel (process.stdout.write + one trailing newline) so the
    // payload shape and serialization match every other `--format json`
    // command. Field names are unchanged.
    emitJson(payload);
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
  // D14-17 (D14-SA14.3-F4, P1): surface the resolved maturity tier so it is no
  // longer an invisible setting. `maturity` is seeded from the inferred team
  // size when no `--maturity` flag is passed (see runInitInteractive); printing
  // it here makes the investment-calibration dial discoverable from the success
  // box and names the change command (`maturity` is a config scalar key —
  // SCALAR_CONFIG_KEYS in `config`).
  const resolvedMaturity = manifest.maturity ?? maturity ?? DEFAULT_MATURITY_TIER;
  summaryLines.push(label("Maturity", `${resolvedMaturity} (change with: hatch3r config maturity=<tier>)`));
  // D10-37 (D14-SA14.3-F, P1): when teamSize=solo + preset=full, the prior
  // disclosure was inverted. It claimed "full preset includes team-only
  // workflows even on solo", but `resolveSelection` Stage 4
  // (`src/content/index.ts` team-size filter) strips every NON-floor
  // `ctx:team-only` item for solo, and init never passes `skipContextFilters`.
  // So a solo+full install does NOT carry the team-only workflows (only the
  // floor-tagged ones bypass the filter), and the suggested "switch to standard"
  // was a no-op for that concern. State the actual contract — team-scoped
  // workflows are EXCLUDED for solo even under full — and name the lever that
  // includes them (`--team-size team` re-runs resolution with the team filter).
  if (
    contentSelection.teamSize === "solo" &&
    contentSelection.preset === "full"
  ) {
    // release/2.8.6 (D10-37 extension): enumerate the ACTUAL filtered ids
    // (grouped by class, computed at the selection site via
    // computeTeamOnlyFilteredItems — never hard-coded) and name BOTH levers:
    // the init flag and the new config team-size setting. Falls back to the
    // generic one-liner when the caller did not thread the list.
    const filteredCount = teamOnlyFiltered?.length ?? 0;
    summaryLines.push(
      chalk.dim(
        `  Note: ${filteredCount > 0 ? `${filteredCount} ` : ""}team-scoped workflows (ctx:team-only) are excluded for solo even under full; ` +
          `floor-tagged items still ship.`,
      ),
    );
    if (teamOnlyFiltered && teamOnlyFiltered.length > 0) {
      for (const line of formatTeamOnlyFilteredByClass(teamOnlyFiltered)) {
        summaryLines.push(chalk.dim(`    ${line}`));
      }
    }
    summaryLines.push(
      chalk.dim(
        `  Include them with 'hatch3r init --team-size team' or later 'hatch3r config team_size=team'.`,
      ),
    );
  }
  if (owner || repo) {
    const platformLabel = PLATFORM_DISPLAY_NAMES[platform];
    summaryLines.push(label(platformLabel, `${namespace || owner}/${project || repo}`));
  }
  if (defaultBranch) {
    summaryLines.push(label("Default branch", defaultBranch));
  }
  if (mcpServers.length > 0) {
    summaryLines.push(label("MCP", mcpServers.join(", ")));
  } else {
    // W3-mcp-optin: name the opt-in lever on the no-MCP path so a user who
    // skipped MCP (now the default — interactive init no longer prompts)
    // learns the side-door without digging through docs.
    summaryLines.push(
      `${chalk.dim("·")} ${chalk.dim("MCP servers: none configured — add anytime with npx hatch3r mcp setup")}`,
    );
  }
  if (manifest.worktree?.enabled) {
    summaryLines.push(label("Worktree", "isolation enabled"));
    summaryLines.push(`  ${chalk.dim("Disable with: hatch3r config set worktree.enabled false")}`);
  }
  if (envResult && envResult.action !== "skipped") {
    summaryLines.push(label("Secrets", `.env.mcp (fill in your API keys)`));
  }
  summaryLines.push("");
  summaryLines.push(label("State dir", `${HATCH3R_DIR}/`));
  summaryLines.push(label("Manifest", `${HATCH3R_DIR}/hatch.json`));
  if (sessionId) {
    summaryLines.push(label("Snapshot", `${sessionId} (revert with: hatch3r rollback --session=${sessionId})`));
  }

  // F10.3-1 (Decision 23 / 2.0.0): post-init primary CTA points at the
  // unified `hatch3r-spec` orchestrator (`commands/hatch3r-spec.md`) which
  // routes greenfield to `hatch3r-greenfield-spec` and brownfield to
  // `hatch3r-brownfield-spec` automatically. Legacy `project-spec` and
  // `codebase-map` paths render as a dimmed alternate with a "Legacy
  // split-flow" qualifier so callers using `formatCommandHint`-based
  // scripts keep working while new users discover the 2.0.0 entry point.
  //
  // The original C9-H29 multi-CTA contract is preserved — greenfield and
  // brownfield both still surface roadmap / feature-plan / quick-change /
  // project-spec / codebase-map. D10-SA10.3-01: every CTA id passed to
  // `formatCommandHint` is the `hatch3r-`-prefixed command id (e.g.
  // `hatch3r-roadmap`), matching the slash name the adapters emit
  // (`toPrefixedId(cmd.id)` → `/hatch3r-roadmap`); the init.test.ts guards pin
  // the prefixed `/hatch3r-<name>` form so a bare-name regression fails the build.
  // D10-M20 (Cycle 10 rollover): the lite path (no board) was previously
  // rendered as a single dimmed bullet under the primary CTA, so a user who
  // wanted feature-only work missed it on first scan. The board-less route is
  // now surfaced as a cyan secondary heading with its own arrow marker, and
  // names the no-board promise inline so the user does not have to drill into
  // `feature-plan` docs to learn the lite path skips Steps 5-7 of this guide.
  // Codex command CTAs must name a command skill that this exact selection
  // emitted. Its command bridge has no repository slash-command fallback, so
  // use the resolved content profile when Codex is selected. Retain the
  // existing repository-analysis wording for slash-command-only adapters.
  const repoIsGreenfield = tools.includes("codex")
    ? contentSelection.projectType === "greenfield"
    : isGreenfield(repoInfo);
  summaryLines.push("");
  // D10-SA10.3-F-10: when some (but not all — all-failed throws above) adapters
  // failed, the install is partial. Prepend a verification CTA above the agent
  // CTA so the user confirms the generated setup before invoking an agent
  // against a half-written configuration. The box is also re-styled as a
  // warning below so the partial state is visually distinct from a clean run.
  const initHadAdapterFailures = adapterFailures.length > 0;
  if (initHadAdapterFailures) {
    summaryLines.push(`${chalk.yellow("→")} ${chalk.bold(`Verify with: npx hatch3r validate`)} (${adapterFailures.length} adapter(s) failed — output may be incomplete)`);
  }
  if (repoIsGreenfield) {
    // D10-27 (D10, P1): `hatch3r-spec.md` opens with an MVP-vs-vision ASK gate
    // (commands/hatch3r-spec.md "MVP vs full vision") that presumes the user can
    // describe a product. Name that up front so a greenfield user is not
    // surprised by the prompt and arrives with the scope decision ready.
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "hatch3r-spec"))} to define your new project (routes greenfield/brownfield automatically; you'll be asked to describe your product idea and MVP scope), then ${chalk.bold(formatCommandHint(tools, "hatch3r-roadmap"))}`);
    summaryLines.push(`${chalk.cyan("→")} Lite path (no board): ${chalk.bold(formatCommandHint(tools, "hatch3r-feature-plan"))} for one feature, ${chalk.bold(formatCommandHint(tools, "hatch3r-quick-change"))} for a tiny change`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Legacy split-flow: ")}${chalk.bold(formatCommandHint(tools, "hatch3r-project-spec"))}`);
  } else {
    // D10-SA10.3-05 (D10, P1): the brownfield branch fires whenever ANY language
    // indicator is present — a bare `tsconfig.json` from `npm create vite` /
    // `create-next-app` / `tsc --init` is enough (repoAnalyzer.ts
    // LANGUAGE_INDICATORS), so a freshly scaffolded, not-yet-specified project
    // lands here and "map your existing codebase" is the wrong frame for it.
    // `hatch3r-spec` re-detects state internally, so the lowest-cost fix names
    // the fresh-scaffold case in the CTA rather than broadening the classifier
    // (which also feeds the post-init JSON payload and content selection).
    summaryLines.push(`${chalk.cyan("→")} Run ${chalk.bold(formatCommandHint(tools, "hatch3r-spec"))} to map your existing code — or define a new product if this is a fresh scaffold (routes greenfield/brownfield automatically)`);
    summaryLines.push(`${chalk.cyan("→")} Lite path (no board): ${chalk.bold(formatCommandHint(tools, "hatch3r-feature-plan"))} for one feature, ${chalk.bold(formatCommandHint(tools, "hatch3r-quick-change"))} for a tiny change`);
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Legacy split-flow: ")}${chalk.bold(formatCommandHint(tools, "hatch3r-codebase-map"))}`);
  }
  // D10-25 (D10, P1): the CTAs above print `/`-prefixed invocations, but not
  // every named workflow is a slash command. Some (e.g. board-init) ship as
  // skills. Name each selected tool's real activation surface; Codex requires
  // the documented `$skill-name` syntax and does not accept a generic `Skill:`
  // prefix.
  summaryLines.push(`${chalk.dim("·")} ${chalk.dim(skillInvocationGuidance(tools))}`);
  // D10-SA10.3-F-10: on the clean path, offer the verification command as a
  // dimmed alternate so users who want to confirm the install have a named
  // command without cluttering the primary CTA. Skipped when failures already
  // surfaced the verify CTA prominently above.
  if (!initHadAdapterFailures) {
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Verify install: npx hatch3r validate")}`);
  }

  // D14-SA14.4-F7 (Pillar P1): surface the customization layer to first-time
  // users. Shown only when no `.hatch3r/{type}/*.customize.yaml` exists yet, so
  // users who already customize do not see redundant chrome. Dim bullet keeps
  // it below the primary CTA (progressive disclosure).
  if (!(await hasCustomizeFiles(rootDir))) {
    summaryLines.push(`${chalk.dim("·")} ${chalk.dim("Customize: drop a .hatch3r/{agents,skills,rules,commands}/<id>.customize.yaml to tweak generated artifacts")}`);
  }

  // D14-15 (D14-SA14.1-F4, Pillar P1): when a detected stack has no dedicated
  // `rules/hatch3r-*-patterns.md` rule, surface a one-line pointer so the user
  // learns the support status (cross-cutting rules apply; no stack-idiom rule)
  // and where the full per-stack matrix lives. Full-tier stacks (a dedicated
  // rule exists) report nothing — `classifyDetectedStacks` filters them.
  const unsupportedStacks = classifyDetectedStacks(repoInfo.frameworks, repoInfo.languages);
  if (unsupportedStacks.length > 0) {
    const names = unsupportedStacks.map((s) => s.name).join(", ");
    summaryLines.push(
      `${chalk.dim("·")} ${chalk.dim(`Stack support: ${names} — covered by cross-cutting rules; no dedicated stack rule. See docs/stack-support-matrix.md`)}`,
    );
  }

  if (envResult && envResult.newVars.length > 0) {
    summaryLines.push("");
    summaryLines.push(`${chalk.yellow("!")} Add your secrets to ${chalk.bold(".env.mcp")}: ${envResult.newVars.join(", ")}`);
    // D10-SA10.5-H1 (D10, P1): tailor the secret-loading guidance to the
    // selected tools instead of unconditionally printing the shell-source
    // command. Tools split into two MCP-secret-loading classes (semantics
    // documented on `TOOL_SECRET_NOTES`):
    //   - shell-source (claude, cursor, codex): needs
    //     `set -a && source .env.mcp && set +a` in the launching shell.
    //   - auto-load (copilot): reads `.env.mcp` for STDIO servers; a macOS
    //     Dock/Finder/Spotlight launch still needs `launchctl setenv` per var.
    // Showing the source command for an auto-load-only tool selection was the
    // wrong remedy (and, for a Dock launch, actively misleading); showing the
    // per-tool note on `--yes` closes the gap where the headless path emitted
    // none (the interactive path surfaces them at tool-selection time).
    const shellSourceTools = tools.filter((t) => MCP_SHELL_SOURCE_TOOLS.has(t));
    const autoLoadTools = tools.filter((t) => MCP_AUTO_LOAD_TOOLS.has(t));
    if (shellSourceTools.length > 0) {
      // D10-23 (D10, P1 — WCAG 1.4.3 AA): the source command is an action the
      // user must type, so render the imperative verb + command token at normal
      // weight (`chalk.bold`, parity with the "Verify with:" CTA above) instead
      // of `chalk.dim` (SGR 2 drops below the 4.5:1 AA contrast floor on light
      // themes). Only the parenthetical tool-scope annotation stays dim.
      summaryLines.push(`  Then run: ${chalk.bold(getSourceEnvMcpCommand())} ${chalk.dim(`(for ${shellSourceTools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")})`)}`);
    }
    if (autoLoadTools.length > 0) {
      summaryLines.push(`  ${chalk.dim(`${autoLoadTools.map((t) => TOOL_DISPLAY_NAMES[t] ?? t).join(", ")} auto-load .env.mcp on a terminal launch; for a macOS Dock/Finder launch run \`launchctl setenv <VAR> <value>\` per secret.`)}`);
    }
  }
  // D10-24 (D10, P1): fold the per-tool secret-loading note (TOOL_SECRET_NOTES)
  // into the DURABLE success box whenever MCP is active — not only when there
  // are NEW secrets to fill. The prior placement gated this note behind
  // `envResult.newVars.length > 0`, so a re-init (or any run where `.env.mcp`
  // already holds the keys) showed the per-tool divergence ONLY as transient
  // `info()` chrome at tool-selection time, which scrolls away before the box.
  // Anchoring it to `features.mcp && mcpServers.length > 0` keeps the precise
  // per-tool loading instruction visible in the box the user actually re-reads.
  if (features.mcp && mcpServers.length > 0) {
    // Per-tool secret-loading note (TOOL_SECRET_NOTES) — emitted on every path
    // (incl. --yes) so the headless install documents the divergence too.
    const boxSecretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
    for (const note of boxSecretNotes) {
      summaryLines.push(`  ${chalk.dim(note)}`);
    }
    // D10-SA10.2-H1 (D10, P1): MCP server configs are read at editor launch, so
    // a user who follows only the success box hits the primary CTA against an
    // editor that has not loaded the new MCP servers. Surface the mandatory
    // editor-restart step (quick-start.md makes it required) on both the
    // interactive and `--yes --mcp` paths whenever MCP servers were configured.
    summaryLines.push(`  ${chalk.yellow("→")} Restart your editor so the new MCP servers load (configs are read at launch).`);
  }

  // D10-SA10.3-F-10: partial-failure installs render a warning-styled box with
  // an explicit "complete with N failure(s)" title so the degraded state is
  // not disguised as a clean "Hatch complete". The clean path keeps the
  // success box + title (preserves the `toContain("Hatch complete")` test
  // contract for non-failure runs).
  if (initHadAdapterFailures) {
    printBox(`Hatch complete with ${adapterFailures.length} adapter failure(s)`, summaryLines, "warning");
  } else {
    printBox("Hatch complete", summaryLines, "success");
  }

  // W5-bigfour (P1): post-box next-steps ladder (no-op under quiet/json).
  // The in-box CTA ladder above already names every command (hatch3r-spec /
  // feature-plan / quick-change / validate), so the single complementary
  // step here is the one action the box cannot perform for the user:
  // switching to the editor where those commands run.
  printNextSteps([
    "Open your editor and run the suggested command above to start your first task.",
  ]);

  if (cliTools && cliTools.selected.length > 0 && !isQuiet()) {
    const finalMissing = await findMissingCliTools(cliTools.selected);
    printMissingCliToolsDisclaimer(finalMissing, cliTools.selected.length);
  }

  if (!isQuiet()) {
    info(`Tip: Run ${formatCommandHint(tools, "hatch3r-create")} anytime to author your own agents, skills, rules, commands, or hooks.`);
  }

  // D10-M9 (Cycle 10): emit total time-to-first-value after the success box
  // and any post-completion advisories so the user sees the elapsed wall
  // clock for the whole init run. `printTimingSummary` is already a no-op
  // under `setQuiet(true)`, so JSON/CI paths skip it automatically.
  printTimingSummary(initStartMs);
}

async function checkExisting(rootDir: string, skipPrompt: boolean, newSelection?: ContentSelection, dryRun?: boolean): Promise<void> {
  // Wave 6: migration shim relocates a legacy `.agents/hatch.json` to
  // `.hatch3r/hatch.json` on first read; checkExisting probes the new
  // location only. W5-bigfour: the relocation moves files, so `--dry-run`
  // skips it (zero-writes promise).
  if (dryRun !== true) {
    await migrateAgentsToHatch3r(rootDir);
  }
  const hatchJsonPath = join(rootDir, HATCH3R_DIR, "hatch.json");
  try {
    await access(hatchJsonPath);
    if (!skipPrompt) {
      let message = `Existing ${HATCH3R_DIR}/ found. This will overwrite managed files. Continue?`;

      // F10.6-5: compute BOTH addCount and removeCount so a user upgrading
      // Minimal → Standard (net +45 items, 0 removed) no longer sees a
      // misleading "0 items will be removed" prompt. Structured message
      // surfaces additions and removals with explicit +/− directions.
      if (newSelection) {
        const existingManifest = await readManifest(rootDir);
        if (existingManifest?.content) {
          const oldIds = getAllContentIds(existingManifest.content);
          const newIds = getAllContentIds(newSelection);
          let removeCount = 0;
          let addCount = 0;
          for (const id of oldIds) {
            if (!newIds.has(id)) removeCount++;
          }
          for (const id of newIds) {
            if (!oldIds.has(id)) addCount++;
          }
          if (addCount > 0 || removeCount > 0) {
            const oldPreset = existingManifest.content.preset.charAt(0).toUpperCase() + existingManifest.content.preset.slice(1);
            const newPreset = newSelection.preset.charAt(0).toUpperCase() + newSelection.preset.slice(1);
            const directionParts: string[] = [];
            if (addCount > 0) directionParts.push(`+${addCount} added`);
            if (removeCount > 0) directionParts.push(`−${removeCount} removed`);
            const directionLabel = directionParts.join(", ");
            if (oldPreset !== newPreset) {
              message = `Existing ${HATCH3R_DIR}/ found. Switching ${oldPreset} → ${newPreset} (${directionLabel}). Continue?`;
            } else {
              message = `Existing ${HATCH3R_DIR}/ found. ${directionLabel} for ${newPreset} profile. Continue?`;
            }
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
      undefined,
      "VALIDATION_ERROR",
      `Re-run with one of: ${valid.join(", ")}.`,
    );
  }
  return value as T;
}

/**
 * Validate a `--preset` arg (a single id OR a comma-list to compose) against
 * {@link KNOWN_PRESET_IDS}, returning the raw arg verbatim for downstream
 * {@link resolvePresetArg} resolution. `undefined` collapses to "standard".
 *
 * Membership reads from {@link KNOWN_PRESET_IDS} (derived from `PRESETS`) so
 * the allow-list cannot drift from the registry as new archetypes land. A
 * comma-list validates EACH part; `custom` is rejected in a multi-part arg
 * (custom is user-driven per-item selection, not a composable subset — it
 * survives only as a lone `--preset=custom`). Unknown parts abort with exit 1
 * before any side effect, per CLI Guidelines fail-fast validation.
 */
function validatePresetArg(value: string | undefined): string {
  if (!value) return "standard";
  const known = KNOWN_PRESET_IDS as readonly string[];
  const parts = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    logError(`Empty --preset: "${value}".`);
    throw new HatchError(
      `Empty --preset: "${value}"`,
      undefined,
      "VALIDATION_ERROR",
      `Re-run with one of: ${known.join(", ")} — or a comma-list to compose (e.g. 'api-service,security').`,
    );
  }
  const multi = parts.length > 1;
  for (const part of parts) {
    const unknown = !known.includes(part);
    // `custom` is a valid lone preset but never composable.
    const customInList = multi && part === "custom";
    if (unknown || customInList) {
      const composable = known.filter((id) => id !== "custom");
      logError(`Invalid --preset part: "${part}". Valid: ${known.join(", ")}`);
      throw new HatchError(
        `Invalid --preset: "${value}"`,
        undefined,
        "VALIDATION_ERROR",
        customInList
          ? `\`custom\` cannot be composed — use it alone (\`--preset=custom\`) for interactive per-item selection. Composable ids: ${composable.join(", ")}.`
          : `Re-run with one of: ${known.join(", ")} — or a comma-list of those (excluding \`custom\`) to compose, e.g. 'api-service,security'.`,
      );
    }
  }
  return value;
}

/**
 * F1.1-H2 (B1 ambiguity-detection gate per CONSTITUTION §2 P8 B1).
 *
 * Resolves three flag-combination ambiguities at the entry point of
 * `initCommand` so the user is not surprised by a late-stage rejection.
 * Implements the multiple-choice shape from
 * `agents/shared/user-question-protocol.md` — at most one question per
 * turn, 2-4 numbered options, each with a trade-off, an explicit
 * default-if-no-response.
 *
 * Under `--yes` we cannot prompt — incompatible flag combinations abort
 * with `HatchError` + a recovery hint. Under interactive mode we ask via
 * `inquirer.prompt` and let the user pick.
 *
 * Checks performed:
 *   1. `--yes --preset=custom` — `custom` requires per-item selection
 *      which has no headless analog.
 *   2. `--workspace=true` on a repo whose root already has a `.git/`
 *      directory — workspace mode expects a workspace root with
 *      sub-repos, not a repo root with a workspace flag.
 *   3. `--workspace=false` but ≥2 git sub-repos detected — the user
 *      likely meant to opt into workspace mode.
 */
async function detectAmbiguity(opts: {
  yes?: boolean;
  preset?: string;
  workspace?: boolean;
}): Promise<void> {
  // Check 1: `--yes --preset=custom`.
  if (opts.yes && opts.preset === "custom") {
    throw new HatchError(
      "Ambiguous flags: --yes is incompatible with --preset=custom (custom requires interactive per-item selection).",
      undefined,
      "VALIDATION_ERROR",
      "Re-run with one of: (a) drop `--yes` to pick items interactively; (b) replace `--preset=custom` with a headless preset — `minimal|standard|full|web-app|api-service|cli-tool|monorepo|legacy|security`, or a comma-list to compose (e.g. `--preset=api-service,security`).",
    );
  }

  const cwd = process.cwd();

  // Check 2: `--workspace=true` on a repo with `.git/` already present.
  if (opts.workspace === true) {
    try {
      await access(join(cwd, ".git"));
      if (opts.yes) {
        throw new HatchError(
          "Ambiguous flags: --workspace=true on a repo with `.git/` already present (workspace mode expects a workspace root, not a single-repo root).",
          undefined,
          "VALIDATION_ERROR",
          "Re-run with one of: (a) drop `--workspace` for a single-repo init; (b) run from the workspace root (one directory up).",
        );
      }
      const { workspaceChoice } = await inquirer.prompt<{ workspaceChoice: "single" | "workspace" }>([
        {
          type: "select",
          name: "workspaceChoice",
          message:
            "This directory already has its own .git/ — workspace mode usually targets a workspace root with multiple sub-repos. Continue?",
          choices: [
            { name: "Single-repo init (drop --workspace)", value: "single" },
            { name: "Workspace init anyway (treat this repo as a single-member workspace)", value: "workspace" },
          ],
          default: "single",
        },
      ]);
      if (workspaceChoice === "single") {
        opts.workspace = false;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        if (err instanceof HatchError) throw err;
        throw err;
      }
    }
  }

  // Check 3: `--workspace=false` but ≥2 git sub-repos detected.
  if (opts.workspace === false) {
    const detected = await detectSubRepos(cwd);
    if (detected.length >= 2) {
      if (opts.yes) {
        warn(
          `--workspace=false on a directory with ${detected.length} git sub-repos detected. ` +
          `Continuing as a single-repo init; sub-repos will not be configured. ` +
          `Re-run with --workspace if you intended workspace mode.`,
        );
      } else {
        const { workspaceChoice } = await inquirer.prompt<{ workspaceChoice: "single" | "workspace" }>([
          {
            type: "select",
            name: "workspaceChoice",
            message:
              `--workspace=false but ${detected.length} git sub-repo(s) detected. Workspace mode would configure all sub-repos together. Continue?`,
            choices: [
              { name: "Workspace init (configure all sub-repos together)", value: "workspace" },
              { name: "Single-repo init (sub-repos are not configured)", value: "single" },
            ],
            default: "workspace",
          },
        ]);
        if (workspaceChoice === "workspace") {
          opts.workspace = true;
        }
      }
    }
  }
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
     * CLI-tools selection on ANY init path (W3-mcp-optin: previously `--yes`
     * only). Accepts `"tier1"`, `"all"`, or a comma-separated list of
     * registry ids (e.g. `"ripgrep,jq,gh"`). On `--yes`, omission applies the
     * default tier-1 + triggered-tier-2 selection; on interactive runs an
     * explicit value skips the CLI-tools picker prompt.
     */
    cliTools?: string;
    /**
     * Disable CLI tools entirely on any init path (interactive runs skip the
     * CLI-tools picker prompt; W3-mcp-optin path-independence).
     */
    noCliTools?: boolean;
    /**
     * Opt in to MCP on ANY init path (W3-mcp-optin: previously `--yes` only).
     * MCP is off by default — interactive init no longer prompts for MCP
     * servers; this flag and the `hatch3r mcp setup` side-door are the only
     * enable paths. When set, the platform default server set
     * (`defaultMcpServers`) is applied.
     */
    mcp?: boolean;
    /**
     * D1-SA1.1-F13: explicit MCP opt-out, symmetric with `--no-cli-tools`.
     * When true, MCP is forced off regardless of `--mcp` so a CI/audit config
     * can self-document "no MCP" rather than relying on the implicit default.
     * Commander's `--no-mcp` registration (program.ts) sets `opts.mcp = false`;
     * this dedicated field additionally lets a programmatic caller force-off
     * even if `mcp` is set, and makes the explicit-off intent legible at the
     * resolution sites below. Honored on every init path — single-repo and
     * workspace, interactive and `--yes` (W3-mcp-optin path-independence).
     */
    noMcp?: boolean;
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
    /**
     * W5-bigfour (P1): `--format <human|json>`. `json` is byte-identical to
     * the legacy `--json` boolean alias (both resolve through `beginCommand`
     * to the same emitJson payload) and is valid only on headless runs
     * (`--yes` / `--quick` / `--default`) — an interactive prompt flow cannot
     * interleave with the single-JSON-document stdout contract (exit 2).
     */
    format?: string;
    /**
     * W5-bigfour (P1): `--dry-run` — preview the per-tool adapter outputs
     * (added/modified/unchanged vs disk) without writing anything: no
     * manifest, adapter outputs, mcp.json, seeds, .gitignore entries,
     * provenance, snapshots, or checkpoints. Prompts still run on the
     * interactive path; only writes are skipped.
     */
    dryRun?: boolean;
    /**
     * W5-bigfour (P1): `--verbose` — per-file written-output detail on the
     * generation pass (stderr), plus the existing verbose() diagnostics.
     */
    verbose?: boolean;
    /**
     * Decision 27 (Bucket 2.2): re-enter the orchestrator at the last
     * checkpoint recorded under `.init-workspace/checkpoint.json`. When set
     * and a checkpoint exists, init surfaces the recorded phase/wave and
     * proceeds as a fresh single-pass run (init has no mid-run pause point
     * yet). Absence of a checkpoint emits a `warn()` and continues as a
     * fresh init. See `src/pipeline/checkpoint.ts`.
     */
    resume?: boolean;
    /**
     * F1.1-H1 / F14.3-H1 (Decision 16): operational maturity tier.
     * Valid: `solo` | `team` | `scaleup` | `enterprise`. Default `solo`.
     * A runtime investment-calibration dial — it does NOT gate content
     * admission (selection is tier-invariant per the Decision 16 reframe);
     * it scales user-content gate strictness and is delivered to runtime
     * agents via the adapter header. Persisted in `.hatch3r/hatch.json`
     * under `maturity`.
     */
    maturity?: string;
    /**
     * 2.8.0: `--communication-style <plain|technical>` additive scalar.
     * release/2.8.5: also PROMPTED on the interactive path (7th calibration
     * prompt; skipped when this flag or `--resume` resolves it — see the
     * honest prompt-count note at the step machine). Persisted under
     * `manifest.communicationStyle`; absent flag on a headless run preserves
     * an existing manifest's value or writes no field. Validated via
     * `validateFlag`.
     */
    communicationStyle?: string;
    /**
     * 2.8.0: `--default-effort <light|standard|deep>` — flag-only additive
     * scalar. Persisted under `manifest.defaultEffort`; absent flag
     * preserves an existing manifest's value or writes no field (absent ⇒
     * auto-tier; an explicit `--effort` run flag overrides). Validated via
     * `validateFlag`.
     */
    defaultEffort?: string;
    /**
     * D14-M6 (Cycle 10 rollover): role-bundle selector. Accepts one of
     * `KNOWN_ROLES`. When set, resolveSelection's role stage filters to
     * items tagged `role:<value>` (plus floor and protected items). Absent
     * or empty = no role filtering. Validated via `validateFlag`.
     */
    role?: string;
    /**
     * D14-M9 (Cycle 10 rollover): graduated-customization facet selector.
     * Accepts a comma-separated list of `KNOWN_FACETS`. When set,
     * resolveSelection admits items carrying the mapped tags (per
     * FACET_TAG_ADMISSIONS) in addition to the preset's capability gate.
     * Unknown facet names emit a warning and are skipped (do not fail the
     * flag).
     */
    facets?: string;
    /**
     * Import an existing tool's config into hatch3r at the tail of init.
     * Accepts one of {@link IMPORT_TARGETS}: `cursor` (`.cursor/rules/*.mdc`),
     * `copilot` (`.github/instructions/*.instructions.md` + legacy
     * `.github/copilot-instructions.md`), `windsurf` (`.windsurf/rules/*.md` +
     * legacy `.windsurfrules`), `cursorrules` (legacy `.cursorrules`), or `auto`
     * (every format). Each converted rule is written as a canonical `.md` +
     * `.mdc` companion under `.hatch3r/overrides/rules/` with conflict detection
     * against existing rule ids (shared across formats under `auto`). Interactive
     * runs preview (dry-run) then confirm before writing; `--yes`/`--json`/`--quiet`
     * write directly. An unset value is a no-op — init behaves exactly as before.
     * See `src/importers/index.ts::runImport`.
     */
    import?: string;
    /**
     * D14-SA14.2-H1 (D14, P4/P1): opt in to per-package monorepo emission.
     * Default OFF — on a detected monorepo, adapter output is written only to
     * the repo root unless this flag is set. When set, `runInit` additionally
     * copies each adapter's output under every package (`outputs × packages`
     * files), capped at {@link PER_PACKAGE_COUNT_CAP} packages, batched with
     * bounded concurrency, and the copies are added to `.gitignore`. No-op on a
     * non-monorepo (no packages detected).
     */
    perPackage?: boolean;
    /**
     * release/2.8.6 — INTERNAL (not a CLI flag): child argv override for the
     * pre-flight auto-update's re-exec (`maybeSelfUpdateBeforeInit`). Set by
     * `hatch3r setup` when chaining into init (`["setup", ".", ...flags]`)
     * so a re-exec re-enters setup against the already-scaffolded directory
     * instead of replaying the original positional and nesting `<dir>/<dir>`.
     * Absent on direct `init` runs — the argv is then derived from
     * `process.argv` (see `buildInitReExecArgv`).
     */
    reExecArgv?: readonly string[];
  } = {},
): Promise<void> {
  // Commander stores the negated `--no-cli-tools` option on the positive
  // `cliTools` key as boolean false. Normalize that parse-level shape to the
  // programmatic field this command uses before resolving any defaults.
  if ((opts as { cliTools?: string | false }).cliTools === false) {
    opts.noCliTools = true;
    delete opts.cliTools;
  }
  // C9-H26 (D10-SA10.2-F1): chrome-suppression flags.
  // - `--json` / `--format json` imply `--quiet` (the structured emission
  //   replaces all chrome).
  // - `--quiet` implies `--no-banner` (banner is chrome).
  // - `--no-banner` alone keeps spinner/success-box output.
  // W5-bigfour (P1): the wiring flows through the standardized beginCommand
  // chokepoint — it resets the module-global UI flags (D1-SA1.1-F09 leak
  // guard), resolves `--format` with the legacy `--json` boolean as a one-way
  // upgrade, wires quiet/verbose, and rejects `--format json` on a
  // prompt-driven run (exit 2): inquirer prompts cannot interleave with the
  // single-JSON-document stdout contract. `--quick`/`--default` collapse to
  // the `--yes` path below, so they count as headless here.
  const headlessRun = opts.yes === true || opts.quick === true || opts.default === true;
  beginCommand(
    { format: opts.format, quiet: opts.quiet, verbose: opts.verbose, json: opts.json, yes: headlessRun },
    { interactive: !headlessRun },
  );
  // `--no-banner` keeps the success box but drops the banner. quiet/json
  // already suppress printBanner internally, so only the explicit flag needs
  // a local gate (C9-H26 semantics preserved).
  // release/2.8.6: a pre-flight auto-update re-exec child (HATCH3R_RE_EXEC=1,
  // see `maybeSelfUpdateBeforeInit` below) also skips the banner — the parent
  // printed it moments earlier. The env guard exists in addition to the
  // `--no-banner` append on the child argv because the `setup` chain cannot
  // take the flag (`setup` does not register `--no-banner` in program.ts).
  if (opts.noBanner !== true && process.env.HATCH3R_RE_EXEC !== "1") {
    printBanner();
  }
  // F16.1-C1 / D11-H-7 (Decision 27 / Bucket 2.2): `--resume` reads the
  // checkpoint at `.init-workspace/checkpoint.json` (now written by
  // `runInitInner` after each phase). Completion is asserted from EVIDENCE, not
  // a bare `passed` status: a FINALIZE-wave `passed` checkpoint at the current
  // hatch3r version WITH the on-disk manifest present means the prior init
  // completed — report it and exit early (re-running would re-prompt and
  // re-overwrite managed files, which is wasteful and surprising on an explicit
  // `--resume`). A baseline mismatch, a `failed`/`in-progress` checkpoint, a
  // generation-only `passed` checkpoint (finalize never ran — D1-SA1.1-04), or
  // no checkpoint at all falls through to a fresh init (which captures a new
  // rollback snapshot).
  if (opts.resume) {
    const cwd = process.cwd();
    const initWorkspace = workspaceDir(cwd, "init");
    const checkpoint = await readCheckpoint(initWorkspace);
    if (checkpoint === null) {
      warn(
        `\`hatch3r init --resume\` requested but no checkpoint found at ` +
        `${checkpointPath(initWorkspace)}. Continuing as a fresh init. ` +
        `Use \`hatch3r rollback --session=<id>\` after the run if you need to revert.`,
      );
    } else if (checkpoint.meta.baselineSha === HATCH3R_VERSION && checkpoint.status === "passed") {
      // D1-SA1.1-04 (D1, P2): a `passed` status alone is NOT run-completion.
      // `recordPhase(INIT_GENERATION_WAVE, "passed")` writes exactly this shape
      // mid-run — after adapter generation, before the finalize phase writes the
      // manifest — so a finalize-window crash (or a stray wave-1 checkpoint)
      // would otherwise be reported as "already completed" with no manifest on
      // disk. Require the FINALIZE wave marker AND corroborate against the
      // on-disk manifest (evidence-backed sign-off) before declaring the prior
      // run complete; otherwise fall through to a fresh init.
      const manifestPresent = (await readManifest(cwd)) !== null;
      const runComplete = checkpoint.wave === INIT_FINALIZE_WAVE && manifestPresent;
      if (runComplete) {
        // D1-15 (D1, P1): the human report goes through `info()`, which is
        // suppressed under `--quiet`/`--json`. Without a machine-readable line a
        // `--resume --json` short-circuit produced EMPTY stdout+stderr at exit 0,
        // so a CI caller could not tell "already complete" from "did nothing".
        // Emit a stable `{"status":"resumed",...}` line on stdout before the early
        // return so the JSON consumer gets a parseable terminal signal that
        // matches the success-box payload's status field convention.
        if (isJson()) {
          console.log(
            JSON.stringify({
              status: "resumed",
              version: HATCH3R_VERSION,
              phase: checkpoint.phase,
              wave: checkpoint.wave,
              checkpointPath: checkpointPath(initWorkspace),
              message: "Prior init at this version already completed; nothing to resume.",
            }),
          );
          return;
        }
        info(
          `Resume: the last init at this hatch3r version (v${HATCH3R_VERSION}) completed ` +
          `(phase=${checkpoint.phase} wave=${checkpoint.wave}). Nothing to resume — re-run ` +
          `\`hatch3r init\` without --resume to re-initialize from scratch.`,
        );
        return;
      }
      // D1-SA1.1-04: passed generation checkpoint whose finalize phase never
      // landed (no manifest on disk, or the marker never advanced to FINALIZE).
      // Re-run from the start rather than falsely reporting completion — falls
      // through to the fresh init below (no early return).
      info(chalk.dim(
        `Resume: prior init reached generation (wave=${checkpoint.wave}) but did not finalize ` +
        `(${manifestPresent ? "manifest present but finalize marker missing" : "no manifest on disk"}). ` +
        `Re-running from the start (init captures a fresh rollback snapshot).`,
      ));
    } else if (checkpoint.meta.baselineSha !== HATCH3R_VERSION) {
      warn(
        `Resume: checkpoint baseline (v${checkpoint.meta.baselineSha}) differs from the ` +
        `installed hatch3r (v${HATCH3R_VERSION}). Running a fresh init.`,
      );
    } else {
      info(chalk.dim(
        `Resume: prior init left a ${checkpoint.status} checkpoint at phase=${checkpoint.phase} ` +
        `wave=${checkpoint.wave}. Re-running from the start (init captures a fresh rollback snapshot).`,
      ));
      if (checkpoint.status === "failed") {
        warn(
          `Checkpoint records a failed status at phase=${checkpoint.phase} wave=${checkpoint.wave}. ` +
          `Triage the recorded failure before treating a fresh-init success as conclusive.`,
        );
      }
    }
  }

  // C8-D1-M4: Validate `--preset`, `--project-type`, `--team-size`, and
  // `--maturity` flag values eagerly, before any prompt or detection work
  // runs. Per CLI Guidelines fail-fast validation, invalid values abort
  // with exit 1 before any side-effect.
  if (opts.preset !== undefined) {
    // Accepts the registry ids (incl. `custom`) AND a comma-list to compose;
    // membership reads from KNOWN_PRESET_IDS so this can't drift from PRESETS.
    validatePresetArg(opts.preset);
  }
  if (opts.projectType !== undefined) {
    validateFlag(opts.projectType, ["greenfield", "brownfield"], "brownfield", "project-type");
  }
  if (opts.teamSize !== undefined) {
    validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
  }
  // F1.1-H1 / F14.3-H1: validate `--maturity` against the canonical tier set.
  if (opts.maturity !== undefined) {
    validateFlag(opts.maturity, [...MATURITY_TIERS], DEFAULT_MATURITY_TIER, "maturity");
  }
  // 2.8.0: validate + resolve the flag-only additive scalars eagerly, before
  // any prompt or detection work (fail-fast, same position as `--maturity`).
  // `undefined` = flag not passed: runInit then preserves an existing
  // manifest's field or writes none (consumers apply the documented
  // fallbacks — "plain" / auto-tier). Invalid values throw
  // HatchError(VALIDATION_ERROR) → exit 64 via ERROR_CODE_TO_EXIT_CODE.
  const cliCommunicationStyle: CommunicationStyle | undefined =
    opts.communicationStyle !== undefined
      ? validateFlag(opts.communicationStyle, [...COMMUNICATION_STYLES], DEFAULT_COMMUNICATION_STYLE, "communication-style")
      : undefined;
  const cliDefaultEffort: OrchestrationEffort | undefined =
    opts.defaultEffort !== undefined
      ? validateFlag(opts.defaultEffort, [...ORCHESTRATION_EFFORTS], "standard", "default-effort")
      : undefined;
  // D14-M6 (Cycle 10): validate `--role` against the known role set early.
  if (opts.role !== undefined) {
    validateFlag(opts.role, [...KNOWN_ROLES], KNOWN_ROLES[0], "role");
  }
  // D14-M9 (Cycle 10): parse + validate `--facets` (comma-separated list).
  // Unknown facets are dropped with a warning rather than failing the
  // flag — the user picks the subset they want; a typo should not abort.
  if (opts.facets !== undefined) {
    const requested = opts.facets.split(",").map((s) => s.trim()).filter(Boolean);
    for (const f of requested) {
      if (!(KNOWN_FACETS as readonly string[]).includes(f)) {
        warn(
          `--facets: unknown facet "${f}" (known: ${KNOWN_FACETS.join(", ")}). ` +
            "Skipping this entry; remove the unknown name to silence this warning.",
        );
      }
    }
  }

  // D1-SA1.2-H1 (D1, P1): parse `--role` / `--facets` to typed values ONCE at
  // the entry point so every downstream `resolveSelection` site receives the
  // same filter. Previously only the `--yes` single-repo branch re-derived
  // them; the interactive single-repo flow and both workspace flows dropped
  // the flags silently, so `--role reviewer` / `--facets a11y` were no-ops
  // there (verified: `--workspace --role reviewer` resolved 168 items vs the
  // single-repo 69). `cliRole`/`cliFacets` are threaded into all four selection
  // calls below; an undefined role / empty facets collapses to no filtering.
  let cliRole: RoleId | undefined = opts.role
    ? (validateFlag(opts.role, [...KNOWN_ROLES], KNOWN_ROLES[0], "role") as RoleId)
    : undefined;
  // D14-SA14.3-01 (D14, CQ9): keep `--role` latent until the corpus backs it.
  // KNOWN_ROLES ships three role ids but no canonical artifact carries a
  // `role:<id>` tag yet, so resolveSelection's Stage-6 role filter would
  // collapse every role value to the identical floor+protected set — a live,
  // `--help`-documented flag with no distinguishing effect, plus a misleading
  // reduced item count. Probe the canonical index once (only when --role is
  // passed): when no artifact carries the role tag, drop the filter (leaving the
  // preset selection intact) and tell the user the flag had no effect, rather
  // than silently installing a floor-only bundle the flag never actually
  // selected. Once the corpus is role-tagged this guard lifts automatically.
  // Extends `setup`'s existing discipline (it never exposes --role) to raw init.
  if (cliRole !== undefined) {
    const roleProbeIndex = await buildContentIndex(resolveBundledContentRoot());
    const roleTag = `role:${cliRole}`;
    const roleTaggedCount = roleProbeIndex.items.filter((i) => i.tags.includes(roleTag)).length;
    if (roleTaggedCount === 0) {
      warn(
        `--role ${cliRole} matched 0 role-tagged artifacts — no canonical content ` +
          `carries a "${roleTag}" tag yet, so role filtering has no effect. ` +
          `Installing your preset selection unchanged (--role is ignored).`,
      );
      cliRole = undefined;
    }
  }
  const cliFacets: FacetId[] = opts.facets
    ? opts.facets
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is FacetId => (KNOWN_FACETS as readonly string[]).includes(s))
    : [];
  // release/2.8.5 (BUG-4): the EFFECTIVE filter (post role-probe) that every
  // selection site below applies — persisted to `manifest.contentFilter` via
  // runInit so `hatch3r config` and the update-time selection refresh keep
  // filtering the same way. Undefined when no filter is active (no field
  // written; byte-identity preserved for unfiltered repos).
  const cliContentFilter: { role?: RoleId; facets?: FacetId[] } | undefined =
    cliRole !== undefined || cliFacets.length > 0
      ? {
          ...(cliRole !== undefined ? { role: cliRole } : {}),
          ...(cliFacets.length > 0 ? { facets: cliFacets } : {}),
        }
      : undefined;

  // release/2.8.6: pre-flight auto-update. When a semver-NEWER hatch3r exists
  // on the registry (strict `semverGt` direction guard — never a downgrade
  // offer, F-SEC-01), interactive init offers a one-confirm (default Yes)
  // self-update through the existing `runSelfUpdate` machinery and re-execs
  // the invoked command (init, or setup when chained) so generation runs on
  // current code and canonical content. Skips silently for: re-exec children,
  // the `--no-update-check`/HATCH3R_NO_UPDATE_CHECK opt-out, the
  // NO_UPDATE_NOTIFIER/`--no-update-notifier` library opt-outs (F-SEC-05),
  // NODE_ENV=test, CI, headless runs (`--yes`/`--quick`/`--default`),
  // `--resume`, `--dry-run` (F-SEC-03 — an accepted update installs and
  // re-execs, both real side effects), non-TTY stdin/stdout, a manifest
  // `versionConstraint` pin (F-SEC-02, verbose note — a pin means "do not
  // move"), and dev-source checkouts. Registry probe is 3s-capped and
  // every AVAILABILITY failure fails OPEN (init proceeds on the current
  // version) — network problems never block init; the one hard stop is a
  // post-install signature-verification failure (INTEGRITY_ERROR, exit 73),
  // which refuses to proceed on an unverifiable install (see the module doc
  // in initUpdateCheck.ts). Placed after the eager flag validation
  // (fail-fast VALIDATION_ERRORs above keep precedence and a re-exec child
  // re-enters with zero side effects behind it) and before the non-TTY
  // preflight + `detectAmbiguity` — the first prompt sites.
  await maybeSelfUpdateBeforeInit({
    headless: headlessRun,
    resume: opts.resume === true,
    dryRun: opts.dryRun === true,
    reExecArgv: opts.reExecArgv,
  });

  // D3-SA3.2-11 (D3, CQ5 / P1): non-TTY preflight — the init-side mirror of
  // config's D1-18 guard (src/cli/commands/config.ts). The interactive flow
  // below issues the ambiguity prompts (`detectAmbiguity`) and then the
  // step-machine prompts (platform, identity, branch, tools, features, preset,
  // maturity, custom items, import/sync confirms). Under a pipe, redirect, or CI
  // runner stdin is not a TTY, so inquirer cannot read a response — it would hang
  // or throw an opaque isTtyError after the first prompt. Reject up front with a
  // usage-code (exit 2) error naming the headless escape. Scoped to
  // `!headlessRun`: `--yes` never prompts and `--quick`/`--default` fold into
  // `headlessRun` (they set `opts.yes` further below), so CI/headless installs
  // still work. Placed after the flag-validation and completed-`--resume`
  // short-circuits (both non-prompting) and before `detectAmbiguity` — the first
  // prompt site — so those headless paths keep their precise errors / early
  // return instead of collapsing to the TTY message.
  if (!headlessRun && !process.stdin.isTTY) {
    throw new HatchError(
      "`hatch3r init` (interactive) requires a TTY — stdin is not interactive (piped, redirected, or CI).",
      2,
      "VALIDATION_ERROR",
      "Re-run with `--yes` (or `--quick` / `--default`) to accept smart defaults headlessly, or run the interactive flow from a terminal.",
    );
  }

  // F1.1-H2 (B1 ambiguity-detection gate). Resolve flag-combination
  // ambiguities at the entry point before any side-effect runs. See
  // `detectAmbiguity` above + `agents/shared/user-question-protocol.md`.
  await detectAmbiguity(opts);

  // C8-D10-M2: `--quick` / `--default` collapses the 9-prompt interactive
  // flow to smart defaults by routing to the existing `--yes` path. This
  // reconciles the README "One command gives you..." claim with the
  // interactive first-run experience.
  if (opts.quick || opts.default) {
    opts.yes = true;
  }

  // D1-SA1.1-F06: collapse symlinks in the working directory before it flows
  // into ~10 `join(rootDir, ...)` write targets. `realpath` resolves a
  // symlinked cwd (e.g. the user `cd`-ed into a symlink) to its canonical
  // path so the success-box "State dir" line and every write land where the
  // user can actually find them. Defensive fallback to the raw cwd: a
  // realpath failure (deleted cwd, permission denied) should surface via the
  // downstream write errors, not abort before any user-facing guidance.
  const cwd = process.cwd();
  let rootDir: string;
  try {
    rootDir = await realpath(cwd);
  } catch {
    rootDir = cwd;
  }

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
    // D1-SA1.2-H1: forward the entry-point-parsed role/facets so workspace
    // init applies them at its selection sites (was dropped before).
    await runWorkspaceInit(rootDir, detectedRepos, repoInfo, opts, { role: cliRole, facets: cliFacets });
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

  // D14-SA14.4-02 (D14, P1): surface the migration bridge at the one moment the
  // CLI knows a competitor config is present. `detectExistingTools` already
  // found a cursor/copilot config on disk, but `existingTools` was consumed only
  // to seed tool DEFAULTS — the `--import` capability stayed invisible on the
  // interactive happy path (flag-only; discoverable only if the user already
  // knew the flag existed). Emit a dim, zero-prompt, opt-in pointer alongside
  // the `Detected:` line above. Skipped when `--import` was already passed
  // (migration is in flight) and when no detected tool is an importable FORMAT
  // (a claude-only config is hatch3r's own output, not an import source — claude
  // is not in IMPORT_TARGETS). `info()` is a no-op under quiet/json, so headless
  // CI callers see nothing.
  if (!opts.import) {
    const importableDetected = repoInfo.existingTools.filter((t) =>
      (IMPORT_TARGETS as readonly string[]).includes(t),
    );
    if (importableDetected.length > 0) {
      const target = importableDetected.length === 1 ? importableDetected[0] : "auto";
      info(
        chalk.dim(
          `Detected ${importableDetected.join(", ")} config — carry your rules across with ` +
            `\`hatch3r init --import ${target}\` (or \`--import auto\`).`,
        ),
      );
    }
  }

  // D14-13 (D14-SA14.4-F3, P1/P4): warn when the repo carries two or more
  // tools competing for one mutually-exclusive role (e.g. both `vitest` and
  // `jest`, or two linters). Without this the generated single-toolchain
  // rules silently contradict the second config a mid-migration repo still
  // carries. `formatConventionConflicts` returns "" when there are none, so
  // unambiguous repos see no extra output. The conflicts are also threaded
  // into the manifest (persisted on `HatchManifest.conflicts`) below.
  const conventionConflicts = analyzeConventionConflicts(repoInfo);
  const conflictBlock = formatConventionConflicts(conventionConflicts);
  if (conflictBlock.length > 0) {
    warn(conflictBlock);
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
          undefined,
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

    // W3-mcp-optin: MCP is pure opt-in on every init path. `--mcp` resolves
    // the platform default server set; without it the list stays empty and no
    // .env.mcp is generated. D1-SA1.1-F13: `--no-mcp` forces the list empty
    // even when `--mcp` is set. `features.mcp` derives from the resolved list
    // so the manifest flag and server list can never disagree.
    const mcpServers = opts.mcp === true && !opts.noMcp ? defaultMcpServers(platform) : [];
    const features = { ...DEFAULT_FEATURES, mcp: mcpServers.length > 0 };

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
    // Accepts a single registry id OR a comma-list to compose (validated by
    // validatePresetArg above). A composition resolves to a synthetic preset
    // whose `.id` is "custom"; resolveSelection persists `content.items` (the
    // resolved selection), so the composition round-trips via the stored items
    // regardless of the persisted "custom" label.
    const presetArg = validatePresetArg(opts.preset);
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], detection.type, "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    // F1.1-H1 / F14.3-H1: read `--maturity` (already validated above) with
    // canonical default "solo".
    const maturity: MaturityTier = validateFlag(opts.maturity, [...MATURITY_TIERS], DEFAULT_MATURITY_TIER, "maturity");
    // D1-SA1.2-H1: role/facets are parsed once at the entry point (`cliRole` /
    // `cliFacets`) and threaded into every selection site, including this one.
    const preset = resolvePresetArg(presetArg);
    const index = await buildContentIndex(resolveBundledContentRoot());
    const projectLanguages = languagesForSelection(repoInfo);
    const contentSelection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages, { role: cliRole, facets: cliFacets });

    // Warn if orchestration-critical agents are missing from selection
    const orchWarnings = validateOrchestrationDependencies(contentSelection);
    for (const w of orchWarnings) { warn(w); }

    warnBoardPrerequisites(contentSelection);
    warnBoardDroppedForSolo(teamSize, preset, projectType, index, projectLanguages, { role: cliRole, facets: cliFacets }, contentSelection);
    // release/2.8.6 (D10-37 extension): compute the solo-filtered id set for
    // the success-box/JSON disclosure (solo+full only — the disclosure's
    // trigger). In-memory resolution, same cost class as the board probe above.
    const teamOnlyFiltered =
      teamSize === "solo" && contentSelection.preset === "full"
        ? computeTeamOnlyFilteredItems(preset, projectType, index, projectLanguages, { role: cliRole, facets: cliFacets }, contentSelection)
        : undefined;

    await checkExisting(rootDir, true, contentSelection, opts.dryRun);
    // D1-SA1.1-02 (D1, P1): run the `--import` step BEFORE adapter generation.
    // runToolImport writes converted rules to `.hatch3r/overrides/rules/`, and
    // runInit's generation reads that overrides tree (readCanonicalFiles with
    // userRepoRoot). Importing first means the generated adapter output already
    // contains the imported rules, so an immediate `hatch3r verify` reports zero
    // drift; the prior tail-order left imported rules inert until an unadvertised
    // `sync`. runToolImport needs only rootDir + a fresh content index (no
    // manifest, no adapter output) and self-creates its target dir, so it runs
    // safely ahead of runInit.
    await runToolImport(rootDir, opts.import, true, opts.dryRun);
    await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, cliTools: cliToolsConfig, yes: true, maturity, communicationStyle: cliCommunicationStyle, defaultEffort: cliDefaultEffort, contentFilter: cliContentFilter, teamOnlyFiltered, perPackage: opts.perPackage, conflicts: conventionConflicts, dryRun: opts.dryRun });
    return;
  }

  console.log();

  const remoteUrl = getGitRemoteUrl();
  const detectedPlatform = detectPlatformFromRemote(remoteUrl);

  const filterIndex = await buildContentIndex(resolveBundledContentRoot());
  const projectLanguages = languagesForSelection(repoInfo);
  const detection = await detectProjectType(repoInfo, rootDir);
  const wslTheme = isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;
  const toolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;

  // F10.3-2 (D10, P1): smart defaults for the prompts dropped to reach the
  // ≤6-prompt ceiling (defaultBranch / projectType / teamSize / mcp; 2.1.0
  // re-added maturity as a prompt seeded by `inferredMaturity` below). Each
  // value is computed from detection / git so the resolved selection matches
  // what the dropped prompt would have defaulted to; every value is overridable
  // post-init via `hatch3r config`.
  const inferredDefaultBranch = parseGitDefaultBranch();
  const inferredProjectType: "greenfield" | "brownfield" = validateFlag(
    opts.projectType,
    ["greenfield", "brownfield"],
    detection.type,
    "project-type",
  );
  // step (d): infer team size from distinct git commit authors.
  const inferredTeamSize: "solo" | "team" = validateFlag(
    opts.teamSize,
    ["solo", "team"],
    inferTeamSizeFromGit(rootDir),
    "team-size",
  );
  // D14-17 (D14-SA14.3-F4, P1; 2.1.0 Decision 25 5→6): the maturity tier is now
  // a prompted input on every interactive run (unless `--maturity` is passed),
  // seeded by this value. `inferTeamSizeFromGit` distinguishes solo vs
  // multi-author by distinct commit-author count; reuse that orthogonal signal
  // to seed the maturity DEFAULT (team-authored repo → "team" tier, otherwise
  // "solo") so the prompt's pre-selected option matches the repo. An explicit
  // `--maturity` flag still wins (validateFlag returns the flag value when
  // present) AND skips the prompt; on the headless / `--yes` paths this seed is
  // the resolved tier directly. The resolved tier is surfaced in the
  // success-box "Maturity" line.
  const seededMaturityDefault: MaturityTier =
    inferredTeamSize === "team" ? "team" : DEFAULT_MATURITY_TIER;
  const inferredMaturity: MaturityTier = validateFlag(
    opts.maturity,
    [...MATURITY_TIERS],
    seededMaturityDefault,
    "maturity",
  );

  // Task F (2.1.0, P1): the default branch + git-inferred team-size/maturity
  // were resolved silently above. Surface ONE dim confirmation line each so the
  // inference is visible before the picker, not a hidden default. `info()` is a
  // no-op under --quiet (and --json sets quiet), so these render only in human
  // interactive mode — the inference outcome is observable without chrome in
  // the structured/quiet paths.
  info(chalk.dim(`Detected default branch: ${inferredDefaultBranch}`));
  // D1-SA1.1-07 (D1, P1): name the CONSEQUENCE of the inferred team size — it is
  // not cosmetic; it gates WHICH artifacts install (team-only workflows such as
  // the board cluster are filtered out at teamSize=solo). The prior line stated
  // the value without saying what it changes, so a user who disagreed had no
  // signal to re-run with `--team-size`.
  info(
    chalk.dim(
      (opts.maturity === undefined
        ? `Inferred maturity: ${inferredMaturity} (team size: ${inferredTeamSize})`
        : `Maturity: ${inferredMaturity} (from --maturity); team size: ${inferredTeamSize}`) +
        ` — team size filters team-only workflows (e.g. board); override with --team-size.`,
    ),
  );

  // C (2.1.0, P1; Decision 25 raised the ceiling 5→6): the maturity tier is a
  // first-class calibration input, prompted on EVERY interactive run. The only
  // skips are `--maturity` (the flag is authoritative) and the headless /
  // `--yes` / `--quick` / `--default` paths, which return before this block.
  // The prompt is seeded at the git-inferred tier (`inferredMaturity`), so
  // enter-through reproduces the prior smart default; the success-box
  // "Maturity" line still surfaces the resolved tier.
  const promptMaturity = opts.maturity === undefined;

  // release/2.8.5: communication style graduates from flag-only to a prompted
  // calibration input on the interactive path. Skips: the
  // `--communication-style` flag (authoritative), `--resume` (a resumed run
  // re-executes with prior intent — no new dial questions), and the headless
  // `--yes` / `--quick` / `--default` paths (structurally: they return before
  // this block; the flag remains their only surface). Enter-through keeps the
  // documented "plain" default, so the pre-2.8.5 no-flag outcome reproduces.
  const promptCommunicationStyle =
    opts.communicationStyle === undefined && opts.resume !== true;

  // W3-mcp-optin: `--cli-tools` / `--no-cli-tools` apply on the interactive
  // path too (flag semantics are path-independent). An explicit selection
  // skips the picker step below; without a flag the picker runs with tier-1 +
  // triggered tier-2 pre-checked, so enter-through reproduces the `--yes`
  // smart default exactly.
  const explicitCliTools: CliToolId[] | undefined = opts.noCliTools
    ? []
    : resolveCliToolsFlag(opts.cliTools, repoInfo, detectedPlatform);

  // Step-machine drives the interactive flow with back-navigation.
  // Each step's `run()` calls inquirer with the same shape the
  // pre-Slice-E inline prompts used so existing test queues match
  // unchanged. The orchestrator awaits `runStepMachine` and consumes
  // the resolved state below.
  // F10.3-2 (D10, P1) — honest prompt count as of release/2.8.5: the
  // interactive first-run max path is SEVEN prompts — platform, identity,
  // preset, maturity, communication style, tools, and the CLI-tools picker
  // (W3-mcp-optin: the collapsed MCP multi-select moved behind the `--mcp`
  // flag / `hatch3r mcp setup` side-door). This EXCEEDS the Decision 25
  // ≤6-prompt ceiling (Vercel-Heroku OSS-onboarding benchmark; raised 5→6 in
  // 2.1.0 for maturity) by one: the communication-style dial was judged
  // first-run-calibration-worthy in 2.8.5 and a governance amendment raising
  // the ceiling 6→7 is QUEUED for the next /h4tcher-evolve session — this
  // comment records the overage honestly rather than restating a ceiling the
  // code no longer meets (CONSTITUTION amendments are out of scope for a
  // release branch). Two of the seven are conditionally skipped by flags
  // (`--maturity`, `--communication-style`), so a flag-driven run stays ≤6.
  // The dropped prompts use smart defaults, each overridable post-init:
  //   - defaultBranch → `parseGitDefaultBranch()` (git-detected)
  //   - projectType   → `detectProjectType()` (auto-detected)
  //   - teamSize      → `inferTeamSizeFromGit()` (recommendation step d)
  //   - mcp           → off unless `--mcp` (opt in later via `hatch3r mcp setup`)
  // `customItems` stays as a conditional power-user prompt (preset=custom only),
  // so it does not count against the common-path ceiling. The maturity prompt
  // is skipped only when `--maturity` resolved the tier from the flag; the
  // communication-style prompt is skipped for `--communication-style` and
  // `--resume` (see `promptCommunicationStyle` above).
  interface SingleRepoState {
    platform: Platform;
    identity: { owner: string; repo: string; namespace: string; project: string };
    preset: PresetId;
    // C (2.1.0): maturity tier, prompted on every interactive run (see
    // `promptMaturity` above). Undefined only when `--maturity` gated the prompt
    // off — the resolved tier then falls back to `inferredMaturity` below.
    maturity: MaturityTier;
    // release/2.8.5: operator-communication dial. Undefined only when the
    // `--communication-style` flag (or `--resume`) gated the prompt off — the
    // resolved value then falls back to the flag / manifest-preservation path.
    communicationStyle: CommunicationStyle;
    customItems: string[] | undefined;
    tools: Tool[];
    // W3-mcp-optin: 3-tier CLI-tools picker result. Empty selection = CLI
    // tools disabled (`{enabled: false, selected: []}`). Replaces the prior
    // collapsed MCP multi-select as the 5th prompt.
    cliTools: CliToolId[];
  }

  // W2-flowsteps: each step is composed from the shared builders in
  // `src/cli/shared/flowSteps.ts` — prompt copy, name keys, defaults, skip
  // predicates, and BACK threading are unchanged from the inline versions.
  const steps: Array<Step<SingleRepoState, keyof SingleRepoState>> = [
    platformStep<SingleRepoState>({
      message: "Select your platform:",
      defaultPlatform: detectedPlatform,
    }),
    // D1-M4: identityStep delegates to the shared repoIdentityPrompt helper
    // so the 3-branch GitHub / Azure DevOps / GitLab prompt is single-sourced.
    identityStep<SingleRepoState>({ remote }),
    // F10.3-2: projectType + teamSize are no longer prompted — the item-
    // count estimate uses the auto-detected projectType and the git-inferred
    // teamSize resolved above the step machine. D10-M17 (Cycle 10 rollover):
    // the banner surfaces the inferred filters BEFORE the picker so the
    // operator sees which filters drive the `(~N items)` and `(excludes M of
    // T)` counts on each choice; the override path (`--project-type` /
    // `--team-size` flags) is named inline so a user who disagrees with the
    // inference can re-run with the flag instead of accepting an off-target
    // preset.
    presetStep<SingleRepoState>({
      index: filterIndex,
      projectType: inferredProjectType,
      teamSize: inferredTeamSize,
      projectLanguages,
      defaultPreset: "standard",
      customUniverseHint: true,
      banner: () =>
        info(
          chalk.dim(
            `Filters: projectType=${inferredProjectType}, teamSize=${inferredTeamSize}. ` +
              `Override with --project-type / --team-size at re-run.`,
          ),
        ),
    }),
    // C (2.1.0, P1): maturity prompt, seeded at the git-inferred tier. Always
    // shown on the interactive path; conditionally spread (matching the
    // cliToolsStep gate below) only so it is ABSENT from the array — not just
    // skipped — when `--maturity` resolved the tier from the flag. Decision 25
    // raised the interactive ceiling 5→6 to admit it; see `promptMaturity`.
    ...(promptMaturity
      ? [
          maturityStep<SingleRepoState>({
            message: "Project maturity (investment depth):",
            defaultMaturity: inferredMaturity,
          }),
        ]
      : []),
    // release/2.8.5: communication-style dial, sequenced with the maturity
    // calibration prompt. Conditionally spread (absent, not just skipped)
    // when the flag or --resume resolved it — matching the maturity gate.
    ...(promptCommunicationStyle
      ? [
          communicationStyleStep<SingleRepoState>({
            message: "How should agents talk to you?",
            defaultStyle: DEFAULT_COMMUNICATION_STYLE,
          }),
        ]
      : []),
    customItemsStep<SingleRepoState>({
      index: filterIndex,
      // D10-13: floor + protected rows are locked-on by the picker itself;
      // this baseline only governs optional rows (no retired `core` tag).
      baselineChecked: () => (item) => item.protected === true,
      previousAsDefault: true,
      wslTheme,
    }),
    // release/2.8.5 (BUG-3): no more `emptyFallback` — an empty submission
    // used to be silently rewritten to DEFAULT_TOOLS (claude), generating a
    // .claude/ setup the user never picked. The shared toolsStep now enforces
    // required-selection semantics (TTY re-prompt / VALIDATION_ERROR
    // otherwise), aligning init with config.
    toolsStep<SingleRepoState>({
      defaults: toolDefaults,
      wslTheme,
    }),
    // W3-mcp-optin: the 5th prompt is the CLI-tools picker (the collapsed MCP
    // multi-select moved behind `--mcp` / `hatch3r mcp setup`). Tier-2
    // suggestions read the platform chosen in step 1, so they are computed
    // per-visit from the in-progress state; with no `existing` selection the
    // picker pre-checks tier-1 + these suggestions, making enter-through equal
    // the `--yes` smart default. Skipped entirely when `--cli-tools` /
    // `--no-cli-tools` resolved an explicit selection above.
    ...(explicitCliTools === undefined
      ? [
          cliToolsStep<SingleRepoState>({
            tier2Suggested: (s) =>
              applyPlatformTriggers(s.platform ?? detectedPlatform, evaluateTier2Triggers(repoInfo)),
            wslTheme,
          }),
        ]
      : []),
  ];

  const stepState = await runStepMachine<SingleRepoState>(steps);

  const platform = stepState.platform;
  const { owner, repo, namespace, project } = stepState.identity;
  // F10.3-2: the four dropped prompts resolve to the smart defaults computed
  // above the step machine (git-detected branch, auto-detected projectType,
  // git-inferred teamSize, flag/default maturity).
  const defaultBranch = inferredDefaultBranch;
  const projectType = inferredProjectType;
  const teamSize = inferredTeamSize;
  // C (2.1.0): use the prompted tier when the maturity step ran (the common
  // interactive path); otherwise (`--maturity` flag) the value inferred above.
  const maturity: MaturityTier = stepState.maturity ?? inferredMaturity;
  // release/2.8.5: the prompted style when the step ran; otherwise the
  // `--communication-style` flag value (or undefined ⇒ runInit preserves an
  // existing manifest's style / writes no field, the pre-2.8.5 semantics).
  const resolvedCommunicationStyle: CommunicationStyle | undefined =
    stepState.communicationStyle ?? cliCommunicationStyle;
  const selectedPreset = getPreset(stepState.preset);
  const customSelections = stepState.customItems;
  const tools = stepState.tools;
  // W3-mcp-optin: MCP no longer prompts on the interactive path. The flag
  // semantics are path-independent: `--mcp` (minus `--no-mcp`) resolves the
  // platform default server set, otherwise MCP stays off — opt in later via
  // `hatch3r mcp setup`. `features.mcp` derives from the resolved list.
  const mcpServers: string[] = opts.mcp === true && !opts.noMcp ? defaultMcpServers(platform) : [];
  const features: Features = { ...DEFAULT_FEATURES, mcp: mcpServers.length > 0 };

  // C9-H32 (D10-SA10.5-F2): Surface MCP secret-loading divergence at
  // tool-selection time — before commit — so a user picking Claude alongside
  // auto-loaders (Cursor / Copilot / Windsurf) sees the divergent shell-source
  // requirement immediately. W3-mcp-optin: gated on an actual MCP opt-in —
  // a no-MCP install has no MCP secrets to load, so the note was noise there.
  if (mcpServers.length > 0) {
    const secretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
    if (secretNotes.length > 0) {
      info(chalk.dim("MCP secret loading by tool:"));
      for (const note of secretNotes) {
        info(chalk.dim(`  ${note}`));
      }
    }
  }

  // Worktree file isolation: auto-enable when a worktree-capable tool is
  // selected; honor explicit --worktree/--no-worktree override.
  const worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));

  // W3-mcp-optin: CLI tools come from the picker step (5th prompt) unless a
  // `--cli-tools` / `--no-cli-tools` flag resolved them above. An empty
  // selection disables CLI tools (`{enabled: false, selected: []}`).
  // Detection + installer follow-up still runs on a non-empty selection so a
  // user with missing tools on PATH gets the same guidance as before.
  const selectedCliTools: CliToolId[] = explicitCliTools ?? stepState.cliTools ?? [];
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
  // Maturity no longer gates selection (Decision 16 reframe): the resolved
  // `maturity` tier is persisted to the manifest below (runInit) as a runtime
  // calibration dial, not a selection filter, so it is not threaded here.
  // D1-SA1.2-H1: thread the entry-point-parsed `cliRole`/`cliFacets` so the
  // interactive single-repo flow honours `--role` / `--facets` like `--yes`.
  const contentSelection = resolveSelection(selectedPreset, projectType, teamSize, filterIndex, customSelections, projectLanguages, { role: cliRole, facets: cliFacets });

  // Warn if orchestration-critical agents are missing from selection
  const orchWarnings = validateOrchestrationDependencies(contentSelection);
  for (const w of orchWarnings) { warn(w); }

  warnBoardPrerequisites(contentSelection);
  warnBoardDroppedForSolo(teamSize, selectedPreset, projectType, filterIndex, projectLanguages, { role: cliRole, facets: cliFacets }, contentSelection);
  // release/2.8.6 (D10-37 extension): solo+full disclosure data — see the
  // headless site for rationale.
  const teamOnlyFiltered =
    teamSize === "solo" && contentSelection.preset === "full"
      ? computeTeamOnlyFilteredItems(selectedPreset, projectType, filterIndex, projectLanguages, { role: cliRole, facets: cliFacets }, contentSelection)
      : undefined;

  await checkExisting(rootDir, false, contentSelection, opts.dryRun);
  // D1-SA1.1-02 (D1, P1): import before generation on the interactive path too,
  // so the imported overrides are present when runInit generates adapter output
  // (zero-drift immediately after init). The import's interactive dry-run
  // preview + confirm now precede the generation spinner — acceptable per the
  // finding, since a declined confirm still leaves disk untouched before init.
  await runToolImport(rootDir, opts.import, false, opts.dryRun);
  await runInit({ rootDir, platform, owner, repo, namespace, project, defaultBranch, tools, features, mcpServers, repoInfo, contentSelection, worktreeEnabled, cliTools: cliToolsConfig, yes: false, maturity, communicationStyle: resolvedCommunicationStyle, defaultEffort: cliDefaultEffort, contentFilter: cliContentFilter, teamOnlyFiltered, perPackage: opts.perPackage, conflicts: conventionConflicts, dryRun: opts.dryRun });
}

// ── Tool import (--import) ─────────────────────────────────────────

/** Sum a numeric field across a list of per-format import summaries. */
function totalAcross(
  summaries: readonly FormatImportSummary[],
  field: (s: FormatImportSummary) => number,
): number {
  return summaries.reduce((acc, s) => acc + field(s), 0);
}

/**
 * Render a per-format headline + per-path breakdown for one import summary.
 * Quiet/JSON callers route the counts through their own envelope, so this only
 * emits when `info`/`warn` are live (no-op under `setQuiet(true)`). The format
 * name leads each headline so an `auto` run reads one line per format.
 */
function renderFormatImportSummary(summary: FormatImportSummary, headlinePrefix: string): void {
  info(
    `${headlinePrefix} [${summary.format}]: ${summary.sourceFiles} source file(s) → ` +
      `${summary.converted.length} converted, ${summary.conflicts.length} conflicts, ` +
      `${summary.manualReview.length} manual-review`,
  );
  for (const c of summary.conflicts) {
    warn(`  conflict: ${c.sourcePath} — ${c.reason}`);
  }
  for (const m of summary.manualReview) {
    warn(`  manual-review: ${m.sourcePath} — ${m.reason}`);
  }
}

/**
 * Run the `--import <target>` step at the tail of init (after content selection +
 * manifest are established). A no-op when `target` is unset, so a plain init is
 * unchanged.
 *
 * - Validates `target` against {@link IMPORT_TARGETS} (throws VALIDATION_ERROR
 *   otherwise) — one of cursor, copilot, windsurf, cursorrules, or auto.
 * - Gathers existing rule ids (canonical + user) from a fresh content index so
 *   conflict detection sees both shipped rules and prior imports.
 * - Interactive (`headless === false`): dry-run first, render the per-format
 *   preview, then `inquirer` confirm before the real write. A declined confirm
 *   leaves disk untouched.
 * - Headless (`--yes`/`--json`/`--quiet`, `headless === true`): writes directly
 *   and surfaces the counts (JSON line under `--json`, summary otherwise).
 * - W5-bigfour `--dry-run` (`dryRun === true`): renders the conversion
 *   preview only (runImport in dry-run mode) and returns — no confirm prompt,
 *   no files written, on both headless and interactive paths.
 */
async function runToolImport(
  rootDir: string,
  target: string | undefined,
  headless: boolean,
  dryRun?: boolean,
): Promise<void> {
  if (target === undefined) return;

  if (!(IMPORT_TARGETS as readonly string[]).includes(target)) {
    throw new HatchError(
      `Unsupported importer: ${target}`,
      undefined,
      "VALIDATION_ERROR",
      `Supported importers: ${IMPORT_TARGETS.join(", ")}. Re-run with --import <target>.`,
    );
  }
  const importTarget = target as ImportTarget;

  // Existing rule ids (canonical + user) for conflict detection. Build a fresh
  // index that includes the project's `.hatch3r/overrides/` so a re-run detects
  // already-imported rules as conflicts rather than silently re-writing them.
  const importIndex = await buildContentIndex(resolveBundledContentRoot(), {
    userRoot: resolveUserContentRoot(rootDir),
  });
  const existingRuleIds = new Set<string>(
    importIndex.items.filter((i) => i.type === "rule").map((i) => i.id),
  );

  // W5-bigfour: under `--dry-run`, render the conversion preview and stop —
  // no confirm, no write — so `init --dry-run --import <t>` keeps the
  // zero-writes promise on every path.
  if (dryRun === true) {
    const preview = await runImport({ rootDir, target: importTarget, dryRun: true, existingRuleIds });
    if (isJson()) {
      emitJson({
        status: "dry-run",
        import: importTarget,
        formats: preview.map((r) => ({
          format: r.format,
          sourceFiles: r.sourceFiles,
          converted: r.converted.length,
          conflicts: r.conflicts.length,
          manualReview: r.manualReview.length,
        })),
      });
      return;
    }
    for (const s of preview) renderFormatImportSummary(s, "Import (dry run)");
    info("Import: dry run — no files written.");
    return;
  }

  // Interactive: dry-run preview → confirm → real write. Headless: write now.
  if (!headless && !isQuiet()) {
    const preview = await runImport({ rootDir, target: importTarget, dryRun: true, existingRuleIds });
    for (const s of preview) renderFormatImportSummary(s, "Import (preview)");
    const previewConverted = totalAcross(preview, (s) => s.converted.length);
    if (previewConverted === 0) {
      info("Import: nothing to write (no convertible rules).");
      return;
    }
    const { confirmImport } = await inquirer.prompt<{ confirmImport: boolean }>([
      {
        type: "confirm",
        name: "confirmImport",
        message: `Write ${previewConverted} imported rule(s) (.md + .mdc) to .hatch3r/overrides/rules/?`,
        default: true,
      },
    ]);
    if (!confirmImport) {
      info("Import: skipped (no files written).");
      return;
    }
  }

  const results = await runImport({ rootDir, target: importTarget, dryRun: false, existingRuleIds });

  if (isJson()) {
    console.log(
      JSON.stringify({
        import: importTarget,
        formats: results.map((r) => ({
          format: r.format,
          sourceFiles: r.sourceFiles,
          converted: r.converted.length,
          conflicts: r.conflicts.length,
          manualReview: r.manualReview.length,
          written: r.written,
        })),
      }),
    );
    return;
  }

  for (const r of results) renderFormatImportSummary(r, "Import");
  const totalWritten = totalAcross(results, (s) => s.written.length);
  if (totalWritten > 0) {
    info(chalk.dim(`  wrote ${totalWritten} file(s) under .hatch3r/overrides/rules/`));
  }
}

// ── Workspace initialization ──────────────────────────────────────

async function runWorkspaceInit(
  rootDir: string,
  detectedRepos: Awaited<ReturnType<typeof detectSubRepos>>,
  repoInfo: RepoInfo,
  opts: { tools?: string; yes?: boolean; preset?: string; projectType?: string; teamSize?: string; worktree?: boolean; cliTools?: string; noCliTools?: boolean; mcp?: boolean; noMcp?: boolean; maturity?: string; communicationStyle?: string; defaultEffort?: string; perPackage?: boolean; dryRun?: boolean },
  // D1-SA1.2-H1: the entry-point-parsed `--role` / `--facets` filters, passed
  // through so the workspace flow (headless + interactive) applies the same
  // selection filter as the single-repo flow instead of silently dropping them.
  selectionFilter: { role?: RoleId; facets: FacetId[] } = { facets: [] },
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
    // W3-mcp-optin: MCP opt-in via --mcp on any init path. Defaults empty.
    // D1-SA1.1-F13: `--no-mcp` forces empty even with `--mcp`. `features.mcp`
    // derives from the resolved list.
    const mcpServers = opts.mcp === true && !opts.noMcp ? defaultMcpServers(platform) : [];
    const features = { ...DEFAULT_FEATURES, mcp: mcpServers.length > 0 };
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
    const index = await buildContentIndex(resolveBundledContentRoot());
    const projectLanguages = languagesForSelection(repoInfo);
    // `--maturity` is validated early in runInit (no longer a selection input under Decision 16);
    // the workspace manifest persists no maturity on this path.
    // D1-SA1.2-H1: apply the forwarded role/facets even on the no-sub-repos
    // default-config path so `--workspace --role <r>` is consistent.
    const contentSelection = resolveSelection(getPreset("standard"), "brownfield", "solo", index, undefined, projectLanguages, { role: selectionFilter.role, facets: selectionFilter.facets });
    const wsManifest = createWorkspaceManifest(
      basename(rootDir) || "workspace",
      { platform, tools, features, mcp: { servers: mcpServers }, cliTools: cliToolsBase, content: contentSelection },
      [],
      "manual",
    );
    // W5-bigfour: `--dry-run` skips the workspace-manifest write.
    if (opts.dryRun === true) {
      info(`Dry run: workspace manifest (${HATCH3R_DIR}/workspace.json) not written.`);
      return;
    }
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
  // F1.1-H1 / F14.3-H1: shared workspace-level maturity resolved before
  // either headless/interactive branch so the runInit call forwards it.
  let wsMaturity: MaturityTier = DEFAULT_MATURITY_TIER;

  if (headless) {
    tools = resolveToolsFromOpts(opts.tools, repoInfo);
    // Worktree: honor explicit --worktree/--no-worktree, else auto-enable for
    // worktree-capable tools (preserves pre-1.6.1 --yes behavior).
    worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
    // W3-mcp-optin: MCP is opt-in via `--mcp` on any init path; default to
    // empty server list. Mirrors single-repo flow. D1-SA1.1-F13: `--no-mcp`
    // forces empty even with `--mcp`. `features.mcp` derives from the list.
    mcpServers = opts.mcp === true && !opts.noMcp ? defaultMcpServers(platform) : [];
    features = { ...DEFAULT_FEATURES, mcp: mcpServers.length > 0 };
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
    // Single registry id OR a comma-list to compose; a composition resolves to
    // a synthetic "custom"-id preset that round-trips via persisted content.items.
    const presetArg = validatePresetArg(opts.preset);
    const projectType = validateFlag(opts.projectType, ["greenfield", "brownfield"], wsDetection.type, "project-type");
    const teamSize = validateFlag(opts.teamSize, ["solo", "team"], "solo", "team-size");
    // F1.1-H1 / F14.3-H1: read `--maturity` (validated earlier) on the
    // headless workspace branch with canonical "solo" default.
    wsMaturity = validateFlag(opts.maturity, [...MATURITY_TIERS], DEFAULT_MATURITY_TIER, "maturity");
    const preset = resolvePresetArg(presetArg);
    const index = await buildContentIndex(resolveBundledContentRoot());
    const projectLanguages = languagesForSelection(repoInfo);
    // D1-SA1.2-H1: thread the forwarded role/facets into the headless
    // workspace selection (was dropped — `--workspace --yes --role <r>` no-op).
    contentSelection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages, { role: selectionFilter.role, facets: selectionFilter.facets });
    // D10-15 (Cycle 11): tell a solo workspace user when the board cluster was
    // dropped by the team-only filter (in-branch: preset/index are block-scoped).
    warnBoardDroppedForSolo(teamSize, preset, projectType, index, projectLanguages, { role: selectionFilter.role, facets: selectionFilter.facets }, contentSelection);
  } else {
    // Interactive workspace-wide config prompts — driven by the
    // step-machine for back-navigation. The per-repo identity-edit loop
    // and the final `syncRepos` checkbox remain outside the state
    // machine (Slice E §workspace).
    const wslTheme = isWSL()
      ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
      : undefined;

    const wsFilterIndex = await buildContentIndex(resolveBundledContentRoot());
    const projectLanguages = languagesForSelection(repoInfo);
    const wsDetection = await detectProjectType(repoInfo, rootDir);
    const wsToolDefaults = repoInfo.existingTools.length > 0 ? repoInfo.existingTools : DEFAULT_TOOLS;

    // F10.3-2 (D10, P1): workspace flow keeps the single-repo prompt-collapse.
    // projectType / teamSize / maturity / cliTools are NOT prompted here — they
    // resolve to detection / git-inference / flag defaults. NOTE: unlike the
    // single-repo flow (which re-added the maturity prompt in 2.1.0, Decision 25
    // 5→6), the workspace flow does NOT prompt maturity; it stays leaner and the
    // tier resolves to the inferred/flag default. Re-deciding this is a behavior
    // change for the workspace machine (wsSteps below), out of scope here.
    const wsInferredProjectType: "greenfield" | "brownfield" = validateFlag(
      opts.projectType,
      ["greenfield", "brownfield"],
      wsDetection.type,
      "project-type",
    );
    const wsInferredTeamSize: "solo" | "team" = validateFlag(
      opts.teamSize,
      ["solo", "team"],
      inferTeamSizeFromGit(rootDir),
      "team-size",
    );
    wsMaturity = validateFlag(opts.maturity, [...MATURITY_TIERS], DEFAULT_MATURITY_TIER, "maturity");
    // W3-mcp-optin: `--cli-tools` / `--no-cli-tools` apply on the interactive
    // workspace path too (path-independent flag semantics); an explicit
    // selection skips the picker step. The workspace platform is derived from
    // sub-repos before the machine runs, so the tier-2 suggestion set is a
    // plain array (no state thunk needed).
    const wsExplicitCliTools: CliToolId[] | undefined = opts.noCliTools
      ? []
      : resolveCliToolsFlag(opts.cliTools, repoInfo, platform);
    const wsTier2Suggested: CliToolId[] = applyPlatformTriggers(
      platform,
      evaluateTier2Triggers(repoInfo),
    );

    // The collapsed workspace prompt set: preset, customItems (conditional),
    // tools, cliTools (W3-mcp-optin: replaces the collapsed MCP multi-select).
    interface WorkspaceState {
      preset: PresetId;
      customItems: string[] | undefined;
      tools: Tool[];
      cliTools: CliToolId[];
    }

    // W2-flowsteps: composed from the shared builders in
    // `src/cli/shared/flowSteps.ts` (same composition as the single-repo
    // machine minus platform/identity, which the workspace flow derives
    // from sub-repos instead of prompting).
    const wsSteps: Array<Step<WorkspaceState>> = [
      // D10-M17 (Cycle 10 rollover): workspace flow mirrors the single-repo
      // pre-picker filter banner so the operator sees which inferred
      // projectType + teamSize drive the `(~N items)` / `(excludes M of T)`
      // counts before picking a preset.
      presetStep<WorkspaceState>({
        index: wsFilterIndex,
        projectType: wsInferredProjectType,
        teamSize: wsInferredTeamSize,
        projectLanguages,
        defaultPreset: "standard",
        customUniverseHint: true,
        banner: () =>
          info(
            chalk.dim(
              `Filters: projectType=${wsInferredProjectType}, teamSize=${wsInferredTeamSize}. ` +
                `Override with --project-type / --team-size at re-run.`,
            ),
          ),
      }),
      customItemsStep<WorkspaceState>({
        index: wsFilterIndex,
        // D10-13: floor + protected rows are locked-on by the picker itself;
        // this baseline only governs optional rows (no retired `core` tag).
        baselineChecked: () => (item) => item.protected === true,
        previousAsDefault: true,
        wslTheme,
      }),
      // release/2.8.5 (BUG-3): required-selection semantics replace the
      // silent DEFAULT_TOOLS substitution (see the single-repo machine note).
      toolsStep<WorkspaceState>({
        defaults: wsToolDefaults,
        wslTheme,
      }),
      // W3-mcp-optin: CLI-tools picker (workspace parity with the single-repo
      // flow; the collapsed MCP multi-select moved behind `--mcp` /
      // `hatch3r mcp setup`). Tier-2 suggestions close over the workspace
      // platform derived from sub-repos above. Skipped when `--cli-tools` /
      // `--no-cli-tools` resolved an explicit selection.
      ...(wsExplicitCliTools === undefined
        ? [
            cliToolsStep<WorkspaceState>({
              tier2Suggested: wsTier2Suggested,
              wslTheme,
            }),
          ]
        : []),
    ];

    const wsState = await runStepMachine<WorkspaceState>(wsSteps);

    const projectType = wsInferredProjectType;
    const teamSize = wsInferredTeamSize;
    // wsMaturity resolved above from `--maturity` / git / default.
    const selectedPreset = getPreset(wsState.preset);
    const customSelections = wsState.customItems;
    tools = wsState.tools;

    // W3-mcp-optin: MCP no longer prompts on the interactive workspace path;
    // `--mcp` (minus `--no-mcp`) resolves the platform default server set,
    // mirroring the single-repo flow. `features.mcp` derives from the list.
    mcpServers = opts.mcp === true && !opts.noMcp ? defaultMcpServers(platform) : [];
    features = { ...DEFAULT_FEATURES, mcp: mcpServers.length > 0 };

    // C9-H32 (D10-SA10.5-F2): Surface per-editor MCP secret-loading
    // divergence at tool-selection time — before commit — matching the
    // single-repo flow. Workspace parity prevents user surprise.
    // W3-mcp-optin: gated on an actual MCP opt-in (no MCP, no MCP secrets).
    if (mcpServers.length > 0) {
      const wsSecretNotes = tools.map((t) => TOOL_SECRET_NOTES[t]).filter(Boolean);
      if (wsSecretNotes.length > 0) {
        info(chalk.dim("MCP secret loading by tool:"));
        for (const note of wsSecretNotes) {
          info(chalk.dim(`  ${note}`));
        }
      }
    }

    worktreeEnabled = opts.worktree ?? tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));

    // W3-mcp-optin: CLI tools come from the picker step unless a flag
    // resolved them; empty selection disables CLI tools.
    const wsSelectedCliTools: CliToolId[] = wsExplicitCliTools ?? wsState.cliTools ?? [];
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

    // D1-SA1.2-H1: thread the forwarded role/facets into the interactive
    // workspace selection (was dropped — `--workspace --role <r>` no-op).
    contentSelection = resolveSelection(selectedPreset, projectType, teamSize, wsFilterIndex, customSelections, projectLanguages, { role: selectionFilter.role, facets: selectionFilter.facets });
    // D10-15 (Cycle 11): tell a solo workspace user when the board cluster was
    // dropped by the team-only filter (in-branch: selectedPreset/wsFilterIndex
    // are block-scoped to this interactive branch).
    warnBoardDroppedForSolo(teamSize, selectedPreset, projectType, wsFilterIndex, projectLanguages, { role: selectionFilter.role, facets: selectionFilter.facets }, contentSelection);
  }

  // Warn if orchestration-critical agents are missing from selection
  const orchWarnings = validateOrchestrationDependencies(contentSelection);
  for (const w of orchWarnings) { warn(w); }

  warnBoardPrerequisites(contentSelection);

  // 2.8.0: resolve the flag-only additive scalars for the workspace-root
  // manifest, mirroring the wsMaturity forwarding below (validated eagerly in
  // initCommand already; re-validated here for direct callers).
  const wsCommunicationStyle: CommunicationStyle | undefined =
    opts.communicationStyle !== undefined
      ? validateFlag(opts.communicationStyle, [...COMMUNICATION_STYLES], DEFAULT_COMMUNICATION_STYLE, "communication-style")
      : undefined;
  const wsDefaultEffort: OrchestrationEffort | undefined =
    opts.defaultEffort !== undefined
      ? validateFlag(opts.defaultEffort, [...ORCHESTRATION_EFFORTS], "standard", "default-effort")
      : undefined;

  // Step 6: Create canonical .agents/ at workspace root (empty identity — workspace root is not a repo)
  await checkExisting(rootDir, headless, contentSelection, opts.dryRun);
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
    // F1.1-H1 / F14.3-H1: forward the resolved workspace maturity tier
    // to the workspace runInit call so the workspace root manifest
    // persists it.
    maturity: wsMaturity,
    // 2.8.0: forward the flag-only additive scalars alongside maturity.
    communicationStyle: wsCommunicationStyle,
    defaultEffort: wsDefaultEffort,
    // release/2.8.5 (BUG-4): persist the effective --role/--facets filter on
    // the workspace-root manifest too (same shape as the single-repo paths).
    contentFilter:
      selectionFilter.role !== undefined || selectionFilter.facets.length > 0
        ? {
            ...(selectionFilter.role !== undefined ? { role: selectionFilter.role } : {}),
            ...(selectionFilter.facets.length > 0 ? { facets: selectionFilter.facets } : {}),
          }
        : undefined,
    // D14-SA14.2-H1: forward the per-package opt-in to the workspace-root init.
    perPackage: opts.perPackage,
    // W5-bigfour: forward `--dry-run` so the workspace-root init previews
    // adapter output without writing.
    dryRun: opts.dryRun,
  });

  // W5-bigfour: `--dry-run` terminus for the workspace flow — the runInit
  // call above already rendered the per-tool would-write preview; the
  // remaining steps (workspace-manifest write, sub-repo sync) are writes, so
  // skip them and stop. The sync-selection prompts are part of the skipped
  // write phase and are skipped with it.
  if (opts.dryRun === true) {
    info(`Dry run: ${HATCH3R_DIR}/workspace.json write and sub-repo sync skipped.`);
    return;
  }

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
    // D10-SA10.6-F10.6-9: workspace-flow parity with the single-repo payload —
    // escalate `status` to "warning" when orchestration-dependency warnings
    // exist so a CI caller running `hatch3r init --workspace --yes --json` can
    // grep the same signal.
    const wsJsonOrchWarnings = validateOrchestrationDependencies(contentSelection);
    const wsJsonStatus: "ok" | "warning" = wsJsonOrchWarnings.length > 0 ? "warning" : "ok";
    const payload = {
      status: wsJsonStatus,
      orchestrationWarnings: wsJsonOrchWarnings,
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
      manifestPath: `${HATCH3R_DIR}/workspace.json`,
    };
    // W5-bigfour (P1): single-document JSON contract — emit via the shared
    // emitJson funnel (process.stdout.write + one trailing newline) so the
    // payload shape and serialization match every other `--format json`
    // command. Field names are unchanged.
    emitJson(payload);
    return;
  }

  if (!isQuiet()) {
    console.log();
  }
  const wsLines = [
    label("Mode", "workspace"),
    label("Repos", `${repoEntries.length} registered, ${syncCount} synced`),
    label("Strategy", "manual (use hatch3r sync --repos to propagate)"),
    label("Manifest", `${HATCH3R_DIR}/workspace.json`),
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
        undefined,
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
      undefined,
      "VALIDATION_ERROR",
      "Re-run with --cli-tools=tier1, --cli-tools=all, or a comma-separated subset of valid ids (run `hatch3r cli-tools list` to see them).",
    );
  }
  return rawIds;
}
