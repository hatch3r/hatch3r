/**
 * C9-H47 (D14-SA14.4-H01): unit tests for the detected-repo substitution
 * tokens. Exercises every axis (linter / test framework / CI provider),
 * the empty / single / multi value rendering rules, and the "unknown"
 * fallback when the manifest lacks a `detected` block.
 */

import { describe, it, expect } from "vitest";
import {
  CI_PROVIDER_TOKEN,
  DETECTION_UNKNOWN,
  LINTER_TOKEN,
  REPO_SUBSTITUTION_TOKENS,
  TEST_FRAMEWORK_TOKEN,
  detectionContextFromManifest,
  renderDetectionList,
  substituteRepoTokens,
} from "../../pipeline/repoSubstitution.js";
import type { HatchManifest } from "../../types.js";

function baseManifest(overrides: Partial<HatchManifest> = {}): HatchManifest {
  return {
    version: "2.0.0",
    hatch3rVersion: "1.8.0",
    platform: "github",
    owner: "owner",
    repo: "repo",
    namespace: "owner",
    project: "repo",
    tools: ["claude"],
    features: {
      agents: true,
      rules: true,
      skills: true,
      commands: true,
      prompts: true,
      hooks: true,
      mcp: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
    ...overrides,
  } as HatchManifest;
}

describe("renderDetectionList", () => {
  it("returns 'unknown' for undefined input", () => {
    expect(renderDetectionList(undefined)).toBe(DETECTION_UNKNOWN);
  });

  it("returns 'unknown' for an empty array", () => {
    expect(renderDetectionList([])).toBe(DETECTION_UNKNOWN);
  });

  it("returns the bare value for a single-element array", () => {
    expect(renderDetectionList(["eslint"])).toBe("eslint");
  });

  it("comma-joins multi-element arrays", () => {
    expect(renderDetectionList(["eslint", "prettier", "biome"])).toBe("eslint, prettier, biome");
  });
});

describe("REPO_SUBSTITUTION_TOKENS", () => {
  it("includes all documented tokens (3 detection + 4 verification-gate per D14-M2)", () => {
    // D14-M2 (Cycle 10 rollover): the registry now also lists the
    // verification-gate tokens. Match by membership rather than exact
    // ordering so future additions do not need a wholesale re-shape of
    // this assertion.
    expect(REPO_SUBSTITUTION_TOKENS).toEqual(
      expect.arrayContaining([LINTER_TOKEN, TEST_FRAMEWORK_TOKEN, CI_PROVIDER_TOKEN]),
    );
    expect(REPO_SUBSTITUTION_TOKENS).toHaveLength(7);
  });

  it("declares the exact wire-format literals", () => {
    expect(LINTER_TOKEN).toBe("${HATCH3R:LINTER}");
    expect(TEST_FRAMEWORK_TOKEN).toBe("${HATCH3R:TEST_FRAMEWORK}");
    expect(CI_PROVIDER_TOKEN).toBe("${HATCH3R:CI_PROVIDER}");
  });
});

describe("substituteRepoTokens", () => {
  it("replaces the linter token with detected value", () => {
    const out = substituteRepoTokens(
      "Run ${HATCH3R:LINTER} before committing.",
      { linters: ["eslint"] },
    );
    expect(out).toBe("Run eslint before committing.");
  });

  it("replaces the test-framework token with detected value", () => {
    const out = substituteRepoTokens(
      "Tests run via ${HATCH3R:TEST_FRAMEWORK}.",
      { testFrameworks: ["vitest"] },
    );
    expect(out).toBe("Tests run via vitest.");
  });

  it("replaces the CI-provider token with detected value", () => {
    const out = substituteRepoTokens(
      "Configured on ${HATCH3R:CI_PROVIDER}.",
      { ciProviders: ["github-actions"] },
    );
    expect(out).toBe("Configured on github-actions.");
  });

  it("replaces every occurrence of each token in one pass", () => {
    const body = "Run ${HATCH3R:LINTER}; rerun ${HATCH3R:LINTER}; tests via ${HATCH3R:TEST_FRAMEWORK}.";
    const out = substituteRepoTokens(body, {
      linters: ["biome"],
      testFrameworks: ["jest"],
    });
    expect(out).toBe("Run biome; rerun biome; tests via jest.");
  });

  it("falls back to 'unknown' when an axis is missing", () => {
    const out = substituteRepoTokens(
      "Linter: ${HATCH3R:LINTER}; Tests: ${HATCH3R:TEST_FRAMEWORK}; CI: ${HATCH3R:CI_PROVIDER}",
      {},
    );
    expect(out).toBe("Linter: unknown; Tests: unknown; CI: unknown");
  });

  it("renders multi-value detection as a comma-separated list", () => {
    const out = substituteRepoTokens(
      "Linters: ${HATCH3R:LINTER}",
      { linters: ["eslint", "prettier"] },
    );
    expect(out).toBe("Linters: eslint, prettier");
  });

  it("is idempotent — second call is a no-op", () => {
    const body = "Run ${HATCH3R:LINTER} now.";
    const first = substituteRepoTokens(body, { linters: ["eslint"] });
    const second = substituteRepoTokens(first, { linters: ["eslint"] });
    expect(second).toBe(first);
  });

  it("returns the input unchanged when no tokens appear", () => {
    const body = "No tokens here, just prose.";
    expect(substituteRepoTokens(body, { linters: ["eslint"] })).toBe(body);
  });

  it("does not match partial / lowercased token strings", () => {
    const body = "hatch3r:linter is not the same token as ${HATCH3R:LINTER}";
    const out = substituteRepoTokens(body, { linters: ["eslint"] });
    // Only the canonical uppercase form is replaced.
    expect(out).toBe("hatch3r:linter is not the same token as eslint");
  });
});

describe("detectionContextFromManifest", () => {
  it("returns an empty object when manifest.detected is absent", () => {
    const ctx = detectionContextFromManifest(baseManifest());
    expect(ctx).toEqual({});
  });

  it("returns the manifest's detected block verbatim", () => {
    const ctx = detectionContextFromManifest(
      baseManifest({
        detected: {
          linters: ["eslint"],
          testFrameworks: ["vitest"],
          ciProviders: ["github-actions"],
        },
      }),
    );
    expect(ctx).toEqual({
      linters: ["eslint"],
      testFrameworks: ["vitest"],
      ciProviders: ["github-actions"],
    });
  });

  it("renders an integration body using values pulled from a manifest", () => {
    const manifest = baseManifest({
      detected: {
        linters: ["biome"],
        testFrameworks: ["vitest", "playwright"],
        ciProviders: ["github-actions"],
      },
    });
    const out = substituteRepoTokens(
      "Lint: ${HATCH3R:LINTER}. Tests: ${HATCH3R:TEST_FRAMEWORK}. CI: ${HATCH3R:CI_PROVIDER}.",
      detectionContextFromManifest(manifest),
    );
    expect(out).toBe("Lint: biome. Tests: vitest, playwright. CI: github-actions.");
  });

  it("falls back to 'unknown' across every axis for a pre-1.8.0 manifest", () => {
    const out = substituteRepoTokens(
      "Lint: ${HATCH3R:LINTER}; Tests: ${HATCH3R:TEST_FRAMEWORK}; CI: ${HATCH3R:CI_PROVIDER}",
      detectionContextFromManifest(baseManifest()),
    );
    expect(out).toBe("Lint: unknown; Tests: unknown; CI: unknown");
  });
});
