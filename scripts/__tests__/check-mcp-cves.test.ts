import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkMcpCves,
  discoverMcpPackages,
  extractPackageFromServer,
  formatTextReport,
  normalizeSeverity,
  parseCvssBase,
  type OsvVulnerability,
  type OsvQueryResponse,
} from "../check-mcp-cves.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  mcpDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "check-mcp-cves-"));
  const mcpDir = join(rootDir, "mcp");
  await mkdir(mcpDir, { recursive: true });
  return { rootDir, mcpDir };
}

async function writeMcpJson(
  mcpDir: string,
  filename: string,
  payload: unknown,
): Promise<void> {
  await writeFile(join(mcpDir, filename), JSON.stringify(payload, null, 2), "utf-8");
}

/** Build an OSV.dev-shaped vulnerability. */
function vuln(overrides: Partial<OsvVulnerability> = {}): OsvVulnerability {
  return {
    id: "GHSA-xxxx-yyyy-zzzz",
    summary: "Test advisory",
    published: "2026-01-01T00:00:00Z",
    database_specific: { severity: "HIGH" },
    ...overrides,
  };
}

/** Mock fetch that returns a queued response per call. */
function fakeFetcher(
  perCall: Array<{ status?: number; body: OsvQueryResponse } | Error>,
): typeof fetch {
  let i = 0;
  return (async (_url: string, _init?: RequestInit) => {
    const next = perCall[i++];
    if (next === undefined) {
      throw new Error("fakeFetcher: no more responses queued");
    }
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    return new Response(JSON.stringify(next.body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ── extractPackageFromServer ──────────────────────────────────────

describe("extractPackageFromServer", () => {
  it("extracts a scoped npm package with version from npx args", () => {
    const pkg = extractPackageFromServer("ctx7", "mcp/mcp.json", {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@2.1.1"],
    });
    expect(pkg).toEqual({
      server: "ctx7",
      sourceFile: "mcp/mcp.json",
      name: "@upstash/context7-mcp",
      version: "2.1.1",
    });
  });

  it("extracts an unscoped npm package with version", () => {
    const pkg = extractPackageFromServer("gl", "mcp/mcp.json", {
      command: "npx",
      args: ["-y", "glab@1.2.3", "mcp"],
    });
    expect(pkg).toEqual({
      server: "gl",
      sourceFile: "mcp/mcp.json",
      name: "glab",
      version: "1.2.3",
    });
  });

  it("returns null for a URL-transport entry (no local package)", () => {
    const pkg = extractPackageFromServer("github", "mcp/mcp.json", {
      url: "https://api.example.com/mcp/",
      headers: { Authorization: "Bearer x" },
    });
    expect(pkg).toBeNull();
  });

  it("returns null when command is not npx", () => {
    const pkg = extractPackageFromServer("custom", "mcp/mcp.json", {
      command: "node",
      args: ["server.js"],
    });
    expect(pkg).toBeNull();
  });

  it("handles a package spec without a pinned version", () => {
    const pkg = extractPackageFromServer("ctx", "mcp/mcp.json", {
      command: "npx",
      args: ["-y", "@scope/pkg"],
    });
    expect(pkg).toEqual({
      server: "ctx",
      sourceFile: "mcp/mcp.json",
      name: "@scope/pkg",
      version: undefined,
    });
  });

  it("skips leading flags when scanning args", () => {
    const pkg = extractPackageFromServer("fs", "mcp/mcp.json", {
      command: "npx",
      args: ["-y", "--no-install", "@modelcontextprotocol/server-filesystem@2026.1.14", "."],
    });
    expect(pkg?.name).toBe("@modelcontextprotocol/server-filesystem");
    expect(pkg?.version).toBe("2026.1.14");
  });
});

// ── discoverMcpPackages ───────────────────────────────────────────

describe("discoverMcpPackages", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns an empty array when the mcp dir is missing", async () => {
    const result = await discoverMcpPackages(join(fx.rootDir, "absent"));
    expect(result).toEqual([]);
  });

  it("discovers packages across every *.json file in the dir", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx7: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@2.1.1"],
        },
        github: {
          url: "https://api.example.com/mcp/",
        },
      },
    });
    await writeMcpJson(fx.mcpDir, "extra.json", {
      mcpServers: {
        extra: {
          command: "npx",
          args: ["-y", "extra-mcp@9.0.0"],
        },
      },
    });
    const result = await discoverMcpPackages(fx.mcpDir);
    expect(result).toHaveLength(2);
    const names = result.map((p) => p.name).sort();
    expect(names).toEqual(["@upstash/context7-mcp", "extra-mcp"]);
  });

  it("throws on a malformed JSON file", async () => {
    await writeFile(join(fx.mcpDir, "broken.json"), "{ not json", "utf-8");
    await expect(discoverMcpPackages(fx.mcpDir)).rejects.toThrow(/failed to parse/);
  });

  it("tolerates a file with no mcpServers key", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", { other: "key" });
    const result = await discoverMcpPackages(fx.mcpDir);
    expect(result).toEqual([]);
  });
});

// ── normalizeSeverity / parseCvssBase ─────────────────────────────

describe("normalizeSeverity", () => {
  it("reads database_specific.severity when present", () => {
    expect(normalizeSeverity(vuln({ database_specific: { severity: "CRITICAL" } }))).toBe(
      "CRITICAL",
    );
    expect(normalizeSeverity(vuln({ database_specific: { severity: "HIGH" } }))).toBe(
      "HIGH",
    );
    expect(normalizeSeverity(vuln({ database_specific: { severity: "MODERATE" } }))).toBe(
      "MODERATE",
    );
    expect(normalizeSeverity(vuln({ database_specific: { severity: "LOW" } }))).toBe("LOW");
  });

  it("maps MEDIUM to MODERATE (npm registry vs GHSA naming drift)", () => {
    expect(normalizeSeverity(vuln({ database_specific: { severity: "MEDIUM" } }))).toBe(
      "MODERATE",
    );
  });

  it("falls back to CVSS bucket when no database_specific severity", () => {
    expect(
      normalizeSeverity(
        vuln({
          database_specific: {},
          severity: [{ type: "CVSS_V3", score: "9.8" }],
        }),
      ),
    ).toBe("CRITICAL");
    expect(
      normalizeSeverity(
        vuln({
          database_specific: {},
          severity: [{ type: "CVSS_V3", score: "7.5" }],
        }),
      ),
    ).toBe("HIGH");
    expect(
      normalizeSeverity(
        vuln({
          database_specific: {},
          severity: [{ type: "CVSS_V3", score: "5.0" }],
        }),
      ),
    ).toBe("MODERATE");
    expect(
      normalizeSeverity(
        vuln({
          database_specific: {},
          severity: [{ type: "CVSS_V3", score: "2.5" }],
        }),
      ),
    ).toBe("LOW");
  });

  it("returns UNKNOWN when no severity signal is available", () => {
    expect(normalizeSeverity({ id: "X", database_specific: {} })).toBe("UNKNOWN");
  });
});

describe("parseCvssBase", () => {
  it("parses a bare numeric string", () => {
    expect(parseCvssBase("7.5")).toBe(7.5);
  });

  it("rejects out-of-range numbers", () => {
    expect(parseCvssBase("11.0")).toBeNull();
    expect(parseCvssBase("-1")).toBeNull();
  });

  it("returns null for a CVSS vector string", () => {
    expect(parseCvssBase("CVSS:3.1/AV:N/AC:L/PR:N/UI:N")).toBeNull();
  });

  it("returns null for undefined / empty input", () => {
    expect(parseCvssBase(undefined)).toBeNull();
    expect(parseCvssBase("")).toBeNull();
  });
});

// ── checkMcpCves end-to-end ───────────────────────────────────────

describe("checkMcpCves", () => {
  let fx: Fixture;
  const NOW = new Date("2026-05-18T00:00:00Z");
  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns no findings when OSV.dev reports no vulns", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      fetcher,
      now: () => NOW,
    });
    expect(report.packages).toHaveLength(1);
    expect(report.findings).toHaveLength(0);
    expect(report.staleFindings).toHaveLength(0);
    expect(report.queryErrors).toHaveLength(0);
  });

  it("flags a High advisory older than the max-age window as stale", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-old-high",
              published: "2026-01-01T00:00:00Z", // ~138 days before NOW
              database_specific: { severity: "HIGH" },
            }),
          ],
        },
      },
    ]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe("HIGH");
    expect(report.findings[0].ageDays).toBeGreaterThan(30);
    expect(report.staleFindings).toHaveLength(1);
  });

  it("does not flag a recent High advisory as stale", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-recent",
              published: "2026-05-10T00:00:00Z", // 8 days before NOW
              database_specific: { severity: "HIGH" },
            }),
          ],
        },
      },
    ]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].isStale).toBe(false);
    expect(report.staleFindings).toHaveLength(0);
  });

  it("ignores Moderate and Low advisories (only Critical/High are findings)", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-mod",
              database_specific: { severity: "MODERATE" },
              published: "2026-01-01T00:00:00Z",
            }),
            vuln({
              id: "GHSA-low",
              database_specific: { severity: "LOW" },
              published: "2026-01-01T00:00:00Z",
            }),
          ],
        },
      },
    ]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
  });

  it("records OSV.dev HTTP errors as queryErrors (warnings, not gate failures)", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([{ status: 503, body: { vulns: [] } }]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.queryErrors).toHaveLength(1);
    expect(report.queryErrors[0].reason).toMatch(/OSV.dev HTTP 503/);
    expect(report.findings).toHaveLength(0);
    expect(report.staleFindings).toHaveLength(0);
  });

  it("skips URL-transport MCP servers (no package to scan)", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        github: {
          url: "https://api.example.com/mcp/",
          headers: { Authorization: "Bearer x" },
        },
      },
    });
    const fetcher = fakeFetcher([]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.packages).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
  });

  it("queries OSV.dev once per package across multiple files", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        a: { command: "npx", args: ["-y", "pkg-a@1.0.0"] },
        b: { command: "npx", args: ["-y", "pkg-b@2.0.0"] },
      },
    });
    let calls = 0;
    const fetcher = (async (_u: string, _i?: RequestInit) => {
      calls++;
      return new Response(JSON.stringify({ vulns: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      fetcher,
      now: () => NOW,
    });
    expect(calls).toBe(2);
    expect(report.packages).toHaveLength(2);
  });

  it("falls back to `modified` when `published` is missing", async () => {
    await writeMcpJson(fx.mcpDir, "mcp.json", {
      mcpServers: {
        ctx: { command: "npx", args: ["-y", "@upstash/context7-mcp@2.1.1"] },
      },
    });
    const fetcher = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-mod-only",
              published: undefined,
              modified: "2026-01-01T00:00:00Z",
              database_specific: { severity: "CRITICAL" },
            }),
          ],
        },
      },
    ]);
    const report = await checkMcpCves({
      mcpDir: fx.mcpDir,
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ageDays).toBeGreaterThan(30);
    expect(report.staleFindings).toHaveLength(1);
  });
});

// ── formatTextReport ──────────────────────────────────────────────

describe("formatTextReport", () => {
  it("renders a clean report when no findings exist", () => {
    const out = formatTextReport({
      packages: [
        {
          server: "ctx",
          sourceFile: "mcp/mcp.json",
          name: "@upstash/context7-mcp",
          version: "2.1.1",
        },
      ],
      findings: [],
      staleFindings: [],
      maxAgeDays: 30,
      queryErrors: [],
    });
    expect(out).toMatch(/packages scanned: 1/);
    expect(out).toMatch(/Critical\/High findings: 0/);
    expect(out).toMatch(/No Critical\/High advisories/);
  });

  it("surfaces stale findings with the FAIL marker", () => {
    const out = formatTextReport({
      packages: [
        {
          server: "ctx",
          sourceFile: "mcp/mcp.json",
          name: "@upstash/context7-mcp",
          version: "2.1.1",
        },
      ],
      findings: [
        {
          pkg: {
            server: "ctx",
            sourceFile: "mcp/mcp.json",
            name: "@upstash/context7-mcp",
            version: "2.1.1",
          },
          id: "GHSA-old",
          summary: "Test summary",
          severity: "HIGH",
          publishedISO: "2026-01-01T00:00:00Z",
          ageDays: 138,
          isStale: true,
        },
      ],
      staleFindings: [
        {
          pkg: {
            server: "ctx",
            sourceFile: "mcp/mcp.json",
            name: "@upstash/context7-mcp",
            version: "2.1.1",
          },
          id: "GHSA-old",
          summary: "Test summary",
          severity: "HIGH",
          publishedISO: "2026-01-01T00:00:00Z",
          ageDays: 138,
          isStale: true,
        },
      ],
      maxAgeDays: 30,
      queryErrors: [],
    });
    expect(out).toMatch(/\[FAIL\] HIGH/);
    expect(out).toMatch(/GHSA-old/);
    expect(out).toMatch(/Bump pinned versions/);
  });
});
