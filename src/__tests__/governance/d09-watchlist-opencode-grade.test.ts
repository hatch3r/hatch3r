import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D9-21 (D9 Platform-Adapters watchlist completeness) gate, repointed
 * at the relocated JSON home (D3-SA3.4-01, Cycle 12).
 *
 * The D9.5 "Active watchlist" candidate state was relocated out of
 * `governance/audit/domains/D09-platform-adapters.md` into
 * `governance/audit/execution-insights.json` -> `current.d9_adapter_watchlist`
 * by EVOLVE run a2a16b59 (2026-07-09). The rewrite SA was write-fenced from the
 * JSON, so the target key was never seeded and this gate — which used to assert
 * the old `#### Active watchlist` heading inside D09 — failed at collection time
 * in every overlay checkout (D3-SA3.4-01). Repointing it at the JSON removes
 * that stale-heading red.
 *
 * Two seams, per the D3-SA3.4-01 pending-marker protocol:
 *   1. Pending-marker gate (always active where D09 is present): while the JSON
 *      key is unseeded, the D09 pointer MUST carry the `PENDING (D3-SA3.4-01)`
 *      marker so the write-fenced seed stays visible on a forcing surface (the
 *      test suite + the domain file), not archive-only. This gate fails if the
 *      seed is still absent AND the pending marker has been dropped.
 *   2. Grade gate (arms once the key is seeded): the OpenCode entry must carry
 *      the Tier-2-track grade the finding fixed on. It is skipped — visibly,
 *      with the finding id in the title — until the seed lands, then enforces.
 *
 * OpenCode is the highest-traction retired candidate (`sst/opencode`), the one
 * the watchlist exists to keep graded so a maintainer deciding where the next
 * CL-2 adapter-currency budget goes sees the live Tier-2 option, not only
 * dead-ends. Grade basis + seed rows: the archive record
 * `governance/audit/archive/evolve-a2a16b59/rewrites/governance__audit__domains__D09-platform-adapters.md.result.md`.
 *
 * Privatization gate: `governance/audit/**` is private overlay IP, gitignored
 * and absent in public CI / contributor clones. Every describe below skips when
 * its source is absent (mirrors validate-governance-total.test.ts's
 * private-corpus contract); the gate stays fully effective wherever the files
 * are present.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const D09 = resolve(ROOT, "governance", "audit", "domains", "D09-platform-adapters.md");
const INSIGHTS = resolve(ROOT, "governance", "audit", "execution-insights.json");

const D09_PRESENT = existsSync(D09);
const INSIGHTS_PRESENT = existsSync(INSIGHTS);

/** The relocated `current.d9_adapter_watchlist` map, or undefined when the file
 * is absent (public CI) or the key is not yet seeded (write-fenced follow-up). */
function readWatchlist(): Record<string, unknown> | undefined {
  if (!INSIGHTS_PRESENT) return undefined;
  const parsed = JSON.parse(readFileSync(INSIGHTS, "utf-8")) as {
    current?: { d9_adapter_watchlist?: Record<string, unknown> };
  };
  return parsed.current?.d9_adapter_watchlist;
}

const watchlist = readWatchlist();
const openCodeEntry = watchlist?.["opencode"] as Record<string, unknown> | undefined;
const SEEDED = openCodeEntry != null;

describe.skipIf(!D09_PRESENT)("D9.5 watchlist relocation — pending-marker protocol (D3-SA3.4-01)", () => {
  it("while the JSON watchlist is unseeded, the D09 pointer carries the PENDING (D3-SA3.4-01) marker", () => {
    if (SEEDED) return; // seed landed: the grade gate below is authoritative
    const body = readFileSync(D09, "utf-8");
    expect(
      /PENDING \(D3-SA3\.4-01\)/.test(body),
      "current.d9_adapter_watchlist is unseeded AND the D09 pointer lacks the PENDING (D3-SA3.4-01) marker — a relocation whose JSON target is write-fenced must keep the pending marker until the seed lands, never a bare relocated-fact pointer",
    ).toBe(true);
  });
});

describe.skipIf(!SEEDED)(
  "D9.5 watchlist grades OpenCode on the relocated JSON key (Cycle 11 D9-21, repointed D3-SA3.4-01)",
  () => {
    // Concatenate the entry's string fields (trigger_to_revisit / last_assessed
    // / disposition) so the grade assertions are robust to which field carries
    // which token in the seed.
    const blob = Object.values(openCodeEntry ?? {})
      .filter((v): v is string => typeof v === "string")
      .join(" \n ");

    it("grades T1 and T2 as PASS (the basis for a Tier-2 track verdict)", () => {
      expect(blob).toMatch(/T1\s*PASS/i);
      expect(blob).toMatch(/T2\s*PASS/i);
    });

    it("disposition is Tier 2 track with the T3-partial grade that keeps it out of Tier 1", () => {
      expect(blob, "OpenCode entry is not graded Tier 2 track").toMatch(/Tier 2 track/i);
      expect(
        /T3 partial/i.test(blob),
        "OpenCode entry omits the T3-partial grade (no capability the 3 retained adapters lack)",
      ).toBe(true);
    });

    it("records the rejected re-introduction rationale (Decision 21 amendment bar)", () => {
      // Re-anchored to Decision 21 (the W2 decision-map renumber of the legacy
      // Decision 12) per the archive seed rows.
      expect(blob).toMatch(/Decision 21/);
      expect(
        /re-introduction requires.*amendment/i.test(blob),
        "OpenCode entry does not state that re-introduction requires a CONSTITUTION §6 Decision 21 amendment",
      ).toBe(true);
    });

    it("names a concrete T4/T5 revisit trigger (>=3 user requests + a cost-vs-ΔP3 estimate)", () => {
      expect(blob).toMatch(/≥3 user requests/);
      expect(blob).toMatch(/cost-vs-ΔP3/);
    });
  },
);
