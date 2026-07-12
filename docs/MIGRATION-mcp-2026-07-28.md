# Migration — MCP 2026-07-28 Release Candidate

The Model Context Protocol [2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) (accessed 2026-05-27) is the largest protocol revision since launch and is tentatively GA in Q3 2026. hatch3r-emitted MCP config in all 3 adapters (`.mcp.json` for Claude Code, `.cursor/mcp.json` for Cursor, `.github/.../mcp` for Copilot) targets the most-recent **stable** revision `2025-11-25` via the `protocolVersion` field. This document tracks what changes when servers move to the RC so operators can pin ahead of GA.

## Re-verification log

`MCP_DEFAULT_PROTOCOL_VERSION` (`src/adapters/mcp-utils.ts`) pins the most-recent **stable** MCP revision. Each audit cycle re-checks it against the spec versioning page and logs the result here. The constant bump plus the migration steps below run only once the 2026-07-28 revision is promoted from release candidate to **current** stable — until then the pin stays on the stable revision.

| Re-checked | Current stable revision (spec) | Pinned constant | 2026-07-28 GA landed? | Action taken |
|------------|--------------------------------|-----------------|-----------------------|--------------|
| 2026-07-12 (Cycle-12 Wave-4, D2-SA2.4-16) | 2025-11-25 | 2025-11-25 (match) | No | None — constant left on 2025-11-25; re-check due after 2026-07-28 |

Source for the 2026-07-12 re-check: https://modelcontextprotocol.io/specification/versioning (accessed 2026-07-12) — "The **current** protocol version is **2025-11-25**." No 2026-07-28 revision is listed as Draft/Current/Final on the versioning page yet, so no bump this cycle.

## Current hatch3r behavior

- `.mcp.json` declares `protocolVersion: "2025-11-25"` (the most-recent stable revision; constant `MCP_DEFAULT_PROTOCOL_VERSION` in `src/adapters/mcp-utils.ts`).
- Override via `.hatch3r/hatch.json`:
  ```json
  { "mcp": { "servers": ["github"], "protocolVersion": "2026-07-28" } }
  ```
  Set `protocolVersion` to `2026-07-28` only after every server in your fleet supports the RC.

## Breaking changes in 2026-07-28 (verified against the RC announcement)

| Change | 2025-11-25 (current) | 2026-07-28 (RC) | Operator action |
|--------|----------------------|-----------------|-----------------|
| Handshake | `initialize` / `initialized` exchange required | Removed; protocol version + client info travel in `_meta` on every request | None at hatch3r layer; server/client libraries must upgrade |
| Sessions | `Mcp-Session-Id` header, protocol-level sessions | Removed; stateless core, works behind standard load balancers | Re-architect stateful servers before pinning to RC |
| Tasks | (n/a) | Lifecycle moved to an extension: `tools/call` returns task handles; clients drive via `tasks/get` / `tasks/update` / `tasks/cancel` | Adopt the Tasks extension only if long-running tools are in use |
| Missing-resource error code | `-32002` (MCP-custom) | `-32602` (JSON-RPC standard Invalid Params) | Update error-code handling in custom server/client glue |
| Roots / Sampling / Logging | Supported | Formally deprecated, twelve-month removal window | Plan replacement before the removal window closes |

## When to pin `protocolVersion: "2026-07-28"`

1. Confirm every MCP server referenced in `mcp.servers` advertises 2026-07-28 support.
2. Confirm your client (Claude Code / Cursor / VS Code Copilot) negotiates the RC.
3. Update error-handling glue for the `-32002` → `-32602` change.
4. Set `mcp.protocolVersion` in `.hatch3r/hatch.json` and run `npx hatch3r sync`.

Until those four hold, leave the field at its default so generated config stays on the stable revision.

## References

- MCP 2026-07-28 RC announcement — https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ (accessed 2026-05-27, trust tier: official-docs)
- MCP 2026 roadmap — https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/ (accessed 2026-05-27, trust tier: official-docs)
