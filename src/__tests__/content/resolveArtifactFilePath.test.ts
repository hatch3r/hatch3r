import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveArtifactFilePath } from "../../content/index.js";

// D1-SA1.7-01 (D1, P1): single-source-of-truth resolution of a CatalogItem to
// its readable on-disk file. Skills are indexed by their DIRECTORY, so the
// readable file is <dir>/SKILL.md; every other type's relativePath is already a
// file. `show` previously re-derived this per command and omitted the skill
// branch, crashing with EISDIR on every skill id.
describe("resolveArtifactFilePath (D1-SA1.7-01)", () => {
  const root = join("/", "content");

  it("appends SKILL.md for skill items (indexed by directory)", () => {
    const p = resolveArtifactFilePath(root, {
      type: "skill",
      relativePath: join("skills", "hatch3r-a11y-audit"),
    });
    expect(p).toBe(join(root, "skills", "hatch3r-a11y-audit", "SKILL.md"));
  });

  it("returns the relativePath as-is (joined to root) for every non-skill type", () => {
    const types = [
      "agent",
      "rule",
      "command",
      "hook",
      "prompt",
      "github-agent",
    ] as const;
    for (const type of types) {
      const rel = join("dir", "hatch3r-thing.md");
      expect(resolveArtifactFilePath(root, { type, relativePath: rel })).toBe(
        join(root, rel),
      );
    }
  });
});
