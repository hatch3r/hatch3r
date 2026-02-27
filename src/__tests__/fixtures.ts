import { fileURLToPath } from "node:url";

/**
 * Resolves a path relative to the caller's file location.
 * Uses new URL() + fileURLToPath for cross-platform support (Windows, Vitest workers).
 */
export function resolveTestPath(importMetaUrl: string, relativePath: string): string {
  return fileURLToPath(new URL(relativePath, importMetaUrl));
}
