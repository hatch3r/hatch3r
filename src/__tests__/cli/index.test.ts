import { describe, it, expect } from "vitest";
import { createProgram } from "../../cli/program.js";

describe("createProgram() command registration", () => {
  const program = createProgram();
  const registeredNames = program.commands.map((cmd) => cmd.name());

  const EXPECTED_COMMANDS = [
    "init",
    "sync",
    "status",
    "update",
    "validate",
    "verify",
    "config",
    "clean",
    "add",
    "worktree-setup",
    "worktree-cleanup",
    // CLI-tooling pivot (1.7.2 Wave 3): mcp + cli-tools side-door commands
    "mcp",
    "cli-tools",
  ] as const;

  it("registers all 13 expected commands", () => {
    expect(registeredNames).toHaveLength(EXPECTED_COMMANDS.length);
    for (const name of EXPECTED_COMMANDS) {
      expect(registeredNames).toContain(name);
    }
  });

  it("sets program name to 'hatch3r'", () => {
    expect(program.name()).toBe("hatch3r");
  });

  it("sets a non-empty version string", () => {
    expect(program.version()).toBeTruthy();
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("registers --fix and --max-fix-attempts options on verify", () => {
    const verify = program.commands.find((cmd) => cmd.name() === "verify");
    expect(verify).toBeDefined();
    const optionFlags = verify!.options.map((o) => o.long);
    expect(optionFlags).toContain("--fix");
    expect(optionFlags).toContain("--max-fix-attempts");
  });

  it("registers --format option on validate (C8-D1-M10)", () => {
    const validate = program.commands.find((cmd) => cmd.name() === "validate");
    expect(validate).toBeDefined();
    const optionFlags = validate!.options.map((o) => o.long);
    expect(optionFlags).toContain("--format");
    const formatOpt = validate!.options.find((o) => o.long === "--format");
    expect(formatOpt?.defaultValue).toBe("human");
  });

  it("each command has a description", () => {
    for (const cmd of program.commands) {
      expect(cmd.description()).toBeTruthy();
    }
  });
});
