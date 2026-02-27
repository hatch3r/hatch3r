import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectRequiredEnvVars,
  generateEnvMcpContent,
  getSourceEnvMcpCommand,
  parseEnvFile,
  ensureEnvMcp,
} from "../../env/mcpEnv.js";

describe("collectRequiredEnvVars", () => {
  it("returns env vars for servers that require them", () => {
    const vars = collectRequiredEnvVars(["github", "brave-search"]);
    const names = vars.map((v) => v.name);
    expect(names).toContain("GITHUB_PAT");
    expect(names).toContain("BRAVE_API_KEY");
  });

  it("returns empty array for servers with no env requirements", () => {
    const vars = collectRequiredEnvVars(["context7", "filesystem", "playwright"]);
    expect(vars).toHaveLength(0);
  });

  it("deduplicates vars across servers", () => {
    const vars = collectRequiredEnvVars(["github", "github"]);
    const names = vars.filter((v) => v.name === "GITHUB_PAT");
    expect(names).toHaveLength(1);
  });

  it("collects all default server vars", () => {
    const vars = collectRequiredEnvVars([
      "github", "context7", "filesystem", "playwright", "brave-search",
    ]);
    const names = vars.map((v) => v.name);
    expect(names).toContain("GITHUB_PAT");
    expect(names).toContain("BRAVE_API_KEY");
    expect(names).toHaveLength(2);
  });

  it("collects opt-in server vars", () => {
    const vars = collectRequiredEnvVars(["sentry", "postgres", "linear"]);
    const names = vars.map((v) => v.name);
    expect(names).toContain("SENTRY_AUTH_TOKEN");
    expect(names).toContain("POSTGRES_URL");
    expect(names).toContain("LINEAR_API_KEY");
  });
});

describe("generateEnvMcpContent", () => {
  it("generates content with empty placeholders", () => {
    const vars = collectRequiredEnvVars(["github", "brave-search"]);
    const content = generateEnvMcpContent(vars);
    expect(content).toContain("GITHUB_PAT=");
    expect(content).toContain("BRAVE_API_KEY=");
    expect(content).toContain("hatch3r MCP secrets");
  });

  it("includes sourcing disclaimer with POSIX and Windows commands", () => {
    const vars = collectRequiredEnvVars(["github", "brave-search"]);
    const content = generateEnvMcpContent(vars);
    expect(content).toContain("Source this file, then start or restart your editor");
    expect(content).toContain("macOS/Linux (bash/zsh)");
    expect(content).toContain("set -a && source .env.mcp && set +a");
    expect(content).toContain("Windows (PowerShell)");
    expect(content).toContain("Windows (Git Bash)");
  });

  it("preserves existing values", () => {
    const vars = collectRequiredEnvVars(["github", "brave-search"]);
    const content = generateEnvMcpContent(vars, {
      GITHUB_PAT: "ghp_existing_token",
    });
    expect(content).toContain("GITHUB_PAT=ghp_existing_token");
    expect(content).toContain("BRAVE_API_KEY=");
  });

  it("returns empty string when no vars needed", () => {
    const content = generateEnvMcpContent([]);
    expect(content).toBe("");
  });
});

describe("getSourceEnvMcpCommand", () => {
  it("returns POSIX command on non-Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    expect(getSourceEnvMcpCommand()).toBe("set -a && source .env.mcp && set +a");
    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });

  it("returns PowerShell command on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const cmd = getSourceEnvMcpCommand();
    expect(cmd).toContain("Get-Content .env.mcp");
    expect(cmd).toContain("ForEach-Object");
    expect(cmd).not.toContain("cursor");
    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE pairs", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and blank lines", () => {
    const result = parseEnvFile("# comment\n\nFOO=bar\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("handles export prefix", () => {
    const result = parseEnvFile("export FOO=bar\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("handles quoted values", () => {
    const result = parseEnvFile('FOO="bar baz"\nQUX=\'hello\'');
    expect(result).toEqual({ FOO: "bar baz", QUX: "hello" });
  });

  it("handles empty values", () => {
    const result = parseEnvFile("FOO=\nBAR=value\n");
    expect(result).toEqual({ FOO: "", BAR: "value" });
  });
});

describe("ensureEnvMcp", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-env-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates .env.mcp when it does not exist", async () => {
    const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
    expect(result.action).toBe("created");
    expect(result.newVars).toContain("GITHUB_PAT");
    expect(result.newVars).toContain("BRAVE_API_KEY");

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    expect(content).toContain("GITHUB_PAT=");
    expect(content).toContain("BRAVE_API_KEY=");
    expect(content).toContain("Source this file, then start or restart your editor");
  });

  it("preserves existing values when updating", async () => {
    await writeFile(
      join(tempDir, ".env.mcp"),
      "GITHUB_PAT=ghp_existing\n",
      "utf-8",
    );

    const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
    expect(result.action).toBe("updated");
    expect(result.newVars).toEqual(["BRAVE_API_KEY"]);

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    expect(content).toContain("GITHUB_PAT=ghp_existing");
    expect(content).toContain("BRAVE_API_KEY=");
  });

  it("skips when all vars already present", async () => {
    await writeFile(
      join(tempDir, ".env.mcp"),
      "GITHUB_PAT=ghp_token\nBRAVE_API_KEY=key123\n",
      "utf-8",
    );

    const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
    expect(result.action).toBe("skipped");
    expect(result.newVars).toHaveLength(0);
  });

  it("skips when no servers require env vars", async () => {
    const result = await ensureEnvMcp(tempDir, ["context7", "filesystem"]);
    expect(result.action).toBe("skipped");
  });

  it("appends vars for newly added servers", async () => {
    await writeFile(
      join(tempDir, ".env.mcp"),
      "GITHUB_PAT=ghp_token\nBRAVE_API_KEY=key123\n",
      "utf-8",
    );

    const result = await ensureEnvMcp(tempDir, [
      "github", "brave-search", "sentry",
    ]);
    expect(result.action).toBe("updated");
    expect(result.newVars).toEqual(["SENTRY_AUTH_TOKEN"]);

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    expect(content).toContain("GITHUB_PAT=ghp_token");
    expect(content).toContain("BRAVE_API_KEY=key123");
    expect(content).toContain("SENTRY_AUTH_TOKEN=");
  });
});
