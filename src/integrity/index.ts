import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

export interface IntegrityManifest {
  version: number;
  generated: string;
  hatchVersion: string;
  files: Record<string, string>;
  checksum?: string;
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
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
      files.push(relPath);
    }
  }
  return files;
}

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

  const checksum = createHmac("sha256", hatchVersion)
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

export async function writeIntegrityManifest(
  agentsDir: string,
  manifest: IntegrityManifest,
): Promise<void> {
  const filePath = join(agentsDir, INTEGRITY_FILE);
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
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
  if ("checksum" in obj && typeof obj.checksum !== "string") return false;
  return true;
}

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

export async function verifyIntegrity(
  agentsDir: string,
): Promise<VerifyResult[]> {
  const manifest = await readIntegrityManifest(agentsDir);
  if (!manifest) {
    return [];
  }

  const results: VerifyResult[] = [];

  if (manifest.checksum !== undefined) {
    const expected = createHmac("sha256", manifest.hatchVersion)
      .update(JSON.stringify(manifest.files))
      .digest("hex");
    if (manifest.checksum !== expected) {
      results.push({ file: INTEGRITY_FILE, status: "tampered" });
      return results;
    }
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
