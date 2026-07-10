# Governance

> Last updated: 2026-07-09

How hatch3r is run and how changes land. For contribution mechanics (setup, tests, PR conventions, pack authoring) see [CONTRIBUTING.md](CONTRIBUTING.md); for what the project is, see [README.md](README.md).

## Decision model

hatch3r is a solo-maintainer open-source project (MIT). The maintainer reviews and merges every pull request, publishes every npm release, and approves every change to shipped agent behavior. There is no steering committee or voting process; the maintainer is the final decision authority.

## Proposing changes

- **Code and documentation** (`src/`, `docs/`, `website/`, top-level docs): open an issue or send a pull request directly.
- **Shipped content and agent behavior** (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/` — the files hatch3r installs into user repos): open an issue describing the change and its intended effect; accepted proposals are routed through an internal pipeline that is quality-audited via a recurring 24-domain governance cycle before release.
- **Vulnerabilities:** report privately per [SECURITY.md](SECURITY.md), not in a public issue.

## Landing rules

A pull request merges only when all of the following hold:

1. **CI green** across the named gates: supply-chain security (lockfile lint, npm audit, dependency review, MCP + CLI-tool CVE checks, Socket scan); the build matrix on Node 22/24 across Ubuntu/macOS/Windows (build, lint, typecheck, tests with coverage); content + governance validation (`npm run validate` and the `hatch3r validate` CLI); inventory and finding-registry drift checks; bundle-size gate.
2. **DCO sign-off** on every commit (`git commit -s`) — CI-verified.
3. **Conventional Commits** PR title (`feat|fix|refactor|test|docs|chore|audit(scope): message`) — CI-verified.
4. **Maintainer review and merge.** No force-push to `main`; work lands from feature branches.

Releases land via tagged release PRs; the maintainer tags and publishes to npm.

## Private governance layers

The `governance/` corpus — the project constitution and the per-release audit machinery — is maintained in a private overlay: it is the framework's core IP and encodes the quality-bar internals the shipped content is held to. The public evidence of that bar lives in this repo: [`governance/inventory.json`](governance/inventory.json) (auto-derived artifact counts, drift-checked in CI), the CI gates named above, and per-release notes in [CHANGELOG.md](CHANGELOG.md).

## Continuity

The maintainer holds sole publish and consent authority today; successor and escrow designation is tracked in the internal governance layer.
