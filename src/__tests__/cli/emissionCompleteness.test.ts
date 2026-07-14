// Emission-completeness check (release/2.6.0, S2c) — two layers:
//
//   1. Real-corpus completeness: a default-manifest `claude` generation over
//      THIS repo's canonical content emits every user-facing canonical
//      command / agent / skill as its own per-file output. This pins the S2a
//      finding (the "missing hatch3r-workflow" report was a stale-prefix
//      rendering issue, not a generation drop — selection is not a
//      generate-time filter per Decision 16) against future regressions.
//   2. Gap attribution units: `buildEmissionExpectations` +
//      `assessEmissionGaps` classify a non-emitted artifact into
//      feature-disabled / customization-disabled / cli-tools-filter /
//      unexplained with actionable text, against the adapter test fixtures.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveTestPath } from "../fixtures.js";
import { getAdapter } from "../../adapters/index.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { output } from "../../adapters/base.js";
import {
  buildEmissionExpectations,
  assessEmissionGaps,
} from "../../cli/commands/status.js";

/** This repo's root IS the canonical content root (top-level commands/, agents/, skills/). */
const REPO_ROOT = resolveTestPath(import.meta.url, "../../..");
const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("emission completeness (release/2.6.0, S2c)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempDir(prefix: string): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), prefix));
    return tempDir;
  }

  it("default-manifest claude generation emits every user-facing canonical command/agent/skill", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-real-");
    const manifest = createManifest({ tools: ["claude"] });
    const adapter = getAdapter("claude");
    const outputs = await adapter.generate(REPO_ROOT, manifest, userRepo);
    const expectations = await buildEmissionExpectations(REPO_ROOT, userRepo, manifest);

    expect(expectations.length).toBeGreaterThan(0);

    // Per-file emission per class — the picker-visible surface. `hatch3r-cli-*`
    // skills are legitimately absent on a default manifest (cliTools unset →
    // pivot filter drops them), and the gap assessment below attributes them.
    const pathSet = new Set(outputs.map((o) => o.path));
    for (const exp of expectations) {
      if (exp.cliFiltered) continue;
      const expectedPath =
        exp.contentClass === "commands"
          ? `.claude/commands/${exp.id}.md`
          : exp.contentClass === "agents"
            ? `.claude/agents/${exp.id}.md`
            : `.claude/skills/${exp.id}/SKILL.md`;
      expect(pathSet.has(expectedPath), `expected ${expectedPath} to be emitted`).toBe(true);
    }

    // The artifact from the user report, pinned explicitly.
    expect(pathSet.has(".claude/commands/hatch3r-workflow.md")).toBe(true);

    // Zero unexplained gaps; every gap on a default manifest is the
    // attributed CLI-tools filter.
    const gaps = assessEmissionGaps("claude", outputs, expectations, manifest);
    const unexplained = gaps.filter((g) => g.reason === "unexplained");
    expect(unexplained).toEqual([]);
    for (const gap of gaps) {
      expect(gap.reason).toBe("cli-tools-filter");
      expect(gap.id.startsWith("hatch3r-cli-")).toBe(true);
    }
  }, 60_000);

  it("attributes a customize enabled:false drop and names the .customize.yaml path", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-cust-");
    const dir = join(userRepo, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test-command.customize.yaml"), "enabled: false", "utf-8");

    const manifest = createManifest({ tools: ["claude"] });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);
    const cmd = expectations.find((e) => e.contentClass === "commands" && e.id === "test-command");
    expect(cmd).toBeDefined();
    expect(cmd!.customizeDisabled).toBe(true);

    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const gap = gaps.find((g) => g.id === "test-command");
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("customization-disabled");
    expect(gap!.action).toContain(".hatch3r/commands/test-command.customize.yaml");
  });

  it("attributes a disabled feature class to every artifact of that class", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-feat-");
    const manifest = createManifest({ tools: ["claude"], features: { commands: false } });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);

    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const commandGaps = gaps.filter((g) => g.contentClass === "commands");
    expect(commandGaps.length).toBeGreaterThan(0);
    for (const gap of commandGaps) {
      expect(gap.reason).toBe("feature-disabled");
      expect(gap.action).toContain("features.commands");
    }
  });

  it("attributes non-selected hatch3r-cli-* skills to the CLI-tools filter", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-cli-");
    const manifest = createManifest({ tools: ["claude"] }); // cliTools unset → filter drops hatch3r-cli-*
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);

    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const cliGap = gaps.find((g) => g.id === "hatch3r-cli-jq");
    expect(cliGap).toBeDefined();
    expect(cliGap!.reason).toBe("cli-tools-filter");

    // A selected CLI skill is expected again: its absence becomes unexplained.
    const selectedManifest = createManifest({
      tools: ["claude"],
      cliTools: { enabled: true, selected: ["jq"] },
    });
    const selectedExpectations = await buildEmissionExpectations(
      FIXTURES_DIR,
      userRepo,
      selectedManifest,
    );
    const jq = selectedExpectations.find((e) => e.id === "hatch3r-cli-jq");
    expect(jq).toBeDefined();
    expect(jq!.cliFiltered).toBe(false);
  });

  it("classifies an artifact absent with no drop gate as unexplained (ordinary drift)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-unexp-");
    const manifest = createManifest({ tools: ["claude"] });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);
    const cmd = expectations.find((e) => e.contentClass === "commands" && e.id === "test-command");
    expect(cmd).toBeDefined();

    // No outputs at all → the enabled, non-customized, non-cli command is unexplained.
    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const gap = gaps.find((g) => g.id === "test-command");
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("unexplained");

    // An output carrying the artifact's sourcePath clears the gap.
    const emitted = [
      output(".claude/commands/test-command.md", "irrelevant", "irrelevant", [cmd!.sourcePath]),
    ];
    const clearedGaps = assessEmissionGaps("claude", emitted, expectations, manifest);
    expect(clearedGaps.find((g) => g.id === "test-command")).toBeUndefined();
  });
});
