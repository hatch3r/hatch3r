// Emission-completeness check (release/2.6.0, S2c) — two layers:
//
//   1. Real-corpus completeness: a default-manifest `claude` generation over
//      THIS repo's canonical content emits every user-facing canonical
//      command / agent / skill as its own per-file output. This pins the S2a
//      finding (the "missing hatch3r-workflow" report was a stale-prefix
//      rendering issue, not a generation drop — at the time, selection was
//      not a generate-time filter; since D10-SA10.6-01 / release/2.8.6 it IS
//      an emission allowlist, and a content-less manifest like the one used
//      here disables it, preserving this full-corpus invariant) against
//      future regressions.
//   2. Gap attribution units: `buildEmissionExpectations` +
//      `assessEmissionGaps` classify a non-emitted artifact into
//      feature-disabled / customization-disabled / cli-tools-filter /
//      not-selected / unexplained with actionable text, against the adapter
//      test fixtures.

import { describe, it, expect, afterEach, vi } from "vitest";
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

  it("attributes a selection-withheld artifact as not-selected (D10-SA10.6-01)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-sel-");
    const manifest = createManifest({
      tools: ["claude"],
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: {
          agents: ["test-agent"],
          skills: [],
          rules: [],
          commands: [], // test-command NOT selected (non-empty union → filter active)
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      },
    });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);

    const cmd = expectations.find((e) => e.contentClass === "commands" && e.id === "test-command");
    expect(cmd).toBeDefined();
    expect(cmd!.selectionFiltered).toBe(true);
    const agent = expectations.find((e) => e.contentClass === "agents" && e.id === "test-agent");
    expect(agent).toBeDefined();
    expect(agent!.selectionFiltered).toBe(false);

    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const gap = gaps.find((g) => g.id === "test-command");
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("not-selected");
    expect(gap!.action).toContain("hatch3r config");

    // An all-empty selection disables the allowlist (fail-open), so nothing
    // is selection-attributed — the same artifact scores unexplained instead.
    const emptyUnion = createManifest({
      tools: ["claude"],
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      },
    });
    const openExpectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, emptyUnion);
    const openCmd = openExpectations.find((e) => e.contentClass === "commands" && e.id === "test-command");
    expect(openCmd).toBeDefined();
    expect(openCmd!.selectionFiltered).toBe(false);
  });

  it("never marks an enabled CLI-tooling skill not-selected (review fix F1: cliTools governs, not content.items)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-clisel-");
    // The reviewer's scenario: custom selection lacking every hatch3r-cli-*
    // id (config/cli-tools never write them into content.items) + an enabled
    // cliTools pick. The cli class is exempt from the selection allowlist, so
    // the enabled skill carries NO drop attribution at all.
    const manifest = createManifest({
      tools: ["claude"],
      cliTools: { enabled: true, selected: ["jq"] },
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: {
          agents: ["test-agent"],
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      },
    });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);
    const jq = expectations.find((e) => e.id === "hatch3r-cli-jq");
    expect(jq).toBeDefined();
    expect(jq!.cliFiltered).toBe(false); // cliTools selects it
    expect(jq!.selectionFiltered).toBe(false); // selection never gates the class

    const gaps = assessEmissionGaps("claude", [], expectations, manifest);
    const jqGap = gaps.find((g) => g.id === "hatch3r-cli-jq");
    // With zero outputs the row degrades to unexplained — the load-bearing
    // assertion is that it is NEVER `not-selected` (the double-gate bug).
    expect(jqGap?.reason).not.toBe("not-selected");
    // An unselected cli skill (fd) still attributes to the cliTools filter.
    const fdGap = gaps.find((g) => g.id === "hatch3r-cli-fd");
    expect(fdGap?.reason).toBe("cli-tools-filter");
  });

  it("escalates a selection-dropped floor:security artifact to not-selected-floor-security with a warning (sec-2.8.6-b2-p4 #5)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-floorsec-");
    // Synthetic canonical root: a floor:security-tagged skill (skills is a
    // covered attribution class; rules — the other common floor:security
    // carrier — are exercised through the adapter-seam escalation test in
    // base.test.ts, since the expectation surface does not enumerate rules).
    const canonicalRoot = join(userRepo, "canonical");
    await mkdir(join(canonicalRoot, "skills", "hatch3r-sec-skill"), { recursive: true });
    await writeFile(
      join(canonicalRoot, "skills", "hatch3r-sec-skill", "SKILL.md"),
      "---\nid: hatch3r-sec-skill\ntype: skill\ndescription: A security-floor fixture skill\ntags: [floor:security]\n---\n# Sec skill\n",
    );
    const manifest = createManifest({
      tools: ["claude"],
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: {
          agents: ["some-agent"], // non-empty union; skills: [] drops the skill
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      },
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const expectations = await buildEmissionExpectations(canonicalRoot, userRepo, manifest);
      const sec = expectations.find((e) => e.id === "hatch3r-sec-skill");
      expect(sec).toBeDefined();
      expect(sec!.selectionFiltered).toBe(true);
      expect(sec!.selectionFilteredFloorSecurity).toBe(true);
      // The build-time warn fired once, naming the artifact.
      const warned = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warned).toContain('Security-floor artifact "hatch3r-sec-skill"');

      const gaps = assessEmissionGaps("claude", [], expectations, manifest);
      const gap = gaps.find((g) => g.id === "hatch3r-sec-skill");
      expect(gap).toBeDefined();
      expect(gap!.reason).toBe("not-selected-floor-security");
      expect(gap!.action).toContain("SECURITY-floor");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("protected artifacts are never selection-attributed in the status mirror (test-2.8.6-b2-p4 #7)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-prot-");
    const canonicalRoot = join(userRepo, "canonical");
    await mkdir(join(canonicalRoot, "agents"), { recursive: true });
    await writeFile(
      join(canonicalRoot, "agents", "protected-agent.md"),
      "---\nid: protected-agent\ntype: agent\ndescription: A protected fixture agent\nprotected: true\n---\n# Protected\n",
    );
    const manifest = createManifest({
      tools: ["claude"],
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: {
          agents: ["some-other-agent"], // protected-agent absent; union non-empty
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      },
    });
    const expectations = await buildEmissionExpectations(canonicalRoot, userRepo, manifest);
    const prot = expectations.find((e) => e.id === "protected-agent");
    expect(prot).toBeDefined();
    // The predicate returns keep-protected-missing for it, never "drop".
    expect(prot!.selectionFiltered).toBe(false);
    expect(prot!.selectionFilteredFloorSecurity).toBe(false);

    // The adapter's protected bypass emits it, so with its sourcePath present
    // in the outputs there is no gap row at all.
    const emitted = [output(".claude/agents/protected-agent.md", "x", "x", [prot!.sourcePath])];
    const gaps = assessEmissionGaps("claude", emitted, expectations, manifest);
    expect(gaps.find((g) => g.id === "protected-agent")).toBeUndefined();
  });

  it("rules are outside the expectation surface: a deselected rule yields no expectation row (test-2.8.6-b2-p4 #10)", async () => {
    const userRepo = await createTempDir("hatch3r-completeness-rules-");
    const manifest = createManifest({
      tools: ["claude"],
      content: {
        preset: "custom",
        projectType: "brownfield",
        teamSize: "solo",
        items: {
          agents: ["test-agent"],
          skills: [],
          rules: [], // test-rule/scoped-rule dropped at the adapter seam
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      },
    });
    const expectations = await buildEmissionExpectations(FIXTURES_DIR, userRepo, manifest);
    // The classes array intentionally covers the picker-visible per-file
    // classes (commands/agents/skills) only — dropped rules surface through
    // the drift comparison + the adapter-seam warnings, not this attribution
    // surface (pinned; see the classes-array comment in status.ts).
    expect(expectations.some((e) => e.id === "test-rule" || e.id === "scoped-rule")).toBe(false);
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
