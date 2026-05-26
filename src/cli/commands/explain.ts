// C9-H13 (D6-SA6.3-F1): `hatch3r explain --cost <command>` surfaces the
// triage-first cost model declared in canonical command frontmatter. The
// `estimateCost` helper from `src/pipeline/observability.ts` already produces
// per-token USD figures; this command wires it to the `triage_tiers` array so
// users can answer "what will this command cost at each triage tier?" without
// running the command.
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

import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import {
  CHARS_PER_TOKEN,
  DEFAULT_INPUT_COST_PER_1M,
  DEFAULT_OUTPUT_COST_PER_1M,
  estimateTokens,
  estimateCost,
  type PipelineTokenSummary,
} from "../../pipeline/observability.js";
import { HatchError } from "../../types.js";
import { findPackageRoot } from "../shared/paths.js";
import { printBanner, printBox, label, info, error as logError, setVerbose } from "../shared/ui.js";

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
    );
  }

  const [, frontmatterStr] = match;
  const parsed = parseYaml(frontmatterStr ?? "") as Record<string, unknown> | null;

  if (!parsed || typeof parsed !== "object") {
    throw new HatchError(
      `Invalid frontmatter in ${filePath}: expected YAML object.`,
      1,
      "VALIDATION_ERROR",
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
    const cost = estimateCost(summary, {
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
  verbose?: boolean;
  inputRate?: string;
  outputRate?: string;
}

/**
 * `hatch3r explain --cost <command-id>` entry point. Reads the canonical
 * command file's `triage_tiers` array, computes per-tier sub-agent fan-out
 * and USD spend, and prints a boxed summary table.
 */
export async function explainCommand(opts?: ExplainOptions): Promise<void> {
  setVerbose(!!opts?.verbose);
  printBanner(true);

  const commandId = opts?.cost?.trim();
  if (!commandId) {
    logError("Missing required flag: --cost <command-id>");
    console.log(chalk.dim("  Example: hatch3r explain --cost hatch3r-quick-change"));
    console.log();
    throw new HatchError(
      "Missing required flag: --cost <command-id>",
      2,
      "VALIDATION_ERROR",
    );
  }

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
    );
  }
  if (!Number.isFinite(outputRate) || outputRate < 0) {
    throw new HatchError(
      `Invalid --output-rate: ${opts?.outputRate} (expected non-negative number USD per 1M tokens)`,
      2,
      "VALIDATION_ERROR",
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
