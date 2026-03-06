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

// On Windows, npm/pnpm/yarn are .cmd wrappers that execFileSync cannot
// resolve without shell:true. Using shell:true triggers npm.ps1 which
// hangs indefinitely (npm/cli#8259). Appending .cmd avoids both issues.
const WIN_EXT = process.platform === "win32" ? ".cmd" : "";

const PM_INFO: Record<PackageManagerName, Omit<PackageManagerInfo, "name">> = {
  bun: { installCmd: "bun", installArgs: ["install"], updateCmd: "bun", updateArgs: ["add", "hatch3r@latest"] },
  pnpm: { installCmd: `pnpm${WIN_EXT}`, installArgs: ["install"], updateCmd: `pnpm${WIN_EXT}`, updateArgs: ["add", "hatch3r@latest"] },
  yarn: { installCmd: `yarn${WIN_EXT}`, installArgs: ["install"], updateCmd: `yarn${WIN_EXT}`, updateArgs: ["add", "hatch3r@latest"] },
  npm: { installCmd: `npm${WIN_EXT}`, installArgs: ["install"], updateCmd: `npm${WIN_EXT}`, updateArgs: ["install", "hatch3r@latest"] },
};

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
