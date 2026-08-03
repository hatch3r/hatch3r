/**
 * Shared step builders for the `hatch3r init` and `hatch3r config`
 * interactive step machines (W2-flowsteps extraction).
 *
 * Sits between the machine driver (`initSteps.ts::runStepMachine`) and the
 * prompt primitives (`pickers.ts`, `repoIdentityPrompt.ts`,
 * `customContentChoices.ts`). Each builder is a factory returning the
 * {@link StepFor} shape the driver executes, generic over any state object
 * with the matching slot, so init's `SingleRepoState`, init's
 * `WorkspaceState`, and config's `ConfigState` all compose the same
 * implementations.
 *
 * Pure-refactor invariants (verified by the init/config test answer-queues,
 * which pass unmodified):
 *  - Prompt `name` keys, copy, choice rendering, defaults, skip predicates,
 *    and BACK threading are identical to the pre-extraction inline steps.
 *  - Defaults are INJECTED by the caller (git/detection values for init,
 *    manifest values for config) — builders never read the manifest.
 *  - `previous`-value threading on BACK-revisit lives inside each builder.
 */
import inquirer from "inquirer";
import { BACK, isBack, type StepFor, type StepResult } from "./initSteps.js";
import { promptRepoIdentity, type RepoIdentity } from "./repoIdentityPrompt.js";
import { TOOL_PROMPT_CHOICES } from "./constants.js";
import { confirmMcpGate, pickCliTools, pickMcpServers } from "./pickers.js";
import { buildTagGroupedCustomContentChoices } from "./customContentChoices.js";
import { PRESETS, type PresetId } from "../../content/presets.js";
import {
  countPresetExclusions,
  estimatePresetItemCount,
  presetOmittedClusters,
  type CatalogItem,
  type ContentIndex,
} from "../../content/index.js";
import {
  HatchError,
  type CliToolId,
  type CommunicationStyle,
  type ConfidenceFloor,
  type MaturityTier,
  type Platform,
  type TeamSize,
  type Tool,
} from "../../types.js";

// Leaf casts like `answer.platform as TState["platform"]` close the
// generic seam: the builder's constraint (`TState extends { platform:
// Platform }`) guarantees the slot type, but TS cannot correlate a
// concrete value back to the indexed-access type. Mirrors the documented
// seam cast in `initSteps.ts::runStepMachine`.

// ── platform ────────────────────────────────────────────────────────

export interface PlatformStepOptions {
  /** Prompt copy — init: "Select your platform:"; config: "Platform:". */
  message: string;
  /** First-visit default (init: git-remote detection; config: manifest). */
  defaultPlatform: Platform;
}

/** Single-select platform picker (`name: "platform"`). */
export function platformStep<TState extends { platform: Platform }>(
  opts: PlatformStepOptions,
): StepFor<TState, "platform"> {
  return {
    id: "platform",
    async run(_state, previous): Promise<StepResult<TState["platform"]>> {
      const answer = await inquirer.prompt<{ platform: Platform | typeof BACK }>([
        {
          type: "select",
          name: "platform",
          message: opts.message,
          choices: [
            { name: "GitHub", value: "github" as Platform },
            { name: "Azure DevOps", value: "azure-devops" as Platform },
            { name: "GitLab", value: "gitlab" as Platform },
          ],
          default: previous ?? opts.defaultPlatform,
        },
      ]);
      return isBack(answer.platform) ? BACK : (answer.platform as TState["platform"]);
    },
  };
}

// ── identity ────────────────────────────────────────────────────────

export interface IdentityStepOptions {
  /** Git-remote parser hints (init single-repo flow). */
  remote?: { owner?: string; repo?: string };
  /**
   * Persisted identity defaults (config: manifest owner/repo/namespace/
   * project), consulted after `previous` and before `remote` — see
   * `RepoIdentityDefaults.seed` for the per-branch resolution.
   */
  seed?: Partial<RepoIdentity>;
}

/**
 * Platform-aware repo-identity prompt. Delegates to the shared
 * `promptRepoIdentity` helper (D1-M4) so the 3-branch GitHub / Azure
 * DevOps / GitLab flow stays single-sourced. Reads `state.platform`, so
 * it must be sequenced after a platform step.
 */
export function identityStep<TState extends { platform: Platform; identity: RepoIdentity }>(
  opts: IdentityStepOptions = {},
): StepFor<TState, "identity"> {
  return {
    id: "identity",
    async run(state, previous): Promise<StepResult<TState["identity"]>> {
      const result = await promptRepoIdentity(state.platform!, {
        previous,
        seed: opts.seed,
        remote: opts.remote,
      });
      return result as StepResult<TState["identity"]>;
    },
  };
}

// ── preset ──────────────────────────────────────────────────────────

export interface PresetStepOptions<TState extends object> {
  /** Content index driving the per-choice counts (caller-built). */
  index: ContentIndex;
  projectType: "greenfield" | "brownfield";
  /**
   * Team size for the per-choice item-count estimate. A thunk resolves it
   * from the in-progress state at prompt time — config passes
   * `(s) => s.teamSize ?? persisted` so a team-size flip made EARLIER in the
   * same run (the teamSizeStep is sequenced before this one) is reflected in
   * the "(~N items)" counts instead of estimating with the stale persisted
   * value (the release/2.8.5 BUG-4 estimate/resolution-disagreement class).
   * Machines that resolve team size before the machine runs (init) pass the
   * computed literal directly.
   */
  teamSize: "solo" | "team" | ((state: Partial<TState>) => "solo" | "team");
  /**
   * Language filter for the item-count estimate. init passes the detected
   * set; config passes `manifest.languages` (release/2.8.5 BUG-4 alignment —
   * both flows estimate with the same filters they resolve with).
   */
  projectLanguages?: string[];
  /** Estimate options (no current caller passes them; kept for API parity with estimatePresetItemCount). */
  estimateOptions?: { skipContextFilters?: boolean };
  /**
   * First-visit default. A thunk defers reads off optional sources —
   * config passes `() => manifest.content!.preset` and relies on its
   * `skip` guard to make the non-null access safe.
   */
  defaultPreset: PresetId | (() => PresetId);
  /**
   * Render the `custom` row with the "(N items to choose from)" universe
   * hint (D1-SA1.1-F11 — init flows). Config's picker omits it.
   */
  customUniverseHint?: boolean;
  /** Printed at the top of every run (init: the D10-M17 `Filters:` line). */
  banner?: () => void;
  skip?: (state: Partial<TState>) => boolean;
}

/** Single-select content-profile picker (`name: "preset"`). */
export function presetStep<TState extends { preset: PresetId }>(
  opts: PresetStepOptions<TState>,
): StepFor<TState, "preset"> {
  return {
    id: "preset",
    skip: opts.skip,
    async run(state, previous): Promise<StepResult<TState["preset"]>> {
      opts.banner?.();
      const totalItems = opts.index.items.length;
      const resolvedTeamSize =
        typeof opts.teamSize === "function" ? opts.teamSize(state) : opts.teamSize;
      const answer = await inquirer.prompt<{ preset: PresetId | typeof BACK }>([
        {
          type: "select",
          name: "preset",
          message: "Select content profile:",
          choices: PRESETS.map((p) => {
            const excluded = countPresetExclusions(p, opts.index);
            const estimated =
              p.id !== "custom"
                ? estimatePresetItemCount(
                    p,
                    opts.projectType,
                    resolvedTeamSize,
                    opts.index,
                    opts.projectLanguages,
                    opts.estimateOptions,
                  )
                : 0;
            // D1-SA1.1-F11: the `custom` preset has no estimable fixed count
            // (the user picks per-item) — init flows surface the size of the
            // choose-from universe instead.
            const countHint =
              opts.customUniverseHint && p.id === "custom"
                ? ` (${totalItems} items to choose from)`
                : estimated > 0
                  ? ` (~${estimated} items)`
                  : "";
            const suffix = excluded > 0 ? ` (excludes ${excluded} of ${totalItems})` : "";
            // F10.6-1 (D10): name WHAT each preset drops, not just a count.
            // D10-12 (Cycle 11): derive the labels from the realized
            // post-floor selection delta via presetOmittedClusters — the
            // static `p.omits` field is capability *intent* and over-states
            // drops because floor-tagged items ship regardless of preset.
            const omittedClusters = presetOmittedClusters(p, opts.index);
            const omitLine = omittedClusters.length ? `omits: ${omittedClusters.join(", ")}` : undefined;
            // D10-SA10.6-05: the `omits:` detail is the choice `description`,
            // not part of `name`, on purpose — @inquirer/select renders
            // `description` only under the highlighted row (progressive
            // disclosure), while the `(excludes N of M)` count stays in `name`
            // so the magnitude is visible for every row at a glance. Note the
            // preset id `minimal` (presets.ts) is distinct from the unrelated
            // generation-mode `minimal` (adapter `generate(..., "minimal")`
            // verbosity strip) — a known naming overload, not a bug.
            return {
              name: `${p.name} — ${p.description}${countHint}${suffix}`,
              value: p.id,
              description: omitLine,
            };
          }),
          default:
            previous ??
            (typeof opts.defaultPreset === "function" ? opts.defaultPreset() : opts.defaultPreset),
        },
      ]);
      return isBack(answer.preset) ? BACK : (answer.preset as TState["preset"]);
    },
  };
}

// ── customItems ─────────────────────────────────────────────────────

export interface CustomItemsStepOptions<TState extends object> {
  /** Items rendered by the tag-grouped picker. */
  index: { items: CatalogItem[] };
  /**
   * Per-visit factory for the checked baseline. Receives `previous` (the
   * BACK-revisit answer) so callers can bake prior answers into `checked`
   * (config) or ignore it and thread via `previousAsDefault` (init). The
   * factory runs exactly once per visit — config's `getAllContentIds`
   * call count (the configHelpers `stubContentIdsTransition` contract)
   * depends on this.
   */
  baselineChecked: (previous: string[] | undefined) => (item: CatalogItem) => boolean;
  /** Thread `previous` via inquirer `default:` (init flows). */
  previousAsDefault?: boolean;
  wslTheme?: unknown;
  /**
   * Extra skip ORed with the built-in `preset !== "custom"` guard
   * (config: `() => !manifest.content`).
   */
  extraSkip?: (state: Partial<TState>) => boolean;
}

/**
 * Conditional multi-select over canonical content items (`name: "items"`).
 * Built-in skip: runs only when the resolved preset is `custom`.
 */
export function customItemsStep<
  TState extends { preset: PresetId; customItems: string[] | undefined },
>(opts: CustomItemsStepOptions<TState>): StepFor<TState, "customItems"> {
  return {
    id: "customItems",
    skip: (s) => (opts.extraSkip ? opts.extraSkip(s) : false) || s.preset !== "custom",
    async run(_state, previous): Promise<StepResult<TState["customItems"]>> {
      // release/2.8.5 (BUG-2): an empty index used to reach the checkbox
      // renderer, which threw the opaque upstream ValidationError
      // "[backable-checkbox] No selectable choices — all are disabled."
      // (non-TTY: an equally opaque @inquirer/checkbox error). Fail first
      // with an actionable error naming the real problem and the recovery.
      if (opts.index.items.length === 0) {
        throw new HatchError(
          "Custom content selection has 0 items to choose from — the content index is empty.",
          undefined,
          "CONFIG_ERROR",
          "The bundled canonical content could not be indexed. Reinstall hatch3r " +
            "(`npm i -g hatch3r`) or run `npm run build` in a source checkout, then re-run. " +
            "A non-custom preset (e.g. `--preset standard`) also fails until the content is restored.",
        );
      }
      const groupedChoices = buildTagGroupedCustomContentChoices(
        opts.index.items,
        opts.baselineChecked(previous),
      );
      const themeOption = opts.wslTheme ? { theme: opts.wslTheme } : {};
      const customAnswer = await inquirer.prompt<{ items: string[] | typeof BACK }>([
        {
          type: "checkbox",
          name: "items",
          message: "Select content items:",
          choices: groupedChoices,
          ...(opts.previousAsDefault && previous ? { default: previous } : {}),
          ...themeOption,
        },
      ]);
      if (isBack(customAnswer.items)) return BACK;
      return (customAnswer.items ?? []) as TState["customItems"];
    },
  };
}

// ── tools ───────────────────────────────────────────────────────────

export interface ToolsStepOptions {
  /**
   * First-visit default (init: detected existing tools or DEFAULT_TOOLS;
   * config: `manifest.tools`).
   */
  defaults: Tool[];
  wslTheme?: unknown;
}

/**
 * Multi-select editor-tool picker (`name: "tools"`).
 *
 * release/2.8.5 (BUG-3): two changes vs the 2.8.0 shape.
 * 1. The active default (`previous ?? defaults`) is ALSO baked into each
 *    choice's `checked` flag, so the pre-selection renders even through a
 *    prompt implementation that ignores `default` (the upstream
 *    `@inquirer/checkbox` has no `default` support; the backable fork now
 *    seeds from it too — belt and suspenders).
 * 2. The former `emptyFallback` option is gone: an empty submission was
 *    silently rewritten to `["claude"]` on init, generating a setup the user
 *    never picked (Silent Failure Contract violation). Both init and config
 *    now share required-selection semantics — `required: true` re-prompts in
 *    a real TTY ("At least one choice must be selected"), and a
 *    non-interactive resolution that still yields [] throws a
 *    VALIDATION_ERROR instead of silently substituting a tool.
 */
export function toolsStep<TState extends { tools: Tool[] }>(
  opts: ToolsStepOptions,
): StepFor<TState, "tools"> {
  return {
    id: "tools",
    async run(_state, previous): Promise<StepResult<TState["tools"]>> {
      const themeOption = opts.wslTheme ? { theme: opts.wslTheme } : {};
      const active = previous ?? opts.defaults;
      const toolAnswers = await inquirer.prompt<{ tools: Tool[] | typeof BACK }>([
        {
          type: "checkbox",
          name: "tools",
          message: "Select tools to configure:",
          choices: TOOL_PROMPT_CHOICES.map((c) => ({
            ...c,
            checked: active.includes(c.value),
          })),
          default: active,
          required: true,
          ...themeOption,
        },
      ]);
      if (isBack(toolAnswers.tools)) return BACK;
      const filtered = (toolAnswers.tools ?? []) as Tool[];
      if (filtered.length === 0) {
        // TTY runs never reach this (required: true re-prompts); it fires for
        // mocked/non-interactive resolutions that answered [].
        throw new HatchError(
          "At least one tool must be selected.",
          undefined,
          "VALIDATION_ERROR",
          "Select at least one of claude, cursor, or copilot (space toggles, enter confirms), " +
            "or pass an explicit `--tools <list>` on headless runs.",
        );
      }
      return filtered as TState["tools"];
    },
  };
}

// ── cliTools ────────────────────────────────────────────────────────

export interface CliToolsStepOptions<TState extends object = object> {
  /** Persisted selection (config: `manifest.cliTools?.selected`). */
  existing?: CliToolId[];
  /**
   * Tier-2 suggestion set. Init's single-repo machine passes a thunk over
   * the in-progress state because the suggestions derive from the platform
   * chosen in an EARLIER step (`applyPlatformTriggers(state.platform, ...)`);
   * machines that resolve the platform before the machine runs (workspace)
   * pass the computed array directly.
   */
  tier2Suggested?: CliToolId[] | ((state: Partial<TState>) => CliToolId[]);
  wslTheme?: unknown;
}

/**
 * 3-tier CLI-tools picker — delegates to `pickCliTools` (which prompts
 * under `name: "tools"`, see `pickers.ts`). `previous` wins over the
 * injected `existing` selection on BACK-revisit.
 */
export function cliToolsStep<TState extends { cliTools: CliToolId[] }>(
  opts: CliToolsStepOptions<TState> = {},
): StepFor<TState, "cliTools"> {
  return {
    id: "cliTools",
    async run(state, previous): Promise<StepResult<TState["cliTools"]>> {
      const existingCliTools = previous ?? opts.existing ?? [];
      const tier2Suggested =
        typeof opts.tier2Suggested === "function" ? opts.tier2Suggested(state) : opts.tier2Suggested;
      const result = await pickCliTools({
        existing: existingCliTools,
        tier2Suggested,
        wslTheme: opts.wslTheme,
      });
      return result as StepResult<TState["cliTools"]>;
    },
  };
}

// ── mcpGate ─────────────────────────────────────────────────────────

export interface McpGateStepOptions<TState extends object = object> {
  /**
   * Whether the manifest already has MCP servers configured. Re-running
   * config with no prior MCP servers defaults the confirm to No; with
   * existing servers it defaults to Yes so users don't accidentally wipe
   * their MCP setup by accepting the default (`confirmMcpGate` semantics).
   */
  hasExisting: boolean;
  /**
   * release/2.8.5 (BUG-4): skip predicate injected by the caller. The
   * pre-2.8.5 built-in skip read the in-run `features` checkbox answer, but
   * the config features prompt was removed (init never had one — the parity
   * fix), so the gate condition now derives from the PERSISTED
   * `manifest.features.mcp` the caller closes over. MCP opt-in lives behind
   * `hatch3r mcp setup` / `init --mcp`.
   */
  skip?: (state: Partial<TState>) => boolean;
}

/**
 * Yes/No MCP gate (`name: "proceed"` via `confirmMcpGate`). `previous` is
 * intentionally not threaded — the confirm default derives from
 * `hasExisting`, matching the pre-extraction config step.
 */
export function mcpGateStep<TState extends { mcpGate: boolean }>(
  opts: McpGateStepOptions<TState>,
): StepFor<TState, "mcpGate"> {
  return {
    id: "mcpGate",
    skip: opts.skip,
    async run(): Promise<StepResult<TState["mcpGate"]>> {
      const result = await confirmMcpGate({ hasExisting: opts.hasExisting });
      return result as StepResult<TState["mcpGate"]>;
    },
  };
}

// ── mcpServers ──────────────────────────────────────────────────────

export interface McpServersStepOptions<TState extends object> {
  /**
   * Resolve the active platform at run time. Machines with a `platform`
   * slot pass `(s) => s.platform!`; the workspace machine (no platform
   * slot) passes a constant accessor over its derived platform.
   */
  platform: (state: Partial<TState>) => Platform;
  wslTheme?: unknown;
  skip?: (state: Partial<TState>) => boolean;
  /**
   * Config's gated picker: delegates to `pickMcpServers`
   * (manifest-seeded default, platform server always prepended).
   * `previous` is not threaded — `pickMcpServers` derives its default
   * from `existing`, matching the pre-extraction config step.
   */
  existing: string[];
}

/**
 * MCP-server multi-select (`name: "mcp"`), delegating to `pickMcpServers`.
 * W3-mcp-optin: init no longer prompts for MCP servers (the collapsed
 * multi-select moved behind `hatch3r mcp setup` / `init --mcp`), so the
 * config-style gated picker is the only shape.
 */
export function mcpServersStep<TState extends { mcpServers: string[] }>(
  opts: McpServersStepOptions<TState>,
): StepFor<TState, "mcpServers"> {
  return {
    id: "mcpServers",
    skip: opts.skip,
    async run(state): Promise<StepResult<TState["mcpServers"]>> {
      const result = await pickMcpServers({
        platform: opts.platform(state),
        existing: opts.existing,
        wslTheme: opts.wslTheme,
      });
      return result as StepResult<TState["mcpServers"]>;
    },
  };
}

// ── teamSize ────────────────────────────────────────────────────────

export interface TeamSizeStepOptions<TState extends object = object> {
  /** Prompt copy — config: "Team size (content scope):". */
  message: string;
  /**
   * First-visit default. config injects the persisted
   * `manifest.content.teamSize`. Builders never read the manifest.
   */
  defaultTeamSize: TeamSize;
  skip?: (state: Partial<TState>) => boolean;
}

/**
 * Single-select team-size picker (`name: "teamSize"`, release/2.8.6). This is
 * the `ctx:team-only` CONTENT gate (`resolveSelection` Stage 4), not the
 * maturity investment dial — the choice copy names the consequence so the two
 * "team" knobs stay distinguishable (D14-SA14.3-03). config-only today: init
 * infers team size from git history (`inferTeamSizeFromGit`) to stay at its
 * ≤6-prompt ceiling (Decision 25), so the config step + the scalar
 * `config team_size=<v>` form are the post-init levers.
 */
export function teamSizeStep<TState extends { teamSize: TeamSize }>(
  opts: TeamSizeStepOptions<TState>,
): StepFor<TState, "teamSize"> {
  return {
    id: "teamSize",
    skip: opts.skip,
    async run(_state, previous): Promise<StepResult<TState["teamSize"]>> {
      const answer = await inquirer.prompt<{ teamSize: TeamSize | typeof BACK }>([
        {
          type: "select",
          name: "teamSize",
          message: opts.message,
          choices: [
            {
              name: "solo — single maintainer; team-only workflows (e.g. board and PR flows) are filtered from the selection",
              value: "solo" as TeamSize,
            },
            {
              name: "team — shared repo; team-only (ctx:team-only) workflows join the selection",
              value: "team" as TeamSize,
            },
          ],
          default: previous ?? opts.defaultTeamSize,
        },
      ]);
      return isBack(answer.teamSize) ? BACK : (answer.teamSize as TState["teamSize"]);
    },
  };
}

// ── maturity ────────────────────────────────────────────────────────

export interface MaturityStepOptions {
  /** Prompt copy — init: "Project maturity (investment depth):"; config: "Maturity tier:". */
  message: string;
  /**
   * First-visit default. init injects the git-inferred tier
   * (`inferTeamSizeFromGit`-seeded); config injects the persisted
   * `readMaturityTier(manifest)` value. Builders never read the manifest.
   */
  defaultMaturity: MaturityTier;
}

/**
 * Single-select maturity-tier picker (`name: "maturity"`). The choice copy
 * names what each tier adds on top of the universal floor (see the
 * `MaturityTier` JSDoc in `src/types.ts`); the tier is an investment dial, not
 * a content gate (Decision 16). The `team` row's copy cross-references
 * `--team-size` (the actual `ctx:team-only` content gate) so a large-team lead
 * does not mistake this investment tier for the content-scoping knob — the two
 * knobs both spell "team" but are orthogonal (D14-SA14.3-03). Used by both the
 * init single-repo machine (the 4th of ≤6 interactive prompts; Decision 25
 * raised the ceiling 5→6 to admit it) and the config machine.
 */
export function maturityStep<TState extends { maturity: MaturityTier }>(
  opts: MaturityStepOptions,
): StepFor<TState, "maturity"> {
  return {
    id: "maturity",
    async run(_state, previous): Promise<StepResult<TState["maturity"]>> {
      const answer = await inquirer.prompt<{ maturity: MaturityTier | typeof BACK }>([
        {
          type: "select",
          name: "maturity",
          message: opts.message,
          choices: [
            { name: "solo — individual / hobby; universal floor, warn-only gates", value: "solo" as MaturityTier },
            { name: "team — shared repo; + duplication/design discipline, strict gates (investment tier, not the --team-size content gate)", value: "team" as MaturityTier },
            { name: "scaleup — multi-team; + SLOs, tracing, performance budgets", value: "scaleup" as MaturityTier },
            { name: "enterprise — regulated; + mutation/contract testing, AI evals, FinOps", value: "enterprise" as MaturityTier },
          ],
          default: previous ?? opts.defaultMaturity,
        },
      ]);
      return isBack(answer.maturity) ? BACK : (answer.maturity as TState["maturity"]);
    },
  };
}

// ── confidenceFloor ─────────────────────────────────────────────────

export interface ConfidenceFloorStepOptions<TState extends object = object> {
  /** Prompt copy — config: "Agent assertiveness floor:". */
  message: string;
  /**
   * First-visit default. Either a fixed floor, or a resolver over the
   * in-progress state. config passes a resolver so the seed tracks the maturity
   * tier the user picked EARLIER in this same run (the maturity step is
   * sequenced before this one): `readConfidenceFloor` with the in-run maturity
   * keeps an explicit persisted floor winning, else solo/team default `any` and
   * scaleup/enterprise default `high`. Without the resolver the seed would lag a
   * mid-run maturity bump, and accepting a stale default could pin a floor that
   * contradicts the newly-chosen tier. Builders never read the manifest — the
   * caller closes over it inside the resolver (mirrors `tier2Suggested` /
   * `defaultPreset`).
   */
  defaultFloor: ConfidenceFloor | ((state: Partial<TState>) => ConfidenceFloor);
}

/**
 * Single-select agent-assertiveness floor picker (`name: "confidenceFloor"`).
 * Choice copy mirrors the `ConfidenceFloor` JSDoc in `src/types.ts`. config-only
 * — init keeps its interactive flow at ≤6 prompts (maturity is the only dial it
 * prompts for), so confidence_floor has no init prompt (the scalar
 * `config confidence_floor=<v>` form remains).
 */
export function confidenceFloorStep<TState extends { confidenceFloor: ConfidenceFloor }>(
  opts: ConfidenceFloorStepOptions<TState>,
): StepFor<TState, "confidenceFloor"> {
  return {
    id: "confidenceFloor",
    async run(state, previous): Promise<StepResult<TState["confidenceFloor"]>> {
      const resolvedDefault =
        typeof opts.defaultFloor === "function" ? opts.defaultFloor(state) : opts.defaultFloor;
      const answer = await inquirer.prompt<{ confidenceFloor: ConfidenceFloor | typeof BACK }>([
        {
          type: "select",
          name: "confidenceFloor",
          message: opts.message,
          choices: [
            { name: "any — second-pass only on a low-confidence reviewer finding", value: "any" as ConfidenceFloor },
            { name: "medium — second-pass on any low-confidence finding", value: "medium" as ConfidenceFloor },
            { name: "high — second-pass on non-high confidence + ASK on every low-confidence finding", value: "high" as ConfidenceFloor },
          ],
          default: previous ?? resolvedDefault,
        },
      ]);
      return isBack(answer.confidenceFloor) ? BACK : (answer.confidenceFloor as TState["confidenceFloor"]);
    },
  };
}

// ── communicationStyle ──────────────────────────────────────────────

export interface CommunicationStyleStepOptions {
  /** Prompt copy — init: "How should agents talk to you?"; config: "Communication style:". */
  message: string;
  /**
   * First-visit default. init passes DEFAULT_COMMUNICATION_STYLE ("plain");
   * config passes the persisted `readCommunicationStyle(manifest)` value.
   * Builders never read the manifest.
   */
  defaultStyle: CommunicationStyle;
  skip?: (state: Partial<object>) => boolean;
}

/**
 * Single-select operator-communication picker (`name: "communicationStyle"`,
 * release/2.8.5). Choice copy mirrors the per-style effects the adapters stamp
 * (`communicationStyleDirective` in `src/manifest/hatchJson.ts`). Wired
 * unconditionally into the config machine and conditionally into init's
 * single-repo machine (skipped when `--communication-style`, a headless flag
 * (`--yes`/`--quick`/`--default`), or `--resume` resolved it) — the scalar
 * `config communication_style=<v>` form remains the headless surface.
 */
export function communicationStyleStep<TState extends { communicationStyle: CommunicationStyle }>(
  opts: CommunicationStyleStepOptions,
): StepFor<TState, "communicationStyle"> {
  return {
    id: "communicationStyle",
    skip: opts.skip,
    async run(_state, previous): Promise<StepResult<TState["communicationStyle"]>> {
      const answer = await inquirer.prompt<{ communicationStyle: CommunicationStyle | typeof BACK }>([
        {
          type: "select",
          name: "communicationStyle",
          message: opts.message,
          choices: [
            {
              name: "plain — define jargon on first use; lead with outcomes",
              value: "plain" as CommunicationStyle,
            },
            {
              name: "technical — precise domain terminology; lead with implementation detail",
              value: "technical" as CommunicationStyle,
            },
          ],
          default: previous ?? opts.defaultStyle,
        },
      ]);
      return isBack(answer.communicationStyle)
        ? BACK
        : (answer.communicationStyle as TState["communicationStyle"]);
    },
  };
}
