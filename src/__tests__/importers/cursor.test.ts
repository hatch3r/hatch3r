import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
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
    expect(only.canonical.description).toBe("Typescript style guide");
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
    expect(result.canonical.description).toBe("Always-on rule");
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
});
