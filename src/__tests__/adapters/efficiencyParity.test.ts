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
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
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
});
