import type { AdapterOutput, HatchManifest, Tool } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";

/**
 * D9-SA9.5-05 (Cycle 12 CL-2 U6): opt-in root `AGENTS.md` output class.
 *
 * ≥6 major agentic platforms (Codex CLI, Grok Build, GitHub Agent HQ/Copilot
 * cloud agents, Factory Droid, OpenCode, Amp) read a root `AGENTS.md` as the
 * cross-vendor instruction surface (https://agents.md, accessed 2026-07-12:
 * standard Markdown, no required headings or frontmatter, repo root, nested
 * closest-wins). This module emits hatch3r's half of that interop: a
 * THIN-POINTER file — universal-floor summary + per-tool pointers into the
 * platform-native generated surfaces — never canonical artifact bodies, which
 * is the two-sources-of-truth resolution recorded in
 * `.audit-workspace/content-specs/agentsmd-output-class.spec.md`. The claude
 * adapter's `claude.agentsMdInterop` (D9-12) is the complementary IMPORT half.
 *
 * Decision-12 boundary: this is an output surface, not an adapter — no
 * per-platform logic, no capability-matrix column. It is invoked once from
 * `BaseAdapter.generate()` (never from any `doGenerate`), so all 3 adapters —
 * and any future one — inherit it without per-adapter code, and the output
 * passes through the shared invariant enforcement (traversal guard,
 * managed-substring check, dedup, provenance fill).
 *
 * This module imports only `types.js` and `merge/managedBlocks.js` — no import
 * from `base.ts` — so wiring it into `BaseAdapter.generate()` creates no
 * module cycle.
 *
 * Nesting: v1 emits the ROOT file only (nested AGENTS.md is the monorepo
 * closest-wins case, out of scope per the finding).
 */

/** Repo-root output path of the emitted file (the agents.md convention path). */
export const AGENTS_MD_PATH = "AGENTS.md";

/**
 * Owner-election priority. `hatch3r sync` runs every adapter in
 * `manifest.tools`, and the sync-side cross-adapter collision check warns when
 * two adapters emit one path — so exactly one adapter owns `AGENTS.md` per
 * run: the first member of this fixed order present in `manifest.tools`.
 * `claude` leads because that adapter already owns the AGENTS.md interop
 * relationship (the `claude.agentsMdInterop` import, D9-12). The emitted bytes
 * are a pure function of the manifest, so ownership never changes content —
 * only which adapter's output set carries the file.
 */
// Codex is first because its adapter emits the native repository instruction
// projection at this exact path. BaseAdapter detects that existing output and
// does not append the optional thin pointer, leaving projectCodexInstructions
// as the single writer while preventing another selected adapter from
// colliding with it during a multi-tool run.
export const AGENTS_MD_OWNER_PRIORITY: readonly Tool[] = ["codex", "claude", "cursor", "copilot"];

/**
 * Resolve which adapter (if any) emits `AGENTS.md` for this manifest.
 *
 * Returns `undefined` — emission OFF — unless `manifest.agentsMd?.enabled` is
 * strictly boolean `true` (a hand-edited `"true"` string or `1` stays off:
 * default-off must be provably off) AND at least one supported tool is
 * selected. Tools outside {@link AGENTS_MD_OWNER_PRIORITY} are ignored.
 */
export function resolveAgentsMdOwner(manifest: HatchManifest): Tool | undefined {
  if (manifest.agentsMd?.enabled !== true) return undefined;
  const tools = new Set<Tool>(manifest.tools ?? []);
  return AGENTS_MD_OWNER_PRIORITY.find((tool) => tools.has(tool));
}

/**
 * Per-tool pointer rows naming each platform's generated entry points. Rows
 * reference surface DIRECTORIES/entry files only — no canonical bodies — so
 * the pointer file cannot drift from artifact content, only from the emission
 * path set (which this module's test pins per adapter).
 */
const TOOL_SURFACE_POINTERS: Record<Tool, string> = {
  claude:
    "- **Claude Code** — start at `CLAUDE.md` (orchestration bridge); rules in `.claude/rules/`, agents in `.claude/agents/`, skills in `.claude/skills/`, commands in `.claude/commands/`.",
  cursor:
    "- **Cursor** — start at `.cursor/rules/hatch3r-bridge.mdc`; rules in `.cursor/rules/*.mdc`, agents in `.cursor/agents/`, commands in `.cursor/commands/`.",
  copilot:
    "- **GitHub Copilot** — start at `.github/copilot-instructions.md`; scoped instructions in `.github/instructions/`, agents in `.github/agents/`, skills in `.github/skills/`, prompts in `.github/prompts/`.",
  codex:
    "- **Codex** — repository skills are in `.agents/skills/`; invoke one explicitly with `$skill-name` or let Codex select it from its description.",
};

/**
 * Build the managed-block body (the content BETWEEN the markers).
 *
 * Three payload classes per the D9-SA9.5-05 recommendation: (1) the universal
 * floor summary — B1 clarification directive + security + correctness +
 * testing — calibrated by the maturity-tier line (`manifest.maturity ??
 * "solo"`, the documented absence semantics from `HatchManifest.maturity`);
 * (2) pointers to the platform-native surfaces for the SELECTED tools only;
 * (3) the regeneration/preservation note. Marker-token mentions in prose stay
 * mid-line: managed-block detection is line-anchored (D1-7/D11-4), so only a
 * line that trims to the bare token is a boundary.
 */
export function buildAgentsMdBody(manifest: HatchManifest): string {
  const tier = manifest.maturity ?? "solo";
  const pointerRows = AGENTS_MD_OWNER_PRIORITY.filter((tool) =>
    (manifest.tools ?? []).includes(tool),
  ).map((tool) => TOOL_SURFACE_POINTERS[tool]);

  return [
    "# AGENTS.md",
    "",
    "Agent setup in this repository is generated by [hatch3r](https://github.com/hatch3r/hatch3r).",
    "This file is a thin pointer for coding agents that read the cross-vendor",
    "AGENTS.md convention (https://agents.md) but have no hatch3r-generated surface",
    'of their own. The full instruction set lives in the files listed under "Where',
    'the authoritative instructions live" — when your tool reads one of those',
    "surfaces, it is the source of truth and this summary defers to it.",
    "",
    "## Ground rules for all agents (universal floor)",
    "",
    "- **Clarify before executing:** when a request maps to 2 or more",
    "  interpretations that produce different artifacts — or the action is",
    "  irreversible (deletes, renames, force-pushes) — ask the user first instead",
    "  of guessing.",
    "- **Security:** no hardcoded secrets or tokens (use environment-variable",
    "  placeholders); reject `..` path traversal outside the project root; never",
    "  weaken an existing security check to make a change pass.",
    "- **Correctness:** keep each change scoped to the request; preserve",
    "  user-authored content you did not write — in generated files, everything",
    "  outside the `HATCH3R:BEGIN`/`HATCH3R:END` comment markers is user-owned.",
    "- **Testing:** run this repository's test suite before declaring work",
    "  complete and report the command plus its result; unverified work is not",
    "  done.",
    "",
    `Project maturity tier: \`${tier}\` — calibrate depth of tests, docs, and review to it.`,
    "",
    "## Where the authoritative instructions live",
    "",
    "Generated and kept current by `hatch3r sync`:",
    "",
    ...pointerRows,
    "",
    "## Maintenance",
    "",
    "`hatch3r sync` regenerates everything between the `HATCH3R:BEGIN` and",
    "`HATCH3R:END` markers; edits inside are overwritten on the next sync. Notes",
    "added outside the markers are preserved across syncs.",
  ].join("\n");
}

/**
 * Build the complete `AGENTS.md` {@link AdapterOutput}: the body wrapped
 * whole-content in the markdown/HTML managed-block variant (the `CLAUDE.md`
 * precedent — `wrapManagedFor` selects HTML comment markers for a `.md` path),
 * so the file participates in drift detection and safe merge like every other
 * output. `sourceFiles: []` is explicit: the content derives from the manifest
 * alone (the documented config-only attribution, the `mcp.json` precedent), so
 * the provenance broad-fill in `BaseAdapter.generate()` must not stamp the
 * adapter-wide canonical read set onto a file that duplicates no canonical
 * body.
 */
export function buildAgentsMdOutput(manifest: HatchManifest): AdapterOutput {
  const body = buildAgentsMdBody(manifest);
  return {
    path: AGENTS_MD_PATH,
    content: wrapManagedFor(AGENTS_MD_PATH, body),
    managedContent: body,
    action: "create",
    sourceFiles: [],
  };
}
