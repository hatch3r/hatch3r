import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { mockPromptsByName } from "./inquirerMock.js";

// Mock inquirer so interactive paths can be exercised. The --yes paths in
// initCommand do not call inquirer.prompt, so existing non-interactive tests
// remain unaffected by this mock. Separator is required by
// src/cli/shared/customContentChoices.ts (custom-preset path).
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

// CI determinism: interactive init calls findMissingCliTools (real PATH probe)
// then offerInstaller (an extra inquirer.prompt) for any tool absent from PATH.
// On a clean CI runner the selected tools are missing, so that extra prompt
// fires and shifts every test's queued inquirer answer by one — surfacing as
// "Cannot destructure property 'proceed'/'syncRepos'". Mock detection to
// "nothing missing" so the prompt sequence is machine-independent. Mirrors
// src/__tests__/cli/config.test.ts:177. Tests that exercise the installer
// path can override with mockResolvedValueOnce.
vi.mock("../../cliTools/detect.js", () => ({
  findMissingCliTools: vi.fn().mockResolvedValue([]),
  detectCliTool: vi.fn(),
  detectCliTools: vi.fn().mockResolvedValue([]),
  probeBin: vi.fn().mockResolvedValue(""),
}));

// Wave 6 (1.9.0): the hatch3r footprint moved from `.agents/` to `.hatch3r/`.
// For the rewritten init tests, `AGENTS_DIR` refers to `.hatch3r/` so existing
// `join(tempDir, AGENTS_DIR, "hatch.json")` reads pick up the new location.
const AGENTS_DIR = HATCH3R_DIR;

// D3-SA3.2-11 (D3, CQ5 / P1): the init interactive flow now refuses to run when
// stdin is not a TTY (mirror of config's D1-18 guard). Under vitest stdin is not
// a TTY, so every interactive (non-`--yes`) test in this file would otherwise
// trip that guard before reaching its mocked prompts. Force
// `process.stdin.isTTY = true` for the whole file (a top-level hook applies to
// all suites) so the prompt-driven flows exercise the interactive path; the
// dedicated non-TTY test below overrides it locally. Restored after each test so
// no process-global state leaks to other files.
let savedStdinIsTTY: boolean | undefined;
beforeEach(() => {
  savedStdinIsTTY = process.stdin.isTTY;
  (process.stdin as { isTTY?: boolean }).isTTY = true;
});
afterEach(() => {
  if (savedStdinIsTTY === undefined) {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  } else {
    (process.stdin as { isTTY?: boolean }).isTTY = savedStdinIsTTY;
  }
});

describe("init command", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; cliTools?: string; noCliTools?: boolean; mcp?: boolean; resume?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  // ── Non-TTY preflight (D3-SA3.2-11) ───────────────────────────
  //
  // Mirror of config's D1-18 test. The interactive flow (no `--yes`) issues
  // inquirer prompts; under a pipe/CI stdin is not a TTY, so init fails fast with
  // a usage-code (exit 2) HatchError naming the `--yes` escape. `--yes` (and its
  // `--quick`/`--default` aliases) short-circuit before the gate, so headless
  // installs keep working. The file-level hook sets isTTY true by default; these
  // tests flip it false explicitly.
  describe("non-TTY preflight (D3-SA3.2-11)", () => {
    it("throws a usage-code (exit 2) HatchError when stdin is not a TTY", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      // init.test.ts does not clear the inquirer mock between tests (no
      // clearAllMocks in beforeEach), so reset the call log here to make the
      // "no prompt reached" assertion order-independent.
      vi.mocked(inquirer.prompt).mockClear();
      try {
        await initCommand({});
        throw new Error("expected initCommand to throw under non-TTY stdin");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).exitCode).toBe(2);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        expect((e as HatchError).recoveryHint).toMatch(/--yes/);
      }
      // The guard fires before any prompt site (detectAmbiguity + step machine).
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });

    it("still runs headlessly under non-TTY stdin with --yes (short-circuits before the gate)", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      vi.mocked(inquirer.prompt).mockClear();
      await initCommand({ yes: true });
      // A real init completed: the manifest landed and no prompt was reached.
      await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });
  });

  it("should create .agents/ directory with --yes flag", async () => {
    await initCommand({ yes: true });

    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
  });

  it("should create hatch.json manifest with --yes flag", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    // Wave 6 (1.9.0 / schemaVersion 3): manifest version bumped.
    expect(manifest.version).toBe("3.0.0");
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(manifest.platform).toBe("github");
    expect(Array.isArray(manifest.tools)).toBe(true);
    expect(manifest.tools.length).toBeGreaterThan(0);
    expect(manifest.features).toBeDefined();
    expect(manifest.features.agents).toBe(true);
    expect(manifest.features.rules).toBe(true);
    expect(manifest.features.skills).toBe(true);
    expect(Array.isArray(manifest.managedFiles)).toBe(true);
    expect(manifest.managedFiles.length).toBeGreaterThan(0);
  });

  it("does NOT materialise canonical content under .agents/ (Wave 3 removal)", async () => {
    await initCommand({ yes: true });

    // Wave 3: adapters source canonical content from the bundled package.
    // No `.agents/` directory is created in user repos.
    let dotAgentsExists = false;
    try {
      await access(join(tempDir, ".agents"));
      dotAgentsExists = true;
    } catch (err) {
      void err;
    }
    expect(dotAgentsExists).toBe(false);
  });

  // D5-SA5.3-H1: `hatch3r init` must seed `.agents/learnings/README.md`
  // so the learnings directory exists and surfaces the feature to users
  // instead of the loader agent silently no-op'ing on an empty dir.
  it("should seed .agents/learnings/README.md on fresh init", async () => {
    await initCommand({ yes: true });

    const readmePath = join(tempDir, AGENTS_DIR, "learnings", "README.md");
    await expect(access(readmePath)).resolves.toBeUndefined();

    const content = await readFile(readmePath, "utf-8");
    expect(content).toContain("Project Learnings");
    expect(content).toContain("hatch3r-learnings-loader");
    expect(content).toContain("frontmatter");
  });

  // D14-SA13.4-H1 (D13): the shipped learnings seed must teach the canonical
  // frontmatter schema (`id`/`topic`/`applies-to`/`confidence`/`created` per
  // rules/hatch3r-learning-system.md), NOT the deprecated keys the loader
  // downgrades to confidence:low. Assert every learning frontmatter block
  // embedded in the seed README (the copy-paste examples) carries only keys
  // that are a subset of the canonical schema and emits none of the deprecated
  // match keys.
  it("seed learnings README teaches the canonical frontmatter schema (no deprecated keys)", async () => {
    await initCommand({ yes: true });

    const content = await readFile(
      join(tempDir, AGENTS_DIR, "learnings", "README.md"),
      "utf-8",
    );

    // Canonical schema (rules/hatch3r-learning-system.md → Structured Frontmatter).
    const CANONICAL_KEYS = new Set(["id", "topic", "applies-to", "confidence", "supersedes", "created"]);
    // Deprecated match keys the loader penalizes (hatch3r-learnings-loader.md).
    const DEPRECATED_KEYS = ["category", "area", "recorded", "source", "author", "date", "tags"];

    // Extract every fenced code block, then keep those that open with a YAML
    // frontmatter fence (`---`) — these are the learning examples a user copies.
    const fenceRe = /```(?:yaml|markdown)?\n([\s\S]*?)```/g;
    const frontmatterBlocks: string[] = [];
    for (const m of content.matchAll(fenceRe)) {
      const body = m[1];
      const fm = body.match(/^---\n([\s\S]*?)\n---/);
      if (fm) frontmatterBlocks.push(fm[1]);
    }
    // At least the Format example + the Recommended First Learning block.
    expect(frontmatterBlocks.length).toBeGreaterThanOrEqual(2);

    for (const block of frontmatterBlocks) {
      const keys = block
        .split("\n")
        .map((line) => line.match(/^([A-Za-z0-9-]+):/)?.[1])
        .filter((k): k is string => Boolean(k));
      // Every declared key is part of the canonical schema.
      for (const key of keys) {
        expect(CANONICAL_KEYS.has(key)).toBe(true);
      }
      // None of the deprecated keys leak into the seed.
      for (const dep of DEPRECATED_KEYS) {
        expect(keys).not.toContain(dep);
      }
    }
  });

  it("should preserve a user-edited learnings README on re-init", async () => {
    await initCommand({ yes: true });

    const readmePath = join(tempDir, AGENTS_DIR, "learnings", "README.md");
    const userContent = "# My Custom Learnings\n\nDo not overwrite.\n";
    await writeFile(readmePath, userContent, "utf-8");

    await initCommand({ yes: true });

    const afterReinit = await readFile(readmePath, "utf-8");
    expect(afterReinit).toBe(userContent);
  });

  it("does NOT emit root AGENTS.md (Wave 3 removal)", async () => {
    await initCommand({ yes: true });

    // Wave 3 (decision #3): root AGENTS.md is no longer emitted; each
    // adapter writes its own native bridge file (CLAUDE.md, .cursor/rules/,
    // .github/copilot-instructions.md).
    let agentsMdExists = false;
    try {
      await access(join(tempDir, "AGENTS.md"));
      agentsMdExists = true;
    } catch (err) {
      void err;
    }
    expect(agentsMdExists).toBe(false);
  });

  it("should generate adapter output files", async () => {
    await initCommand({ yes: true, tools: "cursor" });

    await expect(access(join(tempDir, ".cursor"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, ".cursor", "rules"))).resolves.toBeUndefined();
  });

  it("should use specified tools from --tools flag", async () => {
    await initCommand({ yes: true, tools: "cursor,claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
  });

  it("should reject invalid tools", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");

    await expect(initCommand({ yes: true, tools: "invalid-tool" })).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, tools: "invalid-tool" });
    } catch (e) {
      // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
      expect((e as HatchError).exitCode).toBe(64);
      // C9-H27 (D10-SA10.2-F2): invalid-tool throw site carries an
      // actionable recoveryHint listing the valid ids — verifies the new
      // structured field is threaded through the --yes init path.
      expect((e as HatchError).recoveryHint).toBeDefined();
      expect((e as HatchError).recoveryHint).toMatch(/Re-run with --tools/);
    }

    // C8-D12-M1: `error()` routes to stderr per POSIX; check both streams so
    // future routing changes don't false-positive this assertion.
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    const stderr = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(stdout + " " + stderr).toContain("Invalid tool(s)");
  });

  it("should set all default features with --yes flag", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.features.agents).toBe(true);
    expect(manifest.features.skills).toBe(true);
    expect(manifest.features.rules).toBe(true);
    // Cycle 11 D2-3: prompts defaults OFF — no adapter emits prompt files and
    // canonical ships no `prompts/` content, so defaulting it on fired a
    // spurious unsupported-feature warning on the happy path.
    expect(manifest.features.prompts).toBe(false);
    expect(manifest.features.commands).toBe(true);
    // W3-mcp-optin: MCP defaults OFF — pure opt-in via `--mcp` on any init
    // path or the `hatch3r mcp setup` side-door.
    expect(manifest.features.mcp).toBe(false);
    expect(manifest.features.githubAgents).toBe(true);
  });

  // Wave 3 (CLI-tooling pivot, plan §4.3): MCP is now off by default in
  // `--yes`; callers must pass `--mcp` to re-opt-in. Tests that exercise the
  // server picker side-effects pass the flag explicitly.
  it("should include MCP servers when mcp feature is enabled and --mcp is passed", async () => {
    await initCommand({ yes: true, mcp: true } as Parameters<typeof initCommand>[0]);

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.mcp).toBeDefined();
    expect(manifest.mcp.servers.length).toBeGreaterThan(0);
    // W3-mcp-optin: `features.mcp` derives from the resolved server list.
    expect(manifest.features.mcp).toBe(true);
  });

  it("--yes default produces empty MCP servers (Wave 3 plan §4.3)", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // Plan §4.3 step 8 / §2 decision row: --yes now defaults MCP off. The
    // server list is empty unless --mcp is explicitly passed.
    expect(manifest.mcp.servers).toEqual([]);
    // W3-mcp-optin: the derived feature flag matches the empty list.
    expect(manifest.features.mcp).toBe(false);
  });

  it("should create .env.mcp with required env vars for selected servers when --mcp is passed", async () => {
    await initCommand({ yes: true, mcp: true } as Parameters<typeof initCommand>[0]);

    const envPath = join(tempDir, ".env.mcp");
    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("GITHUB_PAT=");
    expect(content).toContain("hatch3r MCP secrets");
  });

  it("should filter canonical mcp.json to only include selected servers when --mcp is passed", async () => {
    await initCommand({ yes: true, mcp: true } as Parameters<typeof initCommand>[0]);

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const selectedServers = new Set(manifest.mcp.servers);

    const mcpPath = join(tempDir, AGENTS_DIR, "mcp", "mcp.json");
    const mcpContent = JSON.parse(await readFile(mcpPath, "utf-8"));
    const canonicalServers = Object.keys(mcpContent.mcpServers ?? {});

    expect(canonicalServers.length).toBe(selectedServers.size);
    for (const name of canonicalServers) {
      expect(selectedServers.has(name)).toBe(true);
    }
  });

  it("should print summary after init", async () => {
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Hatch complete");
    expect(output).toContain("Tools");
    expect(output).toContain("Features");
  });

  // D10-17 (D10, P1): init wires `recordFirstRunSuccess` at its success
  // terminus, persisting the primary SPACE metric `firstRunSuccessRate` to
  // `.hatch3r/telemetry/space-<date>.jsonl`. This proves the SPACE-telemetry
  // module is an invoked runtime feature (closing the F10.8-1 integration gap),
  // not a tested-but-uncalled library.
  it("records firstRunSuccessRate=1 SPACE telemetry on a successful init", async () => {
    await initCommand({ yes: true });

    const today = new Date().toISOString().slice(0, 10);
    const telemetryPath = join(tempDir, AGENTS_DIR, "telemetry", `space-${today}.jsonl`);
    const content = await readFile(telemetryPath, "utf-8");
    const records = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { metricId: string; axis: string; value: number; source?: string; tags?: Record<string, string> });

    const firstRun = records.find((r) => r.metricId === "firstRunSuccessRate");
    expect(firstRun).toBeDefined();
    expect(firstRun?.axis).toBe("performance");
    expect(firstRun?.value).toBe(1);
    expect(firstRun?.source).toBe("hatch3r-init");
    // A clean (non-partial) init tags the record so the aggregator can segment
    // partial-failure runs.
    expect(firstRun?.tags?.partialAdapterFailure).toBe("false");
  });

  // D10-SA10.8-01 (D10, P5): init also feeds the SPACE `efficiency`
  // (time-to-first-value, previously computed then discarded by
  // printTimingSummary) and `activity` (adapters generated) axes — raising the
  // realized SPACE surface from 1/5 (performance only) to 3/5. Both persist to
  // the same JSONL sink as firstRunSuccessRate.
  it("records efficiency (timeToFirstValueMs) and activity (adaptersGenerated) SPACE telemetry on a successful init", async () => {
    await initCommand({ yes: true });

    const today = new Date().toISOString().slice(0, 10);
    const telemetryPath = join(tempDir, AGENTS_DIR, "telemetry", `space-${today}.jsonl`);
    const records = (await readFile(telemetryPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { metricId: string; axis: string; value: number; source?: string });

    const efficiency = records.find((r) => r.metricId === "timeToFirstValueMs");
    expect(efficiency).toBeDefined();
    expect(efficiency?.axis).toBe("efficiency");
    expect(efficiency?.value).toBeGreaterThanOrEqual(0);
    expect(efficiency?.source).toBe("hatch3r-init");

    const activity = records.find((r) => r.metricId === "adaptersGenerated");
    expect(activity).toBeDefined();
    expect(activity?.axis).toBe("activity");
    // At least one adapter generated output on a successful init.
    expect(activity?.value).toBeGreaterThanOrEqual(1);
  });

  it("should display sourcing hint in success box when --mcp is passed", async () => {
    // Wave 3: the .env.mcp hint only shows when an MCP setup is generated;
    // pass --mcp to re-opt-in so this assertion remains meaningful.
    await initCommand({ yes: true, mcp: true } as Parameters<typeof initCommand>[0]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Add your secrets to");
    expect(output).toContain(".env.mcp");
    expect(output).toContain("Then run:");
  });

  it("should overwrite existing .agents/ without prompting in --yes mode", async () => {
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hatch.json"),
      JSON.stringify({ version: "2.0.0", hatch3rVersion: "0.0.1", platform: "github", tools: [], features: {}, mcp: { servers: [] }, managedFiles: [] }),
    );

    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(agentsDir, "hatch.json"), "utf-8"));
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
  });

  // D12-4 (Cycle 11 Wave 2, D12, P2): init writes `.hatch3r/provenance.json`
  // (lastCommand: "init") so `hatch3r explain --source` resolves immediately
  // after a fresh init — previously only `sync` wrote it, leaving post-init
  // explain with "No provenance manifest found".
  it("writes .hatch3r/provenance.json with lastCommand=init after init", async () => {
    await initCommand({ yes: true, tools: "cursor" });

    const provenancePath = join(tempDir, AGENTS_DIR, "provenance.json");
    const provenance = JSON.parse(await readFile(provenancePath, "utf-8")) as {
      schemaVersion: number;
      lastCommand: string;
      outputs: Array<{ path: string; adapter: string; sourceFiles: string[] }>;
    };
    expect(provenance.schemaVersion).toBe(1);
    expect(provenance.lastCommand).toBe("init");
    expect(provenance.outputs.length).toBeGreaterThan(0);
    expect(provenance.outputs.every((o) => o.adapter === "cursor")).toBe(true);
  });

  // D12-2 (Cycle 11 Wave 2, D12, P4): size guard for the standard-preset
  // provenance manifest. Before D12-1 every output carried an identical
  // 232-file `sourceFiles` array, so a standard init+sync produced a 12.4 MB
  // provenance.json (~26 KB/entry, largest entry 24,215 bytes). D12-1 made
  // per-rule/per-agent/per-skill outputs single-source; only a handful of
  // aggregate outputs (CLAUDE.md, the cursor bridge, the policy/hook docs)
  // still legitimately reference the whole canonical read set. This guard
  // asserts the per-entry breadth stays near the post-D12-1 single-source mean
  // and is a regression alarm against re-introducing the all-outputs-232
  // attribution: that regression would push the mean back to ~232 sources /
  // ~26 KB per entry — over 5x past both bounds below.
  it("keeps provenance.json entry breadth bounded for the standard preset (D12-2)", async () => {
    await initCommand({ yes: true, tools: "cursor" });

    const provenancePath = join(tempDir, AGENTS_DIR, "provenance.json");
    const raw = await readFile(provenancePath, "utf-8");
    const provenance = JSON.parse(raw) as {
      outputs: Array<{ path: string; adapter: string; sourceFiles: string[] }>;
    };
    const n = provenance.outputs.length;
    expect(n).toBeGreaterThan(0);

    // Mean bytes per entry: the metric the (now-corrected) old sync.ts:1191
    // comment falsely claimed ("≤200-bytes-per-entry") but never enforced.
    // Post-D12-1 the cursor standard preset measures ~1.7 KB/entry; the
    // pathological all-232 state was ~26 KB/entry. Bound at 4 KB → ~2.3x
    // headroom over the real mean, ~6x below the pathology.
    const meanBytesPerEntry = Buffer.byteLength(raw, "utf-8") / n;
    expect(meanBytesPerEntry).toBeLessThan(4096);

    // Mean sourceFiles per output: ~13 post-D12-1 (95%+ are single-source; a
    // few aggregates carry the full read set). The pathology was 232 for
    // every output. Bound at 64 → catches a regression to the all-232 fill
    // while leaving the legitimate aggregate outputs room.
    const totalSources = provenance.outputs.reduce((s, o) => s + o.sourceFiles.length, 0);
    const meanSourcesPerOutput = totalSources / n;
    expect(meanSourcesPerOutput).toBeLessThan(64);

    // At least 80% of outputs must be single-source — the direct, structural
    // signature of D12-1's per-output attribution. A re-broadening regression
    // collapses this fraction first.
    const singleSource = provenance.outputs.filter((o) => o.sourceFiles.length === 1).length;
    expect(singleSource / n).toBeGreaterThan(0.8);
  });

  // 1.7.1: re-init over an existing `.agents/hatch.json` must defensively
  // preserve GitHub Projects v2 IDs (board.projectNumber, statusFieldId,
  // statusOptions, areas) plus other user-set state (costTracking, specs).
  // Before this fix `createManifest` reset board IDs to null on every init.
  it("preserves board.projectNumber, statusOptions, areas across re-init", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const baseline = JSON.parse(await readFile(manifestPath, "utf-8"));
    baseline.board = {
      ...baseline.board,
      projectNumber: 42,
      statusFieldId: 99,
      statusOptions: {
        backlog: "PVTSSF_backlog",
        ready: "PVTSSF_ready",
        inProgress: "PVTSSF_in_progress",
        inReview: "PVTSSF_in_review",
        done: "PVTSSF_done",
      },
      areas: ["api", "ui"],
    };
    await writeFile(manifestPath, JSON.stringify(baseline, null, 2));

    await initCommand({ yes: true });

    const after = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(after.board.projectNumber).toBe(42);
    expect(after.board.statusFieldId).toBe(99);
    expect(after.board.statusOptions.backlog).toBe("PVTSSF_backlog");
    expect(after.board.statusOptions.done).toBe("PVTSSF_done");
    expect(after.board.areas).toEqual(["api", "ui"]);
  });

  it("preserves costTracking budgets and specs paths across re-init", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const baseline = JSON.parse(await readFile(manifestPath, "utf-8"));
    baseline.costTracking = { sessionBudget: 5, currency: "USD", hardStop: true };
    baseline.specs = { paths: ["docs/api.md", "docs/architecture.md"], lastGenerated: "2026-05-01" };
    await writeFile(manifestPath, JSON.stringify(baseline, null, 2));

    await initCommand({ yes: true });

    const after = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(after.costTracking).toEqual({ sessionBudget: 5, currency: "USD", hardStop: true });
    expect(after.specs.paths).toEqual(["docs/api.md", "docs/architecture.md"]);
    expect(after.specs.lastGenerated).toBe("2026-05-01");
  });

  // 1.7.5 (Wave 5, CLI-tooling pivot plan §4.7): cliTools selection survives
  // a re-init. Init-supplied cliTools wins over preserved per the
  // applyPreservedManifestFields rule, but the explicit flag path mirrors
  // the previous selection — this test pins the bonus round-trip surface.
  it("re-init --yes --cli-tools tier1 preserves the same tier-1 selection", async () => {
    await initCommand({ yes: true, cliTools: "tier1" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const baseline = JSON.parse(await readFile(manifestPath, "utf-8"));
    // Confirm the first init produced the expected tier-1 set.
    expect(baseline.cliTools.selected).toContain("ripgrep");
    expect(baseline.cliTools.selected).toContain("jq");

    // Re-init with the same flag — selection re-emerges deterministically.
    await initCommand({ yes: true, cliTools: "tier1" });

    const after = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(after.cliTools.selected).toEqual(baseline.cliTools.selected);
  });

  it("does NOT include AGENTS.md in managedFiles (Wave 3 removal)", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    // Wave 3 removed root AGENTS.md emission; the path must not appear in
    // managedFiles either, since orphan-cleanup walks that list.
    expect(manifest.managedFiles).not.toContain("AGENTS.md");
  });

  it("does NOT touch a pre-existing root AGENTS.md (Wave 3 removal)", async () => {
    // Wave 3: init no longer touches root AGENTS.md at all. A user-authored
    // file at the root must be byte-identical after init runs.
    const userContent = "# My Project Instructions\n\nUse TypeScript for all new code.";
    await writeFile(join(tempDir, "AGENTS.md"), userContent);

    await initCommand({ yes: true });

    const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(content).toBe(userContent);
  });

  it("should preserve user content in platform-specific files (e.g. CLAUDE.md) when pre-existing", async () => {
    const userContent = "# My Claude Preferences\n\nAlways prefer functional style.";
    await writeFile(join(tempDir, "CLAUDE.md"), userContent);

    await initCommand({ yes: true, tools: "claude" });

    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain(userContent);
    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("hatch3r");
  });

  it("should handle multiple valid tools from --tools flag", async () => {
    // Wave 1 hard-cut deleted gemini (and 11 other adapters). Use the
    // three retained adapters as the multi-tool fixture.
    await initCommand({ yes: true, tools: "cursor,claude,copilot" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
    expect(manifest.tools).toContain("copilot");
    expect(manifest.tools.length).toBe(3);
  }, 60_000); // Generates output for 3 adapters; on slower Windows runners
                // this can exceed the default 30s testTimeout in vitest.config.ts
                // even though it completes in ~2-5s on Mac/Linux. Confirmed
                // flakiness, not a regression — the surrounding init tests
                // also slow ~2-3x on the same runs.

  it("should reject when any tool in --tools is invalid", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");

    await expect(initCommand({ yes: true, tools: "cursor,bogus" })).rejects.toThrow(HatchError);
    // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
    try { await initCommand({ yes: true, tools: "cursor,bogus" }); } catch (e) { expect((e as HatchError).exitCode).toBe(64); }
    // C8-D12-M1: `error()` routes to stderr per POSIX; check both streams.
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    const stderr = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    const all = stdout + " " + stderr;
    expect(all).toContain("Invalid tool(s)");
    expect(all).toContain("bogus");
  });

  it("should detect existing tools and use them as defaults with --yes", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });

    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
  });

  it("should create the .hatch3r/learnings/ directory (Wave 6 relocation)", async () => {
    await initCommand({ yes: true });

    // Wave 6: learnings live under `.hatch3r/learnings/` now.
    const hatch3rDir = join(tempDir, HATCH3R_DIR);
    await expect(access(join(hatch3rDir, "learnings"))).resolves.toBeUndefined();
  });

  // Removed (Wave 3 + Wave 4): canonical AGENTS.md was previously emitted at
  // `.agents/AGENTS.md` as the source for the root bridge file. The whole
  // tree is gone — adapters source canonical content from the bundled
  // package — so this test has no implementation to exercise.

  it("should handle a single tool from --tools flag", async () => {
    // Wave 1 hard-cut deleted `amp` along with 11 other adapters. Use
    // claude as the single-tool fixture (one of the three retained).
    await initCommand({ yes: true, tools: "claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toEqual(["claude"]);
  });

  it("should use standard preset by default with --yes flag (C9-H25)", async () => {
    // C9-H25 (D10-SA10.1-F2): Default preset is "standard" — aligns README,
    // quick-start, and init.ts on the audit-recommended default. "Full"
    // remains an opt-in for users who want everything including board
    // management and niche audits (a11y, performance, customize).
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // In --yes mode, content.preset must default to standard
    expect(manifest.content?.preset).toBe("standard");
  });

  it("should create hooks directory when hooks feature is enabled", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // hooks feature should be enabled by default
    expect(manifest.features.hooks).toBe(true);
  });

  // F1.1-C1 (Cycle 10 Wave 1): Decision 27 / Bucket 2.2 wiring.
  // `hatch3r init` MUST capture a pre-mutation snapshot under
  // `.hatch3r/snapshots/<sessionId>/` so `hatch3r rollback list` is
  // non-empty after a fresh init and `hatch3r rollback --session=<id>`
  // can revert the run. Without this wiring `--resume` and `rollback`
  // were dead surface (D1 synthesis F1.1).
  describe("Decision 27 snapshot wiring (F1.1-C1)", () => {
    it("captures a pre-mutation snapshot when init writes adapter outputs", async () => {
      await initCommand({ yes: true, tools: "claude" });

      // listSnapshots() reads `<rootDir>/.hatch3r/snapshots/*/meta.json`.
      const { listSnapshots } = await import("../../pipeline/snapshot.js");
      const sessions = await listSnapshots({ projectRoot: tempDir });
      expect(sessions.length).toBeGreaterThan(0);
      // Session id format is `init-<ISO-timestamp>` per runInitInner.
      const initSession = sessions.find((s) => s.sessionId.startsWith("init-"));
      expect(initSession).toBeDefined();
      expect(initSession!.paths.length).toBeGreaterThan(0);
      // The captured paths include the manifest target and the CLAUDE.md
      // adapter output — both files about to be created.
      const relativePaths = initSession!.relativePaths;
      expect(relativePaths.some((p) => p.endsWith("hatch.json"))).toBe(true);
      expect(relativePaths.some((p) => p === "CLAUDE.md")).toBe(true);
    }, 90_000);

    it("`hatch3r rollback list` enumerates the captured init session", async () => {
      // Integration test per F1.1-C1 recommendation step 4: running init
      // followed by `rollback list` must report a non-empty list so the
      // surface advertised in `src/cli/commands/rollback.ts` is real.
      await initCommand({ yes: true, tools: "claude" });
      const { rollbackListCommand } = await import("../../cli/commands/rollback.js");
      await rollbackListCommand();
      const out = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const errOut = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const combined = out + "\n" + errOut;
      // The list output is "Snapshot sessions (<n>):" — assert the header
      // is present (i.e. the empty-state branch did NOT fire).
      expect(combined).toMatch(/Snapshot sessions/);
      expect(combined).not.toMatch(/No snapshot sessions/);
      // The init session id appears in the listing.
      expect(combined).toMatch(/init-/);
    }, 90_000);

    it("`--resume` reads checkpoint and warns when none exists", async () => {
      // D11-H-7 (Wave 2 RETRY): prior Wave 1 F1.1-C1 behaviour was a fixed
      // "not yet wired" warn(). D11-H-7 wires `--resume` to read
      // `.init-workspace/checkpoint.json` via `readCheckpoint()`. Absence
      // of a checkpoint surfaces a warn() naming the checkpoint path and
      // falls through to a fresh init (rollback is the supported revert
      // mechanism for the single-pass run).
      await initCommand({ yes: true, resume: true });
      // Init still completes normally — `--resume` is documented as
      // reserved surface, not a hard error.
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      await expect(access(manifestPath)).resolves.toBeUndefined();
      // The warning text appears in console.error (warn() in ui.ts
      // routes through the warn helper) or stdout (info routes there).
      const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const stderr = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const combined = stdout + "\n" + stderr;
      expect(combined).toMatch(/--resume/);
      expect(combined).toMatch(/no checkpoint found/);
    }, 90_000);
  });

  // C7-H8 (D1): writeManifest must run AFTER adapter generation so that a
  // failure to generate any adapter output does not leave a partial-state
  // hatch.json on disk.
  describe("manifest write ordering (C7-H8)", () => {
    it("writes manifest only after adapter generation succeeds", async () => {
      await initCommand({ yes: true, tools: "claude" });

      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

      // After successful init the manifest exists with managedFiles populated
      // (managedFiles entries are added during adapter generation).
      expect(manifest.managedFiles.length).toBeGreaterThan(0);
      // CLAUDE.md is one of the adapter outputs that should be tracked.
      expect(manifest.managedFiles).toContain("CLAUDE.md");
    });

    it("does NOT leave a manifest on disk when all adapters fail", async () => {
      // Mock the adapter to fail. We replace the adapter map's generate to
      // throw; this exercises the early-throw path where writeManifest must
      // not have run yet (per C7-H8).
      const adaptersMod = await import("../../adapters/index.js");
      const failingAdapter = {
        get warnings() { return [] as string[]; },
        generate: async () => { throw new Error("simulated adapter failure"); },
      };
      const getAdapterSpy = vi.spyOn(adaptersMod, "getAdapter")
        .mockReturnValue(failingAdapter as unknown as ReturnType<typeof adaptersMod.getAdapter>);

      try {
        await expect(initCommand({ yes: true, tools: "claude" })).rejects.toThrow(HatchError);

        // C7-H8: hatch.json must NOT exist when all adapters failed
        const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
        await expect(access(manifestPath)).rejects.toThrow();

        // D10-39 (D10, P1): the all-adapters-failed terminus records the primary
        // SPACE metric `firstRunSuccessRate=0` before throwing, so the metric is
        // not survivorship-biased to 1. Telemetry honours the Silent Failure
        // Contract and writes independently of the (absent) manifest.
        const today = new Date().toISOString().slice(0, 10);
        const telemetryPath = join(tempDir, AGENTS_DIR, "telemetry", `space-${today}.jsonl`);
        const records = (await readFile(telemetryPath, "utf-8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { metricId: string; axis: string; value: number; tags?: Record<string, string> });
        const firstRun = records.find((r) => r.metricId === "firstRunSuccessRate");
        expect(firstRun?.axis).toBe("performance");
        expect(firstRun?.value).toBe(0);
        expect(firstRun?.tags?.failure).toBe("content");
      } finally {
        getAdapterSpy.mockRestore();
      }
    });
  });
});

// F16.1-C1 (Decision 27 / Bucket 2.2): init writes a checkpoint after each
// mutation phase under `.init-workspace/checkpoint.json`, and `--resume`
// short-circuits when a `passed` checkpoint at the current hatch3r version
// already exists.
describe("init resumability checkpoints (F16.1-C1)", () => {
  let initCommand: (opts?: { yes?: boolean; resume?: boolean; tools?: string }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-cp-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("writes a `passed` checkpoint at .init-workspace/checkpoint.json after a successful init", async () => {
    await initCommand({ yes: true, tools: "claude" });

    const cpRaw = await readFile(join(tempDir, ".init-workspace", "checkpoint.json"), "utf-8");
    const cp = JSON.parse(cpRaw) as { phase: string; status: string; wave: number; meta: { baselineSha: string } };
    expect(cp.phase).toBe("init");
    expect(cp.status).toBe("passed");
    expect(cp.wave).toBe(2);
    expect(cp.meta.baselineSha).toBe(HATCH3R_VERSION);
  });

  it("--resume short-circuits when a passed checkpoint at the current version exists", async () => {
    // First run writes the checkpoint.
    await initCommand({ yes: true, tools: "claude" });

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
    // Second run with --resume should report completion and not re-run init.
    await initCommand({ yes: true, resume: true, tools: "claude" });

    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toMatch(/Nothing to resume|completed/i);
    // The resume short-circuit returns before the "Hatch complete" box.
    expect(output).not.toContain("Hatch complete");
  });

  it("--resume with no checkpoint warns and continues as a fresh init", async () => {
    await initCommand({ yes: true, resume: true, tools: "claude" });

    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toMatch(/no checkpoint found|fresh init/i);
    // Fresh init completes.
    await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();
  });

  // D1-SA1.1-04: `recordPhase(1, "passed")` overwrites the single checkpoint.json
  // AFTER adapter generation but BEFORE finalize writes the manifest. A reader
  // keyed only on `status === "passed"` misreports that mid-run state as
  // "already completed". The reader now requires the FINALIZE wave marker AND an
  // on-disk manifest before short-circuiting.
  it("D1-SA1.1-04: a wave-1 `passed` checkpoint with no manifest is NOT reported completed — resume runs a fresh init", async () => {
    // Reproduce the exact on-disk state recordPhase leaves mid-run: generation
    // recorded { wave: 1, status: "passed" }, then the process died before
    // finalize wrote `.hatch3r/hatch.json`.
    const wsDir = join(tempDir, ".init-workspace");
    await mkdir(wsDir, { recursive: true });
    await writeFile(
      join(wsDir, "checkpoint.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          phase: "init",
          wave: 1,
          status: "passed",
          meta: {
            baselineSha: HATCH3R_VERSION,
            lastPassedGateN: 1,
            registrySha: "",
            timestamp: new Date().toISOString(),
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    // Precondition: finalize never ran, so no manifest exists yet.
    await expect(
      access(join(tempDir, AGENTS_DIR, "hatch.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await initCommand({ yes: true, resume: true, tools: "claude" });

    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    // Must NOT falsely short-circuit as complete...
    expect(output).not.toMatch(/Nothing to resume|already completed/i);
    // ...a fresh init must have run to completion (manifest now on disk).
    await expect(
      access(join(tempDir, AGENTS_DIR, "hatch.json")),
    ).resolves.toBeUndefined();
  });
});

// D1-SA1.1-02 (D1, P1): a `--import` at init must feed the imported overrides
// INTO adapter generation (not a detached tail step), so the generated tool
// config already contains the imported rules and an immediate `verify` reports
// zero drift. runToolImport now runs before runInit; this pins that ordering by
// asserting the imported rule reaches the generated `.claude/rules/` output.
describe("init --import feeds generation (D1-SA1.1-02)", () => {
  let initCommand: (opts?: {
    yes?: boolean;
    tools?: string;
    import?: string;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-import-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("imported cursor rule reaches generated .claude/rules output after a single init --import", async () => {
    // Seed a valid cursor rule at the source path the importer reads.
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(
      join(cursorRulesDir, "team-style.mdc"),
      [
        "---",
        "description: Team style guide",
        'globs: ["**/*.ts"]',
        "alwaysApply: false",
        "---",
        "# Team Style",
        "",
        "Prefer named exports.",
        "",
      ].join("\n"),
      "utf-8",
    );

    await initCommand({ yes: true, tools: "claude", import: "cursor" });

    // The importer namespaces the id as hatch3r-cursor-import-<name>; the claude
    // adapter emits it under .claude/rules/. If import ran AFTER generation (the
    // D1-SA1.1-02 defect) the rule would be absent here until a manual sync.
    const { readdir } = await import("node:fs/promises");
    const claudeRules = await readdir(join(tempDir, ".claude", "rules"));
    expect(
      claudeRules.some((f) => f.includes("hatch3r-cursor-import-team-style")),
    ).toBe(true);
  });
});

// D14-SA14.3-01 (D14, CQ9): --role is latent until the canonical corpus carries
// role:* tags. No artifact does yet, so a role value must NOT collapse the
// selection to floor+protected — init warns and IGNORES the flag, leaving the
// preset selection intact (matching setup's discipline of keeping the incomplete
// feature off the surface).
describe("init --role latent gate (D14-SA14.3-01)", () => {
  let initCommand: (opts?: {
    yes?: boolean;
    role?: string;
    tools?: string;
    format?: string;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-role-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("warns that --role matched 0 role-tagged artifacts and still completes the install", async () => {
    await initCommand({ yes: true, role: "reviewer", tools: "claude" });

    const errOutput = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("matched 0 role-tagged artifacts");
    expect(errOutput).toContain("--role is ignored");

    // The flag is ignored, not fatal — the install still wrote its manifest.
    const manifestExists = await access(join(tempDir, AGENTS_DIR, "hatch.json"))
      .then(() => true)
      .catch(() => false);
    expect(manifestExists).toBe(true);
  });

  it("resolves the same item count with --role as without it (no floor+protected collapse)", async () => {
    // Capture the JSON payload's contentItemCount for a plain init (no role).
    const readCount = async (opts: { yes: boolean; tools: string; format: string; role?: string }): Promise<number> => {
      const chunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((c: string | Uint8Array): boolean => {
          chunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf-8"));
          return true;
        }) as never);
      try {
        await initCommand(opts);
      } finally {
        stdoutSpy.mockRestore();
      }
      const combined = chunks.join("");
      return (JSON.parse(combined.slice(combined.indexOf("{")).trim()) as { contentItemCount: number }).contentItemCount;
    };

    const baseCount = await readCount({ yes: true, tools: "claude", format: "json" });

    // Fresh dir for the role run so the second init is not an overwrite.
    const dir2 = await mkdtemp(join(tmpdir(), "hatch3r-init-role2-"));
    cwdSpy.mockReturnValue(dir2);
    const roleCount = await readCount({ yes: true, role: "reviewer", tools: "claude", format: "json" });
    await rm(dir2, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

    expect(baseCount).toBeGreaterThan(0);
    // No collapse: an unbacked --role leaves the selection identical to no-role.
    expect(roleCount).toBe(baseCount);
  });
});

// D14-SA14.4-02 (D14, P1): interactive init detects a competitor tool config
// but historically surfaced the --import migration bridge only via the flag
// (invisible on the happy path). A dim, zero-prompt pointer now fires at the
// Detected: moment, and is suppressed when --import was already passed.
describe("init competitor-config import pointer (D14-SA14.4-02)", () => {
  let initCommand: (opts?: {
    yes?: boolean;
    tools?: string;
    import?: string;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-pointer-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function seedCursorConfig(): Promise<void> {
    const dir = join(tempDir, ".cursor", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "team-style.mdc"),
      "---\ndescription: Team style\nalwaysApply: false\n---\n# Team Style\n\nPrefer named exports.\n",
      "utf-8",
    );
  }

  it("emits an import pointer when a cursor config is detected and --import was not passed", async () => {
    await seedCursorConfig();
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("carry your rules across");
    expect(output).toContain("hatch3r init --import cursor");
  });

  it("suppresses the import pointer when --import was already passed", async () => {
    await seedCursorConfig();
    await initCommand({ yes: true, tools: "claude", import: "cursor" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("carry your rules across");
  });
});

// F10.3-2 (D10, P1): the interactive first-run flow is capped at ≤6 prompts
// (Decision 25 raised the ceiling 5→6 in 2.1.0 to add the maturity prompt).
describe("init interactive ≤6-prompt ceiling (F10.3-2)", () => {
  let initCommand: (opts?: { mcp?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-5p-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("the common-path interactive flow consumes exactly 6 prompts (platform, identity, preset, maturity, tools, cliTools)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: the 6th prompt is the CLI-tools picker (pickCliTools
    // prompts under `name: "tools"`; the queue is order-based, so this
    // answer lands on the cliTools prompt, not the editor-tools prompt).
    inq.mockResolvedValueOnce({ tools: ["ripgrep", "jq"] });

    await initCommand();

    // Exactly six inquirer.prompt calls — the ≤6-prompt ceiling. (No
    // defaultBranch / projectType / teamSize / mcp prompts; those resolve to
    // smart defaults, with MCP pure opt-in via --mcp. Maturity IS now prompted.)
    expect(inq.mock.calls.length).toBe(6);

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    // W3-mcp-optin: no MCP prompt and no --mcp flag → MCP off, no servers.
    expect(manifest.features.mcp).toBe(false);
    expect(manifest.mcp.servers).toEqual([]);
    // Dropped prompts resolved: defaultBranch from git fallback ("main");
    // the cliTools pick round-trips into the manifest.
    expect(manifest.board?.defaultBranch).toBe("main");
    expect(manifest.cliTools?.selected).toEqual(["ripgrep", "jq"]);
    expect(manifest.cliTools?.enabled).toBe(true);
  });

  it("the --mcp flag enables MCP on the interactive path (no MCP prompt fires)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // 6th prompt: cliTools picker (empty selection → CLI tools disabled).
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({ mcp: true });

    // Still 6 prompts — `--mcp` resolves the server set without prompting.
    expect(inq.mock.calls.length).toBe(6);
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.features.mcp).toBe(true);
    // Platform default set: platform server first, then DEFAULT_MCP tail.
    expect(manifest.mcp.servers).toContain("github");
    expect(manifest.mcp.servers).toContain("playwright");
    expect(manifest.mcp.servers).toContain("context7");
    // Empty cliTools pick → disabled config.
    expect(manifest.cliTools).toEqual({ enabled: false, selected: [] });
  });
});

// C / F (2.1.0): interactive maturity prompt + inferred-default feedback lines.
// The maturity prompt shows on EVERY interactive run (Decision 25 raised the
// ceiling 5→6), seeded at the git-inferred tier; only `--maturity` skips it.
describe("init interactive maturity prompt + inferred-default feedback (C/F, 2.1.0)", () => {
  let initCommand: (opts?: {
    tools?: string;
    teamSize?: string;
    maturity?: string;
    quiet?: boolean;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-mat-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("shows the maturity prompt seeded at the git-inferred tier (--team-size team → team seed)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // Order: platform, identity, preset, maturity, tools, cliTools.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "scaleup" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({ teamSize: "team" });

    // 6 prompts: the maturity step is the 4th, inserted after preset.
    expect(inq.mock.calls.length).toBe(6);
    // The maturity prompt (4th call) is seeded at the git-inferred tier — with
    // `--team-size team` and no `--maturity`, the seed is "team".
    const maturityQuestion = (inq.mock.calls[3][0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
    expect(maturityQuestion.name).toBe("maturity");
    expect(maturityQuestion.default).toBe("team");
    // The user's pick persists.
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.maturity).toBe("scaleup");
  });

  it("the common solo flow shows the maturity prompt (seeded solo) and is 6 prompts", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // Fresh temp dir → inferTeamSizeFromGit falls back to solo → maturity seed
    // "solo". Order: platform, identity, preset, maturity, tools, cliTools.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    expect(inq.mock.calls.length).toBe(6);
    // The maturity prompt IS shown on the common path (Decision 25 5→6), seeded
    // at the inferred solo tier.
    const maturityQuestion = (inq.mock.calls[3][0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
    expect(maturityQuestion.name).toBe("maturity");
    expect(maturityQuestion.default).toBe("solo");
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.maturity).toBe("solo");
  });

  it("--maturity skips the maturity prompt and persists the flag value (back to 5 prompts)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // An explicit `--maturity` is authoritative and gates the prompt off, so the
    // flow drops back to 5 prompts (no maturity step).
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({ teamSize: "team", maturity: "scaleup" });

    expect(inq.mock.calls.length).toBe(5);
    const sawMaturityPrompt = inq.mock.calls.some((call) =>
      (call[0] as unknown as Array<{ name?: string }>).some((q) => q.name === "maturity"),
    );
    expect(sawMaturityPrompt).toBe(false);
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.maturity).toBe("scaleup");
  });

  it("emits the inferred default-branch + maturity feedback lines in human mode", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("Detected default branch:");
    expect(stdout).toContain("Inferred maturity:");
  });

  it("suppresses the inferred-default feedback lines under --quiet (json implies quiet)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({ quiet: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Detected default branch:");
    expect(stdout).not.toContain("Inferred maturity:");
  });
});

// D1-SA1.1-07 (D1, P2/P1): `inferTeamSizeFromGit` counted distinct commit-author
// emails with no bot filtering, so a solo repo with dependabot/renovate/
// github-actions automation carried ≥2 distinct authors and mis-inferred as
// "team" — silently admitting team-only content. The fix drops `[bot]` App
// authors before counting. These tests drive the real resolution path: the
// inferred team size seeds the maturity prompt's default, so the 4th prompt's
// `default` reflects it. The disclosure line naming the consequence
// (recommendation 3) is asserted too.
describe("init team-size inference — bot-author filtering + consequence disclosure (D1-SA1.1-07)", () => {
  let initCommand: (opts?: { tools?: string; teamSize?: string; maturity?: string }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-teamsize-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  // Build a real git repo whose commits carry the given author emails. `-c
  // commit.gpgsign=false` neutralizes a globally-signed environment; `-c
  // user.*` supplies a per-commit author identity so no global git config is
  // required. `%ae` (author email) is what `inferTeamSizeFromGit` reads.
  function initGitRepoWithAuthors(dir: string, authors: Array<{ email: string; name: string }>): void {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
    authors.forEach((a, i) => {
      execFileSync(
        "git",
        [
          "-c",
          "commit.gpgsign=false",
          "-c",
          `user.email=${a.email}`,
          "-c",
          `user.name=${a.name}`,
          "commit",
          "--allow-empty",
          "-q",
          "-m",
          `commit ${i}`,
        ],
        { cwd: dir, stdio: "pipe" },
      );
    });
  }

  function queueSixPrompts(): void {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });
  }

  it("excludes [bot] commit authors so a solo repo with dependabot infers teamSize solo", async () => {
    // 1 human + 1 GitHub App bot in the real dependabot author-email format.
    // Pre-fix: 2 distinct authors → "team"; post-fix: 1 human → "solo".
    initGitRepoWithAuthors(tempDir, [
      { email: "solo-dev@example.com", name: "Solo Dev" },
      { email: "49699333+dependabot[bot]@users.noreply.github.com", name: "dependabot[bot]" },
    ]);
    queueSixPrompts();

    await initCommand({});

    // The maturity prompt (4th call, index 3) is seeded from the inferred team
    // size — bot excluded → single human → "solo".
    const inq = vi.mocked(inquirer.prompt);
    const maturityQuestion = (inq.mock.calls[3][0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
    expect(maturityQuestion.name).toBe("maturity");
    expect(maturityQuestion.default).toBe("solo");

    // D1-SA1.1-07 recommendation (3): the inference line names the CONSEQUENCE.
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("team size filters team-only workflows");
  });

  it("still infers team for two distinct human authors (bot filter does not over-exclude)", async () => {
    initGitRepoWithAuthors(tempDir, [
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: "Bob" },
    ]);
    queueSixPrompts();

    await initCommand({});

    const inq = vi.mocked(inquirer.prompt);
    const maturityQuestion = (inq.mock.calls[3][0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
    expect(maturityQuestion.name).toBe("maturity");
    expect(maturityQuestion.default).toBe("team");
  });
});

// D3-SA3.2-12 (D3, CQ5): the interactive suite answers prompts with an
// order-based positional queue, so a conditionally-inserted prompt shifts every
// downstream answer by one (the documented CI-fragility scar tissue). The shared
// name-keyed `mockPromptsByName` helper removes the order coupling and converts
// silent shifts into NAMED failures. These tests (a) adopt it to drive a real,
// collision-free init flow and (b) pin its anti-fragility contract. Retrofitting
// the `name:"tools"` collision flows + the source-side `cliTools` rename is the
// remaining half (source pickers/flowSteps + config.test.ts are outside this
// unit's lock scope).
describe("init name-keyed prompt mock (D3-SA3.2-12)", () => {
  let initCommand: (opts?: { noCliTools?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-namekey-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("drives a full collision-free interactive init flow by prompt name (--no-cli-tools)", async () => {
    // --no-cli-tools skips the CLI-tools picker, so there is one `tools` prompt
    // (editor) and no name:"tools" collision — the flow the helper drives today.
    mockPromptsByName({
      platform: "github",
      owner: "o",
      repo: "r",
      preset: "minimal",
      maturity: "solo",
      tools: ["claude"],
    });

    await initCommand({ noCliTools: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.maturity).toBe("solo");
    // --no-cli-tools resolved without prompting for the picker.
    expect(manifest.cliTools).toEqual({ enabled: false, selected: [] });
  });

  it("throws a NAMED error when a prompt has no registered answer (anti-fragility contract)", async () => {
    // A mis-ordered / newly-inserted prompt fails by NAME instead of landing an
    // undefined answer that destructures opaquely downstream.
    mockPromptsByName({ platform: "github" });
    await expect(
      (inquirer.prompt as unknown as (q: unknown) => Promise<unknown>)([{ name: "maturity", type: "list" }]),
    ).rejects.toThrow(/no mock answer registered for prompt 'maturity'/);
  });

  it("answers each question by its own name, not queue position", async () => {
    mockPromptsByName({ platform: "github", owner: "o", repo: "r" });
    // A two-question identity-style call resolves BOTH by name in one prompt call
    // — position-independent.
    const answer = await (inquirer.prompt as unknown as (q: unknown) => Promise<Record<string, unknown>>)([
      { name: "owner", type: "input" },
      { name: "repo", type: "input" },
    ]);
    expect(answer).toEqual({ owner: "o", repo: "r" });
  });
});

describe("workspace init", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; workspace?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  /**
   * Create a workspace layout: no .git at root, but subdirectories with .git dirs.
   */
  async function createWorkspaceLayout(root: string, repos: string[]): Promise<void> {
    for (const name of repos) {
      const repoDir = join(root, name);
      await mkdir(join(repoDir, ".git"), { recursive: true });
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-init-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("should skip identity prompts and create workspace.json with --yes", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a", "repo-b"]);

    await initCommand({ yes: true });

    // Workspace manifest should exist
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsRaw = await readFile(wsManifestPath, "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(2);
    expect(wsManifest.repos.map((r: { path: string }) => r.path).sort()).toEqual(["repo-a", "repo-b"]);

    // Root hatch.json should have empty identity (not prompted for single repo)
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.owner).toBe("");
    expect(manifest.repo).toBe("");
    // No board config because defaultBranch is empty
    expect(manifest.board).toBeUndefined();
  });

  it("should create the .hatch3r/ state directory at workspace root", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a"]);

    await initCommand({ yes: true });

    // Wave 6: workspace root writes manifest + workspace.json under
    // `.hatch3r/`. Wave 3 removed the canonical AGENTS.md materialisation
    // entirely.
    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
    await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();

    // No canonical AGENTS.md is materialised at workspace root.
    let canonicalAgentsMd = false;
    try {
      await access(join(tempDir, AGENTS_DIR, "AGENTS.md"));
      canonicalAgentsMd = true;
    } catch (err) {
      void err;
    }
    expect(canonicalAgentsMd).toBe(false);
  });

  it("should respect --tools flag in workspace mode", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a"]);

    await initCommand({ yes: true, tools: "cursor,claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.tools).toEqual(["cursor", "claude"]);

    // Workspace manifest should also have the tools
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsManifest = JSON.parse(await readFile(wsManifestPath, "utf-8"));
    expect(wsManifest.defaults.tools).toEqual(["cursor", "claude"]);
  });

  it("should auto-detect workspace when no root .git exists", async () => {
    // No .git at root, but subdirectories have .git
    await createWorkspaceLayout(tempDir, ["service-api", "service-web"]);

    await initCommand({ yes: true });

    // Should have created workspace.json (auto-detected)
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsRaw = await readFile(wsManifestPath, "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(2);
  });

  it("workspace --yes defaults to standard preset (C9-H25)", async () => {
    // C9-H25 (D10-SA10.1-F2): Workspace --yes path must propagate the same
    // recommended default as single-repo --yes — Standard, not Full. Prevents
    // workspace users from receiving the heavier Full bundle by accident.
    await createWorkspaceLayout(tempDir, ["repo-a", "repo-b"]);

    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.content?.preset).toBe("standard");

    // Workspace defaults block also tracks the recommended preset.
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsManifest = JSON.parse(await readFile(wsManifestPath, "utf-8"));
    expect(wsManifest.defaults?.content?.preset).toBe("standard");
  });
});

// ── C7-H20 (D3): branch-coverage uplift for src/cli/commands/init.ts ──
//
// The blocks below exercise interactive flows, validation paths, partial
// failures, language wiring, and workspace branches that the existing tests
// (which run --yes only) cannot reach. They are required to bring branch
// coverage on init.ts from ~33% to >=65% per the global vitest threshold.

describe("init validation flags (--yes path)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; preset?: string; projectType?: string; teamSize?: string; workspace?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-flags-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("rejects an invalid --preset value", async () => {
    await expect(
      initCommand({ yes: true, preset: "kitchen-sink" }),
    ).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, preset: "kitchen-sink" });
    } catch (e) {
      // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
      expect((e as HatchError).exitCode).toBe(64);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      // C9-H27 (D10-SA10.2-F2): validateFlag carries a hint with the
      // valid options the user can re-run with.
      expect((e as HatchError).recoveryHint).toMatch(/Re-run with one of/);
    }
  });

  it("rejects an invalid --project-type value", async () => {
    await expect(
      initCommand({ yes: true, projectType: "legacy" }),
    ).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, projectType: "legacy" });
    } catch (e) {
      // C9-H27: project-type hint mentions the valid project-type literals.
      expect((e as HatchError).recoveryHint).toMatch(/Re-run with one of/);
    }
  });

  it("rejects an invalid --team-size value", async () => {
    await expect(
      initCommand({ yes: true, teamSize: "duo" }),
    ).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, teamSize: "duo" });
    } catch (e) {
      // C9-H27: team-size hint mentions the valid team-size literals.
      expect((e as HatchError).recoveryHint).toMatch(/Re-run with one of/);
    }
  });

  it("accepts --preset minimal and writes it to the manifest", async () => {
    await initCommand({ yes: true, preset: "minimal" });
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.content?.preset).toBe("minimal");
  });

  it("accepts --preset standard and writes it to the manifest", async () => {
    await initCommand({ yes: true, preset: "standard" });
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.content?.preset).toBe("standard");
  });

  it("--preset standard yields fewer items than --preset full", async () => {
    await initCommand({ yes: true, preset: "standard" });
    const stdManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    const stdCount = Object.values(stdManifest.content.items).reduce(
      (s: number, arr) => s + (arr as string[]).length,
      0,
    );

    // Reset and run with full preset
    await rm(join(tempDir, AGENTS_DIR), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    await initCommand({ yes: true, preset: "full" });
    const fullManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    const fullCount = Object.values(fullManifest.content.items).reduce(
      (s: number, arr) => s + (arr as string[]).length,
      0,
    );

    expect(stdCount).toBeLessThanOrEqual(fullCount);
  });

  it("accepts a --preset archetype id and writes it to the manifest", async () => {
    await initCommand({ yes: true, preset: "web-app" });
    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.content?.preset).toBe("web-app");
  });

  it("accepts a --preset comma-list composition and persists it under the custom label", async () => {
    // A composition resolves to a synthetic preset whose `.id` is "custom";
    // the persisted label is "custom" and the real selection lives in
    // content.items (which round-trips on sync regardless of the label).
    await initCommand({ yes: true, preset: "api-service,security" });
    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.content?.preset).toBe("custom");
    // The composition resolved to a non-empty selection.
    const itemCount = Object.values(manifest.content.items).reduce(
      (s: number, arr) => s + (arr as string[]).length,
      0,
    );
    expect(itemCount).toBeGreaterThan(0);
  });

  it("rejects a --preset comma-list with an unknown part (actionable hint)", async () => {
    await expect(
      initCommand({ yes: true, preset: "api-service,bogus" }),
    ).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, preset: "api-service,bogus" });
    } catch (e) {
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      expect((e as HatchError).recoveryHint).toMatch(/comma-list/);
    }
  });

  it("rejects a --preset comma-list containing custom (custom is not composable)", async () => {
    await expect(
      initCommand({ yes: true, preset: "standard,custom" }),
    ).rejects.toThrow(HatchError);
    try {
      await initCommand({ yes: true, preset: "standard,custom" });
    } catch (e) {
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      expect((e as HatchError).recoveryHint).toMatch(/cannot be composed/);
    }
  });

  it("accepts --project-type greenfield via flag", async () => {
    await initCommand({ yes: true, projectType: "greenfield" });
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.content?.projectType).toBe("greenfield");
  });

  it("accepts --team-size team via flag", async () => {
    await initCommand({ yes: true, teamSize: "team" });
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.content?.teamSize).toBe("team");
  });
});

describe("init partial adapter failure (one of many fails)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-partial-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("writes manifest when at least one adapter succeeds (partial failure)", async () => {
    // Mock cursor adapter to fail, claude succeeds. With both selected,
    // partial failure path runs (line 230-232 ternary + line 258 writeManifest).
    const adaptersMod = await import("../../adapters/index.js");
    const realGetAdapter = adaptersMod.getAdapter;
    const failingAdapter = {
      get warnings() { return [] as string[]; },
      generate: async () => { throw new Error("simulated cursor failure"); },
    };
    const getAdapterSpy = vi.spyOn(adaptersMod, "getAdapter")
      .mockImplementation(((tool: string) => {
        if (tool === "cursor") {
          return failingAdapter as unknown as ReturnType<typeof realGetAdapter>;
        }
        return realGetAdapter(tool as Parameters<typeof realGetAdapter>[0]);
      }) as typeof realGetAdapter);

    try {
      await initCommand({ yes: true, tools: "cursor,claude" });

      // Manifest IS written because claude succeeded
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      await expect(access(manifestPath)).resolves.toBeUndefined();

      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      // CLAUDE.md exists, .cursor/ does not
      expect(manifest.managedFiles).toContain("CLAUDE.md");

      // Failure should be reported on stderr/stdout via logError
      const errOutput = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      const allOutput = errOutput + consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(allOutput).toMatch(/Failed to generate Cursor/);
    } finally {
      getAdapterSpy.mockRestore();
    }
  });
});

describe("init re-init: stale content cleanup", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; preset?: string }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-stale-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("removes stale content when switching from full to minimal preset", async () => {
    // First init with full preset
    await initCommand({ yes: true, preset: "full" });
    const fullManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    const fullItemCount = Object.values(fullManifest.content.items).reduce(
      (s: number, arr) => s + (arr as string[]).length,
      0,
    );

    // Re-init with minimal preset (triggers stale-content cleanup branch lines 136-145)
    await initCommand({ yes: true, preset: "minimal" });
    const minimalManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    const minimalItemCount = Object.values(minimalManifest.content.items).reduce(
      (s: number, arr) => s + (arr as string[]).length,
      0,
    );

    // The minimal preset should have strictly fewer items
    expect(minimalItemCount).toBeLessThan(fullItemCount);
    expect(minimalManifest.content.preset).toBe("minimal");
  });
});

describe("init worktree generation (claude tool present)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; worktree?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-worktree-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("generates .worktreeinclude when a worktree-capable tool is selected", async () => {
    await initCommand({ yes: true, tools: "claude" });

    // Worktree branch (lines 242-254) generates .worktreeinclude
    await expect(
      access(join(tempDir, ".worktreeinclude")),
    ).resolves.toBeUndefined();

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.worktree?.enabled).toBe(true);
    expect(manifest.managedFiles).toContain(".worktreeinclude");
  });

  // Removed (Wave 1): the previous test verified that selecting a single
  // non-worktree-capable tool (`amp`) left `.worktreeinclude` unwritten.
  // After Wave 1's hard-cut, every retained adapter (claude, cursor,
  // copilot) is in WORKTREE_CAPABLE_TOOLS (`src/types.ts:201`). There is
  // no non-worktree-capable tool to use as the negative-case fixture.
  // The `--no-worktree` opt-out below still covers the off path.

  // Slice D: worktree is auto-enabled when a worktree-capable tool is
  // selected; the interactive confirm prompt was removed. --worktree /
  // --no-worktree still override. W3-mcp-optin prompt order:
  //   platform -> owner/repo -> preset -> tools -> cliTools picker
  function queueInteractiveWithWorktree(opts: { tools?: string[] } = {}): void {
    const inq = vi.mocked(inquirer.prompt);
    const tools = opts.tools ?? ["claude"];
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "test-owner", repo: "test-repo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset on every
    // interactive run. Solo default (fresh temp dir → inferTeamSizeFromGit solo).
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools });
    // W3-mcp-optin: 6th prompt is the cliTools picker (pickCliTools answers
    // under `name: "tools"`; order-based queue). Empty = CLI tools disabled,
    // which also skips the detection + installer follow-ups.
    inq.mockResolvedValueOnce({ tools: [] });
  }

  it("interactive init auto-enables worktree when a worktree-capable tool is selected", async () => {
    queueInteractiveWithWorktree({ tools: ["claude"] });
    await initCommand();
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.worktree?.enabled).toBe(true);
    await expect(access(join(tempDir, ".worktreeinclude"))).resolves.toBeUndefined();
  });

  it("interactive init auto-enables worktree when cursor is the only selected tool", async () => {
    queueInteractiveWithWorktree({ tools: ["cursor"] });
    await initCommand();
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.worktree?.enabled).toBe(true);
  });

  it("interactive init auto-enables worktree when copilot is the only selected tool", async () => {
    queueInteractiveWithWorktree({ tools: ["copilot"] });
    await initCommand();
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.worktree?.enabled).toBe(true);
  });

  it("--yes --no-worktree disables worktree even when claude is selected", async () => {
    await initCommand({ yes: true, tools: "claude", worktree: false });
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.worktree).toBeUndefined();
    await expect(access(join(tempDir, ".worktreeinclude"))).rejects.toThrow();
  });

  // Removed (Wave 1): tests below depended on a non-worktree-capable tool
  // selection. After the hard-cut to three adapters (all worktree-capable),
  // the negative case has no fixture and these scenarios are unreachable:
  //   - "--yes --worktree enables worktree even when no worktree-capable
  //     tool is selected" (amp tool deleted)
  //   - "interactive init leaves worktree disabled when no worktree-capable
  //     tool is selected" (amp tool deleted)
  //   - "interactive init with only gemini leaves worktree disabled"
  //     (gemini tool deleted)
});

describe("init language detection (Wave 3 H15)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-lang-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("records detected TypeScript language in the manifest", async () => {
    // Drop a tsconfig.json to trigger TypeScript detection
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022" } }),
    );

    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(Array.isArray(manifest.languages)).toBe(true);
    expect(manifest.languages).toContain("typescript");
  });

  it("records detected Python language in the manifest", async () => {
    await writeFile(
      join(tempDir, "pyproject.toml"),
      "[tool.poetry]\nname = \"test\"\n",
    );

    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.languages).toContain("python");
  });

  it("omits the languages field when no language could be detected", async () => {
    // Empty repo with no language-indicator files
    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    // languagesForSelection filters out 'unknown'; createManifest then omits
    // the languages field altogether (line 103-105 of hatchJson.ts).
    expect(manifest.languages).toBeUndefined();
  });

  it("agnostic content (rules without language tags) is included for any project", async () => {
    // Wave 3: canonical content is no longer copied into the user repo;
    // adapters read it from the bundled package. Verify the contract via
    // the manifest's content selection rather than a `.agents/agents/`
    // file probe. Language-agnostic core agents (e.g. hatch3r-implementer)
    // must still appear in the selected items list for any project.
    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.content?.items?.agents).toContain("hatch3r-implementer");
  });
});

describe("init interactive single-repo flow", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-inter-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /**
   * Queue prompt responses for the interactive single-repo flow.
   * W3-mcp-optin prompt order:
   *   platform -> owner/repo -> preset -> [custom items] -> tools ->
   *   cliTools picker -> [existing-install confirm]
   * Slice D removed the worktree confirm prompt; worktree is auto-enabled
   * when a worktree-capable tool (claude/cursor/copilot) is selected.
   * W3-mcp-optin removed the MCP prompt entirely — MCP is enabled only via
   * the `--mcp` flag (any init path) or `hatch3r mcp setup`. The cliTools
   * picker (pickCliTools, `name: "tools"`) is the 5th prompt; an empty
   * selection disables CLI tools and short-circuits the detection +
   * installer follow-ups so tests stay deterministic.
   */
  function setupGithubInteractive(opts: {
    preset?: "minimal" | "standard" | "full" | "custom";
    projectType?: "greenfield" | "brownfield";
    teamSize?: "solo" | "team";
    maturity?: "solo" | "team" | "scaleup" | "enterprise";
    tools?: string[];
    customItems?: string[];
    cliTools?: string[];
  } = {}): void {
    const inq = vi.mocked(inquirer.prompt);
    const tools = opts.tools ?? ["claude"];
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "test-owner", repo: "test-repo" });
    inq.mockResolvedValueOnce({ preset: opts.preset ?? "full" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset, before the
    // custom-items power-user prompt. Default seeded at the inferred tier.
    inq.mockResolvedValueOnce({ maturity: opts.maturity ?? "solo" });
    if (opts.preset === "custom") {
      inq.mockResolvedValueOnce({ items: opts.customItems ?? [] });
    }
    inq.mockResolvedValueOnce({ tools });
    // W3-mcp-optin: cliTools picker answer (order-based queue; same
    // `name: "tools"` key as the editor-tools prompt above).
    inq.mockResolvedValueOnce({ tools: opts.cliTools ?? [] });
  }

  it("runs the GitHub interactive flow end-to-end", async () => {
    setupGithubInteractive();

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.platform).toBe("github");
    expect(manifest.owner).toBe("test-owner");
    expect(manifest.repo).toBe("test-repo");
    expect(manifest.namespace).toBe("test-owner");
    expect(manifest.project).toBe("test-repo");
    expect(manifest.tools).toEqual(["claude"]);
    expect(manifest.board?.defaultBranch).toBe("main");
  });

  it("runs the GitHub interactive flow with custom preset and explicit selections", async () => {
    setupGithubInteractive({
      preset: "custom",
      customItems: ["hatch3r-implementer"],
    });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.content?.preset).toBe("custom");
    // The custom selection plus protected items should be included
    expect(Array.isArray(manifest.content.items.agents)).toBe(true);
  });

  it("runs the Azure DevOps interactive flow", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "azure-devops" });
    inq.mockResolvedValueOnce({ org: "ado-org", project: "ado-proj", repo: "ado-repo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.platform).toBe("azure-devops");
    expect(manifest.owner).toBe("ado-org");
    expect(manifest.namespace).toBe("ado-org");
    expect(manifest.project).toBe("ado-proj");
    expect(manifest.repo).toBe("ado-repo");
  });

  it("runs the GitLab interactive flow", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "gitlab" });
    inq.mockResolvedValueOnce({ namespace: "gl-ns", project: "gl-proj" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.platform).toBe("gitlab");
    expect(manifest.owner).toBe("gl-ns");
    expect(manifest.repo).toBe("gl-proj");
    expect(manifest.namespace).toBe("gl-ns");
    expect(manifest.project).toBe("gl-proj");
  });

  it("falls back to defaults when interactive answers are blank", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "", repo: "" });
    // Empty branch -> falls back to detected default ("main" via parseGitDefaultBranch)
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    // Empty tool selection -> falls back to DEFAULT_TOOLS (= ["claude"])
    inq.mockResolvedValueOnce({ tools: [] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    // tools: [] -> defaults to ["claude"]
    expect(manifest.tools).toEqual(["claude"]);
    // defaultBranch defaults to "main"
    expect(manifest.board?.defaultBranch).toBe("main");
  });

  it("interactive flow never prompts for MCP servers; MCP defaults off (W3-mcp-optin)", async () => {
    setupGithubInteractive();
    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.features.mcp).toBe(false);
    expect(manifest.mcp.servers).toEqual([]);
  });

  it("interactive: existing .agents/ prompt accept proceeds with init", async () => {
    // Pre-create .agents/ to force the checkExisting prompt
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hatch.json"),
      JSON.stringify({ version: "2.0.0", hatch3rVersion: "0.0.1", platform: "github", tools: [], features: {}, mcp: { servers: [] }, managedFiles: [] }),
    );

    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 6th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    // The checkExisting prompt — accept overwrite
    inq.mockResolvedValueOnce({ proceed: true });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(agentsDir, "hatch.json"), "utf-8"));
    expect(manifest.owner).toBe("o");
    expect(manifest.repo).toBe("r");
  });

  it("interactive: existing .agents/ prompt reject throws cancellation", async () => {
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hatch.json"),
      JSON.stringify({ version: "2.0.0", hatch3rVersion: "0.0.1", platform: "github", tools: [], features: {}, mcp: { servers: [] }, managedFiles: [] }),
    );

    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 6th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    // Reject overwrite
    inq.mockResolvedValueOnce({ proceed: false });

    await expect(initCommand({})).rejects.toThrow(HatchError);
  });
});

describe("init interactive workspace flow", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; workspace?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  async function createWorkspaceLayout(root: string, repos: string[]): Promise<void> {
    for (const name of repos) {
      const repoDir = join(root, name);
      await mkdir(join(repoDir, ".git"), { recursive: true });
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-ws-inter-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("interactive workspace prompt accepts workspace mode", async () => {
    await createWorkspaceLayout(tempDir, ["api", "web"]);

    const inq = vi.mocked(inquirer.prompt);
    // 1) Confirm workspace mode (line 400)
    inq.mockResolvedValueOnce({ useWorkspace: true });
    // 2) Accept detected repo identities (line 784) — true means skip per-repo edit
    inq.mockResolvedValueOnce({ acceptIdentity: true });
    // 3) Project type
    // 4) Team size
    // 4b) Maturity tier (F1.1-H1 / F14.3-H1)
    // 5) Preset
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 6) Tools
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // 7) Features (C9-H28: moved before CLI tools; Slice D: worktree auto-enabled)
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    // 8) Repo selection for sync
    inq.mockResolvedValueOnce({ syncRepos: [] });

    await initCommand({});

    const wsRaw = await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(2);
  });

  it("interactive workspace prompt rejects workspace mode (falls through to single-repo)", async () => {
    await createWorkspaceLayout(tempDir, ["api"]);

    const inq = vi.mocked(inquirer.prompt);
    // 1) Decline workspace mode -> falls through to single-repo interactive flow
    inq.mockResolvedValueOnce({ useWorkspace: false });
    // 2-9) Single-repo prompts (C9-H28 order)
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    // No workspace.json should exist (single-repo path)
    await expect(
      access(join(tempDir, AGENTS_DIR, "workspace.json")),
    ).rejects.toThrow();

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.owner).toBe("o");
  });

  it("interactive workspace: edit identities path runs per-repo prompts", async () => {
    await createWorkspaceLayout(tempDir, ["api"]);

    const inq = vi.mocked(inquirer.prompt);
    // 1) Confirm workspace mode
    inq.mockResolvedValueOnce({ useWorkspace: true });
    // 2) Reject auto-detected identity -> enter edit-identities branch (lines 793-805)
    inq.mockResolvedValueOnce({ acceptIdentity: false });
    // 3) Per-repo identity prompt for "api"
    inq.mockResolvedValueOnce({ owner: "edited-owner", repo: "edited-repo", defaultBranch: "develop" });
    // 4) Project type
    // 5) Team size
    // 5b) Maturity tier (F1.1-H1 / F14.3-H1)
    // 6) Preset
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 7) Tools
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // 8) Features (C9-H28: moved before CLI tools; Slice D: worktree auto-enabled)
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    // 9) Repo sync selection
    inq.mockResolvedValueOnce({ syncRepos: [] });

    await initCommand({});

    const wsRaw = await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    const apiEntry = wsManifest.repos.find((r: { name: string }) => r.name === "api");
    expect(apiEntry?.owner).toBe("edited-owner");
    expect(apiEntry?.repo).toBe("edited-repo");
    expect(apiEntry?.defaultBranch).toBe("develop");
  });

  it("--workspace flag with empty subdirs yields workspace with 0 sub-repos", async () => {
    // No git subdirectories — but --workspace forces workspace mode (line 414).
    // detectSubRepos returns empty -> empty-workspace branch (lines 737-758).
    // Pre-create .agents/ since the empty-workspace branch writes
    // workspace.json directly without calling runInit (which would mkdir it).
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    await initCommand({ yes: true, workspace: true });

    const wsRaw = await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(0);
  });

  it("workspace --yes with multiple repos derives platform from sub-repo majority", async () => {
    // All sub-repos are bare .git dirs (no remotes) -> deriveWorkspacePlatform
    // defaults each to "github", so workspace platform is "github".
    await createWorkspaceLayout(tempDir, ["api", "web", "infra"]);

    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.platform).toBe("github");
  });

  it("workspace --yes with explicit --workspace flag and zero subdirs", async () => {
    // Explicit --workspace + 0 repos triggers the empty-workspace early return
    // path (lines 737-758) even when shouldSuggestWorkspace would return false.
    // The empty-workspace branch writes workspace.json directly without
    // creating .agents/ so we pre-create it here.
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    await initCommand({ yes: true, workspace: true });

    await expect(
      access(join(tempDir, AGENTS_DIR, "workspace.json")),
    ).resolves.toBeUndefined();
  });
});

// ── C8-D3-M1 (Wave 3): branch-coverage uplift for src/cli/commands/init.ts ──
//
// These suites exercise branches introduced or surfaced in Cycle 8 Wave 3:
// * `--quick` / `--default` alias handling (C8-D10-M2)
// * Eager flag validation in the interactive path (C8-D1-M4)
// * runInit idempotency guard (C8-D1-M3)
// * Workspace conflict-confirmation prompt (C8-D1-M3)
// Together they push init.ts branch coverage toward the 65% threshold.

describe("init --quick / --default aliases (C8-D10-M2)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; quick?: boolean; default?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-quick-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("--quick runs without prompts and writes a manifest", async () => {
    await initCommand({ quick: true });
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    await expect(access(manifestPath)).resolves.toBeUndefined();
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.platform).toBe("github");
  });

  it("--default runs without prompts and writes a manifest", async () => {
    await initCommand({ default: true });
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    await expect(access(manifestPath)).resolves.toBeUndefined();
  });

  it("--quick with --tools still honors the tool list", async () => {
    await initCommand({ quick: true, tools: "cursor,claude" });
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
  });
});

describe("init eager flag validation (C8-D1-M4)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; preset?: string; projectType?: string; teamSize?: string }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-eager-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("rejects invalid --preset even in interactive mode (without --yes)", async () => {
    // No --yes flag -> interactive path. Validation must run before any prompt.
    await expect(initCommand({ preset: "does-not-exist" })).rejects.toThrow(HatchError);
    // inquirer.prompt must not have been called because validation aborted.
    expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
  });

  it("rejects invalid --project-type in interactive mode", async () => {
    await expect(initCommand({ projectType: "legacy" })).rejects.toThrow(HatchError);
    expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
  });

  it("rejects invalid --team-size in interactive mode", async () => {
    await expect(initCommand({ teamSize: "duo" })).rejects.toThrow(HatchError);
    expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
  });

  it("accepts valid --preset with no --yes flag (enters interactive flow)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // Validation passes; the usual interactive flow runs (C9-H28 order).
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({ preset: "minimal" });

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest).toBeDefined();
  });
});

describe("init runInit idempotency guard (C8-D1-M3)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-guard-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("rejects reentrant runInit for the same rootDir", async () => {
    const { runInit } = await import("../../cli/commands/init.js");
    const { PRESETS, getPreset } = await import("../../content/presets.js");
    const { buildContentIndex, resolveSelection } = await import("../../content/index.js");
    const { findPackageRoot } = await import("../../cli/shared/paths.js");
    const { fileURLToPath } = await import("node:url");
    const { dirname } = await import("node:path");

    // Reconstruct content root the same way initCommand does.
    const moduleUrl = (await import("../../cli/commands/init.js")) as unknown as { CONTENT_ROOT?: string };
    // Fallback: use the same package-root resolution as the production CLI.
    const contentRoot = moduleUrl.CONTENT_ROOT ?? findPackageRoot(dirname(fileURLToPath(import.meta.url)));

    const index = await buildContentIndex(contentRoot);
    void PRESETS;
    const preset = getPreset("minimal");
    const contentSelection = resolveSelection(preset, "brownfield", "solo", index);

    const repoInfo = {
      languages: ["unknown"],
      existingTools: [],
      hasExistingAgents: false,
      packageManager: "unknown" as const,
      isMonorepo: false,
      frameworks: [],
      rootDir: tempDir,
    };

    const options = {
      rootDir: tempDir,
      platform: "github" as const,
      owner: "o",
      repo: "r",
      namespace: "o",
      project: "r",
      defaultBranch: "main",
      tools: ["claude" as const],
      features: {
        agents: true,
        skills: true,
        rules: true,
        prompts: true,
        commands: true,
        mcp: false,
        hooks: false,
        githubAgents: false,
        handoffs: true,
      },
      mcpServers: [],
      repoInfo,
      contentSelection,
      worktreeEnabled: false,
      // Idempotency-focused test — pass `yes: true` to keep the flow
      // non-interactive.
      yes: true,
    };

    // Fire two concurrent runInit calls. The second should reject with the
    // idempotency guard rather than producing a half-written .agents/.
    const first = runInit(options);
    await expect(runInit(options)).rejects.toThrow(/already in progress/);
    await first;
  });
});

describe("init workspace conflict guard (C8-D1-M3)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; workspace?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  async function createWorkspaceLayout(root: string, repos: { name: string; hasHatch3r?: boolean }[]): Promise<void> {
    for (const r of repos) {
      const repoDir = join(root, r.name);
      await mkdir(join(repoDir, ".git"), { recursive: true });
      if (r.hasHatch3r) {
        await mkdir(join(repoDir, AGENTS_DIR), { recursive: true });
        await writeFile(
          join(repoDir, AGENTS_DIR, "hatch.json"),
          JSON.stringify({
            version: "2.0.0",
            hatch3rVersion: "1.0.0",
            platform: "github",
            tools: [],
            features: {},
            mcp: { servers: [] },
            managedFiles: [],
          }),
        );
      }
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-wsconf-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("prompts for confirmation when selected sub-repo already has hatch3r, and on decline drops it from sync", async () => {
    await createWorkspaceLayout(tempDir, [
      { name: "api", hasHatch3r: true },
      { name: "web", hasHatch3r: false },
    ]);

    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ useWorkspace: true });
    inq.mockResolvedValueOnce({ acceptIdentity: true });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    // Select the repo with existing hatch3r for sync (triggers conflict prompt)
    inq.mockResolvedValueOnce({ syncRepos: ["api"] });
    // Decline the overwrite
    inq.mockResolvedValueOnce({ confirmConflict: false });

    await initCommand({});

    const wsRaw = await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    // api stays registered but sync is false because the user declined
    const apiEntry = wsManifest.repos.find((r: { name: string }) => r.name === "api");
    expect(apiEntry?.sync).toBe(false);
  });

  it("proceeds with sync when user confirms overwrite of existing hatch3r sub-repo", async () => {
    await createWorkspaceLayout(tempDir, [{ name: "api", hasHatch3r: true }]);

    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ useWorkspace: true });
    inq.mockResolvedValueOnce({ acceptIdentity: true });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    inq.mockResolvedValueOnce({ syncRepos: ["api"] });
    inq.mockResolvedValueOnce({ confirmConflict: true });

    await initCommand({});

    const wsManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8"));
    const apiEntry = wsManifest.repos.find((r: { name: string }) => r.name === "api");
    expect(apiEntry?.sync).toBe(true);
  });

  it("skips conflict prompt when no selected sub-repo has existing hatch3r", async () => {
    await createWorkspaceLayout(tempDir, [{ name: "api", hasHatch3r: false }]);

    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ useWorkspace: true });
    inq.mockResolvedValueOnce({ acceptIdentity: true });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 5th prompt is the cliTools picker (empty = disabled);
    // MCP no longer prompts — opt-in is via --mcp / `hatch3r mcp setup`.
    inq.mockResolvedValueOnce({ tools: [] });
    inq.mockResolvedValueOnce({ syncRepos: ["api"] });
    // NO confirmConflict prompt expected here

    await initCommand({});

    const wsManifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "workspace.json"), "utf-8"));
    const apiEntry = wsManifest.repos.find((r: { name: string }) => r.name === "api");
    expect(apiEntry?.sync).toBe(true);
  });
});

// ── Wave 5 (CLI-tooling pivot, plan §4.3) ─────────────────────────
//
// Coverage for the new --yes flags introduced by the CLI-tooling pivot:
//   --cli-tools <ids|tier1|all>   resolveCliToolsFlag
//   --no-cli-tools                disables CLI tools entirely
//   --mcp                         re-opts into MCP defaults
//
// The flags must produce the expected manifest.cliTools / manifest.mcp
// shape without prompting the user.

describe("init --yes CLI tooling flags (Wave 5 plan §4.3)", () => {
  let initCommand: (opts?: {
    tools?: string;
    yes?: boolean;
    cliTools?: string;
    noCliTools?: boolean;
    mcp?: boolean;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-cli-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("--yes --no-cli-tools produces manifest.cliTools.enabled === false", async () => {
    await initCommand({ yes: true, noCliTools: true });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.cliTools).toBeDefined();
    expect(manifest.cliTools.enabled).toBe(false);
    expect(manifest.cliTools.selected).toEqual([]);
  });

  it("--yes --cli-tools tier1 produces the tier-1 selection", async () => {
    await initCommand({ yes: true, cliTools: "tier1" });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.cliTools.enabled).toBe(true);
    // TIER1_CLI_TOOLS (plan §3) = ripgrep, fd, jq, yq, gh, delta, bat, sd,
    // ast-grep, zstd, curl (11 entries). Cycle 10 D21-SA21.7-F-1 added
    // `curl` to TIER1 as the canonical HTTP transfer tool (security-pinned
    // 8.20.0). Assert membership rather than exact equality so trigger-
    // driven additions on a real CI runner do not flake the test —
    // `--cli-tools tier1` explicitly resolves to TIER1 only.
    expect(manifest.cliTools.selected).toEqual([
      "ripgrep",
      "fd",
      "jq",
      "yq",
      "gh",
      "delta",
      "bat",
      "sd",
      "ast-grep",
      "zstd",
      "curl",
    ]);
  });

  it("--yes (default) includes the tier-1 CLI tools", async () => {
    // Plan §4.3 `--yes` path: when no explicit `--cli-tools` is passed and
    // `--no-cli-tools` is absent, the default is tier-1 + triggered tier-2.
    // The exact tier-2 set depends on RepoInfo (frameworks/languages) and
    // process.stdout.isTTY which is non-deterministic under vitest. Assert
    // tier-1 membership only; the cliTools registry tests pin the tier-1
    // contents.
    await initCommand({ yes: true });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.cliTools.enabled).toBe(true);
    const tier1 = ["ripgrep", "fd", "jq", "yq", "gh", "delta", "bat", "sd", "ast-grep", "zstd"];
    for (const id of tier1) {
      expect(manifest.cliTools.selected, `missing tier-1 ${id}`).toContain(id);
    }
  });

  it("--yes --mcp re-opts into MCP defaults", async () => {
    await initCommand({ yes: true, mcp: true });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.mcp.servers.length).toBeGreaterThan(0);
    // Github platform default MCP server.
    expect(manifest.mcp.servers).toContain("github");
    // W3-mcp-optin: the derived feature flag follows the non-empty list.
    expect(manifest.features.mcp).toBe(true);
  });

  it("--yes (no --mcp) produces empty manifest.mcp.servers", async () => {
    await initCommand({ yes: true });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    // Plan §4.3 step 8: MCP is opt-in via --mcp. Without it, servers stay [].
    expect(manifest.mcp.servers).toEqual([]);
  });

  it("--yes --cli-tools accepts a comma-separated id list", async () => {
    await initCommand({ yes: true, cliTools: "ripgrep,jq" });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.cliTools.selected).toEqual(["ripgrep", "jq"]);
  });
});

// ── C9-H26 (D10-SA10.2-F1): --quiet, --json, --no-banner flags ───────
describe("init chrome-suppression flags (C9-H26)", () => {
  let initCommand: (opts?: {
    tools?: string;
    yes?: boolean;
    quiet?: boolean;
    json?: boolean;
    noBanner?: boolean;
    format?: string;
    dryRun?: boolean;
  }) => Promise<void>;

  /**
   * W5-bigfour: the init JSON payload is now emitted via the shared emitJson
   * funnel (process.stdout.write), not console.log — capture stdout chunks
   * around an initCommand run. Restores the spy before returning.
   */
  async function captureStdoutWrite(run: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      await run();
    } finally {
      stdoutSpy.mockRestore();
    }
    return chunks.join("");
  }
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-chrome-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("--quiet suppresses the banner and success box on stdout", async () => {
    await initCommand({ yes: true, quiet: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Banner contains the gradient logo + "Crack the egg" tagline; success
    // box title is "Hatch complete". None of these should appear under --quiet.
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).not.toContain("Hatch complete");
  });

  it("--no-banner suppresses the banner but keeps the success box", async () => {
    await initCommand({ yes: true, noBanner: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).toContain("Hatch complete");
  });

  it("--json emits a single machine-readable JSON line and no chrome", async () => {
    // W5-bigfour: the payload flows through emitJson (process.stdout.write).
    const stdoutRaw = await captureStdoutWrite(() =>
      initCommand({ yes: true, json: true, tools: "claude" }),
    );

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Banner + success box must be absent.
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).not.toContain("Hatch complete");

    // Exactly one JSON line on stdout.
    const jsonLines = stdoutRaw
      .split("\n")
      .filter((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
    expect(jsonLines.length).toBe(1);

    const payload = JSON.parse(jsonLines[0]);
    expect(payload.status).toBe("ok");
    expect(payload.version).toBe(HATCH3R_VERSION);
    expect(payload.tools).toEqual(["claude"]);
    // C9-H25: default --yes preset is now "standard" (not "full")
    expect(payload.preset).toBe("standard");
    expect(payload.canonicalDir).toBe(AGENTS_DIR);
    expect(payload.manifestPath).toBe(`${AGENTS_DIR}/hatch.json`);
    expect(Array.isArray(payload.mcpServers)).toBe(true);
    expect(Array.isArray(payload.cliTools)).toBe(true);
    // Manifest still written normally.
    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.tools).toEqual(["claude"]);
  });

  // W5-bigfour: `--format json` must be byte-identical in behavior to the
  // legacy `--json` boolean alias — same single-document payload, same field
  // names, same chrome suppression (both resolve through beginCommand).
  it("--format json is equivalent to --json (same payload fields, same chrome suppression)", async () => {
    const rawFormat = await captureStdoutWrite(() =>
      initCommand({ yes: true, format: "json", tools: "claude" }),
    );
    const formatPayload = JSON.parse(rawFormat.trim());

    // Chrome suppressed exactly like --json.
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).not.toContain("Hatch complete");

    // Second run in a fresh dir with the legacy alias; compare the payloads.
    const aliasDir = await mkdtemp(join(tmpdir(), "hatch3r-init-fmt-"));
    cwdSpy.mockReturnValue(aliasDir);
    try {
      const rawAlias = await captureStdoutWrite(() =>
        initCommand({ yes: true, json: true, tools: "claude" }),
      );
      const aliasPayload = JSON.parse(rawAlias.trim());
      // Identical schema (key set + order) ...
      expect(Object.keys(formatPayload)).toEqual(Object.keys(aliasPayload));
      // ... and identical values on every run-independent field (rootDir and
      // snapshotSessionId are necessarily per-run).
      expect(formatPayload.status).toEqual(aliasPayload.status);
      expect(formatPayload.version).toEqual(aliasPayload.version);
      expect(formatPayload.tools).toEqual(aliasPayload.tools);
      expect(formatPayload.preset).toEqual(aliasPayload.preset);
      expect(formatPayload.canonicalDir).toEqual(aliasPayload.canonicalDir);
      expect(formatPayload.manifestPath).toEqual(aliasPayload.manifestPath);
    } finally {
      cwdSpy.mockReturnValue(tempDir);
      await rm(aliasDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("--format json without --yes is rejected (exit 2) — prompts cannot interleave with the JSON document", async () => {
    const err = await initCommand({ format: "json" }).catch((e) => e as HatchError);
    expect(err).toBeInstanceOf(HatchError);
    expect((err as HatchError).exitCode).toBe(2);
    expect((err as HatchError).recoveryHint).toContain("--yes");
  });

  it("--json implies --quiet (no banner, no success box)", async () => {
    await initCommand({ yes: true, json: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).not.toContain("Hatch complete");
  });

  it("default mode (no flags) still emits the banner and success box", async () => {
    await initCommand({ yes: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("Hatch complete");
  });

  // ── W5-bigfour: --dry-run ────────────────────────────────────────────
  describe("--dry-run (W5-bigfour)", () => {
    it("--dry-run --yes writes NOTHING (no manifest, no adapter outputs, no workspace/checkpoint state)", async () => {
      await initCommand({ yes: true, dryRun: true, tools: "claude,cursor" });

      // The temp dir must contain zero init artifacts: no .hatch3r/ (manifest,
      // seeds, mcp, snapshots), no adapter outputs, no checkpoint workspace,
      // no .gitignore registration.
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(tempDir);
      expect(entries).toEqual([]);
      // Regression (P3 review): SPACE telemetry is one of the dry-run-skipped
      // writes — `.hatch3r/telemetry/` must not exist after a dry run.
      await expect(access(join(tempDir, HATCH3R_DIR, "telemetry"))).rejects.toThrow();
    });

    it("--dry-run writes NO telemetry on the all-adapters-failed path (the failure terminus precedes the dry-run terminus)", async () => {
      // Regression (P3 review): the all-adapters-failed terminus records
      // `firstRunSuccessRate=0` BEFORE the dry-run terminus is reached, so it
      // carries its own `--dry-run` gate. Without the gate, a failed dry run
      // leaked `.hatch3r/telemetry/space-<date>.jsonl` despite the zero-writes
      // contract. Mirrors the non-dry-run test (C7-H8 block), which asserts
      // the telemetry IS written.
      const adaptersMod = await import("../../adapters/index.js");
      const failingAdapter = {
        get warnings() { return [] as string[]; },
        generate: async () => { throw new Error("simulated adapter failure"); },
      };
      const getAdapterSpy = vi.spyOn(adaptersMod, "getAdapter")
        .mockReturnValue(failingAdapter as unknown as ReturnType<typeof adaptersMod.getAdapter>);

      try {
        await expect(
          initCommand({ yes: true, dryRun: true, tools: "claude" }),
        ).rejects.toThrow(HatchError);

        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(tempDir);
        expect(entries).toEqual([]);
      } finally {
        getAdapterSpy.mockRestore();
      }
    });

    it("--dry-run renders the per-tool would-write preview box instead of the success box", async () => {
      await initCommand({ yes: true, dryRun: true, tools: "claude" });

      const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stdout).toContain("Init dry run (no writes)");
      expect(stdout).toContain("+ added");
      expect(stdout).not.toContain("Hatch complete");
    });

    it("--dry-run --format json emits a single dry-run JSON document and writes nothing", async () => {
      const raw = await captureStdoutWrite(() =>
        initCommand({ yes: true, dryRun: true, format: "json", tools: "claude" }),
      );
      const payload = JSON.parse(raw.trim());
      expect(payload.status).toBe("dry-run");
      expect(payload.tools).toEqual(["claude"]);
      expect(Array.isArray(payload.adapterChanges)).toBe(true);
      expect(payload.adapterChanges[0].added.length).toBeGreaterThan(0);

      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(tempDir);
      expect(entries).toEqual([]);
    });
  });
});

// ── C9-H29 (D10-SA10.3-F2): Multi-CTA post-init hint ──────────────────
describe("init multi-CTA post-init hint (C9-H29)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-cta-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("greenfield empty repo surfaces all 4 README paths (project-spec primary, codebase-map/feature-plan/quick-change as alternates)", async () => {
    // Empty tempDir = greenfield (no language detected, no existing agents).
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("/hatch3r-project-spec");
    expect(stdout).toContain("/hatch3r-roadmap");
    expect(stdout).toContain("/hatch3r-codebase-map");
    expect(stdout).toContain("/hatch3r-feature-plan");
    expect(stdout).toContain("/hatch3r-quick-change");
  });

  it("brownfield repo surfaces codebase-map primary and all 3 alternates (feature-plan/quick-change/project-spec)", async () => {
    // Drop a tsconfig.json to make the repo non-greenfield (typescript detected).
    await writeFile(join(tempDir, "tsconfig.json"), JSON.stringify({}));
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("/hatch3r-codebase-map");
    expect(stdout).toContain("/hatch3r-feature-plan");
    expect(stdout).toContain("/hatch3r-quick-change");
    expect(stdout).toContain("/hatch3r-project-spec");
    // D10-SA10.3-05: a tsconfig.json-only tree is a fresh scaffold, not an
    // established codebase — the brownfield CTA must name the new-product path
    // so a scaffolded-new user is not told to reverse-engineer a near-empty tree.
    expect(stdout).toContain("fresh scaffold");
  });
});

// ── D14-15 (D14-SA14.1-F4): post-init stack-support pointer ───────────
describe("init stack-support pointer (D14-15)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-stack-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("surfaces the matrix pointer for a detected partial stack (angular)", async () => {
    // angular.json triggers the angular framework probe — a partial stack
    // (cross-cutting rules only, no dedicated rule).
    await writeFile(join(tempDir, "angular.json"), JSON.stringify({}));
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("Stack support: angular");
    expect(stdout).toContain("docs/stack-support-matrix.md");
  });

  it("omits the pointer for a fully-supported stack (rust)", async () => {
    // Cargo.toml -> rust language (full tier, dedicated rust-patterns rule).
    await writeFile(join(tempDir, "Cargo.toml"), "[package]\nname = \"x\"\n");
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Stack support:");
  });
});

// ── C9-H32 (D10-SA10.5-F2): TOOL_SECRET_NOTES surface at tool-selection time ─
describe("init tool-secret-notes ordering (C9-H32)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; mcp?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-secret-order-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("MCP-secret-loading notes surface on an interactive --mcp run after tool selection", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // W3-mcp-optin: 6th prompt is the cliTools picker (empty = disabled).
    inq.mockResolvedValueOnce({ tools: [] });

    // W3-mcp-optin: the notes are gated on an actual MCP opt-in (no MCP →
    // no MCP secrets to load), so this ordering test runs with --mcp.
    await initCommand({ mcp: true });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Claude routes secrets via shell sourcing — surfaced as part of the
    // TOOL_SECRET_NOTES block at tool-selection time.
    expect(stdout).toContain("MCP secret loading by tool");
    expect(stdout).toContain("shell sourcing");
  });

  it("a no-MCP interactive run omits the secret-loading notes and names the mcp setup side-door", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    // 2.1.0 (Decision 25 5→6): maturity prompt fires after preset.
    inq.mockResolvedValueOnce({ maturity: "solo" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("MCP secret loading by tool");
    // W3-mcp-optin success-box bullet: the opt-in lever is named on the
    // no-MCP path.
    expect(stdout).toContain("none configured");
    expect(stdout).toContain("hatch3r mcp setup");
  });
});

// ── C9-H31 (D10-SA10.5-F1): managedFilesByAdapter._shared bridge files ─
describe("init shared-bridge-file ownership (C9-H31)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-shared-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("drops the managedFilesByAdapter._shared bucket (Wave 6 manifest schema bump)", async () => {
    // Wave 6 (1.9.0 / schemaVersion 3): root AGENTS.md emission was
    // removed in Wave 3, so the `_shared` bucket that tracked it is
    // useless and is explicitly stripped by `migrateManifest` (see
    // `src/manifest/hatchJson.ts` Wave 6 idempotent prune).
    await initCommand({ yes: true, tools: "claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.managedFilesByAdapter).toBeDefined();
    expect(manifest.managedFilesByAdapter._shared).toBeUndefined();
  });

  it("adapter-owned files appear under their own Tool key", async () => {
    await initCommand({ yes: true, tools: "claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // CLAUDE.md is an adapter-owned file → under claude, never under any
    // shared/global bucket.
    expect(manifest.managedFilesByAdapter.claude).toContain("CLAUDE.md");
  });
});

// ── D14-SA14.2-H1: per-package emission is opt-in, capped, and .gitignore'd ─
describe("init per-package emission gate (D14-SA14.2-H1)", () => {
  let initCommand: (opts?: { yes?: boolean; tools?: string; perPackage?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  // Build a 2-package npm-workspace monorepo so analyzeRepo populates
  // manifest.packages (each package dir carries a package.json — the
  // qualifier in detectMonorepoPackages → addPackageIfPresent).
  async function makeMonorepo(root: string, packageNames: string[]): Promise<void> {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    );
    for (const name of packageNames) {
      const dir = join(root, "packages", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: `@scope/${name}` }));
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-perpkg-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("does NOT write per-package copies by default (opt-out-by-default)", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "cursor" });

    // Root emission still happens.
    await expect(access(join(tempDir, ".cursor"))).resolves.toBeUndefined();
    // No per-package copies without --per-package.
    let aExists = false;
    try {
      await access(join(tempDir, "packages", "a", ".cursor"));
      aExists = true;
    } catch (err) {
      void err;
    }
    expect(aExists).toBe(false);
  });

  it("writes outputs × packages per-package copies for cursor with --per-package and .gitignore's them", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "cursor", perPackage: true });

    const manifest = JSON.parse(await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"));
    const cursorManaged = manifest.managedFilesByAdapter.cursor as string[];
    const rootOutputs = cursorManaged.filter((p) => !p.startsWith("packages/"));
    const pkgA = cursorManaged.filter((p) => p.startsWith("packages/a/"));
    const pkgB = cursorManaged.filter((p) => p.startsWith("packages/b/"));

    // Cursor reads `.cursor/rules/*.mdc` from the nearest ancestor, so each
    // package receives a full copy of the root output set (the copy count
    // scales as outputs × packages — the exact behaviour the cap + bounded
    // batch guard against at scale).
    expect(rootOutputs.length).toBeGreaterThan(0);
    expect(pkgA.length).toBe(rootOutputs.length);
    expect(pkgB.length).toBe(rootOutputs.length);
    // A `.cursor/rules/*.mdc` file specifically lands under each package.
    expect(pkgA.some((p) => p.startsWith("packages/a/.cursor/"))).toBe(true);
    expect(pkgB.some((p) => p.startsWith("packages/b/.cursor/"))).toBe(true);
    await expect(access(join(tempDir, "packages", "a", ".cursor"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, "packages", "b", ".cursor"))).resolves.toBeUndefined();

    // Every generated copy is git-ignored (anchored, leading-slash entries).
    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    const ignored = new Set(gitignore.split("\n").map((l) => l.trim()));
    for (const p of [...pkgA, ...pkgB]) {
      expect(ignored.has(`/${p}`)).toBe(true);
    }
  });

  // D14-6: per-package copying fights the load model of claude (ancestor-loads
  // root CLAUDE.md → double-load) and copilot (root-only
  // .github/copilot-instructions.md → never read). Even WITH --per-package they
  // emit nothing per-package; only the root output is written.
  it("D14-6: emits NO per-package copies for claude even with --per-package", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "claude", perPackage: true });

    // Root CLAUDE.md is still written.
    await expect(access(join(tempDir, "CLAUDE.md"))).resolves.toBeUndefined();

    const manifest = JSON.parse(await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"));
    const claudeManaged = (manifest.managedFilesByAdapter.claude as string[]) ?? [];
    expect(claudeManaged.some((p) => p.startsWith("packages/"))).toBe(false);
    await expect(access(join(tempDir, "packages", "a", "CLAUDE.md"))).rejects.toThrow();
    await expect(access(join(tempDir, "packages", "b", "CLAUDE.md"))).rejects.toThrow();
  });

  it("D14-6: emits NO per-package copies for copilot even with --per-package", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "copilot", perPackage: true });

    const manifest = JSON.parse(await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"));
    const copilotManaged = (manifest.managedFilesByAdapter.copilot as string[]) ?? [];
    expect(copilotManaged.some((p) => p.startsWith("packages/"))).toBe(false);
    await expect(
      access(join(tempDir, "packages", "a", ".github", "copilot-instructions.md")),
    ).rejects.toThrow();
  });
});

// ── Cycle-11 Wave-3 Medium fixes (init.ts) ────────────────────────────
describe("init Wave-3 Medium fixes (D10-37, D14-17, D1-15, D6-12)", () => {
  let initCommand: (opts?: {
    tools?: string;
    yes?: boolean;
    preset?: string;
    teamSize?: string;
    maturity?: string;
    json?: boolean;
    resume?: boolean;
  }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-w3-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  // D10-37: the solo+full disclosure must state team-scoped workflows are
  // EXCLUDED for solo (not the inverted "included even on solo"), and name
  // `--team-size team` (not the no-op `--preset=standard`) as the lever.
  it("D10-37: solo+full success box says team-scoped workflows are excluded and points at --team-size team", async () => {
    await initCommand({ yes: true, tools: "claude", preset: "full", teamSize: "solo" });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("excluded for solo");
    // `boxen` word-wraps the Note line, so the multi-word `--team-size team`
    // phrase can split across box rows; assert the load-bearing flag token
    // (which survives wrapping) rather than the full phrase.
    expect(stdout).toContain("--team-size");
    // The inverted prior wording must be gone.
    expect(stdout).not.toContain("includes team-only workflows even on solo");
    expect(stdout).not.toContain("--preset=standard");
  });

  // D14-17: the resolved maturity tier must be surfaced in the success box so
  // it is discoverable rather than a silent default.
  it("D14-17: success box surfaces the resolved Maturity tier with a change command", async () => {
    await initCommand({ yes: true, tools: "claude", maturity: "team" });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("Maturity");
    expect(stdout).toContain("team");
    expect(stdout).toContain("hatch3r config maturity=");
    // The persisted manifest carries the same tier.
    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.maturity).toBe("team");
  });

  // D1-15: a `--resume --json` short-circuit (after a prior completed init)
  // must emit a structured `{"status":"resumed",...}` line, not empty output.
  it("D1-15: --resume --json on a completed checkpoint emits a resumed JSON line", async () => {
    // First run writes a `passed` checkpoint.
    await initCommand({ yes: true, tools: "claude" });
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    // Resume with --json: short-circuits and must print one JSON line.
    await initCommand({ yes: true, tools: "claude", resume: true, json: true });

    const jsonLines = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
    expect(jsonLines.length).toBe(1);
    const payload = JSON.parse(jsonLines[0]);
    expect(payload.status).toBe("resumed");
    expect(payload.version).toBe(HATCH3R_VERSION);
    expect(payload.phase).toBe("init");
    // No success box (json implies quiet; the short-circuit returns early).
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Hatch complete");
  });

  // D6-12: the first-run path now routes through the shared context-budget
  // assessment, but WARN-ONLY — a highest-output (full, all-adapters) install
  // must still complete (P1 first-run success), never abort like sync
  // --strict-budget. Locks the non-fatal invariant of the new gate.
  it("D6-12: full-preset all-adapter init runs the budget gate without aborting", async () => {
    await expect(
      initCommand({ yes: true, tools: "claude,cursor,copilot", preset: "full" }),
    ).resolves.toBeUndefined();
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Install completed despite the budget assessment running on every adapter.
    expect(stdout).toContain("Hatch complete");
    // Output was actually written (manifest present).
    await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();
    // Full preset x all 3 adapters is the heaviest first-run install: on
    // I/O-slow Windows CI runners it runs past the 30s heavy-fs default
    // (cancelled at 30s on win-26), so give this single worst-case test
    // explicit headroom. Linux/macOS finish well under 10s, so the ceiling
    // never trips there.
  }, 120_000);
});

