import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  filterUserFacing,
  readCanonicalFiles,
  readCanonicalFilesDetailed,
  precedenceRank,
  sortByPrecedence,
} from "../../adapters/canonical.js";
import type { CanonicalFile } from "../../types.js";
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
    it("should read agents from agents/ directory (including subdirectories)", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "agents");

      // The raw read is recursive by design so subdirectory companion
      // content (modes, shared reference) remains readable by parent
      // commands. Adapter filtering (`filterUserFacing`) happens later
      // at the emission layer.
      const ids = results.map((r) => r.id);
      expect(ids).toContain("test-agent");
      expect(ids).toContain("readonly-agent");
      expect(ids).toContain("fake-mode");
      expect(ids).toContain("fake-reference");
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
    it("should read commands from commands/ directory (including subdirectories)", async () => {
      const results = await readCanonicalFiles(FIXTURES_DIR, "commands");

      // The raw read is recursive by design. The filter fixtures
      // (`pickup-fake` in a subdir, `hatch3r-fake-shared` with type
      // `shared-context`) appear here but are stripped by the per-adapter
      // `filterUserFacing` step.
      const ids = results.map((r) => r.id);
      expect(ids).toContain("test-command");
      expect(ids).toContain("pickup-fake");
      expect(ids).toContain("hatch3r-fake-shared");
      const primary = results.find((r) => r.id === "test-command")!;
      expect(primary.type).toBe("command");
      expect(primary.description).toBe("A test command for unit testing");
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

  // C7.5-W2B2-H8 (D2-SA2.2-2): frontmatter type-mismatch surfacing.
  // Pre-fix, `id: 123` or `tags: "foo,bar"` silently collapsed to empty
  // string / dropped without warning, falling back to path-derived id.
  // Adversarial canonical content could exploit this for id manipulation.
  describe("C7.5-W2B2-H8 frontmatter type-mismatch diagnostics", () => {
    it("surfaces TYPE_MISMATCH when id is a number", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "numeric-id.md"),
        "---\nid: 12345\ntype: rule\ndescription: numeric id\n---\n# Body",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      // File still loads (id falls back to filename-derived form).
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("numeric-id");
      // Warning surfaces the type mismatch.
      expect(warnings.some((w) => w.includes("TYPE_MISMATCH") && w.includes("id field"))).toBe(true);
      expect(warnings.some((w) => w.includes("got number"))).toBe(true);
    });

    it("surfaces TYPE_MISMATCH when id is an array", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "array-id.md"),
        "---\nid: [a, b, c]\ntype: rule\ndescription: array id\n---\n# Body",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("array-id");
      expect(warnings.some((w) => w.includes("TYPE_MISMATCH") && w.includes("id field") && w.includes("got array"))).toBe(true);
    });

    it("surfaces TYPE_MISMATCH when description is a boolean", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "bool-desc.md"),
        "---\nid: bool-desc\ntype: rule\ndescription: true\n---\n# Body",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      expect(results.length).toBe(1);
      expect(warnings.some((w) => w.includes("description field") && w.includes("got boolean"))).toBe(true);
    });

    it("surfaces TYPE_MISMATCH when tags is a string (not an array)", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "string-tags.md"),
        '---\nid: string-tags\ntype: rule\ndescription: tags as string\ntags: "foo,bar"\n---\n# Body',
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      expect(results.length).toBe(1);
      expect(warnings.some((w) => w.includes("tags field") && w.includes("got string"))).toBe(true);
    });

    it("does not warn when all fields have correct types", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "well-typed.md"),
        "---\nid: well-typed\ntype: rule\ndescription: proper strings\ntags: [a, b]\n---\n# Body",
      );

      const warnings: string[] = [];
      await readCanonicalFiles(dir, "rules", warnings);

      expect(warnings.some((w) => w.includes("TYPE_MISMATCH"))).toBe(false);
    });

    it("collects multiple mismatches for a single file", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "multi-mismatch.md"),
        "---\nid: 1\ntype: [wrong]\ndescription: 2.5\n---\n# Body",
      );

      const warnings: string[] = [];
      await readCanonicalFiles(dir, "rules", warnings);

      const typeMismatchCount = warnings.filter((w) => w.includes("TYPE_MISMATCH")).length;
      expect(typeMismatchCount).toBeGreaterThanOrEqual(3);
    });
  });

  // C7.5-W2B2-H43 (D15-F15.1-02): promptGuard wired into canonical read
  // path. Advisory structural-injection scanning for null bytes, ANSI
  // escapes, chat template tokens, and tool delimiters.
  describe("C7.5-W2B2-H43 promptGuard advisory scan on canonical body", () => {
    it("warns when canonical body contains a null byte", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "nullbyte.md"),
        "---\nid: nullbyte\ntype: rule\ndescription: has nul\n---\nNormal\x00hidden",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      // File still loads — advisory only.
      expect(results.length).toBe(1);
      expect(warnings.some((w) => w.includes("promptGuard") && w.toLowerCase().includes("null byte"))).toBe(true);
    });

    it("warns when canonical body contains chat template injection tokens", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "chat-tokens.md"),
        "---\nid: chat-tokens\ntype: rule\ndescription: has tokens\n---\nNormal [INST] bad [/INST]",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      expect(results.length).toBe(1);
      expect(warnings.some((w) => w.includes("promptGuard") && w.includes("chat template"))).toBe(true);
    });

    it("does not flag legitimate Handlebars-style {{placeholder}} in canonical body", async () => {
      // Handlebars examples in rules/hatch3r-i18n.md and similar files
      // must NOT trigger promptGuard warnings — the narrow scan excludes
      // the template-literal pattern that generates false positives.
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "handlebars.md"),
        "---\nid: handlebars\ntype: rule\ndescription: ok\n---\nUse {{ project_name }} as a variable.",
      );

      const warnings: string[] = [];
      const results = await readCanonicalFiles(dir, "rules", warnings);

      expect(results.length).toBe(1);
      expect(warnings.some((w) => w.includes("promptGuard"))).toBe(false);
    });

    it("does not flag role-colon line markers in canonical body", async () => {
      // Pattern `user:` at end of line is in the general pipeline guard
      // but excluded from the canonical scan — legitimate protocol-style
      // documentation uses these.
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "role-doc.md"),
        "---\nid: role-doc\ntype: rule\ndescription: ok\n---\nExample format:\nsystem:\nassistant:\n",
      );

      const warnings: string[] = [];
      await readCanonicalFiles(dir, "rules", warnings);

      expect(warnings.some((w) => w.includes("promptGuard"))).toBe(false);
    });
  });

  // C8-D2-M3 (D2-SA2.2-3): CanonicalType extended to cover every on-disk
  // `.agents/{dir}/` directory with frontmatter-bearing markdown — not just
  // the original 6. The glob reader is unchanged; only new discriminants
  // and READER_CONFIGS entries were added. These tests lock in that
  // `hooks`, `checks`, `policy`, and `learnings` load through the same
  // discriminated read/warn pipeline and that CanonicalFile.type carries
  // the matching singular literal.
  describe("C8-D2-M3 CanonicalType extensions", () => {
    it("reads hook files via CanonicalType=hooks", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "hooks"), { recursive: true });
      await writeFile(
        join(dir, "hooks", "session-start.md"),
        "---\nid: session-start\ntype: hook\ndescription: Session start hook\n---\n# Hook\n",
      );

      const results = await readCanonicalFiles(dir, "hooks");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("session-start");
      expect(results[0]!.type).toBe("hook");
      expect(results[0]!.description).toBe("Session start hook");
    });

    it("reads checks files via CanonicalType=checks", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "checks"), { recursive: true });
      await writeFile(
        join(dir, "checks", "accessibility.md"),
        "---\nid: accessibility\ntype: check\ndescription: WCAG 2.2 AA coverage\n---\n# Accessibility\n",
      );

      const results = await readCanonicalFiles(dir, "checks");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("accessibility");
      expect(results[0]!.type).toBe("check");
    });

    it("reads policy files via CanonicalType=policy", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "policy"), { recursive: true });
      await writeFile(
        join(dir, "policy", "deny-list.md"),
        "---\nid: deny-list\ntype: policy\ndescription: Deny-list guardrails\n---\n# Policy\n",
      );

      const results = await readCanonicalFiles(dir, "policy");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("deny-list");
      expect(results[0]!.type).toBe("policy");
    });

    it("reads learnings files via CanonicalType=learnings", async () => {
      const dir = await createTempAgentsDir();
      await mkdir(join(dir, "learnings"), { recursive: true });
      await writeFile(
        join(dir, "learnings", "session-1.md"),
        "---\nid: session-1\ntype: learning\ndescription: Observed pitfall\n---\n# Learning\n",
      );

      const results = await readCanonicalFiles(dir, "learnings");
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe("session-1");
      expect(results[0]!.type).toBe("learning");
    });

    it("handles missing hooks/checks/policy/learnings directories gracefully", async () => {
      const dir = await createTempAgentsDir();
      // None of the directories exist; each call must return [] with no warning.
      for (const type of ["hooks", "checks", "policy", "learnings"] as const) {
        const warnings: string[] = [];
        const results = await readCanonicalFiles(dir, type, warnings);
        expect(results).toEqual([]);
        // NOT_FOUND on the directory itself is benign and emits no warning
        // (same contract as rules/agents/prompts/github-agents).
        expect(warnings).toEqual([]);
      }
    });

    it.skipIf(process.platform === "win32")("skips symbolic links in extended directories", async () => {
      const dir = await createTempAgentsDir();
      const { symlink } = await import("node:fs/promises");
      await mkdir(join(dir, "hooks"), { recursive: true });
      // Real file — should load.
      await writeFile(
        join(dir, "hooks", "real.md"),
        "---\nid: real-hook\ntype: hook\ndescription: Real hook\n---\n# Real\n",
      );
      // Symlink pointing at the real file — should be skipped by the existing
      // lstat-gate in readSingleMd (no infinite-recursion risk, no duplicate).
      await symlink(join(dir, "hooks", "real.md"), join(dir, "hooks", "link.md"));

      const results = await readCanonicalFiles(dir, "hooks");
      const ids = results.map((r) => r.id);
      expect(ids).toContain("real-hook");
      // The symlink path is skipped — not duplicated.
      expect(ids.filter((id) => id === "real-hook").length).toBe(1);
    });
  });
});

// Wave A1: rule precedence helpers. These back the future Wave B adapter
// ordering logic. Schema + helper land here; no rule file carries
// precedence yet, so the parser path is covered with an inline temp file.
describe("precedenceRank", () => {
  it("returns the documented ranks for each enum value", () => {
    expect(precedenceRank("critical")).toBe(100);
    expect(precedenceRank("high")).toBe(300);
    expect(precedenceRank("normal")).toBe(500);
    expect(precedenceRank("low")).toBe(700);
  });

  it("falls back to normal rank when value is undefined", () => {
    expect(precedenceRank(undefined)).toBe(500);
  });

  it("falls back to normal rank for unknown values", () => {
    expect(precedenceRank("urgent")).toBe(500);
    expect(precedenceRank("")).toBe(500);
  });
});

describe("sortByPrecedence", () => {
  it("sorts by rank ascending (higher priority first)", () => {
    const input = [
      { id: "b", precedence: "low" },
      { id: "a", precedence: "critical" },
      { id: "c", precedence: "normal" },
      { id: "d", precedence: "high" },
    ];
    const sorted = sortByPrecedence(input);
    expect(sorted.map((x) => x.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("tie-breaks on id alphabetical within the same bucket", () => {
    const input = [
      { id: "zeta", precedence: "high" },
      { id: "alpha", precedence: "high" },
      { id: "mu", precedence: "high" },
    ];
    const sorted = sortByPrecedence(input);
    expect(sorted.map((x) => x.id)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("treats absent precedence as normal for ordering", () => {
    const input = [
      { id: "noPrec" }, // normal (500)
      { id: "lowItem", precedence: "low" },
      { id: "critItem", precedence: "critical" },
    ];
    const sorted = sortByPrecedence(input);
    expect(sorted.map((x) => x.id)).toEqual(["critItem", "noPrec", "lowItem"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "b", precedence: "low" },
      { id: "a", precedence: "critical" },
    ];
    const snapshot = input.map((x) => ({ ...x }));
    sortByPrecedence(input);
    expect(input).toEqual(snapshot);
  });

  it("returns an empty array when given an empty array", () => {
    expect(sortByPrecedence([])).toEqual([]);
  });
});

describe("parseFrontmatter precedence field", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reads a valid precedence value onto the canonical file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-canonical-prec-"));
    await mkdir(join(tempDir, "rules"), { recursive: true });
    await writeFile(
      join(tempDir, "rules", "p.md"),
      "---\nid: p\ntype: rule\ndescription: d\nprecedence: high\n---\n# body\n",
    );

    const results = await readCanonicalFiles(tempDir, "rules");
    expect(results).toHaveLength(1);
    expect(results[0]!.precedence).toBe("high");
  });

  it("leaves precedence undefined when the field is absent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-canonical-prec-"));
    await mkdir(join(tempDir, "rules"), { recursive: true });
    await writeFile(
      join(tempDir, "rules", "p.md"),
      "---\nid: p\ntype: rule\ndescription: d\n---\n# body\n",
    );

    const results = await readCanonicalFiles(tempDir, "rules");
    expect(results).toHaveLength(1);
    expect(results[0]!.precedence).toBeUndefined();
  });

  it("drops out-of-enum precedence values silently (CI validator rejects them)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-canonical-prec-"));
    await mkdir(join(tempDir, "rules"), { recursive: true });
    await writeFile(
      join(tempDir, "rules", "p.md"),
      "---\nid: p\ntype: rule\ndescription: d\nprecedence: urgent\n---\n# body\n",
    );

    const results = await readCanonicalFiles(tempDir, "rules");
    expect(results).toHaveLength(1);
    expect(results[0]!.precedence).toBeUndefined();
  });
});

describe("filterUserFacing", () => {
  const BASE = "/fake/agents/commands";

  function makeFile(
    overrides: Partial<CanonicalFile> & Pick<CanonicalFile, "id" | "sourcePath">,
  ): CanonicalFile {
    return {
      type: "command",
      description: "",
      content: "",
      rawContent: "",
      ...overrides,
    };
  }

  it("keeps top-level files whose frontmatter type matches the expected bucket", () => {
    const files = [
      makeFile({ id: "a", sourcePath: `${BASE}/hatch3r-a.md`, frontmatterType: "command" }),
      makeFile({ id: "b", sourcePath: `${BASE}/hatch3r-b.md`, frontmatterType: "command" }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("drops files whose relative path contains a subdirectory separator", () => {
    const files = [
      makeFile({ id: "top", sourcePath: `${BASE}/hatch3r-top.md`, frontmatterType: "command" }),
      makeFile({ id: "sub", sourcePath: `${BASE}/board/pickup-sub.md`, frontmatterType: "command" }),
      makeFile({ id: "deep", sourcePath: `${BASE}/board/nested/deep.md`, frontmatterType: "command" }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["top"]);
  });

  it("drops top-level files with a non-matching frontmatter type", () => {
    const files = [
      makeFile({ id: "cmd", sourcePath: `${BASE}/hatch3r-cmd.md`, frontmatterType: "command" }),
      makeFile({ id: "shared", sourcePath: `${BASE}/hatch3r-shared.md`, frontmatterType: "shared-context" }),
      makeFile({ id: "ref", sourcePath: `${BASE}/hatch3r-ref.md`, frontmatterType: "reference" }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["cmd"]);
  });

  it("applies both signals to the agents bucket", () => {
    const agentsBase = "/fake/agents/agents";
    const files = [
      makeFile({ id: "agent", type: "agent", sourcePath: `${agentsBase}/hatch3r-agent.md`, frontmatterType: "agent" }),
      makeFile({ id: "mode", type: "agent", sourcePath: `${agentsBase}/modes/fake-mode.md`, frontmatterType: "mode" }),
      makeFile({ id: "shared", type: "agent", sourcePath: `${agentsBase}/shared/fake-ref.md`, frontmatterType: "reference" }),
      makeFile({ id: "top-ref", type: "agent", sourcePath: `${agentsBase}/hatch3r-ref.md`, frontmatterType: "reference" }),
    ];
    const result = filterUserFacing(files, "agent", agentsBase);
    expect(result.map((f) => f.id)).toEqual(["agent"]);
  });

  it("keeps legacy top-level files that lack a frontmatterType", () => {
    const files = [
      makeFile({ id: "legacy", sourcePath: `${BASE}/hatch3r-legacy.md` }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["legacy"]);
  });

  it("keeps files whose sourcePath lies outside the baseDir (safe default)", () => {
    const files = [
      makeFile({ id: "outside", sourcePath: "/somewhere/else/hatch3r-outside.md", frontmatterType: "command" }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["outside"]);
  });

  it("accepts a baseDir passed with or without a trailing slash", () => {
    const files = [
      makeFile({ id: "top", sourcePath: `${BASE}/hatch3r-top.md`, frontmatterType: "command" }),
      makeFile({ id: "sub", sourcePath: `${BASE}/board/pickup.md`, frontmatterType: "command" }),
    ];
    expect(filterUserFacing(files, "command", BASE).map((f) => f.id)).toEqual(["top"]);
    expect(filterUserFacing(files, "command", `${BASE}/`).map((f) => f.id)).toEqual(["top"]);
  });

  it("drops files whose relative path contains a backslash (Windows separator)", () => {
    // Regression guard: on Windows, `node:path.relative` returns a
    // backslash-separated string. Earlier versions of this helper only
    // checked `/`, which meant every subdirectory companion file slipped
    // through and leaked into the user-facing picker on Windows CI runs.
    // We validate the separator-agnostic logic by placing a synthetic
    // backslash-separated path under a baseDir that resolves to the same
    // directory on POSIX, so `path.relative` returns the raw basename
    // and the `\\` stays inside the file name (which the filter treats
    // as a subdirectory marker).
    const files = [
      makeFile({ id: "top", sourcePath: `${BASE}/hatch3r-top.md`, frontmatterType: "command" }),
      makeFile({ id: "winsub", sourcePath: `${BASE}/board\\pickup.md`, frontmatterType: "command" }),
    ];
    const result = filterUserFacing(files, "command", BASE);
    expect(result.map((f) => f.id)).toEqual(["top"]);
  });
});
