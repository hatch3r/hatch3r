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
import {
  MCP_ENV_VAR_FORMAT_PARITY,
  transformEnvVarSyntax,
} from "../../adapters/mcp-utils.js";

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
    // W3-mcp-optin: DEFAULT_FEATURES.mcp is now false (opt-in). This suite
    // exercises MCP emission dataflow, so pin the feature on explicitly.
    features: { mcp: true },
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

/**
 * D2-14 (Cycle 11 Wave 3, D2, P2): the REAL env-var-format parity gate.
 *
 * The in-file table check in `mcp-utils.test.ts` ("MCP_ENV_VAR_FORMAT_PARITY
 * (table-internal consistency)") only verifies the table is shaped correctly —
 * looping each row through `transformEnvVarSyntax(canonical, row.format)` is a
 * tautology that re-derives the row's output from the row's own `format` field
 * and never reads an adapter call site. So a call site emitting the WRONG
 * format (the D11-C-2 class of bug: `$VAR` to a consumer that does not shell-
 * expand) tripped no gate.
 *
 * This suite closes that gap: for every {@link MCP_ENV_VAR_FORMAT_PARITY} row
 * it runs the OWNING adapter's `generate()` against the `${env:VAR}` fixture and
 * asserts the substitution the row declares actually lands in the emitted client
 * config — honoring `viaEnvFile` (copilot STDIO env routed to `.env.mcp`, so the
 * `env` object is dropped rather than substituted) and `viaInputs` (copilot
 * header secrets rewritten to VS Code `${input:NAME}` + a top-level `inputs[]`
 * entry). A call site that drifts from its row, or a row that drifts from its
 * call site, breaks this test rather than shipping unsubstituted placeholders.
 *
 * Surface → fixture field driven:
 *   - mcp-env     → `cmd-server.env.SECRET_KEY` (canonical `${env:SECRET_KEY}`)
 *   - mcp-headers → `auth-server.headers.Authorization`
 *                   (canonical `Bearer ${env:API_TOKEN}`)
 */
describe("MCP_ENV_VAR_FORMAT_PARITY adapter cross-check (D2-14)", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcp-parity-"));
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

  const adapterByName: Record<
    "claude" | "cursor" | "copilot",
    AdapterTestCase
  > = {
    claude: JSON_ADAPTERS.find((a) => a.tool === "claude")!,
    cursor: JSON_ADAPTERS.find((a) => a.tool === "cursor")!,
    copilot: JSON_ADAPTERS.find((a) => a.tool === "copilot")!,
  };

  // Read the server map for an adapter's emitted MCP file. Copilot keys servers
  // under `servers` (VS Code format); claude + cursor under `mcpServers`.
  async function emitServers(
    tc: AdapterTestCase,
  ): Promise<{ doc: Record<string, unknown>; servers: Record<string, Record<string, unknown>> }> {
    const manifest = makeManifest(tc.tool);
    const outputs = await tc.adapter.generate(agentsDir, manifest);
    const mcpOutput =
      typeof tc.mcpOutputPath === "function"
        ? tc.mcpOutputPath(outputs)
        : outputs.find((o) => o.path === tc.mcpOutputPath);
    expect(mcpOutput, `${tc.name}: no MCP output emitted`).toBeDefined();
    const doc = JSON.parse(mcpOutput!.content) as Record<string, unknown>;
    const servers = (tc.name === "Copilot" ? doc.servers : doc.mcpServers) as Record<
      string,
      Record<string, unknown>
    >;
    expect(servers, `${tc.name}: no server map in emitted MCP doc`).toBeDefined();
    return { doc, servers };
  }

  for (const row of MCP_ENV_VAR_FORMAT_PARITY) {
    const label = `${row.adapter}:${row.surface} (format=${row.format})`;

    it(`${label} — emitted output matches the declared substitution`, async () => {
      const tc = adapterByName[row.adapter];
      const { doc, servers } = await emitServers(tc);

      if (row.surface === "mcp-env") {
        const env = servers["cmd-server"]?.env as
          | Record<string, string>
          | undefined;
        if (row.viaEnvFile) {
          // viaEnvFile contract: the `env` object is NOT substituted in-line —
          // it is dropped and the secret is loaded from `.env.mcp`. The row's
          // `format` (shell) deliberately never reaches the VS Code consumer.
          expect(
            env,
            `${label}: viaEnvFile row must drop the inline env object`,
          ).toBeUndefined();
          expect(
            servers["cmd-server"].envFile,
            `${label}: viaEnvFile row must emit an envFile pointer`,
          ).toBe("${workspaceFolder}/.env.mcp");
        } else {
          // Inline-substitution surface: the emitted value MUST equal the
          // canonical `${env:SECRET_KEY}` transformed by the row's declared
          // format. This is what binds the table to the adapter call site —
          // if the adapter passed a different format, the strings differ.
          const expected = transformEnvVarSyntax(
            "${env:SECRET_KEY}",
            row.format,
          );
          expect(env, `${label}: missing cmd-server.env`).toBeDefined();
          expect(env!.SECRET_KEY, `${label}: env substitution mismatch`).toBe(
            expected,
          );
        }
      } else {
        // mcp-headers surface: drive auth-server's Authorization header.
        const headers = servers["auth-server"]?.headers as
          | Record<string, string>
          | undefined;
        expect(headers, `${label}: missing auth-server.headers`).toBeDefined();
        if (row.viaInputs) {
          // viaInputs contract: header secret rewritten to a VS Code
          // ${input:NAME} reference with a matching top-level inputs[] entry —
          // the row's `format` (passthrough) carries the value to the rewrite
          // step untouched, then the adapter swaps env: → input:.
          expect(
            headers!.Authorization,
            `${label}: header secret must become a VS Code input reference`,
          ).toBe("Bearer ${input:API_TOKEN}");
          const inputIds = (
            (doc.inputs as Array<{ id: string }> | undefined) ?? []
          ).map((i) => i.id);
          expect(
            inputIds,
            `${label}: missing inputs[] entry for the header secret`,
          ).toContain("API_TOKEN");
        } else {
          const expected = transformEnvVarSyntax(
            "Bearer ${env:API_TOKEN}",
            row.format,
          );
          expect(
            headers!.Authorization,
            `${label}: header substitution mismatch`,
          ).toBe(expected);
        }
      }
    });
  }
});
