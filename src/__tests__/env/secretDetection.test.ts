import { describe, it, expect } from "vitest";
import {
  maskValue,
  scanValueForSecrets,
  detectSecrets,
  formatSecretFindings,
} from "../../env/secretDetection.js";

describe("secretDetection", () => {
  describe("maskValue", () => {
    it("should mask values longer than 4 characters", () => {
      expect(maskValue("sk_live_12345678")).toBe("sk_l****");
    });

    it("should fully mask short values", () => {
      expect(maskValue("abc")).toBe("****");
      expect(maskValue("ab")).toBe("****");
    });
  });

  describe("scanValueForSecrets", () => {
    it("should detect AWS access keys", () => {
      const findings = scanValueForSecrets("AWS_KEY", "AKIAIOSFODNN7EXAMPLE");
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("AWS Access Key");
      expect(findings[0].severity).toBe("critical");
    });

    it("should detect GitHub personal access tokens (classic)", () => {
      const findings = scanValueForSecrets(
        "GITHUB_PAT",
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("GitHub Personal Access Token (classic)");
    });

    it("should detect private keys", () => {
      const findings = scanValueForSecrets(
        "SSH_KEY",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Private Key (PEM)");
      expect(findings[0].severity).toBe("critical");
    });

    it("should detect Stripe API keys", () => {
      const findings = scanValueForSecrets(
        "STRIPE_KEY",
        "sk_live_abcdefghijklmnopqrstuvwx",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Stripe API Key");
    });

    it("should detect connection strings with credentials", () => {
      const findings = scanValueForSecrets(
        "DATABASE_URL",
        "postgresql://user:password123@localhost:5432/mydb",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Connection String with Credentials");
      expect(findings[0].severity).toBe("high");
    });

    it("should return empty array for safe values", () => {
      expect(scanValueForSecrets("HOST", "localhost")).toEqual([]);
      expect(scanValueForSecrets("PORT", "5432")).toEqual([]);
      expect(scanValueForSecrets("MODE", "development")).toEqual([]);
    });

    it("should return empty array for empty values", () => {
      expect(scanValueForSecrets("EMPTY", "")).toEqual([]);
      expect(scanValueForSecrets("BLANK", "   ")).toEqual([]);
    });

    it("should include masked value in findings", () => {
      const findings = scanValueForSecrets(
        "KEY",
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      );
      expect(findings[0].maskedValue).toBe("ghp_****");
    });

    // D1-26: Azure DevOps PAT pattern currency + anchoring.
    it("should detect the 84-char Azure DevOps PAT marker form", () => {
      const adoPat = "A".repeat(75) + "AZDO" + "B".repeat(5); // 84 chars
      const findings = scanValueForSecrets("AZURE_DEVOPS_PAT", adoPat);
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Azure DevOps PAT");
      expect(findings[0].severity).toBe("high");
    });

    it("should not match the deprecated 52-char base32 form as an Azure DevOps PAT", () => {
      // Old stale pattern was /[a-z2-7]{52}$/ (52 lowercase base32 chars).
      // Use a non-credential variable name so the long-base64 catch-all
      // (contextRequired) stays inert and only the ADO pattern is in play.
      const oldBase32 = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst"; // 52 chars
      const findings = scanValueForSecrets("BUILD_ID", oldBase32);
      expect(findings.some((f) => f.secretType === "Azure DevOps PAT")).toBe(false);
    });

    it("should not match an Azure DevOps PAT as a tail substring of a longer value", () => {
      // Anchoring regression: prefix the valid 84-char token so the
      // unanchored-tail match the old pattern allowed cannot fire.
      const tail = "Z".repeat(75) + "AZDO" + "Y".repeat(5);
      const findings = scanValueForSecrets("BUILD_ID", "prefix-" + tail);
      expect(findings.some((f) => f.secretType === "Azure DevOps PAT")).toBe(false);
    });

    // D1-27: report the highest-severity match, not the first array match.
    it("should report the high provider-specific match over the medium base64 catch-all", () => {
      // The 84-char Azure DevOps PAT is pure alphanumerics, so it matches
      // BOTH the medium "Base64-encoded Secret (long)" catch-all (index 8)
      // AND the high "Azure DevOps PAT" pattern (later in the array). The
      // TOKEN-named variable grants the catch-all's credential-context gate,
      // so the catch-all is a live contender. Before the fix, first-match-wins
      // returned the medium base64 finding; after the fix, highest-severity
      // selection returns the high ADO finding regardless of array order.
      const adoPat = "A".repeat(75) + "AZDO" + "B".repeat(5); // 84 chars
      const findings = scanValueForSecrets("ADO_TOKEN", adoPat);
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Azure DevOps PAT");
      expect(findings[0].severity).toBe("high");
    });

    it("should still report the medium base64 catch-all when no higher-severity pattern matches", () => {
      const findings = scanValueForSecrets("API_TOKEN", "A".repeat(50));
      expect(findings).toHaveLength(1);
      expect(findings[0].secretType).toBe("Base64-encoded Secret (long)");
      expect(findings[0].severity).toBe("medium");
    });
  });

  describe("detectSecrets", () => {
    it("should scan all env vars and report findings", () => {
      const result = detectSecrets({
        SAFE_VAR: "hello",
        GITHUB_PAT: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
        HOST: "localhost",
      });
      expect(result.hasSecrets).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].variableName).toBe("GITHUB_PAT");
    });

    it("should report no secrets for clean env", () => {
      const result = detectSecrets({
        HOST: "localhost",
        PORT: "5432",
        MODE: "development",
      });
      expect(result.hasSecrets).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("should detect multiple secrets", () => {
      const result = detectSecrets({
        GH_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
        DB_URL: "postgresql://user:pass@host:5432/db",
      });
      expect(result.hasSecrets).toBe(true);
      expect(result.findings).toHaveLength(2);
    });
  });

  describe("formatSecretFindings", () => {
    it("should format clean result", () => {
      const result = detectSecrets({ SAFE: "ok" });
      const formatted = formatSecretFindings(result);
      expect(formatted).toContain("No secret patterns detected");
    });

    it("should format findings with severity and guidance", () => {
      const result = detectSecrets({
        TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      });
      const formatted = formatSecretFindings(result);
      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("TOKEN");
      expect(formatted).toContain("secrets manager");
    });
  });
});
