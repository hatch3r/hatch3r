---
id: hatch3r-api-spec
type: skill
description: Generate and validate OpenAPI specifications from codebase. Covers endpoint design, schema validation, and documentation generation.
tags: [planning]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# API Specification Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Inventory existing endpoints
- [ ] Step 2: Generate OpenAPI spec
- [ ] Step 3: Validate schemas
- [ ] Step 4: Generate documentation
- [ ] Step 5: Verify spec accuracy
- [ ] Step 6: Wire oasdiff breaking-change CI gate
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: OpenAPI version (3.0 vs 3.1), spec output path, auth scheme (Bearer vs OAuth2 vs API key), breaking-change policy (block vs version vs document), and target consumers (SDK clients vs human docs vs both).

## Step 1: Inventory Existing Endpoints

- Scan route definitions across the codebase (controllers, handlers, route files).
- For each endpoint, extract: HTTP method, path, request parameters, request body shape, response body shape, status codes, authentication requirements.
- Identify inconsistencies in naming, parameter styles, or response formats.
- Check for undocumented endpoints that exist in code but lack API docs.

## Step 2: Generate OpenAPI Spec

- Create or update `openapi.yaml` (or `openapi.json`) at the project root or `docs/api/` directory.
- Use OpenAPI 3.1 format.
- Include `info` block with title, version, description, and contact.
- Group endpoints by tag (resource or domain area).
- Define reusable `components/schemas` for shared request/response types.
- Use `$ref` references to avoid schema duplication.
- Add `security` schemes matching the project's authentication (Bearer, API key, OAuth2).

## Step 3: Validate Schemas

- Verify all request bodies have JSON Schema validation constraints (`required`, `minLength`, `maxLength`, `pattern`, `enum`).
- Verify response schemas match actual serialized output (check serializers, DTOs, or response builders).
- Validate enum values match database constraints or application constants.
- Check for nullable fields — mark explicitly with `nullable: true` or type union.
- Run a spec linter (e.g., `spectral`, `redocly lint`) if available in the project.

## Step 4: Generate Documentation

- Produce human-readable API docs from the spec (Swagger UI, Redoc, or Markdown).
- Include example request/response bodies for each endpoint.
- Document error response shapes with status code meanings.
- Add authentication setup instructions.
- Include rate limiting and pagination details where applicable.

## Step 5: Verify Spec Accuracy

- Cross-reference the generated spec against integration tests to confirm endpoint behavior.
- Verify content types (`application/json`, `multipart/form-data`, etc.) match actual handlers.
- Check that path parameters, query parameters, and headers are documented with accurate types, required flags, and example values.
- Validate against any existing API consumers (SDKs, frontend clients) for breaking changes.

## Step 6: Wire `oasdiff` Breaking-Change CI Gate

Breaking changes on stable endpoints must trip CI before merge. This step enforces the CONSTITUTION §2 P5 lean-thresholds row "API breaking-change events on stable endpoints = 0 per release" (governance/CONSTITUTION.md:80, verified by `oasdiff / buf breaking / graphql-inspector CI gate`).

### 6.1 Install `oasdiff`

Pick one of two install paths:

- npm global (CI runner with Node 22+): `npm i -g @tufin/oasdiff`
- Docker image (no Node dependency): `docker run --rm -t -v $(pwd):/specs tufin/oasdiff <subcommand>`

Pin the version in CI (e.g., `npm i -g @tufin/oasdiff@1.10.x` or `tufin/oasdiff:1.10`) so a new release of oasdiff does not change gate semantics mid-cycle.

### 6.2 Compare current spec vs previous merged version

The gate compares the spec on the feature branch against the spec at the merge base on the default branch. Fail CI on any breaking change to a stable endpoint; report non-breaking diffs as informational.

- Fetch the base ref's spec into a temp path (e.g., `git show origin/main:openapi.yaml > /tmp/openapi.base.yaml`).
- Run `oasdiff breaking /tmp/openapi.base.yaml ./openapi.yaml --fail-on ERR` — exit code 1 when one or more `ERR`-level breaking changes are detected.
- Scope the gate to stable endpoints by excluding paths tagged `x-stability: experimental` via `--match-path` or by maintaining an `oasdiff-ignore.yaml` rules file for documented breaking changes already coordinated with consumers.

### 6.3 Example GitHub Actions step

```yaml
name: API Breaking-Change Gate
on:
  pull_request:
    paths:
      - 'openapi.yaml'
      - 'openapi.json'
      - 'docs/api/**'

jobs:
  oasdiff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install oasdiff
        run: npm i -g @tufin/oasdiff@1.10.x
      - name: Resolve base spec
        run: |
          git show origin/${{ github.base_ref }}:openapi.yaml > /tmp/openapi.base.yaml
      - name: Run breaking-change diff
        run: |
          oasdiff breaking /tmp/openapi.base.yaml ./openapi.yaml \
            --fail-on ERR \
            --format githubactions
```

The `--format githubactions` flag emits `::error::` annotations so each breaking change shows up inline on the PR diff.

### 6.4 Handling an intentional breaking change

When a breaking change is deliberate (versioned endpoint cut, deprecated field removed after the documented sunset window):

1. Add a row to `oasdiff-ignore.yaml` with the change ID, the affected operation, and a link to the consumer-coordination record.
2. Bump the spec `info.version` in line with the project's API versioning policy (semver-major for breaking changes on stable endpoints).
3. Document the change in CHANGELOG (or equivalent) with the migration path for downstream consumers.

The gate stays green only because the change is recorded — not because the breaking signal was silenced.

## Error Handling

- **Route definitions use dynamic or meta-programmed patterns**: If endpoints are generated at runtime or via decorators that resist static analysis, document the gap and manually enumerate the missing endpoints.
- **OpenAPI linter fails on generated output**: Fix the specific schema violations reported by the linter. Do not suppress linter rules without documenting the reason.
- **Breaking changes detected against existing consumers**: Flag each breaking change with the affected consumer, the migration path, and whether a versioned endpoint is needed.

## Definition of Done

- [ ] OpenAPI spec covers all endpoints in the codebase
- [ ] All schemas have validation constraints
- [ ] Spec passes linter validation
- [ ] Example requests/responses included
- [ ] No breaking changes to existing API consumers
- [ ] `oasdiff breaking` CI gate is wired and fails on any `ERR`-level breaking change on stable endpoints (CONSTITUTION §2 P5: 0 per release)
