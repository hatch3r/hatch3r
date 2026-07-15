import { describe, expect, it } from "vitest";

import {
  ROLLOVER_SUMMARY_DISPOSITIONS,
  SEVERITY_ENUM,
  TERMINAL_DISPOSITIONS,
  checkS12Invariants,
  isOpenStatus,
} from "../validate-finding-registry.js";
import type { Finding } from "../../src/audit/registry-schema.js";

// ── Synthetic fixtures only — never the real overlay registry ─────────

function entry(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "C12-D1-M1",
    domain: "D1: Core",
    severity: "Medium",
    description: "synthetic entry",
    disposition: "targeted",
    execution_status: "done",
    cycle: 12,
    ...overrides,
  };
}

function reasonsOf(reports: ReadonlyArray<{ reason: string }>): string[] {
  return reports.map((r) => r.reason);
}

// ── Derived sets ──────────────────────────────────────────────────────

describe("S12-F2 derived sets", () => {
  it("SEVERITY_ENUM is exactly the 5 canonical severities", () => {
    expect([...SEVERITY_ENUM].sort()).toEqual(
      ["Critical", "High", "Info", "Low", "Medium"].sort(),
    );
  });

  it("TERMINAL_DISPOSITIONS excludes the three active dispositions", () => {
    for (const active of ["targeted", "rollover", "partially_promoted"]) {
      expect(TERMINAL_DISPOSITIONS.has(active)).toBe(false);
    }
    for (const terminal of [
      "excluded",
      "human_only",
      "already_resolved",
      "deferred",
      "deferred_cycle10",
      "multi_cycle_deferred",
      "external_blocker",
      "phase_5_candidate",
    ]) {
      expect(TERMINAL_DISPOSITIONS.has(terminal)).toBe(true);
    }
  });

  it("ROLLOVER_SUMMARY_DISPOSITIONS mirrors the registry-schema aggregate carve-out", () => {
    expect([...ROLLOVER_SUMMARY_DISPOSITIONS].sort()).toEqual([
      "partially_promoted",
      "rollover",
    ]);
  });

  it("isOpenStatus matches the archive.ts::isLiveEntry open definition", () => {
    expect(isOpenStatus(undefined)).toBe(true);
    expect(isOpenStatus("pending")).toBe(true);
    for (const terminal of [
      "done",
      "partial",
      "failed",
      "rolled_back",
      "never_attempted",
      "already_resolved",
      "deferred",
    ]) {
      expect(isOpenStatus(terminal)).toBe(false);
    }
  });
});

// ── Invariant (a): severity ∈ 5-enum ─────────────────────────────────

describe("checkS12Invariants — (a) severity 5-enum", () => {
  it("passes each canonical severity", () => {
    for (const sev of ["Critical", "High", "Medium", "Low", "Info"]) {
      expect(checkS12Invariants([entry({ severity: sev as Finding["severity"] })])).toEqual([]);
    }
  });

  it("flags an off-enum severity", () => {
    const reports = checkS12Invariants([
      entry({ severity: "Moderate" as Finding["severity"] }),
    ]);
    expect(reasonsOf(reports)).toEqual(["S12-F2a severity outside 5-enum"]);
  });

  it("flags a missing severity", () => {
    const e = entry();
    delete (e as { severity?: unknown }).severity;
    const reports = checkS12Invariants([e]);
    expect(reasonsOf(reports)).toEqual(["S12-F2a severity outside 5-enum"]);
  });

  it("accepts an aggregate of enum members on a rollover summary", () => {
    expect(
      checkS12Invariants([
        entry({
          severity: "Medium+Low" as Finding["severity"],
          disposition: "rollover",
          execution_status: "deferred",
        }),
      ]),
    ).toEqual([]);
    expect(
      checkS12Invariants([
        entry({
          severity: "High+Medium+Low" as Finding["severity"],
          disposition: "partially_promoted",
          execution_status: "done",
        }),
      ]),
    ).toEqual([]);
  });

  it("flags an aggregate severity on a NON-rollover disposition", () => {
    const reports = checkS12Invariants([
      entry({ severity: "Medium+Low" as Finding["severity"] }),
    ]);
    expect(reasonsOf(reports)).toEqual(["S12-F2a severity outside 5-enum"]);
  });

  it("flags an aggregate whose components are not enum members (tighter than the shape regex)", () => {
    const reports = checkS12Invariants([
      entry({
        severity: "Foo+Bar" as Finding["severity"],
        disposition: "rollover",
        execution_status: "deferred",
      }),
    ]);
    expect(reasonsOf(reports)).toEqual(["S12-F2a severity outside 5-enum"]);
  });

  it("labels an unidentified entry by index", () => {
    const e = entry({ severity: "Bogus" as Finding["severity"] });
    delete (e as { finding_id?: unknown }).finding_id;
    const reports = checkS12Invariants([e]);
    expect(reports[0].finding_id).toBe("<index 0>");
  });
});

// ── Invariant (b): open ⇒ cycle non-null ─────────────────────────────

describe("checkS12Invariants — (b) open finding must carry a cycle", () => {
  it("passes an open (pending) finding with a numeric or string cycle", () => {
    expect(
      checkS12Invariants([entry({ execution_status: "pending", cycle: 12 })]),
    ).toEqual([]);
    expect(
      checkS12Invariants([entry({ execution_status: "pending", cycle: "12" })]),
    ).toEqual([]);
  });

  it("flags an open (pending) finding with undefined, null, or empty cycle", () => {
    for (const cycle of [undefined, null, ""] as const) {
      const e = entry({ execution_status: "pending" });
      (e as Record<string, unknown>).cycle = cycle;
      if (cycle === undefined) delete (e as { cycle?: unknown }).cycle;
      const reports = checkS12Invariants([e]);
      expect(reasonsOf(reports)).toEqual(["S12-F2b open finding without cycle"]);
    }
  });

  it("flags an open finding whose execution_status is absent entirely", () => {
    const e = entry();
    delete (e as { execution_status?: unknown }).execution_status;
    delete (e as { cycle?: unknown }).cycle;
    const reports = checkS12Invariants([e]);
    expect(reasonsOf(reports)).toEqual(["S12-F2b open finding without cycle"]);
  });

  it("does NOT bind terminal findings (archived rollover stub shape passes)", () => {
    // The live corpus carries C8-rollover-medium-low-remainder: rollover +
    // deferred + no cycle. Terminal status ⇒ invariant (b) does not fire.
    const e = entry({
      severity: "Medium+Low" as Finding["severity"],
      disposition: "rollover",
      execution_status: "deferred",
    });
    delete (e as { cycle?: unknown }).cycle;
    expect(checkS12Invariants([e])).toEqual([]);
  });
});

// ── Invariant (c): terminal disposition ⇒ terminal status ────────────

describe("checkS12Invariants — (c) terminal disposition ⇒ terminal status", () => {
  it("flags a terminal disposition holding an open status", () => {
    const reports = checkS12Invariants([
      entry({ disposition: "excluded", execution_status: "pending" }),
    ]);
    expect(reasonsOf(reports)).toContain(
      "S12-F2c terminal disposition with open status",
    );
  });

  it("flags a terminal disposition with an absent status", () => {
    const e = entry({ disposition: "phase_5_candidate" });
    delete (e as { execution_status?: unknown }).execution_status;
    const reports = checkS12Invariants([e]);
    expect(reasonsOf(reports)).toContain(
      "S12-F2c terminal disposition with open status",
    );
  });

  it("passes every terminal-disposition × terminal-status combination in the live corpus", () => {
    expect(
      checkS12Invariants([
        entry({ disposition: "human_only", execution_status: "never_attempted" }),
        entry({ finding_id: "C12-D1-M2", disposition: "human_only", execution_status: "done" }),
        entry({ finding_id: "C12-D1-M3", disposition: "phase_5_candidate", execution_status: "done" }),
        entry({ finding_id: "C12-D1-M4", disposition: "excluded", execution_status: "done" }),
      ]),
    ).toEqual([]);
  });

  it("exempts the active dispositions (targeted may be open)", () => {
    expect(
      checkS12Invariants([entry({ disposition: "targeted", execution_status: "pending" })]),
    ).toEqual([]);
    const rollover = entry({
      severity: "Medium+Low" as Finding["severity"],
      disposition: "rollover",
      execution_status: "pending",
    });
    // rollover + open status: (c) exempt (active disposition); cycle present
    // so (b) does not fire either.
    expect(checkS12Invariants([rollover])).toEqual([]);
  });
});

// ── Compound: one entry can violate several invariants ────────────────

describe("checkS12Invariants — compound violations", () => {
  it("reports (b) and (c) together for the #98 shape (excluded + pending + no cycle)", () => {
    const e = entry({ disposition: "excluded", execution_status: "pending" });
    delete (e as { cycle?: unknown }).cycle;
    const reports = checkS12Invariants([e]);
    expect(reasonsOf(reports).sort()).toEqual([
      "S12-F2b open finding without cycle",
      "S12-F2c terminal disposition with open status",
    ]);
  });

  it("returns an empty report for a fully conformant mixed batch", () => {
    expect(
      checkS12Invariants([
        entry(),
        entry({ finding_id: "C12-D2-H1", severity: "High", execution_status: "partial" }),
        entry({ finding_id: "C12-D3-L1", severity: "Low", execution_status: "pending", cycle: 12 }),
      ]),
    ).toEqual([]);
  });
});
