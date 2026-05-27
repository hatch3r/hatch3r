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

// MCP config fixture with headers and ${env:VAR} references.
// F15.5-H2: the HTTP `auth-server` carries `_trust_bypass: true` so it survives
// the readFilteredMcp pin gate (this suite exercises header/env-var forwarding,
// not the pin policy); the marker is stripped on emission.
const MCP_CONFIG_WITH_HEADERS = {
  mcpServers: {
    "auth-server": {
      _trust_bypass: true,
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

  // Copilot transforms ${env:VAR} → $VAR (shell format).
  // Cursor preserves ${env:VAR} (passthrough) because Cursor's MCP runtime
  // interprets only ${env:NAME} / ${userHome} / ${workspaceFolder} — shell
  // $VAR is treated as a literal string (cursor.com/docs/context/mcp
  // accessed 2026-05-27). See D11-C-1 (Cycle 10, Pillar P6).
  const copilotAdapter = JSON_ADAPTERS.find((a) => a.name === "Copilot")!;
  it(`Copilot adapter transforms \${env:VAR} to shell format ($VAR)`, async () => {
    const manifest = makeManifest(copilotAdapter.tool);
    const outputs = await copilotAdapter.adapter.generate(agentsDir, manifest);

    let mcpOutput: { path: string; content: string } | undefined;
    if (typeof copilotAdapter.mcpOutputPath === "function") {
      mcpOutput = copilotAdapter.mcpOutputPath(outputs);
    } else {
      mcpOutput = outputs.find((o) => o.path === copilotAdapter.mcpOutputPath);
    }
    expect(mcpOutput).toBeDefined();

    // No raw ${env:VAR} syntax should remain in the output
    expect(mcpOutput!.content).not.toContain("${env:");
  });

  // D11-C-1 regression test: Cursor MUST preserve literal ${env:NAME}.
  // Cursor's MCP runtime parses only ${env:NAME}, ${userHome},
  // ${workspaceFolder} (cursor.com/docs/context/mcp accessed 2026-05-27);
  // emitting $VAR (shell) was silently breaking secret-bearing MCP servers.
  it("Cursor adapter preserves literal ${env:NAME} (no shell transform)", async () => {
    const cursorAdapter = JSON_ADAPTERS.find((a) => a.name === "Cursor")!;
    const manifest = makeManifest(cursorAdapter.tool);
    const outputs = await cursorAdapter.adapter.generate(agentsDir, manifest);

    const mcpOutput = outputs.find((o) => o.path === cursorAdapter.mcpOutputPath);
    expect(mcpOutput).toBeDefined();

    // Cursor's required runtime syntax — literal ${env:NAME} must survive.
    expect(mcpOutput!.content).toContain("${env:");

    const parsed = JSON.parse(mcpOutput!.content);
    expect(parsed.mcpServers["auth-server"].headers.Authorization)
      .toBe("Bearer ${env:API_TOKEN}");
    expect(parsed.mcpServers["cmd-server"].env.SECRET_KEY)
      .toBe("${env:SECRET_KEY}");
    expect(parsed.mcpServers["cmd-server"].headers["X-Trace"])
      .toBe("${env:TRACE_ID}");

    // Shell-style $VAR (without braces, no `env:` prefix) MUST NOT appear —
    // that was the broken pre-fix behaviour.
    expect(mcpOutput!.content).not.toMatch(/"Bearer \$[A-Z_]+"/);
    expect(mcpOutput!.content).not.toMatch(/":\s*"\$[A-Z_]+"/);
  });

  // D11-C-2 (Cycle 10, Pillar P6): Copilot's STDIO MCP servers no longer
  // ship their secrets via the `env` object — VS Code's MCP loader does
  // not perform shell expansion, so the prior `$VAR` form was a literal
  // string. STDIO secrets now route through `envFile`
  // (`${workspaceFolder}/.env.mcp`) per
  // https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
  // (accessed 2026-05-27). HTTP-transport entries continue to ship
  // header secrets as `$VAR` (preserved pending a follow-up that wires
  // `${input:NAME}` + `inputs[]` for the HTTP path).
  it("Copilot adapter routes STDIO secrets through envFile and HTTP secrets through headers", async () => {
    const copilot = new CopilotAdapter();
    const manifest = makeManifest("copilot");
    const outputs = await copilot.generate(agentsDir, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);

    // STDIO server: env object dropped, envFile points at hatch3r-managed .env.mcp.
    expect(parsed.servers["cmd-server"].type).toBe("stdio");
    expect(parsed.servers["cmd-server"].env).toBeUndefined();
    expect(parsed.servers["cmd-server"].envFile).toBe("${workspaceFolder}/.env.mcp");

    // HTTP server: headers still ship the secret via shell-style $VAR
    // (out-of-scope for D11-C-2; documented as a follow-up).
    expect(parsed.servers["auth-server"].type).toBe("http");
    expect(parsed.servers["auth-server"].headers.Authorization).toBe("Bearer $API_TOKEN");

    // No raw ${env:VAR} survives on either transport (the original
    // canonical-syntax markers are fully transformed).
    expect(mcp!.content).not.toContain("${env:");
  });
});
