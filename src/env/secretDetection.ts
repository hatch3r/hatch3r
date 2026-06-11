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
  /**
   * D1-M15: when true, the value must carry an explicit credential context
   * before this pattern flags. Either the variable name names a credential
   * (matches /KEY|SECRET|TOKEN|PASSWORD|PWD|AUTH/i) or the value carries
   * a `=` padding suffix and is at least 60 chars. Used by the generic
   * long-base64 pattern to drop false positives on hash-shaped values.
   */
  contextRequired?: boolean;
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
 *
 * D1-27: scanValueForSecrets selects the highest-severity matching pattern,
 * so array order no longer determines which finding is reported — it only
 * breaks ties among equal-severity matches (earlier == more specific wins).
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
    // D1-M15 (Cycle 10 Wave-3): the bare long-base64 pattern triggered on
    // any 40+ char base64-shaped value, which produced false positives on
    // benign payloads (e.g. SHA-256 digests stored verbatim, image hashes,
    // public key fingerprints). The context-aware filter below requires
    // either (a) the variable name carries a KEY/SECRET/TOKEN/PASSWORD
    // signal, or (b) the value is qualified with an `=` padding suffix
    // and at least 60 chars long. Both branches narrow to genuine
    // credential-shaped inputs while leaving hash-shaped values alone.
    // The `contextRequired` flag is honoured by scanValueForSecrets below.
    name: "Base64-encoded Secret (long)",
    pattern: /^[A-Za-z0-9+/]{40,}={0,2}$/,
    severity: "medium",
    guidance: "Long base64 strings may be encoded secrets. Verify this is not a credential.",
    contextRequired: true,
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
  // D15 Medium: additional MCP and provider-specific patterns (#358-#385)
  {
    // D1-26 (Cycle 11 Wave-3): the prior `/[a-z2-7]{52}$/` targeted the
    // deprecated 52-char base32 Azure DevOps PAT and was unanchored at the
    // start, so it matched the trailing 52 chars of any longer base32-shaped
    // value. Microsoft's current Azure DevOps PAT is the 84-char mixed-case
    // form carrying a literal `AZDO` marker at offsets 76-79 (75 chars before,
    // 5 after). The pattern below is anchored on both ends so it matches the
    // exact 84-char token rather than a tail substring.
    name: "Azure DevOps PAT",
    pattern: /^[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{5}$/,
    severity: "high",
    guidance: "Azure DevOps PATs should be stored in a secrets manager, not in env files.",
  },
  {
    name: "Linear API Key",
    pattern: /lin_api_[A-Za-z0-9]{40,}/,
    severity: "high",
    guidance: "Linear API keys should be stored in a secrets manager.",
  },
  {
    name: "Sentry Auth Token",
    pattern: /sntrys_[A-Za-z0-9]{40,}/,
    severity: "high",
    guidance: "Sentry auth tokens should be stored in a secrets manager.",
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
 * D1-M15: classifier for credential-context variable names.
 *
 * Returns true when the variable name carries a credential signal
 * (KEY/SECRET/TOKEN/PASSWORD/PWD/AUTH, case-insensitive). Used by the
 * generic long-base64 pattern to suppress false positives on benign
 * hash-shaped values stored under non-credential names.
 */
const CONTEXTUAL_CREDENTIAL_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|PWD|AUTH)/i;

function hasCredentialContext(variableName: string, value: string): boolean {
  if (CONTEXTUAL_CREDENTIAL_NAME.test(variableName)) return true;
  // Padded base64 values >= 60 chars are highly likely to be encoded
  // credentials rather than 32-byte hashes (which are 44 chars padded).
  if (/=$/.test(value) && value.length >= 60) return true;
  return false;
}

/**
 * D1-27: rank a severity for highest-severity match selection.
 * Higher number == more severe.
 */
const SEVERITY_RANK: Record<SecretPattern["severity"], number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Scan a single environment variable value for secret patterns.
 */
export function scanValueForSecrets(
  variableName: string,
  value: string,
): SecretFinding[] {
  if (!value || value.trim().length === 0) return [];

  // D1-27: report the single highest-severity match rather than the first
  // match in array order. First-match-wins routed a value that satisfied
  // both the generic medium base64 catch-all (earlier in the array) and a
  // provider-specific high pattern (later) to the medium finding, under-
  // severing real high secrets and mislabelling them "Base64-encoded Secret".
  // Selecting by severity is order-independent: it stays correct regardless
  // of where future patterns are inserted. On a severity tie the earlier
  // (more specific) pattern wins, since SECRET_PATTERNS is ordered most-
  // specific-first.
  let best: SecretPattern | undefined;
  for (const sp of SECRET_PATTERNS) {
    if (!sp.pattern.test(value)) continue;
    // D1-M15: context-required patterns (e.g. generic long-base64) only
    // flag when the variable name or value carries a credential signal.
    if (sp.contextRequired && !hasCredentialContext(variableName, value)) continue;
    if (best === undefined || SEVERITY_RANK[sp.severity] > SEVERITY_RANK[best.severity]) {
      best = sp;
    }
  }

  if (best === undefined) return [];

  return [
    {
      variableName,
      secretType: best.name,
      severity: best.severity,
      guidance: best.guidance,
      maskedValue: maskValue(value),
    },
  ];
}

/**
 * Scan all environment variables in a parsed env file for secrets.
 *
 * This is the primary API for secret detection in MCP env configuration.
 * Wired into `hatch3r validate` only (`src/cli/commands/validate.ts`
 * validateEnvMcpSecrets). The `.env.mcp` writer (`src/env/mcpEnv.ts`
 * ensureEnvMcp) does NOT call this on write, so secrets pasted during
 * `mcp setup`/init are surfaced only on the next explicit `hatch3r validate`,
 * not at write time (D11-SA11.3-F6, Cycle 11 Wave 4 — docstring corrected to
 * match the actual wiring rather than claim a write-time hook that does not
 * exist).
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
