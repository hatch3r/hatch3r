/**
 * SA12.1-F-D12-M13 (Cycle 10 Wave 3, D12, P1): `hatch3r deps <id>` —
 * surface orchestration dependencies declared in a canonical artifact's
 * frontmatter (commands' `agentPipeline`, agents' `delegates` list) plus
 * the inverse "what depends on me?" view. Before this command,
 * orchestration dependencies were validated at build time
 * (`validateOrchestrationDependencies` in `src/content/index.ts`) but never
 * surfaced — operators had to grep canonical content by hand.
 *
 * D12-10 (Cycle 11 Wave 3, D12, P1): the frontmatter view only captures
 * agent->agent orchestration edges. Skills, rules, and MCP servers are
 * referenced in body prose, so the command also runs a best-effort,
 * non-authoritative `scanBodyReferences` pass over the artifact body and
 * prints those references in a separate clearly-labelled section — replacing
 * the misleading "(none declared)" empty state for prose-heavy agents.
 *
 * D12-SA12.4-03 (Cycle 12 Wave 4, D12, CQ2): MCP references in that scan are
 * now confirmed against the bundled `mcp/mcp.json` registry and split into a
 * registry-confirmed tier (carrying the registry `_disabled` flag) and a
 * remaining advisory tier — the same referential-integrity gate the skill/rule
 * facet already receives via the content index (`knownIds`). Previously every
 * MCP name was surfaced pattern-only, so a typo'd or removed server ("Context8
 * MCP") was indistinguishable from a real one.
 *
 * Pillar service: P1 (CLI affordance for orchestration topology),
 * P5 (delegates to `buildContentIndex` + frontmatter parser; no separate
 * dependency graph to drift out of sync).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { buildContentIndex, resolveUserContentRoot, resolveArtifactFilePath, type CatalogItem } from "../../content/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { HatchError } from "../../types.js";
import { printBox, label, error as logError, info } from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";

/** W5: standardized flags for `hatch3r deps <id>`. */
export interface DepsCommandOptions {
  /** `--format <human|json>`; json emits one `{id, declared, prose}` envelope. */
  format?: string;
  /** `--quiet`: suppress stdout chrome (banner, box, hints). */
  quiet?: boolean;
}

interface DepsFrontmatter {
  id?: string;
  type?: string;
  orchestrator?: boolean;
  agentPipeline?: string[];
  /** Some agents (e.g. orchestrator-mode) declare downstream delegations. */
  delegates?: string[];
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string, sourcePath?: string): DepsFrontmatter {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) return {};
  try {
    return (parseYaml(match[1]) as DepsFrontmatter | null) ?? {};
  } catch (err) {
    // Silent Failure Contract (P5): surface the parse failure to stderr so
    // the operator sees that one of the scanned artifacts has bad frontmatter
    // (would otherwise silently disappear from the upstream search).
    console.error(
      `  ${chalk.yellow("⚠")} deps: YAML frontmatter parse failed${sourcePath ? ` in ${sourcePath}` : ""} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

/** Strip the YAML frontmatter block so the body scan never reports an id that
 * only appears in `agentPipeline`/`delegates` (those are the authoritative
 * downstream list, not prose references). */
function stripFrontmatter(raw: string): string {
  const match = raw.match(FRONTMATTER_REGEX);
  return match ? match[2] : raw;
}

/**
 * A prose-derived MCP server reference (D12-SA12.4-03). `confirmed` is true when
 * the normalized name matched a key in the bundled `mcp/mcp.json` registry;
 * `disabled` mirrors that entry's `_disabled: true` flag and is meaningful only
 * when `confirmed`.
 */
export interface McpServerRef {
  name: string;
  confirmed: boolean;
  disabled: boolean;
}

/**
 * Normalize an MCP server name for registry lookup: lowercase and fold the
 * tool-id underscore form onto the registry's hyphen form (`brave_search` →
 * `brave-search`), so both the `mcp__<server>__` and "<Name> MCP" surface forms
 * resolve to the same `mcp/mcp.json` key.
 */
function normalizeMcpName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

/**
 * D12-SA12.4-03 (Cycle 12 Wave 4, D12, CQ2): load the bundled MCP registry
 * (`mcp/mcp.json`) into a normalized lookup so `scanBodyReferences` can confirm
 * prose-derived MCP names against the authoritative server list — the same
 * referential-integrity gate skill/rule ids already receive via the content
 * index. A read/parse failure degrades to an empty map: every MCP reference
 * then falls back to the advisory tier (the pre-D12-SA12.4-03 behavior), never a
 * hard failure of this informational command.
 */
async function loadKnownMcpServers(
  canonicalRoot: string,
): Promise<Map<string, { disabled: boolean }>> {
  const known = new Map<string, { disabled: boolean }>();
  const registryPath = join(canonicalRoot, "mcp", "mcp.json");
  let raw: string;
  try {
    raw = await readFile(registryPath, "utf-8");
  } catch (err) {
    // Silent Failure Contract (P5): a broken/missing registry must be visible,
    // not silently degrade every MCP reference to advisory without explanation.
    console.error(
      `  ${chalk.dim("ℹ")} deps: MCP registry ${registryPath} unreadable (${(err as NodeJS.ErrnoException).code ?? "UNKNOWN"}) — MCP references left advisory`,
    );
    return known;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(
      `  ${chalk.dim("ℹ")} deps: MCP registry ${registryPath} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — MCP references left advisory`,
    );
    return known;
  }
  const rawServers = parsed.mcpServers;
  if (!rawServers || typeof rawServers !== "object") return known;
  for (const [key, val] of Object.entries(rawServers as Record<string, unknown>)) {
    const disabled =
      typeof val === "object" &&
      val !== null &&
      (val as Record<string, unknown>)._disabled === true;
    known.set(normalizeMcpName(key), { disabled });
  }
  return known;
}

/**
 * D12-10 (Cycle 11 Wave 3, D12, P1): the authoritative downstream list is
 * frontmatter-only (`agentPipeline`/`delegates`). Agents routinely reference
 * skills, rules, and MCP servers in prose that the frontmatter never declares,
 * so a bare "(none declared in frontmatter)" misleads the operator. This
 * best-effort scan surfaces those prose references, labelled non-authoritative.
 *
 * Skill/rule ids are confirmed against the content index (`knownIds`) so an
 * arbitrary `skills/foo` mention that is not a real artifact never appears —
 * zero false positives on the id facet. MCP server names are pattern-derived,
 * then confirmed against the bundled `mcp/mcp.json` registry (`knownMcpServers`)
 * and split into a registry-confirmed tier (with the registry `_disabled` flag)
 * and a remaining advisory (unmatched) tier — D12-SA12.4-03.
 *
 * Exported for direct unit testing of the reference-confirmation logic
 * (tool-id vs display forms, normalization, confirmed/advisory/disabled tiers).
 */
export function scanBodyReferences(
  body: string,
  selfId: string,
  knownIds: ReadonlySet<string>,
  knownMcpServers: ReadonlyMap<string, { disabled: boolean }>,
): { skills: string[]; rules: string[]; mcpServers: McpServerRef[] } {
  const skills = new Set<string>();
  const rules = new Set<string>();

  // Match `skills/<id>` and `rules/<id>` path references (backtick path,
  // markdown link, or bare); the leading class segment disambiguates type.
  const pathRefs = body.matchAll(/\b(skills|rules)\/(hatch3r-[a-z0-9-]+)/g);
  for (const m of pathRefs) {
    const cls = m[1];
    const id = m[2];
    if (id === selfId || !knownIds.has(id)) continue;
    (cls === "skills" ? skills : rules).add(id);
  }

  // MCP server names: two recognizable forms appear in canonical prose — tool
  // ids (`mcp__<server>__<tool>`) and the "<Name> MCP" shorthand (e.g.
  // "Context7 MCP"). Normalize (lowercase, `_`→`-`) for the dedup key so both
  // forms collapse onto the registry key, but keep the first-seen surface form
  // for display.
  const mcpSurface = new Map<string, string>();
  for (const m of body.matchAll(/\bmcp__([a-z0-9_]+?)__/gi)) {
    const key = normalizeMcpName(m[1]);
    if (!mcpSurface.has(key)) mcpSurface.set(key, m[1]);
  }
  for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9]+)\s+MCP\b/g)) {
    const key = normalizeMcpName(m[1]);
    if (!mcpSurface.has(key)) mcpSurface.set(key, m[1]);
  }

  // D12-SA12.4-03: confirm each extracted name against the bundled registry —
  // the same referential-integrity gate the skill/rule facet applies via
  // `knownIds`. Confirmed names carry the registry `_disabled` flag; unmatched
  // names stay in the advisory tier.
  const mcpServers: McpServerRef[] = [...mcpSurface.entries()]
    .map(([key, surface]) => {
      const entry = knownMcpServers.get(key);
      return {
        name: surface,
        confirmed: entry !== undefined,
        disabled: entry?.disabled ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    skills: [...skills].sort(),
    rules: [...rules].sort(),
    mcpServers,
  };
}

export async function depsCommand(
  idArg: string | undefined,
  opts: DepsCommandOptions = {},
): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  if (!idArg || typeof idArg !== "string") {
    logError("hatch3r deps <id> requires an artifact id (e.g. `hatch3r deps hatch3r-quick-change`).");
    throw new HatchError(
      "Missing id argument",
      2,
      "VALIDATION_ERROR",
      "Pass a canonical artifact id, e.g. `hatch3r deps hatch3r-quick-change`.",
    );
  }

  const rootDir = process.cwd();
  const canonicalRoot = resolveBundledContentRoot();
  const userRoot = resolveUserContentRoot(rootDir);
  const index = await buildContentIndex(canonicalRoot, userRoot ? { userRoot } : undefined);

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
    logError(`No canonical artifact found with id "${idArg}".`);
    info(`Try \`hatch3r list <type>\` to enumerate every artifact.`);
    throw new HatchError(
      `Unknown artifact id: ${idArg}`,
      undefined,
      "CONFIG_ERROR",
      `Run \`hatch3r list <type>\` to see available ids.`,
    );
  }

  // Read this artifact's frontmatter to surface declared dependencies.
  // D1-SA1.7-01: shared skill-path resolution (skill = <dir>/SKILL.md).
  const fileRoot = item.source === "user" && userRoot ? userRoot : canonicalRoot;
  const filePath = resolveArtifactFilePath(fileRoot, item);
  let frontmatter: DepsFrontmatter = {};
  let body = "";
  try {
    const raw = await readFile(filePath, "utf-8");
    frontmatter = parseFrontmatter(raw);
    body = stripFrontmatter(raw);
  } catch (err) {
    logError(`Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    throw new HatchError(
      `Could not read ${filePath}`,
      undefined,
      "FS_ERROR",
      "Re-run `hatch3r sync` to regenerate; if the file is missing from the bundled package, reinstall hatch3r.",
    );
  }

  const downstream: { id: string; resolved: boolean }[] = [];
  const sources: string[] = [];
  for (const dep of frontmatter.agentPipeline ?? []) {
    downstream.push({ id: dep, resolved: index.byId.has(dep) });
    sources.push("agentPipeline");
  }
  for (const dep of frontmatter.delegates ?? []) {
    downstream.push({ id: dep, resolved: index.byId.has(dep) });
    sources.push("delegates");
  }

  // Inverse view: who declares THIS artifact in their agentPipeline /
  // delegates list?
  const upstream: { id: string; type: string; via: string }[] = [];
  for (const candidate of index.items) {
    if (candidate.id === item.id) continue;
    const candFileRoot = candidate.source === "user" && userRoot ? userRoot : canonicalRoot;
    const candPath = resolveArtifactFilePath(candFileRoot, candidate);
    try {
      const candRaw = await readFile(candPath, "utf-8");
      const candFm = parseFrontmatter(candRaw, candidate.relativePath);
      if ((candFm.agentPipeline ?? []).includes(item.id)) {
        upstream.push({ id: candidate.id, type: candidate.type, via: "agentPipeline" });
      }
      if ((candFm.delegates ?? []).includes(item.id)) {
        upstream.push({ id: candidate.id, type: candidate.type, via: "delegates" });
      }
    } catch (err) {
      // Silent Failure Contract (P5): surface unreadable candidates to stderr
      // so a missing/permission-blocked artifact is visible (otherwise its
      // potential upstream contribution would silently disappear).
      const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
      console.error(
        `  ${chalk.dim("ℹ")} deps: skipping ${candidate.relativePath} (${code}) — cannot scan upstream references`,
      );
    }
  }

  // D12-10: best-effort prose scan, computed before rendering so both the
  // human view and the W5 json envelope share one data pass. The frontmatter
  // block is the only authoritative downstream declaration; skills, rules,
  // and MCP servers are referenced in prose and would otherwise be invisible.
  // Skill/rule ids are index-confirmed; MCP names are pattern-derived, then
  // registry-confirmed against mcp/mcp.json (D12-SA12.4-03) into confirmed +
  // advisory tiers.
  const knownSkillRuleIds = new Set<string>([
    ...(index.byType.skill ?? []).map((c) => c.id),
    ...(index.byType.rule ?? []).map((c) => c.id),
  ]);
  const knownMcpServers = await loadKnownMcpServers(canonicalRoot);
  const refs = scanBodyReferences(body, item.id, knownSkillRuleIds, knownMcpServers);

  // W5: json mode emits one `{id, declared, prose}` envelope mirroring the
  // human sections (declared = frontmatter downstream/upstream; prose = the
  // best-effort body scan) and returns.
  if (format === "json") {
    finishCommand(format, {
      command: "deps",
      title: `Dependencies: ${item.id}`,
      lines: [],
      style: "info",
      json: {
        id: item.id,
        type: item.type,
        orchestrator: frontmatter.orchestrator ?? null,
        declared: {
          downstream: downstream.map((d, i) => ({
            id: d.id,
            via: sources[i],
            resolved: d.resolved,
          })),
          upstream,
        },
        prose: refs,
      },
    });
    return;
  }

  const headerLines = [
    label("Id", item.id),
    label("Type", item.type),
    label("Source", item.source),
  ];
  if (frontmatter.orchestrator !== undefined) {
    headerLines.push(label("Orchestrator", String(frontmatter.orchestrator)));
  }
  printBox(`Dependencies: ${item.id}`, headerLines, "info");

  console.log(chalk.bold("Downstream (this artifact delegates to, from frontmatter):"));
  if (downstream.length === 0) {
    console.log(chalk.dim("  (no agentPipeline / delegates entries in frontmatter)"));
  } else {
    for (let i = 0; i < downstream.length; i++) {
      const { id, resolved } = downstream[i];
      const status = resolved ? chalk.green("✓") : chalk.red("✗");
      const tag = resolved ? "" : chalk.red(" [not in content index]");
      console.log(`  ${status} ${id}${tag} ${chalk.dim(`(${sources[i]})`)}`);
    }
  }
  console.log();

  const refCount = refs.skills.length + refs.rules.length + refs.mcpServers.length;
  console.log(
    chalk.bold("References (best-effort, prose-derived — not authoritative):"),
  );
  if (refCount === 0) {
    console.log(chalk.dim("  (no skill / rule / MCP references found in body prose)"));
  } else {
    for (const id of refs.skills) {
      console.log(`  ${chalk.cyan("•")} ${id} ${chalk.dim("(skill)")}`);
    }
    for (const id of refs.rules) {
      console.log(`  ${chalk.cyan("•")} ${id} ${chalk.dim("(rule)")}`);
    }
    // D12-SA12.4-03: registry-confirmed tier first, then the advisory tier —
    // mirroring the separate skill/rule groups above.
    for (const ref of refs.mcpServers.filter((r) => r.confirmed)) {
      const disabledTag = ref.disabled
        ? chalk.yellow(" [referenced but disabled]")
        : "";
      console.log(
        `  ${chalk.cyan("•")} ${ref.name}${disabledTag} ${chalk.dim("(MCP server, registry-confirmed)")}`,
      );
    }
    for (const ref of refs.mcpServers.filter((r) => !r.confirmed)) {
      console.log(
        `  ${chalk.cyan("•")} ${ref.name} ${chalk.dim("(MCP server, advisory — not in mcp/mcp.json)")}`,
      );
    }
  }
  console.log();

  console.log(chalk.bold("Upstream (these artifacts delegate to this one):"));
  if (upstream.length === 0) {
    console.log(chalk.dim("  (no artifacts reference this one in their agentPipeline / delegates)"));
  } else {
    for (const u of upstream) {
      console.log(`  ${chalk.cyan("•")} ${u.id} ${chalk.dim(`(${u.type}, via ${u.via})`)}`);
    }
  }
  console.log();
}
