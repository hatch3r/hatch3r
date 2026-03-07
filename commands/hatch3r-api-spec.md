---
id: hatch3r-api-spec
type: command
description: Generate or validate an OpenAPI specification from the codebase. Scans route definitions, extracts schemas, and produces a complete API spec.
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Codebase Scan | `hatch3r-researcher` (codebase-analysis mode) | No | Yes |
| 2. Schema Extraction | Orchestrator (inline) | No | Yes |
| 3. Spec Generation | `hatch3r-docs-writer` | No | Yes |
| 4. Validation | `hatch3r-reviewer` | No | Yes (if validate mode) |

# API Specification Generator — OpenAPI from Code or Code-vs-Spec Drift Detection

Take a codebase with HTTP or RPC endpoints and produce a complete OpenAPI 3.1 specification (`docs/api/`), or take an existing spec and compare it against the live codebase to surface undocumented, stale, or drifted endpoints. The researcher sub-agent scans route definitions, decorators, and handlers; the orchestrator extracts TypeScript types and validation schemas inline; the docs-writer assembles the final spec document; and the reviewer validates structural correctness. AI proposes all outputs; user confirms before any files are written.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. Cache any values found (GitHub owner/repo, tooling directives).

**Read the `hatch3r-api-design` rule** if it exists. This rule contains the project's API design conventions (naming, versioning, error shapes, pagination patterns) that the generated spec must conform to.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once the researcher's route scan is collected, reference it in memory — do not re-scan the same directories.
2. **Limit schema reads.** Read only the imported type file — not the entire module tree. Follow one level of imports; stop there.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.
4. **Batch schema extraction.** Group types by source file. Read each file once and extract all referenced types in a single pass.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather API Context

1. **ASK:** "I'll generate or validate an OpenAPI specification from your codebase. I need:
   - **Mode:** `generate` (create spec from code) or `validate` (check existing spec against code)
   - **Output format:** `yaml` (default) or `json`
   - **Output path:** default `docs/api/openapi.yaml` — or specify a custom path
   - **Scope:** full API, or limit to specific route prefixes / modules (e.g., `/api/v2/`, `src/routes/billing/`)
   - **Spec version:** OpenAPI 3.1 (default) or 3.0

   If you have an existing spec you want to validate, point me to its path."

2. If the user provides a validate-mode path, verify the file exists. If it does not, report the error and fall back to generate mode with an ASK.
3. Present a structured summary:

```
API Spec Brief:
  Mode:         {generate | validate}
  Format:       {yaml | json}
  Output:       {path}
  Scope:        {full | scoped to X}
  Spec version: {3.1 | 3.0}
```

**ASK:** "Does this look right? Adjust anything before I scan the codebase."

---

### Step 2: Framework Detection

1. Scan `package.json` dependencies and source patterns to identify the API framework. Supported detections: Express, Fastify, NestJS, tRPC, GraphQL, Hono, Next.js API Routes, Elysia. Assign confidence (high/medium/low) based on signal strength (dependency present + matching code patterns = high).

2. Detect validation/schema libraries: Zod, class-validator, TypeBox, Joi, Ajv/JSON Schema, io-ts, Effect Schema.

3. Check for existing OpenAPI tooling (`zod-to-openapi`, `swagger-jsdoc`, `@nestjs/swagger`, `tsoa`, `fastify-swagger`).

4. Detect auth patterns by scanning middleware, guards, and decorators for JWT, API key, OAuth, or session-based auth.

5. Present detection results:

```
Framework Detection:
  Primary framework:  {name} ({confidence})
  Schema library:     {name | none detected}
  Existing OAS tools: {name | none detected}
  Auth patterns:      {JWT / API key / OAuth / session / none detected}
  Route base path:    {e.g., /api/v1}
  Files to scan:      {N} files across {M} directories
```

**ASK:** "I detected the above. Corrections? Additional patterns I should look for (custom middleware, versioned routes, etc.)?"

---

### Step 3: Endpoint Discovery

Spawn the `hatch3r-researcher` sub-agent in `codebase-analysis` mode with the confirmed framework and scope.

**Researcher prompt must include:** the confirmed framework and schema library, the scope, instruction to follow the **hatch3r-researcher agent protocol**, and depth level `standard`.

For each discovered endpoint, extract: HTTP method, path, path/query parameters, request body type, response type(s), status codes, auth requirement, tags/grouping, and description (from JSDoc or decorator metadata).

Present the discovery summary:

```
Endpoint Discovery:
  Total endpoints:   {N}
  Methods:           GET: {n}, POST: {n}, PUT: {n}, PATCH: {n}, DELETE: {n}
  Auth-protected:    {N} / {total}
  With response types: {N}
  Missing types:     {N} endpoints with no extractable request/response types
  Grouped by:
    {tag/controller}: {N} endpoints
    ...
```

List endpoints with missing or incomplete type information.

**ASK:** "I found {N} endpoints. {M} have incomplete type information (listed above). Options:
- **Confirm** to proceed (incomplete endpoints get placeholder schemas)
- **Add missing endpoints** you know exist but I didn't find
- **Exclude endpoints** from the spec
- **Provide type hints** for endpoints with missing types"

---

### Step 4: Schema Extraction

For each endpoint with typed request/response shapes, extract the underlying types.

1. **Resolve type references.** Follow one level of imports to capture referenced interfaces, enums, and union types.
2. **Convert to OpenAPI schemas.** Map TypeScript types, Zod chains, class-validator decorators, TypeBox definitions, and Joi schemas to JSON Schema properties. Preserve descriptions from `.describe()` calls or JSDoc.
3. **Deduplicate.** Identical types across endpoints become a single `components/schemas` entry referenced via `$ref`.
4. **Detect shared patterns** — pagination wrappers, error response shapes, envelope patterns.

```
Schema Extraction:
  Components extracted: {N} schemas
  Shared patterns:      {pagination: yes/no, error shape: yes/no, envelope: yes/no}
  Enums:                {N}
  Unresolvable types:   {N} (will use empty schema)
```

No ASK checkpoint unless unresolvable types exceed 30% of total schemas:

**ASK (conditional):** "{N}% of schemas could not be resolved. Continue with empty schemas, or provide type definitions manually?"

---

### Step 5: OpenAPI Assembly

Build the complete OpenAPI document.

1. **`info`** — from `package.json` (title, version, description).
2. **`servers`** — detect from env config or Docker Compose; default `http://localhost:{port}`.
3. **`paths`** — one entry per unique path. Each operation includes `operationId`, `summary`, `tags`, `parameters`, `requestBody`, `responses` (with `$ref`), and `security`.
4. **`components/schemas`** — all extracted types as JSON Schema.
5. **`components/securitySchemes`** — JWT Bearer, API Key, OAuth 2.0, or cookie/session based on detected auth patterns.
6. **`tags`** — one per resource group with descriptions.

Present a structural overview (not the full spec):

```
OpenAPI Spec Structure:
  info.title:        {title}
  info.version:      {version}
  servers:           {N} servers
  paths:             {N} paths, {M} operations
  components:
    schemas:         {N}
    securitySchemes: {N}
  tags:              {N}
  Estimated size:    ~{N} lines
```

**ASK:** "Here is the spec structure. Review before I write the file to `{output path}`:
- Confirm to write
- Preview a specific section (paths, schemas, security)
- Adjust structure (rename tags, regroup endpoints, change server URLs)"

---

### Step 6: Validation

Run structural and content validation on the assembled spec.

1. **Structural:** all `$ref` pointers resolve, no duplicate `operationId`, no duplicate path+method, required fields present.
2. **Content quality:** endpoints missing `summary`/`description`, responses without error codes (400, 401, 500), request bodies without `required` fields, undocumented path parameters, security-sensitive endpoints without auth.
3. **Convention checks** (from `hatch3r-api-design` rule if loaded): naming conventions, consistent error shapes, pagination consistency, versioning alignment.
4. Run `spectral` or `redocly` CLI if available in the project.

```
Validation Results:
  Structural:        {pass / N errors}
  Descriptions:      {N} operations missing descriptions
  Error codes:       {N} operations missing standard error responses
  Security:          {N} sensitive endpoints without auth schemes
  Conventions:       {N} violations (from hatch3r-api-design)
  Spectral/Redocly:  {N warnings, M errors / not available}
```

Fix structural errors automatically. Present convention warnings for user decision.

**ASK (if warnings exist):** "Validation found {N} warnings. Fix these before writing, or write as-is and address later?"

---

### Step 7: Drift Detection (Validate Mode Only)

If mode is `validate`, compare the existing spec against discovered endpoints from Step 3.

1. **Load and parse** the existing spec.
2. **Classify each endpoint** as Matching (in both, types consistent), Undocumented (in code only), Stale (in spec only), or Drifted (in both, types differ).
3. **Compare schemas** — fields added/removed in code vs. spec, type changes, optional→required shifts.
4. **Compare security** — endpoints that gained or lost auth requirements.

```
Drift Report:
  Matching:       {N} endpoints — no drift
  Undocumented:   {N} endpoints in code, missing from spec
    {method} {path} — {file}:{line}
  Stale:          {N} endpoints in spec, not found in code
    {method} {path}
  Drifted:        {N} endpoints with schema differences
    {method} {path} — {diff summary}
  Security drift: {N} endpoints with auth changes
```

**ASK:** "Drift report above. Options:
- **Update spec** — merge undocumented, remove stale, update drifted
- **Report only** — write drift report to `docs/api/drift-report.md`
- **Selective update** — tell me which changes to apply"

---

### Step 8: Output

After all confirmations:

1. **Write the spec file** to the confirmed output path. Create parent directories if needed.
2. **Write a summary report** to `docs/api/api-spec-summary.md` containing: generation date, mode, framework, endpoint/schema/tag counts, coverage percentages (descriptions, request types, response types, error responses, auth), endpoints-by-tag breakdown, and unresolved issues.
3. If validate mode with updates, write the updated spec.
4. Present final summary:

```
Files Created/Updated:
  {output path}                — {N} endpoints, {M} schemas
  docs/api/api-spec-summary.md — coverage and stats report
  docs/api/drift-report.md     — drift report (validate mode only, if applicable)
```

---

## Error Handling

- **No route definitions found:** Report and ASK the user to confirm framework, point to route files, or check scope. Do not generate an empty spec.
- **Types not extractable (JS without JSDoc):** Warn schemas will be `{}`. Recommend adding JSDoc or TypeScript types. Proceed with placeholders if confirmed.
- **Multiple API frameworks detected:** Present all with file counts and confidence. ASK which to use as primary, or generate a combined spec with tags separating frameworks.
- **Existing spec parse failure (validate mode):** Report parse error with line number. ASK whether to regenerate or fix manually first.
- **Circular type references:** Break cycle with `$ref` to root type and warn the user.
- **File write failure:** Report error and provide full spec content for manual creation.
- **Missing `package.json`:** Use placeholders for `info.title`/`info.version`. ASK the user to provide values.
- **Researcher sub-agent failure:** Retry once. If it fails again, fall back to inline scanning with reduced depth.

## Guardrails

- **Never overwrite an existing spec without confirmation.** Present a diff summary and ASK before writing.
- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Flag endpoints with no request/response types.** Always surface these rather than silently generating `{}`.
- **Warn about security endpoints without auth schemes.** Auth, payments, and user data endpoints must have `security` defined.
- **Do not invent endpoints.** Only document routes that exist in code.
- **Do not modify application code.** This command reads the codebase — it writes only to spec and documentation files.
- **Respect existing spec structure in validate mode.** Preserve custom descriptions, examples, and `x-*` extensions.
- **Schema names must be stable.** Use original TypeScript type/interface names — consumers may depend on name stability.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs → codebase exploration → Context7 MCP → web research.
- **Spec must be valid.** Never write a spec that fails structural validation. Fix issues before writing.

## Output Templates

### Spec Header

```yaml
openapi: "3.1.0"
info:
  title: "{package name}"
  version: "{package version}"
  description: "{package description}"
servers:
  - url: "http://localhost:{port}"
    description: "Local development"
```

### Drift Report Entry

```markdown
### {METHOD} {path}

- **Status:** {Undocumented | Stale | Drifted}
- **File:** `{source file}:{line}`
- **Details:** {what differs — added/removed fields, type changes}
- **Suggested fix:** {add to spec / remove from spec / update schema}
```

## Related

- **Rule:** `hatch3r-api-design` — API design conventions the generated spec must follow
- **Command:** `hatch3r-codebase-map` — structural map that can help scope the API scan
- **Command:** `hatch3r-project-spec` — project-level specification for API info block context
- **Agent:** `hatch3r-researcher` — performs codebase scan for route definitions
- **Agent:** `hatch3r-docs-writer` — assembles the final spec document
- **Agent:** `hatch3r-reviewer` — validates the generated spec for correctness
