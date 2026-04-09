import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VERSION_CHECKPOINTS,
  getApplicableCheckpoints,
} from "../../version/checkpoints.js";
import type { VersionCheckpoint } from "../../version/checkpoints.js";

describe("VERSION_CHECKPOINTS", () => {
  it("is an array", () => {
    expect(Array.isArray(VERSION_CHECKPOINTS)).toBe(true);
  });
});

describe("getApplicableCheckpoints", () => {
  it("returns an empty array when no checkpoints are registered", () => {
    expect(getApplicableCheckpoints("1.0.0", "2.0.0")).toEqual([]);
  });

  it("returns an empty array when from and to are the same version", () => {
    expect(getApplicableCheckpoints("1.0.0", "1.0.0")).toEqual([]);
  });

  it("returns an empty array for a downgrade range", () => {
    expect(getApplicableCheckpoints("2.0.0", "1.0.0")).toEqual([]);
  });

  describe("with populated checkpoints", () => {
    const original = [...VERSION_CHECKPOINTS];

    beforeEach(() => {
      VERSION_CHECKPOINTS.length = 0;
      VERSION_CHECKPOINTS.push(
        { version: "1.3.0", action: "migration", reason: "Schema migration" },
        { version: "1.5.0", action: "reinit-advisory", reason: "Structural change", changes: ["New adapter paths"] },
        { version: "2.0.0", action: "reinit-advisory", reason: "Major rewrite", changes: ["Everything changed"] },
      );
    });

    afterEach(() => {
      VERSION_CHECKPOINTS.length = 0;
      VERSION_CHECKPOINTS.push(...original);
    });

    it("returns checkpoints within the version range", () => {
      const result = getApplicableCheckpoints("1.2.0", "1.5.0");
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe("1.3.0");
      expect(result[1].version).toBe("1.5.0");
    });

    it("excludes checkpoints at or below fromVersion", () => {
      const result = getApplicableCheckpoints("1.5.0", "2.0.0");
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe("2.0.0");
    });

    it("excludes checkpoints above toVersion", () => {
      const result = getApplicableCheckpoints("1.0.0", "1.4.0");
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe("1.3.0");
    });

    it("returns all checkpoints for a large version jump", () => {
      const result = getApplicableCheckpoints("1.0.0", "3.0.0");
      expect(result).toHaveLength(3);
    });

    it("returns empty when from equals a checkpoint version", () => {
      const result = getApplicableCheckpoints("1.3.0", "1.3.0");
      expect(result).toHaveLength(0);
    });
  });
});

describe("VersionCheckpoint type", () => {
  it("accepts a valid migration checkpoint shape", () => {
    const cp: VersionCheckpoint = {
      version: "2.0.0",
      action: "migration",
      reason: "Schema overhaul",
      migrate: async (manifest, _rootDir) => manifest,
    };
    expect(cp.action).toBe("migration");
    expect(cp.migrate).toBeTypeOf("function");
  });

  it("accepts a valid reinit-advisory checkpoint shape", () => {
    const cp: VersionCheckpoint = {
      version: "3.0.0",
      action: "reinit-advisory",
      reason: "Breaking config format change",
      changes: ["Removed legacy adapter keys", "New manifest schema"],
    };
    expect(cp.action).toBe("reinit-advisory");
    expect(cp.changes).toHaveLength(2);
  });
});
