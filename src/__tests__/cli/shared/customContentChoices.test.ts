// D2-SA2.6-06 (Cycle 12, D2 Adapter Infrastructure, P1 Adoption Experience):
// the custom init/config picker groups items under their primary tag
// (`tags[0]`) and prints a group header per tag. Before this fix the header
// text was `CONTENT_TAG_LABELS[tag] ?? tag`, so any post-2.0.0 tag with no
// label entry rendered its RAW value — "── floor:security (5) ──",
// "── cli-tools (6) ──", "── orchestration (23) ──" — leaking kebab/facet
// syntax the picker's own authoring contract says must never lead a header
// (14 of 23 realized groups). The fix keeps explicit labels for stylized cases
// and adds `humanizeTag` as the future-proof Title-Case fallback.

import { describe, it, expect } from "vitest";
import {
  buildTagGroupedCustomContentChoices,
  humanizeTag,
} from "../../../cli/shared/customContentChoices.js";
import type { CatalogItem } from "../../../content/index.js";

/** A leaked header still carries a facet colon (`a:b`) or an un-spaced kebab
 *  (`a-b`) — a humanized header is Title Case with spaces and never does. */
const LEAK = /[a-z]:[a-z]|[a-z]-[a-z]/;

function synthItem(id: string, tags: string[]): CatalogItem {
  return {
    id,
    type: "agent",
    description: `${id} synthetic description`,
    tags,
    relativePath: `agents/${id}.md`,
    source: "canonical",
  };
}

/** Extract the group-header strings from the built choice list. Separators are
 *  the only choice entries without a `value` field; their text lives on
 *  `.separator` (this inquirer version) or `.line` (older versions). */
function headerLines(
  choices: ReturnType<typeof buildTagGroupedCustomContentChoices>,
): string[] {
  return choices.flatMap((c) => {
    if (typeof c !== "object" || c === null || "value" in c) return [];
    const text =
      (c as unknown as { separator?: string }).separator ??
      (c as unknown as { line?: string }).line;
    return typeof text === "string" ? [text] : [];
  });
}

describe("humanizeTag (D2-SA2.6-06)", () => {
  it.each([
    // Every realized-but-unlabeled primary-tag group from the finding's
    // live corpus scan, plus the acronym and prefix edge cases.
    ["orchestration", "Orchestration"],
    ["cli-tools", "CLI Tools"],
    ["floor:security", "Security Floor"],
    ["spec", "Spec"],
    ["anti-duplication", "Anti Duplication"],
    ["adapters", "Adapters"],
    ["cost", "Cost"],
    ["iteration", "Iteration"],
    ["learning", "Learning"],
    ["proof", "Proof"],
    ["right-sizing", "Right Sizing"],
    ["browser", "Browser"],
    ["reliability", "Reliability"],
    ["ai", "AI"],
    ["ui", "UI"],
    ["ux", "UX"],
    ["api", "API"],
    // `floor:` prefix → " Floor" suffix; `ctx:` prefix → stripped.
    ["floor:ui-ux", "UI UX Floor"],
    ["ctx:team-only", "Team Only"],
  ])("humanizes %s -> %s", (tag, expected) => {
    expect(humanizeTag(tag)).toBe(expected);
  });

  it("never emits a raw kebab/facet header for any realized unlabeled tag", () => {
    const realizedUnlabeled = [
      "orchestration",
      "cli-tools",
      "floor:security",
      "spec",
      "floor:ui-ux",
      "anti-duplication",
      "adapters",
      "cost",
      "iteration",
      "learning",
      "proof",
      "right-sizing",
      "browser",
      "reliability",
    ];
    for (const tag of realizedUnlabeled) {
      expect(humanizeTag(tag), `humanizeTag(${tag}) leaked raw syntax`).not.toMatch(LEAK);
    }
  });

  it("falls back to the raw tag only when humanization is empty", () => {
    expect(humanizeTag("")).toBe("");
  });
});

describe("buildTagGroupedCustomContentChoices group headers (D2-SA2.6-06)", () => {
  const items = [
    synthItem("hatch3r-impl", ["implementation"]), // pre-existing labeled group
    synthItem("hatch3r-orch", ["orchestration"]), // unlabeled bare tag
    synthItem("hatch3r-cli", ["cli-tools"]), // unlabeled acronym kebab
    synthItem("hatch3r-sec", ["floor:security"]), // unlabeled facet tag
    synthItem("hatch3r-uiux", ["floor:ui-ux"]), // map-override facet tag
    synthItem("hatch3r-rs", ["right-sizing"]), // unlabeled kebab
  ];
  const headers = headerLines(buildTagGroupedCustomContentChoices(items, () => false));

  it("renders a human label for every group, labeled or not", () => {
    expect(headers).toEqual(
      expect.arrayContaining([
        "── Implementation (1) ──",
        "── Orchestration (1) ──",
        "── CLI Tools (1) ──",
        "── Security Floor (1) ──",
        "── UI/UX Floor (1) ──",
        "── Right Sizing (1) ──",
      ]),
    );
  });

  it("prefers the explicit CONTENT_TAG_LABELS entry over the generic humanizer", () => {
    // floor:ui-ux would humanize to "UI UX Floor"; the map override wins.
    expect(headers).toContain("── UI/UX Floor (1) ──");
    expect(headers).not.toContain("── UI UX Floor (1) ──");
  });

  it("leaks no raw kebab/facet syntax in any header (the regression)", () => {
    for (const h of headers) {
      expect(h, `header leaked raw syntax: ${h}`).not.toMatch(LEAK);
    }
    // The exact pre-fix leaks must be gone.
    expect(headers).not.toContain("── cli-tools (1) ──");
    expect(headers).not.toContain("── floor:security (1) ──");
    expect(headers).not.toContain("── orchestration (1) ──");
  });
});
