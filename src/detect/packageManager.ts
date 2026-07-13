import { access } from "node:fs/promises";
import { join } from "node:path";
import { verbose } from "../cli/shared/ui.js";

export type PackageManagerName = "bun" | "pnpm" | "yarn" | "npm";

export interface PackageManagerInfo {
  name: PackageManagerName;
  installCmd: string;
  installArgs: string[];
  updateCmd: string;
  updateArgs: string[];
  /**
   * F7 (D1-SA1.6, cycle 10 wave 4): how `name` was determined.
   * - `"lockfile"`: a recognized lockfile was found, so `name` is observed.
   * - `"default"`: no lockfile was found and `name` fell back to npm.
   *
   * Callers that want to message the difference (e.g. a `--verbose`
   * "No lockfile detected — defaulted to npm" hint) read this field; the flat
   * `name` stays a safe default so existing call sites are unaffected.
   */
  source: "lockfile" | "default";
}

// D1-SA1.6-02 (D1, P3): Bun v1.2 (Jan 2025) switched the default lockfile to
// the text-based `bun.lock`; fresh Bun repos ship no `bun.lockb`. Probing only
// the binary form misdetected every Bun >=1.2 repo as npm, which then emitted
// `npm run test`/`npm run lint` into generated agent guidance and drove
// `hatch3r update` with the wrong package manager. Both bun rows stay ahead of
// pnpm/yarn; `bun.lock` (the modern default) is probed first, `bun.lockb`
// (pre-1.2 / migrating repos) second — either resolves to `name: "bun"`.
// Sources: https://bun.com/docs/pm/lockfile ,
// https://bun.com/blog/bun-lock-text-lockfile (accessed 2026-07-09).
const LOCK_FILE_MAP: Array<{ file: string; name: PackageManagerName }> = [
  { file: "bun.lock", name: "bun" },
  { file: "bun.lockb", name: "bun" },
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
];

const PM_INFO: Record<PackageManagerName, Omit<PackageManagerInfo, "name" | "source">> = {
  bun: { installCmd: "bun", installArgs: ["install"], updateCmd: "bun", updateArgs: ["add", "hatch3r@latest"] },
  pnpm: { installCmd: "pnpm", installArgs: ["install"], updateCmd: "pnpm", updateArgs: ["add", "hatch3r@latest"] },
  yarn: { installCmd: "yarn", installArgs: ["install"], updateCmd: "yarn", updateArgs: ["add", "hatch3r@latest"] },
  npm: { installCmd: "npm", installArgs: ["install"], updateCmd: "npm", updateArgs: ["install", "hatch3r@latest"] },
};

/** Detect the project's package manager by checking for lockfile presence. Falls back to npm. */
export async function detectPackageManager(rootDir: string): Promise<PackageManagerInfo> {
  for (const { file, name } of LOCK_FILE_MAP) {
    try {
      await access(join(rootDir, file));
      return { name, ...PM_INFO[name], source: "lockfile" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  // No lockfile matched. npm is the safe default, but flag the fallback so
  // callers can distinguish "detected npm" from "defaulted to npm" (F7).
  // D1-SA1.6-02: the F7 `source` field was previously write-only — no caller
  // surfaced the fallback. Emit a --verbose diagnostic here so an operator
  // debugging wrong-toolchain generation sees that npm was a fallback, not an
  // observed lockfile (Silent Failure Contract). Kept at verbose() level so the
  // common npm-repo case stays quiet by default.
  verbose(
    `detectPackageManager: no recognized lockfile in ${rootDir} — defaulting to npm ` +
      `(bun/pnpm/yarn repos need their lockfile present to be detected)`,
  );
  return { name: "npm", ...PM_INFO.npm, source: "default" };
}
