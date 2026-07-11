import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  importCursorRules,
  parseCursorRule,
  parseCursorRulesDir,
  slugifyCursorRuleId,
} from "../../importers/cursor.js";

describe("cursor importer (minimal parser)", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("parses a single .mdc file and emits a canonical rule", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-"));
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    await mkdir(cursorRulesDir, { recursive: true });

    const mdc = [
      "---",
      "description: Typescript style guide",
      'globs: ["**/*.ts", "**/*.tsx"]',
      "alwaysApply: false",
      "---",
      "# TypeScript Style",
      "",
      "Prefer `const` over `let` for bindings that do not reassign.",
      "",
    ].join("\n");

    await writeFile(join(cursorRulesDir, "typescript-style.mdc"), mdc, "utf-8");

    const results = await parseCursorRulesDir(cursorRulesDir);

    expect(results).toHaveLength(1);
    const only = results[0]!;
    expect(only.sourcePath).toBe("typescript-style.mdc");
    expect(only.canonicalFilename).toBe("hatch3r-cursor-import-typescript-style.md");
    expect(only.canonical.id).toBe("hatch3r-cursor-import-typescript-style");
    expect(only.canonical.type).toBe("rule");
    // D1-SA1.1-03: the 23-char source description is under validate's 60-char
    // floor, so it is synthesized above the floor while retaining the source phrase.
    expect(only.canonical.description.length).toBeGreaterThanOrEqual(60);
    expect(only.canonical.description).toContain("Typescript style guide");
    expect(only.canonical.scope).toBe("**/*.ts,**/*.tsx");
    expect(only.canonical.tags).toEqual(["cursor-import"]);
    expect(only.canonical.content).toContain("# TypeScript Style");
    expect(only.canonical.content).toContain("Prefer `const`");
  });

  it("maps alwaysApply: true to scope 'always' via parseCursorRule", () => {
    const mdc = [
      "---",
      "description: Always-on rule",
      "alwaysApply: true",
      "---",
      "Body",
    ].join("\n");
    const result = parseCursorRule("always-rule.mdc", mdc);
    expect(result.canonical.scope).toBe("always");
    // D1-SA1.1-03: short source description synthesized above the 60-char floor.
    expect(result.canonical.description.length).toBeGreaterThanOrEqual(60);
    expect(result.canonical.description).toContain("Always-on rule");
  });

  it("returns empty array when .cursor/rules directory is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-empty-"));
    const missing = join(tempDir, ".cursor", "rules");
    const results = await parseCursorRulesDir(missing);
    expect(results).toEqual([]);
  });

  it("slugifyCursorRuleId produces kebab-case slugs", () => {
    expect(slugifyCursorRuleId("My Rule.mdc")).toBe("my-rule");
    expect(slugifyCursorRuleId("rule_with_snake.mdc")).toBe("rule-with-snake");
    expect(slugifyCursorRuleId("A.B.C.mdc")).toBe("a-b-c");
  });

  // ── D1-SA1.1-01: malformed-YAML containment ────────────────────────
  it("D1-SA1.1-01: malformed YAML frontmatter is caught, not thrown, and flagged via parseError", () => {
    const malformed = ['---', 'description: "unterminated', "---", "Body text"].join("\n");
    // Must not throw — the pre-fix behavior propagated a filename-less crash.
    const result = parseCursorRule("broken.mdc", malformed);
    expect(result.parseError).toBeDefined();
    expect(result.parseError!.length).toBeGreaterThan(0);
    // No usable frontmatter → empty description + no scope → manualReview downstream.
    expect(result.canonical.description).toBe("");
    expect(result.canonical.scope).toBeUndefined();
    expect(result.sourcePath).toBe("broken.mdc");
  });

  it("D1-SA1.1-01: parseCursorRulesDir contains one malformed file and still parses siblings", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-malformed-"));
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(join(cursorRulesDir, "bad.mdc"), '---\ndescription: "oops\n---\nBad body\n', "utf-8");
    await writeFile(
      join(cursorRulesDir, "good.mdc"),
      "---\ndescription: A valid rule\nalwaysApply: true\n---\nGood body\n",
      "utf-8",
    );

    const results = await parseCursorRulesDir(cursorRulesDir);

    expect(results).toHaveLength(2);
    const bad = results.find((r) => r.sourcePath === "bad.mdc")!;
    const good = results.find((r) => r.sourcePath === "good.mdc")!;
    expect(bad.parseError).toBeDefined();
    expect(good.parseError).toBeUndefined();
    expect(good.canonical.scope).toBe("always");
  });

  it("D1-SA1.1-01: importCursorRules routes malformed to manualReview and converts siblings", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-import-mixed-"));
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(join(cursorRulesDir, "bad.mdc"), '---\ndescription: "oops\n---\nBad body\n', "utf-8");
    await writeFile(
      join(cursorRulesDir, "good.mdc"),
      "---\ndescription: A valid rule\nalwaysApply: true\n---\nGood body\n",
      "utf-8",
    );

    const summary = await importCursorRules({ rootDir: tempDir, dryRun: true });

    expect(summary.sourceFiles).toBe(2);
    expect(summary.manualReview).toHaveLength(1);
    expect(summary.manualReview[0]!.sourcePath).toBe("bad.mdc");
    expect(summary.manualReview[0]!.reason).toContain("invalid YAML frontmatter");
    expect(summary.converted).toHaveLength(1);
    expect(summary.converted[0]!.sourcePath).toBe("good.mdc");
  });

  // ── D1-SA1.1-03: description floor synthesis ───────────────────────
  it("D1-SA1.1-03: a short source description is synthesized above the 60-char validate floor", () => {
    const mdc = [
      "---",
      "description: My team rule",
      'globs: ["**/*.ts"]',
      "---",
      "# Team Rule",
      "",
      "Always run the linter before pushing.",
    ].join("\n");
    const result = parseCursorRule("team-style.mdc", mdc);
    expect(result.canonical.description.length).toBeGreaterThanOrEqual(60);
    expect(result.canonical.description).toContain("My team rule");
    // Must stay YAML-plain-scalar-safe for the raw `.mdc` companion emission.
    expect(result.canonical.description).not.toMatch(/:\s/);
    expect(result.canonical.description).not.toContain("#");
  });

  it("D1-SA1.1-03: a source description already ≥60 chars is preserved verbatim", () => {
    const longDesc =
      "This rule enforces the team TypeScript style guide across every package in the monorepo";
    const mdc = ["---", `description: ${longDesc}`, "alwaysApply: true", "---", "Body"].join("\n");
    const result = parseCursorRule("ts-style.mdc", mdc);
    expect(result.canonical.description).toBe(longDesc);
  });

  it("D1-SA1.1-03: a scope-only rule (no description) is synthesized rather than left empty", () => {
    // alwaysApply gives the rule intent, so it converts — and must clear the floor.
    const result = parseCursorRule("scope-only.mdc", "---\nalwaysApply: true\n---\nBody line here.");
    expect(result.canonical.scope).toBe("always");
    expect(result.canonical.description.length).toBeGreaterThanOrEqual(60);
  });

  it("D1-SA1.1-03: id retains the hatch3r-cursor-import- namespace (validate reconciliation is cross-file)", () => {
    // Regression guard on the unchanged id convention; the reserved-prefix
    // validate exemption lives in src/cli/commands/validate.ts (out of scope here).
    const result = parseCursorRule("x.mdc", "---\nalwaysApply: true\n---\nBody");
    expect(result.canonical.id).toBe("hatch3r-cursor-import-x");
  });
});
