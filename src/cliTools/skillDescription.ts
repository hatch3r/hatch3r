/**
 * Shared description-building data for CLI-tool skill generation.
 *
 * Used by both `scripts/generate-cli-skills.ts` (initial scaffold writer)
 * and `scripts/fix-cli-skill-frontmatter.ts` (Wave 4 cleanup) so the two
 * maintainer scripts cannot drift. Adding a tool to
 * `AVAILABLE_CLI_TOOLS` requires adding entries here so the generator and
 * the cleanup updater emit identical descriptions.
 *
 * The description template lands at ~180–280 chars per registry entry,
 * clearing the 60-char minimum enforced by
 * `validateDescriptionLength()` in `src/cli/commands/validate.ts` and the
 * cosine-similarity threshold of 0.55 in
 * `validateDescriptionCollisions` (per-tool vocabulary keeps the
 * within-cluster cosine below threshold for all `cli-tools`-tagged
 * skills).
 *
 * Pillars: P4 (Lean Coverage), P5 (Governance Self-Quality), P7 (Speed &
 * Token Efficiency).
 */
import type { CliToolMeta } from "./registry.js";

/**
 * Per-tool "Use when..." trigger phrasing. Hand-curated per tool so the
 * description disambiguates against same-category neighbours (e.g. jq vs
 * yq, ripgrep vs fd) and clears the cosine-similarity lint in
 * `src/cli/commands/validate.ts::validateDescriptionCollisions`
 * (threshold 0.55, cluster scoped on `(type, primaryTag)` — all
 * CLI-tool skills land in the same cluster, so per-tool vocabulary is
 * the only lever).
 */
export const TOOL_TRIGGERS: Record<string, string> = {
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
 * so same-category pairs (docker vs podman, delta vs difftastic,
 * playwright vs stagehand, ast-grep vs comby) clear the cosine-0.55
 * threshold. Falls back to the category-default closer when an entry is
 * absent.
 */
export const TOOL_CLOSERS: Record<string, string> = {
  docker: "Talks to a running Docker Engine daemon over a Unix socket; perfect for x86 build hosts.",
  podman: "Forks per-pod processes directly under the invoking user; ideal for hardened CI workers.",
  delta: "Replaces the legacy `less`-based diff renderer with terminal-native ANSI colour blocks.",
  difftastic: "Skips whitespace and reordering noise by computing edits over parsed syntax trees.",
  playwright: "Built around test runners (`@playwright/test`) with deterministic locators and waits.",
  stagehand: "Wraps Browserbase Stagehand so prompts decide which DOM nodes to inspect or click.",
  "ast-grep": "Grammar-aware: queries are written in the same syntax as the language being edited.",
  comby: "Language-agnostic: a single `{:[hole]}` template works against any of 30+ grammars.",
};

/**
 * Per-category closing clause used as fallback when no per-tool entry
 * exists in `TOOL_CLOSERS`. Vocabulary is intentionally non-overlapping
 * across categories so cross-category cosine also stays below threshold.
 */
export const CATEGORY_CLOSERS: Record<string, string> = {
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
 * Build the expanded description used in skill frontmatter.
 *
 * Distinct per-tool ingredients drive lexical diversity below the 0.55
 * cosine threshold:
 *   1. `meta.description` — tool-specific tagline
 *   2. TOOL_TRIGGERS[id] — hand-curated trigger sentence
 *   3. TOOL_CLOSERS[id] (or category fallback) — closing clause
 *   4. `meta.probe` — distinct binary name per tool
 *
 * Output lands at ~180–280 chars per registry entry (60-char min).
 */
export function buildSkillDescription(meta: CliToolMeta): string {
  const trigger = TOOL_TRIGGERS[meta.id] ?? `${meta.category} tasks`;
  const closer =
    TOOL_CLOSERS[meta.id] ??
    CATEGORY_CLOSERS[meta.category] ??
    "Use over an MCP equivalent to cut output tokens.";
  return `${meta.description}. Use when ${trigger}; invoke \`${meta.probe}\`. ${closer}`;
}
