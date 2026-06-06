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
        expect(check!.controlRef).toBe("ASI-RESILIENCE");
      }
    });

    it("should report PASS for every wired resilience module (regression)", async () => {
      const report = await runComplianceChecks();
      const resilienceChecks = report.checks.filter((c) => c.controlRef === "ASI-RESILIENCE");
      expect(resilienceChecks.length).toBeGreaterThan(0);
      const failed = resilienceChecks.filter((c) => c.status === "fail");
      expect(
        failed,
        `unwired resilience modules: ${failed.map((f) => f.id).join(", ")}`,
      ).toEqual([]);
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
      expect(joined).toContain("ASI-RESILIENCE");
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
      expect(reviewLoop?.enforcement).toBe("library-contract-for-downstream");
      expect(diffHash?.enforcement).toBe("library-contract-for-downstream");
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
