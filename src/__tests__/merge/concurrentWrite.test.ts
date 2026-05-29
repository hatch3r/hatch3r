import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { atomicWriteFile, safeWriteFile } from "../../merge/safeWrite.js";

describe("concurrent write safety", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempDir(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-concurrent-"));
    return tempDir;
  }

  // ── atomicWriteFile basic safety ─────────────────────────────

  describe("atomicWriteFile", () => {
    it("writes file content atomically", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "atomic.txt");

      await atomicWriteFile(filePath, "atomic content");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("atomic content");
    });

    it("does not leave temp files on success", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "clean.txt");

      await atomicWriteFile(filePath, "clean write");

      const files = await readdir(dir);
      expect(files).toEqual(["clean.txt"]);
    });

    it("overwrites existing file atomically", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "overwrite.txt");

      await writeFile(filePath, "original", "utf-8");
      await atomicWriteFile(filePath, "replaced");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("replaced");
    });

    it("produces complete file content (not partial writes)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "large.txt");

      // Write a large content string
      const largeContent = "A".repeat(100_000) + "\n" + "B".repeat(100_000);
      await atomicWriteFile(filePath, largeContent);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe(largeContent);
      expect(content.length).toBe(largeContent.length);
    });
  });

  // ── Parallel atomicWriteFile to same file ────────────────────

  describe("parallel writes to same file", () => {
    it("all parallel writes complete without error", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "parallel.txt");

      const writes = Array.from({ length: 10 }, (_, i) =>
        atomicWriteFile(filePath, `writer-${i}\n`),
      );

      // All writes should resolve without throwing
      await expect(Promise.all(writes)).resolves.toBeDefined();

      // File should exist with one of the writer's content (last writer wins)
      const content = await readFile(filePath, "utf-8");
      expect(content).toMatch(/^writer-\d+\n$/);
    });

    it("file is never empty or corrupted after parallel writes", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "integrity.txt");

      // Each writer writes a different payload
      const payloads = Array.from({ length: 20 }, (_, i) =>
        `content-${i}-${"x".repeat(1000)}`,
      );

      const writes = payloads.map((payload) =>
        atomicWriteFile(filePath, payload),
      );

      await Promise.all(writes);

      const content = await readFile(filePath, "utf-8");
      // Content must be exactly one of the payloads (not a partial mix)
      expect(payloads).toContainEqual(content);
    });

    it("no temp files remain after parallel writes", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "no-leftovers.txt");

      const writes = Array.from({ length: 10 }, (_, i) =>
        atomicWriteFile(filePath, `data-${i}`),
      );

      await Promise.all(writes);

      const files = await readdir(dir);
      // Only the target file should remain, no .tmp files
      expect(files).toEqual(["no-leftovers.txt"]);
    });
  });

  // ── Parallel writes to different files ───────────────────────

  describe("parallel writes to different files", () => {
    it("writes to separate files concurrently without interference", async () => {
      const dir = await createTempDir();

      const writes = Array.from({ length: 10 }, (_, i) => {
        const path = join(dir, `file-${i}.txt`);
        return atomicWriteFile(path, `content-${i}`);
      });

      await Promise.all(writes);

      // Verify each file has its correct content
      for (let i = 0; i < 10; i++) {
        const content = await readFile(join(dir, `file-${i}.txt`), "utf-8");
        expect(content).toBe(`content-${i}`);
      }
    });
  });

  // ── Parallel safeWriteFile (higher-level) ────────────────────

  describe("parallel safeWriteFile", () => {
    it("creates multiple new files in parallel without corruption", async () => {
      const dir = await createTempDir();

      const writes = Array.from({ length: 10 }, (_, i) => {
        const path = join(dir, `safe-${i}.md`);
        return safeWriteFile(path, `safe content ${i}`);
      });

      const results = await Promise.all(writes);

      // All should be created
      for (const result of results) {
        expect(result.action).toBe("created");
      }

      // Verify content integrity
      for (let i = 0; i < 10; i++) {
        const content = await readFile(join(dir, `safe-${i}.md`), "utf-8");
        expect(content).toBe(`safe content ${i}`);
      }
    });

    it("parallel writes to managed files overwrite correctly", async () => {
      const dir = await createTempDir();

      // Pre-create managed files
      for (let i = 0; i < 5; i++) {
        await writeFile(join(dir, `hatch3r-rule-${i}.md`), `old-${i}`, "utf-8");
      }

      const writes = Array.from({ length: 5 }, (_, i) => {
        const path = join(dir, `hatch3r-rule-${i}.md`);
        return safeWriteFile(path, `new-${i}`);
      });

      const results = await Promise.all(writes);

      for (const result of results) {
        expect(result.action).toBe("updated");
      }

      for (let i = 0; i < 5; i++) {
        const content = await readFile(join(dir, `hatch3r-rule-${i}.md`), "utf-8");
        expect(content).toBe(`new-${i}`);
      }
    });

    it("parallel safeWriteFile to nested directories creates all parents", async () => {
      const dir = await createTempDir();

      const writes = Array.from({ length: 5 }, (_, i) => {
        const path = join(dir, `nested-${i}`, "deep", "file.md");
        return safeWriteFile(path, `nested-${i}`);
      });

      const results = await Promise.all(writes);

      for (let i = 0; i < 5; i++) {
        expect(results[i].action).toBe("created");
        const content = await readFile(join(dir, `nested-${i}`, "deep", "file.md"), "utf-8");
        expect(content).toBe(`nested-${i}`);
      }
    });
  });

  // ── Rapid sequential writes ──────────────────────────────────

  describe("rapid sequential writes", () => {
    it("each sequential write fully replaces the previous content", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "rapid.txt");

      for (let i = 0; i < 20; i++) {
        await atomicWriteFile(filePath, `iteration-${i}`);
      }

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("iteration-19");
    });

    // D3-SA3.4-F9 (Cycle 10 Wave 4, P2): positive ordering contract for
    // sequentially-awaited writes. Complements the concurrent "any-writer-wins"
    // tests above (which assert no-corruption but NOT which writer wins). The
    // documented contract on atomicWriteFile/safeWriteFile is: concurrent
    // ordering is unspecified, but SEQUENTIALLY-AWAITED writes observe
    // submission order (the last awaited write is the final content). This test
    // pins that contract by reading back the file after each awaited write and
    // asserting it matches the just-written, monotonically-increasing token —
    // a regression that broke await-then-rename ordering (e.g. fire-and-forget
    // rename) would surface here.
    it("sequentially-awaited writes observe submission order (last-write-wins)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "ordering.txt");

      for (let i = 0; i < 25; i++) {
        // Monotonically increasing ordering token; zero-padded so a lexical
        // read-back comparison would also catch an out-of-order landing.
        const token = `seq-${String(i).padStart(3, "0")}`;
        await atomicWriteFile(filePath, token);
        // Each awaited write must be fully visible before the next begins.
        expect(await readFile(filePath, "utf-8")).toBe(token);
      }

      // Final content is the last submitted token — deterministic for the
      // awaited-sequential path (unlike the concurrent path above).
      expect(await readFile(filePath, "utf-8")).toBe("seq-024");
    });

    it("sequentially-awaited safeWriteFile to a managed path is last-write-wins", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "hatch3r-ordering.md");

      let last = "";
      for (let i = 0; i < 10; i++) {
        last = `managed-seq-${String(i).padStart(2, "0")}`;
        const result = await safeWriteFile(filePath, last);
        // First write creates; subsequent writes update (content differs).
        expect(result.action).toBe(i === 0 ? "created" : "updated");
        expect(await readFile(filePath, "utf-8")).toBe(last);
      }

      expect(await readFile(filePath, "utf-8")).toBe("managed-seq-09");
    });
  });
});
