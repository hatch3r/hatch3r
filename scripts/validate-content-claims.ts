#!/usr/bin/env node
/**
 * scripts/validate-content-claims.ts — Pillars P5 (Governance Self-Quality),
 * P4 (every body claim earns a backing implementation), P2 (falsifiable).
 * CL-2 D22-12 (Cycle 11): body-claim-vs-`src/` parity probe — the blind spot
 * that let the pre-fix `skills/hatch3r-recipe/SKILL.md` present a phantom
 * recipe-execution runtime (own CLI-flag execution-modes table, "recipe
 * runner", `.hatch3r/recipes/` store) with no registered command (D22-2).
 * Scope: top-level `skills/hatch3r-<x>/SKILL.md` + `commands/hatch3r-<x>.md`
 * (companion dirs out of scope, matching validate-tag-order.ts); fenced code
 * blocks excluded. Findings:
 *
 *   CONTENT-CLAIM-PHANTOM-RUNTIME (ERROR) — (Trigger A or B) AND no-backing:
 *     A: own-invocation flag table — a left-column backtick cell `<cmd> --flag`
 *        (leading `hatch3r ` transparent) or a bare `--flag` cell when the body
 *        elsewhere stakes an own terminal invocation; bare cells alone document
 *        editor slash-command arguments (the legitimate `/report` shape) and
 *        never fire, nor do external-binary-prefixed tokens.
 *     B: a non-negated sentence asserting a self-provided runner/engine/
 *        executor/runtime — own-name compound `<cmd>[- ]<noun>` or a "this
 *        skill/command ships|provides|... <noun>" clause; the CL-2 negation
 *        tokens suppress (the remediated recipe disclaimer stays green).
 *     No-backing: id (prefix-stripped) is NOT a program.ts `.command()`
 *     registration, NOT in AGENT_COMMAND_NAMES, NOT a src/cli/commands module.
 *   CONTENT-CLAIM-PHANTOM-STORE (WARNING) — a non-negated `.hatch3r/<x>/`
 *     reference whose segment appears in no non-test src .ts file AND no
 *     canonical rules|agents|skills|commands line couples the path with a
 *     create/write/append/persist/save/mkdir instruction (agent-materialized
 *     stores like `.hatch3r/feedback/` are self-backing).
 *
 * Usage: `npm run validate:efficiency` | `tsx scripts/validate-content-claims.ts [--json]`
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const EXTERNAL_BIN =
  /^(?:gh|npm|npx|brew|apt|snap|pip|pipx|cargo|go|git|az|glab|docker|node|playwright)\b/;
const NOUN = "(?:runner|engine|executor|runtime)s?";
const NEGATION = /\b(?:no|not|never|ships no|does not|is not|without a)\s|n't\b/i;
const WRITE_VERB = /\b(?:creat|writ|wrote|written|append|persist|sav|mkdir|emit)/i;
const STORE_REF = /\.hatch3r\/([a-z][a-z0-9_-]*)\//g;

type Severity = "error" | "warning";
export interface Finding { level: Severity; code: string; file: string; message: string }
/** rootDir overrides the repo root (test injection); defaults to the package root. */
export interface RunOptions { rootDir?: string }
/** checkedFiles = skill + command bodies scanned. */
export interface RunResult {
  findings: Finding[]; errorCount: number; warningCount: number; checkedFiles: number;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Shared fallback reader. reason: an absent dir/file contributes no artifacts,
// registry entries, or writer evidence — the scan then surfaces the resulting
// unbacked claims as findings; there is no error to channel here (P5).
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return fallback;
  }
}

/** Body after the YAML frontmatter block (whole file when none). */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const close = raw.indexOf("\n---", 3);
  const nl = close === -1 ? -1 : raw.indexOf("\n", close + 1);
  return close === -1 ? raw : nl === -1 ? "" : raw.slice(nl + 1);
}

/** LF-normalized lines with fenced code blocks (and the fence lines) blanked. */
function unfencedLines(body: string): string[] {
  let inFence = false;
  return body.replace(/\r\n/g, "\n").split("\n").map((l) => {
    if (/^\s*(?:```|~~~)/.test(l)) inFence = !inFence;
    else if (!inFence) return l;
    return "";
  });
}

/** Sentence-ish segments of one line (period/!/? boundaries). */
const sentencesOf = (line: string): string[] => line.split(/(?<=[.!?])\s+/);
/** Top-level published artifacts: skills/hatch3r-<x>/SKILL.md + commands/hatch3r-<x>.md. */
async function listArtifacts(root: string): Promise<{ rel: string; cmd: string }[]> {
  const out: { rel: string; cmd: string }[] = [];
  const dirents: Dirent[] = await safe(
    () => readdir(join(root, "skills"), { withFileTypes: true }), []);
  for (const e of dirents) {
    if (e.isDirectory() && e.name.startsWith("hatch3r-"))
      out.push({ rel: `skills/${e.name}/SKILL.md`, cmd: e.name.slice("hatch3r-".length) });
  }
  for (const n of await safe(() => readdir(join(root, "commands")), [] as string[])) {
    if (n.startsWith("hatch3r-") && n.endsWith(".md"))
      out.push({ rel: `commands/${n}`, cmd: n.slice("hatch3r-".length, -3) });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
/** Backed names: program.ts `.command()` registrations + AGENT_COMMAND_NAMES + module stems. */
async function loadBackedNames(root: string): Promise<Set<string>> {
  const backed = new Set<string>();
  const src = await safe(() => readFile(join(root, "src", "cli", "program.ts"), "utf-8"), "");
  for (const m of src.matchAll(/\.command\(\s*"([^"]+)"/g)) backed.add(m[1].split(/[\s[<]/)[0]);
  const setIdx = src.indexOf("AGENT_COMMAND_NAMES = new Set([");
  if (setIdx !== -1) {
    const close = src.indexOf("])", setIdx);
    for (const m of src.slice(setIdx, close === -1 ? undefined : close).matchAll(/"([^"]+)"/g))
      backed.add(m[1]);
  }
  for (const n of await safe(() => readdir(join(root, "src", "cli", "commands")), [] as string[]))
    if (n.endsWith(".ts")) backed.add(kebab(n.slice(0, -3)));
  return backed;
}

/** Recursively collect files with the given extension; `__tests__` dirs skipped. */
async function collectFiles(dir: string, ext: string): Promise<string[]> {
  const entries: Dirent[] = await safe(() => readdir(dir, { withFileTypes: true }), []);
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") out.push(...(await collectFiles(full, ext)));
    } else if (e.isFile() && e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Trigger A: own-invocation flag table (see header). Returns evidence token or null. */
function findTriggerA(lines: string[], cmd: string): string | null {
  const ownCellRe = new RegExp(`^${esc(cmd)}\\s+--[a-z][a-z-]+`);
  const stakeRe = new RegExp(`(?:^|[\\s\`(])(?:hatch3r ${esc(cmd)}\\b|${esc(cmd)} --[a-z][a-z-]+)`);
  let bare: string | null = null;
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) continue;
    const left = line.split(/(?<!\\)\|/)[1] ?? "";
    for (const m of left.matchAll(/`([^`]+)`/g)) {
      let tok = m[1].trim();
      if (tok.startsWith("hatch3r ")) tok = tok.slice("hatch3r ".length);
      if (EXTERNAL_BIN.test(tok)) continue;
      if (ownCellRe.test(tok)) return tok;
      if (bare === null && /^--[a-z][a-z-]+/.test(tok)) bare = tok;
    }
  }
  if (bare === null) return null;
  return lines.some((l) => stakeRe.test(l)) ? bare : null;
}

/** Trigger B: non-negated self-provided runtime sentence. Returns evidence or null. */
function findTriggerB(lines: string[], cmd: string): string | null {
  const compound = new RegExp(`\\b${esc(cmd)}[ -]${NOUN}\\b`, "i");
  const provision = new RegExp(
    `\\bthis (?:skill|command) (?:ships|provides|includes|bundles|implements|runs)\\b[^.;]*\\b${NOUN}\\b`, "i");
  for (const line of lines) {
    for (const s of sentencesOf(line)) {
      if ((compound.test(s) || provision.test(s)) && !NEGATION.test(s))
        return s.trim().slice(0, 120);
    }
  }
  return null;
}

/** Non-negated `.hatch3r/<x>/` references: segment -> evidence sentence. */
function claimedStores(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    for (const s of sentencesOf(line)) {
      for (const m of s.matchAll(STORE_REF)) {
        if (!NEGATION.test(s) && !out.has(m[1])) out.set(m[1], s.trim().slice(0, 100));
      }
    }
  }
  return out;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.rootDir ?? ROOT;
  const findings: Finding[] = [];
  const backed = await loadBackedNames(root);

  let srcBlob = "";
  for (const f of await collectFiles(join(root, "src"), ".ts"))
    srcBlob += (await readFile(f, "utf-8")) + "\n";

  const parsed: { rel: string; cmd: string; lines: string[] }[] = [];
  for (const a of await listArtifacts(root)) {
    const raw = await safe(() => readFile(join(root, a.rel), "utf-8"), null as string | null);
    if (raw === null) continue; // skill dir without SKILL.md carries no body claims
    parsed.push({ ...a, lines: unfencedLines(stripFrontmatter(raw)) });
  }

  // Agent-materialized stores: any canonical line coupling `.hatch3r/<x>/` with a write
  // instruction backs the segment (findings-ledger's "create ... when absent" is the model).
  const agentWritten = new Set<string>();
  const scanWriterLine = (line: string): void => {
    if (!WRITE_VERB.test(line)) return;
    for (const m of line.matchAll(STORE_REF)) agentWritten.add(m[1]);
  };
  for (const p of parsed) for (const l of p.lines) scanWriterLine(l);
  for (const d of ["rules", "agents"]) {
    for (const f of await collectFiles(join(root, d), ".md"))
      for (const l of unfencedLines(await readFile(f, "utf-8"))) scanWriterLine(l);
  }

  for (const p of parsed) {
    if (!backed.has(p.cmd)) {
      const a = findTriggerA(p.lines, p.cmd);
      const b = a === null ? findTriggerB(p.lines, p.cmd) : null;
      if (a !== null || b !== null) {
        const message = a !== null
          ? `own-invocation flag table (\`${a}\`) but \`${p.cmd}\` is no registered command, AGENT_COMMAND_NAMES entry, or src/cli/commands module — strip the phantom CLI surface or register the command`
          : `non-negated self-provided runtime claim ("${b}") but \`${p.cmd}\` has no backing command — negate/remove the claim or register the command`;
        findings.push({ level: "error", code: "CONTENT-CLAIM-PHANTOM-RUNTIME", file: p.rel, message });
      }
    }
    for (const [seg, ev] of claimedStores(p.lines)) {
      if (agentWritten.has(seg)) continue;
      if (new RegExp(`\\.hatch3r/${esc(seg)}\\b|["'/]${esc(seg)}["'/]`).test(srcBlob)) continue;
      findings.push({
        level: "warning", code: "CONTENT-CLAIM-PHANTOM-STORE", file: p.rel,
        message: `references \`.hatch3r/${seg}/\` ("${ev}") but no src/ writer or canonical write-instruction creates it — add the writer or drop the store claim`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.level === "error").length;
  const warningCount = findings.length - errorCount;
  return { findings, errorCount, warningCount, checkedFiles: parsed.length };
}

export function formatFinding(f: Finding): string {
  return `[${f.level === "error" ? "ERROR" : "WARN "} ${f.code}] ${f.file}: ${f.message}`;
}

async function main(): Promise<void> {
  const r = await runValidator();
  if (process.argv.slice(2).includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    for (const f of r.findings)
      (f.level === "error" ? console.error : console.warn)(formatFinding(f));
    console.log(`validate-content-claims: ${r.checkedFiles} skill/command bodies checked ` +
      `against the src/ command registry; ${r.errorCount} error(s), ${r.warningCount} warning(s)`);
  }
  if (r.errorCount > 0) process.exit(1);
}

// Only auto-run as a script, never on test import (argv[1] is a string; resolve cannot throw).
const isMain = resolve(process.argv[1] ?? "") === __filename;

if (isMain) {
  main().catch((err) => {
    console.error("validate-content-claims failed:", err);
    process.exit(1);
  });
}
