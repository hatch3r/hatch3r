#!/usr/bin/env node
/**
 * scripts/fix-cli-skill-frontmatter.ts — Wave 4 cleanup
 *
 * Rewrites only the `description:` field in the YAML frontmatter of every
 * `skills/hatch3r-cli-{id}/SKILL.md` to meet the 60-char minimum enforced
 * by `validateDescriptionLength()` in `src/cli/commands/validate.ts`.
 *
 * Why a separate script (instead of regenerating via
 * `scripts/generate-cli-skills.ts --force`):
 *   - The generator's `renderCliToolSkillBody()` emits placeholder strings
 *     for the Recipes / Wrong Choice / Alternatives sections that Wave
 *     4b/c/d sub-agents replaced with hand-authored, token-cost-framed
 *     content. Re-running with --force would destroy that work.
 *   - This script splits each file on the
 *     `<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->` marker, rewrites only the
 *     `description:` line in the frontmatter block (lines above the
 *     marker), and reassembles the file. Body bytes are byte-identical.
 *
 * Template:
 *   "{meta.description} — for token-efficient {category} workflows.
 *    Tier-{tier} CLI tool; use over MCP equivalents to cut tokens
 *    substantially."
 *
 * The template lands at ~120-180 chars for every registry entry and
 * frames token-cost rationale per Anthropic's Nov 4 2025 finding
 * (98.7% reduction with code-execution over MCP).
 *
 * Umbrella file (`hatch3r-cli-overview/SKILL.md`) is untouched — its
 * existing description is already ≥60 chars.
 *
 * Pillars: P4 (Lean Coverage), P5 (Governance Self-Quality), P7 (Speed &
 * Token Efficiency).
 *
 * Usage: `npx tsx scripts/fix-cli-skill-frontmatter.ts [--dry-run]`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVAILABLE_CLI_TOOLS,
  type CliToolMeta,
} from "../src/cliTools/registry.js";
import { buildSkillDescription } from "../src/cliTools/skillDescription.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

const GENERATED_MARKER = "<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->";

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

/**
 * Rewrite the `description:` value in the frontmatter block. The block is
 * everything between the opening `---\n` and the closing `\n---\n`. The
 * marker is expected to sit on the line immediately below the closing
 * fence. We deliberately use a line-oriented rewrite rather than a YAML
 * round-trip so byte-for-byte preservation of unrelated lines (`tags`,
 * `cli_tool`, etc.) is guaranteed.
 */
function rewriteFrontmatterDescription(
  content: string,
  newDescription: string,
): { changed: boolean; output: string; reason: string } {
  const markerIdx = content.indexOf(GENERATED_MARKER);
  if (markerIdx === -1) {
    return {
      changed: false,
      output: content,
      reason: "marker absent — refusing to rewrite a non-generated file",
    };
  }

  const header = content.slice(0, markerIdx);
  const tail = content.slice(markerIdx);

  // Locate the opening and closing YAML fences inside the header.
  if (!header.startsWith("---\n") && !header.startsWith("---\r\n")) {
    return {
      changed: false,
      output: content,
      reason: "frontmatter missing opening --- fence",
    };
  }
  const afterOpen = header.indexOf("\n", 3) + 1;
  const closeIdx = header.indexOf("\n---", afterOpen - 1);
  if (afterOpen <= 0 || closeIdx === -1) {
    return {
      changed: false,
      output: content,
      reason: "frontmatter missing closing --- fence",
    };
  }
  const fmBlock = header.slice(afterOpen, closeIdx);
  const beforeFm = header.slice(0, afterOpen);
  const afterFm = header.slice(closeIdx);

  // Replace the description: line in fmBlock. The line begins at column 0
  // and ends at the next \n. Quoted-string variants are recognized by the
  // leading `description: "...":` pattern.
  const lines = fmBlock.split("\n");
  let descriptionLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^description:\s/.test(lines[i])) {
      descriptionLineIdx = i;
      break;
    }
  }
  if (descriptionLineIdx === -1) {
    return {
      changed: false,
      output: content,
      reason: "frontmatter has no description: field",
    };
  }
  const newLine = `description: ${JSON.stringify(newDescription)}`;
  if (lines[descriptionLineIdx] === newLine) {
    return { changed: false, output: content, reason: "already up-to-date" };
  }
  lines[descriptionLineIdx] = newLine;
  const newFmBlock = lines.join("\n");

  const output = `${beforeFm}${newFmBlock}${afterFm}${tail}`;
  return { changed: true, output, reason: "description rewritten" };
}

interface FileResult {
  path: string;
  toolId: string;
  status: "updated" | "noop" | "skipped";
  reason: string;
  newLength: number;
}

async function processOne(meta: CliToolMeta, dryRun: boolean): Promise<FileResult> {
  const path = join(SKILLS_DIR, `hatch3r-cli-${meta.id}`, "SKILL.md");
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        path,
        toolId: meta.id,
        status: "skipped",
        reason: "file missing — run generate-cli-skills first",
        newLength: 0,
      };
    }
    throw err;
  }
  const newDescription = buildSkillDescription(meta);
  const { changed, output, reason } = rewriteFrontmatterDescription(
    content,
    newDescription,
  );
  if (!changed) {
    return {
      path,
      toolId: meta.id,
      status: reason === "already up-to-date" ? "noop" : "skipped",
      reason,
      newLength: newDescription.length,
    };
  }
  if (!dryRun) {
    await writeFile(path, output, "utf-8");
  }
  return {
    path,
    toolId: meta.id,
    status: "updated",
    reason,
    newLength: newDescription.length,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const results: FileResult[] = [];
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    results.push(await processOne(meta, args.dryRun));
  }

  const updated = results.filter((r) => r.status === "updated").length;
  const noop = results.filter((r) => r.status === "noop").length;
  const skipped = results.filter((r) => r.status === "skipped");

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `fix-cli-skill-frontmatter (dry-run): ${updated} would update, ${noop} no-op, ${skipped.length} skipped`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `fix-cli-skill-frontmatter: updated ${updated}, no-op ${noop}, skipped ${skipped.length}`,
    );
  }

  const lengths = results.filter((r) => r.newLength > 0).map((r) => r.newLength);
  if (lengths.length > 0) {
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    // eslint-disable-next-line no-console
    console.log(
      `  description length range: ${minLen}-${maxLen} chars (min required: 60)`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log("  description length range: n/a (no files processed)");
  }

  if (skipped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`  skipped files:`);
    for (const r of skipped) {
      const rel = r.path.startsWith(ROOT) ? r.path.slice(ROOT.length + 1) : r.path;
      // eslint-disable-next-line no-console
      console.warn(`    - ${rel}: ${r.reason}`);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fix-cli-skill-frontmatter failed:", err);
  process.exit(1);
});
