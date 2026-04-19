#!/usr/bin/env node
/**
 * scripts/validate-rule-parity.ts — Cycle 7 H12
 *
 * Enforces that every `rules/hatch3r-*.md` (canonical) and its `.mdc` (Cursor)
 * counterpart share the exact same body content. Frontmatter format may differ
 * (the Markdown variant uses hatch3r YAML keys; the Cursor variant uses MDC
 * description/globs/alwaysApply headers), but the body below the frontmatter
 * must match byte-for-byte after trailing-whitespace normalization.
 *
 * Per .claude/rules/content-authoring.md: "Rules format: Produce both .md
 * (canonical) and .mdc (Cursor) variants with matching content."
 *
 * Pillars: P2 (Scientific Quality), P4 (Lean Coverage).
 *
 * Usage: `npm run validate:rule-parity` (invokes via tsx). Exits 0 on parity,
 * 1 on any drift with a per-pair diff summary.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

async function checkPair(mdName: string): Promise<DriftReport | null> {
  const basename = mdName.replace(/\.md$/, "");
  const mdPath = join(RULES_DIR, mdName);
  const mdcPath = join(RULES_DIR, `${basename}.mdc`);
  let mdcContent: string;
  try {
    mdcContent = await readFile(mdcPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        basename,
        reason: "missing .mdc counterpart",
        detail: `expected ${mdcPath}`,
      };
    }
    throw err;
  }
  const mdContent = await readFile(mdPath, "utf-8");
  const mdBody = normalizeBody(stripFrontmatter(mdContent));
  const mdcBody = normalizeBody(stripFrontmatter(mdcContent));
  if (mdBody === mdcBody) return null;
  return {
    basename,
    reason: "body content drift",
    detail: summarizeDiff(mdBody, mdcBody),
  };
}

async function main(): Promise<void> {
  const mdNames = await listRulePairs();
  const drifts: DriftReport[] = [];
  for (const name of mdNames) {
    const drift = await checkPair(name);
    if (drift) drifts.push(drift);
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
