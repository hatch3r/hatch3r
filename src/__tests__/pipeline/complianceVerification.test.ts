import { describe, it, expect } from "vitest";
import {
  runComplianceChecks,
  formatComplianceReport,
  detectResilienceInvocations,
} from "../../pipeline/complianceVerification.js";

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
  });
});
