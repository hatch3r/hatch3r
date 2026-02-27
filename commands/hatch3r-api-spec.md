---
id: hatch3r-api-spec
type: command
description: Generate or validate an OpenAPI specification from the codebase. Scans route definitions, extracts schemas, and produces a complete API spec.
---
# API Specification Generator

## Inputs

- **Mode:** `generate` (create spec from code) or `validate` (check existing spec against code)
- **Format:** `yaml` (default) or `json`
- **Output path:** default `docs/api/openapi.yaml`

## Procedure

### Generate Mode

1. **Scan the codebase** for route/endpoint definitions. Check common patterns:
   - Express/Fastify route handlers
   - NestJS/Spring controllers with decorators
   - tRPC routers
   - GraphQL schema definitions
2. **Extract for each endpoint:** method, path, path params, query params, request body type, response type, status codes, auth requirements.
3. **Build the OpenAPI 3.1 document:**
   - `info` block from `package.json` (name, version, description)
   - Group endpoints by resource/tag
   - Create `components/schemas` from TypeScript types/interfaces or equivalent
   - Add `securitySchemes` matching the project's auth mechanism
4. **Write the spec** to the output path.
5. **Run validation** on the generated spec using `spectral` or `redocly` if available.

### Validate Mode

1. **Read the existing spec** from the output path.
2. **Scan the codebase** for current endpoints (same as generate step 1).
3. **Compare:** identify endpoints in code but not in spec (undocumented), and endpoints in spec but not in code (stale).
4. **Schema drift:** check if request/response types in code have diverged from spec schemas.
5. **Report** discrepancies with file locations and suggested fixes.

## Output

- Generated or validated OpenAPI spec file
- Summary of endpoints documented/missing/stale
- Validation errors if any schema issues found

## Related

- **Skill:** `hatch3r-api-spec` — detailed workflow for spec authoring
- **Rule:** `hatch3r-api-design` — API design conventions to follow
