import { describe, it, expect } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { PROGRAM_DESCRIPTION } from "../../cli/program.js";

const CLI_PATH = resolve(import.meta.dirname, "../../../dist/cli/index.js");

// D3-2 / D3-SA3.2-09: this suite asserts the program's `--help` banner (against
// the exported PROGRAM_DESCRIPTION constant — no longer the hard-coded
// "Battle-tested" marketing phrase, which coupled the suite to unevidenced copy)
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
      // D3-SA3.2-09: assert the description via the exported constant (single
      // source of truth) rather than a hard-coded marketing phrase. Whitespace
      // is normalized because commander wraps the description to the help width.
      expect(stdout.replace(/\s+/g, " ")).toContain(PROGRAM_DESCRIPTION);
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

  // ── D3-12 (Cycle 11 Wave 3): POSIX signal → exit-code contract ───────────────
  //
  // src/cli/index.ts maps SIGINT→130, SIGTERM→143, SIGHUP→129 via
  // SIGNAL_EXIT_CODES, registered at module top. Before this wave only SIGINT=130
  // was covered (errors.test.ts asserts 130 through formatActionableError, which
  // never produces 143/129), so the SIGTERM=143 and SIGHUP=129 branches — the
  // container/CI/SSH-disconnect shutdown signals cli-ux-standards.md mandates —
  // had zero coverage. These subprocess cases launch a long-parking command
  // (interactive `init` in an empty temp dir, blocking on piped stdin), send the
  // signal, and assert the child exits with 128 + signal number.
  //
  // SIGTERM/SIGHUP delivery to a child and the 128+n convention are POSIX, so
  // these run on the unix CI legs; on win32 (which lacks real POSIX signals and
  // synthesizes termination) they are skipped.
  describe.skipIf(process.platform === "win32")("signal exit codes (D3-12)", () => {
    /**
     * Spawn the CLI on a parking command, wait until it has emitted output
     * (prompt rendered → signal handler installed and event loop live), send
     * the signal, and resolve with the observed exit code. Falls back to a
     * timer if no output appears so the test cannot hang.
     */
    function runUntilSignal(
      signal: NodeJS.Signals,
    ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
      const cwd = mkdtempSync(join(tmpdir(), "hatch3r-signal-test-"));
      return new Promise((resolvePromise) => {
        const child = spawn("node", [CLI_PATH, "init"], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, NODE_NO_WARNINGS: "1", HATCH3R_NO_UPDATE_CHECK: "1" },
        });

        let signalled = false;
        const sendSignal = (): void => {
          if (signalled) return;
          signalled = true;
          child.kill(signal);
        };
        // Fire on first output (the prompt) — handler is registered
        // synchronously at module top, so it is always present by the time any
        // byte is written. Fallback timer guards the no-output case.
        child.stdout.on("data", () => setTimeout(sendSignal, 50));
        child.stderr.on("data", () => setTimeout(sendSignal, 50));
        const fallback = setTimeout(sendSignal, 2_000);

        child.on("close", (code, sig) => {
          clearTimeout(fallback);
          rmSync(cwd, { recursive: true, force: true });
          resolvePromise({ code, signal: sig });
        });
      });
    }

    it("exits 143 on SIGTERM", async () => {
      const { code } = await runUntilSignal("SIGTERM");
      expect(code).toBe(143);
    }, 15_000);

    it("exits 129 on SIGHUP", async () => {
      const { code } = await runUntilSignal("SIGHUP");
      expect(code).toBe(129);
    }, 15_000);
  });
});
