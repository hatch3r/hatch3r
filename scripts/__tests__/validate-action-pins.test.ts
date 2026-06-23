import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commentVersion,
  findFloatingUses,
  formatFinding,
  parsePinSites,
  runValidator,
} from "../validate-action-pins.js";

// ── Pure parsers ──────────────────────────────────────────────────

describe("parsePinSites", () => {
  it("parses a SHA-pinned uses line with a trailing version comment", () => {
    const sites = parsePinSites(
      "wf.yml",
      "      - name: Checkout\n" +
        "        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2\n",
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      file: "wf.yml",
      line: 2,
      owner: "actions",
      repo: "checkout",
      sha: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      comment: "v6.0.2",
    });
  });

  it("captures the sub-action repo segment and a SHA pin without a comment", () => {
    const sites = parsePinSites(
      "wf.yml",
      "        uses: github/codeql-action/analyze@0123456789abcdef0123456789abcdef01234567\n",
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      owner: "github",
      repo: "codeql-action",
      sha: "0123456789abcdef0123456789abcdef01234567",
      comment: "",
    });
  });

  it("ignores a floating (non-SHA) uses ref", () => {
    expect(parsePinSites("wf.yml", "        uses: actions/checkout@v4\n")).toHaveLength(0);
  });
});

describe("commentVersion", () => {
  it("extracts the first vX.Y.Z token", () => {
    expect(commentVersion("v6.0.2")).toBe("v6.0.2");
    expect(commentVersion("v2.19.3 (2026-05-14)")).toBe("v2.19.3");
    expect(commentVersion("pin v4 per policy")).toBe("v4");
    expect(commentVersion("v1.3.2-beta.1")).toBe("v1.3.2-beta.1");
  });

  it("returns null when no version token is present", () => {
    expect(commentVersion("renovate: pinned")).toBeNull();
    expect(commentVersion("")).toBeNull();
  });
});

describe("findFloatingUses", () => {
  it("flags a non-SHA ref at info level and ignores SHA pins + local refs", () => {
    const content =
      "        uses: actions/checkout@v4\n" +
      "        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0\n" +
      "        uses: ./.github/actions/local\n";
    const out = findFloatingUses("wf.yml", content);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ level: "info", code: "PIN-FLOATING-REF", line: 1 });
  });
});

// ── runValidator with an injected resolver (offline) ──────────────

describe("runValidator (injected resolveTags)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "action-pins-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeWorkflow(name: string, body: string): Promise<void> {
    await writeFile(join(dir, name), body, "utf8");
  }

  it("PASS: comment naming a resolved tag yields 0 errors", async () => {
    await writeWorkflow(
      "ci.yml",
      "jobs:\n  a:\n    steps:\n" +
        "      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      resolveTags: async () => ["v6", "v6.0.2"],
    });
    expect(result.errorCount).toBe(0);
    expect(result.checkedSites).toBe(1);
  });

  it("ERROR: coarse comment on a SHA that resolves to a different major is drift", async () => {
    await writeWorkflow(
      "release.yml",
      "jobs:\n  a:\n    steps:\n" +
        "      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v4\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      // The SHA only resolves to v6.0.2 — the `# v4` comment is the D4-3 drift.
      resolveTags: async () => ["v6.0.2"],
    });
    expect(result.errorCount).toBe(1);
    const err = result.findings.find((f) => f.level === "error");
    expect(err?.code).toBe("PIN-COMMENT-DRIFT");
    expect(err?.message).toMatch(/claims 'v4'/);
    expect(err?.message).toMatch(/v6\.0\.2/);
  });

  it("WARNING (not error): a network/transport failure resolves to null", async () => {
    await writeWorkflow(
      "ci.yml",
      "jobs:\n  a:\n    steps:\n" +
        "      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v4\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      resolveTags: async () => null,
    });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("PIN-RESOLVE-FAILED");
  });

  it("WARNING: a SHA that resolves to no tag cannot be verified", async () => {
    await writeWorkflow(
      "ci.yml",
      "jobs:\n  a:\n    steps:\n" +
        "      - uses: acme/tool@0123456789abcdef0123456789abcdef01234567 # v1.0.0\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      resolveTags: async () => [],
    });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("PIN-SHA-UNTAGGED");
  });

  it("INFO: a SHA pin with no comment is reported but does not fail", async () => {
    await writeWorkflow(
      "ci.yml",
      "jobs:\n  a:\n    steps:\n" +
        "      - uses: acme/tool@0123456789abcdef0123456789abcdef01234567\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      resolveTags: async () => ["v1.0.0"],
    });
    expect(result.errorCount).toBe(0);
    expect(result.infoCount).toBe(1);
    expect(result.findings[0].code).toBe("PIN-NO-COMMENT");
  });

  it("resolves each owner/repo@sha once even when pinned in multiple files", async () => {
    let calls = 0;
    await writeWorkflow(
      "a.yml",
      "      - uses: step-security/harden-runner@ab7a9404c0f3da075243ca237b5fac12c98deaa5 # v2.19.3\n",
    );
    await writeWorkflow(
      "b.yml",
      "      - uses: step-security/harden-runner@ab7a9404c0f3da075243ca237b5fac12c98deaa5 # v2.19.3\n",
    );
    const result = await runValidator({
      workflowsDir: dir,
      resolveTags: async () => {
        calls++;
        return ["v2", "v2.19.3"];
      },
    });
    expect(result.errorCount).toBe(0);
    expect(result.checkedSites).toBe(2);
    expect(calls).toBe(1); // cached across files
  });

  it("returns no findings when the workflows dir is absent", async () => {
    const result = await runValidator({
      workflowsDir: join(dir, "does-not-exist"),
      resolveTags: async () => ["v1"],
    });
    expect(result.findings).toHaveLength(0);
    expect(result.checkedSites).toBe(0);
  });
});

// ── Real-corpus guard (offline, via injected SHA-keyed resolver) ──
// The shipped .github/workflows pins map every comment to a tag the SHA
// resolves to AFTER the D4-3 fix. This asserts the parser handles the real
// files and that the core hatch3r-managed pins (ci.yml / release.yml /
// deploy-docs.yml / pr-checks.yml) carry 0 comment-vs-SHA
// drift — without a network call. Keyed on the SHA (not owner/repo) so two pins
// of the same action at different SHAs — actions/checkout is pinned at both
// de0fac2e (v6.0.2) and 692973e3 (v4.1.7) in this repo — each resolve
// correctly. Full-corpus completeness (including the large generated
// generate-docusaurus-docs.lock.yml) is owned by the live `npm run
// validate:action-pins` CI gate; this offline test deliberately maps only the
// hand-authored core pins so it stays deterministic and non-brittle across
// dependabot bumps. An unmapped SHA resolves to null here -> a warning, never a
// drift error, so it cannot give a false pass on the D4-3 property.
describe("runValidator against the real workflows dir (SHA-keyed resolver)", () => {
  it("parses the shipped workflows and reports 0 comment-vs-SHA drift", async () => {
    // SHA -> tag map for the hand-authored core-workflow pins.
    const SHA_TAGS: Record<string, string[]> = {
      ab7a9404c0f3da075243ca237b5fac12c98deaa5: ["v2", "v2.19.3"], // harden-runner
      de0fac2e4500dabe0009e67214ff5f5447ce83dd: ["v6.0.2"], // checkout (modern)
      "692973e3d937129bcbf40652eb9f2f61becf3332": ["v4.1.7"], // checkout (trust-model-audit)
      "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e": ["v6", "v6.4.0"], // setup-node
      c604332985a26aa8cf1bdc465b92731239ec6b9e: ["v4.1.0"], // attest-sbom
      b4309332981a82ec1c5618f44dd2e27cc8bfbfda: ["v3", "v3.0.0"], // action-gh-release
      "2031cfc080254a8a887f58cffee85186f0e49e48": ["v4.9.0"], // dependency-review-action
      ba6de6cc0565af1f42295590380973573297e31f: ["v1.3.2"], // SocketDev/action
      fc324d3547104276b827a68afc52ff2a11cc49c9: ["v5.0.0"], // upload-pages-artifact
      cd2ce8fcbc39b97be8ca5fce6e763baed58fa128: ["v5.0.0"], // deploy-pages
    };
    const result = await runValidator({
      // default workflowsDir = repo .github/workflows
      resolveTags: async (_owner, _repo, sha) => SHA_TAGS[sha] ?? null,
    });
    // The whole point of D4-3: zero comment-vs-SHA drift for every mapped pin.
    const drift = result.findings.filter((f) => f.code === "PIN-COMMENT-DRIFT");
    expect(drift, drift.map(formatFinding).join("\n")).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    // The real corpus pins multiple actions across several workflow files.
    expect(result.checkedSites).toBeGreaterThan(0);
  });
});
