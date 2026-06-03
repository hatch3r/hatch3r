import { describe, it, expect } from "vitest";
import {
  evaluateTier2Triggers,
  applyPlatformTriggers,
} from "../../cliTools/triggers.js";
import type { Framework, RepoInfo } from "../../types.js";

/**
 * Wave 5 Item 28: `src/cliTools/triggers.ts` behavioural tests.
 *
 * `evaluateTier2Triggers` consumes RepoInfo and returns the tier-2 ids the
 * picker should pre-check. `applyPlatformTriggers` adds platform-driven
 * ids on top of a base selection (gitlab → glab, azure-devops → az-devops).
 */

function makeRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    rootDir: "/fake/repo",
    languages: [],
    packageManager: "unknown",
    frameworks: [],
    isMonorepo: false,
    hasExistingAgents: false,
    existingTools: [],
    ...overrides,
  };
}

describe("evaluateTier2Triggers — web-project", () => {
  it("triggers playwright when frameworks include 'react'", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ frameworks: ["react"] }));
    expect(ids).toContain("playwright");
  });

  it("triggers playwright when frameworks include 'next'", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ frameworks: ["next"] }));
    expect(ids).toContain("playwright");
  });

  it("triggers playwright for vue/svelte/astro/remix/angular/nuxt/sveltekit", () => {
    const frameworks: readonly Framework[] = [
      "vue",
      "svelte",
      "astro",
      "remix",
      "angular",
      "nuxt",
      "sveltekit",
    ];
    for (const f of frameworks) {
      const ids = evaluateTier2Triggers(makeRepoInfo({ frameworks: [f] }));
      expect(ids, `framework ${f} should trigger playwright`).toContain("playwright");
    }
  });

  it("does not trigger playwright when no web framework is present", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ frameworks: ["express"] }));
    expect(ids).not.toContain("playwright");
  });
});

describe("evaluateTier2Triggers — data-project", () => {
  it("triggers duckdb and qsv for python projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["python"] }));
    expect(ids).toContain("duckdb");
    expect(ids).toContain("qsv");
  });

  it("triggers duckdb and qsv for r projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["r"] }));
    expect(ids).toContain("duckdb");
    expect(ids).toContain("qsv");
  });

  it("triggers duckdb and qsv for sql projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["sql"] }));
    expect(ids).toContain("duckdb");
    expect(ids).toContain("qsv");
  });

  it("does not trigger data tools for typescript-only projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["typescript"] }));
    expect(ids).not.toContain("duckdb");
    expect(ids).not.toContain("qsv");
  });

  it("triggers duckdb and qsv when hasDataArtifacts is true even with no data language", () => {
    const ids = evaluateTier2Triggers(
      makeRepoInfo({ languages: ["typescript"], hasDataArtifacts: true }),
    );
    expect(ids).toContain("duckdb");
    expect(ids).toContain("qsv");
  });

  it("still triggers duckdb and qsv on a data language when hasDataArtifacts is false", () => {
    const ids = evaluateTier2Triggers(
      makeRepoInfo({ languages: ["python"], hasDataArtifacts: false }),
    );
    expect(ids).toContain("duckdb");
    expect(ids).toContain("qsv");
  });
});

describe("evaluateTier2Triggers — docker-detected", () => {
  it("triggers docker when hasDockerfile is true", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ hasDockerfile: true }));
    expect(ids).toContain("docker");
  });

  it("does not trigger docker when hasDockerfile is false", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ hasDockerfile: false }));
    expect(ids).not.toContain("docker");
  });

  it("does not trigger docker when hasDockerfile is undefined", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo());
    expect(ids).not.toContain("docker");
  });
});

describe("evaluateTier2Triggers — rust-project", () => {
  it("triggers taplo for rust projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["rust"] }));
    expect(ids).toContain("taplo");
  });

  it("triggers taplo for python projects (pyproject.toml)", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["python"] }));
    expect(ids).toContain("taplo");
  });

  it("does not trigger taplo for typescript-only projects", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["typescript"] }));
    expect(ids).not.toContain("taplo");
  });
});

describe("evaluateTier2Triggers — deduplication", () => {
  it("dedupes when multiple triggers map to the same tool (rust + python both pick taplo)", () => {
    const ids = evaluateTier2Triggers(makeRepoInfo({ languages: ["rust", "python"] }));
    const taploCount = ids.filter((i) => i === "taplo").length;
    expect(taploCount).toBe(1);
  });
});

describe("evaluateTier2Triggers — empty inputs", () => {
  it("returns no triggers for a minimal RepoInfo with no languages or frameworks (non-TTY env)", () => {
    // process.stdout.isTTY is typically false under vitest, so interactive-tty
    // does not fire. A bare RepoInfo should produce an empty array.
    const wasTTY = process.stdout?.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      const ids = evaluateTier2Triggers(makeRepoInfo());
      expect(ids).toEqual([]);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: wasTTY, configurable: true });
    }
  });
});

describe("applyPlatformTriggers", () => {
  it("adds glab to the base list for gitlab platform", () => {
    const result = applyPlatformTriggers("gitlab", []);
    expect(result).toContain("glab");
  });

  it("adds az-devops to the base list for azure-devops platform", () => {
    const result = applyPlatformTriggers("azure-devops", []);
    expect(result).toContain("az-devops");
  });

  it("does not add gh for github platform (gh is already tier-1)", () => {
    const result = applyPlatformTriggers("github", []);
    expect(result).toEqual([]);
  });

  it("preserves the base list ordering and dedupes", () => {
    const result = applyPlatformTriggers("gitlab", ["ripgrep", "jq", "glab"]);
    expect(result).toEqual(["ripgrep", "jq", "glab"]);
  });

  it("returns the base list unchanged for undefined platform", () => {
    const result = applyPlatformTriggers(undefined, ["ripgrep", "jq"]);
    expect(result).toEqual(["ripgrep", "jq"]);
  });
});
