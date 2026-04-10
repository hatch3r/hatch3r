import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../../../dist/cli/index.js");

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

describe("CLI entry point (src/cli/index.ts)", () => {
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
    it("exits with code 1 for unknown commands", () => {
      const { exitCode, stderr } = runCli(["nonexistent-command"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unknown command");
      expect(stderr).toContain("--help");
    });

    it("redirects agent commands with helpful message", () => {
      const { exitCode, stderr } = runCli(["workflow"]);
      expect(exitCode).toBe(1);
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
