/**
 * DD-C5 (release/2.8.5): malformed-document behavior for the mcp.json
 * ingress. The pre-2.8.5 code cast `JSON.parse(raw) as Record<string,
 * unknown>`, so a top-level array/string flowed into `{ ...base }` — a
 * string spread enumerates its characters into numeric keys, corrupting the
 * rewritten file. These suites pin the validated parse + never-clobber
 * dispositions.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMcpJsonDocument,
  filterMcpJsonOnDisk,
  materializeUserMcpJson,
} from "../../manifest/mcpFilter.js";
import { HATCH3R_DIR } from "../../types.js";

describe("parseMcpJsonDocument (DD-C5)", () => {
  it("classifies invalid JSON as syntax", () => {
    const r = parseMcpJsonDocument("{nope");
    expect(r.kind).toBe("syntax");
    if (r.kind === "syntax") expect(r.message.length).toBeGreaterThan(0);
  });

  it("classifies top-level array/string/number/null as not-object", () => {
    for (const [raw, label] of [
      ["[1,2]", "an array"],
      ['"hello"', "a string"],
      ["42", "a number"],
      ["null", "null"],
    ] as const) {
      const r = parseMcpJsonDocument(raw);
      expect(r.kind, raw).toBe("not-object");
      if (r.kind === "not-object") expect(r.message).toContain(label);
    }
  });

  it("accepts a document without mcpServers (empty servers map)", () => {
    const r = parseMcpJsonDocument('{"protocolVersion":"1"}');
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.servers).toEqual({});
      expect(r.doc.protocolVersion).toBe("1");
    }
  });

  it("drops non-object server entries and names them", () => {
    const r = parseMcpJsonDocument(
      JSON.stringify({ mcpServers: { good: { command: "x" }, bad: "nope", worse: 3 } }),
    );
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(Object.keys(r.servers)).toEqual(["good"]);
      expect(r.droppedServers.sort()).toEqual(["bad", "worse"]);
    }
  });

  it("treats a non-object mcpServers value as an empty server map", () => {
    const r = parseMcpJsonDocument('{"mcpServers": [1,2]}');
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.servers).toEqual({});
  });
});

describe("filterMcpJsonOnDisk malformed handling", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function stage(content: string): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcpmal-"));
    const target = join(tempDir, "mcp.json");
    await writeFile(target, content, "utf-8");
    return target;
  }

  it("invalid JSON: warns, never writes (bytes on disk untouched)", async () => {
    const target = await stage("{broken");
    const warnings: string[] = [];
    await filterMcpJsonOnDisk(target, new Set(["github"]), (m) => warnings.push(m));

    expect(warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
    expect(await readFile(target, "utf-8")).toBe("{broken");
  });

  it("valid-JSON-wrong-shape (top-level string): warns 'not applied', never writes", async () => {
    const raw = JSON.stringify("i-am-a-string");
    const target = await stage(raw);
    const warnings: string[] = [];
    await filterMcpJsonOnDisk(target, new Set(["github"]), (m) => warnings.push(m));

    expect(warnings.some((w) => w.includes("NOT applied"))).toBe(true);
    expect(await readFile(target, "utf-8")).toBe(raw);
  });

  it("non-object server entries are dropped with a warning; the rest is filtered normally", async () => {
    const target = await stage(
      JSON.stringify({
        keepMe: "sibling",
        mcpServers: {
          github: { command: "gh", _disabled: true },
          weird: "not-an-object",
          dropped: { command: "x" },
        },
      }),
    );
    const warnings: string[] = [];
    await filterMcpJsonOnDisk(target, new Set(["github"]), (m) => warnings.push(m));

    expect(warnings.some((w) => w.includes("weird"))).toBe(true);
    const rewritten = JSON.parse(await readFile(target, "utf-8"));
    expect(rewritten.keepMe).toBe("sibling"); // D11-M6 sibling preservation
    expect(Object.keys(rewritten.mcpServers)).toEqual(["github"]);
    expect(rewritten.mcpServers.github._disabled).toBeUndefined();
  });
});

describe("materializeUserMcpJson malformed handling", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function stageRoot(): Promise<{ rootDir: string; bundled: string }> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcpmat-"));
    const bundled = join(tempDir, "bundled-mcp.json");
    await writeFile(
      bundled,
      JSON.stringify({ mcpServers: { github: { command: "gh", _disabled: true } } }),
      "utf-8",
    );
    return { rootDir: tempDir, bundled };
  }

  it("a top-level-array bundled template is refused (no write) with a malformed warning", async () => {
    const { rootDir, bundled } = await stageRoot();
    await writeFile(bundled, "[1,2,3]", "utf-8");
    const warnings: string[] = [];

    const written = await materializeUserMcpJson(rootDir, new Set(["github"]), {
      bundledMcpPath: bundled,
      onWarn: (m) => warnings.push(m),
    });

    expect(written).toBe(false);
    expect(warnings.some((w) => w.includes("malformed"))).toBe(true);
  });

  it("an existing target that parses to a string is left untouched (the spread would corrupt it)", async () => {
    const { rootDir, bundled } = await stageRoot();
    const targetDir = join(rootDir, HATCH3R_DIR, "mcp");
    await mkdir(targetDir, { recursive: true });
    const target = join(targetDir, "mcp.json");
    const raw = JSON.stringify("user-string");
    await writeFile(target, raw, "utf-8");
    const warnings: string[] = [];

    const written = await materializeUserMcpJson(rootDir, new Set(["github"]), {
      bundledMcpPath: bundled,
      onWarn: (m) => warnings.push(m),
    });

    expect(written).toBe(false);
    expect(warnings.some((w) => w.includes("left untouched"))).toBe(true);
    expect(await readFile(target, "utf-8")).toBe(raw);
  });

  it("happy path still materializes: filtered bundled servers + fresh doc", async () => {
    const { rootDir, bundled } = await stageRoot();

    const written = await materializeUserMcpJson(rootDir, new Set(["github"]), {
      bundledMcpPath: bundled,
    });

    expect(written).toBe(true);
    const doc = JSON.parse(
      await readFile(join(rootDir, HATCH3R_DIR, "mcp", "mcp.json"), "utf-8"),
    );
    expect(Object.keys(doc.mcpServers)).toEqual(["github"]);
    expect(doc.mcpServers.github._disabled).toBeUndefined();
  });
});
