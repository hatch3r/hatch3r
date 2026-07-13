export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

export function parseVersion(v: string): ParsedVersion {
  const cleaned = v.replace(/^v/, "");
  const [core, pre = ""] = cleaned.split("-", 2);
  const parts = core.split(".");
  return {
    major: parseInt(parts[0] ?? "0", 10) || 0,
    minor: parseInt(parts[1] ?? "0", 10) || 0,
    patch: parseInt(parts[2] ?? "0", 10) || 0,
    pre,
  };
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  for (const key of ["major", "minor", "patch"] as const) {
    if (va[key] < vb[key]) return -1;
    if (va[key] > vb[key]) return 1;
  }

  // No pre-release > any pre-release (1.0.0 > 1.0.0-alpha).
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  if (!va.pre && !vb.pre) return 0;

  // Both carry pre-release identifiers — compare per SemVer 2.0.0 §11.4.
  return comparePreRelease(va.pre, vb.pre);
}

/**
 * Compare two non-empty dot-separated pre-release strings per SemVer 2.0.0 §11.4
 * (https://semver.org/spec/v2.0.0.html, accessed 2026-07-12). Identifiers are
 * compared left to right: all-digit identifiers compare numerically (so
 * `beta.9 < beta.10`), other identifiers compare in ASCII lexical order, a
 * numeric identifier has lower precedence than a non-numeric one at the same
 * position, and when every shared identifier is equal the larger set wins
 * (`alpha < alpha.1`). Release-vs-pre-release ordering is resolved by the caller
 * before this runs, so both arguments are non-empty here.
 */
function comparePreRelease(a: string, b: string): -1 | 0 | 1 {
  const aIds = a.split(".");
  const bIds = b.split(".");
  const shared = Math.min(aIds.length, bIds.length);

  for (let i = 0; i < shared; i++) {
    const ai = aIds[i]!;
    const bi = bIds[i]!;
    if (ai === bi) continue;

    const aNumeric = /^\d+$/.test(ai);
    const bNumeric = /^\d+$/.test(bi);

    if (aNumeric && bNumeric) {
      const an = Number(ai);
      const bn = Number(bi);
      if (an < bn) return -1;
      if (an > bn) return 1;
      continue; // numerically equal (e.g. "01" vs "1") — inspect the next identifier
    }
    if (aNumeric) return -1; // numeric < non-numeric (§11.4.3)
    if (bNumeric) return 1;
    return ai < bi ? -1 : 1; // both non-numeric — ASCII lexical order (§11.4.2)
  }

  // Every shared identifier is equal — the larger set has higher precedence (§11.4.4).
  if (aIds.length < bIds.length) return -1;
  if (aIds.length > bIds.length) return 1;
  return 0;
}
