// Website security-audit gate with a root-advisory allowlist.
//
// Reads `npm audit --package-lock-only --json` from stdin and fails (exit 1)
// when any HIGH or CRITICAL advisory is present whose ROOT advisory id is not
// allowlisted. Allowlisting is by root advisory id, not by package: every
// package that merely inherits an allowlisted advisory through its dependency
// chain (the @docusaurus/* propagation set) passes, while a NEW high advisory
// anywhere — including inside the same subtree — still fails the gate.
//
// Release/2.8.5 rationale: the only remaining high chain is
// serve-handler → minimatch → brace-expansion(1.x/2.x), rooted in advisory
// 1124334 (GHSA-mh99-v99m-4gvg, brace-expansion DoS via unbounded expansion).
// The 1.x/2.x major lines serve-handler pins have no patched release, so the
// bare `--audit-level=high` gate was permanently red with no action available.
// Remove the allowlist entry when serve-handler/minimatch ship a fixed chain —
// the stale-entry notice below flags exactly when that happens.
const ALLOWLIST = new Map([
  [
    1124334,
    "GHSA-mh99-v99m-4gvg brace-expansion <=2.x DoS — no patched release on the majors serve-handler pins",
  ],
]);

const raw = await new Promise((resolve, reject) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => resolve(buf));
  process.stdin.on("error", reject);
});

let audit;
try {
  audit = JSON.parse(raw);
} catch {
  console.error("audit-gate: stdin was not valid npm-audit JSON — refusing to pass.");
  process.exit(1);
}

const GATED = new Set(["high", "critical"]);
const offenders = [];
const seenAllowlisted = new Set();

for (const [pkg, info] of Object.entries(audit.vulnerabilities ?? {})) {
  for (const via of info.via ?? []) {
    if (typeof via !== "object" || via === null) continue; // string = inherited, judged at its root
    if (!GATED.has(via.severity)) continue;
    if (ALLOWLIST.has(via.source)) {
      seenAllowlisted.add(via.source);
      continue;
    }
    offenders.push(`${via.severity.toUpperCase()} ${pkg}: advisory ${via.source} (${via.url}) — ${via.title}`);
  }
}

for (const [id, note] of ALLOWLIST) {
  if (!seenAllowlisted.has(id)) {
    console.log(
      `audit-gate NOTICE: allowlist entry ${id} (${note}) no longer matches any advisory — the upstream fix landed; remove the entry from website/scripts/audit-gate.mjs.`,
    );
  }
}

if (offenders.length > 0) {
  console.error(`audit-gate FAIL — ${offenders.length} non-allowlisted high/critical advisory(ies):`);
  for (const line of offenders) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(
  `audit-gate PASS — 0 non-allowlisted high/critical advisories (allowlisted roots matched: ${
    [...seenAllowlisted].join(", ") || "none"
  }).`,
);
