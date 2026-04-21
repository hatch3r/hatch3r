import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildProvenanceManifest,
  writeProvenanceManifest,
  readProvenanceManifest,
  type ProvenanceManifest,
} from "../../integrity/provenance.js";
import type { AdapterOutput } from "../../types.js";

describe("provenance (C8-D12-M3)", () => {
  let rootDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "hatch3r-provenance-"));
    agentsDir = join(rootDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe("buildProvenanceManifest", () => {
    it("normalises absolute sourcePath values into repo-relative posix paths", () => {
      const absRulePath = join(agentsDir, "rules", "hatch3r-test.md");
      const outputs: AdapterOutput[] = [
        {
          path: ".cursor/rules/combined.mdc",
          content: "body",
          action: "create",
          sourceFiles: [absRulePath],
        },
      ];
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        { adapter: "cursor", outputs },
      ]);
      expect(manifest.entries.length).toBe(1);
      // The stored source path should be repo-relative (.agents/rules/...)
      // not the absolute /tmp/... path. Posix separators regardless of host.
      expect(manifest.entries[0]?.sourceFiles[0]).toBe(".agents/rules/hatch3r-test.md");
      expect(manifest.entries[0]?.adapter).toBe("cursor");
      expect(manifest.entries[0]?.path).toBe(".cursor/rules/combined.mdc");
    });

    it("sorts entries by (adapter, path) for deterministic output", () => {
      const outputs: AdapterOutput[] = [
        { path: "z-last.md", content: "z", action: "create", sourceFiles: [] },
        { path: "a-first.md", content: "a", action: "create", sourceFiles: [] },
      ];
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        { adapter: "zed", outputs: [outputs[0]!] },
        { adapter: "cursor", outputs: [outputs[1]!] },
      ]);
      // cursor sorts before zed alphabetically.
      expect(manifest.entries[0]?.adapter).toBe("cursor");
      expect(manifest.entries[1]?.adapter).toBe("zed");
    });

    it("sorts each entry's sourceFiles for stable diffs", () => {
      const outputs: AdapterOutput[] = [
        {
          path: "out.md",
          content: "body",
          action: "create",
          sourceFiles: [
            join(agentsDir, "rules", "zzz.md"),
            join(agentsDir, "rules", "aaa.md"),
          ],
        },
      ];
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        { adapter: "cursor", outputs },
      ]);
      const sources = manifest.entries[0]?.sourceFiles ?? [];
      expect(sources).toEqual([
        ".agents/rules/aaa.md",
        ".agents/rules/zzz.md",
      ]);
    });

    it("produces an empty sourceFiles list when adapter output lacks provenance", () => {
      const outputs: AdapterOutput[] = [
        { path: "no-source.json", content: "{}", action: "create" },
      ];
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        { adapter: "kiro", outputs },
      ]);
      expect(manifest.entries[0]?.sourceFiles).toEqual([]);
    });

    it("captures provenance across multiple adapters in a single manifest", () => {
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        {
          adapter: "cursor",
          outputs: [
            {
              path: ".cursor/rules/rules.mdc",
              content: "c",
              action: "create",
              sourceFiles: [join(agentsDir, "rules", "a.md")],
            },
          ],
        },
        {
          adapter: "claude",
          outputs: [
            {
              path: "CLAUDE.md",
              content: "c",
              action: "create",
              sourceFiles: [join(agentsDir, "agents", "b.md")],
            },
          ],
        },
      ]);
      expect(manifest.entries.length).toBe(2);
      expect(
        manifest.entries.find((e) => e.adapter === "cursor")?.sourceFiles[0],
      ).toBe(".agents/rules/a.md");
      expect(
        manifest.entries.find((e) => e.adapter === "claude")?.sourceFiles[0],
      ).toBe(".agents/agents/b.md");
    });
  });

  describe("write / read round trip", () => {
    it("writes a manifest that parses back to the same shape", async () => {
      const manifest = buildProvenanceManifest("1.6.0", rootDir, [
        {
          adapter: "cursor",
          outputs: [
            {
              path: ".cursor/rules/r.mdc",
              content: "body",
              action: "create",
              sourceFiles: [join(agentsDir, "rules", "x.md")],
            },
          ],
        },
      ]);
      await writeProvenanceManifest(agentsDir, manifest);
      const onDisk = await readProvenanceManifest(agentsDir);
      expect(onDisk).not.toBeNull();
      expect(onDisk?.version).toBe(1);
      expect(onDisk?.entries.length).toBe(1);
      expect(onDisk?.entries[0]?.path).toBe(".cursor/rules/r.mdc");
      expect(onDisk?.entries[0]?.sourceFiles).toEqual([".agents/rules/x.md"]);
    });

    it("writes the file atomically with trailing newline", async () => {
      const manifest: ProvenanceManifest = {
        version: 1,
        generated: "2026-04-20T00:00:00Z",
        hatchVersion: "1.6.0",
        entries: [],
      };
      await writeProvenanceManifest(agentsDir, manifest);
      const raw = await readFile(join(agentsDir, ".provenance.json"), "utf-8");
      // atomicWriteFile + explicit trailing newline for POSIX tool compat.
      expect(raw.endsWith("\n")).toBe(true);
      // JSON is pretty-printed for human diffability.
      expect(raw).toContain("\n  \"version\": 1");
    });
  });

  describe("readProvenanceManifest", () => {
    it("returns null when .provenance.json is absent", async () => {
      const onDisk = await readProvenanceManifest(agentsDir);
      expect(onDisk).toBeNull();
    });

    it("returns null when .provenance.json is malformed JSON", async () => {
      await writeFile(join(agentsDir, ".provenance.json"), "not-json{");
      const onDisk = await readProvenanceManifest(agentsDir);
      expect(onDisk).toBeNull();
    });

    it("returns null when the schema is invalid", async () => {
      await writeFile(
        join(agentsDir, ".provenance.json"),
        JSON.stringify({ version: "not-a-number" }),
      );
      const onDisk = await readProvenanceManifest(agentsDir);
      expect(onDisk).toBeNull();
    });
  });
});
