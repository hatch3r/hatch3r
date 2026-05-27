/**
 * C9-M17 tests: `formatActionableError(err)` is the single funnel for
 * all 14 CLI command error paths. These tests fix the contract:
 *   - HatchError with a recoveryHint → boxed stderr with hint
 *   - HatchError without a hint (or exitCode 0) → silent structured
 *     return (no stderr output)
 *   - generic Error / unknown → multi-line stderr classified by
 *     `errorClassification.ts`
 *   - unhandled rejection scenario (caller passes shuttingDown=true) →
 *     classified as "shutting-down" / clean cancel
 */

import { describe, it, expect } from "vitest";
import {
  formatActionableError,
  writeFormattedCliError,
  resolveRecoveryHint,
  DEFAULT_RECOVERY_HINT,
  type FormattedCliError,
} from "../../../cli/shared/errors.js";
import { HatchError } from "../../../types.js";

describe("formatActionableError() — HatchError with recoveryHint", () => {
  it("emits a boxed stderr block when the hint is present", () => {
    const err = new HatchError(
      "Invalid --tools value: foo",
      undefined,
      "VALIDATION_ERROR",
      "Re-run with --tools set to one of: cursor, claude, copilot.",
    );
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-error");
    expect(result.exitCode).toBe(1);
    expect(result.hint).toBe(
      "Re-run with --tools set to one of: cursor, claude, copilot.",
    );
    expect(result.box).toBeDefined();
    expect(result.box).toContain("Invalid --tools value: foo");
    expect(result.box).toContain(
      "Re-run with --tools set to one of: cursor, claude, copilot.",
    );
    // box is the rendering target; lines is empty so writers don't
    // double-print.
    expect(result.lines).toEqual([]);
  });

  it("preserves the structured exitCode from HatchError when a hint is present", () => {
    const err = new HatchError("Config locked", 1, "LOCK_TIMEOUT", "Wait 30s and retry.");
    const result = formatActionableError(err);
    expect(result.exitCode).toBe(1);
    expect(result.kind).toBe("hatch-error");
  });
});

describe("formatActionableError() — HatchError without recoveryHint", () => {
  it("returns the structured exitCode silently for UNKNOWN_ERROR (no default hint)", () => {
    // UNKNOWN_ERROR intentionally has NO entry in DEFAULT_RECOVERY_HINT, so a
    // hint-less UNKNOWN_ERROR keeps the legacy silent-structured behavior.
    const err = new HatchError("something opaque failed", undefined, "UNKNOWN_ERROR");
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-error");
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
    expect(result.box).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it("treats HatchError with exitCode 0 as a clean cancellation (no output)", () => {
    const err = new HatchError("Init cancelled.", 0);
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-cancel");
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.box).toBeUndefined();
  });
});

describe("formatActionableError() — SA12.1-F01 default recovery hint", () => {
  it("falls back to the errorCode default hint when no explicit hint is given (INTEGRITY_ERROR)", () => {
    // Previously this surfaced silently (the 53%-miss gap). It must now emit
    // the boxed INTEGRITY_ERROR default hint.
    const err = new HatchError("integrity mismatch", undefined, "INTEGRITY_ERROR");
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-error");
    expect(result.exitCode).toBe(1);
    expect(result.hint).toBe(DEFAULT_RECOVERY_HINT.INTEGRITY_ERROR);
    expect(result.box).toBeDefined();
    expect(result.box).toContain("integrity mismatch");
    expect(result.box).toContain("npx hatch3r verify");
    expect(result.lines).toEqual([]);
  });

  it("emits the CONFIG_ERROR default hint for a hint-less 'No hatch.json' failure", () => {
    // Mirrors the finding's canonical example: a missing-manifest CONFIG_ERROR
    // should point the user at `npx hatch3r init`.
    const err = new HatchError("No .hatch3r/hatch.json found.", 1, "CONFIG_ERROR");
    const result = formatActionableError(err);
    expect(result.hint).toBe(DEFAULT_RECOVERY_HINT.CONFIG_ERROR);
    expect(result.box).toContain("npx hatch3r init");
  });

  it("prefers an explicit recoveryHint over the errorCode default", () => {
    const explicit = "Run 'npx hatch3r init --tool cursor' first.";
    const err = new HatchError("No .hatch3r/hatch.json found.", 1, "CONFIG_ERROR", explicit);
    const result = formatActionableError(err);
    expect(result.hint).toBe(explicit);
    expect(result.hint).not.toBe(DEFAULT_RECOVERY_HINT.CONFIG_ERROR);
    expect(result.box).toContain(explicit);
  });

  it("provides a default hint for every fatal errorCode except UNKNOWN_ERROR", () => {
    const fatalCodes = [
      "VALIDATION_ERROR",
      "CONFIG_ERROR",
      "FS_ERROR",
      "INTEGRITY_ERROR",
      "ADAPTER_ERROR",
      "NETWORK_ERROR",
      "CLEAN_ERROR",
      "LOCK_TIMEOUT",
    ] as const;
    for (const code of fatalCodes) {
      expect(DEFAULT_RECOVERY_HINT[code], `missing default hint for ${code}`).toBeTruthy();
    }
    expect(DEFAULT_RECOVERY_HINT.UNKNOWN_ERROR).toBeUndefined();
  });
});

describe("resolveRecoveryHint()", () => {
  it("returns the explicit hint when present", () => {
    const err = new HatchError("x", 1, "FS_ERROR", "do the thing");
    expect(resolveRecoveryHint(err)).toBe("do the thing");
  });

  it("returns the errorCode default when no explicit hint is present", () => {
    const err = new HatchError("x", 1, "LOCK_TIMEOUT");
    expect(resolveRecoveryHint(err)).toBe(DEFAULT_RECOVERY_HINT.LOCK_TIMEOUT);
  });

  it("returns undefined for UNKNOWN_ERROR with no explicit hint", () => {
    const err = new HatchError("x", 1, "UNKNOWN_ERROR");
    expect(resolveRecoveryHint(err)).toBeUndefined();
  });
});

describe("formatActionableError() — generic Error", () => {
  it("classifies an unknown error as 'unexpected' and emits the troubleshooting footer", () => {
    const result = formatActionableError(new Error("boom"));
    expect(result.kind).toBe("unexpected");
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes("hatch3r encountered an unexpected error: boom"))).toBe(
      true,
    );
    expect(result.lines.some((l) => l.includes("hatch3r#troubleshooting"))).toBe(true);
    expect(result.lines.some((l) => l.includes(".failure-log.jsonl"))).toBe(true);
    expect(result.lines.some((l) => l.includes("DEBUG=1"))).toBe(true);
  });

  it("classifies a commander-style 'Invalid' error as 'usage' with exit 2", () => {
    const err = new Error("Invalid option: --foo");
    const result = formatActionableError(err);
    expect(result.kind).toBe("usage");
    expect(result.exitCode).toBe(2);
    expect(result.lines.some((l) => l.includes("hatch3r --help"))).toBe(true);
  });

  it("classifies a non-Error thrown value via String()", () => {
    const result = formatActionableError("a raw string was thrown");
    expect(result.kind).toBe("unexpected");
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes("a raw string was thrown"))).toBe(true);
  });
});

describe("formatActionableError() — shutdown / unhandled rejection paths", () => {
  it("classifies any error received during shutdown as a clean cancel (exit 130)", () => {
    const err = new Error("ECONNREFUSED");
    const result = formatActionableError(err, { shuttingDown: true });
    expect(result.kind).toBe("shutting-down");
    expect(result.exitCode).toBe(130);
    expect(result.lines).toEqual([]);
    expect(result.box).toBeUndefined();
  });

  it("classifies an ExitPromptError as a clean cancel even when not shutting down", () => {
    const err = new Error("User force closed the prompt") as Error & { name: string };
    err.name = "ExitPromptError";
    const result = formatActionableError(err);
    expect(result.kind).toBe("exit-prompt");
    expect(result.exitCode).toBe(130);
    expect(result.lines).toEqual([]);
  });

  it("represents an unhandled rejection (string reason) the same as a thrown string", () => {
    // process.on('unhandledRejection') passes through the reason
    // unchanged — funnel must accept `unknown`.
    const result = formatActionableError("rejected without an Error wrapper");
    expect(result.kind).toBe("unexpected");
    expect(result.lines.some((l) => l.includes("rejected without an Error wrapper"))).toBe(true);
  });
});

describe("writeFormattedCliError()", () => {
  it("writes the box to stderr when present and skips the lines array", () => {
    const formatted: FormattedCliError = {
      lines: ["fallback line"],
      box: "[boxed]",
      exitCode: 1,
      kind: "hatch-error",
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: unknown) => {
      errors.push(String(msg));
    };
    try {
      writeFormattedCliError(formatted);
    } finally {
      console.error = originalError;
    }
    expect(errors).toEqual(["[boxed]"]);
  });

  it("writes lines individually when no box is present", () => {
    const formatted: FormattedCliError = {
      lines: ["", "line one", "  line two"],
      exitCode: 2,
      kind: "usage",
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: unknown) => {
      errors.push(String(msg));
    };
    try {
      writeFormattedCliError(formatted);
    } finally {
      console.error = originalError;
    }
    expect(errors).toEqual(["", "line one", "  line two"]);
  });

  it("writes nothing when lines is empty and no box is present (silent cancel)", () => {
    const formatted: FormattedCliError = {
      lines: [],
      exitCode: 0,
      kind: "hatch-cancel",
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: unknown) => {
      errors.push(String(msg));
    };
    try {
      writeFormattedCliError(formatted);
    } finally {
      console.error = originalError;
    }
    expect(errors).toEqual([]);
  });
});
