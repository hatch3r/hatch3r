import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D5-4 (High, D5 Prompt-Engineering Quality) verification-coverage gate.
 *
 * `agents/hatch3r-security.md` (CQ3 specialist) declares two CRITICAL-trigger
 * sub-checks under checklist item 1 — "refresh-token rotation with reuse
 * detection" and "exact-string `redirect_uri` allowlist (no wildcards)" — and
 * the Status Discipline table escalates item-1 `fail` to CRITICAL. Its
 * Confidence Expression caps a finding at Medium unless the agent produces a
 * `proof_trace` block from a Verification command (High = "auth flow traced …
 * `proof_trace` block produced"). Before D5-4 the Verification commands table
 * had rows for PKCE and grant hygiene but NONE for these two CRITICAL sub-checks,
 * so the framework's two highest-severity OAuth checks structurally could not
 * reach High confidence — a top-severity check capped at Medium.
 *
 * The D5-4 fix adds two Verification rows (a refresh-token-rotation starter scan
 * and a redirect_uri wildcard scan), each annotated "static starter — High
 * confidence requires [a] full flow trace". This test value-asserts that
 * invariant against the canonical source the maintainer edits: every
 * CRITICAL-trigger OAuth sub-check has a Verification command row, and each such
 * starter row carries the confidence-ceiling annotation so the Medium→High
 * proof_trace path the Confidence Expression demands actually exists. It fails
 * the moment either row is removed (re-introducing the Medium cap) or loses its
 * "static starter" annotation (silently implying a static scan yields High
 * confidence, contradicting the Confidence Expression).
 *
 * Reads the repo-root canonical file directly (not the bundled `dist/content`
 * copy) so the assertion tracks the source of truth regardless of build state,
 * mirroring the repo-root resolution in
 * `src/__tests__/governance/content-validation-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SECURITY_AGENT = resolve(ROOT, "agents", "hatch3r-security.md");

/** The `## Verification commands` section body (table + surrounding prose). */
function verificationSection(body: string): string {
  const start = body.indexOf("## Verification commands");
  expect(start, "agents/hatch3r-security.md is missing its '## Verification commands' section").toBeGreaterThan(-1);
  const rest = body.slice(start);
  const next = rest.indexOf("\n## ", "## Verification commands".length);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Pipe-table data rows (lines starting with `|` that are not the header/separator). */
function tableRows(section: string): string[] {
  return section
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .filter((l) => !/^\|\s*Checklist item\s*\|/.test(l.trim())) // header
    .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())); // separator (---|---|---)
}

describe("hatch3r-security CQ3 verification-command coverage (Cycle 11 D5-4)", () => {
  const body = readFileSync(SECURITY_AGENT, "utf-8");
  const section = verificationSection(body);
  const rows = tableRows(section);

  it("the redirect_uri exact-string CRITICAL sub-check has a Verification command row", () => {
    const redirectRow = rows.find((r) => /redirect_uri/i.test(r));
    expect(
      redirectRow,
      "no Verification commands row covers the exact-string `redirect_uri` allowlist CRITICAL sub-check (checklist item 1) — without it the check caps at Medium confidence",
    ).toBeDefined();
    // the starter scan must hunt for a wildcard, the spec violation it detects
    expect(redirectRow).toMatch(/wildcard/i);
  });

  it("the refresh-token rotation + reuse-detection CRITICAL sub-check has a Verification command row", () => {
    const rotationRow = rows.find((r) => /refresh.token/i.test(r) && /(rotat|reuse)/i.test(r));
    expect(
      rotationRow,
      "no Verification commands row covers refresh-token rotation + reuse detection (checklist item 1) — without it the CRITICAL trigger caps at Medium confidence",
    ).toBeDefined();
  });

  it("each CRITICAL-trigger starter row declares its static-scan confidence ceiling", () => {
    // Both new rows are static starters: per the Confidence Expression, a static
    // scan is Medium and High requires a traced flow. Each row must say so, so
    // the agent never reports High off a bare grep.
    const criticalStarterRows = rows.filter((r) => /\(CRITICAL trigger\)/.test(r));
    expect(
      criticalStarterRows.length,
      "expected at least the two D5-4 CRITICAL-trigger starter rows (rotation + redirect_uri)",
    ).toBeGreaterThanOrEqual(2);
    for (const row of criticalStarterRows) {
      expect(
        row,
        `CRITICAL-trigger Verification row omits the static-starter confidence ceiling, implying a static scan yields High confidence (contradicts the Confidence Expression): ${row}`,
      ).toMatch(/static starter/i);
      expect(row).toMatch(/full flow trace/i);
    }
  });

  it("every checklist-item-1 CRITICAL sub-check named in Status Discipline is verification-covered", () => {
    // Guard against the structural gap D5-4 closed generically: the Status
    // Discipline table escalates item-1 `fail` to CRITICAL, and item 1 names two
    // CRITICAL sub-checks (rotation, redirect_uri). Both must be reachable from a
    // Verification row, else a top-severity check is stuck at Medium.
    expect(/Item 1 `fail`.*CRITICAL/.test(body), "Status Discipline no longer escalates item-1 fail to CRITICAL — re-check this gate's premise").toBe(true);
    const item1Rows = rows.filter((r) => /^\|\s*1\./.test(r.trim()));
    const covers = {
      pkce: item1Rows.some((r) => /pkce/i.test(r)),
      grantHygiene: item1Rows.some((r) => /grant hygiene/i.test(r)),
      rotation: item1Rows.some((r) => /refresh.token/i.test(r) && /(rotat|reuse)/i.test(r)),
      redirectUri: item1Rows.some((r) => /redirect_uri/i.test(r)),
    };
    expect(covers).toEqual({ pkce: true, grantHygiene: true, rotation: true, redirectUri: true });
  });
});
