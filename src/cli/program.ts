import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { worktreeSetupCommand } from "./commands/worktreeSetup.js";
import { worktreeCleanupCommand } from "./commands/worktreeCleanup.js";
import { cleanCommand } from "./commands/clean.js";
import { configCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { setupCommand } from "./commands/setup.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";
import { verifyCommand } from "./commands/verify.js";
import { statusCommand } from "./commands/status.js";
import { explainCommand } from "./commands/explain.js";
import { rollbackCommand, rollbackListCommand } from "./commands/rollback.js";
import { showCommand, listCommand } from "./commands/show.js";
import { provenanceCommand } from "./commands/provenance.js";
import { depsCommand } from "./commands/deps.js";
import { learnCaptureCommand } from "./commands/learn.js";
import {
  mcpSetupCommand,
  mcpListCommand,
  mcpRemoveCommand,
  mcpEnvCheckCommand,
} from "./commands/mcp.js";
import {
  cliToolsCommand,
  cliToolsListCommand,
  cliToolsInstallCommand,
  cliToolsDetectCommand,
} from "./commands/cliTools.js";
import { HATCH3R_VERSION } from "../version.js";
import { TOOL_CHOICES } from "../types.js";
import { parseFormatOption } from "./shared/output.js";
import { disableCrossProcessLocking } from "../merge/safeWrite.js";

// D1-5 (Cycle 11 Wave 2, P1): single source of truth for the `verify`
// one-liner. The legacy text described a removed SHA-256 crypto-integrity
// manifest; `verify` has been a drift-detection wrapper over
// `computeAdapterDrift` since the integrity subsystem was deleted in 1.9.0.
// Sourced here so the command `.description()` and the `command:*` "Common
// commands" hint can never drift apart again (the prior bug had two stale
// copies).
const VERIFY_SUMMARY =
  "Detect drift in hatch3r-managed files by regenerating from canonical content and diffing";

// D1-SA1.8-07 / D3-SA3.2-09 (Cycle 12 Wave 4, D1/D3, P5): single source of
// truth for the program's `--help` description. The former copy opened with
// "Battle-tested" — an unverifiable marketing claim the audit charter
// (AUDIT.md directive 5) names as the canonical example of framing-not-evidence
// — so the opener is dropped for a neutral descriptor. Exported so the
// entrypoint subprocess test (src/__tests__/cli/entrypoint.test.ts) asserts
// against this constant instead of hard-coding the copy, decoupling the suite
// from the wording (a copy edit now touches one site).
export const PROGRAM_DESCRIPTION =
  "Agentic coding setup framework. Crack the egg. Hatch better agents.";

// Agent command names that users might try to run directly in the terminal.
// These are slash commands meant to be invoked inside an AI-powered editor, not
// from the CLI. The `command:*` handler below uses this set to redirect such a
// mistype to the editor rather than printing the generic "unknown command".
//
// D1-SA1.8-01 (Cycle 12 Wave 3, D1, P1): exported so the drift-guard test in
// `src/__tests__/cli/index.test.ts` keeps this hand-maintained set in sync with
// the on-disk corpus — it had silently drifted (4 artifacts deleted in v1.9.0
// were still listed; 11 on-disk commands, incl. 2.2.0 headline features, were
// missing) with no test/CI gate to catch it, and `.claude/rules/
// capability-lifecycle.md` reuses the set as a reachability signal, so stale
// entries fed wrong removal decisions. The guard's contract: every
// `commands/hatch3r-*.md` basename (an editor-only orchestrator by
// construction) MUST appear here (minus a documented terminal-command
// allowlist), and every entry here MUST resolve to an on-disk command or skill.
// `learn` is intentionally absent — D13-5 promoted it to a real terminal
// subcommand (`hatch3r learn capture --file <path>`, the shell entry point the
// `/learn` LLM skill shells out to so writes run through the `persistLearning`
// security pipeline); the bare `/learn` slash command still lives in the editor.
export const AGENT_COMMAND_NAMES = new Set([
  // commands/hatch3r-*.md — editor-only orchestrators (all must be listed)
  "api-spec", "auth-scaffold", "benchmark", "board-fill", "board-pickup",
  "bug-pipeline", "bug-plan", "codebase-map", "create", "debug",
  "design-system-create", "diagnose", "feature-plan", "handoff", "healthcheck",
  "incident-response", "migration-plan", "onboard", "pack-install", "plan",
  "pr-resolve", "project-spec", "quick-change", "refactor-plan", "release",
  "rework", "roadmap", "security-audit", "slo-scaffold", "spec", "test-plan",
  "workflow",
  // skills/hatch3r-* commonly mistyped at the terminal (curated subset — the
  // drift guard requires each listed name to exist on disk, not that every
  // skill is listed). `customize` is the merged entry point that replaced the
  // four `*-customize` command stubs deleted in v1.9.0.
  "board-groom", "board-init", "board-refresh", "board-shared",
  "context-health", "cost-tracking", "customize", "dep-audit", "hooks", "recipe",
]);

/**
 * Create and configure the Commander program with all commands registered.
 * Single source of truth for command/option registration. Separated from
 * index.ts so tests can import without triggering side effects (signal
 * handlers, parseAsync, Node version check).
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("hatch3r")
    .description(PROGRAM_DESCRIPTION)
    .version(HATCH3R_VERSION)
    // D1-SA1.8-F-1.8-4 / D10-SA10.2-F9 (Cycle 10 Wave 4, P1): declare the
    // global `--no-update-check` flag so `hatch3r --help` enumerates it.
    // The flag's behavior is implemented by a pre-parse argv-strip in
    // `src/cli/index.ts` that sets HATCH3R_NO_UPDATE_CHECK=1 — that path runs
    // BEFORE `program.parseAsync()` because the update probe (`checkForUpdates`)
    // fires at startup, so it cannot wait for `program.opts()`. This option
    // registration exists for discoverability only; the strip is the source of
    // truth for the runtime effect.
    .option("--no-update-check", "Skip the daily update-notifier probe for this run")
    // DD-A4 (release/2.8.5): global opt-out for the default-on cross-process
    // write lock (src/merge/safeWrite.ts::isLockingEnabled). Program-level on
    // purpose (NOT registered per-command): the lock is a process-wide write
    // policy, and the preAction hook below applies it before any command body
    // runs. Commander scopes program options to the program parser, so the
    // flag goes BEFORE the subcommand: `hatch3r --no-lock sync`.
    // HATCH3R_LOCK=1 force-re-enables over this flag; HATCH3R_LOCK=0 is the
    // env-level equivalent.
    .option(
      "--no-lock",
      "Disable the default cross-process write lock for this run (place before the subcommand: `hatch3r --no-lock sync`; HATCH3R_LOCK=1 overrides)",
    );

  // DD-A4: apply the `--no-lock` opt-out before every command action.
  // Commander maps the negated boolean to `opts().lock === false`
  // (default true when the flag is absent).
  program.hook("preAction", () => {
    if (program.opts().lock === false) {
      disableCrossProcessLocking();
    }
  });

  // D10-5 (Cycle 11 Wave 2, P1): route parse errors through the structured
  // funnel. `exitOverride()` makes commander throw a `CommanderError` out of
  // `parseAsync()` instead of calling `process.exit(1)` itself — that internal
  // self-exit previously bypassed `formatActionableError` in `src/cli/index.ts`,
  // so an unknown option / too-many-args / missing-required mistake exited 1
  // with no help pointer or run-id. With the override the catch in index.ts
  // classifies the CommanderError (`code` is `commander.*`) as a usage error
  // (exit 2 + run-id) and `showHelpAfterError` appends a help pointer to every
  // parse failure. Help/version requests throw a CommanderError with exitCode 0
  // (`commander.helpDisplayed` / `commander.version`); index.ts exits 0 cleanly
  // for those so `hatch3r --help` keeps working.
  program.exitOverride();
  program.showHelpAfterError("(run `hatch3r --help` for usage)");

  // D11-14 (Cycle 11 Wave 3, P6) / DD-A5 (release/2.8.5): document the
  // cross-process write-locking controls on the global help. Since 2.8.5
  // every mutating command (init, sync, update, config, mcp, cli-tools,
  // rollback, workspace/worktree) serializes same-file writes across
  // processes by default via a `proper-lockfile` advisory lock
  // (<file>.hatch3r.lock beside each target), so two concurrent runs against
  // the same repo wait instead of clobbering last-writer-wins. The controls
  // below are the opt-outs / force-on.
  program.addHelpText(
    "after",
    "\nEnvironment:\n" +
      "  HATCH3R_LOCK=0   Disable the default cross-process write lock for this run.\n" +
      "                   By default every mutating command serializes same-file writes\n" +
      "                   across processes via an advisory lock (<file>.hatch3r.lock), so\n" +
      "                   concurrent hatch3r runs against the same repo wait instead of\n" +
      "                   clobbering each other last-writer-wins.\n" +
      "                   `hatch3r --no-lock <command>` is the flag equivalent.\n" +
      "  HATCH3R_LOCK=1   Force-enable locking, overriding a --no-lock flag.\n",
  );

  program
    .command("init")
    .description("Install a complete agent setup into the current repo (first-run: creates .hatch3r/ state + per-tool output files)")
    .option(
      "--tools <tools>",
      `Comma-separated tools (${TOOL_CHOICES})`,
    )
    .option("--yes", "Skip interactive prompts, use defaults")
    .option("--quick", "Skip all prompts and use smart defaults (alias for --yes)")
    .option("--default", "Skip all prompts and use smart defaults (alias for --yes)")
    .option("--preset <preset>", "Content preset: minimal, standard, full, web-app, api-service, cli-tool, monorepo, legacy, security — or a comma-list to compose (e.g. 'api-service,security'). Default: standard")
    .option("--import <target>", "Import an existing tool's config into hatch3r (cursor, copilot, windsurf, cursorrules, or auto — converts each into .hatch3r/overrides/rules/ as .md + .mdc with cross-format conflict detection)")
    .option("--project-type <type>", "Project type: greenfield, brownfield")
    .option("--team-size <size>", "Team size: solo, team")
    .option("--worktree", "Enable git worktree file isolation (overrides tool auto-detect)")
    .option("--no-worktree", "Disable git worktree file isolation")
    .option("--workspace", "Initialize as a multi-repo workspace")
    .option("--cli-tools <ids>", "CLI tools to opt in on any init path: 'tier1', 'all', or comma-separated ids (skips the picker on interactive runs; --yes default: tier-1 + triggered tier-2)")
    .option("--no-cli-tools", "Skip CLI tools on any init path (interactive runs skip the picker)")
    .option("--mcp", "Opt in to MCP servers on any init path (MCP is opt-in by default; interactive init no longer prompts — or run `hatch3r mcp setup` later)")
    // D1-SA1.1-F13 (D1, P1): explicit MCP opt-out, symmetric with `--no-cli-tools`.
    // Commander binds `--no-mcp` to the same `mcp` destination (sets opts.mcp =
    // false); the dedicated `noMcp` field init.ts reads additionally force-disables
    // even when `--mcp` is also passed, so a CI/audit config can self-document
    // "no MCP" rather than rely on the implicit default.
    .option("--no-mcp", "Explicitly disable MCP servers on any init path (default; force-off even with --mcp)")
    // --quiet/--json/--no-banner provenance: C9-H26 (Cycle 9). --resume: Decision 27.
    // --format/--dry-run/--verbose provenance: W5 flag-surface standardization
    // (every non-stub command registers --format + --quiet; --json stays as a
    // legacy boolean alias that upgrades format to "json").
    .option("--quiet", "Suppress stdout chrome (banner, spinner, success box); stderr diagnostics still emit")
    .option("--json", "Emit a machine-readable JSON summary on stdout; implies --quiet")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--dry-run", "Preview what init would create or change without writing files")
    .option("--verbose", "Show detailed per-step output")
    .option("--no-banner", "Skip the ASCII banner at startup")
    .option("--resume", "Resume from the last checkpoint in .init-workspace/checkpoint.json")
    // --maturity provenance: Decision 16 (gate→dial reframe). --role: D14-M6. --facets: D14-M9. --per-package: D14-SA14.2-H1.
    // D1-16 / D14-8 (Cycle 11, P1/P5): help text was a content-admission claim
    // citing the retired "Decision 4" gate — it contradicted Decision 16, where
    // every tier installs the identical corpus and the tier only calibrates how
    // deep the agents invest (see docs/maturity-tiers.md + CONSTITUTION §6
    // Decision 16). Both the help string and this provenance cite now say
    // Decision 16.
    .option("--maturity <tier>", "Project maturity tier: solo, team, scaleup, enterprise (default: solo) — calibrates investment depth; does not change which content is installed")
    // 2.8.0 additive manifest scalars — flag-only by design: init is at its
    // 6-prompt ceiling (CONSTITUTION §6 row 32), so neither flag adds a prompt.
    .option("--communication-style <style>", "How generated agents talk to you: plain, technical (default: plain; flag-only — adds no prompt; change later with `hatch3r config communication_style=<style>`)")
    .option("--default-effort <effort>", "Persisted default orchestration intensity: light, standard, deep (absent: auto-tier from task shape; an explicit --effort run flag overrides; change later with `hatch3r config default_effort=<effort>`)")
    .option("--role <role>", "Role bundle: reviewer, security-lead, senior-eng — filters content to role-tagged items (no effect until the canonical corpus carries role:* tags; currently a no-op)")
    .option("--facets <list>", "Comma-separated graduated-customization facets to add on top of the preset: a11y, performance, observability")
    .option("--per-package", "On a monorepo, also copy adapter output under each package (default: root-only). Capped at 25 packages, batched, and .gitignore'd")
    .action(initCommand);

  program
    .command("setup [dir]")
    .description("Scaffold a fresh project (mkdir + git init, optional GitHub remote) then chain into `hatch3r init`. Needs only Node + git; --remote is opt-in")
    // --remote is opt-in and degrades to a warning when `gh` is missing/unauthed
    // — the happy path must succeed with only Node 22+ and git installed.
    .option("--remote", "Create a private GitHub remote via `gh repo create` after git init (skipped with a warning when gh is missing or unauthenticated)")
    // Pass-through init options (subset of `init`'s flag surface, forwarded to
    // initCommand after the scaffold step).
    .option("--tools <tools>", `Comma-separated tools (${TOOL_CHOICES})`)
    .option("--preset <preset>", "Content preset forwarded to init (e.g. minimal, standard, full, web-app)")
    .option("--maturity <tier>", "Project maturity tier forwarded to init: solo, team, scaleup, enterprise (default: solo)")
    .option("--yes", "Skip interactive prompts (scaffold + init use smart defaults)")
    // --format/--quiet/--dry-run/--verbose provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner, boxes); stderr diagnostics still emit")
    .option("--dry-run", "Preview the scaffold plan (create dir, git init, remote, then run init) without writing anything")
    .option("--verbose", "Show detailed per-step output")
    .action(setupCommand);

  program
    .command("sync")
    .description("Re-generate tool outputs from bundled canonical content (run after updating hatch3r or editing .hatch3r/ overrides)")
    .option("--repos [paths...]", "Sync workspace content to sub-repos (all opted-in if no paths given)")
    .option("--dry-run", "Show what would change without modifying files")
    .option("--diff", "Show a before/after diff summary for each generated file")
    .option("--force", "Overwrite locally modified files in sub-repos")
    .option("--minimal", "Generate stripped-down output (no comments, minimal formatting) to reduce token usage")
    .option("--strict-budget", "Fail sync if any adapter's generated output exceeds its context budget (default: warn)")
    .option("--clean-orphans", "Remove generated adapter output files that no longer match canonical-inventory naming (no hatch3r- prefix). Default is informational only.")
    .option("--verbose", "Show detailed output for each file processed")
    // --resume provenance: Decision 27.
    .option("--resume", "Resume from the last checkpoint in .sync-workspace/checkpoint.json")
    // --concurrency provenance: D14-SA14.2-F4.
    .option(
      "--concurrency <n>",
      "Parallel workspace sub-repo sync limit (default: min(CPU count, 8); raise on SSD-bound runners)",
    )
    // --format provenance: SA12.1-F-D12-M2.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    // --preview-tool provenance: SA12.1-F-D12-M8.
    .option(
      "--preview-tool <name>",
      "Under --dry-run, print the full content body that the named adapter would write",
    )
    // --quiet provenance: W5 flag-surface standardization.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, success box); stderr diagnostics still emit")
    .action(syncCommand);

  program
    .command("status")
    .description("Check sync status between bundled canonical content and generated files")
    .option("--verbose", "Show detailed per-file status information")
    // D1-6 (Cycle 11 Wave 2, P5 Silent-Failure): the prior `--deep` option was
    // registered but never read — `statusCommand` does not destructure it and
    // `computeAdapterDrift` always regenerates every adapter's output in memory
    // (the integrity-manifest "fast path" it claimed to toggle was removed with
    // the integrity subsystem in 1.9.0). A flag that documents a non-existent
    // default and silently no-ops violates the Silent Failure Contract, so it
    // is removed. Re-introduce only alongside a real fidelity toggle wired
    // through statusCommand + computeAdapterDrift.
    // --diff provenance: D12-SA12.2-F5. --format provenance: SA12.1-F-D12-M2.
    .option("--diff", "Show a before/after diff summary for each generated file (same box `hatch3r sync --diff` emits)")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    // --quiet provenance: W5 flag-surface standardization.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, summary boxes); stderr diagnostics still emit")
    // D11-SA11.2-F10 (D11, P1): document drift scope in --help so an operator
    // reading `hatch3r status --help` learns the check covers only the
    // hatch3r-managed block before they run it — symmetric with the runtime
    // scope-disclosure note status emits when drift exists.
    .addHelpText(
      "after",
      "\nNote: status compares only the hatch3r-managed block (HATCH3R:BEGIN/END)\n" +
        "against a fresh regeneration. Content you author OUTSIDE those markers is\n" +
        "yours and is never reported here — use `git diff` to inspect it.\n",
    )
    .action(statusCommand);

  program
    .command("update")
    .description("Pull latest hatch3r templates with safe merge (preserves customizations)")
    .option("--yes", "Skip interactive prompts, use defaults")
    .option("--diff", "Show a before/after diff summary for each generated file")
    .option("--force", "Overwrite hatch3r-prefixed managed files even if their HATCH3R:BEGIN/END markers were stripped (same contract as `hatch3r sync --force`)")
    .option("--offline, --skip-fetch", "Skip the package fetch step; regenerate only from already-installed canonical content")
    .option("--dry-run", "Preview what would change (added/modified/unchanged per adapter) without writing files")
    .option("--skip-audit-signatures", "EMERGENCY OVERRIDE: skip `npm audit signatures` verification on the freshly-fetched package. Default is to refuse update on signature failure.")
    .option("--clean-orphans", "Remove generated adapter output files that no longer match canonical-inventory naming (no hatch3r- prefix). Default is informational only.")
    // --no-redetect provenance: D14-16 (Cycle 11 Wave 3, D14, P3). Commander
    // maps the negated flag to `redetect: false`; default-on re-detects project
    // languages and refreshes `.hatch3r/hatch.json::languages` so the
    // regenerated agents render verification-gate commands for the current
    // language set instead of the frozen init-time one.
    .option("--no-redetect", "Skip post-init language re-detection; keep the init-pinned language set and verification-gate commands")
    // --pin-version provenance: F15.4-H2 (D15-SA15.4, P6). D15-5 (Cycle 11
    // Wave 2): the option was missing from registration, so the documented
    // supply-chain version-pinning control errored at parse — `updateCommand`
    // already reads `pinVersion` and persists it to `versionConstraint`, and
    // `selfUpdate` already builds the pinned `hatch3r@<semver>` install spec.
    .option("--pin-version <semver>", "Pin `hatch3r update` to a semver range or exact version (persisted to .hatch3r/hatch.json::versionConstraint); pass `latest` to clear the pin")
    // --format provenance: SA12.1-F-D12-M2.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    // --quiet provenance: W5 flag-surface standardization.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, success box); stderr diagnostics still emit")
    .action(updateCommand);

  program
    .command("validate")
    .description("Check canonical content structure: frontmatter, cross-references, content safety, compliance")
    .option("--verbose", "Show detailed validation output for each check")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      // D1-SA1.4-02 (Cycle 12 Wave 3, D1, P1): route validate's --format through
      // the shared parseFormatOption resolver at parse time so a mixed-case value
      // (JSON) normalizes to "json" and an unrecognized value (jsom) fails with
      // the exit-2 usage error — matching verify/status, which inherit it via
      // beginCommand. Before this, validateCommand hand-rolled
      // `opts?.format === "json" ? "json" : "human"`, silently degrading both to
      // human mode (the D10-22 defect class, still live on this flagship command).
      parseFormatOption,
      "human",
    )
    .option(
      "--strict-content",
      "Escalate content-body lint (anti-slop wordlist + missing pillar references) from warnings to errors",
    )
    // --quiet provenance: W5 flag-surface standardization.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, summary boxes); stderr diagnostics still emit")
    .addHelpText(
      "after",
      "\nNote: `hatch3r validate` covers structural validation of the bundled canonical\n" +
        "content (frontmatter, cross-refs, anti-slop, deny patterns, command\n" +
        "orchestrator marker). Framework-development checks (`.md`/`.mdc` rule parity,\n" +
        "P7 efficiency invariants, CLI-skill parity, wiring) live in separate\n" +
        "`npm run validate:*` scripts and are aggregated by `npm run validate`. CI\n" +
        "should run BOTH `hatch3r validate` AND `npm run validate` for full coverage.\n",
    )
    .action(validateCommand);

  program
    .command("verify")
    .description(VERIFY_SUMMARY)
    // D1-22 (Cycle 11 Wave 3, P5 Silent-Failure): the prior help named the
    // wrong command + wrong defect class — `--fix` does NOT run `hatch3r update`
    // (no package fetch, no network). It calls `runRegenerate` (verify.ts), the
    // same offline in-memory adapter regeneration `hatch3r sync` performs, up to
    // `--max-fix-attempts` times. Wording aligned to that behavior so an
    // operator does not expect an upstream pull.
    .option("--fix", "Auto-repair detected drift by regenerating adapter output (offline; same regeneration as `hatch3r sync`), up to --max-fix-attempts cycles")
    .option("--max-fix-attempts <n>", "Maximum verify-fix cycles (default: 2, max: 5)", parseInt)
    // --verbose provenance: D1-SA1.4-F11. --diff: D12-SA12.2-F5. --format: SA12.1-F-D12-M2.
    .option("--verbose", "Show the per-tool / per-file drift breakdown (same detail as `hatch3r status`) before the PASS/FAIL summary")
    .option("--diff", "Show a before/after diff summary for each generated file")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    // --quiet provenance: W5 flag-surface standardization.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, PASS/FAIL box); stderr diagnostics still emit")
    // D11-SA11.2-F10 (D11, P1): mirror the status --help scope note so the two
    // drift commands describe their scope identically. verify compares only the
    // hatch3r-managed block; content outside the markers is the user's.
    .addHelpText(
      "after",
      "\nNote: verify compares only the hatch3r-managed block (HATCH3R:BEGIN/END)\n" +
        "against a fresh regeneration. Content you author OUTSIDE those markers is\n" +
        "yours and is never reported here — use `git diff` to inspect it.\n",
    )
    .action(verifyCommand);

  program
    .command("config [arg1] [arg2]")
    .description(
      "Reconfigure tools, MCP servers, features, and platform. " +
      "Accepts scalar key/value forms: `config maturity=<tier>`, " +
      "`config confidence_floor=<any|medium|high>`, " +
      "`config get <key>`, `config set <key> <value>`. " +
      "With no args, runs the interactive flow.",
    )
    // --format/--quiet/--dry-run/--verbose provenance: W5 flag-surface
    // standardization. Options are passed through to configCommand, which
    // reads them (interface contract with the config command body).
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, boxes, next steps); stderr diagnostics still emit")
    .option("--dry-run", "Preview the configuration change without writing")
    .option("--verbose", "Show detailed output")
    .action((arg1: string | undefined, arg2: string | undefined, opts: Record<string, unknown>) => configCommand(arg1, arg2, opts as never));

  program
    .command("clean")
    .description("Remove hatch3r adapter outputs + manifest from the current repo (preserves .hatch3r/ state and .env.mcp; --purge removes those too; optionally reinitialize after)")
    .option("--yes", "Skip confirmation prompts (cleans without reinit; with --purge, also skips the purge confirmation)")
    .option("--dry-run", "Show what would be removed without modifying files")
    // --learnings provenance: D6-M7.
    .option(
      "--learnings",
      "Also remove .hatch3r/learnings/ and .hatch3r/handoffs/ — use for session-corruption recovery when prior context is poisoning fresh runs",
    )
    // --purge provenance: D1-21 (Cycle 11 Wave 3). The default clean is
    // partial-removal by design (keeps .hatch3r/ state + .env.mcp secrets);
    // --purge is the full-uninstall surface that also deletes .hatch3r/ and
    // .env.mcp. Irreversible — it removes .hatch3r/snapshots/, so there is no
    // rollback session to revert it.
    .option(
      "--purge",
      "Full uninstall: after the standard clean, also remove the entire .hatch3r/ directory (state, snapshots, overrides) and .env.mcp. Irreversible — no rollback snapshot survives. Prompts for a separate confirmation unless --yes",
    )
    // --format/--quiet/--verbose provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json (valid only with --yes or --dry-run — the confirmation prompt would interleave with the JSON document)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner, summary box); stderr diagnostics still emit")
    .option("--verbose", "List each removed file on stderr as the clean runs")
    .action(cleanCommand);

  program
    .command("add [pack]")
    .description("Install a community pack from a local path or an installed npm package")
    // CL-2 U12 (D5-SA5.3-09, Cycle 12): pack installer wired — see
    // src/install/packInstall.ts for the gate pipeline. D1-SA1.3-F2 lineage:
    // `--force` stays retired (the integrity-manifest subsystem it overrode
    // was removed in Wave 7 / 1.9.0); collisions with files the pack does not
    // own refuse install outright, and the unsigned-pack override is the
    // separate, explicit `--allow-untrusted` below. A bare `hatch3r add`
    // probe invocation keeps the repaired C8-D1-M8 contract: informational
    // notice, exit 0 — never a usage error.
    .option("--dry-run", "Run every trust gate and preview the write set without writing files")
    .option(
      "--allow-untrusted",
      "Install a pack that declares no signing method (refused by default); the override is recorded in the install ledger",
    )
    .option("--format <format>", "Output format for CI consumers: human (default) or json", "human")
    .option("--quiet", "Suppress stdout chrome (banner, summary box); stderr diagnostics still emit")
    .addHelpText(
      "after",
      [
        "",
        "Pack sources:",
        "  ./path/to/pack   local directory containing pack-manifest.json",
        "  <package-name>   npm package already installed under node_modules/",
        "                   (hatch3r never runs npm install itself)",
        "",
        "Trust gates (all run before any write):",
        "  pack-manifest.json field validation; signing declaration (or --allow-untrusted);",
        "  SHA-256 integrity map; lifecycle-script ban; deny-pattern body scan;",
        "  capability, footprint, and declared-tools checks; path-traversal guards.",
        "",
        "Exit codes:",
        "  0   Success (also: bare `hatch3r add` info notice, --dry-run preview)",
        "  2   Usage error (invalid flag value)",
        "  64  Pack validation refused (manifest field, footprint, undeclared tool,",
        "      traversal guard, collision)",
        "  65  Banned lifecycle script in the pack's package.json",
        "  73  Signing/integrity refused (unsigned without --allow-untrusted,",
        "      SHA-256 mismatch)",
        "",
      ].join("\n"),
    )
    .action(addCommand);

  program
    .command("worktree-setup [name]")
    .description("Create a git worktree by name and populate hatch3r files (auto-resolved to .worktrees/<name>)")
    .option("--from <path>", "Main repo path (auto-detected by default)")
    .option("--from-path <path>", "Legacy mode: populate an existing worktree at <path> (skips git worktree add). Used by editor hooks.")
    .option("--dry-run", "Show what would be done without changes")
    .option("--force", "Overwrite existing files in the worktree")
    .option("--yes", "Skip the secret-propagation confirmation prompt")
    .option("--use-existing", "When branch <name> already exists (locally or on origin), attach/track it in the new worktree without prompting")
    .option("--no-use-existing", "Never reuse an existing branch <name>: fail with a rename hint instead of prompting")
    .option("--verbose", "Break the skipped-files count down by reason (idempotent re-run vs concurrent-write race)")
    // --format/--quiet provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json (valid only with --yes or --dry-run)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner, summary box); stderr diagnostics still emit")
    .action(worktreeSetupCommand);

  program
    .command("worktree-cleanup")
    .description("Discover hatch3r-managed worktrees from the main repo, then clean files and remove the selected worktree(s)")
    .option("--dry-run", "Show what would be done without changes")
    .option("--all", "Skip the all/specific prompt and clean every hatch3r-managed worktree")
    .option("--yes", "Skip selection and confirmation prompts (implies --all unless paths are filtered upstream)")
    .option("--files-only", "Remove hatch3r-managed files only; keep the git worktree and its directory")
    // --format/--quiet provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json (valid only with --yes or --all — the selection prompts would interleave with the JSON document)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner, summary box); stderr diagnostics still emit")
    .action(worktreeCleanupCommand);

  // CLI-tooling pivot (plan §4.5): side-door commands for MCP and CLI tools.
  // `hatch3r init` no longer opens the MCP picker by default; users opt in
  // via the Yes/No gate during init or run `hatch3r mcp setup` later.
  const mcpCmd = program
    .command("mcp")
    .description("Manage MCP servers (now opt-in; CLI tools are the default)");
  // --format/--quiet/--dry-run on mcp subcommands: W5 flag-surface
  // standardization. `setup` always opens the interactive picker, so
  // `--format json` is rejected there at runtime; the headless subcommands
  // (list, remove <id>, env-check) accept it.
  mcpCmd
    .command("setup")
    .description("Open the MCP server picker and update the manifest + .env.mcp")
    .option(
      "--format <format>",
      "Output format: human (default) or json (rejected — setup always prompts)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, success box); stderr diagnostics still emit")
    .option("--dry-run", "Show the resulting server list + features.mcp without writing the manifest or .env.mcp")
    .action((opts: { format?: string; quiet?: boolean; dryRun?: boolean }) => mcpSetupCommand(opts));
  mcpCmd
    .command("list")
    .description("Show current MCP server configuration plus .env.mcp status")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => mcpListCommand(opts));
  mcpCmd
    .command("remove <id>")
    .description("Remove an MCP server by id")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, success box); stderr diagnostics still emit")
    .option("--dry-run", "Show the resulting server list + features.mcp without writing the manifest")
    .action((id: string, opts: { format?: string; quiet?: boolean; dryRun?: boolean }) => mcpRemoveCommand(id, opts));
  mcpCmd
    .command("env-check")
    .description("Audit .env.mcp for missing required environment variables")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => mcpEnvCheckCommand(opts));

  // --format/--quiet/--dry-run on cli-tools: W5 flag-surface standardization.
  // The bare command and `install` can prompt (picker / installer confirm), so
  // `--format json` is rejected there at runtime; list + detect accept it.
  const cliCmd = program
    .command("cli-tools")
    .description("Manage CLI tool integrations (ripgrep, jq, gh, …)")
    .option(
      "--format <format>",
      "Output format: human (default) or json (rejected — the bare command always opens the picker)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, success box); stderr diagnostics still emit")
    .option("--dry-run", "Show the resulting tool selection without writing the manifest")
    .action((opts: { format?: string; quiet?: boolean; dryRun?: boolean }) => cliToolsCommand(opts));
  cliCmd
    .command("list")
    .description("Show current CLI tool selection plus detection status")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => cliToolsListCommand(opts));
  cliCmd
    .command("install")
    .description("Print install commands for any selected CLI tools missing on PATH")
    .option(
      "--format <format>",
      "Output format: human (default) or json (rejected — install may open a confirmation prompt)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => cliToolsInstallCommand(opts));
  cliCmd
    .command("detect")
    .description("Read-only detection report for the current CLI tool selection")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => cliToolsDetectCommand(opts));

  // Decision 27 (Bucket 2.2): per-session snapshot rollback. Long-running
  // orchestrators capture pre-mutation snapshots under .hatch3r/snapshots/;
  // `hatch3r rollback --session=<id>` restores them, `rollback list` enumerates.
  const rollbackCmd = program
    .command("rollback")
    .description("Restore files mutated during a recorded session (snapshot rollback)")
    .option("--session <id>", "Session id to restore (see `hatch3r rollback list`)")
    .option("--yes", "Skip the confirmation prompt")
    .option("--dry-run", "Preview the rollback without writing")
    // --format/--quiet provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json (valid only with --yes or --dry-run)",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, spinner, PASS/FAIL box); stderr diagnostics still emit")
    .action(rollbackCommand);
  rollbackCmd
    .command("list")
    .description("Enumerate snapshot sessions captured under .hatch3r/snapshots/")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, hints); stderr diagnostics still emit")
    .action((opts: { format?: string; quiet?: boolean }) => rollbackListCommand(opts));

  // SA12.1-F-D12-M9 (Cycle 10 Wave 3, D12, P1): inspect a single canonical
  // artifact (frontmatter + resolved scope + body preview) or enumerate every
  // artifact of a given type. Both are read-only — they delegate to
  // `buildContentIndex` so the CLI sees exactly what adapters see.
  program
    .command("show <id>")
    .description("Print frontmatter + resolved scope + body preview for a canonical artifact")
    // --format/--quiet provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box, hints); stderr diagnostics still emit")
    // D12-SA12.3-02 (Cycle 12 Wave 4, D12, CQ2): signpost that `show` prints the
    // CANONICAL source, not the adapter-delivered bytes, and point to the
    // rendered-output preview. Without this a first-time user inspecting "what
    // my editor receives" mistakes the pre-transformation body for the shipped
    // instructions — the render preview was reachable only from the
    // undiscoverable `sync --dry-run --preview-tool` flag. A help-text
    // cross-reference from `show`/`explain` is exactly the discoverability
    // signpost the finding's falsifiability names.
    .addHelpText(
      "after",
      "\nNote: `show` prints the CANONICAL source (frontmatter + body), not what an\n" +
        "adapter delivers. On sync, the adapter wraps the body in HATCH3R:BEGIN/END\n" +
        "markers, adds an NN- filename prefix, applies customization, and (Cursor)\n" +
        "rewrites frontmatter to .mdc shape. To preview the rendered per-adapter\n" +
        "output, run:  hatch3r sync --dry-run --preview-tool <adapter>\n",
    )
    .action((id: string, opts: { format?: string; quiet?: boolean }) => showCommand(id, opts));

  program
    .command("list <type>")
    .description("Enumerate canonical artifacts of a type (agent | skill | rule | command | hook | prompt | github-agent)")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, hints); stderr diagnostics still emit")
    .action((type: string, opts: { format?: string; quiet?: boolean }) => listCommand(type, opts));

  // SA12.1-F-D12-M11 (Cycle 10 Wave 3, D12, P1): read affordance for the
  // provenance manifest at `.hatch3r/provenance.json`. The file has shipped
  // since Wave 7 but was previously only inspectable via `hatch3r explain
  // --source <output-path>` (requires knowing the path) — this top-level
  // subcommand lets operators answer "what's recorded right now?".
  program
    .command("provenance")
    .description("Inspect the .hatch3r/provenance.json manifest (header + per-adapter rollup)")
    // --format provenance: SA12.1-F-D12-M2. --quiet: W5 standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, boxes, hints); stderr diagnostics still emit")
    .action(provenanceCommand);

  // SA12.1-F-D12-M13 (Cycle 10 Wave 3, D12, P1): surface orchestration
  // dependencies declared in frontmatter (commands' agentPipeline, agents'
  // delegates list) plus the inverse "what depends on me?" view. The
  // build-time validator already enforces these — this subcommand makes
  // them inspectable from the CLI.
  program
    .command("deps <id>")
    .description("Show orchestration dependencies (downstream + upstream) declared in frontmatter")
    // --format/--quiet provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, box, hints); stderr diagnostics still emit")
    .action((id: string, opts: { format?: string; quiet?: boolean }) => depsCommand(id, opts));

  // D13-5 (Cycle 11 Wave 2, ASI06): `learn` command group. The `/learn` LLM
  // skill authors a learning file then shells out to `hatch3r learn capture
  // --file <path>` so the write runs through the `persistLearning` security
  // pipeline (3 injection gates + integrity verification + refuse-overwrite +
  // atomic temp+rename) instead of a raw `Write` that bypasses all of it. The
  // bare `learn` group prints guidance toward the editor `/learn` skill, since
  // learning EXTRACTION (asking the user, drafting the body) is an LLM task.
  const learnCmd = program
    .command("learn")
    .description("Capture learnings authored by the /learn editor skill into .hatch3r/learnings/ via the security pipeline")
    .addHelpText(
      "after",
      "\nLearning extraction (drafting the body) runs in your AI editor via the /learn skill.\n" +
        "That skill stages a file, then shells out to `hatch3r learn capture --file <path>`\n" +
        "so the write is screened by the persistLearning gates before it reaches disk.\n",
    )
    .action(() => {
      // Bare `hatch3r learn` is not the capture path — point at the subcommand
      // and the editor skill rather than silently no-op'ing.
      console.error(
        "\n  `hatch3r learn` has one terminal subcommand: `hatch3r learn capture --file <path>`." +
          "\n  To DRAFT a learning, open your AI editor and run the /learn skill — it stages a" +
          "\n  file and invokes `hatch3r learn capture` for you.\n",
      );
      process.exit(2);
    });
  learnCmd
    .command("capture")
    .description("Commit a staged learning file through the persistLearning security pipeline into .hatch3r/learnings/")
    .requiredOption("--file <path>", "Path to the staged learning file the /learn skill authored")
    .option("--as <filename>", "Destination filename in .hatch3r/learnings/ (default: the staged file's basename)")
    // --format/--quiet/--dry-run provenance: W5 flag-surface standardization.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option("--quiet", "Suppress stdout chrome (banner, success box); stderr diagnostics still emit")
    .option("--dry-run", "Run every security/integrity gate against the staged file without persisting it")
    .action((opts: { file?: string; as?: string; format?: string; quiet?: boolean; dryRun?: boolean }) => learnCaptureCommand(opts));

  // C9-H13: surface the triage-first cost model declared in canonical
  // command frontmatter (triage_tiers + agentPipeline) so users can answer
  // "what will this command cost at each tier?" without running it.
  // SA12.3-F03 (Cycle 10 Wave 2): add `--customizations` mode for the
  // per-artifact customize.{yaml,md} state table. The two modes are mutually
  // exclusive and the action validates that exactly one is provided.
  program
    .command("explain")
    .description("Explain a hatch3r command's cost model, the customization-applied state, a generated file's canonical sources, OR the recorded efficiency telemetry")
    .option("--cost <command-id>", "Command id to explain (e.g. hatch3r-quick-change, quick-change)")
    .option("--customizations", "List every .customize.yaml/.customize.md pair with applied state and reasons")
    .option("--source [output-path]", "Show the canonical source files behind a generated output (e.g. CLAUDE.md); omit the path or pass `all` for a per-output source-count summary (add --verbose for every full source list)")
    // --efficiency provenance: D6-M2.
    .option("--efficiency", "Show per-artifact + per-phase aggregate from .hatch3r/efficiency-events.jsonl (telemetry gated by HATCH3R_EFFICIENCY_TELEMETRY=1)")
    .option("--model <selector>", "Cost at a named model's rates: tier alias (opus|sonnet|haiku) or model id (e.g. claude-opus-4-8); default is Sonnet rates (--cost only)")
    .option("--input-rate <usd-per-1m>", "Override input rate in USD per 1M tokens; takes precedence over --model (--cost only)")
    .option("--output-rate <usd-per-1m>", "Override output rate in USD per 1M tokens; takes precedence over --model (--cost only)")
    .option("--cache-hit <ratio>", "Fraction 0-1 of input served from the prompt cache; cached input billed at 0.1x (--cost only)")
    // D12-11 introduced --format json for --source; W5 widened it to every
    // explain mode (--cost, --customizations, --efficiency emit one JSON
    // document each). --quiet: W5 flag-surface standardization.
    .option("--format <format>", "Output format: human (default) or json", "human")
    .option("--quiet", "Suppress stdout chrome (banner, boxes, hints); stderr diagnostics still emit")
    .option("--verbose", "Show detailed output")
    // D12-SA12.3-02 (Cycle 12 Wave 4, D12, CQ2): cross-reference the rendered
    // per-adapter output preview. `explain --source` shows which canonical files
    // feed a generated output; the preview below shows the exact bytes an adapter
    // writes — previously reachable only from the undiscoverable
    // `sync --dry-run --preview-tool` flag.
    .addHelpText(
      "after",
      "\nTip: `explain --source <output>` lists the canonical files behind a generated\n" +
        "file. To preview the exact rendered bytes an adapter would write for a tool,\n" +
        "run:  hatch3r sync --dry-run --preview-tool <adapter>\n",
    )
    .action(explainCommand);

  // Catch-all for unknown commands -- redirect agent commands to the editor.
  // Registering a `command:*` listener makes commander hand the unknown-command
  // case to us instead of throwing its own error, so this handler owns the exit
  // code for that path (commander.exitOverride() never sees it).
  program.on("command:*", (operands: string[]) => {
    const cmd = operands[0];
    if (cmd && AGENT_COMMAND_NAMES.has(cmd)) {
      console.error(
        `\n  "${cmd}" is a hatch3r agent command meant to be run inside your AI editor (e.g. /${cmd}).` +
        `\n  It cannot be invoked from the terminal CLI.` +
        `\n\n  To use agent commands, open your project in Cursor, Claude Code, or another supported tool` +
        `\n  and type /${cmd} in the AI chat.\n`,
      );
    } else {
      console.error(
        `\n  Unknown command: ${cmd}` +
        `\n  Run "hatch3r --help" for available commands.` +
        `\n\n  Common commands:` +
        `\n    hatch3r init      Set up agent configuration in current repo` +
        `\n    hatch3r sync      Regenerate tool outputs from canonical content` +
        `\n    hatch3r status    Check sync status` +
        `\n    hatch3r validate  Check canonical content structure and safety` +
        `\n    hatch3r verify    ${VERIFY_SUMMARY}` +
        `\n    hatch3r config    Reconfigure tools, features, MCP` +
        `\n    hatch3r clean     Remove hatch3r artifacts\n`,
      );
    }
    // D12-8 (Cycle 11 Wave 3, P1): both branches are usage-class errors — the
    // user invoked a name that is not a runnable terminal command. Exit 2 to
    // honor the documented usage-error contract (`cli-ux-standards.md`: 0 ok,
    // 1 unexpected, 2 usage) and match the unknown-OPTION path, which commander
    // routes through exitOverride() → CommanderError → index.ts exit 2. The
    // legacy exit 1 here aliased a usage mistake to the "unexpected error" class
    // so CI could not branch on it.
    process.exit(2);
  });

  return program;
}
