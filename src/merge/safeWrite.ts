import {
  readFile,
  writeFile,
  mkdir,
  access,
  copyFile,
} from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { HATCH3R_PREFIX, type MergeResult } from "../types.js";
import { insertManagedBlock, hasManagedBlock } from "./managedBlocks.js";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function createBackup(filePath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(dirname(filePath), ".backups");
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, `${timestamp}_${basename(filePath)}`);
  await copyFile(filePath, backupPath);
  return backupPath;
}

async function writeWithBackup(
  filePath: string,
  content: string,
  shouldBackup: boolean,
): Promise<MergeResult> {
  if (shouldBackup) {
    const backup = await createBackup(filePath);
    await writeFile(filePath, content, "utf-8");
    return { path: filePath, action: "backed-up", backup };
  }
  await writeFile(filePath, content, "utf-8");
  return { path: filePath, action: "updated" };
}

export async function safeWriteFile(
  filePath: string,
  content: string,
  options: {
    managedContent?: string;
    backup?: boolean;
    /** When true, prepend managed block to existing content if file has no markers (init flow). */
    appendIfNoBlock?: boolean;
  } = {},
): Promise<MergeResult> {
  await mkdir(dirname(filePath), { recursive: true });

  const exists = await fileExists(filePath);

  if (!exists) {
    await writeFile(filePath, content, "utf-8");
    return { path: filePath, action: "created" };
  }

  const existingContent = await readFile(filePath, "utf-8");

  if (options.managedContent) {
    if (!hasManagedBlock(existingContent)) {
      if (options.appendIfNoBlock) {
        const prepended = [content.trim(), "", existingContent.trimStart()].join("\n");
        return writeWithBackup(filePath, prepended, !!options.backup);
      }
      return { path: filePath, action: "skipped" };
    }
    const merged = insertManagedBlock(existingContent, options.managedContent);
    return writeWithBackup(filePath, merged, !!options.backup);
  }

  const fileName = basename(filePath) ?? "";
  const isManagedFile = fileName.startsWith(HATCH3R_PREFIX);

  if (isManagedFile) {
    return writeWithBackup(filePath, content, !!options.backup);
  }

  return { path: filePath, action: "skipped" };
}

export function isManagedPath(filePath: string): boolean {
  const fileName = basename(filePath) ?? "";
  return fileName.startsWith(HATCH3R_PREFIX);
}
