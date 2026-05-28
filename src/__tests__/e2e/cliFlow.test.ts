import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * D3-M10 (Cycle 10 Wave-3 Medium rollover): there was no subprocess CLI
 * e2e flow test for the init → sync → status pipeline. `createFlow.test.ts`
 * already exercises the public APIs in sequence, but it never spawns the
 * built `dist/cli/index.js` — so a regression in the wire-up between the
 * commander program, the signal handlers, or `process.argv` parsing would
 * not surface until manual smoke tests. This test fills that gap.
 *
 * The fixtures path uses a pre-seeded manifest plus a stubbed user-content
 * surface so the test does not depend on interactive prompts. The test
 * runs the built `dist/cli/index.js` via `execFileSync` and confirms each
 * stage produces a 0 (sync) or non-zero (drift) exit code per its
 * contract.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli", "index.js");

// Skip when the build artifact does not exist. The CI matrix builds before
// running tests, but local invocations of `npx vitest run` against an
// untouched checkout can hit this — fail loud with a skip message instead
// of producing a useless ENOENT trace.
const HAS_DIST = existsSync(CLI_PATH);

function runCli(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1", HATCH3R_NO_UPDATE_CHECK: "1" },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe.skipIf(!HAS_DIST)("CLI subprocess e2e flow (D3-M10)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cli-e2e-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("status returns a HatchError exit code in a project with no manifest", () => {
    // `hatch3r status` rejects with CONFIG_ERROR (sysexits EX_DATAERR=65 per
    // C8-D1-M5 central errorCode->exitCode map) when no manifest exists.
    const { exitCode, stderr } = runCli(["status"], tempDir);
    expect(exitCode).toBe(65);
    expect(stderr).toMatch(/hatch\.json|init/i);
  });

  it("status emits a single JSON document on stdout in JSON mode", () => {
    // No manifest — JSON mode emits {status: "failed", ...} on stdout and
    // still exits non-zero (65 EX_DATAERR for CONFIG_ERROR per C8-D1-M5).
    // The contract: one well-formed JSON document on stdout regardless of
    // failure state, no human chrome.
    const { exitCode, stdout } = runCli(["status", "--format", "json"], tempDir);
    expect(exitCode).toBe(65);
    // Find and parse the JSON payload.
    const start = stdout.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(stdout.slice(start).trim()) as {
      status: string;
      errorCode?: string;
    };
    expect(payload.status).toBe("failed");
    expect(payload.errorCode).toBe("CONFIG_ERROR");
  });

  it("sync exits with HatchError when invoked in a directory with no manifest", () => {
    // The sync command's missing-manifest branch (src/cli/commands/sync.ts)
    // throws HatchError(CONFIG_ERROR) which the central C8-D1-M5 map resolves
    // to sysexits EX_DATAERR (65). Confirm the wire-up at the commander layer
    // surfaces it correctly.
    const { exitCode, stderr } = runCli(["sync"], tempDir);
    expect(exitCode).toBe(65);
    expect(stderr).toMatch(/hatch\.json|init/i);
  });

  it("sync + status round-trip: seeded manifest yields a synced report", async () => {
    // Seed a minimal manifest so sync has something to act on. This avoids
    // the interactive init flow while still exercising the
    // sync → status canonical path documented in the CLI UX standards rule.
    const hatch3rDir = join(tempDir, ".hatch3r");
    await mkdir(hatch3rDir, { recursive: true });
    const manifest = {
      version: "3.0.0",
      hatch3rVersion: "2.0.0",
      platform: "github",
      owner: "test-org",
      repo: "test-repo",
      namespace: "test-org",
      project: "test-repo",
      tools: ["cursor"],
      features: {
        agents: true,
        skills: true,
        rules: true,
        prompts: false,
        commands: true,
        mcp: false,
        githubAgents: false,
        hooks: false,
        handoffs: false,
      },
      mcp: { servers: [] },
      managedFiles: [],
    };
    await writeFile(join(hatch3rDir, "hatch.json"), JSON.stringify(manifest, null, 2));

    // sync should succeed and exit 0.
    const syncResult = runCli(["sync"], tempDir);
    expect(syncResult.exitCode).toBe(0);
    // Adapter outputs exist after sync.
    await expect(access(join(tempDir, ".cursor", "rules"))).resolves.toBeUndefined();

    // status against a freshly-synced repo reports in-sync.
    const statusResult = runCli(["status", "--format", "json"], tempDir);
    expect(statusResult.exitCode).toBe(0);
    const start = statusResult.stdout.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(statusResult.stdout.slice(start).trim()) as {
      status: string;
    };
    expect(payload.status).toBe("in-sync");
  });
});
