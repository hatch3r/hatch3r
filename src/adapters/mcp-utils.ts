import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanMcpServers } from "../pipeline/mcpDescriptionScan.js";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  _description?: string;
  _disabled?: boolean;
  /** D15 Medium (#15.44): Per-server timeout in milliseconds (default: 30000). */
  _timeout?: number;
  /**
   * C9-M34 (D15 / Pillar P6): SHA-256 hash of the expected remote endpoint
   * artifact (response body, manifest, or TOFU-on-first-contact certificate
   * SPKI hash, depending on operator policy). Required on HTTP transports
   * (`url` is set, `command` is not) unless `_trust_bypass: true` is also
   * set. Format: 64 lowercase hex chars, optionally prefixed with
   * `"sha256:"`. See {@link validateMcpHttpEndpoint}.
   */
  _pinned_sha256?: string;
  /**
   * C9-M34 (D15 / Pillar P6): Explicit operator opt-out from HTTP-endpoint
   * pinning. When set to literal `true`, {@link validateMcpHttpEndpoint}
   * accepts the entry but {@link validateMcpEntry} emits a warning so the
   * bypass is auditable. Use only when pinning is impossible (e.g., a
   * server with rotating content) and the operator accepts the upstream
   * compromise risk.
   */
  _trust_bypass?: boolean;
  /**
   * D11-15 (Cycle 11 Wave 3, D11, P6/SA11.3-F3): documented rationale for a
   * `_trust_bypass: true` opt-out. When present and non-empty, the per-server
   * "pinning bypassed" warning {@link validateMcpEntry} would otherwise emit
   * on every read is SUPPRESSED — the bypass stays auditable via this recorded
   * reason rather than a repeating runtime warning. Bypass without a reason
   * still warns, so the security signal fires only for operator-added unpinned
   * HTTP servers that have not documented why. The bundled `github` server
   * carries `_trust_bypass_reason: "github-first-party"` because its endpoint
   * (`api.githubcopilot.com`) is a rotating GitHub-operated remote with no
   * stable artifact to SHA-256 pin; emitting an un-actionable warning on a
   * framework decision trains operators to ignore MCP security warnings (alarm
   * fatigue). A malformed value (non-string, or empty/whitespace-only string)
   * is itself a misconfiguration and does NOT suppress — see
   * {@link validateMcpEntry}.
   */
  _trust_bypass_reason?: string;
}

/**
 * D2-13 (Cycle 11 Wave 3, D2, P6): strip every `_`-prefixed key from an MCP
 * server entry, returning a shallow copy that carries only public, on-disk-safe
 * fields.
 *
 * The `_` prefix is the framework-internal namespace (`_description`,
 * `_disabled`, `_timeout`, `_pinned_sha256`, `_trust_bypass`). These are
 * hatch3r policy/metadata markers consumed at generation time
 * ({@link validateMcpHttpEndpoint}, the manifest selection gate, the Claude
 * `_timeout`→`timeout` translation) — none of them has a meaning in a committed
 * client config, and `_pinned_sha256`/`_trust_bypass` in particular leak the
 * endpoint-pin opt-out into a file the user commits. Before this helper,
 * `readFilteredMcp` only removed `_disabled`/`_description` by name, so cursor
 * (`.cursor/mcp.json`) shipped the remaining `_`-prefixed keys verbatim while
 * claude destructured them out inline — an adapter inconsistency.
 *
 * Prefix-based (not a hand-maintained omit list) so a future `_`-field added to
 * {@link McpServerEntry} is stripped automatically rather than silently
 * leaking until someone notices. Returns the entry's own public keys only;
 * inherited/prototype keys are not copied (`Object.entries`).
 */
export function stripPrivateMcpFields<T extends Record<string, unknown>>(
  entry: T,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key.startsWith("_")) continue;
    clean[key] = value;
  }
  return clean;
}

/** Default MCP server request timeout in milliseconds. */
export const DEFAULT_MCP_TIMEOUT_MS = 30_000;
/** Maximum allowed MCP timeout in milliseconds (5 minutes). */
export const MAX_MCP_TIMEOUT_MS = 300_000;
/**
 * Smallest per-server `_timeout` Claude Code honors. The Claude Code MCP loader
 * IGNORES a positive `timeout` below 1000ms and falls through to
 * `MCP_TOOL_TIMEOUT` (or its ~28h default when unset); before v2.1.162 such
 * values were floored to 1s instead (code.claude.com/docs/en/mcp, accessed
 * 2026-06-10: "Values below 1000 are ignored and fall through to
 * MCP_TOOL_TIMEOUT").
 *
 * D9-SA9.1-L / D15-SA15.5-F8 (Cycle 11 Wave 4, D9/D15, P3/P6): the bounds check
 * in {@link validateMcpEntry} accepted any `_timeout > 0`, so an operator who
 * set `_timeout: 500` to bound a slow server got NO warning while the platform
 * silently dropped the bound to the ~28h default — a Silent Failure Contract
 * surface (CONSTITUTION §2 P5). The validator now warns on a positive sub-1000ms
 * value so the operator learns the bound was not applied. The check lives in the
 * adapter-agnostic validator rather than only the Claude emission path, so the
 * warning fires for the whole bundled `mcp.json` independent of which adapter is
 * generating.
 */
export const MIN_HONORED_MCP_TIMEOUT_MS = 1_000;

/**
 * Most-recent stable MCP protocol revision emitted into generated client
 * config when the operator does not pin one via
 * `.hatch3r/hatch.json::mcp.protocolVersion`. F17.2.3 (Cycle 10, D17, P3).
 *
 * The 2026-07-28 release candidate (largest revision since launch) removes
 * the `initialize`/`initialized` handshake, drops protocol-level sessions,
 * moves Tasks to an extension, and changes the missing-resource JSON-RPC
 * code from -32002 to the standard -32602; it is tentatively GA in Q3 2026
 * (blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate, accessed
 * 2026-05-27). Until that GA lands, the most-recent *stable* revision is
 * `2025-11-25` (same source, "Most Recent Stable Version").
 *
 * D9-9 (Cycle 11 Wave 3, D9, P3): this string is emitted as an ADVISORY marker,
 * NOT a field the Claude Code MCP loader consumes. The documented `.mcp.json`
 * top-level schema is `mcpServers` only — protocol-version negotiation happens
 * per-server at `initialize` time, and no top-level `protocolVersion` key is
 * listed (code.claude.com/docs/en/mcp, accessed 2026-06-09). So emitting it does
 * not change the client/server handshake; it is a human-/tooling-readable record
 * of the revision the operator targets and the override seam
 * (`.hatch3r/hatch.json::mcp.protocolVersion`) for staging the RC ahead of GA.
 * It is retained rather than dropped because the Claude emission path also does
 * the per-server `_timeout`→`timeout` translation (a documented, loader-consumed
 * field per the same source) and the override seam is the forward-pin staging
 * surface documented in docs/MIGRATION-mcp-2026-07-28.md.
 *
 * D15-27 (Cycle 11 Wave 3, D15, P3/P6, SA15.5-F6): the advisory marker is
 * **Claude-only by schema constraint**, not by omission. Only the Claude Code
 * `.mcp.json` top-level object tolerates an unknown sibling field next to
 * `mcpServers` (claude.ts emits `{ protocolVersion, mcpServers }`). The other two
 * adapters cannot carry it because their top-level schemas are closed to it:
 *   - Cursor `.cursor/mcp.json`: top-level is `mcpServers` only; per-server keys
 *     are `type|command|args|env|url|headers` (+ OAuth), and variable
 *     interpolation resolves only in `command|args|env|url|headers`
 *     (cursor.com/docs/mcp, accessed 2026-06-09). A top-level `protocolVersion`
 *     is an unknown key.
 *   - VS Code `.vscode/mcp.json` (Copilot): top-level fields are exactly
 *     `servers`, `inputs`, `sandbox`
 *     (code.visualstudio.com/docs/agents/reference/mcp-configuration, accessed
 *     2026-06-09). An unknown top-level key is rejected by the schema-aware
 *     tooling the copilot adapter already targets (D9-C-2: mcp-inspector / VS
 *     Code strict mode / awesome-copilot lint).
 * Emitting it on Cursor/Copilot would ship a schema-invalid file, so the
 * cursor.ts / copilot.ts MCP emission sites carry a back-reference to this
 * rationale instead. The protocol version is negotiated per-server at
 * `initialize` time regardless; the top-level advisory marker is a Claude-surface
 * convenience, not a cross-adapter contract and not a loader-consumed field.
 */
export const MCP_DEFAULT_PROTOCOL_VERSION = "2025-11-25";

/**
 * Default maximum recursion depth for {@link transformEnvVarSyntax}.
 *
 * C8-D2-M5 (D2-SA2.4-2, Pillar P6): MCP config JSON in the wild nests at
 * most ~4 levels (root -> mcpServers -> server entry -> env/headers -> values),
 * so 32 leaves ample headroom for legitimate nesting while bounding the stack
 * against adversarial input. This is a defensive upper bound, not a functional
 * limit expected to be reached in normal use.
 */
export const DEFAULT_TRANSFORM_MAX_DEPTH = 32;

/**
 * Transforms `${env:VAR}` references to the native format for a given adapter.
 *
 * The canonical MCP config uses `${env:VAR}` syntax (matching the MCP spec).
 * Different adapters have different native env var reference syntaxes:
 * - "claude": `${VAR}` (Claude Code native)
 * - "process": `process.env.VAR` replaced at generation time (not used yet)
 * - "passthrough": keep `${env:VAR}` as-is (for adapters that support MCP spec natively)
 * - "shell": `$VAR` (for shell-based expansion)
 *
 * For adapters that don't understand `${env:VAR}`, this prevents silent failures
 * by converting to a syntax the adapter can process.
 *
 * C8-D2-M5 (D2-SA2.4-2, Pillar P6): A recursion depth limit (default
 * {@link DEFAULT_TRANSFORM_MAX_DEPTH}) is enforced to defend against adversarial
 * or malformed input (cyclic references, pathologically nested JSON) that would
 * otherwise exhaust the call stack. Legitimate MCP config depth is <=5 levels,
 * so the default has wide headroom and will not trip on real inputs.
 *
 * D2-SA2.1-08 (Cycle 12, D2, Pillar P4) — extensibility seam, recorded not acted
 * on: the env-var format vocabulary (`"claude" | "shell" | "passthrough"`) is
 * declared as a closed inline union in TWO places — this function's `format`
 * parameter and `BaseAdapter.buildStdMcpEntries` (base.ts). Admitting a 4th adapter
 * whose platform needs a novel env syntax would require widening BOTH unions plus
 * this switch. At the committed 3-adapter scope (CONSTITUTION §6 Decision 12) the
 * closed union is the leaner design (P4), so no abstraction is added ahead of need.
 * If a 4th adapter is ever admitted, consolidate the format vocabulary here
 * (alongside this function) so the base layer stops owning adapter-format literals —
 * the translator modules (this file / adapterToolTranslator) already own the other
 * per-platform vocabularies.
 *
 * @throws {RangeError} When the input nesting exceeds `maxDepth`.
 */
export function transformEnvVarSyntax(
  value: unknown,
  format: "claude" | "shell" | "passthrough" = "passthrough",
  maxDepth: number = DEFAULT_TRANSFORM_MAX_DEPTH,
): unknown {
  return transformEnvVarSyntaxInner(value, format, maxDepth, 0);
}

function transformEnvVarSyntaxInner(
  value: unknown,
  format: "claude" | "shell" | "passthrough",
  maxDepth: number,
  depth: number,
): unknown {
  if (depth > maxDepth) {
    throw new RangeError(
      `transformEnvVarSyntax exceeded maximum recursion depth (${maxDepth}). ` +
        `Input is too deeply nested or contains a cyclic structure. ` +
        `This limit defends against adversarial or malformed MCP config input.`,
    );
  }
  if (typeof value === "string") {
    switch (format) {
      // D11-SA11.3-F11.3-8 (Cycle 10, P3): the `[^}]+` capture group spans
      // everything between `env:` and the closing `}`, so a default-form
      // reference like `${env:HOST:-localhost}` round-trips to the valid
      // Claude Code form `${HOST:-localhost}` (Claude Code MCP supports
      // `${VAR:-default}` per code.claude.com/docs/en/mcp, accessed
      // 2026-05-28). This compatibility is INCIDENTAL, not designed — the
      // regex was authored for the no-default form and the default suffix
      // survives only because it lives inside the braces. The round-trip is
      // pinned by an explicit test in
      // `src/__tests__/adapters/mcp-utils.test.ts` so a future regex tweak
      // that narrows the capture group breaks the test rather than silently
      // dropping defaults.
      case "claude":
        return value.replace(/\$\{env:([^}]+)\}/g, "${$1}");
      case "shell":
        return value.replace(/\$\{env:([^}]+)\}/g, "$$$1");
      case "passthrough":
        return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) =>
      transformEnvVarSyntaxInner(v, format, maxDepth, depth + 1),
    );
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = transformEnvVarSyntaxInner(v, format, maxDepth, depth + 1);
    }
    return result;
  }
  return value;
}

/**
 * D11-M5 (Cycle 10 Wave-3 Medium, P2): canonical env-var-format parity table.
 *
 * Each row records the env-var syntax actually consumed by the target platform
 * for a given adapter output surface (verified against the cited primary
 * source) and the corresponding `transformEnvVarSyntax` format the adapter
 * MUST request.
 *
 * Two regression suites guard this table, and the second is the one that makes
 * it a real contract (D2-14, Cycle 11 Wave 3, D2, P2):
 *   1. `src/__tests__/adapters/mcp-utils.test.ts` → describe
 *      "MCP_ENV_VAR_FORMAT_PARITY": a table-INTERNAL consistency check — every
 *      supported adapter has both surface rows, and each row's `format` maps to
 *      the documented `transformEnvVarSyntax` output. This pins the table's
 *      shape but, on its own, cannot catch an adapter call site that requests a
 *      format the table does not list (it never reads a call site).
 *   2. `src/__tests__/adapters/mcp-dataflow.test.ts` → describe
 *      "MCP_ENV_VAR_FORMAT_PARITY adapter cross-check (D2-14)": the real gate.
 *      For every row it runs the OWNING adapter's `generate()` against a
 *      `${env:VAR}` fixture and asserts the emitted `.mcp.json` / `.cursor/mcp.json`
 *      / `.vscode/mcp.json` carries the substitution the row declares (honoring
 *      `viaEnvFile` and `viaInputs` surfaces). A call site that picks the wrong
 *      format (e.g., emits `$VAR` to a consumer that does not perform shell
 *      expansion), or a table row that drifts from its call site, breaks this
 *      test rather than silently shipping unsubstituted placeholders.
 *
 * Sources accessed 2026-05-27:
 *   - Claude Code MCP: https://code.claude.com/docs/en/mcp (uses `${VAR}`).
 *   - Cursor MCP: https://docs.cursor.com/context/model-context-protocol
 *     (uses MCP spec native `${env:VAR}`).
 *   - VS Code MCP STDIO env: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
 *     (does NOT perform shell expansion on `env:` values; MUST route secrets
 *     via `envFile` instead of substitution — see D11-C-2 in copilot.ts).
 *   - VS Code MCP HTTP headers: same source (header secrets are substituted
 *     via top-level `inputs[]` + `${input:NAME}` references, NOT shell
 *     expansion — VS Code does not shell-expand `$VAR` in header values).
 *     D11-7 (Cycle 11, P6/CQ4) wired the `inputs[]` emission, so the copilot
 *     `mcp-headers` row carries `format: "passthrough"` (the canonical
 *     `${env:NAME}` value passes through `transformEnvVarSyntax` untouched)
 *     plus `viaInputs: true` — the adapter then rewrites `${env:NAME}` to
 *     `${input:NAME}` and emits a matching `inputs[]` entry. See
 *     `src/adapters/copilot.ts::collectMcpHeaderInputs`.
 */
export interface McpEnvVarFormatRow {
  adapter: "claude" | "cursor" | "copilot";
  surface: "mcp-env" | "mcp-headers";
  format: "claude" | "shell" | "passthrough";
  /** True when the surface uses `envFile` instead of inline substitution. */
  viaEnvFile?: true;
  /**
   * True when header secrets are substituted via VS Code's top-level
   * `inputs[]` + `${input:NAME}` mechanism rather than a `transformEnvVarSyntax`
   * format (D11-7, copilot HTTP/STDIO header path).
   */
  viaInputs?: true;
}

export const MCP_ENV_VAR_FORMAT_PARITY: ReadonlyArray<McpEnvVarFormatRow> = [
  { adapter: "claude", surface: "mcp-env", format: "claude" },
  { adapter: "claude", surface: "mcp-headers", format: "claude" },
  { adapter: "cursor", surface: "mcp-env", format: "passthrough" },
  { adapter: "cursor", surface: "mcp-headers", format: "passthrough" },
  // D2-SA2.4-15 (Cycle 12, D2, P2): `format` records the exact envVarFormat the
  // copilot adapter passes to `buildStdMcpEntries` — `"passthrough"` (copilot.ts,
  // `buildStdMcpEntries(mcp, "passthrough", "${workspaceFolder}/.env.mcp")`), NOT a
  // hypothetical inline syntax. `viaEnvFile` drops the `env` object entirely
  // (base.ts), so no substitution is applied to env; the passthrough argument serves
  // the header path. Was `"shell"` pre-D11-C-2 — a stale value that made this one row
  // mean "hypothetical format" while every other row means "the format the adapter
  // requests", the ambiguity a parity contract exists to remove.
  { adapter: "copilot", surface: "mcp-env", format: "passthrough", viaEnvFile: true },
  { adapter: "copilot", surface: "mcp-headers", format: "passthrough", viaInputs: true },
] as const;

const ALLOWED_COMMANDS = new Set([
  "npx",
  "node",
  "uvx",
  "docker",
  "python",
  "python3",
  "pip",
  "pip3",
  "deno",
  "bun",
  "uv",
  "go",
  "cargo",
  // C9-H53 (D15-SA15.5-F01, Pillar P6): on-demand fetch launchers other
  // than npx/uvx that pull packages at launch time. Adding them to the
  // allowlist prevents false "unrecognized command" warnings on valid
  // configs while the ON_DEMAND_FETCH_LAUNCHERS set below routes them
  // through the version-pin gate.
  "pipx",
  "bunx",
  "pnpm",
  "yarn",
  // D11-8 (Cycle 11, P3/P6): the GitLab CLI launched as a local system
  // binary for the canonical `gitlab` MCP server (`glab mcp serve`). It is
  // not an on-demand fetch launcher (it runs an installed binary, like
  // `docker`/`go`/`cargo` above), so it carries no version-pin gate — it is
  // allowlisted so the bundled config does not self-emit a false
  // "unrecognized command" warning.
  "glab",
]);

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Package-managers whose CLIs fetch a package from the network at launch
 * time, then execute it. With no version specifier — or the floating `latest`
 * tag — every launch resolves the newest published version and inherits any
 * upstream compromise (e.g., 2025 npm maintainer-account incidents). The gate
 * this set drives is a no-floating-`latest` gate, NOT an immutability gate: see
 * {@link checkVersionPin} for the exact flagged/accepted specifier classes.
 *
 * Two shapes are supported:
 * 1. **Single-command launchers** (`npx`, `uvx`, `pipx`, `bunx`) — the
 *    command itself fetches and runs the package: `command: "uvx"`,
 *    `args: ["mcp-server-fetch@1.2.3"]`.
 * 2. **Two-token launchers** (`pnpm dlx`, `yarn dlx`) — the `dlx`
 *    subcommand of `pnpm` or `yarn` fetches and runs: `command: "pnpm"`,
 *    `args: ["dlx", "@org/pkg@1.2.3"]`.
 *
 * Origin: C9-H53 (D15-SA15.5-F01, Pillar P6). Replaces the prior
 * `entry.command === "npx"` gate so uvx/pipx/bunx/pnpm dlx/yarn dlx
 * configurations also receive supply-chain protection.
 */
export const ON_DEMAND_FETCH_LAUNCHERS = [
  "npx",
  "uvx",
  "pipx",
  "bunx",
  "pnpm dlx",
  "yarn dlx",
] as const;

/**
 * Set form of {@link ON_DEMAND_FETCH_LAUNCHERS} for O(1) membership checks.
 */
const ON_DEMAND_FETCH_LAUNCHER_SET: ReadonlySet<string> = new Set(
  ON_DEMAND_FETCH_LAUNCHERS,
);

/**
 * D2-SA2.4-04: launchers that resolve against the npm registry, where the
 * `@scope/pkg` convention exists and the unscoped-name typosquat heuristic
 * (with its "use a scoped package (@org/pkg)" advice) is valid. uvx and pipx
 * resolve PyPI packages — `@scope/` is not a PyPI convention there, so applying
 * the npm advice would be misleading. Their supply-chain signal is the
 * version-pin + dependency-confusion escalation in checkVersionPin (which is
 * already launcher-aware, D11-8), applied to every launcher below.
 */
const NPM_REGISTRY_LAUNCHERS: ReadonlySet<string> = new Set([
  "npx",
  "bunx",
  "pnpm dlx",
  "yarn dlx",
]);

/**
 * Detect whether an MCP server entry uses an on-demand fetch launcher and
 * return its canonical token (one of {@link ON_DEMAND_FETCH_LAUNCHERS}).
 *
 * Normalizes the command basename (strips path and trailing `.exe`/`.cmd`/
 * `.bat`) before matching, so Windows shims like `npx.bat` and absolute
 * paths like `/usr/local/bin/uvx` are detected. For two-token launchers
 * (`pnpm dlx`, `yarn dlx`), inspects the first non-flag arg.
 *
 * Returns `null` when the command is not a fetch launcher (e.g., `node`,
 * `docker`, a local script).
 *
 * Origin: C9-H53 (D15-SA15.5-F01, Pillar P6).
 */
export function detectFetchLauncher(
  command: string | undefined,
  args: string[] | undefined,
): (typeof ON_DEMAND_FETCH_LAUNCHERS)[number] | null {
  if (!command) return null;
  const rawBase = command.split("/").pop()?.split("\\").pop() ?? command;
  const baseCommand = rawBase.replace(/\.(?:exe|cmd|bat)$/i, "");

  // Single-token launchers.
  if (ON_DEMAND_FETCH_LAUNCHER_SET.has(baseCommand)) {
    return baseCommand as (typeof ON_DEMAND_FETCH_LAUNCHERS)[number];
  }

  // Two-token launchers: `pnpm dlx <pkg>` / `yarn dlx <pkg>`.
  if (baseCommand === "pnpm" || baseCommand === "yarn") {
    const firstNonFlag = args?.find((a) => !a.startsWith("-"));
    if (firstNonFlag === "dlx") {
      const composite = `${baseCommand} dlx`;
      if (ON_DEMAND_FETCH_LAUNCHER_SET.has(composite)) {
        return composite as (typeof ON_DEMAND_FETCH_LAUNCHERS)[number];
      }
    }
  }

  return null;
}

/**
 * Locate the package argument for an on-demand fetch launcher.
 *
 * For single-token launchers, the package is the first non-flag arg that
 * is not the command itself. For two-token launchers (`pnpm dlx`,
 * `yarn dlx`), it is the first non-flag arg AFTER the `dlx` token.
 *
 * Returns `null` when no package argument is present (e.g., `npx -y`
 * with no following positional arg).
 *
 * Origin: C9-H53 (D15-SA15.5-F01, Pillar P6).
 */
export function findLauncherPackageArg(
  command: string | undefined,
  args: string[] | undefined,
  launcher: (typeof ON_DEMAND_FETCH_LAUNCHERS)[number],
): string | null {
  if (!args || args.length === 0) return null;

  // Two-token launcher: skip past the `dlx` token, then pick the first
  // non-flag arg. Flags BEFORE `dlx` are launcher flags; flags AFTER
  // belong to the package and should be skipped to find the package name.
  if (launcher === "pnpm dlx" || launcher === "yarn dlx") {
    const dlxIndex = args.findIndex((a) => a === "dlx");
    if (dlxIndex === -1) return null;
    for (let i = dlxIndex + 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("-")) return arg;
    }
    return null;
  }

  // Single-token launcher: first non-flag arg that is not the command.
  return args.find((a) => !a.startsWith("-") && a !== command) ?? null;
}

/**
 * Validate a single MCP server entry and return any warnings.
 *
 * Checks: command allowlist, URL scheme, env key naming (POSIX),
 * arg shell metacharacters, unscoped npx packages, and timeout bounds.
 */
export function validateMcpEntry(
  name: string,
  entry: McpServerEntry,
): string[] {
  const warnings: string[] = [];

  if (entry.command) {
    // C7.5-W2B2-H3 (D2-SA2.4-1): Normalize Windows executable extensions
    // before checking the allowlist. Windows users configuring MCP servers
    // on native shells naturally specify `node.exe`, `python.cmd`, or
    // `npx.bat` — the stripped basename ("node.exe", "python.cmd") then
    // fails the allowlist check even though the underlying command is
    // supported. Strip one trailing `.exe`, `.cmd`, or `.bat` (case
    // insensitive) so Windows paths resolve to the same base command name
    // as POSIX paths do. Preserves the original `entry.command` in the
    // warning message when the normalized form is still unrecognized so
    // the user sees the exact string they configured.
    const rawBase =
      entry.command.split("/").pop()?.split("\\").pop() ?? entry.command;
    const baseCommand = rawBase.replace(/\.(?:exe|cmd|bat)$/i, "");
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      warnings.push(
        `MCP server "${name}" uses unrecognized command "${entry.command}". ` +
          `Expected one of: ${[...ALLOWED_COMMANDS].join(", ")}`,
      );
    }
  }

  if (entry.url) {
    try {
      const parsed = new URL(entry.url);
      if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
        warnings.push(
          `MCP server "${name}" uses unsupported URL scheme "${parsed.protocol}". ` +
            `Allowed: ${[...ALLOWED_URL_SCHEMES].join(", ")}`,
        );
      }
    } catch {
      warnings.push(
        `MCP server "${name}" has invalid URL: "${entry.url}"`,
      );
    }
  }

  if (!entry.command && !entry.url) {
    warnings.push(
      `MCP server "${name}" has neither command nor url configured`,
    );
  }

  // #120: Validate env key names follow POSIX convention
  if (entry.env) {
    for (const key of Object.keys(entry.env)) {
      if (!VALID_ENV_KEY.test(key)) {
        warnings.push(
          `MCP server "${name}" has invalid env key "${key}". ` +
            `Environment variable names must match [A-Za-z_][A-Za-z0-9_]*.`,
        );
      }
    }
  }

  if (entry.args) {
    const SHELL_METACHAR = /[|;&`$()]/;
    for (const arg of entry.args) {
      if (SHELL_METACHAR.test(arg)) {
        warnings.push(
          `MCP server "${name}" arg contains shell metacharacters: "${arg}". ` +
            `This may indicate a command injection risk.`,
        );
      }
    }

    // D2-SA2.4-04 (D15, P6): on-demand-fetch supply-chain gate (version pin +
    // typosquat + dependency-confusion escalation). Detect the launcher FIRST,
    // then scope the -y/--yes precondition to npx ONLY. Rationale: npx genuinely
    // prompts before fetching an uncached package, so the historical C7-H6
    // contract warns only for auto-confirmed npx. Every OTHER launcher
    // (uvx/pipx/bunx/pnpm dlx/yarn dlx) auto-fetches-and-executes with no
    // confirmation flag — uvx has no -y at all (astral-sh/uv#16600, accessed
    // 2026-07-10) — so the prior `if (hasAutoYes)` guard made this gate (and the
    // D15-25 unknown-name escalation) UNREACHABLE for 5 of its 6 launchers. Run
    // it unconditionally for them. The package arg comes from
    // findLauncherPackageArg (launcher-aware — the earlier ad-hoc first-non-flag
    // find mis-identified `dlx` as the package for pnpm/yarn dlx).
    // The 2025 npm supply-chain incident (qix maintainer compromise, 18 packages,
    // 2.6B weekly downloads) and OWASP Top 10 for Agentic Apps 2026 motivate the
    // gate; `@latest` is treated as unpinned (mutable tag, not an immutable pin).
    const launcher = detectFetchLauncher(entry.command, entry.args);
    if (launcher !== null) {
      const hasAutoYes = entry.args.some((a) => a === "-y" || a === "--yes");
      // npx is the only launcher that surfaces the package to the operator
      // before fetching; the rest are non-interactive auto-fetch-and-execute.
      const gateApplies = launcher !== "npx" || hasAutoYes;
      if (gateApplies) {
        const launcherPkg = findLauncherPackageArg(
          entry.command,
          entry.args,
          launcher,
        );
        if (launcherPkg) {
          // npm-registry launchers only: the "@scope/pkg" typosquat heuristic is
          // npm-specific (uvx/pipx resolve PyPI, where checkVersionPin's
          // escalation is the signal — see NPM_REGISTRY_LAUNCHERS).
          if (
            NPM_REGISTRY_LAUNCHERS.has(launcher) &&
            !launcherPkg.startsWith("@")
          ) {
            warnings.push(
              `MCP server "${name}" uses ${launcher} with unscoped package "${launcherPkg}". ` +
                `Unscoped packages are susceptible to typosquatting. Consider using a scoped package (@org/pkg).`,
            );
          }
          const pinWarning = checkVersionPin(name, launcherPkg, launcher);
          if (pinWarning) warnings.push(pinWarning);
        }
      }
    }
  }

  // C9-M34 (D15 / Pillar P6): Enforce SHA-256 pin or explicit trust-bypass
  // on HTTP-transport entries. Policy violations surface as warnings on the
  // standard validation path; adapters can also call validateMcpHttpEndpoint
  // directly to refuse generation. Bypassed entries get an audit warning so
  // operators see the opt-out in CI logs.
  const httpPolicy = validateMcpHttpEndpoint(entry);
  if (!httpPolicy.ok && httpPolicy.reason) {
    warnings.push(`MCP server "${name}" ${httpPolicy.reason}`);
  } else if (entry._trust_bypass === true && entry.url && !entry.command) {
    // D11-15 (D11, P6/SA11.3-F3): suppress the per-server bypass warning when
    // a documented rationale is recorded. The bypass remains auditable through
    // the recorded reason; emitting a repeating un-actionable warning for a
    // deliberate, justified opt-out (e.g. the bundled github server's rotating
    // first-party endpoint) trains operators to ignore MCP security warnings.
    // A reason that is present-but-malformed (non-string, or empty/whitespace-
    // only) does NOT suppress — it is a misconfiguration that gets its own
    // warning, so an attempt to silence the signal without a real rationale
    // still surfaces. Bypass with no reason at all keeps the original warning,
    // preserving the signal for operator-added unpinned HTTP servers.
    const reason = entry._trust_bypass_reason;
    const hasValidReason = typeof reason === "string" && reason.trim() !== "";
    if (reason !== undefined && !hasValidReason) {
      warnings.push(
        `MCP server "${name}" has invalid _trust_bypass_reason ` +
          `(${typeof reason === "string" ? "empty/whitespace string" : `${typeof reason}`}). ` +
          `Provide a non-empty rationale string to document the pinning opt-out, ` +
          `or remove the field to restore the bypass warning.`,
      );
    }
    if (!hasValidReason) {
      warnings.push(
        `MCP server "${name}" HTTP endpoint "${entry.url}" pinning bypassed ` +
          `via _trust_bypass: true. Endpoint is trusted on faith — operator ` +
          `accepts upstream-compromise risk. Document the rationale in ` +
          `_trust_bypass_reason to suppress this warning.`,
      );
    }
  }

  // D15 Medium (#15.44): Validate timeout if specified
  if (entry._timeout !== undefined) {
    if (typeof entry._timeout !== "number" || entry._timeout <= 0) {
      // D2-SA2.4-06 (D2 / Pillar P5): state what the emission path actually does,
      // not an un-performed remediation. An invalid _timeout is NOT substituted
      // with a default here or downstream — the Claude emission (claude.ts) writes
      // a `timeout` field only for a positive value, so an invalid one yields NO
      // timeout field and the client applies its own default (Claude Code:
      // MCP_TOOL_TIMEOUT, ~28h — not DEFAULT_MCP_TIMEOUT_MS). Clamping/substituting
      // would require the adapter emission path, outside this validator's scope.
      warnings.push(
        `MCP server "${name}" has invalid timeout: ${entry._timeout}. ` +
        `Timeout must be a positive number (milliseconds). The invalid value is ` +
        `not emitted — no timeout field is written, so the client applies its own ` +
        `default (Claude Code falls through to MCP_TOOL_TIMEOUT, ~28h).`,
      );
    } else if (entry._timeout < MIN_HONORED_MCP_TIMEOUT_MS) {
      // D9-SA9.1-L / D15-SA15.5-F8 (Cycle 11 Wave 4, D9/D15, P3/P6): a
      // positive-but-sub-1000ms value passes the `> 0` guard but the Claude
      // Code loader IGNORES it and falls through to MCP_TOOL_TIMEOUT / the ~28h
      // default (code.claude.com/docs/en/mcp, accessed 2026-06-10). Warn so the
      // operator does not believe a bound was applied that the platform silently
      // dropped (Silent Failure Contract, CONSTITUTION §2 P5).
      warnings.push(
        `MCP server "${name}" timeout (${entry._timeout}ms) is below the minimum honored value ` +
        `(${MIN_HONORED_MCP_TIMEOUT_MS}ms). Claude Code ignores sub-${MIN_HONORED_MCP_TIMEOUT_MS}ms timeouts and ` +
        `falls through to MCP_TOOL_TIMEOUT (default ~28h). Set _timeout to at least ${MIN_HONORED_MCP_TIMEOUT_MS} ` +
        `to apply a per-server bound.`,
      );
    } else if (entry._timeout > MAX_MCP_TIMEOUT_MS) {
      // D2-SA2.4-06 (D2 / Pillar P5): the value is NOT capped — the Claude
      // emission (claude.ts) writes `entry._timeout` verbatim for any positive
      // value. MAX_MCP_TIMEOUT_MS is the advisory threshold that triggers this
      // warning, not an enforced ceiling; the warning states the emitted reality.
      warnings.push(
        `MCP server "${name}" timeout (${entry._timeout}ms) exceeds maximum (${MAX_MCP_TIMEOUT_MS}ms). ` +
        `The value is emitted uncapped — hatch3r does not clamp it, so the client ` +
        `receives ${entry._timeout}ms as-is.`,
      );
    }
  }

  return warnings;
}

/**
 * Package base-names (scope + name, NO version suffix) shipped by the bundled
 * canonical `mcp/mcp.json` on an on-demand fetch launcher.
 *
 * D15-25 (Cycle 11 Wave 3, D15, P6/SA15.5-F2): the version-pin gate used to give
 * the SAME generic "pin a version" advice for every unpinned package, whether it
 * was a recognized canonical MCP package that merely lacked a version or a bare
 * name that is not a package on the launcher's registry at all. That conflation
 * is what produced the unsatisfiable `glab@<version>` advice (D15-1): the right
 * signal there was "this is not the package you think it is," not "you forgot a
 * version." This allowlist lets {@link checkVersionPin} ESCALATE the message for
 * an unpinned package whose base name is unknown — the dependency-confusion /
 * wrong-launcher class — while keeping the plain pin advice for a known package.
 *
 * Source of truth is the bundled `mcp/mcp.json` (the npx-launched server
 * `args[]` package tokens). It is a hand-mirrored list, kept in lockstep with
 * that file; `src/__tests__/mcp/mcp-package-resolution.test.ts` (Decision 20)
 * loads the real bundle, and the parity assertion in
 * `src/__tests__/adapters/mcp-utils.test.ts` asserts every npx-launched bundled
 * package base-name is present here, so a future canonical addition that forgets
 * to update this set breaks a test rather than silently mis-escalating. The
 * non-fetch-launcher servers (`github` HTTP transport, `gitlab` `glab` system
 * binary) are intentionally absent — they never reach the version-pin gate.
 */
export const CANONICAL_MCP_PACKAGES: ReadonlySet<string> = new Set([
  "@upstash/context7-mcp",
  "@modelcontextprotocol/server-filesystem",
  "@playwright/mcp",
  "@brave/brave-search-mcp-server",
  "@sentry/mcp-server",
  "@henkey/postgres-mcp-server",
  "@mkusaka/mcp-server-linear",
  "@tiberriver256/mcp-server-azure-devops",
]);

/**
 * Check whether an on-demand-fetch-launched package argument is anchored to a
 * version specifier rather than floating on `latest`/no version.
 *
 * D2-SA2.4-11 (D2 / Pillar P6): this is a no-floating-`latest` gate, NOT an
 * immutability gate. It flags only the floating class — an unpinned package (no
 * `@version` suffix) or the mutable `@latest` tag — and returns `null` for every
 * other specifier: a pinned semver (`@1.2.3`), a semver range (`@^1.0.0`), a
 * non-`latest` dist-tag (`@beta`), or a tarball/git URL. Ranges and dist-tags do
 * re-resolve per launch and so are not strictly immutable, but they are accepted
 * as deliberate author choices — flagging them is out of scope for this gate,
 * which would otherwise warn on the common, intentional `@^1.0.0` pin. The
 * contract language says "no floating `latest`", not "immutable", so the docs and
 * the gate agree (this reword resolves the prior contract-vs-implementation
 * contradiction rather than tightening the check, per D2-SA2.4-11).
 *
 * Handles both unscoped (`pkg-name`) and scoped (`@scope/pkg`) package arguments
 * by detecting the package version separator after the optional scope prefix.
 *
 * `launcher` names the on-demand fetch launcher that triggered the check (one of
 * {@link ON_DEMAND_FETCH_LAUNCHERS}); it defaults to `"npx"` for backward
 * compatibility with the original npm-only gate. D11-8 (Cycle 11, P3/P6): the
 * advice is launcher-aware and does not assert that the package is
 * npm-registry-resolvable. The bundled `gitlab` entry exposed the failure mode —
 * its old `npx -y glab` form pointed at a bare name (`glab`) that is the GitLab
 * CLI Go binary, not an npm package, so the prior hardcoded "pin glab@<version>"
 * advice was unsatisfiable (pinning `glab@1.0.2` would have installed the
 * unrelated, since-unpublished 2017 npm package). The message now offers two
 * exits — pin a published version of THIS launcher's registry, or switch to the
 * correct package/launcher — so it stays actionable for uvx/pipx/bunx/pnpm dlx/
 * yarn dlx packages and for entries whose package is not on npm at all.
 *
 * D15-25 (Cycle 11 Wave 3, D15, P6/SA15.5-F2): when the unpinned package's base
 * name is NOT in {@link CANONICAL_MCP_PACKAGES}, the message ESCALATES — it
 * leads with an "unknown/unexpected package" line flagging the
 * dependency-confusion / wrong-launcher class (the `glab` failure mode) before
 * the standard pin-or-switch advice. A known canonical package that merely lacks
 * a version keeps the plain advice. The supply-chain severity of an unpinned
 * unknown name (an attacker can register the bare name and `-y` auto-installs +
 * executes it) is higher than a forgotten version on a vetted package, so the
 * operator gets the stronger signal first.
 *
 * Origin: C7-H6 (D15 / Pillar P6); advice corrected under D11-8 (Cycle 11),
 * escalation added under D15-25 (Cycle 11). See call site in `validateMcpEntry`.
 */
export function checkVersionPin(
  serverName: string,
  pkgArg: string,
  launcher: (typeof ON_DEMAND_FETCH_LAUNCHERS)[number] = "npx",
): string | null {
  // Skip non-package args: tarballs, git URLs, file paths.
  if (
    pkgArg.startsWith("file:") ||
    pkgArg.startsWith("git+") ||
    pkgArg.startsWith("git:") ||
    pkgArg.startsWith("http:") ||
    pkgArg.startsWith("https:") ||
    pkgArg.endsWith(".tgz")
  ) {
    return null;
  }

  // Locate the version separator. For scoped packages (`@scope/pkg[@version]`),
  // the version `@` is the SECOND `@`. For unscoped (`pkg[@version]`), it is
  // the first occurrence after the package name.
  const versionAt = pkgArg.startsWith("@")
    ? pkgArg.indexOf("@", 1)
    : pkgArg.indexOf("@");

  const versionSpec = versionAt > 0 ? pkgArg.slice(versionAt + 1) : "";

  // Unpinned: no `@version` suffix. `@latest` is also unpinned because it is
  // a mutable tag that resolves to the newest published version on each launch.
  if (versionSpec === "" || versionSpec === "latest") {
    const baseName = pkgArg.slice(
      0,
      versionAt > 0 ? versionAt : pkgArg.length,
    );
    // D15-25 (D15, P6): escalate when the base name is not a known canonical
    // MCP package. An unpinned UNKNOWN name is the dependency-confusion /
    // wrong-launcher class (the `glab` failure mode) — higher severity than a
    // vetted package that merely lacks a version, so the operator sees the
    // unknown-package signal first.
    const escalation = CANONICAL_MCP_PACKAGES.has(baseName)
      ? ""
      : `"${baseName}" is not a known/expected hatch3r canonical MCP package on ` +
        `${launcher}'s registry — an unpinned unknown name lets an attacker ` +
        `register it and have ${launcher} auto-install + execute it ` +
        `(dependency-confusion / wrong-launcher risk). `;
    return (
      `MCP server "${serverName}" uses ${launcher} with unpinned package "${pkgArg}". ` +
      escalation +
      `Unpinned packages download the latest version on every invocation, exposing ` +
      `the agent to supply chain compromise (e.g., 2025 npm maintainer-account incidents). ` +
      `Pin a published version ("${baseName}@<version>"), or — if "${baseName}" is not a ` +
      `package on ${launcher}'s registry — switch to the correct package or a system-CLI ` +
      `command instead of the ${launcher} launcher.`
    );
  }

  return null;
}

/**
 * Pattern for a valid SHA-256 pin value: 64 lowercase hex chars, optionally
 * prefixed with `sha256:`. Mirrors the handoff integrity format used in
 * `src/content/handoffs/validation.ts` for consistency across the codebase.
 *
 * Origin: C9-M34 (D15 / Pillar P6).
 */
const VALID_SHA256_PIN = /^(?:sha256:)?[0-9a-f]{64}$/;

/**
 * Result of an HTTP-endpoint policy check.
 *
 * `ok: true` means the entry passes the policy and generation may proceed.
 * `ok: false` carries a `reason` string suitable for surfacing to operators
 * via warnings or error messages. Adapters that consume MCP entries must
 * refuse to emit a server config whose endpoint policy returns `ok: false`.
 *
 * Origin: C9-M34 (D15 / Pillar P6).
 */
export interface McpHttpEndpointResult {
  ok: boolean;
  reason?: string;
}

/**
 * Enforce SHA-256 pinning policy for MCP servers using an HTTP transport.
 *
 * An HTTP-transport entry is one where `url` is set and `command` is not
 * — these are remote endpoints reached over the network rather than
 * locally-spawned processes. Without pinning, the agent talks to whatever
 * the URL resolves to on each invocation, inheriting any upstream
 * compromise (server takeover, DNS hijack, malicious update push).
 *
 * Policy (returns `{ ok: true }` iff one holds):
 * 1. Entry is not HTTP transport (has a `command`, or has no `url`).
 * 2. Entry has `_pinned_sha256` matching {@link VALID_SHA256_PIN}.
 * 3. Entry has `_trust_bypass: true` (explicit operator opt-out).
 *
 * All other shapes return `{ ok: false, reason }` and adapters must refuse
 * to generate output for the server. `_pinned_sha256` set to a malformed
 * value is rejected — silently accepting it would defeat the pin.
 * `_trust_bypass` set to any value other than literal `true` is rejected
 * — `false`/`undefined` mean pinning is required; non-boolean is a
 * misconfiguration.
 *
 * Origin: C9-M34 (D15 / Pillar P6). The 2025 npm maintainer-account
 * incidents and OWASP Top 10 for Agentic Apps 2026 document that
 * unauthenticated remote artifact fetching is the dominant supply-chain
 * vector for agent runtimes; pinning at the endpoint layer is the
 * remote-transport analog of the version-pin gate already enforced for
 * on-demand fetch launchers (C9-H53).
 */
export function validateMcpHttpEndpoint(
  server: McpServerEntry,
): McpHttpEndpointResult {
  // Non-HTTP entries (command-based stdio transports, or empty entries
  // that will fail elsewhere) are out of scope for endpoint pinning.
  const isHttpTransport = !!server.url && !server.command;
  if (!isHttpTransport) {
    return { ok: true };
  }

  // Explicit operator opt-out. Strict literal `true` — any other value
  // (string "true", number 1, etc.) is treated as a misconfiguration and
  // rejected so silent type coercion cannot bypass the policy.
  if (server._trust_bypass === true) {
    return { ok: true };
  }
  if (
    server._trust_bypass !== undefined &&
    server._trust_bypass !== false
  ) {
    return {
      ok: false,
      reason:
        `has invalid _trust_bypass value. ` +
        `Must be boolean true (explicit opt-out) or false/omitted (require pin).`,
    };
  }

  // Pinning path: _pinned_sha256 must be present AND well-formed.
  if (server._pinned_sha256 === undefined) {
    return {
      ok: false,
      reason:
        `HTTP endpoint "${server.url}" missing _pinned_sha256. ` +
        `HTTP transports require an immutable SHA-256 pin of the remote ` +
        `endpoint to defend against upstream compromise, or _trust_bypass: true ` +
        `to explicitly opt out. See C9-M34 (Pillar P6).`,
    };
  }
  if (
    typeof server._pinned_sha256 !== "string" ||
    !VALID_SHA256_PIN.test(server._pinned_sha256)
  ) {
    return {
      ok: false,
      reason:
        `HTTP endpoint "${server.url}" has malformed _pinned_sha256: ` +
        `"${String(server._pinned_sha256)}". Expected 64 lowercase hex ` +
        `chars, optionally prefixed with "sha256:".`,
    };
  }

  return { ok: true };
}

// Env var keys must follow POSIX convention: letters, digits, and underscores.
// Keys with other characters are rejected to prevent injection.
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Server names must contain only alphanumeric characters, hyphens, and underscores.
// Names with other special characters are rejected to prevent path traversal,
// injection, or config key manipulation.
const VALID_SERVER_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Characters that are unsafe in an MCP server `args[]` token.
 *
 * Origin: C9-M31 (D15 / Pillar P6). The existing `SHELL_METACHAR` check inside
 * {@link validateMcpEntry} only **warns** on `|;&`+backtick`$()`. That is
 * adequate for human-review surfaces but does not stop the generation step,
 * so a malformed MCP config can still emit an adapter artifact whose
 * launcher-level shell will expand the metacharacters at child-process
 * spawn time. C9-M31 adds a stricter, refusal-grade scan covering:
 *
 *   - The original shell-metacharacter set: `| ; & ` $ ( )`
 *   - Redirection / quoting that survives most shells: `< > \ ' "`
 *   - Newline / carriage-return that lets a single arg become multiple
 *     shell tokens or break out of a quoted context: `\n \r`
 *   - All other ASCII control characters `\x00-\x1f` and DEL `\x7f`, which
 *     no legitimate MCP arg needs and which routinely appear in
 *     adversarial inputs that probe argv parsers.
 *
 * Any hit causes {@link validateMcpServerArgs} to return a refusal message;
 * {@link readMcpConfig} then **drops** the server entry (parallel to the
 * `validateServerName` reject path) rather than emitting a warning-only
 * adapter artifact.
 *
 * Source basis (D15 trust tier ≥2):
 *   - Bash reference manual §3.1.2 "Quoting" — control-flow metacharacters.
 *   - OWASP "Command Injection Prevention Cheat Sheet" (2024) — neutralized
 *     character classes for spawn-based command construction.
 */
export const DANGEROUS_ARG_CHARS =
  // Encoded with \x escapes, NOT raw control bytes (D2-SA2.4-08): a raw NUL byte
  // made the whole file grep-blind (tooling classified it as binary) and left the
  // class one editor/formatter pass from silent semantic corruption. The class is
  // the C0 control block `\x00-\x1f` — its ONE range, and it spans control bytes
  // only (\n \r \t included) — plus DEL `\x7f`, then the shell metacharacters
  // `| ; & ` $ ( )` and redirection/quoting `< > \ ' "` enumerated individually.
  // No range spans printable bytes, so the class cannot subsume a legitimate
  // argument character. `DANGEROUS_ARG_CHARS.source` is pinned in the test suite,
  // so any re-encoding (raw bytes, or a formatter that rewrites the escapes)
  // trips a test rather than silently weakening or over-broadening the gate.
  /[\x00-\x1f\x7f|;&`$()<>\\'"]/;

/**
 * Result of {@link validateMcpServerArgs} — `ok: true` when every arg in the
 * entry is safe; `ok: false` carries a `reason` and `offendingArg` suitable
 * for the {@link readMcpConfig} drop-path warning. Mirrors the
 * {@link McpHttpEndpointResult} shape used by {@link validateMcpHttpEndpoint}.
 *
 * Origin: F15.5-C1 (D15 / Pillar P6). Wires the previously-unused
 * {@link DANGEROUS_ARG_CHARS} constant into a refusal-grade scan.
 */
export interface McpServerArgsResult {
  ok: boolean;
  reason?: string;
  /** The first arg that contained a dangerous character, if any. */
  offendingArg?: string;
  /** Zero-based index of the offending arg within `entry.args`, if any. */
  offendingIndex?: number;
}

/**
 * Documented-legitimate `args[]` idioms that carry a {@link DANGEROUS_ARG_CHARS}
 * byte yet are not injection vectors (D2-SA2.4-07, D2 / Pillar P2). Both patterns
 * full-match the WHOLE arg and exclude every OTHER dangerous byte, so a ref- or
 * path-prefixed injection (`${env:V:-;rm}`, `C:\x;rm`) is NOT exempt and still
 * refuses.
 *
 * (a) {@link CANONICAL_ENV_REF_ARG} — a canonical MCP env-var reference,
 *     `${env:NAME}` or `${env:NAME:-default}`. Its only dangerous byte is `$`
 *     (`{`/`}` are not in the class). This is the exact idiom the module's own
 *     transformation layer emits into the whole entry ({@link transformEnvVarSyntax};
 *     the whole-entry transform at cursor.ts / claude.ts) and that the MCP/Cursor
 *     interpolation surface documents (cursor.com/docs/context/model-context-protocol),
 *     so refusing it here contradicts the module's own design. NAME is a POSIX env
 *     key ({@link VALID_ENV_KEY} body); the optional `:-default` excludes dangerous
 *     bytes so a metacharacter smuggled into a default value still refuses.
 * (b) {@link WINDOWS_PATH_ARG} — a Windows path, drive-letter (`C:\...`) or UNC
 *     (`\\host\share`). Its only dangerous byte is `\`. Mirrors the C7.5-W2B2-H3
 *     Windows posture already accepted for the `command` field of the SAME entries
 *     — the asymmetry (command `C:\Program Files\nodejs\node.exe` accepted, the
 *     identical path in args refused) is the finding. The tail excludes control
 *     bytes and every dangerous byte except the `\` path separator.
 */
const CANONICAL_ENV_REF_ARG =
  /^\$\{env:[A-Za-z_][A-Za-z0-9_]*(?::-[^}|;&`$()<>\\'"\x00-\x1f\x7f]*)?\}$/;
const WINDOWS_PATH_ARG =
  /^(?:[A-Za-z]:\\|\\\\)[^\x00-\x1f\x7f|;&`$()<>'"]*$/;

/**
 * Whether `arg` is one of the two documented-legitimate idioms
 * ({@link CANONICAL_ENV_REF_ARG} / {@link WINDOWS_PATH_ARG}) exempt from the
 * {@link DANGEROUS_ARG_CHARS} refusal despite carrying a dangerous byte. Consulted
 * only AFTER a dangerous byte is found, so clean args never pay for the two extra
 * regex tests.
 */
function isExemptArgIdiom(arg: string): boolean {
  return CANONICAL_ENV_REF_ARG.test(arg) || WINDOWS_PATH_ARG.test(arg);
}

/**
 * Scan an MCP server entry's `args[]` for characters that no legitimate MCP
 * argument needs but every adversarial argv-injection payload requires.
 *
 * Refusal-grade contract (F15.5-C1, D15 / Pillar P6): unlike the warning-only
 * `SHELL_METACHAR` pass inside {@link validateMcpEntry}, a hit here makes
 * {@link readMcpConfig} **drop the entire server entry** — the entry never
 * reaches an adapter, so the launcher-level shell can never expand the
 * metacharacters at child-process spawn time. This is the parallel of the
 * `validateServerName` reject path: refuse, do not emit.
 *
 * Returns `{ ok: true }` when:
 * - `entry.args` is absent or empty (nothing to scan), OR
 * - every arg is a string AND either contains no character matched by
 *   {@link DANGEROUS_ARG_CHARS}, OR is a documented-legitimate idiom exempted by
 *   {@link isExemptArgIdiom} — a whole-arg `${env:NAME}` reference or a Windows
 *   path — even though it carries a dangerous byte (D2-SA2.4-07).
 *
 * Returns `{ ok: false, reason, offendingArg, offendingIndex }` when:
 * - any arg is not a string (type-coercion guard), OR
 * - any arg contains a character in {@link DANGEROUS_ARG_CHARS}.
 *
 * The first offender short-circuits the scan; callers receive enough context
 * to log the offending position without exposing the full arg vector.
 *
 * Threat model basis (D15 trust tier ≥ independent-analysis, accessed
 * 2026-05-27):
 *   - SecurityWeek "By-Design Flaw in MCP Could Enable Widespread AI
 *     Supply Chain Attacks" — confirms argv-injection vector in MCP STDIO
 *     transports launches arbitrary processes.
 *   - Ox Security "The Mother of All AI Supply Chains" — describes the
 *     parameter-injection blast radius (RCE on any system running a
 *     vulnerable MCP implementation).
 */
export function validateMcpServerArgs(
  entry: McpServerEntry,
): McpServerArgsResult {
  if (!entry.args || entry.args.length === 0) {
    return { ok: true };
  }

  for (let i = 0; i < entry.args.length; i++) {
    const arg = entry.args[i];

    // Type-coercion guard: a non-string arg (number, boolean, null, object)
    // would bypass the string-only regex scan. Treat as refusal — a
    // legitimate MCP config never carries non-string positional args.
    if (typeof arg !== "string") {
      return {
        ok: false,
        reason:
          `arg at index ${i} is not a string (got ${typeof arg}). ` +
          `MCP args must be strings; non-string args could bypass the ` +
          `injection scan. Entry refused.`,
        offendingIndex: i,
      };
    }

    if (DANGEROUS_ARG_CHARS.test(arg)) {
      // D2-SA2.4-07 (D2 / Pillar P2): before refusing, exempt the two
      // documented-legitimate idioms whose only dangerous byte is `$` (a whole-arg
      // `${env:NAME}` / `${env:NAME:-default}` reference) or `\` (a Windows path).
      // Both full-match the arg and exclude every other dangerous byte, so a
      // ref-/path-prefixed injection still falls through to the refusal below.
      if (isExemptArgIdiom(arg)) {
        continue;
      }
      // Truncate the offender so a binary blob does not flood the warning
      // stream — operators only need enough context to locate the entry.
      const display = arg.length > 64 ? arg.slice(0, 61) + "..." : arg;
      return {
        ok: false,
        reason:
          `arg at index ${i} contains a dangerous character ` +
          `(shell metacharacter, redirection, quoting, newline, or ASCII ` +
          `control byte). Entry refused to prevent argv-level injection ` +
          `at child-process spawn time. Offender (truncated): ` +
          `${JSON.stringify(display)}.`,
        offendingArg: arg,
        offendingIndex: i,
      };
    }
  }

  return { ok: true };
}

/**
 * Validate an MCP server name. Returns a warning string if invalid, or null if valid.
 * Server names must contain only alphanumeric characters, hyphens, and underscores.
 */
export function validateServerName(name: string): string | null {
  if (!VALID_SERVER_NAME.test(name)) {
    return (
      `MCP server name "${name}" contains invalid characters. ` +
      `Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
  return null;
}

/** Runtime type guard for the top-level MCP config shape (`{ mcpServers: {...} }`). */
function validateMcpConfig(
  parsed: unknown,
): parsed is { mcpServers: Record<string, McpServerEntry> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return typeof obj.mcpServers === "object" && obj.mcpServers !== null;
}

export interface McpConfigResult {
  servers: Record<string, McpServerEntry>;
  warnings: string[];
}

/**
 * Options for {@link readMcpConfig}.
 *
 * D11-16 (Cycle 11 Wave 3, D11, P5/SA11.3-F4): `validateEntries` toggles the
 * warn-only per-entry validation pass ({@link validateMcpEntry} +
 * {@link scanMcpServers}).
 *
 *  - `true` (default): full-bundle validation — every server entry is checked
 *    and its warnings accumulated. This is the surface `hatch3r validate`
 *    relies on to report problems across the WHOLE bundled `mcp.json`,
 *    independent of any per-repo selection.
 *  - `false`: skip the warn-only validation. The refusal-grade drop gates
 *    ({@link validateServerName}, {@link validateMcpServerArgs}) still run —
 *    they protect every consumer regardless of selection. The adapter path
 *    ({@link BaseAdapter.readFilteredMcp}) passes `false` so it can re-run
 *    per-entry validation AFTER the manifest-selection + `_disabled` filter,
 *    surfacing warnings only about the servers the repo actually emits — a
 *    2-server selection no longer reports warnings about the other 8.
 */
export interface ReadMcpConfigOptions {
  validateEntries?: boolean;
}

/**
 * Read and validate the MCP server configuration from `.agents/mcp/mcp.json`.
 *
 * Parses the JSON, validates each server name and entry, and returns
 * the validated servers with any accumulated warnings. Servers with
 * invalid names — or with argv that fail the refusal-grade dangerous-character
 * scan — are dropped entirely. The warn-only per-entry validation pass is
 * controlled by `opts.validateEntries` (default `true`; see
 * {@link ReadMcpConfigOptions}).
 */
export async function readMcpConfig(
  agentsDir: string,
  opts?: ReadMcpConfigOptions,
): Promise<McpConfigResult> {
  const validateEntries = opts?.validateEntries ?? true;
  const mcpPath = join(agentsDir, "mcp", "mcp.json");
  const warnings: string[] = [];
  try {
    const mcpRaw = await readFile(mcpPath, "utf-8");
    const parsed: unknown = JSON.parse(mcpRaw);
    if (validateMcpConfig(parsed)) {
      const validServers: Record<string, McpServerEntry> = {};
      for (const [name, entry] of Object.entries(parsed.mcpServers)) {
        // D2-SA2.4-13 (D2 / Pillar P5 Silent Failure Contract): validateMcpConfig
        // only guarantees `mcpServers` is a non-null object — it does NOT
        // shape-check individual entries, so an entry can be null, a primitive,
        // or an array. Drop such an entry with an auditable per-entry warning
        // instead of letting validateMcpServerArgs dereference `entry.args` and
        // throw a TypeError that escapes to the file-level catch, converting a
        // single malformed entry into whole-config loss ("Could not read MCP
        // config" → zero servers). `rawEntry` is typed `unknown` so the shape
        // checks narrow a genuinely untrusted value — the loop's declared
        // `McpServerEntry` type is the unsound half of validateMcpConfig's guard.
        const rawEntry: unknown = entry;
        if (
          typeof rawEntry !== "object" ||
          rawEntry === null ||
          Array.isArray(rawEntry)
        ) {
          warnings.push(`MCP server "${name}" entry dropped: not an object`);
          continue;
        }
        const nameWarning = validateServerName(name);
        if (nameWarning) {
          warnings.push(nameWarning);
          continue;
        }
        // F15.5-C1 (D15 / Pillar P6): refusal-grade argv scan. Parallel
        // to the validateServerName reject path — a dangerous-character
        // hit DROPS the entry so the adapter never emits an unsafe
        // launcher invocation. The warning is auditable (Silent Failure
        // Contract, CONSTITUTION.md §2 P5) so operators see the drop.
        // Runs regardless of `validateEntries`: a drop gate protects every
        // consumer and is not a selection-scoped diagnostic.
        const argsResult = validateMcpServerArgs(entry);
        if (!argsResult.ok) {
          warnings.push(
            `MCP server "${name}" entry dropped: ${argsResult.reason ?? "invalid args"}`,
          );
          continue;
        }
        // D11-16: warn-only per-entry validation is skipped when the caller
        // will re-run it on a filtered subset (the adapter selection path).
        if (validateEntries) warnings.push(...validateMcpEntry(name, entry));
        validServers[name] = entry;
      }
      // C7.5-W2B2-H46 (D15-F15.6-03, Pillar P6): static scan of MCP
      // server descriptions and free-form textual surfaces for prompt
      // injection / tool-poisoning markers (Invariant Labs 2025). Warns
      // only — servers still emit so legitimate servers whose descriptions
      // happen to hit a pattern are not silently dropped (Silent Failure
      // Contract, CONSTITUTION.md §2 P5). D11-16: scoped with the rest of
      // the warn-only pass so the adapter can run it on survivors only.
      if (validateEntries) warnings.push(...scanMcpServers(validServers));
      return { servers: validServers, warnings };
    }
    return { servers: {}, warnings };
  } catch (err) {
    warnings.push(`Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`);
    return { servers: {}, warnings };
  }
}
