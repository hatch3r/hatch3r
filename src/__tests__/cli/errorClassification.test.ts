import { describe, it, expect } from "vitest";
import { CommanderError } from "commander";
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

  // ────────────────────────────────────────────────────────────────────────
  // D8-2 (Cycle 11 Wave 2, P1): commander 15.x raises a CommanderError whose
  // stable `name`/`code` identify the failure class, and whose *message* is
  // lowercase ("unknown option '--x'", "... argument 'z' is invalid"). The
  // prior capitalized-substring heuristic ("Invalid"/"Unknown") missed every
  // real commander message, so a user mistake was misclassified as
  // "unexpected" (exit 1 + bug-report URL) instead of "usage" (exit 2). These
  // tests lock classification onto the stable code/name contract AND the
  // lowercase-message fallback.
  // ────────────────────────────────────────────────────────────────────────
  describe("usage errors (commander code/name contract)", () => {
    it("classifies a CommanderError by name+code (lowercase message) as 'usage'", () => {
      const err = new CommanderError(
        1,
        "commander.unknownOption",
        "error: unknown option '--bogus'",
      );
      // name is "CommanderError" and code starts with "commander." — must be usage.
      expect(err.name).toBe("CommanderError");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    it.each([
      ["commander.unknownOption", "error: unknown option '--bogus'"],
      ["commander.unknownCommand", "error: unknown command 'frobnicate'"],
      ["commander.invalidArgument", "error: option '--lvl <n>' argument 'z' is invalid. Allowed choices are a, b."],
      ["commander.optionMissingArgument", "error: option '--known <v>' argument missing"],
      ["commander.missingMandatoryOptionValue", "error: required option '--req <v>' not specified"],
    ])("classifies CommanderError code %s as 'usage'", (code, message) => {
      const err = new CommanderError(1, code, message);
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    it("classifies an Error carrying a commander-prefixed `code` (not named CommanderError) as 'usage'", () => {
      // A re-wrapped parse failure may lose the CommanderError name but keep the code.
      const err = Object.assign(new Error("error: unknown option '--x'"), {
        code: "commander.unknownOption",
      });
      expect(err.name).toBe("Error");
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    // L-D9-SA12.1-F4: the prior English-substring heuristic ("Invalid"/"Unknown"
    // /"missing required") would misclassify a localized or reworded commander
    // message as 'unexpected' (exit 1 + crash footer) for what is a usage error.
    // The D8-2 fix keys the PRIMARY classification on the stable typed contract
    // (name === "CommanderError" OR code prefixed "commander.") so the message
    // TEXT is irrelevant to the decision. These cases prove message-independence:
    // a CommanderError whose message contains NONE of the English usage lexemes
    // — including a non-English / fully reworded message — is still 'usage'
    // purely on the typed code. This is the regression gate the finding's
    // falsifiability clause ("a future release rewords ... or a localized build")
    // asks for; without it, a refactor that re-narrowed onto message text would
    // re-introduce the brittleness with a green suite.
    it("classifies a CommanderError on its typed code even when the message contains no English usage lexeme", () => {
      // No "invalid"/"unknown"/"missing"/"not specified"/"argument missing" —
      // the substring fallback would return 'unexpected' for this text.
      const err = new CommanderError(1, "commander.unknownOption", "Fehler: Option nicht erkannt");
      expect(err.message.toLowerCase()).not.toMatch(
        /invalid|unknown|missing required|argument missing|not specified|unknown option|unknown command/,
      );
      expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
    });

    it.each([
      ["commander.unknownOption", "опция не распознана"],
      ["commander.unknownCommand", "コマンドが認識されません"],
      ["commander.missingArgument", "(empty reworded message)"],
    ])(
      "classifies CommanderError code %s as 'usage' regardless of the localized/reworded message",
      (code, message) => {
        const err = new CommanderError(1, code, message);
        expect(classifyCliError(err, { shuttingDown: false })).toBe("usage");
      },
    );

    it.each([
      "error: unknown option '--bogus'",
      "error: unknown command 'frobnicate'",
      "error: option '--lvl <n>' argument 'z' is invalid. Allowed choices are a, b.",
      "error: option '--known <v>' argument missing",
      "error: required option '--req <v>' not specified",
    ])("classifies a plain Error with commander's lowercase message %s as 'usage' (fallback)", (message) => {
      // No name, no code — only the lowercase message text. The fallback must
      // still recognize these because the capitalized heuristic did not.
      const err = new Error(message);
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
