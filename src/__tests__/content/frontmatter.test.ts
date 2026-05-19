// C9-M15: tests for the shared frontmatter helper that consolidates the
// previously duplicated `parseAdaptersFrontmatter` regex parser
// (`src/content/index.ts`) with the canonical YAML-based parser
// (`src/adapters/canonical.ts::parseFrontmatter`). The helper now lives in
// `src/content/frontmatter.ts` and is a thin wrapper around the YAML parser.

import { describe, it, expect } from "vitest";
import { extractAdaptersFrontmatter } from "../../content/frontmatter.js";

function md(frontmatterBody: string, body = "# body\n"): string {
  return `---\n${frontmatterBody}\n---\n${body}`;
}

describe("extractAdaptersFrontmatter", () => {
  it("returns undefined for content without frontmatter delimiters", () => {
    expect(extractAdaptersFrontmatter("just body, no frontmatter\n")).toBeUndefined();
  });

  it("returns undefined when the adapters field is absent", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: An agent without adapters frontmatter",
      "tags: [core]",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toBeUndefined();
  });

  it("parses an inline array of adapters", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Inline-array adapters fixture",
      "adapters: [claude, cursor]",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude", "cursor"]);
  });

  it("parses inline adapters with quoted entries", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Quoted inline adapters fixture",
      'adapters: ["claude", "cursor", "windsurf"]',
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude", "cursor", "windsurf"]);
  });

  it("parses block-form adapters", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Block-form adapters fixture",
      "adapters:",
      "  - claude",
      "  - cursor",
      "  - gemini",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude", "cursor", "gemini"]);
  });

  it("returns an empty array for an explicit empty list (caller decides interpretation)", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Empty adapters list fixture",
      "adapters: []",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toEqual([]);
  });

  it("returns undefined when adapters is a bare scalar (malformed)", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Malformed scalar adapters fixture",
      "adapters: claude",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toBeUndefined();
  });

  it("returns undefined when adapters is an object (malformed)", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Malformed object adapters fixture",
      "adapters:",
      "  primary: claude",
      "  secondary: cursor",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toBeUndefined();
  });

  it("filters non-string entries out of a mixed-type array", () => {
    const raw = md([
      "id: my-agent",
      "type: agent",
      "description: Mixed-type adapters fixture",
      "adapters: [claude, 42, cursor, true]",
    ].join("\n"));
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude", "cursor"]);
  });

  it("returns undefined when the YAML parse throws", () => {
    // Structurally invalid YAML inside the frontmatter delimiters. The
    // canonical parser raises; the helper swallows the error and returns
    // undefined so the index builder keeps loading the item.
    const raw = "---\nadapters: [unclosed\n---\n# body\n";
    expect(extractAdaptersFrontmatter(raw)).toBeUndefined();
  });

  it("handles multi-document YAML by parsing only the first frontmatter block", () => {
    // The canonical FRONTMATTER_REGEX matches only the first `---` … `---`
    // block. Any additional `---` separators in the body are part of the
    // markdown content, not a second frontmatter document.
    const raw = [
      "---",
      "id: my-agent",
      "type: agent",
      "description: Multi-doc body fixture",
      "adapters: [claude]",
      "---",
      "# body",
      "---",
      "id: ignored-second-doc",
      "adapters: [cursor]",
      "---",
    ].join("\n");
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude"]);
  });

  it("handles CRLF line endings", () => {
    const raw = [
      "---",
      "id: my-agent",
      "type: agent",
      "description: CRLF fixture",
      "adapters: [claude, cursor]",
      "---",
      "# body",
    ].join("\r\n");
    expect(extractAdaptersFrontmatter(raw)).toEqual(["claude", "cursor"]);
  });
});
