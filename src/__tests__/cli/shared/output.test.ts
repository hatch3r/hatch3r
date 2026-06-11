/**
 * Unit coverage for the shared CLI output facility
 * (`src/cli/shared/output.ts`).
 *
 * D10-22 (Cycle 11 Wave 3, D10, P1): a `--format` value that is neither
 * `human` nor `json` previously degraded silently to `"human"` at exit 0,
 * hiding a mistyped CI flag. These tests fix the contract:
 *   - valid values (case-insensitive `human`/`json`) normalize as expected
 *   - the absent / empty / non-string fallback resolves to `"human"`
 *     (Commander supplies the `"human"` default on the no-flag path)
 *   - an explicit, non-empty, unrecognized value throws a usage HatchError
 *     (exit 2) so the bad flag fails loudly
 *   - emitJson writes one compact JSON document plus a single trailing newline
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseFormatOption, emitJson } from "../../../cli/shared/output.js";
import { HatchError } from "../../../types.js";

describe("parseFormatOption() — valid values", () => {
  it("returns 'json' for the canonical lowercase value", () => {
    expect(parseFormatOption("json")).toBe("json");
  });

  it("returns 'human' for the canonical lowercase value", () => {
    expect(parseFormatOption("human")).toBe("human");
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(parseFormatOption("JSON")).toBe("json");
    expect(parseFormatOption("Json")).toBe("json");
    expect(parseFormatOption("  json  ")).toBe("json");
    expect(parseFormatOption("HUMAN")).toBe("human");
    expect(parseFormatOption("  Human ")).toBe("human");
  });
});

describe("parseFormatOption() — absent / empty fallback to human", () => {
  it("returns 'human' when the value is undefined (no --format flag)", () => {
    expect(parseFormatOption(undefined)).toBe("human");
  });

  it("returns 'human' for an empty or whitespace-only string", () => {
    expect(parseFormatOption("")).toBe("human");
    expect(parseFormatOption("   ")).toBe("human");
  });

  it("returns 'human' for a non-string value", () => {
    // Defensive: Commander always passes a string, but guard the contract.
    expect(parseFormatOption(123 as unknown as string)).toBe("human");
    expect(parseFormatOption(null as unknown as string)).toBe("human");
  });
});

describe("parseFormatOption() — invalid value is a usage error (D10-22)", () => {
  it("throws a HatchError for an explicit unrecognized value", () => {
    expect(() => parseFormatOption("jsom")).toThrow(HatchError);
  });

  it("throws with usage exit code 2 (not the VALIDATION_ERROR sysexits default)", () => {
    try {
      parseFormatOption("yaml");
      throw new Error("expected parseFormatOption to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HatchError);
      const hatch = err as HatchError;
      expect(hatch.exitCode).toBe(2);
      expect(hatch.errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("includes the offending value and an actionable recovery hint", () => {
    try {
      parseFormatOption("jsom");
      throw new Error("expected parseFormatOption to throw");
    } catch (err) {
      const hatch = err as HatchError;
      expect(hatch.message).toContain("jsom");
      expect(hatch.message).toContain('"human"');
      expect(hatch.message).toContain('"json"');
      expect(hatch.recoveryHint).toContain("--format");
    }
  });

  it("rejects a value that merely contains a valid token as a substring", () => {
    // 'jsonl' / 'human-readable' are not exact matches and must fail loudly.
    expect(() => parseFormatOption("jsonl")).toThrow(HatchError);
    expect(() => parseFormatOption("human-readable")).toThrow(HatchError);
  });
});

describe("emitJson()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one compact JSON document followed by a single trailing newline", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });

    emitJson({ summary: { status: "ok" }, count: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    const out = writes[0];
    expect(out.endsWith("\n")).toBe(true);
    // Exactly one trailing newline (single document for CI parsers).
    expect(out.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(out)).toEqual({ summary: { status: "ok" }, count: 3 });
  });
});
