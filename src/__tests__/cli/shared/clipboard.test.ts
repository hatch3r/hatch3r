/**
 * Unit coverage for the injectable clipboard facility
 * (`src/cli/shared/clipboard.ts`).
 *
 * D3-SA3.2-07 (Cycle 12 Wave 4, D3, content-quality.CQ5): clipboard.ts ships a
 * purpose-built `ClipboardResolver` seam (`which` / `run`) plus a `platform`
 * override so the per-OS candidate chains and the which/run fallback loop can be
 * exercised without shelling out — but no test constructed a resolver, so the
 * darwin / win32 / linux candidate ordering (notably the Wayland-before-X11
 * choice: `wl-copy` before `xclip` before `xsel`) and the fallback loop were
 * unexecuted. These tests pin that contract.
 *
 * Two surfaces:
 *   1. Injected resolver + injected platform — the seam's intended use: per-OS
 *      candidate ordering, which-miss fallback, run-failure fallback,
 *      all-fail → null, and payload threading.
 *   2. Default resolver over a mocked `node:child_process.spawnSync` — the real
 *      `which` / `where` selection and status→boolean wiring the seam abstracts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyToClipboard, type ClipboardResolver } from "../../../cli/shared/clipboard.js";

// Only the default-resolver block exercises spawnSync; the injected-resolver
// tests pass their own fake and never reach this mock.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

// ── injected-resolver harness ──────────────────────────────────

interface FakeCall {
  method: "which" | "run";
  command: string;
  argv?: readonly string[];
  input?: string;
}

/**
 * Builds a ClipboardResolver that shells out to nothing: `which` reports a
 * command "present" iff it is in `present`, and `run` "succeeds" iff the command
 * is in `succeed`. Every call is appended to `calls` in order, so tests can
 * assert candidate ordering and the which-before-run short-circuit.
 */
function fakeResolver(opts: { present: readonly string[]; succeed: readonly string[] }): {
  resolver: ClipboardResolver;
  calls: FakeCall[];
} {
  const present = new Set(opts.present);
  const succeed = new Set(opts.succeed);
  const calls: FakeCall[] = [];
  const resolver: ClipboardResolver = {
    which(command) {
      calls.push({ method: "which", command });
      return present.has(command) ? `/fake/bin/${command}` : null;
    },
    run(command, argv, input) {
      calls.push({ method: "run", command, argv, input });
      return succeed.has(command);
    },
  };
  return { resolver, calls };
}

const trace = (calls: FakeCall[]): string[] => calls.map((c) => `${c.method}:${c.command}`);

describe("copyToClipboard() — darwin candidate chain (pbcopy)", () => {
  it("uses pbcopy when present and returns its name", () => {
    const { resolver, calls } = fakeResolver({ present: ["pbcopy"], succeed: ["pbcopy"] });
    expect(copyToClipboard("hi", resolver, "darwin")).toBe("pbcopy");
    expect(trace(calls)).toEqual(["which:pbcopy", "run:pbcopy"]);
  });

  it("returns null when pbcopy is absent — darwin has no other candidate", () => {
    const { resolver, calls } = fakeResolver({ present: [], succeed: [] });
    expect(copyToClipboard("hi", resolver, "darwin")).toBeNull();
    // which was probed; run short-circuited because the candidate was absent.
    expect(calls).toEqual([{ method: "which", command: "pbcopy" }]);
  });

  it("returns null when pbcopy is present but its copy run fails", () => {
    const { resolver, calls } = fakeResolver({ present: ["pbcopy"], succeed: [] });
    expect(copyToClipboard("hi", resolver, "darwin")).toBeNull();
    expect(trace(calls)).toEqual(["which:pbcopy", "run:pbcopy"]);
  });
});

describe("copyToClipboard() — win32 candidate chain (clip.exe → clip)", () => {
  it("prefers clip.exe and never probes clip when clip.exe succeeds", () => {
    const { resolver, calls } = fakeResolver({
      present: ["clip.exe", "clip"],
      succeed: ["clip.exe", "clip"],
    });
    expect(copyToClipboard("hi", resolver, "win32")).toBe("clip.exe");
    expect(trace(calls)).toEqual(["which:clip.exe", "run:clip.exe"]);
  });

  it("falls back to clip when clip.exe is absent (which-miss fallback)", () => {
    const { resolver, calls } = fakeResolver({ present: ["clip"], succeed: ["clip"] });
    expect(copyToClipboard("hi", resolver, "win32")).toBe("clip");
    expect(trace(calls)).toEqual(["which:clip.exe", "which:clip", "run:clip"]);
  });

  it("falls back to clip when clip.exe is present but its run fails (run-failure fallback)", () => {
    const { resolver, calls } = fakeResolver({
      present: ["clip.exe", "clip"],
      succeed: ["clip"],
    });
    expect(copyToClipboard("hi", resolver, "win32")).toBe("clip");
    expect(trace(calls)).toEqual(["which:clip.exe", "run:clip.exe", "which:clip", "run:clip"]);
  });
});

describe("copyToClipboard() — linux candidate chain (wl-copy → xclip → xsel)", () => {
  it("prefers Wayland wl-copy over the X11 tools when present", () => {
    const { resolver, calls } = fakeResolver({
      present: ["wl-copy", "xclip", "xsel"],
      succeed: ["wl-copy", "xclip", "xsel"],
    });
    expect(copyToClipboard("hi", resolver, "linux")).toBe("wl-copy");
    // xclip / xsel are never probed once Wayland's wl-copy succeeds.
    expect(trace(calls)).toEqual(["which:wl-copy", "run:wl-copy"]);
  });

  it("falls back to xclip with the '-selection clipboard' argv when wl-copy is absent", () => {
    const { resolver, calls } = fakeResolver({ present: ["xclip", "xsel"], succeed: ["xclip"] });
    expect(copyToClipboard("hi", resolver, "linux")).toBe("xclip");
    const xclipRun = calls.find((c) => c.method === "run" && c.command === "xclip");
    expect(xclipRun?.argv).toEqual(["-selection", "clipboard"]);
    expect(trace(calls)).toEqual(["which:wl-copy", "which:xclip", "run:xclip"]);
  });

  it("falls back to xsel with the '--clipboard --input' argv when wl-copy and xclip are absent", () => {
    const { resolver, calls } = fakeResolver({ present: ["xsel"], succeed: ["xsel"] });
    expect(copyToClipboard("hi", resolver, "linux")).toBe("xsel");
    const xselRun = calls.find((c) => c.method === "run" && c.command === "xsel");
    expect(xselRun?.argv).toEqual(["--clipboard", "--input"]);
  });

  it("continues past a present-but-failing wl-copy to the next working tool (run-failure fallback)", () => {
    const { resolver, calls } = fakeResolver({
      present: ["wl-copy", "xclip", "xsel"],
      succeed: ["xclip"],
    });
    expect(copyToClipboard("hi", resolver, "linux")).toBe("xclip");
    expect(trace(calls)).toEqual([
      "which:wl-copy",
      "run:wl-copy",
      "which:xclip",
      "run:xclip",
    ]);
  });

  it("returns null when every linux tool is absent (all-fail → null)", () => {
    const { resolver, calls } = fakeResolver({ present: [], succeed: [] });
    expect(copyToClipboard("hi", resolver, "linux")).toBeNull();
    // Each candidate is probed once, in order, and no run is attempted.
    expect(calls.map((c) => c.command)).toEqual(["wl-copy", "xclip", "xsel"]);
    expect(calls.every((c) => c.method === "which")).toBe(true);
  });

  it("returns null when every present tool fails its run (all-fail → null)", () => {
    const { resolver } = fakeResolver({ present: ["wl-copy", "xclip", "xsel"], succeed: [] });
    expect(copyToClipboard("hi", resolver, "linux")).toBeNull();
  });
});

describe("copyToClipboard() — payload threading", () => {
  it("passes the exact text through to resolver.run as stdin input", () => {
    const { resolver, calls } = fakeResolver({ present: ["pbcopy"], succeed: ["pbcopy"] });
    copyToClipboard("cd /some/worktree/path", resolver, "darwin");
    const run = calls.find((c) => c.method === "run");
    expect(run?.input).toBe("cd /some/worktree/path");
  });
});

// ── default-resolver surface (spawnSync-backed) ────────────────

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

function spawnResult(status: number, stdout = ""): ReturnType<typeof spawnSync> {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(""),
    status,
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>;
}

describe("copyToClipboard() — default resolver over spawnSync", () => {
  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    vi.mocked(spawnSync).mockReset();
  });

  it("probes with POSIX `which`, then copies, returning the tool name (darwin)", () => {
    setPlatform("darwin");
    vi.mocked(spawnSync)
      .mockReturnValueOnce(spawnResult(0, "/usr/bin/pbcopy\n")) // which pbcopy
      .mockReturnValueOnce(spawnResult(0)); // pbcopy run
    expect(copyToClipboard("hi", undefined, "darwin")).toBe("pbcopy");

    const probe = vi.mocked(spawnSync).mock.calls[0]!;
    expect(probe[0]).toBe("which");
    expect(probe[1]).toEqual(["pbcopy"]);

    const run = vi.mocked(spawnSync).mock.calls[1]!;
    expect(run[0]).toBe("pbcopy");
    expect(run[2]).toMatchObject({ input: "hi" });
  });

  it("treats a non-zero `which` status as tool-absent and never runs the copy", () => {
    setPlatform("darwin");
    vi.mocked(spawnSync).mockReturnValue(spawnResult(1));
    expect(copyToClipboard("hi", undefined, "darwin")).toBeNull();
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1);
  });

  it("treats empty `which` stdout as tool-absent", () => {
    setPlatform("darwin");
    vi.mocked(spawnSync).mockReturnValue(spawnResult(0, "   \n"));
    expect(copyToClipboard("hi", undefined, "darwin")).toBeNull();
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1);
  });

  it("returns null when the copy command itself exits non-zero", () => {
    setPlatform("darwin");
    vi.mocked(spawnSync)
      .mockReturnValueOnce(spawnResult(0, "/usr/bin/pbcopy\n")) // which pbcopy → present
      .mockReturnValueOnce(spawnResult(1)); // pbcopy run → fails
    expect(copyToClipboard("hi", undefined, "darwin")).toBeNull();
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(2);
  });

  it("probes with `where` (not `which`) on win32 and splits CRLF `where` output", () => {
    setPlatform("win32");
    vi.mocked(spawnSync).mockReturnValue(
      spawnResult(0, "C:\\Windows\\System32\\clip.exe\r\n"),
    );
    expect(copyToClipboard("hi", undefined, "win32")).toBe("clip.exe");
    expect(vi.mocked(spawnSync).mock.calls[0]![0]).toBe("where");
  });
});
