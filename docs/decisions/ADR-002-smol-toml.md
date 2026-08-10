# ADR-002: Use smol-toml for Codex TOML validation

**Status:** Accepted
**Date:** 2026-08-10
**Pillars:** P3 (Adapter Currency), P6 (Security & Trust), CQ8 (Maintainability)

## Context

Codex project configuration and custom agents use TOML at `.codex/config.toml`
and `.codex/agents/*.toml`. Hatcher must reject malformed input before changing
those files and must parse its generated output in tests. Hand-written parsing
would duplicate TOML grammar and create inconsistent validation between the two
surfaces.

The merge path also has a co-tenancy requirement: user-owned bytes, including
comments and formatting, must survive sync and cleanup outside Hatcher's managed
region.

## Decision

Use `smol-toml` 1.7.1 as the production TOML parser. Pin the exact version in
`package.json` and `package-lock.json`. Centralize parsing and schema-specific
validation in `src/codex/tomlCodec.ts`; adapters import that codec instead of
calling the dependency directly.

Parsing validates documents, but it does not own merge serialization.
`src/codex/projectToml.ts` replaces only the marked Hatcher region and preserves
all bytes outside it. Hatcher renders its own deterministic TOML subset with the
codec's string, key, array, and table helpers.

## Alternatives Considered

| Alternative | Benefit | Rejected because |
|-------------|---------|------------------|
| Hand-written TOML parser | No dependency | TOML grammar and error handling would become a security-sensitive local implementation. |
| Parse through a child process | Reuse another runtime | Adds executable behavior, platform dependencies, and a wider command-injection boundary. |
| Parse and reserialize the complete document | Simpler object merge | Rewrites user formatting and comments, violating Codex co-tenancy guarantees. |
| String-only validation | Preserves bytes | Cannot reliably detect malformed tables, arrays, escaping, or type conflicts. |

## Security and Supply-Chain Controls

- `smol-toml` is a pure parser dependency; Hatcher does not grant it filesystem,
  network, or process-execution capabilities.
- The version is exact-pinned and the npm lock records its integrity hash.
- Untrusted repository TOML is parsed before mutation. Parse or schema errors
  fail closed with `VALIDATION_ERROR`; Hatcher leaves the original file intact.
- Adapter-specific validation rejects unsupported custom-agent root fields and
  validates generated TOML again after merge.
- Dependency and production-audit gates remain the authority for advisory drift;
  this ADR does not waive future vulnerability findings.

## Comment-Preservation Limit

`smol-toml` returns a value tree, not a comment-preserving syntax tree. Hatcher
therefore cannot move, normalize, or semantically merge comments inside the
Hatcher-owned region. Sync replaces that managed region, so comments manually
inserted inside it are not preserved. Comments and formatting outside the
managed markers are retained byte-for-byte. A malformed document or damaged
marker pair is rejected rather than rewritten.

## Consequences

- Codex project and custom-agent TOML share one parser and error taxonomy.
- Generated files are syntax-checked without inventing a partial TOML grammar.
- User-owned formatting remains stable outside managed regions.
- The production dependency must stay pinned, audited, and covered by parser and
  lifecycle regression tests.

## Related

- `src/codex/tomlCodec.ts`
- `src/codex/projectToml.ts`
- `src/adapters/codexTomlCodec.ts`
- `src/__tests__/adapters/codexConfig.test.ts`
- `src/__tests__/adapters/codexAgents.test.ts`
