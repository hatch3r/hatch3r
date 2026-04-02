import { describe, it, expect } from "vitest";
import {
  runComplianceChecks,
  formatComplianceReport,
} from "../../pipeline/complianceVerification.js";

describe("complianceVerification", () => {
  describe("runComplianceChecks", () => {
    it("should return a compliance report with all checks", () => {
      const report = runComplianceChecks();
      expect(report.timestamp).toBeTruthy();
      expect(report.checks.length).toBeGreaterThan(0);
      expect(report.summary.total).toBe(report.checks.length);
      expect(
        report.summary.passed + report.summary.failed + report.summary.warnings,
      ).toBe(report.summary.total);
    });

    it("should be compliant by default (no failed checks)", () => {
      const report = runComplianceChecks();
      expect(report.compliant).toBe(true);
      expect(report.summary.failed).toBe(0);
    });

    it("should include ASI01 checks for prompt guard limits", () => {
      const report = runComplianceChecks();
      const asi01Checks = report.checks.filter((c) => c.controlRef === "ASI01");
      expect(asi01Checks.length).toBeGreaterThanOrEqual(2);
      expect(asi01Checks.every((c) => c.status === "pass")).toBe(true);
    });

    it("should include ASI02 checks for tool allowlists", () => {
      const report = runComplianceChecks();
      const asi02Checks = report.checks.filter((c) => c.controlRef === "ASI02");
      expect(asi02Checks.length).toBeGreaterThanOrEqual(2);
    });

    it("should include ASI07 check for phase schemas", () => {
      const report = runComplianceChecks();
      const asi07 = report.checks.find((c) => c.id === "asi07-phase-schemas");
      expect(asi07).toBeDefined();
      expect(asi07!.status).toBe("pass");
    });

    it("should include review loop limit check", () => {
      const report = runComplianceChecks();
      const loopCheck = report.checks.find((c) => c.id === "review-loop-limit");
      expect(loopCheck).toBeDefined();
      expect(loopCheck!.status).toBe("pass");
    });

    it("should include pipeline timeout check", () => {
      const report = runComplianceChecks();
      const timeoutCheck = report.checks.find((c) => c.id === "pipeline-timeout");
      expect(timeoutCheck).toBeDefined();
      expect(timeoutCheck!.status).toBe("pass");
    });

    it("should include diff-hash verification check", () => {
      const report = runComplianceChecks();
      const hashCheck = report.checks.find((c) => c.id === "diff-hash-verify");
      expect(hashCheck).toBeDefined();
      expect(hashCheck!.status).toBe("pass");
    });

    it("should include least privilege check", () => {
      const report = runComplianceChecks();
      const lpCheck = report.checks.find((c) => c.id === "asi02-least-privilege");
      expect(lpCheck).toBeDefined();
      expect(lpCheck!.status).toBe("pass");
    });
  });

  describe("formatComplianceReport", () => {
    it("should format report with check results", () => {
      const report = runComplianceChecks();
      const lines = formatComplianceReport(report);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("PASS"))).toBe(true);
      expect(lines.some((l) => l.includes("passed"))).toBe(true);
    });

    it("should include control references in output", () => {
      const report = runComplianceChecks();
      const lines = formatComplianceReport(report);
      const joined = lines.join("\n");
      expect(joined).toContain("ASI01");
      expect(joined).toContain("ASI02");
      expect(joined).toContain("ASI07");
    });

    it("should not include NON-COMPLIANT when all checks pass", () => {
      const report = runComplianceChecks();
      const lines = formatComplianceReport(report);
      const joined = lines.join("\n");
      expect(joined).not.toContain("NON-COMPLIANT");
    });
  });
});
