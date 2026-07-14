import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_CUSTOMIZE_MD_BYTES,
  MAX_PROTECTED_CUSTOMIZE_MD_BYTES,
  detectSnapshotDrift,
  readCustomization,
  readCustomizationMarkdown,
  readCustomizationSnapshot,
  readCustomizationWithWarnings,
} from "../../models/customize.js";

describe("readCustomization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-"));
    return tempDir;
  }

  it("returns undefined when file does not exist", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toBeUndefined();
  });

  it("reads model for agents", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toEqual({ model: "opus" });
  });

  it("reads effort for agents (release/2.7.0 effort axis)", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "effort: xhigh",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toEqual({ effort: "xhigh" });
  });

  it("reads model and effort together, verbatim (enum gating is apply-time, not read-time)", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus\neffort: TURBO",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "hatch3r-reviewer");
    // The reader is a plain string reader like `model` — the non-level value
    // survives here and is stripped by the adapters/customization.ts enum gate.
    expect(result).toEqual({ model: "opus", effort: "TURBO" });
  });

  it("ignores an empty-string effort (same non-empty rule as model)", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      'effort: ""',
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("reads scope for rules", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "scope: src/**/*.ts",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toEqual({ scope: "src/**/*.ts" });
  });

  it("reads description for skills", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-issue-workflow.customize.yaml"),
      "description: Custom workflow description",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "skills", "hatch3r-issue-workflow");
    expect(result).toEqual({ description: "Custom workflow description" });
  });

  it("reads enabled flag", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-board-pickup.customize.yaml"),
      "enabled: false",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "commands", "hatch3r-board-pickup");
    expect(result).toEqual({ enabled: false });
  });

  it("reads multiple fields", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "scope: src/**/*.ts\ndescription: Custom testing\nenabled: true",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toEqual({
      scope: "src/**/*.ts",
      description: "Custom testing",
      enabled: true,
    });
  });

  it("ignores empty string fields", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "test.customize.yaml"),
      'model: ""\ndescription: ""',
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "test");
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid YAML", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "test.customize.yaml"),
      "not: valid: yaml: [",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "test");
    expect(result).toBeUndefined();
  });

  // D2-12 (Cycle 11 Wave 3): a YAML parse error must surface a warning instead
  // of silently dropping the override (Silent Failure Contract, CONSTITUTION
  // §2 P5). The bare `readCustomization` wrapper discards warnings, so assert
  // through `readCustomizationWithWarnings` that the value is undefined AND a
  // warning naming the file and the parse reason is emitted.
  it("warns (not silently) when YAML fails to parse", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "enabled: false\nbroken: [unterminated",
      "utf-8",
    );
    const { value, warnings } = await readCustomizationWithWarnings(
      projectRoot,
      "rules",
      "hatch3r-testing",
    );
    expect(value).toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("failed to parse");
    expect(warnings[0]).toContain("hatch3r-testing");
    expect(warnings[0]).toContain(".hatch3r/rules/hatch3r-testing.customize.yaml");
  });

  // D2-12: the parse-error warning must propagate through the snapshot reader
  // so init/sync/update — which read via readCustomizationSnapshot — see it.
  it("propagates the YAML-parse-error warning through readCustomizationSnapshot", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: [opus",
      "utf-8",
    );
    const result = await readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    expect(result.yaml).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("failed to parse"))).toBe(true);
  });

  // D2-12: ENOENT (no customization file at all) must remain a clean no-op —
  // the warning is for present-but-unparseable files, not absent ones.
  it("does not warn when the customization file is absent (ENOENT)", async () => {
    const projectRoot = await createProjectRoot();
    const { value, warnings } = await readCustomizationWithWarnings(
      projectRoot,
      "agents",
      "no-such-id",
    );
    expect(value).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("readCustomizationMarkdown", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-md-"));
    return tempDir;
  }

  it("returns undefined when file does not exist", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readCustomizationMarkdown(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("returns content when file exists", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.md"),
      "## Custom Instructions\n\nReview for HIPAA compliance.",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toBe("## Custom Instructions\n\nReview for HIPAA compliance.");
  });

  it("returns undefined for empty file", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.md"),
      "",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "rules", "hatch3r-testing");
    expect(result).toBeUndefined();
  });

  it("returns undefined for whitespace-only file", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-issue-workflow.customize.md"),
      "   \n\n  \n",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "skills", "hatch3r-issue-workflow");
    expect(result).toBeUndefined();
  });

  it("trims content", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-board-pickup.customize.md"),
      "\n  Custom release steps  \n",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "commands", "hatch3r-board-pickup");
    expect(result).toBe("Custom release steps");
  });

  it("reads from different type directories", async () => {
    const projectRoot = await createProjectRoot();

    for (const type of ["agents", "skills", "commands", "rules"] as const) {
      const dir = join(projectRoot, ".hatch3r", type);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `test-id.customize.md`),
        `Custom ${type} content`,
        "utf-8",
      );
      const result = await readCustomizationMarkdown(projectRoot, type, "test-id");
      expect(result).toBe(`Custom ${type} content`);
    }
  });
});

describe("readCustomizationSnapshot (C8-D2-M4 TOCTOU guard)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-snapshot-"));
    return tempDir;
  }

  it("returns undefined values and no warnings when neither file exists", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    expect(result.yaml).toBeUndefined();
    expect(result.md).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("reads both files consistently when neither changes during the read", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus",
      "utf-8",
    );
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.md"),
      "Focus on security.",
      "utf-8",
    );
    const result = await readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    expect(result.yaml).toEqual({ model: "opus" });
    expect(result.md).toBe("Focus on security.");
    expect(result.warnings).toEqual([]);
  });

  it("detects edit-during-sync by bumping yaml mtime mid-read", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    const yamlPath = join(dir, "hatch3r-reviewer.customize.yaml");
    await writeFile(yamlPath, "model: opus", "utf-8");
    // Pin the pre-read mtime to a known past timestamp so the bump is
    // observable against the filesystem's resolution.
    const past = new Date(Date.now() - 60_000);
    await utimes(yamlPath, past, past);

    // Race an mtime bump into the middle of the snapshot call. The snapshot
    // runs pre-stat -> reads -> post-stat as separate awaits; yielding to
    // the microtask queue after the call begins gives the snapshot time to
    // begin before we bump the file.
    const snapshotPromise = readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    await Promise.resolve();
    await Promise.resolve();
    const future = new Date(Date.now() + 60_000);
    await utimes(yamlPath, future, future);

    const result = await snapshotPromise;
    // Race timing may not always land between pre-stat and post-stat.
    // When it does, the helper must warn and name the yaml file; when it
    // misses, the helper still returns consistent values. Both outcomes
    // are acceptable for a best-effort detector; the property we assert
    // is that whenever a warning is emitted it names the offending file.
    expect(result.yaml).toEqual({ model: "opus" });
    if (result.warnings.length > 0) {
      expect(result.warnings[0]).toContain("changed during sync");
      expect(result.warnings[0]).toContain(".customize.yaml");
    }
  });

  it("emits a warning naming the md file when the md mtime bump lands mid-read", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    const yamlPath = join(dir, "hatch3r-reviewer.customize.yaml");
    const mdPath = join(dir, "hatch3r-reviewer.customize.md");
    await writeFile(yamlPath, "model: opus", "utf-8");
    await writeFile(mdPath, "Focus on security.", "utf-8");
    const past = new Date(Date.now() - 60_000);
    await utimes(yamlPath, past, past);
    await utimes(mdPath, past, past);

    const snapshotPromise = readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    await Promise.resolve();
    await Promise.resolve();
    const future = new Date(Date.now() + 60_000);
    await utimes(mdPath, future, future);

    const result = await snapshotPromise;
    expect(result.yaml).toEqual({ model: "opus" });
    expect(result.md).toBe("Focus on security.");
    if (result.warnings.length > 0) {
      expect(result.warnings[0]).toContain("changed during sync");
      expect(result.warnings[0]).toContain(".customize.md");
    }
  });

  it("propagates oversized yaml warnings from the underlying reader", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    const largeYaml = "# pad\n".repeat(2048) + "model: opus";
    await writeFile(join(dir, "hatch3r-reviewer.customize.yaml"), largeYaml, "utf-8");
    const result = await readCustomizationSnapshot(projectRoot, "agents", "hatch3r-reviewer");
    expect(result.warnings.some((w) => w.includes("exceeds"))).toBe(true);
  });

  it("returns empty values and no warnings for a sanitized traversal id", async () => {
    const projectRoot = await createProjectRoot();
    // sanitizeId strips traversal characters, so a malicious id resolves to
    // a safe path within the project root with no matching files. The
    // snapshot helper must not throw and must return undefined values.
    const result = await readCustomizationSnapshot(projectRoot, "agents", "../../etc/passwd");
    expect(result.yaml).toBeUndefined();
    expect(result.md).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
});

// D3-SA3.4-07 (Cycle 12 Wave 4): the two snapshot tests above race a real
// `utimes` bump against the read window and assert the "changed during sync"
// warning only inside `if (result.warnings.length > 0)` — so when the race
// misses, the warning branch never runs yet the tests still pass, and a
// regression in the message text, recovery guidance, or file naming cannot
// fail CI. Those tests stay as best-effort integration smoke. The warning
// EMISSION given a detected mtime mismatch is deterministic pure logic, so it
// is unit-tested here against the extracted `detectSnapshotDrift` comparator
// with no filesystem race: yaml-only, md-only, both-changed, no-change, and
// existence-transition cases assert the exact warning unconditionally.
describe("detectSnapshotDrift (D3-SA3.4-07 deterministic drift emission)", () => {
  const expectedMessage = (id: string, which: string, type: string): string =>
    `Customization file(s) for "${id}" changed during sync (${which}). ` +
    `Snapshot may be inconsistent — the output for this run is based on a partial read. ` +
    `To regenerate cleanly: save all .hatch3r/${type}/*.customize.{yaml,md} edits, then ` +
    `run \`hatch3r sync\` (no flags needed).`;

  it("returns no warnings when neither mtime changed", () => {
    const warnings = detectSnapshotDrift(
      "agents",
      "hatch3r-reviewer",
      { yaml: 1000, md: 2000 },
      { yaml: 1000, md: 2000 },
    );
    expect(warnings).toEqual([]);
  });

  it("returns no warnings when both files are absent before and after (undefined pair)", () => {
    const warnings = detectSnapshotDrift(
      "agents",
      "hatch3r-reviewer",
      { yaml: undefined, md: undefined },
      { yaml: undefined, md: undefined },
    );
    expect(warnings).toEqual([]);
  });

  it("emits exactly the yaml warning when only the yaml mtime changed", () => {
    const warnings = detectSnapshotDrift(
      "agents",
      "hatch3r-reviewer",
      { yaml: 1000, md: 2000 },
      { yaml: 1500, md: 2000 },
    );
    expect(warnings).toEqual([
      expectedMessage("hatch3r-reviewer", ".customize.yaml", "agents"),
    ]);
    expect(warnings[0]).not.toContain(".customize.md)");
  });

  it("emits exactly the md warning when only the md mtime changed", () => {
    const warnings = detectSnapshotDrift(
      "rules",
      "hatch3r-testing",
      { yaml: 1000, md: 2000 },
      { yaml: 1000, md: 2500 },
    );
    expect(warnings).toEqual([
      expectedMessage("hatch3r-testing", ".customize.md", "rules"),
    ]);
    expect(warnings[0]).not.toContain("(.customize.yaml");
  });

  it("names both files in yaml-then-md order when both mtimes changed", () => {
    const warnings = detectSnapshotDrift(
      "skills",
      "hatch3r-issue-workflow",
      { yaml: 1000, md: 2000 },
      { yaml: 1500, md: 2500 },
    );
    expect(warnings).toEqual([
      expectedMessage(
        "hatch3r-issue-workflow",
        ".customize.yaml, .customize.md",
        "skills",
      ),
    ]);
  });

  it("treats an ENOENT->present transition (undefined -> number) as a change", () => {
    const warnings = detectSnapshotDrift(
      "commands",
      "hatch3r-board-pickup",
      { yaml: undefined, md: 2000 },
      { yaml: 1500, md: 2000 },
    );
    expect(warnings).toEqual([
      expectedMessage("hatch3r-board-pickup", ".customize.yaml", "commands"),
    ]);
  });

  it("treats a present->ENOENT transition (number -> undefined) as a change", () => {
    const warnings = detectSnapshotDrift(
      "agents",
      "hatch3r-reviewer",
      { yaml: 1000, md: 2000 },
      { yaml: 1000, md: undefined },
    );
    expect(warnings).toEqual([
      expectedMessage("hatch3r-reviewer", ".customize.md", "agents"),
    ]);
  });

  it("carries the recovery guidance and the type-scoped path in the message", () => {
    const [warning] = detectSnapshotDrift(
      "rules",
      "hatch3r-testing",
      { yaml: 1000, md: undefined },
      { yaml: 2000, md: undefined },
    );
    expect(warning).toContain("run `hatch3r sync` (no flags needed).");
    expect(warning).toContain(".hatch3r/rules/*.customize.{yaml,md}");
    expect(warning).toContain("Snapshot may be inconsistent");
  });
});

// F2.3-H4 (Cycle 10 Wave 2): the .customize.md byte limits are exported from
// this module as the single source of truth (CONSTITUTION §2 P5 Anti-Bloat
// Principle 1). The adapter layer (src/adapters/customization.ts) consumes
// these exports instead of re-declaring its own literals. Pinning the values
// here makes any future divergence a test failure rather than a silent
// read-time vs apply-time mismatch.
describe("customize byte-limit single source of truth (F2.3-H4)", () => {
  it("exports MAX_CUSTOMIZE_MD_BYTES as 10240", () => {
    expect(MAX_CUSTOMIZE_MD_BYTES).toBe(10_240);
  });

  it("exports MAX_PROTECTED_CUSTOMIZE_MD_BYTES as 2048", () => {
    expect(MAX_PROTECTED_CUSTOMIZE_MD_BYTES).toBe(2_048);
  });

  it("keeps the protected cap strictly below the default cap", () => {
    expect(MAX_PROTECTED_CUSTOMIZE_MD_BYTES).toBeLessThan(MAX_CUSTOMIZE_MD_BYTES);
  });
});
