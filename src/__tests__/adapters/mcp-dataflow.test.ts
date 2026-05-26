import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest, Tool } from "../../types.js";

// Adapters that support MCP (from capability matrix in index.ts).
// After the 3-adapter pivot, only claude, cursor, copilot remain — all
// support MCP.
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";

/**
 * MCP Data Flow Integration Tests (Findings #21 and #22)
 *
 * #21: Verify that headers from MCP config are forwarded through all adapters.
 * #22: Verify that ${env:VAR} syntax is transformed for non-Claude adapters.
 */

// MCP config fixture with headers and ${env:VAR} references
const MCP_CONFIG_WITH_HEADERS = {
  mcpServers: {
    "auth-server": {
      url: "https://api.example.com/mcp/",
      headers: {
        Authorization: "Bearer ${env:API_TOKEN}",
        "X-Custom": "static-value",
      },
    },
    "cmd-server": {
      command: "npx",
      args: ["-y", "@org/mcp-server"],
      env: {
        SECRET_KEY: "${env:SECRET_KEY}",
      },
      headers: {
        "X-Trace": "${env:TRACE_ID}",
      },
    },
  },
};

interface AdapterTestCase {
  name: string;
  tool: Tool;
  adapter: ClaudeAdapter | CursorAdapter | CopilotAdapter;
  mcpOutputPath: string | ((outputs: { path: string; content: string }[]) => { path: string; content: string } | undefined);
}

// Copilot emits `.vscode/mcp.json` (VS Code format); claude + cursor use the
// canonical `mcpServers` key in their respective files. All three are
// retained adapters after the 3-adapter pivot.
const JSON_ADAPTERS: AdapterTestCase[] = [
  { name: "Claude", tool: "claude", adapter: new ClaudeAdapter(), mcpOutputPath: ".mcp.json" },
  { name: "Cursor", tool: "cursor", adapter: new CursorAdapter(), mcpOutputPath: ".cursor/mcp.json" },
  { name: "Copilot", tool: "copilot", adapter: new CopilotAdapter(), mcpOutputPath: ".vscode/mcp.json" },
];

function makeManifest(tool: Tool): HatchManifest {
  return createManifest({
    tools: [tool],
    mcpServers: ["auth-server", "cmd-server"],
  });
}

describe("MCP header forwarding (#21)", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcp-headers-"));
    agentsDir = join(tempDir, "agents");
    await mkdir(join(agentsDir, "mcp"), { recursive: true });
    await writeFile(
      join(agentsDir, "mcp", "mcp.json"),
      JSON.stringify(MCP_CONFIG_WITH_HEADERS),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  for (const { name, tool, adapter, mcpOutputPath } of JSON_ADAPTERS) {
    it(`${name} adapter forwards headers for URL-based servers`, async () => {
      const manifest = makeManifest(tool);
      const outputs = await adapter.generate(agentsDir, manifest);

      let mcpOutput: { path: string; content: string } | undefined;
      if (typeof mcpOutputPath === "function") {
        mcpOutput = mcpOutputPath(outputs);
      } else {
        mcpOutput = outputs.find((o) => o.path === mcpOutputPath);
      }
      expect(mcpOutput).toBeDefined();

      const parsed = JSON.parse(mcpOutput!.content);

      // Find the auth-server entry in the adapter's output structure
      let authServer: Record<string, unknown> | undefined;

      if (name === "Copilot") {
        authServer = parsed.servers?.["auth-server"];
      } else {
        authServer = parsed.mcpServers?.["auth-server"];
      }

      expect(authServer).toBeDefined();
      const headers = authServer!.headers as Record<string, string> | undefined;
      expect(headers).toBeDefined();
      expect(headers!["X-Custom"]).toBe("static-value");
      // Authorization header should be present (value may be transformed)
      expect(headers!.Authorization).toBeDefined();
      expect(headers!.Authorization).toContain("Bearer");
    });
  }

  it("Copilot adapter uses 'servers' key (VS Code format) with headers", async () => {
    const copilot = new CopilotAdapter();
    const manifest = makeManifest("copilot");
    const outputs = await copilot.generate(agentsDir, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.servers["auth-server"].headers).toBeDefined();
    expect(parsed.servers["auth-server"].headers["X-Custom"]).toBe("static-value");
  });

});

describe("${env:VAR} syntax transformation (#22)", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcp-envvar-"));
    agentsDir = join(tempDir, "agents");
    await mkdir(join(agentsDir, "mcp"), { recursive: true });
    await writeFile(
      join(agentsDir, "mcp", "mcp.json"),
      JSON.stringify(MCP_CONFIG_WITH_HEADERS),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("Claude adapter transforms ${env:VAR} to ${VAR}", async () => {
    const adapter = new ClaudeAdapter();
    const manifest = makeManifest("claude");
    const outputs = await adapter.generate(agentsDir, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);

    // Claude uses ${VAR} syntax
    expect(parsed.mcpServers["auth-server"].headers.Authorization).toBe("Bearer ${API_TOKEN}");
    expect(parsed.mcpServers["cmd-server"].env.SECRET_KEY).toBe("${SECRET_KEY}");
    expect(parsed.mcpServers["cmd-server"].headers["X-Trace"]).toBe("${TRACE_ID}");

    // No ${env:*} syntax should remain
    expect(mcp!.content).not.toContain("${env:");
  });

  // Non-Claude adapters should transform ${env:VAR} to $VAR (shell format)
  const nonClaudeJsonAdapters = JSON_ADAPTERS.filter((a) => a.name !== "Claude");

  for (const { name, tool, adapter, mcpOutputPath } of nonClaudeJsonAdapters) {
    it(`${name} adapter transforms \${env:VAR} to shell format ($VAR)`, async () => {
      const manifest = makeManifest(tool);
      const outputs = await adapter.generate(agentsDir, manifest);

      let mcpOutput: { path: string; content: string } | undefined;
      if (typeof mcpOutputPath === "function") {
        mcpOutput = mcpOutputPath(outputs);
      } else {
        mcpOutput = outputs.find((o) => o.path === mcpOutputPath);
      }
      expect(mcpOutput).toBeDefined();

      // No raw ${env:VAR} syntax should remain in the output
      expect(mcpOutput!.content).not.toContain("${env:");
    });
  }

  it("Copilot adapter transforms env vars in both env and headers", async () => {
    const copilot = new CopilotAdapter();
    const manifest = makeManifest("copilot");
    const outputs = await copilot.generate(agentsDir, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    expect(mcp!.content).not.toContain("${env:");
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.servers["auth-server"].headers.Authorization).toBe("Bearer $API_TOKEN");
    expect(parsed.servers["cmd-server"].env.SECRET_KEY).toBe("$SECRET_KEY");
  });
});
