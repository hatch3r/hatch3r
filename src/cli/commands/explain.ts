// C9-H13 (D6-SA6.3-F1): `hatch3r explain --cost <command>` surfaces the
// triage-first cost model declared in canonical command frontmatter. The
// `estimateUsdCost` helper from `src/pipeline/costEstimator.ts` (the canonical
// cost module per Decision 24; F3.4-F2 merged the former observability copy
// into it) produces per-token USD figures; this command wires it to the
// `triage_tiers` array so users can answer "what will this command cost at each
// triage tier?" without running the command.
//
// Cost model (deterministic, character-heuristic based — no provider lookup):
//   tier 1 (trivial / single-agent):  1 sub-agent invocation
//   tier 2 (standard pipeline):       length(agentPipeline) sub-agent invocations
//   tier 3 (research-first):          length(agentPipeline) + 1 (research mode)
//
// Per-invocation token estimate uses CHARS_PER_TOKEN against the command body
// (the body is the static prompt frame that ships to each sub-agent). Output
// tokens are estimated as one-quarter of input — a conservative ratio that
// matches typical plan/act split ratios documented in
// `agents/shared/efficiency-patterns.md` P5.
//
// SA12.3-F03 (Cycle 10 Wave 2): `hatch3r explain --customizations` surfaces
// the per-artifact customization-applied state (yaml + md overrides, skips,
// fail-closed drops) that previously stayed silent under the Silent Failure
// Contract. The mode shares no logic with `--cost`; it dry-calls
// `applyCustomization` across the bundled content root and renders the
// result via `buildCustomizationSummary` (`src/adapters/customizationSummary.ts`).

import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import {
  CHARS_PER_TOKEN,
  estimateTokens,
  type PipelineTokenSummary,
} from "../../pipeline/observability.js";
// F3.4-F2 (Cycle 10 Wave 2): cost computation comes from the canonical cost
// module (Decision 24), not the observability shadow copy. estimateUsdCost +
// the DEFAULT_* rate constants are the single source of truth for token→USD.
import {
  DEFAULT_INPUT_COST_PER_1M,
  DEFAULT_OUTPUT_COST_PER_1M,
  estimateUsdCost,
} from "../../pipeline/costEstimator.js";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { findPackageRoot } from "../shared/paths.js";
import { printBanner, printBox, label, info, error as logError, setVerbose } from "../shared/ui.js";
import {
  buildCustomizationSummary,
  type CustomizationStatus,
} from "../../adapters/customizationSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parsed view of a command file's efficiency-relevant frontmatter fields.
 * Only the four fields needed for cost computation are typed — everything
 * else (description, tags, etc.) is ignored here.
 */
interface CommandFrontmatter {
  id: string;
  orchestrator: boolean;
  agentPipeline: string[];
  triageTiers: number[];
}

/**
 * Per-tier cost row in the output. Each row reports the sub-agent count, the
 * estimated token spend (input + output), and the USD cost for a single
 * invocation at that tier.
 */
interface TierCostRow {
  tier: number;
  label: string;
  subAgents: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usd: number;
}

/**
 * Resolve a user-supplied command id to an on-disk `.md` path. The lookup
 * order matches the canonical-vs-installed split that the rest of the CLI
 * uses: prefer `.agents/commands/` inside the user's repo (the installed
 * copy), fall back to the canonical `commands/` directory bundled with the
 * hatch3r package (dev-mode / framework-development).
 *
 * The id is normalized to allow either `hatch3r-quick-change` or
 * `quick-change`; both map to `commands/hatch3r-quick-change.md`.
 */
async function resolveCommandPath(rootDir: string, commandId: string): Promise<string> {
  const normalized = commandId.startsWith("hatch3r-")
    ? commandId
    : `hatch3r-${commandId}`;
  const filename = `${normalized}.md`;

  const candidates = [
    // Wave 7: legacy `.agents/commands/` probe for pre-1.9 installs that
    // still ship a project-side canonical tree. New installs resolve via
    // the bundled package root (second candidate).
    join(rootDir, ".agents", "commands", filename),
    join(findPackageRoot(__dirname), "commands", filename),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  throw new HatchError(
    `Command not found: ${commandId}. Looked in ${candidates.join(" and ")}.`,
    1,
    "FS_ERROR",
    "Run `hatch3r explain --cost <id>` with a known command id (e.g. hatch3r-quick-change), or check the `commands/` directory for the exact filename.",
  );
}

/**
 * Parse the YAML frontmatter from a command file and extract the four fields
 * needed for cost computation. Throws when the file lacks a frontmatter
 * block or when `orchestrator: true` is declared without `triage_tiers`.
 */
function parseCommandFrontmatter(raw: string, filePath: string): CommandFrontmatter {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new HatchError(
      `Missing frontmatter in ${filePath}. Cost estimation requires id + orchestrator + triage_tiers.`,
      1,
      "VALIDATION_ERROR",
      "Add a YAML frontmatter block with `id`, `orchestrator`, and `triage_tiers` to the command file, then re-run.",
    );
  }

  const [, frontmatterStr] = match;
  const parsed = parseYaml(frontmatterStr ?? "") as Record<string, unknown> | null;

  if (!parsed || typeof parsed !== "object") {
    throw new HatchError(
      `Invalid frontmatter in ${filePath}: expected YAML object.`,
      1,
      "VALIDATION_ERROR",
      "Fix the frontmatter so it parses to a YAML mapping (key: value pairs between the `---` fences), then re-run.",
    );
  }

  const id = typeof parsed.id === "string" ? parsed.id : "";
  const orchestrator = typeof parsed.orchestrator === "boolean" ? parsed.orchestrator : false;

  const agentPipelineRaw = parsed.agentPipeline;
  const agentPipeline = Array.isArray(agentPipelineRaw)
    ? agentPipelineRaw.filter((a: unknown): a is string => typeof a === "string")
    : [];

  const triageRaw = parsed.triage_tiers;
  const triageTiers = Array.isArray(triageRaw)
    ? triageRaw.filter((n: unknown): n is number => Number.isInteger(n) && (n === 1 || n === 2 || n === 3))
    : [];

  if (orchestrator && triageTiers.length === 0) {
    throw new HatchError(
      `${id || filePath} is declared orchestrator: true but has no triage_tiers — cost cannot be split per tier.`,
      1,
      "VALIDATION_ERROR",
      "Add a `triage_tiers` array (e.g. [1, 2, 3]) to the command frontmatter, or set `orchestrator: false` if it does not fan out.",
    );
  }

  return { id, orchestrator, agentPipeline, triageTiers };
}

/**
 * Triage-tier sub-agent fan-out model. The numbers come from the tier
 * definitions in `agents/shared/efficiency-patterns.md` P3 (triage-first
 * orchestration) and the audit-execute tier classifier in
 * `governance/AUDIT-EXECUTE.md`:
 *
 *   Tier 1 — trivial / single-agent path (1 invocation)
 *   Tier 2 — standard pipeline (one per pipeline stage)
 *   Tier 3 — research-first (standard pipeline + 1 researcher mode)
 */
function subAgentCountForTier(tier: number, pipelineLength: number): number {
  switch (tier) {
    case 1:
      return 1;
    case 2:
      return Math.max(1, pipelineLength);
    case 3:
      return Math.max(1, pipelineLength) + 1;
    default:
      return Math.max(1, pipelineLength);
  }
}

function tierLabel(tier: number): string {
  switch (tier) {
    case 1:
      return "Tier 1 (trivial)";
    case 2:
      return "Tier 2 (standard)";
    case 3:
      return "Tier 3 (research-first)";
    default:
      return `Tier ${tier}`;
  }
}

/**
 * Compute per-tier cost rows for the command. Each row models one full
 * invocation of the command at that tier. Token estimates use the body
 * char-count as the static input frame (same context fans out to every
 * sub-agent) and a 0.25 input-to-output ratio for the response.
 */
function computeTierRows(
  fm: CommandFrontmatter,
  bodyCharCount: number,
  options: { inputCostPer1M: number; outputCostPer1M: number },
): TierCostRow[] {
  const perInvocationInputTokens = estimateTokens(bodyCharCount, CHARS_PER_TOKEN);
  const perInvocationOutputTokens = Math.ceil(perInvocationInputTokens / 4);

  const rows: TierCostRow[] = [];
  for (const tier of fm.triageTiers) {
    const subAgents = subAgentCountForTier(tier, fm.agentPipeline.length);
    const inputTokens = perInvocationInputTokens * subAgents;
    const outputTokens = perInvocationOutputTokens * subAgents;
    // Build a one-phase summary so we go through the canonical estimateCost
    // path (instead of duplicating its multiplication / threshold logic).
    // PhaseName is a closed enum in src/pipeline/phaseTimeout.ts; "generation"
    // is the closest semantic match for sub-agent fan-out work.
    const summary: PipelineTokenSummary = {
      phases: [
        {
          phase: "generation",
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      ],
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      grandTotal: inputTokens + outputTokens,
    };
    const cost = estimateUsdCost(summary, {
      inputCostPer1M: options.inputCostPer1M,
      outputCostPer1M: options.outputCostPer1M,
    });
    rows.push({
      tier,
      label: tierLabel(tier),
      subAgents,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      usd: cost.totalCost,
    });
  }
  return rows;
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

interface ExplainOptions {
  cost?: string;
  customizations?: boolean;
  /**
   * SA12.4-F1 (D12): output path (relative to the repo root, e.g.
   * `CLAUDE.md` or `.cursor/rules/hatch3r-bridge.mdc`) whose canonical
   * provenance should be printed. Reads `.hatch3r/provenance.json`
   * written by `hatch3r sync`. The empty string form (`--source` with no
   * value, or `--source all`) lists every recorded output.
   */
  source?: string;
  verbose?: boolean;
  inputRate?: string;
  outputRate?: string;
}

/**
 * `hatch3r explain` entry point. Dispatches to one of three modes:
 *   - `--cost <command-id>`     → per-tier sub-agent fan-out + USD cost table
 *   - `--customizations`        → per-artifact customize.{yaml,md} state table
 *   - `--source <output-path>`  → canonical source files behind a generated file
 *
 * The three modes are mutually exclusive; passing more than one or none is
 * a usage error (exit code 2). The mode selector is checked before any I/O
 * so a missing flag returns immediately with an actionable message.
 */
export async function explainCommand(opts?: ExplainOptions): Promise<void> {
  setVerbose(!!opts?.verbose);
  printBanner(true);

  const costRequested = typeof opts?.cost === "string" && opts.cost.trim().length > 0;
  const customizationsRequested = !!opts?.customizations;
  // `--source` is mode-active whenever the flag is present, including the
  // valueless / `all` form (commander stores `true` when the option takes
  // an optional value and none is supplied). Normalize to a string subject.
  const sourceRequested = opts?.source !== undefined;
  const modesRequested = [costRequested, customizationsRequested, sourceRequested].filter(Boolean).length;

  if (modesRequested > 1) {
    logError("Conflicting flags: --cost, --customizations, and --source are mutually exclusive.");
    console.log(chalk.dim("  Pick one mode per invocation."));
    console.log();
    throw new HatchError(
      "Conflicting flags: --cost, --customizations, --source",
      2,
      "VALIDATION_ERROR",
      "Pass exactly one mode flag per invocation: `--cost <id>`, `--customizations`, or `--source <output-path>`.",
    );
  }

  if (modesRequested === 0) {
    logError("Missing required mode flag: pass --cost <command-id>, --customizations, OR --source <output-path>.");
    console.log(chalk.dim("  Example: hatch3r explain --cost hatch3r-quick-change"));
    console.log(chalk.dim("  Example: hatch3r explain --customizations"));
    console.log(chalk.dim("  Example: hatch3r explain --source CLAUDE.md"));
    console.log();
    throw new HatchError(
      "Missing required mode flag: --cost, --customizations, or --source",
      2,
      "VALIDATION_ERROR",
      "Pass one of: `--cost <id>`, `--customizations`, or `--source <output-path>` (run `hatch3r --help` for usage).",
    );
  }

  if (customizationsRequested) {
    await explainCustomizationsMode();
    return;
  }

  if (sourceRequested) {
    await explainSourceMode(opts!.source);
    return;
  }

  const commandId = opts!.cost!.trim();

  const rootDir = process.cwd();
  const commandPath = await resolveCommandPath(rootDir, commandId);
  const raw = await readFile(commandPath, "utf-8");
  const fm = parseCommandFrontmatter(raw, commandPath);

  // The body (everything after the frontmatter) is the static input frame
  // that every sub-agent invocation will receive. Cost scales linearly with
  // sub-agent count under the static-first prompt model (CONSTITUTION P7).
  const bodyMatch = raw.match(FRONTMATTER_REGEX);
  const body = bodyMatch?.[2] ?? raw;
  const bodyCharCount = body.length;

  const inputRate = opts?.inputRate ? Number(opts.inputRate) : DEFAULT_INPUT_COST_PER_1M;
  const outputRate = opts?.outputRate ? Number(opts.outputRate) : DEFAULT_OUTPUT_COST_PER_1M;

  if (!Number.isFinite(inputRate) || inputRate < 0) {
    throw new HatchError(
      `Invalid --input-rate: ${opts?.inputRate} (expected non-negative number USD per 1M tokens)`,
      2,
      "VALIDATION_ERROR",
      "Pass --input-rate as a non-negative number, e.g. `--input-rate 3.0` for $3/1M input tokens.",
    );
  }
  if (!Number.isFinite(outputRate) || outputRate < 0) {
    throw new HatchError(
      `Invalid --output-rate: ${opts?.outputRate} (expected non-negative number USD per 1M tokens)`,
      2,
      "VALIDATION_ERROR",
      "Pass --output-rate as a non-negative number, e.g. `--output-rate 15.0` for $15/1M output tokens.",
    );
  }

  const rows = computeTierRows(fm, bodyCharCount, {
    inputCostPer1M: inputRate,
    outputCostPer1M: outputRate,
  });

  const headerLines: string[] = [
    label("Command", fm.id || commandId),
    label("Path", commandPath),
    label("Orchestrator", fm.orchestrator ? "true" : "false"),
    label("Pipeline", fm.agentPipeline.length > 0 ? `${fm.agentPipeline.length} sub-agent(s)` : "(inline)"),
    label("Tiers", fm.triageTiers.length > 0 ? fm.triageTiers.join(", ") : "(none)"),
    label("Body size", `${formatTokens(bodyCharCount)} chars (~${formatTokens(estimateTokens(bodyCharCount, CHARS_PER_TOKEN))} tokens)`),
  ];

  printBox("Command", headerLines, "info");

  // Per-tier cost table. Each row reports a single full invocation at that
  // tier; the column widths are static so the box renders the same on every
  // terminal width.
  const tableLines: string[] = [];
  const COL_LABEL = 24;
  const COL_AGENTS = 12;
  const COL_TOKENS = 11;
  const COL_USD = 10;
  tableLines.push(
    `${"Tier".padEnd(COL_LABEL)}${"Sub-agents".padEnd(COL_AGENTS)}` +
      `${"Input".padEnd(COL_TOKENS)}${"Output".padEnd(COL_TOKENS)}${"Total".padEnd(COL_TOKENS)}${"USD".padEnd(COL_USD)}`,
  );
  const tableWidth = COL_LABEL + COL_AGENTS + COL_TOKENS * 3 + COL_USD;
  tableLines.push(chalk.dim("─".repeat(tableWidth)));
  let totalTokens = 0;
  let totalUsd = 0;
  for (const row of rows) {
    tableLines.push(
      `${row.label.padEnd(COL_LABEL)}` +
        `${String(row.subAgents).padEnd(COL_AGENTS)}` +
        `${formatTokens(row.inputTokens).padEnd(COL_TOKENS)}` +
        `${formatTokens(row.outputTokens).padEnd(COL_TOKENS)}` +
        `${formatTokens(row.totalTokens).padEnd(COL_TOKENS)}` +
        `${formatUsd(row.usd).padEnd(COL_USD)}`,
    );
    totalTokens += row.totalTokens;
    totalUsd += row.usd;
  }
  tableLines.push(chalk.dim("─".repeat(tableWidth)));
  tableLines.push(
    `${"All tiers (sum)".padEnd(COL_LABEL)}` +
      `${"—".padEnd(COL_AGENTS)}` +
      `${"".padEnd(COL_TOKENS)}` +
      `${"".padEnd(COL_TOKENS)}` +
      `${formatTokens(totalTokens).padEnd(COL_TOKENS)}` +
      `${formatUsd(totalUsd).padEnd(COL_USD)}`,
  );

  printBox("Per-tier cost estimate", tableLines, "info");

  info(
    chalk.dim(
      `Rates: $${inputRate}/1M input, $${outputRate}/1M output. ` +
        `Token counts use CHARS_PER_TOKEN=${CHARS_PER_TOKEN} (English prose heuristic).`,
    ),
  );
  console.log();
}

/**
 * SA12.3-F03 (Cycle 10 Wave 2): render the per-artifact customization-applied
 * state. Each row reports the canonical artifact id, type, outcome class
 * (active | skipped | failed), and a reason string. Failures and skips appear
 * first so the user sees rejections at a glance; `active` rows follow.
 */
async function explainCustomizationsMode(): Promise<void> {
  const rootDir = process.cwd();
  const summary = await buildCustomizationSummary(rootDir);

  if (summary.entries.length === 0) {
    printBox(
      "Customizations",
      [chalk.dim("No .customize.yaml or .customize.md files found under .hatch3r/{agents,skills,commands,rules}/.")],
      "info",
    );
    return;
  }

  // Sort: failed > skipped > active, then by type, then by id.
  const outcomeRank: Record<CustomizationStatus["outcome"], number> = {
    failed: 0,
    skipped: 1,
    active: 2,
    none: 3,
  };
  const sorted = [...summary.entries].sort((a, b) => {
    if (outcomeRank[a.outcome] !== outcomeRank[b.outcome]) {
      return outcomeRank[a.outcome] - outcomeRank[b.outcome];
    }
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.id.localeCompare(b.id);
  });

  // Column widths chosen to fit a 100-col terminal cleanly. Reason is the
  // widest column so failures/skips have room to be actionable.
  const COL_TYPE = 10;
  const COL_ID = 32;
  const COL_OUTCOME = 10;
  const COL_OVERRIDES = 18;
  const COL_REASON = 50;

  const tableLines: string[] = [];
  tableLines.push(
    `${"Type".padEnd(COL_TYPE)}${"Id".padEnd(COL_ID)}${"Outcome".padEnd(COL_OUTCOME)}${"Overrides".padEnd(COL_OVERRIDES)}${"Reason".padEnd(COL_REASON)}`,
  );
  tableLines.push(chalk.dim("─".repeat(COL_TYPE + COL_ID + COL_OUTCOME + COL_OVERRIDES + COL_REASON)));

  for (const entry of sorted) {
    const overridesParts: string[] = [];
    if (entry.appliedOverrides.description !== undefined) overridesParts.push("desc");
    if (entry.appliedOverrides.model !== undefined) overridesParts.push("model");
    if (entry.appliedOverrides.scope !== undefined) overridesParts.push("scope");
    if (entry.appliedOverrides.enabled !== undefined) overridesParts.push(`enabled=${entry.appliedOverrides.enabled}`);
    if (entry.hasMd && !overridesParts.includes("md")) overridesParts.push("md");
    const overridesCell = overridesParts.length > 0 ? overridesParts.join(",") : chalk.dim("—");

    const outcomeCell = (() => {
      switch (entry.outcome) {
        case "failed":
          return chalk.red("failed");
        case "skipped":
          return chalk.yellow("skipped");
        case "active":
          return chalk.green("active");
        default:
          return chalk.dim("none");
      }
    })();

    const reasonRaw = entry.reason ?? "";
    // Truncate the reason to the column width minus an ellipsis budget so
    // long warnings do not break the layout on narrow terminals.
    const reasonCell = reasonRaw.length > COL_REASON - 1 ? `${reasonRaw.slice(0, COL_REASON - 2)}…` : reasonRaw;

    tableLines.push(
      `${entry.type.padEnd(COL_TYPE)}` +
        `${entry.id.padEnd(COL_ID)}` +
        // chalk-wrapped strings have ANSI codes that inflate length; pad manually.
        `${outcomeCell}${" ".repeat(Math.max(0, COL_OUTCOME - entry.outcome.length))}` +
        `${overridesCell.padEnd(COL_OVERRIDES)}` +
        `${reasonCell.padEnd(COL_REASON)}`,
    );
  }

  printBox("Customizations", tableLines, summary.counts.failed > 0 ? "warning" : "info");

  const summaryLine =
    `${summary.counts.active} active, ${summary.counts.skipped} skipped, ${summary.counts.failed} failed`;
  info(
    `${chalk.bold("Customizations:")} ${summaryLine}. ` +
      chalk.dim(`Run \`hatch3r status\` for a one-line summary.`),
  );
  console.log();
}

/**
 * SA12.4-F1 (D12): one provenance record for a generated output file. Mirrors
 * the schema written by `hatch3r sync` to `.hatch3r/provenance.json`
 * (`src/cli/commands/sync.ts` → SA12.4-F1 writer).
 */
interface ProvenanceEntry {
  path: string;
  adapter: string;
  sourceFiles: string[];
}

interface ProvenanceManifest {
  schemaVersion?: number;
  hatch3rVersion?: string;
  generatedAt?: string;
  outputs?: ProvenanceEntry[];
}

/**
 * SA12.4-F1 (D12): render the canonical-source provenance for a generated
 * adapter output. Reads `.hatch3r/provenance.json` (written by `hatch3r sync`)
 * and prints, for the requested output path, the adapter that produced it and
 * the sorted canonical `sourceFiles[]` that shaped it. This closes the gap
 * where `sourceFiles` provenance was captured in memory by `BaseAdapter` then
 * discarded, leaving operators with no user-visible canonical-source trace.
 *
 * Subject forms:
 *   - a specific output path (`CLAUDE.md`, `.cursor/rules/hatch3r-bridge.mdc`)
 *   - `all` or the valueless flag → one block per recorded output
 */
async function explainSourceMode(subject: string | undefined): Promise<void> {
  const rootDir = process.cwd();
  const provenancePath = join(rootDir, HATCH3R_DIR, "provenance.json");

  let manifest: ProvenanceManifest;
  try {
    const raw = await readFile(provenancePath, "utf-8");
    manifest = JSON.parse(raw) as ProvenanceManifest;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logError(`No provenance manifest found at ${HATCH3R_DIR}/provenance.json.`);
      console.log(chalk.dim("  Run `hatch3r sync` to generate adapter outputs and record their canonical sources."));
      console.log();
      throw new HatchError(
        `No ${HATCH3R_DIR}/provenance.json found`,
        1,
        "FS_ERROR",
        "Run `hatch3r sync` to generate adapter outputs and record their canonical sources, then re-run `hatch3r explain --source`.",
      );
    }
    logError(`Could not read ${HATCH3R_DIR}/provenance.json: ${err instanceof Error ? err.message : String(err)}`);
    console.log();
    throw new HatchError(
      `Unreadable ${HATCH3R_DIR}/provenance.json`,
      1,
      "FS_ERROR",
      "Re-run `hatch3r sync` to regenerate the provenance manifest; if it remains unreadable, delete it and sync again.",
    );
  }

  const outputs = Array.isArray(manifest.outputs) ? manifest.outputs : [];
  if (outputs.length === 0) {
    printBox(
      "Source provenance",
      [chalk.dim(`No outputs recorded in ${HATCH3R_DIR}/provenance.json. Run \`hatch3r sync\` first.`)],
      "info",
    );
    return;
  }

  const normalized = (subject ?? "").trim();
  const wantAll = normalized === "" || normalized.toLowerCase() === "all";

  if (wantAll) {
    const headerLines = [
      label("Manifest", `${HATCH3R_DIR}/provenance.json`),
      label("hatch3r", manifest.hatch3rVersion ?? "(unknown)"),
      label("Generated", manifest.generatedAt ?? "(unknown)"),
      label("Outputs", String(outputs.length)),
    ];
    printBox("Source provenance — all outputs", headerLines, "info");
    // Stable order: by adapter then path (matches the writer's sort).
    const sorted = [...outputs].sort((a, b) => {
      const byAdapter = a.adapter.localeCompare(b.adapter);
      return byAdapter !== 0 ? byAdapter : a.path.localeCompare(b.path);
    });
    for (const entry of sorted) {
      printSourceBlock(entry);
    }
    return;
  }

  const match = outputs.find((o) => o.path === normalized);
  if (!match) {
    logError(`Output path not recorded in provenance: ${normalized}`);
    const known = outputs.map((o) => o.path).sort();
    const preview = known.slice(0, 8).join(", ") + (known.length > 8 ? `, … (${known.length} total)` : "");
    console.log(chalk.dim(`  Recorded outputs: ${preview}`));
    console.log(chalk.dim("  Tip: run `hatch3r explain --source all` to list every recorded output."));
    console.log();
    throw new HatchError(
      `Output path not recorded: ${normalized}`,
      1,
      "CONFIG_ERROR",
      "Pass an output path exactly as recorded (run `hatch3r explain --source all` to list them), or re-run `hatch3r sync`.",
    );
  }

  printSourceBlock(match, manifest);
}

/**
 * SA12.4-F1 (D12): print a single output's provenance block — the generated
 * path, the adapter that emitted it, and each canonical source file. Used by
 * both the single-path and `--source all` forms.
 */
function printSourceBlock(entry: ProvenanceEntry, manifest?: ProvenanceManifest): void {
  const lines: string[] = [
    label("Output", entry.path),
    label("Adapter", entry.adapter),
  ];
  if (manifest) {
    lines.push(label("hatch3r", manifest.hatch3rVersion ?? "(unknown)"));
    lines.push(label("Generated", manifest.generatedAt ?? "(unknown)"));
  }
  if (entry.sourceFiles.length === 0) {
    lines.push(label("Sources", chalk.dim("(none recorded)")));
  } else {
    lines.push(label("Sources", `${entry.sourceFiles.length} canonical file(s):`));
    for (const src of entry.sourceFiles) {
      lines.push(`    ${chalk.cyan("•")} ${src}`);
    }
  }
  printBox(`Source: ${entry.path}`, lines, "info");
}
