import {
  readFile,
  writeFile,
  mkdir,
  access,
  rename,
  unlink,
  open,
  copyFile,
  stat,
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

/**
 * Write a file atomically via tmp+rename with fsync.
 *
 * **Concurrency note:** This function does not use file locking. Running
 * multiple hatch3r processes against the same directory concurrently is
 * unsupported and may produce corrupted output. If you need to sync from
 * multiple terminals, run them sequentially.
 */
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
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") {
      throw new Error(
        `Not enough disk space to write ${filePath}. Free up space and re-run the command.`,
      );
    }
    throw err;
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Temp file already renamed or doesn't exist
    }
  }
}

/**
 * Safely write or merge a file, preserving user content outside managed blocks.
 *
 * **Concurrency note:** This function relies on {@link atomicWriteFile} which
 * does not acquire file locks. Running multiple hatch3r processes (e.g. two
 * terminal tabs running `hatch3r sync`) against the same target directory at
 * the same time is unsupported. To avoid conflicts, run sync operations
 * sequentially. Workspace sync already processes repos one at a time
 * internally, so a single `hatch3r sync --repos` invocation is safe.
 */
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
      // #144 (D19-15): Improved recovery guidance — avoid suggesting init --force
      return {
        path: filePath,
        action: "skipped",
        warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or move your custom content and re-run hatch3r update.`,
      };
    }
    const customContent = extractCustomContent(existingContent);
    const deniedFindings = customContent ? scanForDeniedPatterns(customContent) : [];
    let merged: string;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent);
    } catch {
      // Managed block is corrupted (duplicate markers, wrong order, etc.).
      // Create a .bak backup before overwriting so user content is not lost.
      // #242 (D8-8.9): Verify backup integrity before proceeding with overwrite.
      const bakPath = filePath + ".bak";
      await copyFile(filePath, bakPath);
      const srcStat = await stat(filePath);
      const bakStat = await stat(bakPath);
      if (bakStat.size !== srcStat.size) {
        throw new Error(
          `Backup verification failed for ${filePath}: source=${srcStat.size} bytes, backup=${bakStat.size} bytes. ` +
          `Aborting auto-repair to prevent data loss.`,
        );
      }
      await atomicWriteFile(filePath, content);
      return {
        path: filePath,
        action: "updated",
        warning: `Auto-repaired corrupted managed block in ${filePath} (backup saved to ${bakPath})`,
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

  // #144 (D19-15): Improved recovery guidance — avoid suggesting init --force
  return {
    path: filePath,
    action: "skipped",
    warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or move your custom content and re-run hatch3r update.`,
  };
}

/** Check whether a file path's basename starts with the hatch3r- prefix. */
export function isManagedPath(filePath: string): boolean {
  const fileName = basename(filePath) ?? "";
  return fileName.startsWith(HATCH3R_PREFIX);
}
