import { describe, expect, it } from "vitest";

import type { CliToolMeta } from "../../src/cliTools/registry.js";
import {
  checkCliCves,
  formatTextReport,
  mapToolToOsvTarget,
  normalizeSeverity,
  parseCvssBase,
  type CheckReport,
  type OsvQueryResponse,
  type OsvVulnerability,
} from "../check-cli-cves.js";

// ── Fixture helpers ────────────────────────────────────────────────

const NOW = new Date("2026-06-03T00:00:00Z");

/**
 * Build a minimal CliToolMeta for tests. `id` is the load-bearing key (it
 * drives ECOSYSTEM_OVERRIDES + SCAN_EXEMPT_TOOLS lookup); the rest are filler.
 * Real ids ("docker", "rtk") are required to exercise the override/exempt
 * tables — they are cast through CliToolMeta["id"] because the union is closed.
 */
function meta(id: string, overrides: Partial<CliToolMeta> = {}): CliToolMeta {
  return {
    id: id as CliToolMeta["id"],
    probe: id,
    description: `test ${id}`,
    category: "search",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: `brew install ${id}` }],
      linux: [{ manager: "apt", command: `sudo apt install ${id}` }],
      win: [{ manager: "scoop", command: `scoop install ${id}` }],
    },
    ...overrides,
  } as CliToolMeta;
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

/**
 * Mock fetch that returns a queued response per call and records the request
 * bodies so tests can assert which targets were (not) queried.
 */
function fakeFetcher(
  perCall: Array<{ status?: number; body: OsvQueryResponse } | Error>,
): { fetcher: typeof fetch; bodies: Array<Record<string, unknown>> } {
  let i = 0;
  const bodies: Array<Record<string, unknown>> = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
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
  return { fetcher, bodies };
}

// ── mapToolToOsvTarget (Part 2 mappings) ──────────────────────────

describe("mapToolToOsvTarget", () => {
  it("maps the 6 newly-added tools to their OSV ecosystems", () => {
    expect(mapToolToOsvTarget(meta("docker"))).toMatchObject({
      ecosystem: "Go",
      name: "github.com/moby/moby",
    });
    expect(mapToolToOsvTarget(meta("podman"))).toMatchObject({
      ecosystem: "Go",
      name: "github.com/containers/podman/v5",
    });
    expect(mapToolToOsvTarget(meta("mods"))).toMatchObject({
      ecosystem: "Go",
      name: "github.com/charmbracelet/mods",
    });
    expect(mapToolToOsvTarget(meta("miller"))).toMatchObject({
      ecosystem: "Go",
      name: "github.com/johnkerl/miller/v6",
    });
    expect(mapToolToOsvTarget(meta("container-use"))).toMatchObject({
      ecosystem: "Go",
      name: "github.com/dagger/container-use",
    });
    expect(mapToolToOsvTarget(meta("az-devops"))).toMatchObject({
      ecosystem: "PyPI",
      name: "azure-devops",
    });
  });

  it("returns null for an unknown tool with no override", () => {
    expect(mapToolToOsvTarget(meta("totally-unknown-tool"))).toBeNull();
  });
});

// ── checkCliCves end-to-end ───────────────────────────────────────

describe("checkCliCves", () => {
  it("(1) a mapped tool with a clean OSV response yields no finding and a target", async () => {
    const { fetcher } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: { docker: meta("docker", { minVersion: ">=29.5.2" }) },
      fetcher,
      now: () => NOW,
    });
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]).toMatchObject({ tool: "docker", ecosystem: "Go" });
    expect(report.findings).toHaveLength(0);
    expect(report.unmapped).toHaveLength(0);
    expect(report.exempted).toHaveLength(0);
  });

  it("(2) a scan-exempt tool lands in `exempted`, never in `unmapped`, and is never queried", async () => {
    const { fetcher, bodies } = fakeFetcher([]);
    const report = await checkCliCves({
      registry: { rtk: meta("rtk", { tier: 3, category: "ai" }) },
      fetcher,
      now: () => NOW,
    });
    expect(report.exempted).toHaveLength(1);
    expect(report.exempted[0].meta.id).toBe("rtk");
    expect(report.exempted[0].reason).toMatch(/no OSV advisory package/i);
    expect(report.unmapped).toHaveLength(0);
    expect(report.targets).toHaveLength(0);
    // The exempt tool must never be queried.
    expect(bodies).toHaveLength(0);
  });

  it("(2b) comby is also exempt and not queried even when mixed with a mapped tool", async () => {
    const { fetcher, bodies } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: {
        comby: meta("comby"),
        docker: meta("docker"),
      },
      fetcher,
      now: () => NOW,
    });
    expect(report.exempted.map((e) => e.meta.id)).toContain("comby");
    expect(report.targets.map((t) => t.tool)).toEqual(["docker"]);
    // Exactly one query — for docker only; comby was skipped.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      package: { name: "github.com/moby/moby", ecosystem: "Go" },
    });
  });

  it("(3) an acknowledged Critical+stale advisory is a finding with acknowledged=true but absent from staleFindings", async () => {
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-g76p-4vg5-f4qh", // in ACKNOWLEDGED_ADVISORIES
              published: "2026-01-01T00:00:00Z", // ~153 days before NOW -> stale
              database_specific: { severity: "CRITICAL" },
            }),
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { llm: meta("llm", { category: "ai" }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].acknowledged).toBe(true);
    expect(report.findings[0].isStale).toBe(true);
    expect(report.findings[0].severity).toBe("CRITICAL");
    // Gate-relevant set excludes the acknowledged advisory -> gate would pass.
    expect(report.staleFindings).toHaveLength(0);
    expect(report.acknowledgedFindings).toHaveLength(1);
  });

  it("(4) a non-acknowledged Critical+stale advisory is present in staleFindings (gate would fail)", async () => {
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-not-acknowledged",
              published: "2026-01-01T00:00:00Z", // stale relative to NOW
              database_specific: { severity: "CRITICAL" },
            }),
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { docker: meta("docker") },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].acknowledged).toBe(false);
    expect(report.staleFindings).toHaveLength(1);
    expect(report.staleFindings[0].id).toBe("GHSA-not-acknowledged");
  });

  it("(5) a tool with no override and not exempt lands in `unmapped`", async () => {
    const { fetcher, bodies } = fakeFetcher([]);
    const report = await checkCliCves({
      registry: { "totally-unknown-tool": meta("totally-unknown-tool") },
      fetcher,
      now: () => NOW,
    });
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0].id).toBe("totally-unknown-tool");
    expect(report.targets).toHaveLength(0);
    expect(report.exempted).toHaveLength(0);
    expect(bodies).toHaveLength(0);
  });

  it("does not flag a Moderate advisory (only Critical/High are findings)", async () => {
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-mod",
              database_specific: { severity: "MODERATE" },
              published: "2026-01-01T00:00:00Z",
            }),
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { docker: meta("docker") },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
  });

  it("records OSV.dev HTTP errors as queryErrors (warnings, not gate failures)", async () => {
    const { fetcher } = fakeFetcher([{ status: 503, body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: { docker: meta("docker") },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.queryErrors).toHaveLength(1);
    expect(report.queryErrors[0].reason).toMatch(/OSV.dev HTTP 503/);
    expect(report.findings).toHaveLength(0);
    expect(report.staleFindings).toHaveLength(0);
  });
});

// ── normalizeSeverity / parseCvssBase (mirrors check-mcp-cves) ─────

describe("normalizeSeverity", () => {
  it("reads database_specific.severity when present", () => {
    expect(normalizeSeverity(vuln({ database_specific: { severity: "CRITICAL" } }))).toBe(
      "CRITICAL",
    );
    expect(normalizeSeverity(vuln({ database_specific: { severity: "LOW" } }))).toBe("LOW");
  });

  it("returns UNKNOWN with no severity signal (the docker/podman GO-record blind spot)", () => {
    // GO-#### records arrive without numeric severity; this is why docker /
    // podman HIGH advisories are filtered out and tracked in securityNote.
    expect(normalizeSeverity({ id: "GO-2026-0001", database_specific: {} })).toBe("UNKNOWN");
  });

  it("falls back to the CVSS bucket when no database_specific severity", () => {
    expect(
      normalizeSeverity(vuln({ database_specific: {}, severity: [{ score: "9.8" }] })),
    ).toBe("CRITICAL");
  });
});

describe("parseCvssBase", () => {
  it("parses a bare numeric string and rejects out-of-range / vectors", () => {
    expect(parseCvssBase("7.5")).toBe(7.5);
    expect(parseCvssBase("11.0")).toBeNull();
    expect(parseCvssBase("CVSS:3.1/AV:N/AC:L/PR:N/UI:N")).toBeNull();
    expect(parseCvssBase(undefined)).toBeNull();
  });
});

// ── formatTextReport ──────────────────────────────────────────────

/** Assemble a CheckReport with sane defaults for formatTextReport tests. */
function report(overrides: Partial<CheckReport> = {}): CheckReport {
  return {
    targets: [],
    findings: [],
    staleFindings: [],
    acknowledgedFindings: [],
    maxAgeDays: 30,
    queryErrors: [],
    unmapped: [],
    exempted: [],
    ...overrides,
  };
}

describe("formatTextReport", () => {
  it("(6a) renders the exempted section and a zero unmapped count", () => {
    const out = formatTextReport(
      report({
        targets: [
          { tool: "docker", category: "container", ecosystem: "Go", name: "github.com/moby/moby" },
        ],
        exempted: [{ meta: meta("rtk", { category: "ai" }), reason: "no OSV advisory package" }],
      }),
      NOW,
    );
    expect(out).toMatch(/unmapped registry entries: 0/);
    expect(out).toMatch(/exempted \(intentionally not OSV-scanned\): 1/);
    expect(out).toMatch(/Exempted \(intentionally not OSV-scanned, see SCAN_EXEMPT_TOOLS\):/);
    expect(out).toMatch(/- rtk \(ai\): no OSV advisory package/);
  });

  it("(6b) renders an acknowledged advisory with the [ack] tag + reason and excludes it from the gate line", () => {
    const ackFinding = {
      target: { tool: "llm", category: "ai", ecosystem: "PyPI", name: "llm", version: undefined },
      id: "GHSA-g76p-4vg5-f4qh",
      summary: "code-injection",
      severity: "CRITICAL" as const,
      publishedISO: "2026-01-01T00:00:00Z",
      ageDays: 153,
      isStale: true,
      acknowledged: true,
    };
    const out = formatTextReport(
      report({
        targets: [
          { tool: "llm", category: "ai", ecosystem: "PyPI", name: "llm", version: undefined },
        ],
        findings: [ackFinding],
        staleFindings: [],
        acknowledgedFindings: [ackFinding],
      }),
      NOW,
    );
    expect(out).toMatch(/\[ack\] CRITICAL/);
    expect(out).toMatch(/acknowledged: llm --functions code-injection is by-design/);
    expect(out).toMatch(/review by 2026-09-01/);
    // No FAIL marker, and the gate line reports zero gating advisories.
    expect(out).not.toMatch(/\[FAIL\]/);
    expect(out).toMatch(/No gating Critical\/High advisories/);
  });

  it("prints a 'review overdue' note when reviewBy is in the past (no exit-code change)", () => {
    const ackFinding = {
      target: { tool: "llm", category: "ai", ecosystem: "PyPI", name: "llm", version: undefined },
      id: "GHSA-g76p-4vg5-f4qh",
      summary: "code-injection",
      severity: "CRITICAL" as const,
      publishedISO: "2026-01-01T00:00:00Z",
      ageDays: 300,
      isStale: true,
      acknowledged: true,
    };
    // reviewBy is 2026-09-01; pick a `now` after it.
    const out = formatTextReport(
      report({ findings: [ackFinding], acknowledgedFindings: [ackFinding] }),
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(out).toMatch(/review overdue \(reviewBy 2026-09-01 has passed\)/);
  });

  it("surfaces a stale non-acknowledged finding with the FAIL marker", () => {
    const staleFinding = {
      target: { tool: "docker", category: "container", ecosystem: "Go", name: "github.com/moby/moby", version: ">=29.5.2" },
      id: "GHSA-not-acknowledged",
      summary: "Test summary",
      severity: "CRITICAL" as const,
      publishedISO: "2026-01-01T00:00:00Z",
      ageDays: 153,
      isStale: true,
      acknowledged: false,
    };
    const out = formatTextReport(
      report({ findings: [staleFinding], staleFindings: [staleFinding] }),
      NOW,
    );
    expect(out).toMatch(/\[FAIL\] CRITICAL/);
    expect(out).toMatch(/older than 30 days/);
  });
});
