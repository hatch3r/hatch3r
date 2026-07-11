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
 * Structural scaffold sentinel emitted for a hand-authored section
 * (Recipes / Wrong Choice / Alternatives) when the caller supplies no
 * authored content for it. Kept as a stable literal so a freshly-scaffolded
 * (not-yet-authored) tool renders a deterministic placeholder.
 */
const SCAFFOLD_SECTION_PLACEHOLDER = "<placeholder — replaced in Wave 4>";

/**
 * Per-tool hand-authored section bodies. Supplied by the generator from the
 * existing on-disk skill so regeneration preserves authored prose instead of
 * reverting it to {@link SCAFFOLD_SECTION_PLACEHOLDER}. A field left
 * `undefined`/empty falls back to the scaffold sentinel.
 */
export interface AuthoredCliToolSections {
  /** Body of the `## Recipes` section (markdown, no heading). */
  recipes?: string;
  /** Body of the `## Wrong Choice When` section (markdown, no heading). */
  wrongChoice?: string;
  /** Body of the `## Alternatives` section (markdown, no heading). */
  alternatives?: string;
}

/**
 * Emit the authored body for a section, or the scaffold sentinel when the
 * caller supplied none. Trims so a whitespace-only override still falls back
 * to the placeholder rather than emitting a blank section.
 */
function sectionBody(authored: string | undefined): string {
  const trimmed = authored?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : SCAFFOLD_SECTION_PLACEHOLDER;
}

/**
 * Render the markdown body of a per-tool skill file (no frontmatter — the
 * caller wraps the body with its own YAML). Used by
 * `scripts/generate-cli-skills.ts` to emit `skills/hatch3r-cli-{id}/SKILL.md`.
 *
 * The three hand-authored sections (Recipes / Wrong Choice / Alternatives)
 * are supplied by the optional `authored` argument. When a section is
 * provided the renderer emits it verbatim; when omitted the renderer emits a
 * structural scaffold placeholder. Passing the on-disk authored content lets
 * the generator regenerate the registry-driven parts (frontmatter,
 * When-to-Use, Detection/Install, Security) WITHOUT reverting hand-authored
 * prose — the generate-as-source-of-truth channel that closes the
 * D21-SA21.7-03 / D21-SA21.5-02 generator-marker footgun (the renderer could
 * previously ONLY emit placeholders, so any regeneration overwrote the five
 * standalone skills' authored Recipes/Wrong-Choice/Alternatives). The
 * generator wiring that extracts and passes `authored` from the existing
 * SKILL.md is routed via the capability lifecycle; until it lands, the five
 * standalone skills are hand-patched, never regenerated, per the
 * D21-SA21.7-03 sequencing directive.
 *
 * F15.7-H3 (Cycle 10 D15-SA15.7): the `currentOs` argument now controls
 * the "Default for this machine" highlight only — the renderer always
 * emits install blocks for all three supported OS keys so Linux + Windows
 * end-users see vendor-signed channels for their platform instead of a
 * macOS-only command.
 */
export function renderCliToolSkillBody(
  meta: CliToolMeta,
  currentOs: OsKey,
  authored?: AuthoredCliToolSections,
): string {
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
  sections.push(sectionBody(authored?.recipes));
  sections.push("");

  sections.push("## Wrong Choice When");
  sections.push("");
  sections.push(sectionBody(authored?.wrongChoice));
  sections.push("");

  sections.push("## Alternatives");
  sections.push("");
  sections.push(sectionBody(authored?.alternatives));
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
