import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../types.js";

export function insertManagedBlock(
  existingContent: string,
  managedContent: string,
): string {
  const startIdx = existingContent.indexOf(MANAGED_BLOCK_START);
  const endIdx = existingContent.indexOf(MANAGED_BLOCK_END);

  const block = `${MANAGED_BLOCK_START}\n${managedContent}\n${MANAGED_BLOCK_END}`;

  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Content must contain managed block markers");
  }

  if (startIdx >= endIdx) {
    throw new Error("Corrupted managed block: start marker must appear before end marker");
  }

  const before = existingContent.substring(0, startIdx);
  const after = existingContent.substring(endIdx + MANAGED_BLOCK_END.length);
  return `${before}${block}${after}`;
}

export function extractManagedBlock(content: string): string | null {
  const startIdx = content.indexOf(MANAGED_BLOCK_START);
  const endIdx = content.indexOf(MANAGED_BLOCK_END);

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  return content
    .substring(startIdx + MANAGED_BLOCK_START.length, endIdx)
    .trim();
}

export function extractCustomContent(content: string): string {
  const startIdx = content.indexOf(MANAGED_BLOCK_START);
  const endIdx = content.indexOf(MANAGED_BLOCK_END);

  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const before = content.substring(0, startIdx).trim();
  const after = content.substring(endIdx + MANAGED_BLOCK_END.length).trim();
  return [before, after].filter(Boolean).join("\n\n");
}

export function wrapInManagedBlock(content: string): string {
  return `${MANAGED_BLOCK_START}\n${content}\n${MANAGED_BLOCK_END}`;
}

export function hasManagedBlock(content: string): boolean {
  return (
    content.includes(MANAGED_BLOCK_START) &&
    content.includes(MANAGED_BLOCK_END)
  );
}
