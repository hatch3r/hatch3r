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

  // D11-7 (Cycle 11, P6/CQ4): Copilot leaves NO `${env:VAR}` in `.vscode/mcp.json`.
  // STDIO `env` is dropped in favour of the `.env.mcp` envFile loader; header
  // `${env:NAME}` is rewritten to the VS Code `${input:NAME}` form (with a
  // matching top-level `inputs[]` entry). Cursor preserves `${env:VAR}`
  // (passthrough) because Cursor's MCP runtime interprets only
  // `${env:NAME}` / `${userHome}` / `${workspaceFolder}` (cursor.com/docs/
  // context/mcp accessed 2026-05-27). See D11-C-1 (Cycle 10, Pillar P6).
  const copilotAdapter = JSON_ADAPTERS.find((a) => a.name === "Copilot")!;
  it("Copilot adapter emits no raw ${env:VAR} and rewrites header secrets to ${input:NAME}", async () => {
    const manifest = makeManifest(copilotAdapter.tool);
    const outputs = await copilotAdapter.adapter.generate(agentsDir, manifest);

    let mcpOutput: { path: string; content: string } | undefined;
    if (typeof copilotAdapter.mcpOutputPath === "function") {
      mcpOutput = copilotAdapter.mcpOutputPath(outputs);
    } else {
      mcpOutput = outputs.find((o) => o.path === copilotAdapter.mcpOutputPath);
    }
    expect(mcpOutput).toBeDefined();

    // No raw ${env:VAR} syntax should remain in the output.
    expect(mcpOutput!.content).not.toContain("${env:");
    // Header secrets become VS Code ${input:NAME} references, NOT shell $VAR.
    expect(mcpOutput!.content).toContain("${input:");
    expect(mcpOutput!.content).not.toMatch(/"Bearer \$[A-Z_]+"/);
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

  // D11-C-2 (Cycle 10, Pillar P6) + D11-7 (Cycle 11, P6/CQ4): Copilot's STDIO
  // MCP servers route their `env` secrets through the `envFile` loader
  // (`${workspaceFolder}/.env.mcp`) — VS Code does not shell-expand the `env`
  // object. Header secrets (on either transport) are rewritten to VS Code's
  // `${input:NAME}` form with a matching top-level `inputs[]` entry, because
  // VS Code also does not shell-expand `$VAR` inside header values; the only
  // header-secret substitution it performs is `${input:NAME}` prompting.
  // STDIO schema per
  // https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
  // (accessed 2026-05-27); input-variable schema per
  // https://code.visualstudio.com/docs/agents/reference/mcp-configuration
  // (input-variables-for-sensitive-data, accessed 2026-06-05).
  it("Copilot adapter routes STDIO env through envFile and header secrets through ${input:NAME} + inputs[]", async () => {
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
    // STDIO header secret is rewritten to the VS Code ${input:NAME} form too.
    expect(parsed.servers["cmd-server"].headers["X-Trace"]).toBe("${input:TRACE_ID}");

    // HTTP server: the auth header now carries a VS Code ${input:NAME}
    // reference VS Code actually substitutes — NOT the broken `$VAR` literal.
    expect(parsed.servers["auth-server"].type).toBe("http");
    expect(parsed.servers["auth-server"].headers.Authorization).toBe("Bearer ${input:API_TOKEN}");
    // Static (non-secret) headers pass through unchanged and add no input.
    expect(parsed.servers["auth-server"].headers["X-Custom"]).toBe("static-value");

    // Top-level inputs[] declares one promptString-password entry per distinct
    // header secret (deduped). VS Code prompts for these on first use.
    const inputIds = (parsed.inputs as Array<{ id: string; type: string; password: boolean }>)
      .map((i) => i.id)
      .sort();
    expect(inputIds).toEqual(["API_TOKEN", "TRACE_ID"]);
    for (const input of parsed.inputs as Array<{ type: string; password: boolean }>) {
      expect(input.type).toBe("promptString");
      expect(input.password).toBe(true);
    }

    // No raw ${env:VAR} survives anywhere (env dropped, headers rewritten).
    expect(mcp!.content).not.toContain("${env:");
    // No broken shell `$VAR` header literal survives either.
    expect(mcp!.content).not.toMatch(/"Bearer \$[A-Z_]+"/);
  });
});
