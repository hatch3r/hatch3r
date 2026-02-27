---
description: API endpoint and contract design patterns for the project
alwaysApply: true
---
# API Design

- Use consistent request/response schemas. Document in spec files.
- All endpoints versioned (URL prefix or header). Backward-compatible changes only.
- Additive changes only: add fields, never rename or remove without migration.
- Error responses follow standard shape: `{ code, message, details? }`.
- Idempotency keys for mutation endpoints. Reject duplicate requests.
- Request validation at the boundary: validate and sanitize before processing.
- List endpoints return envelopes: `{ data, pagination }`. Never raw arrays.
- Rate limiting enforced server-side. Return 429 with `Retry-After` when exceeded.
- API contracts documented in project specs. Update on schema changes.

## Authentication & Authorization

- Validate JWT signature, expiration (`exp`), audience (`aud`), and issuer (`iss`) on every request.
- Enforce algorithm in server config (`RS256` for asymmetric, `HS256` for symmetric). Reject `alg: none`.
- Access tokens short-lived (15–60 min). Use opaque refresh tokens with rotation and revocation.
- OAuth 2.0 with PKCE for SPAs and mobile clients. Never use implicit flow.
- API keys identify applications, not users. Scope keys to specific services and rotate on schedule.
- Authorization middleware checks permissions before handler execution. Fail closed on missing claims.
- Apply principle of least privilege: scope tokens to the minimum required permissions.
- Store tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies when possible. Avoid `localStorage`.

## CORS Policy

- Allowlist specific origins explicitly. Never use `Access-Control-Allow-Origin: *` in production.
- Set `Access-Control-Allow-Credentials: true` only for origins that require cookie-based auth.
- Cache preflight responses with `Access-Control-Max-Age` (e.g., 7200 seconds) to reduce OPTIONS overhead.
- Restrict `Access-Control-Allow-Methods` to the methods the endpoint actually supports.
- Restrict `Access-Control-Allow-Headers` to required headers. Do not reflect the request's headers verbatim.
- Reject requests from origins not on the allowlist at the gateway level before reaching application code.

## Security Headers

- `Strict-Transport-Security`: `max-age=63072000; includeSubDomains; preload`. Enforce HTTPS everywhere.
- `Content-Security-Policy`: Use nonce-based script directives. Avoid `unsafe-inline` and `unsafe-eval`.
- `X-Content-Type-Options: nosniff`. Prevent MIME-type sniffing.
- `X-Frame-Options: DENY` (or `SAMEORIGIN` if iframing is required within the same domain).
- `Referrer-Policy: strict-origin-when-cross-origin`. Minimize referrer leakage.
- `Permissions-Policy`: Disable unused browser features (`camera=(), microphone=(), geolocation=()`).
- Return security headers from a centralized middleware so every response includes them consistently.

## Pagination Standards

- Default to cursor-based pagination for ordered data with high write frequency or deep traversal.
- Use offset-based pagination only for small, stable datasets where total count is cheap.
- Enforce a maximum page size server-side (e.g., 100 items). Ignore client requests exceeding the limit.
- Return `nextCursor` (or `null`) in the envelope. Clients must not construct cursors—they are opaque.
- Total count is optional: provide it only when the query cost is bounded. Use `hasMore` boolean otherwise.
- Reject deep offset pagination beyond a threshold (e.g., offset > 10000) to protect database performance.
- Include pagination metadata in the envelope: `{ data, pagination: { nextCursor, hasMore, pageSize } }`.

## Request Security

- Enforce TLS 1.2+ (prefer 1.3). Terminate TLS at the edge or load balancer; reject plaintext HTTP.
- Set request body size limits per endpoint (e.g., 1 MB default, higher for file uploads with explicit cap).
- Validate `Content-Type` header matches expected media type. Reject mismatched content types with 415.
- File uploads: validate MIME type by inspecting magic bytes, not just the extension or header. Restrict to an allowlist.
- SSRF prevention: validate and restrict outbound URLs to an allowlist. Block private/internal IP ranges (`10.x`, `172.16–31.x`, `169.254.x`, `127.x`, `::1`). Resolve DNS before checking.
- Sanitize user input that appears in outbound requests (headers, URLs, body). Parameterize—never interpolate.
- Apply request throttling per client identity, not just per IP, to handle shared proxies.

## Webhook Security

- Sign payloads with HMAC-SHA256 using a per-provider shared secret. Include the signature in a header (e.g., `X-Webhook-Signature: v1=<hex>`).
- Include a timestamp header (e.g., `X-Webhook-Timestamp`). Reject payloads older than 5 minutes.
- Verify the signature over the raw request body bytes using constant-time comparison.
- Idempotency: track delivery IDs to prevent processing duplicate webhook events.
- Delivery retries: use exponential backoff (e.g., 1s, 5s, 30s, 5m, 30m) with a maximum retry count.
- Rotate webhook secrets periodically. Support dual-secret verification during rotation windows.
- Log signature verification failures and alert on anomalous patterns (spike in failures, unknown sources).
- Process webhook payloads asynchronously: acknowledge with 200 immediately, then enqueue for processing.

## OpenAPI 3.1

- Use OpenAPI 3.1 for all REST API documentation. 3.1 aligns fully with JSON Schema (draft 2020-12), eliminating the type mismatches present in 3.0.
- **JSON Schema alignment:** Use standard JSON Schema keywords directly — `$ref` alongside other keywords, `type` as an array (`"type": ["string", "null"]`), `const`, `prefixItems`, `contentMediaType`. No more `nullable: true` (use `type: ["string", "null"]` instead).
- **Webhooks support:** Define webhooks as top-level objects alongside `paths`. Each webhook specifies the callback URL pattern, payload schema, and expected response.
- **`$id` and `$anchor`:** Use JSON Schema `$id` for reusable schema identification and `$anchor` for in-document references. This replaces the need for custom `x-` extension workarounds.
- Validate OpenAPI specs in CI using `@redocly/cli lint` or `spectral`. Block merges on validation failures.
- Generate TypeScript types from OpenAPI specs using `openapi-typescript` for compile-time contract enforcement between client and server.
- Version OpenAPI spec files alongside the code they describe. Every API change must include a corresponding spec update in the same PR.

## GraphQL API Design

### Schema Design

- **Schema-first:** Define the schema (SDL) before implementing resolvers. The schema is the contract — it drives both client and server code generation.
- **Naming:** Types in `PascalCase`, fields and arguments in `camelCase`, enum values in `SCREAMING_SNAKE_CASE`.
- **Nullability:** Fields are nullable by default in GraphQL. Use `!` (non-null) deliberately — only for fields that will always have a value. Over-using `!` makes error handling brittle.
- **Input types:** Use dedicated `input` types for mutations. Never reuse output types as mutation inputs.
- **Descriptions:** Every type, field, and argument must have a description in the SDL. These are the API documentation.

### Pagination

- Implement the Relay Connection specification for paginated lists: `Connection` → `Edge` → `Node` pattern with `pageInfo` (hasNextPage, hasPreviousPage, startCursor, endCursor).
- Support `first`/`after` (forward) and `last`/`before` (backward) pagination arguments.
- Enforce a maximum page size server-side (e.g., 100). Reject requests exceeding the limit.

### Error Handling

- Use the standard GraphQL `errors` array for operation-level errors. Include `extensions.code` for machine-readable error classification (e.g., `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`).
- For field-level expected errors (e.g., a mutation that can fail), use union return types: `type CreateUserResult = User | ValidationError | ConflictError`. This makes error states explicit in the schema.
- Never expose internal error details (stack traces, SQL errors) in production error messages.

### N+1 Prevention

- Use DataLoader (or equivalent batching library) for every resolver that fetches data from a data source. DataLoader batches and deduplicates requests within a single GraphQL operation.
- Create one DataLoader instance per request (not globally). Global loaders leak data between requests.
- Monitor resolver execution with tracing (OpenTelemetry) to identify N+1 patterns that escape DataLoader coverage.

### Security

- Enforce query depth limits (e.g., max depth 10) and query complexity limits to prevent resource exhaustion from deeply nested or expensive queries.
- Disable introspection in production. Enable only in development and staging.
- Apply field-level authorization in resolvers. Schema visibility is not security — every resolver must verify permissions.

## gRPC API Design

### Protobuf Schema Design

- Use Protocol Buffers (proto3) for service and message definitions. Store `.proto` files in a shared `proto/` directory, versioned alongside code.
- **Naming:** Services in `PascalCase`, RPCs in `PascalCase`, messages in `PascalCase`, fields in `snake_case`, enums in `SCREAMING_SNAKE_CASE` with a `_UNSPECIFIED` zero value.
- **Field numbers:** Never reuse field numbers — they are the wire format identity. Reserve removed field numbers with `reserved`.
- **Backward compatibility:** Only add fields (never remove or rename). Use `optional` for new fields that older clients may not send. This is the same additive-only principle as REST.

### Streaming Patterns

| Pattern | Use Case | Example |
|---------|----------|---------|
| Unary | Simple request-response | `GetUser(GetUserRequest) returns (User)` |
| Server streaming | Server pushes multiple responses | `WatchEvents(WatchRequest) returns (stream Event)` |
| Client streaming | Client sends multiple messages | `UploadChunks(stream Chunk) returns (UploadResult)` |
| Bidirectional streaming | Both sides stream | `Chat(stream Message) returns (stream Message)` |

- Default to unary RPCs. Use streaming only when the use case requires it (real-time feeds, large uploads, bidirectional communication).
- Implement proper stream lifecycle: handle cancellation, set deadlines, and clean up resources on stream termination.

### Error Codes

- Use standard gRPC status codes (`google.rpc.Code`). Map domain errors to the most specific status code:

| Status Code | When to Use |
|-------------|-------------|
| `OK` | Success |
| `INVALID_ARGUMENT` | Client sent bad input |
| `NOT_FOUND` | Requested resource does not exist |
| `ALREADY_EXISTS` | Create conflict |
| `PERMISSION_DENIED` | Authenticated but not authorized |
| `UNAUTHENTICATED` | Missing or invalid credentials |
| `RESOURCE_EXHAUSTED` | Rate limit exceeded, quota depleted |
| `INTERNAL` | Unexpected server error |
| `UNAVAILABLE` | Transient failure, client should retry |
| `DEADLINE_EXCEEDED` | Operation timed out |

- Include structured error details using `google.rpc.Status` with `details` field for machine-readable error metadata (e.g., field violations, retry info).

## Rate Limit Headers

Follow the IETF draft standard (`draft-ietf-httpapi-ratelimit-headers`) for rate limit response headers:

| Header | Description | Example |
|--------|-------------|---------|
| `RateLimit-Limit` | Maximum number of requests allowed in the current window | `100` |
| `RateLimit-Remaining` | Number of requests remaining in the current window | `42` |
| `RateLimit-Reset` | Seconds until the rate limit window resets | `30` |
| `Retry-After` | Seconds to wait before retrying (on 429 responses) | `30` |

- Return these headers on every API response (not just 429). This lets clients implement proactive throttling.
- When the rate limit is exceeded, return HTTP `429 Too Many Requests` with `Retry-After` header.
- Document rate limits per endpoint tier in the API specification (e.g., auth endpoints: 100/min, read endpoints: 1000/min, write endpoints: 500/min).
- Apply rate limiting by authenticated identity (API key, user token) as the primary key. Fall back to IP-based limiting for unauthenticated endpoints.
