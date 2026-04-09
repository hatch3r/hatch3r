# Domain 3: Test Infrastructure

**Scope:** All 47 test files across the test suite. Coverage analysis, test quality assessment, and testing infrastructure evaluation.
**Sub-agents:** 5

### Test File Distribution

| Category | Files | Count |
|----------|-------|-------|
| Adapters | `src/__tests__/adapters/` | 19 |
| CLI | `src/__tests__/cli/` | 10 |
| Content | `src/__tests__/content/` | 3 |
| Workspace | `src/__tests__/workspace/` | 3 |
| Models | `src/__tests__/models/` | 2 |
| Merge | `src/__tests__/merge/` | 2 |
| Hooks | `src/__tests__/hooks/` | 2 |
| Worktree | `src/__tests__/worktree/` | 1 |
| Detect | `src/__tests__/detect/` | 1 |
| Env | `src/__tests__/env/` | 1 |
| Integrity | `src/__tests__/integrity/` | 1 |
| Manifest | `src/__tests__/manifest/` | 1 |
| Archive | `src/__tests__/archive/` | 1 |
| **Total** | | **47** |

## Sub-Agent Decomposition

| SA | Focus | Files |
|----|-------|-------|
| 3.1 | Adapter Tests | 19 test files in `src/__tests__/adapters/` (note: no `amazonq.test.ts` exists) |
| 3.2 | CLI Tests | 10 test files in `src/__tests__/cli/` |
| 3.3 | Content & Manifest Tests | `src/__tests__/content/{index,tags,assertSafePath}.test.ts`, `src/__tests__/manifest/hatchJson.test.ts` |
| 3.4 | Integration Tests | `src/__tests__/{hooks,models,detect,env,integrity,archive,merge,workspace,worktree}/` (14 files) |
| 3.5 | Coverage Meta-Analysis | All 47 test files, coverage report, test infrastructure |

## Audit Checklists

### 3.1 Adapter Tests
- [ ] Each adapter test covers: output path correctness, format validation, feature flag behavior, MCP format, hook format, managed blocks
- [ ] Test isolation — no cross-test state leakage
- [ ] Mocking patterns — mocks are minimal and realistic
- [ ] Coverage of error paths — adapter failures are tested

### 3.2 CLI Tests
- [ ] Each CLI command test covers: happy path, error cases, edge cases (existing install, corrupt state, missing dependencies)
- [ ] Mock completeness — filesystem, network, and process mocks are accurate
- [ ] Interactive prompt testing — inquirer prompts are correctly simulated
- [ ] Exit code verification — correct exit codes for success and failure

### 3.3 Content & Manifest Tests
- [ ] Content index tests cover tag filtering, preset application, selective init scenarios
- [ ] Tag tests verify classification accuracy for all content types
- [ ] Manifest tests cover schema validation, parsing edge cases, malformed input

### 3.4 Integration Tests
- [ ] Hook integration tests — hook lifecycle, adapter-specific format transformation
- [ ] Model resolution/customization tests — override application, precedence
- [ ] Repo analyzer tests — detection accuracy across project types
- [ ] MCP env tests — environment variable generation correctness
- [ ] Integrity verification tests — tamper detection accuracy
- [ ] Archive tests — backup creation, restoration, cleanup
- [ ] Safe write/managed block tests — merge integrity, concurrent access
- [ ] Workspace integration tests — manifest lifecycle, multi-repo sync, detection accuracy
- [ ] Worktree integration tests — setup flow, pattern resolution, cross-worktree isolation

### 3.5 Coverage Meta-Analysis
- [ ] Run `npm test` and analyze overall coverage percentage
- [ ] Identify untested modules — source files with zero coverage (note: `src/adapters/amazonq.ts` has no test file)
- [ ] Identify untested branches — conditional paths not exercised
- [ ] Test quality assessment — assertions per test, meaningful vs trivial tests
- [ ] Test determinism — no flaky tests, no order dependencies
- [ ] Fixture management — test data is organized and maintainable
- [ ] Missing test scenarios — identify gaps based on source code analysis
- [ ] Regression quality assessment: zero-regression rate across framework updates, content freshness verification, maintenance burden analysis (effort to keep framework current)
