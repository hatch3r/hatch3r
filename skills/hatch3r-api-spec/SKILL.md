---
id: hatch3r-api-spec
type: skill
description: Generate and validate OpenAPI specifications from codebase. Covers endpoint design, schema validation, and documentation generation.
---

# API Specification Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Inventory existing endpoints
- [ ] Step 2: Generate OpenAPI spec
- [ ] Step 3: Validate schemas
- [ ] Step 4: Generate documentation
- [ ] Step 5: Verify spec accuracy
```

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

- Ensure all request bodies have JSON Schema validation constraints (`required`, `minLength`, `maxLength`, `pattern`, `enum`).
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
- Check that path parameters, query parameters, and headers are correctly documented.
- Validate against any existing API consumers (SDKs, frontend clients) for breaking changes.

## Definition of Done

- [ ] OpenAPI spec covers all endpoints in the codebase
- [ ] All schemas have validation constraints
- [ ] Spec passes linter validation
- [ ] Example requests/responses included
- [ ] No breaking changes to existing API consumers
