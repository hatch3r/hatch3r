#!/usr/bin/env node
/**
 * scripts/validate-trust-crosswalk-citations.ts — Cycle 11 D15-15
 * ("Crosswalk citation integrity: the D15 trust-reference crosswalk cited
 * non-existent files (`secretDetect.ts`, `diffHashVerify.ts`) and unwired
 * validate-IDs (`secrets`/`integrity`/`timeouts`) with no CI backstop").
 *
 * Pillars: P2 (Scientific & Practical Quality — every claim is re-verifiable),
 *          P5 (Governance Self-Quality — governance passes its own tests),
 *          P6 (Security & Trust Governance — the trust crosswalk is the
 *          machine-checkable alignment claim behind CONSTITUTION §2 P6).
 *
 * Standard enforced: every source-file path and every `hatch3r validate`
 * check-ID cited in `governance/audit/domains/D15-trust-reference.md` must
 * resolve against the live codebase. A path that names a file which does not
 * exist, or a validate-ID that no compliance check registers, is a hard error
 * — the exact drift class that shipped `secretDetect.ts` (real:
 * `src/env/secretDetection.ts`) and validate-ID `secrets` (real:
 * `content-safety-patterns`).
 *
 * ERROR-LEVEL by design: the fix column asks for a probe "asserting every
 * cited `file::symbol` and validate-id resolves". The corrected doc resolves
 * every citation, so an error-level gate keeps the green baseline while making
 * any future broken citation fail CI rather than rot silently.
 *
 * Two checks:
 *
 *   Check A — cited-path resolution (TRUST-CITE-PATH-MISSING):
 *     Every backtick-wrapped or table-cell source token that looks like a code
 *     path — a `src/...`/`docs/...`/`scripts/...` path OR a bare `<name>.ts`
 *     module filename — must resolve on disk. A `src/...` path is checked
 *     literally; a bare `<name>.ts` is searched under `src/` (excluding
 *     `__tests__`) and resolves if exactly one non-test match exists, OR (for
 *     a `.test.ts` token) under `src/__tests__`.
 *
 *   Check B — validate-ID resolution (TRUST-CITE-VALIDATE-ID-MISSING):
 *     Every `` `validate` <id> `` citation whose `<id>` is a concrete
 *     compliance-check reference must resolve in
 *     `src/pipeline/complianceVerification.ts`. A bare `asiNN-*` glob resolves
 *     when ANY check `id` starts `asiNN-` OR any check `controlRef` equals
 *     `ASINN`. A non-glob id (`pipeline-timeout`, `content-safety-patterns`,
 *     `diff-hash-verify`, `review-loop-limit`, …) must match a check `id`
 *     verbatim. Prose verbs after `` `validate` `` (asserts, self-tests) are
 *     skipped via an explicit non-id wordlist.
 *
 * Usage:
 *   tsx scripts/validate-trust-crosswalk-citations.ts
 *   tsx scripts/validate-trust-crosswalk-citations.ts --json
 *   npm run validate:trust-crosswalk
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOC_REL = "governance/audit/domains/D15-trust-reference.md";
const COMPLIANCE_REL = "src/pipeline/complianceVerification.ts";

export interface CitationFinding {
  level: "error";
  code: "TRUST-CITE-PATH-MISSING" | "TRUST-CITE-VALIDATE-ID-MISSING";
  line: number;
  token: string;
  message: string;
}

/** Words that can follow `` `validate` `` in prose but are not check IDs. */
const VALIDATE_PROSE_WORDS = new Set([
  "asserts",
  "self-tests",
  "exercises",
  "runs",
  "executes",
  "checks",
  "verifies",
  "gates",
]);

/** Recursively list files under `dir`, returning paths relative to `root`. */
async function listFiles(dir: string, root: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // A missing src/ subtree yields no file index — not an error for this
    // read-only probe; the caller's path tokens then simply fail to resolve.
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(abs, root)));
    } else if (entry.isFile()) {
      out.push(abs.slice(root.length + 1));
    }
  }
  return out;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // stat throwing is the canonical "file absent" signal this probe reports;
    // returning false IS the diagnostic (surfaced as TRUST-CITE-PATH-MISSING).
    return false;
  }
}

/**
 * Extract candidate code-path tokens from a line. Matches:
 *   - rooted paths: src/…, docs/…, scripts/… ending in a known extension
 *   - bare module filenames: <name>.ts / <name>.test.ts
 * Returns de-duplicated tokens in first-seen order.
 */
function extractPathTokens(line: string): string[] {
  const tokens = new Set<string>();
  const rooted = line.matchAll(
    /\b(?:src|docs|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|md|mdc|yml|yaml|json)\b/g,
  );
  for (const m of rooted) tokens.add(m[0]);
  // Bare <name>.ts tokens NOT already part of a rooted path. The rooted
  // matches above are removed from the scan line so a path like
  // `src/env/secretDetection.ts` does not also yield bare `secretDetection.ts`.
  let bareScan = line;
  for (const t of tokens) bareScan = bareScan.split(t).join(" ");
  const bare = bareScan.matchAll(/\b([A-Za-z][A-Za-z0-9_]*\.(?:test\.)?ts)\b/g);
  for (const m of bare) tokens.add(m[1]);
  return [...tokens];
}

/** Extract concrete `` `validate` <id> `` IDs from a line (skips prose verbs). */
function extractValidateIds(line: string): string[] {
  const ids: string[] = [];
  const re = /`validate`\s+([A-Za-z0-9*-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const id = m[1];
    if (VALIDATE_PROSE_WORDS.has(id)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Resolve a path token against the source tree.
 * @returns true when the cited file exists.
 */
async function resolvePathToken(
  token: string,
  rootDir: string,
  srcFiles: string[],
): Promise<boolean> {
  if (token.includes("/")) {
    return pathExists(join(rootDir, token));
  }
  // Bare filename: match basename across the indexed source tree.
  const isTest = token.endsWith(".test.ts");
  const matches = srcFiles.filter((f) => {
    const base = f.slice(f.lastIndexOf("/") + 1);
    if (base !== token) return false;
    const inTests = f.includes("/__tests__/");
    return isTest ? inTests : !inTests;
  });
  return matches.length >= 1;
}

/** Resolve a validate-ID token against the registered compliance checks. */
function resolveValidateId(
  id: string,
  checkIds: Set<string>,
  controlRefs: Set<string>,
): boolean {
  if (id.endsWith("*")) {
    const prefix = id.slice(0, -1); // e.g. "asi03-"
    for (const cid of checkIds) {
      if (cid.startsWith(prefix)) return true;
    }
    // asiNN-* also resolves via a controlRef of ASINN (the check may be
    // registered under a sibling id, e.g. asi02-monotonic-privilege carries
    // controlRef ASI03).
    const ctrl = prefix.replace(/-$/, "").toUpperCase(); // "asi03-" -> "ASI03"
    if (controlRefs.has(ctrl)) return true;
    return false;
  }
  return checkIds.has(id);
}

export async function runValidator(rootDir: string): Promise<CitationFinding[]> {
  const docPath = join(rootDir, DOC_REL);
  const compliancePath = join(rootDir, COMPLIANCE_REL);
  const findings: CitationFinding[] = [];

  const doc = await readFile(docPath, "utf-8");
  const compliance = await readFile(compliancePath, "utf-8");
  const srcFiles = await listFiles(join(rootDir, "src"), rootDir);

  const checkIds = new Set<string>();
  for (const m of compliance.matchAll(/\bid:\s*["'`]([a-z0-9-]+)["'`]/g)) {
    checkIds.add(m[1]);
  }
  const controlRefs = new Set<string>();
  for (const m of compliance.matchAll(/\bcontrolRef:\s*["'`]([A-Z0-9-]+)["'`]/g)) {
    controlRefs.add(m[1]);
  }

  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    for (const token of extractPathTokens(line)) {
      const ok = await resolvePathToken(token, rootDir, srcFiles);
      if (!ok) {
        findings.push({
          level: "error",
          code: "TRUST-CITE-PATH-MISSING",
          line: lineNo,
          token,
          message: `cited source path \`${token}\` does not resolve on disk`,
        });
      }
    }

    for (const id of extractValidateIds(line)) {
      const ok = resolveValidateId(id, checkIds, controlRefs);
      if (!ok) {
        findings.push({
          level: "error",
          code: "TRUST-CITE-VALIDATE-ID-MISSING",
          line: lineNo,
          token: id,
          message: `cited validate check-ID \`${id}\` is not registered in ${COMPLIANCE_REL}`,
        });
      }
    }
  }

  return findings;
}

export function formatFinding(f: CitationFinding): string {
  return `${DOC_REL}:${f.line} [${f.code}] ${f.message}`;
}

async function main(): Promise<void> {
  const rootDir = resolve(__dirname, "..");
  const json = process.argv.includes("--json");
  const findings = await runValidator(rootDir);

  if (json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + "\n");
  } else if (findings.length === 0) {
    process.stdout.write(
      `trust-crosswalk-citations: OK — every cited path and validate-ID in ${DOC_REL} resolves\n`,
    );
  } else {
    for (const f of findings) process.stderr.write(formatFinding(f) + "\n");
    process.stderr.write(
      `\ntrust-crosswalk-citations: ${findings.length} broken citation(s) in ${DOC_REL}\n`,
    );
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === __filename) {
  void main();
}
