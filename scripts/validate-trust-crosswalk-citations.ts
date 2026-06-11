#!/usr/bin/env node
/**
 * scripts/validate-trust-crosswalk-citations.ts — Cycle 11 D15-15 + D15-23
 * D15-15 ("Crosswalk citation integrity: the D15 trust-reference crosswalk
 * cited non-existent files (`secretDetect.ts`, `diffHashVerify.ts`) and unwired
 * validate-IDs (`secrets`/`integrity`/`timeouts`) with no CI backstop").
 * D15-23 ("Dangling + stale code citations in `pack-trust-model.md`: cites
 * `add.ts::preflightIntegrityCheck` (0 hits) + drifted `file:LINE` citations
 * (`scanForDeniedPatterns` cited `:340`, actually moved); fix: cite by symbol
 * not line; add a CI probe asserting cited `file::symbol` references resolve").
 *
 * Pillars: P2 (Scientific & Practical Quality — every claim is re-verifiable),
 *          P5 (Governance Self-Quality — governance passes its own tests),
 *          P6 (Security & Trust Governance — the trust docs are the
 *          machine-checkable alignment claim behind CONSTITUTION §2 P6).
 *
 * Standard enforced: every source-file path, every `hatch3r validate`
 * check-ID, and every `file::symbol` reference cited in the two trust-model
 * documents (`governance/audit/domains/D15-trust-reference.md` and
 * `governance/pack-trust-model.md`) must resolve against the live codebase. A
 * path that names a file which does not exist, a validate-ID that no compliance
 * check registers, or a `file::symbol` whose symbol is not defined in that file
 * is a hard error — the exact drift class that shipped `secretDetect.ts` (real:
 * `src/env/secretDetection.ts`), validate-ID `secrets` (real:
 * `content-safety-patterns`), and `add.ts::preflightIntegrityCheck` (the symbol
 * was deleted with the integrity subsystem but the citation rotted in place).
 *
 * Citing by symbol instead of by line number (D15-23 fix) makes a citation
 * survive any line-shifting edit to the cited file while staying CI-verifiable:
 * Check C resolves the symbol against its definition, not a brittle line range.
 *
 * ERROR-LEVEL by design: the fix column asks for a probe "asserting every
 * cited `file::symbol` and validate-id resolves". The corrected docs resolve
 * every citation, so an error-level gate keeps the green baseline while making
 * any future broken citation fail CI rather than rot silently.
 *
 * Three checks:
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
 *   Check C — file::symbol resolution (TRUST-CITE-SYMBOL-MISSING):
 *     Every `` `<path>.ts::<symbol>` `` citation must (1) resolve its file like
 *     Check A — a rooted `src/...` path literally, or a bare `<name>.ts`
 *     basename uniquely under `src/` — and (2) define `<symbol>` in that file
 *     as a top-level `function`/`const`/`let`/`class`/`interface`/`type`/`enum`
 *     declaration OR an exported-object property key (`<symbol>:`). A path that
 *     resolves but whose symbol is absent, or a path that does not resolve, is
 *     an error. This is the D15-23 backstop: it catches a deleted symbol
 *     (`preflightIntegrityCheck`) that a line-number citation could never flag.
 *
 * Usage:
 *   tsx scripts/validate-trust-crosswalk-citations.ts
 *   tsx scripts/validate-trust-crosswalk-citations.ts --json
 *   npm run validate:trust-crosswalk
 */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Documents whose citations this probe verifies. D15-trust-reference.md is
 * checked for all three checks; pack-trust-model.md is checked for Check A
 * (paths) and Check C (file::symbol). Check B (validate-IDs) is specific to the
 * trust-reference crosswalk and does not appear in pack-trust-model.md.
 */
const CROSSWALK_DOC_REL = "governance/audit/domains/D15-trust-reference.md";
const PACK_TRUST_DOC_REL = "governance/pack-trust-model.md";
const DOC_RELS: readonly string[] = [CROSSWALK_DOC_REL, PACK_TRUST_DOC_REL];

const COMPLIANCE_REL = "src/pipeline/complianceVerification.ts";

export interface CitationFinding {
  level: "error";
  code:
    | "TRUST-CITE-PATH-MISSING"
    | "TRUST-CITE-VALIDATE-ID-MISSING"
    | "TRUST-CITE-SYMBOL-MISSING";
  /** Repo-relative path of the document carrying the offending citation. */
  doc: string;
  line: number;
  token: string;
  message: string;
}

/**
 * Repo-relative path in POSIX (`/`) form regardless of host OS. The source-file
 * index this builds is consumed with `/`-based string ops (`lastIndexOf("/")`
 * for the basename, `includes("/__tests__/")` for the test-tree split), so a
 * Windows `\` separator would break every bare-filename and `.test.ts`
 * resolution. Normalizing at the index-emit site fixes both consumers.
 */
function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
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
      out.push(toPosixRel(abs, root));
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

/** A `file::symbol` citation split into its parts. */
interface SymbolCitation {
  /** The cited `.ts` path or bare module filename. */
  filePath: string;
  /** The referenced symbol name. */
  symbol: string;
  /** The full backticked token, for diagnostics. */
  token: string;
}

/**
 * Extract `` `<path>.ts::<symbol>` `` citations from a line. Only matches inside
 * backticks (so it never fires on prose like "the `preflightIntegrityCheck`
 * symbol"). The path may be rooted (`src/.../foo.ts`) or a bare basename
 * (`selfUpdate.ts`). Returns de-duplicated citations in first-seen order.
 */
function extractSymbolCitations(line: string): SymbolCitation[] {
  const seen = new Set<string>();
  const out: SymbolCitation[] = [];
  const re = /`([A-Za-z0-9_./-]+\.tsx?)::([A-Za-z_$][A-Za-z0-9_$]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const token = m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ filePath: m[1], symbol: m[2], token });
  }
  return out;
}

/**
 * Read a cited file (rooted path or unique bare basename under `src/`) and
 * return its text, or `null` when the path does not resolve to exactly one
 * file. Mirrors Check A's resolution rules so a `file::symbol` whose file is
 * missing is reported as a symbol-citation failure (single, actionable code).
 */
async function readCitedFile(
  filePath: string,
  rootDir: string,
  srcFiles: string[],
): Promise<string | null> {
  let abs: string | null = null;
  if (filePath.includes("/")) {
    abs = join(rootDir, filePath);
    if (!(await pathExists(abs))) return null;
  } else {
    const isTest = filePath.endsWith(".test.ts");
    const matches = srcFiles.filter((f) => {
      const base = f.slice(f.lastIndexOf("/") + 1);
      if (base !== filePath) return false;
      const inTests = f.includes("/__tests__/");
      return isTest ? inTests : !inTests;
    });
    if (matches.length !== 1) return null;
    abs = join(rootDir, matches[0]);
  }
  try {
    return await readFile(abs, "utf-8");
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // A file that indexed but failed to read is treated as unresolvable; the
    // null return surfaces as TRUST-CITE-SYMBOL-MISSING, the intended signal.
    return null;
  }
}

/**
 * Whether `symbol` is defined in `fileText` as a top-level declaration
 * (`function`/`const`/`let`/`var`/`class`/`interface`/`type`/`enum`, optionally
 * `export`/`export default`/`async`) OR as an object-literal property key
 * (`symbol:` or `symbol(` method shorthand). The property-key form covers
 * exported maps and `ADAPTER_CAPABILITIES`-style records whose members the docs
 * cite as `file::member`.
 */
function definesSymbol(fileText: string, symbol: string): boolean {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declRe = new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?` +
      `(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${esc}\\b`,
    "m",
  );
  if (declRe.test(fileText)) return true;
  // Object-literal property key or method shorthand: `  symbol: ...` /
  // `  symbol(...)` / `  "symbol": ...`. Anchored to a line start + indentation
  // so it does not match the symbol appearing mid-expression as a call.
  const propRe = new RegExp(`^\\s*["'\`]?${esc}["'\`]?\\s*[:(]`, "m");
  return propRe.test(fileText);
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
  const compliancePath = join(rootDir, COMPLIANCE_REL);
  const findings: CitationFinding[] = [];

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

  // Cache cited-file contents across docs — multiple `file::symbol` citations
  // commonly point at the same module (e.g. customization.ts).
  const fileCache = new Map<string, string | null>();
  const resolveFileText = async (filePath: string): Promise<string | null> => {
    if (fileCache.has(filePath)) return fileCache.get(filePath) ?? null;
    const text = await readCitedFile(filePath, rootDir, srcFiles);
    fileCache.set(filePath, text);
    return text;
  };

  for (const docRel of DOC_RELS) {
    // The trust docs are private overlay IP (governance privatization
    // initiative, 2026-06-03), gitignored and absent in public clones /
    // contributor CI. An absent doc has no citations to verify — skip it (the
    // run then yields no findings for that doc, exiting clean) rather than
    // ENOENT. Mirrors scripts/validate-governance-total.ts. When the docs ARE
    // present (local dev, fixtures), every citation is checked unchanged.
    const docPath = join(rootDir, docRel);
    if (!existsSync(docPath)) continue;
    const doc = await readFile(docPath, "utf-8");
    const lines = doc.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;

      // Check A — cited source paths (both docs).
      for (const token of extractPathTokens(line)) {
        const ok = await resolvePathToken(token, rootDir, srcFiles);
        if (!ok) {
          findings.push({
            level: "error",
            code: "TRUST-CITE-PATH-MISSING",
            doc: docRel,
            line: lineNo,
            token,
            message: `cited source path \`${token}\` does not resolve on disk`,
          });
        }
      }

      // Check B — validate check-IDs (crosswalk doc only; pack-trust-model.md
      // carries no `` `validate` <id> `` citations).
      if (docRel === CROSSWALK_DOC_REL) {
        for (const id of extractValidateIds(line)) {
          const ok = resolveValidateId(id, checkIds, controlRefs);
          if (!ok) {
            findings.push({
              level: "error",
              code: "TRUST-CITE-VALIDATE-ID-MISSING",
              doc: docRel,
              line: lineNo,
              token: id,
              message: `cited validate check-ID \`${id}\` is not registered in ${COMPLIANCE_REL}`,
            });
          }
        }
      }

      // Check C — file::symbol citations (both docs).
      for (const cite of extractSymbolCitations(line)) {
        const fileText = await resolveFileText(cite.filePath);
        if (fileText === null) {
          findings.push({
            level: "error",
            code: "TRUST-CITE-SYMBOL-MISSING",
            doc: docRel,
            line: lineNo,
            token: cite.token,
            message: `cited \`${cite.token}\` — file \`${cite.filePath}\` does not resolve on disk`,
          });
          continue;
        }
        if (!definesSymbol(fileText, cite.symbol)) {
          findings.push({
            level: "error",
            code: "TRUST-CITE-SYMBOL-MISSING",
            doc: docRel,
            line: lineNo,
            token: cite.token,
            message: `cited \`${cite.token}\` — symbol \`${cite.symbol}\` is not defined in \`${cite.filePath}\``,
          });
        }
      }
    }
  }

  return findings;
}

export function formatFinding(f: CitationFinding): string {
  return `${f.doc}:${f.line} [${f.code}] ${f.message}`;
}

async function main(): Promise<void> {
  const rootDir = resolve(__dirname, "..");
  const json = process.argv.includes("--json");

  // Both trust docs are private overlay IP, gitignored and absent in public
  // clones / contributor CI. With neither doc to verify, skip the whole check
  // (exit clean) — mirroring scripts/validate-governance-total.ts.
  const anyDocPresent = DOC_RELS.some((rel) => existsSync(join(rootDir, rel)));
  if (!anyDocPresent) {
    if (json) {
      process.stdout.write(JSON.stringify({ skipped: true, findings: [] }, null, 2) + "\n");
    } else {
      process.stdout.write(
        `trust-crosswalk-citations: skipped — ${CROSSWALK_DOC_REL} absent (private-corpus public CI)\n`,
      );
    }
    process.exit(0);
  }

  const findings = await runValidator(rootDir);

  if (json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + "\n");
  } else if (findings.length === 0) {
    process.stdout.write(
      `trust-crosswalk-citations: OK — every cited path, validate-ID, and file::symbol in ${DOC_RELS.join(" + ")} resolves\n`,
    );
  } else {
    for (const f of findings) process.stderr.write(formatFinding(f) + "\n");
    process.stderr.write(
      `\ntrust-crosswalk-citations: ${findings.length} broken citation(s) across ${DOC_RELS.length} doc(s)\n`,
    );
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === __filename) {
  void main();
}
