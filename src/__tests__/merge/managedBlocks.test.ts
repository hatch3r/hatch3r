import { describe, it, expect } from "vitest";
import {
  insertManagedBlock,
  extractManagedBlock,
  extractCustomContent,
  hasManagedBlock,
  wrapInManagedBlock,
} from "../../merge/managedBlocks.js";
import { HatchError } from "../../types.js";

describe("managedBlocks", () => {
  const START = "<!-- HATCH3R:BEGIN -->";
  const END = "<!-- HATCH3R:END -->";

  describe("insertManagedBlock", () => {
    it("throws when content has no managed block markers", () => {
      expect(() => insertManagedBlock("Custom content", "Managed content")).toThrow(
        "Content must contain managed block markers",
      );
      expect(() => insertManagedBlock("", "Hello")).toThrow(
        "Content must contain managed block markers",
      );
    });

    // C7-H14: insertManagedBlock throws HatchError (not plain Error) so callers
    // can recover programmatically from corrupted/missing markers.
    it("throws HatchError with VALIDATION_ERROR code on missing markers", () => {
      try {
        insertManagedBlock("Custom content", "Managed content");
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        expect((e as HatchError).exitCode).toBe(1);
      }
    });

    it("throws HatchError with VALIDATION_ERROR code on duplicate start marker", () => {
      const content = `${START}\nfirst\n${END}\n${START}\nsecond`;
      try {
        insertManagedBlock(content, "Managed content");
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      }
    });

    it("replaces existing block while preserving custom content", () => {
      const existing = `${START}\nOld content\n${END}\n\nCustom part`;
      const result = insertManagedBlock(existing, "New content");
      expect(result).toContain("New content");
      expect(result).not.toContain("Old content");
      expect(result).toContain("Custom part");
    });

    it("preserves content before and after existing block", () => {
      const existing = `Before text\n${START}\nOld\n${END}\nAfter text`;
      const result = insertManagedBlock(existing, "Replaced");
      expect(result).toContain("Before text");
      expect(result).toContain("After text");
      expect(result).toContain("Replaced");
      expect(result).not.toContain("Old");
    });

    it("throws when start marker appears after end marker", () => {
      const corrupted = `${END}\nContent\n${START}`;
      expect(() => insertManagedBlock(corrupted, "New content")).toThrow(
        "Corrupted managed block: start marker must appear before end marker",
      );
    });

    it("throws when duplicate start markers exist", () => {
      const content = `${START}\nFirst\n${END}\n${START}\nSecond`;
      expect(() => insertManagedBlock(content, "New")).toThrow(
        "Corrupted managed block: duplicate start marker found",
      );
    });

    it("throws when duplicate end markers exist", () => {
      const content = `${START}\nContent\n${END}\nExtra\n${END}`;
      expect(() => insertManagedBlock(content, "New")).toThrow(
        "Corrupted managed block: duplicate end marker found",
      );
    });

    it("throws when both markers are duplicated", () => {
      const content = `${START}\nA\n${END}\n${START}\nB\n${END}`;
      expect(() => insertManagedBlock(content, "New")).toThrow(
        "duplicate start marker found",
      );
    });
  });

  describe("extractManagedBlock", () => {
    it("returns null when no block present", () => {
      expect(extractManagedBlock("No block here")).toBeNull();
    });

    it("returns null when only start marker present", () => {
      expect(extractManagedBlock(`${START}\nContent without end`)).toBeNull();
    });

    it("returns null when only end marker present", () => {
      expect(extractManagedBlock(`Content without start\n${END}`)).toBeNull();
    });

    it("extracts block content between markers", () => {
      const content = `Before\n${START}\nManaged stuff\n${END}\nAfter`;
      expect(extractManagedBlock(content)).toBe("Managed stuff");
    });

    it("trims extracted content", () => {
      const content = `${START}\n  Indented  \n${END}`;
      expect(extractManagedBlock(content)).toBe("Indented");
    });
  });

  describe("hasManagedBlock", () => {
    it("returns true when both markers present", () => {
      expect(hasManagedBlock(`${START}\nContent\n${END}`)).toBe(true);
    });

    it("returns false when no markers present", () => {
      expect(hasManagedBlock("No markers here")).toBe(false);
    });

    it("returns false when only start marker present", () => {
      expect(hasManagedBlock(`${START}\nContent`)).toBe(false);
    });

    it("returns false when only end marker present", () => {
      expect(hasManagedBlock(`Content\n${END}`)).toBe(false);
    });
  });

  describe("wrapInManagedBlock", () => {
    it("wraps content with start and end markers", () => {
      const result = wrapInManagedBlock("Hello world");
      expect(result).toBe(`${START}\nHello world\n${END}`);
    });

    it("produces content that hasManagedBlock detects", () => {
      const result = wrapInManagedBlock("wrapped");
      expect(hasManagedBlock(result)).toBe(true);
    });

    it("produces content that extractManagedBlock can extract", () => {
      const result = wrapInManagedBlock("inner content");
      expect(extractManagedBlock(result)).toBe("inner content");
    });
  });

  describe("extractCustomContent", () => {
    it("returns full content when no block present", () => {
      const content = "All custom content here";
      expect(extractCustomContent(content)).toBe("All custom content here");
    });

    it("returns content outside the managed block", () => {
      const content = `Before\n${START}\nManaged\n${END}\nAfter`;
      const custom = extractCustomContent(content);
      expect(custom).toContain("Before");
      expect(custom).toContain("After");
      expect(custom).not.toContain("Managed");
    });

    it("handles content only before block", () => {
      const content = `Custom header\n${START}\nManaged\n${END}`;
      const custom = extractCustomContent(content);
      expect(custom).toContain("Custom header");
      expect(custom).not.toContain("Managed");
    });

    it("handles content only after block", () => {
      const content = `${START}\nManaged\n${END}\nCustom footer`;
      const custom = extractCustomContent(content);
      expect(custom).toContain("Custom footer");
      expect(custom).not.toContain("Managed");
    });

    it("returns empty-ish string when only managed block exists", () => {
      const content = `${START}\nManaged only\n${END}`;
      const custom = extractCustomContent(content);
      expect(custom).not.toContain("Managed only");
    });
  });
});
