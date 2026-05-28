---
id: hatch3r-security-rule
type: rule
description: CQ3 Security Quality measurement rule — supply-chain integrity, auth depth, secret hygiene, OWASP ASI controls; specialist routing to hatch3r-security
scope: "src/**,**/auth/**,**/.github/workflows/**,**/Dockerfile*,**/package.json,**/package-lock.json,**/pnpm-lock.yaml,**/yarn.lock"
tags: [floor:security, floor:content-quality, security]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Security Quality (CQ3)

**Pillars:** P6 (Security & Trust), CQ3 (Security Quality)

## Scope

This rule binds the CQ3 measurement set across end-user code that hatch3r generates AND the framework's own source tree. It complements (does not duplicate) two adjacent rules:

- `rules/hatch3r-security-patterns.md` (critical precedence) — input-validation + auth-enforcement patterns at the code level.
- `rules/hatch3r-secrets-management.md` (critical precedence) — secret detection, env-var hygiene, lockfile policy.

This rule owns the CQ3 threshold set, the specialist agent routing, and the per-finding escalation pathway.

## CQ3 Threshold Set

Source: `governance/CONSTITUTION.md` §2B CQ3. Every threshold below is measurable per audit cycle; missing measurement is a Medium finding minimum.

| Threshold | Target | Measurement source |
|-----------|--------|--------------------|
| npm provenance | 100% on release artifacts | `npm publish --provenance`; verify via `npm view {pkg} --json | jq .provenance` |
| SBOM (CycloneDX 1.6 or SPDX 3.0.1) | Attached to every release | CI artifact; `syft` or `cyclonedx-npm` output |
| SHA-pinned GitHub Actions | 100% — 40-char commit SHA | `.github/workflows/*.yml` grep for `uses: .*@[a-f0-9]{40}` |
| Cosign-signed containers | 100% on published images | `cosign verify --certificate-identity-regexp` against issuer + Rekor entry |
| OAuth 2.1 conformance | 100% on auth-bearing services | PKCE on public + confidential clients; refresh-token rotation with reuse detection; implicit + ROPC absent |
| OIDC ID-token validation | 100% — `iss`, `aud`, `azp`, `exp`, `nonce`, JWKS signature | Code audit per `rules/hatch3r-auth-patterns.md` |
| DPoP sender-constraint (RFC 9449) | 100% on browser tokens | `htm`, `htu`, `iat`, `jti` validation; key-thumbprint binding |
| WebAuthn server ceremony | 100% on passwordless flows | Challenge TTL + single-use; RP-ID hash; signature; counter strictly greater; opaque `user.id` |
| Hardcoded secrets count | 0 per cycle | `gitleaks detect --redact`, `trufflehog filesystem`, `detect-secrets scan` |
| OWASP ASI01-10 coverage | 100% on agent-produced code | Per-control verification; current revision per `governance/audit/domains/D15-agentic-security.md` |
| CVE advisory acknowledgement | ≤90-day staleness | `npm audit --audit-level=high`; `osv-scanner -r .`; GHSA inspection |

## Specialist Agent Routing

The CQ3 envelope is owned by a single specialist. Route every trigger below to it:

| Trigger | Route to |
|---------|----------|
| Auth-flow PR (sign-in, refresh, step-up, logout, token introspection, M2M) | `agents/hatch3r-security.md` (CQ3 specialist) |
| Release-touching PR (workflow YAML, Dockerfile, package manifest, container manifest, SBOM tooling) | `agents/hatch3r-security.md` (CQ3 specialist) |
| Project-specific deep audit (database rules, cloud functions, data flows, OWASP Top 10) | `agents/hatch3r-security.md` (CQ3 specialist — deep-audit mode) |
| CVE response — advisory ≤90 days old matches `package.json` lockfile or SHA-pinned action | `agents/hatch3r-security.md` (CQ3 specialist) + framework-owner escalation per CONSTITUTION §2 P6 |
| Container hardening (rootless, distroless, non-root UID, capabilities dropped) | `rules/hatch3r-container-hardening.md` (rule) + `agents/hatch3r-security.md` (review) |

The CQ3 specialist gates the floor, emits `progress_toward_pillar: content-quality.CQ3+<delta>` per finding, AND performs deep project-specific audits when invoked in deep-audit mode. One agent, one routing surface.

## Severity Mapping

Specialist status maps to canonical audit severity per `governance/audit/templates/severity-mapping.md`:

| Specialist Status | Canonical Severity | Action |
|-------------------|--------------------|--------|
| `CRITICAL` | Critical | Block release; framework-owner escalation; ≤7d resolution per CONSTITUTION §2 P6 |
| `FINDINGS` | High + Medium | Block merge on `floor:security` paths; ≤14d resolution for High |
| `PASS` | Low + Info | Surface in iteration summary; no merge block |

## Per-Finding Output Format

Every finding emitted under this rule MUST include the rigor-contract fields per `governance/audit/templates/rigor-contract.md`:

- `proof_trace`: file:line citation + command-output excerpt.
- `impact_horizon`: short | medium | long per CONSTITUTION Decision 17.
- `progress_toward_pillar: content-quality.CQ3+<delta>`: numeric delta against the threshold (e.g. `+0.05` for a 5% step toward SHA-pinning coverage).
- `confidence`: high | medium | low with explicit basis.
- `causal_chain`: ≥3-step linkage from observation → root cause → impact.

## Per-Tier Floor Admission

Decision 4 (CONSTITUTION §6) admits CQ3 floor items per maturity tier:

| Tier | Floor admission |
|------|-----------------|
| solo | npm audit clean; no hardcoded secrets; PKCE on OAuth public clients |
| team | + SBOM attached to release; SHA-pinned actions on release workflow |
| scaleup | + DPoP on browser tokens; refresh-token rotation; OIDC strict validation |
| enterprise | + WebAuthn server ceremony; cosign on containers; OWASP ASI01-10 100%; CVE acknowledgement ≤7d for Critical |

Tier escalation tightens the floor; previous baselines do not survive a tier bump without re-measurement.

## When to Invoke

- Every PR touching `src/auth/*`, JWT verification, cookie wiring, OAuth client config, WebAuthn ceremony, or `.github/workflows/*.yml`.
- Every release-prep gate before publishing — SBOM, provenance, SHA-pin, cosign on all release artifacts.
- Every dependency update PR — `npm audit`, `osv-scanner`, GHSA inspection; populate `securityNote` per `rules/hatch3r-tool-currency.md` if a CLI tool is affected.
- Quarterly OWASP ASI revision review — the ASI revision number changes; rerun the 100% coverage gate against the current revision.

## References

- `governance/CONSTITUTION.md` §2B CQ3 (measurement set + specialist owner).
- `governance/audit/domains/D15-agentic-security.md` (OWASP ASI controls + supply-chain audit checklists).
- `agents/hatch3r-security.md` (CQ3 specialist agent — auth + supply-chain + ASI scope).
- `agents/hatch3r-security.md` (CQ3 specialist — deep-audit mode for project-specific audits).
- `rules/hatch3r-security-patterns.md` (input-validation + auth enforcement at code level).
- `rules/hatch3r-secrets-management.md` (secret detection + env-var hygiene + lockfile policy).
- `rules/hatch3r-container-hardening.md` (rootless / distroless / non-root UID / capability discipline).
