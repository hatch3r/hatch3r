import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatOrphanCleanupDiagnostic } from "../../merge/orphanCleanup.js";

// ───────────────────────────────────────────────────────────────────────────
// Error/edge branch coverage for src/merge/orphanCleanup.ts that the main
// suite does not reach:
//   - safe snapshot non-ENOENT throw → read-failed entry
//   - unlink ENOENT race → missing; unlink non-ENOENT → unlink-failed (289-294)
//   - safe snapshot rejects with a non-Error → String() branch
//   - isPathInKnownAdapterRoot exact-file prefix match (line 147) and the
//     rel === "" guard (line 139)
//   - formatOrphanCleanupDiagnostic e.error ?? e.reason fallback (line 343)
// ───────────────────────────────────────────────────────────────────────────

async function fileExistsOnDisk(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    // Test probe: a missing path is the expected, non-actionable outcome.
    void err;
    return false;
  }
}

describe("sweepOrphansForAdapter — fs error branches (mocked node:fs/promises)", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-errb-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("../../merge/repositoryPathSafety.js");
    vi.resetModules();
  });

  it("marks a candidate read-failed when safe inspection throws a NON-ENOENT error (EACCES)", async () => {
    const relPath = ".cursor/rules/hatch3r-perm.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        readRepositoryFileSnapshot: vi.fn().mockRejectedValue(
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        ),
      };
    });

    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [relPath], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("read-failed");
    expect(entries[0].error).toContain("permission denied");
  });

  it("keeps a second safety snapshot failure in the read-failed phase", async () => {
    const relPath = ".cursor/rules/hatch3r-recheck.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, relPath), "<!-- HATCH3R:BEGIN -->\nx\n<!-- HATCH3R:END -->\n");

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      let reads = 0;
      return {
        ...actual,
        readRepositoryFileSnapshot: vi.fn(async (...args: Parameters<typeof actual.readRepositoryFileSnapshot>) => {
          reads += 1;
          if (reads === 2) {
            throw Object.assign(new Error("recheck denied"), { code: "EACCES" });
          }
          return actual.readRepositoryFileSnapshot(...args);
        }),
      };
    });

    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [relPath], []);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      removed: false,
      reason: "read-failed",
      error: "recheck denied",
    });
    expect(await fileExistsOnDisk(join(tempDir, relPath))).toBe(true);
  });

  it("treats an ENOENT race on unlink as 'missing' (file vanished between exists-check and unlink)", async () => {
    // File exists at the access() check, but unlink() races and reports ENOENT.
    // The unlink catch maps ENOENT → missing (not unlink-failed).
    const relPath = ".cursor/rules/hatch3r-race.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, relPath), "<!-- HATCH3R:BEGIN -->\nx\n<!-- HATCH3R:END -->\n");

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        removeRepositoryFileIfUnchanged: vi.fn().mockRejectedValue(
          Object.assign(new Error("gone"), { code: "ENOENT" }),
        ),
      };
    });

    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [relPath], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("missing");
  });

  it("records 'unlink-failed' with the error message on a non-ENOENT unlink error (EACCES)", async () => {
    const relPath = ".cursor/rules/hatch3r-locked.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, relPath), "<!-- HATCH3R:BEGIN -->\nx\n<!-- HATCH3R:END -->\n");

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        removeRepositoryFileIfUnchanged: vi.fn().mockRejectedValue(
          Object.assign(new Error("EACCES: permission denied, unlink"), { code: "EACCES" }),
        ),
      };
    });

    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [relPath], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("unlink-failed");
    expect(entries[0].error).toContain("permission denied");
    // File still present (the unlink "failed").
    expect(await fileExistsOnDisk(join(tempDir, relPath))).toBe(true);
  });

  it("records 'read-failed' when safe inspection rejects with a NON-Error value (String() branch)", async () => {
    // Rejecting the shared safety read with a plain object (not an Error) exercises the
    // String() fall-through; the result surfaces as a read-failed entry whose
    // `error` is the stringified value.
    const relPath = ".cursor/rules/hatch3r-weird.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, relPath), "content");

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        readRepositoryFileSnapshot: vi.fn().mockRejectedValue({ toString: () => "non-error-read-failure" }),
      };
    });

    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [relPath], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("read-failed");
    expect(entries[0].error).toBe("non-error-read-failure");
  });
});

describe("sweepOrphansForAdapter — isPathInKnownAdapterRoot exact-file + root edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-root-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("accepts an exact-file adapter-root prefix (CLAUDE.md), then rejects on the basename filter", async () => {
    // CLAUDE.md is an exact-file prefix in TOOL_PATH_PREFIXES.claude, so
    // isPathInKnownAdapterRoot returns true via the `posix === prefix` branch
    // (line 147). The basename then fails the hatch3r-* check, yielding
    // `not-managed-basename` — proving the root check passed but the basename
    // soundness check still guards the unlink.
    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    await writeFile(join(tempDir, "CLAUDE.md"), "# user managed file\n");

    const entries = await sweepOrphansForAdapter("claude", tempDir, ["CLAUDE.md"], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("not-managed-basename");
    // The exact-file root path was NOT rejected as outside-adapter-root.
    expect(entries[0].reason).not.toBe("outside-adapter-root");
  });

  it("rejects the repo-root path itself ('.') as outside-adapter-root (rel === '' guard)", async () => {
    // A manifest entry of "." resolves to rootDir; relative(rootDir, rootDir)
    // is "", which the rel === "" guard rejects → not a file path.
    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, ["."], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("outside-adapter-root");
  });

  it("accepts the copilot .vscode/mcp.json exact-file prefix (then basename-rejects)", async () => {
    // Second distinct exact-file prefix to confirm the line-147 branch is not
    // CLAUDE.md-specific.
    const { sweepOrphansForAdapter } = await import("../../merge/orphanCleanup.js");
    await mkdir(join(tempDir, ".vscode"), { recursive: true });
    await writeFile(join(tempDir, ".vscode", "mcp.json"), "{}\n");

    const entries = await sweepOrphansForAdapter(
      "copilot",
      tempDir,
      [".vscode/mcp.json"],
      [],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("not-managed-basename");
  });
});

describe("formatOrphanCleanupDiagnostic — error ?? reason fallback", () => {
  it("falls back to the reason label when a failed entry has no error string", () => {
    // The failed-section formatter uses `${e.error ?? e.reason}`. A
    // unlink-failed / read-failed entry that somehow carries no `error` must
    // still render — with the reason as the fallback label.
    const msg = formatOrphanCleanupDiagnostic([
      {
        adapter: "cursor",
        path: ".cursor/rules/hatch3r-x.mdc",
        removed: false,
        reason: "unlink-failed",
        // no `error` field
      },
    ]);
    expect(msg).toContain("Failed to remove 1 orphan candidate(s)");
    expect(msg).toContain(".cursor/rules/hatch3r-x.mdc");
    // Fallback label is the reason, since error is undefined.
    expect(msg).toContain("unlink-failed");
  });
});
