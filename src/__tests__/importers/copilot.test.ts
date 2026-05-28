import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseCopilotInstruction,
  parseCopilotLegacyInstructions,
  parseCopilotInstructionsDir,
} from "../../importers/copilot.js";

describe("copilot importer", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe("parseCopilotInstruction", () => {
    it("parses an instruction file with applyTo glob and description", () => {
      const raw = [
        "---",
        "name: Python Standards",
        "description: Coding conventions for Python files",
        "applyTo: '**/*.py'",
        "---",
        "Use type hints on all public functions.",
        "",
      ].join("\n");

      const result = parseCopilotInstruction("python.instructions.md", raw);
      expect(result.sourcePath).toBe("python.instructions.md");
      expect(result.canonicalFilename).toBe("hatch3r-copilot-import-python.md");
      expect(result.canonical.id).toBe("hatch3r-copilot-import-python");
      expect(result.canonical.type).toBe("rule");
      expect(result.canonical.description).toBe("Coding conventions for Python files");
      expect(result.canonical.scope).toBe("**/*.py");
      expect(result.canonical.tags).toEqual(["copilot-import"]);
      expect(result.canonical.content).toContain("Use type hints");
    });

    it("splits a comma-separated applyTo into a CSV scope", () => {
      const raw = [
        "---",
        "description: TS rules",
        "applyTo: '**/*.ts, **/*.tsx'",
        "---",
        "body",
      ].join("\n");
      const result = parseCopilotInstruction("ts.instructions.md", raw);
      expect(result.canonical.scope).toBe("**/*.ts,**/*.tsx");
    });

    it("supports applyTo as a YAML list", () => {
      const raw = [
        "---",
        'applyTo: ["src/**/*.js", "test/**/*.js"]',
        "---",
        "body",
      ].join("\n");
      const result = parseCopilotInstruction("js.instructions.md", raw);
      expect(result.canonical.scope).toBe("src/**/*.js,test/**/*.js");
    });

    it("maps a match-everything applyTo (**) to scope 'always'", () => {
      const raw = ["---", "applyTo: '**'", "---", "body"].join("\n");
      const result = parseCopilotInstruction("all.instructions.md", raw);
      expect(result.canonical.scope).toBe("always");
    });

    it("falls back to name when description is absent", () => {
      const raw = ["---", "name: My Rule", "applyTo: '**/*.go'", "---", "b"].join("\n");
      const result = parseCopilotInstruction("x.instructions.md", raw);
      expect(result.canonical.description).toBe("My Rule");
    });

    it("yields undefined scope when applyTo is absent", () => {
      const raw = ["---", "description: no scope", "---", "b"].join("\n");
      const result = parseCopilotInstruction("x.instructions.md", raw);
      expect(result.canonical.scope).toBeUndefined();
    });

    it("handles a file with no frontmatter (whole file is content)", () => {
      const raw = "Just instructions, no frontmatter.";
      const result = parseCopilotInstruction("plain.instructions.md", raw);
      expect(result.canonical.description).toBe("");
      expect(result.canonical.scope).toBeUndefined();
      expect(result.canonical.content).toBe(raw);
    });

    it("strips both .instructions.md and a bare .md extension from the id", () => {
      const raw = "x";
      expect(parseCopilotInstruction("Foo Bar.instructions.md", raw).canonical.id).toBe(
        "hatch3r-copilot-import-foo-bar",
      );
      expect(parseCopilotInstruction("baz.md", raw).canonical.id).toBe(
        "hatch3r-copilot-import-baz",
      );
    });
  });

  describe("parseCopilotLegacyInstructions", () => {
    it("maps the legacy repo file to an always-scope rule", () => {
      const raw = "# Repo instructions\n\nAlways use 2-space indent.";
      const result = parseCopilotLegacyInstructions(raw);
      expect(result.canonical.id).toBe("hatch3r-copilot-import-repo-instructions");
      expect(result.canonical.scope).toBe("always");
      expect(result.sourcePath).toBe(".github/copilot-instructions.md");
      expect(result.canonical.content).toBe(raw);
    });

    it("lifts a description from an (atypical) frontmatter block", () => {
      const raw = ["---", "description: Repo-wide", "---", "Body text"].join("\n");
      const result = parseCopilotLegacyInstructions(raw);
      expect(result.canonical.description).toBe("Repo-wide");
      expect(result.canonical.content).toBe("Body text");
    });
  });

  describe("parseCopilotInstructionsDir", () => {
    async function makeRepo(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-import-"));
      return tempDir;
    }

    it("discovers per-file instructions recursively and the legacy file", async () => {
      const root = await makeRepo();
      const instr = join(root, ".github", "instructions");
      await mkdir(join(instr, "frontend"), { recursive: true });
      await writeFile(
        join(instr, "general.instructions.md"),
        "---\napplyTo: '**'\n---\nGeneral",
      );
      await writeFile(
        join(instr, "frontend", "react.instructions.md"),
        "---\napplyTo: '**/*.tsx'\n---\nReact",
      );
      await writeFile(
        join(root, ".github", "copilot-instructions.md"),
        "Legacy repo guidance",
      );

      const results = await parseCopilotInstructionsDir(root);
      const ids = results.map((r) => r.canonical.id);
      // Per-file (path-sorted) first, then the legacy file appended last.
      expect(ids).toEqual([
        "hatch3r-copilot-import-frontend-react",
        "hatch3r-copilot-import-general",
        "hatch3r-copilot-import-repo-instructions",
      ]);
      const react = results.find((r) => r.canonical.id.endsWith("react"))!;
      expect(react.canonical.scope).toBe("**/*.tsx");
      expect(react.sourcePath).toBe("frontend/react.instructions.md");
    });

    it("ignores non-.instructions.md files and node_modules", async () => {
      const root = await makeRepo();
      const instr = join(root, ".github", "instructions");
      await mkdir(join(instr, "node_modules"), { recursive: true });
      await writeFile(join(instr, "keep.instructions.md"), "keep");
      await writeFile(join(instr, "README.md"), "ignore me");
      await writeFile(
        join(instr, "node_modules", "dep.instructions.md"),
        "ignore me too",
      );

      const results = await parseCopilotInstructionsDir(root);
      expect(results.map((r) => r.canonical.id)).toEqual([
        "hatch3r-copilot-import-keep",
      ]);
    });

    it("returns the legacy file alone when no instructions dir exists", async () => {
      const root = await makeRepo();
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(join(root, ".github", "copilot-instructions.md"), "legacy");
      const results = await parseCopilotInstructionsDir(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.canonical.id).toBe("hatch3r-copilot-import-repo-instructions");
    });

    it("returns an empty array when no copilot sources exist", async () => {
      const root = await makeRepo();
      const results = await parseCopilotInstructionsDir(root);
      expect(results).toEqual([]);
    });
  });
});
