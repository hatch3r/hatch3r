import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { verbose } from "../cli/shared/ui.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";

function recordCleanProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`clean: ${operation} — ${message}`);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    recordCleanProbeFailure(`fileExists(${path}) — not present`, err);
    return false;
  }
}

export async function rootAgentsMdHasUserContent(rootDir: string): Promise<boolean> {
  const agentsMdPath = join(rootDir, "AGENTS.md");
  if (!(await fileExists(agentsMdPath))) return false;
  try {
    const content = await readFile(agentsMdPath, "utf-8");
    return hasManagedBlock(content, agentsMdPath) &&
      extractCustomContent(content, agentsMdPath).trim().length > 0;
  } catch (err) {
    recordCleanProbeFailure(
      `inventoryArtifacts: readFile(${agentsMdPath}) — treating as no user content`, err,
    );
    return false;
  }
}

/** Legacy compatibility: learnings already remain under `.hatch3r/learnings/`. */
export async function backupLearnings(_rootDir: string): Promise<string | null> {
  return null;
}

/** Legacy compatibility companion to {@link backupLearnings}. */
export async function restoreLearnings(_rootDir: string, _backupPath: string): Promise<void> {
  // intentionally no-op
}
