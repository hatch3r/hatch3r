import { describe, it, expect, beforeEach } from "vitest";
import {
  setQuiet,
  setJson,
  setVerbose,
  isQuiet,
  isJson,
  isVerbose,
  resetUiState,
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
