import { describe, it, expect } from "vitest";
import { resolveInvokedCommand } from "../../cli/shared/invokedCommand.js";

// D1-8 (Cycle 11 Wave 2, P1) regression: a global flag placed before the
// subcommand must not derail subcommand resolution. Before the fix the entry
// point read a fixed `process.argv[2]`, so `hatch3r --no-update-check init`
// resolved the subcommand to "--no-update-check", the BACKABLE_COMMANDS check
// missed "init", and registerBackablePrompts() never fired — silently breaking
// Shift+Tab back-navigation in `init`. `resolveInvokedCommand` skips leading
// flag tokens, so it returns the first positional ("init") regardless of how
// many global flags precede it.
describe("resolveInvokedCommand (D1-8: global-flag-before-subcommand)", () => {
  // argv shape is [node, script, ...rest]; the helper skips the first two.
  const argv = (...rest: string[]): string[] => ["node", "/path/to/cli.js", ...rest];

  it("resolves the subcommand when it is the first token (no leading flags)", () => {
    expect(resolveInvokedCommand(argv("init"))).toBe("init");
  });

  it("skips a leading global flag and resolves the subcommand (the D1-8 bug)", () => {
    // The exact failing invocation from the finding.
    expect(resolveInvokedCommand(argv("--no-update-check", "init"))).toBe("init");
  });

  it("skips multiple leading global flags", () => {
    expect(
      resolveInvokedCommand(argv("--no-update-check", "--verbose", "config")),
    ).toBe("config");
  });

  it("returns the subcommand, not a flag that follows it", () => {
    expect(resolveInvokedCommand(argv("init", "--yes"))).toBe("init");
  });

  it("returns undefined for a bare invocation (no positional)", () => {
    expect(resolveInvokedCommand(argv())).toBeUndefined();
  });

  it("returns undefined for a flags-only invocation (e.g. --help)", () => {
    expect(resolveInvokedCommand(argv("--help"))).toBeUndefined();
  });

  it("does not mis-read a flag value as the subcommand when value is flag-shaped", () => {
    // `--project-type -x` is malformed, but the helper must still skip both
    // dash-prefixed tokens rather than return "-x".
    expect(resolveInvokedCommand(argv("--project-type", "-x"))).toBeUndefined();
  });
});
