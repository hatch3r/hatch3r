---
id: hatch3r-api-versioning
type: rule
description: API versioning, deprecation lifecycle, and idempotency — RFC 9457 errors, RFC 9745 Deprecation header, RFC 8594 Sunset, OAuth 2.1, Idempotency-Key, semver vs CalVer for APIs
scope: conditional
globs: "**/api/**,**/openapi*,**/asyncapi*,**/*.proto,**/routes/**,**/handlers/**,**/controllers/**"
tags: [implementation, devops, tier:enterprise-only]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# API Versioning, Deprecation & Idempotency

Lifecycle rules for evolving REST, GraphQL, and gRPC contracts without breaking consumers. Pairs with `rules/hatch3r-api-design.md` (shape) and `rules/hatch3r-contract-testing.md` (verification).

## Versioning Scheme

- **Semver (`v1`, `v2`)** for stable contracts and published SDKs: major version goes in the URL prefix (`/v2/users`) for breaking changes; minor and patch updates are field-level additive and stay within the same major.
- **CalVer (`2026-05-15`)** for rolling APIs that change frequently (Stripe-style date-based versioning): clients pin a date via `Stripe-Version` / `Api-Version` header; the server transforms newer responses down to the pinned date.
- Pick one scheme per API and document it in the spec — never mix semver and CalVer in the same surface.
- Within a major (semver) or pinned date (CalVer), only additive changes ship: new fields, new endpoints, new enum values (when consumers handle `unknown` fallback).

## Deprecation Lifecycle (RFC 9745 + RFC 8594)

Every retirement passes three stages. Skipping any stage breaks downstream consumers.

| Stage | Header(s) | Action |
|-------|-----------|--------|
| Announce | `Deprecation: @<unix-ts>` (RFC 9745, Mar 2025 Standards Track) + `Link: <https://docs.example.com/migrate/v2>; rel="deprecation"` | Emit on every deprecated endpoint/field response; log usage by `X-Api-Key` / authenticated identity. |
| Sunset | `Sunset: <HTTP-date>` (RFC 8594) | Set N months before removal: N=6 public, N=3 partner, N=1 internal. Pair with continued `Deprecation` header. |
| Remove | HTTP 410 Gone + Problem Details (`type: https://errors.example.com/sunset`, `title: Endpoint removed`) | Only after the sunset date passes AND analytics show <0.1% usage for two consecutive 7-day windows. |

- Field-level deprecation: emit `Deprecation` per endpoint that still returns the field; GraphQL uses `@deprecated(reason: "...")`; protobuf uses `[deprecated = true]`.
- Document the migration in the `Link: ...rel="deprecation"` target — include before/after code samples, fallback strategy, and the removal date.

## Idempotency-Key (draft-ietf-httpapi-idempotency-key-header)

Every side-effectful endpoint (POST / PATCH / PUT / DELETE that mutates state) accepts an `Idempotency-Key: <client-generated-uuid>` request header.

- **Key format:** UUIDv4 or ULID, max 255 chars. Clients generate; servers never accept server-generated keys.
- **Storage:** server persists `(tenant_id, api_key, idempotency_key, request_body_hash, response_status, response_body)` for 24 hours (configurable per API; Stripe uses 24h, recommended range 24h-7d).
- **Replay semantics:**
  - Exact replay (same key + same request body hash) -> return the original response (same status, same body, same `Idempotency-Replay: true` header).
  - Conflicting replay (same key + different request body hash) -> 422 with Problem Details `type: https://errors.example.com/idempotency-conflict`.
  - In-flight replay (same key, original still processing) -> 409 Conflict + `Retry-After: <seconds>`.
- **Scope:** per `(tenant_id, api_key)`, never global. Hashing the body prevents replay-with-mutation attacks.

## Rate Limit Headers (draft-ietf-httpapi-ratelimit-headers)

Emit structured-field headers on every response (not just 429):

| Header | Value | Purpose |
|--------|-------|---------|
| `RateLimit-Policy` | `100;w=60` | Quota + window length (seconds). |
| `RateLimit-Limit` | `100` | Maximum requests in current window. |
| `RateLimit-Remaining` | `42` | Remaining quota in current window. |
| `RateLimit-Reset` | `30` | Seconds until the window resets. |

- On 429, also include `Retry-After: <seconds>` (RFC 9110).
- Vendor-specific `X-RateLimit-*` headers may be emitted alongside for backward compatibility, but the IETF draft headers are the floor.

## OAuth 2.1 (draft-ietf-oauth-v2-1)

- **PKCE mandatory on all clients** (public and confidential) — `code_challenge` + `code_challenge_method=S256`.
- **Implicit and password (ROPC) grants removed.** Use authorization code + PKCE for interactive; client credentials for server-server; device code for input-constrained.
- **Exact redirect-URI matching** — no wildcards, no partial paths. Pre-register each callback URL.
- **Refresh-token rotation with reuse detection** — on every refresh, issue a new refresh token and invalidate the old one. If the old token is presented after rotation, revoke the entire token family (replay attack signal).
- Access tokens short-lived (5-15 min). Long-lived refresh tokens, sender-constrained (DPoP or mTLS) for public clients.
- Full auth detail: `rules/hatch3r-auth-patterns.md`.

## Resource Indicators (RFC 8707)

- Token requests include a `resource=<uri>` parameter naming the protected resource the token will be presented to.
- Authorization servers bind the token's `aud` claim to the requested resource — prevents audience-confusion attacks across multi-tenant AS deployments.
- Multi-resource consent flows pass multiple `resource` params; the AS issues separate tokens per audience.

## DPoP (RFC 9449)

- Sender-constrained access and refresh tokens for browser-resident clients (SPAs) — alternative to mTLS for public clients.
- Client generates a key pair (non-extractable in the browser via WebCrypto), signs a fresh DPoP JWT per request, sends in `DPoP: <jwt>` header.
- Server binds the access token's `cnf.jkt` claim (JWK thumbprint) to the client's public key; rejects token presentation from any other key.
- Recommended floor for any token leaving the first-party boundary (third-party SDK consumers, mobile apps with insecure storage).

## Webhook Signing (Standard Webhooks convention)

- Headers: `webhook-id` (unique delivery ID), `webhook-timestamp` (unix seconds), `webhook-signature` (`v1,<base64-HMAC-SHA256(<id>.<timestamp>.<body>)>`).
- HMAC-SHA256 with a per-tenant shared secret, constant-time comparison.
- Reject deliveries where `|now - webhook-timestamp| > 300` seconds (5-minute replay window).
- `webhook-id` doubles as the idempotency key on the receiver — cache for >=5 minutes (Redis/SQLite) to dedupe duplicate deliveries.
- **Key rotation:** signature spec supports comma-separated versions (`v1,sig1 v2,sig2`); receivers accept any valid version during the rollover window.
- Deliveries that fail signature verification return HTTP 401 + Problem Details `type: https://errors.example.com/invalid-signature`.

## Backward Compatibility Policy

- **Field additions** are always safe.
- **Field removal or rename** requires the full RFC 9745 + RFC 8594 lifecycle (Announce -> Sunset -> Remove). Never remove without the lifecycle.
- **Enum extension** is safe only when consumers handle an `unknown` fallback value. Generated client code (OpenAPI Generator, openapi-typescript) must emit the `unknown` branch.
- **Nullable transitions** (required -> optional, or non-null -> nullable) require a feature flag and a deprecation window — clients written against the stricter shape will break on `null`.
- **Type changes** (e.g., `int32` -> `int64` in protobuf, `string` -> `string | null` in OpenAPI) require a new major version unless the wire format is unchanged (protobuf int32->int64 is wire-compatible for small values; document the edge case).

## CI Gates

Every PR touching an API contract runs the matching diff tool against the last shipped tag. Breaking changes block merge.

- `oasdiff breaking` (OpenAPI 3.0 + 3.1, 450+ rules, CNCF Sandbox) — comments on the PR with the breaking-change list.
- `buf breaking` (Protobuf, default `FILE` rule set) — blocks wire + source incompatibility.
- `graphql-inspector diff` — blocks GraphQL schema breaking changes.

All three integrate with PR comments and fail the build on a breaking exit code. Cross-reference the gate set in `rules/hatch3r-api-design.md` "Breaking-Change CI Gate".

## References

- RFC 9457 — Problem Details for HTTP APIs (March 2025, obsoletes RFC 7807).
- RFC 9745 — The Deprecation HTTP Response Header Field (March 2025, Standards Track).
- RFC 8594 — The Sunset HTTP Response Header Field.
- RFC 8707 — Resource Indicators for OAuth 2.0.
- RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP).
- draft-ietf-oauth-v2-1 — The OAuth 2.1 Authorization Framework.
- draft-ietf-httpapi-idempotency-key-header — The Idempotency-Key HTTP Header Field.
- draft-ietf-httpapi-ratelimit-headers — RateLimit Header Fields for HTTP.
- Standard Webhooks — https://github.com/standard-webhooks/standard-webhooks
