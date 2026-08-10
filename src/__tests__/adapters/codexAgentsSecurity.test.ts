import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalFile } from "../../types.js";
import {
  serializeCodexAgentToml,
  type CodexAgentMcpServer,
} from "../../adapters/codexAgents.js";
import { filterUserFacing, readCanonicalFiles } from "../../adapters/canonical.js";
import { parseCodexTomlDocument } from "../../adapters/codexTomlCodec.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function encodeLayers(value: string, depth: number): string {
  let encoded = value;
  for (let index = 0; index < depth; index += 1) encoded = encodeURIComponent(encoded);
  return encoded;
}

function agent(): CanonicalFile {
  return {
    id: "hatch3r-reviewer",
    type: "agent",
    frontmatterType: "agent",
    description: "Review risky changes.",
    content: "Review the delegated scope.",
    rawContent: "",
    sourcePath: "/canonical/agents/hatch3r-reviewer.md",
  };
}

function serializeWith(server: CodexAgentMcpServer): string {
  return serializeCodexAgentToml(agent(), {
    agents: { "hatch3r-reviewer": { mcpServers: { tested: server } } },
  });
}

describe("Codex custom-agent MCP security", () => {
  it("serializes documented MCP and skills tables without literal secrets", () => {
    const content = serializeCodexAgentToml(agent(), {
      agents: {
        "hatch3r-reviewer": {
          mcpServers: {
            docs: {
              url: "https://developers.openai.com/mcp",
              bearerTokenEnvVar: "OPENAI_DOCS_TOKEN",
              envHttpHeaders: { "X-Tenant": "TENANT_ID" },
              enabledTools: ["search"],
              startupTimeoutSec: 20,
            },
          },
          skills: [{ path: ".agents/skills/hatch3r-review", enabled: true }],
        },
      },
    });
    const parsed = parseCodexTomlDocument(content, {
      schema: "custom-agent",
      source: "generated agent",
    });
    expect(parsed).toHaveProperty("mcp_servers.docs.url", "https://developers.openai.com/mcp");
    expect(parsed).toHaveProperty("mcp_servers.docs.bearer_token_env_var", "OPENAI_DOCS_TOKEN");
    expect(parsed).toHaveProperty("skills.config.0.path", ".agents/skills/hatch3r-review");
  });

  it("rejects ambiguous transports and traversing skill paths", () => {
    expect(() => serializeWith({ command: "node", url: "https://example.com/mcp" }))
      .toThrow(/exactly one/);
    expect(() => serializeWith({ url: "https://example.com/mcp", args: ["--stdio"] }))
      .toThrow(/stdio-only fields/);
    expect(() => serializeWith({
      url: "https://example.com/mcp",
      bearerTokenEnvVar: "literal token",
    })).toThrow(/environment variable/);
    expect(() => serializeCodexAgentToml(agent(), {
      agents: { "hatch3r-reviewer": { skills: [{ path: "../private/SKILL.md" }] } },
    })).toThrow(/traverse/);
  });

  it.each([
    [{ command: encodeLayers("https://user:password@example.test/tool", 3) }, /URI userinfo/],
    [{ command: "tool", args: [encodeLayers("--token=plain-looking-value", 4)] }, /credential through command arguments/],
    [{ command: "tool", cwd: encodeLayers("-----BEGIN PRIVATE KEY-----", 3) }, /literal secret/],
    [{ command: "tool", args: [encodeLayers("${TOKEN}", 3)] }, /shell interpolation/],
    [{ url: "https://example.test/mcp?%2574%256f%256b%2565%256e=literal" }, /credential-bearing URL query/],
    [{ url: encodeLayers("https://user:password@example.test/mcp", 3) }, /URI userinfo/],
    [{ command: "tool", envVars: ["TOKEN=value"] }, /environment variable name/],
    [{ url: "https://example.test/mcp", envHttpHeaders: { "X-Test\r\nInjected": "SAFE_ENV" } }, /header name/],
    [{ command: "tool", enabledTools: ["secret=abcdefgh"] }, /literal secret/],
    [{ command: "tool", args: [encodeLayers("tools/mcp", 9)] }, /percent-decoding depth/],
    [{ command: "tool", env: { TOKEN: "literal-secret" } }, /unsupported field env/],
    [{ url: "https://example.test/mcp", headers: { Authorization: "Bearer literal-secret" } }, /unsupported field headers/],
    [{ url: "https://example.test/mcp", bearerToken: "literal-secret" }, /unsupported field bearerToken/],
  ] as const)("fails closed for adversarial per-agent MCP input %#", (server, message) => {
    expect(() => serializeWith(server as unknown as CodexAgentMcpServer)).toThrow(message);
  });

  it("keeps benign scopes, emails, and URL path @ signs in stdio arguments", () => {
    expect(() => serializeWith({
      command: "npx",
      args: ["@scope/mcp@1.2.3", "ops@example.test", "https://example.test/@scope/package"],
    })).not.toThrow();
  });

  it("rejects nested credential arguments for every exported canonical agent", async () => {
    const warnings: string[] = [];
    const allAgents = await readCanonicalFiles(REPO_ROOT, "agents", warnings, undefined, { strict: true });
    const agents = filterUserFacing(allAgents, "agent", join(REPO_ROOT, "agents"));
    const attack = encodeLayers("--authorization=literal-credential", 4);
    for (const canonical of agents) {
      expect(() => serializeCodexAgentToml(canonical, {
        agents: {
          [canonical.id]: { mcpServers: { adversarial: { command: "tool", args: [attack] } } },
        },
      }), canonical.id).toThrow("credential through command arguments");
    }
  }, 30_000);
});
