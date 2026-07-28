/**
 * DD-E4 (release/2.8.5): JSON-surface stability. Two layers:
 *
 *   1. `finishCommand` / `buildJsonEnvelope` envelope invariants
 *      (src/cli/shared/commandOutput.ts): style→status derivation, the
 *      documented `json.status` override, and the append-after-spread rule
 *      that makes `command` / `hatch3rVersion` / `timestamp` non-clobberable.
 *
 *   2. Top-level KEY-SET pins for the four JSON-emitting read/sync commands
 *      (`sync`, `status`, `verify`, `validate`) captured against a staged
 *      minimal repo — a key rename/removal is a breaking change for CI
 *      consumers and must show up as a failing diff here, not in a
 *      downstream pipeline. The verify/validate sets are pinned AS-IS
 *      including their known pre-W5 gaps (no `command` key) — this suite
 *      characterizes, the migration finding tracks the gap.
 *
 * Deviation note: the worklist also names init-dry-run JSON. init.ts is
 * owned by a concurrent 2.8.5 work unit and its payload is in flux on this
 * branch, so pinning it here would gate on a moving surface; add the pin
 * once that slice lands.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { finishCommand, buildJsonEnvelope } from "../../cli/shared/commandOutput.js";

function captureStdout(): { writes: string[]; spy: MockInstance } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as never);
  return { writes, spy };
}

function jsonDocs(writes: string[]): Array<Record<string, unknown>> {
  return writes
    .filter((w) => w.trimStart().startsWith("{"))
    .map((w) => JSON.parse(w) as Record<string, unknown>);
}

describe("finishCommand JSON envelope invariants (commandOutput.ts)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits exactly one document: {status, ...json, command, hatch3rVersion, timestamp}", () => {
    const { writes, spy } = captureStdout();
    finishCommand("json", {
      command: "demo",
      title: "t",
      lines: [],
      style: "success",
      json: { extra: 1 },
    });
    spy.mockRestore();

    const docs = jsonDocs(writes);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      status: "passed",
      extra: 1,
      command: "demo",
      hatch3rVersion: HATCH3R_VERSION,
    });
    expect(typeof docs[0].timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(docs[0].timestamp as string))).toBe(false);
  });

  it("derives status from style (success→passed, info→ok, warning→partial, error→failed)", () => {
    const cases = [
      ["success", "passed"],
      ["info", "ok"],
      ["warning", "partial"],
      ["error", "failed"],
    ] as const;
    for (const [style, status] of cases) {
      const { writes, spy } = captureStdout();
      finishCommand("json", { command: "demo", title: "t", lines: [], style });
      spy.mockRestore();
      expect(jsonDocs(writes)[0].status, style).toBe(status);
    }
  });

  it("a `status` key inside outcome.json is the one documented override", () => {
    const { writes, spy } = captureStdout();
    finishCommand("json", {
      command: "demo",
      title: "t",
      lines: [],
      style: "info",
      json: { status: "dry-run" },
    });
    spy.mockRestore();
    expect(jsonDocs(writes)[0].status).toBe("dry-run");
  });

  it("command/hatch3rVersion/timestamp are appended AFTER the spread — payload keys cannot clobber them", () => {
    const { writes, spy } = captureStdout();
    finishCommand("json", {
      command: "demo",
      title: "t",
      lines: [],
      json: { command: "spoofed", hatch3rVersion: "0.0.0", timestamp: "spoofed" },
    });
    spy.mockRestore();
    const doc = jsonDocs(writes)[0];
    expect(doc.command).toBe("demo");
    expect(doc.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(doc.timestamp).not.toBe("spoofed");
  });

  it("human mode emits no JSON document", () => {
    const { writes, spy } = captureStdout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    finishCommand("human", { command: "demo", title: "t", lines: ["x"] });
    spy.mockRestore();
    logSpy.mockRestore();
    expect(jsonDocs(writes)).toHaveLength(0);
  });
});

describe("buildJsonEnvelope invariants (legacy direct-emitJson sites)", () => {
  it("appends identity fields after the spread and preserves the domain status verbatim", () => {
    const env = buildJsonEnvelope("status", { status: "in-sync", command: "spoofed" }, { outcome: "passed" });
    expect(env.status).toBe("in-sync");
    expect(env.command).toBe("status");
    expect(env.outcome).toBe("passed");
    expect(env.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(typeof env.timestamp).toBe("string");
  });

  it("omits outcome when not supplied", () => {
    const env = buildJsonEnvelope("verify", { status: "pass" });
    expect("outcome" in env).toBe(false);
  });
});

describe("DD-E4 top-level key-set pins (staged repo, --format json)", () => {
  let tempDir: string;
  let cwdSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-jsonschema-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    await writeFile(
      join(tempDir, HATCH3R_DIR, "hatch.json"),
      JSON.stringify({
        version: "3.0.0",
        hatch3rVersion: "2.8.5",
        owner: "o",
        repo: "r",
        namespace: "o",
        project: "r",
        tools: ["cursor"],
        features: {
          agents: true, skills: false, rules: true, prompts: false,
          commands: false, mcp: false, githubAgents: false, hooks: false, handoffs: false,
        },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: "minimal",
          projectType: "brownfield",
          teamSize: "solo",
          items: {
            agents: ["hatch3r-implementer"],
            skills: [],
            rules: ["hatch3r-git-conventions"],
            commands: [],
            prompts: [],
            hooks: [],
            githubAgents: [],
          },
        },
      }, null, 2),
    );
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    vi.restoreAllMocks();
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function runJson(fn: () => Promise<void>): Promise<Record<string, unknown>> {
    const { writes, spy } = captureStdout();
    let threw: unknown;
    try {
      await fn();
    } catch (err) {
      // verify/status may throw AFTER emitting to set the exit code — the
      // document is what this suite pins; record the throw for visibility.
      threw = err;
    } finally {
      spy.mockRestore();
    }
    void threw;
    const docs = jsonDocs(writes);
    expect(docs, "exactly one JSON document per run").toHaveLength(1);
    return docs[0];
  }

  it("sync --format json: pinned key set (workspace key absent outside a cascade run)", async () => {
    const { syncCommand } = await import("../../cli/commands/sync.js");
    const doc = await runJson(() => syncCommand({ format: "json" }));
    expect(Object.keys(doc).sort()).toEqual([
      "adapterFailures",
      "command",
      "dryRun",
      "hatch3rVersion",
      "partialFailureLines",
      "results",
      "snapshotSessionId",
      "status",
      "successfulAdapters",
      "timestamp",
    ]);
    expect(doc.status).toBe("passed");
  }, 120_000);

  it("status --format json: pinned key set", async () => {
    // Sync first so status reads a coherent in-sync tree.
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await runJson(() => syncCommand({ format: "json" }));

    const { statusCommand } = await import("../../cli/commands/status.js");
    const doc = await runJson(() => statusCommand({ format: "json" }));
    expect(Object.keys(doc).sort()).toEqual([
      "command",
      "counts",
      "driftKindCounts",
      "emissionGaps",
      "entries",
      "hatch3rVersion",
      "installation",
      "outcome",
      "spaceTelemetry",
      "status",
      "timestamp",
      "tools",
    ]);
  }, 120_000);

  it("verify --format json: pinned key set (pre-W5 holdout — no `command` key yet)", async () => {
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await runJson(() => syncCommand({ format: "json" }));

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    const doc = await runJson(() => verifyCommand({ format: "json" }));
    expect(Object.keys(doc).sort()).toEqual([
      "counts",
      "driftCount",
      "driftKindCounts",
      "emissionGaps",
      "entries",
      "fixApplied",
      "hatch3rVersion",
      "manifestHatch3rVersion",
      "status",
      "tamperWarnings",
      "timestamp",
      "versionSkew",
      "versionSkewDirection",
    ]);
  }, 120_000);

  it("validate --format json: pinned key set (pre-W5 holdout — errors/summary/warnings only)", async () => {
    const { validateCommand } = await import("../../cli/commands/validate.js");
    const doc = await runJson(() => validateCommand({ format: "json" }));
    expect(Object.keys(doc).sort()).toEqual(["errors", "summary", "warnings"]);
  }, 120_000);
});
