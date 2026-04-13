import { describe, it, expect } from "vitest";
import {
  createFailureLogEntry,
  formatLogEntry,
  parseFailureLog,
  shouldRotateLog,
  rotateLog,
  MAX_LOG_SIZE,
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
    it("should keep the most recent half of entries", () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        createFailureLogEntry(`phase-${i}`, new Error(`error-${i}`)),
      );
      const content = entries.map(formatLogEntry).join("\n") + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(5);
      // Should keep the last 5
      expect(parsed[0].phase).toBe("phase-5");
      expect(parsed[4].phase).toBe("phase-9");
    });

    it("should not lose data when only 1 entry exists", () => {
      const entry = createFailureLogEntry("solo", new Error("only one"));
      const content = formatLogEntry(entry) + "\n";
      const rotated = rotateLog(content);
      const parsed = parseFailureLog(rotated);
      expect(parsed).toHaveLength(1);
    });
  });
});
