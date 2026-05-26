#!/usr/bin/env node
/**
 * scripts/generate-cli-skills.ts — Wave 4a, plan §7 item 23
 *
 * Maintainer-only generator. Reads `AVAILABLE_CLI_TOOLS` from
 * `src/cliTools/registry.ts` and emits one standalone skill file per entry
 * in `STANDALONE_TOOLS` (post v1.9.0 consolidation: ripgrep, jq, gh, fd, fzf):
 *
 *   - `skills/hatch3r-cli-{id}/SKILL.md` (one per standalone registry entry)
 *
 * Every other registry tool is covered by the hand-authored
 * `skills/hatch3r-cli-toolbox/SKILL.md`, which this generator does NOT touch.
 *
 * Body content comes from `renderCliToolSkillBody(meta, currentOs)` in
 * `src/cliTools/skill.ts` — Wave 2 emits scaffolding with placeholders that
 * Wave 4b/c/d sub-agents replace per-tool. Wave 4a only generates structure.
 *
 * Idempotency: every generated file carries the marker
 * `<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->` immediately after the YAML
 * frontmatter. Re-running the generator:
 *   - replaces the file when the marker is present (or the file is absent)
 *   - refuses to overwrite a file whose marker is absent (human-authored)
 *   - `--force` bypasses the refusal; use sparingly
 *
 * Pillars: P3 (CLI-Tool Currency), P4 (Lean Coverage), P5 (Governance Self-Quality).
 *
 * Usage: `npx tsx scripts/generate-cli-skills.ts [--dry-run] [--force]`.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVAILABLE_CLI_TOOLS,
  type CliToolMeta,
  type OsKey,
  renderCliToolSkillBody,
  buildSkillDescription,
} from "../src/cliTools/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

const GENERATED_MARKER = "<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->";

interface Args {
  dryRun: boolean;
  force: boolean;
}

interface PlanEntry {
  path: string;
  /** Action that will be taken: write (new), update (replace marker file), refuse (human-edited), force (forced overwrite). */
  action: "write" | "update" | "refuse" | "force";
  reason: string;
}

function parseArgs(argv: readonly string[]): Args {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

function currentOs(): OsKey {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "linux";
}

/**
 * Derive per-tool tag list per plan §5:
 *   tier-1 = [cli-tools, <category>, core]
 *   tier-2 = [cli-tools, <category>]
 *   tier-3 = [cli-tools, <category>, opt-in] (+ "ai" and "caveat" for RTK)
 */
function tagsFor(meta: CliToolMeta): string[] {
  const base = ["cli-tools", meta.category];
  if (meta.tier === 1) return [...base, "core"];
  if (meta.tier === 2) return base;
  // tier 3
  const tags = [...base, "opt-in"];
  if (meta.caveat) {
    // RTK is the only entry with caveat in Wave 4a; the registry contract
    // dictates that the AI category gets a "caveat" tag whenever a tier-3
    // entry carries any caveat string.
    if (!tags.includes("ai")) tags.push("ai");
    tags.push("caveat");
  }
  return tags;
}

/**
 * Render YAML frontmatter for a per-tool skill. Quoted strings are
 * single-line to keep frontmatter terse and YAML-safe.
 */
function renderPerToolFrontmatter(meta: CliToolMeta): string {
  const tags = tagsFor(meta);
  const tagsArr = tags.map((t) => JSON.stringify(t)).join(", ");
  const lines: string[] = [];
  lines.push("---");
  lines.push(`id: hatch3r-cli-${meta.id}`);
  lines.push(`description: ${JSON.stringify(buildSkillDescription(meta))}`);
  lines.push(`tags: [${tagsArr}]`);
  lines.push("quality_charter: agents/shared/quality-charter.md");
  lines.push("efficiency_patterns: agents/shared/efficiency-patterns.md");
  lines.push("cache_friendly: true");
  lines.push("cli_tool:");
  lines.push(`  id: ${meta.id}`);
  lines.push(`  bin: ${meta.probe}`);
  lines.push(`  tier: ${meta.tier}`);
  lines.push(`  category: ${meta.category}`);
  lines.push(`  homepage: ${meta.homepage}`);
  if (meta.caveat) {
    lines.push(`  caveat: ${meta.caveat}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function renderPerToolFile(meta: CliToolMeta, os: OsKey): string {
  const frontmatter = renderPerToolFrontmatter(meta);
  const body = renderCliToolSkillBody(meta, os);
  // Marker sits between frontmatter and body so it is part of the generated
  // body — human-edits below the body still trip the refusal check.
  return `${frontmatter}\n${GENERATED_MARKER}\n${body}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function classify(
  path: string,
  newContent: string,
  force: boolean,
): Promise<PlanEntry> {
  const exists = await fileExists(path);
  if (!exists) {
    return { path, action: "write", reason: "new file" };
  }
  if (force) {
    return { path, action: "force", reason: "--force overrides idempotency check" };
  }
  const existing = await readFile(path, "utf-8");
  if (existing.includes(GENERATED_MARKER)) {
    if (existing === newContent) {
      return { path, action: "update", reason: "marker present; identical content (no-op)" };
    }
    return { path, action: "update", reason: "marker present; content changed" };
  }
  return {
    path,
    action: "refuse",
    reason: "no generator marker — file looks human-authored; rerun with --force to overwrite",
  };
}

/**
 * v1.9.0 toolbox consolidation: only the five standalone tools below are
 * generator-emitted as their own per-tool skill file. Every other registry
 * tool is covered by the hand-authored `skills/hatch3r-cli-toolbox/SKILL.md`
 * (which the generator does NOT touch — it is human-maintained).
 */
const STANDALONE_TOOLS = new Set(["ripgrep", "jq", "gh", "fd", "fzf"]);

async function buildPlan(force: boolean): Promise<PlanEntry[]> {
  const os = currentOs();
  const plan: PlanEntry[] = [];

  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    if (!STANDALONE_TOOLS.has(meta.id)) continue;
    const path = join(SKILLS_DIR, `hatch3r-cli-${meta.id}`, "SKILL.md");
    const content = renderPerToolFile(meta, os);
    plan.push(await classify(path, content, force));
  }

  return plan;
}

async function contentFor(planEntry: PlanEntry): Promise<string> {
  const os = currentOs();
  // Resolve the right content from the path.
  const relative = planEntry.path.startsWith(SKILLS_DIR)
    ? planEntry.path.slice(SKILLS_DIR.length + 1)
    : planEntry.path;
  const dir = relative.split(/[/\\]/)[0];
  const toolId = dir.replace(/^hatch3r-cli-/, "");
  const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[toolId];
  if (!meta) {
    throw new Error(`buildPlan emitted an unknown tool path: ${planEntry.path}`);
  }
  return renderPerToolFile(meta, os);
}

async function applyPlan(plan: PlanEntry[]): Promise<{
  written: number;
  updated: number;
  refused: number;
  forced: number;
  noop: number;
}> {
  let written = 0;
  let updated = 0;
  let refused = 0;
  let forced = 0;
  let noop = 0;

  for (const entry of plan) {
    if (entry.action === "refuse") {
      refused += 1;
      continue;
    }
    if (entry.action === "update" && entry.reason.startsWith("marker present; identical")) {
      noop += 1;
      continue;
    }
    const content = await contentFor(entry);
    await mkdir(dirname(entry.path), { recursive: true });
    await writeFile(entry.path, content, "utf-8");
    if (entry.action === "write") written += 1;
    else if (entry.action === "update") updated += 1;
    else if (entry.action === "force") forced += 1;
  }

  return { written, updated, refused, forced, noop };
}

function printPlan(plan: PlanEntry[]): void {
  for (const entry of plan) {
    const rel = entry.path.startsWith(ROOT)
      ? entry.path.slice(ROOT.length + 1)
      : entry.path;
    // eslint-disable-next-line no-console
    console.log(`  [${entry.action}] ${rel} — ${entry.reason}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = await buildPlan(args.force);

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`generate-cli-skills (dry-run): ${plan.length} planned operations`);
    printPlan(plan);
    return;
  }

  // Pre-check: refusals are non-fatal but printed up front so the user
  // notices them in the activity log.
  const refusals = plan.filter((e) => e.action === "refuse");
  if (refusals.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`generate-cli-skills: refusing to overwrite ${refusals.length} human-edited file(s):`);
    for (const r of refusals) {
      const rel = r.path.startsWith(ROOT) ? r.path.slice(ROOT.length + 1) : r.path;
      // eslint-disable-next-line no-console
      console.warn(`  - ${rel}`);
    }
    // eslint-disable-next-line no-console
    console.warn("  rerun with --force to overwrite (last resort).");
  }

  const result = await applyPlan(plan);
  // eslint-disable-next-line no-console
  console.log(
    `generate-cli-skills: wrote ${result.written} new, updated ${result.updated}, forced ${result.forced}, no-op ${result.noop}, refused ${result.refused}`,
  );
  // Refusals are not a hard failure — the maintainer may have intentionally
  // hand-authored a file. Reserve exit-1 for unexpected I/O errors only.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("generate-cli-skills failed:", err);
  process.exit(1);
});
