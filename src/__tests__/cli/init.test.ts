import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";

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
    await rm(tempDir, { recursive: true, force: true });
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
    expect(manifest.features.prompts).toBe(true);
    expect(manifest.features.commands).toBe(true);
    expect(manifest.features.mcp).toBe(true);
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
  });

  it("--yes default produces empty MCP servers (Wave 3 plan §4.3)", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // Plan §4.3 step 8 / §2 decision row: --yes now defaults MCP off. The
    // server list is empty unless --mcp is explicitly passed.
    expect(manifest.mcp.servers).toEqual([]);
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
    await rm(tempDir, { recursive: true, force: true });
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
});

// F10.3-2 (D10, P1): the interactive first-run flow is capped at ≤5 prompts.
describe("init interactive ≤5-prompt ceiling (F10.3-2)", () => {
  let initCommand: () => Promise<void>;
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
    await rm(tempDir, { recursive: true, force: true });
  });

  it("the common-path interactive flow consumes exactly 5 prompts (platform, identity, preset, tools, mcp)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ mcp: [] });

    await initCommand();

    // Exactly five inquirer.prompt calls — the ≤5-prompt ceiling. (No
    // defaultBranch / projectType / teamSize / maturity / wantMcp / cliTools
    // prompts; those resolve to smart defaults.)
    expect(inq.mock.calls.length).toBe(5);

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    // Empty MCP selection → MCP feature off (the `(none)` path).
    expect(manifest.features.mcp).toBe(false);
    // Dropped prompts resolved: defaultBranch from git fallback ("main"),
    // cliTools defaulted to the tier-1 + triggered set (non-empty).
    expect(manifest.board?.defaultBranch).toBe("main");
    expect(Array.isArray(manifest.cliTools?.selected)).toBe(true);
  });

  it("a non-empty MCP multi-select enables the MCP feature (collapsed picker)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // User picks a server in the collapsed MCP step.
    inq.mockResolvedValueOnce({ mcp: ["playwright"] });

    await initCommand();

    expect(inq.mock.calls.length).toBe(5);
    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    expect(manifest.features.mcp).toBe(true);
    // The platform server is auto-included alongside an explicit pick.
    expect(manifest.mcp.servers).toContain("playwright");
    expect(manifest.mcp.servers).toContain("github");
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(join(tempDir, AGENTS_DIR), { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
  // --no-worktree still override. C9-H28 (D10-SA10.3-F1) prompt order:
  //   platform -> owner/repo -> defaultBranch -> projectType -> teamSize ->
  //   preset -> tools -> wantMcp -> [mcp picker] ->
  //   cliTools picker -> [create?]
  function queueInteractiveWithWorktree(opts: { tools?: string[] } = {}): void {
    const inq = vi.mocked(inquirer.prompt);
    const tools = opts.tools ?? ["claude"];
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "test-owner", repo: "test-repo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools });
    // Slice B: feature checkbox replaced by single wantMcp confirm.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Queue prompt responses for the interactive single-repo flow.
   * C9-H28 (D10-SA10.3-F1) prompt order:
   *   platform -> owner/repo -> defaultBranch -> projectType -> teamSize ->
   *   preset -> [custom items] -> tools -> features ->
   *   [mcp gate] -> [mcp servers] -> cliTools picker -> [create?]
   * Slice D removed the worktree confirm prompt; worktree is auto-enabled
   * when a worktree-capable tool (claude/cursor/copilot) is selected. The
   * cliTools picker always runs but an empty selection short-circuits the
   * detection + installer follow-ups so tests stay deterministic. The MCP
   * gate fires only when `features.mcp` is true; the server picker fires only
   * when the user proceeds through the gate (mcpServers !== undefined here).
   * C9-H28 moved features + MCP ahead of CLI tools so users complete the
   * high-impact decisions first.
   */
  function setupGithubInteractive(opts: {
    preset?: "minimal" | "standard" | "full" | "custom";
    projectType?: "greenfield" | "brownfield";
    teamSize?: "solo" | "team";
    maturity?: "solo" | "team" | "scaleup" | "enterprise";
    tools?: string[];
    features?: string[];
    mcpServers?: string[];
    customItems?: string[];
    cliTools?: string[];
  } = {}): void {
    const inq = vi.mocked(inquirer.prompt);
    const tools = opts.tools ?? ["claude"];
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "test-owner", repo: "test-repo" });
    inq.mockResolvedValueOnce({ preset: opts.preset ?? "full" });
    if (opts.preset === "custom") {
      inq.mockResolvedValueOnce({ items: opts.customItems ?? [] });
    }
    inq.mockResolvedValueOnce({ tools });
    // Slice B: feature checkbox replaced by single wantMcp confirm — the
    // confirm doubles as the MCP gate. Callers who want MCP supply
    // `mcpServers` (or set `features: ["mcp", ...]` for back-compat);
    // anything else means MCP off.
    const featuresList = opts.features ?? (opts.mcpServers !== undefined ? ["mcp"] : []);
    const wantMcp = featuresList.includes("mcp");
    // F10.3-2: collapsed MCP multi-select (empty = none).
    inq.mockResolvedValueOnce({ mcp: wantMcp ? (opts.mcpServers ?? ["github", "playwright", "context7"]) : [] });
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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

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
    // Empty tool selection -> falls back to DEFAULT_TOOLS (= ["claude"])
    inq.mockResolvedValueOnce({ tools: [] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

    await initCommand({});

    const manifest = JSON.parse(await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"));
    // tools: [] -> defaults to ["claude"]
    expect(manifest.tools).toEqual(["claude"]);
    // defaultBranch defaults to "main"
    expect(manifest.board?.defaultBranch).toBe("main");
  });

  it("interactive flow with mcp disabled does not prompt for MCP servers", async () => {
    setupGithubInteractive({ features: ["agents"], mcpServers: undefined });
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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    await rm(tempDir, { recursive: true, force: true });
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
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

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
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
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
    await initCommand({ yes: true, json: true, tools: "claude" });

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Banner + success box must be absent.
    expect(stdout).not.toContain("Crack the egg");
    expect(stdout).not.toContain("Hatch complete");

    // Exactly one JSON line on stdout.
    const jsonLines = consoleSpy.mock.calls
      .map((c) => String(c[0]))
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
    await rm(tempDir, { recursive: true, force: true });
  });

  it("greenfield empty repo surfaces all 4 README paths (project-spec primary, codebase-map/feature-plan/quick-change as alternates)", async () => {
    // Empty tempDir = greenfield (no language detected, no existing agents).
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("project-spec");
    expect(stdout).toContain("roadmap");
    expect(stdout).toContain("codebase-map");
    expect(stdout).toContain("feature-plan");
    expect(stdout).toContain("quick-change");
  });

  it("brownfield repo surfaces codebase-map primary and all 3 alternates (feature-plan/quick-change/project-spec)", async () => {
    // Drop a tsconfig.json to make the repo non-greenfield (typescript detected).
    await writeFile(join(tempDir, "tsconfig.json"), JSON.stringify({}));
    await initCommand({ yes: true });
    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("codebase-map");
    expect(stdout).toContain("feature-plan");
    expect(stdout).toContain("quick-change");
    expect(stdout).toContain("project-spec");
  });
});

// ── C9-H32 (D10-SA10.5-F2): TOOL_SECRET_NOTES surface at tool-selection time ─
describe("init tool-secret-notes ordering (C9-H32)", () => {
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
    await rm(tempDir, { recursive: true, force: true });
  });

  it("MCP-secret-loading notes surface in interactive flow immediately after tool selection (before features/CLI tools)", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice B: feature checkbox replaced by wantMcp confirm; this test
    // exercises MCP-off.
    // F10.3-2: collapsed MCP multi-select — empty = no MCP.
    inq.mockResolvedValueOnce({ mcp: [] });

    await initCommand({});

    const stdout = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Claude routes secrets via shell sourcing — surfaced as part of the
    // TOOL_SECRET_NOTES block at tool-selection time.
    expect(stdout).toContain("MCP secret loading by tool");
    expect(stdout).toContain("shell sourcing");
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
    await rm(tempDir, { recursive: true, force: true });
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
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does NOT write per-package copies by default (opt-out-by-default)", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "claude" });

    // Root emission still happens.
    await expect(access(join(tempDir, "CLAUDE.md"))).resolves.toBeUndefined();
    // No per-package copies without --per-package.
    let aExists = false;
    try {
      await access(join(tempDir, "packages", "a", "CLAUDE.md"));
      aExists = true;
    } catch (err) {
      void err;
    }
    expect(aExists).toBe(false);
  });

  it("writes outputs × packages per-package copies with --per-package and .gitignore's them", async () => {
    await makeMonorepo(tempDir, ["a", "b"]);
    await initCommand({ yes: true, tools: "claude", perPackage: true });

    const manifest = JSON.parse(await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"));
    const claudeManaged = manifest.managedFilesByAdapter.claude as string[];
    const rootOutputs = claudeManaged.filter((p) => !p.startsWith("packages/"));
    const pkgA = claudeManaged.filter((p) => p.startsWith("packages/a/"));
    const pkgB = claudeManaged.filter((p) => p.startsWith("packages/b/"));

    // Each package receives a full copy of the root output set (the copy count
    // scales as outputs × packages — the exact behaviour the cap + bounded
    // batch guard against at scale).
    expect(rootOutputs.length).toBeGreaterThan(0);
    expect(pkgA.length).toBe(rootOutputs.length);
    expect(pkgB.length).toBe(rootOutputs.length);
    // CLAUDE.md specifically lands under each package.
    expect(pkgA).toContain("packages/a/CLAUDE.md");
    expect(pkgB).toContain("packages/b/CLAUDE.md");
    await expect(access(join(tempDir, "packages", "a", "CLAUDE.md"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, "packages", "b", "CLAUDE.md"))).resolves.toBeUndefined();

    // Every generated copy is git-ignored (anchored, leading-slash entries).
    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    const ignored = new Set(gitignore.split("\n").map((l) => l.trim()));
    for (const p of [...pkgA, ...pkgB]) {
      expect(ignored.has(`/${p}`)).toBe(true);
    }
  });
});

