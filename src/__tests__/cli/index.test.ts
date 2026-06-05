import { describe, it, expect } from "vitest";
import type { Command } from "commander";
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
    // CLI-tooling pivot (1.7.5 Wave 3): mcp + cli-tools side-door commands
    "mcp",
    "cli-tools",
    // SA12.1-F-D12-M9 (Cycle 10 Wave 3): inspection commands
    "show",
    "list",
    // SA12.1-F-D12-M11 (Cycle 10 Wave 3): dedicated provenance reader
    "provenance",
    // SA12.1-F-D12-M13 (Cycle 10 Wave 3): orchestration dependency surface
    "deps",
    // Cycle 9 Wave 2 C9-H13: hatch3r explain --cost <command>
    "explain",
    // Decision 27 (hatch3r 2.0.0 / Bucket 2.2): per-session snapshot rollback
    "rollback",
  ] as const;

  it("registers all expected commands", () => {
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

  // D10-4 (Cycle 11 Wave 2, P1): internal audit finding-IDs and decision tags
  // must not leak into end-user `--help`. Provenance belongs in `//` source
  // comments, never inside `.option()`/`.description()` literals that commander
  // renders verbatim. This guard walks the rendered help for every command +
  // subcommand and rejects any forbidden token. Patterns:
  //   (SA<n>... , D<n>-SA<n>... / D<n>-M<n> / D<n>-H<n> / D<n>-F<n>,
  //   C<n>-H<n> / C<n>-M<n>, Decision <n>
  const PROVENANCE_LEAK =
    /SA\d+\.\d|D\d+-(?:SA|M|H|F)\d|C\d+-[HM]\d|Decision \d/;

  function collectHelp(cmd: Command, path: string): Array<[string, string]> {
    const out: Array<[string, string]> = [[path, cmd.helpInformation()]];
    for (const sub of cmd.commands) {
      out.push(...collectHelp(sub, `${path} ${sub.name()}`));
    }
    return out;
  }

  it("never leaks internal finding-IDs or decision tags into rendered --help (D10-4)", () => {
    const offenders: string[] = [];
    for (const [path, help] of collectHelp(program, "hatch3r")) {
      for (const line of help.split("\n")) {
        if (PROVENANCE_LEAK.test(line)) {
          offenders.push(`[${path}] ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
