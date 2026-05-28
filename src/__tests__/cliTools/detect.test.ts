import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Wave 5 Item 28: behavioural tests for `src/cliTools/detect.ts`.
 *
 * Mocks `node:child_process.spawn` so probe behaviour can be exercised
 * without touching the host filesystem. Covers:
 *  - POSIX vs Windows command construction
 *  - 2-second timeout wall-clock fail-open
 *  - parallel batched probing
 *  - `findMissingCliTools` filtering
 */

// ── child_process mock ─────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter | null;
  kill: (signal?: string) => boolean;
  killed: boolean;
}

let spawnCalls: Array<{ cmd: string; args: readonly string[] }> = [];
type SpawnHandler = (
  cmd: string,
  args: readonly string[],
) => { stdout?: string; code?: number; error?: Error; delayMs?: number };
let spawnHandler: SpawnHandler = () => ({ stdout: "", code: 1 });

vi.mock("node:child_process", () => {
  return {
    spawn: (cmd: string, args: readonly string[]) => {
      spawnCalls.push({ cmd, args });
      const result = spawnHandler(cmd, args);

      const child: MockChild = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        killed: false,
        kill: function (this: MockChild) {
          this.killed = true;
          return true;
        },
      });

      const settle = (): void => {
        if (result.error) {
          child.emit("error", result.error);
          return;
        }
        if (result.stdout !== undefined && result.stdout.length > 0) {
          child.stdout?.emit("data", Buffer.from(result.stdout, "utf8"));
        }
        child.emit("close", result.code ?? 0);
      };

      if (result.delayMs && result.delayMs > 0) {
        setTimeout(settle, result.delayMs);
      } else {
        // Microtask deferral so the promise has time to attach listeners
        // before the child emits — same behaviour as a real spawn.
        Promise.resolve().then(settle);
      }

      return child;
    },
  };
});

// ── platform shim ──────────────────────────────────────────────

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}
function restorePlatform(): void {
  Object.defineProperty(process, "platform", {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
}

// ── module under test ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let detectMod: any;

beforeEach(async () => {
  vi.useFakeTimers();
  spawnCalls = [];
  spawnHandler = () => ({ stdout: "", code: 1 });
  // Fresh import per test so `process.platform` overrides are picked up
  // by any internal caching (detect.ts reads platform at call-time, but
  // import isolation guards against future regression).
  vi.resetModules();
  detectMod = await import("../../cliTools/detect.js");
});

afterEach(() => {
  vi.useRealTimers();
  restorePlatform();
});

describe("probeBin POSIX command construction", () => {
  it("invokes /bin/sh -c 'command -v -- <name>' on darwin", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/opt/homebrew/bin/rg\n", code: 0 });

    const promise = detectMod.probeBin("rg");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;

    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toBe("/bin/sh");
    expect(spawnCalls[0].args[0]).toBe("-c");
    expect(spawnCalls[0].args[1]).toBe('command -v -- "rg"');
    expect(path).toBe("/opt/homebrew/bin/rg");
  });

  it("invokes /bin/sh -c on linux", async () => {
    setPlatform("linux");
    spawnHandler = () => ({ stdout: "/usr/bin/jq\n", code: 0 });

    const promise = detectMod.probeBin("jq");
    await vi.advanceTimersByTimeAsync(10);
    await promise;

    expect(spawnCalls[0].cmd).toBe("/bin/sh");
    expect(spawnCalls[0].args[1]).toBe('command -v -- "jq"');
  });
});

describe("probeBin Windows command construction", () => {
  it("invokes 'where <name>' on win32", async () => {
    setPlatform("win32");
    spawnHandler = () => ({
      stdout: "C:\\Program Files\\Git\\cmd\\gh.exe\r\n",
      code: 0,
    });

    const promise = detectMod.probeBin("gh");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;

    expect(spawnCalls[0].cmd).toBe("where");
    expect(spawnCalls[0].args).toEqual(["gh"]);
    expect(path).toBe("C:\\Program Files\\Git\\cmd\\gh.exe");
  });

  it("takes the first line when `where` returns multiple paths", async () => {
    setPlatform("win32");
    spawnHandler = () => ({
      stdout: "C:\\a\\rg.exe\r\nC:\\b\\rg.exe\r\n",
      code: 0,
    });

    const promise = detectMod.probeBin("rg");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;

    expect(path).toBe("C:\\a\\rg.exe");
  });
});

describe("probeBin timeout", () => {
  it("returns empty string when the child never settles within 2000ms (fail-open)", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/path", code: 0, delayMs: 5000 });

    const promise = detectMod.probeBin("slow-tool");
    // Tick past the 2000ms wall-clock timeout
    await vi.advanceTimersByTimeAsync(2100);
    const path = await promise;
    expect(path).toBe("");
  });

  it("resolves before the timeout when the child settles fast", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/usr/bin/fast\n", code: 0 });

    const promise = detectMod.probeBin("fast");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;
    expect(path).toBe("/usr/bin/fast");
  });
});

describe("probeBin defensive name validation", () => {
  it("returns empty string for names with shell metacharacters", async () => {
    setPlatform("darwin");
    const path = await detectMod.probeBin("evil; rm -rf /");
    expect(path).toBe("");
    expect(spawnCalls.length).toBe(0); // never reached spawn
  });

  it("returns empty string for names with whitespace", async () => {
    setPlatform("darwin");
    const path = await detectMod.probeBin("foo bar");
    expect(path).toBe("");
    expect(spawnCalls.length).toBe(0);
  });
});

describe("probeBin error handling", () => {
  it("returns empty string when child emits 'error' (e.g. ENOENT)", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ error: new Error("ENOENT") });

    const promise = detectMod.probeBin("rg");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;
    expect(path).toBe("");
  });

  it("returns empty string when exit code is non-zero (binary missing)", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "", code: 1 });

    const promise = detectMod.probeBin("missing-tool");
    await vi.advanceTimersByTimeAsync(10);
    const path = await promise;
    expect(path).toBe("");
  });
});

describe("detectCliTool", () => {
  it("returns { installed: true, path } when the binary is found", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/usr/local/bin/rg\n", code: 0 });

    const promise = detectMod.detectCliTool("ripgrep");
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.id).toBe("ripgrep");
    expect(result.probe).toBe("rg");
    expect(result.installed).toBe(true);
    expect(result.path).toBe("/usr/local/bin/rg");
  });

  it("returns { installed: false, path: '' } when the binary is missing", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "", code: 1 });

    const promise = detectMod.detectCliTool("ripgrep");
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.installed).toBe(false);
    expect(result.path).toBe("");
  });

  it("falls back to id for the probe when registry has no matching entry", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "", code: 1 });

    const promise = detectMod.detectCliTool("totally-unknown");
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.probe).toBe("totally-unknown");
  });
});

describe("detectCliTools (batch parallel)", () => {
  it("runs probes in parallel", async () => {
    setPlatform("darwin");
    let inflight = 0;
    let maxInflight = 0;
    spawnHandler = () => {
      inflight++;
      if (inflight > maxInflight) maxInflight = inflight;
      // Resolve on a microtask but decrement on next microtask so we can
      // observe overlap.
      const result = { stdout: "/x\n", code: 0, delayMs: 50 };
      // Schedule a decrement so concurrent probes still see inflight > 1.
      setTimeout(() => { inflight--; }, 60);
      return result;
    };

    const promise = detectMod.detectCliTools(["ripgrep", "jq", "fd"]);
    await vi.advanceTimersByTimeAsync(100);
    const results = await promise;

    expect(results.length).toBe(3);
    // At least 2 spawn calls should have been observed in parallel.
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  it("preserves input order in the result array", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/p\n", code: 0 });

    const promise = detectMod.detectCliTools(["jq", "ripgrep", "fd"]);
    await vi.advanceTimersByTimeAsync(50);
    const results = await promise;

    expect(results.map((r: { id: string }) => r.id)).toEqual(["jq", "ripgrep", "fd"]);
  });
});

describe("findMissingCliTools", () => {
  it("returns only the ids whose probes failed", async () => {
    setPlatform("darwin");
    spawnHandler = (cmd, args) => {
      // Simulate ripgrep installed, jq missing, fd installed.
      const probed = String(args[args.length - 1] ?? "");
      if (probed.includes("rg")) return { stdout: "/usr/bin/rg\n", code: 0 };
      if (probed.includes("fd")) return { stdout: "/usr/bin/fd\n", code: 0 };
      return { stdout: "", code: 1 };
    };

    const promise = detectMod.findMissingCliTools(["ripgrep", "jq", "fd"]);
    await vi.advanceTimersByTimeAsync(50);
    const missing = await promise;

    expect(missing).toEqual(["jq"]);
  });

  it("returns [] when all tools are installed", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "/path\n", code: 0 });

    const promise = detectMod.findMissingCliTools(["ripgrep", "jq"]);
    await vi.advanceTimersByTimeAsync(50);
    const missing = await promise;

    expect(missing).toEqual([]);
  });

  it("returns all ids when none are installed", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "", code: 1 });

    const promise = detectMod.findMissingCliTools(["ripgrep", "jq"]);
    await vi.advanceTimersByTimeAsync(50);
    const missing = await promise;

    expect(missing).toEqual(["ripgrep", "jq"]);
  });
});

describe("detectCliTool extensionProbe (D21-M6, Cycle 10)", () => {
  it("returns installed:false + extensionMissing when az is on PATH but azure-devops extension is absent", async () => {
    setPlatform("darwin");
    // Base probe (/bin/sh -c command -v -- "az") returns a path; the
    // extension probe (az extension list -o tsv) returns stdout that does
    // NOT contain "azure-devops".
    spawnHandler = (cmd, args) => {
      if (cmd === "/bin/sh") {
        return { stdout: "/opt/homebrew/bin/az\n", code: 0 };
      }
      // cmd === "az" — direct spawn of the extension probe
      if (cmd === "az" && args[0] === "extension") {
        return { stdout: "interpret\n", code: 0 };
      }
      return { stdout: "", code: 1 };
    };

    const promise = detectMod.detectCliTool("az-devops");
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.installed).toBe(false);
    expect(result.extensionMissing).toBe("azure-devops");
    expect(result.path).toBe("/opt/homebrew/bin/az");
  });

  it("returns installed:true + no extensionMissing when azure-devops extension is present", async () => {
    setPlatform("darwin");
    spawnHandler = (cmd, args) => {
      if (cmd === "/bin/sh") {
        return { stdout: "/opt/homebrew/bin/az\n", code: 0 };
      }
      if (cmd === "az" && args[0] === "extension") {
        return { stdout: "azure-devops\t1.0.0\nfoo\t2.0.0\n", code: 0 };
      }
      return { stdout: "", code: 1 };
    };

    const promise = detectMod.detectCliTool("az-devops");
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.installed).toBe(true);
    expect(result.extensionMissing).toBeUndefined();
  });

  it("does not run the extension probe when the base binary is missing", async () => {
    setPlatform("darwin");
    spawnHandler = () => ({ stdout: "", code: 1 });

    const promise = detectMod.detectCliTool("az-devops");
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.installed).toBe(false);
    expect(result.extensionMissing).toBeUndefined();
    // Only the base /bin/sh probe should have been invoked.
    expect(spawnCalls.every((c) => c.cmd === "/bin/sh")).toBe(true);
  });
});
