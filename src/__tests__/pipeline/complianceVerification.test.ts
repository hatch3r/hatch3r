import { describe, it, expect } from "vitest";
import {
  runComplianceChecks,
  formatComplianceReport,
  detectResilienceInvocations,
  verifyMonotonicPrivilege,
  type EnforcementClass,
} from "../../pipeline/complianceVerification.js";
import { ALL_TOOL_CATEGORIES } from "../../pipeline/agentToolAllowlist.js";

describe("complianceVerification", () => {
  describe("runComplianceChecks", () => {
    it("should return a compliance report with all checks", async () => {
      const report = await runComplianceChecks();
      expect(report.timestamp).toBeTruthy();
      expect(report.checks.length).toBeGreaterThan(0);
      expect(report.summary.total).toBe(report.checks.length);
      expect(
        report.summary.passed + report.summary.failed + report.summary.warnings,
      ).toBe(report.summary.total);
    });

    it("should be compliant by default (no failed checks)", async () => {
      const report = await runComplianceChecks();
      expect(report.compliant).toBe(true);
      expect(report.summary.failed).toBe(0);
    });

    it("should include ASI01 checks for prompt guard limits", async () => {
      const report = await runComplianceChecks();
      const asi01Checks = report.checks.filter((c) => c.controlRef === "ASI01");
      expect(asi01Checks.length).toBeGreaterThanOrEqual(2);
      expect(asi01Checks.every((c) => c.status === "pass")).toBe(true);
    });

    it("should include ASI02 checks for tool allowlists", async () => {
      const report = await runComplianceChecks();
      const asi02Checks = report.checks.filter((c) => c.controlRef === "ASI02");
      expect(asi02Checks.length).toBeGreaterThanOrEqual(2);
    });

    it("should include ASI07 check for phase schemas", async () => {
      const report = await runComplianceChecks();
      const asi07 = report.checks.find((c) => c.id === "asi07-phase-schemas");
      expect(asi07).toBeDefined();
      expect(asi07!.status).toBe("pass");
    });

    it("should include review loop limit check", async () => {
      const report = await runComplianceChecks();
      const loopCheck = report.checks.find((c) => c.id === "review-loop-limit");
      expect(loopCheck).toBeDefined();
      expect(loopCheck!.status).toBe("pass");
    });

    it("should include pipeline timeout check", async () => {
      const report = await runComplianceChecks();
      const timeoutCheck = report.checks.find((c) => c.id === "pipeline-timeout");
      expect(timeoutCheck).toBeDefined();
      expect(timeoutCheck!.status).toBe("pass");
    });

    it("should include diff-hash verification check", async () => {
      const report = await runComplianceChecks();
      const hashCheck = report.checks.find((c) => c.id === "diff-hash-verify");
      expect(hashCheck).toBeDefined();
      expect(hashCheck!.status).toBe("pass");
    });

    // F15.2-H2: the diff-hash-verify check must EARN its pass via a round-trip
    // self-test, not the prior hard-coded tautology. Guard against regression
    // to the old static string and assert the detail reflects the real check
    // plus the truthful (agent-delegated) enforcement boundary.
    it("diff-hash-verify is de-tautologized: pass is earned by a round-trip self-test", async () => {
      const report = await runComplianceChecks();
      const hashCheck = report.checks.find((c) => c.id === "diff-hash-verify");
      expect(hashCheck).toBeDefined();
      // The old tautological detail must be gone.
      expect(hashCheck!.detail).not.toBe("SHA-256 diff hashing with disk verification enabled");
      // The detail now describes the self-test and the agent-delegated boundary.
      expect(hashCheck!.detail).toMatch(/round-trip self-test|tampered payload rejected/);
      expect(hashCheck!.detail).toMatch(/agent-delegated|Reviewer re-run required/);
      // The description names the self-test, not a generic "available" claim.
      expect(hashCheck!.description).toMatch(/self-test|contract is intact/);
    });

    // D15-21: the content-safety-patterns check must EARN its pass via a
    // scanForDeniedPatterns self-test over a malicious + clean fixture, not the
    // prior hard-coded tautology. Guard against regression to the static string.
    it("content-safety-patterns is de-tautologized: pass is earned by a deny-pattern self-test", async () => {
      const report = await runComplianceChecks();
      const check = report.checks.find((c) => c.id === "content-safety-patterns");
      expect(check).toBeDefined();
      expect(check!.status).toBe("pass");
      // The old tautological detail must be gone.
      expect(check!.detail).not.toBe(
        "Deny patterns cover prompt injection, code execution, exfiltration, and credential exposure",
      );
      // The detail now describes the self-test.
      expect(check!.detail).toMatch(/self-test|prompt-injection probe is flagged/);
      expect(check!.description).toMatch(/self-test|flag injection/);
    });

    // D15-21: the mcp-input-boundary check must EARN its pass by round-tripping a
    // poisoned MCP entry through scanMcpServers and asserting _description is
    // stripped, not the prior hard-coded tautology.
    it("mcp-input-boundary is de-tautologized: pass is earned by a poisoned-entry round-trip", async () => {
      const report = await runComplianceChecks();
      const check = report.checks.find((c) => c.id === "mcp-input-boundary");
      expect(check).toBeDefined();
      expect(check!.status).toBe("pass");
      expect(check!.detail).not.toBe(
        "MCP-specific injection patterns and tool delimiter detection enabled",
      );
      expect(check!.detail).toMatch(/self-test|poisoned _description is flagged|stripped/);
      expect(check!.description).toMatch(/self-test|flag and strip/);
    });

    // D15-21: the mcp-integrity-coverage check must EARN its pass by asserting the
    // timeout bounds are in range and `_`-prefixed integrity markers are stripped,
    // not the prior hard-coded tautology.
    it("mcp-integrity-coverage is de-tautologized: pass is earned by a timeout-bound + strip self-test", async () => {
      const report = await runComplianceChecks();
      const check = report.checks.find((c) => c.id === "mcp-integrity-coverage");
      expect(check).toBeDefined();
      expect(check!.status).toBe("pass");
      expect(check!.detail).not.toBe(
        "Integrity scans include mcp/ directory (.json files). MCP timeout configurable per-server (default: 30s, max: 5m)",
      );
      expect(check!.detail).toMatch(/self-test|markers .*stripped|timeout bounds in range/);
      expect(check!.description).toMatch(/self-test|stripped \+ timeout bounded/);
    });

    it("should include least privilege check", async () => {
      const report = await runComplianceChecks();
      const lpCheck = report.checks.find((c) => c.id === "asi02-least-privilege");
      expect(lpCheck).toBeDefined();
      expect(lpCheck!.status).toBe("pass");
    });

    it("should include a resilience-wiring check for every required module", async () => {
      const report = await runComplianceChecks();
      const required = [
        "circuitbreaker",
        "adaptertimeout",
        "phasetimeout",
        "pipelinetimeout",
        "phaseoutputschema",
        "retrywithbackoff",
      ];
      for (const mod of required) {
        const check = report.checks.find((c) => c.id === `resilience-${mod}`);
        expect(check, `expected resilience check for ${mod}`).toBeDefined();
        expect(check!.controlRef).toBe("ASI08");
      }
    });

    it("should report PASS for every wired resilience module (regression)", async () => {
      const report = await runComplianceChecks();
      const resilienceChecks = report.checks.filter((c) => c.controlRef === "ASI08");
      expect(resilienceChecks.length).toBeGreaterThan(0);
      const failed = resilienceChecks.filter((c) => c.status === "fail");
      expect(
        failed,
        `unwired resilience modules: ${failed.map((f) => f.id).join(", ")}`,
      ).toEqual([]);
    });

    // D15-SA15.3-01 (Cycle-12): the per-commit ASI self-assessment must cover
    // all ten official OWASP ASI:2026 categories. This enumeration invariant
    // binds the check set to the fixed taxonomy so the report can no longer
    // drift to the prior 40%-labeled, pseudo-ref scheme (ASI-LOOP/-TIMEOUT/
    // -RESILIENCE/-MCP/-CONTENT/-INTEGRITY) that hid 6 of 10 categories.
    it("labels every one of the ten official ASI:2026 categories at least once", async () => {
      const report = await runComplianceChecks();
      const refs = new Set(report.checks.map((c) => c.controlRef));
      for (let n = 1; n <= 10; n++) {
        const id = `ASI${String(n).padStart(2, "0")}`;
        expect(refs.has(id), `missing official ASI control ${id}`).toBe(true);
      }
    });

    // D15-SA15.3-01: no invented `ASI-*` pseudo-ref may survive — every
    // controlRef is an official `ASI0N` id, honoring the field contract that
    // declares controlRef holds an ASI control reference.
    it("uses only official ASI0N control references (no ASI-* pseudo-refs)", async () => {
      const report = await runComplianceChecks();
      for (const check of report.checks) {
        expect(check.controlRef, `pseudo-ref on ${check.id}`).toMatch(
          /^ASI(0[1-9]|10)$/,
        );
      }
    });

    // D15-SA15.3-01: ASI05 was the only category with no existing check to
    // relabel; the new explicit check earns its pass by flagging a
    // `curl … | bash` remote-code-execution injection probe.
    it("includes an earned ASI05 code-execution check", async () => {
      const report = await runComplianceChecks();
      const asi05 = report.checks.find((c) => c.id === "asi05-code-execution");
      expect(asi05).toBeDefined();
      expect(asi05!.controlRef).toBe("ASI05");
      expect(asi05!.status).toBe("pass");
    });

    // D15-SA15.6-01: the D15 crosswalk ASI03 row cites `validate asi03-*`, a glob
    // that resolved to zero checks (the only ASI03 token was a controlRef on
    // asi02-monotonic-privilege, a tool-allowlist containment test). This genuine
    // asi03-agent-identity check makes the cite resolve and EARNS its pass by
    // round-tripping the agentIdentity provenance contract (annotate → verify
    // agent/phase → reject mismatch).
    it("includes an earned asi03-agent-identity check that resolves the `validate asi03-*` cite", async () => {
      const report = await runComplianceChecks();
      const asi03 = report.checks.find((c) => c.id === "asi03-agent-identity");
      expect(asi03).toBeDefined();
      expect(asi03!.controlRef).toBe("ASI03");
      expect(asi03!.status).toBe("pass");
      expect(asi03!.enforcement).toBe("library-contract-for-downstream");
      expect(asi03!.detail).toMatch(/round-trip self-test|provenance/);
      // The `validate asi03-*` glob now resolves to >=1 check id.
      expect(report.checks.some((c) => c.id.startsWith("asi03"))).toBe(true);
    });

    // D15-SA15.3-02: agentIdentity.ts was 0-caller dead code whose ASI10 drift
    // fingerprint was never exercised on a CLI path, yet carried a weekly test
    // reading as active coverage. This asi10-capability-drift check wires the
    // fingerprint onto the validate path and EARNS its pass by round-tripping
    // detectCapabilityGoalDrift (unchanged → no drift; widened caps → drift).
    it("includes an earned asi10-capability-drift check that wires the agentIdentity drift fingerprint", async () => {
      const report = await runComplianceChecks();
      const drift = report.checks.find((c) => c.id === "asi10-capability-drift");
      expect(drift).toBeDefined();
      expect(drift!.controlRef).toBe("ASI10");
      expect(drift!.status).toBe("pass");
      expect(drift!.enforcement).toBe("library-contract-for-downstream");
      expect(drift!.detail).toMatch(/self-test|drift fingerprint/);
    });
  });

  describe("detectResilienceInvocations", () => {
    it("should return a set containing every wired module", async () => {
      const invoked = await detectResilienceInvocations();
      // Each of these modules MUST be imported by at least one CLI command.
      // Adding a new resilience module without wiring it should make this fail.
      expect(invoked.has("circuitBreaker")).toBe(true);
      expect(invoked.has("adapterTimeout")).toBe(true);
      expect(invoked.has("phaseTimeout")).toBe(true);
      expect(invoked.has("pipelineTimeout")).toBe(true);
      expect(invoked.has("phaseOutputSchema")).toBe(true);
      expect(invoked.has("retryWithBackoff")).toBe(true);
    });
  });

  describe("formatComplianceReport", () => {
    it("should format report with check results", async () => {
      const report = await runComplianceChecks();
      const lines = formatComplianceReport(report);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("PASS"))).toBe(true);
      expect(lines.some((l) => l.includes("passed"))).toBe(true);
    });

    it("should include control references in output", async () => {
      const report = await runComplianceChecks();
      const lines = formatComplianceReport(report);
      const joined = lines.join("\n");
      expect(joined).toContain("ASI01");
      expect(joined).toContain("ASI02");
      expect(joined).toContain("ASI07");
      expect(joined).toContain("ASI08");
    });

    it("should not include NON-COMPLIANT when all checks pass", async () => {
      const report = await runComplianceChecks();
      const lines = formatComplianceReport(report);
      const joined = lines.join("\n");
      expect(joined).not.toContain("NON-COMPLIANT");
    });

    // D15-4: the report mirrors the Enforcement column of the
    // Control-to-Trust Mapping so a library contract is never read as a live
    // CLI gate. Each rendered check line carries its enforcement class.
    it("mirrors the enforcement class into every rendered check line", async () => {
      const report = await runComplianceChecks();
      const lines = formatComplianceReport(report);
      const checkLines = lines.filter(
        (l) => l.includes("[PASS]") || l.includes("[FAIL]") || l.includes("[WARN]"),
      );
      expect(checkLines.length).toBe(report.checks.length);
      for (const line of checkLines) {
        expect(line).toMatch(
          /\((runtime-CLI|setup-time-shape-check|library-contract-for-downstream|prompt-directive)\)/,
        );
      }
    });
  });

  // D15-4: every compliance check declares an enforcement class, and the
  // library-only controls (reviewLoop, diffHash — both @library_export_only with
  // 0 CLI importers) are not mislabeled as runtime-CLI gates.
  describe("D15-4: enforcement classification", () => {
    const VALID: ReadonlyArray<EnforcementClass> = [
      "runtime-CLI",
      "setup-time-shape-check",
      "library-contract-for-downstream",
      "prompt-directive",
    ];

    it("assigns a valid enforcement class to every check", async () => {
      const report = await runComplianceChecks();
      for (const check of report.checks) {
        expect(VALID, `enforcement for ${check.id}`).toContain(check.enforcement);
      }
    });

    it("classifies the @library_export_only controls as library-contract-for-downstream", async () => {
      const report = await runComplianceChecks();
      const reviewLoop = report.checks.find((c) => c.id === "review-loop-limit");
      const diffHash = report.checks.find((c) => c.id === "diff-hash-verify");
      // D15-SA15.6-01 / D15-SA15.3-02: agentIdentity.ts is the third
      // @library_export_only module self-tested by validate (mirrors
      // diffHash/reviewLoop) — its provenance + drift checks must carry the
      // same class so the report never implies a live CLI gate.
      const agentIdentity = report.checks.find((c) => c.id === "asi03-agent-identity");
      const drift = report.checks.find((c) => c.id === "asi10-capability-drift");
      expect(reviewLoop?.enforcement).toBe("library-contract-for-downstream");
      expect(diffHash?.enforcement).toBe("library-contract-for-downstream");
      expect(agentIdentity?.enforcement).toBe("library-contract-for-downstream");
      expect(drift?.enforcement).toBe("library-contract-for-downstream");
    });

    it("classifies CLI-wired controls as runtime-CLI", async () => {
      const report = await runComplianceChecks();
      const asi07 = report.checks.find((c) => c.id === "asi07-phase-schemas");
      const pipelineTimeout = report.checks.find((c) => c.id === "pipeline-timeout");
      expect(asi07?.enforcement).toBe("runtime-CLI");
      expect(pipelineTimeout?.enforcement).toBe("runtime-CLI");
    });
  });

  describe("D15-M12: verifyMonotonicPrivilege", () => {
    it("returns ok=true for the canonical registry (no agent exceeds the orchestrator root)", () => {
      const report = verifyMonotonicPrivilege();
      expect(report.ok).toBe(true);
      expect(report.violations).toEqual([]);
    });

    it("flags an agent that declares a category outside ALL_TOOL_CATEGORIES", () => {
      const report = verifyMonotonicPrivilege([
        {
          agentId: "test-agent",
          allowedTools: ["read", "rogue-category"],
          description: "test",
        },
      ]);
      expect(report.ok).toBe(false);
      expect(report.violations.some((v) => v.kind === "unknown_category")).toBe(true);
    });

    it("flags an agent that holds every canonical category at once", () => {
      const report = verifyMonotonicPrivilege([
        {
          agentId: "god-agent",
          allowedTools: [...ALL_TOOL_CATEGORIES],
          description: "test — should fail",
        },
      ]);
      expect(report.ok).toBe(false);
      expect(report.violations.some((v) => v.kind === "universal_allowlist")).toBe(true);
    });

    it("is wired into the compliance report as 'asi02-monotonic-privilege'", async () => {
      const report = await runComplianceChecks();
      const check = report.checks.find((c) => c.id === "asi02-monotonic-privilege");
      expect(check).toBeDefined();
      expect(check!.status).toBe("pass");
    });
  });
});
