# ADR-001: Pipeline Modules as Libraries Without Orchestrator

**Status:** Accepted
**Date:** 2026-04-10 (Enforcement column added 2026-06-06, Cycle 11 D16-3)
**Pillar:** P2 (Scientific & Practical Quality), P4 (Lean Coverage)

## Context

The `src/pipeline/` directory contains 14 modules that implement pipeline
infrastructure: circuit breaker, prompt guard, tool allowlists, phase output
schemas, review loop, observability, failure logging, compliance verification,
diff hashing, agent identity, adapter timeout, phase timeout, pipeline context,
and pipeline timeout.

These modules exist as standalone libraries with well-defined interfaces and
full test coverage. They are **not** wired into a single pipeline orchestrator
that drives CLI execution end-to-end.

## Decision

The pipeline modules remain as importable libraries. CLI commands integrate
them individually at their error and data boundaries rather than through a
centralized orchestrator.

**Rationale:**

1. hatch3r is a code-generation CLI, not a long-running agent runtime. Each CLI
   command (init, sync, update, validate, verify) has distinct control flow that
   does not map to a uniform pipeline.
2. A centralized orchestrator would add coupling between commands that currently
   operate independently, increasing maintenance cost without user-facing benefit.
3. Selective integration (importing the specific module where it applies) keeps
   each command's dependency surface minimal.

## All 14 Pipeline Modules

The **Enforcement** column is a controlled vocabulary (Cycle 11 D16-3, half (b)):

- `runtime-CLI` — invoked on a CLI command codepath; `scripts/validate-control-reachability.ts` proves the module is transitively reachable from the CLI entry point (`src/cli/index.ts`) through a non-test import chain, and fails CI if a `runtime-CLI` row ever stops being reachable.
- `library-contract-for-downstream` — an intentional `@library_export_only` export consumed by downstream packs, agent runtime, or a build-time governance script (e.g. `pipelineContext` feeds `scripts/validate-specialist-roster.ts`); not on a CLI runtime codepath.

The **Integration Status** column names the specific reachable importer (verified at the 2026-06-06 edit) for `runtime-CLI` rows, or the downstream consumer for library rows.

| # | Module | Purpose | Enforcement | Integration Status |
|---|--------|---------|-------------|-------------------|
| 1 | `circuitBreaker` | Transient vs substantive failure classification | `runtime-CLI` | `sync`, `update` commands + `install/selfUpdate` |
| 2 | `promptGuard` | Input/output size limits, boundary marker verification | `runtime-CLI` | `content/userContent`, `content/learningsValidation`, `adapters/customization` (content-generation paths) |
| 3 | `agentToolAllowlist` | Per-agent deny-by-default tool restrictions | `runtime-CLI` | `validate` command via `complianceVerification`; `adapters/cursor`, `adapters/claude` |
| 4 | `phaseOutputSchema` | Phase output compaction for CLI summaries (ASI07 summary bounding) | `runtime-CLI` | `sync`, `update` commands (validator surface removed in Cycle 7.5 per P4) |
| 5 | `reviewLoop` | Iterative review with finding severity tracking | `runtime-CLI` | `validate` command via `complianceVerification` → `reviewLoop` |
| 6 | `observability` | Structured telemetry and timing data | `runtime-CLI` | `sync`, `update`, `explain` commands + `workspace/sync`, `pipeline/costEstimator` |
| 7 | `failureLog` | Structured failure recording with context | `runtime-CLI` | `sync`, `update` command error handlers + `content/learningsLoader` |
| 8 | `complianceVerification` | Security control compliance checks | `runtime-CLI` | `validate` command |
| 9 | `diffHash` | Content-addressable diff fingerprinting | `runtime-CLI` | `validate` command via `complianceVerification` → `agentToolAllowlist` → `diffHash` |
| 10 | `agentIdentity` | Agent authentication and capability scoping | `library-contract-for-downstream` | `@library_export_only` — ASI03 provenance contract consumed by agent runtime (no CLI importer) |
| 11 | `adapterTimeout` | Per-adapter timeout enforcement | `runtime-CLI` | `sync`, `update` commands + `adapters/base` |
| 12 | `phaseTimeout` | Per-phase timeout enforcement | `runtime-CLI` | `sync`, `update`, `explain` commands + `adapters/base` |
| 13 | `pipelineContext` | Typed handoff context with runtime validation | `library-contract-for-downstream` | `@library_export_only` — `SPECIALIST_TRIGGER_TABLE` SSOT consumed by `scripts/validate-specialist-roster.ts` (build-time governance, no CLI importer) |
| 14 | `pipelineTimeout` | End-to-end pipeline timeout enforcement | `runtime-CLI` | `sync`, `update` commands |

## Progressive Integration Plan

Modules transition from library-only to CLI-integrated as specific commands
need their capabilities. Each integration is a separate commit, tested in
isolation, with no coupling to other modules. As of the 2026-06-06 edit, 12 of
the 14 modules are `runtime-CLI`; the 2 remaining `library-contract-for-downstream`
entries (`agentIdentity`, `pipelineContext`) carry `@library_export_only` and a
named downstream consumer.

A `runtime-CLI` Enforcement label is not a free-text claim: `scripts/validate-control-reachability.ts`
(wired into CI via `npm run validate`) parses this table and fails the build if
any `runtime-CLI` row stops being transitively reachable from `src/cli/index.ts`
through a non-test import chain. Re-labelling a module `runtime-CLI` without an
actual CLI codepath therefore cannot ship.

## Consequences

- Pipeline modules can be developed and tested independently.
- No single orchestrator failure can break all CLI commands.
- Integration gaps are tracked as audit findings (D16) and resolved per the
  progressive plan above.
- Modules that stay `library-contract-for-downstream` after two audit cycles
  without a downstream consumer are removal candidates per P4 (every file earns
  its existence). The reachability gate keeps the Enforcement labels honest so
  this review reads truthful state rather than aspirational status.
