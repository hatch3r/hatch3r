import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseAwesomeCursorrules,
  parseAwesomeCursorrulesFile,
} from "../../importers/awesomeCursorrules.js";

describe("awesome-cursorrules importer", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe("parseAwesomeCursorrules", () => {
    it("maps a plain .cursorrules body to an always-scope rule", () => {
      const raw = "You are an expert TypeScript engineer.\nPrefer const over let.";
      const result = parseAwesomeCursorrules(raw);
      expect(result.canonical.id).toBe("hatch3r-cursorrules-import");
      expect(result.canonicalFilename).toBe("hatch3r-cursorrules-import.md");
      expect(result.canonical.type).toBe("rule");
      expect(result.canonical.scope).toBe("always");
      expect(result.canonical.tags).toEqual(["cursorrules-import"]);
      expect(result.canonical.content).toBe(raw);
      expect(result.canonical.description).toBe("");
      expect(result.sourcePath).toBe(".cursorrules");
    });

    it("lifts a description from an (atypical) frontmatter block", () => {
      const raw = ["---", "description: My stack", "---", "Body rules here"].join("\n");
      const result = parseAwesomeCursorrules(raw);
      expect(result.canonical.description).toBe("My stack");
      expect(result.canonical.content).toBe("Body rules here");
      expect(result.canonical.scope).toBe("always");
    });
  });

  describe("parseAwesomeCursorrulesFile", () => {
    async function makeRepo(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursorrules-import-"));
      return tempDir;
    }

    it("reads the .cursorrules file at the repo root", async () => {
      const root = await makeRepo();
      await writeFile(join(root, ".cursorrules"), "Rule body");
      const results = await parseAwesomeCursorrulesFile(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.canonical.id).toBe("hatch3r-cursorrules-import");
      expect(results[0]!.canonical.content).toBe("Rule body");
    });

    it("returns an empty array when .cursorrules is absent", async () => {
      const root = await makeRepo();
      const results = await parseAwesomeCursorrulesFile(root);
      expect(results).toEqual([]);
    });

    it("returns an empty array when .cursorrules is a directory", async () => {
      const root = await makeRepo();
      // The modern format uses a .cursor/ dir; a `.cursorrules` directory is
      // not the legacy single file, so it must be skipped (EISDIR).
      await mkdir(join(root, ".cursorrules"), { recursive: true });
      const results = await parseAwesomeCursorrulesFile(root);
      expect(results).toEqual([]);
    });
  });
});
