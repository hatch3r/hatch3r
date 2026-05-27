import type { CliToolMeta, OsKey } from "./registry.js";

/**
 * Display labels for the three OS keys, used by the install-section
 * renderer to label each per-OS block. F15.7-H3 (Cycle 10 D15-SA15.7):
 * canonical labels keep generated skills readable across Linux + Windows +
 * macOS users — the prior single-OS emission silently violated the
 * "vendor-signed channel" assertion on Linux (majority of CI runners) and
 * Windows.
 */
const OS_LABELS: Record<OsKey, string> = {
  mac: "macOS",
  linux: "Linux",
  win: "Windows",
};

/** Stable enumeration order so generator output is deterministic. */
const OS_ORDER: readonly OsKey[] = ["mac", "linux", "win"] as const;

/**
 * Render the markdown body of a per-tool skill file (no frontmatter — the
 * caller wraps the body with its own YAML). Used by
 * `scripts/generate-cli-skills.ts` (Wave 4) to emit
 * `skills/hatch3r-cli-{id}/SKILL.md`.
 *
 * Wave 2 produces structural placeholders for Recipes / Wrong Choice /
 * Alternatives — those sections receive per-tool authored content in
 * Wave 4 alongside the skill-generation script.
 *
 * F15.7-H3 (Cycle 10 D15-SA15.7): the `currentOs` argument now controls
 * the "Default for this machine" highlight only — the renderer always
 * emits install blocks for all three supported OS keys so Linux + Windows
 * end-users see vendor-signed channels for their platform instead of a
 * macOS-only command.
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
  // F15.7-H3: emit install commands for all three supported OS keys so the
  // generated skill remains useful on Linux + Windows machines. The
  // generator host's OS is highlighted as "default for this machine" but
  // the other two blocks are always present.
  let anyEmitted = false;
  for (const os of OS_ORDER) {
    const cmds = meta.install[os] ?? [];
    if (cmds.length === 0) continue;
    anyEmitted = true;
    const label =
      os === currentOs
        ? `Install (${OS_LABELS[os]} — default for this machine):`
        : `Install (${OS_LABELS[os]}):`;
    sections.push(label);
    sections.push("");
    for (const cmd of cmds) {
      sections.push("```bash");
      sections.push(`# ${cmd.manager}`);
      sections.push(cmd.command);
      sections.push("```");
      sections.push("");
    }
  }
  if (!anyEmitted) {
    sections.push(`See ${meta.homepage} for installation instructions.`);
  }
  sections.push(`Homepage: ${meta.homepage}`);
  sections.push("");

  // F15.7-H7 (Cycle 10 D15-SA15.7): surface the registry securityNote /
  // minVersion floor right after the install recipe so an unsigned-channel
  // trade-off or CVE-patched-version requirement is not silently dropped from
  // the generated skill. Emitted only when at least one field is present, so
  // tools with no advisory keep the prior body verbatim.
  if (meta.securityNote || meta.minVersion) {
    sections.push("## Security");
    sections.push("");
    if (meta.minVersion) {
      sections.push(`Minimum recommended version: \`${meta.minVersion}\`. Builds below this floor carry known unpatched advisories — upgrade before relying on the tool.`);
      sections.push("");
    }
    if (meta.securityNote) {
      sections.push(meta.securityNote);
      sections.push("");
    }
  }

  return sections.join("\n");
}
