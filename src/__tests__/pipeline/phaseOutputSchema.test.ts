import { describe, it, expect } from "vitest";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";

describe("phaseOutputSchema", () => {
  describe("compactPhaseOutput", () => {
    it("should return input unchanged when below threshold", () => {
      const input = { key: "short value", list: [1, 2, 3] };
      const result = compactPhaseOutput(input, { threshold: 100_000 });
      expect(result).toEqual(input);
    });

    it("should truncate strings exceeding maxStringLength", () => {
      const longStr = "a".repeat(600);
      const input = { data: longStr };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 100 });
      expect(result.data).toHaveLength(100 + " [compacted]".length);
      expect(result.data).toContain(" [compacted]");
      expect(result.data.startsWith("a".repeat(100))).toBe(true);
    });

    it("should compact arrays exceeding headItems + tailItems", () => {
      const input = { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      const result = compactPhaseOutput(input, {
        threshold: 0,
        headItems: 3,
        tailItems: 2,
      });
      expect(result.items).toHaveLength(6); // 3 head + 1 placeholder + 2 tail
      expect(result.items[0]).toBe(1);
      expect(result.items[1]).toBe(2);
      expect(result.items[2]).toBe(3);
      expect(result.items[3]).toBe("[compacted: 5 items omitted]");
      expect(result.items[4]).toBe(9);
      expect(result.items[5]).toBe(10);
    });

    it("should recurse into nested objects", () => {
      const longStr = "b".repeat(300);
      const input = {
        outer: {
          inner: {
            value: longStr,
          },
        },
      };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 50 });
      expect(result.outer.inner.value).toHaveLength(50 + " [compacted]".length);
      expect(result.outer.inner.value).toContain(" [compacted]");
    });

    it("should preserve primitives (number, boolean, null)", () => {
      const input = {
        count: 42,
        active: true,
        disabled: false,
        nothing: null,
      };
      const result = compactPhaseOutput(input, { threshold: 0 });
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.nothing).toBeNull();
    });

    it("should leave short arrays intact", () => {
      const input = { items: ["a", "b"] };
      const result = compactPhaseOutput(input, {
        threshold: 0,
        headItems: 3,
        tailItems: 2,
      });
      expect(result.items).toEqual(["a", "b"]);
    });

    it("should leave short strings intact", () => {
      const input = { msg: "hello" };
      const result = compactPhaseOutput(input, { threshold: 0, maxStringLength: 500 });
      expect(result.msg).toBe("hello");
    });
  });
});
