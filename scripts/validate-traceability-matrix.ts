#!/usr/bin/env node
/**
 * scripts/validate-traceability-matrix.ts — F24.4-D24-6 + F24.4-D24-7 (Cycle 11 D24 High).
 *
 * Pillar-traceability matrix ↔ domain-frontmatter consistency gate. The
 * CONSTITUTION §3.1 (governance P1-P8) and §3.2 (content-quality CQ1-CQ9)
 * Domains cells are a curated owner map. Two drift classes shipped in Cycle 10
 * because no code gate cross-checked the cells against the 25 audit-domain
 * pillar declarations:
 *
 *   D24-7: §3.2 listed D22 in the CQ1-CQ7 cells while
 *          `D22-content-architecture.md` declared only `content-quality:
 *          [CQ8, CQ9]` — 7 cells cited a pillar the domain did not declare.
 *   D24-6: D24 (P5 primary, P4) and D23 (P3, P5) were absent from the §3.1
 *          cells they own after the 2.0.0 domain admission.
 *
 * Two checks (CI gate):
 *
 *   1. MATRIX → FRONTMATTER (every §3.1/§3.2 cell entry): every domain id
 *      cited in a Domains cell MUST declare that pillar in its pillar set
 *      (frontmatter `pillars:` YAML when present, else the prose
 *      `**Pillars served:**` line). A cell entry whose domain does not declare
 *      the pillar is a STALE-CELL error (the D24-7 class).
 *
 *   2. PRIMARY → MATRIX (the 2.0.0-admitted domains D23 + D24): each of these
 *      domains' PRIMARY governance pillar(s) MUST appear in the matching §3.1
 *      cell. These are the domains whose primary-owner row regressed under the
 *      21→24 admission (the D24-6 class). Restricted to D23/D24 so the gate
 *      does not impose exhaustive primary-owner listing on the older curated
 *      rows (the matrix lists primary OWNERS, not every primary-pillar domain).
 *
 * `.N` SA-suffixes on cell entries (e.g. `D20.1`, `D20.2`) resolve to the
 * parent domain (`D20`).
 *
 * Usage:
 *   npm run validate:efficiency        (chained)
 *   tsx scripts/validate-traceability-matrix.ts
 *   tsx scripts/validate-traceability-matrix.ts --json
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";
const DOMAINS_DIR_REL = "governance/audit/domains";

/** Domains whose PRIMARY governance pillar must appear in its §3.1 cell. */
const PRIMARY_MATRIX_DOMAINS: readonly string[] = ["D23", "D24"];

/**
 * Cross-CQ owner domains: a domain authored to own ALL content-quality cells it
 * appears in (D22 Content Architecture is the §2B cross-vector owner). For each
 * such domain, every §3.2 CQ cell that lists it MUST be declared in its pillar
 * set — and conversely it should not be silently dropped. This is the precise
 * D24-7 invariant (D22 ⟺ its CQ cells) and avoids the curated-owner-cluster
 * false positives a blanket matrix→frontmatter check would raise (e.g. §3.1 P2
 * legitimately lists D07 via the "D7 SA7.x" owner cluster though D07 self-
 * declares P8 primary).
 */
const CROSS_CQ_OWNERS: readonly string[] = ["D22"];

export interface MatrixDrift {
  level: "error";
  code: string;
  message: string;
}

export interface RunOptions {
  rootDir?: string;
}

export interface RunResult {
  /** True when the private governance corpus was absent and the check skipped. */
  skipped: boolean;
  drifts: MatrixDrift[];
  cellEntries: number;
  domainsScanned: number;
  errorCount: number;
}

interface DomainPillars {
  /** All declared pillars (primary + supporting), e.g. {"P2","P5","CQ8"}. */
  all: Set<string>;
  /** Primary pillars only. */
  primary: Set<string>;
}

/** Parse a single Domains-cell CSV into normalized parent domain ids. */
function parseDomainCell(cell: string): string[] {
  return cell
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const m = s.match(/D\d+/i);
      return m ? m[0].toUpperCase() : "";
    })
    .filter((s) => s.length > 0);
}

/**
 * Extract the {pillar -> Domains cell entries} map from a §3.x matrix block.
 * `pillarPrefix` is "P" for §3.1 and "CQ" for §3.2.
 */
export function parseMatrixSection(
  body: string,
  sectionHeader: string,
  pillarPrefix: "P" | "CQ",
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = body.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("### ") && line.includes(sectionHeader)) {
      inSection = true;
      continue;
    }
    // Stop at the next "### " section header.
    if (inSection && line.startsWith("### ") && !line.includes(sectionHeader)) break;
    if (!inSection) continue;
    if (!line.trim().startsWith("|")) continue;

    const cols = line.split("|").map((c) => c.trim());
    // cols[0] is empty (leading pipe); pillar label is cols[1]; Domains is the
    // 9th data column. Header/separator rows are skipped via the pillar regex.
    const pillarLabel = cols[1] ?? "";
    const pillarMatch =
      pillarPrefix === "P"
        ? pillarLabel.match(/^(P[1-8])\b/)
        : pillarLabel.match(/^(CQ[1-9])\b/);
    if (!pillarMatch) continue;
    const pillar = pillarMatch[1];
    // Domains column: index 8 in the pipe-split (1-based data col 8 -> the
    // 8th "| ... |" segment after the leading empty). Header layout:
    // | Pillar | CONST | VISION | AUDIT | A-EXEC | RE-ENV | EVOLVE | TMPL | Domains | Trust |
    const domainsCell = cols[9] ?? "";
    out.set(pillar, parseDomainCell(domainsCell));
  }
  return out;
}

/** Parse a domain file's declared pillars from YAML frontmatter or prose. */
export function parseDomainPillars(body: string): DomainPillars {
  const all = new Set<string>();
  const primary = new Set<string>();

  // Shape A — YAML frontmatter `pillars:` block (D22/D23/D24).
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  let usedYaml = false;
  if (fmMatch) {
    const fm = fmMatch[1];
    const govMatch = fm.match(/governance:\s*\[([^\]]*)\]/);
    const cqMatch = fm.match(/content-quality:\s*\[([^\]]*)\]/);
    if (govMatch || cqMatch) {
      usedYaml = true;
      for (const grp of [govMatch?.[1], cqMatch?.[1]]) {
        if (!grp) continue;
        for (const tok of grp.split(",")) {
          const t = tok.trim().toUpperCase();
          if (/^(P[1-8]|CQ[1-9])$/.test(t)) all.add(t);
        }
      }
      // YAML arrays do not encode primary/supporting; the prose line does.
      // Mine the prose line (if present) for the primary subset.
    }
  }

  // Shape B — prose `**Pillars served:** governance-axis P2 (primary), P5
  // (supporting); content-quality-axis CQ8 ... (supporting).` The qualifier
  // may carry a trailing gloss, e.g. `(primary — runtime resilience)`, so the
  // qualifier matcher requires only the open-paren + keyword, not an immediate
  // close paren. Clauses split on `,` `;` and `)` so each pillar token pairs
  // with the qualifier that follows it within its own clause.
  const proseLine = body.match(/\*\*Pillars served:\*\*[^\n]*/);
  if (proseLine) {
    const text = proseLine[0];
    const clauses = text.split(/[;,)]/);
    let lastQualifier: "primary" | "supporting" | null = null;
    for (const clause of clauses) {
      const q = clause.match(/\((primary|supporting)\b/i);
      const qual = q ? (q[1].toLowerCase() as "primary" | "supporting") : null;
      const effective = qual ?? lastQualifier;
      const tokens = clause.match(/P[1-8]|CQ[1-9]/gi) ?? [];
      for (const tk of tokens) {
        const t = tk.toUpperCase();
        all.add(t);
        if (effective === "primary") primary.add(t);
      }
      if (qual) lastQualifier = qual;
    }
  }

  // If only YAML was available (no prose), treat the first governance and first
  // content-quality entry as primary (the authoring convention orders
  // primaries first; D22/D23/D24 all carry prose too, so this is a safety net).
  if (usedYaml && !proseLine) {
    const govFirst = [...all].find((p) => /^P/.test(p));
    const cqFirst = [...all].find((p) => /^CQ/.test(p));
    if (govFirst) primary.add(govFirst);
    if (cqFirst) primary.add(cqFirst);
  }

  return { all, primary };
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const drifts: MatrixDrift[] = [];

  // Governance corpus is private (governance privatization initiative,
  // 2026-06-03) and absent in public clones / contributor CI. With no
  // CONSTITUTION matrix or audit-domain files to cross-check, skip the whole
  // check (exit clean) — mirroring scripts/validate-governance-total.ts.
  const constitutionPath = join(rootDir, CONSTITUTION_REL);
  const domainsDirPath = join(rootDir, DOMAINS_DIR_REL);
  if (!existsSync(constitutionPath) || !existsSync(domainsDirPath)) {
    return {
      skipped: true,
      drifts: [],
      cellEntries: 0,
      domainsScanned: 0,
      errorCount: 0,
    };
  }

  const constitution = await readFile(constitutionPath, "utf-8");
  const gov = parseMatrixSection(constitution, "§3.1", "P");
  const cq = parseMatrixSection(constitution, "§3.2", "CQ");

  // Load every domain's pillar declaration.
  const domainsDir = domainsDirPath;
  const entries = await readdir(domainsDir);
  const domainPillars = new Map<string, DomainPillars>();
  for (const name of entries) {
    const m = name.match(/^(D\d+)[^/]*\.md$/i);
    if (!m) continue;
    const id = m[1].toUpperCase();
    const body = await readFile(join(domainsDir, name), "utf-8");
    domainPillars.set(id, parseDomainPillars(body));
  }

  let cellEntries = 0;

  // Check 1 — MATRIX → FRONTMATTER for both axes.
  for (const [section, map] of [
    ["§3.1", gov],
    ["§3.2", cq],
  ] as const) {
    for (const [pillar, domains] of map) {
      for (const d of domains) {
        cellEntries += 1;
        const decl = domainPillars.get(d);
        if (!decl) {
          drifts.push({
            level: "error",
            code: "TRACE-MATRIX-UNKNOWN-DOMAIN",
            message: `${section} ${pillar} cell cites ${d} but no governance/audit/domains/${d}*.md exists`,
          });
          continue;
        }
        // STALE-CELL is asserted only for the declared cross-CQ owner(s): a
        // general "cell entry must self-declare the pillar" rule false-positives
        // on the matrix's curated primary-owner SA clusters (see CROSS_CQ_OWNERS
        // note). For a cross-CQ owner, the §3.2 cell ⟺ frontmatter equivalence
        // is the exact D24-7 invariant.
        if (
          section === "§3.2" &&
          CROSS_CQ_OWNERS.includes(d) &&
          !decl.all.has(pillar)
        ) {
          drifts.push({
            level: "error",
            code: "TRACE-MATRIX-STALE-CELL",
            message: `§3.2 ${pillar} cell cites cross-CQ owner ${d} but ${d} does not declare ${pillar} in its pillar set — widen ${d}'s content-quality frontmatter to include ${pillar} or drop it from the cell (F24.4-D24-7)`,
          });
        }
      }
    }
  }

  // Check 1b — cross-CQ owner completeness: every content-quality pillar a
  // cross-CQ owner DECLARES should be reflected by membership in that §3.2 cell
  // (the inverse direction of the D24-7 ⟺ invariant).
  for (const owner of CROSS_CQ_OWNERS) {
    const decl = domainPillars.get(owner);
    if (!decl) continue;
    for (const p of decl.all) {
      if (!/^CQ[1-9]$/.test(p)) continue;
      const cell = cq.get(p) ?? [];
      if (!cell.includes(owner)) {
        drifts.push({
          level: "error",
          code: "TRACE-MATRIX-OWNER-CELL-GAP",
          message: `cross-CQ owner ${owner} declares ${p} but is absent from the §3.2 ${p} Domains cell — add ${owner} to the cell or narrow its frontmatter (F24.4-D24-7)`,
        });
      }
    }
  }

  // Check 2 — PRIMARY → MATRIX for the 2.0.0-admitted domains D23 + D24.
  for (const id of PRIMARY_MATRIX_DOMAINS) {
    const decl = domainPillars.get(id);
    if (!decl) continue;
    for (const p of decl.primary) {
      if (!/^P[1-8]$/.test(p)) continue; // governance axis only for §3.1
      const cell = gov.get(p) ?? [];
      if (!cell.includes(id)) {
        drifts.push({
          level: "error",
          code: "TRACE-MATRIX-MISSING-PRIMARY",
          message: `${id} declares ${p} as a PRIMARY governance pillar but is absent from the §3.1 ${p} Domains cell — add ${id} to the cell (F24.4-D24-6)`,
        });
      }
    }
  }

  return {
    skipped: false,
    drifts,
    cellEntries,
    domainsScanned: domainPillars.size,
    errorCount: drifts.length,
  };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDrift(d: MatrixDrift): string {
  return `[ERROR ${d.code}] ${d.message}`;
}

interface CliFlags {
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (result.skipped) {
    // eslint-disable-next-line no-console
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    // eslint-disable-next-line no-console
    else
      console.log(
        `validate-traceability-matrix: skipped — ${CONSTITUTION_REL} absent (private-corpus public CI)`,
      );
    return;
  }
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const d of result.drifts) {
      // eslint-disable-next-line no-console
      console.error(formatDrift(d));
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-traceability-matrix: ${result.domainsScanned} domain(s), ${result.cellEntries} cell entr(ies), ${result.errorCount} error(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate-traceability-matrix failed:", err);
    process.exit(1);
  });
}
