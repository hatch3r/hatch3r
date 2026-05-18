---
name: h4tcher-adapter-author
description: Create or modify a platform adapter with web research, implementation, testing, and D09 checklist verification.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit WebSearch WebFetch
---

# Adapter Author

Create or modify a platform adapter for hatch3r.

## Step 1: Understand the Contract

1. Read `src/adapters/base.ts` — the `BaseAdapter` abstract class defines:
   - `name: string` — adapter identifier
   - `warnings: string[]` — user-facing warnings
   - `doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]>` — core generation logic
   - `getOutputPaths(agentsDir, manifest): Promise<string[]>` — files this adapter creates
2. Read `src/adapters/canonical.ts` — `readCanonicalFiles()` reads `.agents/` content
3. Read `src/adapters/customization.ts` — `applyCustomization()` applies user overrides
4. Read `src/adapters/mcp-utils.ts` — MCP server config transformation

## Step 2: Research the Target Platform

5. Web-search the target platform's official documentation for:
   - Configuration file format and paths
   - Agent/rule/skill capability support
   - MCP server integration format
   - Hook/event system
   - Model configuration syntax
6. Cite documentation version and date in code comments

## Step 3: Study Reference Implementations

7. Read 2-3 existing adapters:
   - `src/adapters/cursor.ts` — full-featured reference (rules, agents, skills, MCP, hooks)
   - `src/adapters/claude.ts` — CLAUDE.md output format
   - `src/adapters/zed.ts` — minimal adapter (rules only)
8. Read `governance/audit/domains/D09-platform-adapters.md` for per-adapter audit checklist

## Step 4: Implement

9. Create `src/adapters/{name}.ts`:
   - Export class extending `BaseAdapter`
   - Implement `doGenerate()` — handle each content type (agents, skills, rules, commands, hooks, MCP)
   - Implement `getOutputPaths()` — return all file paths this adapter creates
   - Use `wrapInManagedBlock()` for merge-safe output
   - Use `resolveAgentModel()` for model configuration
10. Register in `src/adapters/index.ts`:
    - Add to `adapterMap`
    - Add to `TOOL_DISPLAY_NAMES`
    - Add to `ADAPTER_CAPABILITIES` matrix

## Step 5: Test

11. Create `src/__tests__/adapters/{name}.test.ts`:
    - Output path correctness
    - Content format validation
    - Feature flag behavior (when features are disabled)
    - MCP format transformation
    - Hook format if supported
    - Managed block markers present
    - Error handling for missing canonical files
12. Run: `npm test`, `npx tsc --noEmit`, `npm run lint`

## Step 6: Verify

13. Run `npx hatch3r validate` with the new adapter configured
14. Verify D09 checklist items: output paths, format, feature flags, bridge orchestration, model emission, MCP, secrets, hooks
