// D3-3 (Cycle 11 Wave 2, P2/P5 — CLI command coverage): exercise the
// `hatch3r deps <id>` command body. Before this file, deps.ts had ~1% scoped
// coverage (no test invoked its `.action`), yet it is 181 LOC of real logic:
// 4-form id resolution, downstream agentPipeline/delegates surfacing, and an
// inverse upstream scan over every catalog item. These tests run against the
// REAL bundled canonical content root (resolveBundledContentRoot) so the id
// resolver and the upstream scan are checked end-to-end, and cover the
// missing-arg (exit 2) and unknown-id (CONFIG_ERROR) failure paths.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../../types.js";

describe("depsCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(async () => {
    // A bare tempdir as cwd guarantees no project-local .hatch3r/overrides leak
    // user content into the index — the resolver reads the bundled canonical
    // root regardless, and the upstream scan stays deterministic.
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-deps-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("throws a usage error (exit 2, VALIDATION_ERROR) when the id argument is missing", async () => {
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await expect(depsCommand(undefined)).rejects.toThrow(HatchError);
    try {
      await depsCommand(undefined);
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      expect((e as HatchError).recoveryHint).toContain("hatch3r deps");
    }
  });

  it("throws CONFIG_ERROR when the id matches no canonical artifact", async () => {
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await expect(depsCommand("definitely-not-a-real-artifact-id")).rejects.toMatchObject({
      errorCode: "CONFIG_ERROR",
    });
  });

  it("resolves a command id and lists its declared downstream agentPipeline", async () => {
    // hatch3r-quick-change is an orchestrator command with a non-empty
    // agentPipeline in canonical content, so the downstream block must be
    // populated and the orchestrator row present.
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("hatch3r-quick-change");
    const out = logged();
    expect(out).toContain("Downstream");
    expect(out).toContain("hatch3r-implementer");
    // Every downstream id declared by quick-change resolves in the index, so
    // there must be no "[not in content index]" marker on this artifact.
    expect(out).not.toContain("[not in content index]");
  });

  it("resolves an id given WITHOUT the hatch3r- prefix (4-form id lookup)", async () => {
    // The resolver tries [id, hatch3r-id, cmd-id, cmd-hatch3r-id]; passing the
    // bare slug must still resolve the canonical command.
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("quick-change");
    expect(logged()).toContain("hatch3r-quick-change");
  });

  it("surfaces the inverse upstream view for a delegated-to agent", async () => {
    // hatch3r-implementer is referenced in many commands' agentPipeline, so the
    // upstream scan must find at least one artifact that delegates to it.
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("hatch3r-implementer");
    const out = logged();
    expect(out).toContain("Upstream");
    // The implementer is delegated-to, so the "no artifacts reference this one"
    // empty-state line must NOT appear.
    expect(out).not.toContain("no artifacts reference this one");
  });

  it("surfaces prose-derived skill/rule/MCP references in a non-authoritative section (D12-10)", async () => {
    // hatch3r-implementer declares no agentPipeline/delegates yet references
    // canonical skills (hatch3r-design-system-detect, hatch3r-ui-ux-verify),
    // rules (hatch3r-tooling-hierarchy), and "Context7 MCP" in body prose. The
    // best-effort scan must surface these under the labelled References block so
    // the old "(none declared)" empty state no longer misleads the operator.
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("hatch3r-implementer");
    const out = logged();
    expect(out).toContain("References (best-effort, prose-derived");
    // index-confirmed skill + rule ids referenced in implementer prose
    expect(out).toContain("hatch3r-design-system-detect");
    expect(out).toContain("hatch3r-tooling-hierarchy");
    // pattern-matched MCP server name ("Context7 MCP" shorthand)
    expect(out).toContain("Context7");
    // the References block is populated, so its empty state must be absent
    expect(out).not.toContain("no skill / rule / MCP references found");
  });

  it("scans prose references on a command body too, not just agents (D12-10)", async () => {
    // hatch3r-quick-change is an orchestrator command whose body cites canonical
    // rules in prose (hatch3r-agent-orchestration, hatch3r-iteration-summary)
    // that are absent from its agentPipeline. The scan must surface them so the
    // command's non-agent dependency surface is visible.
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("hatch3r-quick-change");
    const out = logged();
    expect(out).toContain("References (best-effort, prose-derived");
    expect(out).toContain("hatch3r-agent-orchestration");
    expect(out).toContain("hatch3r-iteration-summary");
  });

  it("shows the References empty state when an artifact body cites no skill/rule/MCP (D12-10)", async () => {
    // hatch3r-edge-case-analyst's body cites no canonical skill/rule path refs
    // and no MCP server, so the References block must render its empty state
    // rather than fabricate references. Confirms the index-confirmation guard
    // rejects non-artifact mentions (zero false positives on the id facet).
    const { depsCommand } = await import("../../../cli/commands/deps.js");
    await depsCommand("hatch3r-edge-case-analyst");
    const out = logged();
    expect(out).toContain("References (best-effort, prose-derived");
    expect(out).toContain("no skill / rule / MCP references found");
  });
});
