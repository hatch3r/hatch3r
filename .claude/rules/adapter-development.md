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

Audit checklist: `governance/audit/domains/D09-platform-adapters.md`
