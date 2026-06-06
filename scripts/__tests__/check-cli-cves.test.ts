import { describe, expect, it } from "vitest";

import type { CliToolMeta } from "../../src/cliTools/registry.js";
import {
  checkCliCves,
  formatTextReport,
  mapToolToOsvTarget,
  normalizeSeverity,
  parseCvssBase,
  securityNoteCitesAdvisoryId,
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
  it("maps the newly-added Go tools to their OSV ecosystems", () => {
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
    // az-devops is intentionally NOT mapped — see the SCAN_EXEMPT_TOOLS test
    // below (D21-SA21.5-F3); the PyPI `azure-devops` package is the unrelated
    // 7.x SDK, not the az `.whl` extension.
  });

  it("returns null for an unknown tool with no override", () => {
    expect(mapToolToOsvTarget(meta("totally-unknown-tool"))).toBeNull();
  });

  it("(D21-SA21.3-F1) maps Go modules on v2+ to a `/vN` major-version-suffixed coordinate", () => {
    // A base Go-module path silently matches only the v0/v1 record set on
    // OSV.dev, dropping the post-v1 advisory cluster. dasel (v3) + yq (v4)
    // MUST carry the major suffix.
    expect(mapToolToOsvTarget(meta("dasel"))?.name).toBe("github.com/tomwright/dasel/v3");
    expect(mapToolToOsvTarget(meta("dasel"))?.name.endsWith("/v3")).toBe(true);
    expect(mapToolToOsvTarget(meta("yq"))?.name).toBe("github.com/mikefarah/yq/v4");
    // podman (v5) + miller (v6) were already suffixed — re-assert to lock it.
    expect(mapToolToOsvTarget(meta("podman"))?.name.endsWith("/v5")).toBe(true);
    expect(mapToolToOsvTarget(meta("miller"))?.name.endsWith("/v6")).toBe(true);
  });

  it("(D21-SA21.5-F3) az-devops is no longer an ECOSYSTEM_OVERRIDES target (it is exempt)", () => {
    // az-devops must NOT map to a queryable OSV target — the PyPI azure-devops
    // package is the unrelated 7.x SDK, not the az `.whl` extension.
    expect(mapToolToOsvTarget(meta("az-devops"))).toBeNull();
  });

  it("sets citesAdvisoryId from the securityNote's advisory id (CD11 classifier)", () => {
    // CVE id present -> falsifiable advisory claim.
    expect(
      mapToolToOsvTarget(meta("docker", { securityNote: "CVE-2026-32288: DoS via crafted manifest" }))
        ?.citesAdvisoryId,
    ).toBe(true);
    // GHSA id present -> also a claim.
    expect(
      mapToolToOsvTarget(meta("gh", { securityNote: "GHSA-crc3-h8v6-qh57: token leak" }))
        ?.citesAdvisoryId,
    ).toBe(true);
    // Install-hygiene note (no id) -> not a claim OSV must corroborate.
    expect(
      mapToolToOsvTarget(meta("docker", { securityNote: "Unsigned install channel: prefer signed apt repo." }))
        ?.citesAdvisoryId,
    ).toBe(false);
    // No securityNote at all.
    expect(mapToolToOsvTarget(meta("docker"))?.citesAdvisoryId).toBe(false);
  });
});

describe("securityNoteCitesAdvisoryId", () => {
  it("detects CVE and GHSA ids, rejects hygiene prose and undefined", () => {
    expect(securityNoteCitesAdvisoryId("CVE-2026-7168 credential leak")).toBe(true);
    expect(securityNoteCitesAdvisoryId("GHSA-crc3-h8v6-qh57 token leak")).toBe(true);
    expect(securityNoteCitesAdvisoryId("CVE-2026-46377 / CVE-2026-46378 fixed in v3.11.0")).toBe(true);
    // Generic reference to "GHSA entries" with no concrete id is not a claim.
    expect(securityNoteCitesAdvisoryId("see the upstream GHSA advisories tab")).toBe(false);
    expect(securityNoteCitesAdvisoryId("Unsigned install channel; verify SHA-256")).toBe(false);
    expect(securityNoteCitesAdvisoryId(undefined)).toBe(false);
    expect(securityNoteCitesAdvisoryId("")).toBe(false);
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

  it("(D21-SA21.5-F3) az-devops lands in `exempted`, never in `targets`/`unmapped`, and is never queried", async () => {
    const { fetcher, bodies } = fakeFetcher([]);
    const report = await checkCliCves({
      registry: { "az-devops": meta("az-devops", { category: "forge", minVersion: "1.0.4" }) },
      fetcher,
      now: () => NOW,
    });
    expect(report.exempted.map((e) => e.meta.id)).toContain("az-devops");
    expect(report.exempted.find((e) => e.meta.id === "az-devops")?.reason).toMatch(
      /azure-devops|\.whl|REST SDK/i,
    );
    expect(report.unmapped).toHaveLength(0);
    expect(report.targets).toHaveLength(0);
    // The exempt tool must never be queried (no version-mismatched vacuous clean).
    expect(bodies).toHaveLength(0);
  });

  it("(D15-SA15.7-F1) an UNKNOWN-severity OSV record is surfaced in `unscoredAdvisories`, not silently dropped", async () => {
    // A Go GO-#### record arrives with no database_specific.severity and no
    // parseable CVSS -> normalizeSeverity returns UNKNOWN. It must surface for
    // manual review rather than vanish (the docker/podman/dasel blind spot).
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            {
              id: "GO-2026-4887",
              summary: "docker authorization-bypass (CVE-2026-34040)",
              published: "2026-05-01T00:00:00Z",
              database_specific: {},
            },
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { docker: meta("docker", { securityNote: "CVE-2026-34040 / GO-2026-4887" }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    // Not a Critical/High finding, but not lost either.
    expect(report.findings).toHaveLength(0);
    expect(report.unscoredAdvisories).toHaveLength(1);
    expect(report.unscoredAdvisories[0].id).toBe("GO-2026-4887");
    expect(report.unscoredAdvisories[0].target.tool).toBe("docker");
    expect(report.unscoredAdvisories[0].ageDays).toBe(33);
    // An UNKNOWN record IS a signal (the query hit something) -> the
    // advisory-citing target is NOT a vacuous 0-row certification.
    expect(report.vacuousCertifications).toHaveLength(0);
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

  // ── CD11 fail-closed: vacuous certification guard ───────────────
  // A securityNote that cites a concrete CVE/GHSA id is a falsifiable claim
  // that a published Critical/High advisory exists. If OSV returns a clean
  // 0-row response for such a tool (and it is not in VACUOUS_ACK), the gate
  // must fail closed — a clean result there is structurally vacuous, not a
  // real all-clear. `stagehand` maps to OSV (npm) and is NOT acknowledged in
  // VACUOUS_ACK, so it is used to exercise the gating path; the explicit
  // CVE-bearing securityNote here drives `citesAdvisoryId` regardless of the
  // tool's real registry note.
  const CVE_NOTE = "CVE-2026-99999: synthetic Critical advisory for the gate test";

  it("(CD11-1) an advisory-citing tool with a clean 0-row OSV response is a vacuous certification (gate FAILS)", async () => {
    const { fetcher } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: { stagehand: meta("stagehand", { securityNote: CVE_NOTE }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
    expect(report.staleFindings).toHaveLength(0);
    // The gate fails closed via vacuousCertifications, not staleFindings.
    expect(report.vacuousCertifications).toHaveLength(1);
    expect(report.vacuousCertifications[0].tool).toBe("stagehand");
    expect(report.vacuousCertifications[0].citesAdvisoryId).toBe(true);
    expect(report.acknowledgedVacuous).toHaveLength(0);
  });

  it("(CD11-2) an advisory-citing tool that DOES surface a Critical/High finding is NOT vacuous", async () => {
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-stagehand-real",
              published: "2026-05-25T00:00:00Z", // recent -> not stale, still a signal
              database_specific: { severity: "HIGH" },
            }),
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { stagehand: meta("stagehand", { securityNote: CVE_NOTE }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.vacuousCertifications).toHaveLength(0);
  });

  it("(CD11-3) an advisory-citing tool whose OSV query errors is NOT vacuous (the error is its own signal)", async () => {
    const { fetcher } = fakeFetcher([{ status: 503, body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: { stagehand: meta("stagehand", { securityNote: CVE_NOTE }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.queryErrors).toHaveLength(1);
    // A failed query did not silently certify the tool clean -> not vacuous.
    expect(report.vacuousCertifications).toHaveLength(0);
  });

  it("(CD11-4) a securityNote with NO advisory id (install-hygiene only) is never vacuous on a 0-row result", async () => {
    const { fetcher } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: {
        // Real-shaped hygiene note (unsigned install channel) — no CVE/GHSA id.
        stagehand: meta("stagehand", {
          securityNote: "Unsigned install channel: prefer the signed brew/winget channel and verify the published SHA-256.",
        }),
      },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
    // No concrete advisory id -> OSV's 0-row result is legitimately clean.
    expect(report.vacuousCertifications).toHaveLength(0);
    expect(report.targets[0].citesAdvisoryId).toBe(false);
  });

  it("(CD11-5) a tool with no securityNote at all returning 0 rows is never vacuous", async () => {
    const { fetcher } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      registry: { stagehand: meta("stagehand") }, // no securityNote
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
    expect(report.vacuousCertifications).toHaveLength(0);
    expect(report.targets[0].citesAdvisoryId).toBe(false);
  });

  it("(CD11-6) a Moderate-only OSV response for an advisory-citing tool is still vacuous (Moderate is not a Critical/High signal)", async () => {
    const { fetcher } = fakeFetcher([
      {
        body: {
          vulns: [
            vuln({
              id: "GHSA-stagehand-mod",
              database_specific: { severity: "MODERATE" },
              published: "2026-01-01T00:00:00Z",
            }),
          ],
        },
      },
    ]);
    const report = await checkCliCves({
      registry: { stagehand: meta("stagehand", { securityNote: CVE_NOTE }) },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0); // Moderate is not a finding
    // The cited advisory still produced no Critical/High signal -> vacuous.
    expect(report.vacuousCertifications).toHaveLength(1);
    expect(report.vacuousCertifications[0].tool).toBe("stagehand");
  });

  it("(CD11-7) a VACUOUS_ACK tool (docker) with a 0-row result is acknowledged, NOT gating", async () => {
    const { fetcher } = fakeFetcher([{ body: { vulns: [] } }]);
    const report = await checkCliCves({
      // docker's real registry securityNote cites CVE-2026-32288 etc. and docker
      // is listed in VACUOUS_ACK (GO-record blind spot, patched at the pin).
      registry: {
        docker: meta("docker", { securityNote: "CVE-2026-32288 / CVE-2026-41567: see release notes" }),
      },
      maxAgeDays: 30,
      fetcher,
      now: () => NOW,
    });
    expect(report.findings).toHaveLength(0);
    // The acknowledged tool does NOT fail the gate ...
    expect(report.vacuousCertifications).toHaveLength(0);
    // ... but is surfaced in the acknowledged-vacuous bucket for transparency.
    expect(report.acknowledgedVacuous.map((t) => t.tool)).toEqual(["docker"]);
  });

  it("(CD11-8) the real bundled registry produces ONLY VACUOUS_ACK-acknowledged 0-row tools — no unacknowledged vacuous certifications", async () => {
    // Real-deal guard (Decision 20): run the actual registry through a fetcher
    // that returns 0 vulns for every query (the worst case for the vacuous
    // gate). Every advisory-citing tool that yields 0 rows MUST be acknowledged
    // in VACUOUS_ACK; if a new advisory-citing tool is added without an
    // override that surfaces its CVE or a VACUOUS_ACK entry, this fails — which
    // is the fail-closed contract working. (No `registry` override -> real
    // AVAILABLE_CLI_TOOLS.)
    const zeroFetcher = (async () =>
      new Response(JSON.stringify({ vulns: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const report = await checkCliCves({ maxAgeDays: 30, fetcher: zeroFetcher, now: () => NOW });
    expect(
      report.vacuousCertifications.map((t) => t.tool),
      "every advisory-citing tool with a 0-row OSV result must be in VACUOUS_ACK",
    ).toEqual([]);
    // The acknowledged set is exactly the documented CVE-citing tools.
    // playwright joined at Cycle 11 (D21-4): its securityNote now cites
    // CVE-2025-59288 (installer MitM, fixed at the pinned 1.55.1) + CVE-2026-2441
    // (Chromium roll, not keyed under the npm @playwright/test coordinate), so a
    // 0-row Critical/High result is the documented expected-clean outcome.
    expect(report.acknowledgedVacuous.map((t) => t.tool).sort()).toEqual(
      ["curl", "dasel", "docker", "gh", "llm", "playwright", "podman"].sort(),
    );
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
    unscoredAdvisories: [],
    vacuousCertifications: [],
    acknowledgedVacuous: [],
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

  it("(D15-SA15.7-F1) renders the unscored-advisories review section with a [review] tag and no FAIL", () => {
    const unscored = {
      target: {
        tool: "docker",
        category: "container",
        ecosystem: "Go",
        name: "github.com/moby/moby",
        version: "29.5.2",
        citesAdvisoryId: true,
      },
      id: "GO-2026-4887",
      summary: "docker authorization-bypass (CVE-2026-34040)",
      publishedISO: "2026-05-01T00:00:00Z",
      ageDays: 33,
    };
    const out = formatTextReport(
      report({ targets: [unscored.target], unscoredAdvisories: [unscored] }),
      NOW,
    );
    expect(out).toMatch(/unscored advisories \(UNKNOWN severity, manual review, not gating\): 1/);
    expect(out).toMatch(/Unscored advisories \(OSV returned a record with no severity/);
    expect(out).toMatch(/\[review\] GO-2026-4887  docker \(Go\/github\.com\/moby\/moby@29\.5\.2\) \(33d\)/);
    // Manual-review surfacing is not a gate failure.
    expect(out).not.toMatch(/\[FAIL\]/);
    expect(out).not.toMatch(/gate FAILS closed/);
  });

  it("(CD11) renders the vacuous-certification FAIL section and a fail-closed gate line", () => {
    const vacuousTarget = {
      tool: "someforge",
      category: "forge",
      ecosystem: "Go",
      name: "github.com/acme/someforge",
      version: "1.2.3",
      citesAdvisoryId: true,
    };
    const out = formatTextReport(
      report({
        targets: [vacuousTarget],
        vacuousCertifications: [vacuousTarget],
      }),
      NOW,
    );
    // Header count, per-tool FAIL row, and the fail-closed summary line.
    expect(out).toMatch(/vacuous certifications \(advisory-citing tool, 0 OSV hits, gating\): 1/);
    expect(out).toMatch(/\[FAIL\] someforge \(Go\/github\.com\/acme\/someforge@1\.2\.3\)/);
    expect(out).toMatch(/securityNote cites a concrete advisory id, but OSV\.dev returned no Critical\/High match/);
    expect(out).toMatch(/known-advisory tool\(s\) returned 0 Critical\/High OSV matches/);
  });

  it("(CD11) renders the acknowledged-vacuous section with reason + reviewBy and no FAIL/gate line", () => {
    const ackTarget = {
      tool: "docker",
      category: "container",
      ecosystem: "Go",
      name: "github.com/moby/moby",
      version: "29.5.2",
      citesAdvisoryId: true,
    };
    const out = formatTextReport(
      report({ targets: [ackTarget], acknowledgedVacuous: [ackTarget] }),
      NOW,
    );
    expect(out).toMatch(/acknowledged vacuous \(advisory-citing, expected 0 OSV hits, not gating\): 1/);
    expect(out).toMatch(/\[ack\] docker \(Go\/github\.com\/moby\/moby@29\.5\.2\)/);
    // The documented reason text and review date render.
    expect(out).toMatch(/GO-record blind spot/);
    expect(out).toMatch(/review by 2026-09-05/);
    // No fail-closed marker or gate line for an acknowledged-only report.
    expect(out).not.toMatch(/\[FAIL\]/);
    expect(out).not.toMatch(/gate FAILS closed/);
  });
});
