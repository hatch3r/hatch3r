/**
 * Secret pattern detection for MCP environment variable configuration.
 *
 * Scans environment variable values for accidentally included secrets
 * such as API keys, tokens, passwords, and private keys. This prevents
 * secrets from being committed to version control or leaked through
 * configuration files.
 *
 * Finding #82 (D15, High): Add secret pattern detection to MCP env validation.
 */

// ── Types ────────────────────────────────────────────────────────

export interface SecretPattern {
  /** Name of the secret type being detected. */
  name: string;
  /** Regular expression to match the secret pattern. */
  pattern: RegExp;
  /** Severity of the finding. */
  severity: "critical" | "high" | "medium";
  /** Guidance for the user. */
  guidance: string;
}

export interface SecretDetectionResult {
  /** Whether any secrets were detected. */
  hasSecrets: boolean;
  /** Details of each detected secret. */
  findings: SecretFinding[];
}

export interface SecretFinding {
  /** Name of the variable containing the secret. */
  variableName: string;
  /** Type of secret detected. */
  secretType: string;
  /** Severity level. */
  severity: "critical" | "high" | "medium";
  /** Guidance for remediation. */
  guidance: string;
  /** Masked preview of the value (first 4 chars + ***). */
  maskedValue: string;
}

// ── Patterns ─────────────────────────────────────────────────────

/**
 * Secret patterns ordered by specificity (most specific first).
 *
 * These patterns detect common secret formats in environment variable
 * values. The patterns are intentionally broad enough to catch real
 * secrets but specific enough to avoid excessive false positives.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // ── API Keys and Tokens ──
  {
    name: "AWS Access Key",
    pattern: /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:[^A-Za-z0-9]|$)/,
    severity: "critical",
    guidance: "AWS access keys should be stored in AWS credentials file or a secrets manager, not in env files.",
  },
  {
    name: "GitHub Personal Access Token (classic)",
    pattern: /ghp_[A-Za-z0-9]{36}/,
    severity: "critical",
    guidance: "GitHub PATs should be stored in a secrets manager and injected at runtime.",
  },
  {
    name: "GitHub Fine-grained Token",
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
    severity: "critical",
    guidance: "GitHub fine-grained tokens should be stored in a secrets manager and injected at runtime.",
  },
  {
    name: "GitLab Personal Access Token",
    pattern: /glpat-[A-Za-z0-9\-_]{20,}/,
    severity: "critical",
    guidance: "GitLab PATs should be stored in a secrets manager and injected at runtime.",
  },
  {
    name: "Slack Bot/User Token",
    pattern: /xox[bporas]-[A-Za-z0-9\-]{10,}/,
    severity: "critical",
    guidance: "Slack tokens should be stored in a secrets manager.",
  },
  {
    name: "Stripe API Key",
    pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/,
    severity: "critical",
    guidance: "Stripe API keys should be stored in a secrets manager.",
  },
  {
    name: "Private Key (PEM)",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: "critical",
    guidance: "Private keys must never be stored in environment variables. Use file references or a secrets manager.",
  },
  // ── Generic High-confidence Patterns ──
  {
    name: "Bearer Token in Value",
    pattern: /^Bearer\s+[A-Za-z0-9\-._~+/]+=*$/i,
    severity: "high",
    guidance: "Bearer tokens should be injected at runtime, not stored in env files.",
  },
  {
    name: "Base64-encoded Secret (long)",
    pattern: /^[A-Za-z0-9+/]{40,}={0,2}$/,
    severity: "medium",
    guidance: "Long base64 strings may be encoded secrets. Verify this is not a credential.",
  },
  // ── Generic Keyword Patterns ──
  {
    name: "Generic API Key Pattern",
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?key)\s*[:=]\s*\S+/i,
    severity: "high",
    guidance: "API keys should be stored in a secrets manager, not inline in env values.",
  },
  {
    name: "Password Pattern",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
    severity: "high",
    guidance: "Passwords should never be stored in env files. Use a secrets manager.",
  },
  {
    name: "Connection String with Credentials",
    pattern: /(?:postgresql|mysql|mongodb|redis|amqp):\/\/[^:]+:[^@]+@/i,
    severity: "high",
    guidance: "Connection strings with embedded credentials should use secrets manager references.",
  },
] as const;

// ── Implementation ───────────────────────────────────────────────

/**
 * Mask a secret value for safe display.
 * Shows first 4 characters followed by asterisks.
 */
export function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return value.substring(0, 4) + "****";
}

/**
 * Scan a single environment variable value for secret patterns.
 */
export function scanValueForSecrets(
  variableName: string,
  value: string,
): SecretFinding[] {
  if (!value || value.trim().length === 0) return [];

  const findings: SecretFinding[] = [];

  for (const sp of SECRET_PATTERNS) {
    if (sp.pattern.test(value)) {
      findings.push({
        variableName,
        secretType: sp.name,
        severity: sp.severity,
        guidance: sp.guidance,
        maskedValue: maskValue(value),
      });
      // Only report the most specific (first) match per value
      break;
    }
  }

  return findings;
}

/**
 * Scan all environment variables in a parsed env file for secrets.
 *
 * This is the primary API for secret detection in MCP env configuration.
 * Called during `hatch3r validate` and when writing `.env.mcp` files.
 */
export function detectSecrets(
  envVars: Record<string, string>,
): SecretDetectionResult {
  const findings: SecretFinding[] = [];

  for (const [name, value] of Object.entries(envVars)) {
    const varFindings = scanValueForSecrets(name, value);
    findings.push(...varFindings);
  }

  return {
    hasSecrets: findings.length > 0,
    findings,
  };
}

/**
 * Format secret detection results for human-readable output.
 */
export function formatSecretFindings(result: SecretDetectionResult): string {
  if (!result.hasSecrets) {
    return "No secret patterns detected in environment variables.";
  }

  const lines: string[] = [
    `Detected ${result.findings.length} potential secret(s) in environment variables:`,
  ];

  for (const f of result.findings) {
    lines.push(
      `  [${f.severity.toUpperCase()}] ${f.variableName}: ${f.secretType} ` +
      `(value: ${f.maskedValue})`,
    );
    lines.push(`    -> ${f.guidance}`);
  }

  return lines.join("\n");
}
