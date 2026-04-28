import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPackageManager, type PackageManagerName } from "./packageManager.js";

export type InstallKind = "npx" | "global" | "project-local" | "dev-source";

export interface InstallLocation {
  kind: InstallKind;
  binPath: string;
  packageRoot: string;
  packageManager: PackageManagerName;
  version: string | null;
}

export interface InstallSurvey {
  invokedFrom: InstallLocation;
  alsoPresent: InstallLocation[];
}

const NPX_CACHE_SEGMENTS = [
  join(sep, ".npm", "_npx"),
  join(sep, "npm-cache", "_npx"),
];

function isNpxPath(p: string): boolean {
  const norm = normalize(p);
  return NPX_CACHE_SEGMENTS.some((seg) => norm.includes(seg));
}

function readPackageVersion(packageRoot: string): string | null {
  try {
    const raw = readFileSync(join(packageRoot, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
    // Missing or malformed package.json at a probed path is the expected
    // negative case (we probe paths speculatively). Returning null is the
    // sentinel the survey expects for "no version known".
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return null;
  }
}

function findUpwardsPackageRoot(startDir: string, packageName: string): string | null {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(raw) as { name?: string };
        if (parsed.name === packageName) return dir;
        // Walking upward, hitting an unrelated/malformed package.json on the
        // way to the target is normal. Silent skip is correct: the loop
        // continues to the parent directory until either match or root.
        // eslint-disable-next-line silent-failure/no-silent-catch
      } catch {
        // intentional no-op: continue traversal
      }
    }
    dir = dirname(dir);
  }
  return null;
}

let cachedNpmGlobalRoot: string | null | undefined;

function npmGlobalRoot(): string | null {
  if (cachedNpmGlobalRoot !== undefined) return cachedNpmGlobalRoot;
  try {
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const out = execFileSync(cmd, ["root", "-g"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    cachedNpmGlobalRoot = out.toString("utf-8").trim() || null;
  } catch {
    cachedNpmGlobalRoot = null;
  }
  return cachedNpmGlobalRoot;
}

/** Reset the cached `npm root -g` lookup. Test-only. */
export function _resetNpmGlobalRootCacheForTesting(): void {
  cachedNpmGlobalRoot = undefined;
}

function classifyInvocation(binPath: string, projectRoot: string): InstallKind {
  if (isNpxPath(binPath)) return "npx";
  const globalRoot = npmGlobalRoot();
  if (globalRoot && binPath.startsWith(globalRoot)) return "global";
  const projectNodeModules = join(projectRoot, "node_modules") + sep;
  if (binPath.startsWith(projectNodeModules)) return "project-local";
  return "dev-source";
}

async function buildLocation(
  kind: InstallKind,
  binPath: string,
  packageRoot: string,
  cwdForPmDetection: string,
): Promise<InstallLocation> {
  // Global installs are owned by the system npm; project-local installs use
  // the project's detected package manager (matches existing
  // detectPackageManager semantics in src/detect/packageManager.ts).
  let packageManager: PackageManagerName = "npm";
  if (kind === "project-local") {
    const pm = await detectPackageManager(cwdForPmDetection);
    packageManager = pm.name;
  }
  return {
    kind,
    binPath,
    packageRoot,
    packageManager,
    version: readPackageVersion(packageRoot),
  };
}

function locateInvokedFromPackageRoot(): string {
  // The CLI bin lives at <pkgRoot>/dist/cli/index.js. Resolve from this file.
  const here = fileURLToPath(import.meta.url);
  // src/detect/installContext.ts is two levels under <pkgRoot>/src/, so the
  // built copy at dist/cli/installContext.js is one level under dist/cli/.
  // We climb upwards until we find a package.json named "hatch3r".
  const root = findUpwardsPackageRoot(dirname(here), "hatch3r");
  return root ?? resolve(dirname(here), "..", "..");
}

/**
 * Survey every hatch3r install reachable from the running process: the one
 * that invoked us (always present) and any *other* install of the same
 * package on the system. The intent is to give `hatch3r update` enough
 * information to refresh both a global install and a project-local install
 * in a single command.
 *
 * Cross-platform notes:
 * - npm root -g is shelled out to (5s timeout). Failure is non-fatal — we
 *   simply skip the global probe.
 * - Bun/pnpm/yarn globals live in different roots and are out of scope for
 *   v1; the survey assumes npm for global installs.
 */
export async function surveyInstalls(rootDir: string): Promise<InstallSurvey> {
  const binPath = process.argv[1] ?? "";
  const invokedKind = classifyInvocation(binPath, rootDir);
  const invokedRoot = locateInvokedFromPackageRoot();

  const invokedFrom = await buildLocation(
    invokedKind,
    binPath,
    invokedRoot,
    rootDir,
  );

  const alsoPresent: InstallLocation[] = [];

  // Probe the *other* install kind. If invoked globally, look for a
  // project-local install in rootDir; if invoked from anywhere else, also
  // probe for a global install.
  if (invokedKind !== "project-local") {
    const projectPkgRoot = join(rootDir, "node_modules", "hatch3r");
    if (existsSync(join(projectPkgRoot, "package.json"))) {
      const projectBin = join(projectPkgRoot, "dist", "cli", "index.js");
      alsoPresent.push(
        await buildLocation("project-local", projectBin, projectPkgRoot, rootDir),
      );
    }
  }
  if (invokedKind !== "global") {
    const globalRoot = npmGlobalRoot();
    if (globalRoot) {
      const globalPkgRoot = join(globalRoot, "hatch3r");
      if (existsSync(join(globalPkgRoot, "package.json"))) {
        const globalBin = join(globalPkgRoot, "dist", "cli", "index.js");
        alsoPresent.push(
          await buildLocation("global", globalBin, globalPkgRoot, rootDir),
        );
      }
    }
  }

  return { invokedFrom, alsoPresent };
}
