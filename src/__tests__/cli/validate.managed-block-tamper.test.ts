// D11-SA11.2-F13 (Wave 7+8, D11, P5+P6): unit coverage for
// scanManagedBlockTampering — the structural-integrity scan over on-disk
// adapter-output managed blocks under .claude/, .cursor/, .github/.
//
// This is the complement to hatch3r status/verify (full regenerate-and-diff
// content drift). These tests assert ONLY structural marker anomalies:
// clean blocks pass with 0 warnings; orphan, duplicate/nested, and
// wrong-host-comment-syntax markers each produce >=1 warning; a non-existent
// directory yields 0 warnings and never throws.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanManagedBlockTampering } from "../../cli/commands/validate.js";

const HTML_BEGIN = "<!-- HATCH3R:BEGIN -->";
const HTML_END = "<!-- HATCH3R:END -->";
const YAML_BEGIN = "# HATCH3R:BEGIN";
const YAML_END = "# HATCH3R:END";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "h3r-tamper-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write a file under `root`, creating parent dirs. */
async function seed(relPath: string, content: string): Promise<void> {
  const full = join(root, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf-8");
}

function htmlBlock(body: string): string {
  return [
    "# User heading kept above the block",
    "",
    HTML_BEGIN,
    body,
    HTML_END,
    "",
    "User content kept below the block",
    "",
  ].join("\n");
}

function yamlBlock(body: string): string {
  return [
    "name: copilot-setup-steps",
    "on: workflow_dispatch",
    YAML_BEGIN,
    body,
    YAML_END,
    "",
  ].join("\n");
}

describe("scanManagedBlockTampering", () => {
  it("(a) returns 0 warnings for a clean Markdown managed block", async () => {
    await seed(".claude/CLAUDE.md", htmlBlock("hatch3r-owned content here"));
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings).toEqual([]);
  });

  it("(a) returns 0 warnings for a clean YAML workflow managed block", async () => {
    await seed(
      ".github/workflows/copilot-setup-steps.yml",
      yamlBlock("  steps:\n    - uses: actions/checkout@v4"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings).toEqual([]);
  });

  it("(a) returns 0 warnings for a clean .cursor/rules/*.mdc managed block", async () => {
    await seed(".cursor/rules/10-security.mdc", htmlBlock("rule body"));
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings).toEqual([]);
  });

  it("(a) ignores files that carry no managed-block markers at all", async () => {
    await seed(".claude/CLAUDE.md", "# plain file\n\njust prose, no markers\n");
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings).toEqual([]);
  });

  it("(b) flags an orphan BEGIN with no matching END", async () => {
    await seed(
      ".claude/CLAUDE.md",
      ["intro", HTML_BEGIN, "owned content", "(END marker deleted by hand)", ""].join("\n"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("CLAUDE.md");
    expect(warnings[0]).toContain("orphan");
    expect(warnings[0]).toContain("hatch3r sync");
  });

  it("(b) flags an orphan END with no preceding BEGIN", async () => {
    await seed(
      ".claude/CLAUDE.md",
      ["intro (BEGIN marker deleted by hand)", "owned content", HTML_END, ""].join("\n"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes("orphan") && w.includes("CLAUDE.md"))).toBe(true);
  });

  it("(c) flags HTML-syntax markers inside a .yml workflow file", async () => {
    // Issue #76 corruption: HTML markers in a YAML workflow break the parse.
    await seed(
      ".github/workflows/copilot-setup-steps.yml",
      ["name: x", "on: push", HTML_BEGIN, "  steps: []", HTML_END, ""].join("\n"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("copilot-setup-steps.yml");
    expect(warnings[0]).toContain("wrong host-comment syntax");
    expect(warnings[0]).toContain("hatch3r sync");
  });

  it("(c) flags YAML-syntax markers inside a .md file", async () => {
    await seed(
      ".claude/CLAUDE.md",
      ["# heading", YAML_BEGIN, "owned content", YAML_END, ""].join("\n"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes("wrong host-comment syntax"))).toBe(true);
  });

  it("(d) flags duplicate / nested BEGIN markers", async () => {
    await seed(
      ".claude/CLAUDE.md",
      ["intro", HTML_BEGIN, "first owned chunk", HTML_BEGIN, "second chunk", HTML_END, ""].join("\n"),
    );
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes("duplicate/nested") && w.includes("CLAUDE.md"))).toBe(true);
  });

  it("(e) returns 0 warnings and does not throw when adapter dirs are absent", async () => {
    // root exists but has no .claude/.cursor/.github subtrees.
    await expect(scanManagedBlockTampering(root)).resolves.toEqual([]);
  });

  it("(e) returns 0 warnings and does not throw for a wholly non-existent root", async () => {
    const ghost = join(root, "does", "not", "exist");
    await expect(scanManagedBlockTampering(ghost)).resolves.toEqual([]);
  });

  it("scans all three adapter roots in a single pass", async () => {
    await seed(".claude/CLAUDE.md", htmlBlock("clean")); // clean -> no warning
    await seed(".cursor/rules/x.mdc", ["a", HTML_BEGIN, "b", ""].join("\n")); // orphan BEGIN
    await seed(
      ".github/workflows/setup.yml",
      ["k: v", HTML_BEGIN, "  s: []", HTML_END, ""].join("\n"),
    ); // wrong syntax
    const warnings = await scanManagedBlockTampering(root);
    expect(warnings.some((w) => w.includes("x.mdc"))).toBe(true);
    expect(warnings.some((w) => w.includes("setup.yml"))).toBe(true);
    expect(warnings.some((w) => w.includes("CLAUDE.md"))).toBe(false);
  });

  it("emits one warning per anomaly, each naming file + anomaly + remedy", async () => {
    await seed(".claude/CLAUDE.md", ["a", HTML_BEGIN, "b", ""].join("\n"));
    const warnings = await scanManagedBlockTampering(root);
    for (const w of warnings) {
      expect(w).toContain("CLAUDE.md");
      expect(w).toContain("hatch3r sync");
    }
  });
});
