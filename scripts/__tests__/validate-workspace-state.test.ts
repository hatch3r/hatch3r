import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALL_VERDICTS,
  CHECKPOINT_NAME,
  CONSENT_TIERS,
  LEDGER_NAME,
  MODE_RE,
  ROUND1_VERDICTS,
  ROUND2_VERDICTS,
  WORKSPACE_DIR_NAME,
  classifyLedgerLine,
  runValidator,
  validateCheckpoint,
  validateLedger,
  validateVerdictEntry,
} from "../validate-workspace-state.js";

// ── Fixtures ──────────────────────────────────────────────────────────

/** Minimal §0.6-conformant checkpoint (modeled on the b911d8f5 residual). */
function makeCheckpoint(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    engine: "evolve",
    schema_version: 1,
    run_id: "deadbeef",
    mode: "scoped:A02,A08",
    phase: "§4",
    session_count: 1,
    corpus_sha: "0123456789abcdef0123456789abcdef01234567",
    prompt_sha: "a".repeat(64),
    inventory_hashes: { "governance/CONSTITUTION.md": "b".repeat(64) },
    agenda: { total_blocks: 2, cursor: 1, verdicts_done: 1 },
    round2: { presented: 0, total_candidates: 0 },
    research: { briefs_complete: [], gathered_at: null },
    rewrite: {
      wave: 0,
      files_done: [],
      files_pending: [],
      rolled_back: [],
      failed: [],
      rewritten_hashes: {},
    },
    last_gate: "§1.5",
    by_analogy_decisions: [],
    timestamp: "2026-07-14T15:00:00Z",
    ...overrides,
  };
}

/** Minimal §0.6-conformant round-1 verdict-ledger entry. */
function makeVerdict(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "A02",
    sub_block_of: null,
    name: "CONSTITUTION",
    verdict: "keep-as-is",
    round: 1,
    files: ["governance/CONSTITUTION.md"],
    accepted_suggestions: [],
    rejected_suggestions: [],
    concerns: [],
    direction: "no change",
    new_lean_cap: null,
    consent_tier: "standard",
    owner_consent: true,
    pct_answers: null,
    rationale_dated: "2026-07-14 — verdict rationale",
    ts: "2026-07-14T13:05:00Z",
    ...overrides,
  };
}

function pointersOf(violations: ReadonlyArray<{ pointer: string }>): string[] {
  return violations.map((v) => v.pointer);
}

// ── Enum constants ────────────────────────────────────────────────────

describe("§0.6 enum constants", () => {
  it("declares the round-1 verdict subset", () => {
    expect([...ROUND1_VERDICTS].sort()).toEqual(
      ["deferred", "keep-as-is", "refine", "remove-or-merge", "rewrite"].sort(),
    );
  });

  it("declares the round-2 verdict subset", () => {
    expect([...ROUND2_VERDICTS].sort()).toEqual(
      ["adopt", "defer", "reject"].sort(),
    );
  });

  it("ALL_VERDICTS is the union of the two subsets", () => {
    expect(ALL_VERDICTS.size).toBe(ROUND1_VERDICTS.size + ROUND2_VERDICTS.size);
    for (const v of [...ROUND1_VERDICTS, ...ROUND2_VERDICTS]) {
      expect(ALL_VERDICTS.has(v)).toBe(true);
    }
  });

  it("declares the two consent tiers (s8-labeled is the JSON form of §8-labeled)", () => {
    expect([...CONSENT_TIERS].sort()).toEqual(["s8-labeled", "standard"]);
  });

  it("MODE_RE accepts the three §0.6 mode shapes and rejects near-misses", () => {
    for (const ok of [
      "full-rewrite",
      "assess-only",
      "scoped:A02",
      "scoped:A02,A08",
      "scoped:A00,A14,A15",
    ]) {
      expect(MODE_RE.test(ok)).toBe(true);
    }
    for (const bad of [
      "scoped:",
      "scoped:A2",
      "scoped:A02,",
      "scoped:B02",
      "full_rewrite",
      "assess",
      "",
    ]) {
      expect(MODE_RE.test(bad)).toBe(false);
    }
  });
});

// ── validateCheckpoint ────────────────────────────────────────────────

describe("validateCheckpoint", () => {
  it("passes a §0.6-conformant checkpoint (extra diagnostic keys tolerated)", () => {
    const cp = makeCheckpoint({ cadence_override: "note", inventory_note: "x" });
    expect(validateCheckpoint(cp)).toEqual([]);
  });

  it("rejects a non-object root with a single (root) violation", () => {
    for (const root of [null, [], "x", 7]) {
      const v = validateCheckpoint(root);
      expect(v).toHaveLength(1);
      expect(v[0].pointer).toBe("(root)");
    }
  });

  it("flags a wrong engine literal", () => {
    const v = validateCheckpoint(makeCheckpoint({ engine: "audit" }));
    expect(pointersOf(v)).toEqual(["engine"]);
  });

  it("flags a non-1 schema_version (including the string '1')", () => {
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ schema_version: 2 })))).toEqual(["schema_version"]);
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ schema_version: "1" })))).toEqual(["schema_version"]);
  });

  it("flags a mode outside the §0.6 shape", () => {
    const v = validateCheckpoint(makeCheckpoint({ mode: "banana" }));
    expect(pointersOf(v)).toEqual(["mode"]);
  });

  it("flags each missing required scalar (run_id, phase, corpus_sha, prompt_sha, timestamp)", () => {
    for (const key of ["run_id", "phase", "corpus_sha", "prompt_sha", "timestamp"]) {
      const v = validateCheckpoint(makeCheckpoint({ [key]: undefined }));
      expect(pointersOf(v)).toContain(key);
    }
  });

  it("flags a non-object inventory_hashes", () => {
    const v = validateCheckpoint(makeCheckpoint({ inventory_hashes: [] }));
    expect(pointersOf(v)).toEqual(["inventory_hashes"]);
  });

  it("flags a missing agenda and each missing agenda counter", () => {
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ agenda: null })))).toEqual(["agenda"]);
    const v = validateCheckpoint(
      makeCheckpoint({ agenda: { total_blocks: 2, cursor: "1", verdicts_done: 1 } }),
    );
    expect(pointersOf(v)).toEqual(["agenda.cursor"]);
  });

  it("flags missing round2 / research objects", () => {
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ round2: undefined })))).toEqual(["round2"]);
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ research: "none" })))).toEqual(["research"]);
  });

  it("flags rewrite sub-key violations (wave, arrays, rewritten_hashes)", () => {
    expect(pointersOf(validateCheckpoint(makeCheckpoint({ rewrite: 3 })))).toEqual(["rewrite"]);
    const v = validateCheckpoint(
      makeCheckpoint({
        rewrite: {
          wave: "2",
          files_done: [],
          files_pending: {},
          rolled_back: [],
          failed: [],
          rewritten_hashes: [],
        },
      }),
    );
    expect(pointersOf(v).sort()).toEqual([
      "rewrite.files_pending",
      "rewrite.rewritten_hashes",
      "rewrite.wave",
    ]);
  });

  it("flags a non-array by_analogy_decisions", () => {
    const v = validateCheckpoint(makeCheckpoint({ by_analogy_decisions: {} }));
    expect(pointersOf(v)).toEqual(["by_analogy_decisions"]);
  });
});

// ── ledger line classification + verdict validation ──────────────────

describe("classifyLedgerLine", () => {
  it("classifies gate-keyed lines without a verdict as consent records", () => {
    expect(classifyLedgerLine({ gate: "s7-consent", file: "x", ts: "t" })).toBe("consent");
  });

  it("classifies id/verdict/round-anchored lines as verdict entries", () => {
    expect(classifyLedgerLine(makeVerdict())).toBe("verdict");
    expect(classifyLedgerLine({ verdict: "refine" })).toBe("verdict");
    expect(classifyLedgerLine({ round: 2 })).toBe("verdict");
  });

  it("classifies anchor-less lines as unrecognized", () => {
    expect(classifyLedgerLine({ foo: 1 })).toBe("unrecognized");
  });
});

describe("validateVerdictEntry", () => {
  const FILE = ".evolve-workspace/verdict-ledger.jsonl";

  it("passes a conformant round-1 entry with null pct_answers", () => {
    expect(validateVerdictEntry(makeVerdict(), "line 1", FILE)).toEqual([]);
  });

  it("passes a round-2 entry with an in-subset verdict and pct_answers", () => {
    const entry = makeVerdict({ verdict: "adopt", round: 2, pct_answers: "6 answers" });
    expect(validateVerdictEntry(entry, "line 1", FILE)).toEqual([]);
  });

  it("flags each missing required string (id, name, rationale_dated, ts)", () => {
    for (const key of ["id", "name", "rationale_dated", "ts"]) {
      const v = validateVerdictEntry(makeVerdict({ [key]: "" }), "line 1", FILE);
      expect(pointersOf(v)).toContain(`line 1 · ${key}`);
    }
  });

  it("flags a round outside {1, 2}", () => {
    const v = validateVerdictEntry(makeVerdict({ round: 3 }), "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · round");
  });

  it("flags a verdict outside the §0.6 union", () => {
    const v = validateVerdictEntry(makeVerdict({ verdict: "approve" }), "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · verdict");
  });

  it("flags a round-1 entry carrying a round-2 verdict", () => {
    const v = validateVerdictEntry(makeVerdict({ verdict: "adopt" }), "line 1", FILE);
    expect(v).toHaveLength(1);
    expect(v[0].problem).toMatch(/round-1 entry carries the round-2 verdict/);
  });

  it("flags a round-2 entry carrying a round-1 verdict", () => {
    const entry = makeVerdict({ verdict: "refine", round: 2, pct_answers: "6 answers" });
    const v = validateVerdictEntry(entry, "line 1", FILE);
    expect(v).toHaveLength(1);
    expect(v[0].problem).toMatch(/round-2 entry carries the round-1 verdict/);
  });

  it("flags a non-array files value", () => {
    const v = validateVerdictEntry(makeVerdict({ files: "one.md" }), "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · files");
  });

  it("flags a consent_tier outside {standard, s8-labeled}", () => {
    const v = validateVerdictEntry(makeVerdict({ consent_tier: "§8-labeled" }), "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · consent_tier");
  });

  it("accepts the s8-labeled consent tier", () => {
    const v = validateVerdictEntry(makeVerdict({ consent_tier: "s8-labeled" }), "line 1", FILE);
    expect(v).toEqual([]);
  });

  it("flags a non-boolean owner_consent", () => {
    const v = validateVerdictEntry(makeVerdict({ owner_consent: "yes" }), "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · owner_consent");
  });

  it("flags a non-array accepted_suggestions when present", () => {
    const v = validateVerdictEntry(
      makeVerdict({ accepted_suggestions: "SUG-1" }),
      "line 1",
      FILE,
    );
    expect(pointersOf(v)).toContain("line 1 · accepted_suggestions");
  });

  it("requires non-null pct_answers when accepted_suggestions is non-empty", () => {
    const v = validateVerdictEntry(
      makeVerdict({ accepted_suggestions: ["SUG-1"], pct_answers: null }),
      "line 1",
      FILE,
    );
    expect(pointersOf(v)).toContain("line 1 · pct_answers");
  });

  it("requires non-null pct_answers on every round-2 entry", () => {
    const entry = makeVerdict({ verdict: "defer", round: 2, pct_answers: null });
    const v = validateVerdictEntry(entry, "line 1", FILE);
    expect(pointersOf(v)).toContain("line 1 · pct_answers");
  });

  it("does not require pct_answers on a round-1 entry with no accepted suggestions", () => {
    const entry = makeVerdict({ pct_answers: undefined });
    expect(validateVerdictEntry(entry, "line 1", FILE)).toEqual([]);
  });
});

// ── validateLedger ────────────────────────────────────────────────────

describe("validateLedger", () => {
  it("validates verdict lines, counts consent lines, and skips blanks", () => {
    const content =
      [
        JSON.stringify(makeVerdict()),
        JSON.stringify({ gate: "s7-consent", file: "governance/X.md", consent: "apply", ts: "2026-07-14" }),
        JSON.stringify(makeVerdict({ id: "A08", verdict: "refine", accepted_suggestions: ["SUG-1"], pct_answers: "6 answers" })),
        "",
      ].join("\n") + "\n";
    const report = validateLedger(content);
    expect(report.violations).toEqual([]);
    expect(report.verdictCount).toBe(2);
    expect(report.consentCount).toBe(1);
  });

  it("reports a malformed JSON line with its 1-based line number", () => {
    const content = JSON.stringify(makeVerdict()) + "\n{not json}\n";
    const report = validateLedger(content);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].pointer).toBe("line 2");
    expect(report.violations[0].problem).toMatch(/not valid JSON/);
  });

  it("reports a non-object line (array / scalar)", () => {
    const report = validateLedger('["a"]\n7\n');
    expect(report.violations).toHaveLength(2);
    expect(report.violations.every((v) => /must be a JSON object/.test(v.problem))).toBe(true);
  });

  it("reports an anchor-less line as unrecognized", () => {
    const report = validateLedger('{"foo": 1}\n');
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].problem).toMatch(/matches neither/);
  });
});

// ── runValidator (filesystem behavior) ────────────────────────────────

describe("runValidator", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-state-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seedWorkspace(files: Record<string, string>): Promise<void> {
    const wsDir = join(rootDir, WORKSPACE_DIR_NAME);
    await mkdir(wsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(wsDir, name), content, "utf-8");
    }
  }

  it("skips cleanly when .evolve-workspace/ is absent (ephemeral + gitignored)", async () => {
    const result = await runValidator({ rootDir });
    expect(result.violations).toEqual([]);
    expect(result.checked).toEqual([]);
    expect(result.skipped).toEqual([`${WORKSPACE_DIR_NAME}/`]);
  });

  it("skips each absent target file individually", async () => {
    await seedWorkspace({});
    const result = await runValidator({ rootDir });
    expect(result.violations).toEqual([]);
    expect(result.checked).toEqual([]);
    expect(result.skipped.sort()).toEqual([
      `${WORKSPACE_DIR_NAME}/${CHECKPOINT_NAME}`,
      `${WORKSPACE_DIR_NAME}/${LEDGER_NAME}`,
    ]);
  });

  it("passes a conformant checkpoint + ledger pair", async () => {
    await seedWorkspace({
      [CHECKPOINT_NAME]: JSON.stringify(makeCheckpoint(), null, 2),
      [LEDGER_NAME]:
        JSON.stringify(makeVerdict()) +
        "\n" +
        JSON.stringify({ gate: "s8-landing", file: "governance/CONSTITUTION.md", ts: "2026-07-14" }) +
        "\n",
    });
    const result = await runValidator({ rootDir });
    expect(result.violations).toEqual([]);
    expect(result.checked).toHaveLength(2);
    expect(result.verdictCount).toBe(1);
    expect(result.consentCount).toBe(1);
  });

  it("reports checkpoint violations with the repo-relative file path", async () => {
    await seedWorkspace({
      [CHECKPOINT_NAME]: JSON.stringify(makeCheckpoint({ mode: "banana" })),
    });
    const result = await runValidator({ rootDir });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe(`${WORKSPACE_DIR_NAME}/${CHECKPOINT_NAME}`);
    expect(result.violations[0].pointer).toBe("mode");
    expect(result.skipped).toEqual([`${WORKSPACE_DIR_NAME}/${LEDGER_NAME}`]);
  });

  it("reports an unparseable checkpoint as a single (root) violation", async () => {
    await seedWorkspace({ [CHECKPOINT_NAME]: "{broken" });
    const result = await runValidator({ rootDir });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].pointer).toBe("(root)");
    expect(result.violations[0].problem).toMatch(/not valid JSON/);
  });

  it("validates the ledger alone when only it exists", async () => {
    await seedWorkspace({
      [LEDGER_NAME]: JSON.stringify(makeVerdict({ owner_consent: "yes" })) + "\n",
    });
    const result = await runValidator({ rootDir });
    expect(result.checked).toEqual([`${WORKSPACE_DIR_NAME}/${LEDGER_NAME}`]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].pointer).toBe("line 1 · owner_consent");
  });
});
