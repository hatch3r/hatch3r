import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectRequiredEnvVars,
  generateEnvMcpContent,
  getSourceEnvMcpCommand,
  parseEnvFile,
  ensureEnvMcp,
  ensureGitignoreEntry,
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

  // F1.7-H1 (D1, P6): `.env.mcp` is a secret-bearing file. ensureEnvMcp runs
  // `chmod(envPath, 0o600)` after the atomic write so the resulting file is
  // owner-read/write only on POSIX hosts (CWE-552 mitigation, matches
  // ssh-keygen / .netrc conventions). Windows is skipped because Node's
  // chmod has limited semantics there and the call is best-effort
  // (EPERM/ENOTSUP/EINVAL swallowed under --verbose).
  it.skipIf(process.platform === "win32")(
    "writes .env.mcp with mode 0o600 on POSIX (F1.7-H1)",
    async () => {
      const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
      expect(result.action).toBe("created");

      const fileStat = await stat(join(tempDir, ".env.mcp"));
      expect(fileStat.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "re-applies mode 0o600 when adding a new server (F1.7-H1)",
    async () => {
      // First call creates the file at 0o600.
      await ensureEnvMcp(tempDir, ["github"]);
      const before = await stat(join(tempDir, ".env.mcp"));
      expect(before.mode & 0o777).toBe(0o600);

      // Second call triggers the `updated` path through atomicWriteFile, which
      // writes a fresh file via tmp+rename. chmod fires again afterwards.
      const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
      expect(result.action).toBe("updated");

      const after = await stat(join(tempDir, ".env.mcp"));
      expect(after.mode & 0o777).toBe(0o600);
    },
  );
});

describe("ensureGitignoreEntry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-gitignore-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // F2.7-F3 (D2, P1): `ensureGitignoreEntry` registers all four hatch3r
  // entries — `.env.mcp` (MCP secrets), `.hatch3r-archive/` (archive trees),
  // `.hatch3r/snapshots/` (snapshot dirs), `.hatch3r/handoffs/` (handoff
  // payloads). Without these, `git add .` silently commits operational
  // state + secrets per the Silent Failure Contract.

  it("creates .gitignore with all required hatch3r entries when file does not exist (F2.7-F3)", async () => {
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      ".env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("appends required entries to existing .gitignore (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\ndist/\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      "node_modules/\ndist/\n.env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("adds newline separator when existing file lacks trailing newline (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      "node_modules/\n.env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("skips entries already present (F2.7-F3)", async () => {
    await writeFile(
      join(tempDir, ".gitignore"),
      "node_modules/\n.env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
      "utf-8",
    );
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      "node_modules/\n.env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("skips .env.mcp when .env.* pattern dominates, still adds the others (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".env.*\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      ".env.*\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("skips .hatch3r/* subdir entries when .hatch3r/ dominates (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".env.mcp\n.hatch3r/\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    // .hatch3r/ dominates .hatch3r/snapshots/, .hatch3r/handoffs/, AND the
    // D12-3 .hatch3r/provenance.json file entry.
    // .hatch3r-archive/ is a sibling directory, NOT dominated, so still added.
    expect(content).toBe(".env.mcp\n.hatch3r/\n.hatch3r-archive/\n");
  });

  it("is idempotent across repeated invocations (F2.7-F3)", async () => {
    await ensureGitignoreEntry(tempDir);
    const first = await readFile(join(tempDir, ".gitignore"), "utf-8");
    await ensureGitignoreEntry(tempDir);
    const second = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(second).toBe(first);
  });

  it("adds only the missing subset when some entries already present (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".env.mcp\n.hatch3r-archive/\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(
      ".env.mcp\n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  it("handles .env.mcp with surrounding whitespace in gitignore (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "  .env.mcp  \n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    // .env.mcp covered by whitespace-trimmed match; other entries still appended.
    expect(content).toBe(
      "  .env.mcp  \n.hatch3r-archive/\n.hatch3r/snapshots/\n.hatch3r/handoffs/\n.hatch3r/provenance.json\n",
    );
  });

  // D12-3 (D12, P6): `.hatch3r/provenance.json` is a per-machine drift baseline
  // (regenerated on every init/sync/update) — registering it keeps the file
  // from being staged by a default `git add .`, mirroring the `.env.mcp`
  // secret carve-out. Without this entry `git check-ignore` reports it as NOT
  // ignored and the absolute-home-path leak in older manifests is committable.
  it("registers .hatch3r/provenance.json as machine-local (D12-3)", async () => {
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content.split("\n")).toContain(".hatch3r/provenance.json");
  });
});
