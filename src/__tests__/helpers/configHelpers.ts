/**
 * Shared test helpers for config command tests.
 *
 * Extracted per finding C7.5-W2B2-H9 to reduce vi.mocked boilerplate by
 * centralizing default mock implementations, repeated content-index fixtures,
 * call-count-based transition stubs, and printBox assertion lookups.
 *
 * Consumers must still declare the 15 `vi.mock(...)` hoists at the top of
 * their test file (vi.mock is module-hoisted and cannot be moved into a
 * helper). This helper provides the per-test wiring only.
 */
import { vi, expect, type MockInstance } from "vitest";
import type { ContentSelection, Features, HatchManifest, RepoEntry } from "../../types.js";
import { DEFAULT_FEATURES, WORKTREE_CAPABLE_TOOLS } from "../../types.js";
import type { AdapterContext } from "../../adapters/base.js";
import type {
  PipelineContext,
  TaskType,
  DeepContextTier,
} from "../../pipeline/pipelineContext.js";
import type { CheckpointMeta } from "../../pipeline/checkpoint.js";
import type { SnapshotMeta } from "../../pipeline/snapshot.js";

// Loose mock type used for helpers that accept any vi-mocked function without
// pinning its exact signature (test code only).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

// ─── Fixture builders ──────────────────────────────────────────

export function makeManifest(overrides: Partial<HatchManifest> = {}): HatchManifest {
  return {
    version: "2.0.0",
    hatch3rVersion: "1.1.0",
    platform: "github",
    owner: "test-org",
    repo: "test-repo",
    namespace: "test-org",
    project: "test-repo",
    tools: ["cursor"],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: ["github"] },
    board: {
      owner: "test-org",
      repo: "test-repo",
      defaultBranch: "main",
      projectNumber: null,
      statusFieldId: null,
      statusOptions: { backlog: null, ready: null, inProgress: null, inReview: null, done: null },
      labels: {
        types: ["type:bug"],
        executors: ["executor:agent"],
        statuses: ["status:triage"],
        meta: ["meta:board-overview"],
      },
      branchConvention: "{type}/{short-description}",
      areas: [],
    },
    managedFiles: [],
    ...overrides,
  };
}

export function makeContentSelection(overrides: Partial<ContentSelection> = {}): ContentSelection {
  return {
    preset: "full",
    projectType: "brownfield",
    teamSize: "team",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
    ...overrides,
  };
}

// ─── Central fixture factory (D3-SA3.5-F11) ────────────────────
// Builders for the high-recurrence object shapes that test files otherwise
// hand-roll. `makeManifest` above is the HatchJson builder; the five below
// cover AdapterContext, PipelineContext, RepoEntry (manifest sub-repo entry),
// CheckpointMeta, and SnapshotMeta. Each returns a minimal-VALID instance and
// accepts shallow `overrides` so call sites stay self-documenting.

/**
 * Minimal-valid {@link AdapterContext}. `features`/`mcp` derive from the
 * manifest the factory builds so the three stay mutually consistent.
 */
export function makeAdapterContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const manifest = overrides.manifest ?? makeManifest();
  return {
    canonicalRoot: "/tmp/hatch3r-test/canonical",
    projectRoot: "/tmp/hatch3r-test/project",
    manifest,
    features: manifest.features,
    generationMode: "standard",
    ...overrides,
  };
}

/**
 * Minimal-valid {@link PipelineContext} at run start (pre-Phase-1, no phase
 * outputs). Defaults to a `feature` task at deep-context tier 2.
 */
export function makePipelineContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    correlationId: "00000000-0000-4000-8000-000000000000",
    taskType: "feature" as TaskType,
    issueRef: null,
    deepContextTier: 2 as DeepContextTier,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    totalDuration: null,
    ...overrides,
  };
}

/** Minimal-valid manifest {@link RepoEntry} (workspace sub-repo record). */
export function makeManifestEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    owner: "test-org",
    repo: "test-repo",
    ...overrides,
  };
}

/** Minimal-valid {@link CheckpointMeta} (audit-execute resumability checkpoint). */
export function makeCheckpointMeta(overrides: Partial<CheckpointMeta> = {}): CheckpointMeta {
  return {
    baselineSha: "0".repeat(40),
    lastPassedGateN: 0,
    registrySha: "0".repeat(40),
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Minimal-valid {@link SnapshotMeta} (per-session rollback snapshot). */
export function makeSnapshotMeta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    schemaVersion: 1,
    sessionId: "test-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    paths: [],
    relativePaths: [],
    projectRoot: "/tmp/hatch3r-test/project",
    ...overrides,
  };
}

/**
 * Build a content index fixture from a list of agent IDs.
 *
 * Replaces the verbatim ~15-line `const mockIndex = { items: [...], byType: {}, byId: new Map([...]) }`
 * block repeated 8 times in config.test.ts.
 */
export function makeMockIndex(agentIds: string[]): unknown {
  const items = agentIds.map((id) => ({
    id,
    type: "agent",
    description: id.replace("hatch3r-", "").replace(/-/g, " "),
    tags: [],
    relativePath: `agents/${id}.md`,
  }));
  return {
    items,
    byType: {},
    byId: new Map(items.map((i) => [i.id, i])),
  };
}

// ─── Mock wiring ───────────────────────────────────────────────

/**
 * Re-applies the default mock implementations needed by configCommand.
 *
 * The `vi.mock()` calls at the top of the test file return factories with
 * undefined implementations for most methods. After `vi.clearAllMocks()` in
 * `beforeEach`, those implementations need to be restored before each test.
 *
 * Pass the already-vi.mocked references to this helper to avoid duplicating
 * the `await import` plumbing inside the helper (which would load modules
 * before the test file's top-level vi.mock() hoists take effect).
 */
export interface ConfigMockRefs {
  countSelectionItems: unknown;
  selectionSummary: unknown;
  extractContentReferences: unknown;
  validateOrchestrationDependencies: unknown;
  generateCanonicalAgentsMd: unknown;
  generateRootAgentsMd: unknown;
  ensureEnvMcp: unknown;
  getSourceEnvMcpCommand: unknown;
  runRegenerate: unknown;
  archiveToolOutputs: unknown;
  writeManifest: unknown;
  detectWorkspaceContext: unknown;
  readWorkspaceManifest: unknown;
  findPackageRoot: unknown;
  createSpinner: unknown;
  step: unknown;
  label: unknown;
}

export function applyDefaultConfigMocks(refs: ConfigMockRefs): void {
  vi.mocked(refs.countSelectionItems as AnyMock).mockReturnValue(0);
  vi.mocked(refs.selectionSummary as AnyMock).mockReturnValue("");
  vi.mocked(refs.extractContentReferences as AnyMock).mockReturnValue([]);
  vi.mocked(refs.validateOrchestrationDependencies as AnyMock).mockReturnValue([]);
  vi.mocked(refs.generateCanonicalAgentsMd as AnyMock).mockResolvedValue("# AGENTS.md content");
  vi.mocked(refs.generateRootAgentsMd as AnyMock).mockResolvedValue({
    full: "<!-- HATCH3R:BEGIN -->\n# Root AGENTS.md\n<!-- HATCH3R:END -->\n",
    inner: "# Root AGENTS.md",
  });
  vi.mocked(refs.ensureEnvMcp as AnyMock).mockResolvedValue({
    action: "skipped",
    path: ".env.mcp",
    newVars: [],
  });
  vi.mocked(refs.getSourceEnvMcpCommand as AnyMock).mockReturnValue("source .env.mcp");
  vi.mocked(refs.runRegenerate as AnyMock).mockResolvedValue({
    copiedFiles: 10,
    syncedTools: 1,
    failedTools: 0,
    version: "1.1.0",
  });
  vi.mocked(refs.archiveToolOutputs as AnyMock).mockResolvedValue({ archivedFiles: [], migrations: [] });
  vi.mocked(refs.writeManifest as AnyMock).mockResolvedValue(undefined);
  vi.mocked(refs.detectWorkspaceContext as AnyMock).mockResolvedValue({ type: "standalone" });
  vi.mocked(refs.readWorkspaceManifest as AnyMock).mockResolvedValue(null);
  vi.mocked(refs.findPackageRoot as AnyMock).mockReturnValue("/fake/package/root");
  vi.mocked(refs.createSpinner as AnyMock).mockReturnValue({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    stop: vi.fn(),
  });
  vi.mocked(refs.step as AnyMock).mockImplementation(
    (n: number, total: number, msg: string) => `[${n}/${total}] ${msg}`,
  );
  vi.mocked(refs.label as AnyMock).mockImplementation(
    (name: string, value: string) => `${name}: ${value}`,
  );
}

// ─── Prompt sequence builder ───────────────────────────────────

export interface PromptOverrides {
  platform?: string;
  repoAnswers?: Record<string, string>;
  branch?: string;
  tools?: string[];
  features?: (keyof Features)[];
  mcpServers?: string[];
  contentPreset?: string;
  contentItems?: string[];
  /**
   * Wave 3 (CLI-tooling pivot, plan §4.4): default selection returned by
   * `pickCliTools`. An empty selection short-circuits the detection +
   * installer follow-ups so the prompt sequence stays deterministic.
   */
  cliTools?: string[];
  /**
   * Wave 3 (CLI-tooling pivot, plan §4.4): answer to the Yes/No MCP gate.
   * Defaults to `true` when the manifest has existing servers (mirrors
   * production `confirmMcpGate` semantics — re-runs don't silently wipe
   * existing setups). Set to `false` to exercise the decline branch.
   */
  mcpGateProceed?: boolean;
  /**
   * D10-M14 (Cycle 10): answer to the `Archive these files?` confirm that
   * fires whenever the diff removes ≥1 tool. The helper auto-queues a
   * `proceed=true` for tests that drop tools so existing assertions keep
   * passing; set to `false` to exercise the abort branch.
   */
  confirmArchiveTools?: boolean;
}

/**
 * One-call helper that primes both the `readManifest` stub and the prompt
 * sequence. Replaces the two-line
 *   `vi.mocked(readManifest).mockResolvedValue(manifest);`
 *   `setupStandardPrompts(manifest, ...);`
 * boilerplate that appears in ~80 tests.
 *
 * Returns the manifest so callers can still reference it inline.
 */
export function primeConfig(
  readManifestMock: unknown,
  inquirerMock: { prompt: MockInstance },
  manifest: HatchManifest,
  overrides: PromptOverrides = {},
): HatchManifest {
  vi.mocked(readManifestMock as AnyMock).mockResolvedValue(manifest);
  setupStandardPrompts(inquirerMock, manifest, overrides);
  return manifest;
}

/**
 * Prime a content-management test: sets up readManifest, countSelectionItems,
 * selectionSummary, buildContentIndex, and the prompt sequence in one call.
 *
 * Replaces the 4-5 line per-test repetition seen in the "content management"
 * and related describe blocks.
 */
export interface PrimeContentRefs {
  readManifest: unknown;
  countSelectionItems: unknown;
  selectionSummary: unknown;
  buildContentIndex: unknown;
}

export function primeContent(
  refs: PrimeContentRefs,
  inquirerMock: { prompt: MockInstance },
  manifest: HatchManifest,
  agentIds: string[],
  overrides: PromptOverrides = {},
): void {
  const count = agentIds.length;
  const summary = `${count} agents`;
  vi.mocked(refs.readManifest as AnyMock).mockResolvedValue(manifest);
  vi.mocked(refs.countSelectionItems as AnyMock).mockReturnValue(count);
  vi.mocked(refs.selectionSummary as AnyMock).mockReturnValue(summary);
  vi.mocked(refs.buildContentIndex as AnyMock).mockResolvedValue(makeMockIndex(agentIds));
  setupStandardPrompts(inquirerMock, manifest, overrides);
}

/**
 * Queue the standard prompt sequence for configCommand:
 * platform → repo identity → branch → tools → features → mcp → worktree → content preset.
 *
 * Requires `inquirerMock` — the already-vi.mocked `inquirer` reference from
 * the caller's test file. See `applyDefaultConfigMocks` for why refs are
 * passed in rather than imported here.
 */
export function setupStandardPrompts(
  inquirerMock: { prompt: MockInstance },
  manifest: HatchManifest,
  overrides: PromptOverrides = {},
): void {
  const platform = overrides.platform ?? manifest.platform ?? "github";

  // 1. Platform prompt
  inquirerMock.prompt.mockResolvedValueOnce({ platform });

  // 2. Repo identity prompt (varies by platform)
  if (platform === "azure-devops") {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { org: manifest.owner, project: manifest.project, repo: manifest.repo },
    );
  } else if (platform === "gitlab") {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { namespace: manifest.namespace, project: manifest.project },
    );
  } else {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { owner: manifest.owner, repo: manifest.repo },
    );
  }

  // 3. Default branch prompt
  inquirerMock.prompt.mockResolvedValueOnce({
    defaultBranch: overrides.branch ?? manifest.board?.defaultBranch ?? "main",
  });

  // 4. Tools prompt
  inquirerMock.prompt.mockResolvedValueOnce({
    tools: overrides.tools ?? manifest.tools,
  });

  // 5. Wave 3 CLI tools picker (plan §4.4). An empty selection skips the
  // detection sweep + installer follow-ups so the remaining prompt order
  // stays deterministic. Tests targeting the cliTools roundtrip pass an
  // explicit `cliTools: [...]` override.
  inquirerMock.prompt.mockResolvedValueOnce({
    tools: overrides.cliTools ?? [],
  });

  // 6. Features prompt
  const currentFeatureKeys =
    overrides.features ??
    (Object.keys(DEFAULT_FEATURES) as (keyof Features)[]).filter((k) => manifest.features[k]);
  inquirerMock.prompt.mockResolvedValueOnce({ features: currentFeatureKeys });

  // 7. Wave 3 MCP Yes/No gate (plan §4.4). Fires only when the mcp feature
  // is enabled. Default proceed=true when the manifest already has servers
  // (matches production `confirmMcpGate` defaultYes semantics). If gate
  // proceeds, the server picker runs next.
  const featureSet = new Set(currentFeatureKeys);
  if (featureSet.has("mcp")) {
    const hasExistingMcp = (manifest.mcp.servers ?? []).length > 0;
    const proceedMcp = overrides.mcpGateProceed ?? hasExistingMcp;
    inquirerMock.prompt.mockResolvedValueOnce({ proceed: proceedMcp });
    if (proceedMcp) {
      // 8. MCP servers picker (only when the user proceeded through the gate)
      inquirerMock.prompt.mockResolvedValueOnce({
        mcp: overrides.mcpServers ?? manifest.mcp.servers,
      });
    }
  }

  // 9. Worktree prompt (only if tools include a worktree-capable tool)
  const selectedTools = overrides.tools ?? manifest.tools;
  if (selectedTools.some((t: string) => WORKTREE_CAPABLE_TOOLS.has(t))) {
    inquirerMock.prompt.mockResolvedValueOnce({
      enabled: manifest.worktree?.enabled ?? true,
    });
  }

  // 10. Content preset selection prompt (only if manifest has content)
  if (manifest.content) {
    inquirerMock.prompt.mockResolvedValueOnce({
      preset: overrides.contentPreset ?? manifest.content.preset ?? "full",
    });

    // 11. Custom items prompt (only if preset is "custom")
    if (overrides.contentPreset === "custom") {
      inquirerMock.prompt.mockResolvedValueOnce({
        items: overrides.contentItems ?? [],
      });
    }
  }

  // 12. D10-M14 (Cycle 10): tool-removal archive confirm. Fires only when
  // the standard prompts above drop at least one tool relative to the
  // manifest. Defaults to proceed=true so existing tool-swap tests pass
  // without per-test plumbing; override `confirmArchiveTools: false` to
  // exercise the abort branch.
  const archiveToolSet = overrides.tools ?? manifest.tools;
  const archiveToolsBeingRemoved = manifest.tools.some((t: string) => !archiveToolSet.includes(t));
  if (archiveToolsBeingRemoved) {
    inquirerMock.prompt.mockResolvedValueOnce({
      confirmArchive: overrides.confirmArchiveTools ?? true,
    });
  }
}

// ─── Content-ID transition stubs ───────────────────────────────

/**
 * Stub `getAllContentIds` to return `oldIds` on its first call and
 * `newIds` on all subsequent calls. configCommand calls this twice — once
 * for the current manifest content and once for the resolved selection.
 *
 * Replaces the `let callCount = 0; mockImplementation(...)` pattern
 * repeated 6 times in config.test.ts.
 */
export function stubContentIdsTransition(
  getAllContentIdsMock: unknown,
  oldIds: string[],
  newIds: string[],
): void {
  let callCount = 0;
  vi.mocked(getAllContentIdsMock as AnyMock).mockImplementation(() => {
    callCount++;
    return callCount === 1 ? new Set(oldIds) : new Set(newIds);
  });
}

/**
 * Stub `resolveSelection` to return a ContentSelection with the given agent IDs.
 * Wraps the recurring pattern:
 *   vi.mocked(resolveSelection).mockReturnValue(makeContentSelection({ items: { agents: [...], ...emptyOtherTypes } }));
 */
export function stubResolveSelectionAgents(
  resolveSelectionMock: unknown,
  agentIds: string[],
  preset: "minimal" | "standard" | "full" | "custom" = "full",
): void {
  vi.mocked(resolveSelectionMock as AnyMock).mockReturnValue(
    makeContentSelection({
      preset,
      items: {
        agents: agentIds,
        skills: [],
        rules: [],
        commands: [],
        prompts: [],
        hooks: [],
        githubAgents: [],
      },
    }),
  );
}

// ─── Assertion lookups ─────────────────────────────────────────

type PrintBoxCall = [string, string[], string?];

/**
 * Find the printBox call that rendered the "Config updated" summary.
 *
 * Replaces the repeated `printBox.mock.calls.find((c) => c[0] === "Config updated")`
 * pattern (24 occurrences in config.test.ts) and asserts it exists.
 */
export function getConfigUpdatedBox(printBoxMock: unknown): string[] {
  const call = (vi.mocked(printBoxMock as AnyMock).mock.calls as PrintBoxCall[]).find(
    (c) => c[0] === "Config updated",
  );
  expect(call).toBeDefined();
  return call![1];
}

/**
 * Find the printBox call that rendered the "Current configuration" header.
 */
export function getCurrentConfigBox(printBoxMock: unknown): string[] {
  const call = (vi.mocked(printBoxMock as AnyMock).mock.calls as PrintBoxCall[]).find(
    (c) => c[0] === "Current configuration",
  );
  expect(call).toBeDefined();
  return call![1];
}

/**
 * Extract the manifest that was passed to `writeManifest(rootDir, manifest)`.
 *
 * Replaces `vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest` (16 occurrences).
 */
export function getWrittenManifest(writeManifestMock: unknown, callIndex = 0): HatchManifest {
  const calls = vi.mocked(writeManifestMock as AnyMock).mock.calls as unknown as [unknown, HatchManifest][];
  return calls[callIndex][1];
}

/**
 * Assert that a Config-updated summary line containing `needle` exists.
 * Reduces the 3-line `const line = lines.find(...); expect(line).toBeDefined(); expect(line).toContain(...)`
 * pattern scattered through the summary tests.
 */
export function expectSummaryLine(lines: string[], needle: string, contains?: string): void {
  const line = lines.find((l) => typeof l === "string" && l.includes(needle));
  expect(line, `Expected summary line containing "${needle}"`).toBeDefined();
  if (contains !== undefined) {
    expect(line).toContain(contains);
  }
}
