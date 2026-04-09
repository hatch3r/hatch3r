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

  // No pre-release > any pre-release (1.0.0 > 1.0.0-alpha)
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  if (va.pre < vb.pre) return -1;
  if (va.pre > vb.pre) return 1;

  return 0;
}
