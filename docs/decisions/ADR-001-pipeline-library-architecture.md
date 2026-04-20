# ADR-001: Pipeline Modules as Libraries Without Orchestrator

**Status:** Accepted
**Date:** 2026-04-10
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

| # | Module | Purpose | Integration Status |
|---|--------|---------|-------------------|
| 1 | `circuitBreaker` | Transient vs substantive failure classification | Planned: adapter retry logic |
| 2 | `promptGuard` | Input/output size limits, boundary marker verification | Planned: content generation paths |
| 3 | `agentToolAllowlist` | Per-agent deny-by-default tool restrictions | Library (consumed by agent configs) |
| 4 | `phaseOutputSchema` | Phase output compaction for CLI summaries (ASI07 summary bounding) | Done: `sync`, `update`, `verify` commands (validator surface removed in Cycle 7.5 per P4) |
| 5 | `reviewLoop` | Iterative review with finding severity tracking | Library (consumed by review phase) |
| 6 | `observability` | Structured telemetry and timing data | Planned: `--verbose` output |
| 7 | `failureLog` | Structured failure recording with context | Done: `sync` command error handler |
| 8 | `complianceVerification` | Security control compliance checks | Done: `validate` command |
| 9 | `diffHash` | Content-addressable diff fingerprinting | Library (consumed by integrity checks) |
| 10 | `agentIdentity` | Agent authentication and capability scoping | Library (consumed by agent configs) |
| 11 | `adapterTimeout` | Per-adapter timeout enforcement | Library (consumed by adapter base) |
| 12 | `phaseTimeout` | Per-phase timeout enforcement | Library (consumed by phase runners) |
| 13 | `pipelineContext` | Typed handoff context with runtime validation | Library (consumed by all phases) |
| 14 | `pipelineTimeout` | End-to-end pipeline timeout enforcement | Library (consumed by pipeline entry) |

## Progressive Integration Plan

Modules transition from library-only to CLI-integrated as specific commands
need their capabilities. Each integration is a separate commit, tested in
isolation, with no coupling to other modules.

## Consequences

- Pipeline modules can be developed and tested independently.
- No single orchestrator failure can break all CLI commands.
- Integration gaps are tracked as audit findings (D16) and resolved per the
  progressive plan above.
- Modules that remain unintegrated after two audit cycles are candidates for
  removal per P4 (every file earns its existence).
