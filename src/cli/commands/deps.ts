/**
 * SA12.1-F-D12-M13 (Cycle 10 Wave 3, D12, P1): `hatch3r deps <id>` —
 * surface orchestration dependencies declared in a canonical artifact's
 * frontmatter (commands' `agentPipeline`, agents' `delegates` list) plus
 * the inverse "what depends on me?" view. Before this command,
 * orchestration dependencies were validated at build time
 * (`validateOrchestrationDependencies` in `src/content/index.ts`) but never
 * surfaced — operators had to grep canonical content by hand.
 *
 * Pillar service: P1 (CLI affordance for orchestration topology),
 * P5 (delegates to `buildContentIndex` + frontmatter parser; no separate
 * dependency graph to drift out of sync).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { buildContentIndex, resolveUserContentRoot, type CatalogItem } from "../../content/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { HatchError } from "../../types.js";
import { printBanner, printBox, label, error as logError, info } from "../shared/ui.js";

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

export async function depsCommand(idArg: string | undefined): Promise<void> {
  printBanner(true);
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
  const fileRoot = item.source === "user" && userRoot ? userRoot : canonicalRoot;
  const filePath =
    item.type === "skill"
      ? join(fileRoot, item.relativePath, "SKILL.md")
      : join(fileRoot, item.relativePath);
  let frontmatter: DepsFrontmatter = {};
  try {
    const raw = await readFile(filePath, "utf-8");
    frontmatter = parseFrontmatter(raw);
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
    const candPath =
      candidate.type === "skill"
        ? join(candFileRoot, candidate.relativePath, "SKILL.md")
        : join(candFileRoot, candidate.relativePath);
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

  const headerLines = [
    label("Id", item.id),
    label("Type", item.type),
    label("Source", item.source),
  ];
  if (frontmatter.orchestrator !== undefined) {
    headerLines.push(label("Orchestrator", String(frontmatter.orchestrator)));
  }
  printBox(`Dependencies: ${item.id}`, headerLines, "info");

  console.log(chalk.bold("Downstream (this artifact delegates to):"));
  if (downstream.length === 0) {
    console.log(chalk.dim("  (none declared in frontmatter)"));
  } else {
    for (let i = 0; i < downstream.length; i++) {
      const { id, resolved } = downstream[i];
      const status = resolved ? chalk.green("✓") : chalk.red("✗");
      const tag = resolved ? "" : chalk.red(" [not in content index]");
      console.log(`  ${status} ${id}${tag} ${chalk.dim(`(${sources[i]})`)}`);
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
