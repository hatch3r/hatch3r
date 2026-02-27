import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCanonicalFiles } from "../../adapters/canonical.js";
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

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("test-agent");
      expect(results[0]!.type).toBe("agent");
      expect(results[0]!.description).toBe("A test agent for unit testing");
    });

    it("should include rawContent and sourcePath", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "agents");

      expect(results[0]!.rawContent).toContain("---");
      expect(results[0]!.rawContent).toContain("id: test-agent");
      // Cross-platform: Windows uses backslashes, Unix uses forward slashes
      expect(results[0]!.sourcePath).toMatch(/agents[\\/]test-agent\.md$/);
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

    it("should preserve rawContent with frontmatter intact", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      const raw = "---\nid: raw-test\ntype: rule\ndescription: test\n---\n# Body";
      await writeFile(join(dir, "rules", "raw.md"), raw);

      const results = await readCanonicalFiles(dir, "rules");
      expect(results[0]!.rawContent).toBe(raw);
    });
  });
});
