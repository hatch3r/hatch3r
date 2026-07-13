#!/usr/bin/env node
/**
 * scripts/validate-pillar-coverage.ts — D22-SA22.3-01 (Cycle 12 Wave 2, D22).
 *
 * Makes D22 §22.3's weighted pillar-coverage tally reproducible AND
 * CI-checkable. Root cause the finding fixes: §22.3 mandated a weighted tally
 * over "reading `pillars:` frontmatter + body tag scan", but no canonical
 * tag→pillar map existed, so only 16/190 artifacts had a deterministic pillar
 * assignment and the other 174 fell back on an auditor-interpreted map — two
 * auditors computed divergent tallies from an unchanged corpus (P5: 0 vs 46).
 * `src/content/tags.ts::PILLAR_MAP` supplies the missing substrate; this script
 * consumes it.
 *
 * Two responsibilities:
 *
 *   1. Structural gate (`--check` exits 1 on failure). PILLAR_MAP must stay
 *      COMPLETE (every capability + floor tag has an edge set) and VALID (every
 *      edge cites a pillar in `ALL_PILLARS` and a real role; every key is a
 *      registered capability/floor tag). This is the reproducibility substrate:
 *      if it drifts the tally silently stops covering the corpus — the exact
 *      D22-SA22.3-01 failure mode — so a drift is a hard error, mirroring the
 *      sibling `validate-pillar-currency.ts` gate.
 *
 *   2. Coverage report (always printed, never fails the gate). The
 *      deterministic weighted tally per pillar, flagging under-served (<3) and
 *      over-served (>30) pillars as D22 §22.3 signals for SA22.3 to action via
 *      CL-2. Those thresholds are audit signals, not build invariants, so a
 *      breach reports but does not exit non-zero (a corpus can legitimately
 *      over-serve P5 — that IS the finding SA22.3 raises).
 *
 * Reconciliation (D22 §22.3-R1): PILLAR_MAP tag-scan is authoritative for all
 * 190 artifacts; `pillars:` frontmatter (present on 16) is a cross-check — a
 * divergence between an artifact's declared pillars and its tag-derived PRIMARY
 * pillars is reported as a warning.
 *
 * Scan surface: `agents/hatch3r-*.md`, `skills/hatch3r-<name>/SKILL.md`,
 * `rules/hatch3r-*.md`, `commands/hatch3r-*.md`, `hooks/hatch3r-*.md` — the 190
 * canonical content artifacts. `governance/audit/domains/*` are excluded by
 * construction (out of the scan surface) per §22.3 checklist item 1.
 *
 * Pillars: P5 (Governance Self-Quality — a reproducible audit instrument),
 * P4 (Lean Coverage — the tally drives gap/over-serve findings).
 *
 * Usage: tsx scripts/validate-pillar-coverage.ts           (report)
 *        tsx scripts/validate-pillar-coverage.ts --check    (report + structural gate)
 *        tsx scripts/validate-pillar-coverage.ts --json
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  ALL_PILLARS,
  facetOf,
  pillarsForTag,
  PILLAR_MAP,
  tagsForFacet,
  weightedPillarTally,
} from "../src/content/tags.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/** D22 §22.3 coverage thresholds (audit signals, not build gates). */
const UNDER_SERVED = 3;
const OVER_SERVED = 30;

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  message: string;
}

interface Artifact {
  relPath: string;
  tags: string[];
  /** Declared `pillars:` ids flattened across both axes ([] when absent). */
  declaredPillars: string[];
}

export interface RunOptions {
  root?: string;
}

export interface RunResult {
  /** Weighted per-pillar tally, deterministic for a fixed corpus. */
  tally: Record<string, number>;
  findings: Finding[];
  /** Structural (reproducibility-substrate) errors — the `--check` gate. */
  structuralErrorCount: number;
  artifactCount: number;
}

// ── Frontmatter parsing ───────────────────────────────────────────

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return null;
  const afterOpen = raw.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return null;
  const closeIdx = raw.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return null;
  try {
    const parsed = parseYaml(raw.slice(afterOpen, closeIdx)) as Record<string, unknown> | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractTags(fm: Record<string, unknown> | null): string[] {
  const raw = fm?.tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Flatten the structured canonical `pillars:` block
 * (`{ governance: [...], "content-quality": [...] }`) into a flat id list.
 * Also accepts a plain array shape for forward-compatibility.
 */
function extractDeclaredPillars(fm: Record<string, unknown> | null): string[] {
  const raw = fm?.pillars;
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (raw && typeof raw === "object") {
    const out: string[] = [];
    for (const axis of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(axis)) {
        for (const p of axis) if (typeof p === "string") out.push(p);
      }
    }
    return out;
  }
  return [];
}

// ── Discovery ─────────────────────────────────────────────────────

async function listTopLevel(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.startsWith("hatch3r-") && n.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => join(dir, n));
}

async function listSkills(skillsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (!name.startsWith("hatch3r-")) continue;
    const skillPath = join(skillsDir, name, "SKILL.md");
    try {
      if ((await stat(skillPath)).isFile()) out.push(skillPath);
    } catch {
      // no SKILL.md in this subdir; skip
    }
  }
  return out;
}

async function collectArtifacts(root: string): Promise<Artifact[]> {
  const [agents, rules, commands, hooks, skills] = await Promise.all([
    listTopLevel(join(root, "agents")),
    listTopLevel(join(root, "rules")),
    listTopLevel(join(root, "commands")),
    listTopLevel(join(root, "hooks")),
    listSkills(join(root, "skills")),
  ]);
  const paths = [...agents, ...rules, ...commands, ...hooks, ...skills];
  const artifacts: Artifact[] = [];
  for (const p of paths) {
    const raw = await readFile(p, "utf-8");
    const fm = parseFrontmatter(raw);
    artifacts.push({
      relPath: p.slice(root.length + 1),
      tags: extractTags(fm),
      declaredPillars: extractDeclaredPillars(fm),
    });
  }
  return artifacts;
}

// ── Structural checks (the `--check` reproducibility gate) ────────

/**
 * COMPLETENESS + VALIDITY + NO-DANGLING over PILLAR_MAP. Keeping the map in
 * sync with the tag registry is what makes the tally cover the whole corpus;
 * these are the only failures `--check` treats as errors.
 */
function checkStructural(): Finding[] {
  const findings: Finding[] = [];
  const validPillars = new Set(ALL_PILLARS);
  const tallyTags = [...tagsForFacet("capability"), ...tagsForFacet("floor")];

  // COMPLETENESS: every capability + floor tag has an edge set.
  for (const tag of tallyTags) {
    if (pillarsForTag(tag).length === 0) {
      findings.push({
        level: "error",
        code: "PILLAR-MAP-INCOMPLETE",
        message: `tag \`${tag}\` (${facetOf(tag)}) has no PILLAR_MAP edge — the tally cannot place its artifacts; add an entry in src/content/tags.ts::PILLAR_MAP`,
      });
    }
  }

  for (const [tag, edges] of Object.entries(PILLAR_MAP)) {
    // NO-DANGLING: every key is a registered capability/floor tag.
    const facet = facetOf(tag);
    if (facet !== "capability" && facet !== "floor") {
      findings.push({
        level: "error",
        code: "PILLAR-MAP-DANGLING",
        message: `PILLAR_MAP key \`${tag}\` is facet \`${facet ?? "unknown"}\`, not capability/floor — the tally only reads those two facets; remove it or re-facet the tag`,
      });
    }
    // VALIDITY: every edge cites a real pillar + role.
    for (const edge of edges) {
      if (!validPillars.has(edge.pillar)) {
        findings.push({
          level: "error",
          code: "PILLAR-MAP-BAD-PILLAR",
          message: `PILLAR_MAP[${tag}] cites pillar \`${edge.pillar}\` outside the P1-P8 / CQ1-CQ10 union`,
        });
      }
      if (edge.role !== "primary" && edge.role !== "supporting") {
        findings.push({
          level: "error",
          code: "PILLAR-MAP-BAD-ROLE",
          message: `PILLAR_MAP[${tag}] cites role \`${String(edge.role)}\`; expected "primary" or "supporting"`,
        });
      }
    }
  }
  return findings;
}

// ── Coverage report + reconciliation cross-check (never fail the gate) ──

function coverageFindings(tally: Record<string, number>): Finding[] {
  const findings: Finding[] = [];
  for (const pillar of ALL_PILLARS) {
    const n = tally[pillar] ?? 0;
    if (n < UNDER_SERVED) {
      findings.push({
        level: "warning",
        code: "PILLAR-UNDER-SERVED",
        message: `${pillar}: ${n} weighted artifact(s) < ${UNDER_SERVED} — D22 §22.3 P1-priority CL-2 gap signal`,
      });
    } else if (n > OVER_SERVED) {
      findings.push({
        level: "warning",
        code: "PILLAR-OVER-SERVED",
        message: `${pillar}: ${n} weighted artifact(s) > ${OVER_SERVED} — D22 §22.3 scope-imbalance signal (D16.3)`,
      });
    }
  }
  return findings;
}

/**
 * Reconciliation cross-check (22.3-R1): for each of the 16 artifacts declaring
 * `pillars:` frontmatter, flag any declared pillar with NO tag→pillar edge of
 * any role backing it. The tag-scan stays authoritative; the frontmatter is the
 * cross-check, so a declared pillar with zero tag support is a divergence
 * (warning). A declaration backed at supporting role is consistent and is not
 * flagged — e.g. `hatch3r-ui.md` declares CQ1 and carries `accessibility`
 * (→CQ1 supporting), so it reconciles.
 */
function reconciliationFindings(artifacts: Artifact[]): Finding[] {
  const findings: Finding[] = [];
  for (const a of artifacts) {
    if (a.declaredPillars.length === 0) continue;
    const derived = new Set<string>();
    for (const tag of a.tags) {
      for (const edge of pillarsForTag(tag)) derived.add(edge.pillar);
    }
    const declared = new Set(a.declaredPillars);
    const missing = [...declared].filter((p) => !derived.has(p));
    if (missing.length > 0) {
      findings.push({
        level: "warning",
        code: "PILLAR-RECONCILE-DIVERGENCE",
        message: `${a.relPath}: declares pillar(s) ${missing.join(", ")} in frontmatter with no tag→pillar edge to back them — align the tags or the declaration (22.3-R1 cross-check)`,
      });
    }
  }
  return findings;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.root ?? ROOT;
  const artifacts = await collectArtifacts(root);
  const tally = weightedPillarTally(artifacts);

  const structural = checkStructural();
  const findings: Finding[] = [
    ...structural,
    ...coverageFindings(tally),
    ...reconciliationFindings(artifacts),
  ];

  return {
    tally,
    findings,
    structuralErrorCount: structural.length,
    artifactCount: artifacts.length,
  };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.message}`;
}

interface CliFlags {
  json: boolean;
  check: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json"), check: argv.includes("--check") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();

  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`validate-pillar-coverage: ${result.artifactCount} artifact(s) scanned`);
    for (const pillar of ALL_PILLARS) {
      // eslint-disable-next-line no-console
      console.log(`  ${pillar.padEnd(4)} ${result.tally[pillar] ?? 0}`);
    }
    for (const f of result.findings) {
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      // eslint-disable-next-line no-console
      else console.warn(line);
    }
  }

  // Only structural (reproducibility-substrate) errors fail `--check`. Coverage
  // and reconciliation warnings are audit signals, never build breakers.
  if (flags.check && result.structuralErrorCount > 0) process.exit(1);
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
    console.error("validate-pillar-coverage failed:", err);
    process.exit(1);
  });
}
