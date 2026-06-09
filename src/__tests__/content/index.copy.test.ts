import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import {
  buildContentIndex,
  copySelectedContent,
} from "../../content/index.js";
import type { CatalogItem, ContentIndex } from "../../content/index.js";
import {
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_ORCHESTRATION,
  TAG_BOARD,
  TAG_CTX_TEAM_ONLY,
} from "../../content/tags.js";

// ── Fixture helper ─────────────────────────────────────────────

function mdFile(overrides: Record<string, unknown> = {}, body = "# Content"): string {
  const defaults: Record<string, unknown> = {
    id: "test-item",
    type: "agent",
    description: "A test item",
    tags: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION],
  };
  const merged = { ...defaults, ...overrides };
  const lines = Object.entries(merged).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((i) => String(i)).join(", ")}]`;
    return `${k}: ${String(v)}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

async function createContentRoot(dir: string): Promise<string> {
  const contentRoot = join(dir, "content");

  // agents (glob strategy)
  await mkdir(join(contentRoot, "agents"), { recursive: true });
  await writeFile(
    join(contentRoot, "agents", "hatch3r-implementer.md"),
    mdFile({ id: "hatch3r-implementer", type: "agent", description: "Implements features", tags: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-reviewer.md"),
    mdFile({ id: "hatch3r-reviewer", type: "agent", description: "Reviews code", tags: [TAG_ORCHESTRATION, TAG_REVIEW] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-protected.md"),
    mdFile({ id: "hatch3r-protected", type: "agent", description: "Protected agent", tags: [TAG_ORCHESTRATION], protected: true }),
  );

  // commands (glob strategy)
  await mkdir(join(contentRoot, "commands"), { recursive: true });
  await writeFile(
    join(contentRoot, "commands", "hatch3r-feature-plan.md"),
    mdFile({ id: "hatch3r-feature-plan", type: "command", description: "Plan a feature", tags: [TAG_PLANNING] }),
  );
  await writeFile(
    join(contentRoot, "commands", "hatch3r-board-fill.md"),
    mdFile({ id: "hatch3r-board-fill", type: "command", description: "Init board", tags: [TAG_BOARD, TAG_CTX_TEAM_ONLY] }),
  );

  // rules (glob strategy — with companion .mdc)
  await mkdir(join(contentRoot, "rules"), { recursive: true });
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.md"),
    mdFile({ id: "hatch3r-code-standards", type: "rule", description: "Code standards", tags: [TAG_ORCHESTRATION] }),
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.mdc"),
    "companion mdc content",
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-testing.md"),
    mdFile({ id: "hatch3r-testing", type: "rule", description: "Testing rules", tags: [TAG_REVIEW] }),
  );

  // skills (subdirectory strategy)
  await mkdir(join(contentRoot, "skills", "hatch3r-feature"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-feature", "SKILL.md"),
    mdFile({ id: "hatch3r-feature", type: "skill", description: "Feature skill", tags: [TAG_IMPLEMENTATION] }),
  );
  await mkdir(join(contentRoot, "skills", "hatch3r-refactor"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "SKILL.md"),
    mdFile({ id: "hatch3r-refactor", type: "skill", description: "Refactor skill", tags: [TAG_IMPLEMENTATION] }),
  );
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "helper.md"),
    "# Extra helper file in skill dir",
  );

  // prompts (glob strategy)
  await mkdir(join(contentRoot, "prompts"), { recursive: true });
  await writeFile(
    join(contentRoot, "prompts", "hatch3r-code-review.md"),
    mdFile({ id: "hatch3r-code-review", type: "prompt", description: "Code review prompt", tags: [TAG_REVIEW] }),
  );

  // hooks (glob strategy)
  await mkdir(join(contentRoot, "hooks"), { recursive: true });
  await writeFile(
    join(contentRoot, "hooks", "hatch3r-pre-commit.md"),
    mdFile({ id: "hatch3r-pre-commit", type: "hook", description: "Pre-commit hook", tags: [TAG_DEVOPS] }),
  );

  // github-agents (glob strategy)
  await mkdir(join(contentRoot, "github-agents"), { recursive: true });
  await writeFile(
    join(contentRoot, "github-agents", "hatch3r-test-agent.md"),
    mdFile({ id: "hatch3r-test-agent", type: "github-agent", description: "Test GH agent", tags: [TAG_REVIEW] }),
  );

  // checks/ and mcp/ directories (always-copied)
  await mkdir(join(contentRoot, "checks"), { recursive: true });
  await writeFile(join(contentRoot, "checks", "check1.md"), "# Check 1");
  await mkdir(join(contentRoot, "mcp"), { recursive: true });
  await writeFile(join(contentRoot, "mcp", "mcp-config.json"), '{"servers":[]}');

  return contentRoot;
}

function makeIndex(items: CatalogItem[]): ContentIndex {
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();
  const byTypeAndId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
    byId.set(item.id, item);
    byTypeAndId.set(`${item.type}:${item.id}`, item);
  }
  return { items, byType, byId, byTypeAndId, collisions: [] };
}

function emptySelection(overrides: Partial<ContentSelection> = {}): ContentSelection {
  return {
    preset: "full",
    projectType: "brownfield",
    teamSize: "team",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("content/index — copy & disk emission", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  });

  async function makeTempDir(prefix = "hatch3r-content-"): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), prefix));
    return tempDir;
  }

  // ── copySelectedContent ──────────────────────────────────

  describe("copySelectedContent", () => {
    it("copies glob-strategy items (.md files)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      // copied paths echo CatalogItem.relativePath (POSIX) — see B.2 in PR 64.
      expect(copied).toContain(posix.join("agents", "hatch3r-implementer.md"));

      const content = await readFile(join(agentsDir, "agents", "hatch3r-implementer.md"), "utf-8");
      expect(content).toContain("hatch3r-implementer");
    });

    it("copies subdirectory-strategy items (skill dirs recursively)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: [], skills: ["hatch3r-refactor"], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("skills", "hatch3r-refactor"));

      // Check that the extra file inside the skill dir was also copied
      const helper = await readFile(join(agentsDir, "skills", "hatch3r-refactor", "helper.md"), "utf-8");
      expect(helper).toContain("Extra helper file");
    });

    it("copies companion .mdc files for rules", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: [], skills: [], rules: ["hatch3r-code-standards"], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("rules", "hatch3r-code-standards.md"));
      expect(copied).toContain(posix.join("rules", "hatch3r-code-standards.mdc"));

      const mdcContent = await readFile(join(agentsDir, "rules", "hatch3r-code-standards.mdc"), "utf-8");
      expect(mdcContent).toBe("companion mdc content");
    });

    it("skips items not in selection", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      // Only select one agent
      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      // hatch3r-reviewer should NOT be copied
      const agentIds = copied.filter((p) => p.startsWith("agents"));
      expect(agentIds.length).toBe(1);
    });

    it("always copies checks/ directory", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection();
      await copySelectedContent(contentRoot, agentsDir, selection, index);

      const checkContent = await readFile(join(agentsDir, "checks", "check1.md"), "utf-8");
      expect(checkContent).toContain("Check 1");
    });

    it("always copies mcp/ directory", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection();
      await copySelectedContent(contentRoot, agentsDir, selection, index);

      const mcpContent = await readFile(join(agentsDir, "mcp", "mcp-config.json"), "utf-8");
      expect(mcpContent).toContain("servers");
    });

    it("handles missing checks/mcp dirs gracefully", async () => {
      const dir = await makeTempDir();
      // Content root with no checks/ or mcp/
      await mkdir(join(dir, "agents"), { recursive: true });
      const index = await buildContentIndex(dir);
      const agentsDir = join(dir, "output");

      const selection = emptySelection();
      // Should not throw
      const copied = await copySelectedContent(dir, agentsDir, selection, index);
      expect(copied).toEqual([]);
    });

    it("returns list of copied paths", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer", "hatch3r-reviewer"],
          skills: ["hatch3r-feature"],
          rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("agents", "hatch3r-implementer.md"));
      expect(copied).toContain(posix.join("agents", "hatch3r-reviewer.md"));
      expect(copied).toContain(posix.join("skills", "hatch3r-feature"));
    });

    it("throws HatchError for path traversal in relativePath", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");

      const maliciousItem: CatalogItem = {
        id: "evil",
        type: "agent",
        description: "bad",
        tags: [],
        relativePath: "../../../etc/passwd",
        source: "canonical",
      };
      const index = makeIndex([maliciousItem]);
      const selection = emptySelection({
        items: {
          agents: ["evil"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      await expect(
        copySelectedContent(contentRoot, agentsDir, selection, index),
      ).rejects.toThrow(HatchError);
    });
  });

  // ── generateMdcCompanions ────────────────────────────────

  describe("generateMdcCompanions", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it("generates .mdc files for each .md file in the rules directory", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-test-rule.md"),
        "---\nid: hatch3r-test-rule\ntype: rule\ndescription: A test rule\nscope: always\n---\n# Test Rule\n\nContent.\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      const written = await generateMdcCompanions(rulesDir);
      expect(written.length).toBe(1);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-test-rule.mdc"), "utf-8");
      expect(mdcContent).toContain("alwaysApply: true");
      expect(mdcContent).toContain("A test rule");
      expect(mdcContent).toContain("# Test Rule");
    });

    it("generates correct globs for scoped rules", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-scope-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-ts-rule.md"),
        "---\nid: hatch3r-ts-rule\ntype: rule\ndescription: TypeScript rule\nscope: \"**/*.ts, **/*.tsx\"\n---\n# TS Rule\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-ts-rule.mdc"), "utf-8");
      expect(mdcContent).toContain("globs:");
      expect(mdcContent).toContain("**/*.ts");
      expect(mdcContent).toContain("**/*.tsx");
    });

    // D2-18 (Cycle 11 Wave 3): the canonical two-line form
    // (`scope: conditional` + a separate `globs:` line — the form
    // `.claude/rules/content-authoring.md` mandates for new rules) previously
    // fell to `alwaysApply: false` with NO globs, demoting auto-attached Cursor
    // rules to manual-only. The `.mdc` must now carry the glob set from the
    // separate `globs:` field.
    it("D2-18: emits globs for `scope: conditional` + separate globs field", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-cond-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-cond-rule.md"),
        "---\nid: hatch3r-cond-rule\ntype: rule\ndescription: Conditional rule\nscope: conditional\nglobs: \"src/**/*.ts, src/**/*.tsx\"\n---\n# Cond Rule\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-cond-rule.mdc"), "utf-8");
      expect(mdcContent).toContain('globs: ["src/**/*.ts", "src/**/*.tsx"]');
      expect(mdcContent).not.toContain("alwaysApply");
    });

    // D2-18: a `scope: conditional` rule with NO globs is a deprecated
    // globs-less conditional → manual-only (alwaysApply: false), per the
    // `.md → .mdc` transform table. It must not invent a bogus glob.
    it("D2-18: `scope: conditional` with no globs falls to alwaysApply: false", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-cond-empty-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-cond-empty.md"),
        "---\nid: hatch3r-cond-empty\ntype: rule\ndescription: Deprecated conditional\nscope: conditional\n---\n# Body\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-cond-empty.mdc"), "utf-8");
      expect(mdcContent).toContain("alwaysApply: false");
      expect(mdcContent).not.toContain("globs:");
    });

    // D5-28: `scope: agent-requested` is the sanctioned third activation mode —
    // Cursor's "Apply Intelligently" shape (description-only `.mdc`, no globs,
    // alwaysApply: false). The companion emitter must short-circuit the legacy-
    // CSV branch so the literal "agent-requested" token never becomes a glob.
    it("D5-28: `scope: agent-requested` → alwaysApply: false, description, no globs", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-agentreq-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-agentreq.md"),
        "---\nid: hatch3r-agentreq\ntype: rule\ndescription: Pulled in by description\nscope: agent-requested\n---\n# Body\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-agentreq.mdc"), "utf-8");
      expect(mdcContent).toContain("description: Pulled in by description");
      expect(mdcContent).toContain("alwaysApply: false");
      expect(mdcContent).not.toContain("globs:");
      expect(mdcContent).not.toContain("agent-requested\n"); // never a `globs: agent-requested` line
      expect(mdcContent).not.toContain("alwaysApply: true");
    });

    it("returns empty array for nonexistent directory", async () => {
      const { generateMdcCompanions } = await import("../../content/index.js");
      const result = await generateMdcCompanions("/nonexistent/path");
      expect(result).toEqual([]);
    });

    // C7.5-W2B2-H4 (D2-SA2.6-2): .mdc companion writes now go through
    // atomicWriteFile (temp file + rename with fsync). A crash mid-write
    // can no longer leave a truncated .mdc visible to Cursor.
    it("C7.5-W2B2-H4: .mdc write is atomic (no partial files visible)", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-atomic-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-atomic-rule.md"),
        "---\nid: hatch3r-atomic-rule\ntype: rule\ndescription: atomic\nscope: always\n---\n# Body\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      // After success, exactly one .mdc file exists (no .tmp leftover).
      const entries = await readdir(rulesDir);
      const mdcFiles = entries.filter((e) => e.endsWith(".mdc"));
      const tmpFiles = entries.filter((e) => e.includes(".tmp."));
      expect(mdcFiles).toEqual(["hatch3r-atomic-rule.mdc"]);
      expect(tmpFiles).toEqual([]);
    });

    it("C7.5-W2B2-H4: .mdc content is well-formed after atomic write", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-wellformed-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-wf.md"),
        "---\nid: hatch3r-wf\ntype: rule\ndescription: wf\n---\n# Body\nLine 1\nLine 2\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-wf.mdc"), "utf-8");
      expect(mdcContent.startsWith("---\n")).toBe(true);
      expect(mdcContent).toContain("description: wf");
      expect(mdcContent).toContain("Line 1");
      expect(mdcContent).toContain("Line 2");
    });
  });

  describe("C7.5-W2B2-H7 copySelectedContent user-edit overwrite detection", () => {
    it("emits a warning when destination bytes differ from source", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-overwrite-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        // First copy: clean install.
        await copySelectedContent(contentRoot, agentsDir, selection, index);

        // User edits the canonical file locally.
        const implPath = join(agentsDir, "agents", "hatch3r-implementer.md");
        await writeFile(implPath, "locally edited content\n", "utf-8");

        // Second copy with warnings sink: must detect divergence.
        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting locally-edited") && w.includes(".hatch3r/"))).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not warn when destination matches source byte-for-byte", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-no-overwrite-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        await copySelectedContent(contentRoot, agentsDir, selection, index);

        // Second invocation without local edits: source == dest.
        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting locally-edited"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not warn on first-time copy (no destination exists)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-firstcopy-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("is opt-in — omitting options preserves legacy behavior (no warnings emitted)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-optin-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        await copySelectedContent(contentRoot, agentsDir, selection, index);
        const implPath = join(agentsDir, "agents", "hatch3r-implementer.md");
        await writeFile(implPath, "local edit\n", "utf-8");

        // No options argument: the function should still succeed without
        // throwing and without populating any warnings (legacy callers).
        const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
        expect(copied.length).toBeGreaterThan(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
