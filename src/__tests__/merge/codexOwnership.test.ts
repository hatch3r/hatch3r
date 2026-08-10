import { describe, expect, it } from "vitest";
import {
  fileMatchesTool,
  isCodexExclusivePath,
  isCodexSharedPath,
  planCodexRemoval,
} from "../../merge/codexOwnership.js";

describe("Codex output ownership", () => {
  it.each([
    ".codex/config.toml",
    ".codex/hooks.json",
    "AGENTS.md",
    "AGENTS.override.md",
    ".codex\\config.toml",
  ])("classifies %s as a shared path", (path) => {
    expect(isCodexSharedPath(path)).toBe(true);
  });

  it.each([
    ".agents/skills/hatch3r-feature/SKILL.md",
    ".agents/skills/hatch3r-feature/references/guide.md",
    ".codex/agents/hatch3r-reviewer.toml",
    ".codex/hatch3r/hooks/hatch3r-session-start.mjs",
    ".hatch3r/codex-support/rules/hatch3r-testing.md",
  ])("classifies %s as an exclusive path", (path) => {
    expect(isCodexExclusivePath(path)).toBe(true);
  });

  it("does not claim third-party Codex paths", () => {
    expect(isCodexExclusivePath(".agents/skills/personal/SKILL.md")).toBe(false);
    expect(isCodexExclusivePath(".codex/agents/personal.toml")).toBe(false);
    expect(fileMatchesTool(".agents/skills/personal/SKILL.md", "codex")).toBe(false);
  });

  it("requires exact provenance for standalone files", () => {
    expect(planCodexRemoval(
      ".codex/agents/hatch3r-reviewer.toml",
      "/repo/.codex/agents/hatch3r-reviewer.toml",
      "name = \"reviewer\"\n",
      false,
    )).toEqual({ disposition: "foreign" });
    expect(planCodexRemoval(
      ".codex/agents/hatch3r-reviewer.toml",
      "/repo/.codex/agents/hatch3r-reviewer.toml",
      "name = \"reviewer\"\n",
      true,
    )).toEqual({ disposition: "remove" });
  });
});
