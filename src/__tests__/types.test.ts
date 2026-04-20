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

  it("uses exit code 1 as the current default for runtime errors", () => {
    // Baseline assertion: current CLI convention is 0 = success, 1 = runtime
    // error, 2 = usage error. All defined errorCodes are runtime-class today
    // (usage errors surface via Commander -> classifyCliError path, not via
    // HatchError). Changes to this invariant require updating src/cli/index.ts.
    for (const code of Object.values(ERROR_CODE_TO_EXIT_CODE)) {
      expect(code).toBe(1);
    }
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
