import { describe, it, expect } from "vitest";
import { escapeTomlString, escapeTomlMultilineString } from "../../adapters/toml-utils.js";

describe("escapeTomlString", () => {
  it("escapes backslashes", () => {
    expect(escapeTomlString("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(escapeTomlString('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes tab characters", () => {
    expect(escapeTomlString("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("escapes newline characters", () => {
    expect(escapeTomlString("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage return characters", () => {
    expect(escapeTomlString("line1\rline2")).toBe("line1\\rline2");
  });

  it("returns empty string for empty input", () => {
    expect(escapeTomlString("")).toBe("");
  });

  it("returns string unchanged when no special characters present", () => {
    expect(escapeTomlString("hello world 123")).toBe("hello world 123");
  });

  it("escapes mixed special characters in one string", () => {
    expect(escapeTomlString('path\\to\t"file"\nend\r')).toBe(
      'path\\\\to\\t\\"file\\"\\nend\\r',
    );
  });

  it("preserves unicode characters", () => {
    expect(escapeTomlString("hello 世界 🌍")).toBe("hello 世界 🌍");
  });

  it("#120: escapes backspace characters", () => {
    expect(escapeTomlString("before\x08after")).toBe("before\\bafter");
  });

  it("#120: escapes form feed characters", () => {
    expect(escapeTomlString("before\fafter")).toBe("before\\fafter");
  });

  // C7.5-W2B2-H5 (D2-SA2.4-4): TOML 1.0 spec requires every control
  // character in U+0000-U+0008, U+000A-U+001F, U+007F (except tab) to be
  // escaped. Before this fix only the named chars were handled; raw U+0001
  // etc. were passed through and produced invalid TOML for the codex
  // adapter. All remaining control chars now emit as \uNNNN short-form.
  describe("C7.5-W2B2-H5 control character escapes", () => {
    it("escapes U+0000 (NUL) as \\u0000", () => {
      expect(escapeTomlString("a\x00b")).toBe("a\\u0000b");
    });

    it("escapes U+0001 (SOH) as \\u0001", () => {
      expect(escapeTomlString("a\x01b")).toBe("a\\u0001b");
    });

    it("escapes U+0007 (BEL) as \\u0007", () => {
      expect(escapeTomlString("a\x07b")).toBe("a\\u0007b");
    });

    it("escapes U+000B (VT) as \\u000B", () => {
      expect(escapeTomlString("a\x0bb")).toBe("a\\u000Bb");
    });

    it("escapes U+000E (SO) as \\u000E", () => {
      expect(escapeTomlString("a\x0eb")).toBe("a\\u000Eb");
    });

    it("escapes U+001F (US) as \\u001F", () => {
      expect(escapeTomlString("a\x1fb")).toBe("a\\u001Fb");
    });

    it("escapes U+007F (DEL) as \\u007F", () => {
      expect(escapeTomlString("a\x7fb")).toBe("a\\u007Fb");
    });

    it("preserves already-handled \\b \\f \\t \\n \\r (not double-escaped)", () => {
      // The control-char regex excludes codepoints already handled by
      // the named-escape replace rules above. Output must match the
      // single-escape form, not a \uNNNN form.
      expect(escapeTomlString("\x08")).toBe("\\b");
      expect(escapeTomlString("\x09")).toBe("\\t");
      expect(escapeTomlString("\x0a")).toBe("\\n");
      expect(escapeTomlString("\x0c")).toBe("\\f");
      expect(escapeTomlString("\x0d")).toBe("\\r");
    });

    it("preserves all printable ASCII untouched (deny-pattern exclusions)", () => {
      // Every printable char from space (0x20) through `~` (0x7e) must
      // pass through unchanged (except `"` and `\` which are handled
      // elsewhere in the escape chain).
      const printable = "abcABC0123 !@#$%^&*()-_=+[]{};:'`,.<>/?|~";
      expect(escapeTomlString(printable)).toBe(printable);
    });
  });
});

describe("escapeTomlMultilineString", () => {
  // C7.5-W2B2-H36: Codex adapter emits developer_instructions as a TOML
  // multi-line basic string. Backslashes and bare `"""` sequences must be
  // escaped; LF, CR, tab pass through verbatim.
  it("preserves LF newlines verbatim", () => {
    expect(escapeTomlMultilineString("line1\nline2")).toBe("line1\nline2");
  });

  it("preserves CR verbatim", () => {
    expect(escapeTomlMultilineString("line1\rline2")).toBe("line1\rline2");
  });

  it("preserves tab verbatim", () => {
    expect(escapeTomlMultilineString("col1\tcol2")).toBe("col1\tcol2");
  });

  it("escapes backslashes", () => {
    expect(escapeTomlMultilineString("a\\b")).toBe("a\\\\b");
  });

  it("breaks bare triple-quote sequences by escaping the third quote", () => {
    expect(escapeTomlMultilineString('a """ b')).toBe('a ""\\" b');
  });

  it("leaves single or double quotes unchanged", () => {
    expect(escapeTomlMultilineString('a "b" c')).toBe('a "b" c');
    expect(escapeTomlMultilineString('a "" b')).toBe('a "" b');
  });

  it("escapes other control characters per TOML 1.0 spec", () => {
    expect(escapeTomlMultilineString("before\x08after")).toBe("before\\u0008after");
    expect(escapeTomlMultilineString("before\x00after")).toBe("before\\u0000after");
    expect(escapeTomlMultilineString("before\x7fafter")).toBe("before\\u007Fafter");
  });

  it("returns empty string for empty input", () => {
    expect(escapeTomlMultilineString("")).toBe("");
  });

  it("preserves unicode content", () => {
    expect(escapeTomlMultilineString("hello 世界 🌍")).toBe("hello 世界 🌍");
  });
});
