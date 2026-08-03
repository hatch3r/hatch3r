import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { spawnSync } from "node:child_process";
import { HatchError } from "../../../types.js";
import { BACK } from "../../../cli/shared/initSteps.js";
import { mockPromptsByName } from "../inquirerMock.js";
import { surveyInstalls, type InstallLocation } from "../../../detect/installContext.js";
import { runSelfUpdate, pickReExecBin, type SelfUpdateResult } from "../../../install/selfUpdate.js";
import { readManifest } from "../../../manifest/hatchJson.js";
import { fetchLatestUpdateInfo } from "../../../cli/shared/updateNotifier.js";
import {
  maybeSelfUpdateBeforeInit,
  buildInitReExecArgv,
} from "../../../cli/shared/initUpdateCheck.js";

// Mock inquirer so the two confirm prompts can be driven deterministically
// (name-keyed via mockPromptsByName — the D3-SA3.2-12 anti-fragility helper).
vi.mock("inquirer", () => {
  class Separator {
    constructor(public readonly line: string) {}
  }
  return { default: { prompt: vi.fn(), Separator } };
});

// The helper's collaborators are unit-tested in their own suites
// (selfUpdate.test.ts, installContext.test.ts, updateNotifier.test.ts) —
// mock them here so this suite exercises ONLY the pre-flight decision logic.
vi.mock("../../../detect/installContext.js", () => ({
  surveyInstalls: vi.fn(),
}));
vi.mock("../../../install/selfUpdate.js", () => ({
  runSelfUpdate: vi.fn(),
  pickReExecBin: vi.fn(),
}));
vi.mock("../../../cli/shared/updateNotifier.js", () => ({
  fetchLatestUpdateInfo: vi.fn(),
}));
// F-SEC-02 (sec-2.8.6-p4): the versionConstraint pin gate reads the manifest.
vi.mock("../../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

function location(kind: InstallLocation["kind"], binPath = "/g/bin/hatch3r"): InstallLocation {
  return { kind, binPath, packageRoot: "/g/lib/node_modules/hatch3r", packageManager: "npm", version: "2.8.5" };
}

function survey(kind: InstallLocation["kind"]) {
  return { invokedFrom: location(kind), alsoPresent: [] };
}

function selfUpdateResult(updated: InstallLocation[]): SelfUpdateResult {
  return { updated, skipped: [], failed: [], survey: survey("global") };
}

const NEWER = { latest: "9.9.9", current: "2.8.5", type: "major", name: "hatch3r" } as const;

/** argv fixture: `[node, script, ...rest]` — the helper skips the first two. */
const argvOf = (...rest: string[]): string[] => ["/usr/bin/node", "/g/bin/hatch3r", ...rest];

describe("maybeSelfUpdateBeforeInit", () => {
  const originalEnv = { ...process.env };
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let savedStdinIsTTY: boolean | undefined;
  let savedStdoutIsTTY: boolean | undefined;

  /** Interactive defaults: every gate open, newer version available, global install. */
  function baseOpts(over: Partial<Parameters<typeof maybeSelfUpdateBeforeInit>[0]> = {}) {
    return { headless: false, resume: false, argv: argvOf("init"), ...over };
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear every environment skip-gate so tests opt INTO a gate explicitly.
    delete process.env.HATCH3R_RE_EXEC;
    delete process.env.HATCH3R_NO_UPDATE_CHECK;
    delete process.env.NO_UPDATE_NOTIFIER; // F-SEC-05 library-wide opt-out
    delete process.env.NODE_ENV; // vitest sets "test" — the gate under test
    delete process.env.CI;
    savedStdinIsTTY = process.stdin.isTTY;
    savedStdoutIsTTY = process.stdout.isTTY;
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    (process.stdout as { isTTY?: boolean }).isTTY = true;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
    vi.mocked(surveyInstalls).mockReset().mockResolvedValue(survey("global"));
    // F-SEC-02: default = no manifest on disk (fresh init) — no pin, check runs.
    vi.mocked(readManifest).mockReset().mockResolvedValue(null);
    vi.mocked(fetchLatestUpdateInfo).mockReset().mockResolvedValue({ ...NEWER });
    vi.mocked(runSelfUpdate).mockReset().mockResolvedValue(selfUpdateResult([location("global")]));
    vi.mocked(pickReExecBin).mockReset().mockReturnValue("/g/bin/hatch3r");
    vi.mocked(spawnSync).mockReset().mockReturnValue({
      pid: 1, output: [], stdout: Buffer.from(""), stderr: Buffer.from(""),
      status: 0, signal: null,
    } as never);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    (process.stdin as { isTTY?: boolean }).isTTY = savedStdinIsTTY;
    (process.stdout as { isTTY?: boolean }).isTTY = savedStdoutIsTTY;
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /** A fully-silent skip: no manifest read, no survey subprocess, no registry probe, no prompt. */
  async function expectSilentSkip(opts = baseOpts()) {
    await expect(maybeSelfUpdateBeforeInit(opts)).resolves.toBeUndefined();
    expect(readManifest).not.toHaveBeenCalled();
    expect(surveyInstalls).not.toHaveBeenCalled();
    expect(fetchLatestUpdateInfo).not.toHaveBeenCalled();
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(runSelfUpdate).not.toHaveBeenCalled();
  }

  describe("skip matrix (all silent, zero network/subprocess)", () => {
    it("skips as a re-exec child (HATCH3R_RE_EXEC=1) — no infinite relaunch loop", async () => {
      process.env.HATCH3R_RE_EXEC = "1";
      await expectSilentSkip();
    });

    it("skips under the HATCH3R_NO_UPDATE_CHECK=1 opt-out (the --no-update-check strip)", async () => {
      process.env.HATCH3R_NO_UPDATE_CHECK = "1";
      await expectSilentSkip();
    });

    it("skips under NODE_ENV=test", async () => {
      process.env.NODE_ENV = "test";
      await expectSilentSkip();
    });

    it("skips in CI (CI env truthy)", async () => {
      process.env.CI = "true";
      await expectSilentSkip();
    });

    it("skips on a headless run (--yes/--quick/--default collapse to headless)", async () => {
      await expectSilentSkip(baseOpts({ headless: true }));
    });

    it("skips on --resume (a mid-checkpoint binary swap would invalidate the baseline)", async () => {
      await expectSilentSkip(baseOpts({ resume: true }));
    });

    // F-SEC-03 (sec-2.8.6-p4): dry-run promises zero mutations, but an
    // accepted update npm-installs globally and re-execs — both real side
    // effects. TTY is open in baseOpts, so this isolates the dryRun gate.
    it("skips on --dry-run even on a full TTY (no install, no re-exec)", async () => {
      await expectSilentSkip(baseOpts({ dryRun: true }));
      expect(spawnSync).not.toHaveBeenCalled();
    });

    // F-SEC-05 (sec-2.8.6-p4): the update-notifier library-wide opt-outs bind
    // the active probe exactly like the passive banner — env and argv forms.
    it("skips under the NO_UPDATE_NOTIFIER env opt-out", async () => {
      process.env.NO_UPDATE_NOTIFIER = "1";
      await expectSilentSkip();
    });

    // N-2 (sec-2.8.6-p4-v2): PRESENCE semantics, matching update-notifier's
    // own check — an EMPTY value still opts out.
    it("skips when NO_UPDATE_NOTIFIER is present but empty (presence check, not truthiness)", async () => {
      process.env.NO_UPDATE_NOTIFIER = "";
      await expectSilentSkip();
    });

    it("skips when --no-update-notifier is present in the effective argv", async () => {
      await expectSilentSkip(baseOpts({ argv: argvOf("init", "--no-update-notifier") }));
    });

    it("skips when stdin is not a TTY", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      await expectSilentSkip();
    });

    it("skips when stdout is not a TTY", async () => {
      (process.stdout as { isTTY?: boolean }).isTTY = false;
      await expectSilentSkip();
    });

    it("skips a dev-source checkout without probing the registry", async () => {
      vi.mocked(surveyInstalls).mockResolvedValue(survey("dev-source"));
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(fetchLatestUpdateInfo).not.toHaveBeenCalled();
      expect(inquirer.prompt).not.toHaveBeenCalled();
    });

    it("fails open (one warning, no prompt) when the install survey itself throws", async () => {
      vi.mocked(surveyInstalls).mockRejectedValue(new Error("npm prefix unreadable"));
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(fetchLatestUpdateInfo).not.toHaveBeenCalled();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      const stderrText = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderrText).toContain("npm prefix unreadable");
    });
  });

  describe("registry probe outcomes (fail-open)", () => {
    it("proceeds silently when already up to date (type === \"latest\")", async () => {
      vi.mocked(fetchLatestUpdateInfo).mockResolvedValue({
        latest: "2.8.5", current: "2.8.5", type: "latest", name: "hatch3r",
      });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
    });

    it("proceeds silently when the probe times out or errors (null)", async () => {
      vi.mocked(fetchLatestUpdateInfo).mockResolvedValue(null);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
    });
  });

  // F-SEC-01 (sec-2.8.6-p4): update-notifier `type` is a direction-agnostic
  // semverDiff — non-"latest" in BOTH directions. Without the strict
  // `semverGt(latest, current)` guard, a running version AHEAD of the
  // registry (prerelease build, or a dist-tag rolled back to an old signed
  // release) would get a default-Yes DOWNGRADE prompt.
  describe("downgrade guard (F-SEC-01)", () => {
    it("never prompts when the running version is AHEAD of registry latest (no downgrade offer)", async () => {
      vi.mocked(fetchLatestUpdateInfo).mockResolvedValue({
        latest: "2.8.6", current: "2.9.0-rc.1", type: "prerelease", name: "hatch3r",
      });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("proceeds silently when current === latest but `type` carries an unexpected value", async () => {
      vi.mocked(fetchLatestUpdateInfo).mockResolvedValue({
        latest: "2.8.5", current: "2.8.5", type: "build", name: "hatch3r",
      });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
    });

    it("fails open (no prompt) on a malformed registry version instead of throwing", async () => {
      vi.mocked(fetchLatestUpdateInfo).mockResolvedValue({
        latest: "not-a-version", current: "2.8.5", type: "major", name: "hatch3r",
      });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
    });
  });

  // F-SEC-02 (sec-2.8.6-p4): a manifest `versionConstraint` pin (the
  // `hatch3r update --pin-version` dist-tag-rollback defense) means "do not
  // move" — the pre-flight skips outright instead of probing `latest`.
  describe("versionConstraint pin (F-SEC-02)", () => {
    it("skips the pre-flight entirely when the manifest carries a versionConstraint (no probe, no prompt)", async () => {
      vi.mocked(readManifest).mockResolvedValue({ versionConstraint: "2.8.5" } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(surveyInstalls).not.toHaveBeenCalled();
      expect(fetchLatestUpdateInfo).not.toHaveBeenCalled();
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("proceeds normally when no manifest exists (fresh init)", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);
      mockPromptsByName({ updateHatch3r: false });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(fetchLatestUpdateInfo).toHaveBeenCalledTimes(1);
      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    });

    it("treats an unreadable/malformed manifest as no-pin and proceeds (catch → null)", async () => {
      vi.mocked(readManifest).mockRejectedValue(new HatchError("Malformed JSON", undefined, "CONFIG_ERROR"));
      mockPromptsByName({ updateHatch3r: false });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(fetchLatestUpdateInfo).toHaveBeenCalledTimes(1);
      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    });
  });

  describe("update confirm", () => {
    it("asks ONE confirm naming both versions and the consequence, default Yes", async () => {
      mockPromptsByName({ updateHatch3r: false });
      await maybeSelfUpdateBeforeInit(baseOpts());
      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
      const questions = vi.mocked(inquirer.prompt).mock.calls[0]?.[0] as Array<{
        type: string; name: string; message: string; default?: boolean;
      }>;
      expect(questions[0].type).toBe("confirm");
      expect(questions[0].name).toBe("updateHatch3r");
      expect(questions[0].message).toContain("9.9.9");
      expect(questions[0].message).toContain("2.8.5");
      expect(questions[0].message).toMatch(/current content/);
      expect(questions[0].default).toBe(true);
    });

    it("decline → proceeds with the current version, no self-update, no nagging", async () => {
      mockPromptsByName({ updateHatch3r: false });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("Shift+Tab (BACK) on the first prompt behaves like a decline", async () => {
      mockPromptsByName({ updateHatch3r: BACK });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(runSelfUpdate).not.toHaveBeenCalled();
    });
  });

  describe("accept on a global/project-local install (self-update + re-exec)", () => {
    beforeEach(() => {
      mockPromptsByName({ updateHatch3r: true });
    });

    it("runs runSelfUpdate then re-execs the invoked command with original flags + --no-banner + HATCH3R_RE_EXEC=1, adopting the child's exit code", async () => {
      const opts = baseOpts({ argv: argvOf("init", "--tools", "claude") });
      await expect(maybeSelfUpdateBeforeInit(opts)).rejects.toThrow("process.exit:0");
      expect(runSelfUpdate).toHaveBeenCalledTimes(1);
      expect(spawnSync).toHaveBeenCalledTimes(1);
      const [bin, args, spawnOpts] = vi.mocked(spawnSync).mock.calls[0] as unknown as [
        string, string[], { stdio: string; env: Record<string, string> },
      ];
      expect(bin).toBe("/g/bin/hatch3r");
      expect(args).toEqual(["init", "--tools", "claude", "--no-banner"]);
      expect(spawnOpts.stdio).toBe("inherit");
      expect(spawnOpts.env.HATCH3R_RE_EXEC).toBe("1");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("propagates a non-zero child status", async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 3, signal: null } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).rejects.toThrow("process.exit:3");
    });

    it("translates a signal-terminated child to the POSIX 128+signal code (SIGINT → 130)", async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: null, signal: "SIGINT" } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).rejects.toThrow("process.exit:130");
    });

    // CQ5-4 (test-2.8.6-p4): the remaining signalExitCode arms.
    it("translates SIGTERM to 143", async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: null, signal: "SIGTERM" } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).rejects.toThrow("process.exit:143");
    });

    it("translates any other signal to the generic 1", async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: null, signal: "SIGHUP" } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).rejects.toThrow("process.exit:1");
    });

    it("fails open (warn + proceed) when the relaunch spawn itself errors", async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: null, signal: null, error: new Error("spawn ENOENT"),
      } as never);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
      const stderrText = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderrText).toContain("spawn ENOENT");
    });

    it("fails open (one warning + proceed with current) when the self-update throws", async () => {
      vi.mocked(runSelfUpdate).mockRejectedValue(
        new HatchError("registry unreachable", 1, "NETWORK_ERROR"),
      );
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(spawnSync).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const stderrText = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderrText).toContain("registry unreachable");
      expect(stderrText).toMatch(/continuing init/i);
    });

    // review-2.8.6-r1 F1: INTEGRITY_ERROR is the one failure class that does
    // NOT fail open — `runSelfUpdate` throws it AFTER npm replaced the package
    // on disk, so proceeding would leave an unverified install behind.
    it("hard-stops (INTEGRITY_ERROR, exit 73, no re-exec) when the installed package fails signature verification", async () => {
      vi.mocked(runSelfUpdate).mockRejectedValue(
        new HatchError("sig fail", 1, "INTEGRITY_ERROR"),
      );
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).rejects.toMatchObject({
        errorCode: "INTEGRITY_ERROR",
        // Re-thrown WITHOUT the original explicit exitCode 1: the wrapper omits
        // exitCode so ERROR_CODE_TO_EXIT_CODE maps INTEGRITY_ERROR → 73.
        exitCode: 73,
      });
      expect(spawnSync).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("the INTEGRITY_ERROR hard stop names the global rollback pin and the explicit-override path", async () => {
      vi.mocked(runSelfUpdate).mockRejectedValue(
        new HatchError("sig fail", 1, "INTEGRITY_ERROR"),
      );
      const err = await maybeSelfUpdateBeforeInit(baseOpts()).catch((e) => e as HatchError);
      expect(err).toBeInstanceOf(HatchError);
      // Rollback pin uses the ACTUAL fetched current version + the global form
      // (the mocked survey reports a global install).
      expect((err as HatchError).recoveryHint).toContain("npm install -g hatch3r@2.8.5");
      expect((err as HatchError).recoveryHint).toContain("hatch3r update --skip-audit-signatures");
      expect((err as HatchError).cause).toBeInstanceOf(HatchError);
    });

    it("the INTEGRITY_ERROR rollback pin drops -g for a project-local install", async () => {
      vi.mocked(surveyInstalls).mockResolvedValue(survey("project-local"));
      vi.mocked(runSelfUpdate).mockRejectedValue(
        new HatchError("sig fail", 1, "INTEGRITY_ERROR"),
      );
      const err = await maybeSelfUpdateBeforeInit(baseOpts()).catch((e) => e as HatchError);
      expect((err as HatchError).recoveryHint).toContain("npm install hatch3r@2.8.5");
      expect((err as HatchError).recoveryHint).not.toContain("npm install -g");
    });

    it("proceeds without a re-exec when nothing was actually updated (pickReExecBin null — e.g. the Windows shim skip)", async () => {
      vi.mocked(pickReExecBin).mockReturnValue(null);
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("uses a caller-supplied reExecArgv override VERBATIM (the setup chain's `setup .` shape)", async () => {
      const opts = baseOpts({
        argv: argvOf("setup", "myproj", "--tools", "claude"),
        reExecArgv: ["setup", ".", "--tools", "claude"],
      });
      await expect(maybeSelfUpdateBeforeInit(opts)).rejects.toThrow("process.exit:0");
      const args = vi.mocked(spawnSync).mock.calls[0]?.[1];
      // Verbatim: no positional replay of "myproj", no --no-banner append
      // (setup does not register the flag — the child banner is suppressed by
      // the HATCH3R_RE_EXEC guard in init.ts instead).
      expect(args).toEqual(["setup", ".", "--tools", "claude"]);
    });
  });

  describe("accept on an npx install (read-only cache)", () => {
    beforeEach(() => {
      vi.mocked(surveyInstalls).mockResolvedValue(survey("npx"));
    });

    it("prints the `npx hatch3r@latest <command>` advisory and continues with current on confirm (default Yes)", async () => {
      mockPromptsByName({ updateHatch3r: true, continueWithCurrent: true });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
      const stdoutText = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stdoutText).toContain("npx hatch3r@latest init");
      // Continue-confirm carries default true (the fail-open default).
      const continueQ = (vi.mocked(inquirer.prompt).mock.calls[1]?.[0] as unknown as Array<{
        name: string; default?: boolean;
      }>)[0];
      expect(continueQ.name).toBe("continueWithCurrent");
      expect(continueQ.default).toBe(true);
    });

    it("cancels cleanly (HatchError exit 0) when the user declines to continue with the stale version", async () => {
      mockPromptsByName({ updateHatch3r: true, continueWithCurrent: false });
      try {
        await maybeSelfUpdateBeforeInit(baseOpts());
        throw new Error("expected a clean-cancel HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).exitCode).toBe(0);
        expect((e as HatchError).message).toContain("cancelled");
      }
    });

    it("BACK on the continue-confirm proceeds with the current version (fail-open default)", async () => {
      mockPromptsByName({ updateHatch3r: true, continueWithCurrent: BACK });
      await expect(maybeSelfUpdateBeforeInit(baseOpts())).resolves.toBeUndefined();
    });
  });
});

describe("buildInitReExecArgv", () => {
  const argv = (...rest: string[]): string[] => ["/usr/bin/node", "/g/bin/hatch3r", ...rest];

  it("puts the invoked command first, preserves every flag, appends --no-banner for init", () => {
    expect(buildInitReExecArgv(argv("init", "--tools", "claude", "--preset", "minimal"))).toEqual([
      "init", "--tools", "claude", "--preset", "minimal", "--no-banner",
    ]);
  });

  it("keeps a leading global flag (the D1-8 shape) while still resolving the command", () => {
    expect(buildInitReExecArgv(argv("--verbose", "init"))).toEqual(["init", "--verbose", "--no-banner"]);
  });

  it("does not duplicate an existing --no-banner", () => {
    expect(buildInitReExecArgv(argv("init", "--no-banner"))).toEqual(["init", "--no-banner"]);
  });

  it("does not append --no-banner for a non-init command (setup lacks the flag registration)", () => {
    expect(buildInitReExecArgv(argv("setup", "proj", "--yes"))).toEqual(["setup", "proj", "--yes"]);
  });

  it("defaults to `init` when argv carries no positional command", () => {
    expect(buildInitReExecArgv(argv())).toEqual(["init", "--no-banner"]);
  });
});
