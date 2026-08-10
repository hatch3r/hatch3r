import { HatchError } from "../types.js";

const MAX_PERCENT_DECODE_PASSES = 8;
const PERCENT_BYTE_RE = /%[0-9A-Fa-f]{2}/;
const SECRET_SENSITIVE_NAME_RE =
  /(?:^|[-_])(?:access[-_]?key|api[-_]?key|auth(?:orization)?|bearer|credential|key[-_]?material|pass(?:word|wd)?|pat|private[-_]?key|secret|signing[-_]?key|token)(?:$|[-_])/i;
const PRIVATE_KEY_MATERIAL_RE =
  /-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----|\b(?:private[-_ ]?key|key[-_ ]?material)\s*[=:]/i;
const HIGH_CONFIDENCE_SECRET_RE =
  /(?:\bBearer\s+(?!\$\{env:)[^\s]+|\b(?:api[_-]?key|token|password|secret)\s*[=:]\s*(?!\$\{env:)[^\s,]+|\b(?:gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}))/i;
const SHELL_INTERPOLATION_RE = /[`$;&|<>\r\n\0]/;
const URI_AUTHORITY_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#\s"'<>]+)/g;
const URI_TOKEN_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g;
const CREDENTIAL_ARGUMENT_RE =
  /^--?(?:api[-_]?key|auth|authorization|credential|password|pat|private[-_]?key|secret|token)(?:=|$)/i;

export const CODEX_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CODEX_MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const CODEX_HTTP_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function credentialError(message: string, hint: string): HatchError {
  return new HatchError(message, 1, "VALIDATION_ERROR", hint);
}

function percentDecodedCandidates(value: string, location: string): string[] {
  const candidates = [value];
  let current = value;
  for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
    if (!PERCENT_BYTE_RE.test(current)) return candidates;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      throw credentialError(
        `Codex MCP ${location} contains malformed or ambiguous percent encoding.`,
        "Use a literal non-secret value or environment-variable indirection.",
      );
    }
    if (decoded === current) return candidates;
    candidates.push(decoded);
    current = decoded;
  }
  throw credentialError(
    `Codex MCP ${location} exceeds the safe percent-decoding depth.`,
    "Reduce nested encoding or use environment-variable indirection; deeply encoded values are rejected fail-closed.",
  );
}

function containsUriUserinfo(value: string): boolean {
  URI_AUTHORITY_RE.lastIndex = 0;
  return [...value.matchAll(URI_AUTHORITY_RE)].some((match) => match[1]?.includes("@"));
}

function containsSensitiveUrlQuery(value: string): boolean {
  URI_TOKEN_RE.lastIndex = 0;
  for (const match of value.matchAll(URI_TOKEN_RE)) {
    if (!URL.canParse(match[0])) continue;
    const url = new URL(match[0]);
    if ([...url.searchParams.keys()].some((key) => SECRET_SENSITIVE_NAME_RE.test(key))) {
      return true;
    }
  }
  return false;
}

export function assertNoCodexCredentialMaterial(value: string, location: string): void {
  if (typeof value !== "string") {
    throw credentialError(`Codex MCP ${location} must be a string.`, "Use a string value.");
  }
  for (const candidate of percentDecodedCandidates(value, location)) {
    if (HIGH_CONFIDENCE_SECRET_RE.test(candidate) || PRIVATE_KEY_MATERIAL_RE.test(candidate)) {
      throw credentialError(
        `Codex MCP ${location} contains a literal secret-like credential value.`,
        "Replace the value with environment-variable indirection.",
      );
    }
    if (containsUriUserinfo(candidate)) {
      throw credentialError(
        `Codex MCP ${location} contains credential-bearing URI userinfo.`,
        "Move credentials into environment-variable indirection; URI userinfo is not emitted.",
      );
    }
    if (containsSensitiveUrlQuery(candidate)) {
      throw credentialError(
        `Codex MCP ${location} contains a credential-bearing URL query.`,
        "Move authentication to bearer_token_env_var or env_http_headers.",
      );
    }
  }
}

export function assertSafeCodexProcessToken(value: string, location: string): void {
  const candidates = percentDecodedCandidates(value, location);
  assertNoCodexCredentialMaterial(value, location);
  if (candidates.some((candidate) => SHELL_INTERPOLATION_RE.test(candidate))) {
    throw credentialError(
      `Codex MCP ${location} contains shell interpolation or control characters.`,
      "Use a literal executable/argument token; shell pipelines and variable interpolation are not emitted.",
    );
  }
}

export function assertSafeCodexArgumentVector(
  args: readonly string[],
  location: string,
): void {
  for (const [index, arg] of args.entries()) {
    const candidates = percentDecodedCandidates(arg, `${location} argument ${index}`);
    if (
      candidates.some((candidate) => CREDENTIAL_ARGUMENT_RE.test(candidate)) &&
      (candidates.some((candidate) => candidate.includes("=")) || args[index + 1] !== undefined)
    ) {
      throw credentialError(
        `Codex MCP ${location} passes a credential through command arguments.`,
        "Pass credentials through environment-variable indirection instead.",
      );
    }
    assertSafeCodexProcessToken(arg, `${location} argument ${index}`);
  }
}

export function parseSafeCodexMcpHttpUrl(value: string, location: string): URL {
  assertNoCodexCredentialMaterial(value, location);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw credentialError(`Codex MCP ${location} has an invalid URL.`, "Use an absolute HTTP(S) URL.");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw credentialError(
      `Codex MCP ${location} must use HTTPS (HTTP is accepted only for loopback).`,
      "Use HTTPS or a loopback HTTP endpoint.",
    );
  }
  if (/\bsse\b/i.test(url.pathname) || /(?:^|[?&])transport=sse(?:&|$)/i.test(value)) {
    throw credentialError(
      `Codex MCP ${location} requests the unsupported SSE transport.`,
      "Configure the endpoint for Streamable HTTP instead.",
    );
  }
  return url;
}

export function isCodexCredentialSensitiveName(value: string): boolean {
  return SECRET_SENSITIVE_NAME_RE.test(value);
}
