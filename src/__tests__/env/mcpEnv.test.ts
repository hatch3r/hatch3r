import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { findPackageRoot } from "../../cli/shared/paths.js";
import { AVAILABLE_MCP_SERVERS, ENV_VAR_HELP } from "../../types.js";
import {
  CHECKPOINT_WORKSPACE_COMMANDS,
  WORKSPACE_CHECKPOINT_GITIGNORE_ENTRIES,
} from "../../pipeline/checkpoint.js";

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

  // D11-SA11.3-03 (Cycle 12 Wave 3, Medium, CQ4): the finding's exact
  // proof_trace scenario — enabling a NEW secret-bearing server (linear)
  // alongside an already-selected one (github) must not drop a hand-added
  // custom var. The root-cause fix is D1-SA1.2-02's true-merge updater
  // (appendMissingEnvVars), which routes the existing-file path away from
  // generateEnvMcpContent. This locks that contract to the D11-SA11.3-03 case:
  // github stays SELECTED, so GITHUB_PAT is a currently-required var whose
  // value must survive AND not be re-appended as a duplicate line — a path the
  // deselection test above does not exercise.
  it("preserves a hand-added custom var when a new secret-bearing server is enabled (D11-SA11.3-03)", async () => {
    const seeded = [
      "# hatch3r MCP secrets",
      "GITHUB_PAT=ghp_realvalue",
      "",
      "# a var I added for my own tooling",
      "MY_CUSTOM_VAR=user_added_value",
      "",
    ].join("\n");
    await writeFile(join(tempDir, ".env.mcp"), seeded, "utf-8");

    // Keep github selected AND add linear (a new secret-bearing server).
    const result = await ensureEnvMcp(tempDir, ["github", "linear"]);
    expect(result.action).toBe("updated");
    expect(result.newVars).toEqual(["LINEAR_API_KEY"]);

    const content = await readFile(join(tempDir, ".env.mcp"), "utf-8");
    const parsed = parseEnvFile(content);
    // The custom var survives the regeneration (the D11-SA11.3-03 root cause).
    expect(parsed).toHaveProperty("MY_CUSTOM_VAR", "user_added_value");
    // The already-required github secret keeps its value and is not duplicated.
    expect(parsed).toHaveProperty("GITHUB_PAT", "ghp_realvalue");
    expect(
      content.split("\n").filter((l) => /^GITHUB_PAT=/.test(l)),
    ).toHaveLength(1);
    // The newly-required var is appended with an empty placeholder.
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

  // F2.7-F3 (D2, P1) + D1-14 + D1-SA1.2-06 (D1, P1) + 2.2.0-S1 (P6, P1):
  // `ensureGitignoreEntry` registers all hatch3r entries — secrets
  // (`.env.mcp`), operational state (archive/snapshots/handoffs/provenance
  // plus its stale `provenance.json.bak*` siblings, release/2.7.1),
  // the five `.{command}-workspace/` checkpoint dirs (`.init-workspace/`,
  // `.sync-workspace/`, `.update-workspace/`, `.config-workspace/`,
  // `.verify-fix-workspace/`), `.pr-resolve-workspace/`, and the 2.2.0-S1
  // runtime files (telemetry dir,
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
    // release/2.7.1: stale `provenance.json.bak` / `.bak.<8hex>` siblings
    // minted by pre-2.7.1 force-overwrites (writeProvenance now writes with
    // backup: false and sweeps the canonical `.bak`, but repos initialized
    // earlier can still carry them — keep them out of `git add .`).
    ".hatch3r/provenance.json.bak*",
    ".init-workspace/",
    ".sync-workspace/",
    ".update-workspace/",
    ".config-workspace/",
    ".verify-fix-workspace/",
    ".pr-resolve-workspace/",
    ".hatch3r/telemetry/",
    ".hatch3r/efficiency-events.jsonl",
    ".hatch3r/.failure-log.jsonl",
    ".hatch3r/.breaker-state.jsonl",
    ".hatch3r/.lock",
    ".hatch3r/calibration-state.json",
    ".hatch3r/calibration-log.jsonl",
    ".hatch3r/archive/",
    // release/2.8.6: worktree setup receipt (src/worktree/index.ts::
    // WORKTREE_RECEIPT_RELPATH) — rides branch checkouts into worktrees so a
    // fresh worktree's `git status` stays clean.
    ".hatch3r/worktree-receipt.json",
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
    // siblings are NOT dominated and still added: .hatch3r-archive/, the five
    // .{command}-workspace/ checkpoint dirs (.init/.sync/.update/.config/
    // .verify-fix, D1-SA1.2-06), and the 2.2.0-S1 .pr-resolve-workspace/ (the
    // literal expectation below is the regression anchor for that non-suppression).
    expect(content).toBe(
      ".env.mcp\n.hatch3r/\n.hatch3r-archive/\n.init-workspace/\n.sync-workspace/\n" +
        ".update-workspace/\n.config-workspace/\n.verify-fix-workspace/\n.pr-resolve-workspace/\n",
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

  // D1-SA1.2-06 (D1, P1): the reopened D1-14 leak class. `update`, `config`,
  // and `verify --fix` write `.update-workspace/`, `.config-workspace/`, and
  // `.verify-fix-workspace/` checkpoint dirs (update.ts::runRegenerate +
  // config.ts scalar writer) that D1-14 never registered, so a default
  // `git add .` staged per-run checkpoint state. The registry now spreads
  // `WORKSPACE_CHECKPOINT_GITIGNORE_ENTRIES` — the same shared
  // `CHECKPOINT_WORKSPACE_COMMANDS` list the writers resolve their paths from —
  // so a checkpoint-writing command cannot drift out of the gitignore again.
  it("registers .update-/.config-/.verify-fix-workspace/ (D1-SA1.2-06)", async () => {
    await ensureGitignoreEntry(tempDir);
    const lines = (await readFile(join(tempDir, ".gitignore"), "utf-8")).split("\n");
    expect(lines).toContain(".update-workspace/");
    expect(lines).toContain(".config-workspace/");
    expect(lines).toContain(".verify-fix-workspace/");
  });

  // Anti-drift: every `.{command}-workspace/` a checkpoint writer creates is
  // gitignored, derived from the single shared constant (no hand-listing).
  it("gitignores every derived checkpoint-workspace dir from the shared constant (D1-SA1.2-06)", async () => {
    await ensureGitignoreEntry(tempDir);
    const lines = (await readFile(join(tempDir, ".gitignore"), "utf-8")).split("\n");
    // The five known checkpoint commands are registered — a new writer that
    // is not added to CHECKPOINT_WORKSPACE_COMMANDS fails `workspaceDir`'s
    // typed `command` parameter at compile time, so this set stays complete.
    expect([...CHECKPOINT_WORKSPACE_COMMANDS]).toEqual([
      "init",
      "sync",
      "update",
      "config",
      "verify-fix",
    ]);
    for (const entry of WORKSPACE_CHECKPOINT_GITIGNORE_ENTRIES) {
      expect(lines).toContain(entry);
    }
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

  // release/2.8.6: `.hatch3r/worktree-receipt.json` is the setup receipt
  // `hatch3r worktree-setup` writes into each worktree (D1-SA1.10-02) so
  // cleanup can invert setup. The committed entry rides branch checkouts into
  // every worktree/clone, keeping a fresh worktree's `git status` clean and
  // worktree-cleanup's dirty gate quiet. A wholesale `.hatch3r/` line
  // dominates it like every other `.hatch3r/*` entry.
  it("registers .hatch3r/worktree-receipt.json and lets .hatch3r/ dominate it (release/2.8.6)", async () => {
    await ensureGitignoreEntry(tempDir);
    const lines = (await readFile(join(tempDir, ".gitignore"), "utf-8")).split("\n");
    expect(lines).toContain(".hatch3r/worktree-receipt.json");

    // Dominance: a repo ignoring `.hatch3r/` wholesale never gains the
    // granular receipt line.
    const domDir = await mkdtemp(join(tmpdir(), "hatch3r-gitignore-dom-"));
    try {
      await writeFile(join(domDir, ".gitignore"), ".hatch3r/\n", "utf-8");
      await ensureGitignoreEntry(domDir);
      const domContent = await readFile(join(domDir, ".gitignore"), "utf-8");
      expect(domContent).not.toContain(".hatch3r/worktree-receipt.json");
    } finally {
      await rm(domDir, { recursive: true, force: true });
    }
  });
});

// D11-SA11.3-02 (Cycle 12 Wave 3, Medium, CQ4): `.env.mcp` generation and the
// MCP server picker read a hand-maintained mirror of `mcp/mcp.json` — the
// `${env:...}` refs the adapters emit are matched to `.env.mcp` lines ONLY
// because `AVAILABLE_MCP_SERVERS[*].requiresEnv` + `ENV_VAR_HELP` (types.ts)
// manually restate them, with no gate. Adding a `${env:NEW_VAR}` to the bundle
// without the types.ts mirror ships a client config that references a secret
// `.env.mcp` never prompts for — the server launches with an unset credential
// and hatch3r emits no signal (Silent Failure Contract breach). This mirrors
// the sibling real-bundle lockstep guard for CANONICAL_MCP_PACKAGES
// (mcp-package-resolution.test.ts, D15-25): load the REAL bundle (no fixtures,
// CONSTITUTION §2 P2 Decision 20) and assert the two sources stay in lockstep,
// so a future edit that drifts them fails here rather than silently omitting a
// required secret.
describe("bundled mcp.json ↔ env-var mirror parity (D11-SA11.3-02)", () => {
  interface BundledServer {
    env?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }

  const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const MCP_JSON_PATH = join(PKG_ROOT, "mcp", "mcp.json");

  function loadBundledServers(): Record<string, BundledServer> {
    const raw = readFileSync(MCP_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, BundledServer>;
    };
    expect(parsed.mcpServers, `mcpServers missing in ${MCP_JSON_PATH}`).toBeTruthy();
    return parsed.mcpServers as Record<string, BundledServer>;
  }

  /**
   * Every `${env:NAME}` reference the adapters would emit for a server —
   * collected from BOTH the `env` bag (stdio servers) AND the `headers` bag
   * (HTTP servers like `github`, whose `GITHUB_PAT` lives in
   * `Authorization: Bearer ${env:GITHUB_PAT}`, captured in `.env.mcp` only via
   * the manual requiresEnv mirror).
   */
  function collectBundleEnvRefs(
    servers: Record<string, BundledServer>,
  ): Set<string> {
    const refs = new Set<string>();
    const ENV_REF = /\$\{env:([^}]+)\}/g;
    for (const entry of Object.values(servers)) {
      for (const bag of [entry.env, entry.headers]) {
        if (!bag || typeof bag !== "object") continue;
        for (const value of Object.values(bag)) {
          if (typeof value !== "string") continue;
          for (const m of value.matchAll(ENV_REF)) refs.add(m[1].trim());
        }
      }
    }
    return refs;
  }

  function requiresEnvUnion(): Set<string> {
    const union = new Set<string>();
    for (const meta of Object.values(AVAILABLE_MCP_SERVERS)) {
      for (const name of meta.requiresEnv ?? []) union.add(name);
    }
    return union;
  }

  // Direction A (the high-value silent-failure guard): a `${env:...}` the
  // adapter emits with NO requiresEnv mirror → the picker never learns the
  // server needs it and `.env.mcp` omits the line → the server launches with an
  // unset credential and hatch3r emits no signal.
  it("every ${env:...} ref in the bundle is mirrored in AVAILABLE_MCP_SERVERS.requiresEnv", () => {
    const refs = collectBundleEnvRefs(loadBundledServers());
    expect(
      refs.size,
      "expected the bundle to reference at least one ${env:...} secret",
    ).toBeGreaterThan(0);
    const union = requiresEnvUnion();
    const missing = [...refs].filter((name) => !union.has(name));
    expect(
      missing,
      `bundled mcp.json references \${env:...} secret(s) with no requiresEnv mirror in ` +
        `types.ts — add them or .env.mcp will silently omit the credential: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  // Reverse direction (stale-mirror guard): a requiresEnv var no longer
  // referenced by any bundled server prompts the user for a secret nothing uses.
  it("every requiresEnv var is referenced by a ${env:...} in the bundle", () => {
    const refs = collectBundleEnvRefs(loadBundledServers());
    const stale = [...requiresEnvUnion()].filter((name) => !refs.has(name));
    expect(
      stale,
      `AVAILABLE_MCP_SERVERS.requiresEnv lists secret(s) no bundled server references ` +
        `via \${env:...} — remove them to keep the mirror true: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  // (b) Every mirrored secret carries operator help text; without it
  // generateEnvMcpContent renders a bare `NAME=` line with no guidance on what
  // to paste (collectRequiredEnvVars falls back to the server id / empty url).
  it("every requiresEnv var has an ENV_VAR_HELP entry", () => {
    const missingHelp = [...requiresEnvUnion()].filter(
      (name) => !(name in ENV_VAR_HELP),
    );
    expect(
      missingHelp,
      `requiresEnv var(s) missing an ENV_VAR_HELP entry in types.ts — add one so ` +
        `.env.mcp renders guidance instead of a bare placeholder: ${missingHelp.join(", ")}`,
    ).toEqual([]);
  });

  // (c) The server-key sets must be in lockstep in BOTH directions: a bundle
  // server absent from AVAILABLE_MCP_SERVERS is un-pickable; an
  // AVAILABLE_MCP_SERVERS key absent from the bundle offers a server the
  // adapters cannot emit.
  it("mcp.json server keys and AVAILABLE_MCP_SERVERS keys are in lockstep", () => {
    const bundleKeys = new Set(Object.keys(loadBundledServers()));
    const metaKeys = new Set(Object.keys(AVAILABLE_MCP_SERVERS));
    const bundleOnly = [...bundleKeys].filter((k) => !metaKeys.has(k));
    const metaOnly = [...metaKeys].filter((k) => !bundleKeys.has(k));
    expect(
      bundleOnly,
      `mcp.json server(s) absent from AVAILABLE_MCP_SERVERS (types.ts) — the picker ` +
        `cannot offer them: ${bundleOnly.join(", ")}`,
    ).toEqual([]);
    expect(
      metaOnly,
      `AVAILABLE_MCP_SERVERS key(s) absent from bundled mcp.json — the adapters ` +
        `cannot emit them: ${metaOnly.join(", ")}`,
    ).toEqual([]);
  });
});
