---
name: h4tcher-adapter-author
description: Create or modify a platform adapter with web research, implementation, testing, and D09 checklist verification.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit WebSearch WebFetch
---

> Last updated: 2026-06-09

# Adapter Author

Create or modify a platform adapter for hatch3r.

## Step 0: P8 B1 Ambiguity Gate

Before any read or write, scan the user request against the four B1 triggers from `.claude/rules/clarification-default.md` (which carries the verbatim directive from `governance/CONSTITUTION.md` §2 P8 B1):

1. **Ambiguous scope** — request maps to ≥2 reasonable interpretations producing different adapters (e.g., "add Zed adapter" without specifying rules-only vs full-feature surface).
2. **Multiple valid interpretations** — ≥2 viable approaches with materially different cost, scope, or risk (e.g., bundling MCP support vs. deferring to a follow-up).
3. **Irreversible action** — deleting an existing adapter, renaming its public id, dropping output paths users may already depend on.
4. **Missing acceptance criteria** — no testable definition of done (e.g., no list of file paths, no capability matrix targets, no test coverage threshold).

If any trigger fires, ask via the platform-native question tool per `agents/shared/user-question-protocol.md`: one question per turn; bundle related sub-questions into a single multiple-choice prompt; 2-4 numbered options with one-line trade-offs; declare the default-if-no-response option. Do NOT proceed to Step 1 until the ambiguity is resolved or the user has confirmed the default.

## Step 1: Understand the Contract

1. Read `src/adapters/base.ts` — the `BaseAdapter` abstract class defines:
   - `name: string` — adapter identifier
   - `warnings: string[]` — user-facing warnings
   - `doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]>` — core generation logic
   - `getOutputPaths(agentsDir, manifest): Promise<string[]>` — files this adapter creates
2. Read `src/adapters/canonical.ts` — `readCanonicalFiles(canonicalRoot, type, warnings)` reads frontmatter-bearing markdown from the bundled content root resolved by `resolveBundledContentRoot()` (`src/content/contentRoot.ts`), not a user-repo `.agents/` mirror (the legacy `.agents/` materialisation no longer exists; `canonical.ts:1020-1024`)
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

7. Read the 3 supported adapters (per CONSTITUTION §6 Decision 12, 1.9.0 hard-cut):
   - `src/adapters/cursor.ts` — full-featured reference (rules, agents, skills, MCP, hooks)
   - `src/adapters/claude.ts` — CLAUDE.md output format
   - `src/adapters/copilot.ts` — GitHub Copilot custom-instructions output
8. Read `governance/audit/domains/D09-platform-adapters.md` for per-adapter audit checklist

## Step 4: Implement

9. Create `src/adapters/{name}.ts`:
   - Export class extending `BaseAdapter`
   - Implement `doGenerate()` — handle each content type (agents, skills, rules, commands, hooks, MCP)
   - Implement `getOutputPaths()` — return all file paths this adapter creates
   - Use `wrapInManagedBlock()` for merge-safe output
   - Use `resolveAgentModel()` for model configuration
10. Register the new tool across the `Record<Tool, …>` surfaces. Extend `src/types.ts::TOOLS` FIRST — it is the single `Tool` union every `Record<Tool, …>` keys from, so each surface below compile-errors until you complete it:
    - Extend `src/types.ts::TOOLS` (the `Tool` union) and its derived `src/types.ts::TOOL_WORKTREE_SUPPORT`
    - Add the archive prefix set in `src/archive/index.ts::TOOL_PATH_PREFIXES`
    - Add the factory in `src/adapters/index.ts::adapterFactories`
    - Add to the `src/adapters/index.ts::ADAPTER_CAPABILITIES` matrix
    - Add the display name in `src/cli/shared/constants.ts::TOOL_DISPLAY_NAMES`

## Step 5: Test

11. Create `src/__tests__/adapters/{name}.test.ts`:
    - Output path correctness
    - Content format validation
    - Feature flag behavior (when features are disabled)
    - MCP format transformation
    - Hook format if supported
    - Managed block markers present
    - Error handling for missing canonical files

    Also update the capability-matrix drift tests so the new tool is asserted, not skipped: add it to `TOOLS_UNDER_TEST` and `ADAPTER_SOURCE` in `src/__tests__/adapters/capabilityMatrixDrift.test.ts`, and to `TOOLS_UNDER_TEST` in `src/__tests__/adapters/capability-matrix-doc.test.ts`.
12. Run: `npm test`, `npx tsc --noEmit`, `npm run lint`

## Step 6: Verify

13. Run `npx hatch3r validate` with the new adapter configured
14. Verify D09 checklist items: output paths, format, feature flags, bridge orchestration, model emission, MCP, secrets, hooks
