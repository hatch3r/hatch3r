// D12-3 (D12, P6): the provenance writer must persist `sourceFiles` as paths
// RELATIVE to the bundled content root, not the absolute machine-specific
// `/Users/<name>/…/dist/content/agents/…` paths `BaseAdapter` tracks. An
// absolute home path leaks the operator's username + install layout into a
// file the operator may commit. These tests pin the relativization at the
// single writer boundary (`writeProvenance`) plus the pure helper it uses.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  writeProvenance,
  relativizeSourceFile,
  hashEmittedContent,
  PROVENANCE_FILE,
  type ProvenanceManifest,
} from "../../manifest/provenance.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { HATCH3R_DIR, type AdapterOutput } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";

describe("relativizeSourceFile (D12-3)", () => {
  const root = join(sep, "abs", "content-root");

  it("rewrites an absolute path under the content root to a content-root-relative id", () => {
    const abs = join(root, "agents", "hatch3r-architect.md");
    expect(relativizeSourceFile(abs, root)).toBe("agents/hatch3r-architect.md");
  });

  it("leaves an already-relative id untouched (no cwd-resolution corruption)", () => {
    expect(relativizeSourceFile("rules/hatch3r-security-patterns.md", root)).toBe(
      "rules/hatch3r-security-patterns.md",
    );
  });

  it("preserves attribution for an absolute path outside the content root as a ..-relative id", () => {
    const outside = join(sep, "elsewhere", "skills", "x", "SKILL.md");
    const out = relativizeSourceFile(outside, root);
    // path.relative yields a ..-prefixed result; we keep it rather than drop
    // the source. POSIX-normalized so it never carries a backslash.
    expect(out.startsWith("..")).toBe(true);
    expect(out).not.toContain("\\");
  });

  it("normalizes Windows backslash separators to POSIX (cross-machine byte stability)", () => {
    // Simulate a Windows-style absolute path + root on a POSIX test host by
    // checking the public contract: the output never contains a backslash.
    const abs = join(root, "hooks", "hatch3r-pre.md");
    expect(relativizeSourceFile(abs, root)).not.toContain("\\");
  });
});

describe("writeProvenance sourceFiles relativization (D12-3)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-rel-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readManifest(): Promise<ProvenanceManifest> {
    const raw = await readFile(join(tempDir, HATCH3R_DIR, PROVENANCE_FILE), "utf-8");
    return JSON.parse(raw) as ProvenanceManifest;
  }

  it("persists absolute BaseAdapter source paths as content-root-relative ids", async () => {
    // The writer relativizes against the live bundled content root. Build an
    // absolute input under that root so the assertion is layout-independent.
    const contentRoot = resolveBundledContentRoot();
    const absAgent = join(contentRoot, "agents", "hatch3r-implementer.md");
    const absRule = join(contentRoot, "rules", "hatch3r-security-patterns.md");

    const res = await writeProvenance(
      tempDir,
      [
        {
          adapter: "claude",
          outputs: [
            {
              path: "CLAUDE.md",
              content: "# CLAUDE.md\nbody",
              action: "create",
              sourceFiles: [absAgent, absRule],
            },
          ],
        },
      ],
      "sync",
    );

    expect(res.written).toBe(true);
    const manifest = await readManifest();
    const entry = manifest.outputs.find((o) => o.path === "CLAUDE.md");
    expect(entry).toBeDefined();
    // Sorted, relative, POSIX-separated — and crucially NOT the absolute home path.
    expect(entry?.sourceFiles).toEqual([
      "agents/hatch3r-implementer.md",
      "rules/hatch3r-security-patterns.md",
    ]);
    for (const s of entry?.sourceFiles ?? []) {
      expect(s.startsWith(sep === "\\" ? "C:\\" : "/")).toBe(false);
      expect(s).not.toContain("\\");
    }
  });

  it("writes an empty array unchanged for config-only outputs", async () => {
    const res = await writeProvenance(
      tempDir,
      [
        {
          adapter: "cursor",
          outputs: [
            { path: "mcp.json", content: "{}", action: "create", sourceFiles: [] },
          ],
        },
      ],
      "init",
    );
    expect(res.written).toBe(true);
    const manifest = await readManifest();
    expect(manifest.outputs.find((o) => o.path === "mcp.json")?.sourceFiles).toEqual([]);
  });
});

// D3-SA3.3-03 + D1-SA1.6-05: writeProvenance accreted three documented behavioral
// contracts across cycles — F2.7-F5 idempotency (match branch), D11-M2 failed-
// adapter carry-forward, and the P5 Silent Failure Contract — yet the dedicated
// test file covered only the D12-3 relativization slice. `failedAdapters` and
// `carriedEntries` had zero hits across src/__tests__/. These tests pin each
// contract as an executable specification so a refactor of the index-by-index
// comparison (provenance.ts:215-227) or the carry-forward filter (:248-250)
// fails loudly instead of silently degrading `hatch3r status` drift attribution.
describe("writeProvenance idempotency + carry-forward + silent-failure contracts (D3-SA3.3-03, D1-SA1.6-05)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-cf-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const provenancePath = (): string => join(tempDir, HATCH3R_DIR, PROVENANCE_FILE);

  async function readManifest(): Promise<ProvenanceManifest> {
    return JSON.parse(await readFile(provenancePath(), "utf-8")) as ProvenanceManifest;
  }

  function output(path: string, content: string, sourceFiles: string[] = []): AdapterOutput {
    return { path, content, action: "create", sourceFiles };
  }

  // Sentinels a fresh write could never mint: getRunId() is process-stable and
  // generatedAt is a current ISO date, so these values distinguish a genuine
  // carry-forward from a coincidental fresh write. Shared by the match-branch
  // (a) and version-bump (e) tests below, which build the same first manifest
  // then diverge only in what they stamp and assert.
  const SENTINEL_AT = "1999-12-31T23:59:59.000Z";
  const SENTINEL_RUN = "carry-forward-sentinel-run-id";

  // One-output adapter set whose emit is byte-stable across calls (empty
  // sourceFiles ⇒ relativization is a no-op; contentHash depends only on the
  // fixed content), so a second identical write MATCHES the idempotency
  // comparison at provenance.ts:215-227.
  const idempotentInputs = (): { adapter: string; outputs: AdapterOutput[] }[] => [
    { adapter: "claude", outputs: [output("CLAUDE.md", "# CLAUDE.md\nbody")] },
  ];

  // Write a first manifest with the byte-stable inputs, assert it landed, and
  // read it back so a test can stamp sentinel fields before re-running.
  async function writeFirstAndReadStamped(): Promise<ProvenanceManifest> {
    const first = await writeProvenance(tempDir, idempotentInputs(), "sync");
    expect(first.written).toBe(true);
    return readManifest();
  }

  // (a) F2.7-F5 idempotency MATCH branch (provenance.ts:210-231). A byte-
  // identical re-run must carry `generatedAt`/`lastRunId` forward from the
  // previous manifest (proven with sentinels a fresh mint could never produce)
  // and leave the file byte-identical on disk (no spurious mtime bump on a
  // no-op re-run).
  it("carries generatedAt/lastRunId forward on a byte-identical re-run and leaves the file byte-identical (match branch)", async () => {
    // Stamp sentinels, PRESERVING outputs so the index-by-index idempotency
    // comparison still MATCHES on the next write.
    const stamped = await writeFirstAndReadStamped();
    const sentinelBytes =
      JSON.stringify({ ...stamped, generatedAt: SENTINEL_AT, lastRunId: SENTINEL_RUN }, null, 2) +
      "\n";
    await writeFile(provenancePath(), sentinelBytes, "utf-8");

    const second = await writeProvenance(tempDir, idempotentInputs(), "sync");
    expect(second.written).toBe(true);

    const after = await readManifest();
    // Match branch carried the sentinels forward rather than minting fresh ones.
    expect(after.generatedAt).toBe(SENTINEL_AT);
    expect(after.lastRunId).toBe(SENTINEL_RUN);
    // No spurious rewrite: on-disk bytes are identical to the stamped manifest.
    expect(await readFile(provenancePath(), "utf-8")).toBe(sentinelBytes);
  });

  // (a2) D1-SA1.6-07 (P2): lastCommand is carried forward TOGETHER with
  // generatedAt/lastRunId on a byte-identical re-run, so a no-op re-run under a
  // DIFFERENT command (a no-op `update` after a `sync`) stays byte-identical and
  // the header names one run — the run that produced the bytes — instead of
  // pairing a fresh `update` lastCommand with the carried `sync` lastRunId
  // (which misroutes the documented lastRunId→failure-log trace).
  it("carries lastCommand forward on a byte-identical re-run under a different command (D1-SA1.6-07)", async () => {
    // Stamp generatedAt/lastRunId sentinels, PRESERVING outputs AND the "sync"
    // lastCommand so the next write's idempotency comparison still MATCHES.
    const stamped = await writeFirstAndReadStamped();
    expect(stamped.lastCommand).toBe("sync");
    const sentinelBytes =
      JSON.stringify({ ...stamped, generatedAt: SENTINEL_AT, lastRunId: SENTINEL_RUN }, null, 2) +
      "\n";
    await writeFile(provenancePath(), sentinelBytes, "utf-8");

    // Byte-identical re-run under a DIFFERENT command.
    const second = await writeProvenance(tempDir, idempotentInputs(), "update");
    expect(second.written).toBe(true);

    const after = await readManifest();
    // lastCommand is carried from the run that produced the bytes ("sync"), NOT
    // re-stamped to "update" (the pre-D1-SA1.6-07 behavior).
    expect(after.lastCommand).toBe("sync");
    // …together with the sentinel generatedAt/lastRunId — one coherent run.
    expect(after.generatedAt).toBe(SENTINEL_AT);
    expect(after.lastRunId).toBe(SENTINEL_RUN);
    // And the no-op update leaves the file byte-identical (no spurious rewrite).
    expect(await readFile(provenancePath(), "utf-8")).toBe(sentinelBytes);
  });

  // (b) D11-M2 split-brain repair (provenance.ts:240-250). On a partial run,
  // provenance rows for adapters listed in `failedAdapters` are carried forward
  // from the previous manifest (kept attributable so `status` does not degrade
  // them to `unknown`), while the successful adapter's rows are refreshed.
  it("carries a failed adapter's prior rows forward while refreshing the successful adapter's rows", async () => {
    // First run: both adapters succeed and are recorded.
    const firstRun = await writeProvenance(
      tempDir,
      [
        { adapter: "claude", outputs: [output("CLAUDE.md", "claude-v1")] },
        { adapter: "cursor", outputs: [output(".cursor/rules/x.mdc", "cursor-v1")] },
      ],
      "sync",
    );
    expect(firstRun.written).toBe(true);
    const before = await readManifest();
    const cursorBefore = before.outputs.find((o) => o.adapter === "cursor");
    const claudeBefore = before.outputs.find((o) => o.adapter === "claude");
    expect(cursorBefore).toBeDefined();
    expect(claudeBefore).toBeDefined();

    // Second run: cursor FAILED (absent from perAdapterOutputs), claude
    // succeeded with CHANGED content. cursor's prior row must survive; claude's
    // must refresh (new emit-time hash).
    const partialRun = await writeProvenance(
      tempDir,
      [{ adapter: "claude", outputs: [output("CLAUDE.md", "claude-v2")] }],
      "sync",
      { failedAdapters: ["cursor"] },
    );
    expect(partialRun.written).toBe(true);

    const after = await readManifest();
    const cursorAfter = after.outputs.find((o) => o.adapter === "cursor");
    const claudeAfter = after.outputs.find((o) => o.adapter === "claude");
    // cursor carried forward byte-for-byte (same path, hash, sourceFiles).
    expect(cursorAfter).toEqual(cursorBefore);
    // claude refreshed: the content changed, so its emit-time hash changed.
    expect(claudeAfter?.contentHash).toBeDefined();
    expect(claudeAfter?.contentHash).not.toBe(claudeBefore?.contentHash);
  });

  // (c) Silent Failure Contract, P5 (provenance.ts:269-279). A write failure
  // never throws — it is reported through `onWarn` and returns
  // `{ written: false, warning }`. The failure is forced deterministically and
  // cross-platform by making `<root>/.hatch3r` a FILE, so safeWriteFile's
  // `mkdir(dirname, { recursive: true })` (safeWrite.ts:1255) throws EEXIST.
  it("returns { written: false, warning } and calls onWarn once without throwing when the write fails", async () => {
    // `.hatch3r` as a regular file → mkdir of the provenance dir fails.
    await writeFile(join(tempDir, HATCH3R_DIR), "blocks the .hatch3r directory", "utf-8");
    const onWarn = vi.fn();

    const res = await writeProvenance(
      tempDir,
      [{ adapter: "claude", outputs: [output("CLAUDE.md", "body")] }],
      "sync",
      { onWarn },
    );

    expect(res.written).toBe(false);
    expect(res.warning).toContain(`${HATCH3R_DIR}/${PROVENANCE_FILE}`);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn).toHaveBeenCalledWith(res.warning);
  });

  // (d) A corrupt/unparseable previous manifest degrades to a fresh write
  // without throwing (provenance.ts:232-238 catch → fresh manifest, written:true).
  it("recovers from a corrupt previous manifest by writing a fresh one without throwing", async () => {
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    await writeFile(provenancePath(), "{ this is not valid json", "utf-8");

    const res = await writeProvenance(
      tempDir,
      [{ adapter: "claude", outputs: [output("CLAUDE.md", "fresh-body")] }],
      "init",
    );

    expect(res.written).toBe(true);
    const manifest = await readManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(manifest.lastCommand).toBe("init");
    expect(manifest.outputs.find((o) => o.path === "CLAUDE.md")).toBeDefined();
  });

  // (e) A previous manifest at a DIFFERENT hatch3rVersion invalidates the
  // idempotency carry-forward (the version guard at provenance.ts:212):
  // `generatedAt`/`lastRunId` are freshly minted, not carried from the stale
  // manifest, so a version bump always refreshes the baseline timestamp.
  it("does not carry generatedAt/lastRunId forward when the previous manifest is a different hatch3rVersion", async () => {
    // Same first manifest as (a), but downgrade the recorded version alongside
    // the sentinels — the version guard must then REJECT the carry-forward.
    const stamped = await writeFirstAndReadStamped();
    await writeFile(
      provenancePath(),
      JSON.stringify(
        {
          ...stamped,
          hatch3rVersion: "0.0.0-stale",
          generatedAt: SENTINEL_AT,
          lastRunId: SENTINEL_RUN,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const second = await writeProvenance(tempDir, idempotentInputs(), "sync");
    expect(second.written).toBe(true);

    const after = await readManifest();
    // Version mismatch skipped carry-forward → sentinels replaced by fresh values.
    expect(after.hatch3rVersion).toBe(HATCH3R_VERSION);
    expect(after.generatedAt).not.toBe(SENTINEL_AT);
    expect(after.lastRunId).not.toBe(SENTINEL_RUN);
  });
});

// D12-SA12.2-03 (drift-hash path-awareness) + D12-SA12.2-02 (command
// attribution). The writer previously (a) hashed the emit-time baseline WITHOUT
// the output path, so a `.yml` output whose user region quotes an HTML marker
// pair was reduced to the wrong (HTML-first) block while the status reader used
// the path-aware YAML block — flipping drift attribution to a phantom
// `(your edit)`; and (b) could only stamp `sync`/`init`/`update`, so a
// `config`-originated write was unrepresentable.
describe("writeProvenance drift-hash path-awareness + command attribution (D12-SA12.2-03, D12-SA12.2-02)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-drift-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readManifest(): Promise<ProvenanceManifest> {
    return JSON.parse(
      await readFile(join(tempDir, HATCH3R_DIR, PROVENANCE_FILE), "utf-8"),
    ) as ProvenanceManifest;
  }

  // (a) D12-SA12.2-03: the baseline hash is computed with the output path, so it
  // uses the SAME path-aware, variant-ordered block extraction the status reader
  // applies. Fixture: a `.yml` output (YAML `#` markers) whose user region quotes
  // a complete HTML marker pair on their own lines — the one shape where the
  // two extraction orders diverge (YAML-first with a path, HTML-first without).
  it("hashes the baseline with the output path so a .yml output matches the reader's path-aware block", async () => {
    const ymlPath = ".github/workflows/copilot-setup-steps.yml";
    const ymlContent = [
      "on: push",
      "# HATCH3R:BEGIN",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "# HATCH3R:END",
      "# The note below quotes a complete HTML marker pair on their own lines:",
      "<!-- HATCH3R:BEGIN -->",
      "<!-- HATCH3R:END -->",
      "",
    ].join("\n");

    // Guard: the fixture is only meaningful if the two extraction orders diverge
    // for this content. If this ever stops holding, the regression is inert.
    const withPath = hashEmittedContent(ymlContent, undefined, ymlPath);
    const withoutPath = hashEmittedContent(ymlContent, undefined);
    expect(withPath).not.toBe(withoutPath);

    const res = await writeProvenance(
      tempDir,
      [
        {
          adapter: "copilot",
          outputs: [{ path: ymlPath, content: ymlContent, action: "create", sourceFiles: [] }],
        },
      ],
      "sync",
    );
    expect(res.written).toBe(true);

    const entry = (await readManifest()).outputs.find((o) => o.path === ymlPath);
    // The persisted baseline now equals the path-aware (reader-consistent) hash,
    // not the path-less HTML-first one the pre-fix writer computed.
    expect(entry?.contentHash).toBe(withPath);
    expect(entry?.contentHash).not.toBe(withoutPath);
  });

  // (b) D12-SA12.2-02: `"config"` is a representable, persisted originating
  // command — a config-driven regeneration no longer masquerades as `"update"`.
  it('persists lastCommand "config" for a config-originated write', async () => {
    const res = await writeProvenance(
      tempDir,
      [{ adapter: "claude", outputs: [{ path: "CLAUDE.md", content: "body", action: "create", sourceFiles: [] }] }],
      "config",
    );
    expect(res.written).toBe(true);
    expect((await readManifest()).lastCommand).toBe("config");
  });
});

// release/2.7.0: each provenance entry records the emit-time `model:`/`effort:`
// prefix scalars (emittedModel/emittedEffort, parsed from the out-of-block
// frontmatter above HATCH3R:BEGIN) so `hatch3r status` can tell a hand-edited
// stub from a moved canonical mapping. schemaVersion stays 1 — the fields are
// additive and old readers ignore them — and they participate in the F2.7-F5
// idempotency comparison so a prefix-only mapping change refreshes the
// baseline exactly once instead of being carried as a "match" (contentHash
// covers only the managed block, never the prefix).
describe("writeProvenance emittedModel/emittedEffort scalars (release/2.7.0)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-model-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const provenancePath = (): string => join(tempDir, HATCH3R_DIR, PROVENANCE_FILE);

  async function readManifest(): Promise<ProvenanceManifest> {
    return JSON.parse(await readFile(provenancePath(), "utf-8")) as ProvenanceManifest;
  }

  const AGENT_PATH = ".claude/agents/hatch3r-implementer.md";
  const AGENT_CONTENT = [
    "---",
    "name: hatch3r-implementer",
    "model: claude-fable-5",
    "effort: high",
    "---",
    "",
    "<!-- HATCH3R:BEGIN -->",
    "agent body",
    "<!-- HATCH3R:END -->",
    "",
  ].join("\n");

  const agentInputs = (): { adapter: string; outputs: AdapterOutput[] }[] => [
    {
      adapter: "claude",
      outputs: [
        { path: AGENT_PATH, content: AGENT_CONTENT, action: "create", sourceFiles: [] },
        {
          path: "CLAUDE.md",
          content: "# CLAUDE.md\nno managed block here",
          action: "create",
          sourceFiles: [],
        },
      ],
    },
  ];

  const SENTINEL_AT = "1999-12-31T23:59:59.000Z";
  const SENTINEL_RUN = "scalar-sentinel-run-id";

  it("persists the scalars from a frontmatter-bearing prefix and omits them for prefix-less outputs", async () => {
    const res = await writeProvenance(tempDir, agentInputs(), "sync");
    expect(res.written).toBe(true);

    const manifest = await readManifest();
    expect(manifest.schemaVersion).toBe(1);
    const agentEntry = manifest.outputs.find((o) => o.path === AGENT_PATH);
    expect(agentEntry?.emittedModel).toBe("claude-fable-5");
    expect(agentEntry?.emittedEffort).toBe("high");

    // Prefix-less output: JSON.stringify drops the undefined fields, so the
    // persisted row carries NO emitted* keys at all (old-reader-identical shape).
    const plainEntry = manifest.outputs.find((o) => o.path === "CLAUDE.md");
    expect(plainEntry).toBeDefined();
    expect(Object.keys(plainEntry!)).not.toContain("emittedModel");
    expect(Object.keys(plainEntry!)).not.toContain("emittedEffort");
  });

  it("stays idempotent across two identical runs — no generatedAt flip from the new fields", async () => {
    const first = await writeProvenance(tempDir, agentInputs(), "sync");
    expect(first.written).toBe(true);
    const stamped = await readManifest();
    const sentinelBytes =
      JSON.stringify({ ...stamped, generatedAt: SENTINEL_AT, lastRunId: SENTINEL_RUN }, null, 2) +
      "\n";
    await writeFile(provenancePath(), sentinelBytes, "utf-8");

    const second = await writeProvenance(tempDir, agentInputs(), "sync");
    expect(second.written).toBe(true);

    // Match branch carried the sentinels: the scalar fields did not break the
    // idempotency comparison, and the on-disk bytes are unchanged.
    expect(await readFile(provenancePath(), "utf-8")).toBe(sentinelBytes);
  });

  it("treats an emittedModel-only difference as a change: fresh generatedAt + refreshed scalar", async () => {
    const first = await writeProvenance(tempDir, agentInputs(), "sync");
    expect(first.written).toBe(true);
    const stamped = await readManifest();
    // Simulate a pre-move manifest: same contentHash (the model line lives in
    // the PREFIX, which the block hash never covers), different recorded model.
    const mutated: ProvenanceManifest = {
      ...stamped,
      generatedAt: SENTINEL_AT,
      lastRunId: SENTINEL_RUN,
      outputs: stamped.outputs.map((o) =>
        o.path === AGENT_PATH ? { ...o, emittedModel: "claude-old-model" } : o,
      ),
    };
    await writeFile(provenancePath(), JSON.stringify(mutated, null, 2) + "\n", "utf-8");

    const second = await writeProvenance(tempDir, agentInputs(), "sync");
    expect(second.written).toBe(true);

    const after = await readManifest();
    // The scalar difference invalidated the carry-forward…
    expect(after.generatedAt).not.toBe(SENTINEL_AT);
    expect(after.lastRunId).not.toBe(SENTINEL_RUN);
    // …and the persisted scalar refreshed to the emit-time value.
    expect(after.outputs.find((o) => o.path === AGENT_PATH)?.emittedModel).toBe("claude-fable-5");
  });
});

// release/2.7.1: `.hatch3r/provenance.json` is regenerable machine state, yet
// every content-changing regeneration force-overwrote it as an UNMANAGED file,
// so safeWriteFile's D1-SA1.5-F90 force path minted a `provenance.json.bak` on
// each such run (then uniquely-suffixed `.bak.<8hex>` siblings once the
// canonical slot was taken). The writer now passes `{ force: true,
// backup: false }` so no backup is ever created, and after EVERY successful
// write — including idempotent no-op runs — it best-effort deletes a stale
// `<provenancePath>.bak` left behind by a pre-2.7.1 writer. `.bak.<8hex>`
// siblings are deliberately NOT touched (the 7-day orphan sweep in
// safeWrite.ts owns their reclamation); a failed deletion emits exactly one
// warning on the existing onWarn channel while still returning written: true.
describe("writeProvenance .bak hygiene (release/2.7.1)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-bak-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const hatch3rDir = (): string => join(tempDir, HATCH3R_DIR);
  const provenancePath = (): string => join(hatch3rDir(), PROVENANCE_FILE);
  const bakPath = (): string => provenancePath() + ".bak";

  async function readManifest(): Promise<ProvenanceManifest> {
    return JSON.parse(await readFile(provenancePath(), "utf-8")) as ProvenanceManifest;
  }

  // One-output adapter set keyed by content, so consecutive calls with a
  // different body take the CHANGED-content path (idempotency mismatch →
  // real force-overwrite of the existing manifest), while identical bodies
  // take the idempotent match branch.
  const inputs = (body: string): { adapter: string; outputs: AdapterOutput[] }[] => [
    {
      adapter: "claude",
      outputs: [{ path: "CLAUDE.md", content: body, action: "create", sourceFiles: [] }],
    },
  ];

  it("never mints a provenance.json.bak* across content-changing re-runs", async () => {
    const onWarn = vi.fn();
    const first = await writeProvenance(tempDir, inputs("claude-v1"), "sync", { onWarn });
    expect(first.written).toBe(true);

    // Second run with CHANGED content force-overwrites the existing unmanaged
    // manifest — exactly the shape that minted a `.bak` before backup: false.
    const second = await writeProvenance(tempDir, inputs("claude-v2"), "sync", { onWarn });
    expect(second.written).toBe(true);

    const entries = await readdir(hatch3rDir());
    expect(entries.some((e) => e.includes(".bak"))).toBe(false);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("deletes a stale pre-2.7.1 .bak on a content-changing run and leaves .bak.<8hex> siblings alone", async () => {
    const first = await writeProvenance(tempDir, inputs("claude-v1"), "sync");
    expect(first.written).toBe(true);
    await writeFile(bakPath(), "stale pre-2.7.1 backup", "utf-8");
    await writeFile(bakPath() + ".deadbeef", "operator recovery copy", "utf-8");

    const onWarn = vi.fn();
    const second = await writeProvenance(tempDir, inputs("claude-v2"), "sync", { onWarn });
    expect(second.written).toBe(true);
    expect(onWarn).not.toHaveBeenCalled();

    const entries = await readdir(hatch3rDir());
    expect(entries).not.toContain(`${PROVENANCE_FILE}.bak`);
    // The uniquely-suffixed sibling is not the writer's to reclaim.
    expect(entries).toContain(`${PROVENANCE_FILE}.bak.deadbeef`);
    expect(await readFile(bakPath() + ".deadbeef", "utf-8")).toBe("operator recovery copy");
    // The manifest itself refreshed to the new content set.
    expect((await readManifest()).outputs.find((o) => o.path === "CLAUDE.md")).toBeDefined();
  });

  it("deletes a stale .bak on an idempotent no-op run too, keeping the manifest byte-identical", async () => {
    const first = await writeProvenance(tempDir, inputs("claude-v1"), "sync");
    expect(first.written).toBe(true);
    const bytesBefore = await readFile(provenancePath(), "utf-8");
    await writeFile(bakPath(), "stale pre-2.7.1 backup", "utf-8");
    await writeFile(bakPath() + ".deadbeef", "operator recovery copy", "utf-8");

    const onWarn = vi.fn();
    // Byte-identical inputs → the F2.7-F5 idempotency match branch (an
    // "unchanged" write) — the deletion contract covers this path as well.
    const second = await writeProvenance(tempDir, inputs("claude-v1"), "sync", { onWarn });
    expect(second.written).toBe(true);
    expect(onWarn).not.toHaveBeenCalled();

    const entries = await readdir(hatch3rDir());
    expect(entries).not.toContain(`${PROVENANCE_FILE}.bak`);
    expect(entries).toContain(`${PROVENANCE_FILE}.bak.deadbeef`);
    // The hygiene pass causes no spurious manifest rewrite on a no-op run.
    expect(await readFile(provenancePath(), "utf-8")).toBe(bytesBefore);
  });

  it("emits exactly one warning and still returns written:true when the stale-.bak deletion fails", async () => {
    const first = await writeProvenance(tempDir, inputs("claude-v1"), "sync");
    expect(first.written).toBe(true);
    // A NON-EMPTY directory at the .bak path: `rm` without `recursive`
    // rejects (EISDIR/ERR_FS_EISDIR on POSIX, EPERM on win32), and
    // `force: true` suppresses only ENOENT — a deterministic, cross-platform
    // deletion failure.
    await mkdir(bakPath());
    await writeFile(join(bakPath(), "occupant.txt"), "makes the dir non-empty", "utf-8");

    const onWarn = vi.fn();
    const second = await writeProvenance(tempDir, inputs("claude-v2"), "sync", { onWarn });

    // Best-effort: the failed cleanup is warned about, never fatal.
    expect(second.written).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(String(onWarn.mock.calls[0]?.[0])).toContain(".bak");
    // The manifest write itself succeeded and reflects the new content.
    const manifest = await readManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.outputs.find((o) => o.path === "CLAUDE.md")).toBeDefined();
  });
});
