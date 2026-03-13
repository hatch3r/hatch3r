import {
  readFile,
  writeFile,
  mkdir,
  access,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { HATCH3R_PREFIX, type MergeResult } from "../types.js";
import { insertManagedBlock, hasManagedBlock, extractCustomContent } from "./managedBlocks.js";
import { scanForDeniedPatterns } from "../adapters/customization.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  try {
    await writeFile(tmpPath, content, "utf-8");
    const fh = await open(tmpPath, "r");
    try {
      await fh.datasync();
    } catch (err) {
      // Windows rejects fdatasync on read-only handles (EPERM).
      // The atomic rename provides the safety guarantee; datasync is best-effort.
      if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
    } finally {
      await fh.close();
    }
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      // Retry once for Windows AV locks (EBUSY/EPERM)
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EBUSY" || code === "EPERM") {
        await new Promise((r) => setTimeout(r, 100));
        await rename(tmpPath, filePath);
      } else {
        throw err;
      }
    }
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Temp file already renamed or doesn't exist
    }
  }
}

export async function safeWriteFile(
  filePath: string,
  content: string,
  options: {
    managedContent?: string;
    /** When true, prepend managed block to existing content if file has no markers (init flow). */
    appendIfNoBlock?: boolean;
    /** When true, always write through regardless of filename prefix. */
    force?: boolean;
  } = {},
): Promise<MergeResult> {
  await mkdir(dirname(filePath), { recursive: true });

  const exists = await fileExists(filePath);

  if (!exists) {
    await atomicWriteFile(filePath, content);
    return { path: filePath, action: "created" };
  }

  const existingContent = await readFile(filePath, "utf-8");

  if (options.managedContent) {
    if (!hasManagedBlock(existingContent)) {
      if (options.appendIfNoBlock) {
        const prepended = [content.trim(), "", existingContent.trimStart()].join("\n");
        await atomicWriteFile(filePath, prepended);
        return { path: filePath, action: "updated" };
      }
      return {
        path: filePath,
        action: "skipped",
        warning: `Skipped ${filePath}: existing file without managed block. Run hatch3r init --force to overwrite.`,
      };
    }
    const customContent = extractCustomContent(existingContent);
    const deniedFindings = customContent ? scanForDeniedPatterns(customContent) : [];
    let merged: string;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent);
    } catch {
      // Managed block is corrupted (duplicate markers, wrong order, etc.).
      // Overwrite with fresh content; previous version is recoverable via git.
      await atomicWriteFile(filePath, content);
      return {
        path: filePath,
        action: "updated",
        warning: `Auto-repaired corrupted managed block in ${filePath}`,
      };
    }
    await atomicWriteFile(filePath, merged);
    const result: MergeResult = { path: filePath, action: "updated" };
    if (deniedFindings.length > 0) {
      result.warning = `Content outside managed block in ${filePath} contains suspicious patterns: ${deniedFindings.join("; ")}`;
    }
    return result;
  }

  const fileName = basename(filePath) ?? "";
  const isManagedFile = fileName.startsWith(HATCH3R_PREFIX);

  if (isManagedFile || options.force) {
    await atomicWriteFile(filePath, content);
    return { path: filePath, action: "updated" };
  }

  return {
    path: filePath,
    action: "skipped",
    warning: `Skipped ${filePath}: existing file without managed block. Run hatch3r init --force to overwrite.`,
  };
}

export function isManagedPath(filePath: string): boolean {
  const fileName = basename(filePath) ?? "";
  return fileName.startsWith(HATCH3R_PREFIX);
}
