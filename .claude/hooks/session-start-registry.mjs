#!/usr/bin/env node
/**
 * SessionStart hook helper — print a one-line audit registry status.
 *
 * Why this script exists (C9-H77, D19-SA19.1-F03)
 * -----------------------------------------------
 * The original `.claude/settings.json` SessionStart hook embedded a Python
 * one-liner that iterated `data` as a flat list:
 *
 *   pending=[e for e in data if e.get('execution_status')=='pending']
 *
 * That worked on the v1 registry (flat array) but the v2 registry wraps
 * entries in a top-level object:
 *
 *   { schema_version: "2.0.0", entries: [...] }
 *
 * Iterating the dict raised `AttributeError: 'str' object has no attribute
 * 'get'`, the `|| echo` swallowed the failure, and every session printed
 * "Registry not found" regardless of actual state.
 *
 * This Node script is the v2-aware replacement. It mirrors
 * `src/hooks/sessionStartRegistry.ts` (the unit-tested module) but lives
 * here as standalone JS so it runs at session start without requiring a
 * prior `npm run build`.
 *
 * Output: a single line on stdout, e.g.
 *   Audit registry v2.0.0: 415 entries, 82 pending (Cycle 9: 80 pending, 0 critical)
 *
 * On any error (missing file, bad JSON), prints a friendly fallback and
 * exits 0 — the hook must never fail the session.
 */

import { readFile } from "node:fs/promises";

const REGISTRY_PATH =
  process.argv[2] ?? "governance/audit/finding-registry.json";

/** Extract cycle from explicit field or finding_id prefix. */
function extractCycle(entry) {
  if (entry && typeof entry.cycle === "number" && Number.isFinite(entry.cycle)) {
    return entry.cycle;
  }
  const id = entry && entry.finding_id;
  if (typeof id !== "string") return null;
  const m = /^C(\d+)(?:\.\d+)?-/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Compute summary numbers from a parsed registry. */
function summarize(reg) {
  const entries = reg && Array.isArray(reg.entries) ? reg.entries : [];
  let currentCycle = null;
  for (const e of entries) {
    const c = extractCycle(e);
    if (c !== null && (currentCycle === null || c > currentCycle)) {
      currentCycle = c;
    }
  }
  let pendingTotal = 0;
  let pendingCurrentCycle = 0;
  let criticalCurrentCycle = 0;
  for (const e of entries) {
    const isPending = e && e.execution_status === "pending";
    if (isPending) pendingTotal += 1;
    if (currentCycle !== null && extractCycle(e) === currentCycle) {
      if (isPending) pendingCurrentCycle += 1;
      if (e && e.severity === "Critical") criticalCurrentCycle += 1;
    }
  }
  return {
    schemaVersion:
      reg && typeof reg.schema_version === "string"
        ? reg.schema_version
        : "unknown",
    totalEntries: entries.length,
    pendingTotal,
    currentCycle,
    pendingCurrentCycle,
    criticalCurrentCycle,
  };
}

/** Render the summary as a single line. */
function format(s) {
  const head = `Audit registry v${s.schemaVersion}: ${s.totalEntries} entries, ${s.pendingTotal} pending`;
  if (s.currentCycle === null) return head;
  return `${head} (Cycle ${s.currentCycle}: ${s.pendingCurrentCycle} pending, ${s.criticalCurrentCycle} critical)`;
}

try {
  const raw = await readFile(REGISTRY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  process.stdout.write(format(summarize(parsed)) + "\n");
} catch (err) {
  // Never fail the session — emit a friendly fallback line. Use err.code
  // to differentiate "file missing" from "parse error" so operators can
  // tell why the hook fell back.
  const code = err && err.code ? err.code : err && err.name ? err.name : "ERR";
  process.stdout.write(`Audit registry unavailable (${code})\n`);
}
