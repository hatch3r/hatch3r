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
 * Per-tool "Use when..." trigger phrasing. Hand-curated per tool so the
 * description disambiguates against same-category neighbours (e.g. jq vs
 * yq, ripgrep vs fd) and clears the cosine-similarity lint in
 * `src/cli/commands/validate.ts::validateDescriptionCollisions` (threshold
 * 0.55, cluster scoped on `(type, primaryTag)` — all CLI-tool skills land
 * in the same cluster, so per-tool vocabulary is the only lever).
 *
 * Each phrase mentions a tool-specific keyword (e.g. "regex" for ripgrep,
 * "globs" for fd, "jq-syntax" for jq, "stream editor" for sd) so the
 * within-category cosine drops below the threshold.
 *
 * Adding a tool to `AVAILABLE_CLI_TOOLS` requires adding an entry here.
 * The generator/cleanup scripts will fall back to a generic category
 * phrase, which may collide — surface the missing entry with the
 * description-quality lint output.
 */
const TOOL_TRIGGERS: Record<string, string> = {
  ripgrep: "regex content searches across large source trees with gitignore filtering",
  fd: "locating filenames or directories by glob with parallel walking",
  jq: "shaping JSON streams via jq-syntax filters and select expressions",
  yq: "editing Kubernetes manifests, Helm values, or GitHub-Actions workflows in place",
  gh: "drafting GitHub pull requests, issues, releases, gists, or workflow dispatches",
  delta: "viewing unified git diffs with side-by-side syntax colourised hunks",
  bat: "scrolling one source file with syntax colours, line numbers, and header decorations",
  sd: "literal-string stream substitution with no regex foot-guns",
  "ast-grep": "Tree-sitter AST pattern rewrites scoped to a single grammar",
  zstd: "high-ratio compression with single-digit-millisecond decompress speeds",
  playwright: "end-to-end browser test execution capturing screenshots and traces",
  duckdb: "ad-hoc analytical SQL over local Parquet, CSV, and JSON files",
  xsv: "slicing huge CSV documents by row range or column without materialising the dataset",
  taplo: "formatting and linting pyproject.toml or Cargo.toml manifests",
  glab: "GitLab merge-request review, pipeline retries, and issue triage",
  "az-devops": "Azure DevOps work-item edits, repo pushes, and pipeline runs",
  docker: "image build, container run, exec inspection, or registry push commands",
  llm: "model-agnostic shell prompting with template files and conversation memory",
  fzf: "ad-hoc interactive picker over piped stdin streams from another command",
  lazygit: "keyboard-driven terminal UI for staging, rebasing, branch switching",
  difftastic: "syntax-aware diffing that reports semantic edits instead of textual lines",
  rtk: "compressing oversize tool output payloads before they enter an LLM prompt",
  stagehand: "natural-language browser steering with on-the-fly DOM reasoning",
  aichat: "RAG-enabled multi-provider conversational shell with saved session history",
  mods: "Unix-pipeline LLM inference reading Markdown stdin and writing Markdown stdout",
  comby: "declarative pattern match-and-rewrite spanning mixed-language repositories",
  miller: "awk-like record processing across CSV, TSV, JSON line streams",
  csvkit: "Python-powered CSV toolkit covering csvlook, csvsql, csvjoin, csvstat",
  podman: "rootless OCI-image execution without a privileged daemon",
};

/**
 * Per-tool closing clause. Adds tool-specific differentiator vocabulary
 * so same-category pairs (e.g. docker vs podman, delta vs difftastic,
 * playwright vs stagehand, ast-grep vs comby) clear the cosine-0.55
 * threshold on `validateDescriptionCollisions`. Falls back to the
 * category-default closer when an entry is absent — those defaults are
 * intentionally varied across categories so the cross-category cosine
 * also stays below threshold.
 */
const TOOL_CLOSERS: Record<string, string> = {
  // Container pair — docker is daemon-attached; podman is daemonless.
  docker: "Talks to a running Docker Engine daemon over a Unix socket; perfect for x86 build hosts.",
  podman: "Forks per-pod processes directly under the invoking user; ideal for hardened CI workers.",
  // Diff pair — delta is a textual pager; difftastic is structural.
  delta: "Replaces the legacy `less`-based diff renderer with terminal-native ANSI colour blocks.",
  difftastic: "Skips whitespace and reordering noise by computing edits over parsed syntax trees.",
  // Browser pair — playwright is scripted; stagehand is LLM-driven.
  playwright: "Built around test runners (`@playwright/test`) with deterministic locators and waits.",
  stagehand: "Wraps Browserbase Stagehand so prompts decide which DOM nodes to inspect or click.",
  // Structural-rewrite pair — ast-grep uses Tree-sitter; comby uses match templates.
  "ast-grep": "Grammar-aware: queries are written in the same syntax as the language being edited.",
  comby: "Language-agnostic: a single `{:[hole]}` template works against any of 30+ grammars.",
};

/**
 * Per-category closing clause used as fallback when no per-tool entry
 * exists in `TOOL_CLOSERS`. Vocabulary is intentionally non-overlapping
 * across categories.
 */
const CATEGORY_CLOSERS: Record<string, string> = {
  search: "Outputs newline-separated hit records; bound results with `-c` or `--max-count`.",
  json: "Reads stdin and emits stdout; integrates seamlessly into shell pipelines.",
  yaml: "Preserves YAML anchors, comments, and ordering when editing in place.",
  git: "Reads `.git/objects` directly without invoking external services or remotes.",
  view: "Prints to a terminal pager (`less`-compatible) for quick visual inspection.",
  edit: "Operates byte-by-byte; safe for fixed-string edits where regex would over-match.",
  archive: "Designed for cold-storage payloads and CI artifact upload/download steps.",
  data: "Streams records lazily; works on datasets that exceed available RAM.",
  forge: "Authenticates via the platform's native token mechanism (OAuth / PAT).",
  browser: "Drives a real Chromium/Firefox/WebKit binary via the DevTools Protocol.",
  container: "Composes with OCI-image layer caches and registry pull-through proxies.",
  ai: "Streams tokens to stdout so downstream `grep`/`tee` consumers see partial results.",
  interactive: "Requires a TTY; degrade gracefully to non-interactive batch in CI.",
};

/**
 * Build the expanded description. Distinct per-tool ingredients drive
 * lexical diversity below the 0.55 cosine threshold:
 *   1. `meta.description` — tool-specific tagline
 *   2. TOOL_TRIGGERS[id] — hand-curated tool-specific trigger sentence
 *   3. TOOL_CLOSERS[id] (or category fallback) — tool/category closer
 *   4. `meta.probe` — distinct binary name per tool
 *
 * Length range across the registry: ~180-280 chars (60-char min).
 */
function buildDescription(meta: CliToolMeta): string {
  const trigger = TOOL_TRIGGERS[meta.id] ?? `${meta.category} tasks`;
  const closer =
    TOOL_CLOSERS[meta.id] ??
    CATEGORY_CLOSERS[meta.category] ??
    "Use over an MCP equivalent to cut output tokens.";
  return `${meta.description}. Use when ${trigger}; invoke \`${meta.probe}\`. ${closer}`;
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
  const newDescription = buildDescription(meta);
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

  const minLen = Math.min(...results.filter((r) => r.newLength > 0).map((r) => r.newLength));
  const maxLen = Math.max(...results.filter((r) => r.newLength > 0).map((r) => r.newLength));
  // eslint-disable-next-line no-console
  console.log(
    `  description length range: ${minLen}-${maxLen} chars (min required: 60)`,
  );

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
