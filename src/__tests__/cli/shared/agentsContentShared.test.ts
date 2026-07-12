import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractSkillChecklist,
  readDirFiles,
  readSkillDirs,
  recordAgentsContentProbeFailure,
} from "../../../cli/shared/agentsContentShared.js";
import { setVerbose } from "../../../cli/shared/ui.js";

// D3-SA3.2-08 (Cycle 12 Wave 4): direct tests for the shared filesystem
// readers + skill-checklist extraction heuristic extracted by D1-SA1.7-F9 into
// agentsContentShared.ts. Before this file the module was covered only
// incidentally through three consumers' tests; extractSkillChecklist's regex
// heuristics (heading triggers, stop conditions, 20-line cap, empty→undefined)
// had no direct edge-case assertions. This pins each branch so a silently
// empty checklist on an unmatched heading dialect fails loudly here.

describe("extractSkillChecklist — heading-trigger dialects", () => {
  it.each(["Steps", "Protocol", "Workflow", "Checklist", "Procedure", "Implementation"])(
    "starts capturing at a heading containing %s",
    (keyword) => {
      const result = extractSkillChecklist(`# ${keyword}\n1. first\n2. second\n`);
      expect(result).toBe("1. first\n2. second");
    },
  );

  it("matches the trigger keyword case-insensitively", () => {
    expect(extractSkillChecklist("# STEPS\n1. a\n")).toBe("1. a");
    expect(extractSkillChecklist("## workflow\n1. a\n")).toBe("1. a");
  });

  it("matches the keyword anywhere after the heading marker, not only as the first word", () => {
    expect(extractSkillChecklist("## Quick Start Steps\n1. a\n")).toBe("1. a");
  });

  it("triggers on heading levels 1 through 3", () => {
    expect(extractSkillChecklist("# Steps\n1. a\n")).toBe("1. a");
    expect(extractSkillChecklist("## Steps\n1. a\n")).toBe("1. a");
    expect(extractSkillChecklist("### Steps\n1. a\n")).toBe("1. a");
  });

  it("does NOT trigger on a level-4 heading (regex caps at 3 hashes)", () => {
    // #### Steps: `#{1,3}\s+` cannot consume the 4th hash before whitespace,
    // so inSteps never flips and the list below is never captured.
    expect(extractSkillChecklist("#### Steps\n1. a\n2. b\n")).toBeUndefined();
  });

  it("does NOT trigger on a heading with no trigger keyword", () => {
    expect(extractSkillChecklist("# Overview\n1. a\n2. b\n")).toBeUndefined();
  });
});

describe("extractSkillChecklist — capture dialects", () => {
  it("captures numbered, bullet, indented-numbered, and indented-bullet list lines", () => {
    const content = "# Steps\n1. numbered\n- bullet\n  2. indented-num\n  - indented-bullet\n";
    expect(extractSkillChecklist(content)).toBe(
      "1. numbered\n- bullet\n  2. indented-num\n  - indented-bullet",
    );
  });

  it("skips prose lines between list items without stopping capture", () => {
    const content = "# Steps\n1. one\nsome prose that is not a list item\n2. two\n";
    expect(extractSkillChecklist(content)).toBe("1. one\n2. two");
  });

  it("does not capture list items appearing before the trigger heading", () => {
    const content = "1. early item before any trigger\n# Steps\n2. real item\n";
    const result = extractSkillChecklist(content);
    expect(result).toBe("2. real item");
    expect(result).not.toContain("early item");
  });

  it("does not capture asterisk or plus bullets (dialect boundary)", () => {
    expect(extractSkillChecklist("# Steps\n* star bullet\n+ plus bullet\n")).toBeUndefined();
  });
});

describe("extractSkillChecklist — stop-at-major-heading", () => {
  it("stops at the next level-1/2 heading that is not a step/phase heading", () => {
    const content = "# Steps\n1. one\n2. two\n## Configuration\n3. after-stop\n";
    const result = extractSkillChecklist(content);
    expect(result).toBe("1. one\n2. two");
    expect(result).not.toContain("after-stop");
  });

  it("does NOT stop at a level-3 heading (stop regex caps at 2 hashes)", () => {
    const content = "# Steps\n1. one\n### Sub Detail\n2. two\n";
    expect(extractSkillChecklist(content)).toBe("1. one\n2. two");
  });

  it("does NOT stop at a heading whose text contains 'step' or 'phase'", () => {
    expect(extractSkillChecklist("# Steps\n1. one\n## Next Steps\n2. two\n")).toBe("1. one\n2. two");
    expect(extractSkillChecklist("# Steps\n1. one\n## Phase 2\n2. two\n")).toBe("1. one\n2. two");
  });
});

describe("extractSkillChecklist — 20-line cap", () => {
  it("captures at most 20 list lines even when more are present", () => {
    const items = Array.from({ length: 25 }, (_, i) => `${i + 1}. item`).join("\n");
    const result = extractSkillChecklist(`# Steps\n${items}\n`);
    expect(result).toBeDefined();
    expect(result!.split("\n")).toHaveLength(20);
    expect(result).toContain("20. item");
    expect(result).not.toContain("21. item");
  });
});

describe("extractSkillChecklist — empty result maps to undefined", () => {
  it("returns undefined when there is a trigger heading but no list items", () => {
    expect(extractSkillChecklist("# Steps\nJust prose and no list markers at all.\n")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(extractSkillChecklist("")).toBeUndefined();
  });

  it("returns undefined when no trigger heading is present", () => {
    expect(extractSkillChecklist("Some skill body\nwith no procedural heading\n")).toBeUndefined();
  });
});

describe("readDirFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-acs-dir-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns .md files sorted by name with their content", async () => {
    await writeFile(join(tempDir, "b.md"), "beta body", "utf-8");
    await writeFile(join(tempDir, "a.md"), "alpha body", "utf-8");
    const files = await readDirFiles(tempDir);
    expect(files.map((f) => f.name)).toEqual(["a.md", "b.md"]);
    expect(files[0].content).toBe("alpha body");
    expect(files[1].content).toBe("beta body");
  });

  it("excludes non-markdown files", async () => {
    await writeFile(join(tempDir, "keep.md"), "kept", "utf-8");
    await writeFile(join(tempDir, "skip.txt"), "dropped", "utf-8");
    await writeFile(join(tempDir, "skip.json"), "{}", "utf-8");
    const files = await readDirFiles(tempDir);
    expect(files.map((f) => f.name)).toEqual(["keep.md"]);
  });

  it("returns an empty array when the directory is missing (error path)", async () => {
    const files = await readDirFiles(join(tempDir, "does-not-exist"));
    expect(files).toEqual([]);
  });
});

describe("readSkillDirs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-acs-skills-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedSkill(name: string, frontmatter: string, body: string): Promise<void> {
    await mkdir(join(tempDir, name), { recursive: true });
    await writeFile(join(tempDir, name, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`, "utf-8");
  }

  it("reads each SKILL.md, parses frontmatter, extracts the checklist, and sorts by id", async () => {
    await seedSkill(
      "beta-dir",
      "id: hatch3r-beta\ntype: skill\ndescription: Beta skill",
      "# Steps\n1. beta-one\n2. beta-two\n",
    );
    await seedSkill(
      "alpha-dir",
      "id: hatch3r-alpha\ntype: skill\ndescription: Alpha skill",
      "# Overview\nNo procedural heading here.\n",
    );

    const skills = await readSkillDirs(tempDir);
    expect(skills.map((s) => s.id)).toEqual(["hatch3r-alpha", "hatch3r-beta"]);

    const beta = skills.find((s) => s.id === "hatch3r-beta")!;
    expect(beta.description).toBe("Beta skill");
    expect(beta.checklist).toBe("1. beta-one\n2. beta-two");

    const alpha = skills.find((s) => s.id === "hatch3r-alpha")!;
    expect(alpha.checklist).toBeUndefined();
  });

  it("falls back id → name → directory name when id is absent", async () => {
    await seedSkill("name-fallback", "type: skill\nname: hatch3r-named\ndescription: d", "# body\n");
    await seedSkill("dir-fallback", "type: skill\ndescription: d", "# body\n");

    const skills = await readSkillDirs(tempDir);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("hatch3r-named");
    expect(ids).toContain("dir-fallback");
  });

  it("skips subdirectories that lack a SKILL.md and top-level non-directory entries", async () => {
    await seedSkill("real-skill", "id: hatch3r-real\ntype: skill\ndescription: d", "# body\n");
    await mkdir(join(tempDir, "empty-dir"), { recursive: true });
    await writeFile(join(tempDir, "loose-file.md"), "not a skill dir", "utf-8");

    const skills = await readSkillDirs(tempDir);
    expect(skills.map((s) => s.id)).toEqual(["hatch3r-real"]);
  });

  it("returns an empty array when the directory is missing (error path)", async () => {
    const skills = await readSkillDirs(join(tempDir, "does-not-exist"));
    expect(skills).toEqual([]);
  });
});

describe("recordAgentsContentProbeFailure", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setVerbose(false);
    errSpy.mockRestore();
  });

  it("emits the operation and Error message on stderr when verbose is enabled", () => {
    setVerbose(true);
    recordAgentsContentProbeFailure("readDirFiles(x) skipped", new Error("ENOENT: missing"));
    expect(errSpy).toHaveBeenCalledTimes(1);
    const emitted = String(errSpy.mock.calls[0][0]);
    expect(emitted).toContain("agentsContent: readDirFiles(x) skipped");
    expect(emitted).toContain("ENOENT: missing");
  });

  it("stringifies a non-Error rejection value (String(err) branch)", () => {
    setVerbose(true);
    recordAgentsContentProbeFailure("op", "raw string failure");
    const emitted = String(errSpy.mock.calls[0][0]);
    expect(emitted).toContain("raw string failure");
  });

  it("stays silent when verbose is disabled (default)", () => {
    setVerbose(false);
    recordAgentsContentProbeFailure("op", new Error("suppressed"));
    expect(errSpy).not.toHaveBeenCalled();
  });
});
