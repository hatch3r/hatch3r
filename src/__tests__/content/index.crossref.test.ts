import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContentSelection } from "../../types.js";
import {
  buildContentIndex,
  extractContentReferences,
  validateCrossReferences,
  validateOrchestrationDependencies,
} from "../../content/index.js";
import {
  TAG_IMPLEMENTATION,
  TAG_ORCHESTRATION,
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

describe("content/index — cross-references", () => {
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

  // ── extractContentReferences ─────────────────────────────

  describe("extractContentReferences", () => {
    it("extracts backtick-quoted hatch3r references", () => {
      const content = "Use `hatch3r-implementer` and `hatch3r-reviewer` for this.";
      const refs = extractContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
      expect(refs).toContain("hatch3r-reviewer");
    });

    it("returns empty array when no references present", () => {
      const content = "No hatch3r references here. Just plain text.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("deduplicates references", () => {
      const content = "Use `hatch3r-test` and then `hatch3r-test` again.";
      const refs = extractContentReferences(content);
      expect(refs.length).toBe(1);
      expect(refs[0]).toBe("hatch3r-test");
    });

    it("does not match non-backtick-quoted references", () => {
      // D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): the primary scanner
      // remains backtick-scoped to avoid the adjective-modifier false
      // positive class ("hatch3r-generated code"). Bare prose mentions are
      // handled by `extractBareContentReferences` and surfaced as typo
      // warnings inside `validateCrossReferences` (resolve-or-skip).
      const content = "Use hatch3r-implementer without backticks.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("handles multiple references on same line", () => {
      const content = "Both `hatch3r-alpha` and `hatch3r-beta` are needed.";
      const refs = extractContentReferences(content);
      expect(refs).toContain("hatch3r-alpha");
      expect(refs).toContain("hatch3r-beta");
    });

    // D2-SA2.6-2.6-F03 (Cycle 10 Wave 4): frontmatter + fenced-block strip.
    it("ignores backticked ids inside leading YAML frontmatter", () => {
      const content =
        "---\n" +
        "id: hatch3r-example\n" +
        "description: see `hatch3r-future-thing` once authored\n" +
        "---\n" +
        "Body delegates to `hatch3r-implementer`.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual(["hatch3r-implementer"]);
    });

    it("ignores backticked ids inside fenced code blocks", () => {
      const content =
        "Use `hatch3r-implementer` in prose.\n\n" +
        "```bash\n" +
        "# example: `hatch3r-future-cmd` is not yet authored\n" +
        "hatch3r-not-a-real-id --flag\n" +
        "```\n\n" +
        "And `hatch3r-reviewer` after.";
      const refs = extractContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
      expect(refs).toContain("hatch3r-reviewer");
      expect(refs).not.toContain("hatch3r-future-cmd");
      expect(refs).not.toContain("hatch3r-not-a-real-id");
    });

    it("ignores backticked ids inside tilde-fenced code blocks", () => {
      const content =
        "~~~text\n" +
        "`hatch3r-placeholder` example only\n" +
        "~~~\n" +
        "Real reference: `hatch3r-fixer`.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual(["hatch3r-fixer"]);
    });
  });

  // ── extractBareContentReferences (D2-M10) ────────────────

  describe("extractBareContentReferences (D2-M10)", () => {
    it("captures bare prose mentions of hatch3r-* ids", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content = "Delegate to hatch3r-implementer for the change.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
    });

    it("captures adjective-modifier mentions (caller filters via index)", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      // The scanner returns candidates without judging adjective vs id.
      // It is the CALLER's job (validateCrossReferences resolve-or-skip)
      // to drop adjective-style mentions that don't resolve.
      const content = "Run hatch3r-generated code through hatch3r-managed checks.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-generated");
      expect(refs).toContain("hatch3r-managed");
    });

    it("skips filesystem path mentions", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content =
        "See /repo/agents/hatch3r-implementer.md for details. " +
        "Or https://github.com/anthropic/hatch3r-implementer for the source.";
      const refs = extractBareContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("skips .md / .mdc / .ts filename mentions but keeps bare id", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content = "Edit hatch3r-implementer.md to update hatch3r-implementer.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
      expect(refs.length).toBe(1);
    });

    it("does not duplicate backticked refs already captured", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      // The scanner's backtick carve-out matches at the boundary so this
      // would not double-count when used alongside extractContentReferences.
      const content = "`hatch3r-foo`";
      const refs = extractBareContentReferences(content);
      expect(refs).toEqual([]);
    });
  });

  // ── validateCrossReferences ──────────────────────────────

  describe("validateCrossReferences", () => {
    it("returns no warnings when all references exist in index", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-caller.md"),
        mdFile({ id: "hatch3r-caller", type: "agent", description: "Calls others" }) +
        "\nUse `hatch3r-callee` for details.\n",
      );
      await writeFile(
        join(dir, "agents", "hatch3r-callee.md"),
        mdFile({ id: "hatch3r-callee", type: "agent", description: "Called by others" }),
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings).toEqual([]);
    });

    it("returns warnings for missing cross-referenced IDs", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-orphan-ref.md"),
        mdFile({ id: "hatch3r-orphan-ref", type: "agent", description: "Refs missing ID" }) +
        "\nSee `hatch3r-nonexistent` for details.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("hatch3r-nonexistent");
      // D2-SA2.6-2.6-F03: warning text softened to flag possible example /
      // future-id false positives instead of asserting hard non-existence.
      expect(result.warnings[0]).toContain("not in the content index");
    });

    it("self-references do not trigger warnings", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-self.md"),
        mdFile({ id: "hatch3r-self", type: "agent", description: "Self-referencing" }) +
        "\nThis is `hatch3r-self`.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings).toEqual([]);
    });

    it("handles skill subdirectory cross-references", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "skills", "hatch3r-skillref"), { recursive: true });
      await writeFile(
        join(dir, "skills", "hatch3r-skillref", "SKILL.md"),
        mdFile({ id: "hatch3r-skillref", type: "skill", description: "Skill that refs" }) +
        "\nUse `hatch3r-missing-agent` to assist.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("hatch3r-missing-agent");
    });

    // D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): bare prose references
    // that resolve to a near-by id via edit distance ≤ 2 surface as typo
    // warnings, closing the silent-invisibility gap. Adjective-modifier
    // mentions ("hatch3r-generated", "hatch3r-managed") stay quiet because
    // their edit distance from any real id is well above the threshold.
    describe("D2-M10 bare prose typo detection", () => {
      it("warns when bare prose ref is one edit away from a real id", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        // The real id is "hatch3r-implementer"; the body mentions a typo
        // "hatch3r-implementr" (missing "e") in bare prose. Pre-D2-M10 this
        // silently passed because the validator only scanned backticks.
        await writeFile(
          join(dir, "agents", "hatch3r-impl.md"),
          mdFile({ id: "hatch3r-impl", type: "agent", description: "Caller" }) +
            "\nDelegate to hatch3r-implementr for the change.\n",
        );
        await writeFile(
          join(dir, "agents", "hatch3r-implementer.md"),
          mdFile({ id: "hatch3r-implementer", type: "agent", description: "Real" }),
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        const typoWarnings = result.warnings.filter((w) => w.includes("typo of"));
        expect(typoWarnings.length).toBe(1);
        expect(typoWarnings[0]).toContain("hatch3r-implementr");
        expect(typoWarnings[0]).toContain("hatch3r-implementer");
      });

      it("does NOT warn on adjective-modifier prose (distance > 2 from any id)", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        await writeFile(
          join(dir, "agents", "hatch3r-x.md"),
          mdFile({ id: "hatch3r-x", type: "agent", description: "Caller" }) +
            "\nRun hatch3r-generated code through hatch3r-managed checks.\n",
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        const typoWarnings = result.warnings.filter((w) => w.includes("typo of"));
        expect(typoWarnings).toEqual([]);
      });

      it("does NOT warn on bare prose mention that exactly matches an existing id", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        await writeFile(
          join(dir, "agents", "hatch3r-caller.md"),
          mdFile({ id: "hatch3r-caller", type: "agent", description: "Caller" }) +
            "\nDelegate to hatch3r-callee for the change.\n",
        );
        await writeFile(
          join(dir, "agents", "hatch3r-callee.md"),
          mdFile({ id: "hatch3r-callee", type: "agent", description: "Callee" }),
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        expect(result.warnings).toEqual([]);
      });
    });
  });

  // ── validateOrchestrationDependencies ────────────────────

  describe("validateOrchestrationDependencies", () => {
    it("returns no warnings when orchestration rule is absent", () => {
      const selection = emptySelection({
        items: {
          agents: [],
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      expect(warnings).toEqual([]);
    });

    it("returns no warnings when all required agents are present", () => {
      // F16.3-H1 (Cycle 10 Wave 1C): legacy test-writer + security-auditor
      // collapsed into the CQ specialists. Strict orchestration roster lists
      // only protected + full-preset-admitted CQ agents (security); the
      // testability always-mode contract is enforced via the trigger table.
      const selection = emptySelection({
        items: {
          agents: [
            "hatch3r-researcher",
            "hatch3r-implementer",
            "hatch3r-reviewer",
            "hatch3r-security",
          ],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      expect(warnings).toEqual([]);
    });

    it("returns warnings for each missing orchestration agent", () => {
      const selection = emptySelection({
        items: {
          agents: ["hatch3r-researcher"],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      // Missing: implementer, reviewer, security
      // (post-F16.3-H1: strict roster lists only protected + full-preset
      // CQ agents; testability's always-mode floor is enforced via the
      // trigger table rather than this roster check.)
      expect(warnings.length).toBe(3);
      expect(warnings.some((w) => w.includes("hatch3r-implementer"))).toBe(true);
      expect(warnings.some((w) => w.includes("hatch3r-reviewer"))).toBe(true);
      expect(warnings.some((w) => w.includes("hatch3r-security"))).toBe(true);
    });

    it("warning messages mention the 4-phase pipeline", () => {
      const selection = emptySelection({
        items: {
          agents: [],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      for (const w of warnings) {
        expect(w).toContain("4-phase pipeline");
      }
    });
  });
});
