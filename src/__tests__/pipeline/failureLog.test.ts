import { describe, it, expect, afterEach } from "vitest";
import {
  createFailureLogEntry,
  formatLogEntry,
  parseFailureLog,
  shouldRotateLog,
  rotateLog,
  MAX_LOG_SIZE,
  DEFAULT_MAX_LOG_SIZE,
  MIN_RETAINED_ENTRIES,
  FAILURE_LOG_MAX_BYTES_ENV,
  getMaxLogSize,
} from "../../pipeline/failureLog.js";

describe("failureLog", () => {
  describe("createFailureLogEntry", () => {
    it("should create an entry from an Error", () => {
      const err = new Error("adapter crashed");
      const entry = createFailureLogEntry("adapter", err, { tool: "cursor" });
      expect(entry.phase).toBe("adapter");
      expect(entry.error).toBe("adapter crashed");
      expect(entry.tool).toBe("cursor");
      expect(entry.timestamp).toBeDefined();
    });

    it("should create an entry from a string error", () => {
      const entry = createFailureLogEntry("generation", "something went wrong");
      expect(entry.error).toBe("something went wrong");
      expect(entry.tool).toBeUndefined();
    });

    it("should capture errorCode from HatchError-like objects", () => {
      const err = Object.assign(new Error("config invalid"), { errorCode: "CONFIG_ERROR" });
      const entry = createFailureLogEntry("merge", err);
      expect(entry.errorCode).toBe("CONFIG_ERROR");
    });

    it("should include optional correlationId and version", () => {
      const entry = createFailureLogEntry("review", new Error("timeout"), {
        correlationId: "abc-123",
        version: "1.4.0",
      });
      expect(entry.correlationId).toBe("abc-123");
      expect(entry.version).toBe("1.4.0");
    });
  });

  describe("formatLogEntry", () => {
    it("should produce valid JSON", () => {
      const entry = createFailureLogEntry("adapter", new Error("test"));
      const line = formatLogEntry(entry);
      const parsed = JSON.parse(line);
      expect(parsed.phase).toBe("adapter");
    });
  });

  describe("parseFailureLog", () => {
    it("should parse valid JSONL content", () => {
      const entry1 = createFailureLogEntry("p1", new Error("err1"));
      const entry2 = createFailureLogEntry("p2", new Error("err2"));
      const content = [formatLogEntry(entry1), formatLogEntry(entry2)].join("\n");

      const entries = parseFailureLog(content);
      expect(entries).toHaveLength(2);
      expect(entries[0].phase).toBe("p1");
      expect(entries[1].phase).toBe("p2");
    });

    it("should skip malformed lines", () => {
      const valid = formatLogEntry(createFailureLogEntry("ok", new Error("good")));
      const content = [valid, "not json at all", "{}", valid].join("\n");
      const entries = parseFailureLog(content);
      expect(entries).toHaveLength(2);
    });

    it("should handle empty content", () => {
      expect(parseFailureLog("")).toHaveLength(0);
      expect(parseFailureLog("\n\n")).toHaveLength(0);
    });
  });

  describe("shouldRotateLog", () => {
    it("should return false for small content", () => {
      expect(shouldRotateLog("small")).toBe(false);
    });

    it("should return true for content exceeding MAX_LOG_SIZE", () => {
      const huge = "x".repeat(MAX_LOG_SIZE + 1);
      expect(shouldRotateLog(huge)).toBe(true);
    });
  });

  describe("rotateLog", () => {
    it("should keep the most recent half of entries (no floor active)", () => {
      // D8-M6: with 30 entries, half-split (15) >= floor (10), so the
      // half-split branch wins. Verifies the prior contract still holds when
      // the floor is not the binding constraint.
      const entries = Array.from({ length: 30 }, (_, i) =>
        createFailureLogEntry(`phase-${i}`, new Error(`error-${i}`)),
      );
      const content = entries.map(formatLogEntry).join("\n") + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(15);
      // Should keep the last 15
      expect(parsed[0].phase).toBe("phase-15");
      expect(parsed[14].phase).toBe("phase-29");
    });

    it("should not lose data when only 1 entry exists", () => {
      const entry = createFailureLogEntry("solo", new Error("only one"));
      const content = formatLogEntry(entry) + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(1);
    });
  });

  // D8-M6 (Cycle 10 rollover): env-overridable max-log-size + minimum
  // retention floor on rotation so a tightly-tuned log budget never erases
  // the failure being investigated.
  describe("D8-M6 env override and retention floor", () => {
    afterEach(() => {
      delete process.env[FAILURE_LOG_MAX_BYTES_ENV];
    });

    it("getMaxLogSize returns the default when env var is unset", () => {
      delete process.env[FAILURE_LOG_MAX_BYTES_ENV];
      expect(getMaxLogSize()).toBe(DEFAULT_MAX_LOG_SIZE);
    });

    it("MAX_LOG_SIZE backward-compat re-export equals DEFAULT_MAX_LOG_SIZE", () => {
      expect(MAX_LOG_SIZE).toBe(DEFAULT_MAX_LOG_SIZE);
    });

    it("getMaxLogSize honours HATCH3R_FAILURE_LOG_MAX_BYTES override", () => {
      process.env[FAILURE_LOG_MAX_BYTES_ENV] = "2097152"; // 2MB
      expect(getMaxLogSize()).toBe(2097152);
    });

    it("getMaxLogSize ignores zero and negative values", () => {
      process.env[FAILURE_LOG_MAX_BYTES_ENV] = "0";
      expect(getMaxLogSize()).toBe(DEFAULT_MAX_LOG_SIZE);
      process.env[FAILURE_LOG_MAX_BYTES_ENV] = "-100";
      expect(getMaxLogSize()).toBe(DEFAULT_MAX_LOG_SIZE);
    });

    it("getMaxLogSize ignores non-numeric values", () => {
      process.env[FAILURE_LOG_MAX_BYTES_ENV] = "garbage";
      expect(getMaxLogSize()).toBe(DEFAULT_MAX_LOG_SIZE);
    });

    it("shouldRotateLog reflects the env override", () => {
      const content = "x".repeat(1024);
      delete process.env[FAILURE_LOG_MAX_BYTES_ENV];
      expect(shouldRotateLog(content)).toBe(false); // 1KB < 512KB default
      process.env[FAILURE_LOG_MAX_BYTES_ENV] = "512"; // budget = 512 bytes
      expect(shouldRotateLog(content)).toBe(true); // 1KB > 512 bytes
    });

    it("rotateLog enforces MIN_RETAINED_ENTRIES floor when half-split would drop below", () => {
      // 12 entries — half-split = 6, floor = 10. The floor wins.
      const entries = Array.from({ length: 12 }, (_, i) =>
        createFailureLogEntry(`f-${i}`, new Error(`e-${i}`)),
      );
      const content = entries.map(formatLogEntry).join("\n") + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(MIN_RETAINED_ENTRIES);
      // Should keep the most-recent floor entries
      expect(parsed[0].phase).toBe("f-2");
      expect(parsed[MIN_RETAINED_ENTRIES - 1].phase).toBe("f-11");
    });

    it("rotateLog returns the input unchanged when entries fit under the floor", () => {
      // 3 entries — half-split = 2, floor = 10. We retain min(3, max(2, 10)) = 3.
      const entries = Array.from({ length: 3 }, (_, i) =>
        createFailureLogEntry(`p${i}`, new Error(`e${i}`)),
      );
      const content = entries.map(formatLogEntry).join("\n") + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(3);
    });
  });
});
