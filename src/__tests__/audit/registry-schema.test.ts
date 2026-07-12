import { describe, expect, it } from "vitest";
import {
  checkClBalance,
  countClRegistryEntries,
  countClReportRows,
  CURRENT_REGISTRY_VERSION,
  migrate,
  parseRegistry,
  RegistryParseError,
  validateRegistry,
  type Finding,
  type Reopened,
} from "../../audit/registry-schema.js";

const FIXED_DATE = "2026-04-28T00:00:00.000Z";

function legacyMinimal(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "#42",
    domain: "D1: Core Source",
    severity: "Medium",
    description: "legacy minimal entry",
    disposition: "targeted",
    execution_status: "done",
    ...overrides,
  };
}

function modernMinimal(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "C8-D1-M1",
    domain: "D1: Core Source",
    severity: "Medium",
    description: "modern entry with rigor contract",
    disposition: "targeted",
    execution_status: "pending",
    confidence: "medium",
    causal_chain_depth: 4,
    sources: [],
    execution_tier: 3,
    central_path: false,
    cycle: 8,
    ...overrides,
  };
}

describe("parseRegistry", () => {
  it("accepts legacy v1 array", () => {
    const parsed = parseRegistry([legacyMinimal()]);
    expect(parsed.kind).toBe("legacy-v1");
    expect(parsed.rawLength).toBe(1);
  });

  it("accepts v2 envelope", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    expect(parsed.kind).toBe("v2");
    if (parsed.kind === "v2") {
      expect(parsed.registry.entries).toHaveLength(1);
      expect(parsed.registry.schema_version).toBe(CURRENT_REGISTRY_VERSION);
    }
  });

  it("throws on null root", () => {
    expect(() => parseRegistry(null)).toThrow(RegistryParseError);
  });

  it("throws on object missing schema_version", () => {
    expect(() => parseRegistry({ entries: [] })).toThrow(/schema_version/);
  });

  it("throws on object missing entries array", () => {
    expect(() =>
      parseRegistry({ schema_version: "2.0.0", generated_at: FIXED_DATE }),
    ).toThrow(/entries/);
  });

  it("throws on non-object entry", () => {
    expect(() => parseRegistry([null])).toThrow(RegistryParseError);
    expect(() => parseRegistry(["string"])).toThrow(RegistryParseError);
  });
});

describe("validateRegistry — legacy-tolerant defaults", () => {
  it("passes a clean modern entry", () => {
    const parsed = parseRegistry([modernMinimal()]);
    const drifts = validateRegistry(parsed);
    expect(drifts).toEqual([]);
  });

  it("round-trips the closed-loop fields including cl3_status (D16-16)", () => {
    const entry = modernMinimal({
      cl1_status: "applied",
      sdr_status: "none",
      cl3_status: "queued_for_cycle_11_phase_7",
    });
    const parsed = parseRegistry([entry]);
    // cl3_status is an optional free-form sibling of cl1_status/sdr_status —
    // present, preserved, and never a validation drift.
    expect(validateRegistry(parsed)).toEqual([]);
    const entries =
      parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;
    expect(entries[0].cl3_status).toBe("queued_for_cycle_11_phase_7");
  });

  it("flags legacy entries missing rigor fields when not grandfathered", () => {
    const parsed = parseRegistry([legacyMinimal()]);
    const drifts = validateRegistry(parsed);
    const reasons = new Set(drifts.map((d) => d.reason));
    expect(reasons).toContain("missing confidence");
    expect(reasons).toContain("missing causal_chain_depth");
    expect(reasons).toContain("missing sources");
  });

  it("grandfathers entries with disposition_note=pre-rigor-contract", () => {
    const parsed = parseRegistry([
      legacyMinimal({ disposition_note: "pre-rigor-contract" }),
    ]);
    const drifts = validateRegistry(parsed);
    expect(drifts).toEqual([]);
  });

  it("accepts aggregate severity on rollover summaries", () => {
    // Rollover summaries genuinely carry aggregate severities like
    // "Medium+Low" at runtime; the Severity union models canonical entries.
    const summary = {
      finding_id: "C7-D1-rollover-medium-low",
      domain: "D1",
      severity: "Medium+Low",
      description: "Cycle 7 untargeted M+L; defer",
      disposition: "partially_promoted",
      execution_status: "deferred",
    } as unknown as Finding;
    const drifts = validateRegistry(parseRegistry([summary]));
    expect(drifts.find((d) => d.reason === "invalid severity")).toBeUndefined();
  });

  it("rejects aggregate severity on a regular targeted finding", () => {
    // Cast through unknown: deliberately invalid input to verify rejection.
    const f = modernMinimal({
      severity: "Medium+Low" as unknown as Finding["severity"],
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === "invalid severity")).toBeDefined();
  });
});

describe("validateRegistry — invariants", () => {
  it("flags duplicate finding_id (Invariant 1: completeness)", () => {
    const parsed = parseRegistry([
      modernMinimal({ finding_id: "DUP-1" }),
      modernMinimal({ finding_id: "DUP-1" }),
    ]);
    const drifts = validateRegistry(parsed);
    const dup = drifts.find((d) => d.reason === "duplicate finding_id");
    expect(dup).toBeDefined();
    expect(dup?.finding_id).toBe("DUP-1");
  });

  it("flags broken dedup symmetry (Invariant 2)", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:B",
    });
    const b = modernMinimal({ finding_id: "B" /* no dedup_action */ });
    const drifts = validateRegistry(parseRegistry([a, b]));
    expect(drifts.find((d) => d.reason === "dedup symmetry broken")).toBeDefined();
  });

  it("flags merge_into pointing at a missing target (Invariant 2)", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:GHOST",
    });
    const drifts = validateRegistry(parseRegistry([a]));
    expect(drifts.find((d) => d.reason === "dedup target missing")).toBeDefined();
  });

  it("accepts symmetric merge_into / merged_from pair", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:B",
    });
    const b = modernMinimal({
      finding_id: "B",
      dedup_action: "merged_from:A",
    });
    const drifts = validateRegistry(parseRegistry([a, b]));
    expect(drifts.filter((d) => d.reason.startsWith("dedup"))).toEqual([]);
  });

  it("flags tier=1 with missing tier1_pattern (Invariant 7)", () => {
    const f = modernMinimal({ execution_tier: 1, tier1_pattern: null });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "tier=1 missing tier1_pattern"),
    ).toBeDefined();
  });

  it("flags tier=1 with pattern outside the closed enum (Invariant 7)", () => {
    const f = modernMinimal({
      execution_tier: 1,
      tier1_pattern: "made-up-pattern",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "tier1_pattern outside closed enum"),
    ).toBeDefined();
  });

  it("accepts tier=1 with a pattern from the closed enum", () => {
    const f = modernMinimal({
      execution_tier: 1,
      tier1_pattern: "anti_slop_swap",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.filter((d) =>
        d.reason.includes("tier1_pattern") || d.reason.includes("tier=1"),
      ),
    ).toEqual([]);
  });

  it("flags shallow causal_chain_depth on non-grandfathered entry", () => {
    const f = modernMinimal({ causal_chain_depth: 1 });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "shallow causal_chain_depth"),
    ).toBeDefined();
  });
});

describe("validateRegistry — Cycle Drain Contract (targeted parking)", () => {
  const PARK_REASON = "targeted finding parked at cycle close";

  it("flags a targeted finding with execution_status=deferred", () => {
    const f = modernMinimal({ execution_status: "deferred" });
    const drifts = validateRegistry(parseRegistry([f]));
    const parked = drifts.find((d) => d.reason === PARK_REASON);
    expect(parked).toBeDefined();
    expect(parked?.detail).toContain("Cycle Drain Contract");
    expect(parked?.detail).toContain("deferred");
  });

  it("flags a targeted finding with execution_status=never_attempted", () => {
    const f = modernMinimal({ execution_status: "never_attempted" });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeDefined();
  });

  it("does NOT flag a targeted finding with execution_status=done", () => {
    const f = modernMinimal({ execution_status: "done" });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted (human_only) finding with deferred status — archived data still validates", () => {
    const f = modernMinimal({
      disposition: "human_only",
      execution_status: "deferred",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted (excluded) finding with never_attempted status", () => {
    const f = modernMinimal({
      disposition: "excluded",
      execution_status: "never_attempted",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });
});

describe("validateRegistry — strict mode", () => {
  it("requires v2 envelope in strict mode", () => {
    const parsed = parseRegistry([modernMinimal()]);
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "schema_version missing")).toBeDefined();
  });

  it("flags schema_version mismatch", () => {
    const parsed = parseRegistry({
      schema_version: "1.0.0",
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(
      drifts.find((d) => d.reason === "schema_version mismatch"),
    ).toBeDefined();
  });

  it("rejects pre-rigor grandfather in strict mode", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [legacyMinimal({ disposition_note: "pre-rigor-contract" })],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "missing confidence")).toBeDefined();
  });

  it("requires execution_tier on every targeted entry in strict mode", () => {
    const f = modernMinimal();
    delete (f as { execution_tier?: unknown }).execution_tier;
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [f],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "missing execution_tier")).toBeDefined();
  });
});

describe("validateRegistry — terminal-evidence contract (D16-6 / F16.2-C1)", () => {
  const EVIDENCE_REASON = "done without closure evidence";

  function strictV2(f: Finding) {
    return parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [f],
    });
  }

  it("flags a targeted done finding carrying neither commit_sha nor disposition_note (strict)", () => {
    // F16.2-C1's broader failure mode: `done` asserted with no closure pointer.
    const f = modernMinimal({
      execution_status: "done",
      commit_sha: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    const hit = drifts.find((d) => d.reason === EVIDENCE_REASON);
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("terminal-evidence contract");
  });

  it("accepts a targeted done finding with a commit_sha", () => {
    const f = modernMinimal({ execution_status: "done", commit_sha: "abc1234" });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EVIDENCE_REASON)).toBeUndefined();
  });

  it("accepts a targeted done finding with a disposition_note but no commit_sha", () => {
    const f = modernMinimal({
      execution_status: "done",
      commit_sha: null,
      disposition_note: "closed via doc-only clarification; no diff",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EVIDENCE_REASON)).toBeUndefined();
  });

  it("does NOT apply in legacy-tolerant (non-strict) mode — grandfathers the legacy corpus", () => {
    const f = modernMinimal({ execution_status: "done", commit_sha: null });
    const drifts = validateRegistry(strictV2(f) /* no strict flag */);
    expect(drifts.find((d) => d.reason === EVIDENCE_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-done targeted finding for missing evidence (strict)", () => {
    const f = modernMinimal({ execution_status: "pending", commit_sha: null });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EVIDENCE_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted done summary for missing evidence (strict)", () => {
    const f = modernMinimal({
      disposition: "already_resolved",
      execution_status: "done",
      commit_sha: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EVIDENCE_REASON)).toBeUndefined();
  });
});

describe("validateRegistry — effectiveness leg (D16-7)", () => {
  const EFFECTIVENESS_REASON = "wiring-verb done without effectiveness note";

  function strictV2(f: Finding) {
    return parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [f],
    });
  }

  it("flags a done wiring-verb finding with empty reviewer_notes (strict)", () => {
    // D16-6's own failure mode: "wire the adoption-tracker" closed `done`
    // with a commit but no importer ever existed.
    const f = modernMinimal({
      description: "wire the adoption tracker into the cycle-close gate",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    const hit = drifts.find((d) => d.reason === EFFECTIVENESS_REASON);
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("effectiveness leg");
  });

  it("accepts a done wiring-verb finding that cites the new caller in reviewer_notes", () => {
    const f = modernMinimal({
      description: "no production callers — import telemetry into the request path",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: "new importer: src/pipeline/observability.ts:88 imports spaceTelemetry",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });

  it("treats a whitespace-only reviewer_notes as empty (trim guard)", () => {
    const f = modernMinimal({
      description: "register the new validator in the gate sweep",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: "   ",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeDefined();
  });

  it("matches the 'add … gate' phrase form", () => {
    const f = modernMinimal({
      description: "add a registry-validate gate so closure-by-assertion fails closed",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeDefined();
  });

  it("does NOT flag a done finding whose description has no wiring verb", () => {
    const f = modernMinimal({
      description: "rename the misspelled frontmatter field across all rule twins",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });

  it("does NOT false-positive on a substring like 'recall' (word-boundary guard)", () => {
    const f = modernMinimal({
      description: "document the recall behaviour of the snapshot cache",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });

  it("does NOT apply in legacy-tolerant (non-strict) mode", () => {
    const f = modernMinimal({
      description: "wire the tracker into the gate",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f) /* no strict flag */);
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-done wiring-verb finding (strict)", () => {
    const f = modernMinimal({
      description: "wire the tracker into the gate",
      execution_status: "pending",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted done wiring-verb summary (strict)", () => {
    const f = modernMinimal({
      disposition: "already_resolved",
      description: "wire the tracker into the gate",
      execution_status: "done",
      commit_sha: "abc1234",
      reviewer_notes: null,
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === EFFECTIVENESS_REASON)).toBeUndefined();
  });
});

describe("validateRegistry — postPhase2", () => {
  it("flags missing work_unit on targeted findings after Phase 2", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    const drifts = validateRegistry(parsed, { postPhase2: true });
    expect(drifts.find((d) => d.reason === "missing work_unit")).toBeDefined();
    expect(drifts.find((d) => d.reason === "missing wave")).toBeDefined();
  });

  it("passes when Phase 2 fields are populated", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal({ work_unit: "WU-A", wave: 1 })],
    });
    const drifts = validateRegistry(parsed, { postPhase2: true });
    expect(drifts).toEqual([]);
  });
});

describe("validateRegistry — commit_sha value hygiene (Invariant 8 / D16-SA16.2-07)", () => {
  const HYGIENE_REASON = "commit_sha not a git object name";

  function strictV2(f: Finding) {
    return parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [f],
    });
  }

  it("flags a placeholder commit_sha in strict mode (D16-9 'phase7' fixture)", () => {
    const f = modernMinimal({ execution_status: "done", commit_sha: "phase7" });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    const hit = drifts.find((d) => d.reason === HYGIENE_REASON);
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("Invariant 8 value hygiene");
  });

  it("accepts a bare 7-char hex abbreviation in strict mode", () => {
    const f = modernMinimal({ execution_status: "done", commit_sha: "208c8f7" });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeUndefined();
  });

  it("accepts a full 40-char SHA-1 in strict mode", () => {
    const f = modernMinimal({
      execution_status: "done",
      commit_sha: "0123456789abcdef0123456789abcdef01234567",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeUndefined();
  });

  it("accepts a <repo>:<sha> cross-repo pointer in strict mode (overlay:c0ca1c0 corpus form)", () => {
    const f = modernMinimal({
      execution_status: "done",
      commit_sha: "overlay:c0ca1c0",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeUndefined();
  });

  it("does NOT apply in legacy-tolerant (non-strict) mode — grandfathers the phase7 corpus", () => {
    const f = modernMinimal({ execution_status: "done", commit_sha: "phase7" });
    const drifts = validateRegistry(strictV2(f) /* no strict flag */);
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeUndefined();
  });

  it("does NOT flag a null commit_sha in strict mode", () => {
    const f = modernMinimal({ execution_status: "pending", commit_sha: null });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeUndefined();
  });

  it("flags a placeholder commit_sha regardless of disposition (universal value hygiene)", () => {
    const f = modernMinimal({
      disposition: "already_resolved",
      execution_status: "done",
      commit_sha: "phase7",
    });
    const drifts = validateRegistry(strictV2(f), { strict: true });
    expect(drifts.find((d) => d.reason === HYGIENE_REASON)).toBeDefined();
  });
});

describe("validateRegistry — reopened structural check (D16-SA16.2-07)", () => {
  const validReopenedTrueFix: Reopened = {
    cycle: 11,
    finding_id: "D16-6",
    prior_close:
      "Cycle-10 commit 208c8f7 marked this done but its diff never built the forcing function.",
    true_fix:
      "Cycle-11 D16-6 built scripts/audit-stalled-strategic.ts and the terminal-evidence invariant.",
  };

  it("accepts and preserves the F16.2-C1 true_fix form", () => {
    const parsed = parseRegistry([
      modernMinimal({ reopened: validReopenedTrueFix }),
    ]);
    expect(validateRegistry(parsed)).toEqual([]);
    const entries =
      parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;
    expect(entries[0].reopened?.finding_id).toBe("D16-6");
    expect(entries[0].reopened?.true_fix).toContain("audit-stalled-strategic");
  });

  it("accepts the D12-SA12.3-F07 outstanding form (still-open re-open)", () => {
    const f = modernMinimal({
      reopened: {
        cycle: 12,
        finding_id: "D12-SA12.3-01",
        prior_close:
          "Cycle-10 batch closed this already_resolved on a partial subject.",
        outstanding: "The --rules and --render subjects remain unverified.",
      },
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.filter((d) => d.reason.startsWith("reopened"))).toEqual([]);
  });

  it("flags reopened missing cycle", () => {
    const f = modernMinimal({
      reopened: {
        finding_id: "X",
        prior_close: "prior",
        true_fix: "fix",
      } as unknown as Reopened,
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "reopened missing cycle"),
    ).toBeDefined();
  });

  it("flags reopened missing prior_close", () => {
    const f = modernMinimal({
      reopened: {
        cycle: 12,
        finding_id: "X",
        true_fix: "fix",
      } as unknown as Reopened,
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "reopened missing prior_close"),
    ).toBeDefined();
  });

  it("flags reopened carrying neither true_fix nor outstanding", () => {
    const f = modernMinimal({
      reopened: {
        cycle: 12,
        finding_id: "X",
        prior_close: "prior",
      } as unknown as Reopened,
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find(
        (d) => d.reason === "reopened missing re-disposition narrative",
      ),
    ).toBeDefined();
  });

  it("flags a reopened that is not an object", () => {
    const f = modernMinimal({
      reopened: "re-opened last cycle" as unknown as Reopened,
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "reopened not an object"),
    ).toBeDefined();
  });

  it("does not flag an entry without a reopened field", () => {
    const drifts = validateRegistry(parseRegistry([modernMinimal()]));
    expect(drifts.filter((d) => d.reason.startsWith("reopened"))).toEqual([]);
  });
});

describe("CL-row balance invariant (Cycle-12 CL-3 Proposal 6c)", () => {
  // Mirrors the live AUDIT-REPORT.md shape: prose between heading and table,
  // a bold count line after the table, and (for CL-3) a subsection with its
  // own table that must never be counted.
  const REPORT_FIXTURE = [
    "# Audit Report",
    "",
    "## Phase CL-1: PRD Evolution Candidates",
    "",
    "**Trigger:** intro prose with | a stray pipe-free line.",
    "",
    "| Candidate | Domain |",
    "|-----------|--------|",
    "| Alpha | D17 |",
    "| Beta | D18 |",
    "",
    "**CL-1 count: 2**",
    "",
    "---",
    "",
    "## Phase CL-2: Content Gap Artifacts",
    "",
    "| Gap | Priority |",
    "|-----|----------|",
    "| G1 | P2 |",
    "",
    "## Phase CL-3: Audit Self-Evolution Proposals",
    "",
    "**Trigger:** constraints prose.",
    "",
    "| # | Proposal |",
    "|---|----------|",
    "| 1 | First |",
    "| 2 | Second |",
    "| 3 | Third |",
    "",
    "**CL-3 count: 3**",
    "",
    "### Routed to EVOLVE (out of CL-3 scope)",
    "",
    "| Item | Source |",
    "|------|--------|",
    "| X | Y |",
    "",
  ].join("\n");

  function clEntries(ids: ReadonlyArray<string>): Finding[] {
    return ids.map((id) =>
      modernMinimal({ finding_id: id, disposition: "phase_5_candidate" }),
    );
  }

  describe("countClReportRows", () => {
    it("counts CL-1 body rows (header + separator excluded)", () => {
      expect(countClReportRows(REPORT_FIXTURE, "CL-1")).toBe(2);
    });

    it("counts CL-3 body rows without the Routed-to-EVOLVE subsection table", () => {
      expect(countClReportRows(REPORT_FIXTURE, "CL-3")).toBe(3);
    });

    it("returns null when the phase section is absent", () => {
      expect(countClReportRows("# Report\n\nNo CL sections.\n", "CL-1")).toBeNull();
    });

    it("returns null when the section ends before any table", () => {
      const md = "## Phase CL-1: Candidates\n\nprose only\n\n## Phase CL-2: Gaps\n";
      expect(countClReportRows(md, "CL-1")).toBeNull();
    });

    it("returns 0 for a table with header + separator but no body rows", () => {
      const md = "## Phase CL-1: Candidates\n\n| A | B |\n|---|---|\n\ndone\n";
      expect(countClReportRows(md, "CL-1")).toBe(0);
    });
  });

  describe("countClRegistryEntries", () => {
    it("counts only anchored ids of the requested cycle and phase", () => {
      const entries = clEntries([
        "C12-CL1-1",
        "C12-CL1-2",
        "C12-CL3-1",
        "C11-CL1-1", // other cycle
        "C12-CL1-x", // non-numeric suffix
        "C12-CL1-1-extra", // suffixed
      ]);
      expect(countClRegistryEntries(entries, 12, "CL-1")).toBe(2);
      expect(countClRegistryEntries(entries, 12, "CL-3")).toBe(1);
      expect(countClRegistryEntries(entries, 11, "CL-1")).toBe(1);
    });
  });

  describe("checkClBalance", () => {
    it("passes when both phases balance", () => {
      const entries = clEntries([
        "C12-CL1-1",
        "C12-CL1-2",
        "C12-CL3-1",
        "C12-CL3-2",
        "C12-CL3-3",
      ]);
      expect(
        checkClBalance(entries, 12, { cl1ReportRows: 2, cl3ReportRows: 3 }),
      ).toEqual([]);
    });

    it("fails with a named, count-bearing report when CL-3 rows are not materialized", () => {
      // The exact live shape at implementation time: 10 CL-3 report rows,
      // registry entries not yet landed.
      const entries = clEntries(["C12-CL1-1", "C12-CL1-2"]);
      const failures = checkClBalance(entries, 12, {
        cl1ReportRows: 2,
        cl3ReportRows: 10,
      });
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBe("cl-row balance broken (CL-3)");
      expect(failures[0].finding_id).toBe("C12-CL3-*");
      expect(failures[0].detail).toContain("10 table row(s)");
      expect(failures[0].detail).toContain("0 C12-CL3-<n>");
      expect(failures[0].detail).toContain("materialize one registry entry per report CL row");
    });

    it("fails on orphan registry entries (more entries than report rows)", () => {
      const entries = clEntries(["C12-CL1-1", "C12-CL1-2", "C12-CL1-3"]);
      const failures = checkClBalance(entries, 12, {
        cl1ReportRows: 2,
        cl3ReportRows: 0,
      });
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBe("cl-row balance broken (CL-1)");
      expect(failures[0].detail).toContain("prune orphan entries");
    });

    it("ignores other cycles' entries when balancing", () => {
      const entries = clEntries(["C11-CL1-1", "C12-CL1-1"]);
      expect(
        checkClBalance(entries, 12, { cl1ReportRows: 1, cl3ReportRows: 0 }),
      ).toEqual([]);
    });

    it("flags a missing phase table instead of silently passing", () => {
      const failures = checkClBalance([], 12, {
        cl1ReportRows: null,
        cl3ReportRows: 0,
      });
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBe("cl-balance table missing (CL-1)");
    });

    it("reports both phases independently", () => {
      const failures = checkClBalance([], 12, {
        cl1ReportRows: 9,
        cl3ReportRows: null,
      });
      const reasons = failures.map((f) => f.reason);
      expect(reasons).toContain("cl-row balance broken (CL-1)");
      expect(reasons).toContain("cl-balance table missing (CL-3)");
    });
  });

  it("row counting composed with balancing passes on the fixture end-to-end", () => {
    const entries = clEntries([
      "C12-CL1-1",
      "C12-CL1-2",
      "C12-CL3-1",
      "C12-CL3-2",
      "C12-CL3-3",
    ]);
    const counts = {
      cl1ReportRows: countClReportRows(REPORT_FIXTURE, "CL-1"),
      cl3ReportRows: countClReportRows(REPORT_FIXTURE, "CL-3"),
    };
    expect(checkClBalance(entries, 12, counts)).toEqual([]);
  });
});

describe("migrate", () => {
  it("wraps a legacy array in the v2 envelope", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    expect(result.registry.schema_version).toBe(CURRENT_REGISTRY_VERSION);
    expect(result.registry.generated_at).toBe(FIXED_DATE);
    expect(result.registry.entries).toHaveLength(1);
  });

  it("backfills rigor placeholders + disposition_note on pre-rigor entries", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.confidence).toBe("medium");
    expect(entry.causal_chain_depth).toBe(0);
    expect(entry.sources).toEqual([]);
    expect(entry.disposition_note).toBe("pre-rigor-contract");
    expect(entry.confidence_basis).toBe("backfilled-during-v2-migration");
    expect(entry.schema_revision).toBe("migrated-v1-to-v2");
    expect(result.stats.preRigorBackfilled).toBe(1);
  });

  it("does not overwrite existing rigor fields", () => {
    const original = modernMinimal({
      confidence: "high",
      causal_chain_depth: 5,
      sources: [{ url: "x" }],
    });
    const result = migrate([original], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.confidence).toBe("high");
    expect(entry.causal_chain_depth).toBe(5);
    expect(entry.sources).toEqual([{ url: "x" }]);
    expect(entry.disposition_note).toBeUndefined();
    expect(result.stats.preRigorBackfilled).toBe(0);
  });

  it("backfills execution_tier=3 when absent", () => {
    const f = legacyMinimal();
    delete (f as { execution_tier?: unknown }).execution_tier;
    const result = migrate([f], { generatedAt: FIXED_DATE });
    expect(result.registry.entries[0].execution_tier).toBe(3);
    expect(result.stats.tierBackfilled).toBe(1);
  });

  it("backfills central_path=false and false_positive=false when absent", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.central_path).toBe(false);
    expect(entry.false_positive).toBe(false);
    expect(result.stats.centralPathBackfilled).toBe(1);
    expect(result.stats.falsePositiveBackfilled).toBe(1);
  });

  it("does not mutate the input array or its elements", () => {
    const inputEntry = legacyMinimal();
    const inputArr = [inputEntry];
    const snapshot = JSON.parse(JSON.stringify(inputArr));
    migrate(inputArr, { generatedAt: FIXED_DATE });
    expect(JSON.parse(JSON.stringify(inputArr))).toEqual(snapshot);
  });

  it("produces a v2 envelope that passes legacy-tolerant validation end-to-end", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const reparsed = parseRegistry(result.registry);
    const drifts = validateRegistry(reparsed);
    expect(drifts).toEqual([]);
  });
});
