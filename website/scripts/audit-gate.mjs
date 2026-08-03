// Website security-audit gate with a root-advisory allowlist.
//
// Reads `npm audit --package-lock-only --json` from stdin and fails (exit 1)
// when any HIGH or CRITICAL advisory is present whose ROOT advisory id is not
// allowlisted. Allowlisting is by root advisory id, not by package: every
// package that merely inherits an allowlisted advisory through its dependency
// chain (the @docusaurus/* propagation set) passes, while a NEW high advisory
// anywhere — including inside the same subtree — still fails the gate.
//
// Release/2.8.6: the allowlist is EMPTY. The 2.8.5 entry (advisory 1124334 /
// GHSA-mh99-v99m-4gvg, brace-expansion DoS on the serve-handler → minimatch
// chain) was removed when upstream backported the fix to the pinned 1.x line
// (brace-expansion 1.1.18 also covers GHSA-rgw5-rvv9-x895) and the website
// lockfile was patched via `npm audit fix --package-lock-only`. Historical
// caution for future entries: npm renumbers advisory ids across database
// refreshes (1124334 became 1130588 for the same GHSA), so a numeric-id entry
// can go stale while the advisory is still live — pair any future entry with
// its GHSA id in the note and treat the stale-entry NOTICE below as "verify
// against the GHSA before removing", not proof the vulnerability is gone.
const ALLOWLIST = new Map([]);

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

// Fail closed on anything that is not a real audit report. npm emits an
// `error` envelope (registry outage, lockfile parse failure) as valid JSON
// with no `vulnerabilities` map — treating that as "zero findings" would
// pass the gate while no audit ran. Require the npm-audit v2 report shape:
// an object `vulnerabilities` map plus the `auditReportVersion`/`metadata`
// markers npm writes on every genuine report.
if (audit.error) {
  console.error(
    `audit-gate: npm audit returned an error envelope (${audit.error.code ?? "unknown"}: ${audit.error.summary ?? ""}) — no audit ran; refusing to pass.`,
  );
  process.exit(1);
}
if (
  typeof audit.vulnerabilities !== "object" ||
  audit.vulnerabilities === null ||
  (audit.auditReportVersion === undefined && audit.metadata === undefined)
) {
  console.error(
    "audit-gate: input lacks the npm-audit report shape (vulnerabilities map + auditReportVersion/metadata) — refusing to pass.",
  );
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
