# Domain 3: Test Infrastructure

> Last updated: 2026-04-19

**Pillars served:** P2 (primary), P5 (supporting).

**Scope:** All 133 test files across the test suite. Coverage analysis, test quality assessment, and testing infrastructure evaluation.
**Sub-agents:** 5

### Test File Distribution

| Category | Files | Count |
|----------|-------|-------|
| CLI | `src/__tests__/cli/` | 27 |
| Adapters | `src/__tests__/adapters/` | 26 |
| Pipeline | `src/__tests__/pipeline/` | 22 |
| Content | `src/__tests__/content/` | 13 |
| Merge | `src/__tests__/merge/` | 6 |
| CliTools | `src/__tests__/cliTools/` | 6 |
| Workspace | `src/__tests__/workspace/` | 5 |
| Audit | `src/__tests__/audit/` | 5 |
| Worktree | `src/__tests__/worktree/` | 3 |
| Hooks | `src/__tests__/hooks/` | 3 |
| Detect | `src/__tests__/detect/` | 3 |
| Version | `src/__tests__/version/` | 2 |
| Models | `src/__tests__/models/` | 2 |
| Env | `src/__tests__/env/` | 2 |
| Manifests | `src/__tests__/manifests/` | 1 |
| Manifest | `src/__tests__/manifest/` | 1 |
| Install | `src/__tests__/install/` | 1 |
| Importers | `src/__tests__/importers/` | 1 |
| E2E | `src/__tests__/e2e/` | 1 |
| Clean | `src/__tests__/clean/` | 1 |
| Archive | `src/__tests__/archive/` | 1 |
| Root (`types.test.ts`) | `src/__tests__/` | 1 |
| **Total** | | **133** |

## Sub-Agent Decomposition

| SA | Focus | Files |
|----|-------|-------|
| 3.1 | Adapter Tests | 26 test files in `src/__tests__/adapters/` (now includes `amazonq.test.ts`) |
| 3.2 | CLI Tests | 27 test files in `src/__tests__/cli/` |
| 3.3 | Content & Manifest Tests | `src/__tests__/content/` (13 files), `src/__tests__/manifest/`, `src/__tests__/manifests/` |
| 3.4 | Integration Tests | `src/__tests__/{hooks,models,detect,env,archive,merge,workspace,worktree,pipeline,audit,cliTools,version,clean,e2e,importers,install}/` (83 files) |
| 3.5 | Coverage Meta-Analysis | All 133 test files, coverage report, test infrastructure |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

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
- [ ] Drift detection tests — regenerate-and-diff accuracy
- [ ] Archive tests — backup creation, restoration, cleanup
- [ ] Safe write/managed block tests — merge integrity, concurrent access
- [ ] Workspace integration tests — manifest lifecycle, multi-repo sync, detection accuracy
- [ ] Worktree integration tests — setup flow, pattern resolution, cross-worktree isolation

### 3.5 Coverage Meta-Analysis
- [ ] Run `npm test` and analyze overall coverage percentage
- [ ] Identify untested modules — source files with zero coverage
- [ ] Identify untested branches — conditional paths not exercised
- [ ] Test quality assessment — assertions per test, meaningful vs trivial tests
- [ ] Test determinism — no flaky tests, no order dependencies
- [ ] Fixture management — test data is organized and maintainable
- [ ] Missing test scenarios — identify gaps based on source code analysis
- [ ] Regression quality assessment: zero-regression rate across framework updates, content freshness verification, maintenance burden analysis (effort to keep framework current)
