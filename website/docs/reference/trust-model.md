---
sidebar_position: 7
title: Pack Trust Model
---

# Pack Trust Model

hatch3r content reaches you through one of two channels: the **canonical** content bundled with the npm package, and — when pack distribution ships — third-party **marketplace** packs installed via `hatch3r add <source>`. This page describes the trust model for those packs: the tiers, how packs are signed and verified, and what you as a consumer can check.

:::warning Maturity: this is a specification, not shipped behavior
Pack distribution is a **specification**, not a fully implemented runtime. `hatch3r add` is currently a placeholder that prints a roadmap notice and exits — the install-time signature, body-scan, lifecycle-script, and capability checks described below do **not** execute on your machine today. This page documents the contract that takes effect when `hatch3r add` is wired up. It is intentionally explicit about this so you do not infer a runtime safety net that is not present yet. The canonical content you install via `npx hatch3r init` is covered by the npm package's own publish provenance (see [Canonical tier](#canonical-tier)).
:::

## Pack tiers

| Tier | Source | Distribution | Trust origin |
|------|--------|--------------|--------------|
| **Canonical** | The `agents/`, `skills/`, `rules/`, `commands/`, and `hooks/` content shipped with the `hatch3r` npm package | npm registry | The hatch3r maintainers — Trusted Publishing and npm provenance |
| **Marketplace** | Third-party packs installed via `hatch3r add <source>` | Anthropic plugin marketplace, Cursor plugin marketplace, git URL, or local path | The pack author plus the hatch3r review queue |

### Canonical tier

Canonical content is the single source of truth bundled inside the signed `hatch3r` npm package. Its integrity is established at the package level by npm publish provenance (Sigstore signing with a public transparency-log record), not by per-file inspection at install time. You can verify it with standard npm tooling:

```bash
npm audit signatures
```

### Marketplace tier

Marketplace packs are authored by third parties and pass through a review queue before distribution. They carry the same baseline guarantees as canonical content plus a manifest the consumer can inspect before install.

## Guarantees by tier

| Guarantee | Canonical | Marketplace |
|-----------|:---------:|:-----------:|
| npm provenance (Sigstore signing + transparency-log record) | required | required for npm-published packs |
| Per-file SHA-256 manifest | required | required |
| Body scan against denied patterns (injection, exfiltration, destructive commands) | enforced at sync | enforced at install |
| `preinstall` / `postinstall` lifecycle-script ban | opt-in only, documented | forbidden |
| Capability declaration (what the pack requests) | declared in frontmatter | required upfront in the pack manifest |
| Human review before distribution | PR plus the audit cycle | review queue (see below) |
| Tool-allowlist conformance (deny-by-default per agent) | enforced | enforced; pack tools must be a subset of the declared set |

## Signing and verification

How a pack is signed depends on how it is distributed.

- **npm-published packs** use Trusted Publishing with GitHub OIDC (short-lived publish credentials, no long-lived token in the author's repo) or `npm publish --provenance`. Consumer-side, the install path runs `npm audit signatures` before unpacking; a failure refuses the install.
- **git-URL or local-path packs** cannot use npm provenance, so they substitute Sigstore keyless signing of the pack tarball (verifiable with `cosign verify-blob` against the author's OIDC identity), a committed SHA-256 file manifest, and a pinned 40-character commit SHA recorded so a later mismatch fails closed.
- **Marketplace registries** (Anthropic, Cursor) apply their own ingestion checks; hatch3r additionally records the marketplace-issued advisory identifier so `hatch3r status` can surface takedown notices.

## What a consumer can verify

Before and after installing a pack, you can check:

1. **Signature.** Run `npm audit signatures` for npm packs, or `cosign verify-blob` for tarball-distributed packs, to confirm the publisher's identity and that the bytes were not altered after signing.
2. **Manifest integrity.** Compare the per-file SHA-256 manifest against the unpacked files to confirm nothing was added or modified in transit.
3. **Declared capabilities.** Read the pack manifest's `required_capabilities` (drawn from a closed enum such as `mcp`, `hooks`, `subagents`, `agentTeams`, `slashCommands`) and its `tool_footprint` (caps on how many agents, skills, rules, commands, and hooks it writes). You can refuse an install whose declared surface exceeds what you authorize.
4. **Declared tools.** Read `declared_tools` — the union of every tool the pack's agents request (for example `Read`, `Edit`, `Write`, `Bash`, `WebFetch`). The install validator cross-checks this against the agents' frontmatter; any tool used but not declared refuses the install.

A representative marketplace pack manifest:

```json
{
  "pack_id": "hatch3r-example-pack",
  "version": "1.0.0",
  "hatch3r_min_version": "^1.7.0",
  "required_capabilities": ["mcp", "hooks"],
  "tool_footprint": {
    "max_agents": 2,
    "max_skills": 5,
    "max_rules": 3,
    "max_commands": 1,
    "max_hooks": 1
  },
  "declared_tools": ["Read", "Edit", "Write", "Bash"],
  "signing": { "method": "npm-provenance", "identity": "...", "transparency_log": "..." }
}
```

## What the trust model does NOT guarantee

The model is content-addressed and policy-enforced, not capability-isolated. Be clear-eyed about the boundary:

- **No sandboxing.** hatch3r does not sandbox the AI coding tool that consumes a pack. Tools execute with your shell credentials. If you require capability isolation, run hatch3r inside your own sandbox (a dev container or an ephemeral VM).
- **Scanning is not semantic certification.** A signed-and-scanned pack still contains instructions a downstream tool may follow. The body scan catches known injection, exfiltration, and destructive-command classes; it does not certify that the pack's intent is safe.
- **Revocation is upstream.** Revoking a published signature is the registry's job (the npm unpublish window, a marketplace takedown). hatch3r honors revocations on the next `update` and surfaces a warning, but it does not auto-uninstall — you retain control via `hatch3r remove`.

## Review queue (marketplace packs)

Marketplace submissions move through a sequential pipeline; no stage is skipped:

```
Pack author -> submission PR -> automated security review -> policy match -> manual sign-off -> marketplace publish
```

| Stage | What happens |
|-------|--------------|
| Submission | PR opened with a signed manifest and the tarball SHA-256 |
| Automated security review | Body scan for denied patterns, static scan of `package.json` for banned lifecycle scripts, signature verification |
| Policy match | Declared capabilities and tool footprint cross-checked against the closed enum and the actual unpacked artifact count |
| Manual sign-off | A human reviewer reads the pack body, runs an adversarial-thinking pass (injection beyond the pattern set, privilege-escalation surface, sandbox-escape surface), and applies the framework's pillar-compliance test |
| Publish | Tarball and manifest mirrored to the marketplace; the signing record archived |

A pack that fails any stage has its PR closed with reviewer notes; re-submission requires a version bump.

## Related

- [Auxiliary Artifacts](./auxiliary-artifacts) — the Prompts class reserved for distributed packs.
- [Configuration](./configuration) — `hatch.json` and the `.hatch3r/` layout packs install into.
- [About hatch3r](../about) — the framework's security-and-trust principles in context.
