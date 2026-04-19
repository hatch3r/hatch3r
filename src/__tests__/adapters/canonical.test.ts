import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCanonicalFiles, readCanonicalFilesDetailed } from "../../adapters/canonical.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("readCanonicalFiles", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempAgentsDir(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-canonical-"));
    return tempDir;
  }

  describe("rules", () => {
    it("should read rules from rules/ directory", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "rules");

      expect(results.length).toBe(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("test-rule");
      expect(ids).toContain("scoped-rule");
    });

    it("should parse rule frontmatter correctly", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "rules");

      const testRule = results.find((r) => r.id === "test-rule");
      expect(testRule).toBeDefined();
      expect(testRule!.type).toBe("rule");
      expect(testRule!.description).toBe("A test rule for unit testing");
      expect(testRule!.scope).toBe("always");
      expect(testRule!.content).toContain("This is a test rule");
    });

    it("should parse scoped rules correctly", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "rules");

      const scopedRule = results.find((r) => r.id === "scoped-rule");
      expect(scopedRule).toBeDefined();
      expect(scopedRule!.scope).toBe("**/*.ts");
    });

    it("should handle empty rules directory", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });

      const results = await readCanonicalFiles(dir, "rules");
      expect(results).toEqual([]);
    });

    it("should only read .md files from rules directory", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(join(dir, "rules", "valid.md"), "---\nid: valid\ntype: rule\ndescription: valid\n---\n# Valid");
      await writeFile(join(dir, "rules", "ignore.txt"), "not a markdown file");
      await writeFile(join(dir, "rules", "ignore.json"), "{}");

      const results = await readCanonicalFiles(dir, "rules");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("valid");
    });

    it("should handle files without frontmatter", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(join(dir, "rules", "no-frontmatter.md"), "# Just content\n\nNo frontmatter here.");

      const results = await readCanonicalFiles(dir, "rules");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("no-frontmatter");
      expect(results[0]!.content).toContain("Just content");
    });

    it("should derive id from filename when frontmatter id is missing", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(join(dir, "rules", "my-rule.md"), "---\ntype: rule\ndescription: no id field\n---\n# Rule");

      const results = await readCanonicalFiles(dir, "rules");
      expect(results[0]!.id).toBe("my-rule");
    });
  });

  describe("agents", () => {
    it("should read agents from agents/ directory", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "agents");

      expect(results.length).toBe(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("test-agent");
      expect(ids).toContain("readonly-agent");
      for (const r of results) {
        expect(r.type).toBe("agent");
      }
    });

    it("should include rawContent and sourcePath", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "agents");
      const testAgent = results.find((r) => r.id === "test-agent")!;

      expect(testAgent.rawContent).toContain("---");
      expect(testAgent.rawContent).toContain("id: test-agent");
      expect(testAgent.sourcePath).toMatch(/agents[\\/]test-agent\.md$/);
    });

    it("should handle empty agents directory", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "agents"), { recursive: true });

      const results = await readCanonicalFiles(dir, "agents");
      expect(results).toEqual([]);
    });
  });

  describe("skills", () => {
    it("should read skills from skills/ subdirectories with SKILL.md", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "skills");

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("test-skill");
      expect(results[0]!.type).toBe("skill");
      expect(results[0]!.description).toBe("A test skill for unit testing");
      expect(results[0]!.content).toContain("test skill workflow");
    });

    it("should skip non-directory entries in skills/", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "skills"), { recursive: true });
      await writeFile(join(dir, "skills", "not-a-dir.md"), "# Not a skill directory");

      const results = await readCanonicalFiles(dir, "skills");
      expect(results).toEqual([]);
    });

    it("should skip skill directories without SKILL.md", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "skills", "empty-skill"), { recursive: true });
      await writeFile(join(dir, "skills", "empty-skill", "README.md"), "# Not SKILL.md");

      const results = await readCanonicalFiles(dir, "skills");
      expect(results).toEqual([]);
    });

    it("should handle missing skills/ directory gracefully", async () => {
      const dir = await createTempAgentsDir();

      const results = await readCanonicalFiles(dir, "skills");
      expect(results).toEqual([]);
    });

    it("should use name from frontmatter as skill id", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "skills", "dir-name"), { recursive: true });
      await writeFile(
        join(dir, "skills", "dir-name", "SKILL.md"),
        "---\nname: frontmatter-name\ndescription: has name\n---\n# Skill",
      );

      const results = await readCanonicalFiles(dir, "skills");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("frontmatter-name");
    });
  });

  describe("commands", () => {
    it("should read commands from commands/ directory", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "commands");

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("test-command");
      expect(results[0]!.type).toBe("command");
      expect(results[0]!.description).toBe("A test command for unit testing");
    });

    it("should handle empty commands directory", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "commands"), { recursive: true });

      const results = await readCanonicalFiles(dir, "commands");
      expect(results).toEqual([]);
    });
  });

  describe("prompts", () => {
    it("should read prompts from prompts/ directory", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "prompts");

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("test-prompt");
      expect(results[0]!.type).toBe("prompt");
      expect(results[0]!.description).toBe("A test prompt");
    });

    it("should handle missing prompts/ directory gracefully", async () => {
      const dir = await createTempAgentsDir();

      const results = await readCanonicalFiles(dir, "prompts");
      expect(results).toEqual([]);
    });
  });

  describe("github-agents", () => {
    it("should read github-agents from github-agents/ directory", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "github-agents");

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("test-gh-agent");
      expect(results[0]!.type).toBe("github-agent");
      expect(results[0]!.description).toBe("A test GitHub agent");
    });

    it("should handle missing github-agents/ directory gracefully", async () => {
      const dir = await createTempAgentsDir();

      const results = await readCanonicalFiles(dir, "github-agents");
      expect(results).toEqual([]);
    });
  });

  describe("frontmatter parsing", () => {
    it("should parse all frontmatter fields", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "full.md"),
        "---\nid: full-rule\ntype: rule\ndescription: Full description\nscope: always\nname: full-rule-name\n---\n# Full Rule\n\nBody content.",
      );

      const results = await readCanonicalFiles(dir, "rules");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("full-rule");
      expect(results[0]!.description).toBe("Full description");
      expect(results[0]!.scope).toBe("always");
    });

    it("should use name as id fallback in agents", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "named-agent.md"),
        "---\nname: my-agent-name\ntype: agent\ndescription: Agent with name only\n---\n# Agent",
      );

      const results = await readCanonicalFiles(dir, "agents");
      expect(results[0]!.id).toBe("my-agent-name");
    });

    it("should handle empty frontmatter", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(join(dir, "rules", "empty-fm.md"), "---\n---\n# Empty frontmatter");

      const results = await readCanonicalFiles(dir, "rules");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("empty-fm");
    });

    it("should parse readonly and background boolean fields", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "ro-agent.md"),
        "---\nid: ro-agent\ntype: agent\ndescription: Test readonly\nreadonly: true\nbackground: true\n---\n# RO Agent",
      );

      const results = await readCanonicalFiles(dir, "agents");
      expect(results.length).toBe(1);
      const agent = results[0]!;
      expect(agent.id).toBe("ro-agent");
      expect(agent.readonly).toBe(true);
      expect(agent.background).toBe(true);
    });

    it("should preserve rawContent with frontmatter intact", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      const raw = "---\nid: raw-test\ntype: rule\ndescription: test\n---\n# Body";
      await writeFile(join(dir, "rules", "raw.md"), raw);

      const results = await readCanonicalFiles(dir, "rules");
      expect(results[0]!.rawContent).toBe(raw);
    });
  });

  describe("per-file error handling (#20)", () => {
    it.skipIf(process.platform === "win32")("should continue reading other files when one file read fails", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      // Write two valid files and one that will cause an error
      await writeFile(
        join(dir, "rules", "good-1.md"),
        "---\nid: good-1\ntype: rule\ndescription: First good rule\n---\n# Good Rule 1",
      );
      await writeFile(
        join(dir, "rules", "good-2.md"),
        "---\nid: good-2\ntype: rule\ndescription: Second good rule\n---\n# Good Rule 2",
      );
      // Create a file that will fail to read by making it unreadable
      const badPath = join(dir, "rules", "bad-file.md");
      await writeFile(badPath, "---\nid: bad\n---\n# Bad");
      await chmod(badPath, 0o000);

      const results = await readCanonicalFiles(dir, "rules");
      // Restore permissions for cleanup
      await chmod(badPath, 0o644);

      // Should still have the two good files despite the bad one
      const ids = results.map((r) => r.id);
      expect(ids).toContain("good-1");
      expect(ids).toContain("good-2");
      expect(results.length).toBe(2);
    });

    it.skipIf(process.platform === "win32")("should return empty array when all files fail to read", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      const badPath = join(dir, "rules", "unreadable.md");
      await writeFile(badPath, "---\nid: unreadable\n---\n# Unreadable");
      await chmod(badPath, 0o000);

      const results = await readCanonicalFiles(dir, "rules");
      await chmod(badPath, 0o644);

      expect(results).toEqual([]);
    });
  });

  // C7-H18: silent-null returns converted to a discriminated CanonicalReadResult
  // surfaced via the optional warnings[] channel and via readCanonicalFilesDetailed.
  describe("C7-H18 diagnostic surfacing", () => {
    it("should not push warnings for a missing directory (NOT_FOUND on dir is benign)", async () => {
      const dir = await createTempAgentsDir();
      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);
      expect(results).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it("should surface YAML_PARSE_ERROR via warnings[] channel", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      // Invalid YAML — unbalanced quotes inside frontmatter.
      const badYaml = `---\nid: bad-yaml\ntype: rule\ndescription: "unterminated\n---\n# Body`;
      await writeFile(join(dir, "rules", "bad-yaml.md"), badYaml);
      await writeFile(
        join(dir, "rules", "good.md"),
        "---\nid: good\ntype: rule\ndescription: ok\n---\n# OK",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      // Good file still parses despite bad neighbor.
      expect(results.map((r) => r.id)).toContain("good");
      // Bad YAML surfaces as a warning categorised as YAML_PARSE_ERROR.
      expect(warnings.some((w) => w.includes("YAML_PARSE_ERROR"))).toBe(true);
      expect(warnings.some((w) => w.includes("bad-yaml.md"))).toBe(true);
    });

    it("should classify YAML_PARSE_ERROR via readCanonicalFilesDetailed.error.code", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      const badYaml = `---\nid: bad-yaml\ntype: rule\ndescription: "unterminated\n---\n# Body`;
      await writeFile(join(dir, "rules", "bad-yaml.md"), badYaml);

      const detailed = await readCanonicalFilesDetailed(dir, "rules");
      const failed = detailed.find((r) => r.error);
      expect(failed).toBeDefined();
      expect(failed!.error!.code).toBe("YAML_PARSE_ERROR");
      expect(failed!.error!.message).toContain("bad-yaml.md");
      expect(failed!.canonical).toBeUndefined();
    });

    it("should produce success results with content + frontmatter + body + canonical fields", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      const raw = "---\nid: ok-rule\ntype: rule\ndescription: ok\n---\n# Body\n\nMore body.";
      await writeFile(join(dir, "rules", "ok.md"), raw);

      const detailed = await readCanonicalFilesDetailed(dir, "rules");
      expect(detailed.length).toBe(1);
      const ok = detailed[0]!;
      expect(ok.error).toBeUndefined();
      expect(ok.content).toBe(raw);
      expect(ok.frontmatter).toBeDefined();
      expect(ok.frontmatter!.id).toBe("ok-rule");
      expect(ok.body).toContain("# Body");
      expect(ok.canonical).toBeDefined();
      expect(ok.canonical!.id).toBe("ok-rule");
    });

    it.skipIf(process.platform === "win32")(
      "should classify PERMISSION_DENIED for unreadable files",
      async () => {
        const dir = await createTempAgentsDir();
        await mkdir(join(dir, "rules"), { recursive: true });
        const badPath = join(dir, "rules", "perm.md");
        await writeFile(badPath, "---\nid: perm\ntype: rule\ndescription: blocked\n---\n# X");
        await chmod(badPath, 0o000);

        const warnings: string[] = [];
        const results = await readCanonicalFiles(dir, "rules", warnings);
        const detailed = await readCanonicalFilesDetailed(dir, "rules");
        await chmod(badPath, 0o644);

        expect(results).toEqual([]);
        // The error is classified as PERMISSION_DENIED (EACCES).
        const failed = detailed.find((r) => r.error);
        expect(failed).toBeDefined();
        expect(failed!.error!.code).toBe("PERMISSION_DENIED");
        // And surfaces via the warnings channel.
        expect(warnings.some((w) => w.includes("PERMISSION_DENIED"))).toBe(true);
        expect(warnings.some((w) => w.includes("perm.md"))).toBe(true);
      },
    );

    it("should not warn about missing SKILL.md inside a skill directory (benign skip)", async () => {
      const dir = await createTempAgentsDir();
      // skills/empty/ exists but no SKILL.md inside.
      await mkdir(join(dir, "skills", "empty"), { recursive: true });

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "skills", warnings);
      expect(results).toEqual([]);
      // NOT_FOUND on a SKILL.md is treated as a benign skip.
      expect(warnings).toEqual([]);
    });

    it("should preserve existing readCanonicalFiles signature when warnings is omitted", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "ok.md"),
        "---\nid: ok\ntype: rule\ndescription: ok\n---\n# OK",
      );

      // Two-arg form (legacy) still returns CanonicalFile[].
      const results = await readCanonicalFiles(dir, "rules");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("ok");
    });
  });
});
