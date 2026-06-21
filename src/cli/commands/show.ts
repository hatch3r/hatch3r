/**
 * SA12.1-F-D12-M9 (Cycle 10 Wave 3, D12, P1): CLI inspection commands for
 * canonical content artifacts. Before this module, operators could not
 * inspect frontmatter, resolved scope (rule precedence + glob targeting),
 * customization overrides, or cross-references for a specific canonical
 * artifact without manually opening the bundled package and parsing the
 * `.md` file by hand.
 *
 * Two entry points:
 *   - `hatch3r show <id>`   — print frontmatter + resolved scope + first
 *                              ~40 lines of body for a single artifact.
 *   - `hatch3r list <type>` — enumerate every artifact of a given type
 *                              (agent | skill | rule | command | hook |
 *                              prompt | github-agent), one row per id with
 *                              precedence/tags.
 *
 * Pillar service: P1 (operator inspects canonical state from the CLI without
 * cracking open the bundled package), P5 (single source-of-truth read path —
 * delegates to `buildContentIndex` so the CLI mirrors what adapters see).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { buildContentIndex, resolveUserContentRoot, type CatalogItem } from "../../content/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { HatchError } from "../../types.js";
import { label, error as logError, info } from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";

/** W5: standardized flags shared by `show` and `list`. */
export interface ShowCommandOptions {
  /** `--format <human|json>`; json emits one envelope document on stdout. */
  format?: string;
  /** `--quiet`: suppress stdout chrome (banner, box, hints). */
  quiet?: boolean;
}

/** Frontmatter projection we surface to the operator — typed-safe subset. */
interface ResolvedFrontmatter {
  id?: string;
  type?: string;
  description?: string;
  tags?: string[];
  scope?: string;
  globs?: string;
  precedence?: "critical" | "high" | "normal" | "low";
  orchestrator?: boolean;
  agentPipeline?: string[];
  protected?: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const BODY_PREVIEW_LINES = 40;

/** Parse YAML frontmatter from a canonical file's raw text. Returns
 *  `{frontmatter, body}` with `frontmatter` defaulting to `{}` when absent.
 *  Surfaces YAML parse errors via stderr so the operator sees a malformed
 *  artifact instead of silently treating it as frontmatter-less. */
function parseFrontmatter(raw: string): { frontmatter: ResolvedFrontmatter; body: string } {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatter: {}, body: raw };
  try {
    const parsed = parseYaml(match[1]) as ResolvedFrontmatter | null;
    return { frontmatter: parsed ?? {}, body: match[2] };
  } catch (err) {
    // Silent Failure Contract (P5): surface the parse failure to stderr.
    // Body is still returned so the body-preview block can run.
    console.error(
      `  ${chalk.yellow("⚠")} show: YAML frontmatter parse failed — ${err instanceof Error ? err.message : String(err)}. Treating as frontmatter-less.`,
    );
    return { frontmatter: {}, body: match[2] };
  }
}

/**
 * `hatch3r show <id>` — print frontmatter + resolved scope + body preview
 * for a single canonical artifact. The id may include the `hatch3r-` prefix
 * (`hatch3r-implementer`) or omit it (`implementer`); the lookup tries both.
 * For commands, the `cmd-` prefix is also tried per `applyCommandPrefix`.
 */
export async function showCommand(
  idArg: string | undefined,
  opts: ShowCommandOptions = {},
): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  if (!idArg || typeof idArg !== "string") {
    logError("hatch3r show <id> requires an artifact id (e.g. `hatch3r show hatch3r-implementer`).");
    throw new HatchError(
      "Missing id argument",
      2,
      "VALIDATION_ERROR",
      "Pass an artifact id, e.g. `hatch3r show hatch3r-implementer` or `hatch3r show implementer`.",
    );
  }

  const rootDir = process.cwd();
  const canonicalRoot = resolveBundledContentRoot();
  const userRoot = resolveUserContentRoot(rootDir);
  const index = await buildContentIndex(canonicalRoot, userRoot ? { userRoot } : undefined);

  // Match by exact id, then by hatch3r-prefixed id, then by cmd- prefix.
  const candidates = [idArg, `hatch3r-${idArg}`, `cmd-${idArg}`, `cmd-hatch3r-${idArg}`];
  let item: CatalogItem | undefined;
  for (const cand of candidates) {
    const hit = index.byId.get(cand);
    if (hit) {
      item = hit;
      break;
    }
  }
  if (!item) {
    const sample = [...index.byId.keys()].slice(0, 6).join(", ");
    logError(`No canonical artifact found with id "${idArg}".`);
    info(`Try \`hatch3r list <type>\` to enumerate every artifact, or check the bundled content root.`);
    throw new HatchError(
      `Unknown artifact id: ${idArg}`,
      undefined,
      "CONFIG_ERROR",
      `Run \`hatch3r list <type>\` to see available ids (sample: ${sample}).`,
    );
  }

  // Locate the file on disk to read frontmatter + body. `relativePath` is
  // relative to the content root the item was scanned from (canonical or user).
  const fileRoot = item.source === "user" && userRoot ? userRoot : canonicalRoot;
  const filePath = join(fileRoot, item.relativePath);
  const raw = await readFile(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const headerLines: string[] = [
    label("Id", item.id),
    label("Type", item.type),
    label("Source", item.source),
    label("Path", item.relativePath),
    label("Description", item.description),
    label("Tags", item.tags.join(", ") || "(none)"),
  ];
  if (item.protected) headerLines.push(label("Protected", "true"));
  if (frontmatter.precedence) headerLines.push(label("Precedence", frontmatter.precedence));
  if (frontmatter.scope) headerLines.push(label("Scope", frontmatter.scope));
  if (frontmatter.globs) headerLines.push(label("Globs", frontmatter.globs));
  if (frontmatter.orchestrator !== undefined) {
    headerLines.push(label("Orchestrator", String(frontmatter.orchestrator)));
  }
  if (frontmatter.agentPipeline && frontmatter.agentPipeline.length > 0) {
    headerLines.push(label("Pipeline", frontmatter.agentPipeline.join(" → ")));
  }
  // W5: one chokepoint for both formats — human prints the same "Artifact:"
  // box as before; json emits a small envelope (frontmatter projection only,
  // no body preview) and returns.
  finishCommand(format, {
    command: "show",
    title: `Artifact: ${item.id}`,
    lines: headerLines,
    style: "info",
    json: {
      artifact: {
        id: item.id,
        type: item.type,
        source: item.source,
        path: item.relativePath,
        description: item.description,
        tags: item.tags,
        protected: item.protected ?? false,
        precedence: frontmatter.precedence ?? null,
        scope: frontmatter.scope ?? null,
        globs: frontmatter.globs ?? null,
        orchestrator: frontmatter.orchestrator ?? null,
        agentPipeline: frontmatter.agentPipeline ?? [],
        companionPath: item.companionPath ?? null,
      },
    },
  });
  if (format === "json") return;

  // Body preview: first N lines of the body, with a footer pointing the
  // operator at the source file when the body is truncated.
  const bodyLines = body.trimStart().split("\n");
  const preview = bodyLines.slice(0, BODY_PREVIEW_LINES);
  const truncated = bodyLines.length > BODY_PREVIEW_LINES;
  console.log();
  for (const line of preview) console.log(`  ${line}`);
  if (truncated) {
    console.log();
    console.log(
      chalk.dim(`  … ${bodyLines.length - BODY_PREVIEW_LINES} more line(s) — open ${filePath} for the full body.`),
    );
  }
  console.log();

  // Companion .mdc surface for rules (preserved by the canonical/companion
  // split in `buildContentIndex`).
  if (item.companionPath) {
    info(`Companion .mdc available at ${item.companionPath}`);
  }
}

/**
 * `hatch3r list <type>` — enumerate every artifact of the given type.
 * Accepted types: agent | skill | rule | command | hook | prompt |
 * github-agent. Aliases (plural forms) are normalized to the canonical
 * singular before lookup.
 */
const TYPE_ALIASES: Record<string, CatalogItem["type"]> = {
  agent: "agent",
  agents: "agent",
  skill: "skill",
  skills: "skill",
  rule: "rule",
  rules: "rule",
  command: "command",
  commands: "command",
  hook: "hook",
  hooks: "hook",
  prompt: "prompt",
  prompts: "prompt",
  "github-agent": "github-agent",
  "github-agents": "github-agent",
};

export async function listCommand(
  typeArg: string | undefined,
  opts: ShowCommandOptions = {},
): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  const normalized = typeof typeArg === "string" ? typeArg.trim().toLowerCase() : "";
  const type = TYPE_ALIASES[normalized];
  if (!type) {
    logError(`hatch3r list <type> requires one of: ${Object.keys(TYPE_ALIASES).filter((k) => !k.endsWith("s")).join(", ")}.`);
    throw new HatchError(
      `Unknown type: ${typeArg ?? "(none)"}`,
      2,
      "VALIDATION_ERROR",
      `Pass one of: agent, skill, rule, command, hook, prompt, github-agent (plurals accepted).`,
    );
  }

  const rootDir = process.cwd();
  const canonicalRoot = resolveBundledContentRoot();
  const userRoot = resolveUserContentRoot(rootDir);
  const index = await buildContentIndex(canonicalRoot, userRoot ? { userRoot } : undefined);
  const items = (index.byType[type] ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));

  // W5: json emits one envelope with the per-item projection and returns
  // (covers the empty case too — `items: []`).
  if (format === "json") {
    finishCommand(format, {
      command: "list",
      title: `${type} (${items.length})`,
      lines: [],
      style: "info",
      json: {
        type,
        count: items.length,
        items: items.map((i) => ({
          id: i.id,
          description: i.description,
          tags: i.tags,
          source: i.source,
          protected: i.protected ?? false,
        })),
      },
    });
    return;
  }

  if (items.length === 0) {
    info(`No artifacts of type "${type}" found.`);
    return;
  }

  console.log(chalk.bold(`${type} (${items.length}):`));
  for (const item of items) {
    const tagPreview = item.tags.slice(0, 3).join(", ") + (item.tags.length > 3 ? ` … (+${item.tags.length - 3})` : "");
    const protectedTag = item.protected ? chalk.red(" [protected]") : "";
    const sourceTag = item.source === "user" ? chalk.yellow(" [user]") : "";
    console.log(`  ${chalk.cyan("•")} ${chalk.bold(item.id)}${protectedTag}${sourceTag}  ${chalk.dim(tagPreview)}`);
  }
  console.log();
  info(`Run \`hatch3r show <id>\` to inspect frontmatter + body preview.`);
}
