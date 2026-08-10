import { describe, expect, it } from "vitest";
import {
  buildCodexConfigOutput,
  preflightAndBuildCodexConfig,
  projectCodexMcpServers,
} from "../../adapters/codexConfig.js";
import {
  mergeCodexTomlManagedRegion,
  parseCodexToml,
  preflightCodexToml,
  removeCodexTomlManagedRegion,
} from "../../adapters/codexToml.js";
import type { CleanMcpEntry } from "../../adapters/base.js";
import { insertManagedBlock, wrapManagedFor } from "../../merge/managedBlocks.js";

function encodeLayers(value: string, depth: number): string {
  let encoded = value;
  for (let index = 0; index < depth; index += 1) encoded = encodeURIComponent(encoded);
  return encoded;
}

describe("Codex MCP config projection", () => {
  it("emits deterministic stdio and Streamable HTTP TOML with env indirection", () => {
    const projection = projectCodexMcpServers({
      github: {
        url: "https://api.example.test/mcp",
        headers: {
          Authorization: "Bearer ${env:GITHUB_PAT}",
          "X-MCP-Toolsets": "repos,issues",
          "X-Tenant": "${env:MCP_TENANT}",
        },
      },
      brave: {
        command: "npx",
        args: ["-y", "@brave/mcp@1.0.0"],
        cwd: "tools/mcp",
        env: { BRAVE_API_KEY: "${env:BRAVE_API_KEY}", MODE: "readonly" },
      },
    });

    expect(projection.serverNames).toEqual(["brave", "github"]);
    const parsed = parseCodexToml(projection.managedBody) as unknown as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.mcp_servers.brave).toMatchObject({
      command: "npx",
      args: ["-y", "@brave/mcp@1.0.0"],
      cwd: "tools/mcp",
      env_vars: ["BRAVE_API_KEY"],
      env: { MODE: "readonly" },
    });
    expect(parsed.mcp_servers.github).toMatchObject({
      url: "https://api.example.test/mcp",
      bearer_token_env_var: "GITHUB_PAT",
      http_headers: { "X-MCP-Toolsets": "repos,issues" },
      env_http_headers: { "X-Tenant": "MCP_TENANT" },
    });
  });

  it.each([
    [{ bad: { url: "https://example.test/sse" } }, "SSE"],
    [{ bad: { url: "https://example.test/mcp?token=literal" } }, "credential"],
    [{ bad: { url: "https://example.test/mcp?auth=literal" } }, "credential"],
    [{ bad: { url: "https://example.test/mcp?%252574%25256f%25256b%252565%25256e=literal" } }, "credential"],
    [{ bad: { url: "https://user:password@example.test/mcp" } }, "credential"],
    [{ bad: { command: "sh", args: ["-c", "echo x | curl example.test"] } }, "shell interpolation"],
    [{ bad: { command: "https://user:pass@example.test/tool" } }, "URI userinfo"],
    [{ bad: { command: "tool", args: ["--endpoint=https://user:pass@example.test/mcp"] } }, "URI userinfo"],
    [{ bad: { command: "tool", args: ["https://user%40tenant:pass@example.test/mcp"] } }, "URI userinfo"],
    [{ bad: { command: "tool", args: ["https://user%3Apass%40example.test/mcp"] } }, "URI userinfo"],
    [{ bad: { command: "tool", args: ["https%3A%2F%2Fuser%3Apass%40example.test%2Fmcp"] } }, "URI userinfo"],
    [{ bad: { command: "tool", cwd: "https://user:pass@example.test/work" } }, "URI userinfo"],
    [{ bad: { command: "tool", env: { API_KEY: "secret=abcdefgh" } } }, "requires environment-variable indirection"],
    [{ bad: { command: "tool", env: { ACCESS_TOKEN: "development" } } }, "requires environment-variable indirection"],
    [{ bad: { command: "tool", env: { AWS_ACCESS_KEY_ID: "plain-looking-value" } } }, "requires environment-variable indirection"],
    [{ bad: { command: "tool", env: { PASSWORD_HINT: "not-a-password" } } }, "requires environment-variable indirection"],
    [{ bad: { command: "tool", env: { KEY_MATERIAL: "plain-looking-value" } } }, "requires environment-variable indirection"],
    [{ bad: { command: "tool", env: { MODE: "-----BEGIN PRIVATE KEY-----" } } }, "literal secret"],
    [{ bad: { command: "tool", env: { CUSTOM_SETTING: "enabled" } } }, "not an allowed non-secret literal"],
    [{ bad: { command: "tool", env: { TOKEN: "${env:OTHER_TOKEN}" } } }, "different variable"],
    [{ bad: { command: "tool", args: ["--token=plain-looking-value"] } }, "credential through command arguments"],
    [{ bad: { command: "tool", cwd: "tools/${env:ROOT}" } }, "shell interpolation"],
    [{ bad: { url: "https://example.test/mcp", cwd: "tools/mcp" } }, "cannot define a process cwd"],
    [{ bad: { url: "https://example.test/mcp", headers: { "X-Access-Token": "plain-looking-value" } } }, "requires environment-variable indirection"],
    [{ bad: { url: "https://example.test/mcp", headers: { "X-AWS-Access-Key": "plain-looking-value" } } }, "requires environment-variable indirection"],
    [{ bad: { url: "https://example.test/mcp", headers: { "X-Custom": "plain-looking-value" } } }, "not an allowed non-secret literal"],
    [{ bad: { url: "https://example.test/mcp", headers: { "X-MCP-Toolsets": "-----BEGIN PRIVATE KEY-----" } } }, "literal secret"],
  ] as const)("fails closed for unsafe server %#", (servers, message) => {
    expect(() => projectCodexMcpServers(servers as unknown as Record<string, CleanMcpEntry>)).toThrow(message);
  });

  it("accepts only bounded non-secret literal environment and header semantics", () => {
    const projection = projectCodexMcpServers({
      safe: {
        command: "tool",
        env: {
          DEBUG: "false",
          HOST: "127.0.0.1",
          LOG_LEVEL: "info",
          MODE: "readonly",
          PORT: "65535",
          TRANSPORT: "stdio",
        },
      },
      http: {
        url: "https://example.test/mcp",
        headers: {
          Accept: "application/json",
          "X-Api-Version": "2026-08-09",
          "X-Tenant": "${env:TENANT_ID}",
        },
      },
    });
    const parsed = parseCodexToml(projection.managedBody) as unknown as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.mcp_servers.safe.env).toMatchObject({ MODE: "readonly", PORT: "65535" });
    expect(parsed.mcp_servers.http).toMatchObject({
      http_headers: { Accept: "application/json", "X-Api-Version": "2026-08-09" },
      env_http_headers: { "X-Tenant": "TENANT_ID" },
    });

    expect(() => projectCodexMcpServers({
      badPort: { command: "tool", env: { PORT: "65536" } },
    })).toThrow("not an allowed non-secret literal");
  });

  it("does not treat package scopes, email-like args, or URL path @ signs as URI userinfo", () => {
    expect(() => projectCodexMcpServers({
      safe: {
        command: "npx",
        args: [
          "-y",
          "@scope/mcp-server@1.2.3",
          "--contact=ops@example.test",
          "--endpoint=https://example.test/@scope/package",
          "git+ssh://example.test/repository@v1",
        ],
      },
    })).not.toThrow();
  });

  it.each([
    [encodeLayers("https://user:password@example.test/mcp", 3), "URI userinfo"],
    [encodeLayers("--token=plain-looking-value", 4), "credential through command arguments"],
    [encodeLayers("secret=abcdefgh", 5), "literal secret"],
    [encodeLayers("${TOKEN}", 3), "shell interpolation"],
  ])("rejects nested percent-encoded process payload %#", (payload, message) => {
    expect(() => projectCodexMcpServers({
      bad: { command: "tool", args: [payload] },
    })).toThrow(message);
  });

  it("fails closed when percent encoding is still changing at the safety bound", () => {
    expect(() => projectCodexMcpServers({
      bad: { command: "tool", args: [encodeLayers("tools/mcp", 9)] },
    })).toThrow("safe percent-decoding depth");
  });

  it("permits encoded benign URL-path @ signs without treating them as userinfo", () => {
    expect(() => projectCodexMcpServers({
      safe: {
        command: "tool",
        args: [encodeLayers("--endpoint=https://example.test/@scope/package", 3)],
      },
    })).not.toThrow();
  });

  it("rejects a user-owned MCP table collision before returning output", () => {
    const preflight = preflightCodexToml('[mcp_servers."github"]\ncommand = "user-tool"\n');
    expect(() =>
      buildCodexConfigOutput(preflight, { github: { command: "npx", args: [] } }),
    ).toThrow("user-owned MCP server");
  });

  it("returns a hash-comment managed output whose exact merge parses", () => {
    const existing = '# user comment — Grüße\nmodel = "gpt-5"\n';
    const output = preflightAndBuildCodexConfig(existing, {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
    });
    expect(output?.path).toBe(".codex/config.toml");
    expect(output?.content.startsWith("# HATCH3R:BEGIN\n")).toBe(true);
    expect(() => mergeCodexTomlManagedRegion(existing, output!.managedContent!)).not.toThrow();
  });
});

describe("Codex TOML managed region", () => {
  it("preserves CRLF user bytes and is idempotent", () => {
    const existing = '# Nutzer: Ångström\r\nmodel = "gpt-5"\r\n';
    const first = mergeCodexTomlManagedRegion(existing, '[mcp_servers."x"]\ncommand = "tool"');
    const second = mergeCodexTomlManagedRegion(first, '[mcp_servers."x"]\ncommand = "tool"');
    expect(second).toBe(first);
    expect(first).toContain('# Nutzer: Ångström\r\nmodel = "gpt-5"\r\n');
    expect(first).toContain("# HATCH3R:BEGIN\r\n");
    expect(removeCodexTomlManagedRegion(first)).toBe(existing);
  });

  it.each([
    ['model = "unterminated\n', "malformed TOML"],
    ["# HATCH3R:BEGIN\nmodel = \"x\"\n", "broken or duplicate"],
    ["# HATCH3R:END\n# HATCH3R:BEGIN\n", "broken or duplicate"],
    ["# HATCH3R:BEGIN\n# HATCH3R:BEGIN\n# HATCH3R:END\n", "broken or duplicate"],
  ])("rejects malformed or corrupt existing config %#", (content, message) => {
    expect(() => preflightCodexToml(content)).toThrow(message);
  });

  it("does not treat inline marker prose as a managed region", () => {
    const content = 'note = "mention # HATCH3R:BEGIN safely"\n';
    expect(preflightCodexToml(content).hasManagedRegion).toBe(false);
  });

  it("uses TOML comment markers through the shared merge layer", () => {
    const initial = wrapManagedFor(".codex/config.toml", 'model = "one"');
    expect(initial).toBe('# HATCH3R:BEGIN\nmodel = "one"\n# HATCH3R:END\n');
    const updated = insertManagedBlock(initial, 'model = "two"', ".codex/config.toml");
    expect(updated).toContain('model = "two"');
    expect(() => parseCodexToml(updated)).not.toThrow();
  });

  it("removes the shared writer's byte-zero splice without retaining generated separators", () => {
    const user = '# user TOML\nmodel = "gpt-5"\n';
    const managed = wrapManagedFor(".codex/config.toml", '[mcp_servers."managed"]\ncommand = "tool"');
    expect(removeCodexTomlManagedRegion(`${managed.trim()}\n\n${user}`)).toBe(user);
  });
});
