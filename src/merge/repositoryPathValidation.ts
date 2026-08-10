import { HatchError } from "../types.js";

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

export class UnsafeRepositoryPathError extends HatchError {
  readonly reason: "invalid-path" | "symlink" | "outside-root" | "changed";

  constructor(
    path: string,
    reason: UnsafeRepositoryPathError["reason"],
    detail: string,
  ) {
    super(
      `Unsafe repository path ${JSON.stringify(path)}: ${detail}`,
      1,
      "VALIDATION_ERROR",
      "Repair the manifest path or replace symlinked lifecycle targets with regular repository paths, then retry.",
    );
    this.name = "UnsafeRepositoryPathError";
    this.reason = reason;
  }
}

/**
 * Validate and normalize a manifest/output path without touching disk.
 *
 * Existing relative Windows separators are accepted and normalized to `/`.
 * Absolute POSIX, drive-qualified, UNC, dot-segment, control-character, and
 * empty-segment paths are rejected before a caller can join them to the repo.
 */
export function normalizeRepositoryRelativePath(path: string): string {
  if (path.length === 0) {
    throw new UnsafeRepositoryPathError(path, "invalid-path", "the path is empty");
  }
  if (CONTROL_CHAR_RE.test(path)) {
    throw new UnsafeRepositoryPathError(path, "invalid-path", "control characters are not allowed");
  }
  if (
    path.startsWith("/") ||
    WINDOWS_DRIVE_RE.test(path) ||
    path.startsWith("\\") ||
    path.startsWith("//")
  ) {
    throw new UnsafeRepositoryPathError(
      path,
      "invalid-path",
      "absolute, drive-qualified, and UNC paths are not allowed",
    );
  }

  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new UnsafeRepositoryPathError(path, "invalid-path", "empty path segments are not allowed");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new UnsafeRepositoryPathError(
      path,
      "invalid-path",
      "dot and parent-directory segments are not allowed",
    );
  }
  return normalized;
}
