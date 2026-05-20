---
id: hatch3r-passkey-server
type: rule
description: Server-side WebAuthn / passkey ceremony — registration, authentication, attestation, counter, RP-ID, recovery, FIDO CXP/CXF awareness
scope: "**/auth/**,**/passkey*,**/webauthn*,**/fido*,**/credentials/**,**/api/**,**/handlers/**"
tags: [implementation, floor:security]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Passkey Server — WebAuthn Ceremony

## Scope

Server-side WebAuthn / passkey implementation. Companion to `rules/hatch3r-ux-states-and-flows.md` and `rules/hatch3r-ai-ux-patterns.md` (frontend Conditional UI), and to `rules/hatch3r-auth-patterns.md` (auth model, AAL mapping, step-up). WebAuthn Level 3 (W3C Candidate Recommendation, Jan 2026) is the spec baseline.

## Server Libraries — Use Vetted, Never Hand-Roll

| Runtime | Library |
|---------|---------|
| Node.js / Deno / Bun | `@simplewebauthn/server` |
| JVM (Java / Kotlin) | `webauthn4j` |
| Go | `go-webauthn/webauthn` |
| Python | `py_webauthn` (Duo) |
| Rust | `webauthn-rs` |
| .NET | `Fido2NetLib` |

Hand-rolling the ceremony (signature parsing, CBOR decoding, attestation chain validation) is a Critical anti-pattern.

## Registration Ceremony

Two HTTP endpoints. Always.

### `POST /webauthn/register/options`

Server generates and returns `PublicKeyCredentialCreationOptions`:

- `challenge` — 32 random bytes, cached server-side with a 5-minute TTL keyed to the user session.
- `rp.id` — registrable domain (e.g., `example.com`). Never include scheme or port.
- `rp.name` — human-readable RP name shown in the OS passkey UI.
- `user.id` — server-side opaque ID (16-64 random bytes), NOT email and NOT username. Stable per account; never reused after deletion.
- `user.name`, `user.displayName` — visible identifiers (e.g., email + display name).
- `pubKeyCredParams` — `[{type: "public-key", alg: -7 /* ES256 */}, {type: "public-key", alg: -257 /* RS256 */}]`.
- `authenticatorSelection.userVerification: "required"` for new accounts.
- `authenticatorSelection.residentKey: "required"` to enable discoverable / passkey-first UX.
- `attestation: "none"` for consumer apps. `"direct"` only when high-assurance attestation is required (enterprise / regulated).
- `excludeCredentials` — array of the user's already-registered credential IDs to prevent duplicate registration on the same authenticator.

### `POST /webauthn/register/verify`

Client returns `AuthenticatorAttestationResponse`. Server verifies:

- Challenge matches the cached challenge for this session; consume after verification.
- `origin` is in the allowlist (typically `https://{rp.id}` + known origins).
- RP-ID hash in `authData` matches SHA-256 of `rp.id`.
- Signature validates against the attestation public key (when attestation requested).
- Attestation chain validates against FIDO Metadata Service when `attestation: "direct"`.

Persist on success: `credential_id` (base64url), `public_key` (COSE-encoded), `counter`, `aaguid`, `transports[]`, `backup_eligible`, `backup_state`, `user_id` (FK), `created_at`.

## Authentication Ceremony

### `POST /webauthn/login/options`

Server returns `PublicKeyCredentialRequestOptions`:

- `challenge` — fresh 32 random bytes, cached with 5-minute TTL keyed to the login attempt ID.
- `rp.id` — same registrable domain as registration.
- `allowCredentials` — array of the user's credential IDs when identifier is known. Empty array (or omit) for discoverable login (passkey-first UX); the OS picker handles credential selection.
- `userVerification: "required"` for the AAL2-required path.

### `POST /webauthn/login/verify`

Client returns `AuthenticatorAssertionResponse`. Server verifies:

- Challenge matches; consume after verification.
- `origin` is in the allowlist.
- RP-ID hash matches SHA-256 of `rp.id`.
- Signature validates against the stored public key for the asserted credential ID.
- Counter check (see below).

On success, update the stored counter and `backup_state`; issue the session.

## RP-ID Rules

- `rp.id` is the registrable domain. For `app.example.com`, `rp.id` may be `example.com` (broader) or `app.example.com` (narrower). Broader RP-ID allows credentials to work across subdomains.
- Credentials are bound to the RP-ID used at registration. Changing the RP-ID later requires re-registration.
- Multi-region domains: plan the RP-ID before launch. Use Related Origin Requests (WebAuthn L3) for legitimate multi-origin scenarios.

## Counter Checking — Clone Detection

Every authenticator increments its signature counter on each assertion (some authenticators report 0 always — document expected behavior per AAGUID).

- On registration, persist the initial counter.
- On authentication, the asserted counter MUST be greater than the stored counter.
- If asserted counter <= stored counter (and not both 0): treat as possible clone. Reject the assertion, notify the user via email, and require recovery.
- Always update the stored counter after successful authentication.

## AAGUID Handling

- `aaguid` (Authenticator Attestation GUID) identifies the authenticator model family.
- When `attestation: "none"`, do NOT use AAGUID for security decisions — it is unattested and can be spoofed.
- Use AAGUID for analytics (which device families users prefer) and for cross-referencing the FIDO Metadata Service when `attestation: "direct"`.

## Backup State Flags

WebAuthn L3 introduces two single-bit flags in `authData`:

- `backup_eligible` (BE) — credential CAN be backed up / synced (passkey).
- `backup_state` (BS) — credential IS currently backed up.

Persist both. Display "passkey synced across your devices" UI hint when `BS=1` (cross-reference frontend `rules/hatch3r-ux-states-and-flows.md`). Flag `BE=0` credentials as device-bound (security key) in recovery flows — losing the device means losing the credential.

## Recovery Patterns

- **Multiple passkeys per user** — REQUIRED. Encourage registration of >=2 authenticators (laptop sync + phone, or laptop + hardware key) during onboarding. UI surfaces missing-second-passkey state as a recoverable warning.
- **Account recovery flow** — verified email + identity-proofing question + step-up auth via remaining passkey. Never plain SMS. Document the recovery SLA.
- **Admin recovery** — enterprise tenants get an admin-initiated recovery path with audit trail; consumer accounts do not.
- **FIDO CXP/CXF awareness** — Cross-Platform Export Format (Feb 2026 draft) enables passkey migration across managers (1Password, Apple Keychain, Google Password Manager, Bitwarden). Plan the migration UX so users discover that exporting from manager A to manager B is supported.

## User Verification (UV)

- `userVerification: "required"` — authenticator must verify the user via biometric or PIN. Replaces the password factor. Use for AAL2 and all sensitive operations.
- `userVerification: "preferred"` — authenticator verifies if able, otherwise presence-only. Acceptable for AAL1.
- `userVerification: "discouraged"` — presence only. Rare; only for tap-to-confirm flows.
- Map per AAL level — cross-reference `rules/hatch3r-auth-patterns.md` MFA section.

## Step-Up Authentication

High-risk operations require a fresh WebAuthn assertion even when the session is valid:

- Delete account, change email, change password.
- Rotate API key, add OAuth client, change billing.
- Transfer funds above the project's risk threshold.

Issue a short-lived (5-15 min) step-up token scoped to the operation. Re-assertion uses `userVerification: "required"` regardless of session AAL.

## Discoverable Credentials (Passkey-First UX)

- Register with `residentKey: "required"` so the credential is stored on the authenticator with a username hint.
- Authenticate with empty `allowCredentials` and frontend `mediation: "conditional"` (Conditional UI) so the username field offers passkeys directly.
- Cross-reference `rules/hatch3r-ux-states-and-flows.md` for the frontend autocomplete attribute pattern.

## Telemetry

Track per-feature:

- Registration success rate, registration failure rate by reason.
- Authentication success rate, authentication failure rate by reason.
- Time-to-completion for registration and assertion (P50/P95).
- AAGUID distribution.
- `backup_state` rate (sync vs device-bound).
- Counter-mismatch incidents (potential clone).

Cross-reference `skills/hatch3r-observability-verify` for instrumentation patterns.

## Migration From Passwords

Opt-in flow after a successful password+TOTP login:

1. Prompt "Add a passkey for faster sign-in?" with one-tap registration.
2. On success, mark the account `passkey_enabled: true`.
3. After >=1 passkey is registered AND the user has confirmed passkey works on >=2 sessions, prompt "Switch to passkey-only sign-in?"
4. On opt-in confirmation, disable password sign-in for the account. Keep a recovery path (email + secondary passkey).

## Anti-Patterns

- Never store the private key server-side. Passkeys are public-key only — the private key never leaves the authenticator.
- Never use email as `user.id`. Use a server-side opaque ID; email changes break credential binding otherwise.
- Never accept attestation as user identity. Attestation identifies the authenticator model, not the human.
- Never skip the origin check. RP-ID alone does not prevent phishing — origin allowlist does.
- Never log credential public keys or signatures in plaintext audit logs.
- Never accept a counter <= stored counter as success.

## References

- W3C Web Authentication Level 3 (Candidate Recommendation, Jan 2026).
- FIDO Alliance — Client to Authenticator Protocol (CTAP) 2.2.
- FIDO Alliance — Credential Exchange Protocol / Credential Exchange Format (CXP / CXF, Feb 2026 draft).
- `@simplewebauthn/server` documentation.
- MDN — Web Authentication API.
- FIDO Metadata Service (MDS3) for attestation verification.
