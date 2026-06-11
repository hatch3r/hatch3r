import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  IMPORT_FORMATS,
  IMPORT_TARGETS,
  importFormat,
  importAllFormats,
  runImport,
  runFormatImport,
  resolveImportTargets,
  type ImportFormat,
} from "../../importers/index.js";

describe("importers aggregator", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function makeRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-import-all-"));
    return tempDir;
  }

  it("exposes exactly the four supported formats", () => {
    expect([...IMPORT_FORMATS]).toEqual(["cursor", "copilot", "windsurf", "cursorrules"]);
  });

  it("importFormat reads cursor .mdc rules", async () => {
    const root = await makeRepo();
    const cursorRules = join(root, ".cursor", "rules");
    await mkdir(cursorRules, { recursive: true });
    await writeFile(
      join(cursorRules, "style.mdc"),
      "---\nalwaysApply: true\n---\nStyle rules",
    );
    const rules = await importFormat(root, "cursor");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.canonical.id).toBe("hatch3r-cursor-import-style");
    expect(rules[0]!.canonical.scope).toBe("always");
  });

  it("importFormat returns [] for a format with no sources", async () => {
    const root = await makeRepo();
    for (const fmt of IMPORT_FORMATS) {
      expect(await importFormat(root, fmt)).toEqual([]);
    }
  });

  it("importAllFormats groups results by source format", async () => {
    const root = await makeRepo();

    // cursor
    const cursorRules = join(root, ".cursor", "rules");
    await mkdir(cursorRules, { recursive: true });
    await writeFile(join(cursorRules, "a.mdc"), "---\nalwaysApply: true\n---\nA");
    // copilot (legacy)
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, ".github", "copilot-instructions.md"), "Repo guidance");
    // windsurf (legacy)
    await writeFile(join(root, ".windsurfrules"), "Numbered rules");
    // awesome-cursorrules
    await writeFile(join(root, ".cursorrules"), "Legacy cursorrules");

    const grouped = await importAllFormats(root);
    expect(grouped.map((g) => g.format)).toEqual([
      "cursor",
      "copilot",
      "windsurf",
      "cursorrules",
    ]);

    const byFormat = new Map<ImportFormat, number>(
      grouped.map((g) => [g.format, g.rules.length]),
    );
    expect(byFormat.get("cursor")).toBe(1);
    expect(byFormat.get("copilot")).toBe(1);
    expect(byFormat.get("windsurf")).toBe(1);
    expect(byFormat.get("cursorrules")).toBe(1);

    // Every imported rule carries a distinct namespaced id.
    const allIds = grouped.flatMap((g) => g.rules.map((r) => r.canonical.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toContain("hatch3r-cursor-import-a");
    expect(allIds).toContain("hatch3r-copilot-import-repo-instructions");
    expect(allIds).toContain("hatch3r-windsurf-import-windsurfrules");
    expect(allIds).toContain("hatch3r-cursorrules-import");
  });

  it("importAllFormats yields empty rule arrays for an unconfigured repo", async () => {
    const root = await makeRepo();
    const grouped = await importAllFormats(root);
    expect(grouped).toHaveLength(4);
    expect(grouped.every((g) => g.rules.length === 0)).toBe(true);
  });
});

describe("import runner (runImport / runFormatImport)", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function makeRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-run-import-"));
    return tempDir;
  }

  const overridesRulesDir = (root: string): string =>
    join(root, ".hatch3r", "overrides", "rules");

  it("IMPORT_TARGETS is the four formats plus auto, in order", () => {
    expect([...IMPORT_TARGETS]).toEqual([
      "cursor",
      "copilot",
      "windsurf",
      "cursorrules",
      "auto",
    ]);
  });

  it("resolveImportTargets expands auto to every format and a concrete format to itself", () => {
    expect([...resolveImportTargets("auto")]).toEqual([...IMPORT_FORMATS]);
    expect([...resolveImportTargets("windsurf")]).toEqual(["windsurf"]);
  });

  it("runImport copilot writes .md + .mdc for the legacy repo-instructions file", async () => {
    const root = await makeRepo();
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, ".github", "copilot-instructions.md"), "Repo guidance");

    const [summary] = await runImport({ rootDir: root, target: "copilot", dryRun: false });
    expect(summary!.format).toBe("copilot");
    expect(summary!.sourceFiles).toBe(1);
    expect(summary!.converted).toHaveLength(1);
    expect(summary!.written).toHaveLength(2);

    const dir = overridesRulesDir(root);
    const md = await readFile(join(dir, "hatch3r-copilot-import-repo-instructions.md"), "utf-8");
    expect(md).toContain("id: hatch3r-copilot-import-repo-instructions");
    expect(md).toContain("type: rule");
    expect(md).toContain("Repo guidance");
    // .mdc companion: legacy file is always-apply.
    const mdc = await readFile(join(dir, "hatch3r-copilot-import-repo-instructions.mdc"), "utf-8");
    expect(mdc).toContain("alwaysApply: true");
  });

  it("runImport windsurf writes the legacy .windsurfrules rule to disk", async () => {
    const root = await makeRepo();
    await writeFile(join(root, ".windsurfrules"), "Numbered windsurf rules");

    const [summary] = await runImport({ rootDir: root, target: "windsurf", dryRun: false });
    expect(summary!.converted).toHaveLength(1);
    const st = await stat(join(overridesRulesDir(root), "hatch3r-windsurf-import-windsurfrules.md"));
    expect(st.isFile()).toBe(true);
  });

  it("runImport dryRun classifies but writes nothing", async () => {
    const root = await makeRepo();
    await writeFile(join(root, ".cursorrules"), "Legacy cursorrules body");

    const [summary] = await runImport({ rootDir: root, target: "cursorrules", dryRun: true });
    expect(summary!.converted).toHaveLength(1);
    expect(summary!.written).toEqual([]);
    await expect(stat(overridesRulesDir(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runImport auto runs every format and writes a distinct file per source", async () => {
    const root = await makeRepo();
    // one source per format
    const cursorRules = join(root, ".cursor", "rules");
    await mkdir(cursorRules, { recursive: true });
    await writeFile(join(cursorRules, "a.mdc"), "---\nalwaysApply: true\n---\nA body");
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, ".github", "copilot-instructions.md"), "Copilot guidance");
    await writeFile(join(root, ".windsurfrules"), "Windsurf body");
    await writeFile(join(root, ".cursorrules"), "Cursorrules body");

    const results = await runImport({ rootDir: root, target: "auto", dryRun: false });
    expect(results.map((r) => r.format)).toEqual([
      "cursor",
      "copilot",
      "windsurf",
      "cursorrules",
    ]);
    // 1 converted per format → 2 files (.md + .mdc) per format → 8 files total.
    const totalWritten = results.reduce((acc, r) => acc + r.written.length, 0);
    expect(totalWritten).toBe(8);
    for (const id of [
      "hatch3r-cursor-import-a",
      "hatch3r-copilot-import-repo-instructions",
      "hatch3r-windsurf-import-windsurfrules",
      "hatch3r-cursorrules-import",
    ]) {
      const st = await stat(join(overridesRulesDir(root), `${id}.md`));
      expect(st.isFile()).toBe(true);
    }
  });

  it("runImport seeds existingRuleIds so a pre-existing id becomes a conflict, not an overwrite", async () => {
    const root = await makeRepo();
    await writeFile(join(root, ".cursorrules"), "Cursorrules body");

    const results = await runImport({
      rootDir: root,
      target: "cursorrules",
      dryRun: false,
      existingRuleIds: new Set(["hatch3r-cursorrules-import"]),
    });
    expect(results[0]!.converted).toHaveLength(0);
    expect(results[0]!.conflicts).toHaveLength(1);
    expect(results[0]!.conflicts[0]!.reason).toContain("already exists");
    expect(results[0]!.written).toEqual([]);
  });

  it("runFormatImport routes empty-frontmatter rules to manualReview", async () => {
    const root = await makeRepo();
    // A cursor rule with no frontmatter → empty description, no scope.
    const cursorRules = join(root, ".cursor", "rules");
    await mkdir(cursorRules, { recursive: true });
    await writeFile(join(cursorRules, "bare.mdc"), "Just a body, no frontmatter.\n");

    const rules = await importFormat(root, "cursor");
    const summary = await runFormatImport({ rootDir: root, format: "cursor", rules, dryRun: false });
    expect(summary.converted).toHaveLength(0);
    expect(summary.manualReview).toHaveLength(1);
    expect(summary.manualReview[0]!.reason).toContain("empty or missing frontmatter");
    expect(summary.written).toEqual([]);
  });

  it("runImport on an unconfigured repo yields one empty summary per covered format", async () => {
    const root = await makeRepo();
    const results = await runImport({ rootDir: root, target: "auto", dryRun: false });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.sourceFiles === 0 && r.written.length === 0)).toBe(true);
    await expect(stat(overridesRulesDir(root))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
