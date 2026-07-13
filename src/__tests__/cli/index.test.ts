import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CommanderError, type Command } from "commander";
import { createProgram, AGENT_COMMAND_NAMES } from "../../cli/program.js";
import { HatchError } from "../../types.js";

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
    // Scaffold a fresh project (mkdir + git init, optional gh remote) then
    // chain into init.
    "setup",
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
    // D13-5 (Cycle 11 Wave 2): `learn capture` — shell entry point the /learn
    // skill shells out to so writes run through the persistLearning pipeline.
    "learn",
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

// D1-20 (Cycle 11 Wave 3, P1 / SA1.3-F2): `add` is a stub that always exits 0
// and reads no options, yet its registration advertised a `--force`
// "preflight integrity check" override and an exit-1 "integrity drift blocked"
// contract. The integrity subsystem was removed in Wave 7 (1.9.0); both were
// stale help-text claims that contradict the body. They must be gone from the
// registration until the pack installer lands.
describe("add --force / integrity-drift help removal (D1-20)", () => {
  it("add no longer registers a --force option", () => {
    const add = createProgram().commands.find((c) => c.name() === "add")!;
    const flags = add.options.map((o) => o.long);
    expect(flags).not.toContain("--force");
  });

  // The exit-1 / --force claims lived in the `.addHelpText("after", ...)` block,
  // which Commander renders only on help OUTPUT, not in `helpInformation()`, so
  // these guards grep the source — the same approach the maturity drift guard
  // (below) and verify-summary guard (above) use. The exact removed phrases are
  // matched (not loose substrings) so the SA1.3-F2 explanatory comment that
  // mentions "preflight integrity" is not a false positive.
  it("program.ts no longer advertises the integrity-drift gate on `add`", () => {
    const src = readSource("src/cli/program.ts");
    expect(src).not.toContain("Override the preflight integrity check and proceed despite drift");
    expect(src).not.toContain("Integrity drift blocked the command");
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

// W5 flag-surface drift guard: every registered command + subcommand must be
// classified below, and every non-stub member must register the standardized
// `--format <human|json>` (default "human") + `--quiet` pair; mutating
// commands with a meaningful preview must register `--dry-run`. A NEW command
// added to program.ts without a classification here fails the first test with
// an actionable message — that is the drift guard working as intended: add the
// command to the matching set(s) AND register the standard flags.
describe("W5 flag-surface drift guard", () => {
  const program = createProgram();

  // ── Classification sets (space-joined command paths) ──────────────────────
  // MUTATING: writes files / manifest / git state.
  const MUTATING = new Set<string>([
    "init",
    "setup", // mkdir + git init (+ optional gh remote), then chains into init
    "add", // pack install: writes .hatch3r/overrides/ + .hatch3r/packs/ ledger (CL-2 U12)
    "sync",
    "update",
    "config",
    "clean",
    "worktree-setup",
    "worktree-cleanup",
    "rollback",
    "mcp setup",
    "mcp remove",
    "cli-tools", // bare picker persists the selection
    "cli-tools install", // offerInstaller can run install commands
    "learn capture",
  ]);
  // READ_ONLY: inspection/reporting only.
  const READ_ONLY = new Set<string>([
    "status",
    "validate",
    "verify", // default mode is read-only; --fix regenerates (still non-prompting)
    "show",
    "list",
    "provenance",
    "deps",
    "explain",
    "mcp list",
    "mcp env-check",
    "cli-tools list",
    "cli-tools detect",
    "rollback list",
  ]);
  // INTERACTIVE_CAPABLE: at least one invocation shape opens a prompt, so
  // `--format json` is valid only for the headless shapes (--yes/--dry-run/
  // --all/scalar args) — enforced at runtime by beginCommand's interactive gate.
  const INTERACTIVE_CAPABLE = new Set<string>([
    "init",
    "setup", // prompts for a directory name when [dir] is omitted on a non-empty cwd
    "update",
    "config",
    "clean",
    "worktree-setup",
    "worktree-cleanup",
    "rollback",
    "mcp setup", // always prompts (picker) — json rejected
    "cli-tools", // always prompts (picker) — json rejected
    "cli-tools install", // prompts when tools are missing — json rejected
  ]);
  // STUB / group-shell exemptions (documented):
  //   - `mcp`: group shell with no action of its own (subcommands carry flags).
  //   - `learn`: group shell — the bare action exits 2 pointing at `learn capture`.
  // (`add` left this set in CL-2 U12: the pack installer is wired, so it is
  // classified MUTATING + DRY_RUN with the standard flag pair.)
  const STUB = new Set<string>(["mcp", "learn"]);
  // DRY_RUN: mutating commands where a meaningful preview exists.
  const DRY_RUN = new Set<string>([
    "init",
    "setup", // previews the scaffold plan (create dir / git init / remote / run init)
    "add", // previews the trust-gated write set without materializing (CL-2 U12)
    "sync",
    "update",
    "config",
    "clean",
    "worktree-setup",
    "worktree-cleanup",
    "rollback",
    "mcp setup",
    "mcp remove",
    "cli-tools",
    "learn capture",
  ]);

  function walk(cmd: Command, prefix: string): Array<{ path: string; cmd: Command }> {
    const out: Array<{ path: string; cmd: Command }> = [];
    for (const sub of cmd.commands) {
      const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
      out.push({ path, cmd: sub });
      out.push(...walk(sub, path));
    }
    return out;
  }
  const all = walk(program, "");

  it("classifies every registered command + subcommand (a new command must be added to a set here)", () => {
    const unclassified = all
      .map((e) => e.path)
      .filter(
        (p) =>
          !MUTATING.has(p) && !READ_ONLY.has(p) && !INTERACTIVE_CAPABLE.has(p) && !STUB.has(p),
      );
    expect(
      unclassified,
      `Command(s) registered in program.ts but not classified in the W5 drift guard: ` +
        `[${unclassified.join(", ")}]. Add each to MUTATING / READ_ONLY / ` +
        `INTERACTIVE_CAPABLE / STUB (and DRY_RUN if a preview exists) in index.test.ts, ` +
        `and register --format/--quiet per the W5 convention.`,
    ).toEqual([]);
  });

  it("carries no stale classification entries for unregistered commands", () => {
    const known = new Set(all.map((e) => e.path));
    const stale = [
      ...MUTATING,
      ...READ_ONLY,
      ...INTERACTIVE_CAPABLE,
      ...STUB,
      ...DRY_RUN,
    ].filter((p) => !known.has(p));
    expect(
      stale,
      `Classified command(s) no longer registered in program.ts: [${stale.join(", ")}]`,
    ).toEqual([]);
  });

  it("every non-stub command registers --format (default \"human\") and --quiet", () => {
    const offenders: string[] = [];
    for (const { path, cmd } of all) {
      if (STUB.has(path)) continue;
      const formatOpt = cmd.options.find((o) => o.long === "--format");
      if (!formatOpt) {
        offenders.push(`${path}: missing --format`);
      } else if (formatOpt.defaultValue !== "human") {
        offenders.push(
          `${path}: --format default is ${JSON.stringify(formatOpt.defaultValue)}, expected "human"`,
        );
      }
      if (!cmd.options.some((o) => o.long === "--quiet")) {
        offenders.push(`${path}: missing --quiet`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every member of the dry-run set registers --dry-run", () => {
    const offenders: string[] = [];
    for (const { path, cmd } of all) {
      if (!DRY_RUN.has(path)) continue;
      if (!cmd.options.some((o) => o.long === "--dry-run")) {
        offenders.push(`${path}: missing --dry-run`);
      }
    }
    expect(offenders).toEqual([]);
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

// D1-SA1.8-01 (Cycle 12 Wave 3, D1, P1): AGENT_COMMAND_NAMES (program.ts) is the
// hand-maintained redirect set the `command:*` handler uses to tell a user who
// types an editor slash-command at the terminal to run it in their AI editor
// instead of printing the generic "unknown command". Before this guard it had
// drifted from the corpus (4 artifacts deleted in v1.9.0 still listed; 11 on-disk
// commands — incl. 2.2.0 headline features like design-system-create — missing)
// with nothing to catch it, and `.claude/rules/capability-lifecycle.md` reuses
// the set as a reachability signal, so stale entries fed wrong removal decisions.
// This guard fails on the next drift.
describe("AGENT_COMMAND_NAMES ↔ corpus drift guard (D1-SA1.8-01)", () => {
  // commands/hatch3r-<name>.md basenames — editor-only orchestrators by
  // construction (none collide with a registered terminal CLI command).
  const commandBasenames = new Set(
    readdirSync(resolve(REPO_ROOT, "commands"))
      .filter((n) => n.startsWith("hatch3r-") && n.endsWith(".md"))
      .map((n) => n.replace(/^hatch3r-/, "").replace(/\.md$/, "")),
  );
  // skills/hatch3r-<name>/ directory names.
  const skillNames = new Set(
    readdirSync(resolve(REPO_ROOT, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("hatch3r-"))
      .map((e) => e.name.replace(/^hatch3r-/, "")),
  );
  // Command basenames that ARE real terminal CLI commands (must NOT redirect).
  // `learn` is the documented member (D13-5 promoted it to `hatch3r learn
  // capture`); there is no commands/hatch3r-learn.md today, so this allowlist has
  // no live collisions but is kept for future terminal-command additions.
  const TERMINAL_ALLOWLIST = new Set<string>(["learn"]);

  it("lists every commands/hatch3r-*.md basename (minus the terminal allowlist)", () => {
    const missing = [...commandBasenames]
      .filter((b) => !TERMINAL_ALLOWLIST.has(b) && !AGENT_COMMAND_NAMES.has(b))
      .sort();
    expect(
      missing,
      `commands/hatch3r-*.md basenames absent from AGENT_COMMAND_NAMES (src/cli/program.ts): ` +
        `[${missing.join(", ")}]. A user typing one at the terminal gets the generic "unknown ` +
        `command" message instead of the editor redirect. Add each to AGENT_COMMAND_NAMES, or to ` +
        `TERMINAL_ALLOWLIST here if it became a real CLI command.`,
    ).toEqual([]);
  });

  it("carries no phantom entry — every name resolves to an on-disk command or skill", () => {
    const phantom = [...AGENT_COMMAND_NAMES]
      .filter((name) => !commandBasenames.has(name) && !skillNames.has(name))
      .sort();
    expect(
      phantom,
      `AGENT_COMMAND_NAMES entries with no commands/hatch3r-<name>.md or skills/hatch3r-<name>/ on ` +
        `disk: [${phantom.join(", ")}]. The CLI tells the user to run a slash command that no longer ` +
        `exists. Remove each stale entry from src/cli/program.ts.`,
    ).toEqual([]);
  });
});

// D1-SA1.4-01 (Cycle 12 Wave 3, D1, P1): the top-level parseAsync catch is the
// funnel exit for verify/status --format json failures, which write their JSON
// document to stdout before throwing. A bare `process.exit(formatted.exitCode)`
// truncates that buffered stdout past the OS pipe buffer (Node docs), corrupting
// the machine-parsed payload exactly when the command fails. The catch must drain
// stdout+stderr before exiting — the same idiom the signal/crash nets use. (The
// three validate.ts JSON-error sites the finding also names are owned by a
// concurrent Wave-3 file-lock unit; this guard covers the index.ts exit only.)
describe("top-level catch drains stdout before exit (D1-SA1.4-01)", () => {
  const indexSource = readSource("src/cli/index.ts");

  it("wraps the funnel exit in the stdout→stderr drain idiom, not a bare process.exit", () => {
    const marker = "process.exit(formatted.exitCode)";
    const idx = indexSource.lastIndexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    // The 200 chars before the funnel exit must contain the inner stderr drain
    // callback — present only when the exit is nested inside the
    // process.stdout.write("", () => process.stderr.write("", () => ...)) idiom.
    // A bare synchronous exit would show writeFormattedCliError/DEBUG here.
    const preceding = indexSource.slice(Math.max(0, idx - 200), idx);
    expect(preceding).toContain('process.stderr.write("",');
  });
});

// D12-SA12.1-01 + D8-SA8.1-02 (Cycle 12 Wave 3): index.ts named
// .hatch3r/.failure-log.jsonl as a recovery surface but never wrote it, and its
// unhandledRejection net was diagnostically inferior to the uncaughtException
// sibling (no run id, no failure-log pointer, no clean-cancel classification).
// Both nets + the parseAsync catch now record the fault, the pointer is gated so
// it never dangles, and both nets share one fault footer via reportFatal.
describe("crash-net parity + failure-log recording (D8-SA8.1-02, D12-SA12.1-01)", () => {
  const indexSource = readSource("src/cli/index.ts");

  it("appends genuine top-level faults to the failure log from all three fault sites (D12-SA12.1-01)", () => {
    expect(indexSource).toContain("writeFailureLog");
    expect(indexSource).toContain('"cli:uncaught-exception"');
    expect(indexSource).toContain('"cli:unhandled-rejection"');
    expect(indexSource).toContain('"cli:top-level"');
  });

  it("gates the failure-log pointer on the entry persisting so it never dangles (D12-SA12.1-01)", () => {
    const start = indexSource.indexOf("function emitFaultFooter");
    expect(start).toBeGreaterThan(-1);
    const footer = indexSource.slice(start, start + 500);
    // The ".failure-log.jsonl" pointer sits inside a conditional (emitted only
    // when the entry persisted), not unconditionally at the handler top level.
    expect(footer).toMatch(/if\s*\([\s\S]*?\)\s*\{[\s\S]*?failure-log\.jsonl/);
  });

  it("routes both last-resort nets through the shared reportFatal helper with parity (D8-SA8.1-02)", () => {
    expect(indexSource).toContain('process.on("unhandledRejection"');
    expect(indexSource).toContain('process.on("uncaughtException"');
    expect(indexSource).toMatch(/function reportFatal\b/);
    expect(indexSource).toMatch(/reportFatal\([^)]*"cli:unhandled-rejection"/);
    expect(indexSource).toMatch(/reportFatal\([^)]*"cli:uncaught-exception"/);
    // Parity: reportFatal classifies clean cancellations (exit 130) and emits
    // the shared footer (run id + gated pointer) for both nets.
    expect(indexSource).toContain("classifyCliError(");
    expect(indexSource).toContain("emitFaultFooter(");
  });
});

// D3-SA3.2-04 (Cycle 12 Wave 3, D3, P5): the BACKABLE_COMMANDS set in
// src/cli/index.ts carried a prose "audited" census asserting each member
// guards Shift+Tab→BACK, but nothing enforced it and the census drifted (it
// claimed update had 2 prompts after it grew to 4 guarded sites). This scan
// converts that self-certification into a machine-checked invariant — the same
// source-scan pattern errors.test.ts (C8-D1-M5) applies to exitCode call sites.
// It reads the live BACKABLE set from index.ts, maps each command to its
// source, and asserts the source either routes prompts through runStepMachine
// (step-machine commands) or guards every inquirer.prompt site with an isBack
// check that cancels (defensive commands). Adding a command to the set without
// a spec entry here, or a defensive prompt without an isBack+cancel guard,
// fails this suite.
describe("BACKABLE back-nav guard invariant (D3-SA3.2-04)", () => {
  const indexSource = readSource("src/cli/index.ts");

  // Command name → { source file, back-handling mode }. Kept beside the scan so
  // adding a BACKABLE command forces an explicit classification here; the first
  // test fails when index.ts and this map drift.
  const BACKABLE_SPEC: Record<string, { file: string; mode: "step-machine" | "defensive" }> = {
    init: { file: "src/cli/commands/init.ts", mode: "step-machine" },
    config: { file: "src/cli/commands/config.ts", mode: "step-machine" },
    "worktree-cleanup": { file: "src/cli/commands/worktreeCleanup.ts", mode: "step-machine" },
    clean: { file: "src/cli/commands/clean.ts", mode: "defensive" },
    update: { file: "src/cli/commands/update.ts", mode: "defensive" },
    mcp: { file: "src/cli/commands/mcp.ts", mode: "defensive" },
    "cli-tools": { file: "src/cli/commands/cliTools.ts", mode: "defensive" },
  };

  // Cancel shapes a BACK-guard body may use: an early `return`, `process.exit(0)`,
  // a `throw new HatchError(..., 0)` (update's shape), or a "cancelled" message.
  const CANCELS = /\breturn\b|process\.exit\(0\)|HatchError\([^)]*,\s*0\)|cancelled/i;

  // Parse the live BACKABLE_COMMANDS membership out of index.ts source so the
  // invariant tracks the runtime set, not a copy that could drift.
  function readBackableSet(): string[] {
    const m = indexSource.match(/const BACKABLE_COMMANDS = new Set\(\[([\s\S]*?)\]\)/);
    if (!m) throw new Error("Could not locate BACKABLE_COMMANDS in src/cli/index.ts");
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }

  it("every BACKABLE_COMMANDS member has a back-handling spec (index.ts ↔ scan drift guard)", () => {
    const live = readBackableSet().sort();
    const spec = Object.keys(BACKABLE_SPEC).sort();
    expect(
      live,
      `BACKABLE_COMMANDS in src/cli/index.ts and BACKABLE_SPEC here have drifted: ` +
        `[${live.join(", ")}] vs [${spec.join(", ")}]. Add every new set member to ` +
        `BACKABLE_SPEC (source file + step-machine|defensive mode) so the back-nav ` +
        `guard invariant covers it.`,
    ).toEqual(spec);
  });

  it("step-machine commands route their prompts through runStepMachine", () => {
    const offenders: string[] = [];
    for (const [name, { file, mode }] of Object.entries(BACKABLE_SPEC)) {
      if (mode !== "step-machine") continue;
      if (!/runStepMachine/.test(readSource(file))) {
        offenders.push(`${name} (${file}): declared step-machine but source has no runStepMachine call`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("defensive commands guard every inquirer.prompt site with an isBack check that cancels", () => {
    const offenders: string[] = [];
    for (const [name, { file, mode }] of Object.entries(BACKABLE_SPEC)) {
      if (mode !== "defensive") continue;
      const src = readSource(file);
      const promptIdxs = [...src.matchAll(/inquirer\.prompt/g)].map((x) => x.index ?? 0);
      if (promptIdxs.length === 0) {
        // Delegates prompting to a backable picker helper (pickMcpServers /
        // pickCliTools); it must still guard the returned selection with isBack.
        if (!/isBack\(/.test(src)) {
          offenders.push(`${name} (${file}): defensive command with no isBack guard on its picker result`);
        }
        continue;
      }
      for (let i = 0; i < promptIdxs.length; i++) {
        const start = promptIdxs[i];
        const end = i + 1 < promptIdxs.length ? promptIdxs[i + 1] : src.length;
        const region = src.slice(start, end);
        const line = src.slice(0, start).split("\n").length;
        if (!/isBack\(/.test(region)) {
          offenders.push(`${file}:${line}: inquirer.prompt site with no isBack guard before the next prompt`);
        } else if (!CANCELS.test(region)) {
          offenders.push(
            `${file}:${line}: isBack guard present but no graceful-cancel (return/exit 0/cancelled) in the prompt region`,
          );
        }
      }
    }
    expect(
      offenders,
      `BACKABLE defensive command(s) have an unguarded or non-cancelling Shift+Tab→BACK prompt site:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});

// D1-SA1.4-02 (Cycle 12 Wave 3, D1, P1): `validate` predated the shared output
// module and hand-rolled `opts?.format === "json" ? "json" : "human"`, so
// `--format JSON` (wrong case) or `--format jsom` (typo) silently degraded to
// human mode and exited 0 — the D10-22 defect the framework closed everywhere
// else. The fix routes validate's --format through parseFormatOption at
// registration (program.ts .option coercion), matching verify/status: a bad
// value throws the exit-2 usage error and a mixed-case value normalizes.
// (validate.ts is owned by a concurrent Wave-3 file-lock unit; the
// registration-layer coercion closes the defect without touching it.)
describe("validate --format routes through the shared resolver (D1-SA1.4-02)", () => {
  function makeValidateProgram() {
    const program = createProgram();
    const validate = program.commands.find((c) => c.name() === "validate")!;
    let received: string | undefined;
    // Stub the action so a clean parse resolves without running real validation;
    // the --format coercion runs during parse, before the action fires.
    validate.action((opts: { format?: string }) => {
      received = opts.format;
    });
    return { program, getFormat: () => received };
  }

  it("normalizes a mixed-case --format value to the canonical enum (JSON → json)", async () => {
    const { program, getFormat } = makeValidateProgram();
    await program.parseAsync(["validate", "--format", "JSON"], { from: "user" });
    expect(getFormat()).toBe("json");
  });

  it("passes a lowercase --format value through unchanged (human)", async () => {
    const { program, getFormat } = makeValidateProgram();
    await program.parseAsync(["validate", "--format", "human"], { from: "user" });
    expect(getFormat()).toBe("human");
  });

  it("rejects an unrecognized --format value with a HatchError carrying exit code 2 (no silent human-mode degrade)", async () => {
    const { program } = makeValidateProgram();
    let caught: unknown;
    try {
      await program.parseAsync(["validate", "--format", "jsom"], { from: "user" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(2);
  });

  it("defaults to human when --format is omitted (the default is not coerced)", async () => {
    const { program, getFormat } = makeValidateProgram();
    await program.parseAsync(["validate"], { from: "user" });
    expect(getFormat()).toBe("human");
  });
});
