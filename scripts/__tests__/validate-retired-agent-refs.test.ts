import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SCANNED_DIRS,
  EXEMPT_FILES,
  LEGACY_CUE_RE,
  RETIRED_ID_MAP,
  RETIRED_IDS,
  findRetiredIdsOnLine,
  formatFinding,
  runValidator,
  scanFileContent,
} from "../validate-retired-agent-refs.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p5-retired-agent-refs-"));
  return { rootDir };
}

async function seedFile(rootDir: string, relPath: string, content: string): Promise<void> {
  const abs = join(rootDir, relPath);
  await mkdir(join(abs, "..").replace(/\/?$/, ""), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

// Single scan dir used by most tests so we don't depend on the full default set.
const ONE_DIR = ["agents"] as const;

describe("validate-retired-agent-refs", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Retired-id map constants ────────────────────────────────────

  describe("retired-id map", () => {
    it("maps the 3 pre-2.0.0 meta-agent ids to their canonical CQ specialists", () => {
      expect(RETIRED_ID_MAP).toEqual({
        "test-writer": "hatch3r-testability",
        "security-auditor": "hatch3r-security",
        "perf-profiler": "hatch3r-performance",
      });
    });

    it("derives RETIRED_IDS from the map keys", () => {
      expect(RETIRED_IDS.sort()).toEqual(
        ["perf-profiler", "security-auditor", "test-writer"].sort(),
      );
    });

    it("never has a retired id as a substring of its canonical replacement", () => {
      // Guarantees the word-bounded matcher cannot false-positive on the
      // replacement id itself (e.g. `hatch3r-testability` ⊅ `test-writer`).
      for (const [retired, canonical] of Object.entries(RETIRED_ID_MAP)) {
        expect(canonical.includes(retired)).toBe(false);
      }
    });

    it("exempts the severity-mapping reference doc by repo-relative POSIX path", () => {
      expect(EXEMPT_FILES.has("agents/shared/severity-mapping.md")).toBe(true);
    });

    it("scans the runtime content dirs only — governance/ is out of scope", () => {
      // Audit records (AUDIT-REPORT.md, archives, domain checklists) quote the
      // retired ids as diagnostic data; scrubbing them would erase the record.
      expect(DEFAULT_SCANNED_DIRS).toEqual([
        "agents",
        "checks",
        "commands",
        "rules",
        "skills",
        "hooks",
      ]);
      expect(DEFAULT_SCANNED_DIRS).not.toContain("governance");
    });
  });

  // ── LEGACY_CUE_RE ───────────────────────────────────────────────

  describe("LEGACY_CUE_RE", () => {
    it("matches the word `legacy` case-insensitively", () => {
      expect(LEGACY_CUE_RE.test("absorbs legacy security-auditor scope")).toBe(true);
      expect(LEGACY_CUE_RE.test("Legacy meta-agents were retired")).toBe(true);
    });

    it("also matches `retired` (2.0.0 retirement notes use that word)", () => {
      expect(
        LEGACY_CUE_RE.test("the perf-profiler delegate was retired in 2.0.0"),
      ).toBe(true);
      expect(LEGACY_CUE_RE.test("Retired and absorbed into CQ7")).toBe(true);
    });

    it("does not match a line with neither cue word", () => {
      expect(LEGACY_CUE_RE.test("this is a current dispatch line")).toBe(false);
    });
  });

  // ── findRetiredIdsOnLine ────────────────────────────────────────

  describe("findRetiredIdsOnLine", () => {
    it("finds a single retired id in parenthesized prose", () => {
      const hits = findRetiredIdsOnLine(
        "run Step 7b mandatory specialists (test-writer, security-auditor).",
      );
      expect(hits.map((h) => h.id).sort()).toEqual(
        ["security-auditor", "test-writer"].sort(),
      );
    });

    it("reports the start column of each occurrence", () => {
      const line = "the perf-profiler sub-agent";
      const hits = findRetiredIdsOnLine(line);
      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe("perf-profiler");
      expect(hits[0].startCol).toBe(line.indexOf("perf-profiler"));
    });

    it("does NOT match a retired id embedded as a substring of a longer token", () => {
      // `test-writer-helper` is a different token; the `\b` after the id
      // is satisfied by the hyphen, so guard against the embedded case using
      // a word char immediately after (a letter).
      expect(findRetiredIdsOnLine("the test-writerx variant")).toEqual([]);
      expect(findRetiredIdsOnLine("xtest-writer prefix")).toEqual([]);
    });

    it("does NOT match the canonical replacement ids", () => {
      expect(
        findRetiredIdsOnLine("hatch3r-testability hatch3r-security hatch3r-performance"),
      ).toEqual([]);
    });

    it("finds multiple distinct retired ids on one line", () => {
      const hits = findRetiredIdsOnLine(
        "researcher, implementer, reviewer, fixer, test-writer, security-auditor",
      );
      expect(hits.map((h) => h.id).sort()).toEqual(
        ["security-auditor", "test-writer"].sort(),
      );
    });
  });

  // ── scanFileContent ─────────────────────────────────────────────

  describe("scanFileContent", () => {
    it("returns no hits when only canonical ids are present", () => {
      const md = [
        "# Doc",
        "spawn hatch3r-testability and hatch3r-security via the Task tool",
      ].join("\n");
      expect(scanFileContent(md).hits).toEqual([]);
    });

    it("collects every operational retired-id occurrence with 1-based line numbers", () => {
      const md = [
        "# Doc", // 1
        "", // 2
        "Spawn the test-writer in Phase 4.", // 3
        "", // 4
        "| security-auditor | pass |", // 5
        "Sourced from the perf-profiler sub-agent.", // 6
      ].join("\n");
      const r = scanFileContent(md);
      expect(r.hits).toEqual([
        { line: 3, id: "test-writer" },
        { line: 5, id: "security-auditor" },
        { line: 6, id: "perf-profiler" },
      ]);
    });

    it("skips lines that mention `legacy` (documented historical note)", () => {
      const md = [
        "| `hatch3r-security` (CQ3) | Always | absorbs legacy security-auditor scope |",
        "| `hatch3r-testability` (CQ5) | Always | absorbs legacy test-writer scope |",
      ].join("\n");
      expect(scanFileContent(md).hits).toEqual([]);
    });

    it("skips lines that mention `retired` (2.0.0 retirement note)", () => {
      // Mirrors agents/hatch3r-performance.md:103 — a legitimate scope note.
      const md = [
        "Root-cause investigation runs in-agent — the perf-profiler delegate",
        "was retired in 2.0.0; its scope is now part of CQ7.",
      ].join("\n");
      // Line 1 has `perf-profiler` but no cue word, so on its own it would be
      // flagged — but the real one-line note keeps id + "retired" together.
      const realNote =
        "the perf-profiler delegate was retired in 2.0.0; its scope is now part of CQ7.";
      expect(scanFileContent(realNote).hits).toEqual([]);
      // The two-line split is intentionally NOT how the corpus writes it; this
      // documents that the opt-out is per-line, so id and cue must co-occur.
      expect(scanFileContent(md).hits).toEqual([{ line: 1, id: "perf-profiler" }]);
    });

    it("flags a non-legacy line even when a legacy line sits elsewhere in the file", () => {
      const md = [
        "absorbs legacy security-auditor scope", // exempt
        "Spawn the test-writer now.", // flagged
      ].join("\n");
      expect(scanFileContent(md).hits).toEqual([{ line: 2, id: "test-writer" }]);
    });
  });

  // ── runValidator: happy path ─────────────────────────────────────

  it("PASSes when every scanned file uses canonical ids", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-clean.md",
      [
        "---",
        "id: hatch3r-clean",
        "type: agent",
        "---",
        "# Clean",
        "Delegate to hatch3r-testability, hatch3r-security, hatch3r-performance.",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  // ── runValidator: retired id ERRORs with canonical replacement ──

  it("ERRORs on a retired id and names the canonical replacement", async () => {
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "commands/hatch3r-x.md",
      [
        "# Command",
        "",
        "still run Step 7b mandatory specialists (test-writer, security-auditor).",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["commands"] });
    expect(r.errorCount).toBe(2);
    const tw = r.findings.find((f) => f.message.includes("test-writer"));
    expect(tw?.code).toBe("RETIRED-AGENT-REF");
    expect(tw?.line).toBe(3);
    expect(tw?.file).toMatch(/commands\/hatch3r-x\.md$/);
    expect(tw?.message).toMatch(/hatch3r-testability/);
    const sa = r.findings.find((f) => f.message.includes("security-auditor"));
    expect(sa?.message).toMatch(/hatch3r-security/);
  });

  // ── runValidator: legacy note allowed ───────────────────────────

  it("ALLOWs retired ids on lines that document the legacy retirement", async () => {
    await mkdir(join(fx.rootDir, "rules"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "rules/hatch3r-agent-orchestration.md",
      [
        "# Orchestration",
        "",
        "| `hatch3r-security` (CQ3) | Always | absorbs legacy security-auditor scope |",
        "| `hatch3r-testability` (CQ5) | Always | absorbs legacy test-writer scope |",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["rules"] });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  // ── runValidator: exempt file skipped entirely ──────────────────

  it("skips the exempt severity-mapping.md reference doc", async () => {
    await mkdir(join(fx.rootDir, "agents", "shared"), { recursive: true });
    // This file names `security-auditor` as a historical vocabulary owner; the
    // exemption means it is never scanned (filesScanned stays 0).
    await seedFile(
      fx.rootDir,
      "agents/shared/severity-mapping.md",
      [
        "---",
        "id: shared-severity-mapping",
        "type: reference",
        "description: mapping across reviewer, fixer, security-auditor, check criteria.",
        "---",
        "# Mapping",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.filesScanned).toBe(0);
  });

  // ── runValidator: .mdc twins are scanned ────────────────────────

  it("scans .mdc rule twins, not just .md", async () => {
    await mkdir(join(fx.rootDir, "rules"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "rules/some-rule.mdc",
      ["# Rule", "", "Route to the test-writer for new tests."].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["rules"] });
    expect(r.errorCount).toBe(1);
    expect(r.findings[0].file).toMatch(/some-rule\.mdc$/);
    expect(r.findings[0].message).toMatch(/hatch3r-testability/);
  });

  // ── runValidator: recurses into nested subdirectories ───────────

  it("recurses into nested subdirectories (e.g. commands/rework/)", async () => {
    await mkdir(join(fx.rootDir, "commands", "rework"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "commands/rework/rework-plan.md",
      ["# Rework Plan", "highest-priority specialist: implementer > lint-fixer > test-writer."].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["commands"] });
    expect(r.errorCount).toBe(1);
    expect(r.findings[0].file).toMatch(/rework\/rework-plan\.md$/);
  });

  // ── runValidator: dot dirs skipped ──────────────────────────────

  it("skips dot-prefixed directories (e.g. .audit-workspace)", async () => {
    await mkdir(join(fx.rootDir, "agents", ".transient"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/.transient/note.md",
      "Spawn the test-writer.\n",
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.filesScanned).toBe(0);
  });

  // ── runValidator: missing dir tolerated ─────────────────────────

  it("silently skips scanned directories that do not exist", async () => {
    const r = await runValidator({
      rootDir: fx.rootDir,
      scannedDirs: ["does-not-exist"],
    });
    expect(r.filesScanned).toBe(0);
    expect(r.errorCount).toBe(0);
  });

  // ── runValidator: aggregates across directories ─────────────────

  it("scans every requested directory and aggregates findings", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await mkdir(join(fx.rootDir, "skills"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-clean.md",
      "# OK\nDelegate to hatch3r-security.\n",
    );
    await seedFile(
      fx.rootDir,
      "skills/bad.md",
      "# Bad\nspawn the perf-profiler sub-agent\n",
    );

    const r = await runValidator({
      rootDir: fx.rootDir,
      scannedDirs: ["agents", "skills"],
    });
    expect(r.filesScanned).toBe(2);
    expect(r.errorCount).toBe(1);
    expect(r.findings[0].file).toMatch(/skills\/bad\.md$/);
  });

  // ── Output formatter ────────────────────────────────────────────

  it("formatFinding renders ERROR tag, file:line, and message", () => {
    const txt = formatFinding({
      level: "error",
      code: "RETIRED-AGENT-REF",
      file: "commands/hatch3r-x.md",
      line: 3,
      message: 'retired agent id "test-writer" → "hatch3r-testability"',
    });
    expect(txt).toContain("ERROR");
    expect(txt).toContain("RETIRED-AGENT-REF");
    expect(txt).toContain("commands/hatch3r-x.md:3");
    expect(txt).toContain("test-writer");
  });
});
