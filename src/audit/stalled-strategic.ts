/**
 * src/audit/stalled-strategic.ts
 *
 * Pure core for the strategic-stall forcing function (D16-6 / F16.2-C1).
 * `scripts/audit-stalled-strategic.ts` is the thin filesystem wrapper around
 * these functions, mirroring the migrate.ts (src) / migrate-finding-registry.ts
 * (scripts) split — testable logic lives here under the src coverage scope; the
 * script handles argv, file reads, and the report write.
 *
 * Phase 0 step 6 of AUDIT-EXECUTE.md names this report ("Stalled-strategic-decision
 * report (F16.2-C1)") but until D16-6 no mechanism produced it: F16.2-C1 was
 * closed `done` while the forcing function it prescribed never existed. These
 * functions compute the stall set from registry fields so the two-speed closure
 * gap (high tactical Wave 1-2 rate vs near-zero strategic CL-2/CL-3 rate) is
 * derived, not asserted.
 *
 * Pillars: P5 (Governance Self-Quality), P2 (Scientific Quality),
 *          P7 (Speed & Token Efficiency).
 */
import type { Finding } from "./registry-schema.js";

/** Phase 0 step 6 stall window: >= 3 cycles unresolved. */
export const STALL_THRESHOLD_CYCLES = 3;

/** execution_status values that terminate a finding — a terminal item is never stalled. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "already_resolved",
]);

/**
 * `cl3_status` values that close a CL-3 (audit self-evolution) proposal — a
 * proposal at one of these is applied or rejected and is NOT stalled. Mirrors
 * the cl1_status terminal set in closed-loop-agents.md Phase 7. Any other
 * non-`none` cl3_status (`candidate`, `proposed`, `deferred`,
 * `queued_for_cycle_<N>_phase_7`) marks an open proposal — strategic and, once
 * aged past the threshold, stalled.
 */
const TERMINAL_CL3_STATUSES: ReadonlySet<string> = new Set([
  "applied",
  "rejected",
  "declined",
  "superseded",
]);

/**
 * A `blocker_reason` that names an explicit human owner (`Owner: Human ...`)
 * marks an explicit-block strategic item (D16-SA16.2-02). Matched
 * case-insensitively with tolerant whitespace after the colon.
 */
const OWNER_HUMAN_BLOCK_RE = /Owner:\s*Human/i;

/** A strategic finding the report surfaces, with its computed stall age. */
export interface StalledStrategic {
  finding_id: string;
  domain: string;
  severity: string;
  /** Which predicate(s) marked it strategic (cl1 / sdr / cl3). */
  reason: string;
  /** Numeric cycle stall age, or "unknown" when the entry has no numeric cycle. */
  cycles_stalled: number | "unknown";
  raised_cycle: number | "unknown";
  execution_status: string;
  /** Best-available "last action" signal: reviewer_notes ?? disposition_note ?? "". */
  last_action: string;
}

/** Parse a cycle token (string or numeric) into a finite number, else null. */
export function toCycleNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Identify the strategic predicate(s) an entry matches; "" when none.
 * Strategic = cl1_status=candidate OR sdr_status ∈ {proposed, deferred} OR a
 * non-terminal cl3_status OR a CL-3 proposal id (the AUDIT-EXECUTE.md Phase 0
 * step 6 predicate) OR the explicit human-block lane (D16-SA16.2-02): a
 * `human_only` disposition, or a `blocker_reason` naming an explicit human
 * owner. The cl3_status leg (D16-16) catches a regular finding that carries an
 * open audit-self-evolution disposition but whose id does not match the CL-3
 * naming pattern.
 *
 * The human-block lane closes a structural blindness (D16-SA16.2-02): items
 * routed to a human decision list exit the tactical pipeline WITHOUT any
 * cl1/sdr/cl3 lifecycle status, so the four status-based legs above never see
 * them and the detector returns 0 rows against a registry that holds a stalled
 * human-parked strategic cohort. This leg reads the two fields those items DO
 * carry — the `human_only` disposition and the `Owner: Human ...` blocker text.
 */
export function strategicReason(f: Finding): string {
  const reasons: string[] = [];
  if (typeof f.cl1_status === "string" && f.cl1_status === "candidate") {
    reasons.push("cl1_status=candidate");
  }
  if (
    typeof f.sdr_status === "string" &&
    (f.sdr_status === "proposed" || f.sdr_status === "deferred")
  ) {
    reasons.push(`sdr_status=${f.sdr_status}`);
  }
  if (
    typeof f.cl3_status === "string" &&
    f.cl3_status.length > 0 &&
    f.cl3_status !== "none" &&
    !TERMINAL_CL3_STATUSES.has(f.cl3_status)
  ) {
    reasons.push(`cl3_status=${f.cl3_status}`);
  }
  // Explicit human-block lane (D16-SA16.2-02). Either signal qualifies; the
  // canonical stalled cohort carries both, so both labels can appear.
  if (typeof f.disposition === "string" && f.disposition === "human_only") {
    reasons.push("disposition=human_only");
  }
  const blockerReason =
    typeof f.blocker_reason === "string" ? f.blocker_reason : "";
  if (OWNER_HUMAN_BLOCK_RE.test(blockerReason)) {
    reasons.push("owner-human-block");
  }
  const id = typeof f.finding_id === "string" ? f.finding_id : "";
  if (/^CL-?3/i.test(id)) {
    reasons.push("cl-3-proposal");
  }
  return reasons.join(", ");
}

/** True when the entry has reached a terminal disposition and is not stalled. */
export function isTerminal(f: Finding): boolean {
  if (f.false_positive === true) return true;
  const status = typeof f.execution_status === "string" ? f.execution_status : "";
  return TERMINAL_STATUSES.has(status);
}

/**
 * Pure core: given the registry entries, the current cycle, and the stall
 * threshold, return the stalled strategic findings sorted oldest-stall first.
 * A strategic finding with no numeric `cycle` (or when currentCycle is unknown)
 * cannot be aged; it is reported with cycles_stalled = "unknown" rather than
 * dropped, since a strategic item with no cycle anchor is itself a signal.
 */
export function findStalledStrategic(
  entries: ReadonlyArray<Finding>,
  currentCycle: number | null,
  threshold: number = STALL_THRESHOLD_CYCLES,
): StalledStrategic[] {
  const out: StalledStrategic[] = [];
  for (const f of entries) {
    const reason = strategicReason(f);
    if (reason === "") continue;
    if (isTerminal(f)) continue;

    const raised = toCycleNumber(f.cycle);
    let cyclesStalled: number | "unknown";
    if (raised === null || currentCycle === null) {
      cyclesStalled = "unknown";
    } else {
      cyclesStalled = currentCycle - raised;
      // A finding raised this cycle or aged below the threshold is not yet
      // stalled — skip it. "unknown"-aged entries fall through and ARE
      // reported.
      if (cyclesStalled < threshold) continue;
    }

    const lastAction =
      (typeof f.reviewer_notes === "string" && f.reviewer_notes) ||
      (typeof f.disposition_note === "string" && f.disposition_note) ||
      "";

    out.push({
      finding_id: typeof f.finding_id === "string" ? f.finding_id : "<no-id>",
      domain: typeof f.domain === "string" ? f.domain : "",
      severity: typeof f.severity === "string" ? f.severity : "",
      reason,
      cycles_stalled: cyclesStalled,
      raised_cycle: raised === null ? "unknown" : raised,
      execution_status:
        typeof f.execution_status === "string" ? f.execution_status : "",
      last_action: lastAction,
    });
  }

  // Oldest stall first; "unknown" ages sort last (they cannot be ordered by age).
  out.sort((a, b) => {
    const av = typeof a.cycles_stalled === "number" ? a.cycles_stalled : -1;
    const bv = typeof b.cycles_stalled === "number" ? b.cycles_stalled : -1;
    if (av !== bv) return bv - av;
    return a.finding_id.localeCompare(b.finding_id);
  });
  return out;
}

/** Render the markdown report body. */
export function renderReport(
  rows: ReadonlyArray<StalledStrategic>,
  currentCycle: number | null,
  threshold: number,
  generatedAt: string,
): string {
  const lines: string[] = [];
  lines.push("# Stalled Strategic-Decision Report");
  lines.push("");
  lines.push(`> Generated: ${generatedAt}`);
  lines.push(
    `> Current cycle: ${currentCycle ?? "unknown"} | stall threshold: >= ${threshold} cycles`,
  );
  lines.push("");
  lines.push(
    "Scope: strategic findings (`cl1_status=candidate`, `sdr_status ∈ {proposed, deferred}`, " +
      "a non-terminal `cl3_status`, CL-3 proposals, or the explicit human-block lane — " +
      "`disposition=human_only` / an `Owner: Human` blocker) that are not terminal and have sat " +
      "unresolved for at least the threshold cycles. Forcing function for AUDIT-EXECUTE.md " +
      "Phase 0 step 6 / F16.2-C1.",
  );
  lines.push("");
  if (rows.length === 0) {
    lines.push(`No strategic finding is stalled >= ${threshold} cycles.`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`${rows.length} stalled strategic finding(s):`);
  lines.push("");
  lines.push(
    "| finding_id | severity | cycles_stalled | raised_cycle | strategic_reason | status | last_action |",
  );
  lines.push(
    "|------------|----------|----------------|--------------|------------------|--------|-------------|",
  );
  for (const r of rows) {
    const lastAction = r.last_action
      ? r.last_action.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120)
      : "—";
    lines.push(
      `| ${r.finding_id} | ${r.severity} | ${r.cycles_stalled} | ${r.raised_cycle} | ${r.reason} | ${r.execution_status || "—"} | ${lastAction} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
