---
id: adapter-development
type: rule
description: Procedure for creating or modifying a platform adapter in src/adapters/ — extend BaseAdapter, read canonical content, apply customization, wrap in managed blocks, register, web-research currency, write tests, run gates.
tags: [maintainer, adapters, p3, p2]
scope: always
precedence: high
---

# Adapter Development

> Last updated: 2026-07-09

**Pillars:** P3 (Adapter Currency), P2 (Scientific Quality)

When creating or modifying a platform adapter in `src/adapters/`:

1. **Extend** `BaseAdapter` from `src/adapters/base.ts` — implement `doGenerate(ctx: AdapterContext)` returning `AdapterOutput[]`
2. **Read canonical content** via `readCanonicalFiles()` from `src/adapters/canonical.ts`
3. **Apply customization** via `applyCustomization()` from `src/adapters/customization.ts`
4. **Wrap output** in managed blocks via `wrapInManagedBlock()` from `src/merge/managedBlocks.ts`
5. **Register** the adapter in `src/adapters/index.ts::adapterFactories` + `ADAPTER_CAPABILITIES`, and add the display name in `src/cli/shared/constants.ts::TOOL_DISPLAY_NAMES`
6. **Web-research** the target platform's current documentation before implementation — staleness is a finding per P3
7. **Write tests** in `src/__tests__/adapters/{name}.test.ts` covering: output paths, format, feature flags, MCP, hooks, managed blocks, error paths
8. **Run gates:** `npm test`, `npx tsc --noEmit`, `npm run lint`

Reference adapters (3 supported per CONSTITUTION §6 Decision 12, 1.9.0 hard-cut): `src/adapters/cursor.ts` (full-featured), `src/adapters/claude.ts` (CLAUDE.md output), `src/adapters/copilot.ts` (GitHub Copilot custom-instructions).

## Cooperative cancellation

Between long-running loop iterations in `doGenerate` (per-agent emission, cursor.ts's per-rule `.mdc` emission), call `this.throwIfAborted(ctx)` so a pipeline timeout cancels the batch mid-flight instead of waiting for the current file set to finish. Reuse the shared static `BaseAdapter.throwIfSignalAborted(signal)` (`src/adapters/base.ts`) — do not hand-roll a new abort check. It mirrors the platform primitive `signal.throwIfAborted()` (Node 17.3.0+/16.17.0+: throws `signal.reason` when `signal.aborted` is `true`; nodejs.org/api/globals.html, accessed 2026-07-12), with one intentional deviation the raw call lacks — a non-Error `signal.reason` (e.g. a string) is wrapped in an `Error` with `name = "AbortError"` rather than re-thrown as-is, so every caller can match on both `err instanceof Error` and `err.name === "AbortError"`. Calling the raw `signal.throwIfAborted()` at a new site drops that `instanceof Error` guarantee — which is why the helper is kept rather than replaced by the native call.

Audit checklist: `governance/audit/domains/D09-platform-adapters.md`
