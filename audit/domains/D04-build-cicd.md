# Domain 4: Build, CI/CD & Dependencies

**Scope:** Build tooling, dependency health, CI workflows, release pipeline, and community readiness for open-source distribution.
**Sub-agents:** 5

## Sub-Agent Decomposition

| SA | Focus | Key Files |
|----|-------|-----------|
| 4.1 | Build Configuration | `tsup.config.ts`, `tsconfig.json`, `package.json` (build scripts) |
| 4.2 | Dependency Health | `package.json`, `package-lock.json`, `npm audit` |
| 4.3 | CI Workflows | `.github/workflows/` (5 workflows: `ci.yml`, `pr-checks.yml`, `release.yml`, `deploy-docs.yml`, `docs-pr-preview.yml`) |
| 4.4 | Release Pipeline & OIDC | `.github/workflows/release.yml`, npm provenance, OIDC signing |
| 4.5 | Community & OSS Readiness | `CONTRIBUTING.md`, issue templates, PR template, CoC, dependabot, license |

## Audit Checklists

### 4.1 Build Configuration
- [ ] tsup config correctness — entry points, output paths, format options
- [ ] Output format — ESM/CJS dual output, correct module resolution
- [ ] Tree-shaking — unused code eliminated from output
- [ ] Sourcemaps — generated and correctly mapped
- [ ] Bundle size analysis — compare against budget, identify bloat
- [ ] tsconfig strictness — strict mode enabled, no permissive overrides

### 4.2 Dependency Health
- [ ] `npm audit` clean — zero known vulnerabilities
- [ ] Outdated packages — all dependencies on current or LTS versions
- [ ] CVE exposure — no dependencies with unpatched CVEs
- [ ] Minimal dependency surface — no unnecessary dependencies
- [ ] Lockfile integrity — `package-lock.json` is consistent and committed
- [ ] Unnecessary dependencies — identify and recommend removal

### 4.3 CI Workflows
- [ ] All 5 workflows: completeness, correctness, trigger configuration
- [ ] Security — no secret leaks, pinned action versions (SHA, not tags)
- [ ] Matrix testing — Node versions (18, 20, 22), OS (ubuntu, macos, windows)
- [ ] Caching — dependency caching configured for performance
- [ ] Workflow triggers — correct event triggers, no unnecessary runs

### 4.4 Release Pipeline & OIDC
- [ ] Release workflow integrity — correct trigger, build, publish sequence
- [ ] npm provenance — provenance attestation enabled for verifiable publish origin
- [ ] OIDC trusted publishing — GitHub Actions OIDC token exchange configured
- [ ] Semver adherence — version bumps follow semantic versioning rules
- [ ] Git tag alignment — npm version matches git tag
- [ ] GitHub release creation — release notes generated automatically
- [ ] Lifecycle script safety — no `postinstall` or other lifecycle scripts that execute arbitrary code
- [ ] 2FA enforcement — npm account requires two-factor authentication for publish

### 4.5 Community & OSS Readiness
- [ ] CONTRIBUTING.md quality — clear, complete contribution guide
- [ ] Issue templates — `.github/ISSUE_TEMPLATE/` useful and actionable
- [ ] PR template — guides quality contributions
- [ ] Code of Conduct — present and appropriate
- [ ] Dependabot — `.github/dependabot.yml` configured for automated dependency updates
- [ ] LICENSE file — MIT license correct and present
- [ ] `.gitignore` completeness — sensitive files excluded, no unnecessary entries
