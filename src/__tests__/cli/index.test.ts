import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CommanderError, type Command } from "commander";
import { createProgram } from "../../cli/program.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/__tests__/cli → repo root is three levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

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

// D1-5 (Cycle 11 Wave 2, P1): the `verify` help text described a removed
// SHA-256 crypto-integrity manifest. verify is now a drift-detection wrapper;
// both the command `.description()` and the `command:*` "Common commands" hint
// must use the single shared summary and never mention SHA-256 / integrity.
describe("verify help-text accuracy (D1-5)", () => {
  const program = createProgram();

  it("verify description does not describe the removed SHA-256 integrity manifest", () => {
    const verify = program.commands.find((c) => c.name() === "verify");
    expect(verify).toBeDefined();
    const desc = verify!.description();
    expect(desc).not.toMatch(/SHA-256/i);
    expect(desc).not.toMatch(/integrity/i);
    // It now describes the actual behavior: drift detection via regeneration.
    expect(desc).toMatch(/drift/i);
  });

  it("sources the verify one-liner from a single constant used in both the description and the unknown-command hint", () => {
    // Single source of truth (VERIFY_SUMMARY constant): the command
    // `.description()` and the `command:*` 'Common commands' hint must both
    // reference the SAME constant so a future edit cannot leave one stale (the
    // prior bug had two divergent copies). Verified structurally against the
    // source: the constant is declared once and referenced in both sites.
    const src = readSource("src/cli/program.ts");
    expect(src).toMatch(/const VERIFY_SUMMARY\s*=/);
    expect(src).toContain(".description(VERIFY_SUMMARY)");
    expect(src).toContain("hatch3r verify    ${VERIFY_SUMMARY}");
  });
});

// D1-6 (Cycle 11 Wave 2, P5 Silent-Failure): the `status --deep` option was
// registered but never read (statusCommand never destructured it;
// computeAdapterDrift always regenerates). A flag that silently no-ops and
// documents a non-existent default fast-path violates the Silent Failure
// Contract — it must be gone from registration.
describe("status --deep removal (D1-6)", () => {
  it("status no longer registers a --deep option", () => {
    const status = createProgram().commands.find((c) => c.name() === "status")!;
    const flags = status.options.map((o) => o.long);
    expect(flags).not.toContain("--deep");
  });

  it("no help text references a non-existent integrity-manifest fast path", () => {
    const status = createProgram().commands.find((c) => c.name() === "status")!;
    expect(status.helpInformation()).not.toMatch(/integrity-manifest fast path/i);
  });
});

// D14-8 (Cycle 11 Wave 2, P1): Decision 16 retired the maturity content-
// admission gate — every tier installs the identical corpus. CLI help and the
// canonical type docs must use calibration language, never the stale
// admission claims (`gates content admission`, `admits every artifact`,
// `floor:enterprise-only`, `Drops items`). This guard greps the source so a
// regression cannot reintroduce the contradiction.
describe("maturity calibration language (D14-8 drift guard)", () => {
  // Stale admission-CLAIM phrasings. The correct negation ("does NOT gate
  // content admission") is intentionally not matched — we forbid the CLAIM, not
  // the substring.
  const STALE_ADMISSION_CLAIMS = [
    /gates content admission/i,
    /admits every artifact/i,
    /floor:enterprise-only/i,
    /Drops items tagged/i,
  ];

  it("--maturity help describes calibration, not content admission", () => {
    const init = createProgram().commands.find((c) => c.name() === "init")!;
    const maturityOpt = init.options.find((o) => o.long === "--maturity");
    expect(maturityOpt).toBeDefined();
    const help = maturityOpt!.description;
    expect(help).toMatch(/calibrat/i);
    expect(help).not.toMatch(/gates content admission/i);
  });

  it("program.ts carries no stale maturity admission claim", () => {
    const src = readSource("src/cli/program.ts");
    for (const pattern of STALE_ADMISSION_CLAIMS) {
      expect(src).not.toMatch(pattern);
    }
  });

  it("types.ts carries no stale maturity admission claim", () => {
    const src = readSource("src/types.ts");
    for (const pattern of STALE_ADMISSION_CLAIMS) {
      expect(src).not.toMatch(pattern);
    }
  });
});

// D15-5 (Cycle 11 Wave 2, P6): the documented `--pin-version` supply-chain
// control was unreachable — the option was never registered, so the command
// errored at parse even though updateCommand reads `pinVersion` and selfUpdate
// builds the pinned spec. Registration must exist with a value placeholder.
describe("update --pin-version wiring (D15-5)", () => {
  it("update registers a --pin-version option that takes a value", () => {
    const update = createProgram().commands.find((c) => c.name() === "update")!;
    const pin = update.options.find((o) => o.long === "--pin-version");
    expect(pin).toBeDefined();
    // `<semver>` is a required value argument, so the flag is value-taking.
    expect(pin!.required).toBe(true);
  });

  it("the assembled program parses `update --pin-version <semver>` without a usage error", () => {
    // exitOverride() means an unknown option would THROW a CommanderError with a
    // `commander.unknownOption` code. Parsing up to the action (which we do not
    // run here) must not raise that — proving the option is recognized. We stub
    // the action so parseAsync resolves without executing the real update.
    const program = createProgram();
    const update = program.commands.find((c) => c.name() === "update")!;
    let parsedPin: string | undefined;
    update.action((opts: { pinVersion?: string }) => {
      parsedPin = opts.pinVersion;
    });
    return expect(
      program.parseAsync(["update", "--pin-version", "2.0.0"], { from: "user" }),
    ).resolves.toBeDefined().then(() => {
      expect(parsedPin).toBe("2.0.0");
    });
  });
});

// D10-5 (Cycle 11 Wave 2, P1): unknown-option / excess-argument / missing-
// required parse errors previously bypassed the structured funnel because
// commander self-exited with code 1 before the catch in index.ts ran. With
// `program.exitOverride()`, commander THROWS a CommanderError instead, so
// index.ts can route it to exit 2 + run-id, and `showHelpAfterError` appends a
// help pointer.
describe("parse-error funnel via exitOverride (D10-5)", () => {
  it("an unknown option throws a CommanderError (commander.unknownOption) instead of exiting", () => {
    const program = createProgram();
    // Stub status' action so a clean parse would resolve; the error must come
    // from the unknown option, not a thrown action.
    program.commands.find((c) => c.name() === "status")!.action(() => {});
    let caught: unknown;
    try {
      program.parse(["status", "--definitely-not-a-flag"], { from: "user" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CommanderError);
    expect((caught as CommanderError).code).toBe("commander.unknownOption");
  });

  it("excess arguments throw a CommanderError (commander.excessArguments)", () => {
    const program = createProgram();
    // `status` declares no positional args, so two extras is an excess-args error.
    program.commands.find((c) => c.name() === "status")!.action(() => {});
    let caught: unknown;
    try {
      program.parse(["status", "extra1", "extra2"], { from: "user" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CommanderError);
    expect((caught as CommanderError).code).toBe("commander.excessArguments");
  });

  it("registers a help-after-error pointer so every parse error gains a usage hint", () => {
    // showHelpAfterError stores the pointer string; assert it is wired by
    // confirming the source registers it (commander has no public getter).
    const src = readSource("src/cli/program.ts");
    expect(src).toContain("showHelpAfterError");
    expect(src).toContain("program.exitOverride()");
  });
});
