import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D9-21 (Medium, D9 Platform-Adapters watchlist completeness) gate.
 *
 * The D9.5 "Active watchlist (per-cycle update)" table in
 * `governance/audit/domains/D09-platform-adapters.md` tracks retired adapter
 * candidates against the T1-T5 re-introduction triggers. Before D9-21 it held
 * only blocked/keep-retired candidates (xAI Grok — no platform surface; Devin
 * Desktop — T2 fails) while OpenCode (`sst/opencode`, ≥146k stars and a
 * documented `.opencode/` config + agents/commands surface) — the
 * highest-traction retired candidate, which actually PASSES T1+T2 — was
 * ungraded. An ungraded highest-traction candidate is exactly the gap the
 * watchlist exists to close: a maintainer reading the table to decide where the
 * next CL-2 adapter-currency budget goes saw only dead-ends, so the live
 * Tier-2 option never surfaced.
 *
 * The D9-21 fix added an OpenCode row with an explicit grade (T1 PASS, T2 PASS,
 * T3 partial → Tier 2 "track" pending ≥3 user requests + a T4 cost-vs-ΔP3
 * estimate) and the rejected re-introduction rationale (re-introduction needs a
 * CONSTITUTION §6 Decision 12 amendment, not an audit-cycle add). This test
 * value-asserts that invariant against the canonical file the maintainer edits:
 * the watchlist must grade OpenCode, the grade must be the Tier-2-track verdict
 * the finding fixed on, and the rejected-re-introduction rationale must name the
 * Decision 12 amendment bar. It fails the moment the OpenCode row is dropped
 * (re-opening D9-21) or its disposition silently downgrades to a no-grade
 * placeholder.
 *
 * Reads the repo-root canonical file directly (not the bundled `dist/content`
 * copy) so the assertion tracks the source of truth regardless of build state,
 * mirroring `src/__tests__/governance/security-agent-verification-coverage.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const D09 = resolve(ROOT, "governance", "audit", "domains", "D09-platform-adapters.md");

/** Body of the "#### Active watchlist (per-cycle update)" section (table + heading). */
function watchlistSection(body: string): string {
  const marker = "#### Active watchlist";
  const start = body.indexOf(marker);
  expect(start, "D09-platform-adapters.md is missing its '#### Active watchlist' section").toBeGreaterThan(-1);
  const rest = body.slice(start);
  // Next ATX heading of any level ends the section.
  const next = rest.indexOf("\n## ", marker.length);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Pipe-table data rows: lines starting with `|`, minus the header + separator. */
function tableRows(section: string): string[] {
  return section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .filter((l) => !/^\|\s*Candidate\s*\|/.test(l.trim())) // header
    .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())); // separator (---|---|---)
}

// Privatization gate: governance/audit/domains/* is private overlay IP, gitignored
// and absent in public CI / contributor clones. Skip the whole suite when the
// domain source is absent (mirrors validate-governance-total.test.ts's
// "skips clean when the CONSTITUTION is absent (private-corpus public CI)"
// contract); the gate stays fully effective wherever the file is present.
const D09_PRESENT = existsSync(D09);

describe.skipIf(!D09_PRESENT)("D9.5 watchlist grades the highest-traction candidate (Cycle 11 D9-21)", () => {
  const body = D09_PRESENT ? readFileSync(D09, "utf-8") : "";
  // When the private source is absent every `it` below is skipped, but the
  // describe callback still evaluates at collection time — short-circuit the
  // section/row derivation (whose helper asserts the marker exists) so no
  // collection-time `expect` fires on an empty body.
  const section = D09_PRESENT ? watchlistSection(body) : "";
  const rows = D09_PRESENT ? tableRows(section) : [];
  // Match on the Candidate column (first cell) only — the Devin Desktop row also
  // mentions "OpenCode" in prose (ACP launch-support list), so a whole-row
  // substring match would grab the wrong row.
  const candidateCell = (row: string): string => row.split("|")[1] ?? "";
  const openCodeRow = rows.find((r) => /opencode/i.test(candidateCell(r)));

  it("the watchlist carries an OpenCode row", () => {
    expect(
      openCodeRow,
      "the D9.5 Active watchlist has no OpenCode row — the highest-traction retired candidate (sst/opencode) is ungraded, re-opening D9-21",
    ).toBeDefined();
  });

  it("the OpenCode row grades T1 and T2 as PASS (the basis for a Tier-2 track verdict)", () => {
    expect(openCodeRow).toMatch(/T1\s*PASS/i);
    expect(openCodeRow).toMatch(/T2\s*PASS/i);
  });

  it("the OpenCode disposition is Tier 2 'track', not a blocked/keep-retired/no-grade placeholder", () => {
    // The finding's fix lands OpenCode at Tier 2 (T1+T2 pass, T4/T5 unclear) —
    // distinct from the Grok (blocked) and Devin (Tier 3 keep-retired) rows.
    expect(openCodeRow, "OpenCode row exists but is not graded Tier 2 track").toMatch(/Tier 2 track/i);
    expect(
      /T3 partial/i.test(openCodeRow ?? ""),
      "OpenCode row omits the T3-partial grade that keeps it OUT of Tier 1 (no capability the 3 retained adapters lack)",
    ).toBe(true);
  });

  it("the OpenCode row records the rejected re-introduction rationale (Decision 12 amendment bar)", () => {
    // Re-introduction is a high-bar exception per CONSTITUTION §6 Decision 12;
    // the row must say a re-introduction needs the amendment, not an audit add.
    expect(openCodeRow).toMatch(/Decision 12/);
    expect(
      /re-introduction requires.*amendment/i.test(openCodeRow ?? ""),
      "OpenCode row does not state that re-introduction requires a CONSTITUTION §6 Decision 12 amendment",
    ).toBe(true);
  });

  it("the row names a concrete T4/T5 revisit trigger (≥3 user requests + a cost-vs-ΔP3 estimate)", () => {
    // Without a concrete trigger the Tier-2 row is a dead entry. The fix ties
    // the Tier 2→1 promotion to ≥3 user requests and a T4 cost estimate.
    expect(openCodeRow).toMatch(/≥3 user requests/);
    expect(openCodeRow).toMatch(/cost-vs-ΔP3/);
  });
});
