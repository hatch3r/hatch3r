import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { CodexAdapter } from "../../adapters/codex.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { AdapterOutput, Tool } from "../../types.js";

// Skill-frontmatter quoting parity with the command helper. The Claude/Cursor/
// Copilot adapters route skills through `processSkillsWithFmCliFiltered`, which
// prepends a byte-0 `---\nname:\ndescription:\n---` stub so the `/` picker reads
// the real description (not the `HATCH3R:BEGIN` managed-block marker). A skill
// description carrying `: ` / `--` / `"` makes an UNQUOTED plain scalar invalid
// YAML, so the picker falls back to the marker — the same failure mode already
// fixed for command descriptions (`toYamlDoubleQuotedScalar`). The fix applies
// that helper to the skill `description:` too; this test pins the round-trip.

const SKILL_ID = "hatch3r-torture-desc";

// A torture description: `: ` (mapping-key hazard), `--` (flow/double-dash),
// and inner `"` (quote-escaping path). Staged in the canonical SKILL.md as a
// single-quoted YAML scalar so the canonical frontmatter itself parses, then
// re-emitted by the adapter — which must double-quote it to survive byte-0.
const TORTURE_DESC =
  'Reticulate splines: a dependency-aware --dry-run pass. Use "quoted" mode: yes.';

/** Extract the byte-0 YAML frontmatter block (first `---` … `---`). */
function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no byte-0 frontmatter block found");
  return (parseYaml(match[1]!) ?? {}) as Record<string, unknown>;
}

describe("skill description YAML quoting (picker safety, byte-0 frontmatter)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function stageTortureSkill(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-skill-quote-"));
    const skillDir = join(tempDir, "skills", SKILL_ID);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nid: ${SKILL_ID}\ntype: skill\ndescription: '${TORTURE_DESC.replace(/'/g, "''")}'\ntags: [maintenance]\n---\n# Torture\n\nbody\n`,
      "utf-8",
    );
    return tempDir;
  }

  const adapters: Array<{ tool: Tool; make: () => { generate: (root: string, m: ReturnType<typeof createManifest>) => Promise<AdapterOutput[]> } }> = [
    { tool: "claude", make: () => new ClaudeAdapter() },
    { tool: "cursor", make: () => new CursorAdapter() },
    { tool: "copilot", make: () => new CopilotAdapter() },
    { tool: "codex", make: () => new CodexAdapter() },
  ];

  for (const { tool, make } of adapters) {
    it(`${tool} emits a double-quoted skill description that round-trips through a YAML parser`, async () => {
      const root = await stageTortureSkill();
      const manifest = createManifest({ tools: [tool] });
      const outputs = await make().generate(root, manifest);

      const skillOut = outputs.find((o) => o.path.endsWith("SKILL.md"));
      expect(skillOut, `${tool}: emitted no SKILL.md output`).toBeDefined();

      // The `: `-bearing description would have produced an invalid plain
      // scalar — the fix wraps it in double quotes at byte 0.
      expect(skillOut!.content).toMatch(/\ndescription: "/);

      // The byte-0 frontmatter parses and the description survives intact,
      // including the `: `, `--`, and inner `"`.
      const fm = frontmatterOf(skillOut!.content);
      expect(fm.name).toBe(SKILL_ID);
      expect(fm.description).toBe(TORTURE_DESC);
    });
  }
});
