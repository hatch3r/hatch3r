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
      expect(result).toBe(`${START}\nHello world\n${END}\n`);
    });

    it("produces content that hasManagedBlock detects", () => {
      const result = wrapInManagedBlock("wrapped");
      expect(hasManagedBlock(result)).toBe(true);
    });

    it("produces content that extractManagedBlock can extract", () => {
      const result = wrapInManagedBlock("inner content");
      expect(extractManagedBlock(result)).toBe("inner content");
    });

    // G6 (v1.7.1): wrap output ends with \n so the file written by an
    // adapter is POSIX-final-newline compliant. Without this, every
    // editor/formatter that appends a trailing \n on save creates drift
    // that the next hatch3r sync rewrites — the worktree-setup symptom.
    it("emits a POSIX final newline", () => {
      expect(wrapInManagedBlock("body").endsWith("\n")).toBe(true);
    });
  });

  // G6 (v1.7.1): insertManagedBlock output is also guaranteed to end with
  // \n. Both helpers must converge on the same POSIX-final-newline contract
  // or files round-trip differently depending on which path safeWriteFile
  // takes (new-file vs merge-existing), and the result is non-idempotent.
  describe("POSIX final newline guarantee (G6)", () => {
    it("insertManagedBlock result ends with \\n when after is empty", () => {
      const existing = `${START}\nold\n${END}`;
      expect(insertManagedBlock(existing, "new").endsWith("\n")).toBe(true);
    });

    it("insertManagedBlock preserves an already-terminating \\n", () => {
      const existing = `${START}\nold\n${END}\n`;
      expect(insertManagedBlock(existing, "new")).toBe(`${START}\nnew\n${END}\n`);
    });

    it("insertManagedBlock is idempotent across repeated wraps with same content", () => {
      const existing = `header\n\n${START}\nold\n${END}\n\nfooter\n`;
      const once = insertManagedBlock(existing, "managed body");
      const twice = insertManagedBlock(once, "managed body");
      expect(twice).toBe(once);
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

  // Issue #76: managed-block markers must adopt the host file's comment
  // syntax. HTML markers inside a YAML file produce a parse error on
  // line 2 ("Invalid workflow file ... line 2"). Adapters that emit YAML
  // pass the file path so wrap/insert/extract pick the right marker
  // variant, and read-side helpers accept either variant so existing
  // broken files written by v1.7.0/v1.7.1 are auto-repaired on sync.
  describe("issue #76 — per-file-type marker variants", () => {
    const YAML_START = "# HATCH3R:BEGIN";
    const YAML_END = "# HATCH3R:END";

    describe("wrapInManagedBlock", () => {
      it("emits HTML markers when no path provided (default)", () => {
        expect(wrapInManagedBlock("body")).toBe(`${START}\nbody\n${END}\n`);
      });

      it("emits HTML markers for a markdown path", () => {
        const wrapped = wrapInManagedBlock("body", "AGENTS.md");
        expect(wrapped).toContain(START);
        expect(wrapped).not.toContain(YAML_START);
      });

      it("emits YAML markers for a .yml path", () => {
        const wrapped = wrapInManagedBlock("name: foo", ".github/workflows/copilot-setup-steps.yml");
        expect(wrapped).toBe(`${YAML_START}\nname: foo\n${YAML_END}\n`);
        expect(wrapped).not.toContain("<!--");
      });

      it("emits YAML markers for a .yaml path", () => {
        const wrapped = wrapInManagedBlock("foo: bar", "config.yaml");
        expect(wrapped.startsWith(YAML_START)).toBe(true);
      });

      it("is case-insensitive on the extension", () => {
        const wrapped = wrapInManagedBlock("foo: bar", "Workflow.YML");
        expect(wrapped.startsWith(YAML_START)).toBe(true);
      });
    });

    describe("hasManagedBlock / extractManagedBlock / extractCustomContent across variants", () => {
      it("detects YAML markers", () => {
        const yaml = `${YAML_START}\nname: foo\n${YAML_END}\n`;
        expect(hasManagedBlock(yaml)).toBe(true);
        expect(extractManagedBlock(yaml)).toBe("name: foo");
      });

      it("returns false when only one YAML marker is present", () => {
        expect(hasManagedBlock(`${YAML_START}\nname: foo\n`)).toBe(false);
        expect(hasManagedBlock(`name: foo\n${YAML_END}\n`)).toBe(false);
      });

      it("preserves user content outside YAML markers", () => {
        const content = [
          "# user comment",
          YAML_START,
          "managed: value",
          YAML_END,
          "trailing: user",
        ].join("\n");
        const custom = extractCustomContent(content);
        expect(custom).toContain("# user comment");
        expect(custom).toContain("trailing: user");
        expect(custom).not.toContain("managed: value");
      });
    });

    describe("insertManagedBlock auto-repair across variants", () => {
      it("uses YAML output markers when filePath is a .yml file", () => {
        const existing = `${YAML_START}\nold: value\n${YAML_END}\n`;
        const result = insertManagedBlock(existing, "new: value", "x.yml");
        expect(result).toBe(`${YAML_START}\nnew: value\n${YAML_END}\n`);
      });

      // The v1.7.0/v1.7.1 bug: a YAML workflow file ended up with HTML
      // markers. The next sync must detect the (wrong-variant) markers,
      // strip them, and emit YAML markers so the file becomes valid YAML.
      it("auto-repairs HTML markers in a .yml file to YAML markers", () => {
        const broken = `${START}\nold: value\n${END}\n`;
        const repaired = insertManagedBlock(broken, "new: value", "x.yml");
        expect(repaired).toBe(`${YAML_START}\nnew: value\n${YAML_END}\n`);
        expect(repaired).not.toContain("<!--");
      });

      it("auto-repair preserves user content outside the broken HTML block", () => {
        const broken = [
          "# user header",
          START,
          "old: value",
          END,
          "user_footer: yes",
        ].join("\n");
        const repaired = insertManagedBlock(broken, "new: value", "x.yml");
        expect(repaired).toContain("# user header");
        expect(repaired).toContain("user_footer: yes");
        expect(repaired).toContain(YAML_START);
        expect(repaired).toContain(YAML_END);
        expect(repaired).not.toContain("<!--");
        expect(repaired).not.toContain("old: value");
        expect(repaired).toContain("new: value");
      });

      it("is idempotent after auto-repair (second sync writes nothing new)", () => {
        const broken = `${START}\nold: value\n${END}\n`;
        const once = insertManagedBlock(broken, "new: value", "x.yml");
        const twice = insertManagedBlock(once, "new: value", "x.yml");
        expect(twice).toBe(once);
      });

      it("leaves markdown files on HTML markers by default", () => {
        const existing = `${START}\nold\n${END}\n`;
        const result = insertManagedBlock(existing, "new", "AGENTS.md");
        expect(result).toBe(`${START}\nnew\n${END}\n`);
      });
    });
  });
});
