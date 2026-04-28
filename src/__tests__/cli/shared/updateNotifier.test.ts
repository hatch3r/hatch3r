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
