import { describe, expect, it } from "vitest";
import {
  renderCodexMcpServers,
  type CodexAgentMcpServer,
  type CodexMcpEntry,
} from "../../adapters/codexMcp.js";
import { parseCodexTomlDocument } from "../../adapters/codexTomlCodec.js";

interface ParsedMcp {
  mcp_servers: Record<string, Record<string, unknown>>;
}

function parseProjectMcp(content: string): ParsedMcp {
  return parseCodexTomlDocument(content, {
    schema: "project",
    source: "generated MCP test document",
  }) as unknown as ParsedMcp;
}

describe("Codex normalized MCP model", () => {
  it("renders matching stdio transport fields across project and custom-agent schemas", () => {
    const project: Record<string, CodexMcpEntry> = {
      docs: {
        command: "npx",
        args: ["-y", "@scope/docs@1.2.3"],
        cwd: "tools/mcp",
        env: { DOCS_TOKEN: "${env:DOCS_TOKEN}" },
      },
    };
    const agent: Record<string, CodexAgentMcpServer> = {
      docs: {
        command: "npx",
        args: ["-y", "@scope/docs@1.2.3"],
        cwd: "tools/mcp",
        envVars: ["DOCS_TOKEN"],
      },
    };

    const projectServer = parseProjectMcp(renderCodexMcpServers(project, "project").body)
      .mcp_servers.docs;
    const agentServer = parseProjectMcp(renderCodexMcpServers(agent, "custom-agent").body)
      .mcp_servers.docs;
    expect(agentServer).toMatchObject(projectServer);
  });

  it("renders matching HTTP indirection across project and custom-agent schemas", () => {
    const project = renderCodexMcpServers({
      remote: {
        url: "https://example.test/mcp",
        headers: {
          Authorization: "Bearer ${env:MCP_TOKEN}",
          "X-Tenant": "${env:TENANT_ID}",
        },
      },
    } satisfies Record<string, CodexMcpEntry>, "project");
    const agent = renderCodexMcpServers({
      remote: {
        url: "https://example.test/mcp",
        bearerTokenEnvVar: "MCP_TOKEN",
        envHttpHeaders: { "X-Tenant": "TENANT_ID" },
      },
    } satisfies Record<string, CodexAgentMcpServer>, "custom-agent");

    expect(parseProjectMcp(agent.body).mcp_servers.remote).toMatchObject(
      parseProjectMcp(project.body).mcp_servers.remote,
    );
  });

  it.each(["project", "custom-agent"] as const)(
    "rejects unknown %s MCP fields instead of dropping them",
    (schema) => {
      const input = { docs: { command: "tool", literalSecret: "ignored-before" } };
      expect(() => renderCodexMcpServers(input, schema)).toThrow(/unsupported field literalSecret/);
    },
  );

  it("retains deny-by-default credential rejection in both schemas", () => {
    const encoded = encodeURIComponent(encodeURIComponent("--token=literal-credential"));
    expect(() => renderCodexMcpServers(
      { bad: { command: "tool", args: [encoded] } },
      "project",
    )).toThrow(/credential through command arguments/);
    expect(() => renderCodexMcpServers(
      { bad: { command: "tool", args: [encoded] } },
      "custom-agent",
    )).toThrow(/credential through command arguments/);
  });
});

describe("Codex TOML schema codec", () => {
  it("keeps project config extensible but rejects custom-agent root drift", () => {
    expect(parseCodexTomlDocument('future_project_key = "preserved"\n', {
      schema: "project",
      source: ".codex/config.toml",
    })).toHaveProperty("future_project_key", "preserved");
    expect(() => parseCodexTomlDocument([
      'name = "hatch3r-test"',
      'description = "test"',
      'developer_instructions = "test"',
      'future_agent_key = "unsafe"',
    ].join("\n"), {
      schema: "custom-agent",
      source: ".codex/agents/hatch3r-test.toml",
    })).toThrow(/unsupported custom-agent field/);
  });

  it("requires the documented custom-agent identity fields", () => {
    expect(() => parseCodexTomlDocument('name = "hatch3r-test"\n', {
      schema: "custom-agent",
      source: ".codex/agents/hatch3r-test.toml",
    })).toThrow(/requires a non-empty description/);
  });
});
