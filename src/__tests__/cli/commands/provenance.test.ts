// D3-3 (Cycle 11 Wave 2, P2/P5 — CLI command coverage): exercise the
// `hatch3r provenance` command body. provenance.ts (134 LOC) had no test
// invoking its `.action`. These tests cover the four real branches: present
// manifest (human + per-adapter rollup), empty manifest, absent file
// (ENOENT → FS_ERROR), corrupt JSON (→ FS_ERROR), and the `--json` envelope
// for both present and absent states.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../../types.js";

async function writeProvenance(root: string, manifest: unknown): Promise<void> {
  const dir = join(root, HATCH3R_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "provenance.json"), JSON.stringify(manifest), "utf-8");
}

describe("provenanceCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: MockInstance;
  let errorSpy: MockInstance;
  let stdoutSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // JSON mode writes through process.stdout via emitJson; capture it.
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function loggedHuman(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }
  function loggedJson(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("prints the manifest header + per-adapter rollup for a populated manifest", async () => {
    await writeProvenance(tempDir, {
      schemaVersion: 1,
      hatch3rVersion: "2.0.0",
      generatedAt: "2026-06-05T00:00:00.000Z",
      lastCommand: "sync",
      lastRunId: "hr-test-1",
      outputs: [
        { path: "CLAUDE.md", adapter: "claude", sourceFiles: ["agents/hatch3r-implementer.md"] },
        { path: ".cursor/rules/10-x.mdc", adapter: "cursor", sourceFiles: ["rules/x.md"] },
        { path: ".cursor/rules/30-y.mdc", adapter: "cursor", sourceFiles: ["rules/y.md"] },
      ],
    });
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    await provenanceCommand();
    const out = loggedHuman();
    expect(out).toContain("Provenance");
    expect(out).toContain("sync");
    expect(out).toContain("hr-test-1");
    // Per-adapter rollup: cursor produced 2, claude produced 1.
    expect(out).toContain("claude");
    expect(out).toContain("cursor");
  });

  it("reports the empty state when outputs is an empty array", async () => {
    await writeProvenance(tempDir, { schemaVersion: 1, outputs: [] });
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    await provenanceCommand();
    expect(loggedHuman()).toContain("no recorded outputs");
  });

  it("throws FS_ERROR with a sync recovery hint when the manifest is absent", async () => {
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    await expect(provenanceCommand()).rejects.toThrow(HatchError);
    try {
      await provenanceCommand();
    } catch (e) {
      expect((e as HatchError).errorCode).toBe("FS_ERROR");
      expect((e as HatchError).recoveryHint).toContain("hatch3r sync");
    }
  });

  it("throws FS_ERROR (distinct from ENOENT) when the manifest JSON is corrupt", async () => {
    const dir = join(tempDir, HATCH3R_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "provenance.json"), "{ this is not valid json", "utf-8");
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    await expect(provenanceCommand()).rejects.toMatchObject({ errorCode: "FS_ERROR" });
    try {
      await provenanceCommand();
    } catch (e) {
      // The corrupt-parse branch carries the "Unreadable" message, not the
      // ENOENT "No ... found" message — the two are deliberately distinct.
      expect((e as HatchError).message).toContain("Unreadable");
    }
  });

  it("emits a single `present` JSON envelope under --format json", async () => {
    await writeProvenance(tempDir, {
      schemaVersion: 1,
      outputs: [{ path: "CLAUDE.md", adapter: "claude", sourceFiles: [] }],
    });
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    await provenanceCommand({ format: "json" });
    const raw = loggedJson();
    const start = raw.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(raw.slice(start).trim()) as { status: string; manifest?: unknown };
    expect(payload.status).toBe("present");
    expect(payload.manifest).toBeDefined();
  });

  it("emits an `absent` JSON envelope (no throw before payload) under --format json when missing", async () => {
    const { provenanceCommand } = await import("../../../cli/commands/provenance.js");
    // JSON mode emits the structured payload first, THEN throws the FS_ERROR.
    await expect(provenanceCommand({ format: "json" })).rejects.toThrow(HatchError);
    const raw = loggedJson();
    const start = raw.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(raw.slice(start).trim()) as { status: string };
    expect(payload.status).toBe("absent");
  });
});
