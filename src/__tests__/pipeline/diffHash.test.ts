import { describe, it, expect } from "vitest";
import {
  computeDiffHash,
  createHandoffPayload,
  verifyHandoff,
  verifyDiffsAgainstDisk,
  type DiffEntry,
} from "../../pipeline/diffHash.js";

describe("diffHash", () => {
  const sampleDiffs: DiffEntry[] = [
    { filePath: "src/utils.ts", before: "old code", after: "new code" },
    { filePath: "src/index.ts", before: "before", after: "after" },
  ];

  describe("computeDiffHash", () => {
    it("should produce a deterministic hash for the same diffs", () => {
      const hash1 = computeDiffHash(sampleDiffs);
      const hash2 = computeDiffHash(sampleDiffs);
      expect(hash1).toBe(hash2);
    });

    it("should produce the same hash regardless of entry order", () => {
      const reversed = [...sampleDiffs].reverse();
      const hash1 = computeDiffHash(sampleDiffs);
      const hash2 = computeDiffHash(reversed);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different diffs", () => {
      const modified: DiffEntry[] = [
        { filePath: "src/utils.ts", before: "old code", after: "different code" },
      ];
      const hash1 = computeDiffHash(sampleDiffs);
      const hash2 = computeDiffHash(modified);
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty diffs array", () => {
      const hash = computeDiffHash([]);
      expect(hash).toHaveLength(64); // SHA-256 hex is 64 chars
    });

    it("should handle diffs with empty file content", () => {
      const diffs: DiffEntry[] = [
        { filePath: "new-file.ts", before: "", after: "new content" },
      ];
      const hash = computeDiffHash(diffs);
      expect(hash).toHaveLength(64);
    });
  });

  describe("createHandoffPayload", () => {
    it("should create a payload with matching diff hash", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      expect(payload.diffHash).toBe(computeDiffHash(sampleDiffs));
      expect(payload.diffs).toEqual(sampleDiffs);
      expect(payload.iteration).toBe(1);
      expect(payload.timestamp).toBeDefined();
    });

    it("should produce verifiable payloads", () => {
      const payload = createHandoffPayload(sampleDiffs, 2);
      const verification = verifyHandoff(payload);
      expect(verification.valid).toBe(true);
    });
  });

  describe("verifyHandoff", () => {
    it("should verify a valid handoff payload", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      const result = verifyHandoff(payload);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.computedHash).toBe(result.claimedHash);
    });

    it("should detect a tampered diff hash", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      payload.diffHash = "0".repeat(64); // tamper with the hash

      const result = verifyHandoff(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Diff hash mismatch");
      expect(result.computedHash).not.toBe(result.claimedHash);
    });

    it("should detect modified diffs after hashing", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      // Tamper with the diff content after creating the payload
      payload.diffs[0].after = "sneakily modified content";

      const result = verifyHandoff(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Diff hash mismatch");
    });

    it("should detect added diffs after hashing", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      payload.diffs.push({
        filePath: "src/secret.ts",
        before: "",
        after: "backdoor code",
      });

      const result = verifyHandoff(payload);
      expect(result.valid).toBe(false);
    });

    it("should detect removed diffs after hashing", () => {
      const payload = createHandoffPayload(sampleDiffs, 1);
      payload.diffs.pop();

      const result = verifyHandoff(payload);
      expect(result.valid).toBe(false);
    });
  });

  describe("verifyDiffsAgainstDisk", () => {
    it("should pass when disk matches diffs", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/file.ts", before: "old", after: "new" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async (path) => {
        if (path === "src/file.ts") return "new";
        return null;
      });

      expect(result.valid).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });

    it("should detect content mismatch on disk", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/file.ts", before: "old", after: "new" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async (path) => {
        if (path === "src/file.ts") return "something else entirely";
        return null;
      });

      expect(result.valid).toBe(false);
      expect(result.mismatches).toEqual(
        expect.arrayContaining([expect.stringContaining("content mismatch")]),
      );
    });

    it("should detect file claimed as deleted but still exists", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/deleted.ts", before: "content", after: "" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async (path) => {
        if (path === "src/deleted.ts") return "still here!";
        return null;
      });

      expect(result.valid).toBe(false);
      expect(result.mismatches).toEqual(
        expect.arrayContaining([
          expect.stringContaining("claimed file was deleted but it still exists"),
        ]),
      );
    });

    it("should pass when file is correctly deleted", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/deleted.ts", before: "content", after: "" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async () => null);
      expect(result.valid).toBe(true);
    });

    it("should detect file claimed to exist but is missing", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/new.ts", before: "", after: "new content" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async () => null);
      expect(result.valid).toBe(false);
      expect(result.mismatches).toEqual(
        expect.arrayContaining([
          expect.stringContaining("claimed content exists but file is missing"),
        ]),
      );
    });

    it("should handle multiple files with mixed results", async () => {
      const diffs: DiffEntry[] = [
        { filePath: "src/good.ts", before: "old", after: "new" },
        { filePath: "src/bad.ts", before: "old", after: "expected" },
        { filePath: "src/missing.ts", before: "", after: "should exist" },
      ];

      const result = await verifyDiffsAgainstDisk(diffs, async (path) => {
        if (path === "src/good.ts") return "new";
        if (path === "src/bad.ts") return "actual";
        return null;
      });

      expect(result.valid).toBe(false);
      expect(result.mismatches).toHaveLength(2);
    });
  });
});
