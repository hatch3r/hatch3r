import { describe, it, expect } from "vitest";
import { classifyCliError } from "../../cli/errorClassification.js";

// ──────────────────────────────────────────────────────────────────────────
// D1-SA1.8.1: SIGINT during an inquirer prompt surfaces as an
// ExitPromptError. The top-level catch used to label this "unexpected",
// which is a CLI UX regression (P1). These tests lock the classification
// contract so the regression cannot reappear.
// ──────────────────────────────────────────────────────────────────────────

describe("classifyCliError (D1-SA1.8.1)", () => {
  describe("ExitPromptError from inquirer", () => {
    it("classifies an Error named 'ExitPromptError' as 'exit-prompt'", () => {
      const err = new Error("User force closed the prompt");
      err.name = "ExitPromptError";
      expect(classifyCliError(err, { shuttingDown: false })).toBe("exit-prompt");
    });

    it("exit-prompt classification wins over usage-message heuristic", () => {
      // Even if the message happens to contain "Unknown" etc., the name takes
      // precedence — we must exit cleanly on user Ctrl-C.
      const err = new Error("Unknown prompt state");
      err.name = "ExitPromptError";
      expect(classifyCliError(err, { shuttingDown: false })).toBe("exit-prompt");
    });

    it("exit-prompt classification applies even when shuttingDown is true", () => {
      const err = new Error("force closed");
      err.name = "ExitPromptError";
      expect(classifyCliError(err, { shuttingDown: true })).toBe("exit-prompt");
    });
  });

  describe("shutting-down flag", () => {
    it("classifies any non-ExitPromptError as 'shutting-down' when the flag is set", () => {
      const err = new Error("something failed during teardown");
      expect(classifyCliError(err, { shuttingDown: true })).toBe("shutting-down");
    });

    it("classifies a string throw as 'shutting-down' when the flag is set", () => {
      expect(classifyCliError("unexpected string", { shuttingDown: true })).toBe(
        "shutting-down",
      );
    });
  });

  describe("usage errors (commander messages)", () => {
    it("classifies Commander 'Invalid' messages as 'usage'", () => {
      const err = new Error("Invalid option: --foo");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    it("classifies Commander 'Unknown command' as 'usage'", () => {
      const err = new Error("Unknown command 'banana'");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    it("classifies 'missing required' as 'usage'", () => {
      const err = new Error("missing required argument 'path'");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });
  });

  describe("unexpected errors", () => {
    it("classifies an arbitrary Error as 'unexpected'", () => {
      const err = new Error("disk exploded");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("unexpected");
    });

    it("classifies a non-Error throw as 'unexpected' when not shutting down", () => {
      expect(classifyCliError(42, { shuttingDown: false })).toBe("unexpected");
      expect(classifyCliError(null, { shuttingDown: false })).toBe("unexpected");
      expect(classifyCliError({ boom: true }, { shuttingDown: false })).toBe(
        "unexpected",
      );
    });

    it("an Error whose message mentions 'Invalid' but whose name is not ExitPromptError is usage, not unexpected", () => {
      const err = new Error("Invalid config");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });
  });
});
