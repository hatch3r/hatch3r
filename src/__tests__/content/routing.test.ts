import { describe, it, expect } from "vitest";
import {
  filterCandidatesByTags,
  narrowByProjectDetection,
  buildCandidateSet,
} from "../../content/routing.js";
import type {
  RoutableItem,
  TaskDescription,
  ProjectDetection,
  CandidateSet,
} from "../../content/routing.js";
import {
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
  TAG_ORCHESTRATION,
  TAG_BOARD,
  TAG_PERFORMANCE,
  TAG_AI,
  TAG_FLOOR_SECURITY,
  TAG_FLOOR_UI_UX,
  TAG_FLOOR_PROTOCOL,
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  TAG_LANG_TYPESCRIPT,
  TAG_LANG_PYTHON,
  TAG_LANG_GO,
} from "../../content/tags.js";

// ── Helpers ──────────────────────────────────────────────────────

function item(
  id: string,
  tags: string[],
  extras: Partial<RoutableItem> = {},
): RoutableItem {
  return { id, tags, ...extras };
}

function ids(items: readonly RoutableItem[]): string[] {
  return items.map((i) => i.id);
}

/**
 * Look up the single structured rationale entry for an item id. Structural
 * assertions on `{decision, reason}` decouple tests from the free-text
 * `rationale` format string (F3.3-L1) — a format tweak no longer fans out
 * failures across the rationale-reason tests.
 */
function findStructured(
  result: CandidateSet,
  id: string,
): CandidateSet["rationaleStructured"][number] | undefined {
  return result.rationaleStructured.find((e) => e.id === id);
}

const emptyProject: ProjectDetection = {
  techStack: [],
  lifecycleStage: "unknown",
  maturityTier: "unknown",
};

// ── filterCandidatesByTags ───────────────────────────────────────

describe("filterCandidatesByTags", () => {
  it("returns full-tag matches when task tags intersect item capability tags", () => {
    const items: RoutableItem[] = [
      item("a", [TAG_REVIEW]),
      item("b", [TAG_PLANNING]),
      item("c", [TAG_REVIEW, TAG_IMPLEMENTATION]),
    ];
    const result = filterCandidatesByTags(items, [TAG_REVIEW]);
    expect(ids(result)).toEqual(["a", "c"]);
  });

  it("admits items with multiple capability tags when any tag intersects", () => {
    const items: RoutableItem[] = [
      item("multi", [TAG_REVIEW, TAG_PLANNING, TAG_IMPLEMENTATION]),
    ];
    expect(ids(filterCandidatesByTags(items, [TAG_PLANNING]))).toEqual(["multi"]);
    expect(ids(filterCandidatesByTags(items, [TAG_IMPLEMENTATION]))).toEqual(["multi"]);
    expect(ids(filterCandidatesByTags(items, [TAG_BOARD]))).toEqual([]);
  });

  it("admits floor items even when their capability tags do not match", () => {
    const items: RoutableItem[] = [
      item("a11y-only", [TAG_FLOOR_UI_UX]),
      item("sec-with-cap", [TAG_FLOOR_SECURITY, TAG_REVIEW]),
      item("proto", [TAG_FLOOR_PROTOCOL]),
      item("cap-only", [TAG_PLANNING]),
    ];
    // Task wants ai capability — nothing has it, but every floor item
    // should still pass.
    const result = filterCandidatesByTags(items, [TAG_AI]);
    expect(ids(result).sort()).toEqual(["a11y-only", "proto", "sec-with-cap"]);
  });

  it("admits only floor + protected items when taskTags is empty", () => {
    const items: RoutableItem[] = [
      item("planning", [TAG_PLANNING]),
      item("floor-ui", [TAG_FLOOR_UI_UX]),
      item("protected-zero", [], { protected: true }),
      item("orchestration", [TAG_ORCHESTRATION]),
    ];
    const result = filterCandidatesByTags(items, []);
    expect(ids(result).sort()).toEqual(["floor-ui", "protected-zero"]);
  });

  it("drops items with zero capability tags AND no floor tag AND not protected (reversed empty-tag rule)", () => {
    const items: RoutableItem[] = [
      item("untagged", []),
      item("ui-spec-only", ["a11y"]), // ui-ux-specialisation is not capability
    ];
    const result = filterCandidatesByTags(items, [TAG_REVIEW, TAG_PLANNING]);
    expect(result).toEqual([]);
  });

  it("admits protected items regardless of capability match", () => {
    const items: RoutableItem[] = [
      item("prot-no-tags", [], { protected: true }),
      item("prot-with-other-cap", [TAG_PLANNING], { protected: true }),
      item("unprotected-mismatch", [TAG_PLANNING]),
    ];
    const result = filterCandidatesByTags(items, [TAG_AI]);
    expect(ids(result).sort()).toEqual(["prot-no-tags", "prot-with-other-cap"]);
  });

  it("ignores non-capability tags in the taskTags array (no false admission)", () => {
    const items: RoutableItem[] = [
      // Item's only tag is a language tag — not a capability tag.
      item("lang-only", [TAG_LANG_TYPESCRIPT]),
    ];
    // Task tags are also language tags — even though the strings would
    // intersect, neither is a capability tag, so no match.
    const result = filterCandidatesByTags(items, [TAG_LANG_TYPESCRIPT]);
    expect(result).toEqual([]);
  });

  it("returns an empty array when given empty items", () => {
    expect(filterCandidatesByTags([], [TAG_REVIEW])).toEqual([]);
    expect(filterCandidatesByTags([], [])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const items: RoutableItem[] = [
      item("a", [TAG_REVIEW]),
      item("b", [TAG_PLANNING]),
    ];
    const snapshot = [...items];
    filterCandidatesByTags(items, [TAG_REVIEW]);
    expect(items).toEqual(snapshot);
  });

  it("admits items matching any of multiple task tags", () => {
    const items: RoutableItem[] = [
      item("plan", [TAG_PLANNING]),
      item("dev", [TAG_DEVOPS]),
      item("maint", [TAG_MAINTENANCE]),
      item("ai", [TAG_AI]),
    ];
    const result = filterCandidatesByTags(items, [TAG_PLANNING, TAG_DEVOPS]);
    expect(ids(result).sort()).toEqual(["dev", "plan"]);
  });
});

// ── narrowByProjectDetection ─────────────────────────────────────

describe("narrowByProjectDetection", () => {
  it("drops items whose lang:* tag does not match the project techStack", () => {
    const items: RoutableItem[] = [
      item("ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
      item("py", [TAG_REVIEW, TAG_LANG_PYTHON]),
      item("agnostic", [TAG_REVIEW]),
    ];
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = narrowByProjectDetection(items, project);
    expect(ids(result).sort()).toEqual(["agnostic", "py"]);
  });

  it("javascript techStack matches lang:typescript tagged items", () => {
    const items: RoutableItem[] = [
      item("ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
    ];
    const project: ProjectDetection = {
      techStack: ["javascript"],
      lifecycleStage: "brownfield",
      maturityTier: "solo",
    };
    expect(ids(narrowByProjectDetection(items, project))).toEqual(["ts"]);
  });

  it("multi-language techStack admits items matching any listed language", () => {
    const items: RoutableItem[] = [
      item("ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
      item("py", [TAG_REVIEW, TAG_LANG_PYTHON]),
      item("go", [TAG_REVIEW, TAG_LANG_GO]),
    ];
    const project: ProjectDetection = {
      techStack: ["typescript", "go"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = narrowByProjectDetection(items, project);
    expect(ids(result).sort()).toEqual(["go", "ts"]);
  });

  it("does not drop floor items even when their language tag does not match", () => {
    const items: RoutableItem[] = [
      item("ts-floor", [TAG_FLOOR_SECURITY, TAG_LANG_TYPESCRIPT]),
    ];
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    expect(ids(narrowByProjectDetection(items, project))).toEqual(["ts-floor"]);
  });

  it("does not drop protected items even when their language tag does not match", () => {
    const items: RoutableItem[] = [
      item("ts-protected", [TAG_LANG_TYPESCRIPT], { protected: true }),
    ];
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    expect(ids(narrowByProjectDetection(items, project))).toEqual(["ts-protected"]);
  });

  it("drops ctx:greenfield-only items on brownfield projects", () => {
    const items: RoutableItem[] = [
      item("gf-only", [TAG_REVIEW, TAG_CTX_GREENFIELD_ONLY]),
      item("bf-only", [TAG_REVIEW, TAG_CTX_BROWNFIELD_ONLY]),
      item("either", [TAG_REVIEW]),
    ];
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = narrowByProjectDetection(items, project);
    expect(ids(result).sort()).toEqual(["bf-only", "either"]);
  });

  it("drops ctx:brownfield-only items on greenfield projects", () => {
    const items: RoutableItem[] = [
      item("gf-only", [TAG_REVIEW, TAG_CTX_GREENFIELD_ONLY]),
      item("bf-only", [TAG_REVIEW, TAG_CTX_BROWNFIELD_ONLY]),
    ];
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "greenfield",
      maturityTier: "solo",
    };
    expect(ids(narrowByProjectDetection(items, project))).toEqual(["gf-only"]);
  });

  it("does not apply lifecycle filter when stage is unknown / arbitrary", () => {
    const items: RoutableItem[] = [
      item("gf-only", [TAG_REVIEW, TAG_CTX_GREENFIELD_ONLY]),
      item("bf-only", [TAG_REVIEW, TAG_CTX_BROWNFIELD_ONLY]),
    ];
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "unknown",
      maturityTier: "team",
    };
    const result = narrowByProjectDetection(items, project);
    expect(ids(result).sort()).toEqual(["bf-only", "gf-only"]);
  });

  it("is a no-op on the language filter when techStack is empty", () => {
    const items: RoutableItem[] = [
      item("ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
      item("py", [TAG_REVIEW, TAG_LANG_PYTHON]),
    ];
    const result = narrowByProjectDetection(items, emptyProject);
    // No language filter and no lifecycle match — everything passes.
    expect(ids(result).sort()).toEqual(["py", "ts"]);
  });

  it("admits language-agnostic items even when techStack is set", () => {
    const items: RoutableItem[] = [
      item("no-lang", [TAG_REVIEW]),
    ];
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    expect(ids(narrowByProjectDetection(items, project))).toEqual(["no-lang"]);
  });

  it("does not mutate the input array", () => {
    const items: RoutableItem[] = [
      item("ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
      item("py", [TAG_REVIEW, TAG_LANG_PYTHON]),
    ];
    const snapshot = [...items];
    narrowByProjectDetection(items, {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    });
    expect(items).toEqual(snapshot);
  });

  it("does not filter on maturityTier (field is reserved for downstream consumers)", () => {
    const items: RoutableItem[] = [
      item("a", [TAG_REVIEW]),
      item("b", [TAG_PLANNING]),
    ];
    // Two different maturity tiers should produce the same routing output
    // because the router does not filter on this field.
    const soloOutput = narrowByProjectDetection(items, {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "solo",
    });
    const enterpriseOutput = narrowByProjectDetection(items, {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "enterprise",
    });
    expect(ids(soloOutput)).toEqual(ids(enterpriseOutput));
  });

  it("returns an empty array when given empty candidates", () => {
    expect(narrowByProjectDetection([], emptyProject)).toEqual([]);
  });
});

// ── buildCandidateSet ────────────────────────────────────────────

describe("buildCandidateSet", () => {
  const items: RoutableItem[] = [
    item("review-ts", [TAG_REVIEW, TAG_LANG_TYPESCRIPT]),
    item("review-py", [TAG_REVIEW, TAG_LANG_PYTHON]),
    item("planning", [TAG_PLANNING]),
    item("security-floor", [TAG_FLOOR_SECURITY]),
    item("untagged", []),
    item("ai-feature", [TAG_AI, TAG_REVIEW]),
    item("team-only-review", [TAG_REVIEW, TAG_CTX_TEAM_ONLY]),
    item("gf-only-review", [TAG_REVIEW, TAG_CTX_GREENFIELD_ONLY]),
  ];

  it("composes capability filtering and project narrowing", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    // Expected:
    //   review-py: review capability + python lang match ✓
    //   security-floor: floor bypass ✓
    //   ai-feature: review capability (no lang tag) ✓
    //   team-only-review: review capability (no lang tag, lifecycle ok) ✓
    //   review-ts: dropped — lang:typescript not in techStack
    //   gf-only-review: dropped — ctx:greenfield-only on brownfield
    //   planning: dropped — no review capability, no floor
    //   untagged: dropped — empty-tag rule
    expect(ids(result.candidates).sort()).toEqual([
      "ai-feature",
      "review-py",
      "security-floor",
      "team-only-review",
    ]);
  });

  it("admits all floor items even when task tags do not match and project narrows", () => {
    const task: TaskDescription = { tags: [] };
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "solo",
    };
    const result = buildCandidateSet(items, task, project);
    // Only floor (and protected, but no protected items in fixture).
    expect(ids(result.candidates)).toEqual(["security-floor"]);
  });

  it("rationale array is non-empty and includes header + final-count entries", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: ["typescript"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    expect(result.rationale.length).toBeGreaterThan(0);
    // First line is the input header.
    expect(result.rationale[0]).toMatch(/^routing: input items=\d+/);
    expect(result.rationale[0]).toContain("taskTags=[review]");
    expect(result.rationale[0]).toContain("techStack=[typescript]");
    expect(result.rationale[0]).toContain("lifecycle=brownfield");
    expect(result.rationale[0]).toContain("maturityTier=team");
    // Final line states the candidate count.
    const last = result.rationale[result.rationale.length - 1];
    expect(last).toMatch(/^routing: final candidates=\d+/);
  });

  it("rationale records floor admission with a distinct reason", () => {
    const task: TaskDescription = { tags: [TAG_AI] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    // Human-readable line still emitted; reason-correctness asserted structurally.
    expect(
      result.rationale.some((r) => r.startsWith("admit security-floor")),
    ).toBe(true);
    expect(findStructured(result, "security-floor")).toEqual({
      id: "security-floor",
      decision: "admit",
      reason: "floor",
    });
  });

  it("rationale records capability-match admission structurally", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    expect(
      result.rationale.some((r) => r.startsWith("admit ai-feature")),
    ).toBe(true);
    expect(findStructured(result, "ai-feature")).toEqual({
      id: "ai-feature",
      decision: "admit",
      reason: "capability-match",
    });
  });

  it("rationale records empty-tag drop with a no-capability-match reason", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    expect(result.rationale.some((r) => r.startsWith("drop untagged"))).toBe(
      true,
    );
    expect(findStructured(result, "untagged")).toEqual({
      id: "untagged",
      decision: "drop",
      reason: "no-capability-match",
    });
  });

  it("rationale records lang-mismatch drop separately from capability drop", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    expect(result.rationale.some((r) => r.startsWith("drop review-ts"))).toBe(
      true,
    );
    expect(findStructured(result, "review-ts")).toEqual({
      id: "review-ts",
      decision: "drop",
      reason: "lang-mismatch",
    });
  });

  it("rationale records lifecycle-stage drop with a context-tag reason", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    expect(
      result.rationale.some((r) => r.startsWith("drop gf-only-review")),
    ).toBe(true);
    expect(findStructured(result, "gf-only-review")).toEqual({
      id: "gf-only-review",
      decision: "drop",
      reason: "ctx-greenfield-only",
    });
  });

  it("rationale records lifecycle-stage drop on greenfield projects too", () => {
    const fixture: RoutableItem[] = [
      item("bf-only", [TAG_REVIEW, TAG_CTX_BROWNFIELD_ONLY]),
    ];
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "greenfield",
      maturityTier: "solo",
    };
    const result = buildCandidateSet(fixture, task, project);
    expect(result.rationale.some((r) => r.startsWith("drop bf-only"))).toBe(
      true,
    );
    expect(findStructured(result, "bf-only")).toEqual({
      id: "bf-only",
      decision: "drop",
      reason: "ctx-brownfield-only",
    });
  });

  it("rationale records protected-bypass admission distinctly from capability admission", () => {
    const fixture: RoutableItem[] = [
      item("prot", [], { protected: true }),
    ];
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const result = buildCandidateSet(fixture, task, emptyProject);
    expect(result.rationale.some((r) => r.startsWith("admit prot"))).toBe(true);
    expect(findStructured(result, "prot")).toEqual({
      id: "prot",
      decision: "admit",
      reason: "protected",
    });
  });

  it("returns an empty candidate set with rationale header on empty items", () => {
    const result: CandidateSet = buildCandidateSet(
      [],
      { tags: [TAG_REVIEW] },
      emptyProject,
    );
    expect(result.candidates).toEqual([]);
    expect(result.rationale.length).toBe(2); // header + final-count
    expect(result.rationale[0]).toMatch(/items=0/);
    expect(result.rationale[1]).toMatch(/final candidates=0/);
  });

  it("rationaleStructured records every per-item decision with a stable id+decision+reason (no header/footer noise)", () => {
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: ["python"],
      lifecycleStage: "brownfield",
      maturityTier: "team",
    };
    const result = buildCandidateSet(items, task, project);
    // One structured entry per fixture item (8) — header/footer log lines
    // are excluded from the structured array.
    expect(result.rationaleStructured.length).toBe(items.length);
    // The structured admit set matches the candidate set exactly.
    const admitted = result.rationaleStructured
      .filter((e) => e.decision === "admit")
      .map((e) => e.id)
      .sort();
    expect(admitted).toEqual(ids(result.candidates).sort());
    // Each decision is asserted structurally — no coupling to the free-text
    // rationale format string (the point of F3.3-L1).
    const byId = new Map(result.rationaleStructured.map((e) => [e.id, e]));
    expect(byId.get("security-floor")).toEqual({ id: "security-floor", decision: "admit", reason: "floor" });
    expect(byId.get("ai-feature")).toEqual({ id: "ai-feature", decision: "admit", reason: "capability-match" });
    expect(byId.get("untagged")).toEqual({ id: "untagged", decision: "drop", reason: "no-capability-match" });
    expect(byId.get("review-ts")).toEqual({ id: "review-ts", decision: "drop", reason: "lang-mismatch" });
    expect(byId.get("gf-only-review")).toEqual({ id: "gf-only-review", decision: "drop", reason: "ctx-greenfield-only" });
  });

  it("rationaleStructured records protected-bypass and brownfield-only drop reasons", () => {
    const fixture: RoutableItem[] = [
      item("prot", [], { protected: true }),
      item("bf-only", [TAG_REVIEW, TAG_CTX_BROWNFIELD_ONLY]),
    ];
    const task: TaskDescription = { tags: [TAG_REVIEW] };
    const project: ProjectDetection = {
      techStack: [],
      lifecycleStage: "greenfield",
      maturityTier: "solo",
    };
    const result = buildCandidateSet(fixture, task, project);
    const byId = new Map(result.rationaleStructured.map((e) => [e.id, e]));
    expect(byId.get("prot")).toEqual({ id: "prot", decision: "admit", reason: "protected" });
    expect(byId.get("bf-only")).toEqual({ id: "bf-only", decision: "drop", reason: "ctx-brownfield-only" });
  });

  it("rationaleStructured is empty (no per-item entries) when items is empty", () => {
    const result = buildCandidateSet([], { tags: [TAG_REVIEW] }, emptyProject);
    expect(result.rationaleStructured).toEqual([]);
  });

  it("does not mutate the input items array", () => {
    const fixture: RoutableItem[] = [
      item("a", [TAG_REVIEW]),
      item("b", [TAG_PLANNING]),
    ];
    const snapshot = [...fixture];
    buildCandidateSet(fixture, { tags: [TAG_REVIEW] }, emptyProject);
    expect(fixture).toEqual(snapshot);
  });

  it("admits items matching any of multiple task tags", () => {
    const fixture: RoutableItem[] = [
      item("p", [TAG_PLANNING]),
      item("d", [TAG_DEVOPS]),
      item("o", [TAG_ORCHESTRATION]),
      item("perf", [TAG_PERFORMANCE]),
    ];
    const result = buildCandidateSet(
      fixture,
      { tags: [TAG_PLANNING, TAG_DEVOPS] },
      emptyProject,
    );
    expect(ids(result.candidates).sort()).toEqual(["d", "p"]);
  });

  it("preserves item order from the input array in the candidate output", () => {
    // Ordering is implicit via filter/.includes — verify the LLM step
    // receives a stable order matching input order.
    const fixture: RoutableItem[] = [
      item("first", [TAG_REVIEW]),
      item("second", [TAG_REVIEW]),
      item("third", [TAG_REVIEW]),
    ];
    const result = buildCandidateSet(
      fixture,
      { tags: [TAG_REVIEW] },
      emptyProject,
    );
    expect(ids(result.candidates)).toEqual(["first", "second", "third"]);
  });
});
