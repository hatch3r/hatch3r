// W2-flowsteps: unit tests for the shared step builders that init and
// config compose their interactive machines from. Covers, per builder:
// caller-injected default vs `previous` threading on BACK-revisit, skip
// predicates, and BACK sentinel passthrough.
import { describe, it, expect, vi, beforeEach } from "vitest";
import inquirer from "inquirer";
import {
  BACK,
  isBack,
  runStepMachine,
  type Step,
  type StepFor,
  type StepResult,
} from "../../../cli/shared/initSteps.js";
import {
  COLLAPSED_MCP_MESSAGE,
  cliToolsStep,
  customItemsStep,
  identityStep,
  mcpGateStep,
  mcpServersStep,
  platformStep,
  presetStep,
  toolsStep,
} from "../../../cli/shared/flowSteps.js";
import { pickCliTools, pickMcpServers, confirmMcpGate } from "../../../cli/shared/pickers.js";
import { PLATFORM_MCP_SERVER } from "../../../cli/shared/constants.js";
import type { RepoIdentity } from "../../../cli/shared/repoIdentityPrompt.js";
import type { CatalogItem } from "../../../content/index.js";
import type { CliToolId, Features, Platform, Tool } from "../../../types.js";
import type { PresetId } from "../../../content/presets.js";

// Mirror init.backNav.test.ts: mock inquirer.prompt so each builder call
// resolves a queued answer shape; queue the BACK sentinel directly to
// simulate Shift+Tab (Symbol.for identity holds across module boundaries).
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

// The cliTools / gated-mcpServers / mcpGate builders delegate to the
// pickers module — mock it so the tests assert the delegation contract
// (argument precedence + BACK passthrough) without registry coupling.
// The collapsed mcpServers variant and all other builders prompt through
// inquirer directly and are exercised against the inquirer mock.
vi.mock("../../../cli/shared/pickers.js", () => ({
  pickCliTools: vi.fn(),
  pickMcpServers: vi.fn(),
  confirmMcpGate: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(inquirer.prompt).mockReset();
  vi.mocked(pickCliTools).mockReset();
  vi.mocked(pickMcpServers).mockReset();
  vi.mocked(confirmMcpGate).mockReset();
});

/** First question object of the n-th inquirer.prompt call. */
function questionAt(call: number): Record<string, unknown> {
  return questionsAt(call)[0];
}

/** All question objects of the n-th inquirer.prompt call. */
function questionsAt(call: number): Array<Record<string, unknown>> {
  // The mocked prompt receives plain question-object arrays; inquirer's
  // PromptSession typing doesn't know that, so route the cast via unknown.
  return vi.mocked(inquirer.prompt).mock.calls[call][0] as unknown as Array<
    Record<string, unknown>
  >;
}

/** Minimal catalog item for the customItems picker. */
function item(id: string, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    type: "rule",
    description: `desc ${id}`,
    tags: ["implementation"],
    relativePath: `rules/${id}.md`,
    source: "canonical",
    ...overrides,
  };
}

/** Empty content index — preset decorations resolve to zero counts. */
const emptyIndex = {
  items: [] as CatalogItem[],
  byType: {},
  byId: new Map<string, CatalogItem>(),
  byTypeAndId: new Map<string, CatalogItem>(),
  collisions: [],
};

/** Probe step that returns BACK on its first visit, then a value. */
function backOnceProbe<TState extends { probe: string }>(): StepFor<TState, "probe"> {
  let visits = 0;
  return {
    id: "probe",
    async run(): Promise<StepResult<TState["probe"]>> {
      visits++;
      if (visits === 1) return BACK;
      return "done" as TState["probe"];
    },
  };
}

// ── platformStep ────────────────────────────────────────────────────

describe("platformStep", () => {
  interface S {
    platform: Platform;
    probe: string;
  }

  it("uses the injected default on first visit and threads previous on BACK-revisit", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "gitlab" });
    inq.mockResolvedValueOnce({ platform: "azure-devops" });

    const steps: Array<Step<S>> = [
      platformStep<S>({ message: "Select your platform:", defaultPlatform: "github" }),
      backOnceProbe<S>(),
    ];
    const state = await runStepMachine<S>(steps);

    expect(state.platform).toBe("azure-devops");
    expect(state.probe).toBe("done");
    expect(questionAt(0)).toMatchObject({
      name: "platform",
      message: "Select your platform:",
      default: "github",
    });
    // BACK-revisit re-renders with the prior answer as default.
    expect(questionAt(1)).toMatchObject({ default: "gitlab" });
  });

  it("returns BACK when the prompt resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ platform: BACK });
    const step = platformStep<S>({ message: "Platform:", defaultPlatform: "github" });
    const result = await step.run({}, undefined);
    expect(isBack(result)).toBe(true);
  });
});

// ── identityStep ────────────────────────────────────────────────────

describe("identityStep", () => {
  interface S {
    platform: Platform;
    identity: RepoIdentity;
  }

  it("consults seed after previous and before remote (GitHub branch)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    const step = identityStep<S>({
      seed: { owner: "seed-o", repo: "seed-r" },
      remote: { owner: "rem-o", repo: "rem-r" },
    });

    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    await step.run({ platform: "github" }, undefined);
    expect(questionsAt(0)[0]).toMatchObject({ name: "owner", default: "seed-o" });
    expect(questionsAt(0)[1]).toMatchObject({ name: "repo", default: "seed-r" });

    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    await step.run(
      { platform: "github" },
      { owner: "prev-o", repo: "prev-r", namespace: "prev-o", project: "prev-r" },
    );
    expect(questionsAt(1)[0]).toMatchObject({ default: "prev-o" });
    expect(questionsAt(1)[1]).toMatchObject({ default: "prev-r" });
  });

  it("falls back to remote when no seed is provided", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ owner: "o", repo: "r" });
    const step = identityStep<S>({ remote: { owner: "rem-o", repo: "rem-r" } });
    await step.run({ platform: "github" }, undefined);
    expect(questionsAt(0)[0]).toMatchObject({ default: "rem-o" });
    expect(questionsAt(0)[1]).toMatchObject({ default: "rem-r" });
  });

  it("aliases seed.owner/seed.repo onto the GitLab single-id fields", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ namespace: "ns", project: "pj" });
    // No seed.namespace / seed.project — mirrors a manifest that predates
    // those fields; the GitLab branch must fall back to owner/repo.
    const step = identityStep<S>({ seed: { owner: "acme", repo: "rocket" } });
    const result = await step.run({ platform: "gitlab" }, undefined);
    expect(questionsAt(0)[0]).toMatchObject({ name: "namespace", default: "acme" });
    expect(questionsAt(0)[1]).toMatchObject({ name: "project", default: "rocket" });
    expect(result).toEqual({ owner: "ns", repo: "pj", namespace: "ns", project: "pj" });
  });

  it("returns BACK when any identity field resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ owner: BACK, repo: "r" });
    const step = identityStep<S>();
    const result = await step.run({ platform: "github" }, undefined);
    expect(isBack(result)).toBe(true);
  });
});

// ── presetStep ──────────────────────────────────────────────────────

describe("presetStep", () => {
  interface S {
    preset: PresetId;
    probe: string;
  }

  function makeStep(overrides: Partial<Parameters<typeof presetStep<S>>[0]> = {}) {
    return presetStep<S>({
      index: emptyIndex,
      projectType: "brownfield",
      teamSize: "solo",
      defaultPreset: "standard",
      ...overrides,
    });
  }

  it("uses defaultPreset on first visit and previous on BACK-revisit; banner runs every visit", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ preset: "full" });
    const banner = vi.fn();

    const steps: Array<Step<S>> = [makeStep({ banner }), backOnceProbe<S>()];
    const state = await runStepMachine<S>(steps);

    expect(state.preset).toBe("full");
    expect(questionAt(0)).toMatchObject({ name: "preset", message: "Select content profile:", default: "standard" });
    expect(questionAt(1)).toMatchObject({ default: "minimal" });
    expect(banner).toHaveBeenCalledTimes(2);
  });

  it("resolves a thunk defaultPreset lazily", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ preset: "standard" });
    const step = makeStep({ defaultPreset: () => "full" });
    await step.run({}, undefined);
    expect(questionAt(0)).toMatchObject({ default: "full" });
  });

  it("renders the custom universe hint only when customUniverseHint is set", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ preset: "custom" });
    await makeStep({ customUniverseHint: true }).run({}, undefined);
    const withHint = (questionAt(0).choices as Array<{ value: string; name: string }>).find(
      (c) => c.value === "custom",
    );
    expect(withHint!.name).toContain("(0 items to choose from)");

    inq.mockResolvedValueOnce({ preset: "custom" });
    await makeStep().run({}, undefined);
    const withoutHint = (questionAt(1).choices as Array<{ value: string; name: string }>).find(
      (c) => c.value === "custom",
    );
    expect(withoutHint!.name).not.toContain("items to choose from");
  });

  it("honors the injected skip predicate and passes BACK through", async () => {
    const step = makeStep({ skip: () => true });
    expect(step.skip!({})).toBe(true);

    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ preset: BACK });
    const result = await makeStep().run({}, undefined);
    expect(isBack(result)).toBe(true);
  });
});

// ── customItemsStep ─────────────────────────────────────────────────

describe("customItemsStep", () => {
  interface S {
    preset: PresetId;
    customItems: string[] | undefined;
  }

  const items = [item("hatch3r-a"), item("hatch3r-b")];

  it("skips unless the resolved preset is custom; extraSkip is ORed in", async () => {
    const step = customItemsStep<S>({
      index: { items },
      baselineChecked: () => () => false,
    });
    expect(step.skip!({ preset: "standard" })).toBe(true);
    expect(step.skip!({ preset: "custom" })).toBe(false);

    const gated = customItemsStep<S>({
      index: { items },
      baselineChecked: () => () => false,
      extraSkip: () => true,
    });
    expect(gated.skip!({ preset: "custom" })).toBe(true);
  });

  it("runs the baselineChecked factory once per visit with `previous` and bakes it into checked", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ items: ["hatch3r-b"] });
    const factory = vi.fn((previous: string[] | undefined) => (i: CatalogItem) =>
      previous ? previous.includes(i.id) : false,
    );
    const step = customItemsStep<S>({ index: { items }, baselineChecked: factory });

    await step.run({ preset: "custom" }, ["hatch3r-b"]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(["hatch3r-b"]);
    const choices = (questionAt(0).choices as Array<Record<string, unknown>>).filter(
      (c) => "value" in c,
    );
    expect(choices.find((c) => c.value === "hatch3r-a")!.checked).toBe(false);
    expect(choices.find((c) => c.value === "hatch3r-b")!.checked).toBe(true);
  });

  it("threads previous via inquirer default only when previousAsDefault is set", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ items: [] });
    const threaded = customItemsStep<S>({
      index: { items },
      baselineChecked: () => () => false,
      previousAsDefault: true,
    });
    await threaded.run({ preset: "custom" }, ["hatch3r-a"]);
    expect(questionAt(0).default).toEqual(["hatch3r-a"]);

    inq.mockResolvedValueOnce({ items: [] });
    const unthreaded = customItemsStep<S>({
      index: { items },
      baselineChecked: () => () => false,
    });
    await unthreaded.run({ preset: "custom" }, ["hatch3r-a"]);
    expect("default" in questionAt(1)).toBe(false);
  });

  it("passes BACK through and normalizes a missing answer to []", async () => {
    const inq = vi.mocked(inquirer.prompt);
    const step = customItemsStep<S>({ index: { items }, baselineChecked: () => () => false });

    inq.mockResolvedValueOnce({ items: BACK });
    expect(isBack(await step.run({ preset: "custom" }, undefined))).toBe(true);

    inq.mockResolvedValueOnce({});
    expect(await step.run({ preset: "custom" }, undefined)).toEqual([]);
  });
});

// ── toolsStep ───────────────────────────────────────────────────────

describe("toolsStep", () => {
  interface S {
    tools: Tool[];
  }

  it("defaults to the injected list on first visit and previous on revisit", async () => {
    const inq = vi.mocked(inquirer.prompt);
    const step = toolsStep<S>({ defaults: ["claude"] });

    inq.mockResolvedValueOnce({ tools: ["cursor"] });
    await step.run({}, undefined);
    expect(questionAt(0)).toMatchObject({ name: "tools", default: ["claude"] });

    inq.mockResolvedValueOnce({ tools: ["cursor"] });
    await step.run({}, ["cursor"]);
    expect(questionAt(1)).toMatchObject({ default: ["cursor"] });
  });

  it("substitutes emptyFallback on an empty selection; returns [] without one", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ tools: [] });
    const withFallback = toolsStep<S>({ defaults: ["claude"], emptyFallback: ["claude"] });
    expect(await withFallback.run({}, undefined)).toEqual(["claude"]);

    inq.mockResolvedValueOnce({ tools: [] });
    const withoutFallback = toolsStep<S>({ defaults: ["claude"] });
    expect(await withoutFallback.run({}, undefined)).toEqual([]);
  });

  it("passes BACK through", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ tools: BACK });
    const step = toolsStep<S>({ defaults: ["claude"] });
    expect(isBack(await step.run({}, undefined))).toBe(true);
  });
});

// ── cliToolsStep ────────────────────────────────────────────────────

describe("cliToolsStep", () => {
  interface S {
    cliTools: CliToolId[];
  }

  it("delegates to pickCliTools with previous ?? existing ?? []", async () => {
    const picker = vi.mocked(pickCliTools);
    picker.mockResolvedValue(["gh"] as CliToolId[]);

    const step = cliToolsStep<S>({ existing: ["jq"] as CliToolId[] });
    expect(await step.run({}, undefined)).toEqual(["gh"]);
    expect(picker).toHaveBeenLastCalledWith(
      expect.objectContaining({ existing: ["jq"] }),
    );

    await step.run({}, ["rg"] as CliToolId[]);
    expect(picker).toHaveBeenLastCalledWith(
      expect.objectContaining({ existing: ["rg"] }),
    );

    await cliToolsStep<S>().run({}, undefined);
    expect(picker).toHaveBeenLastCalledWith(
      expect.objectContaining({ existing: [] }),
    );
  });

  it("passes BACK through from the picker", async () => {
    vi.mocked(pickCliTools).mockResolvedValue(BACK);
    const step = cliToolsStep<S>();
    expect(isBack(await step.run({}, undefined))).toBe(true);
  });
});

// ── mcpGateStep ─────────────────────────────────────────────────────

describe("mcpGateStep", () => {
  interface S {
    features: (keyof Features)[];
    mcpGate: boolean;
  }

  it("skips unless the in-progress feature selection includes mcp", () => {
    const step = mcpGateStep<S>({ hasExisting: false });
    expect(step.skip!({})).toBe(true);
    expect(step.skip!({ features: ["agents"] as (keyof Features)[] })).toBe(true);
    expect(step.skip!({ features: ["mcp"] as (keyof Features)[] })).toBe(false);
  });

  it("delegates to confirmMcpGate with the injected hasExisting", async () => {
    const gate = vi.mocked(confirmMcpGate);
    gate.mockResolvedValue(true);
    const step = mcpGateStep<S>({ hasExisting: true });
    expect(await step.run({ features: ["mcp"] as (keyof Features)[] }, undefined)).toBe(true);
    expect(gate).toHaveBeenCalledWith({ hasExisting: true });

    gate.mockResolvedValue(BACK);
    expect(isBack(await step.run({ features: ["mcp"] as (keyof Features)[] }, undefined))).toBe(true);
  });
});

// ── mcpServersStep ──────────────────────────────────────────────────

describe("mcpServersStep — collapsed variant", () => {
  interface S {
    platform: Platform;
    mcpServers: string[];
  }

  const step = mcpServersStep<S>({
    variant: "collapsed",
    platform: (s) => s.platform!,
  });

  it("renders the collapsed copy with default [] on first visit and previous on revisit", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ mcp: [] });
    await step.run({ platform: "github" }, undefined);
    expect(questionAt(0)).toMatchObject({
      name: "mcp",
      message: COLLAPSED_MCP_MESSAGE,
      default: [],
    });

    inq.mockResolvedValueOnce({ mcp: [] });
    await step.run({ platform: "github" }, ["context7"]);
    expect(questionAt(1)).toMatchObject({ default: ["context7"] });
  });

  it("prepends the platform server only on a non-empty selection", async () => {
    const inq = vi.mocked(inquirer.prompt);
    const platformMcp = PLATFORM_MCP_SERVER.github;

    inq.mockResolvedValueOnce({ mcp: ["playwright"] });
    expect(await step.run({ platform: "github" }, undefined)).toEqual([platformMcp, "playwright"]);

    // Empty stays empty — the `(none)` path.
    inq.mockResolvedValueOnce({ mcp: [] });
    expect(await step.run({ platform: "github" }, undefined)).toEqual([]);

    // Already present — no duplicate.
    inq.mockResolvedValueOnce({ mcp: [platformMcp, "context7"] });
    expect(await step.run({ platform: "github" }, undefined)).toEqual([platformMcp, "context7"]);
  });

  it("passes BACK through", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ mcp: BACK });
    expect(isBack(await step.run({ platform: "github" }, undefined))).toBe(true);
  });
});

describe("mcpServersStep — gated variant", () => {
  interface S {
    platform: Platform;
    features: (keyof Features)[];
    mcpGate: boolean;
    mcpServers: string[];
  }

  const step = mcpServersStep<S>({
    variant: "gated",
    platform: (s) => s.platform!,
    existing: ["github"],
    skip: (s) => !(s.features?.includes("mcp")) || !s.mcpGate,
  });

  it("honors the injected skip (config.ts gate chain)", () => {
    expect(step.skip!({})).toBe(true);
    expect(step.skip!({ features: ["mcp"] as (keyof Features)[], mcpGate: false })).toBe(true);
    expect(step.skip!({ features: ["mcp"] as (keyof Features)[], mcpGate: true })).toBe(false);
  });

  it("delegates to pickMcpServers without threading previous", async () => {
    const picker = vi.mocked(pickMcpServers);
    picker.mockResolvedValue(["github", "context7"]);

    const result = await step.run(
      { platform: "gitlab", features: ["mcp"] as (keyof Features)[], mcpGate: true },
      ["stale-previous"],
    );

    expect(result).toEqual(["github", "context7"]);
    // `previous` must NOT leak into the delegation — pickMcpServers derives
    // its own default from `existing` (pre-extraction config behavior).
    expect(picker).toHaveBeenCalledWith({
      platform: "gitlab",
      existing: ["github"],
      wslTheme: undefined,
    });

    picker.mockResolvedValue(BACK);
    expect(
      isBack(
        await step.run(
          { platform: "gitlab", features: ["mcp"] as (keyof Features)[], mcpGate: true },
          undefined,
        ),
      ),
    ).toBe(true);
  });
});
