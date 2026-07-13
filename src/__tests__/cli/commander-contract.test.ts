import { describe, it, expect } from "vitest";
import { createProgram } from "../../cli/program.js";

// D1-SA1.8-06 (Cycle 12 Wave 4, D1, P3): commander 15.0.0 (installed exact; see
// package.json) shipped a breaking change to paired --no-* options — "default
// not implicitly set when both a positive and negative option are defined."
// hatch3r pairs --worktree/--no-worktree and --mcp/--no-mcp on `init`, so under
// 15.x neither key is present in init.opts() until the operator passes a flag.
// init's auto-detect contract depends on that: an undefined opt means "fall back
// to tool auto-detect", so a regression to an implicit default would silently
// override auto-detect. These tests pin the parse-level contract so the next
// commander major breaks loudly here instead of via comment archaeology.
// Re-verified against commander 15.0.0 on 2026-07-12.

function initOpts(...flags: string[]): Record<string, unknown> {
  const program = createProgram();
  const init = program.commands.find((c) => c.name() === "init");
  if (!init) throw new Error("init command not registered on createProgram()");
  let captured: Record<string, unknown> = {};
  // Replace init's real action so a clean parse resolves without running the
  // installer; capture the parsed options off the command instance.
  init.action(() => {
    captured = init.opts();
  });
  program.parse(["init", ...flags], { from: "user" });
  return captured;
}

describe("commander 15 paired --no-* default contract (D1-SA1.8-06)", () => {
  it("leaves worktree AND mcp undefined when neither flag is passed", () => {
    const opts = initOpts("--yes");
    expect(opts.worktree).toBeUndefined();
    expect(opts.mcp).toBeUndefined();
  });

  it("--worktree sets worktree true; --no-worktree sets it false", () => {
    expect(initOpts("--yes", "--worktree").worktree).toBe(true);
    expect(initOpts("--yes", "--no-worktree").worktree).toBe(false);
  });

  it("--mcp sets mcp true; --no-mcp sets it false", () => {
    expect(initOpts("--yes", "--mcp").mcp).toBe(true);
    expect(initOpts("--yes", "--no-mcp").mcp).toBe(false);
  });
});
