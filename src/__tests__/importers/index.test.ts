import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  IMPORT_FORMATS,
  importFormat,
  importAllFormats,
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
