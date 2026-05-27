// F3.2-F2 (D3 Cycle 10 Wave 2): real-deal companion to mcp.test.ts.
//
// mcp.test.ts stubs readManifest/writeManifest AND globally mocks node:fs +
// node:fs/promises to drive the per-subcommand branch coverage in isolation.
// Under that mock a regression that breaks the real manifest writer — or one
// where an mcp subcommand builds a structurally invalid mcp.servers shape that
// the real validateManifest would reject — passes silently (schema-version
// drift masking). Per CONSTITUTION §2 P2 Decision 20 (real-deal-first) this
// file carries NO fs mocks and round-trips the exact mcp.servers shape
// mcpSetupCommand / mcpRemoveCommand persist (manifest.mcp = { servers: [...] })
// through the REAL writeManifest → readManifest path. validateManifest runs on
// both write and read; mcp.servers is validated at hatchJson.ts:252-253.

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createManifest, readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { HatchError } from "../../types.js";

describe("mcp real manifest round-trip (Decision 20 real-deal-first)", () => {
  it("the mcp.servers shape the commands persist survives real writeManifest → readManifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-mcp-real-"));
    try {
      // Build a baseline valid manifest, then set the SAME mcp shape the mcp
      // subcommands assign (manifest.mcp.servers = [...] in mcp.ts).
      const manifest = createManifest({
        platform: "github",
        owner: "acme",
        repo: "widget",
        tools: ["claude"],
        mcpServers: ["github", "context7"],
      });

      await writeManifest(root, manifest);
      const reloaded = await readManifest(root);

      expect(reloaded).not.toBeNull();
      // mcp.servers must survive the validateManifest gate (string[] required).
      expect(reloaded!.mcp.servers).toEqual(["github", "context7"]);
      // schemaVersion drift guard: writer stamps "3.0.0"; an unhandled future
      // bump in the reader's migrate path would surface here, not silently.
      expect(reloaded!.version).toBe("3.0.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("an invalid mcp.servers shape is rejected by the real writeManifest validator (mask removed)", async () => {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-mcp-bad-"));
    try {
      const manifest = createManifest({
        platform: "github",
        owner: "acme",
        repo: "widget",
        tools: ["claude"],
        mcpServers: ["github"],
      });
      // Corrupt the mcp.servers sub-schema with a non-string entry. Under the
      // stubbed writeManifest in mcp.test.ts the mcp flow would persist this
      // silently; the REAL writer runs validateManifest (hatchJson.ts:252-253)
      // and must reject it so the bug cannot reach disk.
      (manifest as unknown as { mcp: { servers: unknown[] } }).mcp.servers = [
        42 as unknown as string,
      ];

      await expect(writeManifest(root, manifest)).rejects.toThrow(HatchError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the cliTools shape persists alongside mcp.servers in a single real round-trip", async () => {
    // Cross-check: cliToolsCommand and the mcp commands both mutate the same
    // manifest. A real round-trip carrying both sub-objects proves neither
    // sub-schema is dropped by the writer's validate-then-serialise path.
    const root = await mkdtemp(join(tmpdir(), "hatch3r-mcp-clitools-"));
    try {
      const manifest = createManifest({
        platform: "github",
        owner: "acme",
        repo: "widget",
        tools: ["claude"],
        mcpServers: ["github"],
        cliTools: { enabled: true, selected: ["ripgrep", "fd"] as never },
      });

      await writeManifest(root, manifest);
      const reloaded = await readManifest(root);

      expect(reloaded!.mcp.servers).toEqual(["github"]);
      expect(reloaded!.cliTools).toEqual({ enabled: true, selected: ["ripgrep", "fd"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
