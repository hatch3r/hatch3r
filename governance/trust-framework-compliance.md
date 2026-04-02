# Trust Framework Compliance Mapping

Finding #84 (D15, High): Create formal trust framework compliance mapping.

## Overview

This document maps the hatch3r framework's security controls to established
agentic AI trust principles. Each control is traced to its implementation,
validation method, and applicable trust dimension.

## Trust Dimensions

| Dimension      | Description                                                          |
|----------------|----------------------------------------------------------------------|
| Accountability | Actions are traceable to specific agents with audit trails           |
| Transparency   | Agent capabilities, limitations, and decisions are visible           |
| Containment    | Agent impact is bounded by enforced limits and allowlists            |
| Integrity      | Data flowing between agents is validated and tamper-evident          |
| Confidentiality| Secrets and sensitive data are protected from leakage                |
| Resilience     | The system degrades gracefully under failure or adversarial input    |

## Control-to-Trust Mapping

### ASI01 — Prompt Injection Mitigations

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Integrity, Resilience                                        |
| Implementation     | `src/pipeline/promptGuard.ts`                                |
| Controls           | Input sanitization, output validation, boundary markers      |
| Validation         | `hatch3r validate` compliance check `asi01-input-limit`, `asi01-output-limit` |
| Finding            | #78 (D15, High)                                              |

### ASI02 — Tool Allowlists per Agent Type

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Containment, Transparency                                    |
| Implementation     | `src/pipeline/agentToolAllowlist.ts`                         |
| Controls           | Per-agent tool category allowlists, deny-by-default policy   |
| Validation         | `hatch3r validate` compliance checks `asi02-*`               |
| Finding            | #79 (D15, High)                                              |

### ASI03 — Agent Identity Metadata

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Accountability, Transparency                                 |
| Implementation     | `src/pipeline/agentIdentity.ts`                              |
| Controls           | Agent identity on all outputs, provenance verification       |
| Validation         | Output metadata includes agentId, version, capabilities      |
| Finding            | #80 (D15, High)                                              |

### ASI07 — Phase Output Schema Validation

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Integrity                                                    |
| Implementation     | `src/pipeline/phaseOutputSchema.ts`                          |
| Controls           | Schema validation at every phase boundary                    |
| Validation         | `hatch3r validate` compliance check `asi07-phase-schemas`    |
| Finding            | #81 (D15, High)                                              |

### Review Loop Iteration Limits

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Resilience, Containment                                      |
| Implementation     | `src/pipeline/reviewLoop.ts`                                 |
| Controls           | Hard max iterations, configurable default, clamping          |
| Validation         | `hatch3r validate` compliance check `review-loop-limit`      |
| Finding            | #76 (D15, High)                                              |

### Diff-Hash Verification

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Integrity                                                    |
| Implementation     | `src/pipeline/diffHash.ts`                                   |
| Controls           | SHA-256 diff hashing, disk verification                      |
| Validation         | `hatch3r validate` compliance check `diff-hash-verify`       |
| Finding            | #77 (D15, High)                                              |

### Pipeline and Phase Timeouts

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Resilience, Containment                                      |
| Implementation     | `src/pipeline/pipelineTimeout.ts`, `src/pipeline/phaseTimeout.ts` |
| Controls           | Configurable timeouts with clamping, graceful termination    |
| Validation         | `hatch3r validate` compliance check `pipeline-timeout`       |
| Findings           | #57, #58 (D8, High)                                         |

### Secret Detection

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Confidentiality                                              |
| Implementation     | `src/env/secretDetection.ts`                                 |
| Controls           | Pattern-based detection of API keys, tokens, passwords       |
| Validation         | `hatch3r validate` scans `.env.mcp` for secrets              |
| Finding            | #82 (D15, High)                                              |

### MCP Server Blast Radius Documentation

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Transparency, Containment                                    |
| Implementation     | `docs/mcp-server-blast-radius.md`                            |
| Controls           | Per-server capability analysis, mitigation guidance          |
| Validation         | Manual review                                                |
| Finding            | #83 (D15, High)                                              |

### Compliance Verification

| Property           | Value                                                        |
|--------------------|--------------------------------------------------------------|
| Trust Dimension    | Accountability                                               |
| Implementation     | `src/pipeline/complianceVerification.ts`                     |
| Controls           | Automated security control checks in `hatch3r validate`      |
| Validation         | Self-validating — the compliance module validates itself      |
| Finding            | #86 (D15, High)                                              |

## Compliance Verification

Run `hatch3r validate` to execute all automated compliance checks. The command
reports:

- **PASS**: Control is properly configured and within acceptable bounds
- **WARN**: Control exists but has a non-ideal configuration
- **FAIL**: Control is missing or misconfigured — must be addressed

## Audit Schedule

| Frequency   | Activity                                                        |
|-------------|----------------------------------------------------------------|
| Per commit  | `hatch3r validate` in CI (automated)                            |
| Weekly      | Review MCP server audit logs                                    |
| Monthly     | Rotate MCP server credentials                                   |
| Quarterly   | Full trust framework review against this mapping                |
| Per release | Update compliance mapping for new controls                      |
