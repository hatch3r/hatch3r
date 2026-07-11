/**
 * D6-M14 (Cycle 9 / Wave 3): Cross-adapter efficiency parity test.
 *
 * Before this test, the 3 retained platform adapters (claude, cursor, copilot)
 * drifted independently in static-frame structure — no automated gate asserted
 * that the same canonical artifact yielded semantically equivalent
 * efficiency-relevant prompt structure across all adapters.
 *
 * What this test asserts: given the same canonical content set, every adapter
 * preserves the static-first frame contract for any agent it emits — frontmatter
 * (the static frame) precedes body content (the variable inputs). The check is
 * intentionally structural, not byte-equal: adapters may serialize frontmatter
 * differently, but every adapter that emits a canonical agent must keep the
 * frontmatter as the leading static prefix so provider caches see a stable
 * frame.
 *
 * Verification path:
 *   1. Pick a sample canonical agent from the fixtures tree.
 *   2. Run each adapter against the fixture set with a stub manifest.
 *   3. For every adapter output whose path corresponds to the sample agent,
 *      assert that the canonical content's `<task>` / `<context>` / `<rules>` /
 *      `## §0 Detect Ambiguity` markers (when present) appear before any
 *      adapter-specific addenda block.
 *
 * Pillar service: P7 (Efficiency-First, static-first contract preservation
 * across adapters) + P3 (Adapter Currency, consistent treatment of canonical
 * structure across the supported set).
 *
 * D6-28 / D6-29 (Cycle 11 Wave 3) extend this suite past frontmatter ordering —
 * the gap that let D6-1 (globs dropped) ship green — with three cross-adapter
 * parity gates: (1) maturity-marker directive payload is byte-identical across
 * adapters; (2) scoped rules carry the real glob via each native scoping
 * primitive (cursor `globs:`, copilot `applyTo:`, claude `paths:`), never the
 * literal "conditional"; (3) the always-loaded (session-start) rule count is
 * equal across all three adapters (tolerance band 0).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import {
  createManifest,
  maturityDirective,
  confidenceFloorDirective,
  readConfidenceFloor,
} from "../../manifest/hatchJson.js";
import type { HatchManifest, MaturityTier, ConfidenceFloor } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("cross-adapter efficiency parity (D6-M14)", () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "hatch3r-efficiency-parity-"));
    await cp(FIXTURES_DIR, fixtureRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  /**
   * For each adapter, find any agent-output file (path ends with `.md` AND
   * contains an `agents/` segment) and confirm structural integrity of the
   * static-first prompt frame. The test does not require all adapters to emit
   * every agent — only that any agent they DO emit preserves the contract.
   */
  it("every adapter preserves frontmatter-first ordering on emitted agent outputs", async () => {
    const adapters = [
      { name: "claude", inst: new ClaudeAdapter(), tools: ["claude"] as const },
      { name: "cursor", inst: new CursorAdapter(), tools: ["cursor"] as const },
      { name: "copilot", inst: new CopilotAdapter(), tools: ["copilot"] as const },
    ];

    for (const { name, inst, tools } of adapters) {
      const manifest = createManifest({
        tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"],
        mcpServers: [],
      });
      const outputs = await inst.generate(fixtureRoot, manifest);

      // Find every output that mirrors a top-level canonical agent — adapter
      // paths like `.claude/agents/foo.md` or `.cursor/agents/foo.md`. Reference
      // subdirectories (`agents/modes/`, `agents/shared/`) are companion content
      // and exempt per the canonical content split documented in
      // `src/content/index.ts:610-626` (manifest `managedFiles` excludes them).
      // Copilot's `.github/agents/*.agent.md` outputs are github-agents (a
      // separate canonical class — type=github-agent, no required frontmatter)
      // and are exempt; their static-frame contract is the body-wrapper-only
      // form, verified separately below.
      const agentOutputs = outputs.filter(
        (o) =>
          o.path.endsWith(".md") &&
          /\/agents\//.test(o.path) &&
          !/\/agents\/(modes|shared)\//.test(o.path) &&
          !o.path.endsWith(".agent.md"),
      );

      for (const out of agentOutputs) {
        // Static-frame contract: frontmatter (`---\n…\n---`) is the leading
        // prefix. The cache-relevant invariant is that the prefix is the same
        // bytes across invocations, NOT that adapters share a specific marker
        // set. We assert positional ordering only.
        const content = out.content ?? "";
        // Output may be empty for some adapter paths; skip those.
        if (content.length === 0) continue;
        const startsWithFrontmatter = content.startsWith("---\n") || content.startsWith("---\r\n");
        expect(
          startsWithFrontmatter,
          `${name} adapter emitted ${out.path} without leading frontmatter — breaks static-first ordering (D6-M14)`,
        ).toBe(true);
      }
    }
  });

  /**
   * Parity gate: every adapter must consistently treat the managed-block
   * marker's relation to frontmatter. Two valid shapes are accepted:
   *   (a) The entire file is a managed block (marker at offset 0, no
   *       frontmatter or with frontmatter inside the block) — typical for
   *       adapter-injected skill/agent files.
   *   (b) Frontmatter is the leading static prefix and the managed block
   *       follows after frontmatter — typical for bridge/AGENTS-style
   *       outputs that mix user content with hatch3r-owned content.
   * What is NOT permitted: frontmatter followed by user-style content
   * followed by the managed block — that breaks the static-first ordering
   * by inserting variable content between cacheable prefix and adapter
   * addendum. We assert this constraint structurally across all adapters
   * so a regression in any one of them surfaces here.
   */
  it("managed-block marker placement is consistent across adapters", async () => {
    const adapters = [
      { name: "claude", inst: new ClaudeAdapter(), tools: ["claude"] as const },
      { name: "cursor", inst: new CursorAdapter(), tools: ["cursor"] as const },
      { name: "copilot", inst: new CopilotAdapter(), tools: ["copilot"] as const },
    ];

    for (const { name, inst, tools } of adapters) {
      const manifest = createManifest({
        tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"],
        mcpServers: [],
      });
      const outputs = await inst.generate(fixtureRoot, manifest);
      for (const out of outputs) {
        const content = out.content ?? "";
        if (content.length === 0) continue;
        const markerIdx = content.indexOf("HATCH3R:BEGIN");
        if (markerIdx === -1) continue;

        const startsWithFrontmatter =
          content.startsWith("---\n") || content.startsWith("---\r\n");

        if (!startsWithFrontmatter) {
          // Shape (a): file is a managed block. Marker should appear at the
          // very top (within the first few lines) — anything else means
          // adapter-specific prose precedes the marker.
          expect(
            markerIdx < 200,
            `${name} adapter placed HATCH3R:BEGIN deep in ${out.path} without leading frontmatter (offset=${markerIdx}) — variable prefix breaks static-first ordering (D6-M14)`,
          ).toBe(true);
          continue;
        }

        // Shape (b): frontmatter prefix exists. Marker must appear AFTER the
        // frontmatter close `---` so the cacheable static prefix is contiguous.
        const fmEnd = content.indexOf("\n---\n", 3);
        if (fmEnd === -1) continue;
        expect(
          markerIdx > fmEnd,
          `${name} adapter placed HATCH3R:BEGIN before frontmatter close in ${out.path} — breaks static-first ordering (D6-M14)`,
        ).toBe(true);
      }
    }
  });

  /**
   * D6-29 (Cycle 11 Wave 3): maturity-marker contract parity.
   *
   * Pre-fix each adapter inlined its own maturity directive string and they had
   * drifted — copilot said "The universal floor", "accessibility basics", and
   * "baseline tests on changed surfaces" with a backtick-wrapped rule path,
   * while claude/cursor said "Universal floor", "a11y basics", and "baseline
   * tests" with a bare path. The maturity-marker CONTRACT is the directive
   * PAYLOAD (`hatchJson.ts::maturityDirective`); each adapter keeps its native
   * wrapper (claude/copilot → visible blockquote; cursor → HTML comment in each
   * rule body — D9-SA9.1-01 moved claude off the comment form because Claude Code
   * strips block-level HTML comments from CLAUDE.md before context injection).
   * This gate asserts every adapter emits the
   * identical payload for the same canonical input + resolved tier, so a future
   * adapter-local reword re-drifts here instead of shipping green.
   *
   * Scope of the assertion: the directive payload bytes only — the comment-vs-
   * blockquote wrapper is an adapter-native rendering detail, consistent with
   * this suite's structural (not byte-equal) contract philosophy above.
   */
  it("maturity-marker directive payload is identical across adapters", async () => {
    const tiers: MaturityTier[] = ["solo", "team", "scaleup", "enterprise"];
    const adapters = [
      { name: "claude", inst: new ClaudeAdapter(), tools: ["claude"] as const },
      { name: "cursor", inst: new CursorAdapter(), tools: ["cursor"] as const },
      { name: "copilot", inst: new CopilotAdapter(), tools: ["copilot"] as const },
    ];

    for (const tier of tiers) {
      const expectedPayload = maturityDirective(tier);
      for (const { name, inst, tools } of adapters) {
        const manifest: HatchManifest = {
          ...createManifest({
            tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"],
            mcpServers: [],
          }),
          maturity: tier,
        };
        const outputs = await inst.generate(fixtureRoot, manifest);
        // The payload appears in the primary memory/instruction surface for
        // each adapter (CLAUDE.md, any .cursor/rules/*.mdc body, copilot-
        // instructions.md). Concatenate all output bodies and assert the exact
        // shared payload is present — proves the directive text is identical,
        // independent of which surface or wrapper carries it.
        const corpus = outputs.map((o) => o.content ?? "").join("\n");
        expect(
          corpus.includes(expectedPayload),
          `${name} adapter at maturity=${tier} did not emit the shared maturityDirective payload verbatim — adapter-local reword re-drifted the maturity-marker contract (D6-29)`,
        ).toBe(true);
      }
    }
  });

  /**
   * D1-17 (Cycle 11 Wave 3, D1, P1): confidence-floor marker parity.
   *
   * Pre-fix the persisted `confidenceFloor` config key was validated and stored
   * but never reached any adapter output — no generated artifact carried it, so
   * an agent reading the generated content could not know the configured floor
   * (in contrast to the maturity tier, stamped by every adapter). This gate
   * asserts all three adapters emit the identical `confidenceFloorDirective`
   * payload for the same resolved floor, so a future adapter-local reword or a
   * dropped header re-surfaces here. Scope mirrors the maturity-marker gate
   * above: payload bytes only, wrapper (HTML comment vs blockquote) is adapter-
   * native. Covers both an EXPLICIT floor and the maturity-derived default.
   */
  it("confidence-floor marker directive payload is identical across adapters", async () => {
    const adapters = [
      { name: "claude", inst: new ClaudeAdapter(), tools: ["claude"] as const },
      { name: "cursor", inst: new CursorAdapter(), tools: ["cursor"] as const },
      { name: "copilot", inst: new CopilotAdapter(), tools: ["copilot"] as const },
    ];
    // [explicit floor | undefined-with-maturity → resolved default]
    const cases: Array<{ floor?: ConfidenceFloor; maturity: MaturityTier }> = [
      { floor: "high", maturity: "solo" }, // explicit wins over the solo default
      { floor: "medium", maturity: "enterprise" }, // explicit wins over the high default
      { floor: undefined, maturity: "solo" }, // resolves to "any"
      { floor: undefined, maturity: "enterprise" }, // resolves to "high"
    ];
    for (const { floor, maturity } of cases) {
      for (const { name, inst, tools } of adapters) {
        const manifest: HatchManifest = {
          ...createManifest({
            tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"],
            mcpServers: [],
          }),
          maturity,
          ...(floor ? { confidenceFloor: floor } : {}),
        };
        const resolved = readConfidenceFloor(manifest);
        const expectedPayload = confidenceFloorDirective(resolved);
        const outputs = await inst.generate(fixtureRoot, manifest);
        const corpus = outputs.map((o) => o.content ?? "").join("\n");
        expect(
          corpus.includes(expectedPayload),
          `${name} adapter (floor=${floor ?? "<default>"}, maturity=${maturity}, resolved=${resolved}) did not emit the shared confidenceFloorDirective payload verbatim (D1-17)`,
        ).toBe(true);
      }
    }
  });

  /**
   * D6-29 (Cycle 11 Wave 3): scoped-rule parity — the test gap that let D6-1
   * (globs dropped) and D6-28 (footprint asymmetry) ship green.
   *
   * The pre-fix suite asserted only frontmatter-first ordering and had zero
   * glob/scope/applyTo/paths coverage, so the 52/65 conditional rules that
   * mis-scoped to the literal "conditional" glob never surfaced. This gate runs
   * the fixture's scoped-rule (canonical glob-scoped to TypeScript files) through
   * every adapter and asserts each emits the REAL glob via its native scoping
   * primitive — cursor via the `globs:` frontmatter array, copilot via the
   * `applyTo:` frontmatter string, claude via the `paths:` frontmatter array.
   * The literal string "conditional" (the D6-1 mis-scope value) must NOT appear
   * in any rule scoping field. (Glob literals live in the assertions below, not
   * here, to keep the JSDoc free of the comment-closing token.)
   */
  it("scoped rules carry real globs (not the literal 'conditional') across adapters", async () => {
    const cursor = new CursorAdapter();
    const copilot = new CopilotAdapter();
    const claude = new ClaudeAdapter();
    const mk = (t: "cursor" | "copilot" | "claude") =>
      createManifest({
        tools: [t] as unknown as Parameters<typeof createManifest>[0]["tools"],
        mcpServers: [],
      });

    const cursorOut = await cursor.generate(fixtureRoot, mk("cursor"));
    const cursorScoped = cursorOut.find(
      (o) => o.path.startsWith(".cursor/rules/") && o.path.includes("scoped-rule"),
    );
    expect(cursorScoped, "cursor emitted no .cursor/rules/ scoped-rule output").toBeDefined();
    // D9-13 (Cycle 11 Wave 3): cursor emits `globs:` as an unquoted comma-separated
    // string (no bracketed array), per cursor.com/docs/context/rules.
    expect(cursorScoped!.content).toContain("globs: **/*.ts");
    expect(cursorScoped!.content).not.toContain("globs: conditional");

    const copilotOut = await copilot.generate(fixtureRoot, mk("copilot"));
    const copilotScoped = copilotOut.find(
      (o) => o.path.startsWith(".github/instructions/") && o.path.includes("scoped-rule"),
    );
    expect(
      copilotScoped,
      "copilot emitted no .github/instructions/ scoped-rule output",
    ).toBeDefined();
    expect(copilotScoped!.content).toContain('applyTo: "**/*.ts"');
    expect(copilotScoped!.content).not.toContain('applyTo: "conditional"');

    const claudeOut = await claude.generate(fixtureRoot, mk("claude"));
    const claudeScoped = claudeOut.find(
      (o) => o.path.startsWith(".claude/rules/") && o.path.includes("scoped-rule"),
    );
    expect(claudeScoped, "claude emitted no .claude/rules/ scoped-rule output").toBeDefined();
    // D9-SA9.1-02 (Cycle 12): claude emits the documented block-sequence `paths:`
    // form (one `  - "<glob>"` line per pattern), not a flow array; the scope
    // keyword must never leak into the resolved glob list (X4/CD4 GLOBS-DROP).
    expect(claudeScoped!.content).toContain('paths:\n  - "**/*.ts"');
    expect(claudeScoped!.content).not.toContain('"conditional"');
  });

  /**
   * D6-28 (Cycle 11 Wave 3): cross-adapter always-loaded-rule footprint parity.
   *
   * The same CANONICAL rule corpus (the files under `rules/`) must yield the
   * same always-loaded (session-start) rule count across adapters — a §6.6
   * parity invariant. Pre-fix D6-1 dropped `globs:` so every `scope: conditional`
   * canonical rule loaded unconditionally on some adapters and not others,
   * asymmetrically inflating the always-loaded footprint (the report's ~4×
   * claude-vs-cursor gap). Fixing D6-1 collapsed it; this assertion is the
   * regression gate.
   *
   * Scope of the count: CANONICAL rules ONLY. Each adapter additionally emits
   * adapter-injected scaffolding (hook→rule shims, the per-agent tool-allowlist
   * rule, the orchestration bridge rule) whose count legitimately differs by
   * adapter design and is NOT part of the canonical-corpus parity claim — so the
   * count is restricted to outputs whose path carries a canonical rule id
   * (the fixture ships `test-rule` (always) + `scoped-rule` (scoped)). Counting
   * the scaffolding too would compare unrelated artifacts.
   *
   * Always-loaded detection per adapter, from each native shape:
   *   - claude  → canonical-rule `.md` whose body has NO leading `paths:`
   *               frontmatter (scoped rules carry `paths:`).
   *   - cursor  → canonical-rule `.mdc` whose frontmatter has `alwaysApply: true`
   *               (scoped rules carry `globs:` + `alwaysApply: false`).
   *   - copilot → canonical rule inlined under `## Hatch3r Rules` in
   *               copilot-instructions.md (scoped canonical rules become separate
   *               `.github/instructions/` files, so they are absent from the
   *               inlined set — total canonical minus scoped instruction files).
   * With all three routed through the shared `resolveRuleGlobs` helper post-D6-1
   * the canonical always-loaded count is EQUAL, so the tolerance band is 0 — the
   * tightest correct assertion. The fixture has 1 canonical always rule
   * (`test-rule`) + 1 canonical scoped rule (`scoped-rule`), so each adapter
   * must report exactly 1 canonical always-loaded rule.
   */
  it("canonical always-loaded-rule count is equal across adapters (D6-28 footprint parity)", async () => {
    // Canonical rule ids shipped by the fixture (src/__tests__/fixtures/agents/rules).
    const CANONICAL_RULE_IDS = ["test-rule", "scoped-rule"] as const;
    const isCanonicalRulePath = (p: string) =>
      CANONICAL_RULE_IDS.some((id) => p.includes(id));
    const mk = (t: "cursor" | "copilot" | "claude") =>
      createManifest({
        tools: [t] as unknown as Parameters<typeof createManifest>[0]["tools"],
        mcpServers: [],
      });

    const claudeOut = await new ClaudeAdapter().generate(fixtureRoot, mk("claude"));
    const claudeAlways = claudeOut.filter(
      (o) =>
        o.path.startsWith(".claude/rules/") &&
        o.path.endsWith(".md") &&
        isCanonicalRulePath(o.path) &&
        !/^---\r?\npaths:/.test(o.content ?? ""),
    ).length;

    const cursorOut = await new CursorAdapter().generate(fixtureRoot, mk("cursor"));
    const cursorAlways = cursorOut.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        o.path.endsWith(".mdc") &&
        isCanonicalRulePath(o.path) &&
        /\balwaysApply:\s*true\b/.test(o.content ?? ""),
    ).length;

    // Copilot inlines always-canonical-rules into copilot-instructions.md and
    // emits scoped canonical rules as separate .github/instructions/ files.
    // Canonical always-loaded = (total canonical rules) − (canonical scoped
    // instruction files). Total canonical rules in the fixture = 2.
    const copilotOut = await new CopilotAdapter().generate(fixtureRoot, mk("copilot"));
    const copilotScopedCanonical = copilotOut.filter(
      (o) =>
        o.path.startsWith(".github/instructions/") &&
        o.path.endsWith(".instructions.md") &&
        isCanonicalRulePath(o.path),
    ).length;
    const copilotAlways = CANONICAL_RULE_IDS.length - copilotScopedCanonical;

    // Fixture canonical corpus: 1 always rule (test-rule) + 1 scoped (scoped-rule).
    expect(claudeAlways).toBe(1);
    expect(cursorAlways).toBe(1);
    expect(copilotAlways).toBe(1);
    // Parity: tolerance band 0 — all three adapters agree on the canonical
    // always-loaded footprint for the identical canonical input.
    expect(cursorAlways).toBe(claudeAlways);
    expect(copilotAlways).toBe(claudeAlways);
  });
});
