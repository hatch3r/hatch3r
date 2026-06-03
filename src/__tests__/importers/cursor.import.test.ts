import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { importCursorRules } from "../../importers/cursor.js";

/**
 * Cursor import runner (Cycle 8) — conflict detection, dry-run, summary
 * reporting, and `.md` + `.mdc` companion emission under
 * `.hatch3r/overrides/rules/`. The parser itself is covered by cursor.test.ts;
 * these tests exercise `importCursorRules` end-to-end against a tmpdir.
 */
describe("cursor importer (import runner)", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  /** Create a tmp project root with the given `.cursor/rules/<name>.mdc` files. */
  async function makeProject(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-run-"));
    tempDir = root;
    const rulesDir = join(root, ".cursor", "rules");
    await mkdir(rulesDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(rulesDir, name), content, "utf-8");
    }
    return root;
  }

  const globRule = [
    "---",
    "description: Typescript style guide",
    'globs: ["**/*.ts", "**/*.tsx"]',
    "alwaysApply: false",
    "---",
    "# TypeScript Style",
    "",
    "Prefer const over let.",
    "",
  ].join("\n");

  const alwaysRule = [
    "---",
    "description: Always-on rule",
    "alwaysApply: true",
    "---",
    "Body of the always rule.",
    "",
  ].join("\n");

  const overridesRulesDir = (root: string): string =>
    join(root, ".hatch3r", "overrides", "rules");

  it("(a) clean import writes 2 files per converted rule with correct counts", async () => {
    const root = await makeProject({ "typescript-style.mdc": globRule, "always.mdc": alwaysRule });

    const summary = await importCursorRules({ rootDir: root, dryRun: false });

    expect(summary.dryRun).toBe(false);
    expect(summary.sourceFiles).toBe(2);
    expect(summary.converted).toHaveLength(2);
    expect(summary.conflicts).toHaveLength(0);
    expect(summary.manualReview).toHaveLength(0);
    // 2 files (.md + .mdc) per converted rule.
    expect(summary.written).toHaveLength(4);

    // Files actually exist on disk.
    const dir = overridesRulesDir(root);
    for (const rel of [
      "hatch3r-cursor-import-typescript-style.md",
      "hatch3r-cursor-import-typescript-style.mdc",
      "hatch3r-cursor-import-always.md",
      "hatch3r-cursor-import-always.mdc",
    ]) {
      const st = await stat(join(dir, rel));
      expect(st.isFile()).toBe(true);
    }

    // Canonical .md carries namespaced id + type rule + body.
    const md = await readFile(join(dir, "hatch3r-cursor-import-typescript-style.md"), "utf-8");
    expect(md).toContain("id: hatch3r-cursor-import-typescript-style");
    expect(md).toContain("type: rule");
    expect(md).toContain("Prefer const over let.");
  });

  it("(b) dryRun computes converted but writes nothing", async () => {
    const root = await makeProject({ "typescript-style.mdc": globRule });

    const summary = await importCursorRules({ rootDir: root, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.converted).toHaveLength(1);
    expect(summary.written).toEqual([]);

    // Nothing landed on disk.
    await expect(stat(overridesRulesDir(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("(c) id already in existingRuleIds becomes a conflict and is not written", async () => {
    const root = await makeProject({ "typescript-style.mdc": globRule });

    const summary = await importCursorRules({
      rootDir: root,
      dryRun: false,
      existingRuleIds: new Set(["hatch3r-cursor-import-typescript-style"]),
    });

    expect(summary.converted).toHaveLength(0);
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0]!.canonicalFilename).toBe(
      "hatch3r-cursor-import-typescript-style.md",
    );
    expect(summary.conflicts[0]!.reason).toContain("already exists");
    expect(summary.written).toEqual([]);
    await expect(stat(overridesRulesDir(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("(d) two files that slugify to the same id produce one conflict", async () => {
    // "my-rule.mdc" and "My Rule.mdc" both slugify to `my-rule`.
    const root = await makeProject({ "my-rule.mdc": alwaysRule, "My Rule.mdc": alwaysRule });

    const summary = await importCursorRules({ rootDir: root, dryRun: false });

    expect(summary.sourceFiles).toBe(2);
    expect(summary.converted).toHaveLength(1);
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0]!.reason).toContain("collides with another imported file");
    // Only the first (1 rule → 2 files) was written.
    expect(summary.written).toHaveLength(2);
  });

  it("(e) empty-frontmatter file goes to manualReview, not converted", async () => {
    // No frontmatter at all — empty description, no scope.
    const root = await makeProject({ "bare.mdc": "Just a body, no frontmatter.\n" });

    const summary = await importCursorRules({ rootDir: root, dryRun: false });

    expect(summary.converted).toHaveLength(0);
    expect(summary.conflicts).toHaveLength(0);
    expect(summary.manualReview).toHaveLength(1);
    expect(summary.manualReview[0]!.sourcePath).toBe("bare.mdc");
    expect(summary.manualReview[0]!.reason).toContain("empty or missing frontmatter");
    expect(summary.written).toEqual([]);
  });

  it("(f) missing .cursor/rules directory yields sourceFiles 0 and never throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-none-"));
    tempDir = root;

    const summary = await importCursorRules({ rootDir: root, dryRun: false });

    expect(summary.sourceFiles).toBe(0);
    expect(summary.converted).toEqual([]);
    expect(summary.conflicts).toEqual([]);
    expect(summary.manualReview).toEqual([]);
    expect(summary.written).toEqual([]);
  });

  it("(g) emitted .mdc has alwaysApply: true for scope 'always' and globs for glob scope", async () => {
    const root = await makeProject({ "always.mdc": alwaysRule, "typescript-style.mdc": globRule });

    await importCursorRules({ rootDir: root, dryRun: false });
    const dir = overridesRulesDir(root);

    const alwaysMdc = await readFile(join(dir, "hatch3r-cursor-import-always.mdc"), "utf-8");
    expect(alwaysMdc).toContain("alwaysApply: true");
    expect(alwaysMdc).not.toContain("globs:");
    expect(alwaysMdc).toContain("Body of the always rule.");

    const globMdc = await readFile(
      join(dir, "hatch3r-cursor-import-typescript-style.mdc"),
      "utf-8",
    );
    // The canonical cursorCompanionFrontmatter helper emits `globs: [...]` for a
    // glob scope (and `alwaysApply: true` only for "always"); no `alwaysApply`
    // line accompanies the glob case.
    expect(globMdc).toContain('globs: ["**/*.ts", "**/*.tsx"]');
    expect(globMdc).not.toContain("alwaysApply: true");
  });
});
