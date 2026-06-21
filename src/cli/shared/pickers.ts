import inquirer from "inquirer";
import chalk from "chalk";
import {
  AVAILABLE_CLI_TOOLS,
  TIER1_CLI_TOOLS,
  TIER2_CLI_TOOLS_BY_TRIGGER,
  TIER3_CLI_TOOLS,
  type CliToolMeta,
} from "../../cliTools/registry.js";
import type { CliToolId, Platform } from "../../types.js";
import { MCP_CHOICES, PLATFORM_MCP_SERVER } from "./constants.js";
import { BACK, isBack, type Back } from "./initSteps.js";

/**
 * Shared inquirer pickers extracted from `init.ts` and `config.ts` so the
 * new `mcp` and `cli-tools` side-door commands (plan §4.5) reuse the same
 * UX. The pickers stay UI-only: no manifest reads/writes happen here.
 *
 * Wave 3 (plan §4.5 / §7 item 14): consolidating these choices in one
 * module removes the duplicated MCP-picker prompt between init, config,
 * and the new `hatch3r mcp setup` entry-point.
 */

type CliToolChoice =
  | InstanceType<typeof inquirer.Separator>
  | { name: string; value: CliToolId; checked: boolean };

/** Tier label used in the grouped CLI-tools picker. */
function tierSeparator(tier: 1 | 2 | 3): InstanceType<typeof inquirer.Separator> {
  const label =
    tier === 1
      ? "── Tier 1 — default-on ──"
      : tier === 2
        ? "── Tier 2 — conditional ──"
        : "── Tier 3 — opt-in advanced ──";
  return new inquirer.Separator(label);
}

/**
 * Render one CLI tool as an inquirer-checkbox choice. Tools with a
 * `caveat` (e.g. RTK pipe-output corruption) are decorated with a leading
 * warning glyph so the user sees the risk at picker time.
 */
function toolChoice(meta: CliToolMeta, preChecked: boolean): {
  name: string;
  value: CliToolId;
  checked: boolean;
} {
  const caveat = meta.caveat ? `${chalk.yellow("⚠")} ` : "";
  const description = meta.description;
  return {
    name: `${caveat}${meta.id} — ${description}`,
    value: meta.id,
    checked: preChecked,
  };
}

export interface PickCliToolsOptions {
  /** Current selection from `manifest.cliTools?.selected` (defaults to `[]`). */
  existing?: CliToolId[];
  /** Tier-2 tools suggested by `evaluateTier2Triggers(repoInfo)` + platform triggers. */
  tier2Suggested?: CliToolId[];
  /** WSL-friendly inquirer theme (passed through unchanged). */
  wslTheme?: unknown;
}

/**
 * Render the 3-tier CLI-tools picker (plan §4.3 step 2). Returns the
 * selected ids. Selection precedence (highest wins):
 *  - Item in `existing` → pre-checked.
 *  - Tier-1 id (always) → pre-checked when no `existing` is provided.
 *  - Tier-2 id in `tier2Suggested` → pre-checked when no `existing` is
 *    provided.
 *  - Tier-3 id → never pre-checked (must be explicit).
 *
 * Caveat-bearing tools (currently only RTK) render with a leading
 * warning glyph so users opt-in with eyes open.
 */
export async function pickCliTools(opts: PickCliToolsOptions = {}): Promise<CliToolId[] | Back> {
  const existingSet = new Set<CliToolId>(opts.existing ?? []);
  const suggestedSet = new Set<CliToolId>(opts.tier2Suggested ?? []);
  const hasExistingSelection = (opts.existing?.length ?? 0) > 0;

  const tier1Choices: ReturnType<typeof toolChoice>[] = [];
  const tier2Choices: ReturnType<typeof toolChoice>[] = [];
  const tier3Choices: ReturnType<typeof toolChoice>[] = [];

  for (const id of TIER1_CLI_TOOLS) {
    const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
    if (!meta) continue;
    const checked = hasExistingSelection ? existingSet.has(id) : true;
    tier1Choices.push(toolChoice(meta, checked));
  }

  // Tier 2 — group all by trigger order, dedupe, surface every tool.
  const seenTier2 = new Set<CliToolId>();
  for (const ids of Object.values(TIER2_CLI_TOOLS_BY_TRIGGER)) {
    for (const id of ids) {
      if (seenTier2.has(id)) continue;
      seenTier2.add(id);
      const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
      if (!meta) continue;
      const checked = hasExistingSelection
        ? existingSet.has(id)
        : suggestedSet.has(id);
      tier2Choices.push(toolChoice(meta, checked));
    }
  }

  for (const id of TIER3_CLI_TOOLS) {
    const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
    if (!meta) continue;
    const checked = hasExistingSelection && existingSet.has(id);
    tier3Choices.push(toolChoice(meta, checked));
  }

  // inquirer.Separator yields a non-selectable header row so the tier
  // grouping survives in the picker. See `customContentChoices.ts` for
  // the same pattern applied to canonical content tags.
  const choices: CliToolChoice[] = [
    tierSeparator(1),
    ...tier1Choices,
    tierSeparator(2),
    ...tier2Choices,
    tierSeparator(3),
    ...tier3Choices,
  ];

  const themeOption = opts.wslTheme ? { theme: opts.wslTheme } : {};

  const { tools } = await inquirer.prompt<{ tools: CliToolId[] | Back }>([
    {
      type: "checkbox",
      name: "tools",
      message: "Select CLI tools (default tier-1 + project-triggered tier-2):",
      choices,
      ...themeOption,
    },
  ]);

  if (isBack(tools)) return BACK;
  return (tools ?? []) as CliToolId[];
}

export interface PickMcpServersOptions {
  /** Active platform — drives the MCP server prepended to the result. */
  platform: Platform;
  /** Current selection from `manifest.mcp.servers` (defaults to `[]`). */
  existing?: string[];
  /** WSL-friendly inquirer theme. */
  wslTheme?: unknown;
}

/**
 * Open the MCP server picker. Mirrors the historical logic that lived in
 * init.ts / config.ts (plan §4.5 deduplication). The platform-specific
 * MCP server is always prepended when missing so a `gitlab`-platform
 * project ends up with `gitlab` first in `manifest.mcp.servers` even if
 * the user untoggled it.
 */
export async function pickMcpServers(opts: PickMcpServersOptions): Promise<string[] | Back> {
  const platformMcp = PLATFORM_MCP_SERVER[opts.platform];
  const defaultSelection = opts.existing && opts.existing.length > 0
    ? opts.existing
    : Array.from(new Set([platformMcp, "playwright", "context7"]));

  const themeOption = opts.wslTheme ? { theme: opts.wslTheme } : {};

  const { mcp } = await inquirer.prompt<{ mcp: string[] | Back }>([
    {
      type: "checkbox",
      name: "mcp",
      message: "Select MCP servers:",
      choices: MCP_CHOICES,
      default: defaultSelection,
      ...themeOption,
    },
  ]);
  if (isBack(mcp)) return BACK;
  const servers = (mcp ?? []) as string[];
  if (!servers.includes(platformMcp)) {
    servers.unshift(platformMcp);
  }
  return servers;
}

export interface ConfirmMcpGateOptions {
  /** Whether the manifest already has MCP servers configured. */
  hasExisting: boolean;
  /** Optional override for the confirm default (otherwise inferred from `hasExisting`). */
  defaultYes?: boolean;
}

/**
 * The new Yes/No MCP gate (plan §4.3 step 8 / §4.4). Default `No` for
 * fresh installs, default `Yes` for existing configs so re-runs don't
 * silently zero out an MCP setup the user already chose. Returns the
 * user's confirm answer; callers decide whether to open
 * `pickMcpServers` based on the return.
 */
export async function confirmMcpGate(opts: ConfirmMcpGateOptions): Promise<boolean | Back> {
  const defaultYes = opts.defaultYes ?? opts.hasExisting;
  const { proceed } = await inquirer.prompt<{ proceed: boolean | Back }>([
    {
      type: "confirm",
      name: "proceed",
      message: "Configure MCP servers? (opt-in; manage later with `hatch3r mcp setup`)",
      default: defaultYes,
    },
  ]);
  if (isBack(proceed)) return BACK;
  return proceed as boolean;
}
