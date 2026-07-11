import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  type EnvVar,
} from "../../env/mcpEnv.js";
import { setVerbose } from "../../cli/shared/ui.js";

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

  // D3-17 (D3, P6): the comment/url fields are the documented pack extension
  // point (governance/pack-trust-model.md). sanitizeEnvMcpComment strips
  // `\r\n=` at the render boundary so a pack-supplied value containing a
  // newline + `KEY=value` cannot inject an attacker-controlled assignment into
  // the rendered `.env.mcp`, which the operator then sources (CWE-78-adjacent).
  // Adversarial coverage of the strip branch (mcpEnv.ts:174-180).
  describe("comment-injection sanitizer (D3-17)", () => {
    afterEach(() => {
      setVerbose(false);
    });

    /** A var whose comment and url each carry a newline-smuggled assignment. */
    function injectedVar(): EnvVar {
      return {
        name: "MYTOKEN",
        server: "evil-pack",
        comment: "ok\nINJECTED=1",
        url: "http://x\nALSO=2",
      };
    }

    it("strips smuggled newline + KEY=value so no attacker assignment is rendered", () => {
      const content = generateEnvMcpContent([injectedVar()]);
      const lines = content.split("\n");

      // The smuggled assignments never appear as standalone lines.
      expect(lines).not.toContain("INJECTED=1");
      expect(lines).not.toContain("ALSO=2");

      // Exactly one `=`-bearing line belongs to MYTOKEN: the placeholder. The
      // comment line that carried the smuggled `=` has had it collapsed to a
      // space, so it no longer parses as an assignment.
      const tokenAssignmentLines = lines.filter((l) => /^MYTOKEN=/.test(l));
      expect(tokenAssignmentLines).toEqual(["MYTOKEN="]);

      // The rendered comment line for MYTOKEN carries the sanitized text with
      // `\n` and `=` replaced by spaces — it contains no `=`.
      const commentLine = lines.find((l) => l.startsWith("# ok "));
      expect(commentLine).toBeDefined();
      expect(commentLine).not.toContain("=");
      expect(commentLine).toContain("INJECTED 1");
      expect(commentLine).toContain("ALSO 2");

      // parseEnvFile (the same parser the operator's shell mimics) recovers
      // only MYTOKEN — never the smuggled keys.
      const parsed = parseEnvFile(content);
      expect(Object.keys(parsed)).toEqual(["MYTOKEN"]);
      expect(parsed).not.toHaveProperty("INJECTED");
      expect(parsed).not.toHaveProperty("ALSO");
    });

    it("emits a --verbose strip diagnostic naming the offending field", () => {
      // verbose() writes via console.error (see cli/shared/ui.ts).
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      setVerbose(true);

      generateEnvMcpContent([injectedVar()]);

      const stderr = spy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(
        stderr.some((line) => /mcpEnv: stripped .* comment for MYTOKEN/.test(line)),
      ).toBe(true);
      expect(
        stderr.some((line) => /mcpEnv: stripped .* url for MYTOKEN/.test(line)),
      ).toBe(true);

      spy.mockRestore();
    });

    it("stays silent when comment/url contain no injection characters", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      setVerbose(true);

      generateEnvMcpContent([
        { name: "CLEAN", server: "ok-pack", comment: "a clean comment", url: "https://example.com" },
      ]);

      const stderr = spy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(stderr.some((line) => /mcpEnv: stripped/.test(line))).toBe(false);

      spy.mockRestore();
    });
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

  // D1-SA1.2-02 (D1, P6): the pre-fix updater re-rendered `.env.mcp` from the
  // template, emitting lines only for the currently-required var set — so
  // switching servers destroyed a filled secret for a deselected server, a
  // hand-added custom var, and every user comment (no VCS recovery: the file
  // is gitignored by design). The true-merge updater must preserve all three
  // and append only the newly-required var. Falsifiable: if any of the three
  // survivors is absent after the update, the merge regressed.
  it("preserves a deselected-server secret, a custom var, and comments when a new var is added (D1-SA1.2-02)", async () => {
    const seeded = [
      "# hatch3r MCP secrets",
      "# my important note about rotation",
      "GITHUB_PAT=ghp_FILLED_SECRET",
      "",
      "# a var I added by hand",
      "MY_CUSTOM_VAR=custom_value",
      "",
    ].join("\n");
    await writeFile(join(tempDir, ".env.mcp"), seeded, "utf-8");

    // Re-pick to a server set that does NOT include github (its secret is now
    // "deselected") but DOES add a new required var (linear → LINEAR_API_KEY).
    const result = await ensureEnvMcp(tempDir, ["linear"]);
    expect(result.action).toBe("updated");
    expect(result.newVars).toEqual(["LINEAR_API_KEY"]);

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    // Survivors: the deselected-server secret, the custom var, the comment.
    expect(content).toContain("GITHUB_PAT=ghp_FILLED_SECRET");
    expect(content).toContain("MY_CUSTOM_VAR=custom_value");
    expect(content).toContain("# my important note about rotation");
    // The newly-required var is appended.
    expect(content).toContain("LINEAR_API_KEY=");

    // The parser (what the operator's shell mimics) still recovers all three
    // real assignments — nothing was dropped.
    const parsed = parseEnvFile(content);
    expect(parsed).toHaveProperty("GITHUB_PAT", "ghp_FILLED_SECRET");
    expect(parsed).toHaveProperty("MY_CUSTOM_VAR", "custom_value");
    expect(parsed).toHaveProperty("LINEAR_API_KEY", "");
  });

  it("never re-renders the template over an existing file — no duplicate header (D1-SA1.2-02)", async () => {
    // First create renders the template (one header).
    await ensureEnvMcp(tempDir, ["github"]);
    // Update appends; it must NOT emit a second full template header block.
    const result = await ensureEnvMcp(tempDir, ["github", "brave-search"]);
    expect(result.action).toBe("updated");

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    const headerCount = content.split("# hatch3r MCP secrets").length - 1;
    expect(headerCount).toBe(1);
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

  // F2.7-F3 (D2, P1) + D1-14 (D1, P1) + 2.2.0-S1 (P6, P1):
  // `ensureGitignoreEntry` registers all hatch3r entries — secrets
  // (`.env.mcp`), operational state (archive/snapshots/handoffs/provenance),
  // per-run checkpoint workspaces (`.init-workspace/`, `.sync-workspace/`,
  // `.pr-resolve-workspace/`), and the 2.2.0-S1 runtime files (telemetry dir,
  // efficiency/failure/breaker logs, advisory lock-note, reviewer-calibration
  // state, removed-tool archive). Without these, `git add .` silently commits
  // operational state + secrets per the Silent Failure Contract.

  // Duplicated literally (NOT imported from mcpEnv.ts) so an accidental entry
  // removal or reorder in REQUIRED_GITIGNORE_ENTRIES fails the suite.
  const ALL_ENTRIES = [
    ".env.mcp",
    ".hatch3r-archive/",
    ".hatch3r/snapshots/",
    ".hatch3r/handoffs/",
    ".hatch3r/provenance.json",
    ".init-workspace/",
    ".sync-workspace/",
    ".pr-resolve-workspace/",
    ".hatch3r/telemetry/",
    ".hatch3r/efficiency-events.jsonl",
    ".hatch3r/.failure-log.jsonl",
    ".hatch3r/.breaker-state.jsonl",
    ".hatch3r/.lock",
    ".hatch3r/calibration-state.json",
    ".hatch3r/calibration-log.jsonl",
    ".hatch3r/archive/",
  ] as const;
  /** Gitignore block for `entries`: one per line, trailing newline. */
  const blockOf = (entries: readonly string[]): string => entries.join("\n") + "\n";
  const ALL_BLOCK = blockOf(ALL_ENTRIES);

  it("creates .gitignore with all required hatch3r entries when file does not exist (F2.7-F3)", async () => {
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(ALL_BLOCK);
  });

  it("appends required entries to existing .gitignore (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\ndist/\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe("node_modules/\ndist/\n" + ALL_BLOCK);
  });

  it("adds newline separator when existing file lacks trailing newline (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe("node_modules/\n" + ALL_BLOCK);
  });

  it("skips entries already present (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\n" + ALL_BLOCK, "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe("node_modules/\n" + ALL_BLOCK);
  });

  it("skips .env.mcp when .env.* pattern dominates, still adds the others (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".env.*\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(".env.*\n" + blockOf(ALL_ENTRIES.filter((e) => e !== ".env.mcp")));
  });

  it("skips .hatch3r/* subdir entries when .hatch3r/ dominates, never .pr-resolve-workspace/ (F2.7-F3, 2.2.0-S1)", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".env.mcp\n.hatch3r/\n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    // .hatch3r/ dominates every `.hatch3r/*` entry — snapshots/, handoffs/,
    // the D12-3 provenance.json, and the 2.2.0-S1 telemetry/, efficiency/
    // failure/breaker logs, .lock, calibration files, and archive/. Top-level
    // siblings are NOT dominated and still added: .hatch3r-archive/,
    // .init-workspace/, .sync-workspace/, and the 2.2.0-S1
    // .pr-resolve-workspace/ (the literal expectation below is the regression
    // anchor for that non-suppression).
    expect(content).toBe(
      ".env.mcp\n.hatch3r/\n.hatch3r-archive/\n.init-workspace/\n.sync-workspace/\n.pr-resolve-workspace/\n",
    );
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
      ".env.mcp\n.hatch3r-archive/\n" +
        blockOf(ALL_ENTRIES.filter((e) => e !== ".env.mcp" && e !== ".hatch3r-archive/")),
    );
  });

  it("handles .env.mcp with surrounding whitespace in gitignore (F2.7-F3)", async () => {
    await writeFile(join(tempDir, ".gitignore"), "  .env.mcp  \n", "utf-8");
    await ensureGitignoreEntry(tempDir);
    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    // .env.mcp covered by whitespace-trimmed match; other entries still appended.
    expect(content).toBe(
      "  .env.mcp  \n" + blockOf(ALL_ENTRIES.filter((e) => e !== ".env.mcp")),
    );
  });

  // D1-14 (D1, P1): `.init-workspace/` and `.sync-workspace/` hold the per-run
  // `--resume` checkpoint trees written unconditionally by init/sync
  // `recordPhase`. Registering them keeps a default `git add .` from staging
  // resume state, mirroring the `.hatch3r/snapshots/` operational-state
  // carve-out. Without these entries `git check-ignore` reports them as NOT
  // ignored after any init/sync run.
  it("registers .init-workspace/ and .sync-workspace/ checkpoint dirs (D1-14)", async () => {
    await ensureGitignoreEntry(tempDir);
    const lines = (await readFile(join(tempDir, ".gitignore"), "utf-8")).split("\n");
    expect(lines).toContain(".init-workspace/");
    expect(lines).toContain(".sync-workspace/");
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

  // 2.2.0-S1 (P6, P1): runtime/ephemeral files hatch3r usage writes into the
  // user's repo — the pr-resolve checkpoint workspace
  // (commands/hatch3r-pr-resolve.md), SPACE + cost/tier telemetry
  // (spaceTelemetry.ts, costEstimator.ts), efficiency/failure/breaker JSONL
  // logs (observability.ts, failureLog.ts, circuitBreaker.ts), the advisory
  // pipeline lock-note (rules/hatch3r-agent-orchestration.md), the
  // reviewer-calibration counter + log (rules/hatch3r-reviewer-calibration.md;
  // a missing state file safely resets the counter to 0), and the removed-tool
  // archive. Registering them keeps a default `git add .` from committing
  // per-run operational state.
  it("registers the 2.2.0-S1 runtime-state entries on a fresh .gitignore (2.2.0-S1)", async () => {
    await ensureGitignoreEntry(tempDir);
    const lines = (await readFile(join(tempDir, ".gitignore"), "utf-8")).split("\n");
    for (const entry of [
      ".pr-resolve-workspace/",
      ".hatch3r/telemetry/",
      ".hatch3r/efficiency-events.jsonl",
      ".hatch3r/.failure-log.jsonl",
      ".hatch3r/.breaker-state.jsonl",
      ".hatch3r/.lock",
      ".hatch3r/calibration-state.json",
      ".hatch3r/calibration-log.jsonl",
      ".hatch3r/archive/",
    ]) {
      expect(lines).toContain(entry);
    }
  });
});
