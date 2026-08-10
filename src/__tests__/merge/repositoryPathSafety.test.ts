import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  assertRepositoryFileUnchanged,
  ensureSafeRepositoryDirectory,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  readRepositoryFileSnapshot,
  removeRepositoryFileIfUnchanged,
  replaceRepositoryFileIfUnchanged,
  UnsafeRepositoryPathError,
} from "../../merge/repositoryPathSafety.js";

describe("repositoryPathSafety", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-safe-path-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("preserves valid legacy relative paths while normalizing separators", () => {
    expect(normalizeRepositoryRelativePath(".agents\\skills\\hatch3r-plan\\SKILL.md"))
      .toBe(".agents/skills/hatch3r-plan/SKILL.md");
    expect(normalizeRepositoryRelativePath("AGENTS.md")).toBe("AGENTS.md");
  });

  it.each([
    "",
    ".",
    "../sentinel",
    "a/../sentinel",
    "a/./sentinel",
    "/tmp/sentinel",
    "C:\\tmp\\sentinel",
    "C:relative",
    "\\windows-rooted\\sentinel",
    "\\\\server\\share\\sentinel",
    "//server/share/sentinel",
    "a//sentinel",
    "a/",
    "a\u0000/sentinel",
    "a\n/sentinel",
  ])("rejects unsafe manifest path %j", (candidate) => {
    expect(() => normalizeRepositoryRelativePath(candidate)).toThrow(UnsafeRepositoryPathError);
  });

  it.runIf(platform() !== "win32")("rejects an ancestor symlink and preserves its outside sentinel", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hatch3r-safe-outside-"));
    try {
      await mkdir(join(outside, "rules"), { recursive: true });
      const sentinel = join(outside, "rules", "hatch3r-sentinel.mdc");
      await writeFile(sentinel, "outside\n");
      await symlink(outside, join(root, ".cursor"));

      await expect(inspectRepositoryPath(root, ".cursor/rules/hatch3r-sentinel.mdc"))
        .rejects.toMatchObject({ reason: "symlink" });
      await expect(ensureSafeRepositoryDirectory(root, ".cursor/new"))
        .rejects.toMatchObject({ reason: "symlink" });
      await expect(readRepositoryFileSnapshot(root, ".cursor/rules/hatch3r-sentinel.mdc"))
        .rejects.toMatchObject({ reason: "symlink" });
      await expect(import("node:fs/promises").then(({ readFile }) => readFile(sentinel, "utf-8")))
        .resolves.toBe("outside\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.runIf(platform() !== "win32")("rejects a dangling ancestor symlink", async () => {
    await symlink(join(root, "missing-target"), join(root, ".codex"));
    await expect(inspectRepositoryPath(root, ".codex/agents/hatch3r-reviewer.toml", { allowMissing: true }))
      .rejects.toMatchObject({ reason: "symlink" });
  });

  it("detects both inode swaps and same-inode content changes before mutation", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    await writeFile(abs, "planned\n");
    const planned = await readRepositoryFileSnapshot(root, rel);

    await writeFile(abs, "changed\n");
    await expect(assertRepositoryFileUnchanged(root, rel, planned.identity))
      .rejects.toMatchObject({ reason: "changed" });

    await writeFile(abs, "planned\n");
    const replacement = join(root, ".cursor", "rules", "replacement.mdc");
    await writeFile(replacement, "planned\n");
    await rename(replacement, abs);
    await expect(assertRepositoryFileUnchanged(root, rel, planned.identity))
      .rejects.toMatchObject({ reason: "changed" });
  });

  it("removes and replaces only the planned inode without leaving quarantine files", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    await writeFile(abs, "old\n");
    const beforeReplace = await readRepositoryFileSnapshot(root, rel);
    await replaceRepositoryFileIfUnchanged(root, rel, beforeReplace.identity, "new\n");
    expect(await readFile(abs, "utf-8")).toBe("new\n");

    const beforeRemove = await readRepositoryFileSnapshot(root, rel);
    await removeRepositoryFileIfUnchanged(root, rel, beforeRemove.identity);
    await expect(readFile(abs, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(root, ".cursor", "rules"))).filter((name) => name.includes("quarantine")))
      .toEqual([]);
  });

  it("does not delete a same-content replacement that appeared after planning", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    await writeFile(abs, "owned\n");
    const planned = await readRepositoryFileSnapshot(root, rel);
    const replacement = join(root, ".cursor", "rules", "replacement.mdc");
    await writeFile(replacement, "owned\n");
    await rename(replacement, abs);

    await expect(removeRepositoryFileIfUnchanged(root, rel, planned.identity))
      .rejects.toMatchObject({ reason: "changed" });
    expect(await readFile(abs, "utf-8")).toBe("owned\n");
  });

  it.runIf(platform() !== "win32")("restores a raced quarantine symlink without following its outside target", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    const outside = await mkdtemp(join(tmpdir(), "hatch3r-safe-outside-"));
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(abs, "owned\n");
    await writeFile(sentinel, "outside\n");
    const planned = await readRepositoryFileSnapshot(root, rel);
    try {
      await expect(removeRepositoryFileIfUnchanged(root, rel, planned.identity, {
        afterQuarantineRename: async ({ quarantineAbsolutePath }) => {
          await rename(quarantineAbsolutePath, `${quarantineAbsolutePath}.displaced`);
          await symlink(sentinel, quarantineAbsolutePath);
        },
      })).rejects.toMatchObject({ reason: "changed" });

      expect((await lstat(abs)).isSymbolicLink()).toBe(true);
      expect(await readlink(abs)).toBe(sentinel);
      expect(await readFile(sentinel, "utf-8")).toBe("outside\n");
      expect((await readdir(join(root, ".cursor", "rules"))).filter((name) =>
        name.includes("hatch3r-quarantine") && !name.endsWith(".displaced"),
      )).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("restores a raced quarantine directory as the exact original-path entry", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    await writeFile(abs, "owned\n");
    const planned = await readRepositoryFileSnapshot(root, rel);

    await expect(removeRepositoryFileIfUnchanged(root, rel, planned.identity, {
      afterQuarantineRename: async ({ quarantineAbsolutePath }) => {
        await rename(quarantineAbsolutePath, `${quarantineAbsolutePath}.displaced`);
        await mkdir(quarantineAbsolutePath);
        await writeFile(join(quarantineAbsolutePath, "sentinel.txt"), "directory\n");
      },
    })).rejects.toMatchObject({ reason: "changed" });

    expect((await lstat(abs)).isDirectory()).toBe(true);
    expect(await readFile(join(abs, "sentinel.txt"), "utf-8")).toBe("directory\n");
  });

  it.runIf(platform() !== "win32")("restores a raced non-regular socket entry without opening it", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    await writeFile(abs, "owned\n");
    const planned = await readRepositoryFileSnapshot(root, rel);
    const server = createServer();
    const socketRoot = await mkdtemp("/tmp/h3r-socket-");
    const sourceSocket = join(socketRoot, "source.sock");
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(sourceSocket, resolveListen);
      });
      await expect(removeRepositoryFileIfUnchanged(root, rel, planned.identity, {
        afterQuarantineRename: async ({ quarantineAbsolutePath }) => {
          await rename(quarantineAbsolutePath, `${quarantineAbsolutePath}.displaced`);
          await rename(sourceSocket, quarantineAbsolutePath);
        },
      })).rejects.toThrow(/non-regular entry/);

      expect((await lstat(abs)).isSocket()).toBe(true);
    } finally {
      if (server.listening) {
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => error ? rejectClose(error) : resolveClose());
        });
      }
      await rm(socketRoot, { recursive: true, force: true });
    }
  });

  it.runIf(platform() !== "win32")("retains and reports a recoverable quarantine when the original path is occupied", async () => {
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    const rel = ".cursor/rules/hatch3r-owned.mdc";
    const abs = join(root, rel);
    const outside = await mkdtemp(join(tmpdir(), "hatch3r-safe-outside-"));
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(abs, "owned\n");
    await writeFile(sentinel, "outside\n");
    const planned = await readRepositoryFileSnapshot(root, rel);
    let quarantinePath = "";
    try {
      await expect(removeRepositoryFileIfUnchanged(root, rel, planned.identity, {
        afterQuarantineRename: async ({ quarantineAbsolutePath, quarantineRelativePath }) => {
          quarantinePath = quarantineRelativePath;
          await rename(quarantineAbsolutePath, `${quarantineAbsolutePath}.displaced`);
          await symlink(sentinel, quarantineAbsolutePath);
          await writeFile(abs, "new owner\n");
        },
      })).rejects.toThrow(/remains recoverable at .*hatch3r-quarantine/);

      expect(await readFile(abs, "utf-8")).toBe("new owner\n");
      expect((await lstat(join(root, quarantinePath))).isSymbolicLink()).toBe(true);
      expect(await readlink(join(root, quarantinePath))).toBe(sentinel);
      expect(await readFile(sentinel, "utf-8")).toBe("outside\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
