---
id: hatch3r-auth-scaffold
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-security]
description: "Scaffold authentication boilerplate for a greenfield API service — OAuth 2.1 authorization-code-with-PKCE flow, OIDC ID-token validation, and hashed personal-access-token (PAT) issuance/verification. Implementer writes the code; hatch3r-security gates it against the CQ3 auth-depth floor."
argument-hint: "[service-name]"
tags: [implementation, security, floor:security, floor:content-quality]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 2
  rationale: One hatch3r-implementer writes the OAuth 2.1 / OIDC / PAT boilerplate (code mutation flows through the implementer per the Mandatory Delegation Directive); one hatch3r-security gates the result against the CQ3 auth-depth floor (PKCE, exact redirect-URI match, ID-token claim validation, token-secret hashing). Independent auth modes (interactive OAuth vs machine-to-machine PAT) fan out to parallel implementers; the implement -> security-gate edge is the only serialization. Cost-dominance per CONSTITUTION §2 P8.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the request for unresolved questions in auth mode, threat model, and identity provider. If the request does not name which flow(s) to scaffold (interactive sign-in via OAuth 2.1, machine-to-machine via PAT, or both), the OIDC provider / issuer, or the client type (public SPA vs confidential server), ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — the token-binding decision (DPoP for browser vs bare bearer) and the redirect-URI allowlist depend on these, and a wrong assumption ships an exploitable flow. Proceed without asking ONLY when the flow set, provider, and client type are all explicit. Scaffolding auth boilerplate is high-blast-radius; default to asking. Source: `.claude/rules/clarification-default.md`.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Parse auth spec | Orchestrator (inline) | No | Yes |
| 2. Confirm flow + threat model + ASK gate | Orchestrator (inline) | No | Yes |
| 3. Generate boilerplate | `hatch3r-implementer` | Per auth mode | Yes |
| 4. Gate against CQ3 auth floor | `hatch3r-security` | Per auth mode | Yes |
| 5. Verify + Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): when the spec covers both interactive OAuth and machine-to-machine PAT, fan out one `hatch3r-implementer` per mode — each writes a disjoint module (`src/auth/oauth/` vs `src/auth/pat/`), aggregation is deterministic (union of generated paths), no shared mutable state. The `hatch3r-security` gate runs once per generated mode after its implementer returns.

---

# Auth Scaffold -- OAuth 2.1 + OIDC + PAT Boilerplate for a Greenfield API

Generates authentication boilerplate for a new API service to the OAuth 2.1 + OIDC + OWASP-ASVS-v5 floor: an authorization-code-with-PKCE flow, OIDC ID-token validation (issuer, audience, nonce, JWKS signature), and hashed personal-access-token issuance/verification for machine-to-machine clients. Output is project-language source plus a `.env.example` of the required secrets — never inlined credentials.

Use `/hatch3r-auth-scaffold` on a greenfield service that needs an auth layer built to the CQ3 auth-depth floor (one of the CONSTITUTION §2B floors: "Auth depth coverage: 100%"). Use the `hatch3r-security-verify` skill to audit an existing auth implementation without regenerating it; use `/hatch3r-security-audit` for a broad security review beyond the auth surface.

---

## Argument Parsing

Optional positional argument: `<service-name>`.

- If supplied: seed Step 1 with that service.
- If omitted: ASK for the service, the flow set, the OIDC provider, and the client type before delegating.

---

## Step 0: Triage

Classify the auth scaffold before delegating. The tier names map to the canonical Light/Standard/Deep vocabulary (`agents/shared/triage-vocabulary.md`); the `Tier {1|2|3}` references in Step 2 resolve to these rows.

- **Tier 1 (Light)** — a single auth mode (PAT only, or OAuth only) for a confidential server client with a named issuer. One `hatch3r-implementer` writes the single module; one `hatch3r-security` gate verifies it.
- **Tier 2 (Standard)** — both interactive OAuth 2.1 and machine-to-machine PAT for one client type. One implementer per mode in parallel (`src/auth/oauth/` vs `src/auth/pat/`); one security gate per generated mode.
- **Tier 3 (Deep)** — a public/browser client (the DPoP token-binding decision is in play), multiple identity providers, or a mixed public+confidential client matrix. Full fan-out (one implementer per mode × provider), each gated, plus the browser-bearer-is-a-High-finding threat check from Step 4 item 4.

Rule: an unspecified client type or an undecided token-binding choice fires the §0 B1 gate before tiering — a public client mis-scaffolded as confidential ships an exploitable bearer flow. Classify upward when the client type or token binding is uncertain.

---

## Step 1: Parse Auth Spec

Collect the inputs that determine the flow shape and the token-binding decision. Cache for the Step 3 implementer prompt.

| Input | Default if unspecified | Notes |
|-------|------------------------|-------|
| Auth modes | OAuth 2.1 + PAT | interactive sign-in, machine-to-machine, or both |
| Client type | confidential | public (SPA/mobile, no secret) vs confidential (server, holds a secret) |
| OIDC provider / issuer | (required — ASK) | issuer URL → JWKS discovery; never a guessed default |
| Token binding | DPoP for browser/mobile; bearer acceptable for confidential server-to-server | RFC 9449 — bare bearer for a browser client is a High finding |
| ID-token clock skew | ≤ 300 s | documented skew window for `exp`/`iat` validation |
| PAT hash | Argon2id (bcrypt fallback) | long-lived secrets are stored hashed, never plaintext |
| Output module | `src/auth/` | `src/auth/oauth/`, `src/auth/oidc/`, `src/auth/pat/` |

The client type drives the PKCE + refresh-token requirement: OAuth 2.1 mandates PKCE on every client (public AND confidential), and refresh tokens issued to public clients MUST be sender-constrained or one-time-use.

---

## Step 2: Confirm Flow + Threat Model + ASK Checkpoint (only mutation gate)

Present the resolved spec and the threat-model decisions so the maintainer confirms before any auth code is written.

```
hatch3r-auth-scaffold — service: {name} (Tier {1|2|3})

Resolved spec:
  modes: OAuth 2.1 (authorization code + PKCE) + PAT (machine-to-machine)
  client type: confidential (holds client_secret)
  OIDC issuer: https://{provider}/  (JWKS auto-discovered)
  token binding: bearer (confidential server-to-server); DPoP required if a browser client is added
  ID-token validation: iss, aud, azp, exp, nonce, JWKS signature; skew ≤ 300s
  PAT: 256-bit random, stored Argon2id-hashed, shown once on issue
  output: src/auth/{oauth,oidc,pat}/ + .env.example

OAuth 2.1 invariants enforced (draft-ietf-oauth-v2-1-15):
  - PKCE (S256) on every authorization-code request
  - exact-string redirect_uri allowlist (no wildcards)
  - implicit grant + ROPC grant absent
  - no bearer token in query string
  - refresh-token rotation with reuse detection

Tier: 2
```

ASK (only gate), per `agents/shared/user-question-protocol.md`:

> Generate the auth scaffold for {name} with the flow + threat model above?
> - `accept` — generate the boilerplate and run the CQ3 security gate
> - `edit` — change a mode, client type, provider, or token binding first
> - `skip` — cancel; write nothing
>
> (accept / edit / skip)

After the user accepts, the run is autonomous through Step 5.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 2 ASK gate, emit the cost preview per `rules/hatch3r-cost-visibility.md`:

```yaml
cost_estimate:
  expected_sa_count: <N auth modes × 1 implementer + N × 1 security gate>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>   # 0-1 — the spec set is fixed by the references below; web only for a fresh CVE check
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 5 Iteration Summary. `--effort=light|standard|deep` (Decision 17) forces the tier; record both auto and override.

---

## Step 3: Generate Boilerplate (sub-agent delegation)

Delegate to `hatch3r-implementer` via the Task tool, one per auth mode. Code mutation flows through the implementer per the Mandatory Delegation Directive — the orchestrator writes no auth code inline.

Each implementer prompt MUST include the resolved spec, the target module paths, and this boilerplate contract:

**OAuth 2.1 authorization-code flow (`src/auth/oauth/`):**

1. PKCE on every authorization-code request — generate a `code_verifier` (43-128 char, high-entropy) and send the `S256` `code_challenge`; verify on the token exchange. PKCE is mandatory on public AND confidential clients in OAuth 2.1.
2. Exact-string `redirect_uri` allowlist — match the callback URI by exact string against a pre-registered list; no wildcard or prefix matching.
3. No implicit grant (`response_type=token`) and no ROPC (`grant_type=password`) — both are removed from OAuth 2.1; do not scaffold either.
4. Refresh-token rotation with reuse detection — rotate the refresh token on every use; on detection of a reused (already-rotated) token, revoke the entire token family. For a public client, the refresh token MUST additionally be sender-constrained (DPoP) or one-time-use.
5. Access tokens are never placed in a URI query string (OAuth 2.1 prohibition) — pass via the `Authorization` header.

**OIDC ID-token validation (`src/auth/oidc/`):** validate `iss` (matches the configured issuer), `aud` (matches the client_id), `azp` when `aud` is multi-valued, `exp` (with the documented ≤300 s skew), and `nonce` (matches the value sent in the auth request — replay guard), and verify the JWKS signature with a pinned `alg` allow-list before creating a session. Reject `alg: none`; reject `HS*` when the key is asymmetric (key-confusion guard). Wire RP-initiated logout (`end_session_endpoint`).

**PAT issuance/verification (`src/auth/pat/`):** generate a 256-bit cryptographically-random token, return it to the caller exactly once at issue time, and store only its Argon2id hash (bcrypt fallback) — never the plaintext. On verification, hash the presented token and compare against the stored hash in constant time. Tokens carry a scope set and an expiry; revocation is a hash-table delete.

**Secrets:** the client secret, issuer URL, and signing keys are referenced via `${env:VAR}` and emitted to `.env.example` with placeholder values — never inlined. (Project secret convention: `.claude/rules/security-patterns.md` rule 3.)

Also include in the prompt: all `scope: always` rule directives; the confidence expression requirement (verbatim, high/medium/low per `agents/shared/quality-charter.md` §1); the implementer's standing test obligation (unit tests for token validation: positive = valid token reaches the resource, negative = `alg:none`/expired/wrong-`aud` token is rejected); and the boundary "do NOT create branches, commits, or PRs". Await the structured result; capture `Files changed`, `Tests written`, and the `Delegation proof ID` per file.

---

## Step 4: Gate Against CQ3 Auth Floor (sub-agent delegation)

After each mode's implementer returns, delegate to `hatch3r-security` via the Task tool — the implementer-pre-write/post-write auth invocation in that agent's "When to invoke" (touches `src/auth/**`).

The security prompt MUST include the generated file paths and require these checklist items (from `agents/hatch3r-security.md` Audit checklist):

1. **OAuth 2.1 grant hygiene** (item 1) — PKCE present on every client; implicit + ROPC absent; exact-string `redirect_uri` allowlist; refresh-token rotation with reuse detection.
2. **OIDC ID-token validation** (item 2) — `iss`, `aud`, `azp`, `exp`, `nonce`, JWKS signature all verified before session creation; clock-skew window documented.
3. **JWT BCP conformance** (item 4, RFC 8725) — `alg` pinned per issuer; `alg: none` rejected; `HS*`-with-asymmetric-key rejected (key-confusion guard).
4. **Sender-constrained tokens** (item 3) — DPoP on any browser/mobile access token; a bare browser bearer is a High finding.
5. **Token-secret storage** — the PAT is stored hashed (Argon2id/bcrypt), never plaintext (OWASP ASVS v5 V6 long-lived-secret storage).

The security gate runs the relevant verification commands from that agent's table (e.g. `rg -n "response_type=code" src/auth/ | rg -v "code_challenge"` must return empty; `rg -n "grant_type=(implicit|password)" src/auth/` must return empty) and returns its `proof_trace` + status. A `CRITICAL` finding (e.g. `alg:none` accepted, refresh rotation absent on a public client) routes the fix back through `hatch3r-implementer` (max 1 regeneration pass), then re-gates. A persistent CRITICAL ends the run at `PARTIAL` and the scaffold is flagged not-merge-ready.

---

## Step 5: Verify + Iteration Summary

Run the project verification gates and record exit codes: `npm test` (or the project equivalent) for the auth unit tests, `npx tsc --noEmit`, and the security agent's grep checks re-run as a final pass.

### End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: `src/auth/oauth/<file>`, `src/auth/oidc/<file>`, `src/auth/pat/<file>` — all `via hatch3r-implementer`.

### Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 23, superseded in place 2026-07-06).

Worked example for this domain:

```markdown
## Iteration Summary

**SUCCESS** — Scaffolded OAuth 2.1 + OIDC + hashed-PAT auth for orders-api; security gate PASS on both modes.
files 9 (+412/−0) · sa 4/4 · gates 3/3 · cost Δ+6% tok / Δ+2% min · tier 2
Not done: `.env.example` placeholders — deferred: populate real issuer + client_secret before first run
Next: wire the OIDC callback route into the service router.
```

Status decision rules:
- **SUCCESS** — boilerplate generated, security gate PASS, auth unit tests + typecheck exit 0.
- **PARTIAL** — generated but the security gate left a residual High/Critical finding, or a verification gate failed.
- **FAILED** — the implementer returned BLOCKED on every mode; nothing written.
- **BLOCKED** — provider/issuer or client type contradictory or undecided, or a security gate Critical the maintainer must rule on.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping: `1` = spec parse + confirm, `2` = implementer boilerplate generation, `3` = security gate + verify + summary. Tier 1 single-mode runs are exempt per the Tier 1 exemption.

---

## Guardrails

1. **One ASK gate.** Step 2 is the only user-facing checkpoint; after `accept`, the run proceeds through Step 5.
2. **No commit or push.** Generated auth code is left staged for human review; git operations are out of scope.
3. **No deprecated grants.** Never scaffold the implicit grant or ROPC — both are removed from OAuth 2.1; PKCE on the authorization-code flow is the only public-client path.
4. **No inlined secrets.** Client secrets, signing keys, and issuer URLs are referenced via `${env:VAR}` and emitted to `.env.example` with placeholders — never written into source.
5. **No plaintext long-lived tokens.** PATs are stored Argon2id/bcrypt-hashed and shown once at issue; a scaffold that persists a PAT in plaintext fails the Step 4 CQ3 gate.
6. **Security gate is mandatory.** The `hatch3r-security` CQ3 gate runs on every generated auth mode — a scaffold is never declared SUCCESS without a PASS verdict.

## Resumability (Decision 27/30)

auth-scaffold fans out one implementer per auth mode, so checkpoint at the per-mode boundary — an interrupted run re-enters at the first un-generated mode rather than regenerating completed OAuth/OIDC/PAT modules.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.auth-scaffold-workspace/`; step range the Step 1 → Step 5 progression; `wave` = the per-mode index in Step 3/4; snapshot/rollback paths every `src/auth/**` file a Step 3 implementer or a Step 4 regeneration touches. Write points: after the Step 1 spec parse, after the Step 2 accept gate, after each Step 3 implementer return (per mode), and after each Step 4 security gate.

## References

- [OAuth 2.1 Authorization Framework (`draft-ietf-oauth-v2-1-15`)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) (accessed 2026-06-02, IETF OAuth WG, official-docs) — mandates PKCE on every client, exact-string redirect-URI matching, removal of the implicit + ROPC grants, the bearer-token-in-query prohibition, and sender-constrained-or-one-time refresh tokens for public clients; source for the Step 3 OAuth contract and the deprecated-grant guardrail.
- [oauth.net — OAuth 2.1 specification index](https://oauth.net/2.1/) (accessed 2026-06-02, Aaron Parecki / OAuth.net, official-docs) — canonical clearinghouse summarizing the OAuth 2.1 normative changes (PKCE, exact redirect match, grant removals, refresh-token constraints); corroborating second source for the OAuth invariants.
- [OWASP ASVS v5.0 — V10 OAuth and OIDC](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md) (accessed 2026-06-02, OWASP Foundation, official-docs; v5.0 released May 2025) — verification requirements for exact redirect-URI allowlisting, sender-constrained tokens (mTLS / DPoP), and ID-token `nonce` replay mitigation; the CQ3 floor the Step 4 gate checks against.
- [OpenID Connect Core 1.0 §3.1.3.7 — ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) (accessed 2026-06-02, OpenID Foundation, official-docs) — the `iss`/`aud`/`azp`/`exp`/`nonce`/signature checks required before session creation; source for the Step 3 OIDC validation contract.
- `agents/hatch3r-security.md` -> Audit checklist items 1-4, Verification commands (accessed 2026-06-02, in-repo canonical, official-docs) — the CQ3 auth-depth floor and the grep-based verification the Step 4 gate runs.
