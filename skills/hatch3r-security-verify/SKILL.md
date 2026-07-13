---
id: hatch3r-security-verify
name: hatch3r-security-verify
type: skill
description: Security verification gate before commit/release — OAuth 2.1 + OIDC + DPoP + WebAuthn server-side, supply-chain floor (SBOM + provenance + SHA-pin + cosign), OWASP ASI01-10 control coverage, CVE acknowledgement
tags: [review, security, supply-chain, floor:security, floor:content-quality]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Security Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping security-sensitive code or release-touching artifacts. Run before declaring a feature complete. The 8 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (CVE acknowledgement at release-cut). Skipping any gate = the feature is not done. Reviewer approval and passing functional tests alone do not satisfy this bar — a missing PKCE flag, an unpinned action SHA, or an `alg: none` JWT verifier ships exploitable code.

Inputs the skill expects:

- A repository with `src/auth/` (or equivalent path), `.github/workflows/`, lockfiles (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`), and release manifests (`Dockerfile`, `kubernetes/*.yaml`).
- Access to the project's CVE alert feed (`gh api repos/{owner}/{repo}/dependabot/alerts`) for Gate 8.
- Access to the JWT verification configuration (the file or module that names `algorithms`, `audience`, `issuer`).

Outputs the skill produces: an 8-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/security-verify-<sha>.json` for downstream consumption by `hatch3r-release`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Default path, not exception. Triggers for THIS skill: auth-flow scope (sign-in vs refresh vs step-up vs M2M), release-surface scope (workflow YAML vs container manifests vs SBOM tooling), gate selection (auth-only vs supply-chain-only vs full), threat-model assumptions (DPoP-bound browser tokens vs mTLS-bound service tokens vs bare bearer), and fix authority (fixes-in-scope vs audit-only).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each security gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-security.md` — invokes this skill as the closing security gate (CQ3) on auth-touching PRs and release-prep flows (a skill-invocation timing cue for the maintainer, not an agent-dispatch condition). The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 8-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW.

## Gate 1: OAuth 2.1 grant hygiene

- PKCE on every public AND confidential client; `response_type=code` only; implicit grant absent; ROPC grant absent.
- Exact-string `redirect_uri` allowlist (no wildcards); refresh-token rotation with reuse detection that revokes the entire token family on reuse.
- Check: `rg -n "response_type=code" src/auth/ | rg -v "code_challenge"` — any match fails this gate (auth-code flow without PKCE).
- Check: `rg -n "grant_type=(implicit|password)" src/auth/` — any match fails this gate.
- Reference: `draft-ietf-oauth-v2-1-15`.

## Gate 2: OIDC ID-token validation

- Verifier validates `iss`, `aud`, `azp` (when `aud` is multi-valued), `exp`, `nonce`, and JWKS signature before session creation.
- Clock-skew window documented (≤300s); RP-initiated logout (`end_session_endpoint`) and back-channel logout wired for SSO sessions.
- Check: `rg -n "jwt\.(verify|decode)" src/auth/ | rg -v "audience|issuer"` — any match fails this gate (validator missing `aud` or `iss`).
- Reference: OpenID Connect Core 1.0 §3.1.3.7.

## Gate 3: Sender-constrained tokens (DPoP / mTLS)

- DPoP (RFC 9449) for browser/mobile access tokens — proof JWT carrying `htm`/`htu`/`iat`/`jti` claims and access token bound via `cnf.jkt` thumbprint.
- OR mTLS-bound tokens (RFC 8705) for service-to-service. Bare bearer tokens for browser clients fail this gate (High).
- Check: `rg -n "Bearer " src/ | rg -v "DPoP|mTLS|cnf\.jkt"` — any browser-issued bearer without sender constraint fails the gate.

## Gate 4: JWT BCP conformance

- `alg` pinned per issuer; `alg: none` rejected at the verifier; `alg: HS*` rejected when verification key is asymmetric (key-confusion guard).
- `kid` resolved against JWKS endpoint with cache TTL 1-24h; no PII in payload; revocation strategy named (introspection OR token-version table).
- Check: `rg -n "alg.*none|jwt\.verify\([^,]+,[^,)]+\)$" src/` — any match fails this gate (`alg: none` accepted OR no `algorithms` option pinned).
- Reference: RFC 8725.

## Gate 5: Supply-chain floor (SBOM + provenance + SHA-pin + cosign)

- SBOM attached to every release in CycloneDX 1.6+ (preferred per ECMA-424) or SPDX 3.0.1.
- npm publication via OIDC trusted publishing with `--provenance`; every GitHub Action reference is a 40-char commit SHA.
- Production container images consumed by digest and cosign-signed (keyless OIDC via sigstore).
- Check: `rg -nE "uses: [^@]+@v?[0-9]+(\.[0-9]+)*$" .github/workflows/` — any match fails this gate (tag instead of 40-char SHA).
- Check: `gh release view --json assets --jq '.assets[].name' | rg -i "(cyclonedx|spdx)"` — empty output on tagged release fails this gate.

## Gate 6: WebAuthn server ceremony

- Challenge cached server-side with TTL ≤300s and single-use marker; `origin` allowlist verified at assertion; RP-ID hash matched.
- Signature validated against credential public key; signature counter strictly greater than stored value (replay guard); `user.id` is a server-side opaque identifier (NOT email or username).
- Check: `rg -n "signCount" src/ | rg -v "[><]"` — any match fails this gate (counter stored without strict-monotonic check).
- Reference: W3C WebAuthn Level 3 §7. Skip when no WebAuthn surface present.

## Gate 7: Cookie security flags

- Every auth cookie carries `__Host-` prefix + `HttpOnly` + `Secure` + `SameSite=Strict|Lax`.
- `SameSite=None` paired with `Partitioned` (CHIPS) only when the cross-site context is documented.
- Check: `rg -n "Set-Cookie" src/ | rg -v "__Host-|HttpOnly|Secure|SameSite"` — any auth cookie missing any flag fails this gate.
- Reference: RFC 6265bis + CHIPS draft.

## Gate 8: OWASP ASI01-10 + CVE acknowledgement

- Every agent-produced module passes the current OWASP ASI revision check (100% control coverage).
- CVE advisories ≤90 days old that match any project dependency are acknowledged in the finding registry with a `mitigated` OR `accepted` verdict + evidence URL.
- Check: `gh api repos/{owner}/{repo}/dependabot/alerts --jq '.[] | select(.state=="open")'` — any unacknowledged alert ≤90 days old fails this gate.
- Reference: OWASP Foundation + GitHub Security Advisories + OSV. Hardcoded secrets count: 0 per `rules/hatch3r-secrets-management.md`.

## Pass criteria

All 8 gates pass = the feature is "done". Anything less = not done.

- Hardcoded secrets in `src/`: 0 (CRITICAL on any hit).
- Supply-chain floor coverage: 100% (SBOM present + provenance + SHA-pinned actions + cosign-signed containers).
- OWASP ASI01-10 controls: 100% coverage.
- OAuth 2.1 PKCE: 100% of public + confidential clients.
- JWT `alg: none` acceptance: 0 occurrences in `src/`.
- Cookie flag coverage on auth cookies: 100% (`__Host-` + `HttpOnly` + `Secure` + `SameSite`).
- Open CVE alerts ≤90 days unacknowledged: 0.

## On fail

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of reviewer approval status.

Failure escalation per `agents/hatch3r-security.md` Status discipline table: Gate 4 fail (`alg: none` accepted) → CRITICAL; Gate 1 fail (refresh-token rotation absent) → CRITICAL; Gate 5 fail (production container by tag) → CRITICAL; Gate 6/3/7/2 → High; Gate 8 → Medium escalating to High when exploitable.

## When this skill runs

- Reviewer pass on any PR touching `src/auth/*`, JWT verification, cookie wiring, OAuth client config, WebAuthn ceremony, or release workflow under `.github/workflows/*.yml`.
- Verifier pre-merge gate on changes with `tags: floor:security` or `tags: floor:content-quality`.
- Release-prep audit before publishing to confirm Gate 5 (supply-chain floor) on every release artifact.
- CVE response when a ≤90-day advisory matches a project dependency.

## Cross-References

- `rules/hatch3r-auth-patterns.md`
- `rules/hatch3r-passkey-server.md`
- `rules/hatch3r-security-patterns.md`
- `rules/hatch3r-secrets-management.md`
- `rules/hatch3r-dependency-management.md`
- `rules/hatch3r-container-hardening.md`

## References

- OAuth 2.1 (`draft-ietf-oauth-v2-1-15`) — `datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/`
- OpenID Connect Core 1.0 — `openid.net/specs/openid-connect-core-1_0.html`
- RFC 9449 DPoP — `www.rfc-editor.org/rfc/rfc9449.html`
- RFC 8725 JWT BCP — `www.rfc-editor.org/rfc/rfc8725.html`
- W3C WebAuthn Level 3 — `www.w3.org/TR/webauthn-3/`
- OWASP CycloneDX (ECMA-424) — `owasp.org/www-project-cyclonedx/`
- sigstore / cosign — `sigstore.dev`
- OWASP ASI — `owasp.org/www-project-application-security-verification-standard/`
