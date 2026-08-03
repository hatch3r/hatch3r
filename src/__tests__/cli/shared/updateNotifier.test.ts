import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const updateNotifierMock = vi.fn();
vi.mock("update-notifier", () => ({
  default: updateNotifierMock,
}));

describe("checkForUpdates", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    updateNotifierMock.mockReset();
    process.env = { ...originalEnv };
    delete process.env.HATCH3R_NO_UPDATE_CHECK;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("calls update-notifier with hatch3r pkg metadata + 24h cache", async () => {
    const notify = vi.fn();
    updateNotifierMock.mockReturnValue({
      update: { current: "1.6.0", latest: "1.7.0", type: "minor" },
      notify,
    });
    const { checkForUpdates } = await import("../../../cli/shared/updateNotifier.js");
    checkForUpdates();
    expect(updateNotifierMock).toHaveBeenCalledTimes(1);
    const opts = updateNotifierMock.mock.calls[0]?.[0] as {
      pkg: { name: string; version: string };
      updateCheckInterval: number;
      shouldNotifyInNpmScript: boolean;
    };
    expect(opts.pkg.name).toBe("hatch3r");
    expect(opts.pkg.version).toMatch(/^\d/);
    expect(opts.updateCheckInterval).toBe(86_400_000);
    expect(opts.shouldNotifyInNpmScript).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    const notifyOpts = notify.mock.calls[0]?.[0] as { defer: boolean; message: string };
    expect(notifyOpts.defer).toBe(true);
    expect(notifyOpts.message).toMatch(/Update available/);
    expect(notifyOpts.message).toMatch(/hatch3r update/);
  });

  it("HATCH3R_NO_UPDATE_CHECK=1 short-circuits before invoking update-notifier", async () => {
    process.env.HATCH3R_NO_UPDATE_CHECK = "1";
    const { checkForUpdates } = await import("../../../cli/shared/updateNotifier.js");
    checkForUpdates();
    expect(updateNotifierMock).not.toHaveBeenCalled();
  });

  it("does nothing when update-notifier reports no update", async () => {
    const notify = vi.fn();
    updateNotifierMock.mockReturnValue({ update: undefined, notify });
    const { checkForUpdates } = await import("../../../cli/shared/updateNotifier.js");
    checkForUpdates();
    expect(notify).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by update-notifier", async () => {
    updateNotifierMock.mockImplementation(() => {
      throw new Error("permission denied: ~/.config/configstore");
    });
    const { checkForUpdates } = await import("../../../cli/shared/updateNotifier.js");
    expect(() => checkForUpdates()).not.toThrow();
  });

  it("swallows errors thrown by notify()", async () => {
    const notify = vi.fn(() => {
      throw new Error("boxen broke");
    });
    updateNotifierMock.mockReturnValue({
      update: { current: "1.6.0", latest: "1.7.0", type: "minor" },
      notify,
    });
    const { checkForUpdates } = await import("../../../cli/shared/updateNotifier.js");
    expect(() => checkForUpdates()).not.toThrow();
  });
});

// release/2.8.6: awaited live probe backing the init pre-flight auto-update
// (src/cli/shared/initUpdateCheck.ts). Contract under test: resolves the
// update-notifier fetchInfo() payload, bounded by a hard timeout, and returns
// null on EVERY failure mode so the caller is structurally fail-open.
describe("fetchLatestUpdateInfo", () => {
  const FETCHED = { latest: "9.9.9", current: "1.0.0", type: "major", name: "hatch3r" };

  beforeEach(() => {
    updateNotifierMock.mockReset();
    vi.resetModules();
  });

  it("resolves the fetched info; the notifier instance is armed never to spawn a second background probe", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(FETCHED);
    updateNotifierMock.mockReturnValue({ fetchInfo });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo()).resolves.toEqual(FETCHED);
    const opts = updateNotifierMock.mock.calls[0]?.[0] as {
      pkg: { name: string }; updateCheckInterval: number; shouldNotifyInNpmScript: boolean;
    };
    expect(opts.pkg.name).toBe("hatch3r");
    // MAX_SAFE_INTEGER interval keeps the constructor-time check() from
    // spawning a detached child alongside checkForUpdates()'s own probe.
    expect(opts.updateCheckInterval).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("supports the declared sync (non-promise) fetchInfo return shape", async () => {
    updateNotifierMock.mockReturnValue({ fetchInfo: vi.fn().mockReturnValue(FETCHED) });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo()).resolves.toEqual(FETCHED);
  });

  it("returns null when the notifier constructor throws (configstore permissions)", async () => {
    updateNotifierMock.mockImplementation(() => {
      throw new Error("EACCES: ~/.config/configstore");
    });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo()).resolves.toBeNull();
  });

  it("returns null when fetchInfo throws SYNCHRONOUSLY (review-2.8.6-r1 F4 — the declared non-promise return shape makes a sync throw reachable)", async () => {
    updateNotifierMock.mockReturnValue({
      fetchInfo: vi.fn(() => {
        throw new Error("sync explosion before any promise exists");
      }),
    });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo()).resolves.toBeNull();
  });

  it("returns null when fetchInfo rejects (network error) without leaking an unhandled rejection", async () => {
    updateNotifierMock.mockReturnValue({
      fetchInfo: vi.fn().mockRejectedValue(new Error("ENOTFOUND registry.npmjs.org")),
    });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo()).resolves.toBeNull();
  });

  it("returns null when fetchInfo exceeds the timeout (never blocks init on a slow registry)", async () => {
    updateNotifierMock.mockReturnValue({
      fetchInfo: vi.fn().mockReturnValue(new Promise(() => { /* never settles */ })),
    });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");
    await expect(fetchLatestUpdateInfo(20)).resolves.toBeNull();
  });

  // CQ5-5 (test-2.8.6-p4): the rejection handler is attached BEFORE the race
  // (src/cli/shared/updateNotifier.ts), so a fetch that rejects AFTER the
  // timeout already won must never surface as an unhandled rejection — an
  // unhandled one would reach the CLI's last-resort net (src/cli/index.ts)
  // and turn a background network error into a fatal exit 1.
  //
  // Real timers, not vi.useFakeTimers(): the assertion target is Node's
  // process-level "unhandledRejection" emission, which fires when the pending
  // rejection survives a REAL macrotask boundary. Vitest's fake timers also
  // fake setTimeout/setImmediate by default, so there is no fake-clock way to
  // cross that boundary — the fake clock fights the real-promise/process
  // interleaving. Ordering stays deterministic with real timers because the
  // 10ms timeout timer is due before the 50ms rejection timer (timers fire in
  // due-time order); total test time ~170ms, under the 500ms budget.
  it("a fetch rejecting AFTER the timeout won resolves null and never fires an unhandled rejection (CQ5-5)", async () => {
    const lateError = new Error("ENOTFOUND registry.npmjs.org (late, after timeout)");
    const fetchInfo = vi.fn().mockReturnValue(
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(lateError), 50);
      }),
    );
    updateNotifierMock.mockReturnValue({ fetchInfo });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      // Timeout (10ms) wins the race while the fetch is still pending.
      await expect(fetchLatestUpdateInfo(10)).resolves.toBeNull();
      expect(fetchInfo).toHaveBeenCalledTimes(1);
      // Let the 50ms rejection fire, then cross a macrotask boundary so a
      // would-be "unhandledRejection" event has had its emission window.
      await new Promise((resolve) => setTimeout(resolve, 120));
      await new Promise((resolve) => setImmediate(resolve));
      const surfaced = unhandled.mock.calls.filter(([reason]) => reason === lateError);
      expect(surfaced).toEqual([]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  // CQ5-10 (test-2.8.6-p4): the finally guard's `timer !== undefined` FALSE
  // arm. The Promise executor runs synchronously inside the constructor, so
  // `timer` is unassigned in `finally` only when setTimeout itself throws
  // before the assignment completes — the executor throw rejects the timeout
  // promise (handled by the race), the catch returns null, and the finally
  // skips clearTimeout. Pins the docstring contract: null on ANY failure,
  // including a broken timer subsystem. The stub throws on the FIRST call
  // only (deterministically ours — the executor runs synchronously within
  // fetchLatestUpdateInfo) and delegates afterwards so no unrelated
  // machinery breaks while the stub is installed.
  it("fails open (null) when setTimeout itself throws — the finally guard's timer===undefined arm (CQ5-10)", async () => {
    updateNotifierMock.mockReturnValue({
      fetchInfo: vi.fn().mockReturnValue(new Promise(() => { /* never settles */ })),
    });
    const { fetchLatestUpdateInfo } = await import("../../../cli/shared/updateNotifier.js");

    const realSetTimeout = globalThis.setTimeout;
    let threwOnce = false;
    vi.stubGlobal("setTimeout", ((...args: Parameters<typeof setTimeout>) => {
      if (!threwOnce) {
        threwOnce = true;
        throw new Error("timer subsystem down");
      }
      return realSetTimeout(...args);
    }) as typeof setTimeout);
    try {
      await expect(fetchLatestUpdateInfo(10)).resolves.toBeNull();
      expect(threwOnce).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports a 3s default cap (the inline-on-init budget)", async () => {
    const { FETCH_INFO_TIMEOUT_MS } = await import("../../../cli/shared/updateNotifier.js");
    expect(FETCH_INFO_TIMEOUT_MS).toBe(3_000);
  });
});
