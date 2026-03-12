# Domain 3: Test Infrastructure

**Scope:** All 39 test files across the test suite. Coverage analysis, test quality assessment, and testing infrastructure evaluation.
**Sub-agents:** 5

### Test File Distribution

| Category | Files | Count |
|----------|-------|-------|
| Adapters | `src/__tests__/adapters/` | 17 |
| CLI | `src/__tests__/cli/` | 8 |
| Content | `src/__tests__/content/` | 2 |
| Models | `src/__tests__/models/` | 2 |
| Merge | `src/__tests__/merge/` | 2 |
| Hooks | `src/__tests__/hooks/` | 2 |
| Detect | `src/__tests__/detect/` | 1 |
| Env | `src/__tests__/env/` | 1 |
| Integrity | `src/__tests__/integrity/` | 1 |
| Manifest | `src/__tests__/manifest/` | 1 |
| Archive | `src/__tests__/archive/` | 1 |
| Fixtures | `src/__tests__/fixtures/` | 1 |
| **Total** | | **39** |

## Sub-Agent Decomposition

| SA | Focus | Files |
|----|-------|-------|
| 3.1 | Adapter Tests | 17 test files in `src/__tests__/adapters/` |
| 3.2 | CLI Tests | 8 test files in `src/__tests__/cli/` |
| 3.3 | Content & Manifest Tests | `src/__tests__/content/{index,tags}.test.ts`, `src/__tests__/manifest/hatchJson.test.ts` |
| 3.4 | Integration Tests | `src/__tests__/{hooks,models,detect,env,integrity,archive,merge}/` (10 files) |
| 3.5 | Coverage Meta-Analysis | All 39 test files, coverage report, test infrastructure |

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

### 3.5 Coverage Meta-Analysis
- [ ] Run `npm test` and analyze overall coverage percentage
- [ ] Identify untested modules — source files with zero coverage
- [ ] Identify untested branches — conditional paths not exercised
- [ ] Test quality assessment — assertions per test, meaningful vs trivial tests
- [ ] Test determinism — no flaky tests, no order dependencies
- [ ] Fixture management — test data is organized and maintainable
- [ ] Missing test scenarios — identify gaps based on source code analysis
