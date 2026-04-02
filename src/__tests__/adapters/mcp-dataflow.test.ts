import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest, Tool } from "../../types.js";

// Adapters that support MCP (from capability matrix in index.ts)
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { WindsurfAdapter } from "../../adapters/windsurf.js";
import { ClineAdapter } from "../../adapters/cline.js";
import { AmpAdapter } from "../../adapters/amp.js";
import { CodexAdapter } from "../../adapters/codex.js";
import { GeminiAdapter } from "../../adapters/gemini.js";
import { OpenCodeAdapter } from "../../adapters/opencode.js";
import { KiroAdapter } from "../../adapters/kiro.js";
import { AmazonQAdapter } from "../../adapters/amazonq.js";
import { AntigravityAdapter } from "../../adapters/antigravity.js";
import { GooseAdapter } from "../../adapters/goose.js";

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
  adapter: ClaudeAdapter | CursorAdapter | CopilotAdapter | WindsurfAdapter
    | ClineAdapter | AmpAdapter | CodexAdapter | GeminiAdapter
    | OpenCodeAdapter | KiroAdapter | AmazonQAdapter | AntigravityAdapter | GooseAdapter;
  mcpOutputPath: string | ((outputs: { path: string; content: string }[]) => { path: string; content: string } | undefined);
}

const JSON_ADAPTERS: AdapterTestCase[] = [
  { name: "Claude", tool: "claude", adapter: new ClaudeAdapter(), mcpOutputPath: ".mcp.json" },
  { name: "Cursor", tool: "cursor", adapter: new CursorAdapter(), mcpOutputPath: ".cursor/mcp.json" },
  { name: "Windsurf", tool: "windsurf", adapter: new WindsurfAdapter(), mcpOutputPath: ".windsurf/mcp.json" },
  { name: "Cline", tool: "cline", adapter: new ClineAdapter(), mcpOutputPath: ".roo/mcp.json" },
  { name: "Amp", tool: "amp", adapter: new AmpAdapter(), mcpOutputPath: ".amp/settings.json" },
  { name: "Gemini", tool: "gemini", adapter: new GeminiAdapter(), mcpOutputPath: ".gemini/settings.json" },
  { name: "Kiro", tool: "kiro", adapter: new KiroAdapter(), mcpOutputPath: ".kiro/settings/mcp.json" },
  { name: "AmazonQ", tool: "amazon-q", adapter: new AmazonQAdapter(), mcpOutputPath: ".amazonq/mcp.json" },
  { name: "Antigravity", tool: "antigravity", adapter: new AntigravityAdapter(), mcpOutputPath: ".antigravity/settings.json" },
  { name: "OpenCode", tool: "opencode", adapter: new OpenCodeAdapter(), mcpOutputPath: "opencode.json" },
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
      } else if (name === "Amp") {
        authServer = parsed["amp.mcpServers"]?.["auth-server"];
      } else if (name === "Gemini") {
        authServer = parsed.mcpServers?.["auth-server"];
      } else if (name === "OpenCode") {
        authServer = parsed.mcp?.["auth-server"];
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

  it("Codex adapter includes headers in TOML output", async () => {
    const codex = new CodexAdapter();
    const manifest = makeManifest("codex");
    const outputs = await codex.generate(agentsDir, manifest);

    const config = outputs.find((o) => o.path === ".codex/config.toml");
    expect(config).toBeDefined();
    expect(config!.content).toContain("headers.X-Custom");
    expect(config!.content).toContain("static-value");
    expect(config!.content).toContain("headers.Authorization");
  });

  it("Goose adapter includes headers in extensions", async () => {
    const goose = new GooseAdapter();
    const manifest = makeManifest("goose");
    const outputs = await goose.generate(agentsDir, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    expect(profile!.content).toContain("headers");
    expect(profile!.content).toContain("X-Custom");
    expect(profile!.content).toContain("static-value");
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

  it("Codex adapter transforms ${env:VAR} in TOML env values", async () => {
    const codex = new CodexAdapter();
    const manifest = makeManifest("codex");
    const outputs = await codex.generate(agentsDir, manifest);

    const config = outputs.find((o) => o.path === ".codex/config.toml");
    expect(config).toBeDefined();

    // Should not contain raw ${env:VAR} syntax
    expect(config!.content).not.toContain("${env:");
    // Should contain transformed env var reference
    expect(config!.content).toContain("$SECRET_KEY");
  });

  it("Goose adapter does not leak ${env:VAR} in YAML output", async () => {
    const goose = new GooseAdapter();
    const manifest = makeManifest("goose");
    const outputs = await goose.generate(agentsDir, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();

    // Goose uses env_keys (just key names), so env values shouldn't appear
    // But headers should be transformed
    expect(profile!.content).not.toContain("${env:");
  });

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
