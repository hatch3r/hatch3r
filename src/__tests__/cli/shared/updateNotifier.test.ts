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

  it("exports a 3s default cap (the inline-on-init budget)", async () => {
    const { FETCH_INFO_TIMEOUT_MS } = await import("../../../cli/shared/updateNotifier.js");
    expect(FETCH_INFO_TIMEOUT_MS).toBe(3_000);
  });
});
