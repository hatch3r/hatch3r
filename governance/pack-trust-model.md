# hatch3r — Pack Trust Model

> Established: 2026-05-18 (Cycle 9 Wave 2, finding C9-H52 / D15-SA15.4-F02; subsumes C9-H59 / D16-F16.2.1)
> Trust contract, signing requirements, body-scan policy, lifecycle-script ban, capability declaration, and review queue for hatch3r packs. Authored as a CL-2 P1 artifact gating `hatch3r add <pack>` (PRD §8.4) and Anthropic / Cursor marketplace submissions (C9-H62, C9-H73).

**Pillars served:** P6 (Security & Trust Governance, primary), P5 (Governance Self-Quality, supporting).

---

## 1. Trust Contract

hatch3r distinguishes two pack tiers. Consumers receive different, named guarantees per tier.

### 1.1 Pack tiers

| Tier | Source | Distribution | Trust origin |
|------|--------|--------------|--------------|
| Canonical | `agents/`, `skills/`, `rules/`, `commands/`, `hooks/` shipped with the `hatch3r` npm package | npm registry | Maintainer (this repo) — Trusted Publishing + provenance per `rules/hatch3r-dependency-management.md` |
| Marketplace | Third-party packs installed via `hatch3r add <source>` (PRD §8.4) | Anthropic plugin marketplace, Cursor plugin marketplace, git URL, local path | Pack author + hatch3r review queue (§6) |

### 1.2 Guarantees by tier

| Guarantee | Canonical | Marketplace | Verification |
|-----------|:---------:|:-----------:|--------------|
| npm provenance (Sigstore + Rekor inclusion) | required | required for npm-published packs | `npm audit signatures` post-fetch (C9-H51) |
| SHA-256 per-file manifest | required | required | Schema defined in §2.2 below; runtime implementation deferred to pack-distribution feature (not shipped as of 1.9.0) |
| Body scan against `DENY_PATTERNS` | enforced at sync (`src/merge/safeWrite.ts:393`, `src/content/userContent.ts:307`) | enforced at pack-install time (§3) | `scanForDeniedPatterns()` (`src/adapters/customization.ts:340`) — 30+ deny regexes |
| `preinstall` / `postinstall` ban | opt-in only with documented justification | forbidden (§4) | static scan of pack `package.json` before unpack |
| Capability declaration | declared in `agents/*.md` frontmatter and `hatch.json` | required upfront in pack manifest (§5) | `src/cli/commands/validate.ts::validateCommandOrchestratorFrontmatter` (already enforces orchestrator + agentPipeline) |
| Human review before distribution | enforced via PR + audit cycle | enforced via review queue (§6) | maintainer sign-off recorded in pack metadata |
| Tool allowlist conformance | hard-enforced via `src/pipeline/agentToolAllowlist.ts` | hard-enforced; pack tools must be subset of declared capability set | per-agent deny-by-default |
| Integrity drift check on `add` | n/a | run before unpack | `src/cli/commands/add.ts::preflightIntegrityCheck` |

### 1.3 What the contract does NOT guarantee

The trust model is content-addressed and policy-enforced, not capability-isolated. Concretely:

- hatch3r does not sandbox the AI coding tool that consumes the pack. Tools execute with the user's shell credentials.
- A signed-and-scanned pack still embeds instructions that a downstream tool may follow. Body scan catches the canonical injection classes listed in `customization.ts:16-103`; it does not certify semantic safety.
- Revoking a published signature is the registry's responsibility (npm unpublish window, marketplace takedown). hatch3r honors revocations on next `update`.

Consumers who require capability isolation operate hatch3r under an additional sandbox (devcontainer, ephemeral VM); the trust model documents this in the review queue (§6.3).

---

## 2. Signing Requirement

### 2.1 npm-published packs

Mandatory controls (cite `rules/hatch3r-dependency-management.md` lines 35-49):

- **Trusted Publisher with GitHub OIDC** for new packs — exchanges per-run JWT for short-lived publish credentials; no long-lived `NPM_TOKEN` in pack-author repository.
- **`npm publish --provenance`** when Trusted Publishing is not yet configured. The flag activates Sigstore-signed provenance via Fulcio with Rekor inclusion record.
- **`repository` field** set in `package.json` — provenance validation fails without it (npm CLI behavior since 11.5.1).
- **`id-token: write`** permission at the publishing-job level.
- **SLSA Build L3** target via `slsa-framework/slsa-github-generator` pinned to a 40-character commit SHA.

Consumer-side verification: `hatch3r update` runs `npm audit signatures` programmatically (closed by C9-H51, finding D15-SA15.4-F01); `hatch3r add <pack>` runs the same check before unpack. Failure refuses install with `INTEGRITY_ERROR` exit code 1.

### 2.2 Non-npm packs (git URL, local path)

When `hatch3r add` resolves to a git ref or local directory, npm provenance is unavailable. Required substitutes:

- **Sigstore keyless signing** of the pack tarball via `cosign sign-blob --yes` against the OIDC identity of the pack-author's CI. Verified via `cosign verify-blob --certificate-identity <author> --certificate-oidc-issuer <issuer>`.
- **SHA-256 manifest** committed under `pack-manifest.json` at the pack root listing every file path + hash. Logical schema (runtime implementation deferred to when pack distribution ships):

  ```typescript
  // pack-manifest.json structure — logical schema for pack-distribution
  // (runtime implementation deferred to when pack distribution ships).
  interface IntegrityManifest {
    files: Record<string, string>;   // path → SHA-256 hex digest
    checksum: string;                // SHA-256 of the sorted files map, hex
  }
  ```
- **`pack-manifest.json` itself signed** via Sigstore (`cosign sign-blob`) — manifest-level integrity follows the schema above.
- **Pinned git ref** in `hatch.json` records the 40-character commit SHA, never a tag or branch. `hatch3r update` fails closed if the resolved commit differs from the recorded SHA.

### 2.3 Marketplace registries

Anthropic and Cursor marketplaces apply their own ingestion checks. hatch3r additionally records the marketplace-issued advisory identifier in `hatch.json` so `hatch3r status` surfaces takedown notices via the marketplace's webhook or polled endpoint (verification cadence: per `update`).

---

## 3. Body Scan Policy

### 3.1 Mandatory scan at pack-install time

`hatch3r add <pack>` runs `scanForDeniedPatterns()` over every `.md`, `.mdc`, `.yaml`, and `.json` file in the candidate pack BEFORE installing pack content into the user's repository under `.hatch3r/overrides/` or any adapter native path. The scan is a hard gate: any hit refuses install with non-zero exit and surfaces the matched pattern.

Implementation reuse: `src/adapters/customization.ts:340-365` (`scanForDeniedPatterns(content: string): string[]`). Already wired into `src/merge/safeWrite.ts:393` for user-content writes and `src/content/userContent.ts:307` for body + frontmatter scans. `hatch3r add` extends the same call site to the pack tarball.

### 3.2 Coverage of `DENY_PATTERNS`

The current pattern set (`customization.ts:16-103`) is layered defense across:

| Class | Examples (verbatim regex fragments) | Source |
|-------|-------------------------------------|--------|
| Audit/security bypass | `skip\s+(security|review|audit)`, `disable\s+(security|review|audit|test)`, `bypass\s+(security|auth|permission|review)` | Cycle 8 baseline |
| Exfiltration | `exfiltrate`, `send\s+(to|data|code)\s+(external|remote|http)`, `(?:upload|exfil)\s+(?:to|data|credentials|keys)` | Cycle 8 baseline + C9 Medium |
| Destructive | `delete\s+(all|everything|repo)`, `(?:chmod|chown)\s+[0-7]{3,4}` | Cycle 8 baseline |
| Credential leak | `(?:api[_-]?key|password|token|secret)\s*[:=]\s*.{8,}`, `(?:hardcoded|embedded)\s+(?:credentials?|secrets?|passwords?)` | Cycle 8 baseline + C9 Medium |
| Curl-pipe-shell | `(?:curl|wget|fetch)\s+.*\|\s*(?:bash|sh|eval)` | C9 Medium #358-385 |
| Prompt injection (English) | `ignore\s+(all\s+)?previous\s+instructions`, `you\s+are\s+now\s+(?:a|an|the)`, `forget\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|context)` | Cycle 8 + Cycle 9 |
| Unicode tag smuggling | `[\uDB40][\uDC00-\uDC7F]` (U+E0000-U+E007F invisible payload) | C9-H5 (D2-SA2.3-01) |
| Zero-width joiner adjacency | ZWJ/ZWNJ within 12 chars of an override keyword | C9-H5 |
| Base64-encoded payloads | Known base64 fragments of "Ignore all previous instructions", "System prompt:", "You are now", "Act as an" | C9-H5 (Promptfoo base64 strategy) |
| Homoglyph keywords | Cyrillic-spelled `ignore` (U+0456 / U+043E / U+0435), `system` (U+0455 / U+0443 / U+0442 / U+0435 / U+043C) | C9-H5 (AWS Unicode smuggling 2026) |
| ANSI escape injection | `\x1b\[` (CSI sequences) | C9-H5 (P-PIPE-05 mirror) |

Total: 30+ named regexes plus the homoglyph normalizer (`customization.ts:110+`). Cycle-over-cycle additions are tracked in `governance/audit/finding-registry.json` and propagate to pack-install scan automatically because both call sites import the same export.

### 3.3 Out-of-scope (intentional)

The body scan does not check:

- Binary files — pack manifest forbids non-text payloads outside `prompts/*.txt` and `checks/*.json` (§5.2 footprint constraint).
- Source code execution — there is no source code in canonical content. If a future pack ships `.ts` or `.js`, marketplace review (§6) blocks it; canonical packs would require a separate review carve-out and a new pillar-compliance proposal.

---

## 4. Lifecycle-Script Ban

### 4.1 Marketplace: forbidden

A pack published to the marketplace MUST NOT declare any of the npm lifecycle scripts in its `package.json`:

`preinstall`, `install`, `postinstall`, `prepare`, `preuninstall`, `postuninstall`, `prepublish`, `prepublishOnly`, `prerestart`, `restart`, `postrestart`, `prestart`, `pretest`, `test`, `posttest`.

Rationale: npm lifecycle scripts execute with the consumer's shell credentials on `npm install`. Shai-Hulud (Sep-Nov 2025), Mini Shai-Hulud (May 2026, 170+ packages / 518M downloads compromised), and the postinstall-mediated attacks tracked in OSV.dev all exploit this surface. Reference: `rules/hatch3r-dependency-management.md:72` (`ignore-scripts=true` enforced in CI) and D04 audit checklist `governance/audit/domains/D04-build-cicd.md:41` (lifecycle script policy).

Enforcement at pack-install time: static scan of the pack's `package.json` `scripts` field against the banned-name list above. Match refuses install with `LIFECYCLE_SCRIPT_BANNED` error code (exit 1).

### 4.2 Canonical: opt-in only, documented

Canonical content does not currently ship any lifecycle scripts (verified: `hatch3r` package itself sets `.npmrc` `ignore-scripts=true`). If a future canonical pack requires a lifecycle script (e.g., a platform-native install verifier), the change requires:

1. A pillar-compliance test entry (P6 + P5 served, measurable benefit, size impact justified).
2. Explicit documentation in this file's §4 with the script name, exact command, and adversarial-thinking analysis.
3. CL-3 (`AUDIT-EXECUTE.md` Phase 7) per-proposal user consent before the change ships.

The default posture is: no lifecycle scripts in canonical OR marketplace packs.

---

## 5. Capability Declaration

Every pack — canonical and marketplace — declares its required adapter capabilities and maximum tool footprint in `pack-manifest.json` at the pack root. Consumers can refuse installation if the declared capability set exceeds what they have authorized.

### 5.1 Manifest schema (required fields)

```json
{
  "pack_id": "string (matches hatch3r-* naming if marketplace)",
  "version": "string (semver)",
  "hatch3r_min_version": "string (e.g., ^1.7.0)",
  "required_capabilities": ["mcp", "hooks", "subagents", "agentTeams"],
  "tool_footprint": {
    "max_agents": 0,
    "max_skills": 0,
    "max_rules": 0,
    "max_commands": 0,
    "max_hooks": 0
  },
  "declared_tools": ["Read", "Edit", "Write", "Bash", "WebFetch", "WebSearch"],
  "mcp_servers": [],
  "signing": { "method": "npm-provenance|cosign-keyless", "identity": "...", "transparency_log": "..." },
  "review_queue": { "submission_id": "...", "reviewer": "...", "decision_date": "YYYY-MM-DD" }
}
```

Field validation occurs at install time via `src/cli/commands/add.ts`. Missing or malformed fields refuse install (exit 1) with the specific error.

### 5.2 Capability set (closed enum)

The `required_capabilities` field draws from the closed enum tracked in `src/adapters/index.ts::ADAPTER_CAPABILITIES`:

`mcp`, `hooks`, `subagents`, `agentTeams`, `slashCommands`, `customRules`, `mcpEnvVarFormat`, plus any added in future cycles. Packs requesting an unknown capability are refused at install. The closed enum keeps the trust surface auditable — consumers can enumerate exactly what a pack will request.

### 5.3 Tool-footprint enforcement

`tool_footprint.max_*` caps the count of artifacts the pack writes. If the unpacked pack exceeds any declared cap, the install aborts with `TOOL_FOOTPRINT_EXCEEDED` (exit 1). This prevents marketplace-published packs from silently bloating canonical content during install and surfaces footprint changes between pack versions for the consumer's review.

### 5.4 Declared-tools allowlist

`declared_tools` enumerates every tool a pack's agents request (mirrors the per-agent allowlist surface in `src/pipeline/agentToolAllowlist.ts`). The pack-install validator cross-checks the union of all `tools:` frontmatter fields across the pack's agents against `declared_tools` — any tool used but not declared is a refuse-install error (`TOOL_NOT_DECLARED`, exit 1). This makes the privilege surface explicit in the manifest, not implicit in the artifact bodies.

---

## 6. Review Queue

### 6.1 Submission flow (marketplace packs)

```
Pack author → submission PR → security review → policy match → manual sign-off → marketplace publish
```

The queue is a sequential pipeline; no stage is skipped. State machine recorded in a per-pack file under `governance/pack-reviews/<pack-id>/<version>.md` (creation deferred until first marketplace submission lands per C9-H62).

### 6.2 Stage gates

| Stage | Gate | Reviewer | Output |
|-------|------|----------|--------|
| 1. Submission | PR opened against `hatch3r/pack-marketplace` with signed `pack-manifest.json` and tarball SHA-256 | Author | PR with manifest + tarball |
| 2. Automated security review | `scanForDeniedPatterns` over pack body; static-scan `package.json` for banned lifecycle scripts; signature verification (`npm audit signatures` or `cosign verify-blob`) | CI | CI status check + log |
| 3. Policy match | Declared capabilities + tool footprint cross-checked against the closed enum and the unpacked artifact count; pack manifest verified against tarball | CI | CI status check + diff |
| 4. Manual sign-off | Human reviewer reads pack body, runs adversarial-thinking pass per `agents/shared/quality-charter.md`, applies the pillar-compliance test (P6 + at least one of P1-P4-P8) | Maintainer | Sign-off comment + label `pack:approved` |
| 5. Publish | Pack tarball + manifest mirrored to marketplace; signing record archived under `governance/pack-reviews/` | Maintainer | Marketplace listing live; signatures discoverable |

A pack fails review at any stage and the PR is closed with reviewer notes. Re-submission requires a new version bump.

### 6.3 Adversarial-thinking pass (stage 4)

The human reviewer applies the same charter directive used in audit-cycle sub-agents (`agents/shared/quality-charter.md`):

1. **Prompt-injection scan beyond DENY_PATTERNS** — does the pack body describe scenarios that DENY_PATTERNS would not catch (steganographic encodings outside the listed classes, novel social-engineering wording)?
2. **Privilege-escalation surface** — does the pack request capabilities (`mcp`, `hooks`) whose declared use case is plausible? A `slashCommands` pack requesting `mcp` without a documented MCP use case is a reject.
3. **Sandbox-escape surface** — does any skill or command instruct the agent to read files outside the user's project root or `.hatch3r/` tree, or execute commands outside the documented project boundary? Reference: D15.7 sub-agent checklist `governance/audit/domains/D15-agentic-security.md:90-95`.
4. **Trust delegation** — does the pack introduce a sub-agent that bypasses the orchestrator (e.g., direct tool invocation from a skill body)? Reference: `governance/audit/domains/D15-trust-reference.md` invariant 1 (monotonically decreasing privilege).

### 6.4 Revocation

A pack approved at sign-off but later found to violate the trust contract is revoked via:

- Marketplace takedown request (Anthropic / Cursor process).
- `hatch3r/pack-marketplace` revocation list update — `governance/pack-reviews/revoked.json` lists `{pack_id, version, revoked_at, reason, cve}`.
- `hatch3r update` consults the revocation list at every run and surfaces a warning if any installed pack matches. Consumers can `hatch3r remove <pack>` to uninstall.

Revocation does not auto-uninstall; the consumer retains control. This matches the consent model in `governance/CONSTITUTION.md` §6 Decision #4 (per-proposal consent for high-risk operations).

---

## 7. Cross-References & Maintenance

| Reference | Purpose |
|-----------|---------|
| `governance/CONSTITUTION.md` §2 P6 | Pillar definition this artifact serves |
| `governance/audit/domains/D15-agentic-security.md` SA15.4 | Audit checklist gating this artifact's currency (4 sub-agent checks) |
| `governance/audit/domains/D15-trust-reference.md` | Trust delegation invariants reused in §1.3 and §6.3 |
| `governance/AUDIT-REPORT.md` Cycle 9 findings C9-H52, C9-H59, C9-H62, C9-H73 | Originating findings; this file closes C9-H52 (and C9-H59 by absorption) and unblocks C9-H62 + C9-H73 |
| `governance/hatch3r-prd.md` §8.4 | `hatch3r add <source>` flow the trust model governs |
| `src/adapters/customization.ts:340` | `scanForDeniedPatterns` referenced in §3 |
| §2.2 (this document) | `IntegrityManifest` schema defined inline; runtime implementation deferred to pack-distribution shipping |
| `src/cli/commands/add.ts` | Install-time gate runs trust-contract checks |
| `src/pipeline/agentToolAllowlist.ts` | Tool allowlist surface enforced per §5.4 |
| `rules/hatch3r-dependency-management.md` | Signing + provenance + lifecycle-script policy reused upstream |

### 7.1 Cadence

Reviewed each audit cycle by D15 SA15.4 (Supply Chain of Agent Definitions). Staleness > 90 days against the latest npm provenance / Sigstore / OWASP ASI guidance is a High finding. Update procedure: open a PR with the cycle date, cite the source URLs accessed, and apply the pillar-compliance test in `governance/CONSTITUTION.md` §2 Pillar Compliance Test.

### 7.2 Pillar-compliance entry (for future modifications)

1. P6 (Security & Trust Governance) — primary. Measurable improvement: every pack-install path executes signature verification + body scan + lifecycle-script check + capability validation before write.
2. P5 (Governance Self-Quality) — supporting. The trust model is itself audit-checked under D15.4 and lives within the lean threshold registered in `governance/CONSTITUTION.md` §2 P5.
3. Size impact: +1 governance artifact at ~280 lines. Justified by closing CD-6 (cross-domain finding D15/D17/D18); blocks pack-install merge per AUDIT-REPORT row C9-H52.
