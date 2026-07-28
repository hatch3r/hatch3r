/**
 * DD-C1 (release/2.8.5): unit coverage for the shared config-ingress
 * parsing/validation primitives (src/config/parse.ts) — the vocabulary the
 * manifest/mcp/pack/env boundaries converge on.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  isPlainObject,
  parseJsonStrict,
  parseYamlStrict,
  requireString,
  requireBoolean,
  requireStringArray,
  requireEnum,
  unknownFields,
  rejectUnknownFields,
  readEnvInt,
  readEnvBool,
} from "../../config/parse.js";
import { HatchError } from "../../types.js";

describe("isPlainObject", () => {
  it("accepts only non-null non-array objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(3)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("parseJsonStrict / parseYamlStrict", () => {
  it("returns the parsed value for valid input", () => {
    expect(parseJsonStrict('{"a":1}', "x.json")).toEqual({ a: 1 });
    expect(parseYamlStrict("a: 1", "x.yaml")).toEqual({ a: 1 });
  });

  it("throws a CONFIG_ERROR HatchError naming the source, with the parse error as cause", () => {
    let caught: unknown;
    try {
      parseJsonStrict("{nope", "/repo/.hatch3r/broken.json");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    const err = caught as HatchError;
    expect(err.errorCode).toBe("CONFIG_ERROR");
    expect(err.message).toContain("/repo/.hatch3r/broken.json");
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });

  it("YAML failure carries only the first line of the parser message", () => {
    let caught: unknown;
    try {
      parseYamlStrict("a: [1,\nb: }", "bad.yaml");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).message).toContain("bad.yaml");
    expect((caught as HatchError).message).not.toContain("\n\n");
  });
});

describe("require* field validators (error accumulation)", () => {
  it("requireString returns the value or pushes a field-named error", () => {
    const errors: string[] = [];
    expect(requireString({ name: "ok" }, "name", errors)).toBe("ok");
    expect(requireString({ name: 3 }, "name", errors)).toBeUndefined();
    expect(requireString({}, "name", errors)).toBeUndefined();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("`name`");
  });

  it("optional fields are valid when absent, still checked when present", () => {
    const errors: string[] = [];
    expect(requireString({}, "desc", errors, { optional: true })).toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(requireString({ desc: 5 }, "desc", errors, { optional: true })).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("label prefixes the reported field path", () => {
    const errors: string[] = [];
    requireBoolean({ sync: "yes" }, "sync", errors, { label: "repos[2]" });
    expect(errors[0]).toContain("`repos[2].sync`");
  });

  it("requireBoolean / requireStringArray validate shape", () => {
    const errors: string[] = [];
    expect(requireBoolean({ on: true }, "on", errors)).toBe(true);
    expect(requireStringArray({ xs: ["a", "b"] }, "xs", errors)).toEqual(["a", "b"]);
    expect(requireStringArray({ xs: ["a", 1] }, "xs", errors)).toBeUndefined();
    expect(requireStringArray({ xs: "a" }, "xs", errors)).toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it("requireEnum narrows to the allowed member and rejects outsiders", () => {
    const errors: string[] = [];
    expect(requireEnum({ mode: "on-sync" }, "mode", ["manual", "on-sync"] as const, errors)).toBe("on-sync");
    expect(requireEnum({ mode: "nope" }, "mode", ["manual", "on-sync"] as const, errors)).toBeUndefined();
    expect(errors[0]).toContain('"manual" | "on-sync"');
  });

  it("error messages never dump a long value verbatim (bounded preview)", () => {
    const errors: string[] = [];
    requireBoolean({ v: "x".repeat(500) }, "v", errors);
    expect(errors[0].length).toBeLessThan(200);
  });
});

describe("unknownFields / rejectUnknownFields", () => {
  it("enumerates keys outside the allowed set, sorted", () => {
    expect(unknownFields({ b: 1, a: 1, known: 1 }, ["known"])).toEqual(["a", "b"]);
    expect(unknownFields({ known: 1 }, ["known"])).toEqual([]);
  });

  it("rejectUnknownFields pushes one labeled error naming every unknown key", () => {
    const errors: string[] = [];
    rejectUnknownFields({ evil: 1, ok: 2 }, ["ok"], errors, "pack-manifest.json");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("pack-manifest.json");
    expect(errors[0]).toContain('"evil"');
    rejectUnknownFields({ ok: 2 }, ["ok"], errors, "pack-manifest.json");
    expect(errors).toHaveLength(1); // no-op when clean
  });
});

describe("readEnvInt / readEnvBool", () => {
  const NAME = "HATCH3R_TEST_PARSE_ENV";
  afterEach(() => {
    delete process.env[NAME];
  });

  it("readEnvInt: unset/blank/non-numeric/Infinity → undefined; numeric → truncated integer", () => {
    expect(readEnvInt(NAME)).toBeUndefined();
    process.env[NAME] = "   ";
    expect(readEnvInt(NAME)).toBeUndefined();
    process.env[NAME] = "abc";
    expect(readEnvInt(NAME)).toBeUndefined();
    process.env[NAME] = "Infinity";
    expect(readEnvInt(NAME)).toBeUndefined();
    process.env[NAME] = "1500";
    expect(readEnvInt(NAME)).toBe(1500);
    process.env[NAME] = "12.9";
    expect(readEnvInt(NAME)).toBe(12);
    process.env[NAME] = "-3";
    expect(readEnvInt(NAME)).toBe(-3);
  });

  it("readEnvBool: strictly '1'/'0'; everything else is no-signal", () => {
    expect(readEnvBool(NAME)).toBeUndefined();
    process.env[NAME] = "1";
    expect(readEnvBool(NAME)).toBe(true);
    process.env[NAME] = "0";
    expect(readEnvBool(NAME)).toBe(false);
    for (const v of ["true", "false", "", "yes", "01"]) {
      process.env[NAME] = v;
      expect(readEnvBool(NAME), `value ${JSON.stringify(v)}`).toBeUndefined();
    }
  });
});
