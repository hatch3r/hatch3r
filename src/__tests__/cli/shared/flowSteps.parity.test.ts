// W2-flowsteps parity: drive an init-shaped single-repo machine and a
// config-shaped machine — both composed from the shared flowSteps builders
// with the same options init.ts and config.ts pass — through equivalent
// mocked answer queues, and assert they resolve identical platform,
// identity fields, tools, and CLI tools. Pickers are REAL here (only
// inquirer is mocked) so both sides exercise the production
// pickCliTools / confirmMcpGate / pickMcpServers prompt shapes, including
// pickCliTools' `name: "tools"` answer key (pickers.ts).
//
// W3-mcp-optin: init adopted the cliToolsStep as its 5th prompt and dropped
// the MCP step entirely (MCP is opt-in via `--mcp` / `hatch3r mcp setup`),
// so cliTools parity is asserted across BOTH machines and MCP resolution is
// config-side only.
import { describe, it, expect, vi, beforeEach } from "vitest";
import inquirer from "inquirer";
import {
  BACK,
  isBack,
  runStepMachine,
  type Step,
  type StepResult,
} from "../../../cli/shared/initSteps.js";
import {
  cliToolsStep,
  customItemsStep,
  identityStep,
  mcpGateStep,
  mcpServersStep,
  platformStep,
  presetStep,
  toolsStep,
} from "../../../cli/shared/flowSteps.js";
import { FEATURE_CHOICES } from "../../../cli/shared/constants.js";
import type { RepoIdentity } from "../../../cli/shared/repoIdentityPrompt.js";
import type { CatalogItem } from "../../../content/index.js";
import type { CliToolId, Features, Platform, Tool } from "../../../types.js";
import type { PresetId } from "../../../content/presets.js";

vi.mock("inquirer", () => {
  class Separator {
    constructor(public readonly line: string) {}
  }
  return {
    default: {
      prompt: vi.fn(),
      Separator,
    },
  };
});

beforeEach(() => {
  vi.mocked(inquirer.prompt).mockReset();
});

const emptyIndex = {
  items: [] as CatalogItem[],
  byType: {},
  byId: new Map<string, CatalogItem>(),
  byTypeAndId: new Map<string, CatalogItem>(),
  collisions: [],
};

// Mirrors init.ts::SingleRepoState.
interface InitState {
  platform: Platform;
  identity: RepoIdentity;
  preset: PresetId;
  customItems: string[] | undefined;
  tools: Tool[];
  cliTools: CliToolId[];
}

// Mirrors config.ts::ConfigState minus defaultBranch/worktree (config-local
// inline steps with no init counterpart — out of the extraction's scope).
interface ConfState {
  platform: Platform;
  identity: RepoIdentity;
  tools: Tool[];
  cliTools: CliToolId[];
  features: (keyof Features)[];
  mcpGate: boolean;
  mcpServers: string[];
}

/** Init's single-repo composition (init.ts step machine, same options). */
function initMachine(): Array<Step<InitState>> {
  return [
    platformStep<InitState>({ message: "Select your platform:", defaultPlatform: "github" }),
    identityStep<InitState>({ remote: { owner: "det-owner", repo: "det-repo" } }),
    presetStep<InitState>({
      index: emptyIndex,
      projectType: "brownfield",
      teamSize: "solo",
      projectLanguages: [],
      defaultPreset: "standard",
      customUniverseHint: true,
    }),
    customItemsStep<InitState>({
      index: emptyIndex,
      baselineChecked: () => (item) => item.protected === true,
      previousAsDefault: true,
    }),
    toolsStep<InitState>({ defaults: ["claude"], emptyFallback: ["claude"] }),
    // W3-mcp-optin: init's 5th step is the CLI-tools picker; the tier-2
    // suggestion thunk mirrors init.ts (reads the platform chosen in step 1
    // — init passes applyPlatformTriggers(s.platform, ...)).
    cliToolsStep<InitState>({
      tier2Suggested: (s) => (s.platform === "github" ? (["gh"] as CliToolId[]) : []),
    }),
  ];
}

/** Config's composition (config.ts step machine, same options; the
 *  config-local `features` step stays inline there and here). */
function configMachine(manifest: {
  platform: Platform;
  owner: string;
  repo: string;
  namespace: string;
  project: string;
  tools: Tool[];
  mcpServers: string[];
}): Array<Step<ConfState>> {
  return [
    platformStep<ConfState>({ message: "Platform:", defaultPlatform: manifest.platform ?? "github" }),
    identityStep<ConfState>({
      seed: {
        owner: manifest.owner,
        repo: manifest.repo,
        namespace: manifest.namespace,
        project: manifest.project,
      },
    }),
    toolsStep<ConfState>({ defaults: manifest.tools }),
    cliToolsStep<ConfState>({ existing: [] }),
    {
      id: "features",
      async run(_state, previous): Promise<StepResult<(keyof Features)[]>> {
        const answer = await inquirer.prompt<{ features: (keyof Features)[] | typeof BACK }>([
          {
            type: "checkbox",
            name: "features",
            message: "Select features:",
            choices: FEATURE_CHOICES,
            default: previous ?? [],
          },
        ]);
        if (isBack(answer.features)) return BACK;
        return (answer.features ?? []) as (keyof Features)[];
      },
    },
    mcpGateStep<ConfState>({ hasExisting: manifest.mcpServers.length > 0 }),
    mcpServersStep<ConfState>({
      platform: (s) => s.platform!,
      existing: manifest.mcpServers,
      skip: (s) => !(s.features?.includes("mcp")) || !s.mcpGate,
    }),
  ];
}

describe("flowSteps parity — init vs config machines", () => {
  it("equivalent answers resolve identical platform, identity, tools, and CLI tools", async () => {
    const inq = vi.mocked(inquirer.prompt);

    // Init: platform → identity → preset → (customItems skipped) → tools →
    // cliTools (W3-mcp-optin: no MCP step; pickCliTools answers under
    // `name: "tools"`, same key as the editor-tools prompt — order-based
    // queue resolves the collision).
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "acme", repo: "rocket" });
    inq.mockResolvedValueOnce({ preset: "standard" });
    inq.mockResolvedValueOnce({ tools: ["claude", "cursor"] });
    inq.mockResolvedValueOnce({ tools: ["jq", "gh"] });
    const initState = await runStepMachine<InitState>(initMachine());

    inq.mockReset();

    // Config: platform → identity → tools → cliTools (pickCliTools answers
    // under `name: "tools"`) → features → mcpGate → mcpServers.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "acme", repo: "rocket" });
    inq.mockResolvedValueOnce({ tools: ["claude", "cursor"] });
    inq.mockResolvedValueOnce({ tools: ["jq", "gh"] });
    inq.mockResolvedValueOnce({ features: ["mcp"] });
    inq.mockResolvedValueOnce({ proceed: true });
    inq.mockResolvedValueOnce({ mcp: ["github"] });
    const confState = await runStepMachine<ConfState>(
      configMachine({
        platform: "github",
        owner: "old-owner",
        repo: "old-repo",
        namespace: "old-owner",
        project: "old-repo",
        tools: ["claude"],
        mcpServers: [],
      }),
    );

    expect(confState.platform).toBe(initState.platform);
    expect(confState.identity).toEqual(initState.identity);
    expect(initState.identity).toEqual({
      owner: "acme",
      repo: "rocket",
      namespace: "acme",
      project: "rocket",
    });
    expect(confState.tools).toEqual(initState.tools);
    expect(initState.tools).toEqual(["claude", "cursor"]);
    // W3-mcp-optin: the same cliTools answer resolves identically on both
    // machines now that init carries the step too.
    expect(confState.cliTools).toEqual(initState.cliTools);
    expect(initState.cliTools).toEqual(["jq", "gh"]);
    // MCP resolution is config-side only — init has no MCP step (opt-in via
    // `--mcp` / `hatch3r mcp setup`).
    expect(confState.mcpServers).toEqual(["github"]);
  });

  it("config gate chain: declining the gate skips the server picker on both BACK and forward passes", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "acme", repo: "rocket" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });
    inq.mockResolvedValueOnce({ features: ["mcp"] });
    inq.mockResolvedValueOnce({ proceed: false });

    const confState = await runStepMachine<ConfState>(
      configMachine({
        platform: "github",
        owner: "acme",
        repo: "rocket",
        namespace: "acme",
        project: "rocket",
        tools: ["claude"],
        mcpServers: [],
      }),
    );

    expect(confState.mcpGate).toBe(false);
    expect(confState.mcpServers).toBeUndefined();
  });
});
