import type { CleanMcpEntry } from "./base.js";
import { HatchError } from "../types.js";
import {
  CODEX_ENV_NAME_RE,
  CODEX_HTTP_HEADER_NAME_RE,
  CODEX_MCP_SERVER_NAME_RE,
  assertNoCodexCredentialMaterial,
  assertSafeCodexArgumentVector,
  assertSafeCodexProcessToken,
  isCodexCredentialSensitiveName,
  parseSafeCodexMcpHttpUrl,
} from "./codexCredentialSafety.js";
import {
  compareCodeUnits,
  encodeCodexTomlKey,
  encodeCodexTomlString,
  encodeCodexTomlStringArray,
  renderCodexTomlStringTable,
} from "./codexTomlCodec.js";

type CodexMcpSchema = "project" | "custom-agent";

export interface CodexAgentMcpServer {
  command?: string;
  args?: readonly string[];
  cwd?: string;
  envVars?: readonly string[];
  url?: string;
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Readonly<Record<string, string>>;
  enabled?: boolean;
  required?: boolean;
  enabledTools?: readonly string[];
  disabledTools?: readonly string[];
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

export type CodexMcpEntry = CleanMcpEntry & { cwd?: string };
type CodexMcpInput = CodexMcpEntry | CodexAgentMcpServer;

interface CodexMcpCommon {
  name: string;
  schema: CodexMcpSchema;
  enabled?: boolean;
  required?: boolean;
  enabledTools?: readonly string[];
  disabledTools?: readonly string[];
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

interface CodexStdioMcpServer extends CodexMcpCommon {
  transport: "stdio";
  command: string;
  args: readonly string[];
  cwd?: string;
  envVars: readonly string[];
  literalEnv: Readonly<Record<string, string>>;
  emitArgs: boolean;
  emitEnvVars: boolean;
}

interface CodexHttpMcpServer extends CodexMcpCommon {
  transport: "http";
  url: string;
  bearerTokenEnvVar?: string;
  httpHeaders: Readonly<Record<string, string>>;
  envHttpHeaders: Readonly<Record<string, string>>;
}

type NormalizedCodexMcpServer = CodexStdioMcpServer | CodexHttpMcpServer;

const PROJECT_FIELDS = new Set([
  "_pinned_sha256", "_timeout", "_trust_bypass", "_trust_bypass_reason",
  "args", "command", "cwd", "env", "headers", "url",
]);
const CUSTOM_AGENT_FIELDS = new Set([
  "args", "bearerTokenEnvVar", "command", "cwd", "disabledTools", "enabled",
  "enabledTools", "envHttpHeaders", "envVars", "required", "startupTimeoutSec",
  "toolTimeoutSec", "url",
]);
const ENV_REFERENCE_RE = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;
const BEARER_ENV_REFERENCE_RE = /^Bearer \$\{env:([A-Z_][A-Z0-9_]*)\}$/i;
const SHELL_INTERPOLATION_RE = /[`$;&|<>\r\n\0]/;
const SAFE_LITERAL_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._,:/@+-]{0,255}$/;
const SAFE_LITERAL_ENV_RULES: Readonly<Record<string, RegExp>> = {
  DEBUG: /^(?:0|1|false|true)$/i,
  ENVIRONMENT: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  HOST: /^(?:localhost|\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,252})$/,
  HOSTNAME: /^(?:localhost|\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,252})$/,
  LOG_LEVEL: /^(?:trace|debug|info|warn|error|fatal|silent)$/i,
  MODE: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  NODE_ENV: /^(?:development|production|test)$/,
  NO_COLOR: /^(?:0|1|false|true)$/i,
  PORT: /^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/,
  TRANSPORT: /^(?:stdio|http|streamable-http)$/i,
};
const SAFE_LITERAL_HEADER_RULES: Readonly<Record<string, RegExp>> = {
  accept: SAFE_LITERAL_VALUE_RE,
  "content-type": SAFE_LITERAL_VALUE_RE,
  "user-agent": SAFE_LITERAL_VALUE_RE,
  "x-api-version": SAFE_LITERAL_VALUE_RE,
  "x-mcp-toolsets": SAFE_LITERAL_VALUE_RE,
};

function mcpError(message: string): HatchError {
  return new HatchError(
    message,
    1,
    "VALIDATION_ERROR",
    "Correct the MCP definition; hatch3r will not emit partial Codex configuration.",
  );
}

function assertKnownFields(name: string, input: CodexMcpInput, schema: CodexMcpSchema): void {
  const allowed = schema === "project" ? PROJECT_FIELDS : CUSTOM_AGENT_FIELDS;
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw mcpError(
      `Codex ${schema === "custom-agent" ? "agent " : ""}MCP server ${name} contains unsupported field ${unknown.sort().join(", ")}; it was not serialized`,
    );
  }
}

function assertPositiveNumber(value: unknown, field: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
    throw mcpError(`${field} must be a positive finite number`);
  }
}

function assertOptionalBoolean(value: unknown, field: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw mcpError(`${field} must be a boolean`);
  }
}

function assertSafeLiteralEnv(key: string, value: string, name: string): void {
  if (isCodexCredentialSensitiveName(key)) {
    throw mcpError(
      `Codex MCP server "${name}" environment key "${key}" requires environment-variable indirection.`,
    );
  }
  assertNoCodexCredentialMaterial(value, `server "${name}" environment key "${key}"`);
  const rule = SAFE_LITERAL_ENV_RULES[key.toUpperCase()];
  if (!rule?.test(value)) {
    throw mcpError(
      `Codex MCP server "${name}" environment key "${key}" is not an allowed non-secret literal configuration field.`,
    );
  }
}

function assertSafeLiteralHeader(header: string, value: string, name: string): void {
  if (isCodexCredentialSensitiveName(header)) {
    throw mcpError(`Codex MCP server "${name}" header "${header}" requires environment-variable indirection.`);
  }
  assertNoCodexCredentialMaterial(value, `server "${name}" header "${header}"`);
  const rule = SAFE_LITERAL_HEADER_RULES[header.toLowerCase()];
  if (!rule?.test(value)) {
    throw mcpError(
      `Codex MCP server "${name}" header "${header}" is not an allowed non-secret literal configuration field.`,
    );
  }
}

function commonFields(
  name: string,
  input: CodexMcpInput,
  schema: CodexMcpSchema,
): CodexMcpCommon {
  const agent = input as CodexAgentMcpServer;
  assertOptionalBoolean(agent.enabled, "enabled");
  assertOptionalBoolean(agent.required, "required");
  assertPositiveNumber(agent.startupTimeoutSec, "startupTimeoutSec");
  assertPositiveNumber(agent.toolTimeoutSec, "toolTimeoutSec");
  for (const [field, values] of [
    ["enabled tool", agent.enabledTools],
    ["disabled tool", agent.disabledTools],
  ] as const) {
    for (const [index, value] of (values ?? []).entries()) {
      assertNoCodexCredentialMaterial(value, `agent server "${name}" ${field} ${index}`);
    }
  }
  return {
    name, schema, enabled: agent.enabled, required: agent.required,
    enabledTools: agent.enabledTools, disabledTools: agent.disabledTools,
    startupTimeoutSec: agent.startupTimeoutSec, toolTimeoutSec: agent.toolTimeoutSec,
  };
}

function validateStdioCwd(
  name: string,
  cwd: string | undefined,
  schema: CodexMcpSchema,
): void {
  if (cwd === undefined) return;
  if (cwd.length === 0) throw mcpError(`Codex MCP server "${name}" cwd must not be empty.`);
  assertSafeCodexProcessToken(cwd, `${schema === "custom-agent" ? "agent " : ""}server "${name}" cwd`);
}

function projectStdioEnvironment(
  name: string,
  input: CodexMcpEntry,
): { envVars: string[]; literalEnv: Record<string, string> } {
  if (input.headers && Object.keys(input.headers).length > 0) {
    throw mcpError(`Codex stdio MCP server "${name}" cannot define HTTP headers.`);
  }
  const envVars: string[] = [];
  const literalEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.env ?? {}).sort(([a], [b]) => compareCodeUnits(a, b))) {
    if (!CODEX_ENV_NAME_RE.test(key)) throw mcpError(`Codex MCP server "${name}" has invalid environment variable name "${key}".`);
    const match = value.match(ENV_REFERENCE_RE);
    if (match?.[1] === key) envVars.push(key);
    else if (match) throw mcpError(`Codex MCP server "${name}" maps environment key "${key}" to a different variable "${match[1]}".`);
    else {
      if (SHELL_INTERPOLATION_RE.test(value)) throw mcpError(`Codex MCP server "${name}" has unsupported environment interpolation for "${key}".`);
      assertSafeLiteralEnv(key, value, name);
      literalEnv[key] = value;
    }
  }
  return { envVars, literalEnv };
}

function agentStdioEnvironment(
  name: string,
  input: CodexAgentMcpServer,
): { envVars: string[]; literalEnv: Record<string, string> } {
  if (input.bearerTokenEnvVar || input.envHttpHeaders) {
    throw mcpError(`Codex agent stdio MCP server ${name} contains HTTP-only fields`);
  }
  const envVars = [...(input.envVars ?? [])];
  for (const envName of envVars) {
    if (!CODEX_ENV_NAME_RE.test(envName)) throw mcpError(`Invalid environment variable name: ${envName}`);
  }
  return { envVars: envVars.sort(compareCodeUnits), literalEnv: {} };
}

function normalizeStdio(
  name: string,
  input: CodexMcpInput,
  schema: CodexMcpSchema,
): CodexStdioMcpServer {
  const command = input.command!;
  assertSafeCodexProcessToken(command, `${schema === "custom-agent" ? "agent " : ""}server "${name}" command`);
  const args = input.args ?? [];
  assertSafeCodexArgumentVector(args, `${schema === "custom-agent" ? "agent " : ""}server "${name}"`);
  const cwd = input.cwd;
  validateStdioCwd(name, cwd, schema);
  const environment = schema === "project"
    ? projectStdioEnvironment(name, input as CodexMcpEntry)
    : agentStdioEnvironment(name, input as CodexAgentMcpServer);
  return {
    ...commonFields(name, input, schema), transport: "stdio", command, args, cwd,
    envVars: environment.envVars, literalEnv: environment.literalEnv,
    emitArgs: schema === "project" || input.args !== undefined,
    emitEnvVars: schema === "custom-agent"
      ? (input as CodexAgentMcpServer).envVars !== undefined
      : environment.envVars.length > 0,
  };
}

interface HttpOptions {
  bearerTokenEnvVar?: string;
  httpHeaders: Record<string, string>;
  envHttpHeaders: Record<string, string>;
}

function addProjectHttpHeader(
  result: HttpOptions,
  name: string,
  header: string,
  value: string,
): void {
  if (!CODEX_HTTP_HEADER_NAME_RE.test(header)) throw mcpError(`Codex MCP server "${name}" has invalid HTTP header name "${header}".`);
  const bearer = value.match(BEARER_ENV_REFERENCE_RE);
  const env = value.match(ENV_REFERENCE_RE);
  if (header.toLowerCase() === "authorization" && bearer) {
    result.bearerTokenEnvVar = bearer[1];
    return;
  }
  if (env) {
    result.envHttpHeaders[header] = env[1]!;
    return;
  }
  if (/\r|\n|\0/.test(value)) throw mcpError(`Codex MCP server "${name}" header "${header}" contains control characters.`);
  assertSafeLiteralHeader(header, value, name);
  result.httpHeaders[header] = value;
}

function projectHttpOptions(name: string, input: CodexMcpEntry): HttpOptions {
  if (input.env && Object.keys(input.env).length > 0) throw mcpError(`Codex HTTP MCP server "${name}" cannot define a process environment.`);
  if (input.cwd !== undefined) throw mcpError(`Codex HTTP MCP server "${name}" cannot define a process cwd.`);
  const result: HttpOptions = { httpHeaders: {}, envHttpHeaders: {} };
  for (const [header, value] of Object.entries(input.headers ?? {}).sort(([a], [b]) => compareCodeUnits(a, b))) {
    addProjectHttpHeader(result, name, header, value);
  }
  return result;
}

function agentHttpOptions(name: string, input: CodexAgentMcpServer): HttpOptions {
  if (input.args || input.cwd || input.envVars) {
    throw mcpError(`Codex agent HTTP MCP server ${name} contains stdio-only fields`);
  }
  if (input.bearerTokenEnvVar && !CODEX_ENV_NAME_RE.test(input.bearerTokenEnvVar)) {
    throw mcpError(`Invalid bearer token environment variable: ${input.bearerTokenEnvVar}`);
  }
  const envHttpHeaders: Record<string, string> = {};
  for (const [header, envName] of Object.entries(input.envHttpHeaders ?? {})) {
    if (!CODEX_HTTP_HEADER_NAME_RE.test(header)) throw mcpError(`Invalid HTTP header name: ${header}`);
    if (!CODEX_ENV_NAME_RE.test(envName)) throw mcpError(`Invalid HTTP header environment variable: ${envName}`);
    envHttpHeaders[header] = envName;
  }
  return { bearerTokenEnvVar: input.bearerTokenEnvVar, httpHeaders: {}, envHttpHeaders };
}

function normalizeHttp(
  name: string,
  input: CodexMcpInput,
  schema: CodexMcpSchema,
): CodexHttpMcpServer {
  const url = input.url!;
  parseSafeCodexMcpHttpUrl(url, `${schema === "custom-agent" ? "agent " : ""}server "${name}" URL`);
  const options = schema === "project"
    ? projectHttpOptions(name, input as CodexMcpEntry)
    : agentHttpOptions(name, input as CodexAgentMcpServer);
  return {
    ...commonFields(name, input, schema), transport: "http", url,
    bearerTokenEnvVar: options.bearerTokenEnvVar,
    httpHeaders: options.httpHeaders,
    envHttpHeaders: options.envHttpHeaders,
  };
}

function normalizeCodexMcpServer(
  name: string,
  input: CodexMcpInput,
  schema: CodexMcpSchema,
): NormalizedCodexMcpServer {
  if (!CODEX_MCP_SERVER_NAME_RE.test(name)) throw mcpError(`Codex MCP server name "${name}" contains unsupported characters.`);
  assertKnownFields(name, input, schema);
  if ((input.command ? 1 : 0) + (input.url ? 1 : 0) !== 1) {
    throw mcpError(`Codex ${schema === "custom-agent" ? "agent " : ""}MCP server "${name}" must use exactly one transport.`);
  }
  return input.command ? normalizeStdio(name, input, schema) : normalizeHttp(name, input, schema);
}

function renderCommon(lines: string[], server: NormalizedCodexMcpServer): void {
  if (server.enabled !== undefined) lines.push(`enabled = ${server.enabled}`);
  if (server.required !== undefined) lines.push(`required = ${server.required}`);
  if (server.enabledTools !== undefined) lines.push(`enabled_tools = ${encodeCodexTomlStringArray(server.enabledTools)}`);
  if (server.disabledTools !== undefined) lines.push(`disabled_tools = ${encodeCodexTomlStringArray(server.disabledTools)}`);
  if (server.startupTimeoutSec !== undefined) lines.push(`startup_timeout_sec = ${server.startupTimeoutSec}`);
  if (server.toolTimeoutSec !== undefined) lines.push(`tool_timeout_sec = ${server.toolTimeoutSec}`);
}

function renderCodexMcpServer(server: NormalizedCodexMcpServer): string[] {
  const serverKey = server.schema === "project"
    ? encodeCodexTomlString(server.name) : encodeCodexTomlKey(server.name);
  const root = `mcp_servers.${serverKey}`;
  const lines = [`[${root}]`];
  if (server.transport === "stdio") {
    lines.push(`command = ${encodeCodexTomlString(server.command)}`);
    if (server.emitArgs) lines.push(`args = ${encodeCodexTomlStringArray(server.args)}`);
    if (server.cwd !== undefined) lines.push(`cwd = ${encodeCodexTomlString(server.cwd)}`);
    if (server.emitEnvVars) lines.push(`env_vars = ${encodeCodexTomlStringArray(server.envVars)}`);
    renderCommon(lines, server);
    lines.push(...renderCodexTomlStringTable(
      `${root}.env`, server.literalEnv, server.schema === "project",
    ));
    return lines;
  }
  lines.push(`url = ${encodeCodexTomlString(server.url)}`);
  if (server.bearerTokenEnvVar) lines.push(`bearer_token_env_var = ${encodeCodexTomlString(server.bearerTokenEnvVar)}`);
  renderCommon(lines, server);
  lines.push(...renderCodexTomlStringTable(
    `${root}.http_headers`, server.httpHeaders, server.schema === "project",
  ));
  if (server.schema === "custom-agent") {
    for (const [header, envName] of Object.entries(server.envHttpHeaders).sort(([a], [b]) => compareCodeUnits(a, b))) {
      lines.push(`env_http_headers.${encodeCodexTomlKey(header)} = ${encodeCodexTomlString(envName)}`);
    }
  } else {
    lines.push(...renderCodexTomlStringTable(`${root}.env_http_headers`, server.envHttpHeaders, true));
  }
  return lines;
}

export function renderCodexMcpServers(
  servers: Readonly<Record<string, CodexMcpInput>>,
  schema: CodexMcpSchema,
): { body: string; names: string[] } {
  const names = Object.keys(servers).sort(compareCodeUnits);
  const sections = names.map((name) =>
    renderCodexMcpServer(normalizeCodexMcpServer(name, servers[name]!, schema)).join("\n")
  );
  return { body: sections.join("\n\n"), names };
}
