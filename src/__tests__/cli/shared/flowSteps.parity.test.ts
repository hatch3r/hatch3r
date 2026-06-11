// W2-flowsteps parity: drive an init-shaped single-repo machine and a
// config-shaped machine — both composed from the shared flowSteps builders
// with the same options init.ts and config.ts pass — through equivalent
// mocked answer queues, and assert they resolve identical platform,
// identity fields, tools, and MCP servers. Pickers are REAL here (only
// inquirer is mocked) so the config side exercises the production
// pickCliTools / confirmMcpGate / pickMcpServers prompt shapes, including
// pickCliTools' `name: "tools"` answer key (pickers.ts).
//
// cliTools parity is asserted config-side only — init adopts the
// cliToolsStep in a later slice.
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
  mcpServers: string[];
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
    mcpServersStep<InitState>({ variant: "collapsed", platform: (s) => s.platform! }),
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
      variant: "gated",
      platform: (s) => s.platform!,
      existing: manifest.mcpServers,
      skip: (s) => !(s.features?.includes("mcp")) || !s.mcpGate,
    }),
  ];
}

describe("flowSteps parity — init vs config machines", () => {
  it("equivalent answers resolve identical platform, identity, tools, and MCP servers", async () => {
    const inq = vi.mocked(inquirer.prompt);

    // Init: platform → identity → preset → (customItems skipped) → tools → mcp.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "acme", repo: "rocket" });
    inq.mockResolvedValueOnce({ preset: "standard" });
    inq.mockResolvedValueOnce({ tools: ["claude", "cursor"] });
    inq.mockResolvedValueOnce({ mcp: ["github"] });
    const initState = await runStepMachine<InitState>(initMachine());

    inq.mockReset();

    // Config: platform → identity → tools → cliTools (pickCliTools answers
    // under `name: "tools"`) → features → mcpGate → mcpServers.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "acme", repo: "rocket" });
    inq.mockResolvedValueOnce({ tools: ["claude", "cursor"] });
    inq.mockResolvedValueOnce({ tools: [] });
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
    // Same MCP answer resolves the same server list on both machines
    // (collapsed variant keeps the platform server; gated pickMcpServers
    // prepends it when missing — identical here because it was selected).
    expect(confState.mcpServers).toEqual(initState.mcpServers);
    expect(initState.mcpServers).toEqual(["github"]);
    expect(confState.cliTools).toEqual([]);
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
