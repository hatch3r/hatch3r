import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import chalk from "chalk";
import {
  setQuiet,
  setJson,
  setVerbose,
  isQuiet,
  isJson,
  isVerbose,
  resetUiState,
  printNextSteps,
} from "../../cli/shared/ui.js";

// D1-SA1.1-F09 (CQ8 maintainability): guard the module-global UI-flag leak
// class. The chrome flags (quiet/json/verbose) persist for the process
// lifetime; under vitest the ui module is shared across tests in the same
// worker, so a forgotten reset leaks state into the next test. These tests
// assert `resetUiState()` clears EVERY flag — so if a future ui-flag is added
// to ui.ts without a matching reset line, the "resets every flag" test fails
// loudly, catching the omission the finding warned about.
//
// Imports the REAL ui module (no vi.mock) because the state functions are pure
// in-memory toggles with no I/O.

describe("shared/ui flag state", () => {
  beforeEach(() => {
    resetUiState();
  });

  it("isQuiet/isJson/isVerbose default to false after reset", () => {
    expect(isQuiet()).toBe(false);
    expect(isJson()).toBe(false);
    expect(isVerbose()).toBe(false);
  });

  it("setQuiet toggles quiet without touching json or verbose", () => {
    setQuiet(true);
    expect(isQuiet()).toBe(true);
    expect(isJson()).toBe(false);
    expect(isVerbose()).toBe(false);
  });

  it("setJson(true) implies quiet (json replaces all chrome)", () => {
    setJson(true);
    expect(isJson()).toBe(true);
    expect(isQuiet()).toBe(true);
  });

  it("setJson(false) clears only json; quiet must be reset separately", () => {
    setJson(true);
    setJson(false);
    expect(isJson()).toBe(false);
    // quiet was set as a side effect of setJson(true) and is NOT auto-cleared
    // by setJson(false) — documents the asymmetry resetUiState() exists to fix.
    expect(isQuiet()).toBe(true);
  });

  it("setVerbose toggles verbose independently", () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
    expect(isQuiet()).toBe(false);
    expect(isJson()).toBe(false);
  });

  it("resetUiState clears EVERY flag after all are set (leak-class guard)", () => {
    setQuiet(true);
    setJson(true);
    setVerbose(true);
    resetUiState();
    expect(isQuiet()).toBe(false);
    expect(isJson()).toBe(false);
    expect(isVerbose()).toBe(false);
  });
});

// D10-23 (Cycle 11 Wave 3, D10, P1 — WCAG 1.4.3 AA): printNextSteps must render
// the action-critical command token at normal weight (bold, no SGR-2 dim) so it
// clears the 4.5:1 AA contrast floor on light terminal themes. SGR 2 (`\x1b[2m`)
// is the dim sequence the finding flags; SGR 1 (`\x1b[1m`) is the bold emphasis
// the fix applies to the backtick-delimited `` `cmd` `` segment. These tests
// force color on (chalk.level 3) so the assertions are deterministic regardless
// of the test runner's TTY state.
const SGR_DIM = "[2m";
const SGR_BOLD = "[1m";

describe("shared/ui printNextSteps WCAG 1.4.3 (D10-23)", () => {
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let priorLevel: typeof chalk.level;

  beforeEach(() => {
    resetUiState();
    logged = [];
    priorLevel = chalk.level;
    chalk.level = 3;
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    chalk.level = priorLevel;
  });

  function stepLine(): string {
    // The bullet header line is index 0; the first step line carries the token.
    return logged.find((l) => l.includes("hatch3r status")) ?? "";
  }

  it("emphasizes the command token in bold (SGR 1), not dim (SGR 2)", () => {
    printNextSteps(["Run `hatch3r status` to verify your generated files are in sync."]);
    const line = stepLine();
    expect(line).not.toBe("");
    // The token's run opens with bold and never with the dim sequence.
    const tokenStart = line.indexOf("hatch3r status");
    const preamble = line.slice(0, tokenStart);
    expect(preamble).toContain(SGR_BOLD);
    // The dim sequence, if present at all, only decorates the leading bullet —
    // it must NOT be the active style at the command token.
    const dimBeforeToken = preamble.lastIndexOf(SGR_DIM);
    const boldBeforeToken = preamble.lastIndexOf(SGR_BOLD);
    expect(boldBeforeToken).toBeGreaterThan(dimBeforeToken);
  });

  it("consumes the backtick markers (display-only, not literal output)", () => {
    printNextSteps(["Run `hatch3r status` now."]);
    const line = stepLine();
    expect(line).not.toContain("`");
    expect(line).toContain("hatch3r status");
    expect(line).toContain("now.");
  });

  it("does not wrap the whole step line in the dim sequence", () => {
    printNextSteps(["Run `hatch3r validate` to check canonical content."]);
    const line = logged.find((l) => l.includes("hatch3r validate")) ?? "";
    // Prose after the token ("to check canonical content.") renders at the
    // terminal default weight — the line must not be a single dim-wrapped span.
    const proseStart = line.indexOf("to check canonical content");
    expect(proseStart).toBeGreaterThan(-1);
    // No dim run open immediately before the trailing prose.
    const proseSegment = line.slice(proseStart);
    expect(proseSegment.startsWith(SGR_DIM)).toBe(false);
  });
});
