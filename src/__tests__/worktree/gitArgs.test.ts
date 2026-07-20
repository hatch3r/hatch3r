import { describe, it, expect, vi, beforeEach } from "vitest";
import { HatchError } from "../../types.js";

// release/2.8.0 attach mode: argv-level contract tests. child_process is
// mocked so each git invocation's EXACT argument vector is asserted (the
// real-git behavioral twins live in resolve.test.ts), and the
// checked-out-elsewhere classification is driven by MOCKED porcelain output.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { execFileSync } from "node:child_process";
import {
  addGitWorktree,
  fetchOriginBranch,
  resolveWorktreeBranchPlan,
} from "../../worktree/index.js";

const execMock = vi.mocked(execFileSync);

/** stderr-carrying error in execFileSync's failure shape. */
function gitError(stderr: string): Error & { stderr: Buffer } {
  return Object.assign(new Error("git failed"), { stderr: Buffer.from(stderr) });
}

beforeEach(() => {
  execMock.mockReset();
});

describe("addGitWorktree git argv shapes", () => {
  it("create mode (default): worktree add -b <name> <path>", () => {
    execMock.mockReturnValue(Buffer.from(""));
    addGitWorktree("/main", "feat", "/main/.worktrees/feat");
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toBe("git");
    expect(execMock.mock.calls[0][1]).toEqual([
      "-C", "/main", "worktree", "add", "-b", "feat", "/main/.worktrees/feat",
    ]);
  });

  it("attach mode: worktree add <path> <name> — NO -b in the argv", () => {
    execMock.mockReturnValue(Buffer.from(""));
    addGitWorktree("/main", "feat", "/main/.worktrees/feat", { mode: "attach" });
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toEqual(["-C", "/main", "worktree", "add", "/main/.worktrees/feat", "feat"]);
    expect(args).not.toContain("-b");
  });

  it("track mode: worktree add --track -b <name> <path> origin/<name>", () => {
    execMock.mockReturnValue(Buffer.from(""));
    addGitWorktree("/main", "feat", "/main/.worktrees/feat", { mode: "track" });
    expect(execMock.mock.calls[0][1]).toEqual([
      "-C", "/main", "worktree", "add", "--track", "-b", "feat",
      "/main/.worktrees/feat", "origin/feat",
    ]);
  });
});

describe("checked-out-elsewhere classification (mocked porcelain)", () => {
  const PORCELAIN = [
    "worktree /main",
    "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "branch refs/heads/main",
    "",
    "worktree /elsewhere/dup-wt",
    "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "branch refs/heads/dup",
    "",
  ].join("\0") + "\0";

  it("names the holder path from `git worktree list --porcelain` → VALIDATION_ERROR 64", () => {
    execMock
      .mockImplementationOnce(() => {
        throw gitError("fatal: 'dup' is already used by worktree at '/elsewhere/dup-wt'\n");
      })
      .mockImplementationOnce(() => PORCELAIN);

    try {
      addGitWorktree("/main", "dup", "/main/.worktrees/dup", { mode: "attach" });
      expect.unreachable("addGitWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const err = e as HatchError;
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.message).toContain("/elsewhere/dup-wt");
      expect(err.recoveryHint).toMatch(/worktree-cleanup/);
      expect(err.recoveryHint).toContain("/elsewhere/dup-wt");
    }
    // The porcelain lookup WAS consulted (second git call).
    expect(execMock.mock.calls[1][1]).toEqual(["worktree", "list", "--porcelain", "-z"]);
  });

  it("matches the older git phrasing 'is already checked out at'", () => {
    execMock
      .mockImplementationOnce(() => {
        throw gitError("fatal: 'dup' is already checked out at '/elsewhere/dup-wt'\n");
      })
      .mockImplementationOnce(() => PORCELAIN);

    expect(() =>
      addGitWorktree("/main", "dup", "/main/.worktrees/dup", { mode: "attach" }),
    ).toThrow(/already checked out in another worktree at '\/elsewhere\/dup-wt'/);
  });

  it("falls back to the stderr-quoted path when the porcelain probe fails", () => {
    execMock
      .mockImplementationOnce(() => {
        throw gitError("fatal: 'dup' is already used by worktree at '/stderr/path-wt'\n");
      })
      .mockImplementationOnce(() => {
        throw gitError("fatal: not a git repository\n");
      });

    try {
      addGitWorktree("/main", "dup", "/main/.worktrees/dup", { mode: "attach" });
      expect.unreachable("addGitWorktree should have thrown");
    } catch (e) {
      const err = e as HatchError;
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.message).toContain("/stderr/path-wt");
    }
  });

  it("generic git failure stays FS_ERROR → exit 74 (no hard-coded 1)", () => {
    execMock.mockImplementationOnce(() => {
      throw gitError("fatal: could not create work tree dir: Permission denied\n");
    });
    try {
      addGitWorktree("/main", "feat", "/main/.worktrees/feat");
      expect.unreachable("addGitWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).errorCode).toBe("FS_ERROR");
      expect((e as HatchError).exitCode).toBe(74);
    }
  });
});

describe("fetchOriginBranch argv + failure classification", () => {
  it("runs git -C <root> fetch origin <name>", () => {
    execMock.mockReturnValue(Buffer.from(""));
    fetchOriginBranch("/main", "feat");
    expect(execMock.mock.calls[0][1]).toEqual(["-C", "/main", "fetch", "origin", "feat"]);
  });

  it("missing upstream ref is soft — returns without throwing", () => {
    execMock.mockImplementationOnce(() => {
      throw gitError("fatal: couldn't find remote ref feat\n");
    });
    expect(() => fetchOriginBranch("/main", "feat")).not.toThrow();
  });

  it("transport failure → NETWORK_ERROR, exit 75", () => {
    execMock.mockImplementationOnce(() => {
      throw gitError(
        "fatal: unable to access 'https://example.invalid/repo.git/': Could not resolve host: example.invalid\n",
      );
    });
    try {
      fetchOriginBranch("/main", "feat");
      expect.unreachable("fetchOriginBranch should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const err = e as HatchError;
      expect(err.errorCode).toBe("NETWORK_ERROR");
      expect(err.exitCode).toBe(75);
      expect(err.message).toContain("Could not resolve host");
    }
  });
});

describe("resolveWorktreeBranchPlan call sequencing", () => {
  it("local branch exists → attach, with NO fetch attempted", () => {
    execMock.mockReturnValueOnce(Buffer.from("abc123\n")); // rev-parse refs/heads OK
    const plan = resolveWorktreeBranchPlan("/main", "feat");
    expect(plan).toEqual({ mode: "attach" });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][1]).toEqual([
      "-C", "/main", "rev-parse", "--verify", "--quiet", "refs/heads/feat",
    ]);
  });

  it("no local ref + origin + remote ref → track, fetch argv in sequence", () => {
    execMock
      .mockImplementationOnce(() => { throw gitError(""); })   // refs/heads probe: absent
      .mockReturnValueOnce(Buffer.from("url\n"))                // remote get-url origin
      .mockReturnValueOnce(Buffer.from(""))                     // fetch origin feat
      .mockReturnValueOnce(Buffer.from("def456\n"));            // refs/remotes probe: exists
    const plan = resolveWorktreeBranchPlan("/main", "feat");
    expect(plan).toEqual({ mode: "track" });
    expect(execMock.mock.calls[2][1]).toEqual(["-C", "/main", "fetch", "origin", "feat"]);
    expect(execMock.mock.calls[3][1]).toEqual([
      "-C", "/main", "rev-parse", "--verify", "--quiet", "refs/remotes/origin/feat",
    ]);
  });

  it("no local ref + no origin remote → create, without fetching", () => {
    execMock
      .mockImplementationOnce(() => { throw gitError(""); })  // refs/heads probe: absent
      .mockImplementationOnce(() => { throw gitError("error: No such remote 'origin'\n"); });
    const plan = resolveWorktreeBranchPlan("/main", "feat");
    expect(plan).toEqual({ mode: "create" });
    const fetchCalls = execMock.mock.calls.filter((c) => (c[1] as string[]).includes("fetch"));
    expect(fetchCalls).toEqual([]);
  });

  it("allowFetch:false (dry-run shape) never fetches — local refs only", () => {
    execMock
      .mockImplementationOnce(() => { throw gitError(""); })  // refs/heads probe: absent
      .mockReturnValueOnce(Buffer.from("def456\n"));           // refs/remotes probe: exists
    const plan = resolveWorktreeBranchPlan("/main", "feat", { allowFetch: false });
    expect(plan).toEqual({ mode: "track" });
    expect(execMock).toHaveBeenCalledTimes(2);
    const fetchCalls = execMock.mock.calls.filter((c) => (c[1] as string[]).includes("fetch"));
    expect(fetchCalls).toEqual([]);
  });
});
