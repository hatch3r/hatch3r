import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseWindsurfRule,
  parseWindsurfLegacyRules,
  parseWindsurfRulesDir,
} from "../../importers/windsurf.js";

describe("windsurf importer", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe("parseWindsurfRule", () => {
    it("maps trigger: glob with globs to a CSV scope", () => {
      const raw = [
        "---",
        "trigger: glob",
        "globs: '**/*.test.ts'",
        "description: Test conventions",
        "---",
        "Write Arrange-Act-Assert tests.",
      ].join("\n");
      const result = parseWindsurfRule("tests.md", raw);
      expect(result.canonicalFilename).toBe("hatch3r-windsurf-import-tests.md");
      expect(result.canonical.id).toBe("hatch3r-windsurf-import-tests");
      expect(result.canonical.type).toBe("rule");
      expect(result.canonical.scope).toBe("**/*.test.ts");
      expect(result.canonical.description).toBe("Test conventions");
      expect(result.canonical.tags).toEqual(["windsurf-import"]);
      expect(result.canonical.content).toContain("Arrange-Act-Assert");
    });

    it("maps trigger: always_on to scope 'always'", () => {
      const raw = ["---", "trigger: always_on", "---", "body"].join("\n");
      expect(parseWindsurfRule("a.md", raw).canonical.scope).toBe("always");
    });

    it("yields undefined scope for trigger: manual and model_decision", () => {
      const manual = ["---", "trigger: manual", "---", "b"].join("\n");
      const model = ["---", "trigger: model_decision", "---", "b"].join("\n");
      expect(parseWindsurfRule("m.md", manual).canonical.scope).toBeUndefined();
      expect(parseWindsurfRule("d.md", model).canonical.scope).toBeUndefined();
    });

    it("supports globs as a YAML list", () => {
      const raw = [
        "---",
        "trigger: glob",
        'globs: ["src/**/*.ts", "lib/**/*.ts"]',
        "---",
        "b",
      ].join("\n");
      expect(parseWindsurfRule("g.md", raw).canonical.scope).toBe(
        "src/**/*.ts,lib/**/*.ts",
      );
    });

    it("yields undefined scope when trigger: glob has no globs", () => {
      const raw = ["---", "trigger: glob", "---", "b"].join("\n");
      expect(parseWindsurfRule("g.md", raw).canonical.scope).toBeUndefined();
    });

    it("defaults a rule with no trigger to scope 'always'", () => {
      const raw = ["---", "description: no trigger", "---", "b"].join("\n");
      expect(parseWindsurfRule("n.md", raw).canonical.scope).toBe("always");
    });

    it("ignores an unrecognised trigger value (falls back to always)", () => {
      const raw = ["---", "trigger: bogus", "---", "b"].join("\n");
      expect(parseWindsurfRule("b.md", raw).canonical.scope).toBe("always");
    });

    it("treats a file with no frontmatter as always-scope content", () => {
      const raw = "Plain rule text, no frontmatter.";
      const result = parseWindsurfRule("p.md", raw);
      expect(result.canonical.scope).toBe("always");
      expect(result.canonical.content).toBe(raw);
      expect(result.canonical.description).toBe("");
    });
  });

  describe("parseWindsurfLegacyRules", () => {
    it("maps the legacy .windsurfrules file to an always-scope rule", () => {
      const raw = "1. Always write tests.\n2. Prefer composition.";
      const result = parseWindsurfLegacyRules(raw);
      expect(result.canonical.id).toBe("hatch3r-windsurf-import-windsurfrules");
      expect(result.canonical.scope).toBe("always");
      expect(result.sourcePath).toBe(".windsurfrules");
      expect(result.canonical.content).toBe(raw);
    });
  });

  describe("parseWindsurfRulesDir", () => {
    async function makeRepo(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-windsurf-import-"));
      return tempDir;
    }

    it("discovers directory rules and the legacy file", async () => {
      const root = await makeRepo();
      const rulesDir = join(root, ".windsurf", "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, "style.md"), "---\ntrigger: always_on\n---\nStyle");
      await writeFile(
        join(rulesDir, "tests.md"),
        "---\ntrigger: glob\nglobs: '**/*.spec.ts'\n---\nTests",
      );
      await writeFile(join(root, ".windsurfrules"), "Legacy numbered rules");

      const results = await parseWindsurfRulesDir(root);
      const ids = results.map((r) => r.canonical.id);
      expect(ids).toEqual([
        "hatch3r-windsurf-import-style",
        "hatch3r-windsurf-import-tests",
        "hatch3r-windsurf-import-windsurfrules",
      ]);
      const tests = results.find((r) => r.canonical.id.endsWith("-tests"))!;
      expect(tests.canonical.scope).toBe("**/*.spec.ts");
    });

    it("ignores non-.md files in the rules directory", async () => {
      const root = await makeRepo();
      const rulesDir = join(root, ".windsurf", "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, "keep.md"), "---\ntrigger: always_on\n---\nx");
      await writeFile(join(rulesDir, "notes.txt"), "ignore");

      const results = await parseWindsurfRulesDir(root);
      expect(results.map((r) => r.canonical.id)).toEqual([
        "hatch3r-windsurf-import-keep",
      ]);
    });

    it("returns the legacy file alone when no rules dir exists", async () => {
      const root = await makeRepo();
      await writeFile(join(root, ".windsurfrules"), "legacy");
      const results = await parseWindsurfRulesDir(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.canonical.id).toBe("hatch3r-windsurf-import-windsurfrules");
    });

    it("returns an empty array when no windsurf sources exist", async () => {
      const root = await makeRepo();
      const results = await parseWindsurfRulesDir(root);
      expect(results).toEqual([]);
    });

    it("discovers .devin/rules/ (the preferred Devin Desktop path)", async () => {
      const root = await makeRepo();
      const devinDir = join(root, ".devin", "rules");
      await mkdir(devinDir, { recursive: true });
      await writeFile(join(devinDir, "style.md"), "---\ntrigger: always_on\n---\nDevin style");

      const results = await parseWindsurfRulesDir(root);
      expect(results.map((r) => r.canonical.id)).toEqual([
        "hatch3r-windsurf-import-style",
      ]);
      expect(results[0]!.canonical.content).toContain("Devin style");
    });

    it("orders .devin/rules/ before .windsurf/rules/ so the preferred copy wins downstream", async () => {
      const root = await makeRepo();
      const devinDir = join(root, ".devin", "rules");
      const windsurfDir = join(root, ".windsurf", "rules");
      await mkdir(devinDir, { recursive: true });
      await mkdir(windsurfDir, { recursive: true });
      // Same rule name in both dirs → same canonical id; .devin/ must come first
      // so the runner's first-id-wins pass adopts it and shadows the fallback.
      await writeFile(
        join(devinDir, "style.md"),
        "---\ntrigger: always_on\ndescription: from devin\n---\nDevin body",
      );
      await writeFile(
        join(windsurfDir, "style.md"),
        "---\ntrigger: always_on\ndescription: from windsurf\n---\nWindsurf body",
      );

      const results = await parseWindsurfRulesDir(root);
      // Both sources are returned (dedup is the downstream runner's job); the
      // .devin/ copy is emitted first.
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.canonical.id)).toEqual([
        "hatch3r-windsurf-import-style",
        "hatch3r-windsurf-import-style",
      ]);
      expect(results[0]!.canonical.description).toBe("from devin");
      expect(results[0]!.canonical.content).toContain("Devin body");
      expect(results[1]!.canonical.description).toBe("from windsurf");
    });

    it("discovers .devin/rules/, .windsurf/rules/, and the legacy file in precedence order", async () => {
      const root = await makeRepo();
      const devinDir = join(root, ".devin", "rules");
      const windsurfDir = join(root, ".windsurf", "rules");
      await mkdir(devinDir, { recursive: true });
      await mkdir(windsurfDir, { recursive: true });
      await writeFile(join(devinDir, "new.md"), "---\ntrigger: always_on\n---\nNew");
      await writeFile(join(windsurfDir, "old.md"), "---\ntrigger: always_on\n---\nOld");
      await writeFile(join(root, ".windsurfrules"), "Legacy body");

      const results = await parseWindsurfRulesDir(root);
      expect(results.map((r) => r.canonical.id)).toEqual([
        "hatch3r-windsurf-import-new",
        "hatch3r-windsurf-import-old",
        "hatch3r-windsurf-import-windsurfrules",
      ]);
    });
  });
});
