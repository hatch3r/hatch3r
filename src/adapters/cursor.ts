// Last updated: 2026-07-14 (P3 platform-currency anchor; cursor.com/docs/agent/hooks
// + cursor.com/docs/agent/subagents access dates inside this file remain
// authoritative for individual claims. D9-M1 Cycle 10 Wave-3 re-verified the
// `readonly: true` subagent frontmatter primitive against the current
// /docs/agent/subagents URL. D9-4 Cycle 11 Wave-2 re-verified the full hook
// lifecycle against cursor.com/docs/agent/hooks accessed 2026-06-06: the
// `subagentStart` event carries `subagent_type` and returns
// `{permission: "deny"}` to block an over-privileged agent at spawn — wired
// to `.cursor/hooks/subagent-guard.mjs` as the hard runtime ASI02 block.
// release/2.7.0 re-verified the subagent `model:` field against
// cursor.com/docs/subagents.md accessed 2026-07-14: concrete ids plus
// per-model bracket options — verbatim example `claude-opus-4-8[effort=high]`
// — drive the class-mapped agent emission below.).
import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import {
  readMaturityTier,
  maturityDirective,
  readCommunicationStyle,
  communicationStyleDirective,
  readDefaultEffort,
  defaultEffortDirective,
  readConfidenceFloor,
  confidenceFloorDirective,
} from "../manifest/hatchJson.js";
import { BaseAdapter, output, type AdapterContext, type CompanionSubdir } from "./base.js";
import { sortByPrecedence, precedenceRank, resolveRuleGlobs } from "./canonical.js";
import { resolveAgentEffort, resolveAgentModel } from "../models/resolve.js";
import { resolveModelAlias } from "../models/aliases.js";
import {
  CLASS_HIGH,
  CLASS_LOW,
  CLASS_TOP,
  CURSOR_TIER_MODEL_MAP,
  EFFORT_RANK,
  defaultEffortForClass,
  normalizeEffortLevel,
  normalizeModelClass,
  resolveTierModel,
} from "../models/tiers.js";
import { applyCustomization } from "./customization.js";
import { stripPrivateMcpFields, transformEnvVarSyntax } from "./mcp-utils.js";
import { toCursorReadonlyFrontmatter } from "../pipeline/adapterToolTranslator.js";
import type { HookDefinition, HookEvent } from "../hooks/types.js";
import {
  buildAgentToolPoliciesJson,
  buildCursorAllowlistRule,
  buildCursorSubagentGuardHookScript,
} from "../pipeline/agentToolAllowlist.js";

/**
 * The Cursor adapter generates .mdc files from .md canonical files by adding
 * Cursor-specific frontmatter (description, globs/alwaysApply) and wrapping
 * content in managed blocks. Rules get `alwaysApply: true` or `globs: [...]`
 * based on their scope. Agents get `name`, `description`, `model`, `readonly`,
 * and `is_background` frontmatter fields.
 */

/**
 * F14.3-H2 (Cycle 10 D14, Pillar P3): per-tier output marker.
 *
 * Adapter outputs were byte-identical across maturity tiers (Decision 4 /
 * #16) — an enterprise install received the same `.cursor/rules/` content
 * as a solo install with no signal of the declared tier. Emit a one-line
 * header comment carrying `manifest.maturity` (absence collapses to
 * `"solo"` via {@link readMaturityTier}) at the top of every per-rule body
 * so the tier travels with the generated artifact. The marker is a markdown
 * comment so it renders invisibly in Cursor's rule view while remaining
 * greppable for drift checks. Paired with F14.3-C1's admission tagging so
 * the tier shown here matches the content actually selected.
 */
function cursorMaturityHeader(ctx: AdapterContext): string {
  // D6-29 (Cycle 11 Wave 3): wrap the shared directive payload (single source in
  // hatchJson.ts::maturityDirective) in an HTML comment so it renders invisibly
  // in Cursor's rule view while staying greppable for drift checks.
  return `<!-- ${maturityDirective(readMaturityTier(ctx.manifest))} -->`;
}

/**
 * D1-17 (Cycle 11 Wave 3, D1, P1): per-rule confidence-floor marker, the
 * agent-assertiveness analog of {@link cursorMaturityHeader}. Wraps the shared
 * `confidenceFloorDirective` payload (single source in hatchJson.ts) in an HTML
 * comment — same invisible-render + greppable design as the maturity header —
 * so the resolved floor ({@link readConfidenceFloor}: explicit `confidenceFloor`
 * else the maturity-aware default) travels with each generated rule. Pre-fix the
 * persisted floor reached no adapter output.
 */
function cursorConfidenceFloorHeader(ctx: AdapterContext): string {
  return `<!-- ${confidenceFloorDirective(readConfidenceFloor(ctx.manifest))} -->`;
}

/**
 * 2.8.0: per-rule communication-style marker, sibling of
 * {@link cursorMaturityHeader}. Wraps the shared `communicationStyleDirective`
 * payload (single source in hatchJson.ts) in an HTML comment — same
 * invisible-render + greppable design. Absence resolves to "plain" via
 * {@link readCommunicationStyle}, so the marker is always stamped.
 */
function cursorCommunicationStyleHeader(ctx: AdapterContext): string {
  return `<!-- ${communicationStyleDirective(readCommunicationStyle(ctx.manifest))} -->`;
}

/**
 * 2.8.0: per-rule default-effort marker. Conditional, unlike the three
 * markers above: an ABSENT `defaultEffort` means auto-tier
 * ({@link readDefaultEffort} returns undefined) and NO marker is emitted —
 * returning "" keeps a no-field rule body byte-identical to pre-2.8 output
 * (the emission site joins only non-empty header lines).
 */
function cursorDefaultEffortHeader(ctx: AdapterContext): string {
  const effort = readDefaultEffort(ctx.manifest);
  return effort === undefined ? "" : `<!-- ${defaultEffortDirective(effort)} -->`;
}

/**
 * D9-H-4 (Cycle 10 D9, Pillar P3): canonical hook event → Cursor 1.7+
 * `hooks.json` lifecycle event (camelCase taxonomy per
 * https://cursor.com/docs/agent/hooks accessed 2026-06-06).
 *
 * Cursor's hook surface runs a shell `command` and reads a permission
 * decision (`{permission: allow|deny|ask}`) — it does NOT spawn an agent.
 * hatch3r hooks declare an `agent:` to activate, which has no native
 * command equivalent, so the emitted `command` surfaces the activation
 * directive on stdout and the `.cursor/rules/hook-*.mdc` rule (still
 * emitted below) carries the actual agent-spawn instruction. The canonical
 * hook events with no Cursor lifecycle equivalent (`post-merge`, `ci-failure`,
 * `review-loop-cap`) are absent from this map and fall through to the `.mdc`
 * fallback only. (`worktree-create`/`worktree-remove` are reserved `HookEvent`
 * type values with no canonical hook file, so they never reach this map —
 * D11-SA11.4-03/-04.)
 *
 * D9-15 (Cycle 11 Wave 3, D9, P6; re-graded D9-SA9.2-02, Cycle 12):
 * `review-loop-cap` is advisory-only on Cursor because no Cursor hook payload
 * carries the orchestrator's per-issue `.review-loop.json` counter context; the
 * closest pre-tool event is `preToolUse` (its payload exposes no agent-identity
 * field — cursor.com/docs/agent/hooks accessed 2026-06-09 — so it cannot bind
 * to a fixer-spawn), and `subagentStart` is already the ASI02 NO_POLICY
 * hard-deny boundary that fires at every spawn without the loop counter. The
 * earlier absolute "no native runtime gate" framing is re-graded: Cursor's
 * current hooks doc (cursor.com/docs/hooks accessed 2026-07-10) documents a
 * per-script `loop_limit` field (default 5) on the `stop`/`subagentStop` events
 * that bounds hook-forced continuations — a coarse spawn-count backstop, NOT a
 * counter-aware gate that reads `.review-loop.json`. Accurate posture: no
 * counter-aware runtime gate; a coarse `subagentStop` `loop_limit` backstop
 * exists. Cursor still ships the `.mdc` advisory rule, not a counter-aware
 * `hooks.json` gate. The canonical `hooks/hatch3r-review-loop-cap.md` Event
 * Mapping records the same re-grade.
 */
interface CursorHookMapping {
  /** Cursor lifecycle event name. */
  event: string;
  /** Optional shell-command matcher (Cursor narrows `beforeShellExecution` by command text). */
  matcher?: string;
}
const CURSOR_HOOK_EVENT_MAP: Partial<Record<HookEvent, CursorHookMapping>> = {
  "pre-commit": { event: "beforeShellExecution", matcher: "git commit" },
  "pre-push": { event: "beforeShellExecution", matcher: "git push" },
  "file-save": { event: "afterFileEdit" },
  "session-start": { event: "sessionStart" },
};

/**
 * Build a single `.cursor/hooks.json` entry for a canonical hook.
 *
 * Cursor hook entries are `{type: "command", command, matcher?}`. Because
 * Cursor runs the command rather than spawning an agent, the command is a
 * `printf` that surfaces the hatch3r activation directive to the agent
 * transcript (the paired `.mdc` rule carries the binding spawn protocol).
 * Exit 0 with no JSON keeps Cursor's default permission flow (`allow`),
 * so the notification never blocks the user's action. The directive text
 * is single-quoted and the agent id interpolated through `toPrefixedId`,
 * which restricts output to the `hatch3r-[a-z0-9-]` namespace, so no shell
 * metacharacters can reach the command string.
 */
function buildCursorHookEntry(
  hook: HookDefinition,
  mapping: CursorHookMapping,
): Record<string, unknown> {
  const directive = `hatch3r hook ${hook.id}: spawn the ${hook.agent} agent (see .cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc)`;
  const entry: Record<string, unknown> = {
    type: "command",
    command: `printf '%s\\n' '${directive}'`,
  };
  if (mapping.matcher) entry.matcher = mapping.matcher;
  return entry;
}

/**
 * D9-SA9.2-01 (Cycle 12, D9, P3/P6): shared body for the two project-global
 * Cursor hook guards below (`mcp-guard.mjs`, `workdir-guard.mjs`). Defines the
 * stdin-payload read plus `allow()` (exit 0 / no decision — Cursor's
 * default-allow) and `deny(userMessage, agentMessage?)` (writes the Cursor deny
 * response `{permission:"deny", …}` to stdout and exits 0; Cursor signals the
 * decision via stdout JSON, not the exit code — cursor.com/docs/agent/hooks
 * accessed 2026-07-10). A malformed payload falls through to `allow()` so a
 * parser bug here cannot brick the host session. Each guard prepends its own
 * `import` line (this prelude assumes `readFileSync`, `dirname`, `join`,
 * `fileURLToPath` are already imported), so the emitted scripts carry no unused
 * imports.
 */
const CURSOR_GUARD_PRELUDE = `const __dirname = dirname(fileURLToPath(import.meta.url));

function allow() {
  // Cursor's default is allow; exit 0 with no stdout emits no decision.
  process.exit(0);
}

function deny(userMessage, agentMessage) {
  const out = { permission: "deny", user_message: userMessage };
  if (agentMessage) out.agent_message = agentMessage;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

let payload = {};
try {
  const raw = readFileSync(0, "utf-8");
  if (raw) payload = JSON.parse(raw);
} catch {
  // Unreadable / malformed payload — fail open so a parser bug cannot brick
  // the host session.
  allow();
}`;

/**
 * D9-SA9.2-01 (Cycle 12, D9, P3/P6): `.cursor/hooks/mcp-guard.mjs` body — a
 * project-global `beforeMCPExecution` allowlist that needs no agent identity.
 * It hard-denies an MCP tool call whose server identity — the payload's `url`
 * (remote servers, matched exactly) or `command` (stdio servers, matched on the
 * whitespace-normalized full command line) — is absent from the resolved
 * `.cursor/mcp.json` set (project root + `~/.cursor/mcp.json` global), upgrading
 * the mcp category from soft (agent-must-refuse) to a hard gate. It fails OPEN
 * (allows) whenever it cannot build a definitive allowlist (no readable
 * manifest) or cannot identify the server, so a legitimately configured server
 * is never denied.
 */
function buildCursorMcpAllowlistGuardScript(): string {
  return `#!/usr/bin/env node
// hatch3r — Cursor beforeMCPExecution allowlist guard (D9-SA9.2-01, D9 P3/P6).
//
// Regenerated by \`npx hatch3r sync\`. Do not edit by hand.
//
// Hard-denies an MCP tool call whose server identity — payload \`url\` (remote,
// matched exactly) or \`command\` (stdio, matched on the whitespace-normalized
// full command line) — is absent from the resolved \`.cursor/mcp.json\` set
// (project + \`~/.cursor/mcp.json\` global), upgrading the mcp category from soft
// (agent-must-refuse) to a hard allowlist. Fails OPEN when no manifest is
// readable or the server cannot be identified, so a configured server is never
// blocked. Contract: cursor.com/docs/agent/hooks + cursor.com/docs/hooks,
// accessed 2026-07-10 (beforeMCPExecution -> {tool_name, tool_input, url|command};
// deny = {permission:"deny"} on stdout).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

${CURSOR_GUARD_PRELUDE}

function normalize(value) {
  return String(value).replace(/\\s+/g, " ").trim();
}

const manifests = [
  join(__dirname, "..", "mcp.json"),
  join(homedir(), ".cursor", "mcp.json"),
];
const allowed = new Set();
let manifestSeen = false;
for (const file of manifests) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    continue;
  }
  const servers = doc && doc.mcpServers;
  if (!servers || typeof servers !== "object") continue;
  manifestSeen = true;
  for (const srv of Object.values(servers)) {
    if (!srv || typeof srv !== "object") continue;
    if (typeof srv.url === "string" && srv.url) allowed.add(normalize(srv.url));
    if (typeof srv.command === "string" && srv.command) {
      const args = Array.isArray(srv.args) ? srv.args : [];
      allowed.add(normalize([srv.command, ...args].join(" ")));
    }
  }
}

// No manifest to enforce against — cannot build an allowlist, so allow.
if (!manifestSeen) allow();

const identity =
  typeof payload.url === "string" && payload.url
    ? normalize(payload.url)
    : typeof payload.command === "string" && payload.command
      ? normalize(payload.command)
      : "";

// Server not identifiable from the payload — do not false-deny.
if (!identity) allow();
if (allowed.has(identity)) allow();

process.stderr.write(
  JSON.stringify({
    hook: "hatch3r-cursor-mcp-guard",
    reasonCode: "MCP_SERVER_NOT_IN_MANIFEST",
    server: identity,
    tool: typeof payload.tool_name === "string" ? payload.tool_name : "",
    timestamp: new Date().toISOString(),
  }) + "\\n",
);
deny(
  \`hatch3r ASI02 MCP guard: server "\${identity}" is not in the resolved .cursor/mcp.json set; deny-by-default. Add it to your MCP config and re-run \\\`npx hatch3r sync\\\`, or remove this guard from .cursor/hooks.json.\`,
  \`Blocked: MCP server "\${identity}" is not configured in this project's .cursor/mcp.json.\`,
);
`;
}

/**
 * D9-SA9.2-01 (Cycle 12, D9, P3/P6): `.cursor/hooks/workdir-guard.mjs` body — a
 * project-global working-directory boundary wired to `beforeReadFile` and
 * `beforeShellExecution`. It denies a read (`file_path`) or a shell execution
 * (`cwd`) whose real path (symlinks resolved) escapes the project root,
 * blunting the working-dir/symlink-escape class (DuneSlide) for users on
 * Cursor <3.0. The project root derives from the script's own location
 * (`.cursor/hooks/` -> root two levels up), so no config is required. It fails
 * OPEN on any ambiguity (no path field, unresolvable path, undetectable root)
 * so a legitimate in-project operation is never blocked.
 */
function buildCursorWorkingDirGuardScript(): string {
  return `#!/usr/bin/env node
// hatch3r — Cursor working-directory guard (D9-SA9.2-01, D9 P3/P6).
//
// Regenerated by \`npx hatch3r sync\`. Do not edit by hand.
//
// Wired to beforeReadFile + beforeShellExecution. Denies a read (\`file_path\`)
// or shell execution (\`cwd\`) whose real path (symlinks resolved) escapes the
// project root, blunting the working-dir/symlink-escape class (DuneSlide) for
// users on Cursor <3.0. Project root derives from this script's own location
// (.cursor/hooks/ -> root two levels up), so no config is required. Fails OPEN
// on any ambiguity (no path field, unresolvable path, undetectable root) so an
// in-project operation is never blocked. Contract: cursor.com/docs/agent/hooks
// + cursor.com/docs/hooks, accessed 2026-07-10 (beforeReadFile -> {file_path};
// beforeShellExecution -> {command, cwd}; deny = {permission:"deny"} on stdout).
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

${CURSOR_GUARD_PRELUDE}

// Project root = two levels up from .cursor/hooks/, symlinks resolved so the
// boundary comparison is realpath-consistent.
let projectRoot;
try {
  projectRoot = realpathSync(join(__dirname, "..", ".."));
} catch {
  allow();
}

// beforeReadFile carries file_path; beforeShellExecution carries cwd.
const target =
  typeof payload.file_path === "string" && payload.file_path
    ? payload.file_path
    : typeof payload.cwd === "string" && payload.cwd
      ? payload.cwd
      : "";

// No path to check (e.g. a shell command with no cwd field) — allow.
if (!target) allow();

let resolved;
try {
  resolved = realpathSync(target);
} catch {
  // Path does not resolve (nonexistent target) — nothing to escape into; allow.
  allow();
}

const withinRoot =
  resolved === projectRoot || resolved.startsWith(projectRoot + sep);
if (withinRoot) allow();

process.stderr.write(
  JSON.stringify({
    hook: "hatch3r-cursor-workdir-guard",
    reasonCode: "PATH_ESCAPES_PROJECT_ROOT",
    target,
    resolved,
    projectRoot,
    timestamp: new Date().toISOString(),
  }) + "\\n",
);
deny(
  \`hatch3r working-directory guard: "\${target}" resolves to "\${resolved}", outside the project root "\${projectRoot}"; deny-by-default. Operate within the project, or remove this guard from .cursor/hooks.json.\`,
);
`;
}

function cursorRuleFrontmatter(rule: CanonicalFile, scopeOverride?: string): string {
  const scope = scopeOverride ?? rule.scope;
  const lines: string[] = [`description: ${rule.description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else {
    // X4/CD4 (D6-1/D9-1/D11-1 — GLOBS DROP): resolve the real glob set via
    // the shared helper. For `scope: conditional` rules the patterns live in
    // the canonical `globs:` field; the previous `scope.split(",")` derived
    // globs from `scope` alone and emitted `globs: ["conditional"]`, which
    // never matched any file so the rule never auto-attached. An empty set
    // (unconditional rule, `scope` absent, or `scope: agent-requested`) falls
    // back to `alwaysApply: false`. For `agent-requested` this IS the intended
    // Cursor "Apply Intelligently" shape — `description:` present + no `globs:`
    // + `alwaysApply: false` — where the agent pulls the rule in by description
    // (cursor.com/docs/context/rules, accessed 2026-06-09; D5-28).
    const globs = resolveRuleGlobs(rule, { scope: scopeOverride });
    if (globs.length > 0) {
      // D9-13 (Cycle 11 Wave 3, D9, P3): emit `globs:` as an unquoted
      // comma-separated string, NOT a YAML/JSON array. cursor.com/docs/context/rules
      // (accessed 2026-06-06) documents `globs` only as a comma-separated string
      // (e.g. `docs/**/*.md, docs/**/*.mdx`); the bracketed-array form is
      // undocumented and Cursor staff have not confirmed it auto-attaches
      // (forum.cursor.com/t/correct-way-to-specify-rules-globs/71752, Colin reply,
      // accessed 2026-06-06), so the prior array emission risked the rule silently
      // never attaching. The join uses NO space after the comma: the same forum
      // thread (KyleM reply) reports a space after the comma silently breaks glob
      // matching, so `a,b` attaches but `a, b` does not.
      lines.push(`globs: ${globs.join(",")}`);
    } else {
      lines.push("alwaysApply: false");
    }
  }
  return `---\n${lines.join("\n")}\n---`;
}

function mdcOutput(path: string, frontmatter: string, body: string, sourceFiles?: string[]): AdapterOutput {
  return output(path, `${frontmatter}\n\n${wrapManagedFor(path, body)}`, body, sourceFiles);
}

/**
 * release/2.6.0 — managed-block wrap for the raw `.mjs` hook-guard emissions
 * (`subagent-guard.mjs`, `mcp-guard.mjs`, `workdir-guard.mjs`), mirroring the
 * claude adapter's `.claude/hooks/pretooluse-allowlist.mjs` fix. The pre-2.6.0
 * emissions were raw (no markers, no managedContent), so safeWrite's unmanaged
 * write path skipped each existing guard on EVERY `hatch3r sync` with a
 * "managed block markers (HATCH3R:BEGIN/END) missing" warning — the basenames
 * carry no `hatch3r-` prefix, so `isManagedFileName` treated them as user
 * content. Wrapping the script body in the JS `//` marker variant
 * (getMarkersForPath: `.mjs` → `// HATCH3R:BEGIN/END`) routes the guards
 * through the managed-merge path instead: idempotent second sync, no warning,
 * and user bytes outside the markers survive updates. The shebang stays ABOVE
 * the block at byte 0 — JS hashbang grammar permits `#!` only at position 0,
 * so wrapping it inside the block would be a SyntaxError on every hook
 * invocation (a script without a shebang wraps from byte 0). Pre-2.6.0
 * marker-less guards heal via safeWrite's legacy-adoption branch
 * (`isLegacyGeneratedNoMarkerFile` — every guard opens with the
 * `#!/usr/bin/env node` + `// hatch3r — ` header its signature matches), which
 * replaces — never prepend-splices — recognized hatch3r-generated scripts,
 * because splicing a second copy above the old one would duplicate the ESM
 * `import` bindings and hard-break the hook.
 */
function managedGuardScriptOutput(path: string, script: string): AdapterOutput {
  const shebangEnd = script.startsWith("#!") ? script.indexOf("\n") + 1 : 0;
  const body = script.slice(shebangEnd);
  return output(path, `${script.slice(0, shebangEnd)}${wrapManagedFor(path, body)}`, body);
}

/**
 * D12-1 (Cycle 11 Wave 2, D12, P2): single-canonical-source attribution for a
 * per-file Cursor output (one rule `.mdc`, one agent `.md`). Returns
 * `[file.sourcePath]` so the output self-attributes to its one canonical input
 * instead of inheriting the adapter-wide read set in `BaseAdapter.generate`;
 * `undefined` for a synthesised fixture whose `sourcePath` is empty (falls back
 * to the broad set rather than a `[""]` row).
 */
function cursorSingleSource(file: CanonicalFile): string[] | undefined {
  return file.sourcePath ? [file.sourcePath] : undefined;
}

export class CursorAdapter extends BaseAdapter {
  readonly name = "cursor";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    if (ctx.features.rules) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field. Direct `readCanonicalFiles` calls bypass the
      // provenance tracker introduced by C8-D12-M3.
      const rules = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules", ctx.userRepoRoot);
      // Wave B3: precedence-ordered emission + NN- numeric filename prefix.
      // NN derives from precedenceRank(rule.precedence): critical=10, high=30,
      // normal=50, low=70. The prefix makes load order visible in the filesystem
      // so tools that enumerate .cursor/rules/ alphabetically apply higher-
      // precedence rules first.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        // C9-H20 (D8-H8.3.1): cooperative abort between per-rule .mdc
        // emissions so pipeline timeouts cancel without waiting for the
        // remaining rules' customisation step to finish.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens so
        // canonical content carries `${HATCH3R:LINTER}` etc. and adapter
        // output carries the resolved value.
        const substituted = this.substituteDetectedRepoTokens(rawContent, ctx);
        // F14.3-H2 (D14, P3): prepend the per-tier maturity header so the
        // declared tier travels with each rule body (was byte-identical
        // across tiers before). D1-17 (D1, P1): also prepend the resolved
        // confidence-floor marker so the configured agent-assertiveness floor
        // reaches the generated artifact (was a write-only config key).
        // 2.8.0: communication-style marker (always; absence → "plain") +
        // default-effort marker (only when the field is persisted — absent =
        // auto-tier = no line, keeping pre-2.8 no-field output byte-identical).
        const headerLines = [
          cursorMaturityHeader(ctx),
          cursorConfidenceFloorHeader(ctx),
          cursorCommunicationStyleHeader(ctx),
          cursorDefaultEffortHeader(ctx),
        ].filter((line) => line.length > 0);
        const content = `${headerLines.join("\n")}\n\n${substituted}`;
        const desc = overrides.description ?? rule.description;
        const ruleWithDesc = { ...rule, description: desc };
        const nn = precedenceRank(rule.precedence) / 10;
        const baseName = `${nn}-${toPrefixedId(rule.id)}.mdc`;
        results.push(mdcOutput(`.cursor/rules/${baseName}`, cursorRuleFrontmatter(ruleWithDesc, overrides.scope), content, cursorSingleSource(rule)));
      }
    }

    if (ctx.features.agents) {
      const agents = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "agents", ctx.userRepoRoot);
      // release/2.7.0: class-word emission posture. `"native"` (default when
      // absent) pins the advanced/frontier classes to concrete ids at
      // emission time; `"conservative"` restores the pre-2.7.0 advisory/omit
      // posture. Pins in `models.tiers` are honored identically under both.
      const agentModelPins = ctx.manifest.cursor?.agentModelPins ?? "native";
      for (const agent of agents) {
        // C9-H20 (D8-H8.3.1): cooperative abort between agent files.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47: substitute detected toolchain tokens in agent body.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const prefixedId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        // release/2.7.0 effort axis: EXPLICIT per-agent effort only
        // (customize > frontmatter — the same override plumbing
        // resolveAgentModel applies above). The class-default fallback
        // (defaultEffortForClass) composes below, and only when the emitted
        // model came from a class mapping — hatch3r cannot assume effort
        // semantics for a user-set concrete model.
        const explicitEffort = resolveAgentEffort(agent.id, agent, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        // Model classes (release/2.7.0, 4-class ladder): Cursor's native
        // frontmatter vocabulary is `fast`, `inherit`, or a concrete model id,
        // optionally with per-model bracket options — the documented example
        // is `claude-opus-4-8[effort=high]` (cursor.com/docs/subagents.md,
        // accessed 2026-07-14). Class words map per class instead of shipping
        // verbatim (a verbatim class word is a dead field Cursor cannot
        // resolve). Under the default `cursor.agentModelPins: "native"`:
        //   - `models.tiers.<class>` pin set -> the operator owns the string:
        //     emit it verbatim after alias expansion, NEVER append or modify
        //     bracket options (an operator who wants brackets pins the
        //     bracketed form — a bracketed string is not a MODEL_ALIASES key,
        //     so alias expansion passes it through untouched). A pin of
        //     `inherit` omits the field and prepends one advisory body line
        //     naming the class, so the authored class intent stays visible
        //     (Silent Failure Contract, CONSTITUTION §2 P5).
        //   - economy -> `model: fast` (CURSOR_TIER_MODEL_MAP), never
        //     bracketed: the docs show bracket options on concrete model ids
        //     only, and a keyword+bracket combination is undocumented.
        //   - standard -> OMIT the field (inherit-by-omission).
        //   - advanced/frontier -> pin a concrete id via alias expansion
        //     (`opus`/`fable`; cursor.com/docs/models lists Claude Fable 5,
        //     accessed 2026-07-14), appending `[effort=high]` iff the
        //     resolved effort (explicit per-agent effort, else
        //     defaultEffortForClass) ranks >= xhigh. Clamp (R2): `high` is
        //     the only bracket effort value cursor.com/docs/subagents.md
        //     documents, so xhigh/max write that documented ceiling; a
        //     plain-`high` resolution gets NO bracket — `high` is the
        //     near-default for these pins, and bracketing it would erase the
        //     >=xhigh distinction the bracket encodes.
        // `agentModelPins: "conservative"` restores the pre-2.7.0 posture:
        // economy -> `fast`, standard -> omit, advanced/frontier -> no native
        // field + one advisory body line naming the class and the Cursor
        // picker. Non-class values (concrete ids, `inherit`, a
        // user-configured `fast`) emit verbatim as before.
        let modelBodyNote = "";
        const modelClass = model ? normalizeModelClass(model) : null;
        if (modelClass) {
          // The pin is alias-expanded (a pinned `fable` emits as
          // `claude-fable-5`) — the same expansion every resolveAgentModel
          // result already received before reaching this loop.
          const tierPinRaw = resolveTierModel(modelClass, ctx.manifest);
          const tierPin = tierPinRaw === undefined ? undefined : resolveModelAlias(tierPinRaw);
          if (tierPin !== undefined) {
            if (tierPin === "inherit") {
              modelBodyNote =
                `Model class: ${modelClass} — \`models.tiers.${modelClass}\` is pinned to \`inherit\`, ` +
                `so no native model field is emitted and this agent inherits the conversation model.`;
            } else {
              lines.push(`model: ${tierPin}`);
            }
          } else if (modelClass === CLASS_LOW) {
            // economy: Cursor's native cost keyword — identical under both
            // emission postures, never bracketed (see contract above).
            lines.push(`model: ${CURSOR_TIER_MODEL_MAP[CLASS_LOW]}`);
          } else if (modelClass === CLASS_HIGH || modelClass === CLASS_TOP) {
            if (agentModelPins === "conservative") {
              modelBodyNote =
                `Model class: ${modelClass} — agentModelPins is "conservative", so no native model ` +
                `pin is emitted; select a ${modelClass}-class model for this agent in the Cursor model picker.`;
            } else {
              const pinAlias = modelClass === CLASS_TOP ? "fable" : "opus";
              const resolvedEffort = explicitEffort ?? defaultEffortForClass(modelClass, ctx.manifest);
              const effortLevel = resolvedEffort === undefined ? null : normalizeEffortLevel(resolvedEffort);
              const bracket =
                effortLevel !== null && EFFORT_RANK[effortLevel] >= EFFORT_RANK.xhigh
                  ? "[effort=high]"
                  : "";
              lines.push(`model: ${resolveModelAlias(pinAlias)}${bracket}`);
            }
          }
          // standard (CLASS_MID), both postures: no model line — the agent
          // inherits by omission.
        } else if (model) {
          lines.push(`model: ${model}`);
        }
        // C7.5-W2B2-H41/H45 (D15, P6): Cursor subagent frontmatter has
        // no tool allowlist — the closest native primitive is
        // `readonly: true`, which blocks file edits and state-changing
        // shell commands. Emit readonly whenever the AGENT_TOOL_POLICIES
        // entry lacks both `write` and `execute`, or whenever the
        // canonical agent already declared itself readonly. Policy
        // takes precedence: once a policy forbids write+execute,
        // readonly is emitted regardless of the canonical flag so the
        // monotonic-privilege invariant cannot be widened by omission.
        const policyReadonly = toCursorReadonlyFrontmatter(prefixedId);
        const effectiveReadonly = policyReadonly ?? agent.readonly ?? false;
        if (effectiveReadonly) lines.push("readonly: true");
        if (agent.background) lines.push("is_background: true");
        const fm = `---\n${lines.join("\n")}\n---`;
        const agentBody = modelBodyNote ? `${modelBodyNote}\n\n${content}` : content;
        results.push(mdcOutput(`.cursor/agents/${prefixedId}.md`, fm, agentBody, cursorSingleSource(agent)));
      }
    }

    results.push(
      ...await this.processSkillsWithFmCliFiltered(ctx, (id) => `.cursor/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsWithFm(ctx, (id) => `.cursor/commands/${toPrefixedId(id)}.md`),
    );

    // Companion/reference content (see `BaseAdapter.processCompanionSubdir`
    // for the rationale). Mirror the canonical subtree under per-adapter
    // native paths so canonical references like `agents/shared/quality-charter.md`
    // resolve in the user repo after the 1.9.0 bundled-content migration.
    // Gating mirrors the primary feature; `checks/` is referenced by both
    // agents (reviewer) and commands (benchmark).
    // Slash-picker fix (release/2.6.0): the three `commands/*` companion rows
    // opt into the byte-0 frontmatter stub (`emitFmStub`) — they land under
    // `.cursor/commands/`, whose command picker reads `description:` at byte 0.
    // `agents/*` rows stay raw (`.cursor/agents/**` is parsed as subagent
    // definitions — a stub would register reference files as agents); `checks/`
    // has no picker surface and stays raw.
    const companionMappings: Array<
      [CompanionSubdir, boolean, (f: string) => string, { emitFmStub?: boolean }?]
    > = [
      ["agents/modes", ctx.features.agents, (f) => `.cursor/agents/modes/${f}`],
      ["agents/shared", ctx.features.agents, (f) => `.cursor/agents/shared/${f}`],
      ["commands/board", ctx.features.commands, (f) => `.cursor/commands/board/${f}`, { emitFmStub: true }],
      ["commands/rework", ctx.features.commands, (f) => `.cursor/commands/rework/${f}`, { emitFmStub: true }],
      // D2-SA2.1-01 (Cycle 12): the orchestration-frame companion referenced by
      // every emitted orchestrator command; ship it under the native command
      // companion path so those references resolve on the user's disk.
      ["commands/shared", ctx.features.commands, (f) => `.cursor/commands/shared/${f}`, { emitFmStub: true }],
      ["checks", ctx.features.agents || ctx.features.commands, (f) => `.cursor/checks/${f}`],
    ];
    for (const [subdir, enabled, pathFn, subdirOpts] of companionMappings) {
      if (!enabled) continue;
      results.push(...await this.processCompanionSubdir(ctx, subdir, pathFn, subdirOpts));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp) {
      // D11-C-1 (Cycle 10, Pillar P6): Cursor's MCP runtime supports only
      // `${env:NAME}`, `${userHome}`, `${workspaceFolder}` interpolation
      // (cursor.com/docs/context/mcp accessed 2026-05-27). Shell-style
      // `$VAR` is treated as a literal string by Cursor, so emitting it
      // breaks every secret-bearing MCP server (github, brave-search,
      // sentry, postgres, linear, azure-devops, gitlab). The canonical
      // MCP fixture already uses `${env:VAR}` form, so "passthrough"
      // keeps it byte-identical to Cursor's required syntax.
      //
      // D2-13 (Cycle 11 Wave 3, D2, P6): strip every `_`-prefixed framework
      // marker per entry before emission. `readFilteredMcp` removes only
      // `_disabled`/`_description`, so without this the endpoint-pin opt-out
      // (`_pinned_sha256`/`_trust_bypass`) and `_timeout` leaked verbatim into
      // the committed `.cursor/mcp.json` (claude.ts already destructures them
      // out — this closes the adapter inconsistency at the shared helper).
      const cleaned: Record<string, Record<string, unknown>> = {};
      for (const [name, entry] of Object.entries(mcp)) {
        cleaned[name] = stripPrivateMcpFields(entry);
      }
      const transformed = transformEnvVarSyntax(cleaned, "passthrough") as Record<string, Record<string, unknown>>;
      // D15-27 (Cycle 11 Wave 3, D15, P3/P6, SA15.5-F6): no top-level
      // `protocolVersion` here. The MCP forward-pin is Claude-only by SCHEMA
      // CONSTRAINT, not omission — Cursor's `.cursor/mcp.json` top level is
      // `mcpServers` only (cursor.com/docs/mcp, accessed 2026-06-09), so a
      // sibling `protocolVersion` would be an unknown key. The shared rationale
      // and the Claude-side emission contrast live at
      // `MCP_DEFAULT_PROTOCOL_VERSION` in mcp-utils.ts.
      results.push(output(".cursor/mcp.json", JSON.stringify({ mcpServers: transformed }, null, 2)));
    }

    // D9-H-4 (D9, P3): Cursor 1.7+ exposes a native hook surface at
    // `.cursor/hooks.json` (version 1, camelCase lifecycle events,
    // `{permission: allow|deny|ask}` outputs — cursor.com/docs/agent/hooks
    // accessed 2026-06-06). Cursor hooks run a shell `command` and read a
    // permission decision; they do NOT spawn agents, and hatch3r hooks
    // carry an `agent:` to activate rather than a script. So we emit BOTH:
    //   1. `.cursor/hooks.json` — wires each mappable canonical event
    //      (pre-commit/pre-push/file-save/session-start) into Cursor's
    //      lifecycle via a `command` that prints the activation directive.
    //   2. `.cursor/rules/hook-*.mdc` — the instructional rule that carries
    //      the actual agent-spawn protocol (also the only surface for the
    //      canonical hook events with no Cursor lifecycle equivalent:
    //      post-merge, ci-failure, review-loop-cap — each ships as the advisory
    //      `.mdc` only; worktree-create/-remove are reserved HookEvent values
    //      with no canonical hook file — D11-SA11.4-03).
    const hookResults = await this.readHooks(ctx);
    const hooksJsonEvents: Record<string, Array<Record<string, unknown>>> = {};
    for (const hook of hookResults) {
      const globs = hook.condition?.globs || [];
      // D9-13 (Cycle 11 Wave 3, D9, P3): same Cursor `globs:` contract as
      // `cursorRuleFrontmatter` above — unquoted comma-separated string with NO
      // space after the comma (cursor.com/docs/context/rules accessed 2026-06-06;
      // the bracketed-array form is undocumented and the comma-space form silently
      // fails to auto-attach), so the hook→rule shim attaches on the scoped files.
      const globLine =
        globs.length > 0
          ? `globs: ${globs.join(",")}`
          : "alwaysApply: false";
      const fm = `---\ndescription: "Hook: ${hook.description}"\n${globLine}\n---`;
      const body = `# Hook: ${hook.id}\n\n**Event:** ${hook.event}\n**Agent:** ${hook.agent}\n\n${hook.description}\n\nHATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.cursor/agents/${toPrefixedId(hook.agent)}.md\`.`;
      results.push(mdcOutput(`.cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc`, fm, body));

      const mapping = CURSOR_HOOK_EVENT_MAP[hook.event as HookEvent];
      if (mapping) {
        const entry = buildCursorHookEntry(hook, mapping);
        (hooksJsonEvents[mapping.event] ??= []).push(entry);
      }
    }
    // D9-4 (Cycle 11 D9, P6): the `.cursor/hooks.json` write is deferred to
    // after the ASI02 `subagentStart` guard entry is injected below, so the
    // hard runtime block always ships alongside any lifecycle-event wiring.

    // D9-4 (Cycle 11 D9, P6/P3): emit the per-adapter MCP / tool gating
    // artifacts. Cursor's `preToolUse` hook payload (cursor.com/docs/agent/hooks
    // accessed 2026-06-06) carries `tool_name`/`tool_input`/`tool_use_id`/
    // `cwd`/`model`/`agent_message` but NO agent-identity field, so a
    // per-tool-CATEGORY deny cannot bind to the active hatch3r agent there —
    // category granularity stays rule-delegated (alwaysApply rule +
    // machine-readable `agents-policy.json`) and the `readonly: true`
    // frontmatter primitive (emitted by `toCursorReadonlyFrontmatter` for
    // agents whose policy lacks both `write` and `execute`) is the hard
    // write/execute guard.
    //
    // The agent-IDENTITY gate that `preToolUse` cannot serve is bound at the
    // `subagentStart` event, which DOES expose `subagent_type` + `subagent_id`
    // and returns `{permission: "deny"}` to block a subagent at spawn. That
    // closes the prior gap (a Cursor over-privileged agent had no hard runtime
    // block at parity with the Claude PreToolUse deny gate): the
    // `.cursor/hooks/subagent-guard.mjs` script (built below, mirrors
    // `buildClaudePreToolUseHookScript`) reads `agents-policy.json` and denies
    // any `hatch3r-*` subagent with no policy row (NO_POLICY), the Cursor
    // analog of the Claude NO_POLICY deny. It is wired into the `subagentStart`
    // event of `.cursor/hooks.json` below.
    const allowlistFm = `---\ndescription: Per-agent tool allowlist (ASI02). Enforced by the Cursor agent runtime — out-of-policy tool calls must be refused.\nalwaysApply: true\n---`;
    results.push(mdcOutput(
      ".cursor/rules/hatch3r-tool-allowlist.mdc",
      allowlistFm,
      buildCursorAllowlistRule(),
    ));
    results.push(output(
      ".cursor/agents-policy.json",
      buildAgentToolPoliciesJson(),
    ));

    // D9-4 (Cycle 11 D9, P6): emit the `subagentStart` deny hook — the hard
    // runtime ASI02 block for Cursor, at parity with the Claude PreToolUse
    // NO_POLICY deny. The script lives under `.cursor/hooks/` and resolves the
    // sibling policy doc at `../agents-policy.json`; it is wired into the
    // `subagentStart` event with `failClosed: true` so a crash/timeout blocks
    // the spawn rather than failing open (cursor.com/docs/agent/hooks accessed
    // 2026-06-06). Emitted regardless of `features.rules` — the guard is a
    // trust artifact, identical posture to the allowlist rule above.
    results.push(managedGuardScriptOutput(
      ".cursor/hooks/subagent-guard.mjs",
      buildCursorSubagentGuardHookScript(),
    ));
    (hooksJsonEvents.subagentStart ??= []).push({
      type: "command",
      command: "node ./.cursor/hooks/subagent-guard.mjs",
      failClosed: true,
    });

    // D9-SA9.2-01 (Cycle 12, D9, P3/P6): two additive project-global hook
    // guards that need no agent-identity field, closing the capability gap
    // where Cursor documents `beforeMCPExecution` + `beforeReadFile` events the
    // adapter left unwired (cursor.com/docs/agent/hooks + cursor.com/docs/hooks,
    // accessed 2026-07-10). Both fail OPEN on any ambiguity so a guard cannot
    // brick a legitimate operation, and both use `failClosed: false` so a script
    // crash/timeout on these high-frequency events cannot block every
    // read/shell/MCP call; a CONFIRMED violation is a hard `{permission:"deny"}`.
    //   (1) beforeMCPExecution -> mcp-guard.mjs: hard-deny an MCP call whose
    //       server is absent from the resolved `.cursor/mcp.json` set, upgrading
    //       the mcp category from soft (agent-must-refuse) to a hard allowlist.
    //   (2) beforeReadFile + beforeShellExecution -> workdir-guard.mjs: deny a
    //       read/exec whose path realpath-resolves outside the project root,
    //       blunting the working-dir/symlink-escape class for Cursor <3.0.
    // The workdir guard is APPENDED to beforeShellExecution after any mapped
    // lifecycle entries, so the D9-14 `[0]`-index lifecycle assertions hold.
    results.push(managedGuardScriptOutput(
      ".cursor/hooks/mcp-guard.mjs",
      buildCursorMcpAllowlistGuardScript(),
    ));
    (hooksJsonEvents.beforeMCPExecution ??= []).push({
      type: "command",
      command: "node ./.cursor/hooks/mcp-guard.mjs",
      failClosed: false,
    });
    results.push(managedGuardScriptOutput(
      ".cursor/hooks/workdir-guard.mjs",
      buildCursorWorkingDirGuardScript(),
    ));
    (hooksJsonEvents.beforeReadFile ??= []).push({
      type: "command",
      command: "node ./.cursor/hooks/workdir-guard.mjs",
      failClosed: false,
    });
    (hooksJsonEvents.beforeShellExecution ??= []).push({
      type: "command",
      command: "node ./.cursor/hooks/workdir-guard.mjs",
      failClosed: false,
    });

    const hooksJson = { version: 1, hooks: hooksJsonEvents };
    results.push(output(".cursor/hooks.json", JSON.stringify(hooksJson, null, 2) + "\n"));

    const bridgeFm = `---
description: Bridge to canonical agent instructions and mandatory orchestration directives
alwaysApply: true
---`;
    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const bridgeBody = `# Hatch3r Bridge

This project uses hatch3r for agentic coding setup.
Canonical agent orchestration is inlined in this rule (\`.cursor/rules/hatch3r-bridge.mdc\`); per-artifact content lives in \`.cursor/rules/\`, \`.cursor/agents/\`, \`.cursor/skills/\`, and \`.cursor/commands/\`.

${bridgeOrchestration}

## Cursor Subagent Configuration (v2.5+)

Cursor runs many subagents in parallel (across git worktrees, cloud, and remote environments — Cursor 3.0), with no fixed cap. Custom subagents in \`.cursor/agents/\` support these frontmatter fields:
- \`model\`: \`fast\`, \`inherit\`, or a specific model ID, optionally with per-model bracket options, e.g. \`claude-opus-4-8[effort=high]\` (cursor.com/docs/subagents.md, accessed 2026-07-14)
- \`readonly\`: \`true\` to restrict write permissions (verification/audit agents)
- \`is_background\`: \`true\` to run without blocking the parent agent

When delegating to hatch3r agents, fan out one subagent per independent unit of work — Cursor 3.0 documents no fixed parallelism cap, so match your fan-out to the task's decomposition rather than an arbitrary number.
Background subagents write output to \`~/.cursor/subagents/\` for later inspection.

## Cursor v2.6 Capabilities

Cursor v2.6 added MCP Apps (interactive UIs in agent chats) and Team Marketplaces for plugins.
If this project includes MCP servers that expose UI components, they will render inline as MCP Apps.
Plugin configurations in \`.cursor/mcp.json\` are compatible with Team Marketplace distribution.

## Cursor 3.0 Workflows

Cursor 3.0 (April 2, 2026) added two slash commands that pair with hatch3r's parallel-agent pipeline:
- \`/worktree\` — runs the current task in an isolated git worktree so agent edits cannot collide with your working tree. Use it when delegating to the implementer, fixer, or lint-fixer agents.
- \`/best-of-n\` — runs the same task across multiple models in parallel worktrees and compares outcomes. Pair with the reviewer agent to pick the winner.

## Getting Started with Cursor

New to this project's agent setup? Progress through these stages:

**Start here:** Rules in \`.cursor/rules/\` are loaded automatically. The orchestration bridge above guides your workflow.
**Next:** Use \`/hatch3r-feature\` or \`/hatch3r-bug-fix\` commands in Cursor chat for guided workflows.
**Then:** Delegate to agents in \`.cursor/agents/\` — Cursor runs many subagents in parallel (worktrees, cloud, remote).
**Later:** Customize agent behavior via \`.hatch3r/{type}/{id}.customize.yaml\` without editing managed files.`;
    results.push(mdcOutput(".cursor/rules/hatch3r-bridge.mdc", bridgeFm, bridgeBody));

    if (ctx.manifest.tools.includes("cursor")) {
      // F9.2.8 (Cycle 10 D9, P3): no `mcpServers` key here. MCP server config
      // is emitted to `.cursor/mcp.json` (above); a redundant empty
      // `mcpServers: {}` in environment.json declared the same surface twice
      // and risked drift between the two files.
      const envConfig = {
        instructions: [
          "Read .cursor/rules/hatch3r-bridge.mdc for project agent orchestration; per-artifact rules, agents, skills, and commands live under .cursor/.",
        ],
      };
      results.push(output(".cursor/environment.json", JSON.stringify(envConfig, null, 2) + "\n"));
    }

    return results;
  }
}
