# Adapter Development

When creating or modifying a platform adapter in `src/adapters/`:

1. **Extend** `BaseAdapter` from `src/adapters/base.ts` — implement `doGenerate(ctx: AdapterContext)` returning `AdapterOutput[]`
2. **Read canonical content** via `readCanonicalFiles()` from `src/adapters/canonical.ts`
3. **Apply customization** via `applyCustomization()` from `src/adapters/customization.ts`
4. **Wrap output** in managed blocks via `wrapInManagedBlock()` from `src/merge/managedBlocks.ts`
5. **Register** the adapter in `src/adapters/index.ts` (adapterMap, TOOL_DISPLAY_NAMES, ADAPTER_CAPABILITIES)
6. **Web-research** the target platform's current documentation before implementation — staleness is a finding per P3
7. **Write tests** in `src/__tests__/adapters/{name}.test.ts` covering: output paths, format, feature flags, MCP, hooks, managed blocks, error paths
8. **Run gates:** `npm test`, `npx tsc --noEmit`, `npm run lint`

Reference adapters: `src/adapters/cursor.ts` (full-featured), `src/adapters/claude.ts` (CLAUDE.md output), `src/adapters/zed.ts` (minimal).

Audit checklist: `governance/audit/domains/D09-platform-adapters.md`
