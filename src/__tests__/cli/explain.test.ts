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

  it("rejects when neither --cost nor --customizations is provided", async () => {
    // SA12.3-F03 (Cycle 10 Wave 2): the mode selector now accepts two flags;
    // omitting both is a usage error and the message names both modes.
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(explainCommand({})).rejects.toThrow(HatchError);
    try {
      await explainCommand({});
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).message).toContain("--cost");
      expect((e as HatchError).message).toContain("--customizations");
    }
  });

  it("rejects when both --cost and --customizations are passed", async () => {
    // Mutual exclusion: the two modes do disjoint things and cannot compose.
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({ cost: "anything", customizations: true }),
    ).rejects.toThrow(HatchError);
    try {
      await explainCommand({ cost: "anything", customizations: true });
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).message).toContain("Conflicting flags");
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

  it("prices at the resolved --model rate and prints the assumed model (D6-18)", async () => {
    const body = "x".repeat(8000);
    await writeCommandFile(tempDir, "hatch3r-model.md", body, {
      id: "hatch3r-model",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "model",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-model", model: "opus" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Opus rates: $5/1M input, $25/1M output (not the Sonnet $3/$15 default).
    expect(output).toContain("Rates: $5/1M input, $25/1M output");
    expect(output).toContain("opus");
    expect(output).toContain("rate accessed");
  });

  it("lets --input-rate override the --model rate per-axis (D6-18)", async () => {
    const body = "x".repeat(8000);
    await writeCommandFile(tempDir, "hatch3r-model-override.md", body, {
      id: "hatch3r-model-override",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "override",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-model-override", model: "opus", inputRate: "99" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Explicit --input-rate wins; output keeps the resolved Opus $25 rate.
    expect(output).toContain("Rates: $99/1M input, $25/1M output");
  });

  it("rejects an unknown --model selector with an actionable error (D6-18)", async () => {
    const body = "x";
    await writeCommandFile(tempDir, "hatch3r-bad-model.md", body, {
      id: "hatch3r-bad-model",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "bad",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({ cost: "hatch3r-bad-model", model: "gpt-4" }),
    ).rejects.toThrow(HatchError);
    try {
      await explainCommand({ cost: "hatch3r-bad-model", model: "gpt-4" });
    } catch (e) {
      expect((e as HatchError).message).toContain("Unknown --model");
    }
  });

  it("applies --cache-hit and notes the cached-input discount in the footer (D6-19)", async () => {
    const body = "x".repeat(8000);
    await writeCommandFile(tempDir, "hatch3r-cache.md", body, {
      id: "hatch3r-cache",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "cache",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ cost: "hatch3r-cache", cacheHit: "0.9" });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("90% input cache-hit");
  });

  it("rejects an out-of-range --cache-hit value (D6-19)", async () => {
    const body = "x";
    await writeCommandFile(tempDir, "hatch3r-bad-cache.md", body, {
      id: "hatch3r-bad-cache",
      type: "command",
      orchestrator: true,
      agentPipeline: ["hatch3r-implementer"],
      description: "bad cache",
      tags: ["core"],
      triage_tiers: [1],
    });

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await expect(
      explainCommand({ cost: "hatch3r-bad-cache", cacheHit: "1.5" }),
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

  // SA12.3-F03 (Cycle 10 Wave 2): `--customizations` mode tests.
  it("--customizations: renders 'no files found' box when no customize.{yaml,md} exist", async () => {
    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ customizations: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Customizations");
    expect(output).toContain("No .customize.yaml or .customize.md files");
  });

  it("--customizations: reports an active md-body row for a non-protected canonical artifact", async () => {
    // Create a customize.md for `hatch3r-reviewer` (a canonical agent that
    // ships with the bundled package). The dry-call should pick it up,
    // classify the outcome as `active`, and surface the artifact in the table.
    const customDir = join(tempDir, ".hatch3r", "agents");
    await mkdir(customDir, { recursive: true });
    await writeFile(
      join(customDir, "hatch3r-reviewer.customize.md"),
      "Focus on security review patterns.",
      "utf-8",
    );

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ customizations: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("hatch3r-reviewer");
    expect(output).toContain("active");
    expect(output).toMatch(/1 active/);
  });

  it("--customizations: reports a failed row when enabled: false is set on a protected/floor artifact", async () => {
    // hatch3r-security is protected + floor:security-tagged in the
    // canonical content. enabled: false on it must be rejected by
    // applyCustomization (F2.3-C1) and surface as a `failed` outcome.
    const customDir = join(tempDir, ".hatch3r", "agents");
    await mkdir(customDir, { recursive: true });
    await writeFile(
      join(customDir, "hatch3r-security.customize.yaml"),
      "enabled: false\n",
      "utf-8",
    );

    const { explainCommand } = await import("../../cli/commands/explain.js");
    await explainCommand({ customizations: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("hatch3r-security");
    expect(output).toContain("failed");
    expect(output).toMatch(/[1-9]\d* failed/);
  });

  // D12-2 (Cycle 11 Wave 2, D12, P4/P1): `explain --source all` defaults to a
  // bounded per-output count summary rather than enumerating every canonical
  // source for every output. The old full enumeration was 224,672 lines /
  // 19.3 MB for a standard init+sync. These tests pin: (1) the default `all`
  // form prints counts, not per-source bullet lines; (2) `--verbose` expands
  // to the full per-path lists; (3) the single-path form is unchanged (full
  // list for the one requested output).
  describe("--source provenance summary (D12-2)", () => {
    // One aggregate output carrying many sources, plus single-source outputs —
    // mirrors the post-D12-1 shape where ~95% of outputs have one source and a
    // handful (CLAUDE.md, the cursor bridge) aggregate the canonical read set.
    const AGG_SOURCES = Array.from({ length: 40 }, (_, i) => `agents/hatch3r-src-${i}.md`);
    // A grep sentinel that only appears if individual source filenames are printed.
    const SENTINEL = "agents/hatch3r-src-37.md";

    async function writeProvenanceFixture(): Promise<void> {
      const dir = join(tempDir, ".hatch3r");
      await mkdir(dir, { recursive: true });
      const manifest = {
        schemaVersion: 1,
        hatch3rVersion: "2.0.0",
        generatedAt: "2026-06-06T00:00:00.000Z",
        lastCommand: "sync",
        lastRunId: "hr-d122-test",
        outputs: [
          { path: "CLAUDE.md", adapter: "claude", sourceFiles: AGG_SOURCES },
          { path: ".cursor/rules/10-secrets.mdc", adapter: "cursor", sourceFiles: ["rules/hatch3r-secrets-management.md"] },
          { path: ".cursor/rules/30-supply.mdc", adapter: "cursor", sourceFiles: ["rules/hatch3r-supply-chain.md"] },
        ],
      };
      await writeFile(join(dir, "provenance.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    }

    it("`--source all` prints a per-output count summary, not the full source enumeration", async () => {
      await writeProvenanceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "all" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Header reports total outputs + total source links.
      expect(output).toContain("Per-output source counts");
      expect(output).toContain("CLAUDE.md");
      // The aggregate's source COUNT (40) is shown...
      expect(output).toContain("40");
      // ...but NOT the individual source filenames (the 224K-line symptom).
      expect(output).not.toContain(SENTINEL);
      // Detail hint is surfaced so the user can opt in.
      expect(output).toContain("--source all --verbose");
    });

    it("`--source all --verbose` expands to the full per-path source list", async () => {
      await writeProvenanceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "all", verbose: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Verbose mode prints each individual canonical source filename.
      expect(output).toContain(SENTINEL);
      expect(output).toContain("rules/hatch3r-secrets-management.md");
    });

    it("`--source <single-path>` still prints the full source list for that one output", async () => {
      await writeProvenanceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "CLAUDE.md" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Single-path form is unaffected by the summary cap: full list shown.
      expect(output).toContain("Source: CLAUDE.md");
      expect(output).toContain(SENTINEL);
    });
  });

  // D12-11 (Cycle 11 Wave 3, D12, P1): `explain --source --format json` emits a
  // single machine-readable document (via emitJson → process.stdout.write), not
  // boxen chrome — matching the JSON surface `provenance`/`verify` already ship.
  // JSON is source-only; the stored sourceFiles are already repo-root-relative
  // (D12-3 / H3), so the JSON form surfaces those relative paths verbatim.
  describe("--source --format json (D12-11)", () => {
    let stdoutSpy: MockInstance;

    beforeEach(() => {
      // emitJson writes via process.stdout.write, not console.log — spy that.
      stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });
    afterEach(() => {
      stdoutSpy.mockRestore();
    });

    function jsonPayload(): unknown {
      // The first stdout.write is the emitted JSON document (one-shot).
      const raw = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      return JSON.parse(raw.trim());
    }

    async function writeJsonFixture(): Promise<void> {
      const dir = join(tempDir, ".hatch3r");
      await mkdir(dir, { recursive: true });
      const manifest = {
        schemaVersion: 1,
        hatch3rVersion: "2.0.0",
        generatedAt: "2026-06-07T00:00:00.000Z",
        lastCommand: "sync",
        lastRunId: "hr-d1211-test",
        outputs: [
          { path: "CLAUDE.md", adapter: "claude", sourceFiles: ["agents/hatch3r-architect.md", "rules/hatch3r-security-patterns.md"] },
          { path: ".cursor/rules/10-secrets.mdc", adapter: "cursor", sourceFiles: ["rules/hatch3r-secrets-management.md"] },
        ],
      };
      await writeFile(join(dir, "provenance.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    }

    it("single-path form emits {output, adapter, sourceFiles, hatch3rVersion, generatedAt} with relative paths", async () => {
      await writeJsonFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "CLAUDE.md", format: "json" });

      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.status).toBe("present");
      expect(payload.output).toBe("CLAUDE.md");
      expect(payload.adapter).toBe("claude");
      expect(payload.sourceFiles).toEqual([
        "agents/hatch3r-architect.md",
        "rules/hatch3r-security-patterns.md",
      ]);
      // H3: sourceFiles are repo-root-relative, not absolute home paths.
      for (const src of payload.sourceFiles as string[]) {
        expect(src.startsWith("/")).toBe(false);
      }
      expect(payload.hatch3rVersion).toBe("2.0.0");
      expect(payload.generatedAt).toBe("2026-06-07T00:00:00.000Z");
    });

    it("`--source all --format json` emits an uncapped outputs[] envelope", async () => {
      await writeJsonFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "all", format: "json" });

      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.status).toBe("present");
      const outputs = payload.outputs as Array<Record<string, unknown>>;
      expect(outputs).toHaveLength(2);
      // Full (uncapped) source lists in JSON, regardless of the human --verbose cap.
      const claudeRow = outputs.find((o) => o.output === "CLAUDE.md")!;
      expect(claudeRow.sourceFiles).toEqual([
        "agents/hatch3r-architect.md",
        "rules/hatch3r-security-patterns.md",
      ]);
      expect(payload.hatch3rVersion).toBe("2.0.0");
    });

    it("an unrecorded path emits status:not-found JSON and still throws exit-config", async () => {
      await writeJsonFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await expect(
        explainCommand({ source: "does/not/exist.md", format: "json" }),
      ).rejects.toThrow(HatchError);

      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.status).toBe("not-found");
      expect(payload.output).toBe("does/not/exist.md");
    });

    it("a missing manifest emits status:absent JSON (no boxen chrome) and throws", async () => {
      // No provenance.json written.
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await expect(
        explainCommand({ source: "all", format: "json" }),
      ).rejects.toThrow(HatchError);

      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.status).toBe("absent");
      expect(payload.hatch3rVersion).toBeTruthy();
    });

    // W5: `--format json` is honored by EVERY explain mode (the former
    // source-only restriction and its usage error are gone). Each non-source
    // mode emits one machine-readable envelope.
    it("`--customizations --format json` emits a single JSON envelope (W5 widening)", async () => {
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ customizations: true, format: "json" });
      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.command).toBe("explain");
      expect(payload.mode).toBe("customizations");
      expect(payload.counts).toBeDefined();
      expect(Array.isArray(payload.entries)).toBe(true);
      expect(payload.hatch3rVersion).toBeTruthy();
    });

    it("`--cost --format json` emits tier rows + totals as a single JSON envelope (W5 widening)", async () => {
      await writeCommandFile(tempDir, "hatch3r-json-cost.md", "Body.", {
        id: "hatch3r-json-cost",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        triage_tiers: [1, 2],
      });
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-json-cost", format: "json" });
      const payload = jsonPayload() as Record<string, unknown>;
      expect(payload.command).toBe("explain");
      expect(payload.mode).toBe("cost");
      expect(payload.commandId).toBe("hatch3r-json-cost");
      const rows = payload.tierRows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0].tier).toBe(1);
      expect(payload.totals).toBeDefined();
    });
  });

  // D6-23 (Cycle 11 Wave 3): `--cost` input basis is per-actor, not
  // body×subAgents. The orchestrator reads its body once; each spawned
  // sub-agent loads its own agent def + a task-context allowance. The pre-fix
  // basis (body re-billed to every sub-agent) over-counted input.
  describe("--cost per-actor input basis (D6-23)", () => {
    it("states the per-actor input basis in the footer instead of body×subAgents", async () => {
      const body = "x".repeat(40);
      await writeCommandFile(tempDir, "hatch3r-basis.md", body, {
        id: "hatch3r-basis",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer", "hatch3r-reviewer"],
        description: "basis",
        tags: ["core"],
        triage_tiers: [1, 2, 3],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-basis" });

      const output = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      // The corrected basis is named explicitly so figures are not misread.
      expect(output).toContain("Input basis: orchestrator body once");
      expect(output).toContain("its own agents/<id>.md");
      expect(output).toContain("task allowance");
    });

    it("sizes a tier-1 inline actor by the agent-def + task-context fallback, not the body alone", async () => {
      // A 4-char body: under the pre-fix model tier-1 input was bodyTokens×1
      // (~1 token). Under the per-actor model the tier-1 inline actor (no
      // distinct agent def) bills at UNKNOWN_AGENT_DEF_CHARS (12000) +
      // TASK_CONTEXT_ALLOWANCE_CHARS (6000) = 18000 chars / 4 = 4500 tokens,
      // plus the tiny body — so the tier-1 input lands in the 4,50x range,
      // impossible under body×subAgents.
      const body = "x".repeat(4);
      await writeCommandFile(tempDir, "hatch3r-tier1.md", body, {
        id: "hatch3r-tier1",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "tier1",
        tags: ["core"],
        triage_tiers: [1],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-tier1" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Tier-1 row carries a ~4,50x input token figure (agent-def + task
      // allowance dominate the 4-char body).
      expect(output).toMatch(/Tier 1[\s\S]*?4,50\d/);
    });

    it("counts the orchestrator body once: tier-2 input delta is body-independent (per-actor)", async () => {
      // Same body across two commands; the only difference is two extra agents
      // (reviewer, fixer) in the pipeline. Under the per-actor model the body is
      // counted ONCE, so the input delta equals exactly the two extra agents'
      // (def + task-context) token contribution and does NOT depend on body
      // size. Under the pre-fix body×subAgents model the delta would be
      // 2×bodyTokens (the body re-billed to each added sub-agent). We assert the
      // delta is invariant across two very different body sizes — only the
      // per-actor (body-once) model produces an identical delta.
      const SMALL = "x".repeat(40);
      const LARGE = "x".repeat(400_000); // 100k body tokens — would explode a body×N delta
      const onePipe = ["hatch3r-implementer"];
      const threePipe = ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-fixer"];

      async function tier2Input(filename: string, body: string, pipeline: string[]): Promise<number> {
        await writeCommandFile(tempDir, filename, body, {
          id: filename.replace(/\.md$/, ""),
          type: "command",
          orchestrator: true,
          agentPipeline: pipeline,
          description: "delta",
          tags: ["core"],
          triage_tiers: [2],
        });
        const { explainCommand } = await import("../../cli/commands/explain.js");
        consoleSpy.mockClear();
        await explainCommand({ cost: filename.replace(/\.md$/, "") });
        const out = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
        const row = out.split("\n").find((l) => l.includes("Tier 2"));
        expect(row).toBeTruthy();
        // Row numbers: [sub-agent count, input, output, total]. Input is index 1.
        const nums = (row as string).match(/[\d,]+/g)?.map((n) => Number(n.replace(/,/g, ""))) ?? [];
        return nums[1] ?? 0;
      }

      const smallDelta =
        (await tier2Input("hatch3r-s3.md", SMALL, threePipe)) -
        (await tier2Input("hatch3r-s1.md", SMALL, onePipe));
      const largeDelta =
        (await tier2Input("hatch3r-l3.md", LARGE, threePipe)) -
        (await tier2Input("hatch3r-l1.md", LARGE, onePipe));

      // Body-once invariance: the added-agent delta is identical at 40 chars and
      // at 400 KB of body. A body×subAgents model would make largeDelta ≈
      // 2×100000 = 200000 while smallDelta ≈ 2×10, so they could never match.
      expect(smallDelta).toBeGreaterThan(0);
      expect(largeDelta).toBe(smallDelta);
    });
  });

  // D1-SA1.7-05 (Cycle 12 Wave 3, D1, P4): `--cost` id resolution routes
  // through the shared content index (same 4-candidate lookup as show/deps),
  // so user commands under `.hatch3r/overrides/commands/` and canonical
  // overrides resolve — the pre-fix bespoke path probed only the legacy
  // `.agents/` tree and the bundled `commands/` dir.
  describe("--cost content-index resolution (D1-SA1.7-05)", () => {
    let consoleWarnSpy: MockInstance;

    beforeEach(() => {
      // The canonical-override case legitimately triggers the index's
      // user-shadow-canonical console.warn; keep test output clean.
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    async function writeOverrideCommandFile(
      filename: string,
      frontmatter: Record<string, unknown>,
    ): Promise<void> {
      const dir = join(tempDir, ".hatch3r", "overrides", "commands");
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
      lines.push("---", "", "override body");
      await writeFile(join(dir, filename), lines.join("\n"));
    }

    it("resolves a user-authored command under .hatch3r/overrides/commands/ (bare id, no forced prefix)", async () => {
      // Pre-fix: 'Command not found' — the bespoke probes never looked at the
      // overrides tier, and the id was force-prefixed to `hatch3r-`.
      await writeOverrideCommandFile("my-costed-cmd.md", {
        id: "my-costed-cmd",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "user command",
        tags: ["core"],
        triage_tiers: [1],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "my-costed-cmd" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Tier 1");
      expect(output).not.toContain("Tier 2");
    });

    it("costs the canonical OVERRIDE, not the bundled copy, when .hatch3r/overrides shadows a canonical id", async () => {
      // Bundled hatch3r-quick-change declares triage_tiers [1, 2, 3]; the
      // override narrows to [1]. Pre-fix the bundled copy was costed (3 tier
      // rows) — the user got figures for the artifact they are NOT running.
      await writeOverrideCommandFile("hatch3r-quick-change.md", {
        id: "hatch3r-quick-change",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "narrowed override",
        tags: ["core"],
        triage_tiers: [1],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-quick-change" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Tier 1");
      expect(output).not.toContain("Tier 3"); // bundled copy would print 3 rows
    });

    it("keeps the legacy .agents/commands/ probe FIRST (Wave-7 back-compat order)", async () => {
      // Both a legacy installed copy and an override exist: the legacy tree
      // wins, preserving the documented pre-1.9 resolution order.
      await writeCommandFile(tempDir, "hatch3r-order.md", "legacy body", {
        id: "hatch3r-order",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "legacy",
        tags: ["core"],
        triage_tiers: [1],
      });
      await writeOverrideCommandFile("hatch3r-order.md", {
        id: "hatch3r-order",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "override",
        tags: ["core"],
        triage_tiers: [1, 2],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-order" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Tier 1");
      expect(output).not.toContain("Tier 2"); // legacy copy (single tier) won
    });

    it("still resolves a bundled canonical command by id (regression: pre-fix behavior kept)", async () => {
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-quick-change" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Bundled quick-change carries triage_tiers [1, 2, 3].
      expect(output).toContain("Tier 1");
      expect(output).toContain("Tier 3");
    });
  });

  // D12-9 (Cycle 11 Wave 3): `--customizations` table is responsive to terminal
  // width and wraps long reasons into continuation lines instead of truncating,
  // so it stays legible at the 80-col non-TTY/CI fallback width.
  describe("--customizations responsive width (D12-9)", () => {
    let columnsDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
      // Force the 80-col fallback so the assertion is width-deterministic
      // regardless of whether CI runs under a TTY.
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    });

    afterEach(() => {
      if (columnsDescriptor) {
        Object.defineProperty(process.stdout, "columns", columnsDescriptor);
      } else {
        // jsdom/node leaves columns undefined by default; restore that.
        Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
      }
    });

    it("keeps the artifact id intact and wraps the long reason tail at 80 cols", async () => {
      // enabled: false on the protected, floor-tagged hatch3r-security agent
      // produces a ~95-char failure reason ("Cannot disable protected agent
      // \"hatch3r-security\" via customization. Ignoring enabled: false."). The
      // pre-fix renderer truncated the reason at 50 cols and dropped the
      // "Ignoring enabled: false." tail; the wrap keeps it on a continuation
      // line. The id (16 chars) must survive intact within its responsive
      // column at 80 cols.
      const customDir = join(tempDir, ".hatch3r", "agents");
      await mkdir(customDir, { recursive: true });
      await writeFile(
        join(customDir, "hatch3r-security.customize.yaml"),
        "enabled: false\n",
        "utf-8",
      );

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ customizations: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Id survives uncropped (no ellipsis on the lookup key).
      expect(output).toContain("hatch3r-security");
      // The reason tail that the old 50-col truncation dropped is now present
      // (wrapped onto a continuation line), proving wrap-not-truncate.
      expect(output).toContain("Ignoring enabled");
    });
  });

  // D6-SA6.3-06 (Cycle 12 Wave 4): `explain --cost` shows a second "typical
  // cached" figure by default so the headline is not the undiscoverably
  // pessimistic uncached upper bound — the framework's efficiency thesis is
  // static-first prompt-cache reuse (cached input bills at 0.1× base). A pinned
  // --cache-hit is the user's own scenario and suppresses the projection.
  describe("--cost typical-cache projection (D6-SA6.3-06)", () => {
    it("shows both the uncached ceiling and a typical-cached figure by default", async () => {
      const body = "x".repeat(8000);
      await writeCommandFile(tempDir, "hatch3r-typcache.md", body, {
        id: "hatch3r-typcache",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "typcache",
        tags: ["core"],
        triage_tiers: [1, 2],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-typcache" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // The uncached table headline is still present...
      expect(output).toContain("All tiers (sum)");
      // ...and the second (typical-cached) figure now accompanies it by default.
      expect(output).toContain("Typical cached");
      expect(output).toContain("90% input cache-hit");
      // The flag is surfaced at point-of-use (its registration lives in the
      // separately owned CLI wiring, but the default output now names it).
      expect(output).toContain("--cache-hit");
    });

    it("suppresses the typical projection when the user pins --cache-hit", async () => {
      const body = "x".repeat(8000);
      await writeCommandFile(tempDir, "hatch3r-pinned.md", body, {
        id: "hatch3r-pinned",
        type: "command",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        description: "pinned",
        tags: ["core"],
        triage_tiers: [1],
      });

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ cost: "hatch3r-pinned", cacheHit: "0.5" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // The pinned ratio is the chosen scenario — no second projection line.
      expect(output).not.toContain("Typical cached");
      // The existing pinned-ratio footer note still renders.
      expect(output).toContain("50% input cache-hit");
    });

    it("adds a `typical` block to --cost --format json by default, null when pinned", async () => {
      await writeCommandFile(tempDir, "hatch3r-typjson.md", "Body.", {
        id: "hatch3r-typjson",
        orchestrator: true,
        agentPipeline: ["hatch3r-implementer"],
        triage_tiers: [1, 2],
      });
      const { explainCommand } = await import("../../cli/commands/explain.js");
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await explainCommand({ cost: "hatch3r-typjson", format: "json" });
        const def = JSON.parse(
          stdoutSpy.mock.calls.map((c) => String(c[0])).join("").trim(),
        ) as Record<string, unknown>;
        const typical = def.typical as Record<string, unknown> | null;
        expect(typical).not.toBeNull();
        expect((typical as Record<string, unknown>).cacheHitRatio).toBe(0.9);
        expect(typeof (typical as Record<string, unknown>).totalUsd).toBe("number");

        stdoutSpy.mockClear();
        await explainCommand({ cost: "hatch3r-typjson", format: "json", cacheHit: "0.3" });
        const pinned = JSON.parse(
          stdoutSpy.mock.calls.map((c) => String(c[0])).join("").trim(),
        ) as Record<string, unknown>;
        expect(pinned.typical).toBeNull();
      } finally {
        stdoutSpy.mockRestore();
      }
    });
  });

  // D12-SA12.3-03 (Cycle 12 Wave 4): `explain --customizations` human mode now
  // renders the RESOLVED value of a description/model/scope override (not just
  // WHICH field applied), so a value override can be confirmed from the table —
  // previously only `enabled` showed its value and the rest needed --format json.
  describe("--customizations resolved values (D12-SA12.3-03)", () => {
    it("renders the resolved value of a model override in the human table", async () => {
      // A model override on a canonical agent (hatch3r-reviewer) is accepted
      // (only rules/prompts/hooks lack a model), so appliedOverrides.model is
      // populated and the row classifies `active`.
      const customDir = join(tempDir, ".hatch3r", "agents");
      await mkdir(customDir, { recursive: true });
      await writeFile(
        join(customDir, "hatch3r-reviewer.customize.yaml"),
        "model: claude-haiku-4-5\n",
        "utf-8",
      );

      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ customizations: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("hatch3r-reviewer");
      // The compact Overrides cell still names the field...
      expect(output).toContain("model");
      // ...and the resolved VALUE is now rendered too (the D12-SA12.3-03 gap).
      expect(output).toContain("claude-haiku-4-5");
    });
  });

  // D12-SA12.4-02 (Cycle 12 Wave 4, consumer half): `explain --source` renders
  // an empty sourceFiles list by its `sourceKind` discriminator when present —
  // distinguishing a config-only output from a tracking failure — and, when the
  // discriminator is absent (real manifests until the producer half lands in
  // base.ts/provenance.ts), names both possibilities instead of the bare,
  // ambiguous "(none recorded)".
  describe("--source empty-sourceFiles discriminator (D12-SA12.4-02)", () => {
    async function writeEmptySourceFixture(): Promise<void> {
      const dir = join(tempDir, ".hatch3r");
      await mkdir(dir, { recursive: true });
      const manifest = {
        schemaVersion: 1,
        hatch3rVersion: "2.5.0",
        generatedAt: "2026-07-11T00:00:00.000Z",
        lastCommand: "sync",
        lastRunId: "hr-d1244-test",
        outputs: [
          { path: ".mcp.json", adapter: "claude", sourceFiles: [], sourceKind: "config" },
          { path: "weird-output.md", adapter: "cursor", sourceFiles: [], sourceKind: "untracked" },
          { path: "legacy-empty.txt", adapter: "copilot", sourceFiles: [] },
        ],
      };
      await writeFile(join(dir, "provenance.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    }

    it("renders a config-only output distinctly (not the bare '(none recorded)')", async () => {
      await writeEmptySourceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: ".mcp.json" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("config-only output");
      expect(output).not.toContain("(none recorded");
    });

    it("renders an untracked output as a tracking failure with a remediation", async () => {
      await writeEmptySourceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "weird-output.md" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("source tracking unavailable");
      expect(output).toContain("hatch3r sync");
    });

    it("names both possibilities when no discriminator is persisted (real-manifest fallback)", async () => {
      await writeEmptySourceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      await explainCommand({ source: "legacy-empty.txt" });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // Honest dual-possibility message — improves on the bare, ambiguous prior.
      expect(output).toContain("either a config-only output");
      expect(output).toContain("re-run");
    });

    it("passes sourceKind through --source --format json", async () => {
      await writeEmptySourceFixture();
      const { explainCommand } = await import("../../cli/commands/explain.js");
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await explainCommand({ source: ".mcp.json", format: "json" });
        const payload = JSON.parse(
          stdoutSpy.mock.calls.map((c) => String(c[0])).join("").trim(),
        ) as Record<string, unknown>;
        expect(payload.status).toBe("present");
        expect(payload.sourceKind).toBe("config");
        expect(payload.sourceFiles).toEqual([]);
      } finally {
        stdoutSpy.mockRestore();
      }
    });
  });
});
