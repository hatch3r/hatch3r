/**
 * Wave 2 of the content-pack redesign — re-tag ~117 canonical artifacts to the
 * new capability/floor/context taxonomy shipped in Wave 1
 * (`src/content/tags.ts`, `src/content/index.ts::resolveSelection`,
 * `src/content/presets.ts`).
 *
 * Authoritative source: `.audit-workspace/council-D-architect.md` §4.
 *
 * Locked maintainer decisions encoded here:
 *   - a11y artifacts get `floor:ui-ux` (a11y is part of the UI/UX floor)
 *   - `floor:protocol` accepted as a 3rd floor tag for pipeline-critical agents
 *   - 5 deprecation hawks removed in this wave (handled separately after retag)
 *
 * Strategy: parse each frontmatter block, locate the single-line `tags: [..]`
 * field, and replace ONLY that line — every other byte (whitespace, quoting,
 * comments, key order) is preserved exactly. This is safer than re-serialising
 * via a YAML library because the canonical corpus mixes quoting styles
 * (`[core, implementation]` vs `["cli-tools", "ai", "opt-in"]`) and we MUST NOT
 * touch fields other than `tags`.
 *
 * For rules, the `.md` file carries the `tags:` field; the companion `.mdc`
 * file does NOT (rule-parity is body-bytes-equal and `.mdc` frontmatter is
 * `description` + `globs` + `alwaysApply` only — see
 * `scripts/validate-rule-parity.ts`). So this script only edits `.md` rule
 * files.
 *
 * Run: `tsx scripts/wave2-retag.ts`
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ── Type definitions ───────────────────────────────────────────────

interface ContentDirConfig {
  /** Directory relative to repo root (e.g. "agents", "skills"). */
  dir: string;
  /** "glob" → scan top-level *.md files; "subdirectory" → scan {name}/SKILL.md. */
  strategy: "glob" | "subdirectory";
  /** Content type label (for logging / reporting). */
  typeLabel: "agent" | "skill" | "rule" | "command" | "hook" | "prompt" | "github-agent";
}

const CONTENT_DIRS: ContentDirConfig[] = [
  { dir: "agents",        strategy: "glob",         typeLabel: "agent" },
  { dir: "skills",        strategy: "subdirectory", typeLabel: "skill" },
  { dir: "rules",         strategy: "glob",         typeLabel: "rule" },
  { dir: "commands",      strategy: "glob",         typeLabel: "command" },
  { dir: "hooks",         strategy: "glob",         typeLabel: "hook" },
  { dir: "prompts",       strategy: "glob",         typeLabel: "prompt" },
  { dir: "github-agents", strategy: "glob",         typeLabel: "github-agent" },
];

// ── RETAG_MAP: id → new tag array ──────────────────────────────────
//
// Keyed by the canonical `id:` value from frontmatter (NOT filename). For
// github-agents the id is derived from filename basename (no frontmatter `id`).
// For commands the canonical id has the `cmd-` prefix applied by
// `applyCommandPrefix` in `src/content/index.ts`; this map uses the
// pre-prefix form (matches the frontmatter `id:` field). The script does NOT
// rewrite ids — it only looks up new tags. The lookup is the raw frontmatter
// id (or filename for github-agents).
//
// Source: `.audit-workspace/council-D-architect.md` §4 (Council D Architect).

const RETAG_MAP: Record<string, string[]> = {
  // ── Agents (19) ─────────────────────────────────────────────────
  "hatch3r-a11y-auditor":        ["review", "floor:ui-ux", "a11y"],
  "hatch3r-architect":           ["planning"], // unchanged — explicit for completeness
  "hatch3r-ci-watcher":          ["devops"], // unchanged
  "hatch3r-context-rules":       ["orchestration", "maintenance"],
  "hatch3r-creator":             ["orchestration", "customize"],
  "hatch3r-dependency-auditor":  ["maintenance", "floor:security"],
  "hatch3r-devops":              ["devops"], // unchanged
  "hatch3r-docs-writer":         ["maintenance"], // unchanged
  "hatch3r-fixer":               ["implementation", "floor:protocol"],
  "hatch3r-handoff-loader":      ["orchestration", "maintenance"],
  "hatch3r-handoff-preparer":    ["orchestration", "maintenance"],
  "hatch3r-implementer":         ["implementation", "floor:protocol"],
  "hatch3r-learnings-loader":    ["orchestration", "maintenance"],
  "hatch3r-lint-fixer":          ["implementation", "orchestration"],
  "hatch3r-perf-profiler":       ["review", "performance"],
  "hatch3r-researcher":          ["planning", "floor:protocol"],
  "hatch3r-reviewer":            ["review", "floor:protocol"],
  "hatch3r-security-auditor":    ["review", "floor:security"],
  "hatch3r-test-writer":         ["review", "floor:protocol"],

  // ── Skills (63 — only those whose tags change) ─────────────────
  "hatch3r-a11y-audit":               ["review", "floor:ui-ux", "a11y"],
  "hatch3r-ai-feature":               ["implementation", "ai"], // unchanged
  "hatch3r-bug-fix":                  ["implementation", "orchestration"],
  "hatch3r-design-system-detect":     ["implementation", "floor:ui-ux", "ui", "design-system", "frontend"],
  "hatch3r-dep-audit":                ["maintenance", "floor:security"],
  "hatch3r-feature":                  ["implementation", "orchestration"],
  "hatch3r-handoff-prepare":          ["orchestration", "maintenance"],
  "hatch3r-handoff-resume":           ["orchestration", "maintenance"],
  "hatch3r-issue-workflow":           ["implementation", "orchestration"],
  "hatch3r-perf-audit":               ["review", "performance"], // unchanged
  "hatch3r-pr-creation":              ["implementation", "orchestration"],
  "hatch3r-qa-validation":            ["review", "orchestration"],
  "hatch3r-recipe":                   ["orchestration"],
  "hatch3r-refactor":                 ["implementation", "orchestration"],
  "hatch3r-ui-ux-verify":             ["review", "floor:ui-ux", "ui", "ux", "a11y"],
  "hatch3r-visual-refactor":          ["implementation", "floor:ui-ux"],
  "hatch3r-migration":                ["implementation", "ctx:brownfield-only"],
  "hatch3r-gh-agentic-workflows":     ["devops", "ctx:team-only"],
  // CLI-tool skills with the legacy `ai` category tag — rename to `ai-cat`
  "hatch3r-cli-aichat":               ["cli-tools", "ai-cat", "opt-in"],
  "hatch3r-cli-llm":                  ["cli-tools", "ai-cat"],
  "hatch3r-cli-mods":                 ["cli-tools", "ai-cat", "opt-in"],
  "hatch3r-cli-rtk":                  ["cli-tools", "ai-cat", "opt-in", "caveat"],
  // CLI-tool skills with legacy `core` recommendation marker — drop `core`.
  // Council D §4 said "CLI-tool tags unchanged" but the legacy `core` tag is
  // the very value Wave 2 is eradicating from the corpus; verification check #5
  // (no `core` anywhere in tag arrays) is incompatible with leaving it on CLI
  // skills. The `cli-tools` + category + opt-in/reference tags continue to
  // route admission via the cli-tool facet downstream — `core` here was a
  // recommendation level, not a capability. Recorded deviation in report.
  "hatch3r-cli-ast-grep":             ["cli-tools", "search"],
  "hatch3r-cli-bat":                  ["cli-tools", "view"],
  "hatch3r-cli-delta":                ["cli-tools", "git"],
  "hatch3r-cli-fd":                   ["cli-tools", "search"],
  "hatch3r-cli-gh":                   ["cli-tools", "forge"],
  "hatch3r-cli-jq":                   ["cli-tools", "json"],
  "hatch3r-cli-overview":             ["cli-tools", "reference"],
  "hatch3r-cli-ripgrep":              ["cli-tools", "search"],
  "hatch3r-cli-sd":                   ["cli-tools", "edit"],
  "hatch3r-cli-yq":                   ["cli-tools", "yaml"],
  "hatch3r-cli-zstd":                 ["cli-tools", "archive"],

  // ── Rules (42 — those whose tags change) ───────────────────────
  "hatch3r-accessibility-standards":      ["floor:ui-ux", "a11y"],
  "hatch3r-agent-orchestration":          ["orchestration", "floor:protocol"],
  "hatch3r-agent-orchestration-detail":   ["orchestration", "floor:protocol"],
  "hatch3r-ai-evals":                     ["review", "implementation", "ai"], // unchanged
  "hatch3r-ai-ux-patterns":               ["implementation", "floor:ui-ux", "ux", "ai", "frontend"],
  "hatch3r-auth-patterns":                ["implementation", "floor:security"],
  "hatch3r-code-standards":               ["implementation", "lang:typescript"], // "core" → "implementation" (coding conventions are implementation capability)
  "hatch3r-component-conventions":        ["implementation", "floor:ui-ux", "lang:typescript"],
  "hatch3r-container-hardening":          ["devops", "floor:security"],
  "hatch3r-data-classification":          ["floor:security"],
  "hatch3r-deep-context":                 ["orchestration", "floor:protocol"],
  "hatch3r-dependency-management":        ["maintenance", "floor:security"],
  "hatch3r-design-system-detection":      ["implementation", "floor:ui-ux", "ui", "design-system", "frontend"],
  "hatch3r-git-conventions":              ["orchestration"],
  "hatch3r-handoff-readiness":            ["orchestration", "maintenance"],
  "hatch3r-i18n":                         ["implementation", "floor:ui-ux", "lang:typescript"],
  "hatch3r-iteration-summary":            ["orchestration", "floor:protocol"],
  "hatch3r-learning-consult":             ["orchestration"],
  "hatch3r-migrations":                   ["implementation", "ctx:brownfield-only"],
  "hatch3r-passkey-server":               ["implementation", "floor:security"],
  "hatch3r-secrets-management":           ["floor:security"],
  "hatch3r-security-patterns":            ["floor:security"],
  "hatch3r-testing":                      ["review", "orchestration"],
  "hatch3r-theming":                      ["implementation", "floor:ui-ux", "lang:typescript"],
  "hatch3r-tooling-hierarchy":            ["orchestration"],
  "hatch3r-ux-states-and-flows":          ["implementation", "floor:ui-ux", "ux", "ui", "frontend"],

  // ── Commands (38 — those whose tags change; ids are pre-cmd-prefix) ──
  "hatch3r-board-fill":         ["board", "ctx:team-only"],
  "hatch3r-board-groom":        ["board", "ctx:team-only"],
  "hatch3r-board-init":         ["board", "ctx:team-only"],
  "hatch3r-board-pickup":       ["board", "ctx:team-only"],
  "hatch3r-board-refresh":      ["board", "ctx:team-only"],
  "hatch3r-board-shared":       ["board", "ctx:team-only"],
  "hatch3r-bug-plan":           ["planning", "orchestration"],
  "hatch3r-codebase-map":       ["planning", "ctx:brownfield-only"],
  "hatch3r-create":             ["orchestration", "customize"],
  "hatch3r-debug":              ["implementation", "orchestration"],
  "hatch3r-dep-audit":          ["maintenance", "floor:security"],
  "hatch3r-feature-plan":       ["planning", "orchestration"],
  "hatch3r-handoff":            ["orchestration", "maintenance"],
  "hatch3r-hooks":              ["devops", "orchestration"],
  "hatch3r-learn":              ["orchestration", "maintenance"],
  "hatch3r-migration-plan":     ["planning", "ctx:brownfield-only"],
  "hatch3r-onboard":            ["planning", "ctx:brownfield-only", "ctx:team-only"],
  "hatch3r-pr-resolve":         ["implementation", "review", "ctx:team-only"],
  "hatch3r-project-spec":       ["planning", "ctx:greenfield-only"],
  "hatch3r-quick-change":       ["implementation", "orchestration"],
  "hatch3r-recipe":             ["orchestration"],
  "hatch3r-revision":           ["implementation", "ctx:team-only"],
  "hatch3r-roadmap":            ["planning", "ctx:greenfield-only"],
  "hatch3r-security-audit":     ["maintenance", "floor:security"],
  "hatch3r-test-plan":          ["planning", "orchestration"],
  "hatch3r-workflow":           ["implementation", "orchestration"],

  // ── Hooks (6) ───────────────────────────────────────────────────
  "ci-failure-ci-watcher":     ["devops"],
  "file-save-context-rules":   ["orchestration"],
  "post-merge-ci-watcher":     ["devops"],
  "pre-commit-lint-fixer":     ["implementation"],
  "pre-push-security-auditor": ["floor:security"],
  "session-start-learnings":   ["orchestration"],

  // ── GitHub agents (4) — keyed by filename basename (no frontmatter id) ──
  "hatch3r-docs-agent":     ["devops", "ctx:team-only"],
  "hatch3r-lint-agent":     ["devops", "ctx:team-only"],
  "hatch3r-security-agent": ["devops", "floor:security", "ctx:team-only"],
  "hatch3r-test-agent":     ["review", "ctx:team-only"],

  // ── Prompts (3 — hawked but retained in map for symmetry; script
  //    skips them via SKIPPED_HAWKS, but if not hawked they would map as
  //    documented in §4) ──
  // "hatch3r-bug-triage":     ["planning"],
  // "hatch3r-code-review":    ["review"],
  // "hatch3r-pr-description": ["implementation"],
};

// ── Deprecation hawks (to skip in retag; physically removed after) ───
const SKIPPED_HAWKS = new Set<string>([
  "hatch3r-observability",
  "hatch3r-observability-tracing-detail",
  "hatch3r-bug-triage",
  "hatch3r-code-review",
  "hatch3r-pr-description",
]);

// ── Tag taxonomy validation (mirror of TAG_REGISTRY) ─────────────────
// Used to verify every retagged artifact ends up with at least one
// capability tag OR at least one floor tag OR `protected: true`.

const CAPABILITY_TAGS = new Set([
  "planning", "implementation", "review", "devops", "maintenance",
  "orchestration", "board", "performance", "ai",
]);
const FLOOR_TAGS = new Set([
  "floor:security", "floor:ui-ux", "floor:protocol",
]);

// ── Frontmatter helpers ──────────────────────────────────────────────

interface Frontmatter {
  /** The raw frontmatter block (without delimiters). */
  body: string;
  /** End position (byte offset) in the original file content. */
  endOffset: number;
  /** Start position (byte offset). */
  startOffset: number;
  /** Parsed id (from `id:` line), or undefined. */
  id?: string;
  /** Parsed protected flag (from `protected: true`), or false. */
  protectedFlag: boolean;
  /** The full `tags: [...]` line including newline, or undefined if no tags field. */
  tagsLine?: string;
  /** Byte offset of the tags line within the file. */
  tagsLineOffset?: number;
  /** Length of the tags line in bytes (including trailing newline). */
  tagsLineLength?: number;
  /** Parsed tag array. */
  currentTags?: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function parseFrontmatterMeta(raw: string): Frontmatter | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const body = match[1];
  const startOffset = 0;
  const endOffset = match[0].length;

  // Extract id (first id: line)
  const idMatch = body.match(/^id:\s*(.+?)\s*$/m);
  const id = idMatch ? idMatch[1].replace(/^["']|["']$/g, "") : undefined;

  // Extract protected flag
  const protectedMatch = body.match(/^protected:\s*true\s*$/m);
  const protectedFlag = !!protectedMatch;

  // Locate the tags: [..] line within the original raw content. We search the
  // frontmatter block by finding the exact line in the raw string so we can
  // compute its byte offset for a surgical replacement.
  //
  // Constraint: every tag line in the canonical corpus is single-line of the
  // form `tags: [...]` (verified by `grep "^tags:" agents rules commands hooks
  // github-agents prompts skills` — no multi-line YAML arrays).
  const tagsRe = /^tags:\s*(\[[^\]]*\])\s*\r?\n/m;
  const tagsMatch = body.match(tagsRe);
  let tagsLine: string | undefined;
  let tagsLineOffset: number | undefined;
  let tagsLineLength: number | undefined;
  let currentTags: string[] | undefined;
  if (tagsMatch) {
    const arrLiteral = tagsMatch[1];
    // Parse array contents — strip [..], split by comma, trim each, drop quotes.
    const inner = arrLiteral.slice(1, -1).trim();
    currentTags = inner.length === 0
      ? []
      : inner.split(",").map((t) => t.trim().replace(/^["']|["']$/g, ""));

    // Compute offset in the original raw file (frontmatter starts at offset 0,
    // body starts after the opening `---\n` line which is 4 bytes for `---\n`
    // or 5 for `---\r\n`).
    const opener = raw.match(/^---\r?\n/);
    const openerLen = opener ? opener[0].length : 4;
    const tagsBodyOffset = tagsMatch.index ?? 0;
    tagsLineOffset = openerLen + tagsBodyOffset;
    tagsLineLength = tagsMatch[0].length;
    tagsLine = tagsMatch[0];
  }

  return {
    body,
    startOffset,
    endOffset,
    id,
    protectedFlag,
    tagsLine,
    tagsLineOffset,
    tagsLineLength,
    currentTags,
  };
}

/**
 * Format the new tags line preserving the single-line `[a, b, c]` shape.
 * Quoting choice: if any new tag value contains characters that would require
 * YAML quoting (`:`, `,`, etc.), wrap in double quotes. Otherwise emit bare.
 * This matches the existing corpus style — bare tags (e.g. `[review, a11y]`)
 * when no quoting needed, quoted (e.g. `["cli-tools", "ai-cat"]`) for CLI
 * skills.
 */
function formatTagsLine(newTags: string[], currentLine?: string): string {
  // Decide quoting: if the current line used quoted strings, preserve quoting
  // for the rewrite. Falls back to bare for new floor:* / ctx:* tags which
  // contain `:` — YAML treats these unambiguously inside flow sequences when
  // they don't start the line, but we play safe and quote tags containing `:`
  // when the file was using a mixed style.
  const currentUsesQuotes = currentLine ? /"\w/.test(currentLine) : false;
  // Tags containing `:` (floor:*, ctx:*, lang:*) — always safe bare inside
  // YAML flow sequences (they're string scalars; `:` in flow scalars without
  // a following space is part of the value). Bare-style files use bare tags
  // already (`lang:typescript` is bare in the existing corpus), so we follow
  // that convention.
  const formatted = newTags.map((t) =>
    currentUsesQuotes ? `"${t}"` : t,
  );
  return `tags: [${formatted.join(", ")}]\n`;
}

// ── File walkers ────────────────────────────────────────────────────

interface ArtifactFile {
  filePath: string;
  relPath: string;
  config: ContentDirConfig;
}

async function walkContent(): Promise<ArtifactFile[]> {
  const out: ArtifactFile[] = [];
  for (const config of CONTENT_DIRS) {
    const dirPath = join(REPO_ROOT, config.dir);
    if (config.strategy === "glob") {
      let entries: string[];
      try {
        entries = (await readdir(dirPath)).filter((f) => f.endsWith(".md")).sort();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const file of entries) {
        out.push({
          filePath: join(dirPath, file),
          relPath: `${config.dir}/${file}`,
          config,
        });
      }
    } else {
      // skills: one SKILL.md per subdirectory
      let dirents;
      try {
        dirents = (await readdir(dirPath, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const skillPath = join(dirPath, dirent.name, "SKILL.md");
        out.push({
          filePath: skillPath,
          relPath: `${config.dir}/${dirent.name}/SKILL.md`,
          config,
        });
      }
    }
  }
  return out;
}

// ── Lookup key derivation ───────────────────────────────────────────
// Map an ArtifactFile to its retag-map key. For most types this is the
// frontmatter `id:`. For github-agents (which lack `id:`), the key is the
// filename basename (e.g. `hatch3r-docs-agent.md` → `hatch3r-docs-agent`).

function resolveRetagKey(file: ArtifactFile, fm: Frontmatter): string | undefined {
  if (file.config.typeLabel === "github-agent") {
    const basename = file.relPath.split("/").pop()!.replace(/\.md$/, "");
    return basename;
  }
  return fm.id;
}

// ── Main ─────────────────────────────────────────────────────────────

interface RetagResult {
  relPath: string;
  type: string;
  id: string;
  oldTags: string[];
  newTags: string[];
  status: "retagged" | "unchanged-identical" | "skipped-hawk" | "no-match-in-map" | "no-frontmatter" | "no-tags-line" | "missing-id" | "warning-no-capability-or-floor";
  warning?: string;
}

async function main(): Promise<void> {
  const files = await walkContent();
  const results: RetagResult[] = [];

  for (const file of files) {
    const raw = await readFile(file.filePath, "utf-8");
    const fm = parseFrontmatterMeta(raw);
    if (!fm) {
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: "",
        oldTags: [],
        newTags: [],
        status: "no-frontmatter",
      });
      continue;
    }

    const key = resolveRetagKey(file, fm);
    if (!key) {
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: "",
        oldTags: fm.currentTags ?? [],
        newTags: [],
        status: "missing-id",
      });
      continue;
    }

    if (SKIPPED_HAWKS.has(key)) {
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: key,
        oldTags: fm.currentTags ?? [],
        newTags: [],
        status: "skipped-hawk",
      });
      continue;
    }

    const newTags = RETAG_MAP[key];
    if (!newTags) {
      // Not in retag map — leave file untouched. This is normal for items
      // already aligned with the new taxonomy (e.g. hatch3r-architect [planning],
      // CLI skills that don't carry the legacy `ai` category, support files
      // outside the inventory).
      //
      // Verify the existing tags are still admissible under the new taxonomy.
      // An artifact is admissible if it has >=1 capability tag OR >=1 floor tag
      // OR protected:true (matches resolveSelection's admission stages).
      const existingTags = fm.currentTags ?? [];
      const hasCap = existingTags.some((t) => CAPABILITY_TAGS.has(t));
      const hasFloor = existingTags.some((t) => FLOOR_TAGS.has(t));
      const isProtected = fm.protectedFlag;
      const cliCategoryHasAi = existingTags.includes("ai") && existingTags.includes("cli-tools");
      // CLI-tool skills with `cli-tools` tag are admitted via the customize-/cli-
      // path or via a non-capability route. They are intentionally outside the
      // capability gate — leave them alone if they don't carry the legacy `ai`
      // category (those are in the RETAG_MAP). Same for the `customize`-only
      // skills (admitted via includeCustomize). Same for hawk files (already
      // skipped). All other items must have cap | floor | protected.
      const isCustomizeOnly = existingTags.length === 1 && existingTags[0] === "customize";
      const isCliTool = existingTags.includes("cli-tools");

      if (!hasCap && !hasFloor && !isProtected && !isCustomizeOnly && !isCliTool) {
        results.push({
          relPath: file.relPath,
          type: file.config.typeLabel,
          id: key,
          oldTags: existingTags,
          newTags: existingTags,
          status: "warning-no-capability-or-floor",
          warning: "Existing tags lack capability + floor + protected; new filter will drop this artifact.",
        });
      } else {
        results.push({
          relPath: file.relPath,
          type: file.config.typeLabel,
          id: key,
          oldTags: existingTags,
          newTags: existingTags,
          status: "no-match-in-map",
        });
      }
      // Sanity warn for residual legacy tags that should never survive after
      // wave 2 (these would be RETAG_MAP misses).
      const LEGACY = ["core", "team", "solo", "greenfield", "brownfield", "security"];
      const legacyHits = existingTags.filter((t) => LEGACY.includes(t));
      if (legacyHits.length > 0 && !cliCategoryHasAi) {
        // CLI-tools skills use "core" as a recommendation level, not the
        // pipeline-protocol meaning — but our RETAG_MAP doesn't touch those.
        // Council D §4 explicitly says CLI-tool skills keep their tags
        // untouched aside from the ai→ai-cat rename. So a "core" in a CLI
        // skill is a CLI-recommendation marker (overview), not the legacy
        // pipeline tag. Leave it.
        const isCliRecCore = isCliTool && legacyHits.length === 1 && legacyHits[0] === "core";
        if (!isCliRecCore) {
          results[results.length - 1].warning =
            `Legacy tag(s) still present: ${legacyHits.join(", ")} — not in RETAG_MAP. Verify in council-D §4.`;
        }
      }
      continue;
    }

    // We have a new tag set to apply.
    if (!fm.tagsLine || fm.tagsLineOffset === undefined || fm.tagsLineLength === undefined) {
      // Shouldn't happen — every file in RETAG_MAP has a tags line. Surface as
      // a warning.
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: key,
        oldTags: [],
        newTags,
        status: "no-tags-line",
      });
      continue;
    }

    const oldTags = fm.currentTags ?? [];
    // Detect identical content (idempotent re-run).
    const same = oldTags.length === newTags.length
      && oldTags.every((t, i) => t === newTags[i]);
    if (same) {
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: key,
        oldTags,
        newTags,
        status: "unchanged-identical",
      });
      continue;
    }

    // Final admission check — would the new tags admit the artifact under the
    // new filter?
    const hasCap = newTags.some((t) => CAPABILITY_TAGS.has(t));
    const hasFloor = newTags.some((t) => FLOOR_TAGS.has(t));
    const isProtected = fm.protectedFlag;
    if (!hasCap && !hasFloor && !isProtected) {
      // We still apply the new tags (the source-of-truth retag table is what
      // it is) but emit a warning.
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: key,
        oldTags,
        newTags,
        status: "retagged",
        warning: "New tags lack capability + floor; admission requires `protected: true` (verified above) or includeIds carve-out.",
      });
    } else {
      results.push({
        relPath: file.relPath,
        type: file.config.typeLabel,
        id: key,
        oldTags,
        newTags,
        status: "retagged",
      });
    }

    // Apply the new tags line: splice replacement into the raw file content.
    const newLine = formatTagsLine(newTags, fm.tagsLine);
    const updated =
      raw.slice(0, fm.tagsLineOffset) +
      newLine +
      raw.slice(fm.tagsLineOffset + fm.tagsLineLength);
    await writeFile(file.filePath, updated, "utf-8");
  }

  // ── Report ───────────────────────────────────────────────────────
  const byStatus: Record<string, RetagResult[]> = {};
  for (const r of results) {
    (byStatus[r.status] ??= []).push(r);
  }

  console.log("=== Wave 2 retag report ===\n");
  console.log(`Total files scanned: ${results.length}\n`);

  // Per-type retagged counts
  const retagged = byStatus["retagged"] ?? [];
  const byType: Record<string, number> = {};
  for (const r of retagged) byType[r.type] = (byType[r.type] ?? 0) + 1;
  console.log("Retagged by type:");
  for (const [type, n] of Object.entries(byType).sort()) {
    console.log(`  ${type}: ${n}`);
  }
  console.log();

  // Detailed diff list (only retagged + warnings)
  console.log("Per-file diffs:");
  for (const r of retagged) {
    const oldStr = `[${r.oldTags.join(", ")}]`;
    const newStr = `[${r.newTags.join(", ")}]`;
    console.log(`  ${r.relPath}  ${r.id}  ${oldStr} → ${newStr}`);
    if (r.warning) console.log(`    WARNING: ${r.warning}`);
  }
  console.log();

  // Other status counts
  for (const status of ["unchanged-identical", "skipped-hawk", "no-match-in-map", "no-frontmatter", "no-tags-line", "missing-id", "warning-no-capability-or-floor"]) {
    const list = byStatus[status] ?? [];
    if (list.length === 0) continue;
    console.log(`Status "${status}" (${list.length}):`);
    for (const r of list) {
      const oldStr = `[${r.oldTags.join(", ")}]`;
      console.log(`  ${r.relPath}  ${r.id}  ${oldStr}${r.warning ? "  WARNING: " + r.warning : ""}`);
    }
    console.log();
  }

  // Final summary line
  const ret = byStatus["retagged"]?.length ?? 0;
  const skip = byStatus["skipped-hawk"]?.length ?? 0;
  const same = byStatus["unchanged-identical"]?.length ?? 0;
  const nomatch = byStatus["no-match-in-map"]?.length ?? 0;
  const warn = byStatus["warning-no-capability-or-floor"]?.length ?? 0;
  console.log(`SUMMARY: ${ret} retagged, ${same} unchanged-identical, ${skip} skipped (hawks), ${nomatch} not in map (left alone), ${warn} admissibility warnings`);
}

main().catch((err) => {
  console.error("wave2-retag failed:", err);
  process.exit(1);
});
