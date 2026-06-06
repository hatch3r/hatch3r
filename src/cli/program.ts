import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { worktreeSetupCommand } from "./commands/worktreeSetup.js";
import { worktreeCleanupCommand } from "./commands/worktreeCleanup.js";
import { cleanCommand } from "./commands/clean.js";
import { configCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
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

// D1-5 (Cycle 11 Wave 2, P1): single source of truth for the `verify`
// one-liner. The legacy text described a removed SHA-256 crypto-integrity
// manifest; `verify` has been a drift-detection wrapper over
// `computeAdapterDrift` since the integrity subsystem was deleted in 1.9.0.
// Sourced here so the command `.description()` and the `command:*` "Common
// commands" hint can never drift apart again (the prior bug had two stale
// copies).
const VERIFY_SUMMARY =
  "Detect drift in hatch3r-managed files by regenerating from canonical content and diffing";

// Agent command names that users might try to run directly in the terminal.
// These are slash commands meant to be invoked inside an AI-powered editor, not from the CLI.
const AGENT_COMMAND_NAMES = new Set([
  "workflow", "project-spec", "codebase-map", "debug", "release",
  "refactor-plan", "test-plan", "bug-plan", "feature-plan", "migration-plan",
  "roadmap", "onboard", "recipe",
  "board-init", "board-pickup", "board-groom", "board-refresh", "board-fill",
  "board-shared",
  "security-audit", "dep-audit", "benchmark", "healthcheck", "context-health",
  // D13-5 (Cycle 11 Wave 2): `learn` is NO LONGER an editor-only redirect.
  // `hatch3r learn capture --file <path>` is a registered terminal subcommand
  // (the shell entry point the `/learn` LLM skill shells out to so writes run
  // through the `persistLearning` security pipeline). The bare `/learn` slash
  // command still lives in the editor — the registered `learn` group's bare
  // action points the user there — so `learn` is dropped from this redirect set.
  "revision", "cost-tracking", "api-spec", "hooks", "quick-change",
  "command-customize", "agent-customize", "rule-customize", "skill-customize",
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
    .description(
      "Battle-tested agentic coding setup framework. Crack the egg. Hatch better agents.",
    )
    .version(HATCH3R_VERSION)
    // D1-SA1.8-F-1.8-4 / D10-SA10.2-F9 (Cycle 10 Wave 4, P1): declare the
    // global `--no-update-check` flag so `hatch3r --help` enumerates it.
    // The flag's behavior is implemented by a pre-parse argv-strip in
    // `src/cli/index.ts` that sets HATCH3R_NO_UPDATE_CHECK=1 — that path runs
    // BEFORE `program.parseAsync()` because the update probe (`checkForUpdates`)
    // fires at startup, so it cannot wait for `program.opts()`. This option
    // registration exists for discoverability only; the strip is the source of
    // truth for the runtime effect.
    .option("--no-update-check", "Skip the daily update-notifier probe for this run");

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
    .option("--cli-tools <ids>", "CLI tools to opt in on --yes: 'tier1', 'all', or comma-separated ids (default: tier-1 + triggered tier-2)")
    .option("--no-cli-tools", "Skip the CLI-tools opt-in on --yes")
    .option("--mcp", "Re-opt-in to MCP servers on --yes (MCP is now opt-in by default)")
    // D1-SA1.1-F13 (D1, P1): explicit MCP opt-out, symmetric with `--no-cli-tools`.
    // Commander binds `--no-mcp` to the same `mcp` destination (sets opts.mcp =
    // false); the dedicated `noMcp` field init.ts reads additionally force-disables
    // even when `--mcp` is also passed, so a CI/audit config can self-document
    // "no MCP" rather than rely on the implicit default.
    .option("--no-mcp", "Explicitly disable MCP servers on --yes (default; force-off even with --mcp)")
    // --quiet/--json/--no-banner provenance: C9-H26 (Cycle 9). --resume: Decision 27.
    .option("--quiet", "Suppress stdout chrome (banner, spinner, success box); stderr diagnostics still emit")
    .option("--json", "Emit a machine-readable JSON summary on stdout; implies --quiet")
    .option("--no-banner", "Skip the ASCII banner at startup")
    .option("--resume", "Resume from the last checkpoint in .init-workspace/checkpoint.json")
    // --maturity provenance: Decision 4 / #16. --role: D14-M6. --facets: D14-M9. --per-package: D14-SA14.2-H1.
    // D14-8 (Cycle 11 Wave 2, P1): help text was a content-admission claim that
    // contradicts Decision 16 — every tier installs the identical corpus; the
    // tier only calibrates how deep the agents invest (see docs/maturity-tiers.md).
    .option("--maturity <tier>", "Project maturity tier: solo, team, scaleup, enterprise (default: solo) — calibrates investment depth; does not change which content is installed")
    .option("--role <role>", "Role bundle: reviewer, security-lead, senior-eng — filters content to items tagged for the named role")
    .option("--facets <list>", "Comma-separated graduated-customization facets to add on top of the preset: a11y, performance, observability")
    .option("--per-package", "On a monorepo, also copy adapter output under each package (default: root-only). Capped at 25 packages, batched, and .gitignore'd")
    .action(initCommand);

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
    .action(updateCommand);

  program
    .command("validate")
    .description("Check canonical content structure: frontmatter, cross-references, content safety, compliance")
    .option("--verbose", "Show detailed validation output for each check")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .option(
      "--strict-content",
      "Escalate content-body lint (anti-slop wordlist + missing pillar references) from warnings to errors",
    )
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
    .option("--fix", "Auto-fix detected drift by running hatch3r update")
    .option("--max-fix-attempts <n>", "Maximum verify-fix cycles (default: 2, max: 5)", parseInt)
    // --verbose provenance: D1-SA1.4-F11. --diff: D12-SA12.2-F5. --format: SA12.1-F-D12-M2.
    .option("--verbose", "Show the per-tool / per-file drift breakdown (same detail as `hatch3r status`) before the PASS/FAIL summary")
    .option("--diff", "Show a before/after diff summary for each generated file")
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
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
    .action((arg1: string | undefined, arg2: string | undefined) => configCommand(arg1, arg2));

  program
    .command("clean")
    .description("Remove all hatch3r artifacts from the current repo (optionally reinitialize after)")
    .option("--yes", "Skip confirmation prompts (cleans without reinit)")
    .option("--dry-run", "Show what would be removed without modifying files")
    // --learnings provenance: D6-M7.
    .option(
      "--learnings",
      "Also remove .hatch3r/learnings/ and .hatch3r/handoffs/ — use for session-corruption recovery when prior context is poisoning fresh runs",
    )
    .action(cleanCommand);

  program
    .command("add [pack]")
    .description("Install a community pack (coming soon)")
    // D1-SA1.3-F2 (Medium, P1): `--force` advertised a "preflight integrity
    // check" override and an exit-1 "integrity drift blocked" contract. The
    // integrity-manifest subsystem was removed in Wave 7 (1.9.0) and the body
    // (add.ts) is a stub that always exits 0, never reading any option — so
    // both were stale help-text claims. They are dropped here until the pack
    // installer body lands; re-add the option + exit-1 row alongside the
    // pack-trust-model §3/§4/§5 gates flagged in add.ts when it does.
    .addHelpText(
      "after",
      [
        "",
        "Roadmap:",
        "  Community pack installation is not yet shipped. The command exits 0 today and",
        "  prints a pointer to the repo's releases + discussions. Scripts that probe for the",
        "  subcommand (e.g. feature-flagged CI) will not see a usage error (exit 2) anymore.",
        "  - Releases:    https://github.com/hatch3r/hatch3r/releases",
        "  - Discussions: https://github.com/hatch3r/hatch3r/discussions",
        "",
        "Exit codes:",
        "  0  Informational (feature pending; no action required)",
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
    .option("--verbose", "Break the skipped-files count down by reason (idempotent re-run vs concurrent-write race)")
    .action(worktreeSetupCommand);

  program
    .command("worktree-cleanup")
    .description("Discover hatch3r-managed worktrees from the main repo, then clean files and remove the selected worktree(s)")
    .option("--dry-run", "Show what would be done without changes")
    .option("--all", "Skip the all/specific prompt and clean every hatch3r-managed worktree")
    .option("--yes", "Skip selection and confirmation prompts (implies --all unless paths are filtered upstream)")
    .option("--files-only", "Remove hatch3r-managed files only; keep the git worktree and its directory")
    .action(worktreeCleanupCommand);

  // CLI-tooling pivot (plan §4.5): side-door commands for MCP and CLI tools.
  // `hatch3r init` no longer opens the MCP picker by default; users opt in
  // via the Yes/No gate during init or run `hatch3r mcp setup` later.
  const mcpCmd = program
    .command("mcp")
    .description("Manage MCP servers (now opt-in; CLI tools are the default)");
  mcpCmd
    .command("setup")
    .description("Open the MCP server picker and update the manifest + .env.mcp")
    .action(mcpSetupCommand);
  mcpCmd
    .command("list")
    .description("Show current MCP server configuration plus .env.mcp status")
    .action(mcpListCommand);
  mcpCmd
    .command("remove <id>")
    .description("Remove an MCP server by id")
    .action(mcpRemoveCommand);
  mcpCmd
    .command("env-check")
    .description("Audit .env.mcp for missing required environment variables")
    .action(mcpEnvCheckCommand);

  const cliCmd = program
    .command("cli-tools")
    .description("Manage CLI tool integrations (ripgrep, jq, gh, …)")
    .action(cliToolsCommand);
  cliCmd
    .command("list")
    .description("Show current CLI tool selection plus detection status")
    .action(cliToolsListCommand);
  cliCmd
    .command("install")
    .description("Print install commands for any selected CLI tools missing on PATH")
    .action(cliToolsInstallCommand);
  cliCmd
    .command("detect")
    .description("Read-only detection report for the current CLI tool selection")
    .action(cliToolsDetectCommand);

  // Decision 27 (Bucket 2.2): per-session snapshot rollback. Long-running
  // orchestrators capture pre-mutation snapshots under .hatch3r/snapshots/;
  // `hatch3r rollback --session=<id>` restores them, `rollback list` enumerates.
  const rollbackCmd = program
    .command("rollback")
    .description("Restore files mutated during a recorded session (snapshot rollback)")
    .option("--session <id>", "Session id to restore (see `hatch3r rollback list`)")
    .option("--yes", "Skip the confirmation prompt")
    .option("--dry-run", "Preview the rollback without writing")
    .action(rollbackCommand);
  rollbackCmd
    .command("list")
    .description("Enumerate snapshot sessions captured under .hatch3r/snapshots/")
    .action(rollbackListCommand);

  // SA12.1-F-D12-M9 (Cycle 10 Wave 3, D12, P1): inspect a single canonical
  // artifact (frontmatter + resolved scope + body preview) or enumerate every
  // artifact of a given type. Both are read-only — they delegate to
  // `buildContentIndex` so the CLI sees exactly what adapters see.
  program
    .command("show <id>")
    .description("Print frontmatter + resolved scope + body preview for a canonical artifact")
    .action((id: string) => showCommand(id));

  program
    .command("list <type>")
    .description("Enumerate canonical artifacts of a type (agent | skill | rule | command | hook | prompt | github-agent)")
    .action((type: string) => listCommand(type));

  // SA12.1-F-D12-M11 (Cycle 10 Wave 3, D12, P1): read affordance for the
  // provenance manifest at `.hatch3r/provenance.json`. The file has shipped
  // since Wave 7 but was previously only inspectable via `hatch3r explain
  // --source <output-path>` (requires knowing the path) — this top-level
  // subcommand lets operators answer "what's recorded right now?".
  program
    .command("provenance")
    .description("Inspect the .hatch3r/provenance.json manifest (header + per-adapter rollup)")
    // --format provenance: SA12.1-F-D12-M2.
    .option(
      "--format <format>",
      "Output format for CI consumers: human (default) or json",
      "human",
    )
    .action(provenanceCommand);

  // SA12.1-F-D12-M13 (Cycle 10 Wave 3, D12, P1): surface orchestration
  // dependencies declared in frontmatter (commands' agentPipeline, agents'
  // delegates list) plus the inverse "what depends on me?" view. The
  // build-time validator already enforces these — this subcommand makes
  // them inspectable from the CLI.
  program
    .command("deps <id>")
    .description("Show orchestration dependencies (downstream + upstream) declared in frontmatter")
    .action((id: string) => depsCommand(id));

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
    .action((opts: { file?: string; as?: string }) => learnCaptureCommand(opts));

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
    .option("--verbose", "Show detailed output")
    .action(explainCommand);

  // Catch-all for unknown commands -- redirect agent commands to the editor
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
    process.exit(1);
  });

  return program;
}
