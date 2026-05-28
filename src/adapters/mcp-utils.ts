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
}

/** Default MCP server request timeout in milliseconds. */
export const DEFAULT_MCP_TIMEOUT_MS = 30_000;
/** Maximum allowed MCP timeout in milliseconds (5 minutes). */
export const MAX_MCP_TIMEOUT_MS = 300_000;

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
 * `2025-11-25` (same source, "Most Recent Stable Version"). Emitting the
 * stable string lets hatch3r-generated `.mcp.json` declare an explicit,
 * forward-pinnable protocol version instead of leaving the field absent and
 * inheriting whatever the client/server negotiate by default.
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
 * MUST request. Regression test `src/__tests__/adapters/mcp-utils.test.ts`
 * loops over this table to enforce that every adapter call site stays aligned
 * with the platform contract — a future adapter that picks the wrong format
 * (e.g., emits `$VAR` to a consumer that does not perform shell expansion)
 * breaks the test rather than silently shipping unsubstituted placeholders.
 *
 * Sources accessed 2026-05-27:
 *   - Claude Code MCP: https://code.claude.com/docs/en/mcp (uses `${VAR}`).
 *   - Cursor MCP: https://docs.cursor.com/context/model-context-protocol
 *     (uses MCP spec native `${env:VAR}`).
 *   - VS Code MCP STDIO env: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
 *     (does NOT perform shell expansion on `env:` values; MUST route secrets
 *     via `envFile` instead of substitution — see D11-C-2 in copilot.ts).
 *   - VS Code MCP HTTP headers: same source (uses literal `$VAR` only
 *     reachable via `${input:NAME}` prompts in current Copilot release;
 *     `shell` format is retained on the headers path pending a follow-up
 *     that wires `inputs[]`, tracked outside this work unit).
 */
export interface McpEnvVarFormatRow {
  adapter: "claude" | "cursor" | "copilot";
  surface: "mcp-env" | "mcp-headers";
  format: "claude" | "shell" | "passthrough";
  /** True when the surface uses `envFile` instead of inline substitution. */
  viaEnvFile?: true;
}

export const MCP_ENV_VAR_FORMAT_PARITY: ReadonlyArray<McpEnvVarFormatRow> = [
  { adapter: "claude", surface: "mcp-env", format: "claude" },
  { adapter: "claude", surface: "mcp-headers", format: "claude" },
  { adapter: "cursor", surface: "mcp-env", format: "passthrough" },
  { adapter: "cursor", surface: "mcp-headers", format: "passthrough" },
  { adapter: "copilot", surface: "mcp-env", format: "shell", viaEnvFile: true },
  { adapter: "copilot", surface: "mcp-headers", format: "shell" },
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
]);

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Package-managers whose CLIs fetch a package from the network at launch
 * time, then execute it. Without an immutable version pin, every launch
 * resolves the latest published version and inherits any upstream
 * compromise (e.g., 2025 npm maintainer-account incidents).
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

    const hasAutoYes = entry.args.some((a) => a === "-y" || a === "--yes");
    if (hasAutoYes) {
      const pkgArg = entry.args.find(
        (a) => !a.startsWith("-") && a !== entry.command,
      );
      if (pkgArg && !pkgArg.startsWith("@")) {
        warnings.push(
          `MCP server "${name}" uses npx -y with unscoped package "${pkgArg}". ` +
            `Unscoped packages are susceptible to typosquatting. Consider using a scoped package (@org/pkg).`,
        );
      }
      // C7-H6 + C9-H53 (D15-SA15.5-F01, Pillar P6): Warn when an on-demand
      // fetch launcher invokes a package without an immutable version
      // pin. The 2025 npm supply-chain incident (qix maintainer compromise
      // affecting 18 packages, 2.6B weekly downloads) and OWASP Top 10
      // for Agentic Apps 2026 documented that unpinned launches resolve
      // `latest` on every invocation and inherit any upstream compromise.
      // `@latest` is treated as unpinned because it is a mutable tag,
      // not an immutable version. The original gate covered npx only;
      // C9-H53 extends coverage to uvx, pipx, bunx, pnpm dlx, and
      // yarn dlx — every launcher in {@link ON_DEMAND_FETCH_LAUNCHERS}.
      // Stays scoped to `-y`/`--yes` to preserve the prior contract that
      // interactive (non-auto-confirm) invocations do not warn.
      const launcher = detectFetchLauncher(entry.command, entry.args);
      if (launcher !== null) {
        const launcherPkg = findLauncherPackageArg(
          entry.command,
          entry.args,
          launcher,
        );
        if (launcherPkg) {
          const pinWarning = checkVersionPin(name, launcherPkg);
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
    warnings.push(
      `MCP server "${name}" HTTP endpoint "${entry.url}" pinning bypassed ` +
        `via _trust_bypass: true. Endpoint is trusted on faith — operator ` +
        `accepts upstream-compromise risk.`,
    );
  }

  // D15 Medium (#15.44): Validate timeout if specified
  if (entry._timeout !== undefined) {
    if (typeof entry._timeout !== "number" || entry._timeout <= 0) {
      warnings.push(
        `MCP server "${name}" has invalid timeout: ${entry._timeout}. ` +
        `Timeout must be a positive number (milliseconds). Using default ${DEFAULT_MCP_TIMEOUT_MS}ms.`,
      );
    } else if (entry._timeout > MAX_MCP_TIMEOUT_MS) {
      warnings.push(
        `MCP server "${name}" timeout (${entry._timeout}ms) exceeds maximum (${MAX_MCP_TIMEOUT_MS}ms). ` +
        `Capping at ${MAX_MCP_TIMEOUT_MS}ms.`,
      );
    }
  }

  return warnings;
}

/**
 * Check whether an `npx`-launched package argument carries an immutable version pin.
 *
 * Returns a warning string when the package is unpinned (no `@version` suffix) or
 * pinned to a mutable tag (`@latest`); returns `null` for any other case (a
 * pinned semver like `@1.2.3`, a range like `@^1.0.0`, a dist-tag like `@beta`,
 * or a tarball/git URL).
 *
 * Handles both unscoped (`pkg-name`) and scoped (`@scope/pkg`) package arguments
 * by detecting the package version separator after the optional scope prefix.
 *
 * Origin: C7-H6 (D15 / Pillar P6). See call site in `validateMcpEntry`.
 */
export function checkVersionPin(
  serverName: string,
  pkgArg: string,
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
    return (
      `MCP server "${serverName}" uses npx -y with unpinned package "${pkgArg}". ` +
      `Unpinned packages download the latest version on every invocation, exposing ` +
      `the agent to supply chain compromise (e.g., 2025 npm maintainer-account incidents). ` +
      `Add an immutable version pin: "${pkgArg.slice(0, versionAt > 0 ? versionAt : pkgArg.length)}@<version>".`
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
  // Explicit set: NUL through unit-separator (control chars including \n, \r, \t),
  // DEL (0x7f), then shell metacharacters `| ; & ` $ ( )`, redirection/quoting
  // `< > \ ' "`. Implemented as a single regex character class — no ranges over
  // printable bytes, so the pattern cannot inadvertently subsume legitimate
  // argument characters.
  /[ -|;&`$()<>\\'"]/;

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
 * - every arg is a string AND contains no character matched by
 *   {@link DANGEROUS_ARG_CHARS}.
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
 * Read and validate the MCP server configuration from `.agents/mcp/mcp.json`.
 *
 * Parses the JSON, validates each server name and entry, and returns
 * the validated servers with any accumulated warnings. Servers with
 * invalid names are skipped entirely.
 */
export async function readMcpConfig(
  agentsDir: string,
): Promise<McpConfigResult> {
  const mcpPath = join(agentsDir, "mcp", "mcp.json");
  const warnings: string[] = [];
  try {
    const mcpRaw = await readFile(mcpPath, "utf-8");
    const parsed: unknown = JSON.parse(mcpRaw);
    if (validateMcpConfig(parsed)) {
      const validServers: Record<string, McpServerEntry> = {};
      for (const [name, entry] of Object.entries(parsed.mcpServers)) {
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
        const argsResult = validateMcpServerArgs(entry);
        if (!argsResult.ok) {
          warnings.push(
            `MCP server "${name}" entry dropped: ${argsResult.reason ?? "invalid args"}`,
          );
          continue;
        }
        warnings.push(...validateMcpEntry(name, entry));
        validServers[name] = entry;
      }
      // C7.5-W2B2-H46 (D15-F15.6-03, Pillar P6): static scan of MCP
      // server descriptions and free-form textual surfaces for prompt
      // injection / tool-poisoning markers (Invariant Labs 2025). Warns
      // only — servers still emit so legitimate servers whose descriptions
      // happen to hit a pattern are not silently dropped (Silent Failure
      // Contract, CONSTITUTION.md §2 P5).
      warnings.push(...scanMcpServers(validServers));
      return { servers: validServers, warnings };
    }
    return { servers: {}, warnings };
  } catch (err) {
    warnings.push(`Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`);
    return { servers: {}, warnings };
  }
}
