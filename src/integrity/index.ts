import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { atomicWriteFile } from "../merge/safeWrite.js";

/**
 * Integrity manifest for hatch3r canonical files.
 *
 * **Guarantees:**
 * - Detects unauthorized modifications to hatch3r-managed files (agents, rules, skills, commands, hooks, prompts).
 * - Detects missing or newly added files relative to the last `hatch3r init` or `hatch3r update`.
 * - Manifest-level checksum detects tampering with the integrity file itself.
 *
 * **Limitations:**
 * - Content-addressed only: detects WHAT changed, not WHO or WHEN.
 * - No signing: an attacker with write access can regenerate a valid manifest.
 * - Symlinks are excluded from scanning to prevent symlink-based bypass.
 * - Only scans `.md`, `.mdc`, and `.json` files in designated directories.
 */
export interface IntegrityManifest {
  version: number;
  generated: string;
  hatchVersion: string;
  files: Record<string, string>;
  checksum: string;
}

export interface VerifyResult {
  file: string;
  status: "pass" | "modified" | "missing" | "new" | "tampered";
  expected?: string;
  actual?: string;
}

const INTEGRITY_FILE = ".integrity.json";
const SCANNED_DIRS = ["agents", "commands", "rules", "skills", "hooks", "prompts", "github-agents", "mcp"];

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

async function collectFiles(dir: string, base: string): Promise<string[]> {
  const files: string[] = [];
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return files;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(dir, entry.name);
    const relPath = posix.join(base, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, relPath)));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdc") || entry.name.endsWith(".json"))) {
      files.push(relPath);
    }
  }
  return files;
}

/**
 * Generate an integrity manifest by hashing all canonical files in the .agents directory.
 *
 * Scans `.md`, `.mdc`, and `.json` files in designated subdirectories
 * and produces a SHA-256 hash for each. The manifest-level checksum
 * covers the entire file hash map to detect tampering.
 */
export async function generateIntegrityManifest(
  agentsDir: string,
  hatchVersion: string,
): Promise<IntegrityManifest> {
  const files: Record<string, string> = {};

  for (const dir of SCANNED_DIRS) {
    const dirPath = join(agentsDir, dir);
    const mdFiles = await collectFiles(dirPath, dir);
    for (const relPath of mdFiles) {
      const content = await readFile(join(agentsDir, relPath), "utf-8");
      files[relPath] = sha256(content);
    }
  }

  const checksum = createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex");

  return {
    version: 1,
    generated: new Date().toISOString(),
    hatchVersion,
    files,
    checksum,
  };
}

/** Atomically write the integrity manifest to `.agents/.integrity.json`. */
export async function writeIntegrityManifest(
  agentsDir: string,
  manifest: IntegrityManifest,
): Promise<void> {
  const filePath = join(agentsDir, INTEGRITY_FILE);
  await atomicWriteFile(filePath, JSON.stringify(manifest, null, 2) + "\n");
}

function validateIntegrityManifest(data: unknown): data is IntegrityManifest {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== "number") return false;
  if (typeof obj.generated !== "string") return false;
  if (typeof obj.hatchVersion !== "string") return false;
  if (typeof obj.files !== "object" || obj.files === null) return false;
  for (const val of Object.values(obj.files as Record<string, unknown>)) {
    if (typeof val !== "string") return false;
  }
  if (typeof obj.checksum !== "string") return false;
  return true;
}

/** Read and validate the integrity manifest, returning null if absent or malformed. */
export async function readIntegrityManifest(
  agentsDir: string,
): Promise<IntegrityManifest | null> {
  try {
    const raw = await readFile(join(agentsDir, INTEGRITY_FILE), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!validateIntegrityManifest(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

/**
 * Verify integrity of all canonical files against the stored manifest.
 *
 * Returns an array of per-file results: `pass`, `modified`, `missing`,
 * `new` (file on disk but not in manifest), or `tampered` (manifest
 * checksum mismatch). Returns an empty array if no manifest exists.
 */
export async function verifyIntegrity(
  agentsDir: string,
): Promise<VerifyResult[]> {
  const manifest = await readIntegrityManifest(agentsDir);
  if (!manifest) {
    return [];
  }

  const results: VerifyResult[] = [];

  const expected = createHash("sha256")
    .update(JSON.stringify(manifest.files))
    .digest("hex");
  if (manifest.checksum !== expected) {
    results.push({ file: INTEGRITY_FILE, status: "tampered" });
    return results;
  }
  const manifestFiles = new Set(Object.keys(manifest.files));

  for (const [filePath, expectedHash] of Object.entries(manifest.files)) {
    const fullPath = join(agentsDir, filePath);
    try {
      const content = await readFile(fullPath, "utf-8");
      const actualHash = sha256(content);
      if (actualHash === expectedHash) {
        results.push({ file: filePath, status: "pass" });
      } else {
        results.push({
          file: filePath,
          status: "modified",
          expected: expectedHash,
          actual: actualHash,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        results.push({
          file: filePath,
          status: "missing",
          expected: expectedHash,
        });
      } else {
        throw err;
      }
    }
  }

  for (const dir of SCANNED_DIRS) {
    const dirPath = join(agentsDir, dir);
    const onDisk = await collectFiles(dirPath, dir);
    for (const filePath of onDisk) {
      if (!manifestFiles.has(filePath)) {
        const content = await readFile(join(agentsDir, filePath), "utf-8");
        results.push({
          file: filePath,
          status: "new",
          actual: sha256(content),
        });
      }
    }
  }

  results.sort((a, b) => a.file.localeCompare(b.file));
  return results;
}
