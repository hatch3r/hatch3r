import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../../../dist/cli/index.js");

// D3-2: this suite is the only assertion of the "Battle-tested" help banner
// and the unknown-command / agent-command redirects, but it can only run
// against the built `dist/cli/index.js`. `scripts.test` is a bare `vitest run`
// with no `pretest` build, so on a fresh clone the artifact is absent and the
// hard-coded path produced an opaque ENOENT (red on fresh clone). Guard with
// the same `existsSync` + `describe.skipIf(!HAS_DIST)` pattern as the e2e
// subprocess suite (src/__tests__/e2e/cliFlow.test.ts:30): the CI matrix builds
// before testing, so the assertions still run in CI; local `npx vitest run`
// against an untouched checkout skips cleanly with an actionable message
// instead of failing.
const HAS_DIST = existsSync(CLI_PATH);
if (!HAS_DIST) {
  console.warn(
    `[entrypoint.test] Skipping CLI entry-point subprocess tests: ${CLI_PATH} not found. Run "npm run build" first to enable them.`,
  );
}

/**
 * Helper to run the CLI as a subprocess and capture output.
 * Returns { stdout, stderr, exitCode }.
 */
function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
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

describe.skipIf(!HAS_DIST)("CLI entry point (src/cli/index.ts)", () => {
  describe("--help", () => {
    it("displays program name and description", () => {
      const { stdout, exitCode } = runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("hatch3r");
      expect(stdout).toContain("Battle-tested");
    });

    it("lists core registered commands", () => {
      const { stdout } = runCli(["--help"]);
      const expectedCommands = [
        "init",
        "sync",
        "status",
        "update",
        "validate",
        "verify",
        "config",
        "add",
        "worktree-setup",
      ];
      for (const cmd of expectedCommands) {
        expect(stdout).toContain(cmd);
      }
    });

    it("shows version option in help", () => {
      const { stdout } = runCli(["--help"]);
      expect(stdout).toMatch(/-V|--version/);
    });
  });

  describe("--version", () => {
    it("prints a semver-like version string", () => {
      const { stdout, exitCode } = runCli(["--version"]);
      expect(exitCode).toBe(0);
      // Version should match semver pattern (e.g. 1.5.0, 1.5.0-beta.1)
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("unknown command handling", () => {
    // D12-8 (Cycle 11 Wave 3, P1): unknown commands are a USAGE error, so they
    // exit 2 (not 1) to honor the cli-ux-standards contract (0 ok / 1 unexpected
    // / 2 usage) and match the unknown-option path (commander → exitOverride →
    // CommanderError → index.ts exit 2).
    it("exits with code 2 for unknown commands", () => {
      const { exitCode, stderr } = runCli(["nonexistent-command"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("Unknown command");
      expect(stderr).toContain("--help");
    });

    it("exits with code 2 for an unknown option (same usage class as unknown command)", () => {
      // `status` is a real command; the bogus flag is the usage error. This
      // proves the unknown-OPTION and unknown-COMMAND paths share exit 2.
      const { exitCode, stderr } = runCli(["status", "--definitely-not-a-flag"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("--definitely-not-a-flag");
    });

    it("redirects agent commands with helpful message and exit code 2", () => {
      const { exitCode, stderr } = runCli(["workflow"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("agent command");
      expect(stderr).toContain("AI editor");
    });

    it("mentions the specific agent command name in the error", () => {
      const { stderr } = runCli(["debug"]);
      expect(stderr).toContain("debug");
      expect(stderr).toContain("/debug");
    });
  });
});
