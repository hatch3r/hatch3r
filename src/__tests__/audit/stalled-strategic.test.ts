import { describe, expect, it } from "vitest";
import {
  findStalledStrategic,
  isTerminal,
  renderReport,
  strategicReason,
  toCycleNumber,
  STALL_THRESHOLD_CYCLES,
  type StalledStrategic,
} from "../../audit/stalled-strategic.js";
import type { Finding } from "../../audit/registry-schema.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "F-1",
    domain: "D16: Cross-Domain Synthesis",
    severity: "High",
    description: "strategic entry",
    disposition: "human_only",
    ...overrides,
  };
}

describe("toCycleNumber", () => {
  it("parses numeric and string cycles", () => {
    expect(toCycleNumber(11)).toBe(11);
    expect(toCycleNumber("11")).toBe(11);
    expect(toCycleNumber("7.5")).toBe(7.5);
  });

  it("returns null on absent / non-numeric", () => {
    expect(toCycleNumber(undefined)).toBeNull();
    expect(toCycleNumber(null)).toBeNull();
    expect(toCycleNumber("not-a-number")).toBeNull();
  });
});

describe("strategicReason", () => {
  it("matches cl1_status=candidate", () => {
    expect(strategicReason(finding({ cl1_status: "candidate" }))).toContain(
      "cl1_status=candidate",
    );
  });

  it("matches sdr_status proposed and deferred", () => {
    expect(strategicReason(finding({ sdr_status: "proposed" }))).toBe(
      "sdr_status=proposed",
    );
    expect(strategicReason(finding({ sdr_status: "deferred" }))).toBe(
      "sdr_status=deferred",
    );
  });

  it("matches CL-3 proposal ids (CL-3 and CL3 spellings)", () => {
    expect(strategicReason(finding({ finding_id: "CL-3-#10" }))).toContain(
      "cl-3-proposal",
    );
    expect(strategicReason(finding({ finding_id: "CL3-2" }))).toContain(
      "cl-3-proposal",
    );
  });

  it("returns empty string for a non-strategic entry", () => {
    expect(strategicReason(finding({ sdr_status: "decided" }))).toBe("");
    expect(strategicReason(finding({ finding_id: "D16-6" }))).toBe("");
  });

  it("joins multiple predicates", () => {
    const r = strategicReason(
      finding({ finding_id: "CL-3-x", cl1_status: "candidate" }),
    );
    expect(r).toContain("cl1_status=candidate");
    expect(r).toContain("cl-3-proposal");
  });
});

describe("isTerminal", () => {
  it("treats done / already_resolved / false_positive as terminal", () => {
    expect(isTerminal(finding({ execution_status: "done" }))).toBe(true);
    expect(isTerminal(finding({ execution_status: "already_resolved" }))).toBe(
      true,
    );
    expect(isTerminal(finding({ false_positive: true }))).toBe(true);
  });

  it("treats pending / never_attempted as non-terminal", () => {
    expect(isTerminal(finding({ execution_status: "pending" }))).toBe(false);
    expect(isTerminal(finding({ execution_status: "never_attempted" }))).toBe(
      false,
    );
  });
});

describe("findStalledStrategic", () => {
  it("reports a strategic finding stalled >= threshold cycles", () => {
    const entries: Finding[] = [
      finding({
        finding_id: "C9-C2",
        cycle: 9,
        sdr_status: "proposed",
        execution_status: "never_attempted",
      }),
    ];
    // Raised cycle 9, current 12 → stalled 3 >= default threshold 3.
    const rows = findStalledStrategic(entries, 12, STALL_THRESHOLD_CYCLES);
    expect(rows).toHaveLength(1);
    expect(rows[0].finding_id).toBe("C9-C2");
    expect(rows[0].cycles_stalled).toBe(3); // 12 - 9 = 3
  });

  it("excludes a strategic finding aged below threshold", () => {
    // Raised cycle 10, current 11 → stalled 1 < 3.
    const entries: Finding[] = [
      finding({ cycle: 10, sdr_status: "proposed" }),
    ];
    expect(findStalledStrategic(entries, 11, 3)).toEqual([]);
  });

  it("includes a finding exactly at the threshold", () => {
    const entries: Finding[] = [
      finding({ cycle: 8, sdr_status: "deferred" }),
    ];
    const rows = findStalledStrategic(entries, 11, 3); // 11 - 8 = 3 >= 3
    expect(rows).toHaveLength(1);
    expect(rows[0].cycles_stalled).toBe(3);
  });

  it("excludes terminal strategic findings", () => {
    const entries: Finding[] = [
      finding({ cycle: 5, sdr_status: "proposed", execution_status: "done" }),
      finding({ cycle: 5, cl1_status: "candidate", false_positive: true }),
    ];
    expect(findStalledStrategic(entries, 11, 3)).toEqual([]);
  });

  it("excludes non-strategic findings regardless of age", () => {
    const entries: Finding[] = [
      finding({ cycle: 1, sdr_status: "decided", cl1_status: "promoted" }),
    ];
    expect(findStalledStrategic(entries, 11, 3)).toEqual([]);
  });

  it("reports cycles_stalled=unknown when the entry has no numeric cycle", () => {
    const entries: Finding[] = [
      finding({ cycle: undefined, sdr_status: "proposed" }),
    ];
    const rows = findStalledStrategic(entries, 11, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].cycles_stalled).toBe("unknown");
    expect(rows[0].raised_cycle).toBe("unknown");
  });

  it("reports unknown ages when current cycle is unknown", () => {
    const entries: Finding[] = [
      finding({ cycle: 5, sdr_status: "proposed" }),
    ];
    const rows = findStalledStrategic(entries, null, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].cycles_stalled).toBe("unknown");
  });

  it("sorts oldest stall first, unknown ages last", () => {
    const entries: Finding[] = [
      finding({ finding_id: "young", cycle: 8, sdr_status: "proposed" }), // 3
      finding({ finding_id: "old", cycle: 5, sdr_status: "proposed" }), // 6
      finding({ finding_id: "unknown-age", cycle: undefined, sdr_status: "proposed" }),
    ];
    const rows = findStalledStrategic(entries, 11, 3);
    expect(rows.map((r) => r.finding_id)).toEqual(["old", "young", "unknown-age"]);
  });

  it("surfaces last_action from reviewer_notes then disposition_note", () => {
    const withReviewer = findStalledStrategic(
      [finding({ cycle: 5, sdr_status: "proposed", reviewer_notes: "RN" })],
      11,
      3,
    );
    expect(withReviewer[0].last_action).toBe("RN");
    const withDisposition = findStalledStrategic(
      [finding({ cycle: 5, sdr_status: "proposed", disposition_note: "DN" })],
      11,
      3,
    );
    expect(withDisposition[0].last_action).toBe("DN");
  });
});

describe("renderReport", () => {
  it("renders an empty-state report when nothing is stalled", () => {
    const out = renderReport([], 11, 3, "2026-06-06T00:00:00.000Z");
    expect(out).toContain("# Stalled Strategic-Decision Report");
    expect(out).toContain("No strategic finding is stalled >= 3 cycles.");
  });

  it("renders a table row per stalled finding and escapes pipes in last_action", () => {
    const rows: StalledStrategic[] = [
      {
        finding_id: "C9-C2",
        domain: "D17",
        severity: "Critical",
        reason: "sdr_status=proposed",
        cycles_stalled: 2,
        raised_cycle: 9,
        execution_status: "never_attempted",
        last_action: "blocked | human consent",
      },
    ];
    const out = renderReport(rows, 11, 3, "2026-06-06T00:00:00.000Z");
    expect(out).toContain("1 stalled strategic finding(s):");
    expect(out).toContain("| C9-C2 | Critical | 2 | 9 | sdr_status=proposed |");
    // Pipe inside last_action is escaped so the markdown table is not broken.
    expect(out).toContain("blocked \\| human consent");
  });
});
