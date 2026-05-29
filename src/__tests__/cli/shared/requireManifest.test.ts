/**
 * D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, D8, P1): contract tests for the shared
 * `assertManifest` preflight that replaced the seven copy-pasted
 * missing-manifest blocks across verify/status/sync/update/mcp/cli-tools/config.
 *
 * Fixes the contract in one place so the per-command paths inherit it:
 *   - null manifest, human mode  → canonical two-line stderr + CONFIG_ERROR
 *     (exit 65) throw with the canonical recovery hint;
 *   - null manifest, JSON mode   → NO human stderr (the command already emitted
 *     its one-shot JSON payload) but still throws CONFIG_ERROR;
 *   - present manifest           → no throw, no output (asserts-narrowing path).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  assertManifest,
  MISSING_MANIFEST_MESSAGE,
  MISSING_MANIFEST_HINT,
} from "../../../cli/shared/requireManifest.js";
import {
  HatchError,
  ERROR_CODE_TO_EXIT_CODE,
  type HatchManifest,
} from "../../../types.js";

// Minimal manifest stand-in — assertManifest only checks truthiness, never
// reads fields, so an empty object satisfies the present-manifest path.
const PRESENT_MANIFEST = {} as HatchManifest;

describe("assertManifest (D8-SA8.1-F8.1.8)", () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("exposes the canonical message + hint as exported constants", () => {
    // The exact strings the per-command JSON payloads and errors.test.ts
    // assert against — pinned so a reword is a deliberate, test-visible change.
    expect(MISSING_MANIFEST_MESSAGE).toBe("No .hatch3r/hatch.json found.");
    expect(MISSING_MANIFEST_HINT).toBe(
      "Run `npx hatch3r init` to set up your project first.",
    );
  });

  it("throws CONFIG_ERROR (exit 65) with the canonical hint when manifest is null (human mode)", () => {
    let thrown: unknown;
    try {
      assertManifest(null);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const err = thrown as HatchError;
    expect(err.message).toBe(MISSING_MANIFEST_MESSAGE);
    expect(err.errorCode).toBe("CONFIG_ERROR");
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.CONFIG_ERROR); // 65
    expect(err.recoveryHint).toBe(MISSING_MANIFEST_HINT);
  });

  it("prints the two-line human message to stderr + stdout-dim in human mode", () => {
    expect(() => assertManifest(null)).toThrow(HatchError);
    // Line 1 (stderr via ui.error): the message.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(MISSING_MANIFEST_MESSAGE),
    );
    // Line 2 (stdout dim): the recovery hint.
    const logged = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(MISSING_MANIFEST_HINT);
  });

  it("suppresses the human stderr/stdout lines in JSON mode but still throws", () => {
    // The calling command has already emitted its structured JSON error
    // payload; the helper must not interleave human chrome into stdout.
    expect(() => assertManifest(null, { jsonMode: true })).toThrow(HatchError);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("does not throw and emits nothing when a manifest is present", () => {
    expect(() => assertManifest(PRESENT_MANIFEST)).not.toThrow();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("narrows the manifest type on the success path (asserts predicate)", () => {
    const manifest: HatchManifest | null = PRESENT_MANIFEST;
    assertManifest(manifest);
    // After the assert, TS treats `manifest` as HatchManifest; this line only
    // compiles because the `asserts manifest` predicate removed `null`.
    const narrowed: HatchManifest = manifest;
    expect(narrowed).toBe(PRESENT_MANIFEST);
  });
});
