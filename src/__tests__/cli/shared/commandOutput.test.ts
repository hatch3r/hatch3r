/**
 * Unit coverage for the standardized command begin/end lifecycle
 * (`src/cli/shared/commandOutput.ts`), Wave 5 slice W5s1-commandOutput.
 *
 * Contract under test:
 *   - beginCommand: resetUiState fires first, `--format`/legacy `--json`
 *     resolution, json-on-interactive without `--yes` is a usage error
 *     (exit 2 + actionable hint), banner gating, quiet/verbose wiring.
 *   - finishCommand: human mode renders box + next steps + timing via ui.ts;
 *     json mode emits exactly one JSON document with the
 *     `status/command/hatch3rVersion/timestamp` envelope and spreads
 *     `outcome.json` — never both channels for one outcome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the ui chrome before imports (same pattern as clean.test.ts) ──

vi.mock("../../../cli/shared/ui.js", () => ({
  resetUiState: vi.fn(),
  setJson: vi.fn(),
  setQuiet: vi.fn(),
  setVerbose: vi.fn(),
  printBanner: vi.fn(),
  printBox: vi.fn(),
  printNextSteps: vi.fn(),
  printTimingSummary: vi.fn(),
}));

import {
  resetUiState,
  setJson,
  setQuiet,
  setVerbose,
  printBanner,
  printBox,
  printNextSteps,
  printTimingSummary,
} from "../../../cli/shared/ui.js";
import { HatchError } from "../../../types.js";
import { HATCH3R_VERSION } from "../../../version.js";

// ── Module under test ──────────────────────────────────────────

import {
  beginCommand,
  finishCommand,
  type CommandOutcome,
} from "../../../cli/shared/commandOutput.js";

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
});

/** Collect every stdout write as a single string. */
function stdoutText(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

// ── beginCommand ───────────────────────────────────────────────

describe("beginCommand() — format resolution", () => {
  it("returns 'human' with no flags", () => {
    expect(beginCommand({})).toBe("human");
  });

  it("returns 'json' for --format json", () => {
    expect(beginCommand({ format: "json" })).toBe("json");
  });

  it("maps the legacy --json boolean to the json format (init back-compat)", () => {
    expect(beginCommand({ json: true })).toBe("json");
  });

  it("legacy --json upgrades even when --format resolves to human", () => {
    expect(beginCommand({ format: "human", json: true })).toBe("json");
  });

  it("propagates the D10-22 usage error for an invalid --format value", () => {
    expect(() => beginCommand({ format: "jsom" })).toThrow(HatchError);
  });
});

describe("beginCommand() — json-on-interactive gate", () => {
  it("throws a HatchError when interactive && json && no --yes", () => {
    expect(() => beginCommand({ format: "json" }, { interactive: true })).toThrow(
      HatchError,
    );
  });

  it("carries usage exit code 2 and the actionable hint", () => {
    try {
      beginCommand({ format: "json" }, { interactive: true });
      expect.unreachable("beginCommand should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HatchError);
      const hatchErr = err as HatchError;
      expect(hatchErr.exitCode).toBe(2);
      expect(hatchErr.errorCode).toBe("VALIDATION_ERROR");
      expect(hatchErr.recoveryHint).toBe(
        "Add --yes (or use the scalar form, e.g. `hatch3r config get <key>`), or drop --format json.",
      );
    }
  });

  it("does not mutate ui flags before throwing", () => {
    expect(() => beginCommand({ format: "json" }, { interactive: true })).toThrow();
    expect(vi.mocked(setJson)).not.toHaveBeenCalled();
    expect(vi.mocked(setQuiet)).not.toHaveBeenCalled();
    expect(vi.mocked(setVerbose)).not.toHaveBeenCalled();
  });

  it("allows json on an interactive command when --yes is set", () => {
    expect(beginCommand({ format: "json", yes: true }, { interactive: true })).toBe(
      "json",
    );
  });

  it("allows json on a non-interactive command without --yes", () => {
    expect(beginCommand({ format: "json" }, { interactive: false })).toBe("json");
  });
});

describe("beginCommand() — ui wiring", () => {
  it("invokes resetUiState exactly once, before the format flags are set", () => {
    beginCommand({ format: "json" });
    expect(vi.mocked(resetUiState)).toHaveBeenCalledTimes(1);
    const resetOrder = vi.mocked(resetUiState).mock.invocationCallOrder[0]!;
    const setJsonOrder = vi.mocked(setJson).mock.invocationCallOrder[0]!;
    expect(resetOrder).toBeLessThan(setJsonOrder);
  });

  it("sets json mode on for json format and off for human format", () => {
    beginCommand({ format: "json" });
    expect(vi.mocked(setJson)).toHaveBeenLastCalledWith(true);
    beginCommand({});
    expect(vi.mocked(setJson)).toHaveBeenLastCalledWith(false);
  });

  it("wires --quiet through setQuiet(true) and never calls setQuiet(false)", () => {
    beginCommand({ quiet: true });
    expect(vi.mocked(setQuiet)).toHaveBeenCalledWith(true);
    beginCommand({});
    expect(vi.mocked(setQuiet)).not.toHaveBeenCalledWith(false);
  });

  it("wires --verbose through setVerbose(true) only when set", () => {
    beginCommand({ verbose: true });
    expect(vi.mocked(setVerbose)).toHaveBeenCalledWith(true);
    vi.mocked(setVerbose).mockClear();
    beginCommand({});
    expect(vi.mocked(setVerbose)).not.toHaveBeenCalled();
  });
});

describe("beginCommand() — banner gating", () => {
  it("prints the compact banner in human mode", () => {
    beginCommand({}, { banner: "compact" });
    expect(vi.mocked(printBanner)).toHaveBeenCalledWith(true);
  });

  it("prints the full banner in human mode", () => {
    beginCommand({}, { banner: "full" });
    expect(vi.mocked(printBanner)).toHaveBeenCalledWith(false);
  });

  it("suppresses the banner in json mode", () => {
    beginCommand({ format: "json" }, { banner: "full" });
    expect(vi.mocked(printBanner)).not.toHaveBeenCalled();
  });

  it("prints no banner by default or for banner: 'none'", () => {
    beginCommand({});
    beginCommand({}, { banner: "none" });
    expect(vi.mocked(printBanner)).not.toHaveBeenCalled();
  });
});

// ── finishCommand ──────────────────────────────────────────────

function makeOutcome(overrides: Partial<CommandOutcome> = {}): CommandOutcome {
  return {
    command: "sync",
    title: "Sync complete",
    lines: ["3 files updated"],
    ...overrides,
  };
}

describe("finishCommand() — human mode", () => {
  it("prints the outcome box verbatim with the default success style", () => {
    finishCommand("human", makeOutcome());
    expect(vi.mocked(printBox)).toHaveBeenCalledWith(
      "Sync complete",
      ["3 files updated"],
      "success",
    );
  });

  it("passes an explicit style through to the box", () => {
    finishCommand("human", makeOutcome({ style: "warning" }));
    expect(vi.mocked(printBox)).toHaveBeenCalledWith(
      "Sync complete",
      ["3 files updated"],
      "warning",
    );
  });

  it("prints next steps when provided, skips when absent or empty", () => {
    finishCommand("human", makeOutcome({ nextSteps: ["Run `hatch3r status`"] }));
    expect(vi.mocked(printNextSteps)).toHaveBeenCalledWith(["Run `hatch3r status`"]);
    vi.mocked(printNextSteps).mockClear();
    finishCommand("human", makeOutcome());
    finishCommand("human", makeOutcome({ nextSteps: [] }));
    expect(vi.mocked(printNextSteps)).not.toHaveBeenCalled();
  });

  it("prints the timing summary only when startMs is present", () => {
    const startMs = Date.now() - 1500;
    finishCommand("human", makeOutcome({ startMs }));
    expect(vi.mocked(printTimingSummary)).toHaveBeenCalledWith(startMs);
    vi.mocked(printTimingSummary).mockClear();
    finishCommand("human", makeOutcome());
    expect(vi.mocked(printTimingSummary)).not.toHaveBeenCalled();
  });

  it("emits no JSON document on stdout (box-vs-json exclusivity)", () => {
    finishCommand("human", makeOutcome());
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe("finishCommand() — json mode", () => {
  it("emits exactly one JSON document with the envelope keys", () => {
    finishCommand("json", makeOutcome());
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = stdoutText();
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.status).toBe("passed");
    expect(parsed.command).toBe("sync");
    expect(parsed.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(typeof parsed.timestamp).toBe("string");
    expect(parsed.timestamp).not.toBe("");
  });

  it("spreads outcome.json into the envelope", () => {
    finishCommand(
      "json",
      makeOutcome({ json: { filesWritten: 3, adapters: ["claude"] } }),
    );
    const parsed = JSON.parse(stdoutText()) as Record<string, unknown>;
    expect(parsed.filesWritten).toBe(3);
    expect(parsed.adapters).toEqual(["claude"]);
  });

  it("derives status from style: info→ok, warning→partial, error→failed", () => {
    for (const [style, status] of [
      ["info", "ok"],
      ["warning", "partial"],
      ["error", "failed"],
    ] as const) {
      stdoutSpy.mockClear();
      finishCommand("json", makeOutcome({ style }));
      expect((JSON.parse(stdoutText()) as Record<string, unknown>).status).toBe(status);
    }
  });

  it("lets outcome.json.status override the style-derived status", () => {
    finishCommand("json", makeOutcome({ style: "success", json: { status: "drifted" } }));
    expect((JSON.parse(stdoutText()) as Record<string, unknown>).status).toBe("drifted");
  });

  it("does not let outcome.json clobber command, hatch3rVersion, or timestamp", () => {
    finishCommand(
      "json",
      makeOutcome({
        json: { command: "forged", hatch3rVersion: "0.0.0", timestamp: "forged" },
      }),
    );
    const parsed = JSON.parse(stdoutText()) as Record<string, unknown>;
    // `command` sits AFTER the outcome.json spread (status is the only
    // documented override), so the envelope's identity field always wins.
    expect(parsed.command).toBe("sync");
    expect(parsed.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(parsed.timestamp).not.toBe("forged");
  });

  it("renders no decorated chrome (box-vs-json exclusivity)", () => {
    finishCommand(
      "json",
      makeOutcome({ nextSteps: ["Run `hatch3r status`"], startMs: Date.now() }),
    );
    expect(vi.mocked(printBox)).not.toHaveBeenCalled();
    expect(vi.mocked(printNextSteps)).not.toHaveBeenCalled();
    expect(vi.mocked(printTimingSummary)).not.toHaveBeenCalled();
  });
});
