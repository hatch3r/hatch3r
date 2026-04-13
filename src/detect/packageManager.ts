import { access } from "node:fs/promises";
import { join } from "node:path";

export type PackageManagerName = "bun" | "pnpm" | "yarn" | "npm";

export interface PackageManagerInfo {
  name: PackageManagerName;
  installCmd: string;
  installArgs: string[];
  updateCmd: string;
  updateArgs: string[];
}

const LOCK_FILE_MAP: Array<{ file: string; name: PackageManagerName }> = [
  { file: "bun.lockb", name: "bun" },
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
];

const PM_INFO: Record<PackageManagerName, Omit<PackageManagerInfo, "name">> = {
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
      return { name, ...PM_INFO[name] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return { name: "npm", ...PM_INFO.npm };
}
