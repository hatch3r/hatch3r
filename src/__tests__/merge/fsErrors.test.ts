import { describe, it, expect } from "vitest";
import { mapFsErrno } from "../../merge/fsErrors.js";
import { HatchError } from "../../types.js";

// D8-SA8.2-03 (Cycle 12): mapFsErrno is the shared errno → actionable-message
// mapping extracted from safeWrite.ts. Every recognised errno yields a guided
// FS_ERROR HatchError naming the path; everything else yields null so callers
// re-throw the original error unchanged.

describe("mapFsErrno (D8-SA8.2-03)", () => {
  const mkErrno = (code: string) => Object.assign(new Error(`${code}: raw`), { code });
  const PATH = "/repo/.cursor/rules/10-hatch3r-security.mdc";

  // Every entry of the 8-errno table: [errno, message fragment].
  const CASES: Array<[string, string]> = [
    ["ENOSPC", "Not enough disk space to write"],
    ["EACCES", "Permission denied writing"],
    ["EDQUOT", "Filesystem quota exceeded writing"],
    ["EROFS", "Read-only filesystem at"],
    ["EFBIG", "File too large for the filesystem at"],
    ["EMFILE", "Too many open files writing"],
    ["ENFILE", "System-wide open-file limit reached writing"],
    ["EIO", "Low-level I/O error writing"],
  ];

  it.each(CASES)("maps %s to a guided FS_ERROR naming the path", (code, fragment) => {
    const mapped = mapFsErrno(mkErrno(code), PATH);
    expect(mapped).toBeInstanceOf(HatchError);
    expect(mapped?.errorCode).toBe("FS_ERROR");
    expect(mapped?.message).toContain(fragment);
    expect(mapped?.message).toContain(PATH);
  });

  it("EFBIG names the parent directory as the move target (FAT32 remediation)", () => {
    const mapped = mapFsErrno(mkErrno("EFBIG"), PATH);
    expect(mapped?.message).toContain("/repo/.cursor/rules");
  });

  it("returns null for an unrecognised errno (caller re-throws the original)", () => {
    expect(mapFsErrno(mkErrno("ENOENT"), PATH)).toBeNull();
    expect(mapFsErrno(mkErrno("EBUSY"), PATH)).toBeNull();
  });

  it("returns null for errors without a code, null/undefined, and non-object throwables", () => {
    expect(mapFsErrno(new Error("plain"), PATH)).toBeNull();
    expect(mapFsErrno(null, PATH)).toBeNull();
    expect(mapFsErrno(undefined, PATH)).toBeNull();
    expect(mapFsErrno("string throwable", PATH)).toBeNull();
    expect(mapFsErrno(42, PATH)).toBeNull();
  });
});
