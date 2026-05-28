import { describe, it, expect } from "vitest";
import {
  HatchError,
  ERROR_CODE_TO_EXIT_CODE,
  exitCodeForErrorCode,
  type HatchErrorCode,
} from "../types.js";

describe("ERROR_CODE_TO_EXIT_CODE (C8-D1-M5)", () => {
  it("has an entry for every HatchErrorCode literal", () => {
    // Enumerate expected codes -- keeps this test in lockstep with the
    // HatchErrorCode union. If the union gains a member without an entry,
    // the map literal in src/types.ts will fail to typecheck first; this
    // test is the runtime sanity check.
    const expectedCodes: HatchErrorCode[] = [
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
    for (const code of expectedCodes) {
      expect(ERROR_CODE_TO_EXIT_CODE[code]).toBeTypeOf("number");
    }
    // Guard against silent union drift: confirm the map key set matches.
    expect(new Set(Object.keys(ERROR_CODE_TO_EXIT_CODE))).toEqual(
      new Set(expectedCodes),
    );
  });

  it("maps every entry to a valid POSIX exit code in [0, 255]", () => {
    for (const [code, exit] of Object.entries(ERROR_CODE_TO_EXIT_CODE) as Array<
      [string, number]
    >) {
      expect(
        Number.isInteger(exit) && exit >= 0 && exit <= 255,
        `${code} -> ${exit} is not a valid POSIX exit code`,
      ).toBe(true);
    }
  });

  it("differentiates exit codes per sysexits.h (SA12.1-F-D12-M1)", () => {
    // SA12.1-F-D12-M1 (Cycle 10 Wave 3, D12, P1): each HatchErrorCode maps to
    // the closest matching sysexits.h convention so CI consumers and shell
    // pipelines can branch on failure kind. Source: FreeBSD `/usr/include/
    // sysexits.h`, accessed 2026-05-28. Explicit exitCode arguments still
    // override this default (see "preserves an explicit non-default exitCode"
    // below).
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
});

describe("exitCodeForErrorCode (C8-D1-M5)", () => {
  it("returns the mapped default for each HatchErrorCode", () => {
    expect(exitCodeForErrorCode("VALIDATION_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.VALIDATION_ERROR,
    );
    expect(exitCodeForErrorCode("UNKNOWN_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR,
    );
    expect(exitCodeForErrorCode("NETWORK_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.NETWORK_ERROR,
    );
  });
});

describe("HatchError constructor (C8-D1-M5)", () => {
  it("derives exitCode from the map when none is passed", () => {
    const err = new HatchError("fs failure", undefined, "FS_ERROR");
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.FS_ERROR);
    expect(err.errorCode).toBe("FS_ERROR");
    expect(err.message).toBe("fs failure");
    expect(err.name).toBe("HatchError");
  });

  it("derives exitCode from UNKNOWN_ERROR when errorCode is also omitted", () => {
    const err = new HatchError("boom");
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR);
  });

  it("preserves an explicit non-default exitCode (user cancellation case)", () => {
    // clean.ts / init.ts throw HatchError with exit 0 for user-initiated
    // cancellation; the constructor must not overwrite that with the map
    // default (which is 1 for UNKNOWN_ERROR).
    const err = new HatchError("Cancelled by user", 0);
    expect(err.exitCode).toBe(0);
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
  });

  it("preserves an explicit exitCode even when errorCode is supplied", () => {
    // sync.ts budgetGateFailed path: exit 2 (usage) with ADAPTER_ERROR code.
    // The explicit exitCode wins over the map lookup for ADAPTER_ERROR (=1).
    const err = new HatchError("budget gate tripped", 2, "ADAPTER_ERROR");
    expect(err.exitCode).toBe(2);
    expect(err.errorCode).toBe("ADAPTER_ERROR");
  });

  it("is instanceof Error and HatchError", () => {
    const err = new HatchError("x", undefined, "CONFIG_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HatchError);
  });
});

describe("HatchError.recoveryHint (C9-H27 / D10-SA10.2-F2)", () => {
  it("is undefined by default", () => {
    const err = new HatchError("boom", 1, "VALIDATION_ERROR");
    expect(err.recoveryHint).toBeUndefined();
  });

  it("preserves an explicit hint as the fourth ctor arg", () => {
    const err = new HatchError(
      "Invalid --tools value",
      1,
      "VALIDATION_ERROR",
      "Re-run with one of the supported tool ids.",
    );
    expect(err.recoveryHint).toBe("Re-run with one of the supported tool ids.");
    // Hint does not displace any other field.
    expect(err.message).toBe("Invalid --tools value");
    expect(err.exitCode).toBe(1);
    expect(err.errorCode).toBe("VALIDATION_ERROR");
  });

  it("accepts a hint even when exitCode/errorCode are omitted", () => {
    const err = new HatchError("transient", undefined, undefined, "Retry in a moment.");
    expect(err.recoveryHint).toBe("Retry in a moment.");
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
    // SA12.1-F-D12-M1: default exitCode comes from ERROR_CODE_TO_EXIT_CODE.
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR);
  });

  it("treats recoveryHint as readonly (compile-time invariant)", () => {
    const err = new HatchError("x", 1, "CONFIG_ERROR", "hint-A");
    // TypeScript marks recoveryHint as readonly; this runtime check guards
    // the contract that the CLI top-level handler observes a stable value.
    expect(err.recoveryHint).toBe("hint-A");
  });
});
