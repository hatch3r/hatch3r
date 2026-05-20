import { describe, it, expect, vi } from "vitest";
import {
  clampAdapterTimeout,
  getAdapterTimeout,
  generateWithTimeout,
  AdapterTimeoutError,
  DEFAULT_ADAPTER_TIMEOUT_MS,
  MIN_ADAPTER_TIMEOUT_MS,
  MAX_ADAPTER_TIMEOUT_MS,
} from "../../pipeline/adapterTimeout.js";
import type { Adapter } from "../../adapters/base.js";
import type { AdapterOutput, HatchManifest, GenerationMode, Tool } from "../../types.js";

function createMockAdapter(
  outputs: AdapterOutput[],
  delayMs = 0,
  warnings: string[] = [],
): Adapter {
  return {
    name: "mock",
    warnings: [...warnings],
    generate: vi.fn(async () => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return outputs;
    }),
    getOutputPaths: vi.fn(async () => outputs.map((o) => o.path)),
  };
}

function createMockManifest(): HatchManifest {
  return {
    version: "1.0.0",
    hatch3rVersion: "1.0.0",
    owner: "test",
    repo: "test",
    namespace: "test",
    project: "test",
    tools: ["cursor"],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: false,
      commands: false,
      mcp: false,
      githubAgents: false,
      hooks: false,
      handoffs: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
  };
}

describe("adapterTimeout", () => {
  describe("clampAdapterTimeout", () => {
    it("should return value when within bounds", () => {
      expect(clampAdapterTimeout(60_000)).toBe(60_000);
    });

    it("should clamp to minimum", () => {
      expect(clampAdapterTimeout(100)).toBe(MIN_ADAPTER_TIMEOUT_MS);
      expect(clampAdapterTimeout(0)).toBe(MIN_ADAPTER_TIMEOUT_MS);
    });

    it("should clamp to maximum", () => {
      expect(clampAdapterTimeout(999_999_999)).toBe(MAX_ADAPTER_TIMEOUT_MS);
    });
  });

  describe("getAdapterTimeout", () => {
    it("should return default when no config", () => {
      expect(getAdapterTimeout("cursor")).toBe(DEFAULT_ADAPTER_TIMEOUT_MS);
    });

    it("should return config timeout", () => {
      expect(
        getAdapterTimeout("cursor", { timeoutMs: 60_000 }),
      ).toBe(60_000);
    });

    it("should use per-tool override", () => {
      expect(
        getAdapterTimeout("cursor", {
          timeoutMs: 60_000,
          overrides: { cursor: 30_000 },
        }),
      ).toBe(30_000);
    });

    it("should fall through to base config when no override for tool", () => {
      expect(
        getAdapterTimeout("claude", {
          timeoutMs: 60_000,
          overrides: { cursor: 30_000 },
        }),
      ).toBe(60_000);
    });

    it("should clamp override values", () => {
      expect(
        getAdapterTimeout("cursor", {
          timeoutMs: 60_000,
          overrides: { cursor: 1 },
        }),
      ).toBe(MIN_ADAPTER_TIMEOUT_MS);
    });
  });

  describe("generateWithTimeout", () => {
    const manifest = createMockManifest();
    const generationMode: GenerationMode = "standard";

    it("should return completed result for fast adapter", async () => {
      const outputs: AdapterOutput[] = [
        { path: "test.md", content: "content", action: "create" },
      ];
      const adapter = createMockAdapter(outputs);

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(true);
      expect(result.tool).toBe("cursor");
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs![0].path).toBe("test.md");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should include adapter warnings in result", async () => {
      const adapter = createMockAdapter([], 0, ["warning1", "warning2"]);

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
      );

      expect(result.warnings).toContain("warning1");
      expect(result.warnings).toContain("warning2");
    });

    it("should handle adapter errors gracefully", async () => {
      const adapter: Adapter = {
        name: "broken",
        warnings: [],
        generate: vi.fn(async () => {
          throw new Error("adapter crash");
        }),
        getOutputPaths: vi.fn(async () => []),
      };

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(false);
      expect(result.error).toContain("adapter crash");
    });

    it("should report elapsed time", async () => {
      const adapter = createMockAdapter([], 50);

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(40);
    });

    it("should use default timeout when no config", async () => {
      const adapter = createMockAdapter([]);

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
      );

      expect(result.completed).toBe(true);
    });

    // ── C9-H20 (D8-H8.3.1): AbortSignal forwarded to adapter.generate ─
    it("passes an AbortSignal as the 4th positional argument to adapter.generate", async () => {
      let receivedSignal: AbortSignal | undefined;
      const adapter: Adapter = {
        name: "signal-capture",
        warnings: [],
        generate: vi.fn(async (_dir, _m, _userRoot, _mode, signal?: AbortSignal) => {
          receivedSignal = signal;
          return [] as AdapterOutput[];
        }),
        getOutputPaths: vi.fn(async () => []),
      };

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(true);
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(false);
    });

    it("propagates an external parentSignal abort into adapter.generate", async () => {
      let receivedSignal: AbortSignal | undefined;
      const adapter: Adapter = {
        name: "parent-link",
        warnings: [],
        generate: vi.fn(async (_dir, _m, _userRoot, _mode, signal?: AbortSignal) => {
          receivedSignal = signal;
          // Simulate work — long enough for the parent to fire before
          // the adapter finishes.
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [] as AdapterOutput[];
        }),
        getOutputPaths: vi.fn(async () => []),
      };

      const parent = new AbortController();
      setTimeout(() => parent.abort(new Error("user-cancelled")), 10);

      await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: 30_000 },
        parent.signal,
      );

      // The inner signal should reflect the parent abort by the time
      // generate resolves.
      expect(receivedSignal?.aborted).toBe(true);
    });

    it("aborts the inner signal when the adapter timeout fires", async () => {
      let receivedSignal: AbortSignal | undefined;
      const adapter: Adapter = {
        name: "slow",
        warnings: [],
        generate: vi.fn(async (_dir, _m, _userRoot, _mode, signal?: AbortSignal) => {
          receivedSignal = signal;
          // Never resolve — the timeout has to win.
          return new Promise<AdapterOutput[]>(() => {});
        }),
        getOutputPaths: vi.fn(async () => []),
      };

      const result = await generateWithTimeout(
        "cursor",
        adapter,
        "/agents",
        manifest,
        generationMode,
        { timeoutMs: MIN_ADAPTER_TIMEOUT_MS },
      );

      // Race timed out → completed=false; the signal handed to the
      // adapter is aborted so cooperative cleanup can run.
      expect(result.completed).toBe(false);
      expect(receivedSignal?.aborted).toBe(true);
    }, 15_000);
  });

  describe("AdapterTimeoutError", () => {
    it("should have correct properties", () => {
      const err = new AdapterTimeoutError("cursor" as Tool, 30_000);
      expect(err.name).toBe("AdapterTimeoutError");
      expect(err.tool).toBe("cursor");
      expect(err.timeoutMs).toBe(30_000);
      expect(err.message).toContain("cursor");
      expect(err.message).toContain("30s");
    });

    it("should include tool name in message", () => {
      const err = new AdapterTimeoutError("claude" as Tool, 60_000);
      expect(err.message).toContain("claude");
    });
  });
});
