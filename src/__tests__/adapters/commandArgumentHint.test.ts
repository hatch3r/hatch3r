import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { resolveTestPath } from "../fixtures.js";
import type { AdapterOutput, Tool } from "../../types.js";

// D5-33 (D5, P1 CLI UX): every command that reads a positional argument must
// declare `argument-hint:` in canonical frontmatter so Claude Code's
// slash-command picker renders the expected-argument affordance. The six
// commands below are the positional-arg set named in the audit finding
// (auth-scaffold/diagnose/pr-resolve/pack-install/slo-scaffold/handoff).
//
// Two assertions cover the two halves of the fix:
//   1. The canonical frontmatter declares a non-empty `argument-hint` (the
//      affordance now exists — regression guard against a future edit dropping
//      it).
//   2. All three adapters (claude/cursor/copilot) emit the `argument-hint:`
//      line verbatim in the generated command file. Claude consumes it; Cursor
//      and Copilot do not model it, so this proves the unknown field passes
//      through gracefully (no adapter strips, rewrites, or rejects it). The
//      passthrough is structural: `processCommandsRaw` emits raw frontmatter
//      verbatim and `parseFrontmatter`'s `CanonicalMetadata` allowlist never
//      reconstructs the body, so an unmodeled key survives as inert text.
//
// The test reads the CANONICAL SOURCE tree (repo top-level `commands/`), not
// `resolveBundledContentRoot()` — the latter prefers a `dist/content/` build
// artifact that may lag the canonical source between builds. The finding is
// about the authored canonical frontmatter, and the adapters accept any
// content root as their first arg, so the canonical root exercises the
// freshly-authored files directly.

const POSITIONAL_ARG_COMMANDS = [
  "hatch3r-auth-scaffold",
  "hatch3r-diagnose",
  "hatch3r-pr-resolve",
  "hatch3r-pack-install",
  "hatch3r-slo-scaffold",
  "hatch3r-handoff",
] as const;

// repo root: src/__tests__/adapters/ -> ../../../
const CANONICAL_ROOT = resolveTestPath(import.meta.url, "../../../");

/** Extract the YAML frontmatter block (between the first two `---` fences). */
function frontmatterOf(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no frontmatter block found");
  return (parseYaml(match[1]!) ?? {}) as Record<string, unknown>;
}

describe("D5-33 command argument-hint affordance", () => {
  it("each positional-arg command declares a non-empty argument-hint in canonical frontmatter", async () => {
    for (const id of POSITIONAL_ARG_COMMANDS) {
      const raw = await readFile(join(CANONICAL_ROOT, "commands", `${id}.md`), "utf-8");
      const fm = frontmatterOf(raw);
      const hint = fm["argument-hint"];
      expect(typeof hint, `${id}: argument-hint must be a string`).toBe("string");
      expect((hint as string).trim().length, `${id}: argument-hint must be non-empty`).toBeGreaterThan(0);
    }
  });

  // The picker hint is only useful if the field reaches the tool that renders
  // it. Generate against the canonical corpus so a future adapter change that
  // strips command frontmatter is caught here.
  const adapters: Array<{
    tool: Tool;
    make: () => { generate: (root: string, m: ReturnType<typeof createManifest>) => Promise<AdapterOutput[]> };
  }> = [
    { tool: "claude", make: () => new ClaudeAdapter() },
    { tool: "cursor", make: () => new CursorAdapter() },
    { tool: "copilot", make: () => new CopilotAdapter() },
  ];

  for (const { tool, make } of adapters) {
    it(`${tool} adapter passes argument-hint through verbatim for every positional-arg command`, async () => {
      const manifest = createManifest({ tools: [tool] });
      const outputs = await make().generate(CANONICAL_ROOT, manifest);

      for (const id of POSITIONAL_ARG_COMMANDS) {
        // Match the per-command output by id-bearing path; copilot uses a
        // `.prompt.md` suffix, the others `.md`, but the id is in all of them.
        const out = outputs.find(
          (o) => o.path.includes(`/${id}.md`) || o.path.includes(`/${id}.prompt.md`),
        );
        expect(out, `${tool}: emitted no command output for ${id}`).toBeDefined();
        // The unknown-to-cursor/copilot field survives as inert frontmatter
        // text — the "ignore gracefully" guarantee from the finding.
        expect(out!.content, `${tool}/${id}: argument-hint line missing from emitted output`).toMatch(
          /\nargument-hint:\s*\S/,
        );
      }
    });
  }
});
