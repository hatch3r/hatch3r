// ── Implementation-Matrix doc ↔ ADAPTER_CAPABILITIES agreement (D9-19) ─────────
//
// Finding D9-19 (D9 Platform Adapters, Medium, pillar P3/P2): the human-curated
// Implementation Matrix in `docs/adapter-capability-matrix.md` is hand-maintained
// alongside the machine-authoritative `ADAPTER_CAPABILITIES` boolean matrix
// (`src/adapters/index.ts`). Before this test a doc cell could silently
// contradict the code — the trigger case was `copilot | prompts | Y` in the doc
// while `ADAPTER_CAPABILITIES.copilot.prompts = false`, with nothing reconciling
// the two. `capabilityMatrixDrift.test.ts` pins the code matrix to observed
// `doGenerate()` output; THIS test pins the doc table to the code matrix, closing
// the doc-vs-code loop.
//
// ── What is checked ───────────────────────────────────────────────────────────
// The Implementation Matrix has 11 columns. Eight are backed 1:1 by a boolean
// `ADAPTER_CAPABILITIES` key (rules, agents, skills, prompts, commands, mcp,
// githubAgents, hooks). The other three (guardrails, model, agentTeams) have no
// boolean column in `ADAPTER_CAPABILITIES` — `guardrails` is a not-yet-emitted
// capability, `model` maps to the separate `modelOverride` flag rendered in its
// own "Agent Model Customization" section, and `agentTeams` is adapter-generated
// — so they are excluded from this cell-level reconciliation by header name.
//
// Legend mapping (docs/adapter-capability-matrix.md → boolean):
//   "Y"  → the adapter emits files from this capability source  → expect true
//   "--" → platform has no support / adapter emits nothing       → expect false
//   "B"  → bridge: folded into an instruction file               → expect false
//   "skip" → supported but global-only, intentionally omitted    → expect false
// Only "Y" means "ADAPTER_CAPABILITIES key === true". Footnote markers appended
// to a cell (e.g. `--[^prompts]`) are stripped before comparison.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTER_CAPABILITIES } from "../../adapters/index.js";
import type { Tool } from "../../types.js";

// Repo root from src/__tests__/adapters/ is three levels up (adapters →
// __tests__ → src → root), matching the dependency-free convention used by the
// governance gate tests (e.g. archive-path-currency-gate.test.ts).
const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const DOC_PATH = resolve(ROOT, "docs", "adapter-capability-matrix.md");

// Implementation-Matrix column header → ADAPTER_CAPABILITIES boolean key.
// Columns absent from this map (guardrails, model, agentTeams) carry no boolean
// key and are intentionally not reconciled at the cell level (see header note).
const COLUMN_TO_CAP_KEY: Record<string, keyof (typeof ADAPTER_CAPABILITIES)["cursor"]> = {
  rules: "rules",
  agents: "agents",
  skills: "skills",
  prompts: "prompts",
  commands: "commands",
  mcp: "mcp",
  githubagents: "githubAgents",
  hooks: "hooks",
};

const TOOLS_UNDER_TEST: Tool[] = ["cursor", "copilot", "claude"];

/** Split a markdown table row into trimmed cells, dropping the leading/trailing
 *  empty fields produced by the outer pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Strip markdown emphasis (`**x**`) and trailing footnote markers (`[^id]`)
 *  from a cell so the legend symbol is compared cleanly. */
function normalizeCell(cell: string): string {
  return cell
    .replace(/\*\*/g, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .trim();
}

/**
 * Parse the "## Implementation Matrix" section's first table into a
 * `{ [tool]: { [columnHeader]: symbol } }` shape. Locates the section by its
 * `## Implementation Matrix` heading, then reads the header row and the data
 * rows until the table ends (first non-`|` line).
 */
function parseImplementationMatrix(doc: string): {
  headers: string[];
  rows: Record<string, Record<string, string>>;
} {
  const lines = doc.split("\n");
  const sectionIdx = lines.findIndex((l) => /^##\s+Implementation Matrix\s*$/.test(l));
  if (sectionIdx === -1) {
    throw new Error("Implementation Matrix section not found in adapter-capability-matrix.md");
  }

  // First table-header line at or after the section heading.
  let i = sectionIdx + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) i++;
  if (i >= lines.length) {
    throw new Error("Implementation Matrix table header not found");
  }

  const headers = splitRow(lines[i]).map((h) => normalizeCell(h).toLowerCase());
  i++;
  // Skip the markdown alignment separator row (|:---:|...).
  if (i < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i].trim())) i++;

  const rows: Record<string, Record<string, string>> = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break; // table ended
    const cells = splitRow(line);
    const tool = normalizeCell(cells[0]).toLowerCase();
    const row: Record<string, string> = {};
    for (let c = 1; c < headers.length && c < cells.length; c++) {
      row[headers[c]] = normalizeCell(cells[c]);
    }
    rows[tool] = row;
  }

  return { headers, rows };
}

describe("Implementation Matrix doc ↔ ADAPTER_CAPABILITIES agreement (D9-19)", () => {
  const doc = readFileSync(DOC_PATH, "utf-8");
  const { headers, rows } = parseImplementationMatrix(doc);

  it("parses a row for every registered adapter", () => {
    for (const tool of TOOLS_UNDER_TEST) {
      expect(rows[tool], `Implementation Matrix is missing a row for "${tool}"`).toBeDefined();
    }
  });

  it("every boolean-backed column header maps to an ADAPTER_CAPABILITIES key", () => {
    // Guards against a column being renamed in the doc without updating the
    // COLUMN_TO_CAP_KEY map — a renamed column would otherwise be silently
    // dropped from the reconciliation.
    for (const header of Object.keys(COLUMN_TO_CAP_KEY)) {
      expect(headers, `doc Implementation Matrix lost the "${header}" column`).toContain(header);
    }
  });

  for (const tool of TOOLS_UNDER_TEST) {
    describe(tool, () => {
      for (const [header, capKey] of Object.entries(COLUMN_TO_CAP_KEY)) {
        it(`${header} cell agrees with ADAPTER_CAPABILITIES.${tool}.${String(capKey)}`, () => {
          const symbol = rows[tool]?.[header];
          expect(
            symbol,
            `Implementation Matrix row "${tool}" has no "${header}" cell`,
          ).toBeDefined();

          const declared = ADAPTER_CAPABILITIES[tool][capKey] as boolean;
          const docSaysEmits = symbol === "Y";

          // Only "Y" denotes emission from this capability source. Any other
          // legend symbol ("--", "B", "skip") MUST correspond to a false flag,
          // and a "Y" MUST correspond to a true flag.
          expect(
            docSaysEmits,
            `doc/code drift for "${tool}.${header}": Implementation Matrix shows ` +
              `"${symbol}" (emits=${docSaysEmits}) but ADAPTER_CAPABILITIES.${tool}.${String(capKey)}=` +
              `${declared}. Set the cell to "Y" when the flag is true, or to "--"/"B" (with a ` +
              `footnote) when it is false; or change the flag in src/adapters/index.ts.`,
          ).toBe(declared);
        });
      }
    });
  }
});
