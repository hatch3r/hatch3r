#!/usr/bin/env node
/**
 * scripts/validate-rule-parity.ts — Cycle 7 H12 + Cycle 7.5 H16
 *
 * Enforces two invariants for every `rules/hatch3r-*.md` + `.mdc` pair:
 *
 * 1. Body parity (H12): bodies below frontmatter match byte-for-byte after
 *    trailing-whitespace normalization.
 *
 * 2. Scope transform (H16): the `.mdc` frontmatter is the deterministic
 *    transform of the `.md` scope per .claude/rules/content-authoring.md:
 *    - `scope: always`                       -> `alwaysApply: true`, no `globs`
 *    - `scope: "<csv>"`                      -> `globs: [...]`, `alwaysApply: false`
 *    - `scope: conditional` + `globs: <csv>` -> `globs: [...]`, `alwaysApply: false`
 *    - `scope: conditional` (no globs)       -> `alwaysApply: false`, no `globs`
 *
 * Pillars: P2 (Scientific Quality), P4 (Lean Coverage).
 *
 * Usage: `npm run validate:rule-parity` (invokes via tsx). Exits 0 on parity,
 * 1 on any drift with a per-pair diff summary.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const RULES_DIR = join(ROOT, "rules");

interface DriftReport {
  basename: string;
  reason: string;
  detail: string;
}

/**
 * Strip the leading YAML/MDC frontmatter block (between the first two `---`
 * markers) and return only the body. Files without frontmatter return as-is.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return content;
  }
  // Locate the closing `---` marker. Search for `\n---\n` (or CRLF variant)
  // starting after the opening `---` line.
  const afterOpen = content.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return content;
  const closeIdx = content.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return content;
  // Advance past the closing `---` line (which may end with \n or \r\n or EOF).
  const afterClose = content.indexOf("\n", closeIdx + 4);
  if (afterClose === -1) return "";
  return content.slice(afterClose + 1);
}

/**
 * Normalize body for comparison: trim trailing whitespace per line, normalize
 * line endings to \n, strip a single trailing newline. Internal whitespace
 * (indentation, blank-line spacing) is preserved -- it carries semantic meaning
 * in markdown (code blocks, lists).
 */
function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Produce a short diff summary: line counts and the first differing line index
 * with its left/right values. Keeps CI logs readable without dumping the entire
 * file body.
 */
function summarizeDiff(mdBody: string, mdcBody: string): string {
  const mdLines = mdBody.split("\n");
  const mdcLines = mdcBody.split("\n");
  const max = Math.max(mdLines.length, mdcLines.length);
  for (let i = 0; i < max; i++) {
    const a = mdLines[i] ?? "<EOF>";
    const b = mdcLines[i] ?? "<EOF>";
    if (a !== b) {
      const aTrim = a.length > 120 ? `${a.slice(0, 117)}...` : a;
      const bTrim = b.length > 120 ? `${b.slice(0, 117)}...` : b;
      return (
        `lines: .md=${mdLines.length} .mdc=${mdcLines.length}; ` +
        `first diff at body line ${i + 1}\n` +
        `      .md  : ${aTrim}\n` +
        `      .mdc : ${bTrim}`
      );
    }
  }
  return `lines: .md=${mdLines.length} .mdc=${mdcLines.length} (bodies equal after normalization but raw bytes differ)`;
}

async function listRulePairs(): Promise<string[]> {
  const entries = await readdir(RULES_DIR);
  return entries
    .filter((name) => name.startsWith("hatch3r-") && name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Extract and parse the leading YAML frontmatter block. Returns an empty
 * object when no frontmatter is present or when parsing fails.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {};
  }
  const afterOpen = content.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return {};
  const closeIdx = content.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return {};
  const fmRaw = content.slice(afterOpen, closeIdx);
  try {
    const parsed = parseYaml(fmRaw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Split a comma-separated glob list into a set, trimming whitespace and
 * stripping surrounding quotes. Returns an empty set for empty input.
 */
function csvToSet(csv: string | undefined): Set<string> {
  if (!csv) return new Set();
  const trimmed = csv.trim().replace(/^["']|["']$/g, "");
  return new Set(trimmed.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Coerce the parsed `globs` value on the `.mdc` side into a set. The
 * canonical form is a JSON array of strings; legacy CSV strings are accepted
 * and flagged separately.
 */
function mdcGlobsToSet(value: unknown): { set: Set<string>; format: "array" | "csv" | "empty" } {
  if (Array.isArray(value)) {
    return { set: new Set(value.filter((g): g is string => typeof g === "string")), format: "array" };
  }
  if (typeof value === "string") {
    return { set: csvToSet(value), format: "csv" };
  }
  return { set: new Set(), format: "empty" };
}

/**
 * Validate that the `.mdc` frontmatter matches the deterministic scope
 * transform of the `.md` side (H16). Returns one drift per violation:
 * description mismatch, alwaysApply mismatch, globs-set mismatch, or
 * bare-CSV globs format.
 */
function checkScopeTransform(
  basename: string,
  mdFm: Record<string, unknown>,
  mdcFm: Record<string, unknown>,
): DriftReport[] {
  const reports: DriftReport[] = [];

  const mdDesc = typeof mdFm.description === "string" ? mdFm.description : "";
  const mdcDesc = typeof mdcFm.description === "string" ? mdcFm.description : "";
  if (mdDesc && mdDesc !== mdcDesc) {
    reports.push({
      basename,
      reason: "description mismatch",
      detail: `.md : ${mdDesc}\n.mdc: ${mdcDesc}`,
    });
  }

  const scope = typeof mdFm.scope === "string" ? mdFm.scope : "";
  const mdGlobsField = typeof mdFm.globs === "string" ? mdFm.globs : "";
  const mdcApply = typeof mdcFm.alwaysApply === "boolean" ? mdcFm.alwaysApply : undefined;
  const { set: mdcGlobs, format: mdcFormat } = mdcGlobsToSet(mdcFm.globs);

  let expectedApply: boolean;
  let expectedGlobs: Set<string>;
  if (scope === "always") {
    expectedApply = true;
    expectedGlobs = new Set();
  } else if (scope === "conditional") {
    expectedApply = false;
    expectedGlobs = csvToSet(mdGlobsField);
  } else if (scope) {
    expectedApply = false;
    expectedGlobs = csvToSet(scope);
  } else {
    expectedApply = false;
    expectedGlobs = new Set();
  }

  if (mdcApply !== expectedApply) {
    reports.push({
      basename,
      reason: "alwaysApply mismatch",
      detail: `expected alwaysApply=${expectedApply} from .md scope="${scope}"; .mdc has alwaysApply=${mdcApply ?? "<absent>"}`,
    });
  }

  const missing = [...expectedGlobs].filter((g) => !mdcGlobs.has(g));
  const extra = [...mdcGlobs].filter((g) => !expectedGlobs.has(g));
  if (missing.length > 0 || extra.length > 0) {
    reports.push({
      basename,
      reason: "globs set mismatch",
      detail: `missing from .mdc: ${JSON.stringify(missing)}; extra in .mdc: ${JSON.stringify(extra)}`,
    });
  }

  if (mdcFormat === "csv" && expectedGlobs.size > 0) {
    reports.push({
      basename,
      reason: "mdc globs format (must be JSON array)",
      detail: `.mdc globs is a bare CSV string; expected array form like ["a", "b"]`,
    });
  }

  return reports;
}

async function checkPair(mdName: string): Promise<DriftReport[]> {
  const basename = mdName.replace(/\.md$/, "");
  const mdPath = join(RULES_DIR, mdName);
  const mdcPath = join(RULES_DIR, `${basename}.mdc`);
  let mdcContent: string;
  try {
    mdcContent = await readFile(mdcPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [{
        basename,
        reason: "missing .mdc counterpart",
        detail: `expected ${mdcPath}`,
      }];
    }
    throw err;
  }
  const mdContent = await readFile(mdPath, "utf-8");
  const reports: DriftReport[] = [];

  const mdBody = normalizeBody(stripFrontmatter(mdContent));
  const mdcBody = normalizeBody(stripFrontmatter(mdcContent));
  if (mdBody !== mdcBody) {
    reports.push({
      basename,
      reason: "body content drift",
      detail: summarizeDiff(mdBody, mdcBody),
    });
  }

  const mdFm = parseFrontmatter(mdContent);
  const mdcFm = parseFrontmatter(mdcContent);
  reports.push(...checkScopeTransform(basename, mdFm, mdcFm));

  return reports;
}

async function main(): Promise<void> {
  const mdNames = await listRulePairs();
  const drifts: DriftReport[] = [];
  for (const name of mdNames) {
    const pairDrifts = await checkPair(name);
    drifts.push(...pairDrifts);
  }
  if (drifts.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `validate:rule-parity: ${mdNames.length} pairs checked, 0 drift`,
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.error(
    `validate:rule-parity: ${drifts.length} of ${mdNames.length} pairs drifted`,
  );
  for (const d of drifts) {
    // eslint-disable-next-line no-console
    console.error(`  - ${d.basename}: ${d.reason}`);
    // eslint-disable-next-line no-console
    console.error(
      d.detail
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n"),
    );
  }
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("validate:rule-parity failed:", err);
  process.exit(1);
});
