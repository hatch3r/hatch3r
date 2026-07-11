/**
 * C9-M17 tests: `formatActionableError(err)` is the single funnel for
 * all 14 CLI command error paths. These tests fix the contract:
 *   - HatchError with a recoveryHint → boxed stderr with hint
 *   - HatchError without a hint → plain stderr lines: message + run id,
 *     no fabricated hint (D1-SA1.8-02; the pre-fix silent return violated
 *     the D12-M3 run-id guarantee)
 *   - HatchError with exitCode 0 → silent clean cancellation
 *   - generic Error / unknown → multi-line stderr classified by
 *     `errorClassification.ts`
 *   - unhandled rejection scenario (caller passes shuttingDown=true) →
 *     classified as "shutting-down" / clean cancel
 */

import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatActionableError,
  writeFormattedCliError,
  resolveRecoveryHint,
  DEFAULT_RECOVERY_HINT,
  type FormattedCliError,
} from "../../../cli/shared/errors.js";
import { HatchError, ERROR_CODE_TO_EXIT_CODE, type HatchErrorCode } from "../../../types.js";

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
    // SA12.1-F-D12-M1: VALIDATION_ERROR maps to sysexits.h EX_USAGE (64).
    expect(result.exitCode).toBe(64);
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
  it("emits message + run id (no fabricated hint) for a hintless UNKNOWN_ERROR (D1-SA1.8-02)", () => {
    // UNKNOWN_ERROR intentionally has NO entry in DEFAULT_RECOVERY_HINT — no
    // "Try:" line is invented. But the pre-fix `lines: []` return printed
    // ZERO bytes for this class, dropping the message AND the
    // SA12.1-F-D12-M3 run-id guarantee ("Run id:" line, pre-funnel
    // src/cli/index.ts at edb5216~1) — an exit-70 with no output is
    // undebuggable. `new HatchError(message)` is the constructor DEFAULT
    // shape, so this branch guards every future unclassified call site.
    const err = new HatchError("something opaque failed", undefined, "UNKNOWN_ERROR");
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-error");
    // SA12.1-F-D12-M1: UNKNOWN_ERROR maps to sysexits.h EX_SOFTWARE (70).
    expect(result.exitCode).toBe(70);
    // What-failed floor: the message renders.
    expect(result.lines.some((l) => l.includes("something opaque failed"))).toBe(true);
    // D12-M3 run-id guarantee: the correlation id renders.
    expect(result.runId).toBeDefined();
    expect(result.lines.some((l) => l.includes(`Run id: ${result.runId}`))).toBe(true);
    // Still no fabricated hint: no box, no hint field, no "Try:" line.
    expect(result.box).toBeUndefined();
    expect(result.hint).toBeUndefined();
    expect(result.lines.some((l) => l.includes("Try:"))).toBe(false);
  });

  it("treats HatchError with exitCode 0 as a clean cancellation (no output)", () => {
    const err = new HatchError("Init cancelled.", 0);
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-cancel");
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.box).toBeUndefined();
  });

  it("never renders zero bytes for ANY non-cancellation outcome (funnel floor, D1-SA1.8-02)", () => {
    // Sweep every HatchErrorCode (explicit-hint, default-hint, and no-hint
    // classes) plus generic/unknown throwables: every outcome that is not a
    // clean cancellation must produce a box OR at least one non-empty line —
    // writeFormattedCliError printing nothing for a fatal outcome is the
    // silent-exit failure mode the funnel exists to close.
    const codes: HatchErrorCode[] = [
      "VALIDATION_ERROR",
      "CONFIG_ERROR",
      "FS_ERROR",
      "INTEGRITY_ERROR",
      "ADAPTER_ERROR",
      "NETWORK_ERROR",
      "CLEAN_ERROR",
      "LOCK_TIMEOUT",
      "UNKNOWN_ERROR",
    ];
    const cases: unknown[] = [
      ...codes.map((code) => new HatchError(`fatal ${code}`, undefined, code)),
      new HatchError("bare default-constructor form"),
      new Error("generic unexpected"),
      "a raw string was thrown",
    ];
    for (const err of cases) {
      const result = formatActionableError(err);
      expect(result.exitCode).not.toBe(0);
      const rendersSomething =
        result.box !== undefined || result.lines.some((l) => l.trim().length > 0);
      expect(rendersSomething).toBe(true);
    }
  });
});

describe("formatActionableError() — SA12.1-F01 default recovery hint", () => {
  it("falls back to the errorCode default hint when no explicit hint is given (INTEGRITY_ERROR)", () => {
    // Previously this surfaced silently (the 53%-miss gap). It must now emit
    // the boxed INTEGRITY_ERROR default hint.
    const err = new HatchError("integrity mismatch", undefined, "INTEGRITY_ERROR");
    const result = formatActionableError(err);
    expect(result.kind).toBe("hatch-error");
    // SA12.1-F-D12-M1: INTEGRITY_ERROR maps to sysexits.h EX_CANTCREAT (73).
    expect(result.exitCode).toBe(73);
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

/**
 * C8-D1-M5 call-site migration completeness gate. The central
 * `ERROR_CODE_TO_EXIT_CODE` map in `src/types.ts` makes "what kind of failure"
 * (`errorCode`) the single source of truth for "how the CLI surfaces it"
 * (`exitCode`). Foundation landed in Cycle 8; Cycle 10 Wave-3 rollover (this
 * test) completes the migration by scanning every `throw new HatchError(...)`
 * in `src/cli/commands/*.ts` and refusing the legacy collapse value `1` as a
 * hand-picked exit code.
 *
 * Permitted hand-picked exit codes after migration:
 *   - `0`  — clean user cancellation (e.g. `new HatchError("Cancelled.", 0)`)
 *   - `2`  — POSIX usage error (e.g. missing required CLI flag, mutually
 *            exclusive flags)
 *   - `undefined` — defer to the central `ERROR_CODE_TO_EXIT_CODE` map
 *
 * Forbidden after migration:
 *   - `1`  — the legacy "everything collapses to exit 1" value
 *
 * If a call site genuinely requires `1`, it must be a `budget`/`gate`-style
 * conditional that surfaces another permitted value on at least one branch
 * (see `sync.ts::budgetGateFailed ? 2 : undefined` for the canonical shape).
 *
 * Failure mode: a regression that re-introduces `, 1, "*_ERROR"` to a CLI
 * command throw causes this scan to fail with the offending file:line list.
 */
describe("C8-D1-M5 — central errorCode->exitCode map enforcement", () => {
  // Resolve `src/cli/commands/` relative to this test file's URL so the gate
  // runs regardless of where vitest is invoked from. `import.meta.url`
  // points at the on-disk test file when vitest loads it.
  const commandsDir = fileURLToPath(
    new URL("../../../cli/commands/", import.meta.url),
  );

  // Each fatal error code maps to a distinct sysexits.h value; we use this to
  // assert the migration produces the FreeBSD-aligned codes end-to-end.
  it("ERROR_CODE_TO_EXIT_CODE preserves the sysexits.h alignment for every fatal code", () => {
    expect(ERROR_CODE_TO_EXIT_CODE.VALIDATION_ERROR).toBe(64); // EX_USAGE
    expect(ERROR_CODE_TO_EXIT_CODE.CONFIG_ERROR).toBe(65); // EX_DATAERR
    expect(ERROR_CODE_TO_EXIT_CODE.FS_ERROR).toBe(74); // EX_IOERR
    expect(ERROR_CODE_TO_EXIT_CODE.INTEGRITY_ERROR).toBe(73); // EX_CANTCREAT
    expect(ERROR_CODE_TO_EXIT_CODE.ADAPTER_ERROR).toBe(69); // EX_UNAVAILABLE
    expect(ERROR_CODE_TO_EXIT_CODE.NETWORK_ERROR).toBe(75); // EX_TEMPFAIL
    expect(ERROR_CODE_TO_EXIT_CODE.CLEAN_ERROR).toBe(74); // EX_IOERR
    expect(ERROR_CODE_TO_EXIT_CODE.LOCK_TIMEOUT).toBe(75); // EX_TEMPFAIL
    expect(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR).toBe(70); // EX_SOFTWARE
  });

  it("no file in src/cli/commands/*.ts hand-picks `1` as a HatchError exitCode", async () => {
    const entries = await readdir(commandsDir, { withFileTypes: true });
    const tsFiles = entries
      .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".d.ts"))
      .map((d) => join(commandsDir, d.name));

    // Match the second-argument form: `, 1, "<CODE>_ERROR"`. We use a multi-
    // line regex against the file body so a `throw new HatchError(\n  msg,\n
    // 1,\n  "CONFIG_ERROR",\n ...)` is caught the same as the single-line
    // shape. `LOCK_TIMEOUT` is kept on the alternation list because it is the
    // only non-`_ERROR`-suffixed fatal code.
    const LEGACY_HAND_PICKED_ONE =
      /,\s*1,\s*"(VALIDATION_ERROR|CONFIG_ERROR|FS_ERROR|INTEGRITY_ERROR|ADAPTER_ERROR|NETWORK_ERROR|CLEAN_ERROR|LOCK_TIMEOUT|UNKNOWN_ERROR)"/;

    const offenders: string[] = [];
    for (const file of tsFiles) {
      const raw = await readFile(file, "utf-8");
      // Walk match-by-match so we surface ALL offenders per file, not just the
      // first. Each match reports the rough source line for triage.
      let cursor = 0;
      while (cursor < raw.length) {
        const match = LEGACY_HAND_PICKED_ONE.exec(raw.slice(cursor));
        if (!match) break;
        const absoluteIndex = cursor + (match.index ?? 0);
        // Convert byte offset to 1-based line number by counting newlines.
        const lineNumber = raw.slice(0, absoluteIndex).split("\n").length;
        offenders.push(`${file}:${lineNumber} — legacy hand-picked exitCode=1 for ${match[1]}`);
        cursor = absoluteIndex + match[0].length;
      }
    }

    expect(
      offenders,
      `C8-D1-M5 regression: ${offenders.length} call site(s) still hand-pick exitCode=1. ` +
        `Drop the literal '1' (use 'undefined') so the central ERROR_CODE_TO_EXIT_CODE map ` +
        `provides the sysexits.h-aligned code:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("HatchError(CONFIG_ERROR) without explicit exitCode resolves to EX_DATAERR (65)", () => {
    // End-to-end re-check: this is the contract every migrated CLI throw now
    // honors — same constructor signature as the migrated call sites under
    // src/cli/commands/*.
    const err = new HatchError(
      "No .hatch3r/hatch.json found.",
      undefined,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
    expect(err.exitCode).toBe(65);
    expect(err.errorCode).toBe("CONFIG_ERROR");
  });

  it("HatchError(VALIDATION_ERROR) without explicit exitCode resolves to EX_USAGE (64)", () => {
    const err = new HatchError("Invalid --tools value: foo", undefined, "VALIDATION_ERROR");
    expect(err.exitCode).toBe(64);
    expect(err.errorCode).toBe("VALIDATION_ERROR");
  });

  it("HatchError(INTEGRITY_ERROR) without explicit exitCode resolves to EX_CANTCREAT (73)", () => {
    const err = new HatchError("drift detected", undefined, "INTEGRITY_ERROR");
    expect(err.exitCode).toBe(73);
    expect(err.errorCode).toBe("INTEGRITY_ERROR");
  });

  it("permitted hand-picked exit codes (0, 2) survive the migration unchanged", () => {
    // Clean user cancellation — `new HatchError(msg, 0)` is intentional and
    // unchanged by C8-D1-M5.
    const cancel = new HatchError("Cancelled by user", 0);
    expect(cancel.exitCode).toBe(0);

    // Explicit POSIX usage error — kept for missing-required-flag and
    // mutually-exclusive-flag throws (e.g. `rollback --session` missing,
    // `explain` mode flag missing).
    const usage = new HatchError("--session=<id> is required", 2, "VALIDATION_ERROR");
    expect(usage.exitCode).toBe(2);
  });
});
