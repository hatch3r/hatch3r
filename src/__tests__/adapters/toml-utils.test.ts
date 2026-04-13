import { describe, it, expect } from "vitest";
import { escapeTomlString } from "../../adapters/toml-utils.js";

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
});
