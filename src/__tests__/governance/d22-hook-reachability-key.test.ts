import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cycle 11 D22-11 (Medium, hooks reference-key measurement) reachability-key
 * gate.
 *
 * `governance/audit/domains/D22-content-architecture.md` SA 22.1 item (b)
 * prescribes a CLASS-AWARE reachability test for removal candidates and
 * enumerates the lookup key per artifact class: agents → `agentPipeline:`
 * id-occurrences; skills/commands → entry-point membership; rules → `scope:`/
 * glob. Before D22-11 the enumeration OMITTED hooks, so a sub-agent scanning a
 * hook removal candidate had no class key and fell back to the `hatch3r-
 * <filename>` stem. Hooks are addressed by their `event:` value and `id:` field,
 * not the stem: `hooks/hatch3r-post-merge.md` declares `id: post-merge-ci-watcher`
 * / `event: post-merge`, and the 8-value event enum is consumed at
 * `src/adapters/cursor.ts:74`, `src/adapters/claude.ts:309`/`:329`, and
 * `src/cli/commands/userContent.ts:714`. Empirically a stem grep for
 * `hatch3r-post-merge` returns 0 source consumers while an `event:`-keyed grep
 * for `post-merge` returns 8, so a stem-keyed reachability scan mis-flags a live
 * hook as orphaned.
 *
 * The D22-11 fix adds the hook key to SA 22.1's class-aware enumeration AND to
 * the line-44 grep-substitution sentence: "for hooks, scan by the `event:` value
 * AND the `id:` field, not the `hatch3r-<filename>` stem". This test
 * value-asserts that invariant against the canonical domain file the maintainer
 * edits. It fails the moment the hook key-selection rule is dropped or the
 * enumeration regresses to omitting hooks (re-introducing the stem-keyed
 * undercount), regardless of how the surrounding prose is reworded.
 *
 * Reads the repo-root canonical file directly (not a built copy) so the
 * assertion tracks the source of truth regardless of build state, mirroring
 * `src/__tests__/governance/audit-execute-skill-npm-separator.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const D22_DOMAIN = resolve(
  ROOT,
  "governance",
  "audit",
  "domains",
  "D22-content-architecture.md",
);

const body = readFileSync(D22_DOMAIN, "utf-8");

/** Whitespace-normalized lowercase view for substring-invariant matching. */
const flat = body.replace(/\s+/g, " ").toLowerCase();

describe("D22 hook reachability key-selection rule (Cycle 11 D22-11)", () => {
  it("SA 22.1 still prescribes a class-aware reachability test (premise guard)", () => {
    // If SA 22.1 ever stops gating removal on class-aware reachability this rule
    // has no anchor — fail loudly so the premise is re-checked rather than
    // passing vacuously when the surrounding contract is gone.
    expect(
      flat.includes("class-aware reachability"),
      "D22 SA 22.1 no longer prescribes a class-aware reachability test — re-check this gate's premise",
    ).toBe(true);
  });

  it("enumerates a hook reachability key (not a stem-keyed scan)", () => {
    // The fix requires the hook class to appear in the per-class key
    // enumeration. Assert the `hooks → event:/id:` key is present.
    expect(
      flat.includes("hooks →") || flat.includes("hooks -"),
      "D22 SA 22.1 reachability enumeration omits the hook class — a stem-keyed scan mis-flags live hooks (D22-11)",
    ).toBe(true);
  });

  it("instructs scanning hooks by `event:` AND `id:`, never the file stem", () => {
    // Both keys must be named: `event:` is the primary reference (consumed by
    // adapters); `id:` is the secondary. The stem must be explicitly excluded.
    expect(flat.includes("`event:`"), "hook reachability key must name `event:`").toBe(
      true,
    );
    expect(flat.includes("`id:`"), "hook reachability key must name `id:`").toBe(true);
    expect(
      /not the `hatch3r-<filename>` stem|never the `hatch3r-<filename>` stem/i.test(body),
      "hook reachability rule must explicitly exclude the `hatch3r-<filename>` stem",
    ).toBe(true);
  });

  it("ties the hook key into the line-44 grep-substitution sentence", () => {
    // SA 22.1's grep-substitution sentence defers zero-inbound counting to
    // agents and substitutes a reachability test for the other classes; hooks
    // must be in that substitution list so a grep run never falls back to the
    // stem for a hook candidate.
    expect(
      /hooks →\s*`event:`\/`id:` keyed scan/.test(body),
      "the grep-substitution sentence must route hooks through the `event:`/`id:` keyed scan",
    ).toBe(true);
  });
});
