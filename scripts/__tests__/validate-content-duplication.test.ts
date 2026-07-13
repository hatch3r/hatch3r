import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORPUS_CEILINGS,
  DEFAULT_CORPORA,
  DEFAULT_MAX,
  WINDOW_LINES,
  formatResult,
  measureDuplication,
  normalizeLine,
  runValidator,
  stripFrontmatter,
} from "../validate-content-duplication.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p4-content-dup-"));
  return { rootDir };
}

async function seedFile(rootDir: string, relPath: string, content: string): Promise<void> {
  const abs = join(rootDir, relPath);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

/** A unique non-trivial line so a file can be padded to a known length. */
function uniq(n: number): string {
  return `unique substantive line number ${n} with content`;
}

/** A block of N identical substantive lines (a clone seed when repeated). */
function clone(label: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${label} shared clone body line ${i}`);
}

describe("validate-content-duplication", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Constants reflect the CONSTITUTION contract ─────────────────

  describe("module constants", () => {
    it("defaults the duplication ceiling to the CONSTITUTION 5% threshold", () => {
      // CONSTITUTION.md:97 "Cross-file duplication | <5%" and CONSTITUTION.md:268
      // CQ8 "jscpd duplication index ≤5% per cycle".
      expect(DEFAULT_MAX).toBe(5);
    });

    it("scans the four content corpora named in finding D6-4", () => {
      expect([...DEFAULT_CORPORA]).toEqual(["agents", "rules", "commands", "skills"]);
    });

    it("uses a 5-line clone window (jscpd --min-lines granularity)", () => {
      expect(WINDOW_LINES).toBe(5);
    });

    it("carries a documented commands/ baseline above the 5% target (D6-5 debt)", () => {
      // commands/ measured 13.82% (jscpd) at introduction; the baseline must be
      // a ratchet ABOVE the target so the gate lands green pending D6-5, never
      // below it (a sub-target ceiling would be a silent relaxation).
      expect(CORPUS_CEILINGS.commands).toBeGreaterThan(DEFAULT_MAX);
    });

    it("ratcheted the commands/ ceiling DOWN to the ex-frontmatter measurement (7%)", () => {
      // D22-4 extracted the seven recurring orchestration scaffold blocks to
      // commands/shared/orchestration-frame.md (14.43% -> 11.78%, frontmatter
      // included). Cycle 12 D22-SA22.2-05 then excluded YAML frontmatter from the
      // metric (stripFrontmatter), re-basing commands to 6.41% body-only; the
      // ceiling ratcheted 12 -> 7 (ceil of 6.41%) to re-lock the gain under the
      // new metric — never a relaxation (still at/below the prior 18% baseline),
      // and above the live 6.41% so the gate stays green while failing on any
      // regression past 7%.
      expect(CORPUS_CEILINGS.commands).toBe(7);
      expect(CORPUS_CEILINGS.commands).toBeLessThan(18);
    });

    it("never sets a per-corpus ceiling below the 5% structural target", () => {
      // Every baseline is a temporary RELAXATION pending extraction; a ceiling
      // tighter than DEFAULT_MAX would be dead config (DEFAULT_MAX already
      // covers it) and signals a typo.
      for (const [corpus, ceiling] of Object.entries(CORPUS_CEILINGS)) {
        expect(ceiling, `${corpus} ceiling`).toBeGreaterThanOrEqual(DEFAULT_MAX);
      }
    });
  });

  // ── normalizeLine ───────────────────────────────────────────────

  describe("normalizeLine", () => {
    it("collapses internal whitespace and trims (jscpd whitespace tolerance)", () => {
      expect(normalizeLine("  a\t b   c  ")).toBe("a b c");
    });

    it("makes whitespace-only indentation differences compare equal", () => {
      expect(normalizeLine("    - item")).toBe(normalizeLine("\t- item"));
    });
  });

  // ── stripFrontmatter (D22-SA22.2-05) ────────────────────────────

  describe("stripFrontmatter", () => {
    it("removes the leading `---`…`---` block and returns the body that follows", () => {
      const raw = ["---", "id: x", "type: agent", "tags: [a, b]", "---", "", "# Body", "prose"].join("\n");
      expect(stripFrontmatter(raw)).toBe(["", "# Body", "prose"].join("\n"));
    });

    it("returns content unchanged when the first line is not a frontmatter delimiter", () => {
      // Models the 4 skills/**/references/*.md reference files that carry no
      // frontmatter — their body (including any later `---`) must survive intact.
      const raw = ["# Reference doc", "no frontmatter here", "---", "a body thematic break"].join("\n");
      expect(stripFrontmatter(raw)).toBe(raw);
    });

    it("returns content unchanged when an opening `---` has no closing delimiter", () => {
      const raw = ["---", "id: x", "type: agent", "(never closed)"].join("\n");
      expect(stripFrontmatter(raw)).toBe(raw);
    });

    it("closes the block at the FIRST `---` after line 0 and preserves a body-level HR", () => {
      const raw = ["---", "id: x", "---", "intro", "---", "after HR"].join("\n");
      expect(stripFrontmatter(raw)).toBe(["intro", "---", "after HR"].join("\n"));
    });
  });

  // ── measureDuplication (pure metric) ────────────────────────────

  describe("measureDuplication", () => {
    it("reports 0 duplicated lines when no window repeats", () => {
      const files = [
        { rel: "a.md", lines: Array.from({ length: 20 }, (_, i) => uniq(i)) },
      ];
      expect(measureDuplication(files)).toEqual({ totalLines: 20, duplicatedLines: 0 });
    });

    it("counts a >= WINDOW_LINES block shared ACROSS files as duplicated in both", () => {
      const shared = clone("X", WINDOW_LINES);
      const files = [
        { rel: "a.md", lines: [...shared, uniq(1), uniq(2)] },
        { rel: "b.md", lines: [uniq(3), ...shared] },
      ];
      const r = measureDuplication(files);
      // Both copies of the 5-line block are flagged: 2 * WINDOW_LINES = 10.
      expect(r.duplicatedLines).toBe(2 * WINDOW_LINES);
      expect(r.totalLines).toBe(2 * WINDOW_LINES + 3);
    });

    it("does NOT flag a shared block shorter than WINDOW_LINES", () => {
      const shortShared = clone("S", WINDOW_LINES - 1); // 4 lines, below the window
      const files = [
        { rel: "a.md", lines: [...shortShared, uniq(1), uniq(2)] },
        { rel: "b.md", lines: [uniq(3), uniq(4), ...shortShared] },
      ];
      expect(measureDuplication(files).duplicatedLines).toBe(0);
    });

    it("flags a block repeated twice WITHIN a single file", () => {
      const shared = clone("W", WINDOW_LINES);
      const files = [{ rel: "a.md", lines: [...shared, uniq(99), ...shared] }];
      expect(measureDuplication(files).duplicatedLines).toBe(2 * WINDOW_LINES);
    });
  });

  // ── runValidator: PASS path ─────────────────────────────────────

  it("PASSes a corpus with no cross-file duplication", async () => {
    await mkdir(join(fx.rootDir, "rules"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "rules/a.md",
      Array.from({ length: 30 }, (_, i) => `rule a unique line ${i}`).join("\n"),
    );
    await seedFile(
      fx.rootDir,
      "rules/b.md",
      Array.from({ length: 30 }, (_, i) => `rule b different line ${i}`).join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, corpora: ["rules"] });
    expect(r.failures).toEqual([]);
    const rules = r.results.find((x) => x.corpus === "rules");
    expect(rules?.percent).toBe(0);
    expect(rules?.files).toBe(2);
    expect(rules?.exceeded).toBe(false);
  });

  // ── runValidator: FAIL path (the D6-4 regression) ───────────────

  it("FAILs a corpus that exceeds its ceiling and reports the percent", async () => {
    // Two files that are ~50% identical: a big shared block plus a little
    // unique tail each → well over the 5% default ceiling.
    const shared = clone("DUP", 20);
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(fx.rootDir, "commands/x.md", [...shared, uniq(1)].join("\n"));
    await seedFile(fx.rootDir, "commands/y.md", [...shared, uniq(2)].join("\n"));

    // Use a 5% ceiling override so the baked-in commands/ baseline does not mask
    // the regression this test asserts.
    const r = await runValidator({
      rootDir: fx.rootDir,
      corpora: ["commands"],
      maxOverride: 5,
    });
    expect(r.failures).toHaveLength(1);
    const cmd = r.failures[0];
    expect(cmd.corpus).toBe("commands");
    expect(cmd.exceeded).toBe(true);
    expect(cmd.percent).toBeGreaterThan(5);
    expect(cmd.ceiling).toBe(5);
  });

  // ── runValidator: per-corpus baseline ceiling honored ───────────

  it("PASSes an over-target corpus when its baseline ceiling allows it", async () => {
    // ~95% duplication, but a high per-corpus ceiling tolerates it (the D6-5
    // pending-extraction model). Without the override this would fail.
    const shared = clone("BASE", 40);
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(fx.rootDir, "commands/x.md", [...shared, uniq(1)].join("\n"));
    await seedFile(fx.rootDir, "commands/y.md", [...shared, uniq(2)].join("\n"));

    const withBaseline = await runValidator({
      rootDir: fx.rootDir,
      corpora: ["commands"],
      ceilings: { commands: 99 },
    });
    expect(withBaseline.failures).toEqual([]);

    const withoutBaseline = await runValidator({
      rootDir: fx.rootDir,
      corpora: ["commands"],
      ceilings: {}, // falls back to DEFAULT_MAX (5)
    });
    expect(withoutBaseline.failures).toHaveLength(1);
  });

  // ── runValidator: maxOverride beats per-corpus ceilings ─────────

  it("--max override replaces every per-corpus ceiling", async () => {
    const shared = clone("OV", 20);
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(fx.rootDir, "commands/x.md", [...shared, uniq(1)].join("\n"));
    await seedFile(fx.rootDir, "commands/y.md", [...shared, uniq(2)].join("\n"));

    const r = await runValidator({
      rootDir: fx.rootDir,
      corpora: ["commands"],
      // Even though CORPUS_CEILINGS.commands is high, --max 1 forces a strict
      // ceiling that this duplicated fixture exceeds.
      maxOverride: 1,
    });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].ceiling).toBe(1);
  });

  // ── runValidator: missing corpus tolerated ──────────────────────

  it("tolerates a missing corpus directory (0 files, 0%)", async () => {
    const r = await runValidator({ rootDir: fx.rootDir, corpora: ["agents"] });
    const agents = r.results.find((x) => x.corpus === "agents");
    expect(agents?.files).toBe(0);
    expect(agents?.totalLines).toBe(0);
    expect(agents?.percent).toBe(0);
    expect(r.failures).toEqual([]);
  });

  // ── runValidator: dot-dirs and nested dirs ──────────────────────

  it("recurses into subdirectories and skips dot-prefixed ones", async () => {
    const shared = clone("NEST", WINDOW_LINES);
    await mkdir(join(fx.rootDir, "commands", "board"), { recursive: true });
    await mkdir(join(fx.rootDir, "commands", ".transient"), { recursive: true });
    // Nested real file is scanned.
    await seedFile(fx.rootDir, "commands/board/a.md", [...shared, uniq(1)].join("\n"));
    await seedFile(fx.rootDir, "commands/board/b.md", [...shared, uniq(2)].join("\n"));
    // Dot-dir file is NOT scanned — if it were, it would add a third clone copy.
    await seedFile(fx.rootDir, "commands/.transient/c.md", [...shared, uniq(3)].join("\n"));

    const r = await runValidator({
      rootDir: fx.rootDir,
      corpora: ["commands"],
      maxOverride: 100,
    });
    const cmd = r.results.find((x) => x.corpus === "commands");
    // Two nested files scanned, the dot-dir one skipped.
    expect(cmd?.files).toBe(2);
  });

  // ── runValidator: frontmatter/trivial lines excluded ────────────

  it("excludes frontmatter delimiters and blank lines from the metric", async () => {
    // Two files whose ONLY shared content is the `---` frontmatter fence and
    // blank lines — trivial lines must not register as a clone.
    const body = (label: string): string =>
      [
        "---",
        `id: ${label}`,
        "type: command",
        "---",
        "",
        ...Array.from({ length: 10 }, (_, i) => `${label} body unique ${i}`),
      ].join("\n");
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(fx.rootDir, "commands/x.md", body("x"));
    await seedFile(fx.rootDir, "commands/y.md", body("y"));

    const r = await runValidator({ rootDir: fx.rootDir, corpora: ["commands"] });
    const cmd = r.results.find((x) => x.corpus === "commands");
    expect(cmd?.percent).toBe(0);
  });

  // ── runValidator: identical frontmatter BODY excluded (D22-SA22.2-05) ──

  it("does NOT count an identical multi-line frontmatter BODY block as duplication", async () => {
    // Two agents sharing the SAME 6-line frontmatter config block (>= WINDOW_LINES,
    // so it WOULD register as a cross-file clone if counted) but with disjoint prose
    // bodies. This models the CQ-specialist phase_4_trigger/efficiency_tier config
    // the adapter reads per-artifact and cannot pointerize — it must not inflate the
    // metric. Without stripFrontmatter the six identical non-trivial YAML lines clone
    // (percent > 0); with it, only the unique bodies remain (percent 0).
    const sharedFrontmatter = [
      "---",
      "type: agent",
      "efficiency_tier: high",
      "cache_friendly: true",
      "parallel_tool_default: true",
      "wall_clock_advisory_ms: 90000",
      "phase_4_trigger: on-specialist-scope",
      "---",
    ];
    const body = (label: string): string =>
      [
        ...sharedFrontmatter,
        "",
        ...Array.from({ length: 12 }, (_, i) => `${label} unique body prose line ${i}`),
      ].join("\n");
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(fx.rootDir, "agents/x.md", body("x"));
    await seedFile(fx.rootDir, "agents/y.md", body("y"));

    const r = await runValidator({ rootDir: fx.rootDir, corpora: ["agents"] });
    const agents = r.results.find((x) => x.corpus === "agents");
    expect(agents?.percent).toBe(0);
  });

  // ── Output formatter ────────────────────────────────────────────

  it("formatResult renders FAIL verdict, percent, counts, and ceiling", () => {
    const txt = formatResult({
      corpus: "commands",
      files: 46,
      totalLines: 11590,
      duplicatedLines: 1672,
      percent: 14.43,
      ceiling: 5,
      exceeded: true,
    });
    expect(txt).toContain("FAIL");
    expect(txt).toContain("commands/");
    expect(txt).toContain("14.43%");
    expect(txt).toContain("1672/11590");
    expect(txt).toContain("ceiling 5%");
  });

  it("formatResult renders an ok verdict for a passing corpus", () => {
    const txt = formatResult({
      corpus: "rules",
      files: 66,
      totalLines: 5742,
      duplicatedLines: 34,
      percent: 0.59,
      ceiling: 5,
      exceeded: false,
    });
    expect(txt).toContain("[ok]");
    expect(txt).not.toContain("FAIL");
  });

  // ── Integration: live commands/ corpus under the D22-4 ratchet ──
  // This is the value-asserting regression guard for D22-4 + D22-SA22.2-05: the
  // real commands/ corpus, after the orchestration-frame.md scaffold extraction
  // AND the frontmatter exclusion (stripFrontmatter), must sit at or under the
  // ratcheted 7% ceiling. If a future inline copy of a scaffold block (or an
  // un-pointered new command) pushes it back over 7%, this test fails, forcing
  // the author to pointer the block per commands/shared/orchestration-frame.md.
  it("holds the live commands/ corpus at or under the ratcheted ceiling", async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const r = await runValidator({ rootDir: repoRoot, corpora: ["commands"] });
    const cmd = r.results.find((x) => x.corpus === "commands");
    expect(cmd, "commands corpus result").toBeDefined();
    // Must not regress past the ratchet captured in CORPUS_CEILINGS.commands.
    expect(cmd!.percent).toBeLessThanOrEqual(CORPUS_CEILINGS.commands);
    expect(cmd!.exceeded).toBe(false);
    // And the corpus stays within a point of its locked ceiling: an independent
    // hardcoded guard (7 + 1) so that even if someone relaxes
    // CORPUS_CEILINGS.commands upward and re-inlines the extracted blocks, this
    // assertion still catches the duplication jump.
    expect(cmd!.percent).toBeLessThan(8);
  });
});
