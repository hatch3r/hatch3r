import type { CliToolMeta, OsKey } from "./registry.js";

/**
 * Render the markdown body of a per-tool skill file (no frontmatter — the
 * caller wraps the body with its own YAML). Used by
 * `scripts/generate-cli-skills.ts` (Wave 4) to emit
 * `skills/hatch3r-cli-{id}/SKILL.md`.
 *
 * Wave 2 produces structural placeholders for Recipes / Wrong Choice /
 * Alternatives — those sections receive per-tool authored content in
 * Wave 4 alongside the skill-generation script.
 */
export function renderCliToolSkillBody(meta: CliToolMeta, currentOs: OsKey): string {
  const sections: string[] = [];

  sections.push(`# ${meta.id}`);
  sections.push("");
  sections.push(meta.description);
  sections.push("");

  if (meta.caveat === "pipe-output-corruption") {
    sections.push("## ⚠ Critical: pipe-output corruption (issue #1282)");
    sections.push("");
    sections.push("rtk's compressed output can corrupt downstream consumers when stdout is piped or redirected.");
    sections.push("Workaround: wrap piped or redirected invocations as `rtk proxy <cmd>` — `proxy` is a documented raw-passthrough subcommand that skips compression for that call.");
    sections.push("Track upstream: https://github.com/rtk-ai/rtk/issues/1282");
    sections.push("");
  }

  sections.push("## When to Use");
  sections.push("");
  sections.push(`Reach for \`${meta.probe}\` when the task is in the **${meta.category}** category and the agent would otherwise call an MCP tool or read large outputs into context.`);
  sections.push("");

  sections.push("## Token Cost");
  sections.push("");
  sections.push("CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.");
  sections.push("Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.");
  sections.push("");

  sections.push("## Recipes");
  sections.push("");
  sections.push("<placeholder — replaced in Wave 4>");
  sections.push("");

  sections.push("## Wrong Choice When");
  sections.push("");
  sections.push("<placeholder — replaced in Wave 4>");
  sections.push("");

  sections.push("## Alternatives");
  sections.push("");
  sections.push("<placeholder — replaced in Wave 4>");
  sections.push("");

  sections.push("## Detection / Install");
  sections.push("");
  sections.push("Verify with:");
  sections.push("```bash");
  sections.push(`command -v ${meta.probe}`);
  sections.push("```");
  sections.push("");
  sections.push(`Install (${currentOs}):`);
  sections.push("");
  const cmds = meta.install[currentOs] ?? [];
  if (cmds.length === 0) {
    sections.push(`See ${meta.homepage} for installation instructions.`);
  } else {
    for (const cmd of cmds) {
      sections.push("```bash");
      sections.push(`# ${cmd.manager}`);
      sections.push(cmd.command);
      sections.push("```");
      sections.push("");
    }
  }
  sections.push(`Homepage: ${meta.homepage}`);
  sections.push("");

  return sections.join("\n");
}
