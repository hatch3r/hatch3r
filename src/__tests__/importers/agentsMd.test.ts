import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AGENTS_MD_FILENAMES,
  parseAgentsMd,
  parseAgentsMdFile,
} from "../../importers/agentsMd.js";
import { runImport } from "../../importers/index.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import {
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START_YAML,
  MANAGED_BLOCK_END_YAML,
} from "../../types.js";

describe("agents (root AGENTS.md) importer", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function makeRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-agents-import-"));
    return tempDir;
  }

  describe("parseAgentsMd", () => {
    it("maps a plain AGENTS.md body to one always-scope rule", () => {
      const raw = "## Build\nRun `npm test` before committing.\n\n## Style\nPrefer const.";
      const result = parseAgentsMd("AGENTS.md", raw);
      expect(result).not.toBeNull();
      expect(result!.canonical.id).toBe("hatch3r-agents-import");
      expect(result!.canonicalFilename).toBe("hatch3r-agents-import.md");
      expect(result!.canonical.type).toBe("rule");
      expect(result!.canonical.scope).toBe("always");
      expect(result!.canonical.tags).toEqual(["agents-import"]);
      expect(result!.canonical.content).toBe(raw);
      expect(result!.canonical.description).toBe("");
      expect(result!.sourcePath).toBe("AGENTS.md");
    });

    it("maps the AGENT.md singular alias to the same canonical id", () => {
      const result = parseAgentsMd("AGENT.md", "Alias body");
      expect(result).not.toBeNull();
      expect(result!.canonical.id).toBe("hatch3r-agents-import");
      expect(result!.sourcePath).toBe("AGENT.md");
      expect(result!.canonical.sourcePath).toBe("AGENT.md");
    });

    it("lifts a description from an (atypical) frontmatter block", () => {
      const raw = ["---", "description: Project agent guide", "---", "Body rules here"].join("\n");
      const result = parseAgentsMd("AGENTS.md", raw);
      expect(result).not.toBeNull();
      expect(result!.canonical.description).toBe("Project agent guide");
      expect(result!.canonical.content).toBe("Body rules here");
      expect(result!.canonical.scope).toBe("always");
    });

    it("throws on a present-but-invalid YAML frontmatter block", () => {
      const raw = ["---", "description: [unclosed", "---", "Body"].join("\n");
      expect(() => parseAgentsMd("AGENTS.md", raw)).toThrow();
    });

    it("skips (returns null for) a hatch3r-emitted file carrying a managed block", () => {
      const raw = [
        "# My repo",
        MANAGED_BLOCK_START,
        "hatch3r floor summary — generated content",
        MANAGED_BLOCK_END,
      ].join("\n");
      expect(parseAgentsMd("AGENTS.md", raw)).toBeNull();
    });

    it("skips a managed block in the YAML marker variant too", () => {
      const raw = [MANAGED_BLOCK_START_YAML, "generated", MANAGED_BLOCK_END_YAML].join("\n");
      expect(parseAgentsMd("AGENTS.md", raw)).toBeNull();
    });

    it("does NOT skip a file that merely quotes a marker mid-line", () => {
      // Marker detection is line-anchored: a prose mention is not a managed block.
      const raw = `Docs note: hatch3r wraps output in ${MANAGED_BLOCK_START} markers.\nReal instructions.`;
      const result = parseAgentsMd("AGENTS.md", raw);
      expect(result).not.toBeNull();
      expect(result!.canonical.content).toBe(raw);
    });

    it("returns null for empty and whitespace-only input", () => {
      expect(parseAgentsMd("AGENTS.md", "")).toBeNull();
      expect(parseAgentsMd("AGENTS.md", "  \n\t\n")).toBeNull();
    });

    it("returns null for a frontmatter-only file with no instruction body", () => {
      const raw = ["---", "description: No body", "---", ""].join("\n");
      expect(parseAgentsMd("AGENTS.md", raw)).toBeNull();
    });
  });

  describe("parseAgentsMdFile", () => {
    it("reads the AGENTS.md file at the repo root", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Root agent instructions");
      const results = await parseAgentsMdFile(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.canonical.id).toBe("hatch3r-agents-import");
      expect(results[0]!.canonical.content).toBe("Root agent instructions");
      expect(results[0]!.sourcePath).toBe("AGENTS.md");
    });

    it("reads the AGENT.md alias when AGENTS.md is absent", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENT.md"), "Alias instructions");
      const results = await parseAgentsMdFile(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.sourcePath).toBe("AGENT.md");
    });

    it("yields both files when both exist — AGENTS.md first, same id, so the runner conflicts the alias", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Standard file");
      await writeFile(join(root, "AGENT.md"), "Alias file");
      const results = await parseAgentsMdFile(root);
      expect(results.map((r) => r.sourcePath)).toEqual([...AGENTS_MD_FILENAMES]);
      expect(new Set(results.map((r) => r.canonical.id)).size).toBe(1);
    });

    it("returns an empty array when neither file exists", async () => {
      const root = await makeRepo();
      expect(await parseAgentsMdFile(root)).toEqual([]);
    });

    it("skips a hatch3r-emitted AGENTS.md but still imports a user AGENT.md beside it", async () => {
      const root = await makeRepo();
      await writeFile(
        join(root, "AGENTS.md"),
        [MANAGED_BLOCK_START, "generated payload", MANAGED_BLOCK_END].join("\n"),
      );
      await writeFile(join(root, "AGENT.md"), "User-authored alias");
      const results = await parseAgentsMdFile(root);
      expect(results).toHaveLength(1);
      expect(results[0]!.sourcePath).toBe("AGENT.md");
    });

    it("returns [] when the only AGENTS.md is hatch3r's own emission", async () => {
      const root = await makeRepo();
      await writeFile(
        join(root, "AGENTS.md"),
        [MANAGED_BLOCK_START, "generated payload", MANAGED_BLOCK_END].join("\n"),
      );
      expect(await parseAgentsMdFile(root)).toEqual([]);
    });

    it("returns [] for a whitespace-only AGENTS.md", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "   \n\n");
      expect(await parseAgentsMdFile(root)).toEqual([]);
    });
  });

  describe("runner integration (--import agents)", () => {
    const overridesRulesDir = (root: string): string =>
      join(root, ".hatch3r", "overrides", "rules");

    it("runImport agents writes .md + .mdc for a root AGENTS.md", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Repo-wide agent guidance");

      const [summary] = await runImport({ rootDir: root, target: "agents", dryRun: false });
      expect(summary!.format).toBe("agents");
      expect(summary!.sourceFiles).toBe(1);
      expect(summary!.converted).toHaveLength(1);
      expect(summary!.written).toHaveLength(2);

      const dir = overridesRulesDir(root);
      const md = await readFile(join(dir, "hatch3r-agents-import.md"), "utf-8");
      expect(md).toContain("id: hatch3r-agents-import");
      expect(md).toContain("type: rule");
      expect(md).toContain("scope: always");
      expect(md).toContain("Repo-wide agent guidance");
      // .mdc companion: always scope → alwaysApply.
      const mdc = await readFile(join(dir, "hatch3r-agents-import.mdc"), "utf-8");
      expect(mdc).toContain("alwaysApply: true");
    });

    it("both files present → AGENTS.md converts, AGENT.md is an intra-import conflict", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Standard file");
      await writeFile(join(root, "AGENT.md"), "Alias file");

      const [summary] = await runImport({ rootDir: root, target: "agents", dryRun: false });
      expect(summary!.sourceFiles).toBe(2);
      expect(summary!.converted).toHaveLength(1);
      expect(summary!.converted[0]!.sourcePath).toBe("AGENTS.md");
      expect(summary!.conflicts).toHaveLength(1);
      expect(summary!.conflicts[0]!.sourcePath).toBe("AGENT.md");
      expect(summary!.conflicts[0]!.reason).toContain("collides");

      const st = await stat(join(overridesRulesDir(root), "hatch3r-agents-import.md"));
      expect(st.isFile()).toBe(true);
    });

    it("a hatch3r-emitted AGENTS.md produces an empty run, not a re-import", async () => {
      const root = await makeRepo();
      await writeFile(
        join(root, "AGENTS.md"),
        [MANAGED_BLOCK_START, "generated payload", MANAGED_BLOCK_END].join("\n"),
      );
      const [summary] = await runImport({ rootDir: root, target: "agents", dryRun: false });
      expect(summary!.sourceFiles).toBe(0);
      expect(summary!.written).toEqual([]);
      await expect(stat(overridesRulesDir(root))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("TOOL_INDICATORS registration guard (D14-SA14.4-03)", () => {
    it("an AGENTS.md-only repo never leaks a non-adapter value into existingTools", async () => {
      // RepoInfo.existingTools is Tool[] and init assigns it directly to the
      // adapter tools selection — the "agents" indicator must be filtered out.
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Agent instructions");
      const info = await analyzeRepo(root);
      expect(info.existingTools).toEqual([]);
    });

    it("adapter-tool detection is unaffected by the agents indicator", async () => {
      const root = await makeRepo();
      await writeFile(join(root, "AGENTS.md"), "Agent instructions");
      await writeFile(join(root, "CLAUDE.md"), "Claude config");
      const info = await analyzeRepo(root);
      expect(info.existingTools).toEqual(["claude"]);
    });
  });
});
