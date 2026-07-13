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
  printBox,
  printPayload,
  printBanner,
  glyph,
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

// D10-SA10.2-03 (Cycle 12): the GLYPHS map carries key-cap glyphs (`↑↓`, `⏎`)
// with ASCII fallbacks so the backablePrompts.ts fork routes its help chrome
// through the same fallback path as the status glyphs. glyph() resolves the
// environment per call, so an env toggle inside a test exercises both forms.
describe("shared/ui glyph key-caps (D10-SA10.2-03)", () => {
  let priorAscii: string | undefined;
  let priorCi: string | undefined;

  beforeEach(() => {
    priorAscii = process.env.HATCH3R_ASCII;
    priorCi = process.env.CI;
    delete process.env.HATCH3R_ASCII;
    // CI=1 makes supportsUnicode() deterministic on win32 runners too.
    process.env.CI = "1";
  });

  afterEach(() => {
    if (priorAscii === undefined) delete process.env.HATCH3R_ASCII;
    else process.env.HATCH3R_ASCII = priorAscii;
    if (priorCi === undefined) delete process.env.CI;
    else process.env.CI = priorCi;
  });

  it("resolves Unicode key-caps on a Unicode-capable terminal", () => {
    expect(glyph("upDown")).toBe("↑↓");
    expect(glyph("enter")).toBe("⏎");
  });

  it("falls back to ASCII words under HATCH3R_ASCII=1", () => {
    process.env.HATCH3R_ASCII = "1";
    expect(glyph("upDown")).toBe("up/down");
    expect(glyph("enter")).toBe("enter");
  });

  it("keeps the status glyphs' ASCII fallbacks intact alongside the key-caps", () => {
    process.env.HATCH3R_ASCII = "1";
    expect(glyph("error")).toBe("[X]");
    expect(glyph("warn")).toBe("[!]");
    expect(glyph("info")).toBe("[i]");
    expect(glyph("success")).toBe("[OK]");
  });
});

// D10-SA10.2-04 + D12-SA12.1-04 (Cycle 12): printBox must never convey
// severity by border colour alone — for error/warning styles the severity
// glyph is prepended to the title at the render layer, so the redundant
// coding (WCAG 1.4.1) is guaranteed regardless of the caller's title text
// and survives NO_COLOR/monochrome. info/success titles stay undecorated:
// absence of an alarm glyph is the non-alarming signal.
describe("shared/ui printBox severity redundant coding (D10-SA10.2-04 / D12-SA12.1-04)", () => {
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let priorAscii: string | undefined;
  let priorCi: string | undefined;

  beforeEach(() => {
    resetUiState();
    logged = [];
    priorAscii = process.env.HATCH3R_ASCII;
    priorCi = process.env.CI;
    delete process.env.HATCH3R_ASCII;
    process.env.CI = "1";
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (priorAscii === undefined) delete process.env.HATCH3R_ASCII;
    else process.env.HATCH3R_ASCII = priorAscii;
    if (priorCi === undefined) delete process.env.CI;
    else process.env.CI = priorCi;
  });

  function rendered(): string {
    return logged.join("\n");
  }

  it("prepends the error glyph to an error box title", () => {
    printBox("verify: FAIL", ["body"], "error");
    expect(rendered()).toContain("✖ verify: FAIL");
  });

  it("prepends the warning glyph to a warning box title", () => {
    printBox("Customizations", ["body"], "warning");
    expect(rendered()).toContain("⚠ Customizations");
  });

  it("uses the ASCII glyph forms under HATCH3R_ASCII=1", () => {
    process.env.HATCH3R_ASCII = "1";
    printBox("failed", ["body"], "error");
    printBox("drifted", ["body"], "warning");
    expect(rendered()).toContain("[X] failed");
    expect(rendered()).toContain("[!] drifted");
  });

  it("leaves info and success titles undecorated (absence of glyph = non-alarming)", () => {
    printBox("Diff summary", ["body"], "info");
    printBox("Hatch complete", ["body"], "success");
    const out = rendered();
    expect(out).toContain("Diff summary");
    expect(out).toContain("Hatch complete");
    for (const g of ["✖", "⚠", "ℹ", "✔", "[X]", "[!]", "[i]", "[OK]"]) {
      expect(out).not.toContain(`${g} Diff summary`);
      expect(out).not.toContain(`${g} Hatch complete`);
    }
  });

  it("stays quiet-gated (boxes are chrome)", () => {
    setQuiet(true);
    printBox("verify: FAIL", ["body"], "error");
    expect(logged).toHaveLength(0);
  });
});

// D1-SA1.7-06 (Cycle 12): printPayload is the payload-side channel of the
// chrome/payload split. `--quiet` strips chrome only — a read-only command's
// data lines still emit — while `--format json` suppresses human payload so
// stdout carries exactly one JSON envelope.
describe("shared/ui printPayload quiet contract (D1-SA1.7-06)", () => {
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUiState();
    logged = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    resetUiState();
  });

  it("emits payload in default mode", () => {
    printPayload("estimated cost: 12k tokens");
    expect(logged).toEqual(["estimated cost: 12k tokens"]);
  });

  it("still emits payload under quiet (payload is not chrome)", () => {
    setQuiet(true);
    printPayload("estimated cost: 12k tokens");
    expect(logged).toEqual(["estimated cost: 12k tokens"]);
  });

  it("suppresses human payload in json mode (stdout carries one JSON envelope)", () => {
    setJson(true);
    printPayload("estimated cost: 12k tokens");
    expect(logged).toHaveLength(0);
  });
});

// D10-SA10.2-05 (Cycle 12, recorded tension): the ANSI-shadow banner has no
// screen-reader-specific suppressor, but its text alternative (tagline +
// version) and its four escape hatches are load-bearing facts the ui.ts
// comment records. Pin the observable halves: quiet fully suppresses the
// banner, the compact path emits a single glyph-free line, and the full
// banner carries the text-alternative lines.
describe("shared/ui banner accessibility record (D10-SA10.2-05)", () => {
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUiState();
    logged = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("suppresses the banner entirely under quiet", () => {
    setQuiet(true);
    printBanner();
    printBanner(true);
    expect(logged).toHaveLength(0);
  });

  it("compact banner is a single line without block glyphs", () => {
    printBanner(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("hatch3r");
    expect(logged[0]).not.toContain("██");
  });

  it("full banner includes the text alternative (tagline + version)", () => {
    printBanner();
    const out = logged.join("\n");
    expect(out).toContain("Crack the egg. Hatch better agents.");
    expect(out).toMatch(/v\d+\.\d+\.\d+/);
  });
});
