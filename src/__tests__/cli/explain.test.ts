// C9-H13: tests for `hatch3r explain --cost <command-id>`. The command reads
// the canonical command frontmatter (triage_tiers + agentPipeline) and prints
// a per-tier sub-agent count and USD cost estimate.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";

const AGENTS_DIR = ".agents";

async function writeCommandFile(
  root: string,
  filename: string,
  body: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const dir = join(root, AGENTS_DIR, "commands");
  await mkdir(dir, { recursive: true });
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value ? "true" : "false"}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body);
  await writeFile(join(dir, filename), lines.join("\n"));
}

describe("explainCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-explain-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects when --cost flag is omitted", async () => {
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(explainCommand({})).rejects.toThrow(HatchError);
    try {
      await explainCommand({});
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).message).toContain("--cost");
    }
  });

  it("rejects when command id does not resolve to a file", async () => {
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({ cost: "nonexistent-command-xyz" }),
    ).rejects.toThrow(HatchError);
    try {
      await explainCommand({ cost: "nonexistent-command-xyz" });
    } catch (e) {
      expect((e as HatchError).message).toContain("Command not found");
    }
  });

  it("reads triage_tiers + agentPipeline and prints per-tier rows", async () => {
    const body = "Command body content for cost estimation purposes.".repeat(40);
    await writeCommandFile(tempDir, "hatch3r-sample.md", body, {
      id: "hatch3r-sample",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-fixer"],
      description: "sample",
      tags: ["core"],
      triage_tiers: [1, 2, 3],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-sample" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");

    expect(output).toContain("hatch3r-sample");
    expect(output).toContain("Tier 1");
    expect(output).toContain("Tier 2");
    expect(output).toContain("Tier 3");
    expect(output).toContain("All tiers (sum)");
    expect(output).toContain("USD");
    expect(output).toContain("Per-tier cost estimate");
  });

  it("normalizes bare command ids (omitting hatch3r- prefix)", async () => {
    const body = "body".repeat(50);
    await writeCommandFile(tempDir, "hatch3r-mini.md", body, {
      id: "hatch3r-mini",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "mini",
      tags: ["core"],
      triage_tiers: [1, 2],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "mini" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("hatch3r-mini");
    expect(output).toContain("Tier 1");
    expect(output).toContain("Tier 2");
  });

  it("computes tier-1 with 1 sub-agent, tier-2 with pipeline length, tier-3 with pipeline+1", async () => {
    const body = "x".repeat(4000); // 4000 chars -> 1000 tokens at CHARS_PER_TOKEN=4
    await writeCommandFile(tempDir, "hatch3r-counts.md", body, {
      id: "hatch3r-counts",
      type: "command",
      orchestrator: true,
      agentPipeline: ["a", "b", "c", "d", "e"], // length 5
      description: "counts",
      tags: ["core"],
      triage_tiers: [1, 2, 3],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-counts" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");

    // Tier 1 always has 1 sub-agent
    const tier1Match = output.match(/Tier 1[^\n]*\n?/);
    expect(tier1Match).toBeTruthy();

    // Output should reference 5 sub-agents (pipeline length) for tier 2
    // and 6 sub-agents (pipeline + 1) for tier 3. Both must appear.
    expect(output).toMatch(/Tier 2[\s\S]*?\b5\b/);
    expect(output).toMatch(/Tier 3[\s\S]*?\b6\b/);
  });

  it("rejects orchestrator: true with no triage_tiers", async () => {
    await writeCommandFile(tempDir, "hatch3r-broken.md", "body", {
      id: "hatch3r-broken",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "broken",
      tags: ["core"],
      // triage_tiers intentionally omitted
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({ cost: "hatch3r-broken" }),
    ).rejects.toThrow(HatchError);
    try {
      await explainCommand({ cost: "hatch3r-broken" });
    } catch (e) {
      expect((e as HatchError).message).toContain("triage_tiers");
    }
  });

  it("honors --input-rate and --output-rate overrides", async () => {
    const body = "x".repeat(8000);
    await writeCommandFile(tempDir, "hatch3r-rates.md", body, {
      id: "hatch3r-rates",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "rates",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({
      cost: "hatch3r-rates",
      inputRate: "10",
      outputRate: "30",
    });

    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toContain("Rates: $10/1M input, $30/1M output");
  });

  it("rejects invalid --input-rate values", async () => {
    const body = "x";
    await writeCommandFile(tempDir, "hatch3r-bad-rate.md", body, {
      id: "hatch3r-bad-rate",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "rates",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({
        cost: "hatch3r-bad-rate",
        inputRate: "not-a-number",
      }),
    ).rejects.toThrow(HatchError);
  });

  it("does not require orchestrator: true (declared tiers are honored regardless)", async () => {
    // Inline-execution commands rarely declare triage_tiers, but the command
    // should still print whatever the canonical file declares so authors can
    // inspect their cost model during authoring.
    const body = "y".repeat(200);
    await writeCommandFile(tempDir, "hatch3r-inline.md", body, {
      id: "hatch3r-inline",
      type: "command",
      orchestrator: false,
      description: "inline",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-inline" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Tier 1");
    expect(output).toContain("hatch3r-inline");
  });

  it("falls back to bundled canonical commands when not installed in current repo", async () => {
    // No .agents/commands/ in tempDir — the resolver should fall through to
    // the package's bundled commands/ directory. hatch3r-quick-change is
    // known to declare triage_tiers: [1, 2, 3].
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-quick-change" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("hatch3r-quick-change");
    expect(output).toContain("Tier 1");
    expect(output).toContain("Tier 2");
    expect(output).toContain("Tier 3");
  });
});
