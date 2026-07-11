import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterMcpJsonOnDisk, materializeUserMcpJson } from "../../manifest/mcpFilter.js";

/**
 * D3-M5 (Cycle 10 Wave-3 Medium rollover): `src/manifest/mcpFilter.ts`
 * previously had 65%/37.5% statements/branches coverage. The four branches
 * (ENOENT, JSON SyntaxError, missing `mcpServers`, normal-path filter) all
 * fork behaviour but had no direct unit test — coverage came from one
 * incidental run inside the init flow. Cover each branch here so a future
 * refactor of the on-disk filter cannot silently regress.
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hatch3r-mcpFilter-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("filterMcpJsonOnDisk", () => {
  it("no-ops when the target file does not exist (ENOENT)", async () => {
    const missing = join(tmpDir, "no-such-file.json");
    // Should resolve without throwing and without creating the file.
    await expect(filterMcpJsonOnDisk(missing, new Set(["github"]))).resolves.toBeUndefined();
    await expect(readFile(missing, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns silently when the file is malformed JSON (SyntaxError branch)", async () => {
    const target = join(tmpDir, "mcp.json");
    await writeFile(target, "{ not valid json");
    await expect(filterMcpJsonOnDisk(target, new Set(["github"]))).resolves.toBeUndefined();
    // File is preserved as-is on parse failure (no clobber).
    expect(await readFile(target, "utf-8")).toBe("{ not valid json");
  });

  it("returns silently when the payload has no mcpServers field", async () => {
    const target = join(tmpDir, "mcp.json");
    const original = JSON.stringify({ otherKey: 1 });
    await writeFile(target, original);
    await filterMcpJsonOnDisk(target, new Set(["github"]));
    // No rewrite happened — the file content is byte-for-byte identical.
    expect(await readFile(target, "utf-8")).toBe(original);
  });

  it("filters mcpServers to the selected ids and drops the _disabled marker", async () => {
    const target = join(tmpDir, "mcp.json");
    await writeFile(
      target,
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", _disabled: false },
          gitlab: { command: "npx", _disabled: true },
          custom: { command: "npx", _disabled: false },
        },
      }),
    );
    await filterMcpJsonOnDisk(target, new Set(["github", "custom"]));
    const parsed = JSON.parse(await readFile(target, "utf-8"));
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(["custom", "github"]);
    expect(parsed.mcpServers.github._disabled).toBeUndefined();
    expect(parsed.mcpServers.custom._disabled).toBeUndefined();
  });

  it("emits an empty mcpServers object when no ids match", async () => {
    const target = join(tmpDir, "mcp.json");
    await writeFile(
      target,
      JSON.stringify({
        mcpServers: {
          github: { command: "npx" },
        },
      }),
    );
    await filterMcpJsonOnDisk(target, new Set(["nonexistent"]));
    const parsed = JSON.parse(await readFile(target, "utf-8"));
    expect(parsed.mcpServers).toEqual({});
  });

  it("D11-M6: preserves top-level fields beyond mcpServers (no destructive rewrite)", async () => {
    const target = join(tmpDir, "mcp.json");
    await writeFile(
      target,
      JSON.stringify({
        protocolVersion: "2025-11-25",
        $schema: "https://example.com/mcp.schema.json",
        mcpServers: {
          github: { command: "npx" },
          gitlab: { command: "npx" },
        },
      }),
    );
    await filterMcpJsonOnDisk(target, new Set(["github"]));
    const parsed = JSON.parse(await readFile(target, "utf-8"));
    // Sibling fields survive the rewrite.
    expect(parsed.protocolVersion).toBe("2025-11-25");
    expect(parsed.$schema).toBe("https://example.com/mcp.schema.json");
    // mcpServers is filtered as before.
    expect(Object.keys(parsed.mcpServers)).toEqual(["github"]);
  });
});

/**
 * D1-SA1.2-08 (Cycle 12 Wave 3): `materializeUserMcpJson` is the shared
 * materialization point for `.hatch3r/mcp/mcp.json` — extracted from init's
 * Wave-6 copy-then-filter block so post-init server-set changes (mcp
 * setup/remove, runRegenerate) can refresh the copy agents are pointed at.
 * Each branch below pins one contract from the helper's JSDoc.
 */
describe("materializeUserMcpJson", () => {
  const TARGET_REL = join(".hatch3r", "mcp", "mcp.json");

  async function writeBundled(servers: Record<string, unknown>, siblings: Record<string, unknown> = {}) {
    const bundledPath = join(tmpDir, "bundled-mcp.json");
    await writeFile(bundledPath, JSON.stringify({ ...siblings, mcpServers: servers }));
    return bundledPath;
  }

  it("materializes a fresh filtered copy (drops _disabled, excludes unselected)", async () => {
    const bundledMcpPath = await writeBundled({
      github: { command: "npx", _disabled: true },
      gitlab: { command: "npx" },
    });

    const written = await materializeUserMcpJson(tmpDir, new Set(["github"]), { bundledMcpPath });

    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(join(tmpDir, TARGET_REL), "utf-8"));
    expect(Object.keys(parsed.mcpServers)).toEqual(["github"]);
    expect(parsed.mcpServers.github).toEqual({ command: "npx" }); // _disabled dropped
  });

  it("refresh: replaces mcpServers from the bundled template while preserving user sibling keys (D11-M6)", async () => {
    const bundledMcpPath = await writeBundled({
      github: { command: "npx", version: "2" },
      gitlab: { command: "npx" },
    });
    await mkdir(join(tmpDir, ".hatch3r", "mcp"), { recursive: true });
    await writeFile(
      join(tmpDir, TARGET_REL),
      JSON.stringify({
        userNote: "hand-edited",
        mcpServers: { github: { command: "npx", version: "1" }, stale: { command: "old" } },
      }),
    );

    const written = await materializeUserMcpJson(tmpDir, new Set(["github", "gitlab"]), { bundledMcpPath });

    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(join(tmpDir, TARGET_REL), "utf-8"));
    expect(parsed.userNote).toBe("hand-edited"); // user sibling preserved
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(["github", "gitlab"]);
    expect(parsed.mcpServers.github.version).toBe("2"); // fresh bundled definition wins
    expect(parsed.mcpServers.stale).toBeUndefined(); // stale entry gone
  });

  it("empty selection + absent target: no write (directory stays absent)", async () => {
    const bundledMcpPath = await writeBundled({ github: { command: "npx" } });

    const written = await materializeUserMcpJson(tmpDir, new Set(), { bundledMcpPath });

    expect(written).toBe(false);
    await expect(readFile(join(tmpDir, TARGET_REL), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("empty selection + existing target: rewrites to zero servers so the copy stays truthful", async () => {
    const bundledMcpPath = await writeBundled({ github: { command: "npx" } });
    await mkdir(join(tmpDir, ".hatch3r", "mcp"), { recursive: true });
    await writeFile(
      join(tmpDir, TARGET_REL),
      JSON.stringify({ keepMe: 1, mcpServers: { github: { command: "npx" } } }),
    );

    const written = await materializeUserMcpJson(tmpDir, new Set(), { bundledMcpPath });

    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(join(tmpDir, TARGET_REL), "utf-8"));
    expect(parsed.mcpServers).toEqual({});
    expect(parsed.keepMe).toBe(1);
  });

  it("missing bundled template: warns and returns false without writing", async () => {
    const warnings: string[] = [];

    const written = await materializeUserMcpJson(tmpDir, new Set(["github"]), {
      bundledMcpPath: join(tmpDir, "no-such-template.json"),
      onWarn: (m) => warnings.push(m),
    });

    expect(written).toBe(false);
    expect(warnings.some((w) => w.includes("not found"))).toBe(true);
    await expect(readFile(join(tmpDir, TARGET_REL), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("unparseable existing target: warns and never clobbers the user file", async () => {
    const bundledMcpPath = await writeBundled({ github: { command: "npx" } });
    await mkdir(join(tmpDir, ".hatch3r", "mcp"), { recursive: true });
    await writeFile(join(tmpDir, TARGET_REL), "{ not valid json");
    const warnings: string[] = [];

    const written = await materializeUserMcpJson(tmpDir, new Set(["github"]), {
      bundledMcpPath,
      onWarn: (m) => warnings.push(m),
    });

    expect(written).toBe(false);
    expect(warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
    expect(await readFile(join(tmpDir, TARGET_REL), "utf-8")).toBe("{ not valid json");
  });
});
